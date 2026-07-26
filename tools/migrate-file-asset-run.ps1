# FileAsset 迁移编排：precheck →（可选）修共享头像 → apply → 磁盘 stored_name 回填
# 用法:
#   powershell -ExecutionPolicy Bypass -File tools/migrate-file-asset-run.ps1
#   powershell -ExecutionPolicy Bypass -File tools/migrate-file-asset-run.ps1 -FixSharedAvatars
#   powershell -ExecutionPolicy Bypass -File tools/migrate-file-asset-run.ps1 -SkipApply
param(
    [string]$Mysql = "D:\MySQL\MySQL Server 8.0\bin\mysql.exe",
    [string]$User = "root",
    [string]$Password = "123456",
    [string]$Database = "test",
    [switch]$FixSharedAvatars,
    [switch]$SkipApply,
    [string]$UploadDir = "",
    [string]$LegacyDir = ""
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
if (-not $UploadDir) { $UploadDir = Join-Path $env:USERPROFILE ".stray-animal\upload" }
if (-not $LegacyDir) { $LegacyDir = Join-Path $root "legacy-uploads" }
$repoUpload = Join-Path $root "upload"

function Invoke-Mysql([string]$Sql) {
    $prev = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    $out = & $Mysql "-u$User" "-p$Password" $Database --default-character-set=utf8mb4 -e $Sql 2>&1
    $code = $LASTEXITCODE
    $ErrorActionPreference = $prev
    $filtered = $out | Where-Object {
        $_ -and ($_ -notmatch "Using a password on the command line")
    }
    $filtered | ForEach-Object { Write-Host $_ }
    if ($code -ne 0) {
        throw "mysql exit $code : $Sql"
    }
}

function Invoke-MysqlFile([string]$Path) {
    $abs = (Resolve-Path $Path).Path
    $src = $abs -replace '\\', '/'
    Invoke-Mysql "source $src"
}

Write-Host "=== FileAsset migrate run ==="
Write-Host "DB=$Database upload=$UploadDir legacy=$LegacyDir"

function Invoke-MysqlScalar([string]$Sql) {
    $prev = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    $out = & $Mysql "-u$User" "-p$Password" $Database -N -B -e $Sql 2>&1 |
        Where-Object { $_ -and ($_ -notmatch "Using a password") }
    $code = $LASTEXITCODE
    $ErrorActionPreference = $prev
    if ($code -ne 0) { throw "mysql scalar exit $code : $Sql" }
    $line = ($out | Select-Object -Last 1)
    return [int]("$line".Trim())
}

Write-Host "`n[1] PRECHECK"
Invoke-MysqlFile (Join-Path $root "docs\sql\2026-07-21-file-asset-migrate-precheck.sql")

$blocking = Invoke-MysqlScalar "SELECT COUNT(*) FROM t_file_asset_migration_conflict WHERE reason IN ('MULTI_BUSINESS','BUSINESS_BIND_MISMATCH','SOFT_DELETED_AMBIGUOUS','SOFT_DELETED_EXISTS');"
Write-Host "blocking_conflicts=$blocking"
if ($blocking -gt 0 -and -not $FixSharedAvatars) {
    Write-Host "Conflicts present. Re-run with -FixSharedAvatars only after reviewing, or resolve manually."
    Invoke-Mysql "SELECT reason, COUNT(*) c FROM t_file_asset_migration_conflict GROUP BY reason;"
    if (-not $SkipApply) {
        throw "migration blocked: $blocking conflict(s)"
    }
}

if ($FixSharedAvatars) {
    Write-Host "`n[1b] Fix shared avatar flags (keep min user id) — irreversible without backup"
    # 导出映射便于人工回滚
    Invoke-Mysql "SELECT id, username, avatar FROM t_user WHERE avatar IN (SELECT avatar FROM t_user WHERE avatar IS NOT NULL AND TRIM(avatar)<>'' GROUP BY avatar HAVING COUNT(*)>1) ORDER BY avatar, id;"
    Invoke-Mysql @"
UPDATE t_user u
JOIN (
  SELECT avatar, MIN(id) AS keep_id
  FROM t_user
  WHERE avatar IS NOT NULL AND TRIM(avatar) <> '' AND CHAR_LENGTH(TRIM(avatar)) BETWEEN 8 AND 64
  GROUP BY avatar
  HAVING COUNT(*) > 1
) d ON d.avatar = u.avatar
SET u.avatar = NULL
WHERE u.id <> d.keep_id;
"@
    Write-Host "Re-precheck after fix:"
    Invoke-MysqlFile (Join-Path $root "docs\sql\2026-07-21-file-asset-migrate-precheck.sql")
    $blocking = Invoke-MysqlScalar "SELECT COUNT(*) FROM t_file_asset_migration_conflict WHERE reason IN ('MULTI_BUSINESS','BUSINESS_BIND_MISMATCH','SOFT_DELETED_AMBIGUOUS','SOFT_DELETED_EXISTS');"
    Write-Host "blocking_after_fix=$blocking"
    if ($blocking -gt 0 -and -not $SkipApply) {
        throw "migration still blocked after FixSharedAvatars: $blocking"
    }
}

if (-not $SkipApply) {
    Write-Host "`n[2] LOAD APPLY PROCEDURE"
    Invoke-MysqlFile (Join-Path $root "docs\sql\2026-07-21-file-asset-migrate-apply.sql")
    $runId = Get-Date -Format "yyyyMMddHHmmss"
    Write-Host "[2b] CALL sp_file_asset_migrate_apply('$runId')"
    try {
        Invoke-Mysql "CALL sp_file_asset_migrate_apply('$runId');"
    } catch {
        Write-Host "APPLY FAILED: $_" -ForegroundColor Red
        Invoke-Mysql "SELECT reason, COUNT(*) c FROM t_file_asset_migration_conflict WHERE run_id='$runId' GROUP BY reason;"
        throw
    }
    Write-Host "Idempotent second CALL:"
    Invoke-Mysql "CALL sp_file_asset_migrate_apply('${runId}-2');"
}

Write-Host "`n[3] BACKFILL stored_name from disk"
$dirs = @($UploadDir, $LegacyDir, $repoUpload) | Where-Object { $_ -and (Test-Path $_) }
$flagToFiles = @{}
foreach ($d in $dirs) {
    Get-ChildItem -File $d -ErrorAction SilentlyContinue | ForEach-Object {
        $name = $_.Name
        if ($name -match '^([a-zA-Z0-9]{8,64})-') {
            $flag = $Matches[1]
            if (-not $flagToFiles.ContainsKey($flag)) {
                $flagToFiles[$flag] = New-Object System.Collections.Generic.List[string]
            }
            if (-not $flagToFiles[$flag].Contains($name)) {
                $flagToFiles[$flag].Add($name) | Out-Null
            }
        }
    }
}
Write-Host ("Disk flags parsed: {0}" -f $flagToFiles.Count)

$meta = Invoke-Mysql "SELECT flag, stored_name FROM t_file_asset WHERE deleted=0;"
# skip header lines - use batch update via temp SQL
$updates = New-Object System.Collections.Generic.List[string]
$matched = 0
$missing = 0
$ambiguous = 0
$prev = $ErrorActionPreference
$ErrorActionPreference = "Continue"
$flags = & $Mysql "-u$User" "-p$Password" $Database -N -B -e "SELECT flag, IFNULL(stored_name,'') FROM t_file_asset WHERE deleted=0;" 2>&1 |
    Where-Object { $_ -and ($_ -notmatch "Using a password") -and ($_ -notmatch "Warning") }
$ErrorActionPreference = $prev
foreach ($line in $flags) {
    if (-not $line) { continue }
    $parts = "$line" -split "`t"
    if ($parts.Count -lt 1) { continue }
    $flag = $parts[0].Trim()
    if ($flag -notmatch '^[a-zA-Z0-9]{8,64}$' -and $flag -ne 'flag_loop_ok') { continue }
    $stored = if ($parts.Count -gt 1) { $parts[1].Trim() } else { "" }
    if (-not $flagToFiles.ContainsKey($flag) -or $flagToFiles[$flag].Count -eq 0) {
        $missing++
        continue
    }
    if ($flagToFiles[$flag].Count -gt 1) {
        $ambiguous++
        Write-Host ("AMBIGUOUS flag={0} files={1}" -f $flag, ($flagToFiles[$flag] -join ','))
        continue
    }
    $real = $flagToFiles[$flag][0]
    if ($stored -ne $real) {
        $safe = $real.Replace("'", "''")
        $updates.Add("UPDATE t_file_asset SET stored_name='$safe' WHERE flag='$flag' AND deleted=0;")
    }
    $matched++
}
if ($ambiguous -gt 0) {
    throw "backfill blocked: $ambiguous ambiguous flag(s) with multiple physical files"
}
if ($updates.Count -gt 0) {
    $sqlFile = Join-Path $env:TEMP "file_asset_backfill.sql"
    # UTF8 without BOM for mysql
    [System.IO.File]::WriteAllLines($sqlFile, $updates, [System.Text.UTF8Encoding]::new($false))
    $src = ($sqlFile -replace '\\', '/')
    Invoke-Mysql "source $src"
}
Write-Host ("Backfill candidates matched={0} missing_disk={1} ambiguous={2} updates={3}" -f $matched, $missing, $ambiguous, $updates.Count)

Write-Host "`n[4] SUMMARY"
Invoke-Mysql @"
SELECT purpose, visibility, COUNT(*) c FROM t_file_asset WHERE deleted=0 GROUP BY purpose, visibility;
SELECT
  SUM(stored_name LIKE '%-legacy') AS still_legacy,
  SUM(stored_name NOT LIKE '%-legacy') AS real_names,
  COUNT(*) AS total
FROM t_file_asset WHERE deleted=0;
"@
Write-Host "Done."
