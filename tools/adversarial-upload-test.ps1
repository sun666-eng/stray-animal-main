# 对抗：上传目录绝对路径 + 上传后可按 flag 读回 + meta 记录
param(
  [string]$BaseUrl = "http://localhost:9999",
  [string]$Root = "D:\Documents\日期归档\2026\2026.4.7\Myproject\stray-animal-main",
  [string]$Mysql = "D:\MySQL\MySQL Server 8.0\bin\mysql.exe"
)

$ErrorActionPreference = "Continue"
$fail = 0
function Pass($n, $ok, $d) {
  if ($ok) { Write-Host "[PASS] $n :: $d" -ForegroundColor Green }
  else { Write-Host "[FAIL] $n :: $d" -ForegroundColor Red; $script:fail++ }
}

function EnsureApp {
  try {
    Invoke-WebRequest -Uri "$BaseUrl/api/dashboard/public-stats" -UseBasicParsing -TimeoutSec 3 | Out-Null
    return
  } catch {}
  $conns = Get-NetTCPConnection -LocalPort 9999 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique
  foreach ($procId in $conns) { if ($procId) { Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue } }
  Start-Sleep 2
  $env:JWT_SECRET = "dev-local-jwt-secret-change-me-32chars-min"
  $env:DB_PASSWORD = "123456"
  Start-Process -FilePath "mvn" -ArgumentList "-q","-DskipTests","spring-boot:run" -WorkingDirectory $Root -WindowStyle Hidden
  for ($i = 0; $i -lt 40; $i++) {
    Start-Sleep 2
    try { Invoke-WebRequest -Uri "$BaseUrl/api/dashboard/public-stats" -UseBasicParsing -TimeoutSec 2 | Out-Null; return } catch {}
  }
}

EnsureApp

Write-Host "=== 1) meta 中的 upload_root ===" -ForegroundColor Cyan
$meta = & $Mysql -uroot -p123456 -N -e "USE test; SELECT meta_value FROM app_schema_meta WHERE meta_key='upload_root';" 2>&1 |
  Where-Object { $_ -notmatch 'Using a password' }
$meta = ($meta | Out-String).Trim()
Pass "upload_root 已写入" ($meta.Length -gt 3) "meta=$meta"
Pass "upload_root 为绝对路径" ($meta -match '^[A-Za-z]:\\' -or $meta.StartsWith('/') -or $meta -match '^[A-Za-z]:/') "meta=$meta"
Pass "upload_root 含 stray-animal 或自定义" ($meta -match 'stray-animal|upload' -or $meta.Length -gt 5) "ok"

Write-Host "=== 2) 登录并上传 ===" -ForegroundColor Cyan
$s = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$login = Invoke-RestMethod -Uri "$BaseUrl/api/user/login" -Method POST -ContentType "application/json" `
  -Body '{"username":"jerry","password":"123456"}' -WebSession $s
$token = $login.data.token
Pass "登录" ($login.code -eq "0" -and $token) "ok"

$pngPath = Join-Path $env:TEMP "adv-upload.png"
# minimal 1x1 png
[IO.File]::WriteAllBytes($pngPath, [Convert]::FromBase64String(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="))

$form = @{
  file = Get-Item $pngPath
}
try {
  $resp = Invoke-RestMethod -Uri "$BaseUrl/api/files/upload" -Method POST -WebSession $s -Form $form
  # PowerShell 5 may not support -Form; fallback curl
} catch {
  $resp = $null
}
if (-not $resp) {
  $cookie = Join-Path $env:TEMP "adv-up-cookie.txt"
  # login cookie jar
  curl.exe -s -c $cookie -b $cookie -H "Content-Type: application/json" -d "{\"username\":\"jerry\",\"password\":\"123456\"}" "$BaseUrl/api/user/login" | Out-Null
  $raw = curl.exe -s -b $cookie -H "Authorization: Bearer $token" -F "file=@$pngPath" "$BaseUrl/api/files/upload"
  $resp = $raw | ConvertFrom-Json
}
Pass "上传成功" ($resp.code -eq "0" -and $resp.data.flag) "flag=$($resp.data.flag)"
$flag = $resp.data.flag

Write-Host "=== 3) 磁盘上文件存在于绝对目录 ===" -ForegroundColor Cyan
$found = $false
if ($meta -and (Test-Path $meta)) {
  $hit = Get-ChildItem -Path $meta -Filter "$flag-*" -ErrorAction SilentlyContinue | Select-Object -First 1
  $found = $null -ne $hit
  Pass "落盘在 upload_root" $found "file=$($hit.FullName)"
} else {
  Pass "落盘在 upload_root" $false "meta path missing: $meta"
}

Write-Host "=== 4) 按 flag 读回 ===" -ForegroundColor Cyan
try {
  $get = Invoke-WebRequest -Uri "$BaseUrl/api/files/$flag" -UseBasicParsing -WebSession $s
  Pass "读回 HTTP 200" ($get.StatusCode -eq 200 -and $get.RawContentLength -gt 10) "len=$($get.RawContentLength)"
} catch {
  Pass "读回 HTTP 200" $false $_.Exception.Message
}

Write-Host "=== DONE fail=$fail ===" -ForegroundColor Cyan
if ($fail -gt 0) { exit 1 } else { exit 0 }
