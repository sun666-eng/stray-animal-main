# 对抗：破坏角色/权限契约 → 重启 → RolePermissionGuard 自愈 → 业务与越权检查
param(
  [string]$Mysql = "D:\MySQL\MySQL Server 8.0\bin\mysql.exe",
  [string]$Root = "D:\Documents\日期归档\2026\2026.4.7\Myproject\stray-animal-main",
  [string]$BaseUrl = "http://localhost:9999"
)

$ErrorActionPreference = "Continue"
$fail = 0
function Pass($n, $ok, $d) {
  if ($ok) { Write-Host "[PASS] $n :: $d" -ForegroundColor Green }
  else { Write-Host "[FAIL] $n :: $d" -ForegroundColor Red; $script:fail++ }
}
function Mysql([string]$sql) {
  $out = & $Mysql -uroot -p123456 -N -e "USE test; $sql" 2>&1 | Where-Object { $_ -notmatch 'Using a password' }
  return ($out | Out-String).Trim()
}

Write-Host "=== 1) 破坏权限契约 ===" -ForegroundColor Cyan
$sqlFile = Join-Path $env:TEMP "adv-perm-break.sql"
@'
USE test;
UPDATE t_role SET permission='[]' WHERE id=3;
UPDATE t_role SET permission='[{"flag":"adopt"},{"flag":"visit"},{"flag":"proof"}]' WHERE id=4;
UPDATE t_user SET role='[{"id":3,"name":"普通用户","description":null,"permission":null},{"id":2,"name":"志愿者","description":null,"permission":null}]' WHERE username='jerry';
SELECT id, LEFT(permission,60) FROM t_role WHERE id IN (3,4);
SELECT id, LEFT(role,100) FROM t_user WHERE username='jerry';
'@ | Set-Content -Path $sqlFile -Encoding ASCII
Get-Content $sqlFile -Raw | & $Mysql -uroot -p123456 2>&1 | Where-Object { $_ -notmatch 'Using a password' }
Write-Host "role3 cleared, role4 poisoned, jerry forced 2+3"

Write-Host "=== 2) 重启应用 ===" -ForegroundColor Cyan
$conns = Get-NetTCPConnection -LocalPort 9999 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique
foreach ($procId in $conns) { if ($procId) { Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue } }
Start-Sleep 2
$env:JWT_SECRET = "dev-local-jwt-secret-change-me-32chars-min"
$env:DB_PASSWORD = "123456"
Start-Process -FilePath "mvn" -ArgumentList "-q","-DskipTests","spring-boot:run" -WorkingDirectory $Root -WindowStyle Hidden | Out-Null
$up = $false
for ($i = 0; $i -lt 45; $i++) {
  Start-Sleep 2
  try {
    $r = Invoke-WebRequest -Uri "$BaseUrl/api/dashboard/public-stats" -UseBasicParsing -TimeoutSec 2
    if ($r.StatusCode -eq 200) { $up = $true; break }
  } catch {}
}
Pass "应用启动" $up "ok"

Write-Host "=== 3) 契约断言 ===" -ForegroundColor Cyan
$p3 = Mysql "SELECT permission FROM t_role WHERE id=3"
$p4 = Mysql "SELECT permission FROM t_role WHERE id=4"
$ver = Mysql "SELECT meta_value FROM app_schema_meta WHERE meta_key='role_contract_version'"
$jerryRole = Mysql "SELECT role FROM t_user WHERE username='jerry'"

Pass "角色3 恢复用户闭环 flags" ($p3 -match "my_proof" -and $p3 -match "im" -and $p3 -match "apply") "ok"
Pass "角色3 无后台 adopt" (-not ($p3 -match '"flag":"adopt"')) "ok"
Pass "角色4 已清空后台权" (($p4 -eq "[]") -or ($p4 -eq "") -or (-not ($p4 -match "adopt"))) "p4=$p4"
Pass "role_contract_version" ($ver -match "2026.07.12-rbac-v1") "ver=$ver"
Pass "jerry 降权 role2→4" (($jerryRole -match '"id":4') -and (-not ($jerryRole -match '"id":2'))) "role=$jerryRole"

Write-Host "=== 4) 运行时权限行为 ===" -ForegroundColor Cyan
try {
  $s = New-Object Microsoft.PowerShell.Commands.WebRequestSession
  $login = Invoke-RestMethod -Uri "$BaseUrl/api/user/login" -Method POST -ContentType "application/json" `
    -Body '{"username":"jerry","password":"123456"}' -WebSession $s
  $flags = @($login.data.user.permission | ForEach-Object { $_.flag })
  $adminLeak = @($flags | Where-Object { $_ -in @("animal","adopt","proof","visit","volunteer","account","notice","help","user","role") })
  Pass "jerry 登录 flags 无后台大权" ($adminLeak.Count -eq 0) "flags=$($flags -join ',')"
  $need = @("im","adopt_view","my_adopt","my_proof","apply")
  $missing = @($need | Where-Object { $flags -notcontains $_ })
  Pass "jerry 具备用户闭环 flags" ($missing.Count -eq 0) "missing=$($missing -join ',')"

  $help = Invoke-WebRequest -Uri "$BaseUrl/api/help" -Method POST -ContentType "application/json" -WebSession $s `
    -Body '{"title":"perm-adv","description":"d","location":"l","phone":"1"}' -UseBasicParsing
  $hj = $help.Content | ConvertFrom-Json
  Pass "救助提交 200" ($hj.code -eq "0") "code=$($hj.code)"

  $idor = Invoke-WebRequest -Uri "$BaseUrl/api/adopt/page2?pageNum=1&pageSize=1&uid=1&name=" -WebSession $s -UseBasicParsing
  $ij = $idor.Content | ConvertFrom-Json
  Pass "越权他人领养 403" ($ij.code -eq "403") "code=$($ij.code)"
} catch {
  Pass "运行时权限行为" $false $_.Exception.Message
}

Write-Host "=== DONE fail=$fail ===" -ForegroundColor Cyan
if ($fail -gt 0) { exit 1 } else { exit 0 }
