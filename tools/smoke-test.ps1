# 5 分钟冒烟：部署后跑一遍，快速发现环境/权限/主闭环断裂
# 用法（项目根目录）:
#   powershell -ExecutionPolicy Bypass -File tools/smoke-test.ps1
#   powershell -File tools/smoke-test.ps1 -BaseUrl http://localhost:9999 -UserPass 123456

param(
  [string]$BaseUrl = "http://localhost:9999",
  [string]$AdminUser = "admin",
  [string]$AdminPass = "admin",
  [string]$UserName = "jerry",
  [string]$UserPass = "123456"
)

$ErrorActionPreference = "Continue"
$fail = 0

function Pass($name, $ok, $detail) {
  if ($ok) { Write-Host "[PASS] $name :: $detail" -ForegroundColor Green }
  else { Write-Host "[FAIL] $name :: $detail" -ForegroundColor Red; $script:fail++ }
}

function Login($user, $pass) {
  $s = New-Object Microsoft.PowerShell.Commands.WebRequestSession
  $body = @{ username = $user; password = $pass } | ConvertTo-Json
  $r = Invoke-RestMethod -Uri "$BaseUrl/api/user/login" -Method POST -ContentType "application/json" -Body $body -WebSession $s
  return @{ session = $s; data = $r }
}

Write-Host "=== Smoke against $BaseUrl ===" -ForegroundColor Cyan

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
  $u = Login $UserName $UserPass
  $flags = @($u.data.data.user.permission | ForEach-Object { $_.flag })
  Pass "普通用户登录" ($u.data.code -eq "0") "flags=$($flags -join ',')"
  $adminLeak = $flags | Where-Object { $_ -in @("user","role","animal","adopt","proof","visit","volunteer","account","notice","help") }
  Pass "普通用户无后台大权" ($adminLeak.Count -eq 0) "leaked=$($adminLeak -join ',')"

  $help = Invoke-WebRequest -Uri "$BaseUrl/api/help" -Method POST -ContentType "application/json" -WebSession $u.session `
    -Body (@{ title = "smoke-$(Get-Random)"; description = "d"; location = "l"; phone = "1" } | ConvertTo-Json) -UseBasicParsing
  $hj = $help.Content | ConvertFrom-Json
  Pass "用户提交救助" ($hj.code -eq "0") "code=$($hj.code) msg=$($hj.msg)"

  $uid = $u.data.data.user.id
  $mine = Invoke-RestMethod -Uri "$BaseUrl/api/help/mine?uid=$uid" -WebSession $u.session
  Pass "我的救助" ($mine.code -eq "0") "count=$(@($mine.data).Count)"

  try {
    $idor = Invoke-WebRequest -Uri "$BaseUrl/api/adopt/page2?pageNum=1&pageSize=1&uid=1&name=" -WebSession $u.session -UseBasicParsing
    $ij = $idor.Content | ConvertFrom-Json
    Pass "防越权-他人领养" ($ij.code -eq "403") "code=$($ij.code)"
  } catch {
    $msg = $_.ErrorDetails.Message
    Pass "防越权-他人领养" ($msg -match "403") $msg
  }
} catch {
  Pass "普通用户链路" $false $_.Exception.Message
}

try {
  $a = Login $AdminUser $AdminPass
  Pass "管理员登录" ($a.data.code -eq "0") "ok"
  $proof = Invoke-RestMethod -Uri "$BaseUrl/api/proof/page?pageNum=1&pageSize=1&name=" -WebSession $a.session
  Pass "凭证列表(pstatus列)" ($proof.code -eq "0") "code=$($proof.code) msg=$($proof.msg)"
  $vol = Invoke-RestMethod -Uri "$BaseUrl/api/volunteer/page?pageNum=1&pageSize=1&name=" -WebSession $a.session
  Pass "义工列表" ($vol.code -eq "0") "ok"
} catch {
  Pass "管理员链路" $false $_.Exception.Message
}

Write-Host "=== DONE fail=$fail ===" -ForegroundColor Cyan
if ($fail -gt 0) { exit 1 } else { exit 0 }
