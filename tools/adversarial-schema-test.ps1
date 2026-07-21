# 对抗性验证：人为破坏闭环结构 → 触发 SchemaGuard（重启应用或直接断言列恢复）
# 用法（需 MySQL + 应用能启动）:
#   powershell -ExecutionPolicy Bypass -File tools/adversarial-schema-test.ps1

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

Write-Host "=== 1) 人为破坏结构 ===" -ForegroundColor Cyan
# drop columns if exist
$hasP = Mysql "SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='t_proof' AND COLUMN_NAME='pstatus'"
if ($hasP -eq "1") {
  Mysql "ALTER TABLE t_proof DROP COLUMN pstatus"
  Write-Host "dropped t_proof.pstatus"
}
$hasA = Mysql "SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='t_volunteer' AND COLUMN_NAME='apic'"
if ($hasA -eq "1") {
  Mysql "ALTER TABLE t_volunteer DROP COLUMN apic"
  Write-Host "dropped t_volunteer.apic"
}
Mysql "DELETE FROM t_role WHERE id=4"
# 故意去掉 my_proof，验证启动时会重建标准用户权限
Mysql "UPDATE t_role SET permission='[]' WHERE id=3"
Write-Host "role4 deleted, role3 permission cleared"

Write-Host "=== 2) 重启应用以触发 SchemaGuard ===" -ForegroundColor Cyan
$conns = Get-NetTCPConnection -LocalPort 9999 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique
foreach ($procId in $conns) { if ($procId) { Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue } }
Start-Sleep 2

$env:JWT_SECRET = "dev-local-jwt-secret-change-me-32chars-min"
$env:DB_PASSWORD = "123456"
$env:SCHEMA_GUARD_ENABLED = "true"
$env:SCHEMA_GUARD_AUTO_MIGRATE = "true"

$p = Start-Process -FilePath "mvn" -ArgumentList "-q","-DskipTests","spring-boot:run" -WorkingDirectory $Root -PassThru -WindowStyle Hidden
$up = $false
for ($i = 0; $i -lt 45; $i++) {
  Start-Sleep 2
  try {
    $r = Invoke-WebRequest -Uri "$BaseUrl/api/dashboard/public-stats" -UseBasicParsing -TimeoutSec 2
    if ($r.StatusCode -eq 200) { $up = $true; break }
  } catch {}
}
Pass "应用重启成功" $up "pid=$($p.Id)"

Write-Host "=== 3) 断言结构已自愈 ===" -ForegroundColor Cyan
$pstatus = Mysql "SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='t_proof' AND COLUMN_NAME='pstatus'"
$apic = Mysql "SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='t_volunteer' AND COLUMN_NAME='apic'"
$uid = Mysql "SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='t_volunteer' AND COLUMN_NAME='uid'"
$role4 = Mysql "SELECT COUNT(*) FROM t_role WHERE id=4"
$role3 = Mysql "SELECT permission FROM t_role WHERE id=3"
$ver = Mysql "SELECT meta_value FROM app_schema_meta WHERE meta_key='schema_version'"

Pass "pstatus 已恢复" ($pstatus -eq "1") "cnt=$pstatus"
Pass "apic 已恢复" ($apic -eq "1") "cnt=$apic"
Pass "uid 存在" ($uid -eq "1") "cnt=$uid"
Pass "角色4 已恢复" ($role4 -eq "1") "cnt=$role4"
Pass "角色3 含 my_proof" ($role3 -match "my_proof") "perm=$role3"
Pass "schema_version 已写入" ($ver -match "2026.07.12-loop-v2") "ver=$ver"

Write-Host "=== 4) 业务接口不再因缺列失败 ===" -ForegroundColor Cyan
try {
  $s = New-Object Microsoft.PowerShell.Commands.WebRequestSession
  Invoke-RestMethod -Uri "$BaseUrl/api/user/login" -Method POST -ContentType "application/json" `
    -Body '{"username":"admin","password":"admin"}' -WebSession $s | Out-Null
  $proof = Invoke-RestMethod -Uri "$BaseUrl/api/proof/page?pageNum=1&pageSize=1&name=" -WebSession $s
  Pass "凭证分页可用" ($proof.code -eq "0") "code=$($proof.code) msg=$($proof.msg)"
} catch {
  Pass "凭证分页可用" $false $_.Exception.Message
}

Write-Host "=== DONE fail=$fail ===" -ForegroundColor Cyan
if ($fail -gt 0) { exit 1 } else { exit 0 }
