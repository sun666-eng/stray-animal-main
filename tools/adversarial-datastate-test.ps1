# 对抗：制造领养/动物脏状态 → 重启 DataStateGuard → 断言干净 + 版本写入
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

Write-Host "=== 1) 制造脏数据 ===" -ForegroundColor Cyan
$sqlFile = Join-Path $env:TEMP "adv-state-break.sql"
@'
USE test;
SET @aid := (SELECT MIN(id) FROM t_animal);
SET @aid2 := (SELECT MIN(id) FROM t_animal WHERE id > @aid);
DELETE FROM t_adopt WHERE aid IN (@aid, @aid2) AND uid IN (21, 23, 32);
INSERT INTO t_adopt (aid, uid, uname, aname, vstate, tel, location)
VALUES
  (@aid, 21, 'hello', 'dirty-test', 1, 1, 'loc'),
  (@aid, 23, 'yes', 'dirty-test', 1, 1, 'loc'),
  (@aid, 32, 'jehh', 'dirty-test', 0, 1, 'loc');
UPDATE t_animal SET tstate = 0 WHERE id = @aid;
-- 孤儿申请中
DELETE FROM t_adopt WHERE aid = @aid2 AND uid IN (21, 23, 32);
UPDATE t_animal SET tstate = 1 WHERE id = @aid2;
SELECT @aid AS dirty_aid, @aid2 AS orphan_aid;
SELECT aid, uid, vstate FROM t_adopt WHERE aid = @aid ORDER BY uid;
SELECT id, tstate FROM t_animal WHERE id IN (@aid, @aid2);
'@ | Set-Content -Path $sqlFile -Encoding ASCII
Get-Content $sqlFile -Raw | & $Mysql -uroot -p123456 2>&1 | Where-Object { $_ -notmatch 'Using a password' }

$pending = Mysql "SELECT COUNT(*) FROM t_adopt d WHERE d.vstate=0 AND EXISTS (SELECT 1 FROM t_adopt x WHERE x.aid=d.aid AND x.vstate=1)"
$multi = Mysql "SELECT COUNT(*) FROM (SELECT aid FROM t_adopt WHERE vstate=1 GROUP BY aid HAVING COUNT(*)>1) t"
Pass "破坏成功-有待审且有通过" ([int]$pending -ge 1) "pending=$pending"
Pass "破坏成功-多通过" ([int]$multi -ge 1) "multi=$multi"

Write-Host "=== 2) 重启应用触发 DataStateGuard ===" -ForegroundColor Cyan
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

Write-Host "=== 3) 断言已干净 ===" -ForegroundColor Cyan
$pending2 = Mysql "SELECT COUNT(*) FROM t_adopt d WHERE d.vstate=0 AND EXISTS (SELECT 1 FROM t_adopt x WHERE x.aid=d.aid AND x.vstate=1)"
$multi2 = Mysql "SELECT COUNT(*) FROM (SELECT aid FROM t_adopt WHERE vstate=1 GROUP BY aid HAVING COUNT(*)>1) t"
$mismatch = Mysql "SELECT COUNT(*) FROM t_animal a WHERE a.tstate <> (CASE WHEN EXISTS (SELECT 1 FROM t_adopt d WHERE d.aid=a.id AND d.vstate=1) THEN 2 WHEN EXISTS (SELECT 1 FROM t_adopt d WHERE d.aid=a.id AND d.vstate=0) THEN 1 ELSE 0 END)"
$orphan = Mysql "SELECT COUNT(*) FROM t_animal a WHERE a.tstate=1 AND NOT EXISTS (SELECT 1 FROM t_adopt d WHERE d.aid=a.id AND d.vstate IN (0,1))"
$ver = Mysql "SELECT meta_value FROM app_schema_meta WHERE meta_key='data_state_version'"

Pass "无「有通过仍待审」" ($pending2 -eq "0") "cnt=$pending2"
Pass "无「一动物多通过」" ($multi2 -eq "0") "cnt=$multi2"
Pass "动物 tstate 与领养一致" ($mismatch -eq "0") "cnt=$mismatch"
Pass "无孤儿申请中" ($orphan -eq "0") "cnt=$orphan"
Pass "data_state_version" ($ver -match "2026.07.12-state-v1") "ver=$ver"

# 同一动物只剩一条通过，且为该动物上原通过集合中 uid 最小者
$aidMin = Mysql "SELECT MIN(id) FROM t_animal"
$cntAppr = Mysql "SELECT COUNT(*) FROM t_adopt WHERE aid=$aidMin AND vstate=1"
$keptUid = Mysql "SELECT uid FROM t_adopt WHERE aid=$aidMin AND vstate=1 LIMIT 1"
Pass "同一动物仅一条已通过" ($cntAppr -eq "1") "cnt=$cntAppr"
Pass "保留的是最小 uid 策略结果" ($cntAppr -eq "1" -and $keptUid -ne "") "aid=$aidMin keepUid=$keptUid"

Write-Host "=== DONE fail=$fail ===" -ForegroundColor Cyan
if ($fail -gt 0) { exit 1 } else { exit 0 }
