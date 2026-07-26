# 对抗：上传 + purpose 元数据 + 私有文件权限 + /file/** 旁路不应直出私有盘
param(
  [string]$BaseUrl = "http://localhost:9999",
  [string]$UserName = "jerry",
  [string]$UserPass = "123456"
)

$ErrorActionPreference = "Continue"
$fail = 0
. "$PSScriptRoot\lib-session.ps1"

function Pass($n, $ok, $d) {
  if ($ok) { Write-Host "[PASS] $n :: $d" -ForegroundColor Green }
  else { Write-Host "[FAIL] $n :: $d" -ForegroundColor Red; $script:fail++ }
}

Write-Host "=== Upload adversarial ===" -ForegroundColor Cyan

try {
  Invoke-WebRequest -Uri "$BaseUrl/api/animal/page1?pageNum=1&pageSize=1" -UseBasicParsing -TimeoutSec 3 | Out-Null
} catch {
  Write-Host "服务未启动，中止（请先 SPRING_PROFILES_ACTIVE=dev 启动）" -ForegroundColor Yellow
  exit 1
}

$s = New-AppSession -BaseUrl $BaseUrl -Username $UserName -Password $UserPass
Pass "登录" ($s.Login.code -eq "0") "ok"
Pass "会话含 csrf" ([bool]$s.Csrf) "csrf=$([bool]$s.Csrf)"

$pngPath = Join-Path $env:TEMP "adv-upload.png"
[IO.File]::WriteAllBytes($pngPath, [Convert]::FromBase64String(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="))

# curl 登录：用 body 文件避免 PS 转义问题
$cookie = Join-Path $env:TEMP "adv-up-cookie.txt"
$loginBody = Join-Path $env:TEMP "adv-up-login.json"
Remove-Item $cookie -ErrorAction SilentlyContinue
$utf8 = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText($loginBody, (@{ username = $UserName; password = $UserPass } | ConvertTo-Json -Compress), $utf8)
$loginRaw = curl.exe -s -c $cookie -b $cookie -H "Content-Type: application/json" --data-binary "@$loginBody" "$BaseUrl/api/user/login"
$loginObj = $null
try { $loginObj = $loginRaw | ConvertFrom-Json } catch {}
$csrf = if ($loginObj -and $loginObj.data) { $loginObj.data.csrfToken } else { $null }
$loginJwt = $loginObj -and $loginObj.data -and $loginObj.data.token
Pass "curl 登录拿 csrf" ([bool]$csrf -and -not $loginJwt) "csrf=$([bool]$csrf) jwt=$loginJwt"

$raw = curl.exe -s -b $cookie -H "X-CSRF-Token: $csrf" `
  -F "file=@$pngPath;type=image/png" -F "purpose=proof" "$BaseUrl/api/files/upload"
$resp = $null
try { $resp = $raw | ConvertFrom-Json } catch {}
Pass "上传 proof purpose" ($resp -and $resp.code -eq "0" -and $resp.data.flag) "flag=$(if($resp -and $resp.data){$resp.data.flag}) raw=$raw"
$flag = if ($resp -and $resp.data) { $resp.data.flag } else { $null }

$expectedHash = (Get-FileHash -Path $pngPath -Algorithm SHA256).Hash
if ($flag) {
  try {
    $anon = Invoke-WebRequest -Uri "$BaseUrl/api/files/$flag" -UseBasicParsing
    Pass "匿名读私有 proof 应拒绝" ($anon.StatusCode -eq 403) "http=$($anon.StatusCode)"
  } catch {
    $st = 0
    if ($_.Exception.Response) { $st = [int]$_.Exception.Response.StatusCode }
    Pass "匿名读私有 proof 应拒绝" ($st -eq 403) "http=$st"
  }

  $ownPath = Join-Path $env:TEMP "own-proof.bin"
  $ownCode = curl.exe -s -o $ownPath -w "%{http_code}" -b $cookie "$BaseUrl/api/files/$flag"
  $ownLen = 0
  $actualHash = ""
  if (Test-Path $ownPath) {
    $ownLen = (Get-Item $ownPath).Length
    $actualHash = (Get-FileHash -Path $ownPath -Algorithm SHA256).Hash
  }
  Pass "owner 可读且内容一致" ($ownCode -eq "200" -and $actualHash -eq $expectedHash) "http=$ownCode len=$ownLen hashMatch=$($actualHash -eq $expectedHash)"

  # /file/** 旁路：用真实 stored_name（上传格式 flag-原名）
  $storedGuess = "$flag-adv-upload.png"
  try {
    $bypass = Invoke-WebRequest -Uri "$BaseUrl/file/$storedGuess" -UseBasicParsing
    Pass "/file 旁路不直出真实文件" ($bypass.StatusCode -ne 200 -or $bypass.RawContentLength -lt 5) "http=$($bypass.StatusCode) len=$($bypass.RawContentLength)"
  } catch {
    $st = 0
    if ($_.Exception.Response) { $st = [int]$_.Exception.Response.StatusCode }
    Pass "/file 旁路不直出真实文件" ($st -ne 200) "http=$st"
  }
} else {
  Pass "匿名读私有 proof 应拒绝" $false "no flag"
  Pass "owner 可读且内容一致" $false "no flag"
  Pass "/file 旁路不直出真实文件" $false "no flag"
}

# 普通用户声明 animal 必须 403（成功即提权 FAIL）
$raw2 = curl.exe -s -b $cookie -H "X-CSRF-Token: $csrf" `
  -F "file=@$pngPath;type=image/png" -F "purpose=animal" "$BaseUrl/api/files/upload"
$resp2 = $null
try { $resp2 = $raw2 | ConvertFrom-Json } catch {}
if ($resp2 -and $resp2.code -eq "0") {
  Pass "普通用户不可声明 animal purpose" $false "SECURITY: upload succeeded code=0 flag=$(if($resp2.data){$resp2.data.flag})"
} else {
  Pass "普通用户不可声明 animal purpose" ($resp2 -and $resp2.code -eq "403") "code=$(if($resp2){$resp2.code}) raw=$raw2"
}
try {
  $pub = Invoke-WebRequest -Uri "$BaseUrl/api/files/1619999075860" -UseBasicParsing
  Pass "匿名可读已有 animal 公开图" ($pub.StatusCode -eq 200) "http=$($pub.StatusCode)"
} catch {
  Pass "匿名可读已有 animal 公开图" $false $_.Exception.Message
}

Write-Host "=== DONE fail=$fail ===" -ForegroundColor Cyan
if ($fail -gt 0) { exit 1 } else { exit 0 }
