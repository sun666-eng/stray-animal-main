# 对抗性验证：人为破坏闭环结构 → 触发 SchemaGuard 自愈
# 默认：只读检查（安全）
# 破坏性：必须 -Destructive -ConfirmToken DESTROY_SCHEMA_TEST
#   且 DB_NAME 必须为允许的测试库名（默认仅 test / animal_test）
#
# 环境变量（推荐）：
#   MYSQL_CLI, DB_HOST, DB_PORT, DB_NAME, DB_USERNAME, DB_PASSWORD
#   BASE_URL, PROJECT_ROOT

param(
  [string]$Mysql = $env:MYSQL_CLI,
  [string]$Root = $(if ($env:PROJECT_ROOT) { $env:PROJECT_ROOT } else { Split-Path -Parent $PSScriptRoot }),
  [string]$BaseUrl = $(if ($env:BASE_URL) { $env:BASE_URL } else { "http://localhost:9999" }),
  [string]$DbName = $(if ($env:DB_NAME) { $env:DB_NAME } else { "test" }),
  [string]$DbUser = $(if ($env:DB_USERNAME) { $env:DB_USERNAME } else { "root" }),
  [string]$DbPassword = $(if ($env:DB_PASSWORD) { $env:DB_PASSWORD } else { "" }),
  [switch]$Destructive,
  [string]$ConfirmToken = ""
)

$ErrorActionPreference = "Continue"
$fail = 0
if (-not $Mysql -or -not (Test-Path $Mysql)) {
  $candidates = @(
    "D:\MySQL\MySQL Server 8.0\bin\mysql.exe",
    "C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe",
    "mysql"
  )
  foreach ($c in $candidates) {
    if ($c -eq "mysql" -or (Test-Path $c)) { $Mysql = $c; break }
  }
}

function Pass($n, $ok, $d) {
  if ($ok) { Write-Host "[PASS] $n :: $d" -ForegroundColor Green }
  else { Write-Host "[FAIL] $n :: $d" -ForegroundColor Red; $script:fail++ }
}

function Mysql([string]$sql) {
  if (-not $DbPassword) {
    throw "DB_PASSWORD is required (do not hardcode secrets in scripts)"
  }
  $args = @("-u$DbUser", "-p$DbPassword", "-N", "-e", "USE ``$DbName``; $sql")
  if ($env:DB_HOST) { $args = @("-h$($env:DB_HOST)") + $args }
  if ($env:DB_PORT) { $args = @("-P$($env:DB_PORT)") + $args }
  $out = & $Mysql @args 2>&1 | Where-Object { $_ -notmatch 'Using a password' }
  return ($out | Out-String).Trim()
}

function Assert-ReadOnlySchemaHealth {
  Write-Host "=== Read-only schema health (db=$DbName) ===" -ForegroundColor Cyan
  $ver = Mysql "SELECT meta_value FROM app_schema_meta WHERE meta_key='schema_version'"
  Pass "schema_version v3" ($ver -match "2026\.07\.24-file-collation-v3") "ver=$ver"
  $flagCol = Mysql "SELECT COLLATION_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='t_file_asset' AND COLUMN_NAME='flag'"
  $avatarCol = Mysql "SELECT COLLATION_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='t_user' AND COLUMN_NAME='avatar'"
  $badAvatar = Mysql "SELECT COUNT(*) FROM t_user WHERE TRIM(IFNULL(avatar,''))='1'"
  $pstatus = Mysql "SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='t_proof' AND COLUMN_NAME='pstatus'"
  $apic = Mysql "SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='t_volunteer' AND COLUMN_NAME='apic'"
  Pass "flag unicode_ci" ($flagCol -match "utf8mb4_unicode_ci") "col=$flagCol"
  Pass "avatar unicode_ci" ($avatarCol -match "utf8mb4_unicode_ci") "col=$avatarCol"
  Pass "无 avatar=1" ($badAvatar -eq "0") "cnt=$badAvatar"
  Pass "pstatus 存在" ($pstatus -eq "1") "cnt=$pstatus"
  Pass "apic 存在" ($apic -eq "1") "cnt=$apic"
  try {
    $r = Invoke-WebRequest -Uri "$BaseUrl/api/dashboard/home-stats" -UseBasicParsing -TimeoutSec 5
    Pass "应用可达" ($r.StatusCode -eq 200) "http=$($r.StatusCode)"
  } catch {
    Pass "应用可达" $false $_.Exception.Message
  }
}

$allowedDbs = @("test", "animal_test", "stray_animal_test")
if ($Destructive) {
  if ($ConfirmToken -ne "DESTROY_SCHEMA_TEST") {
    Write-Host "ERROR: destructive mode requires -ConfirmToken DESTROY_SCHEMA_TEST" -ForegroundColor Red
    exit 2
  }
  if ($allowedDbs -notcontains $DbName) {
    Write-Host "ERROR: destructive mode only allows DB_NAME in: $($allowedDbs -join ', ')" -ForegroundColor Red
    exit 2
  }
  if (-not $DbPassword) {
    Write-Host "ERROR: set DB_PASSWORD env for destructive mode" -ForegroundColor Red
    exit 2
  }

  Write-Host "=== DESTRUCTIVE schema heal test on db=$DbName ===" -ForegroundColor Yellow
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
  Mysql "UPDATE t_role SET permission='[]' WHERE id=3"
  Write-Host "role4 deleted, role3 permission cleared"

  Write-Host "=== Restart app to trigger SchemaGuard ===" -ForegroundColor Cyan
  $conns = Get-NetTCPConnection -LocalPort 9999 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique
  foreach ($procId in $conns) { if ($procId) { Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue } }
  Start-Sleep 2

  $env:SPRING_PROFILES_ACTIVE = "dev"
  $env:DB_PASSWORD = $DbPassword
  $env:DB_NAME = $DbName
  if ($env:DB_USERNAME) { } else { $env:DB_USERNAME = $DbUser }

  $p = Start-Process -FilePath "mvn" -ArgumentList "-q","-DskipTests","spring-boot:run","-Dspring-boot.run.profiles=dev" `
    -WorkingDirectory $Root -PassThru -WindowStyle Hidden
  $up = $false
  for ($i = 0; $i -lt 45; $i++) {
    Start-Sleep 2
    try {
      $r = Invoke-WebRequest -Uri "$BaseUrl/api/dashboard/public-stats" -UseBasicParsing -TimeoutSec 2
      if ($r.StatusCode -eq 200) { $up = $true; break }
    } catch {}
  }
  Pass "应用重启成功" $up "pid=$($p.Id)"
  Assert-ReadOnlySchemaHealth
} else {
  Write-Host "=== Non-destructive mode (pass -Destructive -ConfirmToken DESTROY_SCHEMA_TEST for heal test) ===" -ForegroundColor Cyan
  if (-not $DbPassword) {
    # allow empty password only for local socketless skip? require password for any mysql
    if ($env:DB_PASSWORD) { $DbPassword = $env:DB_PASSWORD }
  }
  if (-not $DbPassword) {
    Write-Host "WARN: DB_PASSWORD unset; skip MySQL assertions" -ForegroundColor Yellow
    try {
      $r = Invoke-WebRequest -Uri "$BaseUrl/api/dashboard/home-stats" -UseBasicParsing -TimeoutSec 5
      Pass "应用可达（无 DB 断言）" ($r.StatusCode -eq 200) "http=$($r.StatusCode)"
    } catch {
      Pass "应用可达（无 DB 断言）" $false $_.Exception.Message
    }
  } else {
    Assert-ReadOnlySchemaHealth
  }
}

Write-Host "=== adversarial-schema-test done fail=$fail destructive=$Destructive ===" -ForegroundColor Cyan
if ($fail -gt 0) { exit 1 } else { exit 0 }
