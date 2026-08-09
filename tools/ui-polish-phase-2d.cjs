/**
 * Phase 2D strict — rescue help + animal archive governance.
 * Baseline: 813eaad · BASE_URL default http://127.0.0.1:18095
 * Fixtures only; no skip-pass; no DB writes; no Vue-state E2E.
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const base = process.env.BASE_URL || 'http://127.0.0.1:18095';
const out = path.resolve('output/playwright/ui-polish-phase-2d');
const shotDir = path.join(out, 'screenshots');
if (fs.existsSync(shotDir)) {
  for (const f of fs.readdirSync(shotDir)) {
    if (f.endsWith('.png')) fs.unlinkSync(path.join(shotDir, f));
  }
}
fs.mkdirSync(shotDir, { recursive: true });

const HDR = 'x-ui-audit-expected-error';
const VAL = 'phase2d';
const EH = { [HDR]: VAL };

const HELP_RECORDS = [
  { id: 91001, title: 'UI_2D_HELP_PENDING', description: '路边发现', uname: '申请人甲', phone: '13800000001', location: '测试路1号', status: 0, priority: 0, createTime: '2026-07-30 10:00:00', updateTime: '2026-07-30 10:00:00', outcome: null, resolutionNote: '', remark: '', animalId: null, version: 3, pic: '' },
  { id: 91002, title: 'UI_2D_HELP_URGENT', description: '紧急', uname: '申请人乙', phone: '13800000002', location: '公园', status: 1, priority: 2, createTime: '2026-07-30 11:00:00', updateTime: '2026-07-30 11:30:00', outcome: null, resolutionNote: '', remark: '已出警', animalId: null, version: 5, pic: '' },
  { id: 91003, title: 'UI_2D_HELP_DONE', description: '已接收入站', uname: '申请人丙', phone: '13800000003', location: '小区', status: 2, priority: 0, createTime: '2026-07-29 09:00:00', updateTime: '2026-07-29 18:00:00', outcome: 'intake', resolutionNote: '已建档', remark: '完成', animalId: 92001, version: 8, pic: '' }
];

// tpic: empty = missing image placeholder; fixture-ok = routed 1x1 PNG; missing-img = intentional broken path for @error fallback
const ANIMAL_RECORDS = [
  { id: 92001, tname: 'UI_2D_ANIMAL_AVAIL', ttype: '猫', tsex: '母', tbirthday: '2024-01-01', tstate: 0, tdescribe: '待领养', tpic: '' },
  { id: 92002, tname: 'UI_2D_ANIMAL_FLOW', ttype: '狗', tsex: '公', tbirthday: '', tstate: 1, tdescribe: '申请中', tpic: 'fixture-ok' },
  { id: 92003, tname: 'UI_2D_ANIMAL_DONE', ttype: '猫', tsex: '未知', tbirthday: '', tstate: 2, tdescribe: '已领养', tpic: 'missing-img' }
];

// 1x1 PNG
const PNG1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

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
  phase2cBaseline: '813eaadec40995fb92135a1ad88480ea757546ff',
  branch: 'ui-polish/phase-2d-rescue-animal-governance-20260730',
  checks: [],
  failures: [],
  screenshots: [],
  focusAudit: [],
  writeRequestLog: [],
  fixtures: { help: 'route GET /api/help/page', animal: 'route GET /api/animal/page', writes: 'routeIntercept no DB' },
  consoleAudit: {},
  requestFailedWrite: [],
  permissionMatrix: {},
  segmentedStyleEvidence: {},
  segmentedViewportMatrix: [],
  controlledRequestAudit: [],
  bestEffortPassCount: 0,
  fallbackPassCount: 0,
  strictRuntimeProbeCount: 0,
  summary: {}
};

function pass(id, d, flags) {
  const bestEffort = !!(flags && flags.bestEffort);
  const fallback = !!(flags && flags.fallback);
  if (bestEffort) results.bestEffortPassCount += 1;
  if (fallback) results.fallbackPassCount += 1;
  results.checks.push({
    id, ok: true, skipped: false, detail: String(d || ''),
    bestEffort, fallback
  });
}
function fail(id, d) {
  results.checks.push({ id, ok: false, skipped: false, detail: String(d || ''), bestEffort: false, fallback: false });
  results.failures.push({ id, detail: String(d || '') });
  console.error('FAIL', id, d);
}
function assert(id, c, d) { if (c) pass(id, d); else fail(id, d); }
/** Runtime probe that must observe live DOM — never CSS-only. */
function recordStrictRuntimeProbe(name, data) {
  results.strictRuntimeProbeCount += 1;
  results.controlledRequestAudit.push(Object.assign({
    name,
    at: new Date().toISOString(),
    probeIndex: results.strictRuntimeProbeCount
  }, data || {}));
}
function exp(status, body) {
  return { status, headers: Object.assign({ 'content-type': 'application/json' }, EH), body: JSON.stringify(body) };
}
function pageData(records) {
  return { status: 200, contentType: 'application/json', body: JSON.stringify({ code: '0', data: { records, current: 1, total: records.length, pages: 1 } }) };
}

async function login(ctx, u, p) {
  const res = await ctx.request.post(base + '/api/user/login', { data: { username: u, password: p } });
  const j = await res.json();
  if (j.code !== '0') throw new Error('login ' + u);
  ctx._csrf = (j.data && j.data.csrfToken) || '';
}

async function shot(page, name, meta) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(40);
  const file = path.join(shotDir, name + '.png');
  await page.screenshot({ path: file, fullPage: false });
  results.screenshots.push(Object.assign({
    file: 'screenshots/' + name + '.png', name, time: new Date().toISOString(),
    routeIntercept: true, realNetwork: true, databaseWrite: false
  }, meta || {}));
}

async function inspectFocus(page) {
  return page.evaluate(() => {
    const el = document.activeElement;
    const dlg = document.querySelector('[role="dialog"], [role="alertdialog"]');
    return {
      tag: el ? el.tagName : '',
      id: el ? el.id : '',
      isBody: el === document.body,
      isHtml: el === document.documentElement,
      connected: !!(el && el.isConnected),
      inDialog: !!(dlg && el && dlg.contains(el)),
      roleAlert: !!(el && el.getAttribute && el.getAttribute('role') === 'alert'),
      interactive: !!(el && el.matches && el.matches('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href],[tabindex]:not([tabindex="-1"])'))
    };
  });
}
function focusOk(f) {
  return f && f.connected && !f.isBody && !f.isHtml && (f.interactive || f.roleAlert);
}
/** While a dialog is open/retained: must be inside dialog (role=alert ok only if inDialog). */
function dialogFocusOk(f) {
  return !!(f && f.connected === true && f.inDialog === true && f.isBody === false && f.isHtml === false);
}
function stableFocusOk(f) {
  return focusOk(f) && !f.isBody && !f.isHtml;
}
function recFocus(s, f, extra) {
  const dialogStrict = extra && extra.dialogStrict;
  const ok = dialogStrict ? dialogFocusOk(f) : focusOk(f);
  results.focusAudit.push(Object.assign({ scenario: s, strictOk: ok, dialogStrict: !!dialogStrict }, f, extra || {}));
}
async function assertDialogFocus(page, id, scenario) {
  await page.waitForTimeout(80);
  const f = await inspectFocus(page);
  recFocus(scenario || id, f, { dialogStrict: true });
  assert(id, dialogFocusOk(f), JSON.stringify(f));
  return f;
}
async function clickVisible(page, selector, timeout = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const loc = page.locator(selector);
    const n = await loc.count();
    for (let i = 0; i < n; i++) {
      if (await loc.nth(i).isVisible().catch(() => false)) {
        await loc.nth(i).click();
        return loc.nth(i);
      }
    }
    await page.waitForTimeout(100);
  }
  await page.locator(selector).first().click({ force: true });
  return page.locator(selector).first();
}

async function assertTabCycle(page, idPrefix) {
  const before = await page.evaluate(() => {
    const root = document.querySelector('[role="dialog"], [role="alertdialog"]');
    if (!root) return null;
    const list = Array.prototype.slice.call(root.querySelectorAll(
      'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'
    )).filter((el) => !el.disabled && (el.offsetParent !== null || el.getClientRects().length));
    if (!list.length) return null;
    list[0].focus();
    return { n: list.length, firstId: list[0].id || list[0].tagName, lastId: list[list.length - 1].id || list[list.length - 1].tagName };
  });
  assert(idPrefix + '-focusables', !!(before && before.n >= 2), JSON.stringify(before));
  if (!before) return;
  // Tab from first through all should wrap: after n tabs back to first-ish
  for (let i = 0; i < before.n; i++) await page.keyboard.press('Tab');
  const afterTab = await inspectFocus(page);
  assert(idPrefix + '-tab-cycle', dialogFocusOk(afterTab), JSON.stringify(afterTab));
  // Shift+Tab from first wraps to last
  await page.evaluate(() => {
    const root = document.querySelector('[role="dialog"], [role="alertdialog"]');
    const list = Array.prototype.slice.call(root.querySelectorAll(
      'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'
    )).filter((el) => !el.disabled && (el.offsetParent !== null || el.getClientRects().length));
    if (list[0]) list[0].focus();
  });
  await page.keyboard.press('Shift+Tab');
  const afterShift = await inspectFocus(page);
  assert(idPrefix + '-shift-tab-cycle', dialogFocusOk(afterShift), JSON.stringify(afterShift));
}

function writeReport() {
  const passed = results.checks.filter((c) => c.ok).length;
  const failed = results.checks.filter((c) => !c.ok).length;
  const skipped = results.checks.filter((c) => c.skipped).length;
  // Recompute from check flags so counters cannot drift from summary
  const bestEffortPassCount = results.checks.filter((c) => c.ok && c.bestEffort).length;
  const fallbackPassCount = results.checks.filter((c) => c.ok && c.fallback).length;
  results.bestEffortPassCount = bestEffortPassCount;
  results.fallbackPassCount = fallbackPassCount;
  const noBestEffortPass = bestEffortPassCount === 0 && fallbackPassCount === 0;
  const noSkipPass = skipped === 0 && results.checks.every((c) => !c.skipped);
  const strictMode = noBestEffortPass && noSkipPass && failed === 0;
  results.summary = {
    passed,
    failed,
    skipped,
    total: results.checks.length,
    screenshots: results.screenshots.length,
    viewports: VIEWPORTS.length,
    finishedAt: new Date().toISOString(),
    bestEffortPassCount,
    fallbackPassCount,
    strictRuntimeProbeCount: results.strictRuntimeProbeCount,
    noBestEffortPass,
    noSkipPass,
    strictMode,
    noBestEffortPassFormula: 'bestEffortPassCount===0 && fallbackPassCount===0',
    noSkipPassFormula: 'skipped===0 && every check !skipped',
    strictModeFormula: 'noBestEffortPass && noSkipPass && failed===0'
  };
  results.ok = failed === 0 && skipped === 0 && noBestEffortPass;
  fs.writeFileSync(path.join(out, 'phase-2d-report.json'), JSON.stringify(results, null, 2));
  fs.writeFileSync(path.join(out, 'screenshots-index.json'), JSON.stringify(results.screenshots, null, 2));
  return results.summary;
}

(async () => {
  console.log('Phase 2D strict start', base);
  const consoleErrors = [], pageErrors = [], httpErrors = [];
  let browser;
  try {
    const helpHtml = fs.readFileSync('src/main/resources/static/page/end/help.html', 'utf8');
    const animalHtml = fs.readFileSync('src/main/resources/static/page/end/animal.html', 'utf8');
    const css = fs.readFileSync('src/main/resources/static/css/admin-workspace.css', 'utf8');
    const adoptHtml = fs.readFileSync('src/main/resources/static/page/end/adopt.html', 'utf8');

    assert('help-cache-0802a', helpHtml.includes('admin-workspace.css?v=20260809p'), 'cache');
    assert('animal-cache-0808f', animalHtml.includes('admin-workspace.css?v=20260809p'), 'cache');
    assert('animal-command-desk', animalHtml.includes('animal-command-desk') && animalHtml.includes('admin-command-hero') && animalHtml.includes('admin-command-panel'), 'layout');
    assert('adopt-untouched-0808c', adoptHtml.includes('20260809p'), 'adopt cache');
    assert('css-help-gov', css.includes('.help-governance-hero'), 'css');
    assert('css-animal-gov', css.includes('.animal-governance-hero'), 'css');
    assert('css-admin-segmented', /\.admin-segmented\s*\{/.test(css) && /\.admin-segmented\s*>\s*button\.is-active/.test(css.replace(/\s+/g, ' ')), 'segmented css');
    assert('css-admin-segmented-active-bg', /\.admin-segmented\s*>\s*button\.is-active[\s\S]{0,200}background\s*:/.test(css), 'active bg');
    assert('css-admin-segmented-min-h', /min-height:\s*44px/.test(css) && css.includes('.admin-segmented'), '44px');
    assert('help-segmented-aria', helpHtml.includes('role="group"') && helpHtml.includes('aria-pressed') && helpHtml.includes('helpAnimalModeExisting'), 'aria');
    assert('help-loadseq', helpHtml.includes('loadSeq'), 'seq');
    assert('animal-loadseq', animalHtml.includes('loadSeq'), 'seq');
    assert('help-writelocks', helpHtml.includes('__helpWriteLocks'), 'locks');
    assert('animal-writelocks', animalHtml.includes('__animalWriteLocks'), 'locks');
    assert('help-doc-esc', helpHtml.includes('_onDocEsc'), 'esc');
    assert('animal-doc-esc', animalHtml.includes('_onDocEsc'), 'esc');
    assert('help-focus-trap', helpHtml.includes('createFocusTrap'), 'trap');
    assert('animal-focus-trap', animalHtml.includes('createFocusTrap'), 'trap');
    assert('animal-delete-error-id', animalHtml.includes('id="animalDeleteError"') && animalHtml.includes('focusDeleteError'), 'del-err');
    assert('animal-import-error-id', animalHtml.includes('id="animalImportError"') && animalHtml.includes('focusImportError'), 'imp-err');
    assert('help-new-animal-ids', helpHtml.includes('id="helpNewAnimalName"') && helpHtml.includes('id="helpNewAnimalType"') && helpHtml.includes('id="helpNewAnimalSex"') && helpHtml.includes('id="helpNewAnimalDescribe"'), 'ids');
    assert('animal-payload-no-tstate', animalHtml.includes('Never send tstate') || !/payload\.tstate\s*=/.test(animalHtml), 'tstate');
    assert('help-expected-version', helpHtml.includes('expectedVersion'), 'version');
    {
      const suiteSrc = fs.readFileSync('tools/ui-polish-phase-2d.cjs', 'utf8');
      // Disallow direct Vue instance mutation in E2E (payload must come from real inputs)
      const bad = /__vue__\s*\.\s*manageForm\s*\.\s*animal\s*=/.test(suiteSrc)
        || /vm\.manageForm\.animal\s*=\s*\{/.test(suiteSrc);
      assert('no-vue-e2e-in-suite', !bad, 'vue-e2e');
      // Strict suite integrity — no false-green patterns (exclude self-check lines from scan)
      const scanSrc = suiteSrc.split(/\r?\n/).filter(function (ln) {
        return ln.indexOf('self-no-') < 0 && ln.indexOf('self-has-') < 0;
      }).join('\n');
      assert('self-no-css-fallback-string', scanSrc.indexOf('css-fallback') < 0, 'css-fallback present in suite body');
      assert('self-no-unconditional-true-assert', !/assert\s*\(\s*['"][^'"]+['"]\s*,\s*true\s*,/.test(scanSrc), 'assert(..., true, ...)');
      assert('self-no-disabled-probe-null-catch', !/disabledProbe[\s\S]{0,400}\.catch\s*\(\s*\(\s*\)\s*=>\s*null\s*\)/.test(scanSrc), 'disabledProbe catch null');
      assert('self-no-css-only-disabled-fallback', !/missed in-flight|css rule required/.test(scanSrc), 'css-only disabled fallback');
      assert('self-has-controlled-hold', /hold409/.test(suiteSrc) && /release409/.test(suiteSrc), 'controlled hold missing');
    }

    browser = await chromium.launch({ headless: true });
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await login(ctx, 'admin', 'admin');
    const page = await ctx.newPage();
    const cssReq = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
    page.on('requestfailed', (req) => {
      if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method())) {
        results.requestFailedWrite.push({ method: req.method(), url: req.url() });
      }
    });
    page.on('response', (r) => {
      if (r.status() >= 400) httpErrors.push({ status: r.status(), url: r.url(), headers: r.headers() });
    });
    page.on('request', (req) => { if (/admin-workspace\.css/.test(req.url())) cssReq.push(req.url()); });

    // File assets: valid fixture image vs intentional missing (placeholder path)
    await page.route('**/api/files/**', async (route) => {
      const url = route.request().url();
      if (/fixture-ok/.test(url)) {
        await route.fulfill({ status: 200, contentType: 'image/png', body: PNG1, headers: EH });
        return;
      }
      // intentional broken / empty / unknown image ids → 404 with expected-error header for audit
      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ code: '404', msg: 'file not found' }),
        headers: Object.assign({ 'content-type': 'application/json' }, EH)
      });
    });

    // ——— HELP ———
    await page.route('**/api/help/page**', async (route) => {
      if (route.request().method() !== 'GET') { await route.continue(); return; }
      await route.fulfill(pageData(HELP_RECORDS));
    });
    await page.route('**/api/help/chat/history**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ code: '0', data: [] }) });
    });
    await page.goto(base + '/page/end/help.html', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(800);
    assert('help-css-0802a', cssReq.some((u) => /v=20260809p/.test(u)), JSON.stringify(cssReq.slice(-2)));
    assert('help-title', /救助处置/.test(await page.locator('h1').innerText()), 'title');
    assert('help-metrics', (await page.locator('.help-governance-metric').count()) >= 5, 'metrics');
    assert('help-fixture-pending', (await page.locator('text=UI_2D_HELP_PENDING').count()) >= 1, 'pending');
    assert('help-fixture-urgent', (await page.locator('text=UI_2D_HELP_URGENT').count()) >= 1, 'urgent');
    assert('help-public-chat', /公共|全局/.test(await page.locator('#adminCommunityTitle').innerText()), 'chat');
    const helpLayout = await page.evaluate(() => {
      const title = document.querySelector('#helpAdminTitle').getBoundingClientRect();
      const hero = document.querySelector('.help-governance-hero').getBoundingClientRect();
      const list = document.querySelector('.help-governance-ticket-panel').getBoundingClientRect();
      const chat = document.querySelector('.help-governance-chat').getBoundingClientRect();
      const metricsEl = document.querySelector('.help-governance-metrics');
      return {
        titleOffset: Math.round(title.top - hero.top),
        heroHeight: Math.round(hero.height),
        worktopDelta: Math.round(Math.abs(list.top - chat.top)),
        workSurfaceHeightDelta: Math.round(Math.abs(list.height - chat.height)),
        ticketOverflowY: getComputedStyle(document.querySelector('.admin-help-table')).overflowY,
        metricOverflow: Math.max(0, Math.round(metricsEl.scrollWidth - metricsEl.clientWidth)),
        pageOverflow: Math.max(0, Math.round(document.documentElement.scrollWidth - document.documentElement.clientWidth))
      };
    });
    recordStrictRuntimeProbe('help-desktop-layout', helpLayout);
    assert('help-title-near-hero-top', helpLayout.titleOffset < 95, JSON.stringify(helpLayout));
    assert('help-hero-compact', helpLayout.heroHeight < 260, JSON.stringify(helpLayout));
    assert('help-work-surfaces-aligned', helpLayout.worktopDelta <= 2, JSON.stringify(helpLayout));
    assert('help-work-surfaces-equal-height', helpLayout.workSurfaceHeightDelta <= 2, JSON.stringify(helpLayout));
    assert('help-ticket-table-scrolls-inside', /auto|scroll/.test(helpLayout.ticketOverflowY), JSON.stringify(helpLayout));
    assert('help-desktop-no-overflow', helpLayout.metricOverflow <= 1 && helpLayout.pageOverflow <= 2, JSON.stringify(helpLayout));
    await shot(page, '01-help-desktop', { page: 'help', role: 'admin', viewport: '1440x900', state: 'fixture', goal: '救助桌面' });

    // Detail + esc
    const detBtn = page.locator('button:has-text("详情"), button:has-text("查看详情")').first();
    assert('help-detail-btn', (await detBtn.count()) >= 1, 'missing');
    const detH = await detBtn.elementHandle();
    await detBtn.click();
    await page.waitForTimeout(250);
    assert('help-detail-open', (await page.locator('#helpDetailTitle').count()) >= 1, 'dialog');
    await assertDialogFocus(page, 'help-detail-focus-in', 'help-detail-open');
    await assertTabCycle(page, 'help-detail');
    await shot(page, '02-help-detail', { page: 'help', role: 'admin', viewport: '1440x900', state: 'detail', goal: '工单详情' });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    assert('help-detail-esc-close', (await page.locator('#helpDetailTitle').count()) === 0, 'open');
    const f1 = await inspectFocus(page);
    const exact1 = detH ? await page.evaluate((el) => document.activeElement === el, detH) : false;
    recFocus('help-detail-esc', f1, { exactTrigger: exact1 });
    assert('help-detail-esc-focus', exact1 && focusOk(f1), JSON.stringify({ exact1, f1 }));

    // Manage 409 double
    const mgBtn = page.locator('button:has-text("处理工单"), button:has-text("处理")').first();
    assert('help-manage-btn', (await mgBtn.count()) >= 1, 'missing');
    const mgH = await mgBtn.elementHandle();
    await mgBtn.click();
    await page.waitForTimeout(300);
    assert('help-manage-open', (await page.locator('#manageTitle').count()) >= 1, 'dialog');
    await assertDialogFocus(page, 'help-manage-focus-in', 'help-manage-open');
    await assertTabCycle(page, 'help-manage');
    await shot(page, '03-help-manage', { page: 'help', role: 'admin', viewport: '1440x900', state: 'manage', goal: '处理弹窗' });

    // intake existing path UI + segmented control visual/a11y
    await page.selectOption('#managerStatus', '2');
    await page.waitForTimeout(100);
    await page.selectOption('#managerOutcome', 'intake');
    await page.waitForTimeout(100);
    await page.fill('#managerResolution', '接收入站并关联档案');
    assert('help-segmented-present', (await page.locator('.admin-segmented').count()) >= 1, 'missing group');
    assert('help-segmented-role-group', await page.locator('.admin-segmented[role="group"]').count() >= 1, 'role');
    const modeExisting = page.locator('#helpAnimalModeExisting, button:has-text("关联已有档案")').first();
    const modeNew = page.locator('#helpAnimalModeNew, button:has-text("创建新档案")').first();
    assert('help-mode-btns', (await modeExisting.count()) >= 1 && (await modeNew.count()) >= 1, 'btns');

    // Select existing
    await modeExisting.click();
    await page.waitForTimeout(80);
    const existingState = await page.evaluate(() => {
      const ex = document.getElementById('helpAnimalModeExisting') || document.querySelector('.admin-segmented button');
      const nw = document.getElementById('helpAnimalModeNew') || document.querySelectorAll('.admin-segmented button')[1];
      const csEx = window.getComputedStyle(ex);
      const csNw = window.getComputedStyle(nw);
      const csBox = window.getComputedStyle(document.querySelector('.admin-segmented'));
      return {
        exPressed: ex.getAttribute('aria-pressed'),
        nwPressed: nw.getAttribute('aria-pressed'),
        exActive: ex.classList.contains('is-active'),
        nwActive: nw.classList.contains('is-active'),
        exBg: csEx.backgroundColor,
        nwBg: csNw.backgroundColor,
        exBorder: csEx.borderTopColor || csEx.borderColor,
        nwBorder: csNw.borderTopColor || csNw.borderColor,
        exColor: csEx.color,
        nwColor: csNw.color,
        exH: ex.getBoundingClientRect().height,
        nwH: nw.getBoundingClientRect().height,
        boxBg: csBox.backgroundColor,
        appearance: csEx.appearance || csEx.webkitAppearance || '',
        existingIdVisible: !!document.getElementById('existingAnimalId'),
        newNameVisible: !!document.getElementById('helpNewAnimalName')
      };
    });
    assert('help-mode-existing-pressed', existingState.exPressed === 'true' && existingState.nwPressed === 'false', JSON.stringify(existingState));
    assert('help-mode-existing-active-class', existingState.exActive && !existingState.nwActive, JSON.stringify(existingState));
    assert('help-mode-existing-fields', existingState.existingIdVisible && !existingState.newNameVisible, JSON.stringify(existingState));
    assert('help-mode-touch-44', existingState.exH >= 44 && existingState.nwH >= 44, JSON.stringify(existingState));
    const styleDiffExisting = existingState.exBg !== existingState.nwBg
      || existingState.exBorder !== existingState.nwBorder
      || existingState.exColor !== existingState.nwColor;
    assert('help-mode-existing-style-diff', styleDiffExisting, JSON.stringify(existingState));
    assert('help-mode-not-browser-default', existingState.boxBg && existingState.boxBg !== 'rgba(0, 0, 0, 0)' && existingState.appearance !== 'auto', JSON.stringify(existingState));
    results.segmentedStyleEvidence = results.segmentedStyleEvidence || {};
    results.segmentedStyleEvidence.existingSelected = existingState;
    await page.fill('#existingAnimalId', '92001');
    await shot(page, '04-help-intake-existing', { page: 'help', role: 'admin', viewport: '1440x900', state: 'intake-existing', goal: '关联已有档案' });

    // Switch to new archive mode
    await modeNew.click();
    await page.waitForTimeout(80);
    const newState = await page.evaluate(() => {
      const ex = document.getElementById('helpAnimalModeExisting');
      const nw = document.getElementById('helpAnimalModeNew');
      const csEx = window.getComputedStyle(ex);
      const csNw = window.getComputedStyle(nw);
      return {
        exPressed: ex.getAttribute('aria-pressed'),
        nwPressed: nw.getAttribute('aria-pressed'),
        exActive: ex.classList.contains('is-active'),
        nwActive: nw.classList.contains('is-active'),
        exBg: csEx.backgroundColor,
        nwBg: csNw.backgroundColor,
        exBorder: csEx.borderTopColor || csEx.borderColor,
        nwBorder: csNw.borderTopColor || csNw.borderColor,
        exColor: csEx.color,
        nwColor: csNw.color,
        existingIdVisible: !!document.getElementById('existingAnimalId'),
        newNameVisible: !!document.getElementById('helpNewAnimalName'),
        newTypeVisible: !!document.getElementById('helpNewAnimalType'),
        newSexVisible: !!document.getElementById('helpNewAnimalSex'),
        newDescVisible: !!document.getElementById('helpNewAnimalDescribe')
      };
    });
    assert('help-mode-new-pressed', newState.nwPressed === 'true' && newState.exPressed === 'false', JSON.stringify(newState));
    assert('help-mode-new-active-class', newState.nwActive && !newState.exActive, JSON.stringify(newState));
    assert('help-mode-new-fields', !newState.existingIdVisible && newState.newNameVisible && newState.newTypeVisible && newState.newSexVisible && newState.newDescVisible, JSON.stringify(newState));
    const styleDiffNew = newState.exBg !== newState.nwBg || newState.exBorder !== newState.nwBorder || newState.exColor !== newState.nwColor;
    assert('help-mode-new-style-diff', styleDiffNew, JSON.stringify(newState));
    results.segmentedStyleEvidence.newSelected = newState;
    await shot(page, '04b-help-intake-new-selected', { page: 'help', role: 'admin', viewport: '1440x900', state: 'intake-new-selected', goal: '创建新档案选中' });

    // Keyboard focus outline on segmented buttons
    await modeExisting.focus();
    const focusOutline = await page.evaluate(() => {
      const el = document.activeElement;
      const cs = window.getComputedStyle(el);
      return {
        id: el && el.id,
        outline: cs.outlineStyle + ' ' + cs.outlineWidth + ' ' + cs.outlineColor,
        outlineWidth: parseFloat(cs.outlineWidth) || 0,
        boxShadow: cs.boxShadow,
        inGroup: !!(el && el.closest && el.closest('.admin-segmented'))
      };
    });
    // Tab between the two mode buttons
    await page.keyboard.press('Tab');
    const afterTabMode = await page.evaluate(() => {
      const el = document.activeElement;
      return { id: el && el.id, tag: el && el.tagName, inSeg: !!(el && el.closest && el.closest('.admin-segmented')) };
    });
    assert('help-mode-tab-focusable', focusOutline.inGroup && (focusOutline.id === 'helpAnimalModeExisting' || focusOutline.id === 'helpAnimalModeNew'), JSON.stringify(focusOutline));
    assert('help-mode-tab-reaches-peer', afterTabMode.inSeg || afterTabMode.id === 'helpAnimalModeNew' || afterTabMode.id === 'existingAnimalId' || afterTabMode.id === 'helpNewAnimalName', JSON.stringify(afterTabMode));
    // Prefer visible focus ring: outline or box-shadow on focus-visible path — force focus-visible via keyboard
    await page.keyboard.press('Shift+Tab');
    const ring = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || !el.closest('.admin-segmented')) return { ok: false };
      // trigger :focus-visible styles by ensuring keyboard modality
      const cs = window.getComputedStyle(el);
      const ow = parseFloat(cs.outlineWidth) || 0;
      const hasShadow = cs.boxShadow && cs.boxShadow !== 'none';
      return { ok: ow >= 1 || hasShadow || el.classList.contains('is-active'), outline: cs.outline, boxShadow: cs.boxShadow, id: el.id };
    });
    assert('help-mode-focus-ring', ring.ok, JSON.stringify(ring));

    // Viewport matrix for segmented control inside manage dialog
    results.segmentedViewportMatrix = [];
    for (const w of [320, 360, 390, 768, 1440]) {
      await page.setViewportSize({ width: w, height: w <= 390 ? 844 : 900 });
      await page.waitForTimeout(120);
      // ensure dialog still open
      if ((await page.locator('#manageTitle').count()) === 0) {
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.locator('button:has-text("处理工单")').first().click();
        await page.waitForTimeout(200);
        await page.selectOption('#managerStatus', '2');
        await page.selectOption('#managerOutcome', 'intake');
        await page.setViewportSize({ width: w, height: w <= 390 ? 844 : 900 });
        await page.waitForTimeout(120);
      }
      await modeExisting.click().catch(() => {});
      await page.waitForTimeout(50);
      const vpM = await page.evaluate((width) => {
        const box = document.querySelector('.admin-segmented');
        const btns = box ? Array.from(box.querySelectorAll('button')) : [];
        const overflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
        const dlg = document.querySelector('[role="dialog"][aria-labelledby="manageTitle"]');
        const dlgOverflow = dlg ? (dlg.scrollWidth > dlg.clientWidth + 2) : true;
        const metrics = btns.map((b) => {
          const r = b.getBoundingClientRect();
          const cs = window.getComputedStyle(b);
          return {
            h: r.height,
            w: r.width,
            left: r.left,
            right: r.right,
            clipped: r.right > window.innerWidth + 1 || r.left < -1,
            text: (b.textContent || '').trim(),
            whiteSpace: cs.whiteSpace,
            overflow: cs.overflow
          };
        });
        return {
          width,
          overflow,
          dlgOverflow,
          btnCount: btns.length,
          metrics,
          allH44: metrics.every((m) => m.h >= 44),
          noneClipped: metrics.every((m) => !m.clipped && m.w > 40)
        };
      }, w);
      results.segmentedViewportMatrix.push(vpM);
      assert('help-mode-vp-' + w + '-no-hscroll', vpM.overflow <= 2, JSON.stringify(vpM));
      assert('help-mode-vp-' + w + '-btn-geometry', vpM.allH44 && vpM.noneClipped && vpM.btnCount === 2, JSON.stringify(vpM));
      if (w === 320) {
        await shot(page, '04c-help-intake-segmented-320', { page: 'help', role: 'admin', viewport: '320x844', state: 'segmented-320', goal: '320档案方式' });
      }
    }
    // restore desktop for subsequent 409 tests
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(100);
    if ((await page.locator('#manageTitle').count()) === 0) {
      await page.locator('button:has-text("处理工单")').first().click();
      await page.waitForTimeout(250);
      await page.selectOption('#managerStatus', '2');
      await page.selectOption('#managerOutcome', 'intake');
      await page.fill('#managerResolution', '接收入站并关联档案');
    }
    await modeExisting.click();
    await page.waitForTimeout(50);
    await page.fill('#existingAnimalId', '92001');
    await page.fill('#managerResolution', '接收入站并关联档案');

    // Controlled 409 hang: observe real disabled state while PUT is held
    const puts = [];
    let release409 = null;
    const hold409 = new Promise((resolve) => { release409 = resolve; });
    let resolveRequestStarted = null;
    const requestStarted = new Promise((resolve) => { resolveRequestStarted = resolve; });
    const baselineSeg = await page.evaluate(() => {
      const ex = document.getElementById('helpAnimalModeExisting');
      const nw = document.getElementById('helpAnimalModeNew');
      const cs = window.getComputedStyle(ex);
      return {
        exDisabled: !!(ex && ex.disabled),
        nwDisabled: !!(nw && nw.disabled),
        exPressed: ex && ex.getAttribute('aria-pressed'),
        opacity: parseFloat(cs.opacity) || 1,
        cursor: cs.cursor
      };
    });
    assert('help-mode-baseline-enabled', !baselineSeg.exDisabled && !baselineSeg.nwDisabled, JSON.stringify(baselineSeg));
    await page.route('**/api/help/**/manage', async (route) => {
      if (route.request().method() !== 'PUT') { await route.continue(); return; }
      const body = route.request().postDataJSON();
      puts.push(body);
      results.writeRequestLog.push({ scenario: 'help-manage-409', body, seq: puts.length, held: true });
      if (resolveRequestStarted) {
        resolveRequestStarted({ at: Date.now(), n: puts.length });
        resolveRequestStarted = null;
      }
      // Stay pending until probe completes — deterministic hang, not fixed sleep
      await hold409;
      await route.fulfill(exp(409, { code: '409', msg: '状态冲突，请刷新后重试。' }));
    });
    const saveH = await page.locator('[role="dialog"] button:has-text("确认并保存"), [role="dialog"] button:has-text("保存处理结果")').first().elementHandle();
    assert('help-save-btn', !!saveH, 'no save');
    await saveH.evaluate((el) => { el.click(); el.click(); });
    // Wait until the route has accepted the first PUT (request hanging)
    let startedMeta = null;
    try {
      startedMeta = await Promise.race([
        requestStarted,
        new Promise((_, rej) => setTimeout(() => rej(new Error('manage PUT never reached route')), 8000))
      ]);
    } catch (e) {
      if (release409) release409();
      assert('help-mode-request-started', false, String(e && e.message || e));
      throw e;
    }
    assert('help-mode-request-started', !!startedMeta, JSON.stringify(startedMeta));
    // Request still held — read live DOM (must fail if not actually disabled)
    const disState = await page.evaluate(() => {
      const ex = document.getElementById('helpAnimalModeExisting');
      const nw = document.getElementById('helpAnimalModeNew');
      if (!ex || !nw) return { missing: true };
      const cs = window.getComputedStyle(ex);
      return {
        missing: false,
        exDisabled: ex.disabled === true,
        nwDisabled: nw.disabled === true,
        exPressed: ex.getAttribute('aria-pressed'),
        nwPressed: nw.getAttribute('aria-pressed'),
        opacity: parseFloat(cs.opacity) || 1,
        cursor: cs.cursor,
        bg: cs.backgroundColor
      };
    });
    recordStrictRuntimeProbe('help-manage-409-inflight-disabled', {
      requestCountWhileHeld: puts.length,
      startedMeta,
      baseline: baselineSeg,
      probe: disState
    });
    results.segmentedStyleEvidence.savingDisabled = disState;
    results.segmentedStyleEvidence.savingBaseline = baselineSeg;
    assert('help-mode-saving-disabled', !disState.missing && disState.exDisabled && disState.nwDisabled, JSON.stringify(disState));
    assert('help-mode-saving-pressed', disState.exPressed === 'true' && disState.nwPressed === 'false', JSON.stringify(disState));
    assert('help-mode-saving-opacity', disState.opacity < baselineSeg.opacity, JSON.stringify({ baseline: baselineSeg.opacity, now: disState.opacity }));
    assert('help-mode-saving-cursor', disState.cursor === 'not-allowed', JSON.stringify(disState));
    assert('help-manage-once-inflight', puts.length === 1, 'n=' + puts.length);
    // Release 409 response after probe
    release409();
    await page.waitForSelector('#helpManageError', { timeout: 8000 });
    assert('help-manage-once', puts.length === 1, 'n=' + puts.length);
    assert('help-manage-version', puts[0] && Number(puts[0].expectedVersion) === 3, JSON.stringify(puts[0]));
    assert('help-manage-existing-id', puts[0] && Number(puts[0].existingAnimalId) === 92001, JSON.stringify(puts[0]));
    assert('help-manage-no-animal-both', !(puts[0].animal && puts[0].existingAnimalId), JSON.stringify(puts[0]));
    assert('help-409-keeps', (await page.locator('#manageTitle').count()) >= 1, 'closed');
    assert('help-409-error', /冲突|刷新/.test(await page.locator('#helpManageError').innerText().catch(() => '')), 'err');
    assert('help-409-no-success', (await page.locator('.help-governance-feedback.is-success').count()) === 0, 'success');
    const lock = await page.evaluate(() => {
      const vm = document.querySelector('#workspace').__vue__;
      const L = window.__helpWriteLocks || {};
      return { saving: !!(vm && vm.manageSaving), lock: !!L.manage };
    });
    assert('help-409-lock-released', !lock.saving && !lock.lock, JSON.stringify(lock));
    const f409 = await inspectFocus(page);
    recFocus('help-manage-409', f409, { dialogStrict: true });
    assert('help-409-focus-in-dialog', dialogFocusOk(f409) && (f409.id === 'helpManageError' || f409.roleAlert), JSON.stringify(f409));
    await shot(page, '05-help-manage-409', { page: 'help', role: 'admin', viewport: '1440x900', state: 'manage-409', goal: '处理409' });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    assert('help-manage-esc', (await page.locator('#manageTitle').count()) === 0, 'open');
    const fEsc = await inspectFocus(page);
    const exactMg = mgH ? await page.evaluate((el) => document.activeElement === el, mgH) : false;
    recFocus('help-manage-esc', fEsc, { exactTrigger: exactMg });
    assert('help-manage-esc-exact', exactMg && focusOk(fEsc), JSON.stringify({ exactMg, fEsc }));
    await page.unroute('**/api/help/**/manage').catch(() => {});

    // Manage success + new animal via real form fields (no Vue assignment)
    await mgBtn.click();
    await page.waitForTimeout(200);
    await page.selectOption('#managerStatus', '2');
    await page.selectOption('#managerOutcome', 'intake');
    await page.fill('#managerResolution', '创建新档案入库');
    await page.locator('button:has-text("创建新档案")').click();
    await page.waitForTimeout(100);
    await page.fill('#helpNewAnimalName', '新救助猫');
    await page.fill('#helpNewAnimalType', '猫');
    await page.selectOption('#helpNewAnimalSex', '未知');
    await page.fill('#helpNewAnimalDescribe', 'fixture');
    await shot(page, '06-help-intake-new', { page: 'help', role: 'admin', viewport: '1440x900', state: 'intake-new', goal: '创建档案' });
    const putsOk = [];
    await page.route('**/api/help/**/manage', async (route) => {
      if (route.request().method() !== 'PUT') { await route.continue(); return; }
      putsOk.push(route.request().postDataJSON());
      results.writeRequestLog.push({ scenario: 'help-manage-success', body: route.request().postDataJSON() });
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ code: '0', data: true }) });
    });
    await page.locator('[role="dialog"] button:has-text("确认并保存"), [role="dialog"] button:has-text("保存处理结果")').first().click();
    await page.waitForFunction(() => {
      const fb = document.querySelector('.help-governance-feedback');
      return fb && /已更新/.test(fb.textContent || '') && !document.querySelector('#manageTitle');
    }, { timeout: 8000 }).catch(() => {});
    assert('help-success-once', putsOk.length === 1, 'n=' + putsOk.length);
    assert('help-success-new-animal', putsOk[0] && putsOk[0].animal && putsOk[0].animal.tname === '新救助猫', JSON.stringify(putsOk[0]));
    assert('help-success-new-type', putsOk[0] && putsOk[0].animal && putsOk[0].animal.ttype === '猫', JSON.stringify(putsOk[0]));
    assert('help-success-no-existing', !putsOk[0].existingAnimalId, JSON.stringify(putsOk[0]));
    assert('help-success-feedback', /已更新/.test(await page.locator('.help-governance-feedback').innerText().catch(() => '')), 'msg');
    const fHelpOk = await inspectFocus(page);
    recFocus('help-manage-success', fHelpOk, {});
    assert('help-success-focus-stable', stableFocusOk(fHelpOk) && !fHelpOk.inDialog, JSON.stringify(fHelpOk));
    await shot(page, '07-help-success', { page: 'help', role: 'admin', viewport: '1440x900', state: 'success', goal: '处理成功' });
    await page.unroute('**/api/help/**/manage').catch(() => {});

    // Validation blocks
    await page.locator('button:has-text("处理工单"), button:has-text("处理")').first().click();
    await page.waitForTimeout(200);
    await page.selectOption('#managerStatus', '2');
    await page.selectOption('#managerOutcome', '');
    await page.locator('[role="dialog"] button:has-text("确认并保存"), [role="dialog"] button:has-text("保存处理结果")').first().click();
    await page.waitForTimeout(150);
    assert('help-block-outcome', /处理结果/.test(await page.locator('#helpManageError').innerText().catch(() => '')), 'outcome');
    await page.selectOption('#managerOutcome', 'intake');
    await page.fill('#managerResolution', '');
    await page.locator('[role="dialog"] button:has-text("确认并保存"), [role="dialog"] button:has-text("保存处理结果")').first().click();
    await page.waitForTimeout(150);
    assert('help-block-resolution', /处理结论/.test(await page.locator('#helpManageError').innerText().catch(() => '')), 'resolution');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);

    // Chat empty + send success + send fail
    assert('help-chat-empty', (await page.locator('.ui-chat-empty').count()) >= 1, 'empty');
    const chats = [];
    await page.route('**/api/help/chat', async (route) => {
      if (route.request().method() !== 'POST') { await route.continue(); return; }
      chats.push(route.request().postDataJSON());
      results.writeRequestLog.push({ scenario: 'help-chat', body: route.request().postDataJSON() });
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ code: '0', data: { id: 1, username: 'admin', text: '测试消息', createdTime: '2026-07-30 12:00:00' } })
      });
    });
    await page.fill('#adminCommunityMessage', '测试消息');
    const chatBtn = page.locator('.ui-chat-compose button[type="submit"]');
    const ch = await chatBtn.elementHandle();
    await ch.evaluate((el) => { el.click(); el.click(); });
    await page.waitForTimeout(500);
    assert('help-chat-once', chats.length === 1, 'n=' + chats.length);
    assert('help-chat-success', (await page.locator('.ui-chat-bubble').count()) >= 1, 'msg');
    const fChatOk = await inspectFocus(page);
    recFocus('help-chat-success', fChatOk, {});
    await shot(page, '08-help-chat', { page: 'help', role: 'admin', viewport: '1440x900', state: 'chat', goal: '公共聊天' });
    await page.unroute('**/api/help/chat').catch(() => {});

    // Chat 500 fail: keep input, show error, no fake bubble, lock released, double-click once
    const chatFails = [];
    await page.route('**/api/help/chat', async (route) => {
      if (route.request().method() !== 'POST') { await route.continue(); return; }
      chatFails.push(route.request().postDataJSON());
      results.writeRequestLog.push({ scenario: 'help-chat-fail', body: route.request().postDataJSON() });
      await new Promise((r) => setTimeout(r, 300));
      await route.fulfill(exp(500, { code: '500', msg: '聊天服务异常' }));
    });
    const bubblesBefore = await page.locator('.ui-chat-bubble').count();
    await page.fill('#adminCommunityMessage', '失败保留消息');
    const chFail = await page.locator('.ui-chat-compose button[type="submit"]').elementHandle();
    await chFail.evaluate((el) => { el.click(); el.click(); });
    await page.waitForTimeout(700);
    assert('help-chat-fail-once', chatFails.length === 1, 'n=' + chatFails.length);
    assert('help-chat-fail-keep-input', (await page.locator('#adminCommunityMessage').inputValue()) === '失败保留消息', 'cleared');
    assert('help-chat-fail-error', /异常|未能|失败|网络/.test(await page.locator('.ui-chat-feedback').innerText().catch(() => '')), 'err');
    assert('help-chat-fail-no-fake', (await page.locator('.ui-chat-bubble').count()) === bubblesBefore, 'fake bubble');
    const chatLock = await page.evaluate(() => {
      const vm = document.querySelector('#workspace').__vue__;
      const L = window.__helpWriteLocks || {};
      return { sending: !!(vm && vm.chatSending), lock: !!L.chat };
    });
    assert('help-chat-fail-lock', !chatLock.sending && !chatLock.lock, JSON.stringify(chatLock));
    const fChatFail = await inspectFocus(page);
    recFocus('help-chat-fail', fChatFail, {});
    await page.unroute('**/api/help/chat').catch(() => {});

    // Mobile help
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(base + '/page/end/help.html', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(600);
    const ov = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert('help-mobile-no-hscroll', ov <= 2, 'ov=' + ov);
    assert('help-mobile-cards', await page.locator('.admin-help-card').first().isVisible(), 'cards');
    await shot(page, '09-help-mobile', { page: 'help', role: 'admin', viewport: '390x844', state: 'mobile', goal: '救助移动端' });

    // ——— ANIMAL ———
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.route('**/api/animal/page**', async (route) => {
      if (route.request().method() !== 'GET') { await route.continue(); return; }
      await route.fulfill(pageData(ANIMAL_RECORDS));
    });
    await page.goto(base + '/page/end/animal.html', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(700);
    assert('animal-title', /档案治理|动物档案/.test(await page.locator('h1').innerText()), 'title');
    assert('animal-metrics', (await page.locator('.animal-governance-metric').count()) >= 4, 'metrics');
    assert('animal-fixture', (await page.locator('text=UI_2D_ANIMAL_AVAIL').count()) >= 1, 'fixture');
    await shot(page, '10-animal-desktop', { page: 'animal', role: 'admin', viewport: '1440x900', state: 'fixture', goal: '动物桌面' });

    // Create success
    const createBtn = page.locator('button:has-text("新增动物")').first();
    await createBtn.click();
    await page.waitForTimeout(250);
    assert('animal-create-open', (await page.locator('#animalName').count()) >= 1, 'dialog');
    await assertDialogFocus(page, 'animal-create-focus-in', 'animal-create-open');
    await page.fill('#animalName', 'UI_2D_NEW');
    await page.fill('#animalType', '猫');
    await shot(page, '11-animal-create', { page: 'animal', role: 'admin', viewport: '1440x900', state: 'create', goal: '新增' });
    const creates = [];
    await page.route('**/api/animal', async (route) => {
      const m = route.request().method();
      if (m !== 'POST' && m !== 'PUT') { await route.continue(); return; }
      const body = route.request().postDataJSON();
      creates.push({ method: m, body });
      results.writeRequestLog.push({ scenario: 'animal-create', method: m, body });
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ code: '0', data: true }) });
    });
    const saveBtn = page.locator('[role="dialog"] button:has-text("保存"), form.admin-edit-form button[type="submit"]').first();
    const sh = await saveBtn.elementHandle();
    await sh.evaluate((el) => { el.click(); el.click(); });
    await page.waitForTimeout(700);
    const posts = creates.filter((c) => c.method === 'POST');
    assert('animal-create-once', posts.length === 1, 'n=' + posts.length + JSON.stringify(creates));
    assert('animal-create-no-tstate', posts[0] && posts[0].body && posts[0].body.tstate === undefined, JSON.stringify(posts[0]));
    assert('animal-create-success', /已保存/.test(await page.locator('.animal-governance-feedback').innerText().catch(() => '')), 'msg');
    const fCreateOk = await inspectFocus(page);
    recFocus('animal-create-success', fCreateOk, {});
    assert('animal-create-focus-stable', stableFocusOk(fCreateOk) && !fCreateOk.inDialog, JSON.stringify(fCreateOk));
    await shot(page, '12-animal-create-success', { page: 'animal', role: 'admin', viewport: '1440x900', state: 'create-ok', goal: '新增成功' });
    await page.unroute('**/api/animal').catch(() => {});

    // Edit 409 then success
    const editBtn = page.locator('.admin-record-table button:has-text("编辑"), button:has-text("编辑档案"), button:has-text("编辑")').first();
    assert('animal-edit-btn', (await editBtn.count()) >= 1, 'missing');
    const editH = await editBtn.elementHandle();
    await editBtn.click();
    await page.waitForTimeout(250);
    assert('animal-edit-open', (await page.locator('#animalName').count()) >= 1, 'dialog');
    await assertDialogFocus(page, 'animal-edit-focus-in', 'animal-edit-open');
    assert('animal-tstate-readonly', await page.locator('#animalState').getAttribute('readonly') !== null
      || await page.locator('#animalState').isDisabled(), 'tstate');
    await page.fill('#animalName', 'UI_2D_ANIMAL_EDITED');
    await shot(page, '13-animal-edit', { page: 'animal', role: 'admin', viewport: '1440x900', state: 'edit', goal: '编辑' });
    const animalPuts = [];
    await page.route('**/api/animal', async (route) => {
      if (route.request().method() !== 'PUT') { await route.continue(); return; }
      const body = route.request().postDataJSON();
      animalPuts.push(body);
      results.writeRequestLog.push({ scenario: 'animal-edit-409', body });
      await new Promise((r) => setTimeout(r, 400));
      await route.fulfill(exp(409, { code: '409', msg: '保存冲突，请刷新后重试。' }));
    });
    const esh = await page.locator('form.admin-edit-form button[type="submit"], [role="dialog"] button.is-primary').first().elementHandle();
    await esh.evaluate((el) => { el.click(); el.click(); });
    await page.waitForTimeout(800);
    assert('animal-edit-once', animalPuts.length === 1, 'n=' + animalPuts.length);
    assert('animal-edit-no-tstate', animalPuts[0] && animalPuts[0].tstate === undefined, JSON.stringify(animalPuts[0]));
    assert('animal-409-keeps', (await page.locator('#animalName').count()) >= 1, 'closed');
    assert('animal-409-error', /冲突|刷新/.test(await page.locator('#animalEditError').innerText().catch(() => '')), 'err');
    const aLock = await page.evaluate(() => {
      const vm = document.querySelector('#workspace').__vue__;
      const L = window.__animalWriteLocks || {};
      return { saving: !!(vm && vm.saving), lock: !!L.save };
    });
    assert('animal-409-lock', !aLock.saving && !aLock.lock, JSON.stringify(aLock));
    const af = await inspectFocus(page);
    recFocus('animal-edit-409', af, { dialogStrict: true });
    assert('animal-409-focus', dialogFocusOk(af) && (af.id === 'animalEditError' || af.roleAlert), JSON.stringify(af));
    await shot(page, '14-animal-409', { page: 'animal', role: 'admin', viewport: '1440x900', state: 'edit-409', goal: '编辑409' });
    await page.unroute('**/api/animal').catch(() => {});

    // Edit success (real fill + one PUT)
    const putsOkAnimal = [];
    await page.route('**/api/animal', async (route) => {
      if (route.request().method() !== 'PUT') { await route.continue(); return; }
      putsOkAnimal.push(route.request().postDataJSON());
      results.writeRequestLog.push({ scenario: 'animal-edit-ok', body: route.request().postDataJSON() });
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ code: '0', data: true }) });
    });
    await page.fill('#animalName', 'UI_2D_ANIMAL_SAVED');
    const esh2 = await page.locator('form.admin-edit-form button[type="submit"]').first().elementHandle();
    await esh2.evaluate((el) => { el.click(); el.click(); });
    await page.waitForTimeout(800);
    assert('animal-edit-ok-once', putsOkAnimal.length === 1, 'n=' + putsOkAnimal.length);
    assert('animal-edit-ok-no-tstate', putsOkAnimal[0] && putsOkAnimal[0].tstate === undefined, JSON.stringify(putsOkAnimal[0]));
    assert('animal-edit-ok-closed', (await page.locator('#animalEditTitle').count()) === 0, 'open');
    assert('animal-edit-ok-msg', /已保存/.test(await page.locator('.animal-governance-feedback').innerText().catch(() => '')), 'msg');
    const fEditOk = await inspectFocus(page);
    recFocus('animal-edit-success', fEditOk, {});
    assert('animal-edit-ok-focus-stable', stableFocusOk(fEditOk) && !fEditOk.inDialog, JSON.stringify(fEditOk));
    await page.unroute('**/api/animal').catch(() => {});

    // Delete 409 + tab cycle + esc exact + success
    const delBtn = page.locator('.admin-record-table button:has-text("删除")').first();
    assert('animal-del-btn', (await delBtn.count()) >= 1, 'missing');
    const delH = await delBtn.elementHandle();
    await delBtn.click();
    await page.waitForTimeout(280);
    const delDlg = page.locator('[role="alertdialog"][aria-labelledby="animalDeleteTitle"]');
    assert('animal-del-dialog', (await delDlg.count()) >= 1 && /删除/.test(await delDlg.innerText()), 'dialog');
    assert('animal-del-shows-name', /UI_2D_ANIMAL/.test(await delDlg.innerText()), 'name');
    assert('animal-del-shows-id', /#9200/.test(await delDlg.innerText()), 'id');
    const fDelOpen = await assertDialogFocus(page, 'animal-del-focus-open', 'animal-delete-open');
    assert('animal-del-open-not-trigger', !(await page.evaluate((el) => document.activeElement === el, delH)), 'still on trigger ' + JSON.stringify(fDelOpen));
    await assertTabCycle(page, 'animal-del');
    await shot(page, '15-animal-delete', { page: 'animal', role: 'admin', viewport: '1440x900', state: 'delete', goal: '删除确认' });
    const dels = [];
    await page.route('**/api/animal/**', async (route) => {
      if (route.request().method() !== 'DELETE') { await route.continue(); return; }
      dels.push(route.request().url());
      results.writeRequestLog.push({ scenario: 'animal-delete-409', url: route.request().url() });
      await new Promise((r) => setTimeout(r, 350));
      await route.fulfill(exp(409, { code: '409', msg: '删除冲突，请刷新后重试。' }));
    });
    const delConf = page.locator('[role="alertdialog"] button.is-danger-solid, [role="alertdialog"] button:has-text("确认删除")').first();
    await delConf.waitFor({ state: 'visible', timeout: 5000 });
    const dch = await delConf.elementHandle();
    assert('animal-del-confirm', !!dch, 'no confirm');
    await dch.evaluate((el) => { el.click(); el.click(); });
    await page.waitForTimeout(700);
    assert('animal-delete-once', dels.length === 1, 'n=' + dels.length);
    assert('animal-delete-409-keeps', (await delDlg.count()) >= 1, 'closed');
    assert('animal-delete-409-error', /冲突|刷新/.test(await page.locator('#animalDeleteError').innerText().catch(() => '')), 'err');
    assert('animal-delete-409-no-success', (await page.locator('.animal-governance-feedback.is-success').count()) === 0, 'success');
    const dLock = await page.evaluate(() => {
      const vm = document.querySelector('#workspace').__vue__;
      const L = window.__animalWriteLocks || {};
      return { deleting: !!(vm && vm.deleting), lock: !!L.del };
    });
    assert('animal-delete-409-lock', !dLock.deleting && !dLock.lock, JSON.stringify(dLock));
    const df = await inspectFocus(page);
    recFocus('animal-delete-409', df, { dialogStrict: true });
    assert('animal-delete-409-focus', dialogFocusOk(df) && df.id === 'animalDeleteError', JSON.stringify(df));
    await page.unroute('**/api/animal/**').catch(() => {});

    // Esc exact restore to delete button
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    assert('animal-del-esc-closed', (await delDlg.count()) === 0, 'open');
    const fDelEsc = await inspectFocus(page);
    const exactDel = delH ? await page.evaluate((el) => document.activeElement === el, delH) : false;
    recFocus('animal-delete-esc', fDelEsc, { exactTrigger: exactDel });
    assert('animal-del-esc-exact', exactDel && focusOk(fDelEsc), JSON.stringify({ exactDel, fDelEsc }));

    // Reopen delete → success
    await delBtn.click();
    await page.waitForTimeout(200);
    const delsOk = [];
    await page.route('**/api/animal/**', async (route) => {
      if (route.request().method() !== 'DELETE') { await route.continue(); return; }
      delsOk.push(route.request().url());
      results.writeRequestLog.push({ scenario: 'animal-delete-ok', url: route.request().url() });
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ code: '0', data: true }) });
    });
    const dch2 = await page.locator('[role="alertdialog"] button.is-danger-solid').first().elementHandle();
    await dch2.evaluate((el) => { el.click(); el.click(); });
    await page.waitForTimeout(700);
    assert('animal-delete-ok-once', delsOk.length === 1, 'n=' + delsOk.length);
    assert('animal-delete-ok-closed', (await delDlg.count()) === 0, 'still open');
    assert('animal-delete-ok-msg', /已删除/.test(await page.locator('.animal-governance-feedback').innerText().catch(() => '')), 'msg');
    const fDelOk = await inspectFocus(page);
    recFocus('animal-delete-success', fDelOk, {});
    assert('animal-delete-ok-focus-stable', stableFocusOk(fDelOk) && !fDelOk.inDialog, JSON.stringify(fDelOk));
    await page.unroute('**/api/animal/**').catch(() => {});

    // Mobile card delete button
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(base + '/page/end/animal.html', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(500);
    const cardDel = page.locator('.admin-animal-cards button:has-text("删除")').first();
    assert('animal-card-del-btn', (await cardDel.count()) >= 1, 'missing');
    const cardDelH = await cardDel.elementHandle();
    await cardDel.click();
    await page.waitForTimeout(250);
    await assertDialogFocus(page, 'animal-card-del-focus', 'animal-card-delete-open');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    const exactCardDel = cardDelH ? await page.evaluate((el) => document.activeElement === el, cardDelH) : false;
    assert('animal-card-del-esc-exact', exactCardDel, 'esc focus');
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(base + '/page/end/animal.html', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(500);

    // Import: partial + full success + fail
    await page.locator('button:has-text("批量导入")').click();
    await page.waitForTimeout(200);
    assert('animal-import-open', (await page.locator('text=导入').count()) >= 1, 'import');
    await assertDialogFocus(page, 'animal-import-focus-in', 'animal-import-open');
    assert('animal-import-template', (await page.locator('button:has-text("模板")').count()) + (await page.locator('text=下载').count()) >= 1, 'template');
    await shot(page, '16-animal-import', { page: 'animal', role: 'admin', viewport: '1440x900', state: 'import', goal: '批量导入' });
    await page.setInputFiles('#animalImportFile, input[type="file"]', {
      name: 'animals.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: Buffer.from('PK fake xlsx')
    });
    await page.waitForTimeout(150);
    assert('animal-import-file-not-success', (await page.locator('.admin-import-result').count()) === 0, 'false success');
    const imports = [];
    await page.route('**/api/animal/import', async (route) => {
      if (route.request().method() !== 'POST') { await route.continue(); return; }
      imports.push(1);
      results.writeRequestLog.push({ scenario: 'animal-import-partial', n: imports.length });
      await new Promise((r) => setTimeout(r, 300));
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({
          code: '0',
          data: { total: 3, successCount: 2, failed: [{ row: 3, reason: '名称缺失' }] }
        })
      });
    });
    const impBtn = page.locator('[role="dialog"] button:has-text("开始导入")').first();
    const ih = await impBtn.elementHandle();
    await ih.evaluate((el) => { el.click(); el.click(); });
    await page.waitForTimeout(700);
    assert('animal-import-once', imports.length === 1, 'n=' + imports.length);
    assert('animal-import-partial', /成功 2|失败/.test(await page.locator('.admin-import-result').innerText().catch(() => '')), 'partial');
    await page.unroute('**/api/animal/import').catch(() => {});

    // Import 100% success
    const importsOk = [];
    await page.route('**/api/animal/import', async (route) => {
      if (route.request().method() !== 'POST') { await route.continue(); return; }
      importsOk.push(1);
      results.writeRequestLog.push({ scenario: 'animal-import-full-ok', n: importsOk.length });
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ code: '0', data: { total: 3, successCount: 3, failed: [] } })
      });
    });
    await page.setInputFiles('#animalImportFile, input[type="file"]', {
      name: 'animals-ok.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: Buffer.from('PK ok')
    });
    const ih2 = await page.locator('[role="dialog"] button:has-text("开始导入")').first().elementHandle();
    await ih2.evaluate((el) => { el.click(); el.click(); });
    await page.waitForTimeout(700);
    assert('animal-import-full-once', importsOk.length === 1, 'n=' + importsOk.length);
    const fullTxt = await page.locator('.admin-import-result').innerText().catch(() => '');
    assert('animal-import-full-ok', /成功 3/.test(fullTxt) && /失败 0/.test(fullTxt), fullTxt);
    assert('animal-import-full-no-fail-list', (await page.locator('.admin-import-result li').count()) === 0, 'failed list');
    const impLock = await page.evaluate(() => {
      const vm = document.querySelector('#workspace').__vue__;
      const L = window.__animalWriteLocks || {};
      return { importing: !!(vm && vm.importing), lock: !!L.import };
    });
    assert('animal-import-full-lock', !impLock.importing && !impLock.lock, JSON.stringify(impLock));
    const fImpOk = await inspectFocus(page);
    recFocus('animal-import-success', fImpOk, { dialogStrict: true });
    assert('animal-import-full-focus', dialogFocusOk(fImpOk), JSON.stringify(fImpOk));
    await page.unroute('**/api/animal/import').catch(() => {});

    // Import full failure
    await page.route('**/api/animal/import', async (route) => {
      if (route.request().method() !== 'POST') { await route.continue(); return; }
      results.writeRequestLog.push({ scenario: 'animal-import-fail' });
      await route.fulfill(exp(500, { code: '500', msg: '导入服务异常' }));
    });
    await page.setInputFiles('#animalImportFile, input[type="file"]', {
      name: 'animals2.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: Buffer.from('PK fake2')
    });
    await page.locator('[role="dialog"] button:has-text("开始导入")').first().click();
    await page.waitForTimeout(500);
    assert('animal-import-fail', /异常|失败/.test(await page.locator('#animalImportError').innerText().catch(() => '')), 'fail');
    assert('animal-import-fail-keeps', (await page.locator('[role="dialog"][aria-labelledby="animalImportTitle"]').count()) >= 1, 'closed');
    const fImpFail = await inspectFocus(page);
    recFocus('animal-import-fail', fImpFail, { dialogStrict: true });
    assert('animal-import-fail-focus', dialogFocusOk(fImpFail) && (fImpFail.id === 'animalImportError' || fImpFail.roleAlert), JSON.stringify(fImpFail));
    await page.unroute('**/api/animal/import').catch(() => {});
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);

    // Missing image placeholder still present on list
    assert('animal-image-placeholder', (await page.locator('.admin-thumb, img, .animal-governance-thumb, .admin-card-media').count()) >= 1, 'thumb');

    // Mobile animal workbench
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(base + '/page/end/animal.html', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(600);
    const aov = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert('animal-mobile-no-hscroll', aov <= 2, 'ov=' + aov);
    await shot(page, '17-animal-mobile', { page: 'animal', role: 'admin', viewport: '390x844', state: 'mobile', goal: '动物移动端' });

    // Mobile dialog matrix: 390 / 360 / 320
    for (const vp of [{ name: '390x844', w: 390, h: 844 }, { name: '360x800', w: 360, h: 800 }, { name: '320x700', w: 320, h: 700 }]) {
      await page.setViewportSize({ width: vp.w, height: vp.h });
      await page.route('**/api/help/page**', async (route) => {
        if (route.request().method() === 'GET') await route.fulfill(pageData(HELP_RECORDS));
        else await route.continue();
      });
      await page.goto(base + '/page/end/help.html', { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForTimeout(400);
      await clickVisible(page, 'button:has-text("处理工单"), .admin-help-card button.is-primary');
      await page.waitForTimeout(250);
      await page.selectOption('#managerStatus', '2');
      await page.selectOption('#managerOutcome', 'intake');
      await clickVisible(page, 'button:has-text("创建新档案")');
      await page.waitForTimeout(80);
      const helpDlgMetrics = await page.evaluate(() => {
        const root = document.querySelector('[role="dialog"][aria-labelledby="manageTitle"]');
        if (!root) return null;
        const r = root.getBoundingClientRect();
        const btn = root.querySelector('.admin-dialog-actions button');
        const br = btn ? btn.getBoundingClientRect() : null;
        return {
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          dlgW: r.width,
          btnH: br ? br.height : 0,
          btnVisible: br ? br.bottom <= window.innerHeight + 2 && br.top >= -2 : false,
          inDialog: root.contains(document.activeElement)
        };
      });
      assert('mobile-help-manage-' + vp.name, helpDlgMetrics && helpDlgMetrics.overflow <= 2 && helpDlgMetrics.inDialog && helpDlgMetrics.btnH >= 40, JSON.stringify(helpDlgMetrics));
      await page.keyboard.press('Escape');
      await page.waitForTimeout(100);

      await page.route('**/api/animal/page**', async (route) => {
        if (route.request().method() === 'GET') await route.fulfill(pageData(ANIMAL_RECORDS));
        else await route.continue();
      });
      await page.goto(base + '/page/end/animal.html', { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForTimeout(400);
      await clickVisible(page, '.admin-animal-cards button:has-text("编辑"), button:has-text("编辑档案"), button:has-text("编辑")');
      await page.waitForTimeout(200);
      const editM = await page.evaluate(() => {
        const root = document.querySelector('[role="dialog"][aria-labelledby="animalEditTitle"]');
        if (!root) return null;
        const btn = root.querySelector('.admin-dialog-actions button');
        const br = btn && btn.getBoundingClientRect();
        return {
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          inDialog: root.contains(document.activeElement),
          btnH: br ? br.height : 0
        };
      });
      assert('mobile-animal-edit-' + vp.name, editM && editM.overflow <= 2 && editM.inDialog, JSON.stringify(editM));
      await page.keyboard.press('Escape');
      await page.waitForTimeout(100);
      await clickVisible(page, '.admin-animal-cards button:has-text("删除"), button:has-text("删除档案"), button:has-text("删除")');
      await page.waitForTimeout(200);
      const delM = await page.evaluate(() => {
        const root = document.querySelector('[role="alertdialog"]');
        if (!root) return null;
        const btn = root.querySelector('button.is-danger-solid, button');
        const br = btn && btn.getBoundingClientRect();
        return {
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          inDialog: root.contains(document.activeElement),
          btnH: br ? br.height : 0
        };
      });
      assert('mobile-animal-del-' + vp.name, delM && delM.overflow <= 2 && delM.inDialog && delM.btnH >= 40, JSON.stringify(delM));
      await page.keyboard.press('Escape');
      await page.waitForTimeout(100);
      await clickVisible(page, 'button:has-text("批量导入")');
      await page.waitForTimeout(200);
      const impM = await page.evaluate(() => {
        const root = document.querySelector('[role="dialog"][aria-labelledby="animalImportTitle"]');
        if (!root) return null;
        return {
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          inDialog: root.contains(document.activeElement)
        };
      });
      assert('mobile-animal-import-' + vp.name, impM && impM.overflow <= 2 && impM.inDialog, JSON.stringify(impM));
      await page.keyboard.press('Escape');
      await page.waitForTimeout(80);
    }

    // Viewport matrix
    for (const vp of VIEWPORTS) {
      for (const pg of ['help', 'animal']) {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        if (pg === 'help') {
          await page.route('**/api/help/page**', async (route) => {
            if (route.request().method() === 'GET') await route.fulfill(pageData(HELP_RECORDS));
            else await route.continue();
          });
        } else {
          await page.route('**/api/animal/page**', async (route) => {
            if (route.request().method() === 'GET') await route.fulfill(pageData(ANIMAL_RECORDS));
            else await route.continue();
          });
        }
        await page.goto(base + '/page/end/' + pg + '.html', { waitUntil: 'domcontentloaded', timeout: 45000 });
        await page.waitForTimeout(250);
        const m = await page.evaluate(() => ({
          h1: !!document.querySelector('h1'),
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
        }));
        assert('vp-' + pg + '-' + vp.name, m.h1 && m.overflow <= 2, JSON.stringify(m));
      }
    }

    // Permissions matrix
    {
      const a = await browser.newContext();
      await login(a, 'admin', 'admin');
      const p = await a.newPage();
      await p.goto(base + '/page/end/help.html', { waitUntil: 'domcontentloaded', timeout: 45000 });
      await p.waitForTimeout(400);
      const helpApi = await a.request.get(base + '/api/help/page');
      const helpOk = !/login|forbidden|error=/.test(p.url()) && helpApi.status() === 200;
      await p.goto(base + '/page/end/animal.html', { waitUntil: 'domcontentloaded', timeout: 45000 });
      await p.waitForTimeout(400);
      const animalApi = await a.request.get(base + '/api/animal/page?pageNum=1&pageSize=1');
      const animalOk = !/login|forbidden|error=/.test(p.url()) && animalApi.status() === 200;
      assert('admin-help-ok', helpOk, p.url() + ' api=' + helpApi.status());
      assert('admin-animal-ok', animalOk, p.url() + ' api=' + animalApi.status());
      results.permissionMatrix.admin = { help: helpOk, animal: animalOk };
      await a.close();
    }
    {
      const j = await browser.newContext();
      await login(j, 'jerry', '123456');
      const p = await j.newPage();
      await p.goto(base + '/page/end/help.html', { waitUntil: 'domcontentloaded', timeout: 45000 });
      await p.waitForTimeout(500);
      const apiH = await j.request.get(base + '/api/help/page');
      const helpDenied = /forbidden|login|error=|index/.test(p.url()) || apiH.status() === 403;
      await p.goto(base + '/page/end/animal.html', { waitUntil: 'domcontentloaded', timeout: 45000 });
      await p.waitForTimeout(500);
      const apiA = await j.request.get(base + '/api/animal/page?pageNum=1&pageSize=1');
      const animalDenied = /forbidden|login|error=|index/.test(p.url()) || apiA.status() === 403;
      assert('jerry-help-denied', helpDenied, p.url() + ' ' + apiH.status());
      assert('jerry-animal-denied', animalDenied, p.url() + ' ' + apiA.status());
      results.permissionMatrix.jerry = { helpDenied, animalDenied, helpApi: apiH.status(), animalApi: apiA.status() };
      await j.close();
    }
    {
      const a = await browser.newContext();
      const p = await a.newPage();
      await p.goto(base + '/page/end/animal.html', { waitUntil: 'domcontentloaded', timeout: 45000 });
      await p.waitForTimeout(400);
      assert('anon-animal-login', /login/i.test(p.url()), p.url());
      await a.close();
    }
    {
      const a = await browser.newContext();
      const p = await a.newPage();
      await p.goto(base + '/page/end/help.html', { waitUntil: 'domcontentloaded', timeout: 45000 });
      await p.waitForTimeout(400);
      assert('anon-help-login', /login/i.test(p.url()), p.url());
      await a.close();
    }
    // tom: animal yes, help no (real partial admin)
    {
      const t = await browser.newContext();
      let tomLoginOk = false;
      try {
        await login(t, 'tom', '123456');
        tomLoginOk = true;
      } catch (e) {
        tomLoginOk = false;
      }
      if (tomLoginOk) {
        const p = await t.newPage();
        await p.goto(base + '/page/end/help.html', { waitUntil: 'domcontentloaded', timeout: 45000 });
        await p.waitForTimeout(500);
        const apiH = await t.request.get(base + '/api/help/page');
        const helpDenied = /forbidden|login|error=|index/.test(p.url()) || apiH.status() === 403;
        await p.goto(base + '/page/end/animal.html', { waitUntil: 'domcontentloaded', timeout: 45000 });
        await p.waitForTimeout(500);
        const apiA = await t.request.get(base + '/api/animal/page?pageNum=1&pageSize=1');
        const animalOk = !/forbidden|login|error=/.test(p.url()) && apiA.status() === 200;
        assert('tom-help-denied', helpDenied, p.url() + ' ' + apiH.status());
        assert('tom-animal-ok', animalOk, p.url() + ' ' + apiA.status());
        results.permissionMatrix.tom_animal_only = { helpDenied, animalOk, helpApi: apiH.status(), animalApi: apiA.status() };
      } else {
        assert('tom-help-denied', false, 'tom login failed');
        assert('tom-animal-ok', false, 'tom login failed');
      }
      await t.close();
    }
    // help-only: mock /api/user/me after admin login — page must not enter animal; nav must not claim animal
    {
      const h = await browser.newContext();
      await login(h, 'admin', 'admin');
      const p = await h.newPage();
      await p.route('**/api/user/me**', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            code: '0',
            data: {
              id: 9001,
              username: 'help_only_sim',
              permission: [{ id: 11, flag: 'help', name: '救助' }]
            }
          })
        });
      });
      await p.goto(base + '/page/end/animal.html', { waitUntil: 'domcontentloaded', timeout: 45000 });
      await p.waitForTimeout(600);
      const animalBlocked = /forbidden|error=|index|login/.test(p.url());
      assert('help-only-no-animal-page', animalBlocked, p.url());
      await p.goto(base + '/page/end/help.html', { waitUntil: 'domcontentloaded', timeout: 45000 });
      await p.waitForTimeout(600);
      const helpPageOk = /help\.html/.test(p.url()) && (await p.locator('h1').count()) >= 1;
      assert('help-only-help-page', helpPageOk, p.url());
      // Real API still enforces server RBAC for non-help principals separately; frontend hide ≠ 403
      results.permissionMatrix.help_only_sim = { animalBlocked, helpPageOk, note: 'page gate via me mock; API 403 still server-side' };
      await h.close();
    }

    // Final: every dialog-open focus audit must have been dialogStrict-ok when marked
    const dialogFocusFails = results.focusAudit.filter((f) => f.dialogStrict && !f.strictOk);
    assert('all-dialog-focus-strict', dialogFocusFails.length === 0, JSON.stringify(dialogFocusFails.slice(0, 3)));
    assert('strict-runtime-probe-ran', results.strictRuntimeProbeCount >= 1, 'probes=' + results.strictRuntimeProbeCount);
    assert('zero-best-effort-passes', results.bestEffortPassCount === 0, 'n=' + results.bestEffortPassCount);
    assert('zero-fallback-passes', results.fallbackPassCount === 0, 'n=' + results.fallbackPassCount);

    const intentional = httpErrors.filter((e) => {
      const h = e.headers || {};
      return h[HDR] === VAL || h[HDR.toLowerCase()] === VAL;
    });
    const unexpected = httpErrors.filter((e) => {
      const h = e.headers || {};
      if (h[HDR] === VAL || h[HDR.toLowerCase()] === VAL) return false;
      // image placeholder loads may surface without custom headers in some browsers; still not product bugs
      if (/\/api\/files\//.test(e.url || '') && (e.status === 403 || e.status === 404)) return false;
      return true;
    });
    const realConsole = consoleErrors.filter((t) => {
      if (/Failed to load resource: the server responded with a status of (403|404|409|500)/.test(t)) return false;
      if (/\/api\/files\//.test(t)) return false;
      return true;
    });
    results.consoleAudit = {
      intentionalErrorResponses: intentional,
      unexpectedHttpErrors: unexpected,
      realConsoleErrors: realConsole,
      pageErrors,
      pageErrorCount: pageErrors.length,
      unexpectedHttpCount: unexpected.length,
      realConsoleErrorCount: realConsole.length
    };
    assert('no-unexpected-http', unexpected.length === 0, JSON.stringify(unexpected.slice(0, 3)));
    assert('no-pageerrors', pageErrors.length === 0, JSON.stringify(pageErrors));
    assert('no-requestfailed-write', results.requestFailedWrite.length === 0, JSON.stringify(results.requestFailedWrite));
    assert('no-real-console', realConsole.length === 0, JSON.stringify(realConsole.slice(0, 3)));
    assert('no-skipped', results.checks.every((c) => !c.skipped), 'skipped');
    assert('screenshots-match-index', results.screenshots.length === fs.readdirSync(shotDir).filter((f) => f.endsWith('.png')).length, 'shot count');

    await ctx.close();
  } catch (e) {
    fail('suite-exception', String(e && e.stack || e));
  } finally {
    if (browser) await browser.close().catch(() => {});
    const s = writeReport();
    console.log(JSON.stringify(s, null, 2));
    console.log(s.failed || s.skipped ? `FAILED f=${s.failed} s=${s.skipped}` : `ALL PASSED ${s.passed}`);
    if (results.failures.length) console.log(JSON.stringify(results.failures, null, 2));
    process.exit((s.failed || s.skipped) ? 1 : 0);
  }
})();
