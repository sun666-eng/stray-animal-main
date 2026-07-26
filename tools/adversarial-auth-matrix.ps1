# 认证权威矩阵（Session 唯一）
param(
  [string]$BaseUrl = "http://localhost:9999",
  [string]$UserName = "jerry",
  [string]$UserPass = "123456"
)
$ErrorActionPreference = "Continue"
$fail = 0
. "$PSScriptRoot\lib-session.ps1"
function Pass($n,$ok,$d){ if($ok){Write-Host "[PASS] $n :: $d" -ForegroundColor Green}else{Write-Host "[FAIL] $n :: $d" -ForegroundColor Red; $script:fail++} }

Write-Host "=== Auth authority matrix ===" -ForegroundColor Cyan

# 1) cookie-only /me
$s = New-AppSession -BaseUrl $BaseUrl -Username $UserName -Password $UserPass
$me = Invoke-ApiJson -BaseUrl $BaseUrl -Path "/api/user/me" -AppSession $s -Method GET
Pass "cookie-only /me" ($me.Json -and $me.Json.code -eq "0") "code=$($me.Json.code)"

# 2) no cookie /me
try {
  $anon = Invoke-WebRequest -Uri "$BaseUrl/api/user/me" -UseBasicParsing
  Pass "no-cookie /me 401" ($anon.StatusCode -eq 401) "http=$($anon.StatusCode)"
} catch {
  $st = 0; if ($_.Exception.Response) { $st = [int]$_.Exception.Response.StatusCode }
  Pass "no-cookie /me 401" ($st -eq 401) "http=$st"
}

# 3) forged JWT-only /me must 401 (even if syntactically jwt-like)
$fakeJwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.deadbeef"
try {
  $j = Invoke-WebRequest -Uri "$BaseUrl/api/user/me" -Headers @{ Authorization = "Bearer $fakeJwt" } -UseBasicParsing
  Pass "jwt-only /me 401" ($j.StatusCode -eq 401) "http=$($j.StatusCode)"
} catch {
  $st = 0; if ($_.Exception.Response) { $st = [int]$_.Exception.Response.StatusCode }
  Pass "jwt-only /me 401" ($st -eq 401) "http=$st"
}

# 4) login does not return token field with value
$hasToken = $s.Login.data.PSObject.Properties.Name -contains "token" -and $s.Login.data.token
Pass "login response no JWT" (-not $hasToken) "hasToken=$hasToken"

# 5) GET logout must NOT invalidate (authenticated → 405 body)
try {
  $g = Invoke-WebRequest -Uri "$BaseUrl/api/user/logout" -Method GET -WebSession $s.Session -UseBasicParsing
  Pass "GET logout rejected" ($g.StatusCode -eq 405 -or ($g.Content -match '"code"\s*:\s*"405"')) "http=$($g.StatusCode)"
} catch {
  $st = 0; $body = ""
  if ($_.Exception.Response) {
    $st = [int]$_.Exception.Response.StatusCode
    try {
      $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
      $body = $reader.ReadToEnd()
    } catch {}
  }
  Pass "GET logout rejected" ($st -eq 405 -or $body -match '"code"\s*:\s*"405"') "http=$st body=$body"
}
# GET 不得登出：此后 cookie-only /me 仍应成功
$meStill = Invoke-ApiJson -BaseUrl $BaseUrl -Path "/api/user/me" -AppSession $s -Method GET
Pass "GET logout 未销毁 Session" ($meStill.Json -and $meStill.Json.code -eq "0") "code=$($meStill.Json.code)"

# 6) POST logout without CSRF -> 403
Clear-AppSessionStickyHeaders -AppSession $s
try {
  $bad = Invoke-WebRequest -Uri "$BaseUrl/api/user/logout" -Method POST -ContentType "application/json" `
    -WebSession $s.Session -Body '{}' -UseBasicParsing
  $bj = $bad.Content | ConvertFrom-Json
  Pass "POST logout no CSRF 403" ($bj.code -eq "403" -or $bad.StatusCode -eq 403) "code=$($bj.code)"
} catch {
  $st = 0; if ($_.Exception.Response) { $st = [int]$_.Exception.Response.StatusCode }
  Pass "POST logout no CSRF 403" ($st -eq 403) "http=$st"
}

# 7) POST logout with CSRF + cookie then me 401
$s2 = New-AppSession -BaseUrl $BaseUrl -Username $UserName -Password $UserPass
$lo = Invoke-ApiJson -BaseUrl $BaseUrl -Path "/api/user/logout" -AppSession $s2 -Method POST -BodyObject @{}
Pass "POST logout CSRF ok" ($lo.Json -and $lo.Json.code -eq "0") "code=$($lo.Json.code)"
$me2 = Invoke-ApiJson -BaseUrl $BaseUrl -Path "/api/user/me" -AppSession $s2 -Method GET
Pass "after logout cookie /me 401" (($me2.StatusCode -eq 401) -or ($me2.Json -and $me2.Json.code -ne "0")) "http=$($me2.StatusCode) code=$($me2.Json.code)"

# 8) historical JWT replay (if we can mint via unit tests only — here use garbage long token)
# 无法从浏览器登录拿到 JWT；用随机 Bearer 证明拦截器不接受
$fresh = New-Object Microsoft.PowerShell.Commands.WebRequestSession
try {
  $r = Invoke-WebRequest -Uri "$BaseUrl/api/user/me" -WebSession $fresh -Headers @{ Authorization = "Bearer $fakeJwt" } -UseBasicParsing
  Pass "fresh session + JWT still 401" ($r.StatusCode -eq 401) "http=$($r.StatusCode)"
} catch {
  $st = 0; if ($_.Exception.Response) { $st = [int]$_.Exception.Response.StatusCode }
  Pass "fresh session + JWT still 401" ($st -eq 401) "http=$st"
}

Write-Host "=== DONE fail=$fail ===" -ForegroundColor Cyan
if ($fail -gt 0) { exit 1 } else { exit 0 }
