# 列出磁盘孤儿文件（有 flag 前缀但无 active 元数据）与缺失文件
param(
    [string]$Mysql = "D:\MySQL\MySQL Server 8.0\bin\mysql.exe",
    [string]$User = "root",
    [string]$Password = "123456",
    [string]$Database = "test",
    [string]$OutCsv = ""
)
$ErrorActionPreference = "Continue"
$root = Split-Path -Parent $PSScriptRoot
$dirs = @(
    (Join-Path $env:USERPROFILE ".stray-animal\upload"),
    (Join-Path $root "legacy-uploads"),
    (Join-Path $root "upload")
) | Where-Object { Test-Path $_ }

$metaFlags = @{}
$lines = & $Mysql "-u$User" "-p$Password" $Database -N -B -e "SELECT flag FROM t_file_asset WHERE deleted=0" 2>&1 |
    Where-Object { $_ -and ($_ -notmatch "password") }
foreach ($f in $lines) { $metaFlags["$f".Trim()] = $true }

$rows = New-Object System.Collections.Generic.List[object]
foreach ($d in $dirs) {
    Get-ChildItem -File $d | ForEach-Object {
        if ($_.Name -match '^([a-zA-Z0-9]{8,64})-') {
            $flag = $Matches[1]
            if (-not $metaFlags.ContainsKey($flag)) {
                $rows.Add([pscustomobject]@{
                    Kind = "orphan_physical"
                    Flag = $flag
                    File = $_.Name
                    Dir  = $d
                    Size = $_.Length
                }) | Out-Null
            }
        } else {
            $rows.Add([pscustomobject]@{
                Kind = "unparsed_name"
                Flag = ""
                File = $_.Name
                Dir  = $d
                Size = $_.Length
            }) | Out-Null
        }
    }
}

Write-Host ("orphan_physical={0} unparsed={1}" -f `
    @($rows | Where-Object Kind -eq 'orphan_physical').Count, `
    @($rows | Where-Object Kind -eq 'unparsed_name').Count)

if ($OutCsv) {
    $rows | Export-Csv -Path $OutCsv -NoTypeInformation -Encoding UTF8
    Write-Host "wrote $OutCsv"
} else {
    $rows | Select-Object -First 30 | Format-Table -AutoSize
    if ($rows.Count -gt 30) { Write-Host "... total $($rows.Count) rows; use -OutCsv to export" }
}
