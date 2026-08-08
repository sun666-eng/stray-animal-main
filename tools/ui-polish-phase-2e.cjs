/**
 * Phase 2E strict — volunteer + visit governance (repair: staged image lifecycle).
 * Baseline: 52b04ca · BASE_URL default http://127.0.0.1:18102
 * Fixtures only; controlled Promise hangs; no skip/best-effort pass.
 * HTTP intentional only via audit header or explicit registry (method+url+status).
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const base = process.env.BASE_URL || 'http://127.0.0.1:18102';
const out = path.resolve('output/playwright/ui-polish-phase-2e');
const shotDir = path.join(out, 'screenshots');
if (fs.existsSync(shotDir)) {
  for (const f of fs.readdirSync(shotDir)) if (f.endsWith('.png')) fs.unlinkSync(path.join(shotDir, f));
}
fs.mkdirSync(shotDir, { recursive: true });

const HDR = 'x-ui-audit-expected-error';
const VAL = 'phase2e';
const EH = { [HDR]: VAL };

const VOL_RECORDS = [
  { id: 81001, name: 'UI_2E_VOL_PENDING', tel: '13800000001', email: 'p@example.test', wechat: 'wx_p', location: '测试区A', age: 22, company: '机构甲', sparetime: 1, isvisit: 0, vstate: 0, moreability: '愿意周末值班', apic: '' },
  { id: 81002, name: 'UI_2E_VOL_APPROVED', tel: '13800000002', email: 'a@example.test', wechat: 'wx_a', location: '测试区B', age: 30, company: '机构乙', sparetime: 4, isvisit: 1, vstate: 1, moreability: '已通过', apic: '' },
  { id: 81003, name: 'UI_2E_VOL_REJECTED', tel: '13800000003', email: 'r@example.test', wechat: 'wx_r', location: '测试区C', age: 28, company: '机构丙', sparetime: 2, isvisit: 0, vstate: 2, moreability: '未通过', apic: '' }
];
const VISIT_RECORDS = [
  { id: 82001, petId: 101, uid: 201, aname: 'UI_2E_VISIT_GOOD', vtime: '2026-07-20', state: 5, vname: '记录员甲', remark: '状态良好夹具', pic: '' },
  { id: 82002, petId: 102, uid: 202, aname: 'UI_2E_VISIT_WATCH', vtime: '2026-07-21', state: 3, vname: '记录员乙', remark: '继续观察夹具', pic: '' },
  { id: 82003, petId: 103, uid: 203, aname: 'UI_2E_VISIT_RISK', vtime: '2026-07-22', state: 2, vname: '记录员丙', remark: '需要关注夹具', pic: 'fixture-ok' }
];
const PNG1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
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
  phase2dBaseline: '52b04cafd226f1588667992455493c04c74c9904',
  branch: 'ui-polish/phase-2e-volunteer-visit-governance-20260730',
  checks: [], failures: [], screenshots: [], focusAudit: [], writeRequestLog: [],
  controlledRequestAudit: [], stagedLifecycleAudit: [], permissionMatrix: {},
  bestEffortPassCount: 0, fallbackPassCount: 0, strictRuntimeProbeCount: 0,
  consoleAudit: {}, requestFailedWrite: [], expectedHttpRegistry: [],
  classifierMutationPassCount: 0, visitLoadAudit: [], summary: {}
};

/** Registry of expected non-header HTTP outcomes (e.g. real RBAC 403). */
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
    const el = document.activeElement;
    const dlg = document.querySelector('[role="dialog"], [role="alertdialog"]');
    return {
      tag: el ? el.tagName : '', id: el ? el.id : '',
      isBody: el === document.body, isHtml: el === document.documentElement,
      connected: !!(el && el.isConnected),
      inDialog: !!(dlg && el && dlg.contains(el)),
      roleAlert: !!(el && el.getAttribute && el.getAttribute('role') === 'alert'),
      interactive: !!(el && el.matches && el.matches('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href],[tabindex]:not([tabindex="-1"])'))
    };
  });
}
function focusOk(f) { return f && f.connected && !f.isBody && !f.isHtml && (f.interactive || f.roleAlert); }
function dialogFocusOk(f) {
  return !!(f && f.connected === true && f.inDialog === true && f.isBody === false && f.isHtml === false);
}
function recFocus(s, f, extra) {
  const dialogStrict = extra && extra.dialogStrict;
  results.focusAudit.push(Object.assign({ scenario: s, strictOk: dialogStrict ? dialogFocusOk(f) : focusOk(f), dialogStrict: !!dialogStrict }, f, extra || {}));
}
async function assertDialogFocus(page, id, scenario) {
  await page.waitForTimeout(50);
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
    await page.waitForTimeout(60);
  }
  throw new Error('clickVisible timeout: ' + selector);
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
async function vmState(page) {
  return page.evaluate(() => {
    const vm = document.querySelector('#workspace') && document.querySelector('#workspace').__vue__;
    if (!vm) return null;
    const L = window.__visitWriteLocks || window.__volunteerWriteLocks || {};
    return {
      stagedFlag: vm.stagedFlag || '',
      pic: vm.form && vm.form.pic,
      imageFileName: vm.imageFileName || '',
      saving: !!vm.saving, uploading: !!vm.uploading, deleting: !!vm.deleting, auditSaving: !!vm.auditSaving,
      locks: L,
      editOpen: !!vm.editOpen, deleteItem: !!(vm.deleteItem), auditItem: !!(vm.auditItem), detailItem: !!(vm.detailItem),
      auditState: vm.auditState, impactAcknowledged: !!vm.impactAcknowledged,
      message: vm.message || '', messageType: vm.messageType || '',
      loadSeq: vm.loadSeq
    };
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
  fs.writeFileSync(path.join(out, 'phase-2e-report.json'), JSON.stringify(results, null, 2));
  fs.writeFileSync(path.join(out, 'screenshots-index.json'), JSON.stringify(results.screenshots, null, 2));
  return results.summary;
}

(async () => {
  console.log('Phase 2E strict repair start', base);
  const consoleErrors = [], pageErrors = [], httpErrors = [];
  let browser;
  try {
    const volHtml = fs.readFileSync('src/main/resources/static/page/end/volunteer.html', 'utf8');
    const visitHtml = fs.readFileSync('src/main/resources/static/page/end/visit.html', 'utf8');
    const css = fs.readFileSync('src/main/resources/static/css/admin-workspace.css', 'utf8');
    const suiteSrc = fs.readFileSync('tools/ui-polish-phase-2e.cjs', 'utf8');
    const helpHtml = fs.readFileSync('src/main/resources/static/page/end/help.html', 'utf8');

    assert('vol-cache-30i', volHtml.includes('admin-workspace.css?v=20260730i'), 'cache');
    assert('visit-cache-0808e', visitHtml.includes('admin-workspace.css?v=20260808e'), 'cache');
    assert('visit-command-desk', visitHtml.includes('visit-command-desk') && visitHtml.includes('admin-command-hero') && visitHtml.includes('admin-command-panel'), 'layout');
    assert('help-untouched-0802a', helpHtml.includes('20260802a'), 'help');
    assert('css-relation-grid', css.includes('.visit-relation-grid'), 'css');
    assert('css-file-label', css.includes('.visit-file-label') && css.includes('min-height: 44px'), 'css');
    assert('visit-removeImage', visitHtml.includes('removeImage:') && !/@click="form\.pic\s*=\s*''"/.test(visitHtml), 'remove');
    assert('visit-no-retire-on-save-fail', !/code !== "0"[\s\S]{0,120}retireStage\(vm\.stagedFlag\)/.test(visitHtml), 'lifecycle');
    assert('visit-retire-dedupe', visitHtml.includes('retiredStageFlags'), 'dedupe');
    assert('vol-trap', volHtml.includes('createFocusTrap'), 'trap');
    assert('visit-trap', visitHtml.includes('createFocusTrap'), 'trap');
    const scan = suiteSrc.split(/\r?\n/).filter((ln) => ln.indexOf('self-no-') < 0 && ln.indexOf('self-has-') < 0).join('\n');
    assert('self-no-css-fallback', scan.indexOf('css-fallback') < 0, 'fb');
    assert('self-no-true-assert', !/assert\s*\(\s*['"][^'"]+['"]\s*,\s*true\s*,/.test(scan), 'true');
    assert('self-no-null-catch-pass', !/\.catch\s*\(\s*\(\s*\)\s*=>\s*null\s*\)[\s\S]{0,200}assert\(/.test(scan), 'catch');
    assert('self-has-holds', /holdAudit|holdSave|holdDel|holdUpload/.test(suiteSrc), 'hold');

    browser = await chromium.launch({ headless: true });
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await login(ctx, 'admin', 'admin');
    const page = await ctx.newPage();
    const cssReq = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
    page.on('requestfailed', (req) => {
      if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method())) results.requestFailedWrite.push({ method: req.method(), url: req.url() });
    });
    page.on('response', (r) => {
      if (r.status() >= 400) {
        httpErrors.push({
          status: r.status(),
          url: r.url(),
          method: r.request().method(),
          headers: r.headers()
        });
      }
    });
    page.on('request', (req) => { if (/admin-workspace\.css/.test(req.url())) cssReq.push(req.url()); });

    await page.route('**/api/files/**', async (route) => {
      const url = route.request().url();
      const method = route.request().method();
      if (method === 'DELETE' && /\/api\/files\/staged\//.test(url)) {
        results.writeRequestLog.push({ scenario: 'staged-delete', url, method });
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ code: '0', data: true }), headers: Object.assign({ 'content-type': 'application/json' }, EH) });
        return;
      }
      if (method === 'GET' && /fixture-ok|stage-/.test(url)) {
        await route.fulfill({ status: 200, contentType: 'image/png', body: PNG1, headers: EH });
        return;
      }
      if (method === 'GET') {
        await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ code: '404', msg: 'nf' }), headers: Object.assign({ 'content-type': 'application/json' }, EH) });
        return;
      }
      await route.continue();
    });

    // ========== VOLUNTEER ==========
    let volRecords = VOL_RECORDS.slice();
    await page.route('**/api/volunteer/page**', async (route) => {
      if (route.request().method() !== 'GET') { await route.continue(); return; }
      await route.fulfill(pageData(volRecords));
    });
    await page.goto(base + '/page/end/volunteer.html', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(600);
    assert('vol-css-30i', cssReq.some((u) => /v=20260730i/.test(u)), JSON.stringify(cssReq.slice(-2)));
    assert('vol-title', /义工申请审核/.test(await page.locator('h1').innerText()), 't');
    assert('vol-metrics', (await page.locator('.volunteer-governance-metric').count()) >= 4, 'm');
    assert('vol-fixture', (await page.locator('text=UI_2E_VOL_PENDING').count()) >= 1, 'f');
    await shot(page, '01-vol-desktop', { page: 'volunteer', role: 'admin', viewport: '1440x900', state: 'list', goal: '义工桌面' });

    // empty / invalid / 500 / loadSeq
    await page.unroute('**/api/volunteer/page**').catch(() => {});
    await page.route('**/api/volunteer/page**', async (route) => {
      if (route.request().method() !== 'GET') { await route.continue(); return; }
      await route.fulfill(pageData([]));
    });
    await page.locator('button:has-text("查询")').click();
    await page.waitForTimeout(400);
    assert('vol-empty', /没有义工申请/.test(await page.locator('.admin-status').innerText().catch(() => '')), 'empty');

    await page.unroute('**/api/volunteer/page**').catch(() => {});
    await page.route('**/api/volunteer/page**', async (route) => {
      if (route.request().method() !== 'GET') { await route.continue(); return; }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ code: '0', data: null }) });
    });
    await page.locator('button:has-text("查询")').click({ force: true });
    await page.waitForTimeout(450);
    assert('vol-invalid-shape', (await page.locator('.admin-status.is-error').count()) >= 1 || /无法|无效|识别/.test(await page.locator('main').innerText()), 'invalid');

    await page.unroute('**/api/volunteer/page**').catch(() => {});
    await page.route('**/api/volunteer/page**', async (route) => {
      if (route.request().method() !== 'GET') { await route.continue(); return; }
      await route.fulfill(exp(500, { code: '500', msg: '义工列表服务异常' }));
    });
    await page.waitForFunction(() => {
      const b = document.querySelector('button.ui-button.is-dark[type="submit"]');
      return b && !b.disabled;
    }, { timeout: 5000 }).catch(() => {});
    await page.locator('button:has-text("查询")').click({ force: true });
    await page.waitForTimeout(450);
    assert('vol-load-500', /异常|无法|网络|服务/.test(await page.locator('.admin-status.is-error').innerText().catch(() => '')), '500');

    // loadSeq: slow then fast
    let resolveSlowVol;
    const slowVol = new Promise((r) => { resolveSlowVol = r; });
    let volHit = 0;
    await page.unroute('**/api/volunteer/page**').catch(() => {});
    await page.route('**/api/volunteer/page**', async (route) => {
      if (route.request().method() !== 'GET') { await route.continue(); return; }
      volHit++;
      const n = volHit;
      if (n === 1) {
        await slowVol;
        await route.fulfill(pageData([{ id: 1, name: 'STALE_OLD', vstate: 0, location: 'x', sparetime: 1, isvisit: 0 }]));
      } else {
        await route.fulfill(pageData(VOL_RECORDS));
      }
    });
    // Concurrent loads (disabled submit cannot fire twice) — invoke page load() race to prove loadSeq
    await page.evaluate(() => {
      const vm = document.querySelector('#workspace').__vue__;
      vm.load(1);
      vm.load(1);
    });
    await page.waitForTimeout(120);
    resolveSlowVol();
    await page.waitForTimeout(500);
    assert('vol-loadseq-no-stale', (await page.locator('text=STALE_OLD').count()) === 0 && (await page.locator('text=UI_2E_VOL_PENDING').count()) >= 1, 'seq');
    assert('vol-loadseq-hits', volHit >= 2, 'hits=' + volHit);

    await page.unroute('**/api/volunteer/page**').catch(() => {});
    await page.route('**/api/volunteer/page**', async (route) => {
      if (route.request().method() === 'GET') await route.fulfill(pageData(VOL_RECORDS));
      else await route.continue();
    });
    await page.goto(base + '/page/end/volunteer.html', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(500);

    // detail -> audit single dialog
    await page.locator('button:has-text("详情")').first().click();
    await page.waitForTimeout(200);
    await assertDialogFocus(page, 'vol-detail-focus', 'vol-detail');
    await assertTabCycle(page, 'vol-detail');
    await shot(page, '02-vol-detail', { page: 'volunteer', role: 'admin', viewport: '1440x900', state: 'detail', goal: '详情' });
    await page.locator('[role="dialog"] button:has-text("进入审核")').click();
    await page.waitForTimeout(250);
    const dlgCount = await page.locator('[role="dialog"]').count();
    assert('vol-detail-to-audit-one-dialog', dlgCount === 1 && (await page.locator('#auditTitle').count()) === 1 && (await page.locator('#detailTitle').count()) === 0, 'n=' + dlgCount);
    await assertDialogFocus(page, 'vol-audit-focus', 'vol-audit');
    await assertTabCycle(page, 'vol-audit');
    await shot(page, '03-vol-audit', { page: 'volunteer', role: 'admin', viewport: '1440x900', state: 'audit', goal: '审核' });

    // business fail 200 then 500 then success with hold
    await page.locator('input[name="auditState"][value="1"]').check();
    await page.check('#auditImpactConfirm');

    // 200 business fail
    let auditPuts = [];
    await page.route('**/api/volunteer/**/state/**', async (route) => {
      if (route.request().method() !== 'PUT') { await route.continue(); return; }
      auditPuts.push(route.request().url());
      results.writeRequestLog.push({ scenario: 'vol-audit-biz-fail', n: auditPuts.length });
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ code: '1', msg: '业务拒绝审核' }) });
    });
    await page.locator('[role="dialog"] button.is-primary').click();
    await page.waitForTimeout(500);
    assert('vol-audit-biz-fail-err', /业务|失败|拒绝/.test(await page.locator('#volunteerAuditError').innerText().catch(() => '')), 'err');
    assert('vol-audit-biz-fail-keeps', (await page.locator('#auditTitle').count()) >= 1, 'open');
    assert('vol-audit-biz-fail-ack', await page.isChecked('#auditImpactConfirm'), 'ack');
    assert('vol-audit-biz-fail-state', await page.isChecked('input[name="auditState"][value="1"]'), 'state');
    assert('vol-audit-biz-fail-no-success', (await page.locator('.volunteer-governance-feedback.is-success').count()) === 0, 'ok');
    const lockBiz = await page.evaluate(() => {
      const vm = document.querySelector('#workspace').__vue__;
      return { saving: !!vm.auditSaving, lock: !!(window.__volunteerWriteLocks || {}).audit };
    });
    assert('vol-audit-biz-fail-lock', !lockBiz.saving && !lockBiz.lock, JSON.stringify(lockBiz));
    await page.unroute('**/api/volunteer/**/state/**').catch(() => {});

    // 500 with controlled hang
    auditPuts = [];
    let releaseAudit = null;
    const holdAudit = new Promise((r) => { releaseAudit = r; });
    let resolveAuditStarted = null;
    const auditStarted = new Promise((r) => { resolveAuditStarted = r; });
    await page.route('**/api/volunteer/**/state/**', async (route) => {
      if (route.request().method() !== 'PUT') { await route.continue(); return; }
      auditPuts.push(route.request().url());
      results.writeRequestLog.push({ scenario: 'vol-audit-500', n: auditPuts.length });
      if (resolveAuditStarted) { resolveAuditStarted({ n: auditPuts.length }); resolveAuditStarted = null; }
      await holdAudit;
      await route.fulfill(exp(500, { code: '500', msg: '审核服务异常' }));
    });
    const auditSave = await page.locator('[role="dialog"] button.is-primary').elementHandle();
    await auditSave.evaluate((el) => { el.click(); el.click(); });
    await Promise.race([auditStarted, new Promise((_, rej) => setTimeout(() => rej(new Error('audit hang timeout')), 8000))]);
    const auditInflight = await page.evaluate(() => {
      const btn = document.querySelector('[role="dialog"] button.is-primary');
      const radios = Array.from(document.querySelectorAll('input[name="auditState"]'));
      return { btnDisabled: !!(btn && btn.disabled), radiosDisabled: radios.every((r) => r.disabled), busy: btn && btn.getAttribute('aria-busy') };
    });
    // Esc must not close while saving
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);
    assert('vol-audit-esc-blocked', (await page.locator('#auditTitle').count()) >= 1, 'esc');
    recordProbe('vol-audit-inflight-500', { n: auditPuts.length, auditInflight });
    assert('vol-audit-once-inflight', auditPuts.length === 1, 'n=' + auditPuts.length);
    assert('vol-audit-inflight-disabled', auditInflight.btnDisabled && auditInflight.radiosDisabled, JSON.stringify(auditInflight));
    releaseAudit();
    await page.waitForSelector('#volunteerAuditError', { timeout: 8000 });
    assert('vol-audit-500-err', /异常|失败|服务/.test(await page.locator('#volunteerAuditError').innerText()), 'err');
    assert('vol-audit-500-ack', await page.isChecked('#auditImpactConfirm'), 'ack');
    await shot(page, '04-vol-audit-500', { page: 'volunteer', role: 'admin', viewport: '1440x900', state: 'audit-500', goal: '审核500' });
    await page.unroute('**/api/volunteer/**/state/**').catch(() => {});

    // retry success
    const auditOk = [];
    await page.route('**/api/volunteer/**/state/**', async (route) => {
      if (route.request().method() !== 'PUT') { await route.continue(); return; }
      auditOk.push(1);
      results.writeRequestLog.push({ scenario: 'vol-audit-ok' });
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ code: '0', data: true }) });
    });
    await page.locator('[role="dialog"] button.is-primary').click();
    await page.waitForTimeout(600);
    assert('vol-audit-retry-ok', auditOk.length === 1 && (await page.locator('#auditTitle').count()) === 0, 'ok');
    assert('vol-audit-ok-msg', /已更新|已通过/.test(await page.locator('.volunteer-governance-feedback').innerText().catch(() => '')), 'msg');
    await shot(page, '05-vol-success', { page: 'volunteer', role: 'admin', viewport: '1440x900', state: 'success', goal: '审核成功' });
    await page.unroute('**/api/volunteer/**/state/**').catch(() => {});

    // ========== VISIT ==========
    await page.route('**/api/visit/page**', async (route) => {
      if (route.request().method() === 'GET') await route.fulfill(pageData(VISIT_RECORDS));
      else await route.continue();
    });
    await page.goto(base + '/page/end/visit.html', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(600);
    assert('visit-title', /领养后回访|回访/.test(await page.locator('h1').innerText()), 't');
    assert('visit-metrics', (await page.locator('.visit-governance-metric').count()) >= 4, 'm');
    await shot(page, '06-visit-desktop', { page: 'visit', role: 'admin', viewport: '1440x900', state: 'list', goal: '回访桌面' });

    // export
    const exportHits = [];
    await page.route('**/api/visit/export**', async (route) => {
      exportHits.push(route.request().url());
      await route.fulfill({ status: 200, contentType: 'application/octet-stream', body: 'xlsx', headers: EH });
    });
    await page.locator('button:has-text("导出")').click();
    await page.waitForTimeout(300);
    assert('visit-export-hit', exportHits.length === 1 && /\/api\/visit\/export/.test(exportHits[0]), JSON.stringify(exportHits));
    await page.unroute('**/api/visit/export**').catch(() => {});

    // empty / invalid shapes / 500 / loadSeq
    await page.unroute('**/api/visit/page**').catch(() => {});
    await page.route('**/api/visit/page**', async (route) => {
      if (route.request().method() === 'GET') await route.fulfill(pageData([]));
      else await route.continue();
    });
    await page.locator('button:has-text("查询")').click({ force: true });
    await page.waitForTimeout(350);
    assert('visit-empty', /没有回访/.test(await page.locator('.admin-status').innerText().catch(() => '')), 'empty');

    // --- invalid structure A: data null (seed success first) ---
    await page.unroute('**/api/visit/page**').catch(() => {});
    await page.route('**/api/visit/page**', async (route) => {
      if (route.request().method() === 'GET') await route.fulfill(pageData(VISIT_RECORDS));
      else await route.continue();
    });
    await page.locator('button:has-text("查询")').click({ force: true });
    await page.waitForTimeout(350);
    assert('visit-seed-before-null', (await page.locator('text=UI_2E_VISIT_GOOD').count()) >= 1, 'seed');
    await page.unroute('**/api/visit/page**').catch(() => {});
    await page.route('**/api/visit/page**', async (route) => {
      if (route.request().method() !== 'GET') { await route.continue(); return; }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ code: '0', data: null })
      });
    });
    await page.locator('button:has-text("查询")').click({ force: true });
    await page.waitForTimeout(450);
    let visitVm = await page.evaluate(() => {
      const vm = document.querySelector('#workspace').__vue__;
      return {
        loading: !!(vm && vm.loading),
        loadError: (vm && vm.loadError) || '',
        recordsLen: vm && Array.isArray(vm.records) ? vm.records.length : -1,
        hasGood: !!(vm && Array.isArray(vm.records) && vm.records.some((r) => r.aname === 'UI_2E_VISIT_GOOD')),
        emptyCopy: !!document.querySelector('.admin-status:not(.is-error)')
      };
    });
    results.visitLoadAudit.push({ scenario: 'invalid-null', visitVm, at: new Date().toISOString() });
    const nullErrText = await page.locator('.admin-status.is-error').innerText().catch(() => '');
    assert('visit-invalid-null-error', (await page.locator('.admin-status.is-error').count()) >= 1 && !!visitVm.loadError, nullErrText || JSON.stringify(visitVm));
    assert('visit-invalid-null-not-empty-copy', !/没有回访记录/.test(nullErrText) && !(visitVm.emptyCopy && /没有回访记录/.test(await page.locator('.admin-status:not(.is-error)').innerText().catch(() => ''))), 'not empty success');
    assert('visit-invalid-null-no-stale-data', !visitVm.hasGood && visitVm.recordsLen === 0 && (await page.locator('text=UI_2E_VISIT_GOOD').count()) === 0, JSON.stringify(visitVm));
    assert('visit-invalid-null-loading-false', visitVm.loading === false, JSON.stringify(visitVm));

    // --- invalid structure B: data.records not array (seed then corrupt) ---
    await page.unroute('**/api/visit/page**').catch(() => {});
    await page.route('**/api/visit/page**', async (route) => {
      if (route.request().method() === 'GET') await route.fulfill(pageData(VISIT_RECORDS));
      else await route.continue();
    });
    await page.locator('button:has-text("查询")').click({ force: true });
    await page.waitForTimeout(350);
    assert('visit-seed-before-invalid', (await page.locator('text=UI_2E_VISIT_GOOD').count()) >= 1, 'seed');
    await page.unroute('**/api/visit/page**').catch(() => {});
    await page.route('**/api/visit/page**', async (route) => {
      if (route.request().method() !== 'GET') { await route.continue(); return; }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ code: '0', data: { records: 'not-an-array', current: 1, total: 9, pages: 1 } })
      });
    });
    await page.locator('button:has-text("查询")').click({ force: true });
    await page.waitForTimeout(450);
    visitVm = await page.evaluate(() => {
      const vm = document.querySelector('#workspace').__vue__;
      return {
        loading: !!(vm && vm.loading),
        loadError: (vm && vm.loadError) || '',
        recordsLen: vm && Array.isArray(vm.records) ? vm.records.length : -1,
        hasGood: !!(vm && Array.isArray(vm.records) && vm.records.some((r) => r.aname === 'UI_2E_VISIT_GOOD'))
      };
    });
    results.visitLoadAudit.push({ scenario: 'invalid-records', visitVm, at: new Date().toISOString() });
    assert('visit-invalid-records-error', (await page.locator('.admin-status.is-error').count()) >= 1 && !!visitVm.loadError, JSON.stringify(visitVm));
    assert('visit-invalid-no-stale-data', !visitVm.hasGood && visitVm.recordsLen === 0 && (await page.locator('text=UI_2E_VISIT_GOOD').count()) === 0, JSON.stringify(visitVm));
    assert('visit-invalid-records-loading-false', visitVm.loading === false, JSON.stringify(visitVm));

    await page.unroute('**/api/visit/page**').catch(() => {});
    await page.route('**/api/visit/page**', async (route) => {
      if (route.request().method() === 'GET') await route.fulfill(exp(500, { code: '500', msg: '回访列表异常' }));
      else await route.continue();
    });
    await page.waitForFunction(() => {
      const b = document.querySelector('form.admin-review-toolbar button[type="submit"]');
      return b && !b.disabled;
    }, { timeout: 5000 }).catch(() => {});
    await page.locator('button:has-text("查询")').click({ force: true });
    await page.waitForTimeout(400);
    assert('visit-load-500', (await page.locator('.admin-status.is-error').count()) >= 1, '500');

    // Visit loadSeq race: request#1 slow STALE, request#2 fast GOOD; release slow after fast
    let resolveSlowVisit;
    const slowVisit = new Promise((r) => { resolveSlowVisit = r; });
    let visitHit = 0;
    const visitLoadTimeline = [];
    await page.unroute('**/api/visit/page**').catch(() => {});
    await page.route('**/api/visit/page**', async (route) => {
      if (route.request().method() !== 'GET') { await route.continue(); return; }
      visitHit++;
      const n = visitHit;
      const t0 = Date.now();
      if (n === 1) {
        visitLoadTimeline.push({ n, phase: 'slow-wait', t: t0 });
        await slowVisit;
        visitLoadTimeline.push({ n, phase: 'slow-fulfill-STALE', t: Date.now() });
        await route.fulfill(pageData([{
          id: 82999, petId: 999, uid: 999, aname: 'VISIT_STALE_OLD', vtime: '2020-01-01', state: 1, vname: 'old', remark: 'stale', pic: ''
        }]));
      } else {
        visitLoadTimeline.push({ n, phase: 'fast-fulfill-GOOD', t: Date.now() });
        await route.fulfill(pageData(VISIT_RECORDS));
      }
    });
    // Concurrent loads via Vue load() (query button disabled while loading)
    await page.evaluate(() => {
      const vm = document.querySelector('#workspace').__vue__;
      vm.load(1);
      vm.load(1);
    });
    await page.waitForFunction(() => {
      const vm = document.querySelector('#workspace').__vue__;
      return vm && Array.isArray(vm.records) && vm.records.some((r) => r.aname === 'UI_2E_VISIT_GOOD') && vm.loading === false;
    }, { timeout: 8000 }).catch(() => {});
    visitLoadTimeline.push({ phase: 'fast-settled-before-slow-release', t: Date.now(), hit: visitHit });
    resolveSlowVisit();
    await page.waitForTimeout(500);
    const afterSeq = await page.evaluate(() => {
      const vm = document.querySelector('#workspace').__vue__;
      return {
        loading: !!(vm && vm.loading),
        loadError: (vm && vm.loadError) || '',
        loadSeq: vm && vm.loadSeq,
        names: (vm && Array.isArray(vm.records) ? vm.records.map((r) => r.aname) : []),
        hasStale: !!(vm && Array.isArray(vm.records) && vm.records.some((r) => r.aname === 'VISIT_STALE_OLD')),
        hasGood: !!(vm && Array.isArray(vm.records) && vm.records.some((r) => r.aname === 'UI_2E_VISIT_GOOD'))
      };
    });
    const fastIdx = visitLoadTimeline.findIndex((x) => x.phase === 'fast-fulfill-GOOD');
    const slowFulfillIdx = visitLoadTimeline.findIndex((x) => x.phase === 'slow-fulfill-STALE');
    results.visitLoadAudit.push({
      scenario: 'loadseq',
      visitHit,
      visitLoadTimeline,
      afterSeq,
      ordering: { fastBeforeSlowFulfill: fastIdx >= 0 && slowFulfillIdx >= 0 && fastIdx < slowFulfillIdx }
    });
    assert('visit-loadseq-hits', visitHit >= 2, 'hits=' + visitHit + ' timeline=' + JSON.stringify(visitLoadTimeline));
    assert('visit-loadseq-ordering', fastIdx >= 0 && slowFulfillIdx >= 0 && fastIdx < slowFulfillIdx, JSON.stringify(visitLoadTimeline));
    assert('visit-loadseq-no-stale', !afterSeq.hasStale && (await page.locator('text=VISIT_STALE_OLD').count()) === 0, JSON.stringify(afterSeq));
    assert('visit-loadseq-new-result', afterSeq.hasGood && (await page.locator('text=UI_2E_VISIT_GOOD').count()) >= 1, JSON.stringify(afterSeq));
    assert('visit-loadseq-loading-false', afterSeq.loading === false, JSON.stringify(afterSeq));
    assert('visit-loadseq-error-not-from-stale', !/stale/i.test(afterSeq.loadError || ''), afterSeq.loadError);

    await page.unroute('**/api/visit/page**').catch(() => {});
    await page.route('**/api/visit/page**', async (route) => {
      if (route.request().method() === 'GET') await route.fulfill(pageData(VISIT_RECORDS));
      else await route.continue();
    });
    await page.goto(base + '/page/end/visit.html', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(500);

    // open edit
    await page.locator('button:has-text("编辑")').first().click();
    await page.waitForTimeout(250);
    assert('visit-edit-open', (await page.locator('#visitEditTitle').count()) >= 1, 'open');
    await assertDialogFocus(page, 'visit-edit-focus', 'visit-edit');
    await assertTabCycle(page, 'visit-edit');

    // relation grid geometry
    const relGeo = await page.evaluate(() => {
      const grid = document.querySelector('.visit-relation-grid');
      if (!grid) return null;
      const kids = Array.from(grid.children);
      const cs = getComputedStyle(grid);
      const boxes = kids.map((k) => {
        const r = k.getBoundingClientRect();
        return { w: r.width, h: r.height, top: r.top };
      });
      return {
        cols: cs.gridTemplateColumns,
        n: kids.length,
        boxes,
        equalH: boxes.length === 2 && Math.abs(boxes[0].h - boxes[1].h) < 2,
        equalTop: boxes.length === 2 && Math.abs(boxes[0].top - boxes[1].top) < 2
      };
    });
    assert('visit-relation-two-cols', relGeo && relGeo.n === 2 && relGeo.equalH && relGeo.equalTop, JSON.stringify(relGeo));
    results.relationGridEvidence = relGeo;
    await shot(page, '07-visit-relation-grid', { page: 'visit', role: 'admin', viewport: '1440x900', state: 'relation', goal: '两列关系' });

    // custom file control
    const fileCtl = await page.evaluate(() => {
      const input = document.getElementById('visitImage');
      const label = document.querySelector('.visit-file-label');
      if (!input || !label) return null;
      const ics = getComputedStyle(input);
      const lcs = getComputedStyle(label);
      const r = label.getBoundingClientRect();
      const text = label.innerText || '';
      return {
        inputType: input.type,
        accept: input.accept,
        labelH: r.height,
        labelOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        hasChooseFile: /Choose File|No file chosen/i.test(text),
        hasCn: /选择回访图片|尚未选择文件/.test(text),
        appearance: ics.appearance || ics.webkitAppearance || '',
        labelDisplay: lcs.display,
        cursor: lcs.cursor
      };
    });
    assert('visit-file-custom', fileCtl && fileCtl.hasCn && !fileCtl.hasChooseFile && fileCtl.labelH >= 44, JSON.stringify(fileCtl));
    results.fileControlEvidence = fileCtl;
    await shot(page, '08-visit-file-control', { page: 'visit', role: 'admin', viewport: '1440x900', state: 'file', goal: '自定义上传' });

    // non-image
    await page.setInputFiles('#visitImage', { name: 'x.txt', mimeType: 'text/plain', buffer: Buffer.from('nope') });
    await page.waitForTimeout(200);
    assert('visit-upload-nonimage', /JPG|PNG|GIF|图片/.test(await page.locator('#visitEditError').innerText().catch(() => '')), 'type');

    // upload success with hang probe
    const uploads = [];
    let releaseUpload = null;
    const holdUpload = new Promise((r) => { releaseUpload = r; });
    let resolveUpStarted = null;
    const upStarted = new Promise((r) => { resolveUpStarted = r; });
    await page.route('**/api/files/upload', async (route) => {
      if (route.request().method() !== 'POST') { await route.continue(); return; }
      uploads.push(1);
      results.writeRequestLog.push({ scenario: 'visit-upload', n: uploads.length });
      if (resolveUpStarted) { resolveUpStarted({ n: uploads.length }); resolveUpStarted = null; }
      await holdUpload;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ code: '0', data: { flag: 'stage-aaa' } }) });
    });
    await page.setInputFiles('#visitImage', { name: 'a.png', mimeType: 'image/png', buffer: PNG1 });
    await Promise.race([upStarted, new Promise((_, rej) => setTimeout(() => rej(new Error('upload hang')), 8000))]);
    const upInflight = await page.evaluate(() => {
      const input = document.getElementById('visitImage');
      const label = document.querySelector('.visit-file-label');
      const L = window.__visitWriteLocks || {};
      return { inputDisabled: !!(input && input.disabled), lock: !!L.upload, busy: label && label.classList.contains('is-busy') };
    });
    await page.keyboard.press('Escape');
    assert('visit-upload-esc-blocked', (await page.locator('#visitEditTitle').count()) >= 1, 'esc');
    recordProbe('visit-upload-inflight', { uploads: uploads.length, upInflight });
    assert('visit-upload-once-inflight', uploads.length === 1, 'n=' + uploads.length);
    assert('visit-upload-inflight-disabled', upInflight.inputDisabled && upInflight.lock, JSON.stringify(upInflight));
    releaseUpload();
    await page.waitForTimeout(400);
    let st = await vmState(page);
    assert('visit-upload-ok-stage', st && st.stagedFlag === 'stage-aaa' && st.pic === 'stage-aaa', JSON.stringify(st));
    assert('visit-upload-preview', (await page.locator('#visitImagePreview img').count()) >= 1, 'prev');
    await page.unroute('**/api/files/upload').catch(() => {});

    // upload replace fail keeps old
    await page.route('**/api/files/upload', async (route) => {
      if (route.request().method() !== 'POST') { await route.continue(); return; }
      results.writeRequestLog.push({ scenario: 'visit-upload-fail' });
      await route.fulfill(exp(500, { code: '500', msg: '上传服务异常' }));
    });
    await page.setInputFiles('#visitImage', { name: 'b.png', mimeType: 'image/png', buffer: PNG1 });
    await page.waitForTimeout(400);
    st = await vmState(page);
    assert('visit-upload-fail-keep-stage', st && st.stagedFlag === 'stage-aaa' && st.pic === 'stage-aaa', JSON.stringify(st));
    assert('visit-upload-fail-preview', (await page.locator('#visitImagePreview img').count()) >= 1, 'prev');
    await shot(page, '09-visit-upload-fail', { page: 'visit', role: 'admin', viewport: '1440x900', state: 'upload-fail', goal: '上传失败保留' });
    await page.unroute('**/api/files/upload').catch(() => {});

    // upload replace success retires old once
    const stagedDelBefore = results.writeRequestLog.filter((x) => x.scenario === 'staged-delete').length;
    await page.route('**/api/files/upload', async (route) => {
      if (route.request().method() !== 'POST') { await route.continue(); return; }
      results.writeRequestLog.push({ scenario: 'visit-upload-replace' });
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ code: '0', data: { flag: 'stage-bbb' } }) });
    });
    await page.setInputFiles('#visitImage', { name: 'c.png', mimeType: 'image/png', buffer: PNG1 });
    await page.waitForTimeout(500);
    st = await vmState(page);
    const stagedDelAfter = results.writeRequestLog.filter((x) => x.scenario === 'staged-delete' && /stage-aaa/.test(x.url || '')).length;
    assert('visit-upload-replace-stage', st && st.stagedFlag === 'stage-bbb' && st.pic === 'stage-bbb', JSON.stringify(st));
    assert('visit-upload-replace-retire-once', stagedDelAfter === 1, 'dels=' + stagedDelAfter + ' before=' + stagedDelBefore);
    await page.unroute('**/api/files/upload').catch(() => {});

    // save 409 keeps stage, no staged delete
    await page.fill('#visitName', 'UI2E_REC_A');
    await page.selectOption('#visitScore', '4');
    const stagedBefore409 = results.writeRequestLog.filter((x) => x.scenario === 'staged-delete').length;
    const saves = [];
    let releaseSave = null;
    const holdSave = new Promise((r) => { releaseSave = r; });
    let resolveSaveStarted = null;
    const saveStarted = new Promise((r) => { resolveSaveStarted = r; });
    await page.route('**/api/visit', async (route) => {
      if (route.request().method() !== 'PUT') { await route.continue(); return; }
      const body = route.request().postDataJSON();
      saves.push(body);
      results.writeRequestLog.push({ scenario: 'visit-save-409', body, n: saves.length });
      if (resolveSaveStarted) { resolveSaveStarted({ n: saves.length }); resolveSaveStarted = null; }
      await holdSave;
      await route.fulfill(exp(409, { code: '409', msg: '保存冲突，请刷新后重试。' }));
    });
    const saveBtn = await page.locator('form.admin-edit-form button[type="submit"]').elementHandle();
    await saveBtn.evaluate((el) => { el.click(); el.click(); });
    await Promise.race([saveStarted, new Promise((_, rej) => setTimeout(() => rej(new Error('save hang')), 8000))]);
    const saveInflight = await page.evaluate(() => {
      const btn = document.querySelector('form.admin-edit-form button[type="submit"]');
      const date = document.getElementById('visitDate');
      const L = window.__visitWriteLocks || {};
      return { btnDisabled: !!(btn && btn.disabled), dateDisabled: !!(date && date.disabled), lock: !!L.save, busy: btn && btn.getAttribute('aria-busy') };
    });
    await page.keyboard.press('Escape');
    assert('visit-save-esc-blocked', (await page.locator('#visitEditTitle').count()) >= 1, 'esc');
    // backdrop click blocked
    await page.locator('.admin-dialog-backdrop').first().click({ position: { x: 5, y: 5 }, force: true }).catch(() => {});
    await page.waitForTimeout(80);
    assert('visit-save-backdrop-blocked', (await page.locator('#visitEditTitle').count()) >= 1, 'bg');
    recordProbe('visit-save-inflight-409', { saves: saves.length, saveInflight });
    assert('visit-save-once-inflight', saves.length === 1, 'n=' + saves.length);
    assert('visit-save-inflight-disabled', saveInflight.btnDisabled && saveInflight.dateDisabled && saveInflight.lock, JSON.stringify(saveInflight));
    releaseSave();
    await page.waitForSelector('#visitEditError', { timeout: 8000 });
    st = await vmState(page);
    const stagedAfter409 = results.writeRequestLog.filter((x) => x.scenario === 'staged-delete').length;
    results.stagedLifecycleAudit.push({ scenario: 'save-409', stagedFlag: st.stagedFlag, pic: st.pic, stagedDeletes: stagedAfter409 - stagedBefore409, payloadPic: saves[0] && saves[0].pic });
    assert('visit-409-keep-stage', st.stagedFlag === 'stage-bbb' && st.pic === 'stage-bbb', JSON.stringify(st));
    assert('visit-409-no-stage-delete', stagedAfter409 === stagedBefore409, 'dels ' + stagedBefore409 + '->' + stagedAfter409);
    assert('visit-409-keep-input', (await page.locator('#visitName').inputValue()) === 'UI2E_REC_A', 'input');
    assert('visit-409-preview', (await page.locator('#visitImagePreview img').count()) >= 1, 'prev');
    assert('visit-409-payload-pic', saves[0] && saves[0].pic === 'stage-bbb', JSON.stringify(saves[0]));
    await shot(page, '10-visit-409-keep-pic', { page: 'visit', role: 'admin', viewport: '1440x900', state: 'save-409', goal: '409保留图片' });
    await page.unroute('**/api/visit').catch(() => {});

    // retry success without re-upload
    const savesOk = [];
    await page.route('**/api/visit', async (route) => {
      if (route.request().method() !== 'PUT') { await route.continue(); return; }
      const body = route.request().postDataJSON();
      savesOk.push(body);
      results.writeRequestLog.push({ scenario: 'visit-save-retry-ok', body });
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ code: '0', data: true }) });
    });
    const stagedBeforeRetry = results.writeRequestLog.filter((x) => x.scenario === 'staged-delete').length;
    await page.locator('form.admin-edit-form button[type="submit"]').click();
    await page.waitForTimeout(600);
    st = await vmState(page);
    const stagedAfterRetry = results.writeRequestLog.filter((x) => x.scenario === 'staged-delete').length;
    results.stagedLifecycleAudit.push({ scenario: 'save-retry-ok', stagedFlag: st.stagedFlag, pic: st.pic, stagedDeletes: stagedAfterRetry - stagedBeforeRetry, payloadPic: savesOk[0] && savesOk[0].pic });
    assert('visit-retry-ok-once', savesOk.length === 1, 'n=' + savesOk.length);
    assert('visit-retry-pic-same', savesOk[0] && savesOk[0].pic === 'stage-bbb', JSON.stringify(savesOk[0]));
    assert('visit-retry-no-stage-delete', stagedAfterRetry === stagedBeforeRetry, 'dels');
    assert('visit-retry-stage-cleared', st && st.stagedFlag === '' && !st.editOpen, JSON.stringify(st));
    assert('visit-retry-msg', /已保存/.test(await page.locator('.visit-governance-feedback').innerText().catch(() => '')), 'msg');
    await page.unroute('**/api/visit').catch(() => {});

    // reopen for biz fail / 500 keep stage + remove/cancel retire once
    await page.locator('button:has-text("编辑")').first().click();
    await page.waitForTimeout(200);
    await page.route('**/api/files/upload', async (route) => {
      if (route.request().method() !== 'POST') { await route.continue(); return; }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ code: '0', data: { flag: 'stage-ccc' } }) });
    });
    await page.setInputFiles('#visitImage', { name: 'd.png', mimeType: 'image/png', buffer: PNG1 });
    await page.waitForTimeout(400);
    await page.unroute('**/api/files/upload').catch(() => {});
    await page.fill('#visitName', 'UI2E_REC_B');

    // business fail keep
    await page.route('**/api/visit', async (route) => {
      if (route.request().method() !== 'PUT') { await route.continue(); return; }
      results.writeRequestLog.push({ scenario: 'visit-save-biz-fail' });
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ code: '1', msg: '业务拒绝保存' }) });
    });
    const stagedBizBefore = results.writeRequestLog.filter((x) => x.scenario === 'staged-delete').length;
    await page.locator('form.admin-edit-form button[type="submit"]').click();
    await page.waitForTimeout(450);
    st = await vmState(page);
    const stagedBizAfter = results.writeRequestLog.filter((x) => x.scenario === 'staged-delete').length;
    results.stagedLifecycleAudit.push({ scenario: 'save-biz-fail', stagedFlag: st.stagedFlag, pic: st.pic, stagedDeletes: stagedBizAfter - stagedBizBefore });
    assert('visit-biz-fail-keep-stage', st.stagedFlag === 'stage-ccc' && st.pic === 'stage-ccc', JSON.stringify(st));
    assert('visit-biz-fail-no-delete', stagedBizAfter === stagedBizBefore, 'dels');
    await page.unroute('**/api/visit').catch(() => {});

    // 500 keep + retry ok
    await page.route('**/api/visit', async (route) => {
      if (route.request().method() !== 'PUT') { await route.continue(); return; }
      results.writeRequestLog.push({ scenario: 'visit-save-500' });
      await route.fulfill(exp(500, { code: '500', msg: '保存服务异常' }));
    });
    const staged500Before = results.writeRequestLog.filter((x) => x.scenario === 'staged-delete').length;
    await page.locator('form.admin-edit-form button[type="submit"]').click();
    await page.waitForTimeout(450);
    st = await vmState(page);
    const staged500After = results.writeRequestLog.filter((x) => x.scenario === 'staged-delete').length;
    results.stagedLifecycleAudit.push({ scenario: 'save-500', stagedFlag: st.stagedFlag, pic: st.pic, stagedDeletes: staged500After - staged500Before });
    assert('visit-500-keep-stage', st.stagedFlag === 'stage-ccc' && st.pic === 'stage-ccc', JSON.stringify(st));
    assert('visit-500-no-delete', staged500After === staged500Before, 'dels');
    await page.unroute('**/api/visit').catch(() => {});

    await page.route('**/api/visit', async (route) => {
      if (route.request().method() !== 'PUT') { await route.continue(); return; }
      const body = route.request().postDataJSON();
      results.writeRequestLog.push({ scenario: 'visit-save-500-retry', body });
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ code: '0', data: true }) });
    });
    await page.locator('form.admin-edit-form button[type="submit"]').click();
    await page.waitForTimeout(550);
    assert('visit-500-retry-ok', (await page.locator('#visitEditTitle').count()) === 0, 'closed');
    await page.unroute('**/api/visit').catch(() => {});

    // removeImage once
    await page.locator('button:has-text("编辑")').first().click();
    await page.waitForTimeout(200);
    await page.route('**/api/files/upload', async (route) => {
      if (route.request().method() !== 'POST') { await route.continue(); return; }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ code: '0', data: { flag: 'stage-ddd' } }) });
    });
    await page.setInputFiles('#visitImage', { name: 'e.png', mimeType: 'image/png', buffer: PNG1 });
    await page.waitForTimeout(400);
    await page.unroute('**/api/files/upload').catch(() => {});
    const delBeforeRemove = results.writeRequestLog.filter((x) => x.scenario === 'staged-delete' && /stage-ddd/.test(x.url || '')).length;
    await page.locator('button:has-text("移除图片")').click();
    await page.waitForTimeout(250);
    await page.locator('button:has-text("移除图片")').click({ trial: true }).catch(() => {});
    st = await vmState(page);
    const delAfterRemove = results.writeRequestLog.filter((x) => x.scenario === 'staged-delete' && /stage-ddd/.test(x.url || '')).length;
    assert('visit-remove-once', delAfterRemove - delBeforeRemove === 1, 'dels=' + (delAfterRemove - delBeforeRemove));
    assert('visit-remove-cleared', st && !st.pic && !st.stagedFlag, JSON.stringify(st));

    // cancel retires once
    await page.route('**/api/files/upload', async (route) => {
      if (route.request().method() !== 'POST') { await route.continue(); return; }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ code: '0', data: { flag: 'stage-eee' } }) });
    });
    await page.setInputFiles('#visitImage', { name: 'f.png', mimeType: 'image/png', buffer: PNG1 });
    await page.waitForTimeout(400);
    await page.unroute('**/api/files/upload').catch(() => {});
    const delBeforeCancel = results.writeRequestLog.filter((x) => x.scenario === 'staged-delete' && /stage-eee/.test(x.url || '')).length;
    await page.locator('[role="dialog"] button:has-text("取消")').click();
    await page.waitForTimeout(300);
    const delAfterCancel = results.writeRequestLog.filter((x) => x.scenario === 'staged-delete' && /stage-eee/.test(x.url || '')).length;
    assert('visit-cancel-retire-once', delAfterCancel - delBeforeCancel === 1, 'dels=' + (delAfterCancel - delBeforeCancel));
    assert('visit-cancel-closed', (await page.locator('#visitEditTitle').count()) === 0, 'closed');

    // delete 500 hang
    const delBtn = page.locator('button:has-text("删除")').first();
    const delH = await delBtn.elementHandle();
    await delBtn.click();
    await page.waitForTimeout(200);
    await assertDialogFocus(page, 'visit-del-focus', 'visit-del');
    await assertTabCycle(page, 'visit-del');
    await shot(page, '11-visit-delete', { page: 'visit', role: 'admin', viewport: '1440x900', state: 'delete', goal: '删除' });
    const dels = [];
    let releaseDel = null;
    const holdDel = new Promise((r) => { releaseDel = r; });
    let resolveDelStarted = null;
    const delStarted = new Promise((r) => { resolveDelStarted = r; });
    await page.route('**/api/visit/**', async (route) => {
      if (route.request().method() !== 'DELETE') { await route.continue(); return; }
      dels.push(route.request().url());
      results.writeRequestLog.push({ scenario: 'visit-del-500', n: dels.length });
      if (resolveDelStarted) { resolveDelStarted({ n: dels.length }); resolveDelStarted = null; }
      await holdDel;
      await route.fulfill(exp(500, { code: '500', msg: '删除服务异常' }));
    });
    const conf = await page.locator('[role="alertdialog"] button.is-danger-solid').elementHandle();
    await conf.evaluate((el) => { el.click(); el.click(); });
    await Promise.race([delStarted, new Promise((_, rej) => setTimeout(() => rej(new Error('del hang')), 8000))]);
    const delInflight = await page.evaluate(() => {
      const b = document.querySelector('[role="alertdialog"] button.is-danger-solid');
      const c = document.querySelector('[role="alertdialog"] button.is-ghost');
      const L = window.__visitWriteLocks || {};
      return { conf: !!(b && b.disabled), cancel: !!(c && c.disabled), lock: !!L.del };
    });
    await page.keyboard.press('Escape');
    assert('visit-del-esc-blocked', (await page.locator('#visitDeleteTitle').count()) >= 1, 'esc');
    recordProbe('visit-del-inflight-500', { dels: dels.length, delInflight });
    assert('visit-del-once-inflight', dels.length === 1, 'n=' + dels.length);
    assert('visit-del-inflight-disabled', delInflight.conf && delInflight.cancel && delInflight.lock, JSON.stringify(delInflight));
    releaseDel();
    await page.waitForSelector('#visitDeleteError', { timeout: 8000 });
    assert('visit-del-500-err', /异常|失败|服务/.test(await page.locator('#visitDeleteError').innerText()), 'err');
    await shot(page, '12-visit-del-500', { page: 'visit', role: 'admin', viewport: '1440x900', state: 'del-500', goal: '删除500' });
    await page.unroute('**/api/visit/**').catch(() => {});
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    const exactDel = delH ? await page.evaluate((el) => document.activeElement === el, delH) : false;
    assert('visit-del-esc-exact', exactDel, 'focus');

    // mobile / 320 / 720
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(base + '/page/end/volunteer.html', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(400);
    assert('vol-mobile', await page.locator('.admin-volunteer-card').first().isVisible(), 'card');
    await shot(page, '13-vol-mobile', { page: 'volunteer', role: 'admin', viewport: '390x844', state: 'mobile', goal: '义工移动' });
    await page.setViewportSize({ width: 320, height: 700 });
    await clickVisible(page, '.admin-volunteer-card button:has-text("审核"), button:has-text("审核")');
    await page.waitForTimeout(200);
    assert('vol-320-audit', dialogFocusOk(await inspectFocus(page)), 'f');
    await shot(page, '14-vol-audit-320', { page: 'volunteer', role: 'admin', viewport: '320x700', state: 'audit-320', goal: '320审核' });
    await page.keyboard.press('Escape');

    await page.route('**/api/visit/page**', async (route) => {
      if (route.request().method() === 'GET') await route.fulfill(pageData(VISIT_RECORDS));
      else await route.continue();
    });
    await page.goto(base + '/page/end/visit.html', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(400);
    await shot(page, '15-visit-mobile', { page: 'visit', role: 'admin', viewport: '390x844', state: 'mobile', goal: '回访移动' });
    await page.setViewportSize({ width: 320, height: 700 });
    await clickVisible(page, 'button:has-text("编辑")');
    await page.waitForTimeout(200);
    const file320 = await page.evaluate(() => {
      const label = document.querySelector('.visit-file-label');
      if (!label) return null;
      const r = label.getBoundingClientRect();
      return { h: r.height, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth, text: label.innerText };
    });
    assert('visit-320-file', file320 && file320.h >= 44 && file320.overflow <= 2 && !/Choose File/i.test(file320.text), JSON.stringify(file320));
    await shot(page, '16-visit-file-320', { page: 'visit', role: 'admin', viewport: '320x700', state: 'file-320', goal: '320上传' });
    await page.keyboard.press('Escape');
    await clickVisible(page, 'button:has-text("删除")');
    await page.waitForTimeout(150);
    await shot(page, '17-visit-del-320', { page: 'visit', role: 'admin', viewport: '320x700', state: 'del-320', goal: '320删除' });
    await page.keyboard.press('Escape');

    await page.setViewportSize({ width: 720, height: 450 });
    await page.goto(base + '/page/end/visit.html', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(300);
    await clickVisible(page, 'button:has-text("编辑")');
    await page.waitForTimeout(200);
    const lowH = await page.evaluate(() => {
      const btn = document.querySelector('form.admin-edit-form button[type="submit"]');
      if (!btn) return null;
      btn.scrollIntoView({ block: 'nearest' });
      const r = btn.getBoundingClientRect();
      return { visible: r.bottom > 0 && r.top < window.innerHeight, h: r.height };
    });
    assert('visit-720x450-actions', lowH && lowH.visible && lowH.h >= 36, JSON.stringify(lowH));
    await page.keyboard.press('Escape');

    // viewport matrix
    for (const vp of VIEWPORTS) {
      for (const pg of ['volunteer', 'visit']) {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        if (pg === 'volunteer') {
          await page.route('**/api/volunteer/page**', async (route) => {
            if (route.request().method() === 'GET') await route.fulfill(pageData(VOL_RECORDS));
            else await route.continue();
          });
        } else {
          await page.route('**/api/visit/page**', async (route) => {
            if (route.request().method() === 'GET') await route.fulfill(pageData(VISIT_RECORDS));
            else await route.continue();
          });
        }
        await page.goto(base + '/page/end/' + pg + '.html', { waitUntil: 'domcontentloaded', timeout: 45000 });
        await page.waitForTimeout(160);
        const m = await page.evaluate(() => ({
          h1: !!document.querySelector('h1'),
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
        }));
        assert('vp-' + pg + '-' + vp.name, m.h1 && m.overflow <= 2, JSON.stringify(m));
      }
    }

    // permissions — register real RBAC outcomes (no audit header from server)
    {
      const a = await browser.newContext();
      await login(a, 'admin', 'admin');
      const apiV = await a.request.get(base + '/api/volunteer/page');
      const apiT = await a.request.get(base + '/api/visit/page?pageNum=1&pageSize=1');
      assert('admin-apis-ok', apiV.status() === 200 && apiT.status() === 200, apiV.status() + '/' + apiT.status());
      results.permissionMatrix.admin = { real: true, ok: true };
      await a.close();
    }
    {
      const j = await browser.newContext();
      await login(j, 'jerry', '123456');
      registerExpectedHttp('jerry-vol-api', 'GET', /\/api\/volunteer\/page/, 403);
      registerExpectedHttp('jerry-visit-api', 'GET', /\/api\/visit\/page/, 403);
      registerExpectedHttp('jerry-vol-api-401', 'GET', /\/api\/volunteer\/page/, 401);
      registerExpectedHttp('jerry-visit-api-401', 'GET', /\/api\/visit\/page/, 401);
      const p = await j.newPage();
      await p.goto(base + '/page/end/volunteer.html', { waitUntil: 'domcontentloaded', timeout: 45000 });
      await p.waitForTimeout(350);
      const apiV = await j.request.get(base + '/api/volunteer/page');
      await p.goto(base + '/page/end/visit.html', { waitUntil: 'domcontentloaded', timeout: 45000 });
      await p.waitForTimeout(350);
      const apiT = await j.request.get(base + '/api/visit/page?pageNum=1&pageSize=1');
      assert('jerry-denied', apiV.status() === 403 || apiV.status() === 401 || /forbidden|login|error=/.test(p.url()), apiV.status());
      assert('jerry-visit-denied', apiT.status() === 403 || apiT.status() === 401 || /forbidden|login|error=/.test(p.url()), apiT.status());
      results.permissionMatrix.jerry = { real: true, volApi: apiV.status(), visitApi: apiT.status() };
      await j.close();
    }
    {
      const a = await browser.newContext();
      registerExpectedHttp('anon-visit-api', 'GET', /\/api\/visit\/page/, 401);
      registerExpectedHttp('anon-vol-api', 'GET', /\/api\/volunteer\/page/, 401);
      const p = await a.newPage();
      await p.goto(base + '/page/end/visit.html', { waitUntil: 'domcontentloaded', timeout: 45000 });
      await p.waitForTimeout(300);
      assert('anon-login', /login/i.test(p.url()), p.url());
      results.permissionMatrix.anonymous = { real: true };
      await a.close();
    }

    // ——— Error classifier unit + mutation self-tests (no browser) ———
    // Intentional only via exact audit header OR registered method+url+status.
    // No blanket 403/404/409/500 whitelist. /api/files/** 403/404 only with EH header.
    let clfPass = 0;
    function clfAssert(id, cond, d) {
      assert(id, cond, d);
      if (cond) clfPass++;
    }
    clfAssert('clf-intentional-header-500', isIntentionalHttp({
      status: 500, method: 'PUT', url: base + '/api/visit', headers: { [HDR]: VAL }
    }), 'header');
    clfAssert('clf-unexpected-500-no-header', !isIntentionalHttp({
      status: 500, method: 'PUT', url: base + '/api/visit', headers: {}
    }), 'no-header must NOT be intentional');
    clfAssert('clf-unexpected-wrong-header', !isIntentionalHttp({
      status: 500, method: 'PUT', url: base + '/api/visit', headers: { [HDR]: 'other-phase' }
    }), 'wrong val');
    clfAssert('clf-unexpected-same-status-diff-url', !isIntentionalHttp({
      status: 500, method: 'GET', url: base + '/api/other/unregistered', headers: {}
    }), 'diff url');
    clfAssert('clf-unexpected-same-status-diff-method', !isIntentionalHttp({
      status: 403, method: 'DELETE', url: base + '/api/volunteer/page', headers: {}
    }), 'diff method vs registered GET');
    clfAssert('clf-files-404-no-header-unexpected', !isIntentionalHttp({
      status: 404, method: 'GET', url: base + '/api/files/no-fixture-flag', headers: {}
    }), 'files 404 without EH must be unexpected');
    clfAssert('clf-files-404-with-header-intentional', isIntentionalHttp({
      status: 404, method: 'GET', url: base + '/api/files/no-fixture-flag', headers: { [HDR]: VAL }
    }), 'files 404 with EH intentional');
    clfAssert('clf-console-real-error', isRealConsoleError('TypeError: boom at x'), 'real');
    clfAssert('clf-console-resource-noise', !isRealConsoleError('Failed to load resource: the server responded with a status of 500 ()'), 'noise');
    clfAssert('clf-resource-noise-helper', isResourceConsoleNoise('Failed to load resource: the server responded with a status of 409 ()'), 'noise-fn');
    // Mutation: unmarked 500 injected into live classification list must land in unexpected
    const mutationSample = { status: 500, method: 'PUT', url: base + '/api/visit/mutation-probe', headers: { 'content-type': 'application/json' } };
    const mutationUnexpected = !isIntentionalHttp(mutationSample);
    clfAssert('clf-mutation-unmarked-500-unexpected', mutationUnexpected, 'mutation');
    const mutatedList = httpErrors.concat([mutationSample]);
    const mutatedUnexpected = mutatedList.filter((e) => !isIntentionalHttp(e));
    clfAssert('clf-mutation-live-list-catches-unmarked-500', mutatedUnexpected.some((e) => /mutation-probe/.test(e.url || '')), 'live-list n=' + mutatedUnexpected.length);
    // pageerror path must fail the suite (gate present; live count must be 0)
    clfAssert('clf-pageerror-gate-exists', typeof pageErrors !== 'undefined' && Array.isArray(pageErrors), 'pageErrors array');
    results.classifierMutationPassCount = clfPass;
    assert('clf-mutation-count-ge-8', clfPass >= 8, 'n=' + clfPass);

    // Live HTTP classification — header OR registry only (no status-code whitelist)
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
      expectedHttpRegistrySize: results.expectedHttpRegistry.length,
      note: 'resourceConsoleNoise is recorded separately; it does not prove all console errors were expected'
    };
    assert('no-unexpected-http', unexpected.length === 0, JSON.stringify(unexpected.slice(0, 5)));
    assert('no-pageerrors', pageErrors.length === 0, JSON.stringify(pageErrors));
    assert('no-requestfailed-write', results.requestFailedWrite.length === 0, JSON.stringify(results.requestFailedWrite));
    assert('no-real-console', realConsoleStrict.length === 0, JSON.stringify(realConsoleStrict.slice(0, 3)));
    assert('no-skipped', results.checks.every((c) => !c.skipped), 'skip');
    assert('screenshots-match', results.screenshots.length === fs.readdirSync(shotDir).filter((f) => f.endsWith('.png')).length, 'shots');
    assert('probes-ge-3', results.strictRuntimeProbeCount >= 3, 'n=' + results.strictRuntimeProbeCount);
    assert('probes-ge-prior', results.strictRuntimeProbeCount >= 4, 'n=' + results.strictRuntimeProbeCount);
    assert('zero-best-effort', results.bestEffortPassCount === 0, 'n');
    assert('zero-fallback', results.fallbackPassCount === 0, 'n');
    assert('assert-count-gt-134', results.checks.length > 134, 'n=' + results.checks.length);
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
