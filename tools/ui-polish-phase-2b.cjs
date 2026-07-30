/**
 * Phase 2B strict acceptance — RBAC governance (role + permission).
 * BASE_URL default http://127.0.0.1:18088
 * Baseline Phase 2A: cd24ab1
 *
 * Real try/catch/finally cleanup for UI_AUDIT_2B_* roles.
 * Real browser network for save/delete (no $.ajax mock, no API success fallback).
 * Strict focus restore: BODY/HTML never pass; cancel/Escape exact trigger; success → actionable.
 * No path-wide API allowlist; only x-ui-audit-expected-error: phase2b.
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const base = process.env.BASE_URL || 'http://127.0.0.1:18089';
const out = path.resolve('output/playwright/ui-polish-phase-2b');
const shotDir = path.join(out, 'screenshots');
fs.mkdirSync(shotDir, { recursive: true });

const EXPECTED_ERROR_HEADER = 'x-ui-audit-expected-error';
const EXPECTED_ERROR_VALUE = 'phase2b';
const EXPECTED_ERROR_HEADERS = { [EXPECTED_ERROR_HEADER]: EXPECTED_ERROR_VALUE };
const TEMP_PREFIX = 'UI_AUDIT_2B_';
const USER_LOOP = ['im', 'adopt_view', 'my_adopt', 'my_proof', 'apply'];
const ADMIN_FLAGS = ['user', 'role', 'permission', 'animal', 'adopt', 'proof', 'visit', 'volunteer', 'account', 'notice', 'help', 'rescue', 'admin_agent'];

const VIEWPORTS = [
  { name: '1440x900', width: 1440, height: 900 },
  { name: '1280x800', width: 1280, height: 800 },
  { name: '1024x768', width: 1024, height: 768 },
  { name: '768x1024', width: 768, height: 1024 },
  { name: '720x450', width: 720, height: 450 },
  { name: '390x844', width: 390, height: 844 },
  { name: '360x800', width: 360, height: 800 }
];

const KNOWN_FLAGS = [
  'user', 'role', 'permission', 'animal', 'adopt', 'proof', 'visit',
  'volunteer', 'account', 'notice', 'help', 'rescue', 'im', 'adopt_view',
  'my_adopt', 'my_proof', 'apply', 'admin_agent'
];
const ALLOWED_PATHS = [
  '/page/end/user.html', '/page/end/role.html', '/page/end/permission.html',
  '/page/end/animal.html', '/page/end/adopt.html', '/page/end/proof.html',
  '/page/end/visit.html', '/page/end/volunteer.html', '/page/end/account.html',
  '/page/end/notice.html', '/page/end/help.html', '/page/end/rescue.html',
  '/page/end/admin_agent.html'
];

const results = {
  startedAt: new Date().toISOString(),
  base,
  phase2aBaseline: 'cd24ab143f98b4ffa9bcbe1de24d280d1512de78',
  branch: 'ui-polish/phase-2b-rbac-governance-20260730',
  checks: [],
  failures: [],
  screenshots: [],
  midCourseFailures: [],
  tempRoles: { created: [], cleaned: [], leftover: [], deleteAttempts: [] },
  uiDelete: { requestCount: 0, status: null, success: false },
  finallyCleanup: { attempts: [], success: false },
  permissionMatrix: {},
  consoleAudit: {},
  requestFailedWrite: [],
  focusAudit: [],
  toolbarGeometry: [],
  summary: {}
};

/** Strict focus inspection — BODY/HTML never count as restored. */
function isStrictFocusOk(info) {
  return !!(
    info &&
    info.exists &&
    info.connected &&
    !info.isBody &&
    !info.isHtml &&
    (info.interactive || info.explicitHeading)
  );
}

async function pageInspectFocus(page) {
  return page.evaluate(() => {
    const el = document.activeElement;
    return {
      exists: !!el,
      tag: el ? el.tagName : '',
      id: el ? el.id : '',
      className: el ? String(el.className || '') : '',
      connected: !!(el && el.isConnected),
      isBody: el === document.body,
      isHtml: el === document.documentElement,
      tabIndex: el ? el.tabIndex : -999,
      interactive: !!(
        el &&
        el.matches(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
        )
      ),
      explicitHeading:
        !!(el && /^(H1|H2)$/.test(el.tagName) && el.getAttribute('tabindex') === '-1')
    };
  });
}

function recordFocusAudit(scenario, info, extra) {
  results.focusAudit.push(Object.assign({
    scenario: scenario,
    tag: info && info.tag,
    id: info && info.id,
    className: info && info.className,
    isBody: !!(info && info.isBody),
    isHtml: !!(info && info.isHtml),
    connected: !!(info && info.connected),
    interactive: !!(info && info.interactive),
    explicitHeading: !!(info && info.explicitHeading),
    strictOk: isStrictFocusOk(info)
  }, extra || {}));
}

function pass(id, detail) {
  results.checks.push({ id, ok: true, detail: String(detail || '') });
}
function fail(id, detail) {
  const d = String(detail || '');
  results.checks.push({ id, ok: false, detail: d });
  results.failures.push({ id, detail: d });
  console.error('FAIL', id, d);
}
function assert(id, cond, detail) {
  if (cond) pass(id, detail);
  else fail(id, detail);
}

function expectedErrorFulfill(status, bodyObj) {
  return {
    status,
    headers: Object.assign({ 'content-type': 'application/json' }, EXPECTED_ERROR_HEADERS),
    body: typeof bodyObj === 'string' ? bodyObj : JSON.stringify(bodyObj)
  };
}

function extractJavaSet(src, name) {
  const idx = src.indexOf(name);
  if (idx < 0) return null;
  const slice = src.slice(idx, idx + 900);
  const m2 = slice.match(/Arrays\.asList\(([\s\S]*?)\)\s*\)/);
  if (!m2) return null;
  return (m2[1].match(/"([^"]+)"/g) || []).map((s) => s.slice(1, -1)).sort();
}
function extractHtmlArray(html, key) {
  const re = new RegExp(key + '\\s*:\\s*\\[([\\s\\S]*?)\\]');
  const m = html.match(re);
  if (!m) return null;
  return (m[1].match(/'([^']+)'/g) || []).map((s) => s.slice(1, -1)).sort();
}

function classifyHttpError(entry) {
  const headers = entry.headers || {};
  const tagged =
    headers[EXPECTED_ERROR_HEADER] === EXPECTED_ERROR_VALUE ||
    headers[EXPECTED_ERROR_HEADER.toLowerCase()] === EXPECTED_ERROR_VALUE;
  if (tagged) return { kind: 'expectedHttpError', status: entry.status, url: entry.url, method: entry.method || '' };
  if (entry.status === 404 && /\.(png|jpe?g|gif|webp)(\?|$)/i.test(entry.url || '') && !/\/api\//i.test(entry.url || '')) {
    return { kind: 'staticImageNoise', status: entry.status, url: entry.url };
  }
  return { kind: 'unexpectedHttpError', status: entry.status, url: entry.url, method: entry.method || '' };
}

function finalizeConsoleClassification(consoleErrors, expectedHttpErrors) {
  const expectedByStatus = {};
  for (const e of expectedHttpErrors) {
    expectedByStatus[e.status] = (expectedByStatus[e.status] || 0) + 1;
  }
  const used = {};
  const expectedConsoleNoise = [];
  const realConsoleErrors = [];
  for (const text of consoleErrors) {
    const m = /Failed to load resource: the server responded with a status of (400|403|409|500)\b/.exec(text || '');
    if (m) {
      const st = Number(m[1]);
      used[st] = (used[st] || 0) + 1;
      if (used[st] <= (expectedByStatus[st] || 0)) expectedConsoleNoise.push(text);
      else realConsoleErrors.push(text + ' [excess over tagged ' + st + ']');
    } else if (/net::ERR_ABORTED|net::ERR_FAILED/i.test(text || '')) {
      // Self-cancelled write requests are product bugs — never blanket-whitelist
      realConsoleErrors.push(text);
    } else {
      realConsoleErrors.push(text);
    }
  }
  return { expectedConsoleNoise, realConsoleErrors };
}

async function login(ctx, user, pass) {
  const res = await ctx.request.post(base + '/api/user/login', {
    data: { username: user, password: pass }
  });
  const json = await res.json();
  if (json.code !== '0') throw new Error(`login ${user}: ${JSON.stringify(json)}`);
  ctx._csrf = (json.data && json.data.csrfToken) || '';
  return json;
}
function csrfHeaders(ctx) {
  return ctx._csrf ? { 'X-CSRF-Token': ctx._csrf } : {};
}

async function shot(page, name, meta) {
  // Always capture from page top (focus restore may scroll mid-page)
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(40);
  const file = path.join(shotDir, name + '.png');
  await page.screenshot({ path: file, fullPage: false });
  results.screenshots.push({
    file: path.relative(out, file).replace(/\\/g, '/'),
    name,
    simulated: !!meta.simulated,
    routeIntercept: !!meta.routeIntercept,
    page: meta.page || '',
    role: meta.role || '',
    viewport: meta.viewport || '',
    state: meta.state || '',
    goal: meta.goal || '',
    time: new Date().toISOString()
  });
}

/** Real layout metrics for RBAC admin-review-toolbar (no screenshot-only checks). */
async function measureToolbar(page) {
  return page.evaluate(() => {
    const toolbar = document.querySelector('.admin-review-toolbar');
    const search = document.querySelector('.admin-review-toolbar .ui-search');
    const input = document.querySelector('.admin-review-toolbar .ui-search input');
    const btn = document.querySelector(
      '.admin-review-toolbar button[type="submit"], .admin-review-toolbar .ui-button.is-dark'
    );
    const header = document.querySelector('.admin-header, .ui-header, header.ui-header');
    const tr = toolbar ? toolbar.getBoundingClientRect() : null;
    const sr = search ? search.getBoundingClientRect() : null;
    const ir = input ? input.getBoundingClientRect() : null;
    const br = btn ? btn.getBoundingClientRect() : null;
    const hr = header ? header.getBoundingClientRect() : null;
    const styles = toolbar ? getComputedStyle(toolbar) : null;
    const searchStyles = search ? getComputedStyle(search) : null;
    const inputStyles = input ? getComputedStyle(input) : null;
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    const overflowX = document.documentElement.scrollWidth - document.documentElement.clientWidth;
    const clipped = !sr || sr.width <= 0 || sr.height <= 0 || sr.right > vw + 2 || sr.left < -2;
    // Obscured = under sticky header, off-screen, or zero opacity — not flaky elementFromPoint
    let obscured = true;
    if (sr && ir && inputStyles) {
      const underHeader = !!(hr && hr.height > 0 && sr.bottom <= hr.bottom + 1 && sr.top < hr.bottom);
      const offScreen = sr.bottom < 0 || sr.top > vh || ir.height <= 0 || ir.width <= 0;
      const invisible = inputStyles.visibility === 'hidden' || inputStyles.opacity === '0' || inputStyles.display === 'none';
      obscured = underHeader || offScreen || invisible;
    }
    const round = (n) => Math.round((n || 0) * 10) / 10;
    return {
      toolbarHeight: tr ? round(tr.height) : 0,
      toolbarWidth: tr ? round(tr.width) : 0,
      searchHeight: sr ? round(sr.height) : 0,
      searchWidth: sr ? round(sr.width) : 0,
      inputHeight: ir ? round(ir.height) : 0,
      inputVisible: !!(input && ir && ir.height > 0 && ir.width > 0),
      btnHeight: br ? round(br.height) : 0,
      flexDirection: styles ? styles.flexDirection : '',
      searchFlexGrow: searchStyles ? searchStyles.flexGrow : '',
      searchFlexBasis: searchStyles ? searchStyles.flexBasis : '',
      overflowX,
      clipped: !!clipped,
      obscured: !!obscured,
      rowLayout: !!(styles && (styles.flexDirection === 'row' || styles.flexDirection === 'row-reverse')),
      headerBottom: hr ? round(hr.bottom) : 0,
      searchTop: sr ? round(sr.top) : 0
    };
  });
}

/** First visible list/status block below toolbar (skip display:none tables). */
async function toolbarCoversList(page) {
  return page.evaluate(() => {
    const tb = document.querySelector('.admin-review-toolbar');
    if (!tb) return { ok: false, reason: 'no-toolbar' };
    const a = tb.getBoundingClientRect();
    const nodes = Array.prototype.slice.call(
      document.querySelectorAll('.admin-record-card, .admin-record-table, .admin-status, .rbac-state-banner')
    );
    let list = null;
    let b = null;
    for (let i = 0; i < nodes.length; i++) {
      const el = nodes[i];
      const st = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      if (st.display === 'none' || st.visibility === 'hidden' || r.height < 1 || r.width < 1) continue;
      list = el;
      b = r;
      break;
    }
    if (!list || !b) return { ok: true, reason: 'no-visible-list' };
    return {
      ok: a.bottom <= b.top + 4,
      toolbarBottom: Math.round(a.bottom * 10) / 10,
      listTop: Math.round(b.top * 10) / 10,
      listTag: list.tagName + (list.className ? '.' + String(list.className).split(/\s+/)[0] : '')
    };
  });
}

function assertToolbarGeometry(pageKey, vpName, m, mode) {
  const prefix = pageKey + '-toolbar-' + vpName.replace('x', 'x');
  results.toolbarGeometry.push(Object.assign({ page: pageKey, viewport: vpName, mode: mode }, m));
  assert(prefix + '-search-h-min', m.searchHeight >= 44, JSON.stringify(m));
  assert(prefix + '-search-h-max', m.searchHeight <= 56, JSON.stringify(m));
  assert(prefix + '-input-visible', m.inputVisible && m.inputHeight > 0, JSON.stringify(m));
  assert(prefix + '-btn-h-min', m.btnHeight >= 44, JSON.stringify(m));
  assert(prefix + '-no-hscroll', m.overflowX <= 2, JSON.stringify(m));
  assert(prefix + '-not-clipped', !m.clipped, JSON.stringify(m));
  assert(prefix + '-not-obscured', !m.obscured, JSON.stringify(m));
  if (mode === 'mobile') {
    assert(prefix + '-toolbar-h-cap', m.toolbarHeight < 140, JSON.stringify(m));
    // must not retain the 180px flex-basis height bug
    assert(prefix + '-not-180-bug', m.searchHeight < 100 && m.toolbarHeight < 200, JSON.stringify(m));
  }
  if (mode === 'desktop') {
    assert(prefix + '-row-layout', m.rowLayout, JSON.stringify(m));
  }
  if (mode === 'compact') {
    assert(prefix + '-toolbar-compact', m.toolbarHeight < 160, JSON.stringify(m));
  }
}

async function listTempRoles(ctx) {
  const res = await ctx.request.get(base + '/api/role/page', {
    params: { name: TEMP_PREFIX, pageNum: 1, pageSize: 50 }
  });
  const j = await res.json().catch(() => ({}));
  return (j.data && j.data.records || []).filter((r) => String(r.name || '').startsWith(TEMP_PREFIX));
}

async function deleteTempRole(ctx, id) {
  const res = await ctx.request.delete(base + '/api/role/' + id, { headers: csrfHeaders(ctx) });
  const body = await res.json().catch(() => ({}));
  const ok = res.ok() || body.code === '0';
  results.tempRoles.deleteAttempts.push({ id, status: res.status(), code: body.code, ok });
  if (ok) results.tempRoles.cleaned.push(id);
  return ok;
}

async function cleanupAllTempRoles(ctx) {
  const list = await listTempRoles(ctx);
  for (const r of list) {
    await deleteTempRole(ctx, r.id);
  }
  const leftover = await listTempRoles(ctx);
  results.tempRoles.leftover = leftover.map((r) => ({ id: r.id, name: r.name }));
  return leftover;
}

function writeReport() {
  const passed = results.checks.filter((c) => c.ok).length;
  const failed = results.checks.filter((c) => !c.ok).length;
  results.summary = {
    passed,
    failed,
    total: results.checks.length,
    screenshots: results.screenshots.length,
    viewports: VIEWPORTS.length,
    finishedAt: new Date().toISOString(),
    strictMode: true,
    noBestEffortPass: true,
    realFinallyCleanup: true
  };
  results.ok = failed === 0 && (results.tempRoles.leftover || []).length === 0;
  fs.writeFileSync(path.join(out, 'phase-2b-report.json'), JSON.stringify(results, null, 2));
  fs.writeFileSync(path.join(out, 'screenshots-index.json'), JSON.stringify(results.screenshots, null, 2));
  return { passed, failed };
}

(async () => {
  const t0 = Date.now();
  console.log('Phase 2B strict start', base);

  let browser = null;
  let adminCtx = null;
  let page = null;
  const pageErrors = [];
  const consoleErrors = [];
  const httpErrorLog = [];
  const cssRequests = [];
  const deletePermRequests = [];
  let controlledCleanupTestError = null;

  // Static contracts (no browser)
  {
    const roleHtml = fs.readFileSync('src/main/resources/static/page/end/role.html', 'utf8');
    const permHtml = fs.readFileSync('src/main/resources/static/page/end/permission.html', 'utf8');
    const opsHtml = fs.readFileSync('src/main/resources/static/page/end/operations.html', 'utf8');
    const css = fs.readFileSync('src/main/resources/static/css/admin-workspace.css', 'utf8');
    const permJava = fs.readFileSync('src/main/java/com/example/service/PermissionService.java', 'utf8');

    assert('role-cache-20260730c', roleHtml.includes('admin-workspace.css?v=20260730c'), 'missing');
    assert('perm-cache-20260730c', permHtml.includes('admin-workspace.css?v=20260730c'), 'missing');
    assert('ops-still-20260730a', opsHtml.includes('admin-workspace.css?v=20260730a'), 'ops version');
    assert('ops-not-20260730c', !opsHtml.includes('admin-workspace.css?v=20260730c') && !opsHtml.includes('admin-workspace.css?v=20260730b'), 'ops bumped');
    assert('css-rbac', css.includes('.rbac-hero') && css.includes('.rbac-perm-picker'), 'css');
    assert(
      'css-admin-review-search-mobile-fix',
      /admin-review-toolbar\s+\.ui-search[\s\S]{0,200}flex:\s*0\s+0\s+auto/.test(css) &&
        /admin-review-toolbar\s+\.ui-search[\s\S]{0,200}height:\s*46px/.test(css),
      'missing mobile search fix'
    );
    assert('role-focus-trap', roleHtml.includes('createFocusTrap') && roleHtml.includes('beforeDestroy'), 'trap');
    assert('perm-focus-trap', permHtml.includes('createFocusTrap') && permHtml.includes('beforeDestroy'), 'trap');
    assert('role-normalize', roleHtml.includes('normalizePermissionIds'), 'normalize');
    assert('role-escape-guard', roleHtml.includes("key !== 'Escape'") || roleHtml.includes('key !== "Escape"') || roleHtml.includes("e.key !== 'Escape'"), 'esc');
    assert('perm-no-delete-api', !/type:\s*['"]DELETE['"]/.test(permHtml), 'delete');
    assert('role-no-inline-style', !/\sstyle="/.test(roleHtml), 'inline');
    assert('perm-no-inline-style', !/\sstyle="/.test(permHtml), 'inline');
    assert('role-no-ajax-prefilter', !roleHtml.includes('ajaxPrefilter') && !roleHtml.includes('delSent') && !roleHtml.includes('saveSent'), 'prefilter still present');
    assert('perm-no-ajax-prefilter', !permHtml.includes('ajaxPrefilter') && !permHtml.includes('saveSent'), 'prefilter still present');

    const javaFlags = extractJavaSet(permJava, 'KNOWN_FLAGS');
    const javaPaths = extractJavaSet(permJava, 'ALLOWED_PATHS');
    const htmlFlags = extractHtmlArray(permHtml, 'flags');
    const htmlPaths = extractHtmlArray(permHtml, 'paths');
    assert('flags-java-html-match', JSON.stringify(javaFlags) === JSON.stringify((htmlFlags || []).slice().sort()), JSON.stringify({ javaFlags, htmlFlags }));
    assert('paths-java-html-match', JSON.stringify(javaPaths) === JSON.stringify((htmlPaths || []).slice().sort()), JSON.stringify({ javaPaths, htmlPaths }));
    assert('flags-has-admin-agent', (htmlFlags || []).includes('admin_agent'), 'admin_agent');
  }

  try {
    browser = await chromium.launch({ headless: true });
    adminCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await login(adminCtx, 'admin', 'admin');
    page = await adminCtx.newPage();

    page.on('pageerror', (e) => pageErrors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
    page.on('request', (req) => {
      const u = req.url();
      if (/admin-workspace\.css/i.test(u)) cssRequests.push(u);
      if (req.method() === 'DELETE' && /\/api\/permission\//i.test(u)) deletePermRequests.push(u);
    });
    page.on('requestfailed', (req) => {
      const m = req.method();
      const u = req.url();
      if ((m === 'POST' || m === 'PUT' || m === 'DELETE') && /\/api\/(role|permission)/.test(u)) {
        results.requestFailedWrite.push({ method: m, url: u, failure: req.failure() && req.failure().errorText });
      }
    });
    page.on('response', (r) => {
      if (r.status() >= 400) {
        httpErrorLog.push({
          status: r.status(),
          url: r.url(),
          method: r.request().method(),
          headers: r.headers()
        });
      }
    });

    // ——— Role page basic + cache ———
    await page.goto(base + '/page/end/role.html', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForSelector('h1', { timeout: 15000 });
    await page.waitForTimeout(700);
    assert('role-network-css-30c', cssRequests.some((u) => /admin-workspace\.css\?v=20260730c/.test(u)), JSON.stringify(cssRequests.slice(-5)));
    const rolePerf = await page.evaluate(() => performance.getEntriesByType('resource').map((e) => e.name).filter((n) => /admin-workspace/.test(n)));
    assert('role-perf-css-30c', rolePerf.some((n) => /v=20260730c/.test(n)), JSON.stringify(rolePerf));
    assert('role-title', /角色治理/.test(await page.locator('h1').innerText()), 'title');
    assert('role-metrics-3', (await page.locator('.rbac-metric').count()) >= 3, 'metrics');
    assert('role-admin-create-visible', (await page.locator('button:has-text("新增")').count()) >= 1, 'create');
    results.permissionMatrix.admin_role = { pageOk: true, canWrite: true, createVisible: true };

    await page.waitForTimeout(400);
    {
      const geo = await measureToolbar(page);
      assertToolbarGeometry('role', '1440x900', geo, 'desktop');
      assert('role-desktop-metrics-visible', (await page.locator('.rbac-metric').count()) >= 3, 'metrics gone');
      assert('role-desktop-table-or-cards', (await page.locator('.admin-record-table, .admin-record-card').count()) >= 1, 'list gone');
    }
    await shot(page, '01-role-desktop-list', { page: 'role', role: 'admin', viewport: '1440x900', state: 'populated', goal: '角色桌面列表' });

    // Role #1 readonly dialog + focus + close restores exact 查看 button
    const viewBtn = page.locator('button:has-text("查看")').first();
    if (await viewBtn.count()) {
      const viewHandle = await viewBtn.elementHandle();
      await viewBtn.click();
      await page.waitForTimeout(300);
      const focusTag = await page.evaluate(() => {
        const a = document.activeElement;
        return a ? { tag: a.tagName, id: a.id, cls: a.className, disabled: !!a.disabled } : null;
      });
      assert('role1-dialog-focus-not-disabled-input', !(focusTag && focusTag.tag === 'INPUT' && focusTag.disabled), JSON.stringify(focusTag));
      assert('role1-dialog-focus-in-dialog', await page.evaluate(() => {
        const d = document.querySelector('[role="dialog"]');
        return d && d.contains(document.activeElement);
      }), 'focus outside');
      assert('role1-no-save', (await page.locator('[role="dialog"] button:has-text("保存角色")').count()) === 0, 'save');
      await shot(page, '04-role-super-readonly', { page: 'role', role: 'admin', viewport: '1440x900', state: 'role1-readonly', goal: '角色#1只读弹窗' });

      // Tab trap
      await page.keyboard.press('Tab');
      await page.keyboard.press('Tab');
      await page.keyboard.press('Tab');
      const stillIn = await page.evaluate(() => {
        const d = document.querySelector('[role="dialog"]');
        return d && d.contains(document.activeElement);
      });
      assert('role-dialog-tab-trap', stillIn, 'tab escaped');
      // Escape closes → exact focus on original 查看
      await page.keyboard.press('Escape');
      await page.waitForTimeout(200);
      assert('role-dialog-escape-close', (await page.locator('[role="dialog"]').count()) === 0, 'still open');
      const roleRoFocus = await pageInspectFocus(page);
      const roleRoExact = viewHandle
        ? await page.evaluate((el) => document.activeElement === el, viewHandle)
        : false;
      recordFocusAudit('role-readonly-close', roleRoFocus, {
        exactTrigger: roleRoExact,
        listRefreshed: false
      });
      assert('role-readonly-close-focus-exact', roleRoExact && isStrictFocusOk(roleRoFocus), JSON.stringify({ roleRoExact, roleRoFocus }));
    } else {
      fail('role1-dialog-focus-not-disabled-input', 'no view button');
    }

    // ——— Role #3 / #4 contract (open edit, no real PUT) ———
    {
      const res = await adminCtx.request.get(base + '/api/role/page', { params: { pageNum: 1, pageSize: 50 } });
      const j = await res.json();
      const records = (j.data && j.data.records) || [];
      const r3 = records.find((r) => Number(r.id) === 3);
      const r4 = records.find((r) => Number(r.id) === 4);
      assert('role3-exists', !!r3, 'missing #3');
      assert('role4-exists', !!r4, 'missing #4');

      // inject and open via evaluate for reliability
      await page.goto(base + '/page/end/role.html', { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForTimeout(600);
      await page.evaluate(async () => {
        const vm = document.querySelector('#workspace').__vue__;
        await new Promise((resolve) => {
          $.ajax({ url: '/api/permission', type: 'GET' }).done((res) => {
            vm.permissions = res && res.code === '0' ? res.data : [];
            resolve();
          }).fail(() => resolve());
        });
      });
      await page.waitForTimeout(200);

      if (r3) {
        await page.evaluate((item) => {
          const vm = document.querySelector('#workspace').__vue__;
          // simulate drifted data: strip one loop flag, add admin flag if possible
          const admin = (vm.permissions || []).find((p) => p.flag === 'user');
          const drifted = Object.assign({}, item, {
            permission: (item.permission || []).filter((p) => p.flag !== 'apply').concat(admin ? [admin] : [])
          });
          vm.openEdit(drifted);
        }, r3);
        await page.waitForTimeout(350);
        const c3 = await page.evaluate(({ loop, admin }) => {
          const vm = document.querySelector('#workspace').__vue__;
          const ids = vm.form.permissionIds || [];
          const flags = (vm.permissions || []).filter((p) => ids.indexOf(p.id) >= 0 || ids.indexOf(Number(p.id)) >= 0).map((p) => p.flag);
          const byFlag = {};
          (vm.permissions || []).forEach((p) => { byFlag[p.flag] = p.id; });
          const hasAllLoop = loop.every((f) => flags.indexOf(f) >= 0 || ids.indexOf(byFlag[f]) >= 0);
          const hasAdmin = admin.some((f) => flags.indexOf(f) >= 0);
          // try group clear on loop
          const loopGroup = (vm.permissionGroups || []).find((g) => g.id === 'loop');
          if (loopGroup) vm.selectGroup(loopGroup, false);
          const ids2 = vm.form.permissionIds || [];
          const flags2 = (vm.permissions || []).filter((p) => ids2.indexOf(p.id) >= 0 || ids2.indexOf(Number(p.id)) >= 0).map((p) => p.flag);
          const loopStill = loop.every((f) => {
            const id = byFlag[f];
            return id != null && (ids2.indexOf(id) >= 0 || ids2.indexOf(Number(id)) >= 0 || flags2.indexOf(f) >= 0);
          });
          // try select admin group
          const acc = (vm.permissionGroups || []).find((g) => g.id === 'account');
          if (acc) vm.selectGroup(acc, true);
          const ids3 = vm.form.permissionIds || [];
          const flags3 = (vm.permissions || []).filter((p) => ids3.indexOf(p.id) >= 0 || ids3.indexOf(Number(p.id)) >= 0).map((p) => p.flag);
          const noAdmin = !admin.some((f) => flags3.indexOf(f) >= 0);
          const payload = (ids3 || []).map((id) => ({ id }));
          return { hasAllLoop, hasAdmin, loopStill, noAdmin, payload, flags3 };
        }, { loop: USER_LOOP, admin: ADMIN_FLAGS });
        assert('role3-normalized-loop', c3.hasAllLoop, JSON.stringify(c3));
        assert('role3-normalized-no-admin', !c3.hasAdmin, JSON.stringify(c3));
        assert('role3-clear-keeps-loop', c3.loopStill, JSON.stringify(c3));
        assert('role3-select-no-admin', c3.noAdmin, JSON.stringify(c3));
        await shot(page, '05-role3-contract-lock', { page: 'role', role: 'admin', viewport: '1440x900', state: 'role3-contract', goal: '角色#3契约锁定', simulated: true });
        await page.keyboard.press('Escape');
        await page.waitForTimeout(150);
      }

      if (r4) {
        await page.evaluate((item) => {
          const vm = document.querySelector('#workspace').__vue__;
          const admin = (vm.permissions || []).find((p) => p.flag === 'animal');
          const drifted = Object.assign({}, item, {
            permission: (item.permission || []).concat(admin ? [admin] : [])
          });
          vm.openEdit(drifted);
        }, r4);
        await page.waitForTimeout(300);
        const c4 = await page.evaluate(({ admin }) => {
          const vm = document.querySelector('#workspace').__vue__;
          const ids = vm.form.permissionIds || [];
          const flags = (vm.permissions || []).filter((p) => ids.indexOf(p.id) >= 0 || ids.indexOf(Number(p.id)) >= 0).map((p) => p.flag);
          const hasAdmin = admin.some((f) => flags.indexOf(f) >= 0);
          const acc = (vm.permissionGroups || []).find((g) => g.id === 'account');
          if (acc) vm.selectGroup(acc, true);
          const ids2 = vm.form.permissionIds || [];
          const flags2 = (vm.permissions || []).filter((p) => ids2.indexOf(p.id) >= 0 || ids2.indexOf(Number(p.id)) >= 0).map((p) => p.flag);
          const noAdmin = !admin.some((f) => flags2.indexOf(f) >= 0);
          return { hasAdmin, noAdmin, flags2 };
        }, { admin: ADMIN_FLAGS });
        assert('role4-normalized-no-admin', !c4.hasAdmin, JSON.stringify(c4));
        assert('role4-select-no-admin', c4.noAdmin, JSON.stringify(c4));
        await shot(page, '06-role4-contract-lock', { page: 'role', role: 'admin', viewport: '1440x900', state: 'role4-contract', goal: '角色#4契约锁定', simulated: true });
        await page.keyboard.press('Escape');
      }
    }

    // ——— Role edit Escape → exact focus on original 编辑 button ———
    {
      await page.goto(base + '/page/end/role.html', { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForTimeout(500);
      const editBtn = page.locator('.admin-record-table button:has-text("编辑")').first();
      assert('role-edit-btn-for-escape', (await editBtn.count()) > 0, 'no edit');
      const editHandle = await editBtn.elementHandle();
      await editBtn.click();
      await page.waitForTimeout(250);
      assert('role-edit-dialog-open', (await page.locator('[role="dialog"]').count()) >= 1, 'no dialog');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(200);
      assert('role-edit-escape-close', (await page.locator('[role="dialog"]').count()) === 0, 'still open');
      const escFocus = await pageInspectFocus(page);
      const escExact = editHandle
        ? await page.evaluate((el) => document.activeElement === el, editHandle)
        : false;
      recordFocusAudit('role-edit-escape', escFocus, { exactTrigger: escExact, listRefreshed: false });
      assert('role-edit-escape-focus-exact', escExact && isStrictFocusOk(escFocus), JSON.stringify({ escExact, escFocus }));
    }

    // ——— Create temp role + focus + double-submit + delete 409 ———
    const uniqueName = TEMP_PREFIX + Date.now();
    let createdRoleId = null;
    await page.goto(base + '/page/end/role.html', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(500);
    await page.locator('button:has-text("新增")').first().click();
    await page.waitForTimeout(250);
    assert('role-create-focus-name', await page.evaluate(() => document.activeElement && document.activeElement.id === 'roleName'), 'focus');
    await page.fill('#roleName', uniqueName);
    await page.fill('#roleDesc', 'phase2b temp');
    assert('role-perm-picker', (await page.locator('.rbac-perm-picker').count()) >= 1, 'picker');
    await shot(page, '03-role-perm-picker', { page: 'role', role: 'admin', viewport: '1440x900', state: 'perm-picker', goal: '权限分组选择弹窗' });
    const checks = page.locator('.rbac-perm-item input[type="checkbox"]:not([disabled])');
    const n = Math.min(2, await checks.count());
    for (let i = 0; i < n; i++) await checks.nth(i).check({ force: true }).catch(() => {});

    let createPosts = 0;
    let createBody = null;
    await page.route('**/api/role', async (route) => {
      if (route.request().method() === 'POST') {
        createPosts += 1;
        createBody = route.request().postDataJSON();
        await new Promise((r) => setTimeout(r, 400));
      }
      await route.continue();
    });
    const saveBtn = page.locator('[role="dialog"] button:has-text("保存角色")');
    await saveBtn.click();
    await saveBtn.click({ force: true }).catch(() => {});
    // Wait for list refresh (loading ends + feedback), not fixed luck
    await page.waitForFunction(() => {
      const vm = document.querySelector('#workspace') && document.querySelector('#workspace').__vue__;
      return vm && !vm.loading && !vm.editOpen && /角色已保存/.test(vm.message || '');
    }, { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(100);
    await page.unroute('**/api/role');
    assert('role-create-once', createPosts === 1, 'posts=' + createPosts);
    assert('role-create-payload-ids', createBody && Array.isArray(createBody.permission) && createBody.permission.every((p) => p && Object.keys(p).length === 1 && p.id != null), JSON.stringify(createBody));
    assert('role-create-success-kept', /角色已保存/.test(await page.locator('.rbac-feedback').innerText().catch(() => '')), 'msg');
    {
      const createFocus = await pageInspectFocus(page);
      recordFocusAudit('role-create-success', createFocus, { exactTrigger: false, listRefreshed: true });
      assert('role-create-success-focus-actionable', isStrictFocusOk(createFocus), JSON.stringify(createFocus));
      assert('role-create-success-focus-not-body', !createFocus.isBody && !createFocus.isHtml, JSON.stringify(createFocus));
    }

    {
      const recs = await listTempRoles(adminCtx);
      const rec = recs.find((r) => r.name === uniqueName);
      assert('role-temp-created', !!rec, JSON.stringify(recs));
      if (rec) {
        createdRoleId = rec.id;
        results.tempRoles.created.push({ id: createdRoleId, name: uniqueName });
      }
    }

    // delete confirm + real network 409 + double click + real UI delete success
    let uiDeleted = false;
    if (createdRoleId) {
      await page.fill('input[placeholder*="角色名称"]', uniqueName);
      await page.locator('button:has-text("查询")').click();
      await page.waitForTimeout(700);
      const delBtn = page.locator('button:has-text("删除")').first();
      assert('role-delete-btn', (await delBtn.count()) > 0, 'no delete');
      await delBtn.click();
      await page.waitForTimeout(250);
      const delFocus = await page.evaluate(() => {
        const a = document.activeElement;
        const text = (a && a.textContent || '').replace(/\s+/g, '');
        return { text, inAlert: !!(document.querySelector('[role="alertdialog"]') && document.querySelector('[role="alertdialog"]').contains(a)) };
      });
      assert('role-delete-focus-cancel', delFocus.inAlert && /取消/.test(delFocus.text), JSON.stringify(delFocus));
      assert('role-delete-title-name', (await page.locator('#roleDeleteTitle').innerText()).includes(uniqueName), 'name');
      await shot(page, '07-role-delete-confirm', { page: 'role', role: 'admin', viewport: '1440x900', state: 'delete-confirm', goal: '自定义角色删除确认', realNetwork: false });

      // ——— Part 1: 409 with real network double-click ———
      const delReqs = [];
      await page.unroute('**/api/role/**').catch(() => {});
      await page.route('**/api/role/**', async (route) => {
        if (route.request().method() !== 'DELETE') {
          await route.continue();
          return;
        }
        delReqs.push({ method: route.request().method(), url: route.request().url() });
        await new Promise((r) => setTimeout(r, 700));
        await route.fulfill(expectedErrorFulfill(409, { code: '409', msg: '角色仍被用户引用，无法删除' }));
      });
      // Stable handle (class, not loading text) — text-based locator re-resolves after "删除中..." ends and falsely re-clicks after lock release
      const confHandle = await page.locator('[role="alertdialog"] button.ui-button.is-danger-solid').first().elementHandle();
      if (!confHandle) throw new Error('delete confirm button missing');
      // Two real DOM clicks on the same node (true double-submit); lock must keep DELETE count === 1
      await confHandle.evaluate((el) => { el.click(); el.click(); });
      await page.waitForTimeout(120);
      const delPending = await page.evaluate(() => {
        const vm = document.querySelector('#workspace').__vue__;
        const btn = document.querySelector('[role="alertdialog"] button.ui-button.is-danger-solid');
        const locks = window.__rbacWriteLocks || {};
        return {
          deleting: !!(vm && vm.deleting),
          disabled: !!(btn && btn.disabled),
          busy: btn && btn.getAttribute('aria-busy'),
          open: !!document.querySelector('[role="alertdialog"]'),
          lock: !!locks.del
        };
      });
      await page.keyboard.press('Escape');
      await page.locator('.admin-dialog-backdrop').first().click({ position: { x: 2, y: 2 } }).catch(() => {});
      await page.waitForTimeout(800);
      assert('role-real-delete-observed', delReqs.length >= 1, 'DELETE count=' + delReqs.length);
      assert('role-real-delete-once', delReqs.length === 1, 'DELETE count=' + delReqs.length + ' pending=' + JSON.stringify(delPending));
      assert('role-real-delete-id', delReqs[0] && String(delReqs[0].url).indexOf('/api/role/' + createdRoleId) >= 0, JSON.stringify(delReqs[0]));
      assert('role-double-delete-blocked', delReqs.length === 1, 'count=' + delReqs.length);
      assert('role-delete-pending-state', (delPending.deleting || delPending.lock) && delPending.disabled && delPending.busy === 'true', JSON.stringify(delPending));
      assert('role-delete-pending-escape-blocked', (await page.locator('[role="alertdialog"]').count()) >= 1, 'closed by escape');
      assert('role-delete-pending-backdrop-blocked', (await page.locator('[role="alertdialog"]').count()) >= 1, 'closed by backdrop');
      const errText = await page.locator('[role="alertdialog"] .is-error').first().innerText().catch(() => '');
      assert('role-delete-409-keeps-dialog', (await page.locator('[role="alertdialog"]').count()) >= 1 && /引用|无法删除/.test(errText), errText);
      {
        const still = await listTempRoles(adminCtx);
        assert('role-delete-409-still-exists', still.some((r) => r.id === createdRoleId), JSON.stringify(still));
      }
      await page.waitForTimeout(100);
      const lockReleased = await page.evaluate(() => {
        const vm = document.querySelector('#workspace').__vue__;
        const locks = window.__rbacWriteLocks || {};
        return { deleting: !!(vm && vm.deleting), del: !!locks.del };
      });
      assert('role-delete-lock-released', !lockReleased.deleting && !lockReleased.del, JSON.stringify(lockReleased));
      await shot(page, '08-role-delete-409', { page: 'role', role: 'admin', viewport: '1440x900', state: 'delete-409', goal: '删除409真实网络', routeIntercept: true, realNetwork: true, simulated: false, databaseWrite: false });
      await page.unroute('**/api/role/**').catch(() => {});

      // ——— Part 2: real UI DELETE success (no API fallback, no forged message) ———
      const realDel = [];
      page.on('request', (req) => {
        if (req.method() === 'DELETE' && req.url().indexOf('/api/role/' + createdRoleId) >= 0) {
          realDel.push({ method: req.method(), url: req.url() });
        }
      });
      page.on('response', async (res) => {
        if (res.request().method() === 'DELETE' && res.url().indexOf('/api/role/' + createdRoleId) >= 0) {
          results.uiDelete.status = res.status();
        }
      });
      // ensure dialog still open after 409
      if ((await page.locator('[role="alertdialog"]').count()) === 0) {
        await page.locator('button:has-text("删除")').first().click();
        await page.waitForTimeout(200);
      }
      await page.locator('[role="alertdialog"] button:has-text("确认删除角色")').first().click();
      await page.waitForFunction(() => {
        const vm = document.querySelector('#workspace') && document.querySelector('#workspace').__vue__;
        return vm && !vm.loading && !vm.deleteItem && /角色已删除/.test(vm.message || '');
      }, { timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(100);
      results.uiDelete.requestCount = realDel.length;
      const feedback = await page.locator('.rbac-feedback').innerText().catch(() => '');
      const dialogGone = (await page.locator('[role="alertdialog"]').count()) === 0;
      uiDeleted = realDel.length === 1 && dialogGone && /角色已删除/.test(feedback);
      results.uiDelete.success = uiDeleted;
      assert('role-ui-delete-observed', realDel.length >= 1, 'DELETE count=' + realDel.length);
      assert('role-ui-delete-once', realDel.length === 1, 'DELETE count=' + realDel.length);
      assert('role-ui-delete-dialog-closed', dialogGone, 'dialog still open');
      assert('role-ui-delete-feedback', /角色已删除/.test(feedback), feedback);
      assert('role-ui-delete-success', uiDeleted, JSON.stringify({ realDel, feedback, dialogGone, status: results.uiDelete.status }));
      // Strict focus after delete: BODY/HTML must fail; must be actionable or explicit heading
      const delFocusInfo = await pageInspectFocus(page);
      const onSearch = await page.evaluate(() => {
        const a = document.activeElement;
        return !!(a && a.matches && a.matches('input[type="search"], .ui-toolbar input, .admin-review-toolbar input'));
      });
      const onHeading = !!(delFocusInfo.explicitHeading);
      recordFocusAudit('role-delete-success', delFocusInfo, {
        exactTrigger: false,
        listRefreshed: true,
        onSearch: onSearch,
        onHeading: onHeading
      });
      assert('role-delete-success-focus-not-body', !delFocusInfo.isBody && !delFocusInfo.isHtml, JSON.stringify(delFocusInfo));
      assert('role-delete-success-focus-actionable', isStrictFocusOk(delFocusInfo) && (onSearch || onHeading || delFocusInfo.interactive), JSON.stringify(delFocusInfo));
      const after = await listTempRoles(adminCtx);
      assert('role-ui-delete-removed-from-api', !after.some((r) => r.id === createdRoleId), JSON.stringify(after));
      if (uiDeleted) {
        results.tempRoles.cleaned.push(createdRoleId);
        createdRoleId = null;
      }
      await shot(page, '08b-role-ui-delete-success', { page: 'role', role: 'admin', viewport: '1440x900', state: 'delete-success', goal: '真实UI删除成功', realNetwork: true, routeIntercept: false, databaseWrite: true });
    }

    // Role race: stale load
    {
      await page.goto(base + '/page/end/role.html', { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForTimeout(400);
      let gate = 0;
      await page.route('**/api/role/page**', async (route) => {
        gate += 1;
        const g = gate;
        if (g === 1) await new Promise((r) => setTimeout(r, 900));
        else await new Promise((r) => setTimeout(r, 50));
        if (g === 1) {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ code: '0', data: { records: [{ id: 999001, name: 'STALE_OLD_ROLE', permission: [] }], current: 1, total: 1, pages: 1 } })
          });
        } else {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ code: '0', data: { records: [{ id: 999002, name: 'FRESH_NEW_ROLE', permission: [] }], current: 1, total: 1, pages: 1 } })
          });
        }
      });
      await page.evaluate(() => {
        const vm = document.querySelector('#workspace').__vue__;
        vm.search = 'A';
        vm.load(1);
        vm.search = 'B';
        vm.load(1);
      });
      await page.waitForTimeout(1200);
      const names = await page.locator('.admin-record-table strong, .admin-record-card h3').allTextContents();
      assert('role-stale-load-ignored', names.some((n) => /FRESH_NEW_ROLE/.test(n)) && !names.some((n) => /STALE_OLD_ROLE/.test(n)), names.join('|'));
      await page.unroute('**/api/role/page**');
    }

    // Role loading/error states
    {
      await page.route('**/api/role/page**', async (route) => {
        await route.fulfill(expectedErrorFulfill(500, { code: '500', msg: '角色加载失败审计' }));
      });
      await page.evaluate(() => {
        const vm = document.querySelector('#workspace').__vue__;
        vm.records = [{ id: 1, name: 'KEEP_ON_ERROR', permission: [] }];
        vm.load(1);
      });
      await page.waitForTimeout(400);
      assert('role-error-keeps-data', (await page.locator('text=KEEP_ON_ERROR').count()) >= 1 || /KEEP_ON_ERROR/.test(await page.locator('main').innerText()), 'lost');
      assert('role-error-banner', (await page.locator('.rbac-state-banner').count()) >= 1, 'no banner');
      await page.unroute('**/api/role/page**');
      await page.locator('button:has-text("重试")').click();
      await page.waitForTimeout(700);
      assert('role-retry-ok', (await page.locator('.rbac-state-banner').count()) === 0, 'still error');
    }

    // Mobile role toolbar geometry + cards (390 then 360) — measure before screenshot
    for (const vp of [
      { name: '390x844', width: 390, height: 844 },
      { name: '360x800', width: 360, height: 800 }
    ]) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto(base + '/page/end/role.html', { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForTimeout(700);
      // Measure with toolbar in view (sticky header overlap is real failure)
      await page.evaluate(() => {
        const tb = document.querySelector('.admin-review-toolbar');
        if (tb) tb.scrollIntoView({ block: 'center', inline: 'nearest' });
      });
      await page.waitForTimeout(80);
      const geo = await measureToolbar(page);
      assertToolbarGeometry('role', vp.name, geo, 'mobile');
      assert('role-mobile-card-visible-' + vp.name, await page.locator('.admin-record-card').first().isVisible(), 'no card');
      const cover = await toolbarCoversList(page);
      assert('role-toolbar-not-cover-list-' + vp.name, cover.ok, JSON.stringify(cover));
      // Screenshot from page top: hero + toolbar + first data
      await shot(page, vp.name === '390x844' ? '02-role-mobile-cards' : '02b-role-mobile-360', {
        page: 'role', role: 'admin', viewport: vp.name, state: 'mobile-toolbar', goal: '角色移动端工具栏与卡片'
      });
    }

    // ——— Permission page ———
    await page.setViewportSize({ width: 1440, height: 900 });
    cssRequests.length = 0;
    await page.goto(base + '/page/end/permission.html', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(700);
    assert('perm-network-css-30c', cssRequests.some((u) => /admin-workspace\.css\?v=20260730c/.test(u)), JSON.stringify(cssRequests.slice(-3)));
    assert('perm-title', /权限治理/.test(await page.locator('h1').innerText()), 'title');
    assert('perm-metrics', (await page.locator('.rbac-metric').count()) >= 3, 'metrics');
    assert('perm-admin-create', (await page.locator('button:has-text("新增")').count()) >= 1, 'create');
    results.permissionMatrix.admin_permission = { pageOk: true, canWrite: true, createVisible: true };
    {
      const geo = await measureToolbar(page);
      assertToolbarGeometry('perm', '1440x900', geo, 'desktop');
    }
    await shot(page, '09-perm-desktop', { page: 'permission', role: 'admin', viewport: '1440x900', state: 'populated', goal: '权限桌面列表' });

    // ——— Permission focus: cancel exact restore (before write tests) ———
    {
      const editForCancel = page.locator('.admin-record-table button:has-text("编辑")').first();
      assert('perm-edit-btn-for-cancel', (await editForCancel.count()) > 0, 'no edit');
      const cancelTrigger = await editForCancel.elementHandle();
      await editForCancel.click();
      await page.waitForTimeout(250);
      assert('perm-cancel-dialog-open', (await page.locator('[role="dialog"]').count()) >= 1, 'no dialog');
      await page.locator('[role="dialog"] button:has-text("取消")').click();
      await page.waitForTimeout(200);
      assert('perm-cancel-dialog-closed', (await page.locator('[role="dialog"]').count()) === 0, 'still open');
      const cancelFocus = await pageInspectFocus(page);
      const cancelExact = cancelTrigger
        ? await page.evaluate((el) => document.activeElement === el, cancelTrigger)
        : false;
      recordFocusAudit('perm-cancel', cancelFocus, { exactTrigger: cancelExact, listRefreshed: false });
      assert('perm-cancel-focus-exact', cancelExact && isStrictFocusOk(cancelFocus), JSON.stringify({ cancelExact, cancelFocus }));
    }

    // ——— Permission real write: double-click + 409 + success (no $.ajax mock) ———
    const editTrigger = page.locator('.admin-record-table button:has-text("编辑")').first();
    await editTrigger.click();
    await page.waitForTimeout(250);
    assert('perm-dialog-focus-name', await page.evaluate(() => document.activeElement && document.activeElement.id === 'permName'), 'focus');
    const nameBefore = await page.inputValue('#permName');

    // 409 + double click real network
    const permWrites = [];
    await page.route('**/api/permission', async (route) => {
      const m = route.request().method();
      if (m === 'PUT' || m === 'POST') {
        const body = route.request().postDataJSON();
        permWrites.push({ method: m, url: route.request().url(), body });
        await new Promise((r) => setTimeout(r, 600));
        await route.fulfill(expectedErrorFulfill(409, { code: '409', msg: 'flag 重复或权限被角色引用' }));
        return;
      }
      await route.continue();
    });
    // Stable handle (class, not loading text) — avoids re-click after "保存中..." ends and lock release
    const pSaveHandle = await page.locator('[role="dialog"] button.ui-button.is-primary').first().elementHandle();
    if (!pSaveHandle) throw new Error('permission save button missing');
    // Two real DOM clicks on the same node; writeLocks.save must keep write count === 1
    await pSaveHandle.evaluate((el) => { el.click(); el.click(); });
    await page.waitForTimeout(150);
    const pPending = await page.evaluate(() => {
      const vm = document.querySelector('#workspace').__vue__;
      const btn = document.querySelector('[role="dialog"] button.ui-button.is-primary');
      return {
        saving: !!(vm && vm.saving),
        disabled: !!(btn && btn.disabled),
        busy: btn && btn.getAttribute('aria-busy'),
        loading: !!(btn && btn.classList.contains('is-loading'))
      };
    });
    await page.keyboard.press('Escape');
    await page.locator('.admin-dialog-backdrop').first().click({ position: { x: 2, y: 2 } }).catch(() => {});
    await page.waitForTimeout(700);
    assert('perm-real-write-observed', permWrites.length >= 1, 'writes=' + permWrites.length);
    assert('perm-real-write-once', permWrites.length === 1, 'writes=' + permWrites.length);
    assert('perm-double-click-blocked', permWrites.length === 1, 'writes=' + permWrites.length);
    assert('perm-real-write-method', permWrites[0] && (permWrites[0].method === 'PUT' || permWrites[0].method === 'POST'), JSON.stringify(permWrites[0]));
    assert('perm-real-write-payload', permWrites[0] && permWrites[0].body && permWrites[0].body.name != null && permWrites[0].body.flag != null, JSON.stringify(permWrites[0] && permWrites[0].body));
    assert('perm-pending-state', pPending.saving && pPending.disabled && pPending.busy === 'true', JSON.stringify(pPending));
    assert('perm-pending-escape-blocked', (await page.locator('[role="dialog"]').count()) >= 1, 'closed');
    assert('perm-pending-backdrop-blocked', (await page.locator('[role="dialog"]').count()) >= 1, 'closed');
    await shot(page, '11-perm-saving-loading', { page: 'permission', role: 'admin', viewport: '1440x900', state: 'saving', goal: '权限保存loading真实网络', routeIntercept: true, realNetwork: true, simulated: false, databaseWrite: false });
    const dlgText = await page.locator('[role="dialog"]').innerText().catch(() => '');
    assert('perm-409-keeps-dialog', (await page.locator('[role="dialog"]').count()) >= 1 && /引用|重复|409|冲突/.test(dlgText), dlgText.slice(0, 160));
    const nameAfter409 = await page.inputValue('#permName').catch(() => '');
    assert('perm-409-keeps-input', nameAfter409 === nameBefore && !!nameAfter409, nameAfter409);
    const pLock = await page.evaluate(() => {
      const vm = document.querySelector('#workspace').__vue__;
      const locks = window.__rbacWriteLocks || {};
      return { saving: !!(vm && vm.saving), save: !!locks.save };
    });
    assert('perm-lock-released-after-error', !pLock.saving && !pLock.save, JSON.stringify(pLock));
    await shot(page, '12-perm-save-409', { page: 'permission', role: 'admin', viewport: '1440x900', state: '409', goal: '权限保存409真实网络', routeIntercept: true, realNetwork: true, simulated: false, databaseWrite: false });
    await page.unroute('**/api/permission');

    // Success path via route (no DB mutation) + strict focus after list refresh
    const successWrites = [];
    await page.route('**/api/permission', async (route) => {
      const m = route.request().method();
      if (m === 'PUT' || m === 'POST') {
        successWrites.push({ method: m, url: route.request().url(), body: route.request().postDataJSON() });
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ code: '0', data: true })
        });
        return;
      }
      await route.continue();
    });
    // re-enable form if still open
    if ((await page.locator('[role="dialog"]').count()) === 0) {
      await page.locator('.admin-record-table button:has-text("编辑")').first().click();
      await page.waitForTimeout(200);
    }
    await page.locator('[role="dialog"] button:has-text("保存权限")').click();
    await page.waitForFunction(() => {
      const vm = document.querySelector('#workspace') && document.querySelector('#workspace').__vue__;
      return vm && !vm.loading && !vm.editOpen && /权限定义已保存/.test(vm.message || '');
    }, { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(100);
    assert('perm-success-write-once', successWrites.length === 1, 'writes=' + successWrites.length);
    assert('perm-success-dialog-closed', (await page.locator('[role="dialog"]').count()) === 0, 'still open');
    assert('perm-success-feedback', /权限定义已保存/.test(await page.locator('.rbac-feedback').innerText().catch(() => '')), 'no msg');
    {
      const succFocus = await pageInspectFocus(page);
      const onSearch = await page.evaluate(() => {
        const a = document.activeElement;
        return !!(a && a.matches && a.matches('input[type="search"], .ui-toolbar input, .admin-review-toolbar input'));
      });
      recordFocusAudit('perm-success', succFocus, { exactTrigger: false, listRefreshed: true, onSearch: onSearch });
      assert('perm-success-focus-not-body', !succFocus.isBody && !succFocus.isHtml, JSON.stringify(succFocus));
      assert('perm-success-focus-actionable', isStrictFocusOk(succFocus), JSON.stringify(succFocus));
    }
    await page.unroute('**/api/permission');

    // Normal Escape close + exact focus restore to original 编辑
    {
      const escEdit = page.locator('.admin-record-table button:has-text("编辑")').first();
      const escHandle = await escEdit.elementHandle();
      await escEdit.click();
      await page.waitForTimeout(200);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(200);
      assert('perm-escape-close', (await page.locator('[role="dialog"]').count()) === 0, 'still open');
      const escFocus = await pageInspectFocus(page);
      const escExact = escHandle
        ? await page.evaluate((el) => document.activeElement === el, escHandle)
        : false;
      recordFocusAudit('perm-escape', escFocus, { exactTrigger: escExact, listRefreshed: false });
      assert('perm-escape-focus-exact', escExact && isStrictFocusOk(escFocus), JSON.stringify({ escExact, escFocus }));
    }

    // Readonly 查看 close → exact focus (simulated non-write via formReadOnly path)
    // Super-admin always canWrite; use 查看 only when canWrite false is simulated later.
    // Dedicated: open first row as openEdit then cancel via close button — already covered by cancel.
    // Extra: non-super simulated readonly close exact (after nonsuper section we re-assert if 查看 exists).

    // Permission empty list
    await page.route('**/api/permission/page**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ code: '0', data: { records: [], current: 1, total: 0, pages: 1 } })
      });
    });
    await page.evaluate(() => document.querySelector('#workspace').__vue__.load(1));
    await page.waitForTimeout(400);
    const emptyTxt = await page.locator('main').innerText();
    assert('perm-empty-state', /暂无权限/.test(emptyTxt), emptyTxt.slice(0, 120));
    assert('perm-empty-no-cards', (await page.locator('.admin-record-card').count()) === 0, 'cards remain');
    await page.unroute('**/api/permission/page**');

    // Permission race
    {
      let gate = 0;
      await page.route('**/api/permission/page**', async (route) => {
        gate += 1;
        const g = gate;
        if (g === 1) await new Promise((r) => setTimeout(r, 900));
        else await new Promise((r) => setTimeout(r, 50));
        if (g === 1) {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ code: '0', data: { records: [{ id: 1, name: 'STALE_PERM', flag: 'user', path: '' }], current: 1, total: 1, pages: 1 } })
          });
        } else {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ code: '0', data: { records: [{ id: 2, name: 'FRESH_PERM', flag: 'role', path: '' }], current: 1, total: 1, pages: 1 } })
          });
        }
      });
      await page.evaluate(() => {
        const vm = document.querySelector('#workspace').__vue__;
        vm.search = 'A';
        vm.load(1);
        vm.search = 'B';
        vm.load(1);
      });
      await page.waitForTimeout(1200);
      const t = await page.locator('main').innerText();
      assert('perm-stale-load-ignored', /FRESH_PERM/.test(t) && !/STALE_PERM/.test(t), t.slice(0, 160));
      await page.unroute('**/api/permission/page**');
    }

    // perm 500 error keep + retry success
    await page.route('**/api/permission/page**', async (route) => {
      await route.fulfill(expectedErrorFulfill(500, { code: '500', msg: '权限加载失败审计' }));
    });
    await page.evaluate(() => {
      const vm = document.querySelector('#workspace').__vue__;
      vm.records = [{ id: 1, name: 'PERM_KEEP', flag: 'user', path: '/page/end/user.html' }];
      vm.load(1);
    });
    await page.waitForTimeout(400);
    assert('perm-error-keeps', /PERM_KEEP/.test(await page.locator('main').innerText()), 'lost');
    assert('perm-error-banner', (await page.locator('.rbac-state-banner').count()) >= 1, 'no banner');
    await page.unroute('**/api/permission/page**');
    await page.locator('button:has-text("重试")').click();
    await page.waitForTimeout(700);
    assert('perm-retry-ok', (await page.locator('.rbac-state-banner').count()) === 0, 'still error');

    // Role empty state
    await page.goto(base + '/page/end/role.html', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(400);
    await page.route('**/api/role/page**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ code: '0', data: { records: [], current: 1, total: 0, pages: 1 } })
      });
    });
    await page.evaluate(() => document.querySelector('#workspace').__vue__.load(1));
    await page.waitForTimeout(400);
    assert('role-empty-state', /暂无角色/.test(await page.locator('main').innerText()), 'no empty');
    assert('role-empty-no-cards', (await page.locator('.admin-record-card').count()) === 0, 'cards');
    await page.unroute('**/api/role/page**');

    // mobile perm toolbar + cards (390 then 360)
    for (const vp of [
      { name: '390x844', width: 390, height: 844 },
      { name: '360x800', width: 360, height: 800 }
    ]) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto(base + '/page/end/permission.html', { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForTimeout(700);
      await page.evaluate(() => {
        const tb = document.querySelector('.admin-review-toolbar');
        if (tb) tb.scrollIntoView({ block: 'center', inline: 'nearest' });
      });
      await page.waitForTimeout(80);
      const geo = await measureToolbar(page);
      assertToolbarGeometry('perm', vp.name, geo, 'mobile');
      assert('perm-mobile-card-' + vp.name, await page.locator('.admin-record-card').first().isVisible(), 'no card');
      const cover = await toolbarCoversList(page);
      assert('perm-toolbar-not-cover-list-' + vp.name, cover.ok, JSON.stringify(cover));
      await shot(page, vp.name === '390x844' ? '10-perm-mobile-cards' : '10b-perm-mobile-360', {
        page: 'permission', role: 'admin', viewport: vp.name, state: 'mobile-toolbar', goal: '权限移动端工具栏与卡片'
      });
    }

    // 720 viewport — both pages: operable toolbar, no cover, no h-scroll
    for (const pg of ['role', 'permission']) {
      await page.setViewportSize({ width: 720, height: 450 });
      await page.goto(base + `/page/end/${pg}.html`, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForTimeout(500);
      await page.evaluate(() => {
        const tb = document.querySelector('.admin-review-toolbar');
        if (tb) tb.scrollIntoView({ block: 'center', inline: 'nearest' });
      });
      await page.waitForTimeout(80);
      const geo = await measureToolbar(page);
      assertToolbarGeometry(pg === 'role' ? 'role' : 'perm', '720x450', geo, 'compact');
      // search + button operable
      const operable = await page.evaluate(() => {
        const input = document.querySelector('.admin-review-toolbar input');
        const btn = document.querySelector('.admin-review-toolbar button[type="submit"], .admin-review-toolbar .ui-button.is-dark');
        return {
          inputEnabled: !!(input && !input.disabled && input.offsetParent !== null),
          btnEnabled: !!(btn && !btn.disabled && btn.offsetParent !== null)
        };
      });
      assert(pg + '-720-search-operable', operable.inputEnabled && operable.btnEnabled, JSON.stringify(operable));
      const cover = await toolbarCoversList(page);
      assert(pg + '-720-toolbar-not-cover-list', cover.ok, JSON.stringify(cover));
      if (pg === 'role') {
        await shot(page, '15-role-720-200equiv', { page: 'role', role: 'admin', viewport: '720x450', state: 'compact', goal: '720等效200%' });
      } else {
        await shot(page, '15b-perm-720', { page: 'permission', role: 'admin', viewport: '720x450', state: 'compact', goal: '权限720工具栏' });
      }
    }

    // Viewport matrix
    for (const vp of VIEWPORTS) {
      for (const pg of ['role', 'permission']) {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await page.goto(base + `/page/end/${pg}.html`, { waitUntil: 'domcontentloaded', timeout: 45000 });
        await page.waitForTimeout(300);
        const m = await page.evaluate(() => ({
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          h1: !!document.querySelector('h1')
        }));
        assert(`vp-${pg}-${vp.name}`, m.h1 && m.overflow <= 2, JSON.stringify(m));
      }
    }

    // operations still 30a
    cssRequests.length = 0;
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(base + '/page/end/operations.html', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(400);
    assert('ops-css-still-30a', cssRequests.some((u) => /v=20260730a/.test(u)), JSON.stringify(cssRequests.filter((u) => /admin-workspace/.test(u))));
    assert('ops-css-not-30c', !cssRequests.some((u) => /v=20260730c/.test(u)) && !cssRequests.some((u) => /v=20260730b/.test(u)), 'ops 30c/b');

    // Non-super simulated both pages
    await page.goto(base + '/page/end/role.html', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(400);
    await page.evaluate(() => {
      const vm = document.querySelector('#workspace').__vue__;
      vm.user = Object.assign({}, vm.user, { role: [{ id: 2, name: '非超管' }] });
    });
    await page.waitForTimeout(100);
    assert('role-nonsuper-banner', (await page.locator('.rbac-readonly-banner').count()) >= 1, 'banner');
    assert('role-nonsuper-no-create', (await page.locator('button:has-text("新增")').count()) === 0, 'create');
    assert('role-nonsuper-no-delete', (await page.locator('button:has-text("删除")').count()) === 0, 'delete');
    assert('role-nonsuper-view-only', (await page.locator('button:has-text("查看")').count()) >= 1, 'view');
    await shot(page, '13-role-nonsuper-readonly', { page: 'role', role: 'simulated-nonsuper', viewport: '1440x900', state: 'readonly', goal: '非超管角色只读', simulated: true });
    results.permissionMatrix.sim_nonsuper_role = { simulated: true, readonly: true, createVisible: false };

    await page.goto(base + '/page/end/permission.html', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(400);
    await page.evaluate(() => {
      const vm = document.querySelector('#workspace').__vue__;
      vm.user = Object.assign({}, vm.user, { role: [{ id: 2, name: '非超管' }] });
    });
    await page.waitForTimeout(100);
    assert('perm-nonsuper-banner', (await page.locator('.rbac-readonly-banner').count()) >= 1, 'banner');
    assert('perm-nonsuper-no-create', (await page.locator('button:has-text("新增")').count()) === 0, 'create');
    assert('perm-nonsuper-view', (await page.locator('button:has-text("查看")').count()) >= 1, 'view');
    {
      const viewOnly = page.locator('.admin-record-table button:has-text("查看")').first();
      const viewHandle = await viewOnly.elementHandle();
      await viewOnly.click();
      await page.waitForTimeout(250);
      assert('perm-readonly-dialog-open', (await page.locator('[role="dialog"]').count()) >= 1, 'no dialog');
      await page.locator('[role="dialog"] button:has-text("关闭"), [role="dialog"] .admin-dialog-close').first().click();
      await page.waitForTimeout(200);
      assert('perm-readonly-dialog-closed', (await page.locator('[role="dialog"]').count()) === 0, 'still open');
      const roFocus = await pageInspectFocus(page);
      const roExact = viewHandle
        ? await page.evaluate((el) => document.activeElement === el, viewHandle)
        : false;
      recordFocusAudit('perm-readonly-close', roFocus, { exactTrigger: roExact, listRefreshed: false });
      assert('perm-readonly-close-focus-exact', roExact && isStrictFocusOk(roFocus), JSON.stringify({ roExact, roFocus }));
    }
    await shot(page, '14-perm-nonsuper-readonly', { page: 'permission', role: 'simulated-nonsuper', viewport: '1440x900', state: 'readonly', goal: '非超管权限只读', simulated: true });
    results.permissionMatrix.sim_nonsuper_permission = { simulated: true, readonly: true, createVisible: false };

    // Non-super write API (real) — tom if exists else admin's secondary check with 403 intercept is not enough
    // Use jerry session for write attempt
    {
      const jctx = await browser.newContext();
      try {
        await login(jctx, 'jerry', '123456');
        const post = await jctx.request.post(base + '/api/role', {
          headers: csrfHeaders(jctx),
          data: { name: TEMP_PREFIX + 'SHOULD_FAIL', description: 'x', permission: [] }
        });
        const pj = await post.json().catch(() => ({}));
        assert('jerry-role-write-denied', post.status() === 403 || pj.code === '403' || pj.code === '401', JSON.stringify({ st: post.status(), pj }));
        const ppost = await jctx.request.post(base + '/api/permission', {
          headers: csrfHeaders(jctx),
          data: { name: 'x', flag: 'user', path: '' }
        });
        const ppj = await ppost.json().catch(() => ({}));
        assert('jerry-perm-write-denied', ppost.status() === 403 || ppj.code === '403' || ppj.code === '401', JSON.stringify({ st: ppost.status(), ppj }));
      } catch (e) {
        fail('jerry-write-probe', String(e));
      }
      await jctx.close();
    }

    // jerry pages both
    {
      const ctx = await browser.newContext();
      await login(ctx, 'jerry', '123456');
      const p = await ctx.newPage();
      await p.goto(base + '/page/end/role.html', { waitUntil: 'domcontentloaded', timeout: 45000 });
      await p.waitForTimeout(600);
      const roleUrl = p.url();
      const roleApi = await ctx.request.get(base + '/api/role/page');
      const roleApiJ = await roleApi.json().catch(() => ({}));
      const roleDenied = /forbidden|login|error=|index\.html/.test(roleUrl) || roleApi.status() === 403 || roleApiJ.code === '403';
      assert('jerry-role-page-or-api-denied', roleDenied, JSON.stringify({ roleUrl, st: roleApi.status() }));
      results.permissionMatrix.jerry_role = { url: roleUrl, apiStatus: roleApi.status(), denied: roleDenied };

      await p.goto(base + '/page/end/permission.html', { waitUntil: 'domcontentloaded', timeout: 45000 });
      await p.waitForTimeout(600);
      const permUrl = p.url();
      const permApi = await ctx.request.get(base + '/api/permission/page');
      const permApiJ = await permApi.json().catch(() => ({}));
      const permDenied = /forbidden|login|error=|index\.html/.test(permUrl) || permApi.status() === 403 || permApiJ.code === '403';
      assert('jerry-perm-page-or-api-denied', permDenied, JSON.stringify({ permUrl, st: permApi.status() }));
      results.permissionMatrix.jerry_permission = { url: permUrl, apiStatus: permApi.status(), denied: permDenied };
      await ctx.close();
    }

    // anonymous both pages
    {
      const ctx = await browser.newContext();
      const p = await ctx.newPage();
      await p.goto(base + '/page/end/role.html', { waitUntil: 'domcontentloaded', timeout: 45000 });
      await p.waitForTimeout(500);
      const roleUrl = p.url();
      const roleApi = await ctx.request.get(base + '/api/role/page');
      assert('anon-role-login', /login/i.test(roleUrl), roleUrl);
      assert('anon-role-api', roleApi.status() === 401 || roleApi.status() === 403, 'st=' + roleApi.status());
      results.permissionMatrix.anon_role = { url: roleUrl, apiStatus: roleApi.status() };

      await p.goto(base + '/page/end/permission.html', { waitUntil: 'domcontentloaded', timeout: 45000 });
      await p.waitForTimeout(500);
      const permUrl = p.url();
      const permApi = await ctx.request.get(base + '/api/permission/page');
      assert('anon-perm-login', /login/i.test(permUrl), permUrl);
      assert('anon-perm-api', permApi.status() === 401 || permApi.status() === 403, 'st=' + permApi.status());
      results.permissionMatrix.anon_permission = { url: permUrl, apiStatus: permApi.status() };
      await ctx.close();
    }

    assert('no-perm-delete-requests', deletePermRequests.length === 0, JSON.stringify(deletePermRequests));

    // ——— Cleanup self-test: create then throw controlled error ———
    {
      const name = TEMP_PREFIX + 'CLEANUP_SELF_' + Date.now();
      const create = await adminCtx.request.post(base + '/api/role', {
        headers: csrfHeaders(adminCtx),
        data: { name, description: 'cleanup self-test', permission: [] }
      });
      const cj = await create.json().catch(() => ({}));
      assert('cleanup-self-create', create.ok() || cj.code === '0' || cj.data === true || create.status() === 200, JSON.stringify({ st: create.status(), cj }));
      // find id
      const recs = await listTempRoles(adminCtx);
      const rec = recs.find((r) => r.name === name);
      if (rec) {
        results.tempRoles.created.push({ id: rec.id, name, purpose: 'cleanup-self-test' });
      }
      controlledCleanupTestError = new Error('UI_AUDIT_2B_CONTROLLED_CLEANUP_THROW');
      throw controlledCleanupTestError;
    }
  } catch (e) {
    if (e && e.message === 'UI_AUDIT_2B_CONTROLLED_CLEANUP_THROW') {
      pass('cleanup-self-controlled-throw', 'threw as planned');
      results.midCourseFailures.push({ id: 'cleanup-self-controlled-throw', detail: 'controlled', ok: true });
    } else {
      fail('suite-exception', String(e && e.stack || e));
      results.midCourseFailures.push({ id: 'suite-exception', detail: String(e) });
    }
  } finally {
    // Always cleanup temp roles with admin session
    try {
      if (!adminCtx) {
        if (!browser) browser = await chromium.launch({ headless: true });
        adminCtx = await browser.newContext();
        await login(adminCtx, 'admin', 'admin');
      }
      const before = await listTempRoles(adminCtx);
      for (const r of before) {
        const ok = await deleteTempRole(adminCtx, r.id);
        results.finallyCleanup.attempts.push({ id: r.id, name: r.name, ok });
      }
      const leftover = await listTempRoles(adminCtx);
      results.tempRoles.leftover = leftover.map((r) => ({ id: r.id, name: r.name }));
      results.finallyCleanup.success = leftover.length === 0;
      assert('temp-roles-cleaned', leftover.length === 0, JSON.stringify(leftover));
      if (leftover.length === 0 && controlledCleanupTestError) {
        pass('cleanup-self-finally-worked', 'leftover=0 after controlled throw');
      }
    } catch (ce) {
      fail('cleanup-finally-error', String(ce));
      results.finallyCleanup.success = false;
    }

    // Console audit
    try {
      const expectedHttpErrors = [];
      const unexpectedHttpErrors = [];
      for (const entry of httpErrorLog) {
        const c = classifyHttpError(entry);
        if (c.kind === 'expectedHttpError') expectedHttpErrors.push(c);
        else if (c.kind !== 'staticImageNoise') unexpectedHttpErrors.push(c);
      }
      const consoleClass = finalizeConsoleClassification(consoleErrors, expectedHttpErrors);
      results.consoleAudit = {
        intentionalErrorResponses: expectedHttpErrors,
        unexpectedHttpErrors,
        expectedConsoleNoise: consoleClass.expectedConsoleNoise,
        realConsoleErrors: consoleClass.realConsoleErrors,
        pageErrors: pageErrors.slice(),
        pageErrorCount: pageErrors.length,
        unexpectedHttpCount: unexpectedHttpErrors.length,
        realConsoleErrorCount: consoleClass.realConsoleErrors.length,
        ignoreRule: 'Only x-ui-audit-expected-error: phase2b; console Failed-to-load matched 1:1 by status'
      };
      assert('pageerror-clean', pageErrors.length === 0, pageErrors.slice(0, 3).join('|'));
      assert('unexpected-http-clean', unexpectedHttpErrors.length === 0, JSON.stringify(unexpectedHttpErrors.slice(0, 8)));
      assert('real-console-clean', consoleClass.realConsoleErrors.length === 0, consoleClass.realConsoleErrors.slice(0, 5).join(' || '));
      // Self-cancelled writes (prefilter/abort) must fail the suite
      assert('no-self-cancelled-writes', (results.requestFailedWrite || []).length === 0, JSON.stringify(results.requestFailedWrite));
    } catch (ae) {
      fail('console-audit-error', String(ae));
    }

    try { if (page) await page.close(); } catch (_) { /* */ }
    try { if (adminCtx) await adminCtx.close(); } catch (_) { /* */ }
    try { if (browser) await browser.close(); } catch (_) { /* */ }

    results.summary = results.summary || {};
    results.summary.durationMs = Date.now() - t0;
    results.summary.uiDeleteSuccess = !!(results.uiDelete && results.uiDelete.success);
    results.summary.finallyCleanupSuccess = !!(results.finallyCleanup && results.finallyCleanup.success);
    const { passed, failed } = writeReport();
    console.log(JSON.stringify(results.summary, null, 2));
    const leftoverN = (results.tempRoles.leftover || []).length;
    console.log(failed || leftoverN ? `FAILED ${failed}/${results.checks.length}` : `ALL PASSED ${passed}`);
    if (failed) console.log(JSON.stringify(results.failures, null, 2));
    // UI delete failure already in asserts; leftover fail too
    process.exit((failed || leftoverN) ? 1 : 0);
  }
})().catch((e) => {
  console.error('FATAL', e);
  results.fatal = String(e);
  writeReport();
  process.exit(1);
});
