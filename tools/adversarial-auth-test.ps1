# 对抗：假登录 / 真登录 /me / 带 JWT 访问
param(
  [string]$BaseUrl = "http://localhost:9999",
  [string]$Root = "D:\Documents\日期归档\2026\2026.4.7\Myproject\stray-animal-main"
)

$ErrorActionPreference = "Continue"
$fail = 0
function Pass($n, $ok, $d) {
  if ($ok) { Write-Host "[PASS] $n :: $d" -ForegroundColor Green }
  else { Write-Host "[FAIL] $n :: $d" -ForegroundColor Red; $script:fail++ }
}

# ensure app up
try {
  Invoke-WebRequest -Uri "$BaseUrl/api/dashboard/public-stats" -UseBasicParsing -TimeoutSec 3 | Out-Null
} catch {
  Write-Host "starting app..."
  $conns = Get-NetTCPConnection -LocalPort 9999 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique
  foreach ($procId in $conns) { if ($procId) { Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue } }
  Start-Sleep 2
  $env:JWT_SECRET = "dev-local-jwt-secret-change-me-32chars-min"
  $env:DB_PASSWORD = "123456"
  Start-Process -FilePath "mvn" -ArgumentList "-q","-DskipTests","spring-boot:run" -WorkingDirectory $Root -WindowStyle Hidden
  for ($i=0; $i -lt 40; $i++) {
    Start-Sleep 2
    try { Invoke-WebRequest -Uri "$BaseUrl/api/dashboard/public-stats" -UseBasicParsing -TimeoutSec 2 | Out-Null; break } catch {}
  }
}

Write-Host "=== 1) 无凭证访问 /me ===" -ForegroundColor Cyan
try {
  $r = Invoke-WebRequest -Uri "$BaseUrl/api/user/me" -UseBasicParsing
  $j = $r.Content | ConvertFrom-Json
  Pass "/me 未登录应失败" ($j.code -ne "0") "code=$($j.code)"
} catch {
  Pass "/me 未登录 401/错误" $true $_.Exception.Message
}

Write-Host "=== 2) 登录拿 token ===" -ForegroundColor Cyan
$s = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$login = Invoke-RestMethod -Uri "$BaseUrl/api/user/login" -Method POST -ContentType "application/json" `
  -Body '{"username":"jerry","password":"123456"}' -WebSession $s
$token = $login.data.token
Pass "登录成功有 token" ($login.code -eq "0" -and $token) "len=$($token.Length)"

Write-Host "=== 3) Session cookie 访问 /me ===" -ForegroundColor Cyan
$me1 = Invoke-RestMethod -Uri "$BaseUrl/api/user/me" -WebSession $s
Pass "Session /me" ($me1.code -eq "0" -and $me1.data.username -eq "jerry") "user=$($me1.data.username)"

Write-Host "=== 4) 仅 Bearer 无 cookie 访问 /me ===" -ForegroundColor Cyan
$me2 = Invoke-RestMethod -Uri "$BaseUrl/api/user/me" -Headers @{ Authorization = "Bearer $token" }
Pass "JWT /me" ($me2.code -eq "0" -and $me2.data.id) "id=$($me2.data.id)"

Write-Host "=== 5) 假 token ===" -ForegroundColor Cyan
try {
  Invoke-RestMethod -Uri "$BaseUrl/api/user/me" -Headers @{ Authorization = "Bearer faketoken.xxx.yyy" } | Out-Null
  Pass "假 token 应失败" $false "unexpected ok"
} catch {
  Pass "假 token 拒绝" $true "rejected"
}

Write-Host "=== 6) 业务 API 带 JWT ===" -ForegroundColor Cyan
$help = Invoke-RestMethod -Uri "$BaseUrl/api/help" -Method POST -ContentType "application/json" `
  -Headers @{ Authorization = "Bearer $token" } `
  -Body '{"title":"auth-adv","description":"d","location":"l","phone":"1"}'
Pass "JWT 提交救助" ($help.code -eq "0") "code=$($help.code)"

Write-Host "=== 7) 静态资源 auth-session 可访问 ===" -ForegroundColor Cyan
$js = Invoke-WebRequest -Uri "$BaseUrl/js/auth-session.js?v=20260712a" -UseBasicParsing
Pass "auth-session.js" ($js.StatusCode -eq 200 -and $js.Content -match "AuthSession") "len=$($js.Content.Length)"

Write-Host "=== DONE fail=$fail ===" -ForegroundColor Cyan
if ($fail -gt 0) { exit 1 } else { exit 0 }
