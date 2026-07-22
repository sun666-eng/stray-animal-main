# 对抗：Session / JWT / 登出 / CSRF /me
# 用法：应用已启动后
#   powershell -ExecutionPolicy Bypass -File tools/adversarial-auth-test.ps1
# 启动应用时请设 SPRING_PROFILES_ACTIVE=dev

param(
  [string]$BaseUrl = "http://localhost:9999",
  [string]$Root = "D:\Documents\日期归档\2026\2026.4.7\Myproject\stray-animal-main",
  [string]$UserName = "jerry",
  [string]$UserPass = "123456"
)

$ErrorActionPreference = "Continue"
$fail = 0
. "$PSScriptRoot\lib-session.ps1"

function Pass($n, $ok, $d) {
  if ($ok) { Write-Host "[PASS] $n :: $d" -ForegroundColor Green }
  else { Write-Host "[FAIL] $n :: $d" -ForegroundColor Red; $script:fail++ }
}

function EnsureApp {
  try {
    Invoke-WebRequest -Uri "$BaseUrl/api/dashboard/public-stats" -UseBasicParsing -TimeoutSec 3 | Out-Null
    return
  } catch {}
  Write-Host "starting app with SPRING_PROFILES_ACTIVE=dev ..."
  $conns = Get-NetTCPConnection -LocalPort 9999 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique
  foreach ($procId in $conns) { if ($procId) { Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue } }
  Start-Sleep 2
  $env:SPRING_PROFILES_ACTIVE = "dev"
  $env:JWT_ALLOW_DEV_SECRET = "true"
  $env:DB_PASSWORD = "123456"
  Start-Process -FilePath "mvn" -ArgumentList "-q","-DskipTests","spring-boot:run" -WorkingDirectory $Root -WindowStyle Hidden
  for ($i = 0; $i -lt 45; $i++) {
    Start-Sleep 2
    try { Invoke-WebRequest -Uri "$BaseUrl/api/dashboard/public-stats" -UseBasicParsing -TimeoutSec 2 | Out-Null; return } catch {}
  }
  throw "app failed to start"
}

try { EnsureApp } catch { Write-Host $_.Exception.Message -ForegroundColor Red; exit 1 }

Write-Host "=== 1) 无凭证 /me ===" -ForegroundColor Cyan
$r = Invoke-ApiJson -BaseUrl $BaseUrl -Path "/api/user/me" -AppSession ([pscustomobject]@{ Session = (New-Object Microsoft.PowerShell.Commands.WebRequestSession); Token = $null; Csrf = $null }) -Method GET
Pass "/me 未登录失败" (($r.Json -and $r.Json.code -ne "0") -or $r.StatusCode -eq 401) "http=$($r.StatusCode) code=$($r.Json.code)"

Write-Host "=== 2) 登录 ===" -ForegroundColor Cyan
$s = New-AppSession -BaseUrl $BaseUrl -Username $UserName -Password $UserPass
Pass "登录成功" ($s.Login.code -eq "0") "user=$($s.User.username)"
Pass "返回 csrfToken" ([bool]$s.Csrf) "csrf_len=$($s.Csrf.Length)"

Write-Host "=== 3) Session /me ===" -ForegroundColor Cyan
$me1 = Invoke-ApiJson -BaseUrl $BaseUrl -Path "/api/user/me" -AppSession $s -Method GET
Pass "Session /me" ($me1.Json.code -eq "0" -and $me1.Json.data.username -eq $UserName) "user=$($me1.Json.data.username)"

Write-Host "=== 4) 假 token ===" -ForegroundColor Cyan
$fake = [pscustomobject]@{ Session = (New-Object Microsoft.PowerShell.Commands.WebRequestSession); Token = "faketoken.xxx.yyy"; Csrf = $null }
$meFake = Invoke-ApiJson -BaseUrl $BaseUrl -Path "/api/user/me" -AppSession $fake -Method GET
Pass "假 token 拒绝" (($meFake.Json -and $meFake.Json.code -ne "0") -or $meFake.StatusCode -eq 401) "http=$($meFake.StatusCode)"

Write-Host "=== 5) 有 CSRF 提交救助 ===" -ForegroundColor Cyan
$help = Invoke-ApiJson -BaseUrl $BaseUrl -Path "/api/help" -AppSession $s -Method POST -BodyObject @{
  title = "auth-adv"; description = "d"; location = "l"; phone = "1"
}
Pass "CSRF 提交救助" ($help.Json.code -eq "0") "code=$($help.Json.code)"

Write-Host "=== 6) 无 CSRF 状态变更 ===" -ForegroundColor Cyan
Clear-AppSessionStickyHeaders -AppSession $s
try {
  $bad = Invoke-WebRequest -Uri "$BaseUrl/api/help" -Method POST -ContentType "application/json" `
    -WebSession $s.Session -Body '{"title":"no-csrf","description":"d","location":"l","phone":"1"}' -UseBasicParsing
  $bj = $bad.Content | ConvertFrom-Json
  Pass "无 CSRF 403" ($bj.code -eq "403" -or [int]$bad.StatusCode -eq 403) "code=$($bj.code)"
} catch {
  $st = 0
  $body = ""
  if ($_.Exception.Response) {
    $st = [int]$_.Exception.Response.StatusCode
    try {
      $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
      $body = $reader.ReadToEnd()
    } catch {}
  }
  Pass "无 CSRF 403" ($st -eq 403 -or $body -match '"code"\s*:\s*"403"') "http=$st"
}

Write-Host "=== 7) 登出后 me ===" -ForegroundColor Cyan
$lo = Invoke-ApiJson -BaseUrl $BaseUrl -Path "/api/user/logout" -AppSession $s -Method POST -BodyObject @{}
Clear-AppSessionStickyHeaders -AppSession $s
$me2 = Invoke-ApiJson -BaseUrl $BaseUrl -Path "/api/user/me" -AppSession $s -Method GET
Pass "登出后 me 失败" (($me2.Json -and $me2.Json.code -ne "0") -or $me2.StatusCode -eq 401) "http=$($me2.StatusCode) code=$($me2.Json.code)"
# 登录响应不得带 JWT
$tok = $false
if ($s.Login.data -and $s.Login.data.PSObject.Properties.Name -contains "token" -and $s.Login.data.token) { $tok = $true }
Pass "登录无 JWT" (-not $tok) "hasToken=$tok"

Write-Host "=== 8) auth-session.js ===" -ForegroundColor Cyan
$js = Invoke-WebRequest -Uri "$BaseUrl/js/auth-session.js" -UseBasicParsing
Pass "auth-session.js" ($js.StatusCode -eq 200 -and $js.Content -match "getCsrfToken" -and $js.Content -match "getUploadHeaders") "len=$($js.Content.Length)"

Write-Host "=== DONE fail=$fail ===" -ForegroundColor Cyan
if ($fail -gt 0) { exit 1 } else { exit 0 }
