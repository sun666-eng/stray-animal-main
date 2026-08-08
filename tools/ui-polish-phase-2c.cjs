/**
 * Phase 2C strict acceptance repair — adopt + proof governance.
 * Baseline: 1c0a0ff · BASE_URL default http://127.0.0.1:18092
 *
 * - No pass(..., 'skipped') / best-effort green
 * - Deterministic route fixtures for pending records (no DB dependency)
 * - Real network count for writes; 409 keeps dialog + focus + Esc restore
 * - Expected errors only via x-ui-audit-expected-error: phase2c
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const base = process.env.BASE_URL || 'http://127.0.0.1:18092';
const out = path.resolve('output/playwright/ui-polish-phase-2c');
const shotDir = path.join(out, 'screenshots');
fs.mkdirSync(shotDir, { recursive: true });

const EXPECTED_ERROR_HEADER = 'x-ui-audit-expected-error';
const EXPECTED_ERROR_VALUE = 'phase2c';
const EXPECTED_ERROR_HEADERS = { [EXPECTED_ERROR_HEADER]: EXPECTED_ERROR_VALUE };

const FIXTURE_ADOPT = {
  aid: 900001,
  uid: 900002,
  aname: 'UI_AUDIT_2C_CAT',
  uname: 'UI_AUDIT_2C_USER',
  tel: '13800000000',
  vstate: 0,
  version: 7,
  gender: '女',
  age: 28,
  maritalstatus: 2,
  occupation: '设计师',
  location: '测试市测试路1号',
  fixresident: 1,
  income: 8000,
  experience: 1,
  petnum: 1,
  familyagree: 1,
  wechat: 'ui_audit_2c'
};

const FIXTURE_PROOF = {
  id: 900101,
  ptitle: 'UI_AUDIT_2C_PROOF',
  paid: 900001,
  puid: 900002,
  aname: 'UI_AUDIT_2C_CAT',
  uname: 'UI_AUDIT_2C_USER',
  pstatus: 0,
  ppic: ''
};

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
  phase2bBaseline: '1c0a0ffe0b5f5fb29759ca410c4864316ea37987',
  branch: 'ui-polish/phase-2c-adoption-governance-20260730',
  checks: [],
  failures: [],
  screenshots: [],
  focusAudit: [],
  writeRequestLog: [],
  fixtures: {
    adoptList: 'routeIntercept GET /api/adopt/page|page1',
    proofList: 'routeIntercept GET /api/proof/page',
    writes: 'routeIntercept PUT/POST (no databaseWrite unless noted)'
  },
  consoleAudit: {},
  requestFailedWrite: [],
  permissionMatrix: {},
  summary: {}
};

function pass(id, detail) {
  results.checks.push({ id, ok: true, skipped: false, detail: String(detail || '') });
}
function fail(id, detail) {
  const d = String(detail || '');
  results.checks.push({ id, ok: false, skipped: false, detail: d });
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

function pageJson(records) {
  return {
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      code: '0',
      data: { records, current: 1, total: records.length, pages: 1 }
    })
  };
}

async function login(ctx, user, pass) {
  const res = await ctx.request.post(base + '/api/user/login', {
    data: { username: user, password: pass }
  });
  const json = await res.json();
  if (json.code !== '0') throw new Error('login ' + user + ': ' + JSON.stringify(json));
  ctx._csrf = (json.data && json.data.csrfToken) || '';
  return json;
}

async function shot(page, name, meta) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(40);
  const file = path.join(shotDir, name + '.png');
  await page.screenshot({ path: file, fullPage: false });
  results.screenshots.push(Object.assign({
    file: path.relative(out, file).replace(/\\/g, '/'),
    name,
    time: new Date().toISOString(),
    simulated: false,
    routeIntercept: false,
    realNetwork: true,
    databaseWrite: false
  }, meta || {}));
}

async function pageInspectFocus(page) {
  return page.evaluate(() => {
    const el = document.activeElement;
    const dlg = document.querySelector('[role="dialog"], [role="alertdialog"]');
    return {
      exists: !!el,
      tag: el ? el.tagName : '',
      id: el ? el.id : '',
      className: el ? String(el.className || '') : '',
      connected: !!(el && el.isConnected),
      isBody: el === document.body,
      isHtml: el === document.documentElement,
      inDialog: !!(dlg && el && dlg.contains(el)),
      interactive: !!(el && el.matches(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
      )),
      explicitHeading: !!(el && /^(H1|H2)$/.test(el.tagName) && el.getAttribute('tabindex') === '-1'),
      roleAlert: !!(el && el.getAttribute && el.getAttribute('role') === 'alert')
    };
  });
}

function isStrictFocusOk(info) {
  return !!(info && info.exists && info.connected && !info.isBody && !info.isHtml &&
    (info.interactive || info.explicitHeading || info.roleAlert));
}

function recordFocus(scenario, info, extra) {
  results.focusAudit.push(Object.assign({ scenario, strictOk: isStrictFocusOk(info) }, info, extra || {}));
}

async function installAdoptListFixture(page) {
  await page.route('**/api/adopt/page**', async (route) => {
    if (route.request().method() !== 'GET') { await route.continue(); return; }
    await route.fulfill(pageJson([FIXTURE_ADOPT]));
  });
  await page.route('**/api/adopt/page1**', async (route) => {
    if (route.request().method() !== 'GET') { await route.continue(); return; }
    await route.fulfill(pageJson([FIXTURE_ADOPT]));
  });
}

async function installProofListFixture(page) {
  await page.route('**/api/proof/page**', async (route) => {
    if (route.request().method() !== 'GET') { await route.continue(); return; }
    await route.fulfill(pageJson([FIXTURE_PROOF]));
  });
}

async function measureDialogMobile(page) {
  return page.evaluate(() => {
    const dlg = document.querySelector('[role="dialog"], [role="alertdialog"]');
    if (!dlg) return null;
    const r = dlg.getBoundingClientRect();
    const actions = dlg.querySelector('.admin-dialog-actions');
    const ar = actions && actions.getBoundingClientRect();
    const btns = Array.prototype.map.call(dlg.querySelectorAll('button'), (b) => {
      const br = b.getBoundingClientRect();
      return { h: Math.round(br.height), w: Math.round(br.width), text: (b.textContent || '').trim().slice(0, 20) };
    });
    return {
      dialogW: Math.round(r.width),
      dialogOverflow: r.right > window.innerWidth + 2 || r.left < -2,
      pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      actionsVisible: !!(ar && ar.height > 0 && ar.bottom <= window.innerHeight + 4),
      minBtnH: btns.length ? Math.min.apply(null, btns.map((b) => b.h)) : 0,
      buttons: btns
    };
  });
}

function writeReport() {
  const passed = results.checks.filter((c) => c.ok).length;
  const failed = results.checks.filter((c) => !c.ok).length;
  const skipped = results.checks.filter((c) => c.skipped).length;
  results.summary = {
    passed,
    failed,
    skipped,
    total: results.checks.length,
    screenshots: results.screenshots.length,
    viewports: VIEWPORTS.length,
    finishedAt: new Date().toISOString(),
    strictMode: true,
    noBestEffortPass: true,
    noSkipPass: true
  };
  results.ok = failed === 0 && skipped === 0;
  fs.writeFileSync(path.join(out, 'phase-2c-report.json'), JSON.stringify(results, null, 2));
  fs.writeFileSync(path.join(out, 'screenshots-index.json'), JSON.stringify(results.screenshots, null, 2));
  return { passed, failed, skipped };
}

(async () => {
  console.log('Phase 2C strict repair start', base);
  const consoleErrors = [];
  const pageErrors = [];
  const httpErrors = [];
  let browser;
  try {
    const adoptHtml = fs.readFileSync('src/main/resources/static/page/end/adopt.html', 'utf8');
    const proofHtml = fs.readFileSync('src/main/resources/static/page/end/proof.html', 'utf8');
    const css = fs.readFileSync('src/main/resources/static/css/admin-workspace.css', 'utf8');

    assert('static-adopt-doc-esc', adoptHtml.includes('_onDocEsc') && adoptHtml.includes('document.addEventListener("keydown"'), 'doc esc');
    assert('static-proof-doc-esc', proofHtml.includes('_onDocEsc') && proofHtml.includes('document.addEventListener("keydown"'), 'doc esc');
    assert('static-adopt-remove-listener', adoptHtml.includes('removeEventListener("keydown", this._onDocEsc'), 'cleanup');
    assert('static-proof-remove-listener', proofHtml.includes('removeEventListener("keydown", this._onDocEsc'), 'cleanup');
    assert('static-adopt-focus-dialog-error', adoptHtml.includes('focusDialogError'), 'focus err');
    assert('static-proof-focus-dialog-error', proofHtml.includes('focusDialogError'), 'focus err');
    assert('static-adopt-no-workspace-keyup-esc', !/v-cloak\s+@keyup\.esc/.test(adoptHtml) && !adoptHtml.includes('@keyup.esc="closeTopLayer"'), 'workspace esc removed');
    assert('static-proof-no-workspace-keyup-esc', !proofHtml.includes('@keyup.esc="closeTopLayer"'), 'workspace esc removed');
    assert('static-adopt-compact-row-actions',
      adoptHtml.includes('class="admin-row-actions" aria-label="领养申请操作"')
        && !adoptHtml.includes('class="admin-row-actions adopt-governance-actions"')
        && !adoptHtml.includes('class="is-group-label"'),
      'desktop actions must retain the compact pre-Phase-1 row layout');
    assert('static-adopt-cache-0808c', adoptHtml.includes('admin-workspace.css?v=20260808c'), 'cache');
    assert('static-proof-cache-30d', proofHtml.includes('admin-workspace.css?v=20260730d'), 'cache');
    assert('static-adopt-command-desk', adoptHtml.includes('adopt-governance-main') && adoptHtml.includes('adopt-governance-queue'), 'command desk');
    assert('static-adopt-status-key', adoptHtml.includes('adopt-governance-status-key'), 'status key');
    assert('static-css-governance', css.includes('.adopt-governance-hero') && css.includes('.proof-governance-hero'), 'css');

    browser = await chromium.launch({ headless: true });
    const adminCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await login(adminCtx, 'admin', 'admin');
    const page = await adminCtx.newPage();
    const cssRequests = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
    page.on('requestfailed', (req) => {
      const method = req.method();
      if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
        results.requestFailedWrite.push({ method, url: req.url(), failure: req.failure() && req.failure().errorText });
      }
    });
    page.on('response', (r) => {
      if (r.status() >= 400) {
        httpErrors.push({ status: r.status(), url: r.url(), method: r.request().method(), headers: r.headers() });
      }
    });
    page.on('request', (req) => {
      if (/admin-workspace\.css/i.test(req.url())) cssRequests.push(req.url());
    });

    // ——— Adopt with fixture ———
    await installAdoptListFixture(page);
    await page.goto(base + '/page/end/adopt.html', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(800);
    assert('adopt-fixture-row', (await page.locator('text=UI_AUDIT_2C_CAT').count()) >= 1, 'fixture missing');
    assert('adopt-network-css-0808c', cssRequests.some((u) => /v=20260808c/.test(u)), JSON.stringify(cssRequests.slice(-3)));
    assert('adopt-command-desk-mounted', await page.locator('.adopt-governance-main .adopt-governance-queue').count() === 1, 'queue');
    assert('adopt-metrics-integrated', await page.locator('.adopt-governance-hero > .adopt-governance-metrics').count() === 1, 'metrics');
    assert('adopt-status-key-mounted', await page.locator('.adopt-governance-status-key').count() === 1, 'status key');
    const fixtureRowBox = await page.locator('.admin-adopt-table tbody tr').first().boundingBox();
    assert('adopt-desktop-row-is-compact', !!fixtureRowBox && fixtureRowBox.height <= 96,
      fixtureRowBox ? `height=${fixtureRowBox.height}` : 'row missing');
    assert('adopt-desktop-actions-have-no-group-headings',
      await page.locator('.admin-adopt-table .is-group-label').count() === 0,
      'group headings reintroduced');
    await shot(page, '01-adopt-desktop', { page: 'adopt', role: 'admin', viewport: '1440x900', state: 'fixture-list', goal: '领养桌面 fixture', routeIntercept: true });

    // Mode switch no request
    let listGets = 0;
    page.on('request', (req) => {
      if (req.method() === 'GET' && /\/api\/adopt\/page/.test(req.url())) listGets += 1;
    });
    const before = listGets;
    await page.locator('.adopt-governance-search-mode button:has-text("按申请人")').click();
    await page.waitForTimeout(150);
    assert('adopt-mode-no-autoload', listGets === before, 'gets=' + listGets);

    // ——— Questionnaire 409 + Esc exact focus ———
    const editBtn = page.locator('button:has-text("编辑问卷")').first();
    assert('adopt-edit-btn-present', (await editBtn.count()) >= 1, 'missing 编辑问卷');
    const editHandle = await editBtn.elementHandle();
    assert('adopt-edit-handle', !!editHandle, 'no handle');
    await editBtn.click();
    await page.waitForTimeout(300);
    assert('adopt-edit-dialog-open', (await page.locator('[role="dialog"][aria-labelledby="adoptQuestionnaireTitle"]').count()) >= 1
      || (await page.locator('#adoptQuestionnaireTitle').count()) >= 1, 'dialog');
    assert('adopt-edit-groups', (await page.locator('.adopt-governance-form-group').count()) >= 4, 'groups');
    assert('adopt-edit-readonly-ctx', (await page.locator('.adopt-governance-context').count()) >= 1, 'ctx');
    await page.fill('#adoptEditOccupation', '审计测试职业');
    await shot(page, '02-adopt-questionnaire-desktop', { page: 'adopt', role: 'admin', viewport: '1440x900', state: 'questionnaire', goal: '问卷桌面', routeIntercept: true });

    const putBodies = [];
    await page.route(new RegExp('/api/adopt/' + FIXTURE_ADOPT.aid + '/' + FIXTURE_ADOPT.uid + '$'), async (route) => {
      if (route.request().method() !== 'PUT') { await route.continue(); return; }
      let body = {};
      try { body = route.request().postDataJSON() || {}; } catch (e) { body = {}; }
      putBodies.push(body);
      results.writeRequestLog.push({ scenario: 'adopt-save-409', method: 'PUT', url: route.request().url(), body });
      await new Promise((r) => setTimeout(r, 450));
      await route.fulfill(expectedErrorFulfill(409, { code: '409', msg: '记录已被其他人修改，请刷新后重试。' }));
    });
    const saveBtn = page.locator('[role="dialog"] button:has-text("保存问卷")').first();
    const saveHandle = await saveBtn.elementHandle();
    assert('adopt-save-btn', !!saveHandle, 'no save');
    await saveHandle.evaluate((el) => { el.click(); el.click(); });
    await page.waitForTimeout(900);
    assert('adopt-save-once', putBodies.length === 1, 'puts=' + putBodies.length);
    const forbidden = ['aid', 'uid', 'vstate', 'auditor', 'auditTime', 'audit_time', 'checker'];
    const bodyKeys = Object.keys(putBodies[0] || {});
    assert('adopt-save-payload-no-identity', !forbidden.some((k) => bodyKeys.indexOf(k) >= 0), JSON.stringify(bodyKeys));
    assert('adopt-409-keeps-dialog', (await page.locator('[role="dialog"]').count()) >= 1, 'closed');
    assert('adopt-409-keeps-input', (await page.inputValue('#adoptEditOccupation')) === '审计测试职业', 'lost input');
    const err409 = await page.locator('#adoptEditFormError').innerText().catch(() => '');
    assert('adopt-409-error-msg', /冲突|修改|刷新|409/.test(err409) || /冲突|修改|刷新/.test(await page.locator('[role="dialog"]').innerText()), err409);
    assert('adopt-409-no-success', (await page.locator('.adopt-governance-feedback.is-success').count()) === 0, 'success shown');
    const lockAfter = await page.evaluate(() => {
      const vm = document.querySelector('#workspace').__vue__;
      const L = window.__adoptWriteLocks || {};
      return { saving: !!(vm && vm.saving), save: !!L.save };
    });
    assert('adopt-409-lock-released', !lockAfter.saving && !lockAfter.save, JSON.stringify(lockAfter));
    const focus409 = await pageInspectFocus(page);
    recordFocus('adopt-save-409', focus409, { exactTrigger: false, listRefreshed: false });
    assert('adopt-409-focus-not-body', !focus409.isBody && !focus409.isHtml, JSON.stringify(focus409));
    assert('adopt-409-focus-in-dialog', focus409.inDialog || focus409.roleAlert, JSON.stringify(focus409));
    await shot(page, '03-adopt-questionnaire-409', { page: 'adopt', role: 'admin', viewport: '1440x900', state: 'save-409', goal: '问卷409', routeIntercept: true });

    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
    assert('adopt-esc-closes-edit', (await page.locator('#adoptQuestionnaireTitle').count()) === 0
      && (await page.locator('[role="dialog"]').count()) === 0, 'still open');
    const focusEsc = await pageInspectFocus(page);
    const exactEdit = editHandle
      ? await page.evaluate((el) => document.activeElement === el, editHandle)
      : false;
    recordFocus('adopt-edit-esc-restore', focusEsc, { exactTrigger: exactEdit, listRefreshed: false });
    assert('adopt-esc-focus-exact-edit', exactEdit && isStrictFocusOk(focusEsc), JSON.stringify({ exactEdit, focusEsc }));
    await page.unroute(new RegExp('/api/adopt/' + FIXTURE_ADOPT.aid + '/' + FIXTURE_ADOPT.uid + '$')).catch(() => {});

    // Success path questionnaire (route success, no DB)
    await editBtn.click();
    await page.waitForTimeout(250);
    const successPuts = [];
    await page.route(new RegExp('/api/adopt/' + FIXTURE_ADOPT.aid + '/' + FIXTURE_ADOPT.uid + '$'), async (route) => {
      if (route.request().method() !== 'PUT') { await route.continue(); return; }
      successPuts.push(route.request().postDataJSON());
      results.writeRequestLog.push({ scenario: 'adopt-save-success', method: 'PUT', url: route.request().url() });
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ code: '0', data: true }) });
    });
    await page.locator('[role="dialog"] button:has-text("保存问卷")').click();
    await page.waitForFunction(() => {
      const vm = document.querySelector('#workspace') && document.querySelector('#workspace').__vue__;
      return vm && !vm.editOpen && /问卷已保存|已保存/.test(vm.message || '');
    }, { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(100);
    assert('adopt-success-once', successPuts.length === 1, 'n=' + successPuts.length);
    assert('adopt-success-dialog-closed', (await page.locator('#adoptQuestionnaireTitle').count()) === 0, 'open');
    assert('adopt-success-feedback', /问卷已保存|已保存/.test(await page.locator('.adopt-governance-feedback').innerText().catch(() => '')), 'msg');
    const focusOk = await pageInspectFocus(page);
    recordFocus('adopt-save-success', focusOk, { exactTrigger: false, listRefreshed: true });
    assert('adopt-success-focus-actionable', isStrictFocusOk(focusOk), JSON.stringify(focusOk));
    await shot(page, '04-adopt-save-success', { page: 'adopt', role: 'admin', viewport: '1440x900', state: 'save-success', goal: '问卷成功', routeIntercept: true });
    await page.unroute(new RegExp('/api/adopt/' + FIXTURE_ADOPT.aid + '/' + FIXTURE_ADOPT.uid + '$')).catch(() => {});

    // ——— Transition 409 ———
    const approveBtn = page.locator('button:has-text("通过并预留")').first();
    assert('adopt-approve-btn-present', (await approveBtn.count()) >= 1, 'missing 通过并预留');
    const approveHandle = await approveBtn.elementHandle();
    await approveBtn.click();
    await page.waitForTimeout(250);
    assert('adopt-action-dialog', (await page.locator('[role="alertdialog"][aria-labelledby="adoptActionTitle"]').count()) >= 1
      || (await page.locator('#adoptActionTitle').count()) >= 1, 'dialog');
    const actionTitle = await page.locator('#adoptActionTitle').innerText();
    assert('adopt-action-title-names', /UI_AUDIT_2C_USER/.test(actionTitle) && /UI_AUDIT_2C_CAT/.test(actionTitle), actionTitle);
    await shot(page, '05-adopt-transition-confirm', { page: 'adopt', role: 'admin', viewport: '1440x900', state: 'transition-confirm', goal: '状态确认', routeIntercept: true });

    const transitions = [];
    await page.route('**/api/adopt/**/transition', async (route) => {
      if (route.request().method() !== 'POST') { await route.continue(); return; }
      const body = route.request().postDataJSON();
      transitions.push(body);
      results.writeRequestLog.push({ scenario: 'adopt-transition-409', method: 'POST', body });
      await new Promise((r) => setTimeout(r, 450));
      await route.fulfill(expectedErrorFulfill(409, { code: '409', msg: '状态已变化（冲突），请重新核对后重试。' }));
    });
    const conf = page.locator('[role="alertdialog"] button:has-text("确认执行")').first();
    const confH = await conf.elementHandle();
    assert('adopt-confirm-btn', !!confH, 'no confirm');
    await confH.evaluate((el) => { el.click(); el.click(); });
    await page.waitForTimeout(900);
    assert('adopt-transition-once', transitions.length === 1, 'n=' + transitions.length);
    assert('adopt-transition-action', transitions[0] && transitions[0].action === 'APPROVE', JSON.stringify(transitions[0]));
    assert('adopt-transition-expected-version', transitions[0] && Number(transitions[0].expectedVersion) === 7, JSON.stringify(transitions[0]));
    assert('adopt-transition-409-keeps', (await page.locator('#adoptActionTitle').count()) >= 1, 'closed');
    const actionErr = await page.locator('#adoptActionError').innerText().catch(() => '');
    assert('adopt-transition-409-error', /冲突|变化|核对/.test(actionErr), actionErr);
    assert('adopt-transition-409-no-success', (await page.locator('.adopt-governance-feedback.is-success').count()) === 0, 'success');
    const tLock = await page.evaluate(() => {
      const vm = document.querySelector('#workspace').__vue__;
      const L = window.__adoptWriteLocks || {};
      return { transitioning: !!(vm && vm.transitioning), lock: !!L.transition };
    });
    assert('adopt-transition-lock-released', !tLock.transitioning && !tLock.lock, JSON.stringify(tLock));
    const tFocus = await pageInspectFocus(page);
    recordFocus('adopt-transition-409', tFocus, {});
    assert('adopt-transition-409-focus-in-dialog', tFocus.inDialog || tFocus.roleAlert, JSON.stringify(tFocus));
    await shot(page, '06-adopt-transition-409', { page: 'adopt', role: 'admin', viewport: '1440x900', state: 'transition-409', goal: '流转409', routeIntercept: true });

    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
    assert('adopt-transition-esc-closes', (await page.locator('#adoptActionTitle').count()) === 0, 'open');
    const tEsc = await pageInspectFocus(page);
    const exactApprove = approveHandle
      ? await page.evaluate((el) => document.activeElement === el, approveHandle)
      : false;
    recordFocus('adopt-transition-esc-restore', tEsc, { exactTrigger: exactApprove });
    assert('adopt-transition-esc-focus-exact', exactApprove && isStrictFocusOk(tEsc), JSON.stringify({ exactApprove, tEsc }));
    await page.unroute('**/api/adopt/**/transition').catch(() => {});

    // Transition success
    await approveBtn.click();
    await page.waitForTimeout(200);
    const tSuccess = [];
    await page.route('**/api/adopt/**/transition', async (route) => {
      if (route.request().method() !== 'POST') { await route.continue(); return; }
      tSuccess.push(route.request().postDataJSON());
      results.writeRequestLog.push({ scenario: 'adopt-transition-success', method: 'POST', body: route.request().postDataJSON() });
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ code: '0', data: true }) });
    });
    await page.locator('[role="alertdialog"] button:has-text("确认执行")').click();
    await page.waitForFunction(() => {
      const vm = document.querySelector('#workspace') && document.querySelector('#workspace').__vue__;
      return vm && !vm.actionItem && /已更新|成功/.test(vm.message || '');
    }, { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(100);
    assert('adopt-transition-success-once', tSuccess.length === 1, 'n=' + tSuccess.length);
    assert('adopt-transition-success-closed', (await page.locator('#adoptActionTitle').count()) === 0, 'open');
    assert('adopt-transition-success-feedback', /已更新|成功/.test(await page.locator('.adopt-governance-feedback').innerText().catch(() => '')), 'msg');
    const tsFocus = await pageInspectFocus(page);
    recordFocus('adopt-transition-success', tsFocus, { listRefreshed: true });
    assert('adopt-transition-success-focus', isStrictFocusOk(tsFocus), JSON.stringify(tsFocus));
    await shot(page, '07-adopt-transition-success', { page: 'adopt', role: 'admin', viewport: '1440x900', state: 'transition-success', goal: '流转成功', routeIntercept: true });
    await page.unroute('**/api/adopt/**/transition').catch(() => {});

    // Mobile questionnaire viewports
    for (const vp of [{ name: '390x844', w: 390, h: 844 }, { name: '360x800', w: 360, h: 800 }, { name: '320x700', w: 320, h: 700 }]) {
      await page.setViewportSize({ width: vp.w, height: vp.h });
      await installAdoptListFixture(page);
      await page.goto(base + '/page/end/adopt.html', { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForTimeout(600);
      const listLayout = await page.evaluate(() => ({
        pageOverflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth,
        cards: Array.from(document.querySelectorAll('.admin-adopt-cards .admin-record-card')).filter((el) => {
          const style = getComputedStyle(el);
          const rect = el.getBoundingClientRect();
          return style.display !== 'none' && rect.width > 0 && rect.height > 0;
        }).length,
        queueWidth: (document.querySelector('.adopt-governance-queue') || {}).getBoundingClientRect
          ? document.querySelector('.adopt-governance-queue').getBoundingClientRect().width
          : 0
      }));
      assert('adopt-list-no-page-hscroll-' + vp.name, listLayout.pageOverflow <= 2, JSON.stringify(listLayout));
      assert('adopt-list-card-visible-' + vp.name, listLayout.cards >= 1 && listLayout.queueWidth > 0, JSON.stringify(listLayout));
      if (vp.name === '390x844' || vp.name === '320x700') {
        await shot(page, '08-adopt-list-' + vp.name, { page: 'adopt', role: 'admin', viewport: vp.name, state: 'list-mobile', goal: '领养列表移动端', routeIntercept: true });
      }
      // Prefer visible card action on mobile (desktop table buttons are display:none)
      const editVis = page.locator('button:has-text("编辑问卷"):visible').first();
      assert('adopt-edit-visible-' + vp.name, (await editVis.count()) >= 1, 'no visible edit');
      await editVis.click();
      await page.waitForTimeout(300);
      assert('adopt-q-open-' + vp.name, (await page.locator('#adoptQuestionnaireTitle').count()) >= 1, 'no dialog');
      const m = await measureDialogMobile(page);
      assert('adopt-q-no-page-hscroll-' + vp.name, m && m.pageOverflow <= 2, JSON.stringify(m));
      assert('adopt-q-no-dialog-overflow-' + vp.name, m && !m.dialogOverflow, JSON.stringify(m));
      assert('adopt-q-actions-visible-' + vp.name, m && m.actionsVisible, JSON.stringify(m));
      assert('adopt-q-btn-min-44-' + vp.name, m && m.minBtnH >= 44, JSON.stringify(m));
      await shot(page, '08-adopt-q-' + vp.name, { page: 'adopt', role: 'admin', viewport: vp.name, state: 'questionnaire-mobile', goal: '问卷移动端', routeIntercept: true });
      await page.keyboard.press('Escape');
      await page.waitForTimeout(150);
    }

    // ——— Proof fixture ———
    await page.setViewportSize({ width: 1440, height: 900 });
    await installProofListFixture(page);
    await page.goto(base + '/page/end/proof.html', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(700);
    assert('proof-fixture-row', (await page.locator('text=UI_AUDIT_2C_PROOF').count()) >= 1, 'fixture');
    await shot(page, '09-proof-desktop', { page: 'proof', role: 'admin', viewport: '1440x900', state: 'fixture-list', goal: '材料桌面', routeIntercept: true });

    const pDetail = page.locator('button:has-text("详情")').first();
    assert('proof-detail-btn', (await pDetail.count()) >= 1, 'missing');
    await pDetail.click();
    await page.waitForTimeout(250);
    assert('proof-detail-dialog', (await page.locator('#proofDetail').count()) >= 1, 'dialog');
    assert('proof-preview', (await page.locator('.proof-governance-preview').count()) >= 1, 'preview');
    await shot(page, '10-proof-detail', { page: 'proof', role: 'admin', viewport: '1440x900', state: 'detail', goal: '材料详情', routeIntercept: true });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    const pEsc = await pageInspectFocus(page);
    recordFocus('proof-detail-esc', pEsc, {});
    assert('proof-detail-esc-focus', isStrictFocusOk(pEsc), JSON.stringify(pEsc));

    const passBtn = page.locator('button:has-text("通过")').first();
    assert('proof-pass-btn', (await passBtn.count()) >= 1, 'missing 通过');
    const passHandle = await passBtn.elementHandle();
    await passBtn.click();
    await page.waitForTimeout(250);
    assert('proof-audit-dialog', (await page.locator('#proofDecision').count()) >= 1, 'dialog');
    const audits = [];
    await page.route('**/api/proof/**/audit', async (route) => {
      if (route.request().method() !== 'PUT') { await route.continue(); return; }
      audits.push(route.request().postDataJSON());
      results.writeRequestLog.push({ scenario: 'proof-audit-409', method: 'PUT', body: route.request().postDataJSON() });
      await new Promise((r) => setTimeout(r, 400));
      await route.fulfill(expectedErrorFulfill(409, { code: '409', msg: '状态冲突，请刷新后重试。' }));
    });
    const pConf = page.locator('[role="alertdialog"] button:has-text("确认")').first();
    const pConfH = await pConf.elementHandle();
    assert('proof-confirm-btn', !!pConfH, 'no confirm');
    await pConfH.evaluate((el) => { el.click(); el.click(); });
    await page.waitForTimeout(800);
    assert('proof-audit-once', audits.length === 1, 'n=' + audits.length);
    assert('proof-audit-409-keeps', (await page.locator('#proofDecision').count()) >= 1, 'closed');
    const pErr = await page.locator('#proofDecisionError').innerText().catch(() => '');
    assert('proof-audit-409-error', /冲突|刷新|状态/.test(pErr), pErr);
    assert('proof-audit-409-no-success', (await page.locator('.proof-governance-feedback.is-success').count()) === 0, 'success');
    const pLock = await page.evaluate(() => {
      const vm = document.querySelector('#workspace').__vue__;
      const L = window.__proofWriteLocks || {};
      return { deciding: !!(vm && vm.deciding), audit: !!L.audit };
    });
    assert('proof-audit-lock-released', !pLock.deciding && !pLock.audit, JSON.stringify(pLock));
    const pFocus = await pageInspectFocus(page);
    recordFocus('proof-audit-409', pFocus, {});
    assert('proof-audit-409-focus-in-dialog', pFocus.inDialog || pFocus.roleAlert, JSON.stringify(pFocus));
    await shot(page, '11-proof-audit-409', { page: 'proof', role: 'admin', viewport: '1440x900', state: 'audit-409', goal: '材料审核409', routeIntercept: true });

    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
    assert('proof-audit-esc-closes', (await page.locator('#proofDecision').count()) === 0, 'open');
    const pEsc2 = await pageInspectFocus(page);
    const exactPass = passHandle
      ? await page.evaluate((el) => document.activeElement === el, passHandle)
      : false;
    recordFocus('proof-audit-esc-restore', pEsc2, { exactTrigger: exactPass });
    assert('proof-audit-esc-focus-exact', exactPass && isStrictFocusOk(pEsc2), JSON.stringify({ exactPass, pEsc2 }));
    await page.unroute('**/api/proof/**/audit').catch(() => {});

    // Proof success
    await passBtn.click();
    await page.waitForTimeout(200);
    const aOk = [];
    await page.route('**/api/proof/**/audit', async (route) => {
      if (route.request().method() !== 'PUT') { await route.continue(); return; }
      aOk.push(1);
      results.writeRequestLog.push({ scenario: 'proof-audit-success', method: 'PUT' });
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ code: '0', data: true }) });
    });
    await page.locator('[role="alertdialog"] button:has-text("确认")').click();
    await page.waitForFunction(() => {
      const vm = document.querySelector('#workspace') && document.querySelector('#workspace').__vue__;
      return vm && !vm.decisionItem && /已更新|成功/.test(vm.message || '');
    }, { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(100);
    assert('proof-audit-success-once', aOk.length === 1, 'n=' + aOk.length);
    assert('proof-audit-success-closed', (await page.locator('#proofDecision').count()) === 0, 'open');
    assert('proof-audit-success-feedback', /已更新|成功/.test(await page.locator('.proof-governance-feedback').innerText().catch(() => '')), 'msg');
    const psFocus = await pageInspectFocus(page);
    recordFocus('proof-audit-success', psFocus, { listRefreshed: true });
    assert('proof-audit-success-focus', isStrictFocusOk(psFocus), JSON.stringify(psFocus));
    await shot(page, '12-proof-audit-success', { page: 'proof', role: 'admin', viewport: '1440x900', state: 'audit-success', goal: '材料审核成功', routeIntercept: true });
    await page.unroute('**/api/proof/**/audit').catch(() => {});

    // Reject reason required
    await page.locator('button:has-text("驳回")').first().click();
    await page.waitForTimeout(200);
    await page.fill('#proofDecisionReason', '');
    await page.locator('[role="alertdialog"] button:has-text("确认")').click();
    await page.waitForTimeout(200);
    const rejErr = await page.locator('#proofDecisionError').innerText().catch(() => '');
    assert('proof-reject-requires-reason', /原因/.test(rejErr) && (await page.locator('#proofDecision').count()) >= 1, rejErr);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);

    // Viewport matrix
    for (const vp of VIEWPORTS) {
      for (const pg of ['adopt', 'proof']) {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        if (pg === 'adopt') await installAdoptListFixture(page);
        else await installProofListFixture(page);
        await page.goto(base + '/page/end/' + pg + '.html', { waitUntil: 'domcontentloaded', timeout: 45000 });
        await page.waitForTimeout(280);
        const m = await page.evaluate(() => ({
          h1: !!document.querySelector('h1'),
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
        }));
        assert('vp-' + pg + '-' + vp.name, m.h1 && m.overflow <= 2, JSON.stringify(m));
      }
    }

    // Permissions
    {
      const jctx = await browser.newContext();
      await login(jctx, 'jerry', '123456');
      const jp = await jctx.newPage();
      await jp.goto(base + '/page/end/adopt.html', { waitUntil: 'domcontentloaded', timeout: 45000 });
      await jp.waitForTimeout(500);
      const api = await jctx.request.get(base + '/api/adopt/page');
      const denied = /forbidden|login|error=|index\.html/.test(jp.url()) || api.status() === 403;
      assert('jerry-adopt-denied', denied, jp.url());
      results.permissionMatrix.jerry_adopt = { denied: true };
      await jctx.close();
    }
    {
      const actx = await browser.newContext();
      const ap = await actx.newPage();
      await ap.goto(base + '/page/end/adopt.html', { waitUntil: 'domcontentloaded', timeout: 45000 });
      await ap.waitForTimeout(400);
      assert('anon-adopt-login', /login/i.test(ap.url()), ap.url());
      await actx.close();
    }
    {
      const actx = await browser.newContext();
      const ap = await actx.newPage();
      await ap.goto(base + '/page/end/proof.html', { waitUntil: 'domcontentloaded', timeout: 45000 });
      await ap.waitForTimeout(400);
      assert('anon-proof-login', /login/i.test(ap.url()), ap.url());
      await actx.close();
    }

    const intentional = httpErrors.filter((e) => {
      const h = e.headers || {};
      return h[EXPECTED_ERROR_HEADER] === EXPECTED_ERROR_VALUE || h[EXPECTED_ERROR_HEADER.toLowerCase()] === EXPECTED_ERROR_VALUE;
    });
    const unexpected = httpErrors.filter((e) => {
      const h = e.headers || {};
      return !(h[EXPECTED_ERROR_HEADER] === EXPECTED_ERROR_VALUE || h[EXPECTED_ERROR_HEADER.toLowerCase()] === EXPECTED_ERROR_VALUE);
    });
    const realConsole = consoleErrors.filter((t) => !/Failed to load resource: the server responded with a status of (409|500)/.test(t));
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
    assert('no-real-console-errors', realConsole.length === 0, JSON.stringify(realConsole.slice(0, 5)));
    assert('no-skipped-checks', results.checks.every((c) => !c.skipped), 'skipped present');

    await adminCtx.close();
  } catch (e) {
    fail('suite-exception', String(e && e.stack || e));
  } finally {
    if (browser) await browser.close().catch(() => {});
    const { passed, failed, skipped } = writeReport();
    console.log(JSON.stringify(results.summary, null, 2));
    console.log(failed || skipped ? `FAILED failed=${failed} skipped=${skipped} total=${results.checks.length}` : `ALL PASSED ${passed}`);
    if (results.failures.length) console.log(JSON.stringify(results.failures, null, 2));
    process.exit((failed || skipped) ? 1 : 0);
  }
})();
