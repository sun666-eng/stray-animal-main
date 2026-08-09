param(
    [string]$BaseUrl = "http://localhost:10001",
    [string]$UserName = "jerry",
    [string]$UserPass = "123456",
    [string]$AdminName = "admin",
    [string]$AdminPass = "admin",
    [switch]$SkipHttp
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$staticRoot = Join-Path $root "src/main/resources/static"
$failed = 0
$passed = 0

$pages = @(
    @{ Path = "page/front/index.html"; Public = $true; Form = $false },
    @{ Path = "page/front/animal_browse.html"; Public = $true; Form = $false },
    @{ Path = "page/front/animal_detail.html"; Public = $true; Form = $false },
    @{ Path = "page/front/login.html"; Public = $true; Form = $true },
    @{ Path = "page/front/register.html"; Public = $true; Form = $true },
    @{ Path = "page/front/notice_list.html"; Public = $true; Form = $false },
    @{ Path = "page/front/notice_detail.html"; Public = $true; Form = $false },
    @{ Path = "page/front/account_public.html"; Public = $true; Form = $false },
    @{ Path = "page/front/adopt_apply.html"; Public = $false; Form = $true },
    @{ Path = "page/front/my_adopt.html"; Public = $false; Form = $false },
    @{ Path = "page/front/notifications.html"; Public = $false; Form = $false },
    @{ Path = "page/front/adopt_proof.html"; Public = $false; Form = $true },
    @{ Path = "page/front/my_visit.html"; Public = $false; Form = $false },
    @{ Path = "page/front/volunteer_apply.html"; Public = $false; Form = $true },
    @{ Path = "page/front/my_volunteer.html"; Public = $false; Form = $false },
    @{ Path = "page/front/volunteer_tasks.html"; Public = $false; Form = $false },
    @{ Path = "page/front/favorites.html"; Public = $false; Form = $false },
    @{ Path = "page/front/rescue_apply.html"; Public = $false; Form = $true },
    @{ Path = "page/front/my_rescue.html"; Public = $false; Form = $false },
    @{ Path = "page/front/pet_care.html"; Public = $false; Form = $true },
    @{ Path = "page/end/index.html"; Public = $false; Form = $false; Workspace = $true },
    @{ Path = "page/end/person.html"; Public = $false; Form = $true; Workspace = $true },
    @{ Path = "page/end/user.html"; Public = $false; Form = $true; Workspace = $true },
    @{ Path = "page/end/role.html"; Public = $false; Form = $true; Workspace = $true },
    @{ Path = "page/end/permission.html"; Public = $false; Form = $true; Workspace = $true },
    @{ Path = "page/end/volunteer.html"; Public = $false; Form = $true; Workspace = $true },
    @{ Path = "page/end/help.html"; Public = $false; Form = $true; Workspace = $true }
    @{ Path = "page/end/animal.html"; Public = $false; Form = $true; Workspace = $true }
    @{ Path = "page/end/notice.html"; Public = $false; Form = $true; Workspace = $true }
    @{ Path = "page/end/account.html"; Public = $false; Form = $true; Workspace = $true }
    @{ Path = "page/end/adopt.html"; Public = $false; Form = $true; Workspace = $true }
    @{ Path = "page/end/proof.html"; Public = $false; Form = $true; Workspace = $true }
    @{ Path = "page/end/visit.html"; Public = $false; Form = $true; Workspace = $true }
    @{ Path = "page/end/admin_agent.html"; Public = $false; Form = $true; Workspace = $true }
    @{ Path = "page/end/operations.html"; Public = $false; Form = $true; Workspace = $true }
)

$legacyPages = @(
    "page/end/register.html", "page/end/plugins.html", "page/end/im.html",
    "page/end/my_adopt.html", "page/end/adopt_wait.html", "page/end/adopt_view.html",
    "page/end/adopt_apply.html", "page/end/adopt_proof.html", "page/end/volunteer_apply.html",
    "page/end/rescue.html", "prototype.html"
)

function Pass([string]$Message) {
    $script:passed++
    Write-Host "[PASS] $Message" -ForegroundColor Green
}

function Fail([string]$Message) {
    $script:failed++
    Write-Host "[FAIL] $Message" -ForegroundColor Red
}

function Assert-True([bool]$Condition, [string]$Message) {
    if ($Condition) { Pass $Message } else { Fail $Message }
}

function Read-Utf8([string]$Path) {
    return [System.IO.File]::ReadAllText($Path, [System.Text.Encoding]::UTF8)
}

Write-Host "=== Frontend adversarial contract ===" -ForegroundColor Cyan
$classified = @{}
foreach ($page in $pages) { $classified[$page.Path] = $true }
foreach ($path in $legacyPages) { $classified[$path] = $true }
$allHtml = [System.IO.Directory]::GetFiles($staticRoot, "*.html", [System.IO.SearchOption]::AllDirectories) | ForEach-Object {
    $_.Substring($staticRoot.Length).TrimStart('\', '/').Replace('\', '/')
}
foreach ($entrypoint in $allHtml) {
    Assert-True ($classified.ContainsKey($entrypoint)) "entrypoint inventory: $entrypoint is explicitly classified"
}
Assert-True ($allHtml.Count -eq $pages.Count) "entrypoint inventory: classification has no stale or missing paths"

$authInterceptor = Read-Utf8 (Join-Path $root "src/main/java/com/example/common/AuthInterceptor.java")
$mvcConfig = Read-Utf8 (Join-Path $root "src/main/java/com/example/common/WebMvcConfig.java")
foreach ($legacyPage in $legacyPages) {
    Assert-True ($authInterceptor -match [regex]::Escape('LEGACY_PAGE_REDIRECTS.put("/' + $legacyPage + '"')) "legacy route: /$legacyPage is server redirected"
}
Assert-True ($mvcConfig -notmatch 'excludePathPatterns\([\s\S]*?/page/end/register\.html') "legacy register: redirect is not bypassed by interceptor exclusion"
Assert-True ($mvcConfig -match '"/prototype\.html"') "prototype: root entrypoint is intercepted"

foreach ($page in $pages) {
    $file = Join-Path $staticRoot $page.Path
    if (-not (Test-Path -LiteralPath $file)) {
        Fail "$($page.Path): file exists"
        continue
    }
    $html = Read-Utf8 $file
    Assert-True ($html -match '<meta\s+name="viewport"') "$($page.Path): responsive viewport"
    Assert-True ($html -match 'css/product-ui\.css') "$($page.Path): shared product design system"
    Assert-True ($html -notmatch 'element\.(css|js)') "$($page.Path): no full Element UI payload"
    Assert-True ($html -notmatch 'front-nav\.js') "$($page.Path): no legacy DOM-rewriting navigation"
    Assert-True ($html -notmatch 'dark-mode\.js') "$($page.Path): no conflicting legacy theme script"
    Assert-True ($html -notmatch 'v-html|insertAdjacentHTML|\.innerHTML\s*=') "$($page.Path): no unsafe HTML sink"
    Assert-True ($html -notmatch 'localStorage\.setItem\s*\(\s*["'']token') "$($page.Path): no browser JWT persistence"
    Assert-True ($html -notmatch '\$\.get\s*\(\s*["'']/api/user/logout|type\s*:\s*["'']GET["''][^}]*logout') "$($page.Path): no GET logout"
    Assert-True ($html -match '\sv-cloak(?:\s|>)') "$($page.Path): stable Vue first paint"
    if ($page.Form) {
        Assert-True ($html -match '<label') "$($page.Path): visible form labels"
        Assert-True ($html -match 'aria-live="polite"|role="alert"') "$($page.Path): accessible form feedback"
    }
    if (-not $page.Public) {
        Assert-True ($html -match 'AuthSession\.bootstrap\s*\(\s*\{\s*requireAuth\s*:\s*true') "$($page.Path): authoritative protected-page bootstrap"
        Assert-True ($html -notmatch 'sessionStorage\.getItem\s*\(\s*["'']user') "$($page.Path): no direct trust in cached identity"
        if ($page.Path -eq "page/end/operations.html") {
            Assert-True ($html -notmatch 'JSON\.stringify\s*\(\s*\{[^}]*\b(userId|actorId|createdBy|completedAt)\s*:') "$($page.Path): workflow writes exclude identity and audit fields"
        } else {
            Assert-True ($html -notmatch 'JSON\.stringify\s*\(\s*\{[^}]*\b(uid|uname|aname|apic|vstate|puid|pstatus|status)\s*:') "$($page.Path): write payload excludes server-owned fields"
        }
    }
}

$frontShellScript = Read-Utf8 (Join-Path $staticRoot "js/front-shell.js")
Assert-True ($frontShellScript -match 'href="/page/front/index\.html"' -and $frontShellScript -match 'class="ui-site-footer ui-front-footer"') "front shell: canonical public home and footer are defined once"
Assert-True ($frontShellScript -match 'ui-front-mobile-toggle' -and $frontShellScript -match 'ui-front-drawer' -and $frontShellScript -match 'mobileOpen') "front shell: shared accessible mobile navigation is available"
$shellPages = @($pages | Where-Object { $_.Path -notmatch '/(login|register)\.html$' -and -not $_.Workspace })
foreach ($page in $shellPages) {
    $html = Read-Utf8 (Join-Path $staticRoot $page.Path)
    Assert-True ($html -match '<front-site-header\s+:user="user"' -and $html -match '<front-site-footer>' -and $html -match 'front-shell\.js\?v=20260809u1a') "$($page.Path): shared public header and verified footer shell"
}

$homeHtml = Read-Utf8 (Join-Path $staticRoot "page/front/index.html")
Assert-True ($homeHtml -match '/api/dashboard/home-stats' -and $homeHtml -match '/api/animal/page1') "home: real bounded APIs drive stats and featured animals"
Assert-True ($homeHtml -notmatch '328|94%|400-021-0520|v-html|innerHTML|insertAdjacentHTML' -and $homeHtml -notmatch '<img[^>]+src=["'']https?://') "home: no prototype claims, unsafe sink, hotline, or external tracking image"

$authScript = Read-Utf8 (Join-Path $staticRoot "js/auth-session.js")
Assert-True ($authScript -notmatch 'Authorization\s*[''"]?\s*[:,=]') "auth-session: no Authorization bearer injection"
Assert-True ($authScript -match "url\.indexOf\('/api/user/me'\)") "auth-session: public /me probe does not force redirect"
Assert-True ($authScript -notmatch '\.always\s*\(\s*finish\s*\)' -and $authScript -notmatch '\.finally\s*\(\s*finish\s*\)') "auth-session: logout does not clear session on any HTTP outcome"
Assert-True ($authScript -match 'function postLogout' -and $authScript -match '退出未完成') "auth-session: logout requires server success before clear"
Assert-True ($authScript -notmatch 'complete\s*\(\s*!!localUser|complete\s*\(\s*true\s*,\s*localUser') "auth-session: cached identity is never promoted to authenticated"
Assert-True ($authScript -match '\},\s*false\s*\);') "auth-session: all bootstrap identity probes fail closed on network errors"
Assert-True ($authScript -match 'revalidateFlight\.callbacks\.push' -and $authScript -match 'revalidateFlight\s*=\s*null') "auth-session: concurrent identity probes use single-flight"

$productCss = Read-Utf8 (Join-Path $staticRoot "css/product-ui.css")
Assert-True ($productCss -match '\.ui-header\s*\{[^}]*height:\s*84px') "design contract: desktop header is 84px"
Assert-True ($productCss -match '\.ui-nav a\s*\{[^}]*font-size:\s*14px') "design contract: desktop navigation is 14px"
Assert-True ($productCss -match '\.ui-button\s*\{[^}]*min-height:\s*48px[^}]*font-size:\s*14px') "design contract: primary controls are readable and touchable"
Assert-True ($productCss -match '\.ui-badge\.is-closed\s*\{') "design contract: rejected and closed states have explicit styling"
Assert-True ($productCss -match '@media\s*\(max-width:\s*960px\)[\s\S]*?\.ui-detail\s*\{[^}]*grid-template-columns:\s*1fr') "design contract: detail page becomes single-column on tablet"

foreach ($protectedHeaderPage in @("page/front/adopt_apply.html", "page/front/my_adopt.html", "page/front/adopt_proof.html", "page/front/volunteer_apply.html", "page/front/my_volunteer.html", "page/front/rescue_apply.html", "page/front/my_rescue.html", "page/front/pet_care.html")) {
    $html = Read-Utf8 (Join-Path $staticRoot $protectedHeaderPage)
    Assert-True ($html -match '<front-site-header\s+:user="user"' -and $html -match 'front-shell\.js\?v=20260809u1a' -and $frontShellScript -match 'ui-front-mobile-toggle' -and $frontShellScript -match 'ui-front-drawer') "${protectedHeaderPage}: protected mobile navigation remains available"
}

$registerHtml = Read-Utf8 (Join-Path $staticRoot "page/front/register.html")
Assert-True ($registerHtml -match 'id="registerPasswordConfirm"' -and $registerHtml -match 'passwordConfirm\s*!==\s*this\.form\.password') "register: password confirmation is enforced"
Assert-True ($registerHtml -match 'allowCachedOnNetworkError:\s*false') "register: cached identity cannot bypass authoritative revalidation"
$loginHtml = Read-Utf8 (Join-Path $staticRoot "page/front/login.html")
Assert-True ($loginHtml -match 'allowCachedOnNetworkError:\s*false') "login: stale cached identity cannot create redirect loop"
# Phase 3G: redirect allowlist lives in shared UserWorkspace (login/register both consume it).
$userWorkspaceJs = Read-Utf8 (Join-Path $staticRoot "js/user-workspace.js")
Assert-True (
  ($loginHtml -match 'UserWorkspace\.safeRedirectFromLocation|UserWorkspace\.safeRedirect') -and
  ($userWorkspaceJs -match 'function safeRedirect') -and
  ($userWorkspaceJs -match 'new URL\(') -and
  ($userWorkspaceJs -match "indexOf\('\.\.'\)") -and
  ($userWorkspaceJs -match 'ADMIN_REDIRECT_PATHS|isAdminPath|hasAdminAccess')
) "login: redirect is normalized and canonical allowlisted"

$petCareHtml = Read-Utf8 (Join-Path $staticRoot "page/front/pet_care.html")
Assert-True ($petCareHtml -match '/api/petcare/config' -and $petCareHtml -notmatch 'v-if="isAdmin"|Number\(role\.id\)\s*===\s*1') "pet care: personal AI configuration is available to every authenticated user"
Assert-True ($petCareHtml -match 'autocomplete="new-password"' -and $petCareHtml -notmatch '(localStorage|sessionStorage)\.setItem[^;]*(api|key|secret)') "pet care: API key is never persisted in browser storage"
Assert-True ($petCareHtml -match 'admin-agent-markdown\.js' -and $petCareHtml -match '<petcare-rich-answer\s+:text="msg\.text"' -and $petCareHtml -notmatch 'v-html|innerHTML|insertAdjacentHTML') "pet care: assistant Markdown uses the bounded structured renderer without an HTML sink"
Assert-True ($productCss -match '\.petcare-rich-answer\s*>' -and $productCss -match '\.petcare-rich-answer\s+li\s*>\s*ul' -and $productCss -match '\.petcare-answer-table\s+td::before') "pet care: article hierarchy, nested guidance, and mobile tables have explicit visual treatment"
Assert-True ($petCareHtml -match 'configForm\.apiKey\s*=\s*''''') "pet care: API key input is cleared after use"
Assert-True ($petCareHtml -match '/api/petcare/config/clear' -and $petCareHtml -match '账号级加密配置' -and $petCareHtml -match '服务重启仍会保留') "pet care: users can clear account-scoped encrypted configuration"
Assert-True ($petCareHtml -match '/api/petcare/conversations' -and $petCareHtml -match 'questionTime' -and $petCareHtml -match 'answerTime' -and $petCareHtml -match '历史聊天') "pet care: persisted history uses a selectable left-side conversation directory with timestamps"
Assert-True ($petCareHtml -match 'loadConversations\(\)' -and $petCareHtml -notmatch 'created:\s*function\s*\(\)\s*\{[\s\S]{0,250}loadHistory') "pet care: opening the assistant loads only the conversation directory, never an old transcript"
Assert-True ($petCareHtml -match 'conversationId:\s*payload\.conversationId' -and $petCareHtml -match '/title' -and $petCareHtml -match '修改标题') "pet care: questions stay in one conversation and users can rename it"
Assert-True ($petCareHtml -match 'configStatus\.connected' -and $petCareHtml -match 'connectionStatus\s*===\s*''failed''' -and $petCareHtml -notmatch 'source\s*===\s*''personal''\s*&&\s*this\.configStatus\.ready\)\s*return\s*''个人 Agent 已连接''') "pet care: connected badge is based on a persisted successful request, not merely complete fields"
Assert-True ($petCareHtml -match '/api/petcare/config/auto-test' -and $petCareHtml -match 'replacingApiKey\s*\|\|\s*!vm\.configStatus\.apiKeyConfigured' -and $petCareHtml -match 'v-if="configStatus\.apiKeyConfigured\s*&&\s*!replacingApiKey"') "pet care: saved secret is auto-verified and cannot be replaced by password-manager autofill"
$productCss = Read-Utf8 (Join-Path $staticRoot "css/product-ui.css")
Assert-True ($productCss -match '\.petcare-chat-layout\s*>\s*\.ui-panel\s*\+\s*\.ui-panel\s*\{\s*margin-top:\s*0') "pet care: conversation sidebar and chat panel share the same top edge"
$petCareController = Read-Utf8 (Join-Path $root "src/main/java/com/example/controller/PetCareController.java")
$petCareTaskService = Read-Utf8 (Join-Path $root "src/main/java/com/example/service/PetCareTaskService.java")
$petCareCrypto = Read-Utf8 (Join-Path $root "src/main/java/com/example/service/PetCareConfigCrypto.java")
$petCareConfigEntity = Read-Utf8 (Join-Path $root "src/main/java/com/example/entity/PetCareAiConfig.java")
Assert-True ($petCareController -match 'petCareAiConfigService\.find\(user\.getId\(\)\)' -and $petCareController -match 'petCareAiConfigService\.save\(' -and $petCareController -notmatch 'AI_CONFIG_SESSION_KEY|setAttribute\([^)]*aiConfig') "pet care: API configuration is account-scoped in the database rather than HttpSession"
Assert-True ($petCareCrypto -match 'AES/GCM/NoPadding' -and $petCareCrypto -match 'encryptWithAad\(aad\(userId\)' -and $petCareCrypto -match 'cipher\.updateAAD\(associatedData\)' -and $petCareConfigEntity -match 'apiKeyCiphertext' -and $petCareConfigEntity -notmatch 'private\s+String\s+apiKey\s*;') "pet care: API key is authenticated encrypted at rest and bound to its owning account"
Assert-True ($petCareController -match 'petCareTaskService\.ask\(user\.getId\(\),\s*body\.getRequestId\(\)' -and $petCareTaskService -match 'conversationService\.assertOwned\(userId,\s*conversationId\)[\s\S]{0,1000}petCareService\.ask' -and $petCareTaskService -match 'markConnectionBestEffort\(') "pet care: conversation ownership is checked before paid model use and real connection outcomes are persisted"
Assert-True ($petCareHtml -match '_conversationGeneration' -and $petCareHtml -match '_historyGeneration' -and $petCareHtml -match '_titleGeneration' -and $petCareHtml -match '_mutationGeneration' -and $petCareHtml -match 'abortRequest\(' -and $petCareHtml -match 'conversationRefreshQueued') "pet care: directory, detail, rename, and mutation requests reject stale responses with queued refresh"
Assert-True ($petCareHtml -match 'conversationError:\s*[\s\S]*?historyError:\s*[\s\S]*?conversationRefreshQueued' -and $petCareHtml -match 'askError:\s*' -and $petCareHtml -match 'v-else-if="conversationError"' -and $petCareHtml -match 'v-else-if="historyError') "pet care: directory, history, and ask failures remain distinct from empty states"
Assert-True (([regex]::Matches($petCareHtml, 'res\.data\s*===\s*true').Count -ge 2)) "pet care: conversation delete and clear require exact Boolean true"
Assert-True ($petCareHtml -match 'crypto\.randomUUID' -and $petCareHtml -match 'requestId:\s*payload\.requestId' -and $petCareHtml -match 'failedAsk\s*=\s*request' -and $petCareHtml -match 'sendAsk\(this\.failedAsk,\s*false\)' -and $petCareHtml -notmatch '\bhistory:\s*history') "pet care: ask retries keep one stable requestId and submit only the server contract fields"
Assert-True ($petCareHtml -match "ai:\s*'AI 生成'" -and $petCareHtml -match "local:\s*'本地知识库'" -and $petCareHtml -match "degraded:\s*'AI 失败 · 已降级'" -and $petCareHtml -match '服务端请求可能仍在处理') "pet care: answer provenance and local-only stop semantics are explicit"
Assert-True ($petCareHtml -match 'configDirty' -and $petCareHtml -match 'applyConfigStatus\(res\.data,\s*false\)' -and $petCareHtml -match '确认清除当前账号的个人 AI 配置') "pet care: connection tests cannot overwrite edits and config clear is confirmed"

foreach ($booleanMutation in @(
    @{ Path = "page/front/volunteer_apply.html"; Label = "volunteer apply" },
    @{ Path = "page/front/rescue_apply.html"; Label = "rescue apply" },
    @{ Path = "page/end/volunteer.html"; Label = "volunteer audit" },
    @{ Path = "page/end/help.html"; Label = "rescue management" },
    @{ Path = "page/end/person.html"; Label = "profile update" }
)) {
    $html = Read-Utf8 (Join-Path $staticRoot $booleanMutation.Path)
    $hasExactBooleanGuard = $html -match "res\.data\s*!==\s*true" -or
        ($html -match "res\.data\s*===\s*true" -and $html -match "!\s*exactSuccess\s*\(\s*res\s*\)")
    Assert-True $hasExactBooleanGuard "$($booleanMutation.Label): false Boolean response cannot report success"
}
Assert-True ((Read-Utf8 (Join-Path $staticRoot "page/end/person.html")) -match '/api/user/me/profile' -and (Read-Utf8 (Join-Path $staticRoot "page/end/person.html")) -notmatch 'id:\s*this\.user\.id|username:\s*this\.user\.username') "profile update: session-owned endpoint excludes identity fields"

$adminHomeHtml = Read-Utf8 (Join-Path $staticRoot "page/end/index.html")
$adminPersonHtml = Read-Utf8 (Join-Path $staticRoot "page/end/person.html")
$adminVolunteerHtml = Read-Utf8 (Join-Path $staticRoot "page/end/volunteer.html")
$adminHelpHtml = Read-Utf8 (Join-Path $staticRoot "page/end/help.html")
$adminAnimalHtml = Read-Utf8 (Join-Path $staticRoot "page/end/animal.html")
$adminNoticeHtml = Read-Utf8 (Join-Path $staticRoot "page/end/notice.html")
$adminAccountHtml = Read-Utf8 (Join-Path $staticRoot "page/end/account.html")
$adminAgentHtml = Read-Utf8 (Join-Path $staticRoot "page/end/admin_agent.html")
$adminAgentMarkdown = Read-Utf8 (Join-Path $staticRoot "js/admin-agent-markdown.js")
$adminAuthScript = Read-Utf8 (Join-Path $staticRoot "js/admin-auth.js")
$adminWorkspaceCss = Read-Utf8 (Join-Path $staticRoot "css/admin-workspace.css")
foreach ($adminPage in @(
    @{ Name = "admin home"; Html = $adminHomeHtml },
    @{ Name = "admin person"; Html = $adminPersonHtml },
    @{ Name = "admin volunteer"; Html = $adminVolunteerHtml },
    @{ Name = "admin help"; Html = $adminHelpHtml }
    @{ Name = "admin animal"; Html = $adminAnimalHtml }
    @{ Name = "admin notice"; Html = $adminNoticeHtml }
    @{ Name = "admin account"; Html = $adminAccountHtml }
)) {
    Assert-True ($adminPage.Html -match 'admin-workspace\.css') "$($adminPage.Name): minimal shared workspace layer"
    Assert-True ($adminPage.Html -match 'allowCachedOnNetworkError:\s*false') "$($adminPage.Name): network errors fail closed"
    Assert-True ($adminPage.Html -match 'ui-mobile-toggle' -and $adminPage.Html -match 'ui-mobile-nav' -and $adminPage.Html -match 'mobileOpen') "$($adminPage.Name): accessible mobile navigation remains available"
    Assert-True ($adminPage.Html -notmatch 'element\.(css|js)|theme\.css|base\.css|dark-mode\.js|base\.js|tinymce|front-nav\.js') "$($adminPage.Name): no prohibited legacy frontend dependency"
    Assert-True ($adminPage.Html -notmatch 'permission\.path|item\.path|:href\s*=\s*["''][^"'']*\.path') "$($adminPage.Name): server permission paths never drive navigation"
    Assert-True ($adminPage.Html -match 'AuthSession\.logout\s*\(' -and $adminPage.Html -notmatch '/api/user/logout') "$($adminPage.Name): logout uses AuthSession POST contract only"
}
Assert-True ($adminAuthScript -match 'var\s+ROUTES\s*=\s*Object\.freeze' -and $adminAuthScript -match "help:\s*Object\.freeze\(\{[^}]*'/page/end/help\.html'" -and $adminAuthScript -match "rescue:\s*Object\.freeze\(\{[^}]*'/page/end/help\.html'" -and $adminAuthScript -match 'seenHrefs') "admin auth: help and rescue aliases use one deduplicated canonical route"
Assert-True ($adminAuthScript -notmatch '\.path\b|sessionStorage\.getItem\s*\(\s*["'']user') "admin auth: route construction ignores server paths and cached identity"
Assert-True ($adminAuthScript -match 'AVATAR_PLACEHOLDER' -and $adminAuthScript -match 'image\.onerror\s*=\s*null' -and $adminAuthScript -match 'avatarFallback') "admin auth: missing avatars use a stable static fallback without an error loop"
Assert-True ($adminHomeHtml -match '/api/dashboard/public-stats' -and $adminHomeHtml -match '/api/notice/page' -and $adminHomeHtml -notmatch '/api/notice/["'']|/api/animal/["'']|/api/(user|adopt|volunteer)/["'']') "admin home: only bounded, truthful dashboard and notice reads"
Assert-True ($adminHomeHtml -match "hasFlag\('account'\)[\s\S]*?/api/account/stats/by-label" -and $adminHomeHtml -notmatch 'echarts|allRecords') "admin home: account aggregation is permission-gated without full-record chart data"
Assert-True ($adminPersonHtml -match "formData\.append\('file',\s*file\)" -and $adminPersonHtml -match "appendUploadPurpose\(formData,\s*'avatar'\)" -and $adminPersonHtml -match "url:\s*'/api/user/me/profile'[\s\S]*?type:\s*'PUT'") "admin person: avatar upload is followed by session-owned profile update"
Assert-True ($adminPersonHtml -notmatch 'type=["'']password|v-model[^>]*password|\bpassword\s*:') "admin person: no unsupported password-change field"
Assert-True ($adminPersonHtml -match 'profilePayload[\s\S]*?email:\s*this\.form\.email[\s\S]*?phone:\s*this\.form\.phone[\s\S]*?avatar:\s*this\.form\.avatar' -and $adminPersonHtml -notmatch 'id:\s*this\.user\.id|username:\s*this\.user\.username') "admin person: profile write contains only editable profile fields"
Assert-True ($adminWorkspaceCss -match '@media\s*\(max-width:\s*960px\)' -and $adminWorkspaceCss -match '@media\s*\(max-width:\s*640px\)' -and $adminWorkspaceCss -match '\.admin-bar-track\s*\{\s*display:\s*none') "admin workspace: tablet/mobile layout and chart-card fallback are explicit"
Assert-True ($adminAgentHtml -match 'admin-agent-markdown\.js' -and $adminAgentHtml -match '<agent-rich-answer\s+:text="turn\.answer"' -and $adminAgentHtml -notmatch 'v-html|innerHTML|insertAdjacentHTML') "admin agent: model Markdown uses a structured text-only renderer without an HTML sink"
Assert-True ($adminAgentMarkdown -match 'MAX_SOURCE\s*=\s*20000' -and $adminAgentMarkdown -match 'MAX_TABLE_ROWS\s*=\s*30' -and $adminAgentMarkdown -match 'MAX_TABLE_COLUMNS\s*=\s*8' -and $adminAgentMarkdown -notmatch 'innerHTML|outerHTML|document\.write') "admin agent: Markdown parsing is bounded and never interprets model HTML"
Assert-True ($adminWorkspaceCss -match '\.admin-agent-rich-answer h3::before' -and $adminWorkspaceCss -match '\.admin-agent-answer-table td::before\s*\{\s*content:\s*attr\(data-label\)') "admin agent: structured answers and mobile table cards have explicit visual treatment"

$rescueApplyHtml = Read-Utf8 (Join-Path $staticRoot "page/front/rescue_apply.html")
$myRescueHtml = Read-Utf8 (Join-Path $staticRoot "page/front/my_rescue.html")
$rescuePayloadMatch = [regex]::Match($rescueApplyHtml, 'mutablePayload:\s*function[\s\S]*?submitRescue:\s*function')
$rescuePayload = $rescuePayloadMatch.Value
foreach ($rescuePage in @(
    @{ Name = "rescue apply"; Html = $rescueApplyHtml },
    @{ Name = "my rescue"; Html = $myRescueHtml },
    @{ Name = "admin help"; Html = $adminHelpHtml }
)) {
    Assert-True ($rescuePage.Html -match 'AuthSession\.bootstrap\s*\(\s*\{\s*requireAuth\s*:\s*true[\s\S]*?allowCachedOnNetworkError\s*:\s*false') "$($rescuePage.Name): authoritative bootstrap fails closed before Vue mount"
    Assert-True ($rescuePage.Html -notmatch 'v-html|insertAdjacentHTML|\.innerHTML\b|outerHTML|document\.write') "$($rescuePage.Name): adversarial message and record content has no HTML sink"
}
Assert-True ($rescueApplyHtml -match 'class="ui-panel ui-rescue-form"[\s\S]*?class="ui-panel ui-rescue-chat"' -and $productCss -match '@media\s*\(max-width:\s*640px\)[\s\S]*?\.ui-rescue-form\s*\{\s*order:\s*1') "rescue apply: formal rescue form precedes chat and remains mobile priority"
$rescueRoomIsPublic = $rescueApplyHtml -match '所有已登录用户共享|已认证全局救助社区聊天室' -and
    $rescueApplyHtml -match '不是私人会话|不是私人客服'
$adminRoomIsPublic = $adminHelpHtml -match '已认证全局救助社区聊天室' -and $adminHelpHtml -match '不是私人'
Assert-True ($rescueRoomIsPublic -and $adminRoomIsPublic) "rescue chat: authenticated global community room is explicitly non-private"
$rescuePayloadFields = @('title', 'description', 'location', 'phone') | ForEach-Object {
    $rescuePayload -match ("{0}:\s*(?:this\.form\.{0}|String\(this\.form\.{0})" -f $_)
}
Assert-True ($rescuePayloadMatch.Success -and -not ($rescuePayloadFields -contains $false) -and $rescuePayload -match 'payload\.pic\s*=\s*(?:String\()?photoFlag' -and $rescuePayload -notmatch '\b(id|uid|uname|state|status|time|createTime|updateTime|remark)\s*:') "rescue apply: mutable Help payload has only actual editable fields and optional picture flag"
Assert-True ($rescueApplyHtml -match "appendUploadPurpose\((?:formData|upload),\s*'help'\)" -and $rescueApplyHtml -match '\^\[a-zA-Z0-9-\]\{1,64\}\$' -and $myRescueHtml -match "'/api/files/'\s*\+\s*encodeURIComponent\(value\)" -and $adminHelpHtml -match "'/api/files/'\s*\+\s*encodeURIComponent\(value\)") "rescue images: help-purpose upload and validated encoded file flags only"
Assert-True ($myRescueHtml -match "url:\s*'/api/help/mine'[\s\S]*?data:\s*\{\s*pageNum:\s*page,\s*pageSize:\s*view\.pageSize\s*\}" -and $myRescueHtml -notmatch '[?&]uid=|\buid\s*:\s*(this|view|vm)\.user') "my rescue: session-owned bounded mine endpoint has no client identity selector"
Assert-True ($myRescueHtml -match 'ui-rescue-record-card' -and $myRescueHtml -match '管理员回复' -and $myRescueHtml -match "0:\s*'待处理'[\s\S]*?1:\s*'处理中'[\s\S]*?2:\s*'已完成'[\s\S]*?3:\s*'已关闭'" -and $myRescueHtml -match 'totalPages') "my rescue: responsive records expose status, reply, detail, errors, and pagination"
foreach ($chatPage in @(
    @{ Name = "rescue apply"; Html = $rescueApplyHtml },
    @{ Name = "admin help"; Html = $adminHelpHtml }
)) {
    Assert-True ($chatPage.Html -match "url:\s*'/api/help/chat/history'[\s\S]*?type:\s*'GET'" -and $chatPage.Html -match "url:\s*'/api/help/chat'[\s\S]*?type:\s*'POST'[\s\S]*?JSON\.stringify\(\{\s*text:\s*text\s*\}\)" -and $chatPage.Html -match 'item\.username' -and $chatPage.Html -match 'item\.text' -and $chatPage.Html -match 'item\.createdTime') "$($chatPage.Name) chat: bounded DTO history and HTTP-only persistence send path"
    Assert-True ($chatPage.Html -notmatch 'WebSocket|ws-ticket|ChatMessagePublisher|socket\.onmessage|reconnectTimer|connectSocket|closeSocket') "$($chatPage.Name) chat: active page has no WebSocket, ticket, publisher, receive, or reconnect path"
    $hasBoundedPolling = $chatPage.Html -match 'pollInterval\s*=\s*10000' -and
        $chatPage.Html -match 'historyRequest(?:Active)?' -and
        $chatPage.Html -match 'visibilitychange' -and $chatPage.Html -match 'document\.hidden' -and
        $chatPage.Html -match 'pagehide' -and $chatPage.Html -match '定时更新|每\s*10\s*秒更新'
    Assert-True $hasBoundedPolling "$($chatPage.Name) chat: visible-page bounded HTTP polling lifecycle is explicit"
    $rendersPersistedResponse = ($chatPage.Html -match 'appendMessage\(res\.data\)' -and $chatPage.Html -match 'messages\.length\s*>\s*100') -or
        ($chatPage.Html -match 'normalizeMessage\(res\.data\)' -and $chatPage.Html -match 'mergeMessages\(\[normalized\]\)' -and $chatPage.Html -match 'merged\.length\s*>\s*100')
    Assert-True $rendersPersistedResponse "$($chatPage.Name) chat: persisted response is rendered with bounded client state"
    $hasCanonicalMerge = $chatPage.Html -match 'mergeMessages\((?:res\.data|normalized)\)' -and
        $chatPage.Html -match 'item\.id\s*==\s*null' -and $chatPage.Html -match '\^\[1-9\]\[0-9\]\*\$' -and
        $chatPage.Html -match 'Object\.create\(null\)' -and $chatPage.Html -match '(?:messages|merged)\.sort' -and
        $chatPage.Html -notmatch 'Number\((left|right)\.id' -and $chatPage.Html -notmatch 'messages\s*=\s*\[\]\s*;\s*res\.data'
    Assert-True $hasCanonicalMerge "$($chatPage.Name) chat: polling validates canonical decimal IDs, deduplicates, sorts without precision loss, and retains the last 100"
    $rejectsStalePoll = $chatPage.Html -match "status(?:Text)?\s*(?:!==|===)\s*'abort'"
    Assert-True ($chatPage.Html -match 'res\.data\.length\s*>\s*500' -and $chatPage.Html -match 'pollingGeneration' -and $chatPage.Html -match 'historyRequest\.abort\(\)' -and $rejectsStalePoll) "$($chatPage.Name) chat: malformed oversized history and stale polling requests are bounded"
}
Assert-True ($rescueApplyHtml -match 'id="rescueTitleInput"[^>]*maxlength="255"' -and $rescueApplyHtml -match 'id="rescueDescription"[^>]*maxlength="5000"' -and $rescueApplyHtml -match 'form\.description\.length\s*\}\}/5000') "rescue apply: title and description caps match backend 255/5000"
Assert-True ($rescueApplyHtml -notmatch 'webp' -and ((Read-Utf8 (Join-Path $staticRoot "page/front/volunteer_apply.html")) -notmatch 'webp') -and $adminPersonHtml -notmatch 'webp') "image inputs: rescue, volunteer, and avatar UIs advertise JPG/PNG/GIF only"
$helpServiceSource = Read-Utf8 (Join-Path $root "src/main/java/com/example/service/HelpService.java")
Assert-True ($helpServiceSource -match 'getChatHistory\s*\(\)[\s\S]*?orderByDesc\(Help::getCreateTime\)[\s\S]*?LIMIT\s+100[\s\S]*?toChatDTO' -and $helpServiceSource -match 'dto\.setUsername' -and $helpServiceSource -match 'dto\.setText' -and $helpServiceSource -match 'dto\.setCreatedTime') "rescue chat API: history is a bounded safe DTO projection"
Assert-True ($helpServiceSource -notmatch 'ChatMessagePublisher|WebSocketServer|TransactionSynchronization|\.publish\s*\(') "rescue chat save: DB persistence has no active publisher or broadcast path"
$redisConfigSource = Read-Utf8 (Join-Path $root "src/main/java/com/example/config/RedisConfig.java")
Assert-True ($redisConfigSource -notmatch 'RedisMessageListenerContainer|MessageListenerAdapter|RedisMessageSubscriber|addMessageListener') "rescue chat: Redis subscriber is not registered"
$userControllerSource = Read-Utf8 (Join-Path $root "src/main/java/com/example/controller/UserController.java")
Assert-True ($userControllerSource -match '@PostMapping\("/ws-ticket"\)[\s\S]*?HttpStatus\.GONE[\s\S]*?Result\.error\("410"' -and $userControllerSource -notmatch 'WebSocketServer\.closeUserSessions') "user chat contract: ticket issuance is 410 and logout has no WebSocket static bridge"
$webSocketServerPath = Join-Path $root "src/main/java/com/example/component/WebSocketServer.java"
Assert-True (-not (Test-Path -LiteralPath $webSocketServerPath)) "user chat contract: dormant legacy WebSocket endpoint implementation is removed"
Assert-True ($adminHelpHtml -match "hasFlag\(authenticatedUser,\s*'help'\)\s*&&\s*!AdminWorkspace\.hasFlag\(authenticatedUser,\s*'rescue'\)" -and $adminHelpHtml -match 'AdminWorkspace\.navigation\(authenticatedUser\.permission\)' -and $adminHelpHtml -notmatch 'permission\.path|item\.path') "admin help: help/rescue permissions use fixed AdminWorkspace routes"
Assert-True ($adminHelpHtml -match 'avatarUrl:\s*function\s*\(flag\)[\s\S]*?\^\[a-zA-Z0-9-\]\{1,64\}\$[\s\S]*?AdminWorkspace\.avatarUrl\(value\)') "admin help: account avatar uses a validated encoded file flag"
Assert-True ($adminHelpHtml -match "url:\s*'/api/help/page'[\s\S]*?pageSize:\s*view\.pageSize" -and $adminHelpHtml -match 'pageSize:\s*12' -and $adminHelpHtml -notmatch "url:\s*'/api/help'\s*,\s*type:\s*'GET'") "admin help: management list only uses bounded /api/help/page"
$managerPayloadMatch = [regex]::Match($adminHelpHtml, 'managerPayload:\s*function[\s\S]*?saveManage:\s*function')
Assert-True ($managerPayloadMatch.Success -and $managerPayloadMatch.Value -match 'status:\s*Number\(f\.status\)' -and $managerPayloadMatch.Value -match 'remark:f\.remark' -and $managerPayloadMatch.Value -match 'outcome:f\.outcome' -and $managerPayloadMatch.Value -notmatch '\b(uid|uname|title|description|location|phone|pic|createTime|updateTime)\s*:' -and $adminHelpHtml -match "'/api/help/'\s*\+\s*encodeURIComponent\(view\.manageItem\.id\)\s*\+\s*'/manage'[\s\S]*?type:\s*'PUT'") "admin help: dedicated manager endpoint receives only controlled workflow and intake fields"
Assert-True ($adminWorkspaceCss -match '@media\s*\(max-width:\s*960px\)[\s\S]*?\.admin-help-table\s*\{\s*display:\s*none' -and $adminWorkspaceCss -match '\.admin-help-cards\s*\{\s*display:\s*grid') "admin help: wide records become responsive cards and detail"

foreach ($batch6Page in @(
    @{ Name = "admin animal"; Html = $adminAnimalHtml; Flag = "animal" },
    @{ Name = "admin notice"; Html = $adminNoticeHtml; Flag = "notice" },
    @{ Name = "admin account"; Html = $adminAccountHtml; Flag = "account" }
)) {
    Assert-True ($batch6Page.Html -match 'AuthSession\.bootstrap\s*\(\s*\{\s*requireAuth\s*:\s*true[\s\S]*?allowCachedOnNetworkError\s*:\s*false[\s\S]*?new Vue' -and $batch6Page.Html.IndexOf('AuthSession.bootstrap') -lt $batch6Page.Html.IndexOf('new Vue')) "$($batch6Page.Name): fail-closed authoritative auth precedes Vue mount"
    Assert-True ($batch6Page.Html -match "hasFlag\(authenticatedUser,\s*[`"']$($batch6Page.Flag)[`"']\)" -and $batch6Page.Html -match 'AdminWorkspace\.navigation\(\s*authenticatedUser\.permission\s*,?\s*\)' -and $batch6Page.Html -notmatch 'permission\.path|item\.path') "$($batch6Page.Name): domain permission and fixed routes only"
    Assert-True ($batch6Page.Html -match 'admin-record-table' -and $batch6Page.Html -match 'admin-record-cards' -and $batch6Page.Html -match 'admin-dialog') "$($batch6Page.Name): responsive table, mobile cards, and dialog/detail surface"
}
Assert-True ($adminAnimalHtml -match 'url:\s*["'']/api/animal/page["''][\s\S]*?data:\s*\{[\s\S]*?name:\s*vm\.search[\s\S]*?pageNum:\s*page[\s\S]*?pageSize:\s*vm\.pageSize' -and $adminAnimalHtml -notmatch 'url:\s*["'']/api/animal["'']\s*,\s*type:\s*["'']GET["'']') "admin animal: only bounded management page endpoint reads records"
$animalPayload = [regex]::Match($adminAnimalHtml, 'animalPayload:\s*function\s*\(\)[\s\S]*?selectImage:\s*function').Value
Assert-True ($animalPayload -match '\b(tname|ttype|tsex|tbirthday|tpic|tdescribe)\s*:' -and $animalPayload -notmatch '\b(tstate|health|location|photos|images|uid|uname)\s*:' -and $adminAnimalHtml -match "appendUploadPurpose\(data,\s*['`"]animal['`"]\)" -and $adminAnimalHtml -match "url:\s*['`"]\/api\/animal\/import['`"]" -and $adminAnimalHtml -match '/api/animal/template') "admin animal: editable payload excludes workflow state and uses actual upload/import contracts"
Assert-True ($adminAnimalHtml -notmatch '健康状态|健康状况|发现地点|救助地点|多图|相册|multiple') "admin animal: no fake health, location, or multi-photo claims"
Assert-True ($adminAnimalHtml -match '正在上传图片|正在上传并处理文件|导入完成|失败' -and $adminAnimalHtml -match 'type:\s*["'']DELETE["'']') "admin animal: upload/import progress, errors, and confirmed delete are explicit"
Assert-True ($adminAnimalHtml -match 'id="animalName"[\s\S]*?maxlength="20"[\s\S]*?required' -and $adminAnimalHtml -match 'id="animalType"[\s\S]*?maxlength="20"[\s\S]*?required' -and $adminAnimalHtml -match 'id="animalSex"[\s\S]*?required' -and $adminAnimalHtml -match 'id="animalDescription"[\s\S]*?maxlength="100"' -and $adminAnimalHtml -match '未知时留空，不会生成默认日期' -and $adminAnimalHtml -match '绑定成功前保持私有') "admin animal: form constraints match backend and unknown birthdays/uploads stay honest"
Assert-True ($adminAnimalHtml -match 'admin-animal-cards[\s\S]*?@click="askDelete\(item\)"' -and $adminAnimalHtml -match 'res\.code\s*!==\s*"0"\s*\|\|\s*res\.data\s*!==\s*true') "admin animal: mobile delete parity and Boolean mutation success are enforced"
Assert-True ($adminNoticeHtml -match 'url:\s*["'']/api/notice/page["''][\s\S]*?pageSize:\s*vm\.pageSize' -and $adminNoticeHtml -notmatch 'url:\s*["'']/api/notice["'']\s*,\s*type:\s*["'']GET["'']') "admin notice: only bounded notice pagination reads records"
$noticePayload = [regex]::Match($adminNoticeHtml, 'noticePayload:\s*function\s*\(\)[\s\S]*?save:\s*function').Value
Assert-True ($noticePayload -match 'title:\s*this\.form\.title' -and $noticePayload -match 'content:\s*this\.form\.content' -and $noticePayload -notmatch '\b(date|time|draft|category|author|html|status)\s*:' -and $adminNoticeHtml -match '保存后立即公开|确认保存并立即公开') "admin notice: title/content-only payload and immediate-public semantics"
Assert-True ($adminNoticeHtml -notmatch '(id|v-model)="[^"]*(date|time|draft|category|author|html)[^"]*"|发布日期输入|发布时间输入|定时发布按钮|草稿箱|分类管理|作者字段|v-html|tinymce') "admin notice: no fake date, draft, category, author, or rich HTML controls"
Assert-True ($adminNoticeHtml -match 'admin-notice-cards[\s\S]*?@click="askDelete\(item\)"' -and $adminNoticeHtml -match 'res\.code\s*!==\s*"0"\s*\|\|\s*res\.data\s*!==\s*true') "admin notice: mobile delete parity and Boolean mutation success are enforced"
Assert-True ($adminAccountHtml -match "url:\s*['`"]\/api\/account\/page['`"][\s\S]*?pageSize:\s*vm\.pageSize" -and $adminAccountHtml -match "url:\s*['`"]\/api\/account\/stats\/by-label['`"]" -and $adminAccountHtml -notmatch "url:\s*['`"]\/api\/account['`"]\s*,\s*type:\s*['`"]GET['`"]") "admin account: bounded records and aggregate-only whole-dataset totals"
$accountPayload = [regex]::Match($adminAccountHtml, 'accountPayload:\s*function\s*\([^)]*\)[\s\S]*?save:\s*function').Value
Assert-True ($accountPayload -match 'alabel:\s*this\.form\.alabel' -and $accountPayload -notmatch 'auname\s*:' -and $accountPayload -match 'avalue:\s*String\(this\.form\.avalue\)' -and $accountPayload -match 'adescribe:\s*this\.form\.adescribe' -and $accountPayload -match 'occurredAt:' -and $accountPayload -match 'businessType:' -and $accountPayload -notmatch '\b(id|currency|ledger|balance|income|expense|createdBy|reversalOf)\s*:' -and $adminAccountHtml -match 'type:\s*["'']POST["'']' -and $adminAccountHtml -notmatch 'type:\s*vm\.form\.id\s*\?\s*["'']PUT' -and $adminAccountHtml -match '历史记录不可编辑' -and $adminAccountHtml -match '历史记录不可物理删除' -and $adminAccountHtml -match 'decimal-money\.js' -and $adminAccountHtml -match 'DecimalMoney\.format' -and $adminAccountHtml -notmatch '(Number|parseFloat)\([^\)]*avalue|avalue[^\r\n;]*\.toFixed') "admin account: append-only exact decimal and business-association payload derives handler server-side"
Assert-True ($adminAccountHtml -match 'res\.code\s*!==\s*"0"\s*\|\|\s*res\.data\s*!==\s*true') "admin account: append success requires the exact Boolean API result"
Assert-True ($adminAccountHtml -match '正数表示收入，负数表示支出' -and $adminAccountHtml -match '完整数据集|全量汇总' -and $adminAccountHtml -notmatch '(id|v-model)="[^"]*(date|time|currency|ledger)[^"]*"|交易日期输入|发生日期输入|币种选择|人民币金额|CNY|账本编号|总账') "admin account: signed semantics and whole-dataset totals without fake ledger controls or claims"
Assert-True ($adminWorkspaceCss -match '@media\s*\(max-width:\s*960px\)[\s\S]*?\.admin-record-table\s*\{\s*display:\s*none' -and $adminWorkspaceCss -match '\.admin-record-cards\s*\{\s*display:\s*grid') "batch 6 admin: desktop tables become mobile cards"

$myAdoptHtml = Read-Utf8 (Join-Path $staticRoot "page/front/my_adopt.html")
$proofFrontHtml = Read-Utf8 (Join-Path $staticRoot "page/front/adopt_proof.html")
$animalDetailHtml = Read-Utf8 (Join-Path $staticRoot "page/front/animal_detail.html")
$myVisitHtml = Read-Utf8 (Join-Path $staticRoot "page/front/my_visit.html")
$adminAdoptHtml = Read-Utf8 (Join-Path $staticRoot "page/end/adopt.html")
$adminProofHtml = Read-Utf8 (Join-Path $staticRoot "page/end/proof.html")
$adminVisitHtml = Read-Utf8 (Join-Path $staticRoot "page/end/visit.html")
$adoptApplyHtml = Read-Utf8 (Join-Path $staticRoot "page/front/adopt_apply.html")
Assert-True ($myAdoptHtml -match '/api/adopt/page2' -and $myAdoptHtml -notmatch 'uid:\s*this\.user\.id' -and $myAdoptHtml -match 'status-text\.js' -and $myAdoptHtml -match 'StatusText\.adopt\(value\)') "batch 7 owner adoption: session-owned pagination and shared neutral state semantics"
Assert-True ($proofFrontHtml -match '/api/proof/page1' -and $proofFrontHtml -match 'paid\s*:\s*this\.aid' -and $proofFrontHtml -notmatch 'pageSize\s*:\s*100|\.filter\([^)]*item\.paid' -and $proofFrontHtml -match 'res\.data\s*!==\s*true' -and $proofFrontHtml -match "appendUploadPurpose\(upload,\s*'proof'\)") "batch 7 owner proof: server-side animal filtering, exact mutation success, and proof-purpose upload"
Assert-True ($myVisitHtml -match '/api/visit/mine' -and $myVisitHtml -notmatch 'uid\s*:\s*(this|view)\.user\.id|sessionStorage\.getItem' -and $myVisitHtml -match '回访方式：未记录' -and $myVisitHtml -notmatch '上门/电话|startsWith\(') "batch 7 owner visit: authoritative session, safe file flags, and no unsupported method claim"
foreach ($batch7Admin in @(
    @{ Name = 'admin adopt'; Html = $adminAdoptHtml; Flag = 'adopt' },
    @{ Name = 'admin proof'; Html = $adminProofHtml; Flag = 'proof' },
    @{ Name = 'admin visit'; Html = $adminVisitHtml; Flag = 'visit' }
)) {
    $pageGatePattern = 'hasFlag\(user,\s*[''"]' + [regex]::Escape($batch7Admin.Flag) + '[''"]\)'
    Assert-True ($batch7Admin.Html -match $pageGatePattern -and $batch7Admin.Html -match 'AdminWorkspace\.navigation\(user\.permission\)' -and $batch7Admin.Html -notmatch 'permission\.path|item\.path') "$($batch7Admin.Name): fixed permission navigation and page gate"
    Assert-True ($batch7Admin.Html -match 'admin-record-table' -and $batch7Admin.Html -match 'admin-record-cards' -and $batch7Admin.Html -match 'res\.data\s*!==\s*true') "$($batch7Admin.Name): responsive action parity and exact Boolean mutation success"
}
$visitUpdatePayload = [regex]::Match($adminVisitHtml, 'var payload\s*=\s*\{[\s\S]*?\};\s*vm\.saving').Value
Assert-True ($visitUpdatePayload -match 'id\s*:\s*vm\.form\.id' -and $visitUpdatePayload -notmatch '\b(petId|uid|aname)\s*:') "admin visit: update payload cannot transfer adoption relationship"
Assert-True ($adminProofHtml -match 'var payload\s*=\s*\{\s*id\s*:\s*vm\.form\.id,\s*ptitle\s*:\s*vm\.form\.ptitle,\s*ppic\s*:\s*vm\.form\.ppic' -and $adminProofHtml -notmatch '证书编号|签发日期|发行人|颁发机构') "admin proof: narrow mutable payload without fake certificate issuance fields"
Assert-True ($adminAdoptHtml -match '/api/adopt/["'']?\s*\+' -and $adminAdoptHtml -match '/transition' -and $adminAdoptHtml -match 'stateText\s*:\s*function\s*\(v\)[\s\S]*?StatusText\.adopt\(v\)' -and $adminAdoptHtml -match 'appendUploadPurpose\(d,\s*"visit"\)') "admin adopt: dedicated transition state machine, shared status text, and visit-purpose upload"
$draftSaveBlock = [regex]::Match($adminAdoptHtml, 'saveAiDraft:\s*function[\s\S]*?discardAiDraft:\s*function').Value
$draftFinalizeBlock = [regex]::Match($adminAdoptHtml, 'finalizeAiDraft:\s*function[\s\S]*?generateAiDraft:\s*function').Value
$draftServiceJava = Read-Utf8 (Join-Path $root "src/main/java/com/example/service/AdminAgentDraftService.java")
$draftRepositoryJava = Read-Utf8 (Join-Path $root "src/main/java/com/example/service/AdminAgentDraftRepository.java")
$adminAgentControllerJava = Read-Utf8 (Join-Path $root "src/main/java/com/example/controller/AdminAgentController.java")
$schemaGuardJava = Read-Utf8 (Join-Path $root "src/main/java/com/example/component/SchemaGuardRunner.java")
Assert-True ($adminAdoptHtml -match 'canUseAgent:\s*AdminWorkspace\.hasFlag\(user,\s*"admin_agent"\)' -and ([regex]::Matches($adminAdoptHtml, 'openAiDraft\(item').Count -ge 2)) "admin adopt 3A: AI draft entry requires agent permission with desktop/mobile parity"
Assert-True ($adminAdoptHtml -match 'admin-workspace\.css\?v=20260809p' -and $adminWorkspaceCss -match '\.admin-agent-draft-boundary' -and $adminWorkspaceCss -match 'admin-agent-draft-verdict') "admin adopt 3B: cache-busted stylesheet contains the human-confirmation layout"
Assert-True ($adminAdoptHtml -match '/api/admin-agent/adoption-drafts/generate' -and $draftSaveBlock -match '/api/admin-agent/adoption-drafts/' -and $draftSaveBlock -notmatch '/api/adopt/audit/|askAction\(') "admin adopt 3A: draft generation and save cannot invoke approval or rejection endpoints"
Assert-True ($adminAdoptHtml -match '保存仍只更新个人草稿' -and $adminAdoptHtml -match '进入人工确认' -and $adminWorkspaceCss -match '\.admin-agent-draft-boundary' -and $adminWorkspaceCss -match '@media\s*\(max-width:\s*600px\)[\s\S]*?\.admin-agent-draft-verdict') "admin adopt 3A: saving a draft remains non-mutating and responsive"
Assert-True ($draftFinalizeBlock -match '/api/admin-agent/adoption-drafts/' -and $draftFinalizeBlock -match '/finalize' -and $draftFinalizeBlock -notmatch '/api/adopt/audit/|askAction\(') "admin adopt 3B: browser submits only the dedicated human-confirmation endpoint"
Assert-True ($adminAdoptHtml -match '完整申请资料（仅授权管理员可见）' -and $adminAdoptHtml -match 'reviewedApplication' -and $adminAdoptHtml -match 'acknowledgeConsequences' -and $adminAdoptHtml -match 'aiFinalizeNeedsReason') "admin adopt 3B: full evidence, explicit decision, consequences, and override reason are required"
Assert-True ($draftFinalizeBlock -match 'requestId:\s*vm\.aiFinalizeRequestId' -and $adminAdoptHtml -match 'aiFinalizeRequestId\s*=\s*this\.requestId\(\)') "admin adopt 3B: one stable finalize request id survives response-loss retries"
Assert-True ($draftServiceJava -match '@Transactional[\s\S]*?finalizeDraft' -and $draftServiceJava -match 'adoptService\.transition' -and $draftServiceJava -match 'drafts\.markFinalized' -and $draftServiceJava.IndexOf('adoptService.transition') -lt $draftServiceJava.IndexOf('drafts.markFinalized')) "admin adopt 3B: workflow state machine and execution credential share one transaction"
Assert-True ($draftServiceJava -match 'requireDraftPermission\(actor\)' -and $draftServiceJava -match 'reviewedApplication' -and $draftServiceJava -match 'acknowledgeConsequences' -and $draftServiceJava -notmatch 'client\.generateAdoptionDraft[\s\S]{0,800}finalizeDraft') "admin adopt 3B: permissions and human acknowledgements precede execution without an AI write call"
Assert-True ($draftRepositoryJava -match "status='executed'" -and $draftRepositoryJava -match 'final_request_id' -and $draftRepositoryJava -match 'expectedVersion' -and $adminAgentControllerJava -match '/adoption-drafts/\{id\}/finalize') "admin adopt 3B: executed drafts are versioned, idempotent, and exposed through a narrow endpoint"
Assert-True ($schemaGuardJava -match 'operations-p2-v12' -and $schemaGuardJava -match 'uk_admin_agent_draft_final_request' -and $schemaGuardJava -match 'override_reason') "admin adopt 3B: current schema preserves unique execution requests and human override evidence"
$automationServiceJava = Read-Utf8 (Join-Path $root "src/main/java/com/example/service/AdminAgentAutomationService.java")
$automationExecutorJava = Read-Utf8 (Join-Path $root "src/main/java/com/example/service/AdminAgentAutomationExecutor.java")
$automationPolicyJava = Read-Utf8 (Join-Path $root "src/main/java/com/example/service/AdminAgentAutomationPolicy.java")
Assert-True ($adminAgentHtml -match 'v-if="status\.canConfigure"[\s\S]{0,240}openAutomation' -and $adminAgentHtml -match '/api/admin-agent/automation/run' -and $adminAgentHtml -notmatch '/api/adopt/audit/') "admin agent 3C: control entry is super-admin surfaced and browser has no direct adoption write endpoint"
Assert-True ($adminAgentHtml -match 'automationDirty' -and $adminAgentHtml -match 'automationRunReady' -and $adminAgentHtml -match '!automationRunReady' -and $adminAgentHtml -match '自动驳回永久为 0' -and $adminWorkspaceCss -match '\.admin-agent-automation-dialog' -and $adminWorkspaceCss -match '@media\s*\(max-width:\s*600px\)[\s\S]*?\.admin-agent-automation-dialog') "admin agent 3C: unsaved or unconfirmed guarded runs stay disabled and the control plane is responsive"
Assert-True ($automationServiceJava -match 'requireSuperAdmin\(actor\)' -and $automationServiceJava -match 'maxBatch < 1 \|\| maxBatch > 3' -and $automationServiceJava -match '"shadow"\.equals\(run\.getMode\(\)\)' -and $automationServiceJava -notmatch 'auditAdopt\([^\)]*,\s*2\)') "admin agent 3C: super-admin-only, bounded, shadow-safe, and contains no automatic rejection path"
Assert-True ($automationExecutorJava -match '@Transactional[\s\S]*?autoApprove' -and $automationExecutorJava -match 'repository\.lockConfig' -and $automationExecutorJava -match 'tools\.adoptionDraftContext' -and $automationExecutorJava -match 'adoptService\.auditSolePendingAdopt\(animalId, applicantId, actor\)') "admin agent 3C: write transaction rechecks emergency switch and live minimized context before sole-pending approve state machine"
Assert-True ($automationPolicyJava -match 'privacy_minimized' -and $automationPolicyJava -match 'adult_confirmed' -and $automationPolicyJava -match 'household_agreement' -and $automationPolicyJava -match 'pending_applications_for_animal' -and $automationPolicyJava -match '"approve"\.equals' -and $automationPolicyJava -match '"low"\.equals') "admin agent 3C: deterministic hard gates constrain model output and competing applications"
Assert-True ($schemaGuardJava -match 't_admin_agent_automation_config' -and $schemaGuardJava -match 't_admin_agent_automation_run' -and $schemaGuardJava -match 't_admin_agent_automation_item' -and $schemaGuardJava -match 'uk_admin_agent_automation_request') "admin agent 3C: v9 schema persists safe default, idempotent runs, and item evidence"
foreach ($preMountPage in @(
    @{ Name = 'adopt apply'; Html = $adoptApplyHtml },
    @{ Name = 'my adopt'; Html = $myAdoptHtml },
    @{ Name = 'owner proof'; Html = $proofFrontHtml }
)) {
    Assert-True ($preMountPage.Html -match 'AuthSession\.bootstrap[\s\S]*?onDone\s*:\s*function[\s\S]*?new Vue' -and $preMountPage.Html.IndexOf('AuthSession.bootstrap') -lt $preMountPage.Html.IndexOf('new Vue')) "$($preMountPage.Name): authoritative auth completes before Vue mount"
}
Assert-True ($adoptApplyHtml -match 'res\.data===true|res\.data\s*===\s*true') "batch 7 adoption submit: exact Boolean success prevents false redirect"
Assert-True ($adoptApplyHtml -match '\[0,1\]\.includes\(Number\(animal\.tstate\)\)' -and $adoptApplyHtml -match '仍可提交' -and $animalDetailHtml -match '\[0,\s*1\]\.includes\(Number\(this\.animal\.tstate\)\)') "batch 7 adoption competition: applying animals remain honestly open to additional applicants"
Assert-True ($proofFrontHtml -match '/api/adopt/mine/' -and $proofFrontHtml -notmatch '/api/adopt/page2' -and $proofFrontHtml -match '\[1,\s*3\]\.includes\(Number\(relation\.vstate\)\)' -and $proofFrontHtml -match '/api/files/staged/') "batch 7 owner proof: material-required or pending-handover preflight and staged upload cleanup"
Assert-True ($adminAdoptHtml -match 'canVisit\s*:\s*AdminWorkspace\.hasFlag\(user,\s*"visit"\)' -and $adminAdoptHtml -match 'vstate\)===4&&canVisit' -and ([regex]::Matches($adminAdoptHtml, "askAction\(item,'reject'").Count -ge 2)) "admin adopt: completed-only visit gate and mobile rejection parity"
Assert-True (([regex]::Matches($adminProofHtml, 'askAudit\(item,2').Count -ge 2) -and $adminProofHtml -match '/api/files/staged/' -and $adminVisitHtml -match '/api/files/staged/') "admin proof and visit: mobile rejection parity and staged upload cleanup"

$volunteerApplyHtml = Read-Utf8 (Join-Path $staticRoot "page/front/volunteer_apply.html")
$myVolunteerHtml = Read-Utf8 (Join-Path $staticRoot "page/front/my_volunteer.html")
$volunteerPayloadMatch = [regex]::Match($volunteerApplyHtml, 'mutablePayload:\s*function[\s\S]*?uploadPhoto:\s*function')
$volunteerPayload = $volunteerPayloadMatch.Value
foreach ($volunteerPage in @(
    @{ Name = "volunteer apply"; Html = $volunteerApplyHtml },
    @{ Name = "my volunteer"; Html = $myVolunteerHtml },
    @{ Name = "admin volunteer"; Html = $adminVolunteerHtml }
)) {
    Assert-True ($volunteerPage.Html -match 'AuthSession\.bootstrap\s*\(\s*\{\s*requireAuth\s*:\s*true[\s\S]*?allowCachedOnNetworkError\s*:\s*false') "$($volunteerPage.Name): authoritative bootstrap fails closed before Vue mount"
}
# Phase 3E equivalent: FormData variable may be formData or upload; purpose remains volunteer.
Assert-True (
    ($volunteerApplyHtml -match "append\('file'," -and $volunteerApplyHtml -match "appendUploadPurpose\((formData|upload),\s*'volunteer'\)") -and
    $volunteerApplyHtml -match "url:\s*'/api/files/upload'"
) "volunteer apply: optional photo uses the volunteer upload purpose"
Assert-True ($volunteerApplyHtml -match "url:\s*'/api/volunteer'[\s\S]*?type:\s*'POST'" -and $volunteerPayloadMatch.Success -and $volunteerPayload -match '\b(age|wechat|company|location|sparetime|isvisit|moreability)\s*:' -and $volunteerPayload -notmatch '\b(id|uid|username|name|tel|email|vstate|state)\s*:') "volunteer apply: payload excludes authoritative account identity and server-owned status"
Assert-True ($volunteerApplyHtml -match 'id="volunteerName"[^>]*readonly' -and $volunteerApplyHtml -match 'id="volunteerTel"[^>]*readonly' -and $volunteerApplyHtml -match 'id="volunteerEmail"[^>]*readonly' -and $volunteerApplyHtml -match '\^1\[3-9\]\\d\{9\}\$' -and $volunteerApplyHtml -match '前往个人资料更新') "volunteer apply: authoritative identity is read-only with backend-matching phone guidance"
Assert-True (
    $volunteerApplyHtml -match 'for="volunteerCompany">工作单位\s*<small>必填' -and
    $volunteerApplyHtml -match "errors\.company\s*=\s*'请填写工作单位"
) "volunteer apply: company is visibly and programmatically required"
# Gate/existing-application check must use session-owned /mine without identity selectors.
Assert-True (
    $volunteerApplyHtml -match "url:\s*'/api/volunteer/mine'" -and
    $volunteerApplyHtml -match "pageNum:\s*1" -and
    $volunteerApplyHtml -match "pageSize:\s*(1|20)" -and
    $volunteerApplyHtml -notmatch '\b(username|phone|email)\s*:\s*this\.user'
) "volunteer apply: existing count relies on session-owned mine endpoint"
Assert-True (
    $myVolunteerHtml -match "url:\s*'/api/volunteer/mine'" -and
    $myVolunteerHtml -match "pageNum:\s*page" -and
    $myVolunteerHtml -match "pageSize:\s*(vm|view)\.pageSize" -and
    $myVolunteerHtml -notmatch '\b(username|phone|email|uid)\s*:\s*(this|vm|view)\.user'
) "my volunteer: pagination has no cached identity filter"
Assert-True ($myVolunteerHtml -match "\{\s*0:\s*'待审核',\s*1:\s*'已通过',\s*2:\s*'未通过'\s*\}" -and $myVolunteerHtml -match 'ui-volunteer-record-card') "my volunteer: actual states and responsive records are explicit"
Assert-True ($adminVolunteerHtml -match "hasFlag\(authenticatedUser,\s*'volunteer'\)" -and $adminVolunteerHtml -match 'AdminWorkspace\.navigation\(authenticatedUser\.permission\)' -and $adminVolunteerHtml -notmatch 'permission\.path|item\.path') "admin volunteer: fixed route map and client permission gate complement the server page gate"
Assert-True ($adminVolunteerHtml -match "url:\s*'/api/volunteer/page'[\s\S]*?pageSize:\s*vm\.pageSize" -and $adminVolunteerHtml -match 'pageSize:\s*12' -and $adminVolunteerHtml -notmatch '/api/volunteer["'']\s*,\s*type:\s*["'']GET') "admin volunteer: only bounded management pagination is read"
Assert-True ($adminVolunteerHtml -match "url:\s*'/api/volunteer/'\s*\+\s*encodeURIComponent\(vm\.auditItem\.id\)\s*\+\s*'/state/'\s*\+\s*encodeURIComponent\(vm\.auditState\)[\s\S]*?type:\s*'PUT'" -and $adminVolunteerHtml -notmatch 'auditPayload:\s*function' -and $adminVolunteerHtml -notmatch 'JSON\.stringify\([^\)]*(uid|vstate)') "admin volunteer: audit uses the dedicated state endpoint without identity or state payload fields"
Assert-True ($adminVolunteerHtml -match '角色影响提示' -and $adminVolunteerHtml -match '按系统配置' -and $adminVolunteerHtml -match '可审计的状态调整' -and $adminVolunteerHtml -match 'impactAcknowledged' -and $adminVolunteerHtml -match '确认变更状态') "admin volunteer: audited transitions use configuration-qualified role-impact acknowledgement"
Assert-True ($adminWorkspaceCss -match '@media\s*\(max-width:\s*960px\)[\s\S]*?\.admin-volunteer-table\s*\{\s*display:\s*none' -and $adminWorkspaceCss -match '\.admin-volunteer-cards\s*\{\s*display:\s*grid') "admin volunteer: sensitive wide table becomes cards and detail on mobile"

$animalBrowseHtml = Read-Utf8 (Join-Path $staticRoot "page/front/animal_browse.html")
Assert-True ($animalBrowseHtml -match "type:\s*this\.typeFilter" -and $animalBrowseHtml -notmatch 'displayAnimals') "animal browse: type filter and pagination share the server query"
Assert-True ($animalBrowseHtml -match 'maxlength="100"' -and $animalBrowseHtml -match '_animalsGeneration' -and $animalBrowseHtml -match '_animalsRequest\.abort\(\)' -and $animalBrowseHtml -match "status\s*===\s*'abort'") "animal browse: bounded search and stale request cancellation are enforced"
Assert-True ($animalBrowseHtml -match 'xhr\.responseJSON\s*&&\s*xhr\.responseJSON\.msg' -and $animalBrowseHtml -match 'status-text\.js' -and $animalBrowseHtml -match 'StatusText\.animal\(value\)' -and $animalBrowseHtml -match 'item\.tstate') "animal browse: backend errors and canonical tstate labels are visible"
$animalControllerSource = Read-Utf8 (Join-Path $root "src/main/java/com/example/controller/AnimalController.java")
Assert-True ($animalControllerSource -match 'MAX_PUBLIC_PAGE_SIZE\s*=\s*50' -and $animalControllerSource -match 'Math\.min\(pageSize,\s*MAX_PUBLIC_PAGE_SIZE\)') "animal API: anonymous page size is capped"

if (-not $SkipHttp) {
    Write-Host "=== HTTP adversarial probes ($BaseUrl) ===" -ForegroundColor Cyan
    foreach ($page in $pages | Where-Object { $_.Public }) {
        try {
            $response = Invoke-WebRequest -Uri "$BaseUrl/$($page.Path)" -UseBasicParsing -MaximumRedirection 0 -TimeoutSec 8
            Assert-True ($response.StatusCode -eq 200) "$($page.Path): anonymous HTTP 200"
            Assert-True ($response.Content -match 'product-ui\.css') "$($page.Path): current migrated build served"
        } catch {
            Fail "$($page.Path): anonymous request failed ($($_.Exception.Message))"
        }
    }

    try {
        $rootRequest = [System.Net.HttpWebRequest]::Create("$BaseUrl/")
        $rootRequest.AllowAutoRedirect = $false
        $rootResponse = $rootRequest.GetResponse()
        $rootLocation = [string]$rootResponse.Headers["Location"]
        $rootStatus = [int]$rootResponse.StatusCode
        $rootResponse.Close()
        Assert-True ($rootStatus -eq 302 -and $rootLocation.EndsWith("/page/front/index.html")) "site root: one redirect to canonical public home"
    } catch {
        Fail "site root: canonical redirect probe failed ($($_.Exception.Message))"
    }

    try {
        $response = Invoke-WebRequest -Uri "$BaseUrl/api/dashboard/home-stats" -UseBasicParsing -TimeoutSec 8
        $json = $response.Content | ConvertFrom-Json
        $names = @($json.data.PSObject.Properties.Name | Sort-Object)
        $expected = @("adoptedAnimals", "approvedVolunteers", "availableAnimals" | Sort-Object)
        Assert-True ($json.code -eq "0" -and ($names -join ',') -eq ($expected -join ',')) "/api/dashboard/home-stats: exact truthful public aggregate contract"
    } catch {
        Fail "/api/dashboard/home-stats: public aggregate request failed ($($_.Exception.Message))"
    }

    foreach ($privateAnimalPath in @("/api/animal", "/api/animal/page?pageNum=1&pageSize=1")) {
        try {
            Invoke-WebRequest -Uri "$BaseUrl$privateAnimalPath" -UseBasicParsing -TimeoutSec 8 | Out-Null
            Fail "${privateAnimalPath}: anonymous management read unexpectedly succeeded"
        } catch {
            $status = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { 0 }
            Assert-True ($status -eq 401) "${privateAnimalPath}: anonymous management read rejected"
        }
    }

    $protectedPages = @($pages | Where-Object { -not $_.Public })
    foreach ($page in $protectedPages) {
        try {
            $request = [System.Net.HttpWebRequest]::Create("$BaseUrl/$($page.Path)")
            $request.AllowAutoRedirect = $false
            $request.Timeout = 8000
            $response = $request.GetResponse()
            $status = [int]$response.StatusCode
            $location = [string]$response.Headers["Location"]
            $response.Close()
            $absoluteLocation = if ($location.StartsWith("/")) { $BaseUrl.TrimEnd("/") + $location } else { $location }
            $target = [Uri]$absoluteLocation
            $redirectValue = if ($target.Query -match '(?:^|[?&])redirect=([^&]+)') { [Uri]::UnescapeDataString($matches[1]) } else { "" }
            $sameOrigin = $target.GetLeftPart([System.UriPartial]::Authority) -eq ([Uri]$BaseUrl).GetLeftPart([System.UriPartial]::Authority)
            $loginRedirect = $sameOrigin -and $target.AbsolutePath -eq "/page/front/login.html" -and $redirectValue.StartsWith("/$($page.Path)")
            Assert-True ($status -eq 302 -and $loginRedirect) "$($page.Path): anonymous request redirects to login with original path (location=$location)"
        } catch {
            Fail "$($page.Path): anonymous redirect probe failed ($($_.Exception.Message))"
        }
    }

    try {
        . (Join-Path $PSScriptRoot "lib-session.ps1")
        $appSession = New-AppSession -BaseUrl $BaseUrl -Username $UserName -Password $UserPass
        Assert-True ($null -ne $appSession.User -and $null -ne $appSession.User.id) "protected pages: Cookie-only test session established"
        $userAccessiblePages = @($protectedPages | Where-Object {
            -not $_.Workspace -or $_.Path -in @('page/end/index.html', 'page/end/person.html')
        })
        $adminOnlyPages = @($protectedPages | Where-Object {
            $_.Workspace -and $_.Path -notin @('page/end/index.html', 'page/end/person.html')
        })
        foreach ($page in $userAccessiblePages) {
            try {
                $response = Invoke-WebRequest -Uri "$BaseUrl/$($page.Path)" -UseBasicParsing -WebSession $appSession.Session -MaximumRedirection 0 -TimeoutSec 8
                Assert-True ($response.StatusCode -eq 200) "$($page.Path): authenticated HTTP 200"
                Assert-True ($response.Content -match 'product-ui\.css') "$($page.Path): authenticated migrated build served"
            } catch {
                Fail "$($page.Path): authenticated request failed ($($_.Exception.Message))"
            }
        }

        foreach ($page in $adminOnlyPages) {
            try {
                $request = [System.Net.HttpWebRequest]::Create("$BaseUrl/$($page.Path)")
                $request.AllowAutoRedirect = $false
                $request.Timeout = 8000
                $request.CookieContainer = $appSession.Session.Cookies
                $response = $request.GetResponse()
                $status = [int]$response.StatusCode
                $location = [string]$response.Headers["Location"]
                $response.Close()
                # operations uses multi-flag guard -> error=forbidden; classic admin pages -> error=need_admin
                $isDeniedRedirect = $status -eq 302 -and $location -match '/page/end/index\.html\?error=(need_admin|forbidden)'
                Assert-True $isDeniedRedirect "$($page.Path): ordinary user is denied by the server"
            } catch {
                $status = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { 0 }
                Assert-True ($status -eq 403) "$($page.Path): ordinary user is denied by the server"
            }
        }

        $adminSession = New-AppSession -BaseUrl $BaseUrl -Username $AdminName -Password $AdminPass
        Assert-True ($null -ne $adminSession.User -and $null -ne $adminSession.User.id) "admin pages: Cookie-only admin session established"
        foreach ($page in $adminOnlyPages) {
            try {
                $response = Invoke-WebRequest -Uri "$BaseUrl/$($page.Path)" -UseBasicParsing -WebSession $adminSession.Session -MaximumRedirection 0 -TimeoutSec 8
                Assert-True ($response.StatusCode -eq 200) "$($page.Path): admin HTTP 200"
                Assert-True ($response.Content -match 'product-ui\.css') "$($page.Path): admin migrated build served"
            } catch {
                Fail "$($page.Path): admin request failed ($($_.Exception.Message))"
            }
        }

        $forgedAdopt = @{
            aid = 10011; uid = 1; uname = "forged"; aname = "forged"; apic = "forged"; vstate = 1
            gender = "女"; age = 17; maritalstatus = 2; occupation = "测试"; tel = 13800138000
            location = "测试地址"; fixresident = 1; income = 5000; experience = 1
            petnum = 0; familyagree = 1; wechat = "test"
        }
        $forgedResult = Invoke-ApiJson -BaseUrl $BaseUrl -Path "/api/adopt" -AppSession $appSession -Method POST -BodyObject $forgedAdopt
        Assert-True ($forgedResult.StatusCode -eq 400 -and $forgedResult.Json -and $forgedResult.Json.code -eq "400") "/api/adopt: forged ownership/status and invalid age rejected before claim"
    } catch {
        Fail "protected pages: could not establish test session ($($_.Exception.Message))"
    }

    try {
        Invoke-WebRequest -Uri "$BaseUrl/api/adopt/page2?pageNum=1&pageSize=1&uid=1" -UseBasicParsing -TimeoutSec 8 | Out-Null
        Fail "/api/adopt/page2: anonymous request unexpectedly succeeded"
    } catch {
        $status = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { 0 }
        Assert-True ($status -eq 401) "/api/adopt/page2: anonymous request rejected"
    }

    $apiChecks = @(
        "/api/animal/page1?pageNum=1&pageSize=1",
        "/api/notice/page?pageNum=1&pageSize=1",
        "/api/account/public?pageNum=1&pageSize=1"
    )
    foreach ($api in $apiChecks) {
        try {
            $response = Invoke-WebRequest -Uri "$BaseUrl$api" -UseBasicParsing -TimeoutSec 8
            $json = $response.Content | ConvertFrom-Json
            Assert-True ($response.StatusCode -eq 200 -and $json.code -eq "0") "${api}: anonymous public API contract"
        } catch {
            Fail "${api}: public API request failed ($($_.Exception.Message))"
        }
    }

    try {
        $response = Invoke-WebRequest -Uri "$BaseUrl/api/animal/page1?type=%E7%8C%AB&pageNum=1&pageSize=5000" -UseBasicParsing -TimeoutSec 8
        $utf8Content = [System.Text.Encoding]::UTF8.GetString($response.RawContentStream.ToArray())
        $json = $utf8Content | ConvertFrom-Json
        $records = @($json.data.records)
        $allCats = @($records | Where-Object { $_.ttype -ne "猫" }).Count -eq 0
        Assert-True ($json.code -eq "0" -and $json.data.size -eq 50 -and $allCats) "/api/animal/page1: type results and capped pagination use one server query"
    } catch {
        Fail "/api/animal/page1: filtered consistency probe failed ($($_.Exception.Message))"
    }

    try {
        Invoke-WebRequest -Uri "$BaseUrl/api/user/logout" -UseBasicParsing -MaximumRedirection 0 -TimeoutSec 8 | Out-Null
        Fail "GET /api/user/logout: must reject state-changing GET"
    } catch {
        $status = [int]$_.Exception.Response.StatusCode
        Assert-True ($status -eq 401 -or $status -eq 405) "GET /api/user/logout: rejected without state change"
    }
}

Write-Host "=== frontend adversarial result: pass=$passed fail=$failed ===" -ForegroundColor Cyan
if ($failed -gt 0) { exit 1 }
exit 0
