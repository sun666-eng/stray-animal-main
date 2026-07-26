# P0-8：真实 MySQL 文件引用 collation / 哨兵值矩阵（只读检查 + 可选破坏后重启）
# 默认只做只读断言；加 -Destructive 才会 DROP 列并重启应用（与 adversarial-schema-test 类似）
param(
  [string]$Mysql = $env:MYSQL_CLI,
  [string]$Db = $(if ($env:DB_NAME) { $env:DB_NAME } else { "test" }),
  [string]$User = $(if ($env:DB_USERNAME) { $env:DB_USERNAME } else { "root" }),
  [string]$Password = $(if ($env:DB_PASSWORD) { $env:DB_PASSWORD } else { "" }),
  [string]$BaseUrl = $(if ($env:BASE_URL) { $env:BASE_URL } else { "http://localhost:9999" })
)

$ErrorActionPreference = "Continue"
$fail = 0
if (-not $Mysql) {
  foreach ($c in @("D:\MySQL\MySQL Server 8.0\bin\mysql.exe", "mysql")) {
    if ($c -eq "mysql" -or (Test-Path $c)) { $Mysql = $c; break }
  }
}
function Pass([string]$n, [bool]$ok, [string]$d) {
  if ($ok) { Write-Host "[PASS] $n :: $d" -ForegroundColor Green }
  else { Write-Host "[FAIL] $n :: $d" -ForegroundColor Red; $script:fail++ }
}
function Mysql([string]$sql) {
  if (-not $Password) { throw "DB_PASSWORD required" }
  $args = @("-u$User", "-p$Password", "-N", "-e", "USE ``$Db``; $sql")
  if ($env:DB_HOST) { $args = @("-h$($env:DB_HOST)") + $args }
  if ($env:DB_PORT) { $args = @("-P$($env:DB_PORT)") + $args }
  $out = & $Mysql @args 2>&1 | Where-Object { $_ -notmatch 'Using a password' }
  return ($out | Out-String).Trim()
}

Write-Host "=== P0 MySQL matrix (db=$Db) ===" -ForegroundColor Cyan
$ver = Mysql "SELECT meta_value FROM app_schema_meta WHERE meta_key='schema_version'"
Pass "schema_version v3" ($ver -match "2026\.07\.24-file-collation-v3") "ver=$ver"

$cols = @(
  @("t_file_asset","flag"),
  @("t_user","avatar"),
  @("t_animal","tpic"),
  @("t_proof","ppic"),
  @("t_volunteer","apic"),
  @("t_help","pic"),
  @("t_visit","pic")
)
foreach ($c in $cols) {
  $coll = Mysql "SELECT COLLATION_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='$($c[0])' AND COLUMN_NAME='$($c[1])'"
  Pass "$($c[0]).$($c[1]) unicode_ci" ($coll -eq "utf8mb4_unicode_ci") "col=$coll"
}

$badAvatar = Mysql "SELECT COUNT(*) FROM t_user WHERE TRIM(IFNULL(avatar,''))='1'"
Pass "无 avatar=1" ($badAvatar -eq "0" -or $badAvatar -eq "") "cnt=$badAvatar"

# 启动存活
try {
  $r = Invoke-WebRequest -Uri "$BaseUrl/api/dashboard/home-stats" -UseBasicParsing -TimeoutSec 5
  Pass "应用可达" ($r.StatusCode -eq 200) "http=$($r.StatusCode)"
} catch {
  Pass "应用可达" $false $_.Exception.Message
}

Write-Host "=== p0-mysql-collation-matrix done fail=$fail (read-only) ===" -ForegroundColor Cyan
Write-Host "Destructive heal: tools/adversarial-schema-test.ps1 -Destructive -ConfirmToken DESTROY_SCHEMA_TEST" -ForegroundColor DarkGray
if ($fail -gt 0) { exit 1 } else { exit 0 }
