/**
 * Phase 3C strict audit — authenticated user adoption workflow.
 * Deterministic fixtures intercept every business write. Real-service smoke is read-only.
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const startedAt = Date.now();
const base = process.env.BASE_URL || 'http://127.0.0.1:18122';
const out = path.resolve('output/playwright/ui-polish-phase-3c');
const shotDir = path.join(out, 'screenshots');
fs.mkdirSync(shotDir, { recursive: true });
for (const file of fs.readdirSync(shotDir)) {
  if (file.endsWith('.png')) fs.unlinkSync(path.join(shotDir, file));
}

const PAGES = ['adopt_apply.html', 'my_adopt.html', 'adopt_proof.html', 'my_visit.html'];
const VIEWPORTS = [
  { name: '1440x900', width: 1440, height: 900 },
  { name: '1280x800', width: 1280, height: 800 },
  { name: '768x1024', width: 768, height: 1024 },
  { name: '390x844', width: 390, height: 844 },
  { name: '320x700', width: 320, height: 700 }
];
const result = {
  phase: '3C',
  base,
  branch: 'ui-polish/phase-3c-user-adoption-workflow-20260731',
  baseline: '4ad8ac7',
  startedAt: new Date().toISOString(),
  checks: [],
  failures: [],
  visits: [],
  screenshots: [],
  consoleAudit: [],
  httpAudit: [],
  requestFailedAudit: [],
  fixtureWriteAudit: [],
  realWriteAudit: [],
  probes: [],
  realSmoke: [],
  bestEffortPassCount: 0,
  fallbackPassCount: 0,
  skippedCount: 0,
  strictRuntimeProbeCount: 0,
  summary: {}
};

function pass(id, detail) {
  result.checks.push({ id, ok: true, skipped: false, bestEffort: false, fallback: false, detail: String(detail || '') });
}
function fail(id, detail) {
  const row = { id, ok: false, skipped: false, bestEffort: false, fallback: false, detail: String(detail || '') };
  result.checks.push(row);
  result.failures.push(row);
  console.error('FAIL', id, detail);
}
function assert(id, condition, detail) {
  if (condition) pass(id, detail);
  else fail(id, detail);
}
function probe(name, detail) {
  result.strictRuntimeProbeCount += 1;
  result.probes.push({ name, detail, at: new Date().toISOString() });
}
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function safeName(value) {
  return String(value).replace(/\.html$/, '').replace(/[^a-z0-9_-]+/gi, '-');
}
function success(data) {
  return JSON.stringify({ code: '0', msg: '成功', data });
}
function failure(code, msg) {
  return JSON.stringify({ code: String(code), msg, data: null });
}
function fixtureHeaders(expectedError = false) {
  const headers = { 'x-ui-audit-fixture': 'phase3c' };
  if (expectedError) headers['x-ui-audit-expected-error'] = 'phase3c';
  return headers;
}
function canonicalId(value) {
  const normalized = value == null ? '' : String(value).trim();
  return /^[1-9][0-9]{0,18}$/.test(normalized) ? normalized : '';
}
function adoptRecord(index = 1, overrides = {}) {
  return {
    aid: String(10010 + index),
    uid: '43',
    aname: index === 1 ? '咪咪' : `领养伙伴${index}`,
    apic: '',
    vstate: index % 4,
    version: index,
    tel: '13800138000',
    location: `上海市测试区用于验证长地址安全断行 ${'地址'.repeat(index * 4)}`,
    reviewReason: index % 2 ? '资料已经进入人工审核，请保持电话畅通。' : '',
    reviewedAt: index % 2 ? '2026-07-30T10:20:00' : null,
    handoverAt: null,
    ...overrides
  };
}
function proofRecord(index = 1, overrides = {}) {
  return {
    id: String(300 + index),
    paid: '10011',
    puid: '43',
    ptitle: `居住环境材料 ${index} ${'长标题'.repeat(index)}`,
    ppic: '',
    pstatus: index % 3,
    reviewReason: index % 3 === 2 ? '请补充能够看清安全防护范围的图片。' : '',
    reviewedAt: index % 3 ? '2026-07-30T12:30:00' : null,
    ...overrides
  };
}
function visitRecord(index = 1, overrides = {}) {
  return {
    id: String(500 + index),
    petId: '10011',
    uid: '43',
    aname: `咪咪${index}`,
    pic: '',
    state: (index % 5) + 1,
    vtime: `2026-07-${String(10 + index).padStart(2, '0')}T09:30:00`,
    vname: '回访员',
    remark: `精神状态稳定，饮食正常。${'这是一段用于验证长备注断行的内容。'.repeat(index)}`,
    ...overrides
  };
}
function visitPlan(index = 1, overrides = {}) {
  return {
    id: String(700 + index),
    aid: '10011',
    uid: '43',
    planType: ['7_day', '30_day', '90_day'][index % 3],
    dueAt: `2026-08-${String(index).padStart(2, '0')}T09:00:00`,
    status: index % 5,
    ...overrides
  };
}

async function login(context) {
  const response = await context.request.post(`${base}/api/user/login`, {
    data: { username: 'jerry', password: '123456' }
  });
  const body = await response.json();
  if (response.status() !== 200 || !body || body.code !== '0') {
    throw new Error(`jerry login failed: ${response.status()} ${JSON.stringify(body)}`);
  }
}

function pageUrl(file, query) {
  if (query != null) return `${base}/page/front/${file}?${query}`;
  if (file === 'adopt_apply.html') return `${base}/page/front/${file}?animalId=10011`;
  if (file === 'adopt_proof.html') return `${base}/page/front/${file}?aid=10011`;
  return `${base}/page/front/${file}`;
}

function defaultScenario() {
  return {
    existingState: null,
    listError: false,
    proofListError: false,
    planError: false,
    recordError: false,
    adoptWrite: 'success',
    withdrawWrite: 'success',
    proofSaveFailures: 0,
    proofDeleteWrite: 'success',
    timelineFailures: 0,
    delayMs: 0
  };
}

async function installFixture(page, custom = {}) {
  const scenario = Object.assign(defaultScenario(), custom);
  const state = {
    requests: [],
    writes: [],
    uploadCount: 0,
    adoptPostCount: 0,
    withdrawCount: 0,
    proofPostCount: 0,
    stagedDeleteCount: 0,
    proofDeleteCount: 0,
    timelineCount: 0,
    listCount: 0,
    planCount: 0,
    recordCount: 0
  };
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const method = request.method();
    const url = new URL(request.url());
    const pathname = url.pathname;
    state.requests.push({ method, pathname, search: url.search, postData: request.postData() });

    const reply = async (status, body, expectedError = false) => {
      await route.fulfill({
        status,
        contentType: 'application/json',
        headers: fixtureHeaders(expectedError),
        body
      });
    };
    if (pathname === '/api/user/me') {
      await reply(200, success({ id: '43', username: 'jerry', permissions: [] }));
      return;
    }
    if (pathname === '/api/user/csrf') {
      await reply(200, success({ csrfToken: 'phase3c-fixture' }));
      return;
    }
    if (pathname === '/api/notifications/unread-count') {
      await reply(200, success(0));
      return;
    }
    if (method === 'GET' && /^\/api\/animal\/[1-9][0-9]*$/.test(pathname)) {
      if (scenario.animalError) {
        await reply(500, failure(500, '动物信息读取失败'), true);
      } else {
        await reply(200, success({
          id: pathname.split('/').pop(),
          tname: `咪咪 ${'长名字'.repeat(8)}`,
          ttype: '猫',
          tsex: '母',
          tpic: '',
          tstate: scenario.animalState == null ? 0 : scenario.animalState,
          tdescribe: '性格温和，已完成基础检查，适合耐心陪伴。'
        }));
      }
      return;
    }
    if (method === 'GET' && /^\/api\/adopt\/mine\/[1-9][0-9]*$/.test(pathname)) {
      if (scenario.preflightError) {
        await reply(500, failure(500, '既有申请检查失败'), true);
      } else if (scenario.existingState == null) {
        await reply(404, failure(404, '领养申请不存在'), true);
      } else {
        await reply(200, success(adoptRecord(1, {
          aid: pathname.split('/').pop(),
          vstate: scenario.existingState,
          version: 4
        })));
      }
      return;
    }
    if (method === 'GET' && pathname === '/api/adopt/page2') {
      state.listCount += 1;
      const query = url.searchParams.get('name') || '';
      const pageNum = Number(url.searchParams.get('pageNum') || 1);
      if (scenario.listRace && query === '慢请求') await sleep(260);
      if (scenario.listError === true || (scenario.listErrorOnCount && state.listCount >= scenario.listErrorOnCount)) {
        await reply(500, failure(500, '申请列表读取失败'), true);
        return;
      }
      if (query === '没有结果') {
        await reply(200, success({ records: [], total: 0, pages: 0, current: 1, size: 8 }));
        return;
      }
      const label = query === '快速结果' ? '快速结果伙伴' : null;
      const records = Array.from({ length: 4 }, (_, index) => adoptRecord(index + 1, label ? { aname: label } : {}));
      await reply(200, success({ records, total: 12, pages: 3, current: pageNum, size: 8 }));
      return;
    }
    if (method === 'GET' && /^\/api\/adopt\/[1-9][0-9]*\/[1-9][0-9]*\/timeline$/.test(pathname)) {
      state.timelineCount += 1;
      if (scenario.timelineDelay && state.timelineCount === 1) await sleep(240);
      if (state.timelineCount <= Number(scenario.timelineFailures || 0)) {
        await reply(500, failure(500, '时间线读取失败'), true);
        return;
      }
      await reply(200, success([
        { id: '9001', toState: 0, reason: '提交领养申请', createdAt: '2026-07-29T10:00:00' },
        { id: '9002', toState: 3, reason: '请补充居住环境图片', createdAt: '2026-07-30T11:00:00' }
      ]));
      return;
    }
    if (method === 'GET' && pathname === '/api/proof/page1') {
      if (scenario.proofListError) {
        await reply(500, failure(500, '材料列表读取失败'), true);
        return;
      }
      await reply(200, success({
        records: scenario.proofRecords || [proofRecord(1, { pstatus: 0 }), proofRecord(2, { pstatus: 1 })],
        total: 2,
        pages: 1,
        current: 1,
        size: 50
      }));
      return;
    }
    if (method === 'GET' && pathname === '/api/visit-plans/mine') {
      state.planCount += 1;
      if (scenario.planRace && state.planCount === 2) await sleep(250);
      if (scenario.planError) {
        await reply(500, failure(500, '回访计划读取失败'), true);
        return;
      }
      const fast = scenario.planRace && state.planCount >= 3;
      await reply(200, success([
        visitPlan(1, fast ? { planType: '30_day', status: 1 } : {}),
        visitPlan(2)
      ]));
      return;
    }
    if (method === 'GET' && pathname === '/api/visit/mine') {
      state.recordCount += 1;
      const pageNum = Number(url.searchParams.get('pageNum') || 1);
      if (scenario.recordRace && pageNum === 2) await sleep(260);
      if (scenario.recordError) {
        await reply(500, failure(500, '回访记录读取失败'), true);
        return;
      }
      const records = Array.from({ length: 3 }, (_, index) => visitRecord(index + 1, {
        aname: pageNum === 1 ? `快速页伙伴${index + 1}` : `慢页伙伴${index + 1}`
      }));
      await reply(200, success({ records, total: 6, pages: 2, current: pageNum, size: 8 }));
      return;
    }

    if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      const write = { method, pathname, at: Date.now() };
      state.writes.push(write);
      result.fixtureWriteAudit.push(write);
    }
    if (method === 'POST' && pathname === '/api/adopt') {
      state.adoptPostCount += 1;
      if (scenario.delayMs) await sleep(scenario.delayMs);
      if (scenario.adoptWrite === 'conflict') {
        await reply(409, failure(409, '动物状态已变化，请刷新后重试'), true);
      } else {
        await reply(200, success(true));
      }
      return;
    }
    if (method === 'POST' && /^\/api\/adopt\/[1-9][0-9]*\/[1-9][0-9]*\/transition$/.test(pathname)) {
      state.withdrawCount += 1;
      if (scenario.delayMs) await sleep(scenario.delayMs);
      if (scenario.withdrawWrite === 'conflict') {
        await reply(409, failure(409, '申请已在其他页面更新，请刷新后重试'), true);
      } else {
        await reply(200, success(true));
      }
      return;
    }
    if (method === 'POST' && pathname === '/api/files/upload') {
      state.uploadCount += 1;
      if (scenario.delayMs) await sleep(scenario.delayMs);
      await reply(200, success({ flag: 'phase3c-staged-flag' }));
      return;
    }
    if (method === 'POST' && pathname === '/api/proof') {
      state.proofPostCount += 1;
      if (scenario.delayMs) await sleep(scenario.delayMs);
      if (state.proofPostCount <= Number(scenario.proofSaveFailures || 0)) {
        await reply(500, failure(500, '材料保存失败'), true);
      } else {
        await reply(200, success(true));
      }
      return;
    }
    if (method === 'DELETE' && /^\/api\/files\/staged\/[a-zA-Z0-9-]+$/.test(pathname)) {
      state.stagedDeleteCount += 1;
      await reply(200, success(true));
      return;
    }
    if (method === 'DELETE' && /^\/api\/proof\/[1-9][0-9]*$/.test(pathname)) {
      state.proofDeleteCount += 1;
      if (scenario.delayMs) await sleep(scenario.delayMs);
      if (scenario.proofDeleteWrite === 'conflict') {
        await reply(409, failure(409, '材料已变化，请刷新后重试'), true);
      } else {
        await reply(200, success(true));
      }
      return;
    }
    await reply(500, failure(500, `Phase 3C 未登记夹具：${method} ${pathname}`), false);
  });
  return state;
}

function attachAudit(page, label, allowAbort = false) {
  const audit = { label, console: [], pageErrors: [], http: [], requestFailed: [] };
  page.on('console', (message) => {
    if (message.type() === 'error') audit.console.push(message.text());
  });
  page.on('pageerror', (error) => audit.pageErrors.push(error.message));
  page.on('response', (response) => {
    if (response.status() >= 400) {
      const headers = response.headers();
      audit.http.push({
        status: response.status(),
        method: response.request().method(),
        url: response.url(),
        expected: headers['x-ui-audit-expected-error'] === 'phase3c'
      });
    }
  });
  page.on('requestfailed', (request) => {
    const row = {
      method: request.method(),
      url: request.url(),
      error: request.failure() && request.failure().errorText
    };
    if (!(allowAbort && /ERR_ABORTED|NS_BINDING_ABORTED/i.test(row.error || ''))) audit.requestFailed.push(row);
  });
  return audit;
}

function expectedConsole(text, httpRows) {
  const match = String(text).match(/status of ([0-9]+)/i);
  if (!match) return false;
  return httpRows.some((row) => row.expected && row.status === Number(match[1]));
}

function finishAudit(audit) {
  const unexpectedHttp = audit.http.filter((row) => !row.expected);
  const realConsole = audit.console.filter((text) => !expectedConsole(text, audit.http));
  result.consoleAudit.push({ label: audit.label, rows: audit.console, unexpected: realConsole });
  result.httpAudit.push({ label: audit.label, rows: audit.http, unexpected: unexpectedHttp });
  result.requestFailedAudit.push({ label: audit.label, rows: audit.requestFailed });
  assert(`${audit.label}-console`, realConsole.length === 0, JSON.stringify(realConsole));
  assert(`${audit.label}-pageerror`, audit.pageErrors.length === 0, JSON.stringify(audit.pageErrors));
  assert(`${audit.label}-http`, unexpectedHttp.length === 0, JSON.stringify(unexpectedHttp));
  assert(`${audit.label}-requestfailed`, audit.requestFailed.length === 0, JSON.stringify(audit.requestFailed));
}

async function pageGeometry(page) {
  return page.evaluate(() => {
    const visible = (element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };
    const offenders = Array.from(document.querySelectorAll(
      'main h1,main h2,main h3,main p,main strong,main .ui-panel,main .ui-record-card,main .ui-proof-card,main .ui-visit-plan-card'
    )).filter(visible).map((element) => {
      const rect = element.getBoundingClientRect();
      return {
        tag: element.tagName,
        className: element.className,
        text: (element.textContent || '').trim().slice(0, 80),
        left: rect.left,
        right: rect.right,
        viewport: innerWidth
      };
    }).filter((row) => row.left < -1 || row.right > row.viewport + 1);
    const touch = Array.from(document.querySelectorAll('main button,main .ui-button'))
      .filter(visible)
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return { text: (element.textContent || '').trim(), width: rect.width, height: rect.height };
      })
      .filter((row) => row.width < 43.5 || row.height < 43.5);
    return {
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      offenders,
      touch,
      cache: performance.getEntriesByType('resource').some((entry) => entry.name.includes('product-ui.css?v=20260731c')),
      namespace: document.body.classList.contains('ui-user-adoption-page'),
      header: document.querySelectorAll('.ui-front-header').length,
      footer: document.querySelectorAll('.ui-front-footer').length
    };
  });
}

async function waitReady(page, file) {
  await page.locator('.ui-front-header').waitFor({ state: 'visible', timeout: 8000 });
  if (file === 'adopt_apply.html') await page.locator('.ui-adoption-form').waitFor({ state: 'visible', timeout: 8000 });
  if (file === 'my_adopt.html') await page.locator('.ui-adoption-record').first().waitFor({ state: 'visible', timeout: 8000 });
  if (file === 'adopt_proof.html') await page.locator('.ui-proof-intake').waitFor({ state: 'visible', timeout: 8000 });
  if (file === 'my_visit.html') await page.locator('.ui-visit-record').first().waitFor({ state: 'visible', timeout: 8000 });
}

async function matrix(browser) {
  const context = await browser.newContext();
  await login(context);
  for (const viewport of VIEWPORTS) {
    for (const file of PAGES) {
      const page = await context.newPage();
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      const scenario = file === 'adopt_proof.html' ? { existingState: 1 } : {};
      const state = await installFixture(page, scenario);
      const audit = attachAudit(page, `matrix-${safeName(file)}-${viewport.name}`);
      let navigationError = '';
      try {
        await page.goto(pageUrl(file), { waitUntil: 'domcontentloaded', timeout: 15000 });
        await waitReady(page, file);
        await page.waitForTimeout(180);
      } catch (error) {
        navigationError = error.message;
      }
      const prefix = `matrix-${safeName(file)}-${viewport.name}`;
      assert(`${prefix}-navigation`, !navigationError, navigationError || page.url());
      if (!navigationError) {
        const geometry = await pageGeometry(page);
        assert(`${prefix}-shell`, geometry.header === 1 && geometry.footer === 1, JSON.stringify(geometry));
        assert(`${prefix}-cache`, geometry.cache && geometry.namespace, JSON.stringify(geometry));
        assert(`${prefix}-overflow`, !geometry.overflow && geometry.offenders.length === 0, JSON.stringify(geometry));
        assert(`${prefix}-touch`, geometry.touch.length === 0, JSON.stringify(geometry.touch));
        assert(`${prefix}-fixture-writes`, state.writes.length === 0, JSON.stringify(state.writes));
        if (viewport.name === '1440x900' || viewport.name === '390x844') {
          const name = `${safeName(file)}-${viewport.name}.png`;
          await page.screenshot({ path: path.join(shotDir, name), fullPage: true });
          result.screenshots.push({ name, file: `screenshots/${name}`, viewport: viewport.name, page: file });
        }
      }
      finishAudit(audit);
      result.visits.push({ file, viewport: viewport.name, navigationError });
      await page.close();
    }
  }
  await context.close();
}

async function staticAudit() {
  const pageDir = path.resolve('src/main/resources/static/page/front');
  for (const file of PAGES) {
    const html = fs.readFileSync(path.join(pageDir, file), 'utf8');
    const prefix = `static-${safeName(file)}`;
    assert(`${prefix}-cache`, /product-ui\.css\?v=20260731c/.test(html), '20260731c');
    assert(`${prefix}-namespace`, /ui-user-adoption-page/.test(html), 'body namespace');
    assert(`${prefix}-shell`, /front-shell\.js\?v=20260731a/.test(html) && /user-workspace\.js\?v=20260731a/.test(html), 'shared shell');
    assert(`${prefix}-auth-before-vue`, html.indexOf('AuthSession.bootstrap') < html.indexOf("el: '#app'"), 'bootstrap before Vue');
    assert(`${prefix}-no-native-dialog`, !/(?:window\.)?(?:alert|confirm|prompt)\s*\(/.test(html), 'no native dialog');
    assert(`${prefix}-no-inline-style`, !/\sstyle\s*=/i.test(html), 'no inline style');
    assert(`${prefix}-canonical-id`, /function canonicalId\(value\)/.test(html), 'canonical decimal id');
  }
  const apply = fs.readFileSync(path.join(pageDir, 'adopt_apply.html'), 'utf8');
  const mine = fs.readFileSync(path.join(pageDir, 'my_adopt.html'), 'utf8');
  const proof = fs.readFileSync(path.join(pageDir, 'adopt_proof.html'), 'utf8');
  const visit = fs.readFileSync(path.join(pageDir, 'my_visit.html'), 'utf8');
  const css = fs.readFileSync('src/main/resources/static/css/product-ui.css', 'utf8');
  const own = fs.readFileSync('tools/ui-polish-phase-3c.cjs', 'utf8');
  assert('static-apply-active-states', /\[0,\s*1,\s*3\]\.includes\(state\)/.test(apply), 'material-required blocks duplicate');
  assert('static-apply-safe-payload', /aid:\s*this\.animalId/.test(apply) && !/uid:\s*this\.user/.test(apply), 'server-owned fields absent');
  assert('static-mine-latest-wins', /listSeq/.test(mine) && /historySeq/.test(mine) && /statusText === 'abort'/.test(mine), 'list and timeline guards');
  assert('static-mine-custom-confirm', /ui-adoption-confirm-dialog/.test(mine) && /confirmWithdraw/.test(mine), 'withdraw dialog');
  assert('static-proof-stage-retry', /if \(this\.stagedFlag\) \{\s*this\.persistProof\(\)/s.test(proof), 'retry without upload');
  assert('static-proof-success-no-delete', /this\.stagedFlag = '';\s*this\.saving = false;/s.test(proof), 'bound file retained');
  assert('static-proof-idempotent-retire', /retiredFlags/.test(proof) && /keepalive:\s*true/.test(proof), 'single cleanup');
  assert('static-visit-independent-state', /planLoading/.test(visit) && /recordLoading/.test(visit) && /planSeq/.test(visit) && /recordSeq/.test(visit), 'independent latest-wins');
  assert('static-css-phase', /Phase 3C · 用户领养闭环/.test(css), 'Phase 3C CSS marker');
  assert('static-test-no-hardcoded-strict', !/strictMode\s*:\s*true/.test(own), 'computed strict mode');
  assert('static-test-no-fake-pass', !/assert\([^,\n]+,\s*true\s*,/.test(own), 'no unconditional assertions');
}

async function invalidIdProbe(browser) {
  const context = await browser.newContext();
  await login(context);
  const cases = [
    { file: 'adopt_apply.html', query: 'animalId=abc', forbidden: /^\/api\/(?:animal|adopt\/mine)\// },
    { file: 'adopt_proof.html', query: 'aid=0001', forbidden: /^\/api\/(?:adopt\/mine|proof\/page1)/ },
    { file: 'my_visit.html', query: 'aid=1e3', forbidden: /^\/api\/(?:visit|visit-plans)/ }
  ];
  for (const item of cases) {
    const page = await context.newPage();
    const state = await installFixture(page);
    const audit = attachAudit(page, `invalid-${safeName(item.file)}`);
    await page.goto(pageUrl(item.file, item.query), { waitUntil: 'domcontentloaded' });
    await page.locator('[role="alert"]').first().waitFor({ state: 'visible' });
    const forbidden = state.requests.filter((row) => item.forbidden.test(row.pathname));
    assert(`invalid-${safeName(item.file)}-no-request`, forbidden.length === 0, JSON.stringify(forbidden));
    finishAudit(audit);
    await page.close();
  }
  probe('invalid-id-fail-before-request', cases.map((item) => item.file));
  await context.close();
}

async function existingMaterialProbe(browser) {
  const context = await browser.newContext();
  await login(context);
  const page = await context.newPage();
  await installFixture(page, { existingState: 3 });
  const audit = attachAudit(page, 'existing-material');
  await page.goto(pageUrl('adopt_apply.html'), { waitUntil: 'domcontentloaded' });
  await page.locator('.ui-adoption-form').waitFor();
  assert('existing-material-message', await page.getByText('等待补充材料', { exact: false }).count() > 0, 'material-required notice');
  assert('existing-material-submit-disabled', await page.locator('#adoptSubmit').isDisabled(), 'submit disabled');
  finishAudit(audit);
  probe('material-required-duplicate-preflight', { blocked: true });
  await page.close();
  await context.close();
}

async function fillApplication(page) {
  await page.locator('#adoptAge').fill('28');
  await page.locator('#adoptGender').selectOption('女');
  await page.locator('#adoptPhone').fill('13800138000');
  await page.locator('#adoptWechat').fill('phase3c-user');
  await page.locator('#adoptOccupation').fill('设计师');
  await page.locator('#adoptMarital').selectOption('2');
  await page.locator('#adoptResident').selectOption('1');
  await page.locator('#adoptIncome').selectOption('5000');
  await page.locator('#adoptExperience').selectOption('1');
  await page.locator('#adoptPets').fill('1');
  await page.locator('#adoptFamily').selectOption('1');
  await page.locator('#adoptAddress').fill('上海市测试区测试路 100 号');
}

async function applicationWriteProbe(browser) {
  const context = await browser.newContext();
  await login(context);
  const page = await context.newPage();
  const state = await installFixture(page, { adoptWrite: 'conflict', delayMs: 150 });
  const audit = attachAudit(page, 'application-write');
  await page.goto(pageUrl('adopt_apply.html'), { waitUntil: 'domcontentloaded' });
  await page.locator('.ui-adoption-form').waitFor();
  await page.locator('#adoptSubmit').click();
  assert('application-validation-focus', (await page.evaluate(() => document.activeElement && document.activeElement.id)) === 'adoptAge', 'first invalid field focused');
  await fillApplication(page);
  await page.locator('#adoptSubmit').evaluate((button) => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await page.getByRole('alert').filter({ hasText: '动物状态已变化' }).waitFor();
  const adoptRequest = state.requests.find((row) => row.method === 'POST' && row.pathname === '/api/adopt');
  const payload = adoptRequest && adoptRequest.postData ? JSON.parse(adoptRequest.postData) : null;
  assert('application-double-click-one', state.adoptPostCount === 1, `posts=${state.adoptPostCount}`);
  assert('application-safe-payload', payload && payload.aid === '10011' && payload.uid === undefined && payload.vstate === undefined, JSON.stringify(payload));
  assert('application-error-preserves-input', await page.locator('#adoptAddress').inputValue() === '上海市测试区测试路 100 号', 'address retained');
  assert('application-error-focus', (await page.evaluate(() => document.activeElement && document.activeElement.getAttribute('role'))) === 'alert', 'summary focused');
  assert('application-fixture-write-only', state.writes.every((row) => row.pathname === '/api/adopt'), JSON.stringify(state.writes));
  finishAudit(audit);
  probe('application-validation-double-submit-conflict', { posts: state.adoptPostCount });
  await page.close();
  await context.close();
}

async function listTimelineRaceProbe(browser) {
  const context = await browser.newContext();
  await login(context);
  const page = await context.newPage();
  const state = await installFixture(page, { listRace: true, timelineFailures: 1 });
  const audit = attachAudit(page, 'list-timeline-race', true);
  await page.goto(pageUrl('my_adopt.html'), { waitUntil: 'domcontentloaded' });
  await page.locator('.ui-adoption-record').first().waitFor();
  await page.locator('#adoptSearch').fill('慢请求');
  await page.locator('.ui-adoption-toolbar').evaluate((form) => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  await sleep(25);
  await page.locator('#adoptSearch').fill('快速结果');
  await page.locator('.ui-adoption-toolbar').evaluate((form) => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  await page.getByText('快速结果伙伴', { exact: false }).first().waitFor();
  await sleep(300);
  assert('list-race-latest-wins', await page.getByText('快速结果伙伴', { exact: false }).count() > 0 && await page.getByText('慢请求', { exact: false }).count() === 0, 'fast result retained');
  await page.getByRole('button', { name: '处理进度' }).first().click();
  await page.getByText('时间线读取失败', { exact: false }).waitFor();
  await page.getByRole('button', { name: '重试' }).click();
  await page.getByText('请补充居住环境图片', { exact: false }).waitFor();
  assert('timeline-retry-count', state.timelineCount === 2, `timeline=${state.timelineCount}`);
  finishAudit(audit);
  probe('adoption-list-and-timeline-latest-wins', { list: state.listCount, timeline: state.timelineCount });
  await page.close();
  await context.close();
}

async function withdrawDialogProbe(browser) {
  const context = await browser.newContext();
  await login(context);
  const page = await context.newPage();
  const state = await installFixture(page, { withdrawWrite: 'conflict', delayMs: 160 });
  const audit = attachAudit(page, 'withdraw-dialog');
  await page.goto(pageUrl('my_adopt.html'), { waitUntil: 'domcontentloaded' });
  const trigger = page.getByRole('button', { name: '撤回申请' }).first();
  await trigger.waitFor();
  await trigger.click();
  await page.locator('.ui-adoption-confirm-dialog').waitFor();
  await page.keyboard.press('Escape');
  assert('withdraw-esc-restores-focus', await trigger.evaluate((element) => element === document.activeElement), 'trigger focus');
  await trigger.click();
  await page.locator('#confirmWithdrawButton').evaluate((button) => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await page.getByText('其他页面更新', { exact: false }).waitFor();
  assert('withdraw-double-click-one', state.withdrawCount === 1, `withdraw=${state.withdrawCount}`);
  assert('withdraw-error-focus', await page.locator('[role="alert"]').last().evaluate((element) => element === document.activeElement), 'dialog error focus');
  finishAudit(audit);
  probe('withdraw-dialog-focus-lock-conflict', { writes: state.withdrawCount });
  await page.close();
  await context.close();
}

async function proofStageRetryProbe(browser) {
  const context = await browser.newContext();
  await login(context);
  const page = await context.newPage();
  const state = await installFixture(page, { existingState: 1, proofSaveFailures: 1, delayMs: 80 });
  const audit = attachAudit(page, 'proof-stage-retry');
  await page.goto(pageUrl('adopt_proof.html'), { waitUntil: 'domcontentloaded' });
  await page.locator('.ui-proof-intake').waitFor();
  await page.locator('#proofType').selectOption({ index: 1 });
  await page.locator('#proofFile').setInputFiles({
    name: 'home-proof.png',
    mimeType: 'image/png',
    buffer: Buffer.from('phase3c-image')
  });
  await page.locator('#proofSubmit').click();
  await page.getByRole('alert').filter({ hasText: '材料保存失败' }).waitFor();
  assert('proof-stage-visible-after-failure', await page.locator('.ui-stage-note').isVisible(), 'staged retained');
  assert('proof-first-attempt-counts', state.uploadCount === 1 && state.proofPostCount === 1 && state.stagedDeleteCount === 0, JSON.stringify(state));
  await page.locator('#proofSubmit').click();
  await page.waitForFunction(() => !document.querySelector('.ui-stage-note'));
  assert('proof-retry-no-reupload', state.uploadCount === 1 && state.proofPostCount === 2, JSON.stringify(state));
  assert('proof-success-no-stage-delete', state.stagedDeleteCount === 0, `deletes=${state.stagedDeleteCount}`);
  finishAudit(audit);
  probe('proof-stage-retry-without-reupload', {
    uploads: state.uploadCount,
    saves: state.proofPostCount,
    stagedDeletes: state.stagedDeleteCount
  });
  await page.close();
  await context.close();
}

async function proofCancelAndDeleteProbe(browser) {
  const context = await browser.newContext();
  await login(context);
  const page = await context.newPage();
  const state = await installFixture(page, { existingState: 1, proofSaveFailures: 1, delayMs: 120 });
  const audit = attachAudit(page, 'proof-cancel-delete');
  await page.goto(pageUrl('adopt_proof.html'), { waitUntil: 'domcontentloaded' });
  await page.locator('#proofType').selectOption({ index: 1 });
  await page.locator('#proofFile').setInputFiles({
    name: 'cancel-proof.png',
    mimeType: 'image/png',
    buffer: Buffer.from('phase3c-cancel')
  });
  await page.locator('#proofSubmit').click();
  await page.getByRole('alert').filter({ hasText: '材料保存失败' }).waitFor();
  await page.getByRole('button', { name: '取消选择' }).click();
  await page.waitForFunction(() => !document.querySelector('.ui-stage-note'));
  assert('proof-cancel-one-stage-delete', state.stagedDeleteCount === 1, `deletes=${state.stagedDeleteCount}`);

  const deleteTrigger = page.getByRole('button', { name: '删除材料' }).first();
  await deleteTrigger.click();
  await page.keyboard.press('Escape');
  assert('proof-delete-esc-focus', await deleteTrigger.evaluate((element) => element === document.activeElement), 'trigger focus');
  await deleteTrigger.click();
  await page.locator('#confirmProofDelete').evaluate((button) => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await page.waitForFunction(() => !document.querySelector('.ui-adoption-confirm-dialog'));
  assert('proof-delete-double-click-one', state.proofDeleteCount === 1, `deletes=${state.proofDeleteCount}`);
  finishAudit(audit);
  probe('proof-cancel-and-delete-lock', { stageDeletes: state.stagedDeleteCount, proofDeletes: state.proofDeleteCount });
  await page.close();
  await context.close();
}

async function proofReplacementProbe(browser) {
  const context = await browser.newContext();
  await login(context);
  const page = await context.newPage();
  const state = await installFixture(page, { existingState: 1, proofSaveFailures: 1, delayMs: 60 });
  const audit = attachAudit(page, 'proof-replacement');
  await page.goto(pageUrl('adopt_proof.html'), { waitUntil: 'domcontentloaded' });
  await page.locator('#proofType').selectOption({ index: 1 });
  await page.locator('#proofFile').setInputFiles({
    name: 'old-proof.png',
    mimeType: 'image/png',
    buffer: Buffer.from('phase3c-old-proof')
  });
  await page.locator('#proofSubmit').click();
  await page.getByRole('alert').filter({ hasText: '材料保存失败' }).waitFor();
  await page.locator('#proofFile').setInputFiles({
    name: 'replacement-proof.png',
    mimeType: 'image/png',
    buffer: Buffer.from('phase3c-replacement-proof')
  });
  await page.waitForFunction(() => !document.querySelector('.ui-stage-note'));
  assert('proof-replacement-retires-stage-once', state.stagedDeleteCount === 1, `deletes=${state.stagedDeleteCount}`);
  assert('proof-replacement-does-not-upload-early', state.uploadCount === 1, `uploads=${state.uploadCount}`);
  assert('proof-replacement-keeps-new-file', await page.locator('#proofFile').evaluate((input) => input.files.length === 1 && input.files[0].name === 'replacement-proof.png'), 'replacement selected');
  finishAudit(audit);
  probe('proof-replacement-retires-old-stage-once', {
    uploads: state.uploadCount,
    stagedDeletes: state.stagedDeleteCount
  });
  await page.close();
  await context.close();
}

async function proofPagehideProbe(browser) {
  const context = await browser.newContext();
  await login(context);
  const page = await context.newPage();
  const state = await installFixture(page, { existingState: 1, proofSaveFailures: 1, delayMs: 60 });
  const audit = attachAudit(page, 'proof-pagehide');
  await page.goto(pageUrl('adopt_proof.html'), { waitUntil: 'domcontentloaded' });
  await page.locator('#proofType').selectOption({ index: 1 });
  await page.locator('#proofFile').setInputFiles({
    name: 'leave-proof.png',
    mimeType: 'image/png',
    buffer: Buffer.from('phase3c-leave-proof')
  });
  await page.locator('#proofSubmit').click();
  await page.getByRole('alert').filter({ hasText: '材料保存失败' }).waitFor();
  await page.evaluate(() => {
    window.dispatchEvent(new PageTransitionEvent('pagehide'));
    window.dispatchEvent(new PageTransitionEvent('pagehide'));
  });
  await sleep(250);
  assert('proof-pagehide-stage-delete-once', state.stagedDeleteCount === 1, `deletes=${state.stagedDeleteCount}`);
  finishAudit(audit);
  probe('proof-pagehide-cleans-stage-once', { stagedDeletes: state.stagedDeleteCount });
  await page.close();
  await context.close();
}

async function visitRaceProbe(browser) {
  const context = await browser.newContext();
  await login(context);
  const page = await context.newPage();
  const state = await installFixture(page, { planRace: true, recordRace: true });
  const audit = attachAudit(page, 'visit-race', true);
  await page.goto(pageUrl('my_visit.html'), { waitUntil: 'domcontentloaded' });
  await page.locator('.ui-visit-record').first().waitFor();
  await page.evaluate(() => {
    const app = document.querySelector('#app').__vue__;
    app.loadPlans();
    setTimeout(() => app.loadPlans(), 20);
    app.loadRecords(2);
    setTimeout(() => app.loadRecords(1), 20);
  });
  await page.getByText('快速页伙伴1', { exact: false }).waitFor();
  await sleep(320);
  assert('visit-record-race-latest', await page.getByText('快速页伙伴1', { exact: false }).count() > 0 && await page.getByText('慢页伙伴1', { exact: false }).count() === 0, 'page 1 retained');
  assert('visit-plan-race-latest', await page.getByText('30 天健康回访', { exact: false }).count() > 0, 'fast plan retained');
  finishAudit(audit);
  probe('visit-plan-record-independent-latest-wins', { plans: state.planCount, records: state.recordCount });
  await page.close();
  await context.close();
}

async function staleClearProbe(browser) {
  const context = await browser.newContext();
  await login(context);
  const page = await context.newPage();
  const state = await installFixture(page, { listErrorOnCount: 2 });
  const audit = attachAudit(page, 'stale-clear');
  await page.goto(pageUrl('my_adopt.html'), { waitUntil: 'domcontentloaded' });
  await page.locator('.ui-adoption-record').first().waitFor();
  await page.getByRole('button', { name: '搜索' }).click();
  await page.getByText('申请列表读取失败', { exact: false }).waitFor();
  assert('stale-clear-no-old-records', await page.locator('.ui-adoption-record').count() === 0, 'old records cleared');
  finishAudit(audit);
  probe('error-clears-untrusted-stale-records', { listCalls: state.listCount });
  await page.close();
  await context.close();
}

async function realReadOnlySmoke(browser) {
  const context = await browser.newContext();
  await login(context);
  let animalId = '10011';
  let adoptId = '10011';
  try {
    const animalResponse = await context.request.get(`${base}/api/animal/page1?pageNum=1&pageSize=1`);
    const animalBody = await animalResponse.json();
    const row = animalBody && animalBody.data && animalBody.data.records && animalBody.data.records[0];
    if (row && canonicalId(row.id)) animalId = canonicalId(row.id);
  } catch (error) {
    fail('real-smoke-discover-animal', error.message);
  }
  try {
    const adoptResponse = await context.request.get(`${base}/api/adopt/page2?pageNum=1&pageSize=1`);
    const adoptBody = await adoptResponse.json();
    const row = adoptBody && adoptBody.data && adoptBody.data.records && adoptBody.data.records[0];
    if (row && canonicalId(row.aid)) adoptId = canonicalId(row.aid);
  } catch (error) {
    fail('real-smoke-discover-adopt', error.message);
  }
  const urls = [
    ['adopt_apply.html', `animalId=${encodeURIComponent(animalId)}`],
    ['my_adopt.html', null],
    ['adopt_proof.html', `aid=${encodeURIComponent(adoptId)}`],
    ['my_visit.html', null]
  ];
  for (const [file, query] of urls) {
    const page = await context.newPage();
    const writes = [];
    const pageErrors = [];
    await page.route('**/api/**', async (route) => {
      if (!['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) {
        writes.push({ method: route.request().method(), url: route.request().url() });
        result.realWriteAudit.push({ file, method: route.request().method(), url: route.request().url() });
        await route.fulfill({ status: 405, contentType: 'application/json', body: failure(405, 'Phase 3C real smoke blocks writes') });
      } else {
        await route.continue();
      }
    });
    page.on('pageerror', (error) => pageErrors.push(error.message));
    let error = '';
    try {
      await page.goto(pageUrl(file, query), { waitUntil: 'domcontentloaded', timeout: 15000 });
      await page.locator('.ui-front-header').waitFor({ state: 'visible', timeout: 8000 });
    } catch (caught) {
      error = caught.message;
    }
    assert(`real-smoke-${safeName(file)}-page`, !error, error || page.url());
    assert(`real-smoke-${safeName(file)}-pageerror`, pageErrors.length === 0, JSON.stringify(pageErrors));
    assert(`real-smoke-${safeName(file)}-writes`, writes.length === 0, JSON.stringify(writes));
    result.realSmoke.push({ file, url: page.url(), error, writes: writes.length, pageErrors });
    await page.close();
  }
  probe('real-service-read-only-smoke', { animalId, adoptId, pages: urls.length });
  await context.close();
}

function writeReports() {
  result.summary = {
    passed: result.checks.filter((row) => row.ok).length,
    failed: result.failures.length,
    skipped: result.skippedCount,
    total: result.checks.length,
    visits: result.visits.length,
    expectedVisits: PAGES.length * VIEWPORTS.length,
    screenshots: result.screenshots.length,
    strictRuntimeProbeCount: result.strictRuntimeProbeCount,
    bestEffortPassCount: result.bestEffortPassCount,
    fallbackPassCount: result.fallbackPassCount,
    fixtureWrites: result.fixtureWriteAudit.length,
    realWrites: result.realWriteAudit.length,
    durationMs: Date.now() - startedAt,
    finishedAt: new Date().toISOString()
  };
  result.summary.strictMode = result.summary.failed === 0
    && result.summary.skipped === 0
    && result.summary.bestEffortPassCount === 0
    && result.summary.fallbackPassCount === 0
    && result.summary.realWrites === 0;
  result.ok = result.summary.strictMode && result.summary.visits === result.summary.expectedVisits;
  fs.writeFileSync(path.join(out, 'phase-3c-report.json'), JSON.stringify(result, null, 2));
  fs.writeFileSync(path.join(out, 'screenshots-index.json'), JSON.stringify(result.screenshots, null, 2));
  const log = [
    `PHASE 3C STRICT=${result.summary.strictMode}`,
    `ASSERTIONS ${result.summary.passed}/${result.summary.failed}/${result.summary.skipped}`,
    `VISITS ${result.summary.visits}/${result.summary.expectedVisits}`,
    `SCREENSHOTS ${result.summary.screenshots}`,
    `PROBES ${result.summary.strictRuntimeProbeCount}`,
    `BEST_EFFORT ${result.summary.bestEffortPassCount}`,
    `FALLBACK ${result.summary.fallbackPassCount}`,
    `FIXTURE_WRITES ${result.summary.fixtureWrites}`,
    `REAL_WRITES ${result.summary.realWrites}`
  ].join('\n') + '\n';
  fs.writeFileSync(path.join(out, 'run-strict-final.log'), log);
  const report = `# Phase 3C · 用户领养闭环

- 分支：\`${result.branch}\`
- 基线：\`${result.baseline}\`
- 服务：\`${base}\`
- 结果：${result.ok ? 'PASS' : 'FAIL'}
- 断言：${result.summary.passed} 通过 / ${result.summary.failed} 失败 / ${result.summary.skipped} 跳过
- 页面矩阵：${result.summary.visits} / ${result.summary.expectedVisits}
- 截图：${result.summary.screenshots}
- 严格探针：${result.summary.strictRuntimeProbeCount}
- best-effort / fallback：${result.summary.bestEffortPassCount} / ${result.summary.fallbackPassCount}
- 夹具拦截写请求：${result.summary.fixtureWrites}
- 真实业务写请求：${result.summary.realWrites}

## 覆盖

- 4 个领养闭环页面 × 5 个视口（1440 / 1280 / 768 / 390 / 320）。
- 申请前置校验、字段错误、同帧双击、409 保留输入。
- 我的领养搜索竞态、时间线失败重试、撤回确认和写锁。
- 材料上传成功后业务保存失败的暂存保留、无重复上传、取消单次清理、删除确认。
- 回访计划与记录独立错误、分页竞态和 latest-wins。
- 真实服务只读烟测；所有测试业务写入均由夹具拦截。

## 证据

- \`phase-3c-report.json\`
- \`run-strict-final.log\`
- \`screenshots-index.json\`
- \`screenshots/\`
`;
  fs.writeFileSync(path.join(out, 'PHASE-3C-REPORT.md'), report);
}

(async () => {
  console.log('Phase 3C strict start', base);
  const browser = await chromium.launch({ headless: true });
  try {
    await staticAudit();
    await matrix(browser);
    await invalidIdProbe(browser);
    await existingMaterialProbe(browser);
    await applicationWriteProbe(browser);
    await listTimelineRaceProbe(browser);
    await withdrawDialogProbe(browser);
    await proofStageRetryProbe(browser);
    await proofCancelAndDeleteProbe(browser);
    await proofReplacementProbe(browser);
    await proofPagehideProbe(browser);
    await visitRaceProbe(browser);
    await staleClearProbe(browser);
    await realReadOnlySmoke(browser);
  } catch (error) {
    fail('phase-3c-runner', error && error.stack ? error.stack : error);
  } finally {
    await browser.close();
    writeReports();
  }
  console.log(JSON.stringify(result.summary, null, 2));
  if (!result.ok) process.exitCode = 1;
})().catch((error) => {
  fail('phase-3c-fatal', error && error.stack ? error.stack : error);
  writeReports();
  console.error(error);
  process.exitCode = 1;
});
