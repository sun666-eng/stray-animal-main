# 5 分钟冒烟：部署后跑一遍，快速发现环境/权限/主闭环断裂
# 用法（项目根目录）:
#   $env:SPRING_PROFILES_ACTIVE="dev"
#   powershell -ExecutionPolicy Bypass -File tools/smoke-test.ps1
#
# 适配：Session + CSRF + HTTP 真实状态码

param(
  [string]$BaseUrl = "http://localhost:9999",
  [string]$AdminUser = "admin",
  [string]$AdminPass = "admin",
  [string]$UserName = "jerry",
  [string]$UserPass = "123456"
)

$ErrorActionPreference = "Continue"
$fail = 0
. "$PSScriptRoot\lib-session.ps1"

function Pass($name, $ok, $detail) {
  if ($ok) { Write-Host "[PASS] $name :: $detail" -ForegroundColor Green }
  else { Write-Host "[FAIL] $name :: $detail" -ForegroundColor Red; $script:fail++ }
}

Write-Host "=== Smoke against $BaseUrl ===" -ForegroundColor Cyan
Write-Host "提示: 应用须以 SPRING_PROFILES_ACTIVE=dev 启动（或 prod+JWT_SECRET）" -ForegroundColor DarkGray

try {
  $browse = Invoke-RestMethod -Uri "$BaseUrl/api/animal/page1?pageNum=1&pageSize=3"
  Pass "公开浏览动物" ($browse.code -eq "0") "total=$($browse.data.total)"
} catch {
  Pass "公开浏览动物" $false $_.Exception.Message
  Write-Host "服务可能未启动，中止。" -ForegroundColor Yellow
  exit 1
}

try {
  $n = Invoke-RestMethod -Uri "$BaseUrl/api/notice/page?pageNum=1&pageSize=1"
  Pass "公开公告" ($n.code -eq "0") "ok"
} catch { Pass "公开公告" $false $_.Exception.Message }

try {
  $pub = Invoke-RestMethod -Uri "$BaseUrl/api/account/public?pageNum=1&pageSize=5"
  $hasAll = $false
  if ($pub.data -and $pub.data.PSObject.Properties.Name -contains "allRecords") { $hasAll = $true }
  Pass "资金公示无 allRecords" ($pub.code -eq "0" -and -not $hasAll) "hasAllRecords=$hasAll"
} catch { Pass "资金公示公开" $false $_.Exception.Message }

try {
  $u = New-AppSession -BaseUrl $BaseUrl -Username $UserName -Password $UserPass
  $flags = @()
  if ($u.User -and $u.User.permission) {
    $flags = @($u.User.permission | ForEach-Object { $_.flag })
  }
  Pass "普通用户登录" ($u.Login.code -eq "0") "flags=$($flags -join ','); csrf=$([bool]$u.Csrf)"
  $adminLeak = $flags | Where-Object { $_ -in @("user","role","animal","adopt","proof","visit","volunteer","account","notice","help") }
  Pass "普通用户无后台大权" ($adminLeak.Count -eq 0) "leaked=$($adminLeak -join ',')"

  $help = Invoke-ApiJson -BaseUrl $BaseUrl -Path "/api/help" -AppSession $u -Method POST -BodyObject @{
    title = "smoke-$(Get-Random)"; description = "d"; location = "l"; phone = "1"
  }
  Pass "用户提交救助(CSRF)" ($help.Json -and $help.Json.code -eq "0") "http=$($help.StatusCode) code=$($help.Json.code) msg=$($help.Json.msg)"

  # 无 CSRF 应 403（必须清掉 Session.Headers 粘滞的 X-CSRF-Token）
  Clear-AppSessionStickyHeaders -AppSession $u
  try {
    $bad = Invoke-WebRequest -Uri "$BaseUrl/api/help" -Method POST -ContentType "application/json" `
      -WebSession $u.Session -Body '{"title":"x","description":"d","location":"l","phone":"1"}' -UseBasicParsing
    $bj = $bad.Content | ConvertFrom-Json
    Pass "无CSRF应失败" ($bj.code -eq "403" -or [int]$bad.StatusCode -eq 403) "code=$($bj.code) http=$($bad.StatusCode)"
  } catch {
    $st = 0
    $body = ""
    if ($_.Exception.Response) {
      $st = [int]$_.Exception.Response.StatusCode
      try {
        $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
        $body = $reader.ReadToEnd()
      } catch {}
    }
    Pass "无CSRF应失败" ($st -eq 403 -or $body -match '"code"\s*:\s*"403"') "http=$st body=$body"
  }

  $uid = $u.User.id
  $mine = Invoke-ApiJson -BaseUrl $BaseUrl -Path "/api/help/mine?uid=$uid" -AppSession $u -Method GET
  Pass "我的救助" ($mine.Json -and $mine.Json.code -eq "0") "count=$(@($mine.Json.data).Count)"

  $idor = Invoke-ApiJson -BaseUrl $BaseUrl -Path "/api/adopt/page2?pageNum=1&pageSize=1&uid=1&name=" -AppSession $u -Method GET
  Pass "防越权-他人领养" (($idor.Json -and $idor.Json.code -eq "403") -or $idor.StatusCode -eq 403) "code=$($idor.Json.code) http=$($idor.StatusCode)"

  $online = Invoke-ApiJson -BaseUrl $BaseUrl -Path "/api/user/online" -AppSession $u -Method GET
  Pass "普通用户不可枚举online" (($online.Json -and $online.Json.code -eq "403") -or $online.StatusCode -eq 403) "code=$($online.Json.code)"
} catch {
  Pass "普通用户链路" $false $_.Exception.Message
}

try {
  $a = New-AppSession -BaseUrl $BaseUrl -Username $AdminUser -Password $AdminPass
  Pass "管理员登录" ($a.Login.code -eq "0") "csrf=$([bool]$a.Csrf)"
  $proof = Invoke-ApiJson -BaseUrl $BaseUrl -Path "/api/proof/page?pageNum=1&pageSize=1&name=" -AppSession $a -Method GET
  Pass "凭证列表" ($proof.Json -and $proof.Json.code -eq "0") "code=$($proof.Json.code) msg=$($proof.Json.msg)"
  $vol = Invoke-ApiJson -BaseUrl $BaseUrl -Path "/api/volunteer/page?pageNum=1&pageSize=1&name=" -AppSession $a -Method GET
  Pass "义工列表" ($vol.Json -and $vol.Json.code -eq "0") "ok"

  # 登出后 /me 应失败（仅 Session）
  $lo = Invoke-ApiJson -BaseUrl $BaseUrl -Path "/api/user/logout" -AppSession $a -Method POST -BodyObject @{}
  Clear-AppSessionStickyHeaders -AppSession $a
  $meAfter = Invoke-ApiJson -BaseUrl $BaseUrl -Path "/api/user/me" -AppSession $a -Method GET
  Pass "登出后 me 失败" (($meAfter.Json -and $meAfter.Json.code -ne "0") -or $meAfter.StatusCode -eq 401) "http=$($meAfter.StatusCode) code=$($meAfter.Json.code)"
  $loginHasJwt = $a.Login.data -and ($a.Login.data.PSObject.Properties.Name -contains "token") -and $a.Login.data.token
  Pass "登录响应无 JWT" (-not $loginHasJwt) "hasToken=$loginHasJwt"
} catch {
  Pass "管理员链路" $false $_.Exception.Message
}

Write-Host "=== DONE fail=$fail ===" -ForegroundColor Cyan
if ($fail -gt 0) { exit 1 } else { exit 0 }
