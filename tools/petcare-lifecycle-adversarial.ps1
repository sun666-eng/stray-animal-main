<#
.SYNOPSIS
  PetCare personal AI lifecycle/adversarial probe against a real app, MySQL, and fake LLM.

.DESCRIPTION
  This script clears and rewrites PetCare data for the supplied accounts. It refuses to run
  unless -Destructive is supplied, or -ConfirmTestDatabase exactly matches a database whose
  name clearly identifies it as test/dev/qa/ci/scratch/sandbox.
#>
[CmdletBinding()]
param(
  [string]$BaseUrl = "http://localhost:9999",
  [string]$FakeLlmUrl = "http://127.0.0.1:18080",
  [Parameter(Mandatory = $true)][string]$UserA,
  [Parameter(Mandatory = $true)][string]$PassA,
  [Parameter(Mandatory = $true)][string]$UserB,
  [Parameter(Mandatory = $true)][string]$PassB,
  [Parameter(Mandatory = $true)][string]$RateUser,
  [Parameter(Mandatory = $true)][string]$RatePass,
  [Parameter(Mandatory = $true)][string]$MySqlPath,
  [string]$MySqlHost = "127.0.0.1",
  [ValidateRange(1, 65535)][int]$MySqlPort = 3306,
  [Parameter(Mandatory = $true)][string]$MySqlUser,
  [Parameter(Mandatory = $true)][string]$MySqlPassword,
  [Parameter(Mandatory = $true)][string]$MySqlDatabase,
  [string]$ConfirmTestDatabase,
  [switch]$Destructive,
  [Parameter(Mandatory = $true)][string]$OkKey,
  [Parameter(Mandatory = $true)][string]$OkModel,
  [string]$OkBaseUrl,
  [ValidateRange(1, 20)][int]$ConcurrentRequests = 4,
  [ValidateRange(1, 300)][int]$RateLimitWaitSeconds = 61,
  [ValidateRange(1, 60)][int]$ProviderTimeoutSeconds = 12,
  [string]$ArtifactDir = "tools/petcare-artifacts"
)

$ErrorActionPreference = "Stop"
$BaseUrl = $BaseUrl.TrimEnd('/')
$FakeLlmUrl = $FakeLlmUrl.TrimEnd('/')
if ([string]::IsNullOrWhiteSpace($OkBaseUrl)) { $OkBaseUrl = "$FakeLlmUrl/v1" }
$OkBaseUrl = $OkBaseUrl.TrimEnd('/')

if ($UserA -eq $UserB -or $UserA -eq $RateUser -or $UserB -eq $RateUser) {
  throw "UserA, UserB, and RateUser must be three distinct accounts"
}
if ($MySqlDatabase -notmatch '^[A-Za-z0-9_$-]+$') {
  throw "MySqlDatabase contains unsupported characters"
}
if (-not $Destructive) {
  if ([string]::IsNullOrWhiteSpace($ConfirmTestDatabase) -or $ConfirmTestDatabase -cne $MySqlDatabase) {
    throw "Refusing destructive probes: pass -Destructive or -ConfirmTestDatabase exactly matching -MySqlDatabase"
  }
  if ($MySqlDatabase -notmatch '(?i)(test|dev|qa|ci|scratch|sandbox)') {
    throw "Confirmed database name does not look like a test database; use -Destructive only after explicit review"
  }
}

New-Item -ItemType Directory -Force -Path $ArtifactDir | Out-Null
$script:startedAt = Get-Date
$script:pass = 0
$script:fail = 0
$script:skip = 0
$script:tests = [System.Collections.Generic.List[object]]::new()
$script:notes = [System.Collections.Generic.List[string]]::new()
$script:fatal = $null

function Redact([string]$Value) {
  if ($null -eq $Value) { return "" }
  $result = $Value
  foreach ($secret in @($PassA, $PassB, $RatePass, $MySqlPassword, $OkKey)) {
    if (-not [string]::IsNullOrEmpty($secret)) {
      $result = $result.Replace($secret, '[REDACTED]')
    }
  }
  return $result
}

function Check([string]$Name, [bool]$Condition, [string]$Detail) {
  $safeDetail = Redact $Detail
  $status = if ($Condition) { "PASS" } else { "FAIL" }
  if ($Condition) { $script:pass++ } else { $script:fail++ }
  $script:tests.Add([pscustomobject]@{
    name = $Name
    status = $status
    detail = $safeDetail
    at = (Get-Date).ToString('o')
  }) | Out-Null
  Write-Host ("{0,-4} {1} :: {2}" -f $status, $Name, $safeDetail)
}

function Skip([string]$Name, [string]$Detail) {
  $script:skip++
  $safeDetail = Redact $Detail
  $script:tests.Add([pscustomobject]@{
    name = $Name
    status = "SKIP"
    detail = $safeDetail
    at = (Get-Date).ToString('o')
  }) | Out-Null
  Write-Host ("SKIP {0} :: {1}" -f $Name, $safeDetail)
}

function CodeIs($Response, [string]$Expected) {
  return $null -ne $Response -and $null -ne $Response.Json -and "$($Response.Json.code)" -eq $Expected
}

function New-SessionLogin([string]$Username, [string]$Password) {
  $session = [Microsoft.PowerShell.Commands.WebRequestSession]::new()
  $body = @{ username = $Username; password = $Password } | ConvertTo-Json -Compress
  $response = Invoke-RestMethod -Uri "$BaseUrl/api/user/login" -Method POST -Body $body `
    -ContentType "application/json; charset=utf-8" -WebSession $session -TimeoutSec 15
  if ("$($response.code)" -ne "0") { throw "Login failed for ${Username}: $($response.msg)" }
  return [pscustomobject]@{
    Session = $session
    Csrf = "$($response.data.csrfToken)"
    User = $response.data.user
    Username = $Username
  }
}

function Invoke-Api($Auth, [string]$Method, [string]$Path, $Body = $null, [int]$TimeoutSec = 30) {
  $headers = @{ "X-CSRF-Token" = $Auth.Csrf }
  $parameters = @{
    Uri = "$BaseUrl$Path"
    Method = $Method
    WebSession = $Auth.Session
    Headers = $headers
    UseBasicParsing = $true
    TimeoutSec = $TimeoutSec
  }
  if ($null -ne $Body) {
    $parameters.ContentType = "application/json; charset=utf-8"
    $parameters.Body = $Body | ConvertTo-Json -Compress -Depth 12
  }
  try {
    $response = Invoke-WebRequest @parameters
    $json = $response.Content | ConvertFrom-Json
    return [pscustomobject]@{ Status = [int]$response.StatusCode; Json = $json; Content = $response.Content }
  } catch {
    $status = 0
    try { $status = [int]$_.Exception.Response.StatusCode } catch {}
    $content = if ($_.ErrorDetails -and $_.ErrorDetails.Message) { $_.ErrorDetails.Message } else { "" }
    if (-not $content -and $_.Exception.Response) {
      try {
        $reader = [System.IO.StreamReader]::new($_.Exception.Response.GetResponseStream())
        $content = $reader.ReadToEnd()
        $reader.Dispose()
      } catch {}
    }
    $json = $null
    try { if ($content) { $json = $content | ConvertFrom-Json } } catch {}
    if ($null -eq $json) {
      $json = [pscustomobject]@{ code = "$status"; msg = $_.Exception.Message; data = $null }
    }
    return [pscustomobject]@{ Status = $status; Json = $json; Content = $content }
  }
}

function Invoke-MySql([string]$Sql) {
  $oldPassword = [Environment]::GetEnvironmentVariable('MYSQL_PWD', 'Process')
  [Environment]::SetEnvironmentVariable('MYSQL_PWD', $MySqlPassword, 'Process')
  try {
    $output = & $MySqlPath "--host=$MySqlHost" "--port=$MySqlPort" "--user=$MySqlUser" `
      "--database=$MySqlDatabase" --batch --raw --skip-column-names --execute=$Sql 2>&1
    if ($LASTEXITCODE -ne 0) { throw "mysql exited ${LASTEXITCODE}: $($output -join ' ')" }
    return @($output | ForEach-Object { "$_" })
  } finally {
    [Environment]::SetEnvironmentVariable('MYSQL_PWD', $oldPassword, 'Process')
  }
}

function DbScalar([string]$Sql) {
  $rows = @(Invoke-MySql $Sql)
  if ($rows.Count -gt 0) { return "$($rows[0])" }
  return ""
}

function Get-ConfigDb([long]$UserId) {
  $row = DbScalar "SELECT CONCAT_WS(CHAR(9), enabled, base_url, model, connection_status, version, LENGTH(api_key_ciphertext), COALESCE(DATE_FORMAT(last_tested_at,'%Y-%m-%d %H:%i:%s.%f'),'NULL')) FROM t_petcare_ai_config WHERE user_id=$UserId"
  if (-not $row) { return $null }
  $parts = $row -split "`t", 7
  return [pscustomobject]@{
    enabled = $parts[0]
    baseUrl = $parts[1]
    model = $parts[2]
    status = $parts[3]
    version = [long]$parts[4]
    cipherLength = [int]$parts[5]
    testedAt = $parts[6]
  }
}

function Get-Cipher([long]$UserId) {
  return DbScalar "SELECT api_key_ciphertext FROM t_petcare_ai_config WHERE user_id=$UserId"
}

function Get-Sha256([string]$Value) {
  if ([string]::IsNullOrEmpty($Value)) { return "" }
  $bytes = [Text.Encoding]::UTF8.GetBytes($Value)
  # Windows PowerShell 5.1 没有 SHA256.HashData / Convert.ToHexString
  $sha = [Security.Cryptography.SHA256]::Create()
  try {
    $hash = $sha.ComputeHash($bytes)
  } finally {
    $sha.Dispose()
  }
  $sb = New-Object System.Text.StringBuilder ($hash.Length * 2)
  foreach ($b in $hash) { [void]$sb.AppendFormat("{0:x2}", $b) }
  return $sb.ToString()
}

function Get-FakeStats {
  try { return Invoke-RestMethod -Uri "$FakeLlmUrl/__stats" -TimeoutSec 5 } catch { return $null }
}

function Reset-Fake {
  Invoke-RestMethod -Uri "$FakeLlmUrl/__reset" -TimeoutSec 5 | Out-Null
}

function Assert-NoSecret($Value, [string]$Name) {
  $json = $Value | ConvertTo-Json -Compress -Depth 15
  $leaked = $false
  foreach ($secret in @($OkKey, $MySqlPassword, $PassA, $PassB, $RatePass)) {
    if (-not [string]::IsNullOrEmpty($secret) -and $json.Contains($secret)) { $leaked = $true }
  }
  Check $Name (-not $leaked) $(if ($leaked) { "secret appeared in response" } else { "response is redacted" })
}

function Wait-FakeIdle([int]$TimeoutSeconds = 70) {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    $stats = Get-FakeStats
    if ($null -ne $stats -and $stats.active -eq 0) { return $true }
    Start-Sleep -Milliseconds 200
  } while ((Get-Date) -lt $deadline)
  return $false
}

function Save-GoodConfig($Auth, [string]$Base = $OkBaseUrl, [string]$Model = $OkModel, [string]$Key = $OkKey) {
  return Invoke-Api $Auth POST "/api/petcare/config" @{
    enabled = $true
    baseUrl = $Base
    model = $Model
    apiKey = $Key
  }
}

function Wait-TestRateWindow([string]$Reason) {
  $script:notes.Add("Waited $RateLimitWaitSeconds seconds for test rate window: $Reason") | Out-Null
  Write-Host "WAIT $RateLimitWaitSeconds seconds :: $Reason"
  Start-Sleep -Seconds $RateLimitWaitSeconds
}

function Start-AuthenticatedApiJob([string]$Username, [string]$Password, [string]$Method,
                                   [string]$Path, $Body = $null, [int]$TimeoutSec = 30) {
  $bodyJson = if ($null -eq $Body) { "" } else { $Body | ConvertTo-Json -Compress -Depth 12 }
  return Start-Job -ScriptBlock {
    param($BaseUrl, $Username, $Password, $Method, $Path, $BodyJson, $TimeoutSec)
    $ErrorActionPreference = 'Stop'
    $session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
    try {
      $loginBody = @{ username = $Username; password = $Password } | ConvertTo-Json -Compress
      $login = Invoke-RestMethod "$BaseUrl/api/user/login" -Method POST -Body $loginBody `
        -ContentType 'application/json' -WebSession $session -TimeoutSec 15
      $parameters = @{
        Uri = "$BaseUrl$Path"
        Method = $Method
        WebSession = $session
        Headers = @{ 'X-CSRF-Token' = "$($login.data.csrfToken)" }
        UseBasicParsing = $true
        TimeoutSec = $TimeoutSec
      }
      if ($BodyJson) {
        $parameters.ContentType = 'application/json'
        $parameters.Body = $BodyJson
      }
      $response = Invoke-WebRequest @parameters
      [pscustomobject]@{ status = [int]$response.StatusCode; content = $response.Content } | ConvertTo-Json -Compress
    } catch {
      $status = 0
      try { $status = [int]$_.Exception.Response.StatusCode } catch {}
      $content = if ($_.ErrorDetails -and $_.ErrorDetails.Message) { $_.ErrorDetails.Message } else { '' }
      if (-not $content -and $_.Exception.Response) {
        try {
          $stream = $_.Exception.Response.GetResponseStream()
          if ($stream) {
            $reader = New-Object System.IO.StreamReader($stream)
            $content = $reader.ReadToEnd()
            $reader.Close()
          }
        } catch {}
      }
      if (-not $content) {
        $content = (@{ code = "$status"; msg = $_.Exception.Message; data = $null } | ConvertTo-Json -Compress)
      }
      [pscustomobject]@{ status = $status; content = $content; error = $_.Exception.Message } | ConvertTo-Json -Compress
    }
  } -ArgumentList $BaseUrl, $Username, $Password, $Method, $Path, $bodyJson, $TimeoutSec
}

function Receive-ApiJobs($Jobs) {
  $raw = @($Jobs | Wait-Job | Receive-Job)
  $Jobs | Remove-Job -Force
  $results = @()
  foreach ($item in $raw) {
    if ($item -is [string]) {
      try {
        $wrapper = $item | ConvertFrom-Json
        $json = if ($wrapper.content) { $wrapper.content | ConvertFrom-Json } else { $null }
        $results += [pscustomobject]@{ Status = [int]$wrapper.status; Json = $json; Error = $wrapper.error }
      } catch {
        $results += [pscustomobject]@{ Status = 0; Json = $null; Error = "Unparseable job result" }
      }
    }
  }
  return @($results)
}

function Run-Probes {
  Write-Host "==== Preconditions and destructive scope ===="
  $homeStats = Invoke-RestMethod "$BaseUrl/api/dashboard/home-stats" -TimeoutSec 8
  Check "pre-app-up" ($null -ne $homeStats) "dashboard endpoint reachable"
  $health = Invoke-RestMethod "$FakeLlmUrl/health" -TimeoutSec 5
  Check "pre-fake-up" ($health.ok -eq $true) "fake LLM reachable"
  $selectedDb = DbScalar "SELECT DATABASE()"
  Check "pre-db-selected" ($selectedDb -ceq $MySqlDatabase) "selected database=$selectedDb"

  $authA = New-SessionLogin $UserA $PassA
  $authB = New-SessionLogin $UserB $PassB
  $authRate = New-SessionLogin $RateUser $RatePass
  Check "pre-distinct-user-ids" (
    [long]$authA.User.id -ne [long]$authB.User.id -and
    [long]$authA.User.id -ne [long]$authRate.User.id -and
    [long]$authB.User.id -ne [long]$authRate.User.id
  ) "three account IDs are distinct"

  foreach ($auth in @($authA, $authB, $authRate)) {
    $clear = Invoke-Api $auth POST "/api/petcare/config/clear"
    Check "pre-clear-$($auth.Username)" (CodeIs $clear "0") "personal config cleared"
  }

  Write-Host "`n==== Test rate limit: 3/minute ===="
  $rateSave = Save-GoodConfig $authRate
  Check "rate-config-saved" (CodeIs $rateSave "0") "dedicated rate account configured"
  Reset-Fake
  $rateResponses = @()
  1..4 | ForEach-Object { $rateResponses += Invoke-Api $authRate POST "/api/petcare/config/test" }
  $rateStats = Get-FakeStats
  Check "rate-first-three-success" (
    (CodeIs $rateResponses[0] "0") -and (CodeIs $rateResponses[1] "0") -and (CodeIs $rateResponses[2] "0")
  ) "first three tests accepted"
  Check "rate-fourth-429" (CodeIs $rateResponses[3] "429") "fourth code=$($rateResponses[3].Json.code)"
  Check "rate-fourth-no-provider-call" ($rateStats.calls -eq 3) "fake calls=$($rateStats.calls)"

  Write-Host "`n==== First configuration and validation ===="
  $empty = Invoke-Api $authA GET "/api/petcare/config"
  Check "first-empty" ((CodeIs $empty "0") -and -not $empty.Json.data.personalConfigured) "source=$($empty.Json.data.source)"
  Check "first-no-key-echo" (-not $empty.Json.data.apiKeyConfigured -and -not $empty.Json.data.apiKeyHint) "no key or hint"

  $validationCases = @(
    @{ name = "required-base"; body = @{ enabled = $true; baseUrl = ""; model = $OkModel; apiKey = $OkKey }; match = "Base URL|不能为空" },
    @{ name = "required-model"; body = @{ enabled = $true; baseUrl = $OkBaseUrl; model = ""; apiKey = $OkKey }; match = "模型|不能为空" },
    @{ name = "required-key"; body = @{ enabled = $true; baseUrl = $OkBaseUrl; model = $OkModel; apiKey = "" }; match = "API Key" },
    @{ name = "mask-bullets"; body = @{ enabled = $true; baseUrl = $OkBaseUrl; model = $OkModel; apiKey = "••••" }; match = "掩码" },
    @{ name = "mask-stars"; body = @{ enabled = $true; baseUrl = $OkBaseUrl; model = $OkModel; apiKey = "********" }; match = "掩码" },
    @{ name = "url-malformed"; body = @{ enabled = $true; baseUrl = "not-a-url"; model = $OkModel; apiKey = $OkKey }; match = "Base URL|HTTPS" },
    @{ name = "url-public-http"; body = @{ enabled = $true; baseUrl = "http://example.com/v1"; model = $OkModel; apiKey = $OkKey }; match = "HTTPS" },
    @{ name = "url-private"; body = @{ enabled = $true; baseUrl = "https://192.168.1.20/v1"; model = $OkModel; apiKey = $OkKey }; match = "HTTPS|Base URL" }
  )
  foreach ($case in $validationCases) {
    $bad = Invoke-Api $authA POST "/api/petcare/config" $case.body
    Check "validation-$($case.name)" ((-not (CodeIs $bad "0")) -and "$($bad.Json.msg)" -match $case.match) "code=$($bad.Json.code) msg=$($bad.Json.msg)"
    Assert-NoSecret $bad "validation-$($case.name)-no-secret"
  }

  $wrongKey = "$OkKey-wrong"
  $saveWrongKey = Invoke-Api $authA POST "/api/petcare/config" @{
    enabled = $true; baseUrl = $OkBaseUrl; model = $OkModel; apiKey = $wrongKey
  }
  Check "wrong-key-save-untested" ((CodeIs $saveWrongKey "0") -and $saveWrongKey.Json.data.connectionStatus -eq "untested") "saved as untested"
  $wrongKeyTest = Invoke-Api $authA POST "/api/petcare/config/test"
  Check "wrong-key-provider-rejected" ((-not (CodeIs $wrongKeyTest "0")) -and "$($wrongKeyTest.Json.msg)" -match '401|API Key') "code=$($wrongKeyTest.Json.code)"
  Assert-NoSecret $wrongKeyTest "wrong-key-error-no-secret"
  $failedStatus = Invoke-Api $authA GET "/api/petcare/config"
  Check "wrong-key-status-failed" ($failedStatus.Json.data.connectionStatus -eq "failed" -and -not $failedStatus.Json.data.connected) "failed persisted"

  $saveWrongModel = Invoke-Api $authA POST "/api/petcare/config" @{
    enabled = $true; baseUrl = $OkBaseUrl; model = "$OkModel-missing"; apiKey = $OkKey
  }
  Check "wrong-model-save-untested" ((CodeIs $saveWrongModel "0") -and $saveWrongModel.Json.data.connectionStatus -eq "untested") "saved as untested"
  $wrongModelTest = Invoke-Api $authA POST "/api/petcare/config/test"
  Check "wrong-model-provider-rejected" ((-not (CodeIs $wrongModelTest "0")) -and "$($wrongModelTest.Json.msg)" -match '404|模型') "code=$($wrongModelTest.Json.code)"

  $goodSave = Save-GoodConfig $authA
  Check "good-save-ready-untested" ((CodeIs $goodSave "0") -and $goodSave.Json.data.ready -and $goodSave.Json.data.connectionStatus -eq "untested") "ready but not connected"
  Check "good-save-key-masked" ($goodSave.Json.data.apiKeyConfigured -and "$($goodSave.Json.data.apiKeyHint)" -notmatch [regex]::Escape($OkKey)) "hint length=$($goodSave.Json.data.apiKeyHint.Length)"
  Assert-NoSecret $goodSave "good-save-no-secret"
  Reset-Fake
  $goodTest = Invoke-Api $authA POST "/api/petcare/config/test"
  $goodStats = Get-FakeStats
  Check "good-test-connected" ((CodeIs $goodTest "0") -and $goodTest.Json.data.connected -and $goodTest.Json.data.connectionStatus -eq "connected") "connected"
  Check "good-test-provider-call" ($goodStats.calls -eq 1) "fake calls=$($goodStats.calls)"

  Write-Host "`n==== Persistence, ciphertext, and recent auto-test ===="
  $cipherBefore = Get-Cipher ([long]$authA.User.id)
  $cipherHashBefore = Get-Sha256 $cipherBefore
  Check "ciphertext-present" ($cipherBefore.Length -gt $OkKey.Length -and -not $cipherBefore.Contains($OkKey)) "cipher length=$($cipherBefore.Length) sha256=$cipherHashBefore"
  $refresh1 = Invoke-Api $authA GET "/api/petcare/config"
  $refresh2 = Invoke-Api $authA GET "/api/petcare/config"
  $cipherAfterReads = Get-Cipher ([long]$authA.User.id)
  Check "refresh-stable" ($refresh1.Json.data.connectionStatus -eq $refresh2.Json.data.connectionStatus -and $refresh2.Json.data.baseUrl -eq $OkBaseUrl) "status=$($refresh2.Json.data.connectionStatus)"
  Check "ciphertext-unchanged-on-read" ($cipherBefore -ceq $cipherAfterReads) "sha256=$(Get-Sha256 $cipherAfterReads)"

  $keepKey = Invoke-Api $authA POST "/api/petcare/config" @{
    enabled = $true; baseUrl = $OkBaseUrl; model = $OkModel; apiKey = ""
  }
  $cipherAfterBlank = Get-Cipher ([long]$authA.User.id)
  Check "blank-key-preserves-ciphertext" ((CodeIs $keepKey "0") -and $cipherBefore -ceq $cipherAfterBlank) "sha256=$(Get-Sha256 $cipherAfterBlank)"
  Check "noop-save-keeps-connected" ($keepKey.Json.data.connectionStatus -eq "connected") "status=$($keepKey.Json.data.connectionStatus)"

  Reset-Fake
  $authANewSession = New-SessionLogin $UserA $PassA
  $auto1 = Invoke-Api $authANewSession POST "/api/petcare/config/auto-test"
  $autoStats1 = Get-FakeStats
  $auto2 = Invoke-Api $authANewSession POST "/api/petcare/config/auto-test"
  $autoStats2 = Get-FakeStats
  Check "auto-recent-connected-no-call" ((CodeIs $auto1 "0") -and $autoStats1.calls -eq 0) "recent connected status reused"
  Check "auto-same-session-no-repeat" ((CodeIs $auto2 "0") -and $autoStats2.calls -eq 0) "fake calls remained zero"
  $authA = $authANewSession

  Write-Host "`n==== State transitions and account isolation ===="
  $disabled = Invoke-Api $authA POST "/api/petcare/config" @{
    enabled = $false; baseUrl = $OkBaseUrl; model = $OkModel; apiKey = ""
  }
  Check "state-disable" ((CodeIs $disabled "0") -and -not $disabled.Json.data.enabled -and $disabled.Json.data.connectionStatus -eq "untested") "disabled"
  $enabled = Invoke-Api $authA POST "/api/petcare/config" @{
    enabled = $true; baseUrl = $OkBaseUrl; model = $OkModel; apiKey = ""
  }
  Check "state-reenable-keeps-key" ((CodeIs $enabled "0") -and $enabled.Json.data.enabled -and $enabled.Json.data.apiKeyConfigured) "key retained"

  $bBefore = Invoke-Api $authB GET "/api/petcare/config"
  Check "isolation-b-cannot-see-a-config" (-not $bBefore.Json.data.personalConfigured) "B remains unconfigured"
  Save-GoodConfig $authB | Out-Null
  $bCipher = Get-Cipher ([long]$authB.User.id)
  $aCipher = Get-Cipher ([long]$authA.User.id)
  Check "isolation-user-bound-ciphertext" ($aCipher -and $bCipher -and $aCipher -cne $bCipher) "same key produced different ciphertext"
  Invoke-Api $authB POST "/api/petcare/config/clear" | Out-Null
  $aAfterBClear = Invoke-Api $authA GET "/api/petcare/config"
  Check "isolation-b-clear-does-not-affect-a" ($aAfterBClear.Json.data.personalConfigured) "A still configured"

  Save-GoodConfig $authB | Out-Null
  Reset-Fake
  $toFailed = Invoke-Api $authB POST "/api/petcare/config" @{
    enabled = $true; baseUrl = "$FakeLlmUrl/status/500"; model = $OkModel; apiKey = $OkKey
  }
  $failedTest = Invoke-Api $authB POST "/api/petcare/config/test"
  $failedRead = Invoke-Api $authB GET "/api/petcare/config"
  Check "state-connected-to-failed" ((CodeIs $toFailed "0") -and (-not (CodeIs $failedTest "0")) -and $failedRead.Json.data.connectionStatus -eq "failed") "500 persisted failed"
  Save-GoodConfig $authB | Out-Null
  $recovered = Invoke-Api $authB POST "/api/petcare/config/test"
  Check "state-failed-to-connected" ((CodeIs $recovered "0") -and $recovered.Json.data.connected) "recovered"

  Write-Host "`n==== Provider failures and configuration-version race ===="
  foreach ($providerCode in @(401)) {
    $providerSave = Invoke-Api $authB POST "/api/petcare/config" @{
      enabled = $true; baseUrl = "$FakeLlmUrl/status/$providerCode"; model = $OkModel; apiKey = $OkKey
    }
    $providerResult = Invoke-Api $authB POST "/api/petcare/config/test"
    Check "provider-$providerCode" ((CodeIs $providerSave "0") -and (-not (CodeIs $providerResult "0")) -and "$($providerResult.Json.msg)" -match "$providerCode") "mapped provider HTTP $providerCode"
  }
  Wait-TestRateWindow "B used three connection tests"

  foreach ($providerCode in @(403, 429, 500)) {
    $providerSave = Invoke-Api $authB POST "/api/petcare/config" @{
      enabled = $true; baseUrl = "$FakeLlmUrl/status/$providerCode"; model = $OkModel; apiKey = $OkKey
    }
    $providerResult = Invoke-Api $authB POST "/api/petcare/config/test"
    Check "provider-$providerCode" ((CodeIs $providerSave "0") -and (-not (CodeIs $providerResult "0")) -and "$($providerResult.Json.msg)" -match "$providerCode") "mapped provider HTTP $providerCode"
    Assert-NoSecret $providerResult "provider-$providerCode-no-secret"
  }
  Wait-TestRateWindow "B used next three connection tests"

  $timeoutSave = Invoke-Api $authB POST "/api/petcare/config" @{
    enabled = $true; baseUrl = "$FakeLlmUrl/delay/$ProviderTimeoutSeconds"; model = $OkModel; apiKey = $OkKey
  }
  $timeoutResult = Invoke-Api $authB POST "/api/petcare/config/test" $null ($ProviderTimeoutSeconds + 15)
  Check "provider-timeout" ((CodeIs $timeoutSave "0") -and (-not (CodeIs $timeoutResult "0")) -and ("$($timeoutResult.Json.code)" -eq "504" -or "$($timeoutResult.Json.msg)" -match '超时|timeout')) "code=$($timeoutResult.Json.code)"
  Check "provider-timeout-fake-drained" (Wait-FakeIdle) "delayed fake request completed before counters reset"

  Reset-Fake
  $delayedSave = Invoke-Api $authB POST "/api/petcare/config" @{
    enabled = $true; baseUrl = "$FakeLlmUrl/delay/2"; model = $OkModel; apiKey = $OkKey
  }
  $oldDb = Get-ConfigDb ([long]$authB.User.id)
  $oldTestJob = Start-AuthenticatedApiJob $UserB $PassB POST "/api/petcare/config/test" $null 20
  $deadline = (Get-Date).AddSeconds(8)
  do {
    Start-Sleep -Milliseconds 100
    $inFlightStats = Get-FakeStats
  } while (($null -eq $inFlightStats -or $inFlightStats.active -lt 1) -and (Get-Date) -lt $deadline)
  $newModel = "$OkModel-new-version"
  $newSave = Invoke-Api $authB POST "/api/petcare/config" @{
    enabled = $true; baseUrl = $OkBaseUrl; model = $newModel; apiKey = $OkKey
  }
  $oldTestResult = @(Receive-ApiJobs @($oldTestJob))[0]
  $newDb = Get-ConfigDb ([long]$authB.User.id)
  Check "version-race-started-in-flight" ($inFlightStats.active -ge 1) "old version=$($oldDb.version)"
  Check "version-race-new-config-won" ((CodeIs $newSave "0") -and $newDb.version -gt $oldDb.version -and $newDb.model -eq $newModel) "new version=$($newDb.version)"
  # 新配置必须保持 untested；旧测试要么 409（版本冲突），要么失败且未把新配置写成 connected
  $oldCode = if ($null -ne $oldTestResult -and $null -ne $oldTestResult.Json) { "$($oldTestResult.Json.code)" } else { "" }
  $oldDiscarded = ($newDb.status -eq "untested") -and ($oldCode -eq "409" -or $oldCode -eq "502" -or $oldCode -eq "504" -or $oldCode -eq "0" -or $oldCode -eq "")
  Check "version-race-old-result-discarded" $oldDiscarded "old result code=$oldCode, status=$($newDb.status)"

  Write-Host "`n==== Ask requestId, task lookup, idempotency, and concurrency ===="
  Save-GoodConfig $authA | Out-Null
  Reset-Fake
  $missingRequestId = Invoke-Api $authA POST "/api/petcare/ask" @{ question = "新手养猫准备什么" }
  $missingStats = Get-FakeStats
  Check "ask-request-id-required" ((-not (CodeIs $missingRequestId "0")) -and "$($missingRequestId.Json.msg)" -match 'requestId') "code=$($missingRequestId.Json.code)"
  Check "ask-invalid-does-not-call-provider" ($missingStats.calls -eq 0) "fake calls=0"

  $requestId = "life-$([Guid]::NewGuid().ToString('N'))"
  $question = "新手养猫需要准备什么？"
  $firstAsk = Invoke-Api $authA POST "/api/petcare/ask" @{ requestId = $requestId; question = $question }
  $afterFirstAsk = Get-FakeStats
  $sameAsk = Invoke-Api $authA POST "/api/petcare/ask" @{ requestId = $requestId; question = $question }
  $afterSameAsk = Get-FakeStats
  $task = Invoke-Api $authA GET "/api/petcare/tasks/$requestId"
  $firstData = $firstAsk.Json.data | ConvertTo-Json -Compress -Depth 12
  $sameData = $sameAsk.Json.data | ConvertTo-Json -Compress -Depth 12
  $taskData = $task.Json.data | ConvertTo-Json -Compress -Depth 12
  Check "ask-first-completed" ((CodeIs $firstAsk "0") -and $firstAsk.Json.data.status -eq "completed" -and $firstAsk.Json.data.answer) "requestId=$requestId"
  Check "ask-same-request-id-one-provider-call" ((CodeIs $sameAsk "0") -and $afterFirstAsk.calls -eq 1 -and $afterSameAsk.calls -eq 1) "fake calls stayed one"
  Check "ask-same-request-id-same-result" ($firstData -ceq $sameData) "duplicate returned persisted task"
  Check "ask-get-task-same-result" ((CodeIs $task "0") -and $taskData -ceq $firstData) "GET task matches POST"
  $conflict = Invoke-Api $authA POST "/api/petcare/ask" @{ requestId = $requestId; question = "狗狗疫苗怎么安排？" }
  Check "ask-request-id-payload-conflict" (CodeIs $conflict "409") "same ID with different payload rejected"

  $bTask = Invoke-Api $authB GET "/api/petcare/tasks/$requestId"
  Check "ask-task-account-isolation" (-not (CodeIs $bTask "0")) "B cannot read A task"

  $delayConfig = Invoke-Api $authA POST "/api/petcare/config" @{
    enabled = $true; baseUrl = "$FakeLlmUrl/delay/0.35"; model = $OkModel; apiKey = $OkKey
  }
  Check "ask-concurrent-delay-config" (CodeIs $delayConfig "0") "fake delay configured"
  Reset-Fake
  $jobs = @()
  $concurrentIds = @()
  1..$ConcurrentRequests | ForEach-Object {
    $id = "multi-$($_)-$([Guid]::NewGuid().ToString('N'))"
    $concurrentIds += $id
    $jobs += Start-AuthenticatedApiJob $UserA $PassA POST "/api/petcare/ask" @{
      requestId = $id
      question = "第 $_ 个并发请求：新手养猫准备什么？"
    } 30
  }
  $concurrentResults = @(Receive-ApiJobs $jobs)
  $concurrentStats = Get-FakeStats
  $completedCount = @($concurrentResults | Where-Object { "$($_.Json.code)" -eq "0" -and $_.Json.data.status -eq "completed" }).Count
  Check "ask-multi-request-all-completed" ($completedCount -eq $ConcurrentRequests) "completed=$completedCount/$ConcurrentRequests"
  Check "ask-multi-request-provider-count" ($concurrentStats.calls -eq $ConcurrentRequests) "fake calls=$($concurrentStats.calls)"
  Check "ask-multi-request-was-concurrent" ($concurrentStats.peak_active -gt 1) "fake peak_active=$($concurrentStats.peak_active)"
  foreach ($id in $concurrentIds) {
    $taskCheck = Invoke-Api $authA GET "/api/petcare/tasks/$id"
    Check "ask-task-$($id.Substring(0,12))" ((CodeIs $taskCheck "0") -and $taskCheck.Json.data.status -eq "completed") "persisted"
  }

  Write-Host "`n==== Static frontend security contract ===="
  $page = (Invoke-WebRequest "$BaseUrl/page/front/pet_care.html" -WebSession $authA.Session -UseBasicParsing -TimeoutSec 15).Content
  Check "static-key-autocomplete" ($page -match 'autocomplete="new-password"') "replacement key uses new-password"
  # 中文文案在部分控制台编码下不稳定，用 ASCII class / 关键片段断言
  Check "static-saved-secret-state" ($page -match 'petcare-saved-secret' -and $page -match 'apiKeyConfigured') "saved-key UI present"
  Check "static-no-secret-storage" ($page -notmatch '(localStorage|sessionStorage)\.[gs]etItem\([^\)]*apiKey') "no API key browser storage"
  Check "static-request-id-and-task-contract" ($page -match 'requestId:\s*vm\.newRequestId\(\)' -and $page -match '/api/petcare/ask') "frontend sends requestId"
  Assert-NoSecret $page "static-page-no-secret"
}

try {
  Run-Probes
} catch {
  $script:fatal = Redact $_.Exception.ToString()
  $script:fail++
  $script:tests.Add([pscustomobject]@{
    name = "fatal"
    status = "FAIL"
    detail = $script:fatal
    at = (Get-Date).ToString('o')
  }) | Out-Null
  Write-Host "FATAL :: $script:fatal"
} finally {
  $finishedAt = Get-Date
  $report = [ordered]@{
    schemaVersion = 1
    script = "petcare-lifecycle-adversarial.ps1"
    startedAt = $script:startedAt.ToString('o')
    finishedAt = $finishedAt.ToString('o')
    durationSeconds = [Math]::Round(($finishedAt - $script:startedAt).TotalSeconds, 3)
    target = [ordered]@{
      baseUrl = $BaseUrl
      fakeLlmUrl = $FakeLlmUrl
      mysqlHost = $MySqlHost
      mysqlPort = $MySqlPort
      mysqlDatabase = $MySqlDatabase
      users = @($UserA, $UserB, $RateUser)
      destructiveOverride = [bool]$Destructive
    }
    summary = [ordered]@{ pass = $script:pass; fail = $script:fail; skip = $script:skip }
    notes = @($script:notes)
    tests = @($script:tests)
  }
  $jsonPath = Join-Path $ArtifactDir "lifecycle-report.json"
  $textPath = Join-Path $ArtifactDir "lifecycle-summary.txt"
  $report | ConvertTo-Json -Depth 20 | Set-Content -Path $jsonPath -Encoding UTF8
  $lines = @(
    "PetCare lifecycle adversarial report"
    "Started: $($script:startedAt.ToString('o'))"
    "Finished: $($finishedAt.ToString('o'))"
    "PASS=$($script:pass) FAIL=$($script:fail) SKIP=$($script:skip)"
    ""
  ) + @($script:tests | ForEach-Object { "$($_.status) $($_.name) :: $($_.detail)" })
  $lines | Set-Content -Path $textPath -Encoding UTF8
  Write-Host "`n==== Summary ===="
  Write-Host "PASS=$($script:pass) FAIL=$($script:fail) SKIP=$($script:skip)"
  Write-Host "Artifacts: $jsonPath ; $textPath"
}

if ($script:fail -gt 0) { exit 1 }
exit 0
