# 历史文件元数据迁移辅助：扫描 upload/ 与 legacy-uploads/，对照业务 flag，输出报告（不写库）
# 用法: powershell -ExecutionPolicy Bypass -File tools/migrate-file-asset-report.ps1

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$uploadDir = Join-Path $root "upload"
$legacyDir = Join-Path $root "legacy-uploads"

function Get-FlagsFromDir([string]$dir) {
    if (-not (Test-Path $dir)) { return @() }
    Get-ChildItem -File $dir | ForEach-Object {
        $name = $_.Name
        if ($name -match '^([a-fA-F0-9\-]{8,64})-') {
            [PSCustomObject]@{ Flag = $Matches[1]; File = $name; Dir = $dir }
        } elseif ($name -match '^(avatar-\d+)') {
            [PSCustomObject]@{ Flag = $Matches[1]; File = $name; Dir = $dir }
        } else {
            [PSCustomObject]@{ Flag = $null; File = $name; Dir = $dir }
        }
    }
}

$items = @()
$items += Get-FlagsFromDir $uploadDir
$items += Get-FlagsFromDir $legacyDir

$withFlag = $items | Where-Object { $_.Flag }
$noFlag = $items | Where-Object { -not $_.Flag }

Write-Host "=== File Asset Migration Report ==="
Write-Host "upload dir   : $uploadDir"
Write-Host "legacy dir   : $legacyDir"
Write-Host "total files  : $($items.Count)"
Write-Host "parseable flag: $($withFlag.Count)"
Write-Host "unparsed     : $($noFlag.Count)"
Write-Host ""
Write-Host "--- Sample parseable (first 20) ---"
$withFlag | Select-Object -First 20 | ForEach-Object { Write-Host ("{0}`t{1}" -f $_.Flag, $_.File) }
if ($noFlag.Count -gt 0) {
    Write-Host ""
    Write-Host "--- Unparsed names (first 20; need manual mapping) ---"
    $noFlag | Select-Object -First 20 | ForEach-Object { Write-Host $_.File }
}
Write-Host ""
Write-Host "Next: run docs/sql/2026-07-21-file-asset.sql then 2026-07-21-file-asset-migrate-legacy.sql on MySQL"
Write-Host "Then verify: SELECT purpose, COUNT(*) FROM t_file_asset GROUP BY purpose;"
