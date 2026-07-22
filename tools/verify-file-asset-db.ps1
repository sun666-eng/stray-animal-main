# 严格文件元数据 + 磁盘联合校验（M2 门禁）
param(
    [string]$Mysql = "D:\MySQL\MySQL Server 8.0\bin\mysql.exe",
    [string]$User = "root",
    [string]$Password = "123456",
    [string]$Database = "test",
    [string]$UploadDir = "",
    [string]$LegacyDir = "",
    [switch]$AllowOrphans
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
if (-not $UploadDir) { $UploadDir = Join-Path $env:USERPROFILE ".stray-animal\upload" }
if (-not $LegacyDir) { $LegacyDir = Join-Path $root "legacy-uploads" }
$repoUpload = Join-Path $root "upload"

function Q([string]$sql) {
    $prev = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    $out = & $Mysql "-u$User" "-p$Password" $Database -N -B -e $sql 2>&1 |
        Where-Object { $_ -and ($_ -notmatch "Using a password") }
    $ErrorActionPreference = $prev
    if ($LASTEXITCODE -ne 0) { throw "mysql failed: $sql / $out" }
    return ($out | Out-String).Trim()
}

Write-Host "=== verify-file-asset-db STRICT ==="

# --- disk index: flag -> files[] ---
$dirs = @($UploadDir, $LegacyDir, $repoUpload) | Where-Object { $_ -and (Test-Path $_) }
$flagFiles = @{}
$allPhysical = New-Object System.Collections.Generic.List[string]
foreach ($d in $dirs) {
    Get-ChildItem -File $d -ErrorAction SilentlyContinue | ForEach-Object {
        $allPhysical.Add($_.FullName) | Out-Null
        if ($_.Name -match '^([a-zA-Z0-9]{8,64})-') {
            $flag = $Matches[1]
            if (-not $flagFiles.ContainsKey($flag)) { $flagFiles[$flag] = New-Object System.Collections.Generic.List[string] }
            $flagFiles[$flag].Add($_.Name) | Out-Null
        }
    }
}

$activeMetadataCount = [int](Q "SELECT COUNT(*) FROM t_file_asset WHERE deleted=0")
$legacyPendingCount = [int](Q "SELECT COUNT(*) FROM t_file_asset WHERE deleted=0 AND (stored_name IS NULL OR stored_name='' OR stored_name LIKE '%-legacy')")
$duplicateStoredNameCount = [int](Q "SELECT COUNT(*) FROM (SELECT stored_name, COUNT(*) c FROM t_file_asset WHERE deleted=0 AND stored_name IS NOT NULL AND stored_name<>'' GROUP BY stored_name HAVING c>1) t")

# load meta rows
$metaLines = Q "SELECT flag, IFNULL(stored_name,''), purpose, visibility FROM t_file_asset WHERE deleted=0"
$metadataMissingFileCount = 0
$uniquePhysicalMatchCount = 0
$ambiguousFlagCount = 0
$missingDetails = New-Object System.Collections.Generic.List[string]

foreach ($line in ($metaLines -split "`n")) {
    $line = $line.Trim()
    if (-not $line) { continue }
    $p = $line -split "`t"
    if ($p.Count -lt 2) { continue }
    $flag = $p[0].Trim()
    $stored = $p[1].Trim()
    $found = $false
    # exact stored_name in any dir
    if ($stored -and $stored -notlike '*-legacy') {
        foreach ($d in $dirs) {
            $path = Join-Path $d $stored
            if (Test-Path -LiteralPath $path -PathType Leaf) { $found = $true; break }
        }
    }
    # candidate count for flag
    $cands = if ($flagFiles.ContainsKey($flag)) { $flagFiles[$flag].Count } else { 0 }
    if ($cands -gt 1) { $ambiguousFlagCount++ }
    if (-not $found) {
        if ($cands -eq 1 -and ($stored -like '*-legacy' -or -not $stored)) {
            # legacy recoverable — still count as pending if name is legacy
            if ($stored -like '*-legacy' -or -not $stored) {
                # treat as missing for strict mode if still legacy
                $metadataMissingFileCount++
                $missingDetails.Add("$flag stored=$stored cands=$cands") | Out-Null
            }
        } else {
            $metadataMissingFileCount++
            $missingDetails.Add("$flag stored=$stored cands=$cands") | Out-Null
        }
    } else {
        $uniquePhysicalMatchCount++
    }
}

# business refs without meta
function BizMissing([string]$sql) {
    return [int](Q $sql)
}
$bizMissing = 0
# 用 CONVERT 避免 utf8mb3/utf8mb4 collation 冲突
$bizMissing += BizMissing @"
SELECT COUNT(*) FROM t_animal a
LEFT JOIN t_file_asset f ON CONVERT(f.flag USING utf8mb4)=CONVERT(a.tpic USING utf8mb4) AND f.deleted=0
WHERE a.tpic IS NOT NULL AND TRIM(a.tpic)<>'' AND CHAR_LENGTH(TRIM(a.tpic)) BETWEEN 8 AND 64 AND f.id IS NULL
"@
$bizMissing += BizMissing @"
SELECT COUNT(*) FROM t_user u
LEFT JOIN t_file_asset f ON CONVERT(f.flag USING utf8mb4)=CONVERT(u.avatar USING utf8mb4) AND f.deleted=0
WHERE u.avatar IS NOT NULL AND TRIM(u.avatar)<>'' AND CHAR_LENGTH(TRIM(u.avatar)) BETWEEN 8 AND 64 AND f.id IS NULL
"@
$bizMissing += BizMissing @"
SELECT COUNT(*) FROM t_proof p
LEFT JOIN t_file_asset f ON CONVERT(f.flag USING utf8mb4)=CONVERT(p.ppic USING utf8mb4) AND f.deleted=0
WHERE p.ppic IS NOT NULL AND TRIM(p.ppic)<>'' AND CHAR_LENGTH(TRIM(p.ppic)) BETWEEN 8 AND 64 AND f.id IS NULL
"@
$bizMissing += BizMissing @"
SELECT COUNT(*) FROM t_help h
LEFT JOIN t_file_asset f ON CONVERT(f.flag USING utf8mb4)=CONVERT(h.pic USING utf8mb4) AND f.deleted=0
WHERE h.pic IS NOT NULL AND TRIM(h.pic)<>'' AND CHAR_LENGTH(TRIM(h.pic)) BETWEEN 8 AND 64
  AND (h.title IS NULL OR h.title<>'聊天室消息') AND f.id IS NULL
"@
$bizMissing += BizMissing @"
SELECT COUNT(*) FROM t_visit v
LEFT JOIN t_file_asset f ON CONVERT(f.flag USING utf8mb4)=CONVERT(v.pic USING utf8mb4) AND f.deleted=0
WHERE v.pic IS NOT NULL AND TRIM(v.pic)<>'' AND CHAR_LENGTH(TRIM(v.pic)) BETWEEN 8 AND 64 AND f.id IS NULL
"@
$bizMissing += BizMissing @"
SELECT COUNT(*) FROM t_volunteer v
LEFT JOIN t_file_asset f ON CONVERT(f.flag USING utf8mb4)=CONVERT(v.apic USING utf8mb4) AND f.deleted=0
WHERE v.apic IS NOT NULL AND TRIM(v.apic)<>'' AND CHAR_LENGTH(TRIM(v.apic)) BETWEEN 8 AND 64 AND f.id IS NULL
"@

# physical orphans: files with flag prefix not in active meta
$metaFlags = @{}
foreach ($line in ($metaLines -split "`n")) {
    $line = $line.Trim(); if (-not $line) { continue }
    $f = ($line -split "`t")[0].Trim()
    $metaFlags[$f] = $true
}
$physicalOrphanCount = 0
foreach ($kv in $flagFiles.GetEnumerator()) {
    if (-not $metaFlags.ContainsKey($kv.Key)) { $physicalOrphanCount += $kv.Value.Count }
}

Write-Host "activeMetadataCount=$activeMetadataCount"
Write-Host "uniquePhysicalMatchCount=$uniquePhysicalMatchCount"
Write-Host "metadataMissingFileCount=$metadataMissingFileCount"
Write-Host "duplicateStoredNameCount=$duplicateStoredNameCount"
Write-Host "ambiguousFlagCount=$ambiguousFlagCount"
Write-Host "businessReferenceWithoutMetadataCount=$bizMissing"
Write-Host "physicalOrphanCount=$physicalOrphanCount"
Write-Host "legacyPendingCount=$legacyPendingCount"

$fail = 0
if ($metadataMissingFileCount -gt 0) { Write-Host "FAIL metadata missing file"; $fail++ }
if ($duplicateStoredNameCount -gt 0) { Write-Host "FAIL duplicate stored_name"; $fail++ }
if ($ambiguousFlagCount -gt 0) { Write-Host "FAIL ambiguous flag multi-file"; $fail++ }
if ($bizMissing -gt 0) { Write-Host "FAIL business ref without meta"; $fail++ }
if ($legacyPendingCount -gt 0) { Write-Host "FAIL legacy pending stored_name"; $fail++ }
if (-not $AllowOrphans -and $physicalOrphanCount -gt 0) {
    Write-Host "WARN physical orphans=$physicalOrphanCount (not hard-fail; use -AllowOrphans silence)"
}
if ($missingDetails.Count -gt 0) {
    Write-Host "missing samples:"
    $missingDetails | Select-Object -First 10 | ForEach-Object { Write-Host "  $_" }
}

if ($fail -gt 0) {
    Write-Host "STRICT FAIL"
    exit 1
}
Write-Host "STRICT PASS"
exit 0
