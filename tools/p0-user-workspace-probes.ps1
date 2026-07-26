# P0: 登录后用户功能可达性对抗探针
# 验证：普通用户默认首页、服务入口静态存在、member API 可用、管理员分流、redirect 安全
param(
  [string]$BaseUrl = "http://localhost:9999",
  [string]$UserName = "jerry",
  [string]$UserPass = "123456",
  [string]$AdminName = "admin",
  [string]$AdminPass = "admin"
)

$ErrorActionPreference = "Stop"
$pass = 0; $fail = 0; $skip = 0
function Pass($n, $ok, $detail) {
  if ($ok) { Write-Host "PASS  $n  $detail"; $script:pass++ }
  else { Write-Host "FAIL  $n  $detail"; $script:fail++ }
}
function Skip($n, $detail) { Write-Host "SKIP  $n  $detail"; $script:skip++ }

function Login($user, $pass) {
  $s = New-Object Microsoft.PowerShell.Commands.WebRequestSession
  $body = (@{ username = $user; password = $pass } | ConvertTo-Json -Compress)
  $r = Invoke-WebRequest -Uri "$BaseUrl/api/user/login" -Method POST -Body $body `
    -ContentType "application/json; charset=utf-8" -WebSession $s -UseBasicParsing
  $j = $r.Content | ConvertFrom-Json
  $flags = @()
  if ($j.data.user.permission) {
    $flags = @($j.data.user.permission | ForEach-Object { $_.flag })
  }
  return @{ Session = $s; Json = $j; User = $j.data.user; Flags = $flags }
}

$adminFlags = @('user','role','permission','animal','adopt','proof','visit','volunteer','account','notice','help','rescue')
$userLoopFlags = @('im','adopt_view','my_adopt','my_proof','apply')
# 匿名可访问的公开页（member 页需登录，在 jerry session 段验证）
$publicPages = @(
  '/page/front/animal_browse.html',
  '/page/front/notice_list.html',
  '/page/front/account_public.html',
  '/page/front/index.html',
  '/js/user-workspace.js',
  '/js/front-nav.js'
)

Write-Host "=== Static assets (public) ==="
foreach ($p in $publicPages) {
  try {
    $r = Invoke-WebRequest -Uri "$BaseUrl$p" -Method GET -UseBasicParsing
    Pass "static $p" ($r.StatusCode -eq 200 -and $r.Content.Length -gt 50 -and $r.Content -notmatch '登录 · 归途计划') "len=$($r.Content.Length)"
  } catch {
    Pass "static $p" $false $_.Exception.Message
  }
}

$uw = (Invoke-WebRequest -Uri "$BaseUrl/js/user-workspace.js" -UseBasicParsing).Content
Pass "UserWorkspace.defaultHome" ($uw -match 'defaultHome' -and $uw -match '/page/front/index.html' -and $uw -match '/page/end/index.html') "has both homes"
Pass "UserWorkspace.USER_SERVICES" ($uw -match 'my_adopt' -and $uw -match 'rescue_apply' -and $uw -match 'volunteer_apply') "core services"
Pass "UserWorkspace.hasAdminAccess" ($uw -match 'hasAdminAccess' -and $uw -match 'ADMIN_FLAGS') "admin gate"

$loginHtml = (Invoke-WebRequest -Uri "$BaseUrl/page/front/login.html" -UseBasicParsing).Content
Pass "login loads user-workspace" ($loginHtml -match 'user-workspace\.js') "script tag"
Pass "login uses defaultHome" ($loginHtml -match 'defaultHome\(user\)' -or $loginHtml -match 'UserWorkspace\.defaultHome') "redirect helper"
Pass "login blocks open redirect" ($loginHtml -match "indexOf\('\\\\'\)" -or $loginHtml -match "raw\.indexOf") "backslash/path guard"

$frontIndex = (Invoke-WebRequest -Uri "$BaseUrl/page/front/index.html" -UseBasicParsing).Content
Pass "front index member hub" ($frontIndex -match 'ui-service-grid' -and $frontIndex -match 'UserWorkspace' -and $frontIndex -match 'memberServicesTitle') "service grid"
Pass "front index account menu" ($frontIndex -match 'my_adopt' -and $frontIndex -match 'logout') "account actions"

$frontNav = (Invoke-WebRequest -Uri "$BaseUrl/js/front-nav.js" -UseBasicParsing).Content
Pass "front-nav role home" ($frontNav -match 'MEMBER_HOME' -and $frontNav -match 'resolveHome' -and $frontNav -match '/page/front/index.html') "not forced to end/index only"

Write-Host "`n=== jerry (ordinary/badge user) login ==="
try {
  $j = Login $UserName $UserPass
  Pass "jerry login" ($j.Json.code -eq '0' -and $j.User) "user=$($j.User.username)"
  $hasAdmin = $false
  foreach ($f in $j.Flags) { if ($adminFlags -contains $f) { $hasAdmin = $true } }
  Pass "jerry no admin flags" (-not $hasAdmin) "flags=$($j.Flags -join ',')"
  $missingLoop = @($userLoopFlags | Where-Object { $j.Flags -notcontains $_ })
  Pass "jerry has user-loop flags" ($missingLoop.Count -eq 0) "missing=$($missingLoop -join ','); flags=$($j.Flags -join ',')"

  $expectedHome = if ($hasAdmin) { '/page/end/index.html' } else { '/page/front/index.html' }
  Pass "jerry defaultHome=front" ($expectedHome -eq '/page/front/index.html') $expectedHome

  $apis = @(
    @{ Name='my adopt page2'; Url='/api/adopt/page2?pageNum=1&pageSize=5' },
    @{ Name='my volunteer mine'; Url='/api/volunteer/mine?pageNum=1&pageSize=5' },
    @{ Name='my rescue mine'; Url='/api/help/mine?pageNum=1&pageSize=5' },
    @{ Name='my visit mine'; Url='/api/visit/mine?pageNum=1&pageSize=5' },
    @{ Name='my proof page1'; Url='/api/proof/page1?pageNum=1&pageSize=5' },
    @{ Name='me'; Url='/api/user/me' },
    @{ Name='public animals'; Url='/api/animal/page1?pageNum=1&pageSize=3' },
    @{ Name='notices'; Url='/api/notice/page?pageNum=1&pageSize=3' }
  )
  foreach ($a in $apis) {
    try {
      $r = Invoke-WebRequest -Uri "$BaseUrl$($a.Url)" -WebSession $j.Session -UseBasicParsing
      $body = $r.Content | ConvertFrom-Json
      Pass "jerry API $($a.Name)" ($body.code -eq '0') "code=$($body.code) msg=$($body.msg)"
    } catch {
      $code = $_.Exception.Response.StatusCode.value__
      Pass "jerry API $($a.Name)" $false "http=$code $($_.Exception.Message)"
    }
  }

  try {
    $r = Invoke-WebRequest -Uri "$BaseUrl/api/user/page?pageNum=1&pageSize=5" -WebSession $j.Session -UseBasicParsing
    $body = $r.Content | ConvertFrom-Json
    Pass "jerry blocked admin user/page" ($body.code -ne '0' -or $r.StatusCode -ge 400) "code=$($body.code)"
  } catch {
    $code = $_.Exception.Response.StatusCode.value__
    Pass "jerry blocked admin user/page" ($code -eq 401 -or $code -eq 403) "http=$code"
  }

  foreach ($p in @('/page/front/my_adopt.html','/page/front/my_rescue.html','/page/front/my_volunteer.html','/page/front/rescue_apply.html')) {
    $r = Invoke-WebRequest -Uri "$BaseUrl$p" -WebSession $j.Session -UseBasicParsing
    Pass "jerry page $p" ($r.StatusCode -eq 200 -and $r.Content -match 'AuthSession|requireAuth') "auth bootstrap present"
  }

  # 普通用户可打开 end/index：无管理菜单时应渲染 userServices 兜底
  $endAsUser = Invoke-WebRequest -Uri "$BaseUrl/page/end/index.html" -WebSession $j.Session -UseBasicParsing
  Pass "jerry can open end/index" ($endAsUser.StatusCode -eq 200 -and $endAsUser.Content -match 'userServices' -and $endAsUser.Content -match 'UserWorkspace') "user hub fallback"
  Pass "jerry end/index not login page" ($endAsUser.Content -notmatch '登录 · 归途计划') "authenticated content"
} catch {
  Pass "jerry login" $false $_.Exception.Message
}

Write-Host "`n=== admin login ==="
try {
  $a = Login $AdminName $AdminPass
  Pass "admin login" ($a.Json.code -eq '0' -and $a.User) "user=$($a.User.username)"
  $hasAdmin = $false
  foreach ($f in $a.Flags) { if ($adminFlags -contains $f) { $hasAdmin = $true } }
  Pass "admin has admin flags" $hasAdmin "flags count=$($a.Flags.Count)"
  $expectedHome = if ($hasAdmin) { '/page/end/index.html' } else { '/page/front/index.html' }
  Pass "admin defaultHome=end" ($expectedHome -eq '/page/end/index.html') $expectedHome

  $endAsAdmin = Invoke-WebRequest -Uri "$BaseUrl/page/end/index.html" -WebSession $a.Session -UseBasicParsing
  Pass "admin end/index menuItems" ($endAsAdmin.Content -match 'menuItems' -and $endAsAdmin.Content -match 'userServices' -and $endAsAdmin.Content -match 'AdminWorkspace') "admin workspace shell"
  $person = Invoke-WebRequest -Uri "$BaseUrl/page/end/person.html" -WebSession $a.Session -UseBasicParsing
  Pass "admin person page" ($person.StatusCode -eq 200 -and $person.Content -notmatch '登录 · 归途计划') "profile reachable"
} catch {
  Pass "admin login" $false $_.Exception.Message
}

Write-Host "`n=== Adversarial: open-redirect allowlist ==="
Pass "login adminPaths gated" ($loginHtml -match 'adminPaths' -and $loginHtml -match 'hasAdminAccess') "admin redirect gated"
Pass "login memberPaths include front services" ($loginHtml -match 'my_adopt.html' -and $loginHtml -match 'rescue_apply.html') "member allowlist"

Write-Host "`n=== Summary: PASS=$pass FAIL=$fail SKIP=$skip ==="
if ($fail -gt 0) { exit 1 } else { exit 0 }
