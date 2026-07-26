# P0 对抗探针：假退出语义（服务端）+ 普通用户禁止改 username
param(
  [string]$BaseUrl = "http://localhost:9999",
  [string]$UserName = "jerry",
  [string]$UserPass = "123456"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot "lib-session.ps1")
$fail = 0
function Pass([string]$n, [bool]$ok, [string]$d) {
  if ($ok) { Write-Host "[PASS] $n :: $d" -ForegroundColor Green }
  else { Write-Host "[FAIL] $n :: $d" -ForegroundColor Red; $script:fail++ }
}

# --- auth-session source contract ---
$authJs = Get-Content (Join-Path $root "src/main/resources/static/js/auth-session.js") -Raw -Encoding UTF8
Pass "logout 无 always(finish) 假退出" ($authJs -notmatch '\.always\s*\(\s*finish\s*\)' -and $authJs -notmatch '\.finally\s*\(\s*finish\s*\)') "source-check"
Pass "logout 成功路径 postLogout" ($authJs -match 'function postLogout' -and $authJs -match '退出未完成') "source-check"

# --- live identity / session ---
$s = New-AppSession -BaseUrl $BaseUrl -Username $UserName -Password $UserPass
Pass "登录成功" ($null -ne $s.User -and $null -ne $s.User.id) "id=$($s.User.id)"

# bad CSRF logout must NOT destroy session
$badLogoutStatus = 0
try {
  Invoke-WebRequest -Uri "$BaseUrl/api/user/logout" -Method POST -WebSession $s.Session `
    -Headers @{ "X-CSRF-Token" = "intentionally-wrong" } -ContentType "application/json" -Body "{}" `
    -UseBasicParsing -TimeoutSec 8 | Out-Null
  $badLogoutStatus = 200
} catch {
  if ($_.Exception.Response) { $badLogoutStatus = [int]$_.Exception.Response.StatusCode }
}
Pass "错误 CSRF 退出被拒绝" ($badLogoutStatus -eq 403) "status=$badLogoutStatus"

$meAfterBad = $null
try {
  $r = Invoke-WebRequest -Uri "$BaseUrl/api/user/me" -WebSession $s.Session -UseBasicParsing -TimeoutSec 8
  $meAfterBad = $r.Content | ConvertFrom-Json
} catch {}
Pass "错误 CSRF 退出后 Session 仍有效" ($meAfterBad -and $meAfterBad.code -eq "0") "code=$($meAfterBad.code)"

# rename attack
$renameStatus = 0
$renameCode = ""
try {
  $body = @{ id = $s.User.id; username = "should_fail_rename_$([DateTime]::UtcNow.Ticks)" } | ConvertTo-Json -Compress
  $rr = Invoke-WebRequest -Uri "$BaseUrl/api/user" -Method PUT -WebSession $s.Session `
    -Headers @{ "X-CSRF-Token" = $s.Csrf } -ContentType "application/json" -Body $body `
    -UseBasicParsing -TimeoutSec 8
  $renameStatus = [int]$rr.StatusCode
  $renameCode = (($rr.Content | ConvertFrom-Json).code)
} catch {
  if ($_.Exception.Response) {
    $renameStatus = [int]$_.Exception.Response.StatusCode
  }
}
Pass "PUT /api/user 改 username 被拒" (($renameStatus -eq 403) -or ($renameCode -eq "403")) "http=$renameStatus code=$renameCode"

# me/profile still works
$profileOk = $false
try {
  $pb = @{ email = "jerry_p0@example.com"; phone = "13800138000" } | ConvertTo-Json -Compress
  $pr = Invoke-WebRequest -Uri "$BaseUrl/api/user/me/profile" -Method PUT -WebSession $s.Session `
    -Headers @{ "X-CSRF-Token" = $s.Csrf } -ContentType "application/json" -Body $pb `
    -UseBasicParsing -TimeoutSec 8
  $pj = $pr.Content | ConvertFrom-Json
  $profileOk = ($pr.StatusCode -eq 200 -and $pj.code -eq "0")
} catch {}
Pass "PUT /me/profile 仍可用" $profileOk "profile"

# good logout destroys session
$s2 = New-AppSession -BaseUrl $BaseUrl -Username $UserName -Password $UserPass
Invoke-WebRequest -Uri "$BaseUrl/api/user/logout" -Method POST -WebSession $s2.Session `
  -Headers @{ "X-CSRF-Token" = $s2.Csrf } -ContentType "application/json" -Body "{}" `
  -UseBasicParsing -TimeoutSec 8 | Out-Null
$afterLogout = 0
try {
  Invoke-WebRequest -Uri "$BaseUrl/api/user/me" -WebSession $s2.Session -UseBasicParsing -TimeoutSec 8 | Out-Null
  $afterLogout = 200
} catch {
  if ($_.Exception.Response) { $afterLogout = [int]$_.Exception.Response.StatusCode }
}
Pass "正确退出后 /me 401" ($afterLogout -eq 401) "status=$afterLogout"

# original username still loginable
try {
  $s3 = New-AppSession -BaseUrl $BaseUrl -Username $UserName -Password $UserPass
  Pass "原用户名仍可登录" ($s3.User.username -eq $UserName) "name=$($s3.User.username)"
} catch {
  Pass "原用户名仍可登录" $false $_.Exception.Message
}

Write-Host "=== p0-session-identity-probes done fail=$fail ===" -ForegroundColor Cyan
if ($fail -gt 0) { exit 1 } else { exit 0 }
