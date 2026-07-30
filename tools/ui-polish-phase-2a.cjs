/**
 * Phase 2A strict acceptance — no best-effort PASS.
 * BASE_URL default http://127.0.0.1:10101
 *
 * Error policy:
 * - Only responses with header x-ui-audit-expected-error: phase2a are intentional.
 * - Real API 4xx/5xx, pageerror, and unexpected console.error always fail.
 * - Static historical image 404 noise may be ignored; never API paths.
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const base = process.env.BASE_URL || 'http://127.0.0.1:10101';
const out = path.resolve('output/playwright/ui-polish-phase-2a');
const shotDir = path.join(out, 'screenshots');
fs.mkdirSync(shotDir, { recursive: true });

const EXPECTED_ERROR_HEADER = 'x-ui-audit-expected-error';
const EXPECTED_ERROR_VALUE = 'phase2a';
const EXPECTED_ERROR_HEADERS = { [EXPECTED_ERROR_HEADER]: EXPECTED_ERROR_VALUE };

const VIEWPORTS = [
  { name: '1440x900', width: 1440, height: 900 },
  { name: '1280x800', width: 1280, height: 800 },
  { name: '1024x768', width: 1024, height: 768 },
  { name: '768x1024', width: 768, height: 1024 },
  { name: '720x450', width: 720, height: 450 },
  { name: '390x844', width: 390, height: 844 },
  { name: '360x800', width: 360, height: 800 }
];
const TABS = ['work', 'tasks', 'medical'];

const results = {
  startedAt: new Date().toISOString(),
  base,
  checks: [],
  failures: [],
  screenshots: [],
  midCourseFailures: [],
  apiCoverage: {},
  summary: {}
};

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
  const file = path.join(shotDir, name + '.png');
  await page.screenshot({ path: file, fullPage: false });
  results.screenshots.push({
    file: path.relative(out, file).replace(/\\/g, '/'),
    name,
    simulated: !!meta.simulated,
    routeIntercept: !!meta.routeIntercept,
    ...meta,
    time: new Date().toISOString()
  });
}

/** Historical static image / upload asset 404 only — never API. */
function isHistoricalStaticImageNoise(url) {
  if (!url || /\/api\//i.test(url)) return false;
  return /\.(png|jpe?g|gif|webp)(\?|$)/i.test(url) || /\/file\//i.test(url) || /\/upload\//i.test(url);
}

/** Intentional error fulfill helper — always tags with expected-error header. */
function expectedErrorFulfill(status, bodyObj) {
  return {
    status,
    headers: Object.assign(
      { 'content-type': 'application/json' },
      EXPECTED_ERROR_HEADERS
    ),
    body: typeof bodyObj === 'string' ? bodyObj : JSON.stringify(bodyObj)
  };
}

/**
 * Pure classifier for HTTP responses and console noise.
 * Used by live audit and isolated self-tests (no browser side effects).
 */
function classifyHttpError(entry, intentionalList) {
  const status = entry.status;
  const url = entry.url || '';
  const headers = entry.headers || {};
  const tagged =
    headers[EXPECTED_ERROR_HEADER] === EXPECTED_ERROR_VALUE ||
    headers[EXPECTED_ERROR_HEADER.toLowerCase()] === EXPECTED_ERROR_VALUE;
  if (tagged) {
    return { kind: 'expectedHttpError', status, url };
  }
  if (status === 404 && isHistoricalStaticImageNoise(url)) {
    return { kind: 'staticImageNoise', status, url };
  }
  return { kind: 'unexpectedHttpError', status, url };
}

function classifyConsoleError(text, expectedHttpCount) {
  const m = /Failed to load resource: the server responded with a status of (400|409|500)\b/.exec(text || '');
  if (m) {
    return { kind: 'possibleExpectedResourceNoise', status: Number(m[1]), text };
  }
  return { kind: 'realConsoleError', text };
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
    const c = classifyConsoleError(text);
    if (c.kind === 'possibleExpectedResourceNoise') {
      const st = c.status;
      used[st] = (used[st] || 0) + 1;
      if (used[st] <= (expectedByStatus[st] || 0)) {
        expectedConsoleNoise.push(text);
      } else {
        realConsoleErrors.push(text + ' [excess over tagged ' + st + ' responses]');
      }
    } else {
      realConsoleErrors.push(text);
    }
  }
  return { expectedConsoleNoise, realConsoleErrors, expectedByStatus, used };
}

/** Isolated classifier self-tests — pure functions only, no browser pollution. */
function runClassifierSelfTests() {
  const self = { passed: 0, failed: 0, details: [] };
  function check(id, cond, detail) {
    if (cond) {
      self.passed += 1;
      self.details.push({ id, ok: true, detail: String(detail || '') });
      pass('classifier-' + id, detail);
    } else {
      self.failed += 1;
      self.details.push({ id, ok: false, detail: String(detail || '') });
      fail('classifier-' + id, detail);
    }
  }

  // unmarked simulated API 500 → unexpected
  const unmarked = classifyHttpError(
    { status: 500, url: 'http://127.0.0.1/api/operations/admin/work-items', headers: {} },
    []
  );
  check('unmarked-api-500-unexpected', unmarked.kind === 'unexpectedHttpError', JSON.stringify(unmarked));

  // tagged intentional 409 → expected
  const tagged409 = classifyHttpError(
    {
      status: 409,
      url: 'http://127.0.0.1/api/operations/admin/work-items/1',
      headers: { [EXPECTED_ERROR_HEADER]: EXPECTED_ERROR_VALUE }
    },
    []
  );
  check('tagged-409-expected', tagged409.kind === 'expectedHttpError', JSON.stringify(tagged409));

  // API path must never be treated as static image noise even on 404
  const api404 = classifyHttpError(
    { status: 404, url: 'http://127.0.0.1/api/operations/admin/x.png', headers: {} },
    []
  );
  check('api-404-not-image-noise', api404.kind === 'unexpectedHttpError', JSON.stringify(api404));

  // historical static image 404 ok
  const img404 = classifyHttpError(
    { status: 404, url: 'http://127.0.0.1/static/img/missing-animal.png', headers: {} },
    []
  );
  check('static-image-404-noise', img404.kind === 'staticImageNoise', JSON.stringify(img404));

  // real console.error must be real
  const real = classifyConsoleError('UI_AUDIT_REAL_ERROR');
  check('real-console-error', real.kind === 'realConsoleError', JSON.stringify(real));

  // resource noise matched 1:1 with expected tagged responses
  const fin = finalizeConsoleClassification(
    [
      'Failed to load resource: the server responded with a status of 409 (Conflict)',
      'Failed to load resource: the server responded with a status of 409 (Conflict)',
      'UI_AUDIT_REAL_ERROR'
    ],
    [{ status: 409, url: '/a' }]
  );
  check(
    'console-match-and-excess',
    fin.expectedConsoleNoise.length === 1 &&
      fin.realConsoleErrors.length === 2 &&
      fin.realConsoleErrors.some((t) => /UI_AUDIT_REAL_ERROR/.test(t)) &&
      fin.realConsoleErrors.some((t) => /excess/.test(t)),
    JSON.stringify(fin)
  );

  // 200 must not be classified via expectedErrorFulfill path — helper only for errors
  const fulfill = expectedErrorFulfill(409, { code: '409', msg: 'x' });
  check(
    'fulfill-helper-tags',
    fulfill.status === 409 &&
      fulfill.headers[EXPECTED_ERROR_HEADER] === EXPECTED_ERROR_VALUE &&
      /409/.test(fulfill.body),
    JSON.stringify(fulfill.headers)
  );

  return self;
}

const SAMPLE_TASKS = [
  { id: 101, title: '草稿任务A', description: 'd', location: '园区北门', start_at: '2030-01-01T09:00:00', end_at: '2030-01-01T12:00:00', capacity: 5, status: 0, signup_count: 0, version: 3 },
  { id: 102, title: '招募中任务B', description: 'd', location: '南区', start_at: '2030-02-01T09:00:00', end_at: '2030-02-01T17:00:00', capacity: 10, status: 1, signup_count: 3, version: 4 },
  { id: 103, title: '已关闭任务C', description: 'd', location: '东仓', start_at: '2020-01-01T09:00:00', end_at: '2020-01-01T12:00:00', capacity: 4, status: 2, signup_count: 2, version: 5 },
  { id: 104, title: '已满任务D', description: 'd', location: '西侧', start_at: '2030-03-01T09:00:00', end_at: '2030-03-01T11:00:00', capacity: 2, status: 1, signup_count: 2, version: 2 },
  { id: 105, title: '已结束任务E', description: 'd', location: '中庭', start_at: '2020-06-01T09:00:00', end_at: '2020-06-01T10:00:00', capacity: 8, status: 1, signup_count: 1, version: 1 }
];

const SAMPLE_SIGNUPS = [
  { id: 201, user_id: 11, username: 'alice', status: 0, note: '想参加', version: 1, service_minutes: null, summary: null },
  { id: 202, user_id: 12, username: 'bob', status: 1, note: '已确认', version: 2, service_minutes: null, summary: null },
  { id: 203, user_id: 13, username: 'cara', status: 2, note: '-', version: 3, service_minutes: 90, summary: '完成喂养' },
  { id: 204, user_id: 14, username: 'dan', status: 3, note: '有事退出', version: 1, service_minutes: null, summary: null },
  { id: 205, user_id: 15, username: 'eve', status: 4, note: '不符', version: 1, service_minutes: null, summary: null }
];

const SAMPLE_MEDICAL = [
  { id: 301, record_type: 'exam', title: '年度体检', content: '健康', visibility: 'public', occurred_at: '2026-01-01T10:00:00', asset_flag: null },
  { id: 302, record_type: 'vaccine', title: '狂犬疫苗', content: '', visibility: 'owner', occurred_at: '2026-02-01T10:00:00', asset_flag: null },
  { id: 303, record_type: 'surgery', title: '绝育手术', content: '顺利', visibility: 'admin', occurred_at: '2026-03-01T10:00:00', asset_flag: 'abc-def-123' },
  { id: 304, record_type: 'weird_type', title: '未知类型记录', content: 'x', visibility: 'public', occurred_at: '2026-04-01T10:00:00', asset_flag: '!!!bad!!!' }
];

(async () => {
  const t0 = Date.now();
  console.log('Phase 2A strict start', base);

  // ——— Classifier self-tests (pure, no browser pollution) ———
  const classifierSelf = runClassifierSelfTests();
  results.classifierSelfTest = classifierSelf;
  assert('classifier-self-all-pass', classifierSelf.failed === 0, JSON.stringify(classifierSelf));

  const browser = await chromium.launch({ headless: true });

  // ——— Static contracts ———
  {

    const html = fs.readFileSync('src/main/resources/static/page/end/operations.html', 'utf8');
    const css = fs.readFileSync('src/main/resources/static/css/admin-workspace.css', 'utf8');
    const methods = ['activate', 'loadWork', 'updateWork', 'loadTasks', 'createTask', 'setTaskState', 'openSignups', 'assign', 'complete', 'createMedical', 'loadMedical', 'fileUrl', 'notifyFor', 'clearFeedback'];
    for (const m of methods) {
      assert('method-' + m, html.includes(m + ': function') || html.includes(m + ':function'), m);
    }
    const largeInlineStyleBlock = /<style>[\s\S]{200,}<\/style>/.test(html);
    assert('css-no-large-inline-block', !largeInlineStyleBlock, 'large style block present=' + largeInlineStyleBlock);
    const opsClassInHtmlStyle = /<style>[\s\S]*\.ops-tabs[\s\S]*<\/style>/.test(html);
    assert('css-ops-not-in-page-style', !opsClassInHtmlStyle, 'ops in page style');
    const requiredOps = ['.ops-tabs', '.ops-metrics', '.ops-card', '.ops-form', '.ops-tasks-layout', '.ops-medical-layout', '.ops-signup-cards', '.ops-feedback'];
    for (const sel of requiredOps) {
      assert('css-has-' + sel.replace(/^\./, ''), css.includes(sel), sel);
    }
    // base definition should exist (media queries may restate props)
    assert('css-ops-tabs-present', css.includes('.ops-tabs'), 'missing');
    // page must not redefine ops-tabs
    assert('css-ops-tabs-not-in-html', !html.includes('.ops-tabs'), 'ops-tabs in html');
    const styleAttrCount = (html.match(/\sstyle="/g) || []).length;
    assert('css-no-style-attrs', styleAttrCount === 0, 'count=' + styleAttrCount);
    assert('aria-static', html.includes('role="tablist"') && html.includes('role="tabpanel"') && html.includes('aria-selected'), 'ok');
    assert('mime-static', html.includes('accept="image/jpeg,image/png,image/gif,application/pdf"'), 'ok');
    assert('noopener-static', html.includes('rel="noopener"') && html.includes('target="_blank"'), 'ok');

    // Phase 2A cache bust
    const htmlContent = fs.readFileSync('src/main/resources/static/page/end/operations.html', 'utf8');
    assert('cache-bust-20260730a', htmlContent.includes('admin-workspace.css?v=20260730a'), 'missing new version');
    assert('cache-bust-no-20260729c', !htmlContent.includes('admin-workspace.css?v=20260729c'), 'old version still present');
  }

  // ——— Admin interactive ———
  const adminCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await login(adminCtx, 'admin', 'admin');
  const page = await adminCtx.newPage();
  const pageErrors = [];
  const consoleErrors = [];
  const httpErrorLog = []; // raw 4xx/5xx from page responses
  const cssRequests = []; // track admin-workspace.css network requests
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });
  page.on('request', (req) => {
    const u = req.url();
    if (/admin-workspace\.css/i.test(u)) cssRequests.push(u);
  });
  page.on('response', (r) => {
    const st = r.status();
    if (st >= 400) {
      httpErrorLog.push({
        status: st,
        url: r.url(),
        headers: r.headers()
      });
    }
  });

  await page.goto(base + '/page/end/operations.html', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForSelector('[role="tablist"]', { timeout: 15000 });
  await page.waitForTimeout(700);

  // Cache-bust: browser must actually request CSS with v=20260730a (not old 20260729c)
  const cssHitNew = cssRequests.filter((u) => /admin-workspace\.css\?v=20260730a/i.test(u));
  const cssHitOld = cssRequests.filter((u) => /admin-workspace\.css\?v=20260729c/i.test(u));
  assert(
    'cache-bust-network-20260730a',
    cssHitNew.length >= 1,
    'no network request for admin-workspace.css?v=20260730a; seen=' + JSON.stringify(cssRequests)
  );
  assert(
    'cache-bust-network-no-20260729c',
    cssHitOld.length === 0,
    'old CSS version requested: ' + JSON.stringify(cssHitOld)
  );
  // performance resource timing also must list the new version (not optional)
  const perfCss = await page.evaluate(() => {
    try {
      return performance.getEntriesByType('resource')
        .map((e) => e.name)
        .filter((n) => /admin-workspace\.css/i.test(n));
    } catch (e) {
      return [];
    }
  });
  assert(
    'cache-bust-performance-20260730a',
    perfCss.some((n) => /admin-workspace\.css\?v=20260730a/i.test(n)),
    'performance resources missing v=20260730a; seen=' + JSON.stringify(perfCss)
  );

  // three tabs
  const tabTexts = (await page.locator('[role="tab"]').allTextContents()).map((t) => t.replace(/\s+/g, ' ').trim());
  assert('admin-three-tabs',
    tabTexts[0] === '统一待办' && tabTexts.includes('义工任务') && tabTexts.includes('医疗档案') && tabTexts.length === 3,
    tabTexts.join('|'));

  // ARIA structure
  const aria0 = await page.evaluate(() => {
    const tabs = [...document.querySelectorAll('[role="tab"]')];
    const panels = [...document.querySelectorAll('[role="tabpanel"]')];
    const selected = tabs.filter((t) => t.getAttribute('aria-selected') === 'true');
    const visiblePanels = panels.filter((p) => {
      const st = getComputedStyle(p);
      return st.display !== 'none' && st.visibility !== 'hidden' && p.offsetParent !== null;
    });
    return {
      tabCount: tabs.length,
      selectedCount: selected.length,
      selectedId: selected[0] && selected[0].id,
      selectedControls: selected[0] && selected[0].getAttribute('aria-controls'),
      tabIndexes: tabs.map((t) => t.tabIndex),
      panelIds: panels.map((p) => p.id),
      panelLabels: panels.map((p) => p.getAttribute('aria-labelledby')),
      visiblePanelIds: visiblePanels.map((p) => p.id),
      controlsExist: tabs.every((t) => !!document.getElementById(t.getAttribute('aria-controls') || '')),
      labelsPointBack: panels.every((p) => {
        const id = p.getAttribute('aria-labelledby');
        return id && !!document.getElementById(id);
      })
    };
  });
  assert('aria-initial-work',
    aria0.selectedId === 'ops-tab-work' &&
    aria0.selectedControls === 'ops-panel-work' &&
    aria0.selectedCount === 1 &&
    aria0.visiblePanelIds.length === 1 &&
    aria0.visiblePanelIds[0] === 'ops-panel-work' &&
    aria0.controlsExist &&
    aria0.labelsPointBack &&
    aria0.tabIndexes.filter((x) => x === 0).length === 1,
    JSON.stringify(aria0));

  await shot(page, '01-ops-work-real', { page: 'operations', role: 'admin', viewport: '1440x900', state: 'work-real', goal: '统一待办真实数据', simulated: false });

  // Keyboard sequence
  await page.locator('#ops-tab-work').focus();
  async function selectedLabel() {
    return (await page.locator('[role="tab"][aria-selected="true"]').innerText()).replace(/\s+/g, ' ').trim();
  }
  async function ariaSnap() {
    return page.evaluate(() => {
      const tabs = [...document.querySelectorAll('[role="tab"]')];
      const selected = tabs.find((t) => t.getAttribute('aria-selected') === 'true');
      const panels = [...document.querySelectorAll('[role="tabpanel"]')];
      const visible = panels.filter((p) => getComputedStyle(p).display !== 'none' && p.offsetParent !== null);
      return {
        label: selected ? selected.textContent.replace(/\s+/g, ' ').trim() : '',
        id: selected && selected.id,
        controls: selected && selected.getAttribute('aria-controls'),
        tab0: tabs.map((t) => ({ id: t.id, ti: t.tabIndex, sel: t.getAttribute('aria-selected') })),
        visible: visible.map((p) => p.id)
      };
    });
  }

  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(250);
  let snap = await ariaSnap();
  assert('kbd-right-1-tasks', snap.label === '义工任务' && snap.id === 'ops-tab-tasks' && snap.controls === 'ops-panel-tasks' && snap.visible.length === 1 && snap.visible[0] === 'ops-panel-tasks', JSON.stringify(snap));

  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(250);
  snap = await ariaSnap();
  assert('kbd-right-2-medical', snap.label === '医疗档案' && snap.id === 'ops-tab-medical' && snap.controls === 'ops-panel-medical' && snap.visible[0] === 'ops-panel-medical', JSON.stringify(snap));

  await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(250);
  snap = await ariaSnap();
  assert('kbd-left-tasks', snap.label === '义工任务' && snap.visible[0] === 'ops-panel-tasks', JSON.stringify(snap));

  await page.keyboard.press('Home');
  await page.waitForTimeout(250);
  snap = await ariaSnap();
  assert('kbd-home-work', snap.label === '统一待办' && snap.visible[0] === 'ops-panel-work', JSON.stringify(snap));

  await page.keyboard.press('End');
  await page.waitForTimeout(250);
  snap = await ariaSnap();
  assert('kbd-end-medical', snap.label === '医疗档案' && snap.visible[0] === 'ops-panel-medical', JSON.stringify(snap));
  assert('kbd-single-selected', snap.tab0.filter((t) => t.sel === 'true').length === 1 && snap.tab0.filter((t) => t.ti === 0).length === 1, JSON.stringify(snap.tab0));

  // Cross-tab message cleanup + race
  await page.keyboard.press('Home');
  await page.waitForTimeout(200);
  await page.evaluate(() => {
    const vm = document.querySelector('#workspace').__vue__;
    vm.notify('待办已更新');
    vm.messageError = false;
  });
  let msg = await page.locator('.ops-feedback').innerText().catch(() => '');
  assert('msg-set-work', /待办已更新/.test(msg), msg);
  await page.getByRole('tab', { name: '义工任务' }).click();
  await page.waitForTimeout(200);
  const msgAfter = await page.locator('.ops-feedback').count();
  assert('msg-cleared-on-tab-switch', msgAfter === 0, 'count=' + msgAfter);
  await shot(page, '02-ops-tab-switch-no-stale-msg', { page: 'operations', role: 'admin', viewport: '1440x900', state: 'tasks-after-switch', goal: '切换标签后无旧消息', simulated: false });

  // Race: work notify after switch to medical
  await page.getByRole('tab', { name: '统一待办' }).click();
  await page.waitForTimeout(150);
  await page.evaluate(() => {
    const vm = document.querySelector('#workspace').__vue__;
    const token = vm.beginFeedback('work');
    vm.selectTab('medical');
    vm.notifyFor(token, '待办已更新-竞态');
  });
  await page.waitForTimeout(100);
  assert('race-work-to-medical', (await page.locator('.ops-feedback').count()) === 0, 'stale shown');

  // Race: tasks error after switch to work
  await page.evaluate(() => {
    const vm = document.querySelector('#workspace').__vue__;
    const token = vm.beginFeedback('tasks');
    vm.selectTab('work');
    vm.notifyFor(token, '任务加载失败-竞态', true);
  });
  assert('race-tasks-to-work', (await page.locator('.ops-feedback').count()) === 0, 'stale shown');

  // Race: medical success after switch to tasks
  await page.evaluate(() => {
    const vm = document.querySelector('#workspace').__vue__;
    const token = vm.beginFeedback('medical');
    vm.selectTab('tasks');
    vm.notifyFor(token, '医疗记录已保存-竞态');
  });
  assert('race-medical-to-tasks', (await page.locator('.ops-feedback').count()) === 0, 'stale shown');

  // Work metrics + filter/overdue (client inject, marked simulated)
  await page.getByRole('tab', { name: '统一待办' }).click();
  await page.waitForTimeout(300);
  assert('work-metrics-count', (await page.locator('.ops-metrics .ops-metric').count()) >= 4, 'metrics');
  await page.evaluate(() => {
    const vm = document.querySelector('#workspace').__vue__;
    const now = Date.now();
    vm.workItems = (vm.workItems || []).concat([
      { id: 'sim-od', business_type: 'adopt', business_id: 900001, title: 'SIM_OVERDUE_UI_AUDIT', priority: 3, assignee_id: null, assignee_name: null, due_at: new Date(now - 86400000).toISOString(), status: 0, version: 1 },
      { id: 'sim-unk', business_type: 'unknown_type_x', business_id: 900002, title: 'SIM_UNKNOWN_TYPE', priority: 0, assignee_id: 1, assignee_name: 'admin', due_at: null, status: 1, version: 1 }
    ]);
  });
  await page.waitForTimeout(150);
  assert('overdue-badge', (await page.locator('.ops-badge.is-overdue').count()) >= 1, 'missing overdue');
  assert('unassigned-badge', (await page.locator('.ops-badge.is-warn', { hasText: '未分派' }).count()) >= 1, 'missing unassigned');
  await page.locator('.ops-toolbar input[type="search"]').fill('SIM_OVERDUE');
  await page.waitForTimeout(100);
  const heads = await page.locator('.ops-card h3').allTextContents();
  assert('filter-keyword', heads.some((h) => h.includes('SIM_OVERDUE')), heads.join('|'));
  await shot(page, '03-ops-filter-overdue-sim', { page: 'operations', role: 'admin', viewport: '1440x900', state: 'filter', goal: '筛选/逾期', simulated: true });
  await page.locator('.ops-toolbar input[type="search"]').fill('');

  // updateWork structure + busy double submit
  let puts = [];
  await page.route('**/api/operations/admin/work-items/**', async (route) => {
    if (route.request().method() === 'PUT') {
      puts.push({ url: route.request().url(), body: route.request().postDataJSON() });
      await new Promise((r) => setTimeout(r, 600));
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ code: '0', data: true }) });
      return;
    }
    await route.continue();
  });
  await page.evaluate(() => {
    const vm = document.querySelector('#workspace').__vue__;
    const item = { id: 55, status: 0, priority: 1, version: 7, assignee_id: null };
    vm.updateWork(item, 0, 1, 'self');
    vm.updateWork(item, 0, 1, 'self');
  });
  await page.waitForTimeout(900);
  assert('work-put-once', puts.length === 1, 'puts=' + puts.length);
  assert('work-put-version', puts[0] && puts[0].body && puts[0].body.expectedVersion === 7 && puts[0].body.assigneeId != null, JSON.stringify(puts[0]));
  results.apiCoverage['PUT /admin/work-items/{id}'] = 'intercepted-ok';
  await page.unroute('**/api/operations/admin/work-items/**');

  // 409
  await page.route('**/api/operations/admin/work-items/**', async (route) => {
    if (route.request().method() === 'PUT') {
      await route.fulfill(expectedErrorFulfill(409, { code: '409', msg: '待办已被其他管理员更新' }));
      return;
    }
    await route.continue();
  });
  await page.evaluate(() => {
    const vm = document.querySelector('#workspace').__vue__;
    vm.updateWork({ id: 99, status: 0, priority: 1, version: 1, assignee_id: null }, 1, 1);
  });
  await page.waitForTimeout(300);
  const c409 = await page.locator('.ops-feedback.is-conflict, .ops-feedback.error').innerText().catch(() => '');
  assert('work-409', /刷新|其他管理员|更新/.test(c409), c409);
  await shot(page, '04-ops-work-409-sim', { page: 'operations', role: 'admin', viewport: '1440x900', state: '409', goal: '409 冲突', simulated: true, routeIntercept: true });
  await page.unroute('**/api/operations/admin/work-items/**');

  // busy visual
  await page.route('**/api/operations/admin/work-items/**', async (route) => {
    if (route.request().method() === 'PUT') {
      await new Promise((r) => setTimeout(r, 1000));
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ code: '0', data: true }) });
      return;
    }
    await route.continue();
  });
  await page.evaluate(() => {
    const vm = document.querySelector('#workspace').__vue__;
    vm.workItems = [{ id: 77, business_type: 'proof', business_id: 1, title: 'BUSY_CARD', priority: 1, assignee_id: null, due_at: null, status: 0, version: 1 }];
    vm.updateWork(vm.workItems[0], 0, 1, 'self');
  });
  await page.waitForTimeout(100);
  assert('work-busy-class', await page.locator('.ops-card.is-busy').count() >= 1, 'no busy');
  await shot(page, '05-ops-work-busy-sim', { page: 'operations', role: 'admin', viewport: '1440x900', state: 'busy', goal: '待办 busy', simulated: true, routeIntercept: true });
  await page.waitForTimeout(1100);
  await page.unroute('**/api/operations/admin/work-items/**');

  // ——— Tasks tab with intercepts ———
  await page.route('**/api/operations/admin/volunteer-tasks', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ code: '0', data: SAMPLE_TASKS }) });
      return;
    }
    await route.continue();
  });
  await page.getByRole('tab', { name: '义工任务' }).click();
  await page.waitForTimeout(500);
  const taskTitles = await page.locator('.ops-card h3').allTextContents();
  assert('tasks-populated', SAMPLE_TASKS.every((t) => taskTitles.some((x) => x.includes(t.title))), taskTitles.join('|'));
  assert('tasks-full-badge', await page.locator('.ops-badge', { hasText: '已满' }).count() >= 1, 'full');
  assert('tasks-ended-badge', await page.locator('.ops-badge', { hasText: '已结束' }).count() >= 1, 'ended');
  assert('tasks-draft-publish', await page.locator('button:has-text("发布")').count() >= 1, 'publish');
  assert('tasks-close-recruit', await page.locator('button:has-text("关闭招募")').count() >= 1, 'close');
  await shot(page, '06-ops-tasks-populated', { page: 'operations', role: 'admin', viewport: '1440x900', state: 'tasks-populated', goal: '义工任务 populated', routeIntercept: true, simulated: true });
  results.apiCoverage['GET /admin/volunteer-tasks'] = 'intercepted-ok';

  // empty tasks
  await page.unroute('**/api/operations/admin/volunteer-tasks');
  await page.route('**/api/operations/admin/volunteer-tasks', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ code: '0', data: [] }) });
      return;
    }
    await route.continue();
  });
  await page.evaluate(() => document.querySelector('#workspace').__vue__.loadTasks());
  await page.waitForTimeout(400);
  const emptyText = await page.locator('#ops-panel-tasks').innerText();
  assert('tasks-empty', /还没有义工任务/.test(emptyText), emptyText.slice(0, 120));
  await shot(page, '07-ops-tasks-empty', { page: 'operations', role: 'admin', viewport: '1440x900', state: 'tasks-empty', goal: '义工 empty', routeIntercept: true, simulated: true });

  // create task POST intercept
  let createPosts = [];
  await page.unroute('**/api/operations/admin/volunteer-tasks');
  await page.route('**/api/operations/admin/volunteer-tasks', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ code: '0', data: SAMPLE_TASKS }) });
      return;
    }
    if (route.request().method() === 'POST') {
      createPosts.push(route.request().postDataJSON());
      await new Promise((r) => setTimeout(r, 500));
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ code: '0', data: 999 }) });
      return;
    }
    await route.continue();
  });
  await page.evaluate(() => { document.querySelector('#workspace').__vue__.taskComposeOpen = true; });
  await page.waitForTimeout(100);
  // validation: end before start
  await page.fill('#opsTaskCompose input[maxlength="120"]', 'UI_AUDIT_2A_TASK');
  const dtInputs = page.locator('#opsTaskCompose input[type="datetime-local"]');
  await dtInputs.nth(0).fill('2030-05-02T10:00');
  await dtInputs.nth(1).fill('2030-05-01T10:00');
  await page.locator('#opsTaskCompose input[type="number"]').fill('5');
  await page.locator('#opsTaskCompose button[type="submit"]').click();
  await page.waitForTimeout(150);
  assert('task-create-end-before-start', createPosts.length === 0 && /结束时间必须晚于开始时间/.test(await page.locator('.ops-feedback').innerText().catch(() => '')), 'validation');
  // capacity invalid
  await dtInputs.nth(1).fill('2030-05-03T10:00');
  await page.evaluate(() => {
    const vm = document.querySelector('#workspace').__vue__;
    vm.taskForm.capacity = 0;
    vm.taskForm.startAt = '2030-05-02T10:00';
    vm.taskForm.endAt = '2030-05-03T10:00';
    vm.taskForm.title = 'UI_AUDIT_2A_TASK';
    vm.createTask();
  });
  await page.waitForTimeout(150);
  const capMsg = await page.locator('.ops-feedback').innerText().catch(() => '');
  assert('task-create-capacity', createPosts.length === 0 && /招募人数/.test(capMsg), capMsg || 'no msg');
  // valid create + double click
  await page.locator('#opsTaskCompose input[type="number"]').fill('6');
  await page.locator('#opsTaskCompose textarea').fill('desc-audit');
  await page.locator('#opsTaskCompose input').nth(1).fill('测试地点');
  createPosts = [];
  await page.locator('#opsTaskCompose button[type="submit"]').click();
  await page.locator('#opsTaskCompose button[type="submit"]').click({ force: true }).catch(() => {});
  await page.waitForTimeout(800);
  assert('task-create-once', createPosts.length === 1, 'posts=' + createPosts.length);
  const body = createPosts[0] || {};
  assert('task-create-body',
    body.title === 'UI_AUDIT_2A_TASK' && body.location === '测试地点' && body.capacity === 6 && body.description === 'desc-audit' && body.startAt && body.endAt && (body.status === 0 || body.status === 1),
    JSON.stringify(body));
  results.apiCoverage['POST /admin/volunteer-tasks'] = 'intercepted-ok';
  // loading/success shots taken later with delayed intercept (08 / 08b)

  // fail create keeps input
  await page.unroute('**/api/operations/admin/volunteer-tasks');
  await page.route('**/api/operations/admin/volunteer-tasks', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ code: '0', data: SAMPLE_TASKS }) });
      return;
    }
    if (route.request().method() === 'POST') {
      await route.fulfill(expectedErrorFulfill(400, { code: '400', msg: '创建失败审计' }));
      return;
    }
    await route.continue();
  });
  await page.fill('#opsTaskCompose input[maxlength="120"]', 'KEEP_TITLE');
  await dtInputs.nth(0).fill('2030-06-01T09:00');
  await dtInputs.nth(1).fill('2030-06-01T11:00');
  await page.locator('#opsTaskCompose input[type="number"]').fill('3');
  await page.locator('#opsTaskCompose button[type="submit"]').click();
  await page.waitForTimeout(300);
  const kept = await page.inputValue('#opsTaskCompose input[maxlength="120"]');
  assert('task-create-fail-keep', kept === 'KEEP_TITLE', kept);

  // setTaskState PUT
  let statusPuts = [];
  await page.unroute('**/api/operations/admin/volunteer-tasks');
  await page.route('**/api/operations/admin/volunteer-tasks', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ code: '0', data: SAMPLE_TASKS }) });
      return;
    }
    await route.continue();
  });
  await page.route('**/api/operations/admin/volunteer-tasks/*/status', async (route) => {
    if (route.request().method() === 'PUT') {
      statusPuts.push({ url: route.request().url(), body: route.request().postDataJSON() });
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ code: '0', data: true }) });
      return;
    }
    await route.continue();
  });
  await page.evaluate(() => document.querySelector('#workspace').__vue__.loadTasks());
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const vm = document.querySelector('#workspace').__vue__;
    const draft = vm.tasks.find((t) => Number(t.status) === 0);
    if (draft) vm.setTaskState(draft, 1);
  });
  await page.waitForTimeout(200);
  assert('task-status-put', statusPuts.length === 1 && statusPuts[0].body.status === 1 && statusPuts[0].body.expectedVersion === 3 && /\/101\/status/.test(statusPuts[0].url), JSON.stringify(statusPuts[0]));
  results.apiCoverage['PUT /admin/volunteer-tasks/{id}/status'] = 'intercepted-ok';

  // 409 status
  await page.unroute('**/api/operations/admin/volunteer-tasks/*/status');
  await page.route('**/api/operations/admin/volunteer-tasks/*/status', async (route) => {
    await route.fulfill(expectedErrorFulfill(409, { code: '409', msg: '任务已被其他管理员更新' }));
  });
  await page.evaluate(() => {
    const vm = document.querySelector('#workspace').__vue__;
    vm.setTaskState({ id: 102, status: 1, version: 4 }, 2);
  });
  await page.waitForTimeout(200);
  assert('task-status-409', /刷新|其他管理员/.test(await page.locator('.ops-feedback').innerText().catch(() => '')), 'no 409 msg');
  await page.unroute('**/api/operations/admin/volunteer-tasks/*/status');

  // signups
  await page.route('**/api/operations/admin/volunteer-tasks/*/signups', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ code: '0', data: SAMPLE_SIGNUPS }) });
  });
  await page.evaluate((task) => {
    document.querySelector('#workspace').__vue__.openSignups(task);
  }, SAMPLE_TASKS[1]);
  await page.waitForTimeout(300);
  assert('signups-desktop-table', await page.locator('.ops-table table').count() >= 1, 'no table');
  const signupText = await page.locator('.ops-signups').innerText();
  assert('signups-states', /待确认|已指派|已完成|已撤回|未通过/.test(signupText) && /alice|bob|cara/.test(signupText) && /90 分钟/.test(signupText), signupText.slice(0, 120));
  await shot(page, '09-ops-signups-desktop', { page: 'operations', role: 'admin', viewport: '1440x900', state: 'signups-table', goal: '报名桌面表格', routeIntercept: true, simulated: true });
  results.apiCoverage['GET /admin/volunteer-tasks/{id}/signups'] = 'intercepted-ok';

  // assign true/false
  let assigns = [];
  await page.route('**/api/operations/admin/volunteer-signups/*/assign', async (route) => {
    assigns.push({ url: route.request().url(), body: route.request().postDataJSON() });
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ code: '0', data: true }) });
  });
  await page.evaluate(() => {
    const vm = document.querySelector('#workspace').__vue__;
    vm.assign({ id: 201, version: 1, status: 0 }, true);
  });
  await page.waitForTimeout(150);
  await page.evaluate(() => {
    const vm = document.querySelector('#workspace').__vue__;
    vm.assign({ id: 201, version: 1, status: 0 }, false);
  });
  await page.waitForTimeout(150);
  assert('assign-true', assigns[0] && assigns[0].body.accepted === true && assigns[0].body.expectedVersion === 1, JSON.stringify(assigns[0]));
  assert('assign-false', assigns[1] && assigns[1].body.accepted === false, JSON.stringify(assigns[1]));
  results.apiCoverage['PUT /admin/volunteer-signups/{id}/assign'] = 'intercepted-ok';

  // assign 409
  await page.unroute('**/api/operations/admin/volunteer-signups/*/assign');
  await page.route('**/api/operations/admin/volunteer-signups/*/assign', async (route) => {
    await route.fulfill(expectedErrorFulfill(409, { code: '409', msg: '报名已被更新' }));
  });
  await page.evaluate(() => document.querySelector('#workspace').__vue__.assign({ id: 201, version: 1, status: 0 }, true));
  await page.waitForTimeout(150);
  assert('assign-409', /刷新|报名/.test(await page.locator('.ops-feedback').innerText().catch(() => '')), 'no msg');
  await shot(page, '10-ops-assign-409', { page: 'operations', role: 'admin', viewport: '1440x900', state: 'assign-409', goal: '报名 409', routeIntercept: true, simulated: true });
  await page.unroute('**/api/operations/admin/volunteer-signups/*/assign');

  // complete via mocked prompt
  let completes = [];
  await page.route('**/api/operations/admin/volunteer-signups/*/complete', async (route) => {
    completes.push({ url: route.request().url(), body: route.request().postDataJSON() });
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ code: '0', data: true }) });
  });
  await page.evaluate(() => {
    const vm = document.querySelector('#workspace').__vue__;
    const origPrompt = window.prompt;
    let i = 0;
    window.prompt = function () {
      i += 1;
      return i === 1 ? '90' : '现场服务完成';
    };
    try { vm.complete({ id: 202, version: 2, status: 1 }); }
    finally { window.prompt = origPrompt; }
  });
  await page.waitForTimeout(250);
  assert('complete-body', completes.length === 1 && completes[0].body.serviceMinutes === 90 && completes[0].body.summary === '现场服务完成' && completes[0].body.expectedVersion === 2, JSON.stringify(completes[0]));
  results.apiCoverage['POST /admin/volunteer-signups/{id}/complete'] = 'intercepted-ok';

  completes = [];
  await page.evaluate(() => {
    const vm = document.querySelector('#workspace').__vue__;
    const orig = window.prompt;
    window.prompt = function () { return null; };
    try { vm.complete({ id: 202, version: 2, status: 1 }); }
    finally { window.prompt = orig; }
  });
  await page.waitForTimeout(100);
  assert('complete-cancel', completes.length === 0, 'sent');

  completes = [];
  await page.evaluate(() => {
    const vm = document.querySelector('#workspace').__vue__;
    const orig = window.prompt;
    let i = 0;
    window.prompt = function () { i += 1; return i === 1 ? '-5' : 'x'; };
    try { vm.complete({ id: 202, version: 2, status: 1 }); }
    finally { window.prompt = orig; }
  });
  await page.waitForTimeout(100);
  assert('complete-invalid-minutes', completes.length === 0 && /分钟数无效/.test(await page.locator('.ops-feedback').innerText().catch(() => '')), 'not blocked');

  // missing version
  await page.evaluate(() => document.querySelector('#workspace').__vue__.setTaskState({ id: 1, status: 0 }, 1));
  await page.waitForTimeout(50);
  assert('task-missing-version', /版本缺失/.test(await page.locator('.ops-feedback').innerText().catch(() => '')), 'no msg');

  // ——— Medical ———
  await page.getByRole('tab', { name: '医疗档案' }).click();
  await page.waitForTimeout(300);
  // visibility options text
  const visTexts = await page.evaluate(() => {
    const sel = document.querySelector('#ops-panel-medical select');
    // find visibility select by options
    const selects = [...document.querySelectorAll('#ops-panel-medical select')];
    const vis = selects.find((s) => [...s.options].some((o) => o.value === 'owner'));
    return vis ? [...vis.options].map((o) => ({ value: o.value, text: o.textContent.trim() })) : [];
  });
  assert('medical-opt-public', visTexts.some((o) => o.value === 'public' && o.text === '公开'), JSON.stringify(visTexts));
  assert('medical-opt-owner', visTexts.some((o) => o.value === 'owner' && o.text === '仅正式领养人和管理员'), JSON.stringify(visTexts));
  assert('medical-opt-admin', visTexts.some((o) => o.value === 'admin' && o.text === '仅管理员'), JSON.stringify(visTexts));
  await shot(page, '11-ops-medical-form', { page: 'operations', role: 'admin', viewport: '1440x900', state: 'medical-form', goal: '医疗表单', simulated: false });

  // medical POST no file
  let medicalPosts = [];
  let uploads = [];
  let stagedDeletes = [];
  await page.route('**/api/files/upload', async (route) => {
    uploads.push(true);
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ code: '0', data: { flag: 'stage-flag-ok' } }) });
  });
  await page.route('**/api/files/staged/**', async (route) => {
    if (route.request().method() === 'DELETE') {
      stagedDeletes.push(route.request().url());
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ code: '0', data: true }) });
      return;
    }
    await route.continue();
  });
  await page.route('**/api/operations/admin/animals/*/medical', async (route) => {
    if (route.request().method() === 'POST') {
      medicalPosts.push(route.request().postDataJSON());
      await new Promise((r) => setTimeout(r, 400));
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ code: '0', data: 1 }) });
      return;
    }
    await route.continue();
  });
  await page.route('**/api/operations/animals/*/medical', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ code: '0', data: SAMPLE_MEDICAL }) });
  });

  // fill medical form
  const medPanel = page.locator('#ops-panel-medical');
  await medPanel.locator('input[type="number"]').first().fill('12');
  await medPanel.locator('input[maxlength="120"]').fill('UI_AUDIT_2A_MED');
  await medPanel.locator('input[type="datetime-local"]').fill('2026-07-01T10:30');
  await medPanel.locator('textarea').fill('详情内容');
  medicalPosts = [];
  const medSave = medPanel.getByRole('button', { name: /保存医疗记录|正在保存|正在上传/ });
  await medSave.click();
  await medSave.click({ force: true }).catch(() => {});
  await page.waitForTimeout(700);
  assert('medical-post-once', medicalPosts.length === 1, 'posts=' + medicalPosts.length);
  const mb = medicalPosts[0] || {};
  assert('medical-post-body',
    Number(mb.animalId) === 12 && mb.recordType && mb.title === 'UI_AUDIT_2A_MED' && mb.occurredAt && mb.visibility && mb.content === '详情内容' && (mb.assetFlag == null || mb.assetFlag === null),
    JSON.stringify(mb));
  results.apiCoverage['POST /admin/animals/{id}/medical'] = 'intercepted-ok';
  // uploading/saving/success shots taken later with delayed intercept (12a/12b/12c)

  // with file upload order
  medicalPosts = [];
  uploads = [];
  await page.setInputFiles('#ops-panel-medical input[type="file"]', {
    name: 'audit.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4 audit')
  });
  await medPanel.locator('input[type="number"]').first().fill('12');
  await medPanel.locator('input[maxlength="120"]').fill('WITH_FILE');
  await medPanel.locator('input[type="datetime-local"]').fill('2026-07-02T10:30');
  await medPanel.getByRole('button', { name: /保存医疗记录|正在保存|正在上传/ }).click();
  await page.waitForTimeout(800);
  assert('medical-upload-then-post', uploads.length === 1 && medicalPosts.length === 1 && medicalPosts[0].assetFlag === 'stage-flag-ok', JSON.stringify({ uploads: uploads.length, body: medicalPosts[0] }));
  results.apiCoverage['POST /api/files/upload'] = 'intercepted-ok';

  // illegal flag from upload
  await page.unroute('**/api/files/upload');
  await page.route('**/api/files/upload', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ code: '0', data: { flag: '../evil' } }) });
  });
  medicalPosts = [];
  await page.setInputFiles('#ops-panel-medical input[type="file"]', {
    name: 'bad.pdf', mimeType: 'application/pdf', buffer: Buffer.from('x')
  });
  await medPanel.getByRole('button', { name: /保存医疗记录|正在保存|正在上传/ }).click();
  await page.waitForTimeout(400);
  assert('medical-illegal-flag-no-post', medicalPosts.length === 0, 'posted');
  assert('medical-illegal-flag-msg', /上传失败|标识无效|附件/.test(await page.locator('.ops-feedback').innerText().catch(() => '')), 'no msg');

  // upload ok but medical fail => staged delete
  await page.unroute('**/api/files/upload');
  await page.route('**/api/files/upload', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ code: '0', data: { flag: 'stage-to-delete' } }) });
  });
  await page.unroute('**/api/operations/admin/animals/*/medical');
  await page.route('**/api/operations/admin/animals/*/medical', async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill(expectedErrorFulfill(400, { code: '400', msg: '保存失败审计' }));
      return;
    }
    await route.continue();
  });
  stagedDeletes = [];
  await page.setInputFiles('#ops-panel-medical input[type="file"]', {
    name: 'z.pdf', mimeType: 'application/pdf', buffer: Buffer.from('z')
  });
  await medPanel.getByRole('button', { name: /保存医疗记录|正在保存|正在上传/ }).click();
  await page.waitForTimeout(500);
  assert('medical-fail-retire-stage', stagedDeletes.some((u) => u.includes('stage-to-delete')), stagedDeletes.join('|'));
  results.apiCoverage['DELETE /api/files/staged/{flag}'] = 'intercepted-ok';
  await shot(page, '13-ops-medical-error', { page: 'operations', role: 'admin', viewport: '1440x900', state: 'medical-error', goal: '医疗 error', routeIntercept: true, simulated: true });

  // medical GET populated
  await page.unroute('**/api/operations/animals/*/medical');
  await page.route('**/api/operations/animals/*/medical', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ code: '0', data: SAMPLE_MEDICAL }) });
  });
  await page.locator('.ops-medical-query input[type="number"]').fill('12');
  await page.locator('.ops-medical-query button[type="submit"]').click();
  await page.waitForTimeout(300);
  const medList = await page.locator('#ops-panel-medical .ops-card').innerText().catch(() => '');
  const allMed = await page.locator('#ops-panel-medical').innerText();
  assert('medical-visibility-zh-list', /公开/.test(allMed) && /仅正式领养人和管理员/.test(allMed) && /仅管理员/.test(allMed), allMed.slice(0, 200));
  assert('medical-type-fallback', /weird_type|未知/.test(allMed) || /未知类型记录/.test(allMed), 'type');
  const goodLink = page.locator('a.ops-attach-link[href="/api/files/abc-def-123"]');
  assert('medical-attach-link', await goodLink.count() === 1, 'link');
  assert('medical-attach-noopener', await goodLink.getAttribute('rel') === 'noopener' && await goodLink.getAttribute('target') === '_blank', 'attrs');
  assert('medical-bad-flag-no-link', await page.locator('a[href*="!!!"]').count() === 0, 'bad link shown');
  await shot(page, '14-ops-medical-populated', { page: 'operations', role: 'admin', viewport: '1440x900', state: 'medical-populated', goal: '医疗 populated', routeIntercept: true, simulated: true });
  results.apiCoverage['GET /animals/{id}/medical'] = 'intercepted-ok';

  // medical empty
  await page.unroute('**/api/operations/animals/*/medical');
  await page.route('**/api/operations/animals/*/medical', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ code: '0', data: [] }) });
  });
  await page.locator('.ops-medical-query button[type="submit"]').click();
  await page.waitForTimeout(200);
  assert('medical-empty', /暂无医疗记录/.test(await page.locator('#ops-panel-medical').innerText()), 'no empty');
  await shot(page, '15-ops-medical-empty', { page: 'operations', role: 'admin', viewport: '1440x900', state: 'medical-empty', goal: '医疗 empty', routeIntercept: true, simulated: true });

  // unauthorized method force from DOM when on medical - switch and ensure work update msg not shown if forced from wrong context is already tested

  // ——— State feedback: error must not wipe populated data ———
  await page.getByRole('tab', { name: '统一待办' }).click();
  await page.waitForTimeout(200);
  await page.evaluate(() => {
    const vm = document.querySelector('#workspace').__vue__;
    vm.workItems = [{ id: 1, business_type: 'adopt', business_id: 1, title: 'KEEP_ON_ERROR', priority: 1, assignee_id: null, due_at: null, status: 0, version: 1 }];
    vm.workError = '';
    vm.loadingWork = false;
  });
  await page.waitForTimeout(50);
  await page.route('**/api/operations/admin/dashboard', async (route) => {
    await route.fulfill(expectedErrorFulfill(500, { code: '500', msg: '待办加载失败审计' }));
  });
  await page.evaluate(() => document.querySelector('#workspace').__vue__.loadWork());
  await page.waitForTimeout(400);
  const keepCards = await page.locator('#ops-panel-work .ops-card h3', { hasText: 'KEEP_ON_ERROR' }).count();
  const errBanner = await page.locator('#ops-panel-work .ops-state.is-error').count();
  assert('work-error-keeps-data', keepCards >= 1 && errBanner >= 1, `cards=${keepCards} banner=${errBanner}`);
  await shot(page, '22-ops-work-error-keeps-data', { page: 'operations', role: 'admin', viewport: '1440x900', state: 'work-error-with-data', goal: '错误不覆盖已有待办', routeIntercept: true, simulated: true });

  // retry recovers
  await page.unroute('**/api/operations/admin/dashboard');
  await page.route('**/api/operations/admin/dashboard', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ code: '0', data: { items: [{ id: 2, business_type: 'proof', business_id: 2, title: 'AFTER_RETRY', priority: 0, assignee_id: null, due_at: null, status: 0, version: 1 }], summary: { open: 1 } } })
    });
  });
  await page.locator('#ops-panel-work .ops-state.is-error button:has-text("重试")').click();
  await page.waitForTimeout(400);
  assert('work-retry-ok', await page.locator('#ops-panel-work .ops-card h3', { hasText: 'AFTER_RETRY' }).count() >= 1 && (await page.locator('#ops-panel-work .ops-state.is-error').count()) === 0, 'retry failed');
  await page.unroute('**/api/operations/admin/dashboard');

  // loading with data shows inline status, not full replace
  await page.route('**/api/operations/admin/dashboard', async (route) => {
    await new Promise((r) => setTimeout(r, 800));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ code: '0', data: { items: [{ id: 3, business_type: 'visit_plan', business_id: 3, title: 'AFTER_LOAD', priority: 0, assignee_id: null, due_at: null, status: 0, version: 1 }], summary: { open: 1 } } })
    });
  });
  await page.evaluate(() => {
    const vm = document.querySelector('#workspace').__vue__;
    vm.workItems = [{ id: 9, business_type: 'adopt', business_id: 9, title: 'WHILE_LOADING', priority: 0, assignee_id: null, due_at: null, status: 0, version: 1 }];
    vm.loadWork();
  });
  await page.waitForTimeout(100);
  const whileLoading = await page.evaluate(() => ({
    inline: !!document.querySelector('#ops-panel-work .ops-inline-status'),
    card: [...document.querySelectorAll('#ops-panel-work .ops-card h3')].some((h) => /WHILE_LOADING/.test(h.textContent)),
    fullOnly: !!document.querySelector('#ops-panel-work .ops-state') && !document.querySelector('#ops-panel-work .ops-card')
  }));
  assert('work-loading-keeps-data', whileLoading.inline && whileLoading.card && !whileLoading.fullOnly, JSON.stringify(whileLoading));
  await shot(page, '23-ops-work-loading-refresh', { page: 'operations', role: 'admin', viewport: '1440x900', state: 'work-loading-with-data', goal: '刷新 loading 不整页替换', routeIntercept: true, simulated: true });
  await page.waitForTimeout(900);
  await page.unroute('**/api/operations/admin/dashboard');

  // success feedback visible
  await page.evaluate(() => {
    const vm = document.querySelector('#workspace').__vue__;
    vm.clearFeedback();
    vm.notify('待办已更新');
  });
  assert('success-feedback', /待办已更新/.test(await page.locator('.ops-feedback').innerText()) && !(await page.locator('.ops-feedback').getAttribute('class') || '').includes('error'), 'no success');
  await shot(page, '24-ops-success-feedback', { page: 'operations', role: 'admin', viewport: '1440x900', state: 'success-msg', goal: '成功反馈', simulated: false });

  // tasks error keeps data
  await page.getByRole('tab', { name: '义工任务' }).click();
  await page.waitForTimeout(200);
  await page.evaluate(() => {
    const vm = document.querySelector('#workspace').__vue__;
    vm.tasks = [{ id: 10, title: 'TASK_KEEP', location: 'x', start_at: '2030-01-01T00:00:00', end_at: '2030-01-01T01:00:00', capacity: 2, status: 1, signup_count: 0, version: 1 }];
    vm.tasksError = '';
  });
  await page.route('**/api/operations/admin/volunteer-tasks', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill(expectedErrorFulfill(500, { code: '500', msg: '任务加载失败审计' }));
      return;
    }
    await route.continue();
  });
  await page.evaluate(() => document.querySelector('#workspace').__vue__.loadTasks());
  await page.waitForTimeout(350);
  assert('tasks-error-keeps-data',
    await page.locator('#ops-panel-tasks .ops-card h3', { hasText: 'TASK_KEEP' }).count() >= 1 &&
    await page.locator('#ops-panel-tasks .ops-state.is-error').count() >= 1,
    'tasks error replaced data');
  await shot(page, '25-ops-tasks-error-keeps-data', { page: 'operations', role: 'admin', viewport: '1440x900', state: 'tasks-error', goal: '义工错误保留列表', routeIntercept: true, simulated: true });
  await page.unroute('**/api/operations/admin/volunteer-tasks');

  // medical error keeps records
  await page.getByRole('tab', { name: '医疗档案' }).click();
  await page.waitForTimeout(200);
  await page.evaluate(() => {
    const vm = document.querySelector('#workspace').__vue__;
    vm.medicalAnimalId = 12;
    vm.medicalQueried = true;
    vm.medicalRecords = [{ id: 1, record_type: 'exam', title: 'MED_KEEP', content: 'c', visibility: 'public', occurred_at: '2026-01-01T00:00:00', asset_flag: null }];
    vm.medicalError = '';
  });
  await page.route('**/api/operations/animals/*/medical', async (route) => {
    await route.fulfill(expectedErrorFulfill(500, { code: '500', msg: '档案加载失败审计' }));
  });
  await page.evaluate(() => document.querySelector('#workspace').__vue__.loadMedical());
  await page.waitForTimeout(350);
  assert('medical-error-keeps-data',
    await page.locator('#ops-panel-medical .ops-card h3', { hasText: 'MED_KEEP' }).count() >= 1 &&
    await page.locator('#ops-panel-medical .ops-state.is-error').count() >= 1,
    'medical error replaced data');
  await shot(page, '26-ops-medical-error-keeps-data', { page: 'operations', role: 'admin', viewport: '1440x900', state: 'medical-error-with-data', goal: '医疗错误保留列表', routeIntercept: true, simulated: true });
  await page.unroute('**/api/operations/animals/*/medical');

  // work empty evidence (deterministic UI state + route reload)
  await page.getByRole('tab', { name: '统一待办' }).click();
  await page.waitForTimeout(150);
  await page.route('**/api/operations/admin/dashboard**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ code: '0', data: { items: [], summary: { open: 0 } } }) });
  });
  await page.evaluate(() => {
    const vm = document.querySelector('#workspace').__vue__;
    vm.workItems = [];
    vm.workError = '';
    vm.loadingWork = false;
    vm.summary = { open: 0 };
  });
  await page.waitForTimeout(50);
  let emptyPanel = await page.locator('#ops-panel-work').innerText();
  assert('work-empty', /当前没有开放待办/.test(emptyPanel), emptyPanel.slice(0, 160));
  await page.evaluate(() => document.querySelector('#workspace').__vue__.loadWork());
  await page.waitForTimeout(400);
  emptyPanel = await page.locator('#ops-panel-work').innerText();
  assert('work-empty-after-load', /当前没有开放待办/.test(emptyPanel) && (await page.locator('#ops-panel-work .ops-card').count()) === 0, emptyPanel.slice(0, 160));
  await shot(page, '27-ops-work-empty', { page: 'operations', role: 'admin', viewport: '1440x900', state: 'work-empty', goal: '待办 empty', routeIntercept: true, simulated: true });
  await page.unroute('**/api/operations/admin/dashboard**');

  // 360 three-tab evidence
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto(base + '/page/end/operations.html', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForSelector('[role="tablist"]');
  await page.waitForTimeout(400);
  await shot(page, '28-ops-360-work', { page: 'operations', role: 'admin', viewport: '360x800', state: 'work', goal: '360 待办' });
  await page.getByRole('tab', { name: '义工任务' }).click();
  await page.waitForTimeout(250);
  await shot(page, '29-ops-360-tasks', { page: 'operations', role: 'admin', viewport: '360x800', state: 'tasks', goal: '360 义工' });
  await page.getByRole('tab', { name: '医疗档案' }).click();
  await page.waitForTimeout(250);
  await shot(page, '30-ops-360-medical', { page: 'operations', role: 'admin', viewport: '360x800', state: 'medical', goal: '360 医疗' });
  await page.setViewportSize({ width: 1440, height: 900 });

  // ——— Same-tab feedback residual (strict) ———
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(base + '/page/end/operations.html', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForSelector('[role="tablist"]');
  await page.waitForTimeout(400);

  // task 409 then open signups successfully -> 409 gone
  await page.getByRole('tab', { name: '义工任务' }).click();
  await page.waitForTimeout(200);
  await page.route('**/api/operations/admin/volunteer-tasks/*/status', async (route) => {
    await route.fulfill(expectedErrorFulfill(409, { code: '409', msg: '任务已被其他管理员更新' }));
  });
  await page.evaluate(() => {
    document.querySelector('#workspace').__vue__.setTaskState({ id: 102, status: 1, version: 4, title: 'x' }, 2);
  });
  await page.waitForTimeout(200);
  assert('fb-task-409-shown', /任务已被其他管理员更新|刷新/.test(await page.locator('.ops-feedback').innerText().catch(() => '')), 'no 409');
  await page.unroute('**/api/operations/admin/volunteer-tasks/*/status');
  await page.route('**/api/operations/admin/volunteer-tasks/*/signups', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ code: '0', data: SAMPLE_SIGNUPS }) });
  });
  await page.evaluate((task) => {
    document.querySelector('#workspace').__vue__.openSignups(task);
  }, SAMPLE_TASKS[1]);
  await page.waitForTimeout(300);
  assert('fb-open-signups-clears-409', (await page.locator('.ops-feedback').count()) === 0, await page.locator('.ops-feedback').innerText().catch(() => 'still shown'));
  assert('fb-signups-loaded', await page.locator('.ops-signups').count() >= 1 && /alice/.test(await page.locator('.ops-signups').innerText()), 'no list');
  await shot(page, '31-ops-signups-clean-feedback', { page: 'operations', role: 'admin', viewport: '1440x900', state: 'signups-no-stale-409', goal: '报名成功且无旧409', routeIntercept: true, simulated: true });

  // assign 409 then successful openSignups again
  await page.route('**/api/operations/admin/volunteer-signups/*/assign', async (route) => {
    await route.fulfill(expectedErrorFulfill(409, { code: '409', msg: '报名已被更新' }));
  });
  await page.evaluate(() => document.querySelector('#workspace').__vue__.assign({ id: 201, version: 1, status: 0 }, true));
  await page.waitForTimeout(200);
  assert('fb-assign-409-shown', /报名/.test(await page.locator('.ops-feedback').innerText().catch(() => '')), 'no assign 409');
  await page.unroute('**/api/operations/admin/volunteer-signups/*/assign');
  await page.evaluate((task) => document.querySelector('#workspace').__vue__.openSignups(task), SAMPLE_TASKS[1]);
  await page.waitForTimeout(250);
  assert('fb-resignups-clears-assign-409', (await page.locator('.ops-feedback').count()) === 0, 'stale assign 409');

  // medical save fail then successful query clears
  await page.getByRole('tab', { name: '医疗档案' }).click();
  await page.waitForTimeout(200);
  await page.route('**/api/operations/admin/animals/*/medical', async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill(expectedErrorFulfill(400, { code: '400', msg: '保存失败审计残留' }));
      return;
    }
    await route.continue();
  });
  await page.evaluate(() => {
    const vm = document.querySelector('#workspace').__vue__;
    vm.medicalForm = { animalId: 12, recordType: 'exam', title: 'FAIL_THEN_QUERY', occurredAt: '2026-07-01T10:00', visibility: 'public', content: 'x' };
    vm.medicalFile = null;
    vm.createMedical();
  });
  await page.waitForTimeout(300);
  assert('fb-medical-save-fail', /保存失败/.test(await page.locator('.ops-feedback').innerText().catch(() => '')), 'no save fail');
  await page.unroute('**/api/operations/admin/animals/*/medical');
  await page.route('**/api/operations/animals/*/medical', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ code: '0', data: SAMPLE_MEDICAL }) });
  });
  await page.evaluate(() => {
    const vm = document.querySelector('#workspace').__vue__;
    vm.medicalAnimalId = 12;
    vm.loadMedical(false);
  });
  await page.waitForTimeout(350);
  assert('fb-medical-query-clears-save-error', (await page.locator('.ops-feedback').count()) === 0, await page.locator('.ops-feedback').innerText().catch(() => 'still'));
  assert('fb-medical-populated-clean', /年度体检|公开/.test(await page.locator('#ops-panel-medical').innerText()), 'no records');
  await shot(page, '32-ops-medical-populated-clean', { page: 'operations', role: 'admin', viewport: '1440x900', state: 'medical-populated-clean', goal: '医疗成功查询无旧错误', routeIntercept: true, simulated: true });

  // medical query fail then success clears
  await page.unroute('**/api/operations/animals/*/medical').catch(() => {});
  await page.route('**/api/operations/animals/*/medical', async (route) => {
    await route.fulfill(expectedErrorFulfill(500, { code: '500', msg: '档案加载失败审计' }));
  });
  await page.evaluate(() => {
    const vm = document.querySelector('#workspace').__vue__;
    vm.medicalAnimalId = 12;
    vm.loadMedical(false);
  });
  await page.waitForTimeout(400);
  const medFailText = await page.evaluate(() => {
    const fb = document.querySelector('.ops-feedback');
    const st = document.querySelector('#ops-panel-medical .ops-state.is-error');
    return ((fb && fb.textContent) || '') + '|' + ((st && st.textContent) || '');
  });
  assert('fb-medical-query-fail', /档案加载失败/.test(medFailText), medFailText || 'no fail');
  await page.unroute('**/api/operations/animals/*/medical');
  await page.route('**/api/operations/animals/*/medical', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ code: '0', data: SAMPLE_MEDICAL }) });
  });
  await page.evaluate(() => document.querySelector('#workspace').__vue__.loadMedical(false));
  await page.waitForTimeout(350);
  assert('fb-medical-requery-clears', (await page.locator('.ops-feedback').count()) === 0 && (await page.locator('#ops-panel-medical .ops-state.is-error').count()) === 0, 'stale error');

  // create task success + internal loadTasks preserves message
  await page.getByRole('tab', { name: '义工任务' }).click();
  await page.waitForTimeout(150);
  let createN = 0;
  await page.route('**/api/operations/admin/volunteer-tasks', async (route) => {
    if (route.request().method() === 'POST') {
      createN++;
      await new Promise((r) => setTimeout(r, 900));
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ code: '0', data: 1001 }) });
      return;
    }
    if (route.request().method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ code: '0', data: SAMPLE_TASKS }) });
      return;
    }
    await route.continue();
  });
  await page.evaluate(() => { document.querySelector('#workspace').__vue__.taskComposeOpen = true; });
  await page.fill('#opsTaskCompose input[maxlength="120"]', 'UI_AUDIT_2A_LOAD');
  const dts = page.locator('#opsTaskCompose input[type="datetime-local"]');
  await dts.nth(0).fill('2030-08-01T09:00');
  await dts.nth(1).fill('2030-08-01T12:00');
  await page.locator('#opsTaskCompose input[type="number"]').fill('4');
  createN = 0;
  const createClick = page.locator('#opsTaskCompose button[type="submit"]');
  await createClick.click();
  await page.waitForTimeout(100);
  // pending loading assertions
  const loadState = await page.evaluate(() => {
    const vm = document.querySelector('#workspace').__vue__;
    const btn = document.querySelector('#opsTaskCompose button[type="submit"]');
    return {
      saving: vm.saving,
      loadingClass: btn && btn.classList.contains('is-loading'),
      disabled: btn && btn.disabled,
      ariaBusy: btn && btn.getAttribute('aria-busy'),
      childOpacity: btn ? getComputedStyle(btn.querySelector('.ui-icon') || btn).opacity : null
    };
  });
  assert('task-create-loading-state', loadState.saving && loadState.loadingClass && loadState.disabled && loadState.ariaBusy === 'true', JSON.stringify(loadState));
  await createClick.click({ force: true }).catch(() => {});
  await page.waitForTimeout(50);
  assert('task-create-loading-once', createN === 1, 'posts=' + createN);
  await shot(page, '08-ops-task-create-loading', { page: 'operations', role: 'admin', viewport: '1440x900', state: 'task-create-loading', goal: '真实创建 loading', routeIntercept: true, simulated: true });
  await page.waitForTimeout(1000);
  const afterCreate = await page.locator('.ops-feedback').innerText().catch(() => '');
  assert('task-create-success-kept', /任务已创建/.test(afterCreate), afterCreate);
  await shot(page, '08b-ops-task-create-success', { page: 'operations', role: 'admin', viewport: '1440x900', state: 'task-create-success', goal: '创建成功且内部刷新保留消息', routeIntercept: true, simulated: true });
  await page.unroute('**/api/operations/admin/volunteer-tasks');

  // medical uploading + saving real loading
  await page.getByRole('tab', { name: '医疗档案' }).click();
  await page.waitForTimeout(150);
  let uploadN = 0;
  let medPostN = 0;
  await page.route('**/api/files/upload', async (route) => {
    uploadN++;
    await new Promise((r) => setTimeout(r, 900));
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ code: '0', data: { flag: 'load-flag-1' } }) });
  });
  await page.route('**/api/operations/admin/animals/*/medical', async (route) => {
    if (route.request().method() === 'POST') {
      medPostN++;
      await new Promise((r) => setTimeout(r, 900));
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ code: '0', data: 1 }) });
      return;
    }
    await route.continue();
  });
  await page.route('**/api/operations/animals/*/medical', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ code: '0', data: SAMPLE_MEDICAL }) });
  });
  const medPanelLoad = page.locator('#ops-panel-medical');
  await medPanelLoad.locator('input[type="number"]').first().fill('12');
  await medPanelLoad.locator('input[maxlength="120"]').fill('LOAD_MED');
  await medPanelLoad.locator('input[type="datetime-local"]').fill('2026-07-03T10:00');
  await page.setInputFiles('#ops-panel-medical input[type="file"]', {
    name: 'load.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4')
  });
  uploadN = 0; medPostN = 0;
  const medSaveBtn = medPanelLoad.getByRole('button', { name: /保存医疗记录|正在保存|正在上传/ });
  await medSaveBtn.click();
  await page.waitForTimeout(120);
  const upState = await page.evaluate(() => {
    const vm = document.querySelector('#workspace').__vue__;
    const btn = document.querySelector('#ops-panel-medical .ops-medical-block button.is-primary');
    return { uploading: vm.uploading, saving: vm.saving, loading: btn && btn.classList.contains('is-loading'), disabled: btn && btn.disabled, busy: btn && btn.getAttribute('aria-busy') };
  });
  assert('medical-uploading-state', upState.uploading && upState.saving && upState.loading && upState.disabled && upState.busy === 'true', JSON.stringify(upState));
  await medSaveBtn.click({ force: true }).catch(() => {});
  await page.waitForTimeout(40);
  assert('medical-upload-once', uploadN === 1, 'uploads=' + uploadN);
  await shot(page, '12a-ops-medical-uploading', { page: 'operations', role: 'admin', viewport: '1440x900', state: 'medical-uploading', goal: '真实上传 loading', routeIntercept: true, simulated: true });
  for (let i = 0; i < 30; i++) {
    const st = await page.evaluate(() => {
      const vm = document.querySelector('#workspace').__vue__;
      return { uploading: vm.uploading, saving: vm.saving };
    });
    if (!st.uploading && st.saving) break;
    await page.waitForTimeout(50);
  }
  const saveState = await page.evaluate(() => {
    const vm = document.querySelector('#workspace').__vue__;
    const btn = document.querySelector('#ops-panel-medical .ops-medical-block button.is-primary');
    return { uploading: vm.uploading, saving: vm.saving, loading: btn && btn.classList.contains('is-loading'), disabled: btn && btn.disabled, busy: btn && btn.getAttribute('aria-busy') };
  });
  assert('medical-saving-state', !saveState.uploading && saveState.saving && saveState.loading && saveState.disabled && saveState.busy === 'true', JSON.stringify(saveState));
  await shot(page, '12b-ops-medical-saving', { page: 'operations', role: 'admin', viewport: '1440x900', state: 'medical-saving', goal: '真实保存 loading', routeIntercept: true, simulated: true });
  await page.waitForTimeout(1000);
  const medSuccess = await page.locator('.ops-feedback').innerText().catch(() => '');
  assert('medical-success-kept', /医疗记录已保存/.test(medSuccess), medSuccess);
  await shot(page, '12c-ops-medical-success', { page: 'operations', role: 'admin', viewport: '1440x900', state: 'medical-success', goal: '医疗保存成功保留消息', routeIntercept: true, simulated: true });
  assert('medical-post-once', medPostN === 1, 'posts=' + medPostN);

  await page.evaluate(() => {
    const vm = document.querySelector('#workspace').__vue__;
    vm.medicalFile = null;
    if (vm.$refs.medicalFile) vm.$refs.medicalFile.value = '';
    vm.medicalForm = { animalId: 12, recordType: 'exam', title: 'NO_FILE', occurredAt: '2026-07-04T10:00', visibility: 'public', content: 'c' };
  });
  medPostN = 0;
  await medPanelLoad.getByRole('button', { name: /保存医疗记录|正在保存|正在上传/ }).click();
  await page.waitForTimeout(100);
  const noFileLoad = await page.evaluate(() => {
    const vm = document.querySelector('#workspace').__vue__;
    const btn = document.querySelector('#ops-panel-medical .ops-medical-block button.is-primary');
    return { saving: vm.saving, uploading: vm.uploading, loading: btn.classList.contains('is-loading') };
  });
  assert('medical-nofile-saving', noFileLoad.saving && !noFileLoad.uploading && noFileLoad.loading, JSON.stringify(noFileLoad));
  await page.waitForTimeout(1000);

  // same-tab reverse order race
  await page.getByRole('tab', { name: '义工任务' }).click();
  await page.waitForTimeout(100);
  await page.evaluate(() => {
    const vm = document.querySelector('#workspace').__vue__;
    const a = vm.beginUserOp('tasks');
    const b = vm.beginUserOp('tasks');
    vm.notifyFor(a, '旧操作失败', true);
    vm.notifyFor(b, '新操作成功');
  });
  const revText = await page.evaluate(() => (document.querySelector('.ops-feedback') || {}).textContent || '');
  assert('same-tab-reverse-order', /新操作成功/.test(revText) && !/旧操作失败/.test(revText), revText || 'no feedback');

  // cross-tab races still
  await page.evaluate(() => {
    const vm = document.querySelector('#workspace').__vue__;
    const token = vm.beginUserOp('work');
    vm.selectTab('medical');
    vm.notifyFor(token, '待办已更新-竞态');
  });
  assert('race-work-to-medical-2', (await page.locator('.ops-feedback').count()) === 0, 'stale');
  await page.evaluate(() => {
    const vm = document.querySelector('#workspace').__vue__;
    const token = vm.beginUserOp('tasks');
    vm.selectTab('work');
    vm.notifyFor(token, '任务失败-竞态', true);
  });
  assert('race-tasks-to-work-2', (await page.locator('.ops-feedback').count()) === 0, 'stale');
  await page.evaluate(() => {
    const vm = document.querySelector('#workspace').__vue__;
    const token = vm.beginUserOp('medical');
    vm.selectTab('tasks');
    vm.notifyFor(token, '医疗成功-竞态');
  });
  assert('race-medical-to-tasks-2', (await page.locator('.ops-feedback').count()) === 0, 'stale');

  // strict console / network classification (header-tagged expected only)
  const expectedHttpErrors = [];
  const unexpectedHttpErrors = [];
  const staticImageNoise = [];
  for (const entry of httpErrorLog) {
    const c = classifyHttpError(entry);
    if (c.kind === 'expectedHttpError') expectedHttpErrors.push(c);
    else if (c.kind === 'staticImageNoise') staticImageNoise.push(c);
    else unexpectedHttpErrors.push(c);
  }
  const consoleClass = finalizeConsoleClassification(consoleErrors, expectedHttpErrors);
  const expectedConsoleNoise = consoleClass.expectedConsoleNoise;
  const realConsoleErrors = consoleClass.realConsoleErrors;

  results.consoleAudit = {
    intentionalErrorResponses: expectedHttpErrors,
    unexpectedHttpErrors,
    expectedConsoleNoise,
    realConsoleErrors,
    pageErrors: pageErrors.slice(),
    staticImageNoise,
    consoleErrorTotal: consoleErrors.length,
    expectedHttpCount: expectedHttpErrors.length,
    expectedConsoleNoiseCount: expectedConsoleNoise.length,
    realConsoleErrorCount: realConsoleErrors.length,
    unexpectedHttpCount: unexpectedHttpErrors.length,
    pageErrorCount: pageErrors.length,
    ignoreRule: 'Only responses with header x-ui-audit-expected-error: phase2a; console Failed-to-load matched 1:1 by status to those; static image 404 only (never API)'
  };
  assert('pageerror-clean', pageErrors.length === 0, pageErrors.slice(0, 3).join('|'));
  assert('unexpected-http-clean', unexpectedHttpErrors.length === 0, JSON.stringify(unexpectedHttpErrors.slice(0, 8)));
  assert('real-console-error-clean', realConsoleErrors.length === 0, realConsoleErrors.slice(0, 5).join(' || '));
  assert(
    'expected-console-matches-tagged-http',
    expectedConsoleNoise.length <= expectedHttpErrors.length,
    'noise=' + expectedConsoleNoise.length + ' tagged=' + expectedHttpErrors.length
  );
  assert(
    'intentional-errors-recorded',
    expectedHttpErrors.length >= 8,
    'tagged=' + expectedHttpErrors.length + ' samples=' + JSON.stringify(expectedHttpErrors.slice(0, 3))
  );

  // Viewport matrix 3 tabs × 7
  // restore volunteer tasks route for populated states
  await page.unroute('**/api/operations/admin/volunteer-tasks');
  await page.route('**/api/operations/admin/volunteer-tasks', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ code: '0', data: SAMPLE_TASKS }) });
      return;
    }
    await route.continue();
  });

  for (const vp of VIEWPORTS) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto(base + '/page/end/operations.html', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForSelector('[role="tablist"]', { timeout: 15000 });
    await page.waitForTimeout(400);
    for (const tabKey of TABS) {
      const nameMap = { work: '统一待办', tasks: '义工任务', medical: '医疗档案' };
      await page.getByRole('tab', { name: nameMap[tabKey] }).click();
      await page.waitForTimeout(350);
      if (tabKey === 'tasks') {
        await page.evaluate(() => {
          const vm = document.querySelector('#workspace').__vue__;
          if (vm) vm.loadTasks();
        });
        await page.waitForTimeout(250);
      }
      const m = await page.evaluate((key) => {
        const overflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
        const panel = document.getElementById('ops-panel-' + key);
        const tabs = [...document.querySelectorAll('[role="tab"]')];
        const touchBad = tabs.filter((t) => {
          const r = t.getBoundingClientRect();
          return r.width > 0 && (r.height < 44 || r.width < 44);
        }).length;
        const tabsReachable = tabs.every((t) => {
          const r = t.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        });
        // 主操作按钮存在即可达（允许滚动到达，不要求首屏可见）
        const primary = panel && panel.querySelector('button[type="submit"], .ui-button.is-primary, .ui-button.is-dark, .ui-button.is-ghost');
        const pr = primary && primary.getBoundingClientRect();
        const primaryOk = !primary || (pr.width > 0 && pr.height >= 40);
        return {
          overflow,
          touchBad,
          panelVisible: panel && getComputedStyle(panel).display !== 'none',
          tabsReachable,
          primaryOk
        };
      }, tabKey);
      assert(`vp-${vp.name}-${tabKey}`, m.overflow <= 1 && m.touchBad === 0 && m.panelVisible && m.tabsReachable && m.primaryOk, JSON.stringify(m));
    }
    // signups responsive on tasks
    await page.getByRole('tab', { name: '义工任务' }).click();
    await page.waitForTimeout(200);
    await page.route('**/api/operations/admin/volunteer-tasks/*/signups', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ code: '0', data: SAMPLE_SIGNUPS }) });
    });
    await page.evaluate((task) => {
      document.querySelector('#workspace').__vue__.openSignups(task);
    }, SAMPLE_TASKS[1]);
    await page.waitForTimeout(250);
    const resp = await page.evaluate(() => {
      const table = document.querySelector('.ops-table');
      const cards = document.querySelector('.ops-signup-cards');
      return {
        table: table ? getComputedStyle(table).display : 'none',
        cards: cards ? getComputedStyle(cards).display : 'none',
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
      };
    });
    if (vp.width >= 768) {
      assert('signups-layout-' + vp.name, resp.table !== 'none' && resp.cards === 'none' && resp.overflow <= 1, JSON.stringify(resp));
    } else {
      assert('signups-layout-' + vp.name, resp.table === 'none' && resp.cards !== 'none' && resp.overflow <= 1, JSON.stringify(resp));
    }
    if (vp.name === '390x844') {
      await shot(page, '16-ops-390-tasks-signups', { page: 'operations', role: 'admin', viewport: vp.name, state: 'signups-cards', goal: '390 报名卡片', routeIntercept: true, simulated: true });
      await page.getByRole('tab', { name: '统一待办' }).click();
      await page.waitForTimeout(150);
      await shot(page, '17-ops-390-work', { page: 'operations', role: 'admin', viewport: vp.name, state: 'work', goal: '390 待办' });
      await page.getByRole('tab', { name: '医疗档案' }).click();
      await page.waitForTimeout(150);
      await shot(page, '18-ops-390-medical', { page: 'operations', role: 'admin', viewport: vp.name, state: 'medical', goal: '390 医疗' });
    }
    if (vp.name === '360x800') {
      await shot(page, '19-ops-360-tasks', { page: 'operations', role: 'admin', viewport: vp.name, state: 'tasks', goal: '360 义工' });
    }
    if (vp.name === '720x450') {
      await shot(page, '20-ops-720-200equiv', { page: 'operations', role: 'admin', viewport: vp.name, state: 'compact', goal: '等效200%' });
    }
  }

  // focus screenshot
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(base + '/page/end/operations.html', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForSelector('[role="tab"]');
  await page.locator('[role="tab"]').first().focus();
  await shot(page, '21-ops-tab-focus', { page: 'operations', role: 'admin', viewport: '1440x900', state: 'focus', goal: 'tab focus' });

  // nav/icons regression presence
  assert('nav-1b', await page.locator('.admin-desktop-nav, .ui-mobile-toggle').count() > 0, 'missing nav');
  assert('icons-1c', await page.locator('use').count() > 0, 'missing icons');

  await adminCtx.close();

  // ——— tom real ———
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await login(ctx, 'tom', '123456');
    const p = await ctx.newPage();
    await p.goto(base + '/page/end/operations.html', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await p.waitForTimeout(900);
    const url = p.url();
    assert('tom-stays-ops', /\/page\/end\/operations\.html/.test(url) && !/error=|login/.test(url), url);
    const tabs = (await p.locator('[role="tab"]').allTextContents()).map((t) => t.trim());
    assert('tom-three-tabs', tabs.includes('统一待办') && tabs.includes('义工任务') && tabs.includes('医疗档案'), tabs.join('|'));
    const dash = await ctx.request.get(base + '/api/operations/admin/dashboard');
    const dashJ = await dash.json().catch(() => ({}));
    assert('tom-dashboard-200', dash.status() === 200 && (dashJ.code === '0' || dashJ.code === 0), dash.status() + JSON.stringify(dashJ).slice(0, 80));
    const tasks = await ctx.request.get(base + '/api/operations/admin/volunteer-tasks');
    const tasksJ = await tasks.json().catch(() => ({}));
    assert('tom-tasks-200', tasks.status() === 200 && (tasksJ.code === '0' || tasksJ.code === 0), tasks.status() + JSON.stringify(tasksJ).slice(0, 80));
    await ctx.close();
  }

  // ——— jerry ———
  {
    const ctx = await browser.newContext();
    await login(ctx, 'jerry', '123456');
    const p = await ctx.newPage();
    await p.goto(base + '/page/end/operations.html', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await p.waitForTimeout(700);
    const url = p.url();
    const pageDenied = /forbidden|login|error=|need_admin/.test(url);
    const dash = await ctx.request.get(base + '/api/operations/admin/dashboard');
    const dashJ = await dash.json().catch(() => ({}));
    const tasks = await ctx.request.get(base + '/api/operations/admin/volunteer-tasks');
    const tasksJ = await tasks.json().catch(() => ({}));
    const med = await ctx.request.post(base + '/api/operations/admin/animals/1/medical', {
      headers: csrfHeaders(ctx),
      data: { recordType: 'exam', title: 'x', occurredAt: '2026-01-01T00:00:00', visibility: 'admin', content: '' }
    });
    const medJ = await med.json().catch(() => ({}));
    const apiDenied = (dash.status() === 403 || dashJ.code === '403') &&
      (tasks.status() === 403 || tasksJ.code === '403') &&
      (med.status() === 403 || medJ.code === '403');
    assert('jerry-denied-page-api', pageDenied && apiDenied, JSON.stringify({ url, dash: dash.status(), tasks: tasks.status(), med: med.status() }));
    await ctx.close();
  }

  // ——— anon ———
  {
    const ctx = await browser.newContext();
    const p = await ctx.newPage();
    await p.goto(base + '/page/end/operations.html', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await p.waitForTimeout(500);
    const url = p.url();
    const dash = await ctx.request.get(base + '/api/operations/admin/dashboard');
    const tasks = await ctx.request.get(base + '/api/operations/admin/volunteer-tasks');
    const med = await ctx.request.post(base + '/api/operations/admin/animals/1/medical', {
      data: { recordType: 'exam', title: 'x', occurredAt: '2026-01-01T00:00:00', visibility: 'admin' }
    });
    const pageDenied = /login/i.test(url);
    const apiDenied = [dash.status(), tasks.status(), med.status()].every((s) => s === 401 || s === 403);
    assert('anon-denied-page-api', pageDenied && apiDenied, JSON.stringify({ url, dash: dash.status(), tasks: tasks.status(), med: med.status() }));
    await ctx.close();
  }

  await browser.close();

  const passed = results.checks.filter((c) => c.ok).length;
  const failed = results.checks.filter((c) => !c.ok).length;
  results.summary = {
    passed,
    failed,
    total: results.checks.length,
    screenshots: results.screenshots.length,
    viewports: VIEWPORTS.length,
    tabViewportCells: TABS.length * VIEWPORTS.length,
    durationMs: Date.now() - t0,
    finishedAt: new Date().toISOString(),
    strictMode: true,
    noBestEffortPass: true
  };
  results.ok = failed === 0;
  fs.writeFileSync(path.join(out, 'phase-2a-report.json'), JSON.stringify(results, null, 2));
  fs.writeFileSync(path.join(out, 'screenshots-index.json'), JSON.stringify(results.screenshots, null, 2));
  console.log(JSON.stringify(results.summary, null, 2));
  console.log(failed ? `FAILED ${failed}/${results.checks.length}` : `ALL PASSED ${passed}`);
  if (failed) console.log(JSON.stringify(results.failures, null, 2));
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  results.fatal = String(e);
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'phase-2a-report.json'), JSON.stringify(results, null, 2));
  process.exit(1);
});
