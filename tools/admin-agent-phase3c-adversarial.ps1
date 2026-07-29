param(
    [string]$BaseUrl = "http://localhost:9999",
    [string]$UserName = "jerry",
    [string]$UserPass = "123456",
    [string]$AdminName = "admin",
    [string]$AdminPass = "admin"
)

$ErrorActionPreference = "Stop"
$script:Passed = 0

function Assert-Status([string]$Label, [int]$Actual, [int]$Expected) {
    if ($Actual -ne $Expected) { throw "$Label expected HTTP $Expected but received $Actual" }
    $script:Passed += 1
    Write-Host "[PASS] $Label -> HTTP $Actual"
}

function Assert-True([string]$Label, [bool]$Condition) {
    if (-not $Condition) { throw "$Label failed" }
    $script:Passed += 1
    Write-Host "[PASS] $Label"
}

function Invoke-Probe([string]$Method, [string]$Path, $Body, $Auth) {
    try {
        $params = @{ Uri = "$BaseUrl$Path"; Method = $Method; ContentType = "application/json"; TimeoutSec = 10 }
        if ($null -ne $Body) { $params.Body = ($Body | ConvertTo-Json -Compress) }
        if ($null -ne $Auth) {
            $params.WebSession = $Auth.Session
            if ($Method -ne "GET") { $params.Headers = @{ "X-CSRF-Token" = $Auth.Token } }
        }
        $response = Invoke-WebRequest @params
        return @{ Status = [int]$response.StatusCode; Json = ($response.Content | ConvertFrom-Json) }
    } catch {
        if ($_.Exception.Response) { return @{ Status = [int]$_.Exception.Response.StatusCode; Json = $null } }
        throw
    }
}

function Login([string]$Name, [string]$Pass) {
    $session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
    $response = Invoke-RestMethod -Uri "$BaseUrl/api/user/login" -Method Post -ContentType "application/json" `
        -Body (@{ username = $Name; password = $Pass } | ConvertTo-Json -Compress) -WebSession $session -TimeoutSec 10
    if ($response.code -ne "0" -or -not $response.data.csrfToken) { throw "login $Name failed" }
    $script:Passed += 1
    Write-Host "[PASS] login $Name -> authenticated session"
    return @{ Session = $session; Token = [string]$response.data.csrfToken }
}

Assert-Status "anonymous automation status denied" (Invoke-Probe "GET" "/api/admin-agent/automation/status" $null $null).Status 401

$userAuth = Login $UserName $UserPass
Assert-Status "ordinary user automation status denied" (Invoke-Probe "GET" "/api/admin-agent/automation/status" $null $userAuth).Status 403

$adminAuth = Login $AdminName $AdminPass
$statusProbe = Invoke-Probe "GET" "/api/admin-agent/automation/status" $null $adminAuth
Assert-Status "super admin can read safe automation status" $statusProbe.Status 200
$version = if ($statusProbe.Json -and $statusProbe.Json.data.config.version) { [long]$statusProbe.Json.data.config.version } else { 1 }
$enabledBefore = [bool]$statusProbe.Json.data.config.enabled
$modeBefore = [string]$statusProbe.Json.data.config.mode
$runsBeforeProbe = Invoke-Probe "GET" "/api/admin-agent/automation/runs?limit=20" $null $adminAuth
$runsBefore = @($runsBeforeProbe.Json.data).Count

$badBatch = @{ expectedVersion = $version; enabled = $true; mode = "shadow"; maxBatch = 99;
    acknowledgeNoAutoReject = $false; acknowledgeHumanFallback = $false; confirmationText = "" }
Assert-Status "oversized batch rejected before mutation" (Invoke-Probe "POST" "/api/admin-agent/automation/config" $badBatch $adminAuth).Status 400

$missingGuard = @{ expectedVersion = $version; enabled = $true; mode = "guarded"; maxBatch = 1;
    acknowledgeNoAutoReject = $false; acknowledgeHumanFallback = $false; confirmationText = "" }
Assert-Status "guarded mode requires explicit acknowledgements" (Invoke-Probe "POST" "/api/admin-agent/automation/config" $missingGuard $adminAuth).Status 400

$wrongPhrase = $missingGuard.Clone(); $wrongPhrase.acknowledgeNoAutoReject = $true
$wrongPhrase.acknowledgeHumanFallback = $true; $wrongPhrase.confirmationText = "启用自动驳回"
Assert-Status "guarded mode rejects wrong confirmation phrase" (Invoke-Probe "POST" "/api/admin-agent/automation/config" $wrongPhrase $adminAuth).Status 400

Assert-Status "invalid run request id rejected without model call" `
    (Invoke-Probe "POST" "/api/admin-agent/automation/run" @{ requestId = "bad request id" } $adminAuth).Status 400

Assert-Status "invalid batch id rejected" (Invoke-Probe "GET" "/api/admin-agent/automation/runs/0" $null $adminAuth).Status 400

$afterProbe = Invoke-Probe "GET" "/api/admin-agent/automation/status" $null $adminAuth
Assert-True "invalid probes did not change automation config" `
    ($afterProbe.Status -eq 200 -and [long]$afterProbe.Json.data.config.version -eq $version `
     -and [bool]$afterProbe.Json.data.config.enabled -eq $enabledBefore `
     -and [string]$afterProbe.Json.data.config.mode -eq $modeBefore)
$runsAfterProbe = Invoke-Probe "GET" "/api/admin-agent/automation/runs?limit=20" $null $adminAuth
Assert-True "invalid probes created no automation run" (@($runsAfterProbe.Json.data).Count -eq $runsBefore)

Write-Host "admin-agent-phase3c-adversarial: PASS ($script:Passed checks, no model call or business mutation)"
