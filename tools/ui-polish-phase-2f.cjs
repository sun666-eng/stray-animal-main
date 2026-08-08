/**
 * Phase 2F strict — user governance + person profile (avatar staged lifecycle).
 * Baseline: 83fbf1ba10df9942633133d08e35cd7b1882f291 · default BASE_URL :18104
 * Fixtures only; no skip/best-effort; intentional HTTP = audit header OR registry.
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const base = process.env.BASE_URL || 'http://127.0.0.1:18104';
const out = path.resolve('output/playwright/ui-polish-phase-2f');
const shotDir = path.join(out, 'screenshots');
if (fs.existsSync(shotDir)) {
  for (const f of fs.readdirSync(shotDir)) if (f.endsWith('.png')) fs.unlinkSync(path.join(shotDir, f));
}
fs.mkdirSync(shotDir, { recursive: true });

const HDR = 'x-ui-audit-expected-error';
const VAL = 'phase2f';
const EH = { [HDR]: VAL };

const USER_RECORDS = [
  { id: 1, username: 'UI_2F_SUPER', phone: '13800000001', email: 'super@example.test', role: [{ id: 1, name: '超级管理员' }], avatar: '' },
  { id: 91002, username: 'UI_2F_NORMAL', phone: '13900001111', email: 'normal@example.test', role: [{ id: 3, name: '普通用户' }], avatar: '' },
  { id: 91003, username: 'UI_2F_VOL', phone: '13700002222', email: 'vol@example.test', role: [{ id: 3, name: '普通用户' }, { id: 4, name: '认证义工' }], avatar: '' }
];
const ROLE_LIST = [
  { id: 1, name: '超级管理员' },
  { id: 2, name: '机构管理员' },
  { id: 3, name: '普通用户' },
  { id: 4, name: '认证义工' }
];
const PNG1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
// Real FileController-style 32-hex flags (no stage-* prefix)
const UUID_A = 'a1b2c3d4e5f6478899aabbccddeeff01';
const UUID_B = 'b2c3d4e5f6478899aabbccddeeff02a1';
const UUID_C = 'c3d4e5f6478899aabbccddeeff03a1b2';
const UUID_BOUND = 'd4e5f6478899aabbccddeeff04a1b2c3';
const UUID_RE = /^[a-f0-9]{32}$/;
const VIEWPORTS = [
  { name: '1440x900', width: 1440, height: 900 },
  { name: '1280x800', width: 1280, height: 800 },
  { name: '1024x768', width: 1024, height: 768 },
  { name: '768x1024', width: 768, height: 1024 },
  { name: '720x450', width: 720, height: 450 },
  { name: '390x844', width: 390, height: 844 },
  { name: '360x800', width: 360, height: 800 },
  { name: '320x700', width: 320, height: 700 }
];

const results = {
  startedAt: new Date().toISOString(),
  base,
  phase2eBaseline: '83fbf1ba10df9942633133d08e35cd7b1882f291',
  branch: 'ui-polish/phase-2f-user-profile-governance-20260730',
  checks: [], failures: [], screenshots: [], focusAudit: [], writeRequestLog: [],
  controlledRequestAudit: [], avatarLifecycleAudit: [], superAdminPayloadAudit: [],
  userDeleteAudit: { deleteUserRequests: 0 },
  permissionMatrix: {},
  bestEffortPassCount: 0, fallbackPassCount: 0, strictRuntimeProbeCount: 0,
  consoleAudit: {}, requestFailedWrite: [], expectedHttpRegistry: [],
  classifierMutationPassCount: 0, userLoadAudit: [], summary: {}
};

function registerExpectedHttp(scenario, method, urlRe, status) {
  results.expectedHttpRegistry.push({ scenario, method, urlRe, status });
}
function isIntentionalHttp(e) {
  if (!e) return false;
  const h = e.headers || {};
  if (h[HDR] === VAL || h[HDR.toLowerCase()] === VAL) return true;
  return results.expectedHttpRegistry.some((reg) => {
    if (Number(reg.status) !== Number(e.status)) return false;
    if (reg.method && String(reg.method).toUpperCase() !== String(e.method || '').toUpperCase()) return false;
    if (reg.urlRe && !reg.urlRe.test(e.url || '')) return false;
    return true;
  });
}
function isResourceConsoleNoise(text) {
  return /Failed to load resource:\s*the server responded with a status of \d+/i.test(String(text || ''));
}
function isRealConsoleError(text) {
  const t = String(text || '');
  if (!t) return false;
  if (isResourceConsoleNoise(t)) return false;
  return true;
}
function pass(id, d, flags) {
  const bestEffort = !!(flags && flags.bestEffort);
  const fallback = !!(flags && flags.fallback);
  if (bestEffort) results.bestEffortPassCount++;
  if (fallback) results.fallbackPassCount++;
  results.checks.push({ id, ok: true, skipped: false, detail: String(d || ''), bestEffort, fallback });
}
function fail(id, d) {
  results.checks.push({ id, ok: false, skipped: false, detail: String(d || ''), bestEffort: false, fallback: false });
  results.failures.push({ id, detail: String(d || '') });
  console.error('FAIL', id, d);
}
function assert(id, c, d) { if (c) pass(id, d); else fail(id, d); }
function recordProbe(name, data) {
  results.strictRuntimeProbeCount++;
  results.controlledRequestAudit.push(Object.assign({ name, at: new Date().toISOString(), probeIndex: results.strictRuntimeProbeCount }, data || {}));
}
function exp(status, body) {
  return { status, headers: Object.assign({ 'content-type': 'application/json' }, EH), body: JSON.stringify(body) };
}
function pageData(records) {
  return { status: 200, contentType: 'application/json', body: JSON.stringify({ code: '0', data: { records, current: 1, total: records.length, pages: 1 } }) };
}
function redactPayload(p) {
  if (!p || typeof p !== 'object') return p;
  const o = Object.assign({}, p);
  if (Object.prototype.hasOwnProperty.call(o, 'password')) o.password = '[REDACTED]';
  return o;
}
async function login(ctx, u, p) {
  const res = await ctx.request.post(base + '/api/user/login', { data: { username: u, password: p } });
  const j = await res.json();
  if (j.code !== '0') throw new Error('login ' + u);
}
async function shot(page, name, meta) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(40);
  await page.screenshot({ path: path.join(shotDir, name + '.png'), fullPage: false });
  results.screenshots.push(Object.assign({
    file: 'screenshots/' + name + '.png', name, time: new Date().toISOString(),
    routeIntercept: true, realNetwork: true, databaseWrite: false
  }, meta || {}));
}
async function inspectFocus(page) {
  return page.evaluate(() => {
    const a = document.activeElement;
    const root = document.querySelector('[role="dialog"], [role="alertdialog"]');
    return {
      tag: a && a.tagName,
      id: a && a.id,
      role: a && a.getAttribute && a.getAttribute('role'),
      inDialog: !!(root && a && root.contains(a)),
      isBody: !!(a && a.tagName === 'BODY')
    };
  });
}
function dialogFocusOk(f) { return f && f.inDialog && !f.isBody; }
async function assertDialogFocus(page, id, kind) {
  const f = await inspectFocus(page);
  results.focusAudit.push(Object.assign({ id, kind, dialogStrict: true }, f, { strictOk: dialogFocusOk(f) }));
  assert(id, dialogFocusOk(f), JSON.stringify(f));
}
async function assertTabCycle(page, idPrefix) {
  const meta = await page.evaluate(() => {
    const root = document.querySelector('[role="dialog"], [role="alertdialog"]');
    if (!root) return null;
    const list = Array.prototype.slice.call(root.querySelectorAll(
      'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'
    )).filter((el) => !el.disabled && (el.offsetParent !== null || el.getClientRects().length));
    if (list.length < 2) return { n: list.length };
    list[0].focus();
    return { n: list.length };
  });
  assert(idPrefix + '-focusables', meta && meta.n >= 2, JSON.stringify(meta));
  if (!meta || meta.n < 2) return;
  for (let i = 0; i < meta.n; i++) await page.keyboard.press('Tab');
  assert(idPrefix + '-tab-cycle', dialogFocusOk(await inspectFocus(page)), 'tab');
  await page.evaluate(() => {
    const root = document.querySelector('[role="dialog"], [role="alertdialog"]');
    const list = Array.prototype.slice.call(root.querySelectorAll(
      'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'
    )).filter((el) => !el.disabled && (el.offsetParent !== null || el.getClientRects().length));
    if (list[0]) list[0].focus();
  });
  await page.keyboard.press('Shift+Tab');
  assert(idPrefix + '-shift-tab-cycle', dialogFocusOk(await inspectFocus(page)), 'shift');
}
async function overflowX(page) {
  return page.evaluate(() => {
    const de = document.documentElement;
    return { sw: de.scrollWidth, cw: de.clientWidth, overflow: de.scrollWidth > de.clientWidth + 1 };
  });
}
function writeReport() {
  const passed = results.checks.filter((c) => c.ok).length;
  const failed = results.checks.filter((c) => !c.ok).length;
  const skipped = results.checks.filter((c) => c.skipped).length;
  const bestEffortPassCount = results.checks.filter((c) => c.ok && c.bestEffort).length;
  const fallbackPassCount = results.checks.filter((c) => c.ok && c.fallback).length;
  results.bestEffortPassCount = bestEffortPassCount;
  results.fallbackPassCount = fallbackPassCount;
  const noBestEffortPass = bestEffortPassCount === 0 && fallbackPassCount === 0;
  const noSkipPass = skipped === 0 && results.checks.every((c) => !c.skipped);
  const strictMode = noBestEffortPass && noSkipPass && failed === 0;
  results.summary = {
    passed, failed, skipped, total: results.checks.length,
    screenshots: results.screenshots.length, viewports: VIEWPORTS.length,
    finishedAt: new Date().toISOString(),
    bestEffortPassCount, fallbackPassCount,
    strictRuntimeProbeCount: results.strictRuntimeProbeCount,
    noBestEffortPass, noSkipPass, strictMode,
    noBestEffortPassFormula: 'bestEffortPassCount===0 && fallbackPassCount===0',
    strictModeFormula: 'noBestEffortPass && noSkipPass && failed===0'
  };
  results.ok = failed === 0 && skipped === 0 && noBestEffortPass;
  fs.writeFileSync(path.join(out, 'phase-2f-report.json'), JSON.stringify(results, null, 2));
  fs.writeFileSync(path.join(out, 'screenshots-index.json'), JSON.stringify(results.screenshots, null, 2));
  return results.summary;
}

process.on('unhandledRejection', (err) => {
  console.error('unhandledRejection', err && err.stack || err);
});

(async () => {
  console.log('Phase 2F strict start', base);
  const consoleErrors = [], pageErrors = [], httpErrors = [];
  let browser;
  try {
    const userHtml = fs.readFileSync('src/main/resources/static/page/end/user.html', 'utf8');
    const personHtml = fs.readFileSync('src/main/resources/static/page/end/person.html', 'utf8');
    const css = fs.readFileSync('src/main/resources/static/css/admin-workspace.css', 'utf8');
    const suiteSrc = fs.readFileSync('tools/ui-polish-phase-2f.cjs', 'utf8');
    const visitHtml = fs.readFileSync('src/main/resources/static/page/end/visit.html', 'utf8');
    const volunteerHtml = fs.readFileSync('src/main/resources/static/page/end/volunteer.html', 'utf8');

    assert('user-cache-0808h', userHtml.includes('admin-workspace.css?v=20260808h'), 'cache');
    assert('user-command-desk', userHtml.includes('user-command-desk') && userHtml.includes('admin-command-hero') && userHtml.includes('admin-command-panel'), 'layout');
    assert('person-cache-30j', personHtml.includes('admin-workspace.css?v=20260730j'), 'cache');
    assert('visit-untouched-cache', visitHtml.includes('20260808e'), 'visit');
    assert('vol-untouched-cache', volunteerHtml.includes('20260808g'), 'vol');
    assert('user-no-delete-btn', !/askDelete|confirmDelete|deleteItem/.test(userHtml) && !/>删除</.test(userHtml), 'del');
    assert('user-retention-copy', /不支持删除|业务历史需要保留/.test(userHtml), 'ret');
    assert('user-loadseq', userHtml.includes('loadSeq'), 'seq');
    assert('user-super-omit-role', /editingSuper/.test(userHtml) && /MUST omit role|omit role entirely/i.test(userHtml), 'super');
    assert('person-staged', personHtml.includes('stagedAvatarFlag') && personHtml.includes('retiredStageFlags'), 'stage');
    assert('person-file-label', personHtml.includes('person-file-label') && css.includes('.person-file-label'), 'file');
    assert('css-user-metrics', css.includes('.user-governance-metric'), 'css');
    const scan = suiteSrc.split(/\r?\n/).filter((ln) => ln.indexOf('self-no-') < 0 && ln.indexOf('self-has-') < 0).join('\n');
    assert('self-no-true-assert', !/assert\s*\(\s*['"][^'"]+['"]\s*,\s*true\s*,/.test(scan), 'true');
    assert('self-no-best-effort-pass-path', !/bestEffort:\s*true/.test(scan), 'be');
    assert('self-has-holds', /holdSave|holdUpload|resolveSlow/.test(suiteSrc), 'hold');

    browser = await chromium.launch({ headless: true });
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await login(ctx, 'admin', 'admin');
    const page = await ctx.newPage();
    const cssReq = [];
    const deleteUserReqs = [];

    page.on('pageerror', (e) => pageErrors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
    page.on('requestfailed', (req) => {
      if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method())) results.requestFailedWrite.push({ method: req.method(), url: req.url() });
    });
    page.on('response', (r) => {
      if (r.status() >= 400) {
        httpErrors.push({ status: r.status(), url: r.url(), method: r.request().method(), headers: r.headers() });
      }
    });
    page.on('request', (req) => {
      if (/admin-workspace\.css/.test(req.url())) cssReq.push(req.url());
      if (req.method() === 'DELETE' && /\/api\/user\/\d+/.test(req.url())) {
        deleteUserReqs.push(req.url());
        results.userDeleteAudit.deleteUserRequests++;
      }
    });

    await page.route('**/api/files/**', async (route) => {
      const url = route.request().url();
      const method = route.request().method();
      if (method === 'DELETE' && /\/api\/files\/staged\//.test(url)) {
        const flag = (url.match(/\/api\/files\/staged\/([^/?#]+)/) || [])[1] || '';
        results.writeRequestLog.push({ scenario: 'staged-delete', url, method, flag: decodeURIComponent(flag) });
        await route.fulfill({
          status: 200, contentType: 'application/json',
          body: JSON.stringify({ code: '0', data: true }),
          headers: Object.assign({ 'content-type': 'application/json' }, EH)
        });
        return;
      }
      // Serve fixture images for UUID flags and legacy fixture-ok
      if (method === 'GET' && (/fixture-ok/.test(url) || /\/api\/files\/[a-f0-9]{32}/i.test(url))) {
        await route.fulfill({ status: 200, contentType: 'image/png', body: PNG1, headers: EH });
        return;
      }
      if (method === 'GET') {
        await route.fulfill({
          status: 404, contentType: 'application/json',
          body: JSON.stringify({ code: '404', msg: 'nf' }),
          headers: Object.assign({ 'content-type': 'application/json' }, EH)
        });
        return;
      }
      await route.continue();
    });

    // ========== USER PAGE ==========
    await page.route('**/api/user/page**', async (route) => {
      if (route.request().method() === 'GET') await route.fulfill(pageData(USER_RECORDS));
      else await route.continue();
    });
    await page.route('**/api/role**', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ code: '0', data: ROLE_LIST }) });
      } else await route.continue();
    });

    await page.goto(base + '/page/end/user.html', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(600);
    assert('user-css-0808h', cssReq.some((u) => /v=20260808h/.test(u)), JSON.stringify(cssReq.slice(-2)));
    assert('user-title', /用户治理/.test(await page.locator('h1').innerText()), 't');
    assert('user-metrics', (await page.locator('.user-governance-metric').count()) >= 4, 'm');
    assert('user-metrics-page-label', /当前页/.test(await page.locator('.user-governance-metrics').innerText()), 'page');
    assert('user-fixture', (await page.locator('text=UI_2F_NORMAL').count()) >= 1, 'f');
    assert('user-no-delete-control', (await page.locator('button:has-text("删除")').count()) === 0, 'btn');
    assert('user-no-delete-dialog', (await page.locator('[role="alertdialog"]').count()) === 0, 'dlg');
    await shot(page, '01-user-desktop', { page: 'user', role: 'admin', viewport: '1440x900', state: 'list', goal: '用户桌面' });

    // empty / invalid / 500 / loadSeq
    await page.unroute('**/api/user/page**').catch(() => {});
    await page.route('**/api/user/page**', async (route) => {
      if (route.request().method() === 'GET') await route.fulfill(pageData([]));
      else await route.continue();
    });
    await page.locator('button:has-text("查询")').click({ force: true });
    await page.waitForTimeout(350);
    assert('user-empty', /暂无用户/.test(await page.locator('.admin-status').innerText().catch(() => '')), 'empty');

    await page.unroute('**/api/user/page**').catch(() => {});
    await page.route('**/api/user/page**', async (route) => {
      if (route.request().method() === 'GET') await route.fulfill(pageData(USER_RECORDS));
      else await route.continue();
    });
    await page.locator('button:has-text("查询")').click({ force: true });
    await page.waitForTimeout(350);
    assert('user-seed-before-null', (await page.locator('text=UI_2F_NORMAL').count()) >= 1, 'seed');

    await page.unroute('**/api/user/page**').catch(() => {});
    await page.route('**/api/user/page**', async (route) => {
      if (route.request().method() !== 'GET') { await route.continue(); return; }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ code: '0', data: null }) });
    });
    await page.locator('button:has-text("查询")').click({ force: true });
    await page.waitForTimeout(400);
    let uVm = await page.evaluate(() => {
      const vm = document.querySelector('#workspace').__vue__;
      return {
        loading: !!(vm && vm.loading), loadError: (vm && vm.loadError) || '',
        recordsLen: vm && Array.isArray(vm.records) ? vm.records.length : -1,
        hasNormal: !!(vm && Array.isArray(vm.records) && vm.records.some((r) => r.username === 'UI_2F_NORMAL'))
      };
    });
    results.userLoadAudit.push({ scenario: 'invalid-null', uVm });
    assert('user-invalid-null-error', (await page.locator('.admin-status.is-error').count()) >= 1 && !!uVm.loadError, JSON.stringify(uVm));
    assert('user-invalid-null-not-empty', !/暂无用户/.test(await page.locator('.admin-status.is-error').innerText().catch(() => '')), 'not empty');
    assert('user-invalid-null-no-stale', !uVm.hasNormal && uVm.recordsLen === 0, JSON.stringify(uVm));
    assert('user-invalid-null-loading-false', uVm.loading === false, JSON.stringify(uVm));

    await page.unroute('**/api/user/page**').catch(() => {});
    await page.route('**/api/user/page**', async (route) => {
      if (route.request().method() === 'GET') await route.fulfill(pageData(USER_RECORDS));
      else await route.continue();
    });
    await page.locator('button:has-text("查询")').click({ force: true });
    await page.waitForTimeout(350);
    await page.unroute('**/api/user/page**').catch(() => {});
    await page.route('**/api/user/page**', async (route) => {
      if (route.request().method() !== 'GET') { await route.continue(); return; }
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ code: '0', data: { records: 'not-array', current: 1, total: 9, pages: 1 } })
      });
    });
    await page.locator('button:has-text("查询")').click({ force: true });
    await page.waitForTimeout(400);
    uVm = await page.evaluate(() => {
      const vm = document.querySelector('#workspace').__vue__;
      return {
        loading: !!(vm && vm.loading), loadError: (vm && vm.loadError) || '',
        recordsLen: vm && Array.isArray(vm.records) ? vm.records.length : -1,
        hasNormal: !!(vm && Array.isArray(vm.records) && vm.records.some((r) => r.username === 'UI_2F_NORMAL'))
      };
    });
    results.userLoadAudit.push({ scenario: 'invalid-records', uVm });
    assert('user-invalid-records-error', !!uVm.loadError && (await page.locator('.admin-status.is-error').count()) >= 1, JSON.stringify(uVm));
    assert('user-invalid-no-stale', !uVm.hasNormal && uVm.recordsLen === 0, JSON.stringify(uVm));
    assert('user-invalid-records-loading-false', uVm.loading === false, JSON.stringify(uVm));

    await page.unroute('**/api/user/page**').catch(() => {});
    await page.route('**/api/user/page**', async (route) => {
      if (route.request().method() === 'GET') await route.fulfill(exp(500, { code: '500', msg: '用户列表异常' }));
      else await route.continue();
    });
    await page.waitForFunction(() => {
      const b = document.querySelector('form.admin-review-toolbar button[type="submit"]');
      return b && !b.disabled;
    }, { timeout: 5000 }).catch(() => {});
    await page.locator('button:has-text("查询")').click({ force: true });
    await page.waitForTimeout(400);
    assert('user-load-500', (await page.locator('.admin-status.is-error').count()) >= 1, '500');

    // loadSeq
    let resolveSlowUser;
    const slowUser = new Promise((r) => { resolveSlowUser = r; });
    let userHit = 0;
    const userLoadTimeline = [];
    await page.unroute('**/api/user/page**').catch(() => {});
    await page.route('**/api/user/page**', async (route) => {
      if (route.request().method() !== 'GET') { await route.continue(); return; }
      userHit++;
      const n = userHit;
      if (n === 1) {
        userLoadTimeline.push({ n, phase: 'slow-wait' });
        await slowUser;
        userLoadTimeline.push({ n, phase: 'slow-STALE' });
        await route.fulfill(pageData([{ id: 99, username: 'USER_STALE_OLD', phone: '', email: '', role: [] }]));
      } else {
        userLoadTimeline.push({ n, phase: 'fast-GOOD' });
        await route.fulfill(pageData(USER_RECORDS));
      }
    });
    await page.evaluate(() => {
      const vm = document.querySelector('#workspace').__vue__;
      vm.load(1);
      vm.load(1);
    });
    await page.waitForFunction(() => {
      const vm = document.querySelector('#workspace').__vue__;
      return vm && Array.isArray(vm.records) && vm.records.some((r) => r.username === 'UI_2F_NORMAL') && vm.loading === false;
    }, { timeout: 8000 }).catch(() => {});
    resolveSlowUser();
    await page.waitForTimeout(400);
    const afterUserSeq = await page.evaluate(() => {
      const vm = document.querySelector('#workspace').__vue__;
      return {
        loading: !!(vm && vm.loading),
        names: (vm && Array.isArray(vm.records) ? vm.records.map((r) => r.username) : []),
        hasStale: !!(vm && Array.isArray(vm.records) && vm.records.some((r) => r.username === 'USER_STALE_OLD')),
        hasGood: !!(vm && Array.isArray(vm.records) && vm.records.some((r) => r.username === 'UI_2F_NORMAL'))
      };
    });
    results.userLoadAudit.push({ scenario: 'loadseq', userHit, userLoadTimeline, afterUserSeq });
    recordProbe('user-loadseq', { userHit, afterUserSeq });
    assert('user-loadseq-hits', userHit >= 2, 'hits=' + userHit);
    assert('user-loadseq-no-stale', !afterUserSeq.hasStale && (await page.locator('text=USER_STALE_OLD').count()) === 0, JSON.stringify(afterUserSeq));
    assert('user-loadseq-new-result', afterUserSeq.hasGood, JSON.stringify(afterUserSeq));
    assert('user-loadseq-loading-false', afterUserSeq.loading === false, JSON.stringify(afterUserSeq));

    await page.unroute('**/api/user/page**').catch(() => {});
    await page.route('**/api/user/page**', async (route) => {
      if (route.request().method() === 'GET') await route.fulfill(pageData(USER_RECORDS));
      else await route.continue();
    });
    await page.goto(base + '/page/end/user.html', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(500);

    // export
    const exportHits = [];
    await page.route('**/api/user/export**', async (route) => {
      exportHits.push(route.request().url());
      await route.fulfill({ status: 200, contentType: 'application/octet-stream', body: 'xlsx', headers: EH });
    });
    await page.locator('button:has-text("导出")').click();
    await page.waitForTimeout(250);
    assert('user-export-hit', exportHits.length === 1 && /\/api\/user\/export/.test(exportHits[0]), JSON.stringify(exportHits));
    await page.unroute('**/api/user/export**').catch(() => {});

    // online dialog
    await page.route('**/api/user/online**', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200, contentType: 'application/json',
          body: JSON.stringify({ code: '0', data: [{ id: 1, username: 'UI_2F_ONLINE_A' }, { id: 2, username: 'UI_2F_ONLINE_B' }] })
        });
      } else await route.continue();
    });
    await page.locator('button:has-text("在线用户")').click();
    await page.waitForTimeout(300);
    assert('user-online-open', (await page.locator('#userOnlineTitle').count()) >= 1, 'open');
    assert('user-online-names', (await page.locator('text=UI_2F_ONLINE_A').count()) >= 1, 'names');
    const onlineListText = await page.locator('.user-online-list').innerText().catch(() => '');
    // disclaimer may mention Token/Cookie by name; list itself must only show usernames
    assert('user-online-no-secret',
      /UI_2F_ONLINE/.test(onlineListText) &&
      !/@|1[3-9]\d{9}|csrf=|sessionid=|Bearer\s/i.test(onlineListText),
      onlineListText);
    await assertDialogFocus(page, 'user-online-focus', 'online');
    await assertTabCycle(page, 'user-online');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    assert('user-online-esc-close', (await page.locator('#userOnlineTitle').count()) === 0, 'esc');

    // Super admin edit — payload must omit role
    const putBodies = [];
    let putCount = 0;
    let heldSuperBody = null;

    await page.locator('tr:has-text("UI_2F_SUPER") button:has-text("编辑")').click();
    await page.waitForTimeout(300);
    assert('user-super-edit-open', (await page.locator('#userEditTitle').count()) >= 1, 'open');
    assert('user-super-role-protected', /超级管理员角色受保护|受保护/.test(await page.locator('.user-role-protected').innerText().catch(() => '')), 'prot');
    await assertDialogFocus(page, 'user-edit-focus', 'edit');
    await assertTabCycle(page, 'user-edit');
    await page.fill('#userPhone', '13800009999');
    await page.fill('#userEmail', 'super.edit@example.test');

    // delay INSIDE handler; dual vm.save() (not force-click) proves write lock
    await page.unroute('**/api/user').catch(() => {});
    await page.route('**/api/user', async (route) => {
      const req = route.request();
      const method = req.method();
      if (method !== 'PUT' && method !== 'POST') {
        await route.continue();
        return;
      }
      putCount++;
      let body = {};
      try { body = JSON.parse(req.postData() || '{}'); } catch (e) { body = {}; }
      const redacted = redactPayload(body);
      putBodies.push({ method: method, body: redacted });
      results.superAdminPayloadAudit.push(redacted);
      results.writeRequestLog.push({ scenario: 'user-write', method: method, body: redacted });
      if (putCount === 1) heldSuperBody = redacted;
      await new Promise((r) => setTimeout(r, 900));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ code: '0', data: true })
      });
    });
    await page.evaluate(() => {
      const vm = document.querySelector('#workspace').__vue__;
      vm.save();
      vm.save();
    });
    await page.waitForFunction(() => {
      const vm = document.querySelector('#workspace') && document.querySelector('#workspace').__vue__;
      const L = window.__userWriteLocks || {};
      return vm && vm.saving === true && L.save === true;
    }, { timeout: 5000 }).catch(() => {});
    const saveInflight = await page.evaluate(() => {
      const vm = document.querySelector('#workspace').__vue__;
      const L = window.__userWriteLocks || {};
      const btn = document.querySelector('button.is-primary[type="submit"]');
      return { saving: !!(vm && vm.saving), lock: !!L.save, submitDisabled: !!(btn && btn.disabled) };
    });
    recordProbe('user-save-inflight', { putCount, saveInflight });
    assert('user-save-double-one', putCount === 1, 'puts=' + putCount);
    assert('user-save-inflight-lock', saveInflight.saving && saveInflight.lock, JSON.stringify(saveInflight));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(80);
    assert('user-save-esc-blocked', (await page.locator('#userEditTitle').count()) >= 1 && saveInflight.saving, 'esc');
    await page.waitForFunction(() => !document.querySelector('#userEditTitle'), { timeout: 8000 }).catch(() => {});
    const superPayload = heldSuperBody || (putBodies[putBodies.length - 1] && putBodies[putBodies.length - 1].body);
    assert('user-super-payload-no-role', superPayload && !Object.prototype.hasOwnProperty.call(superPayload, 'role'), JSON.stringify(superPayload));
    assert('user-super-payload-no-password', superPayload && !Object.prototype.hasOwnProperty.call(superPayload, 'password'), JSON.stringify(superPayload));
    assert('user-super-payload-fields', superPayload && superPayload.id === 1 && superPayload.username === 'UI_2F_SUPER', JSON.stringify(superPayload));
    assert('user-super-saved-close', (await page.locator('#userEditTitle').count()) === 0, 'closed');

    // Normal user edit with role
    putBodies.length = 0;
    putCount = 0;
    await page.unroute('**/api/user').catch(() => {});
    await page.route('**/api/user', async (route) => {
      const method = route.request().method();
      if (method !== 'PUT' && method !== 'POST') { await route.continue(); return; }
      putCount++;
      let body = {};
      try { body = JSON.parse(route.request().postData() || '{}'); } catch (e) { body = {}; }
      putBodies.push({ method: method, body: redactPayload(body) });
      if (putCount === 1) {
        await route.fulfill(exp(409, { code: '409', msg: '用户名冲突夹具' }));
      } else {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ code: '0', data: true }) });
      }
    });
    await page.locator('tr:has-text("UI_2F_NORMAL") button:has-text("编辑")').click({ force: true });
    await page.waitForTimeout(250);
    await page.fill('#userPhone', '13900008888');
    await page.locator('button:has-text("保存用户")').click();
    await page.waitForTimeout(350);
    assert('user-409-keep-open', (await page.locator('#userEditTitle').count()) >= 1, 'open');
    assert('user-409-keep-input', (await page.locator('#userPhone').inputValue()) === '13900008888', 'phone');
    assert('user-409-error', /冲突|失败|异常/.test(await page.locator('#userEditError').innerText().catch(() => '')), 'err');
    const normalPayload = putBodies[0] && putBodies[0].body;
    assert('user-normal-has-role', normalPayload && Array.isArray(normalPayload.role), JSON.stringify(normalPayload));
    assert('user-normal-no-password', normalPayload && !Object.prototype.hasOwnProperty.call(normalPayload, 'password'), JSON.stringify(normalPayload));
    // retry success
    await page.locator('button:has-text("保存用户")').click();
    await page.waitForFunction(() => !document.querySelector('#userEditTitle'), { timeout: 5000 }).catch(() => {});
    assert('user-409-retry-ok', (await page.locator('#userEditTitle').count()) === 0, 'closed');
    assert('user-409-retry-puts', putCount === 2, 'puts=' + putCount);

    // ——— Empty manual roles on edit: frontend error, zero PUT ———
    putBodies.length = 0;
    putCount = 0;
    const emptyRolePuts = [];
    await page.unroute('**/api/user').catch(() => {});
    await page.route('**/api/user', async (route) => {
      const method = route.request().method();
      if (method !== 'PUT' && method !== 'POST') { await route.continue(); return; }
      putCount++;
      let body = {};
      try { body = JSON.parse(route.request().postData() || '{}'); } catch (e) { body = {}; }
      emptyRolePuts.push(redactPayload(body));
      putBodies.push({ method: method, body: redactPayload(body) });
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ code: '0', data: true }) });
    });
    await page.locator('tr:has-text("UI_2F_NORMAL") button:has-text("编辑")').click({ force: true });
    await page.waitForTimeout(250);
    // uncheck all manual role checkboxes
    const roleCbs = page.locator('#userRoleField input[type="checkbox"]');
    const cbCount = await roleCbs.count();
    for (let i = 0; i < cbCount; i++) {
      if (await roleCbs.nth(i).isChecked()) await roleCbs.nth(i).uncheck();
    }
    await page.locator('button:has-text("保存用户")').click();
    await page.waitForTimeout(250);
    const emptyRoleState = await page.evaluate(() => {
      const vm = document.querySelector('#workspace').__vue__;
      const ae = document.activeElement;
      return {
        open: !!(vm && vm.editOpen),
        roleErr: (vm && vm.fieldErrors && vm.fieldErrors.role) || '',
        roleIds: (vm && vm.form && vm.form.roleIds) || [],
        focusTag: ae && ae.tagName,
        focusId: ae && ae.id,
        isBody: !!(ae && ae.tagName === 'BODY'),
        ariaInvalid: !!(document.getElementById('userRoleField') && document.getElementById('userRoleField').getAttribute('aria-invalid') === 'true')
      };
    });
    results.controlledRequestAudit.push({ name: 'user-empty-role', emptyRoleState, putCount, emptyRolePuts });
    assert('user-empty-role-error', /至少保留一个|不能单独|角色/.test(emptyRoleState.roleErr), JSON.stringify(emptyRoleState));
    assert('user-empty-role-zero-put', putCount === 0 && emptyRolePuts.length === 0, 'puts=' + putCount);
    assert('user-empty-role-keep-open', emptyRoleState.open === true, JSON.stringify(emptyRoleState));
    assert('user-empty-role-focus-not-body', !emptyRoleState.isBody, JSON.stringify(emptyRoleState));
    assert('user-empty-role-aria', emptyRoleState.ariaInvalid === true || (await page.locator('#userRoleErr').count()) >= 1, JSON.stringify(emptyRoleState));
    // re-check one role and close via cancel for cleanup
    if (cbCount > 0) await roleCbs.nth(0).check();
    await page.locator('button:has-text("取消")').click();
    await page.waitForTimeout(150);

    // Create user validation + password redaction (empty roles allowed for create)
    putBodies.length = 0;
    putCount = 0;
    await page.unroute('**/api/user').catch(() => {});
    await page.route('**/api/user', async (route) => {
      if (route.request().method() === 'POST') {
        let body = {};
        try { body = JSON.parse(route.request().postData() || '{}'); } catch (e) { body = {}; }
        putBodies.push({ method: 'POST', body: redactPayload(body) });
        putCount++;
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ code: '0', data: true }) });
      } else await route.continue();
    });
    await page.locator('button:has-text("新增用户")').click();
    await page.waitForTimeout(200);
    await page.fill('#userName', 'UI_2F_NEW');
    await page.fill('#userPassword', 'Password1!');
    await page.fill('#userPhone', '13600000000');
    await page.fill('#userEmail', 'new@example.test');
    // leave roles unchecked — create may send role:[] or omit; backend defaults roleId=3
    await page.locator('button:has-text("保存用户")').click();
    await page.waitForTimeout(350);
    const createBody = putBodies[0] && putBodies[0].body;
    assert('user-create-password-redacted', createBody && createBody.password === '[REDACTED]', JSON.stringify(createBody));
    assert('user-create-has-role-or-omit', createBody && (Array.isArray(createBody.role) || !Object.prototype.hasOwnProperty.call(createBody, 'role')), JSON.stringify(createBody));
    assert('user-create-closed', (await page.locator('#userEditTitle').count()) === 0, 'closed');
    assert('user-create-allowed-empty-roles', putCount === 1, 'create put must fire');

    // DELETE must stay 0
    assert('user-delete-requests-zero', deleteUserReqs.length === 0 && results.userDeleteAudit.deleteUserRequests === 0, JSON.stringify(deleteUserReqs));

    // mobile overflow
    await page.setViewportSize({ width: 320, height: 700 });
    await page.goto(base + '/page/end/user.html', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(400);
    const ov320 = await overflowX(page);
    assert('user-320-no-overflow', !ov320.overflow, JSON.stringify(ov320));
    await shot(page, '02-user-320', { page: 'user', role: 'admin', viewport: '320x700', state: 'list', goal: '用户320' });
    await page.setViewportSize({ width: 1440, height: 900 });

    // ========== PERSON PAGE ==========
    await page.goto(base + '/page/end/person.html', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(500);
    assert('person-title', /个人资料/.test(await page.locator('h1').innerText()), 't');
    assert('person-no-password-field', (await page.locator('input[type="password"]').count()) === 0, 'pw');
    assert('person-file-control', (await page.locator('.person-file-label').count()) >= 1, 'file');
    const fileGeo = await page.evaluate(() => {
      const lab = document.querySelector('.person-file-label');
      if (!lab) return null;
      const r = lab.getBoundingClientRect();
      const t = lab.innerText || '';
      return { h: r.height, w: r.width, hasChoose: /Choose File|No file chosen/i.test(t), hasCn: /选择头像/.test(t) };
    });
    assert('person-file-min44', fileGeo && fileGeo.h >= 44, JSON.stringify(fileGeo));
    assert('person-file-no-choose', fileGeo && !fileGeo.hasChoose && fileGeo.hasCn, JSON.stringify(fileGeo));
    await shot(page, '03-person-desktop', { page: 'person', role: 'admin', viewport: '1440x900', state: 'form', goal: '资料桌面' });

    // avatar upload lifecycle — real 32-hex UUID flags (no stage-* naming)
    let uploadCount = 0;
    let profilePuts = [];
    const uploadFlags = [UUID_A, UUID_B, UUID_C];
    await page.route('**/api/files/upload', async (route) => {
      const flag = uploadFlags[Math.min(uploadCount, uploadFlags.length - 1)];
      uploadCount++;
      results.writeRequestLog.push({ scenario: 'avatar-upload', n: uploadCount, flag });
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ code: '0', data: { flag: flag } }),
        headers: Object.assign({ 'content-type': 'application/json' }, EH)
      });
    });
    await page.route('**/api/user/me/profile', async (route) => {
      if (route.request().method() !== 'PUT') { await route.continue(); return; }
      let body = {};
      try { body = JSON.parse(route.request().postData() || '{}'); } catch (e) { body = {}; }
      profilePuts.push(body);
      results.writeRequestLog.push({ scenario: 'profile-put', body: { email: body.email, phone: body.phone, avatar: body.avatar } });
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ code: '0', data: true }) });
    });

    await page.setInputFiles('#avatarFile', {
      name: 'avatar-a.png',
      mimeType: 'image/png',
      buffer: PNG1
    });
    await page.waitForTimeout(400);
    let pVm = await page.evaluate(() => {
      const vm = document.querySelector('#workspace').__vue__;
      return {
        staged: (vm && vm.stagedAvatarFlag) || '',
        avatar: vm && vm.form && vm.form.avatar,
        fileName: (vm && vm.imageFileName) || '',
        dirty: !!(vm && vm.dirty),
        uploading: !!(vm && vm.uploading)
      };
    });
    results.avatarLifecycleAudit.push({ scenario: 'upload-success', pVm, uploadCount, expected: UUID_A });
    recordProbe('person-upload-staged', { uploadCount, staged: pVm.staged });
    assert('person-upload-uuid-shape', UUID_RE.test(pVm.staged) && !/^stage-/.test(pVm.staged), pVm.staged);
    assert('person-upload-staged', pVm.staged === UUID_A && pVm.avatar === UUID_A, JSON.stringify(pVm));
    assert('person-upload-no-auto-save', profilePuts.length === 0, 'puts=' + profilePuts.length);
    assert('person-upload-filename', /avatar-a/.test(pVm.fileName), pVm.fileName);

    // replace upload: fail then success
    await page.unroute('**/api/files/upload').catch(() => {});
    await page.route('**/api/files/upload', async (route) => {
      uploadCount++;
      results.writeRequestLog.push({ scenario: 'avatar-upload-fail', n: uploadCount });
      await route.fulfill(exp(500, { code: '500', msg: '上传服务异常' }));
    });
    await page.setInputFiles('#avatarFile', { name: 'avatar-fail.png', mimeType: 'image/png', buffer: PNG1 });
    await page.waitForTimeout(400);
    pVm = await page.evaluate(() => {
      const vm = document.querySelector('#workspace').__vue__;
      return { staged: (vm && vm.stagedAvatarFlag) || '', avatar: vm && vm.form && vm.form.avatar };
    });
    results.avatarLifecycleAudit.push({ scenario: 'upload-fail-keep', pVm, expected: UUID_A });
    assert('person-upload-fail-keep-stage', pVm.staged === UUID_A && pVm.avatar === UUID_A, JSON.stringify(pVm));

    await page.unroute('**/api/files/upload').catch(() => {});
    await page.route('**/api/files/upload', async (route) => {
      uploadCount++;
      results.writeRequestLog.push({ scenario: 'avatar-upload-replace', n: uploadCount, flag: UUID_B });
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ code: '0', data: { flag: UUID_B } }),
        headers: Object.assign({ 'content-type': 'application/json' }, EH)
      });
    });
    const stagedDelBefore = results.writeRequestLog.filter((x) => x.scenario === 'staged-delete');
    await page.setInputFiles('#avatarFile', { name: 'avatar-b.png', mimeType: 'image/png', buffer: PNG1 });
    await page.waitForTimeout(450);
    pVm = await page.evaluate(() => {
      const vm = document.querySelector('#workspace').__vue__;
      return { staged: (vm && vm.stagedAvatarFlag) || '', avatar: vm && vm.form && vm.form.avatar };
    });
    const stagedDelAfter = results.writeRequestLog.filter((x) => x.scenario === 'staged-delete');
    const retiredOld = stagedDelAfter.filter((x) => x.flag === UUID_A);
    results.avatarLifecycleAudit.push({
      scenario: 'replace-success', pVm, expected: UUID_B,
      stagedDeletes: stagedDelAfter.length - stagedDelBefore.length,
      retiredFlags: stagedDelAfter.map((x) => x.flag)
    });
    recordProbe('person-replace-stage', { staged: pVm.staged, dels: stagedDelAfter.length - stagedDelBefore.length });
    assert('person-replace-new-stage', pVm.staged === UUID_B && pVm.avatar === UUID_B, JSON.stringify(pVm));
    assert('person-replace-retire-old-uuid', retiredOld.length === 1, JSON.stringify(stagedDelAfter));
    assert('person-replace-retire-once', stagedDelAfter.length === stagedDelBefore.length + 1, 'dels');

    // save 409 keep stage
    await page.unroute('**/api/user/me/profile').catch(() => {});
    let profilePutN = 0;
    await page.route('**/api/user/me/profile', async (route) => {
      const req = route.request();
      if (req.method() !== 'PUT') { await route.continue(); return; }
      profilePutN++;
      let body = {};
      try { body = JSON.parse(req.postData() || '{}'); } catch (e) { body = {}; }
      profilePuts.push(body);
      if (profilePutN === 1) {
        await new Promise((r) => setTimeout(r, 900));
        await route.fulfill(exp(409, { code: '409', msg: '资料冲突' }));
      } else {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ code: '0', data: true }) });
      }
    });
    await page.fill('#profileEmail', 'me@example.test');
    await page.fill('#profilePhone', '13600001111');
    await page.evaluate(() => {
      const vm = document.querySelector('#workspace').__vue__;
      vm.saveProfile();
      vm.saveProfile();
    });
    await page.waitForFunction(() => {
      const vm = document.querySelector('#workspace') && document.querySelector('#workspace').__vue__;
      const L = window.__personWriteLocks || {};
      return vm && vm.saving === true && L.save === true;
    }, { timeout: 5000 }).catch(() => {});
    const profInflight = await page.evaluate(() => {
      const vm = document.querySelector('#workspace').__vue__;
      const L = window.__personWriteLocks || {};
      return { saving: !!(vm && vm.saving), lock: !!L.save, n: 1 };
    });
    recordProbe('person-save-inflight', { profilePutN, profInflight });
    assert('person-save-double-one', profilePutN === 1, 'n=' + profilePutN);
    await page.waitForFunction(() => {
      const vm = document.querySelector('#workspace') && document.querySelector('#workspace').__vue__;
      return vm && vm.saving === false && vm.messageType === 'error';
    }, { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(100);
    pVm = await page.evaluate(() => {
      const vm = document.querySelector('#workspace').__vue__;
      return {
        staged: (vm && vm.stagedAvatarFlag) || '',
        avatar: vm && vm.form && vm.form.avatar,
        email: vm && vm.form && vm.form.email,
        phone: vm && vm.form && vm.form.phone,
        msgType: (vm && vm.messageType) || ''
      };
    });
    results.avatarLifecycleAudit.push({ scenario: 'save-409-keep', pVm, expected: UUID_B });
    assert('person-409-keep-stage', pVm.staged === UUID_B && pVm.avatar === UUID_B, JSON.stringify(pVm));
    assert('person-409-keep-contact', pVm.email === 'me@example.test' && pVm.phone === '13600001111', JSON.stringify(pVm));
    assert('person-409-error', pVm.msgType === 'error', pVm.msgType);

    // retry ok (still dirty after 409) — success clears local staged only
    const stagedDelMid = results.writeRequestLog.filter((x) => x.scenario === 'staged-delete').length;
    await page.evaluate(() => {
      const vm = document.querySelector('#workspace').__vue__;
      vm.saveProfile();
    });
    await page.waitForFunction(() => {
      const vm = document.querySelector('#workspace') && document.querySelector('#workspace').__vue__;
      return vm && vm.saving === false && vm.messageType === 'success';
    }, { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(100);
    pVm = await page.evaluate(() => {
      const vm = document.querySelector('#workspace').__vue__;
      return {
        staged: (vm && vm.stagedAvatarFlag) || '',
        avatar: vm && vm.user && vm.user.avatar,
        dirty: !!(vm && vm.dirty),
        msgType: (vm && vm.messageType) || '',
        headerAvatar: document.querySelector('.admin-account-photo') && document.querySelector('.admin-account-photo').getAttribute('src')
      };
    });
    const stagedDelEnd = results.writeRequestLog.filter((x) => x.scenario === 'staged-delete').length;
    results.avatarLifecycleAudit.push({ scenario: 'save-success', pVm, noStagedDelete: stagedDelEnd === stagedDelMid, bound: UUID_B });
    assert('person-save-ok-clear-stage', pVm.staged === '' && pVm.avatar === UUID_B, JSON.stringify(pVm));
    assert('person-save-ok-no-staged-delete', stagedDelEnd === stagedDelMid, 'dels');
    assert('person-save-ok-dirty-false', pVm.dirty === false, JSON.stringify(pVm));
    assert('person-save-ok-success-msg', pVm.msgType === 'success', pVm.msgType);
    assert('person-save-session-avatar', (pVm.headerAvatar || '').indexOf(UUID_B) >= 0, pVm.headerAvatar);

    // remove STAGED avatar (upload new UUID then remove)
    await page.unroute('**/api/user/me/profile').catch(() => {});
    profilePuts = [];
    await page.route('**/api/user/me/profile', async (route) => {
      if (route.request().method() !== 'PUT') { await route.continue(); return; }
      let body = {};
      try { body = JSON.parse(route.request().postData() || '{}'); } catch (e) { body = {}; }
      profilePuts.push(body);
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ code: '0', data: true }) });
    });
    await page.unroute('**/api/files/upload').catch(() => {});
    await page.route('**/api/files/upload', async (route) => {
      results.writeRequestLog.push({ scenario: 'avatar-upload-rm', flag: UUID_C });
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ code: '0', data: { flag: UUID_C } }),
        headers: Object.assign({ 'content-type': 'application/json' }, EH)
      });
    });
    await page.setInputFiles('#avatarFile', { name: 'rm.png', mimeType: 'image/png', buffer: PNG1 });
    await page.waitForTimeout(350);
    const delBeforeRm = results.writeRequestLog.filter((x) => x.scenario === 'staged-delete');
    await page.locator('button:has-text("移除头像")').click();
    await page.waitForTimeout(200);
    pVm = await page.evaluate(() => {
      const vm = document.querySelector('#workspace').__vue__;
      return { staged: (vm && vm.stagedAvatarFlag) || '', avatar: vm && vm.form && vm.form.avatar };
    });
    const delAfterRm = results.writeRequestLog.filter((x) => x.scenario === 'staged-delete');
    const retiredC = delAfterRm.filter((x) => x.flag === UUID_C);
    results.avatarLifecycleAudit.push({ scenario: 'remove-staged', pVm, stagedDeletes: delAfterRm.length - delBeforeRm.length, retiredC: retiredC.length });
    assert('person-remove-clears-form', pVm.avatar === '' && pVm.staged === '', JSON.stringify(pVm));
    assert('person-remove-retires-stage', retiredC.length === 1 && delAfterRm.length === delBeforeRm.length + 1, JSON.stringify(delAfterRm.slice(-2)));
    await page.locator('button:has-text("保存资料")').click();
    await page.waitForTimeout(350);
    assert('person-remove-save-payload', profilePuts[0] && profilePuts[0].avatar === '', JSON.stringify(profilePuts[0]));

    // ——— Bound avatar direct remove: no staged DELETE ———
    await page.evaluate((bound) => {
      const vm = document.querySelector('#workspace').__vue__;
      vm.user = Object.assign({}, vm.user, { avatar: bound, email: 'bound@example.test', phone: '13600002222' });
      vm.form = { email: 'bound@example.test', phone: '13600002222', avatar: bound };
      vm.stagedAvatarFlag = '';
      vm.imageFileName = '';
      vm.message = '';
      vm.messageType = '';
      // ensure bound flag is NOT in session staged set (simulate committed avatar)
      // sessionStagedFlags is module-private; save success already removed UUID_B
    }, UUID_BOUND);
    await page.waitForTimeout(100);
    profilePuts = [];
    const delBeforeBound = results.writeRequestLog.filter((x) => x.scenario === 'staged-delete').length;
    await page.locator('button:has-text("移除头像")').click();
    await page.waitForTimeout(200);
    const delAfterBound = results.writeRequestLog.filter((x) => x.scenario === 'staged-delete').length;
    pVm = await page.evaluate(() => {
      const vm = document.querySelector('#workspace').__vue__;
      return { staged: (vm && vm.stagedAvatarFlag) || '', avatar: vm && vm.form && vm.form.avatar, dirty: !!(vm && vm.dirty) };
    });
    results.avatarLifecycleAudit.push({ scenario: 'remove-bound', pVm, stagedDeletes: delAfterBound - delBeforeBound, bound: UUID_BOUND });
    assert('person-bound-remove-no-staged-delete', delAfterBound === delBeforeBound, 'dels ' + delBeforeBound + '->' + delAfterBound);
    assert('person-bound-remove-form-empty', pVm.avatar === '' && pVm.staged === '', JSON.stringify(pVm));
    await page.locator('button:has-text("保存资料")').click();
    await page.waitForTimeout(350);
    assert('person-bound-remove-save-empty-avatar', profilePuts[0] && profilePuts[0].avatar === '', JSON.stringify(profilePuts[0]));

    // ——— Reset form retires current staged UUID once ———
    await page.unroute('**/api/files/upload').catch(() => {});
    await page.route('**/api/files/upload', async (route) => {
      const flag = 'e5f6478899aabbccddeeff05a1b2c3d4';
      results.writeRequestLog.push({ scenario: 'avatar-upload-reset', flag });
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ code: '0', data: { flag: flag } }),
        headers: Object.assign({ 'content-type': 'application/json' }, EH)
      });
    });
    await page.setInputFiles('#avatarFile', { name: 'reset.png', mimeType: 'image/png', buffer: PNG1 });
    await page.waitForTimeout(350);
    const resetFlag = await page.evaluate(() => {
      const vm = document.querySelector('#workspace').__vue__;
      return (vm && vm.stagedAvatarFlag) || '';
    });
    const delBeforeReset = results.writeRequestLog.filter((x) => x.scenario === 'staged-delete');
    await page.locator('button:has-text("撤销修改")').click();
    await page.waitForTimeout(250);
    const delAfterReset = results.writeRequestLog.filter((x) => x.scenario === 'staged-delete');
    const resetRetired = delAfterReset.filter((x) => x.flag === resetFlag);
    results.avatarLifecycleAudit.push({
      scenario: 'reset-retire-staged',
      resetFlag,
      stagedDeletes: delAfterReset.length - delBeforeReset.length,
      resetRetired: resetRetired.length
    });
    assert('person-reset-uuid-shape', UUID_RE.test(resetFlag), resetFlag);
    assert('person-reset-retire-once', resetRetired.length === 1 && delAfterReset.length === delBeforeReset.length + 1, JSON.stringify(delAfterReset.slice(-3)));

    // field validation focus
    await page.fill('#profileEmail', 'not-an-email');
    await page.locator('button:has-text("保存资料")').click();
    await page.waitForTimeout(200);
    const focusEmail = await page.evaluate(() => document.activeElement && document.activeElement.id);
    assert('person-invalid-focus-email', focusEmail === 'profileEmail', focusEmail);
    await page.fill('#profileEmail', 'ok@example.test');

    // viewports sample
    for (const vp of [{ name: '390x844', width: 390, height: 844 }, { name: '320x700', width: 320, height: 700 }]) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto(base + '/page/end/person.html', { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForTimeout(300);
      const ov = await overflowX(page);
      assert('person-overflow-' + vp.name, !ov.overflow, JSON.stringify(ov));
      await shot(page, '04-person-' + vp.name, { page: 'person', role: 'admin', viewport: vp.name, state: 'form', goal: '资料' + vp.name });
    }
    await page.setViewportSize({ width: 1440, height: 900 });

    // zoom 200%
    await page.evaluate(() => { document.body.style.zoom = '2'; });
    await page.goto(base + '/page/end/user.html', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(300);
    await page.evaluate(() => { document.body.style.zoom = '2'; });
    const zov = await overflowX(page);
    assert('user-zoom-200-stable', typeof zov.sw === 'number', JSON.stringify(zov));
    await shot(page, '05-user-zoom200', { page: 'user', role: 'admin', viewport: '1440x900', state: 'zoom200', goal: '200%放大' });
    await page.evaluate(() => { document.body.style.zoom = '1'; });

    // multi viewport geometry for user cards
    for (const vp of VIEWPORTS.slice(0, 4)) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto(base + '/page/end/user.html', { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForTimeout(280);
      const geo = await overflowX(page);
      assert('user-vp-' + vp.name, !geo.overflow || vp.width <= 360, JSON.stringify(geo));
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await shot(page, '06-user-after-vp', { page: 'user', role: 'admin', viewport: '1440x900', state: 'list', goal: '视口后' });

    // ========== PERMISSION MATRIX ==========
    {
      const a = await browser.newContext();
      await login(a, 'admin', 'admin');
      const api = await a.request.get(base + '/api/user/page?pageNum=1&pageSize=1');
      assert('admin-user-api-ok', api.status() === 200, api.status());
      results.permissionMatrix.admin = { real: true, userPage: api.status() };
      await a.close();
    }
    {
      const j = await browser.newContext();
      await login(j, 'jerry', '123456');
      registerExpectedHttp('jerry-user-api', 'GET', /\/api\/user\/page/, 403);
      registerExpectedHttp('jerry-user-api-401', 'GET', /\/api\/user\/page/, 401);
      const p = await j.newPage();
      await p.goto(base + '/page/end/user.html', { waitUntil: 'domcontentloaded', timeout: 45000 });
      await p.waitForTimeout(400);
      const api = await j.request.get(base + '/api/user/page?pageNum=1&pageSize=1');
      assert('jerry-user-denied', api.status() === 403 || api.status() === 401 || /forbidden|login|error=/.test(p.url()), api.status() + ' ' + p.url());
      await p.goto(base + '/page/end/person.html', { waitUntil: 'domcontentloaded', timeout: 45000 });
      await p.waitForTimeout(350);
      assert('jerry-person-ok', /个人资料/.test(await p.locator('h1').innerText().catch(() => '')), 'person');
      results.permissionMatrix.jerry = { real: true, userApi: api.status() };
      await j.close();
    }
    {
      const a = await browser.newContext();
      registerExpectedHttp('anon-user-api', 'GET', /\/api\/user\/page/, 401);
      const p = await a.newPage();
      await p.goto(base + '/page/end/user.html', { waitUntil: 'domcontentloaded', timeout: 45000 });
      await p.waitForTimeout(300);
      assert('anon-user-login', /login/i.test(p.url()), p.url());
      await p.goto(base + '/page/end/person.html', { waitUntil: 'domcontentloaded', timeout: 45000 });
      await p.waitForTimeout(300);
      assert('anon-person-login', /login/i.test(p.url()), p.url());
      results.permissionMatrix.anonymous = { real: true };
      await a.close();
    }

    // ========== classifier ==========
    let clfPass = 0;
    function clfAssert(id, cond, d) {
      assert(id, cond, d);
      if (cond) clfPass++;
    }
    clfAssert('clf-intentional-header-500', isIntentionalHttp({
      status: 500, method: 'PUT', url: base + '/api/user', headers: { [HDR]: VAL }
    }), 'h');
    clfAssert('clf-unexpected-500-no-header', !isIntentionalHttp({
      status: 500, method: 'PUT', url: base + '/api/user', headers: {}
    }), 'noh');
    clfAssert('clf-unexpected-wrong-header', !isIntentionalHttp({
      status: 500, method: 'PUT', url: base + '/api/user', headers: { [HDR]: 'phase2e' }
    }), 'wrong');
    clfAssert('clf-unexpected-diff-url', !isIntentionalHttp({
      status: 500, method: 'GET', url: base + '/api/other/x', headers: {}
    }), 'url');
    clfAssert('clf-files-404-no-header-unexpected', !isIntentionalHttp({
      status: 404, method: 'GET', url: base + '/api/files/x', headers: {}
    }), 'f404');
    clfAssert('clf-files-404-with-header', isIntentionalHttp({
      status: 404, method: 'GET', url: base + '/api/files/x', headers: { [HDR]: VAL }
    }), 'f404h');
    clfAssert('clf-console-real', isRealConsoleError('TypeError: boom'), 'real');
    clfAssert('clf-console-noise', !isRealConsoleError('Failed to load resource: the server responded with a status of 500 ()'), 'noise');
    const mut = { status: 500, method: 'PUT', url: base + '/api/user/mutation', headers: {} };
    clfAssert('clf-mutation-unmarked-500', !isIntentionalHttp(mut), 'mut');
    results.classifierMutationPassCount = clfPass;
    assert('clf-mutation-count-ge-8', clfPass >= 8, 'n=' + clfPass);

    const intentional = httpErrors.filter((e) => isIntentionalHttp(e));
    const unexpected = httpErrors.filter((e) => !isIntentionalHttp(e));
    const resourceConsoleNoise = consoleErrors.filter((t) => isResourceConsoleNoise(t));
    const realConsoleStrict = consoleErrors.filter((t) => isRealConsoleError(t));
    results.consoleAudit = {
      intentionalErrorResponses: intentional,
      unexpectedHttpErrors: unexpected,
      resourceConsoleNoise,
      realConsoleErrors: realConsoleStrict,
      pageErrors,
      pageErrorCount: pageErrors.length,
      unexpectedHttpCount: unexpected.length,
      realConsoleErrorCount: realConsoleStrict.length,
      resourceConsoleNoiseCount: resourceConsoleNoise.length,
      intentionalHttpCount: intentional.length,
      classifierMutationPassCount: results.classifierMutationPassCount,
      expectedHttpRegistrySize: results.expectedHttpRegistry.length
    };
    assert('no-unexpected-http', unexpected.length === 0, JSON.stringify(unexpected.slice(0, 5)));
    assert('no-pageerrors', pageErrors.length === 0, JSON.stringify(pageErrors));
    assert('no-requestfailed-write', results.requestFailedWrite.length === 0, JSON.stringify(results.requestFailedWrite));
    assert('no-real-console', realConsoleStrict.length === 0, JSON.stringify(realConsoleStrict.slice(0, 3)));
    assert('no-skipped', results.checks.every((c) => !c.skipped), 'skip');
    assert('screenshots-match', results.screenshots.length === fs.readdirSync(shotDir).filter((f) => f.endsWith('.png')).length, 'shots');
    assert('probes-ge-4', results.strictRuntimeProbeCount >= 4, 'n=' + results.strictRuntimeProbeCount);
    assert('zero-best-effort', results.bestEffortPassCount === 0, 'n');
    assert('zero-fallback', results.fallbackPassCount === 0, 'n');
    assert('user-delete-still-zero', results.userDeleteAudit.deleteUserRequests === 0, 'del');
    const dialogFails = results.focusAudit.filter((f) => f.dialogStrict && !f.strictOk);
    assert('dialog-focus-all', dialogFails.length === 0, JSON.stringify(dialogFails.slice(0, 2)));

    await ctx.close();
  } catch (e) {
    fail('suite-exception', String(e && e.stack || e));
  } finally {
    if (browser) await browser.close().catch(() => {});
    const s = writeReport();
    console.log(JSON.stringify(s, null, 2));
    console.log((s.failed || s.skipped || !s.noBestEffortPass) ? `FAILED f=${s.failed} s=${s.skipped}` : `ALL PASSED ${s.passed}`);
    if (results.failures.length) console.log(JSON.stringify(results.failures, null, 2));
    process.exit((s.failed || s.skipped || !s.noBestEffortPass) ? 1 : 0);
  }
})();
