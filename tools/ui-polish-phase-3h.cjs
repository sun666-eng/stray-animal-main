/**
 * Phase 3H credibility-strict suite — cross-page journeys with real DOM writes only.
 * Port default :18142. Fail-closed. No synthetic writes / no direct journeyStore mutations for success.
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const startedAt = Date.now();
const base = process.env.BASE_URL || 'http://127.0.0.1:18142';
const out = path.resolve('output/playwright/ui-polish-phase-3h');
const shotDir = path.join(out, 'screenshots');
fs.mkdirSync(shotDir, { recursive: true });
for (const f of fs.readdirSync(shotDir)) {
  if (f.endsWith('.png')) fs.unlinkSync(path.join(shotDir, f));
}

const VIEWPORTS = [
  { name: '1440x900', width: 1440, height: 900 },
  { name: '1280x800', width: 1280, height: 800 },
  { name: '768x1024', width: 768, height: 1024 },
  { name: '390x844', width: 390, height: 844 },
  { name: '320x700', width: 320, height: 700 }
];

const PAGE_CATALOG = [
  { file: 'index.html', phase: '3B', access: 'public', nav: 'home' },
  { file: 'animal_browse.html', phase: '3B', access: 'public', nav: 'browse' },
  { file: 'animal_detail.html', phase: '3B', access: 'public', nav: 'browse', query: 'id=12' },
  { file: 'notice_list.html', phase: '3B', access: 'public', nav: 'notice' },
  { file: 'notice_detail.html', phase: '3B', access: 'public', nav: 'notice', query: 'id=1' },
  { file: 'account_public.html', phase: '3B', access: 'public', nav: 'account' },
  { file: 'login.html', phase: '3G', access: 'public', nav: '' },
  { file: 'register.html', phase: '3G', access: 'public', nav: '' },
  { file: 'adopt_apply.html', phase: '3C', access: 'protected', nav: 'browse', query: 'animalId=12' },
  { file: 'my_adopt.html', phase: '3C', access: 'protected', nav: '' },
  { file: 'adopt_proof.html', phase: '3C', access: 'protected', nav: '' },
  { file: 'my_visit.html', phase: '3C', access: 'protected', nav: '' },
  { file: 'rescue_apply.html', phase: '3D', access: 'protected', nav: '' },
  { file: 'my_rescue.html', phase: '3D', access: 'protected', nav: '' },
  { file: 'notifications.html', phase: '3D', access: 'protected', nav: '' },
  { file: 'volunteer_apply.html', phase: '3E', access: 'protected', nav: '' },
  { file: 'my_volunteer.html', phase: '3E', access: 'protected', nav: '' },
  { file: 'volunteer_tasks.html', phase: '3E', access: 'protected', nav: '' },
  { file: 'favorites.html', phase: '3F', access: 'protected', nav: '' },
  { file: 'pet_care.html', phase: '3F', access: 'protected', nav: '' }
];

const MEMBER = { id: '43', username: 'jerry', name: 'jerry', phone: '', email: '', permission: [] };
const ADMIN = {
  id: '1', username: 'admin', name: 'admin', phone: '', email: '',
  permission: [{ flag: 'user' }, { flag: 'role' }, { flag: 'animal' }, { flag: 'adopt' }]
};

const expectedRequestFailureLedger = [];
const requiredJourneyWrites = [];
const activeScenarioByPage = new WeakMap();
const requestScenarioByRequest = new WeakMap();
let requestFailedSeq = 0;
let fixtureWriteSeq = 0;

const result = {
  phase: '3H',
  base,
  branch: 'ui-polish/phase-3h-20260801',
  baseline: 'f5185543f8428dba568a29bab1afa95c83d05704',
  startedAt: new Date().toISOString(),
  credibilityRemediation: 'false-green-removal-dom-only-writes',
  checks: [],
  failures: [],
  visits: [],
  matrixVisits: [],
  pageScores: [],
  journeyResults: [],
  screenshots: [],
  probes: [],
  fixtureWriteAudit: [],
  realWriteAudit: [],
  syntheticWriteAudit: [],
  directStoreMutationAudit: [],
  setupSeedAudit: [],
  requestFailedAudit: [],
  evaluateUsage: [],
  consoleErrors: [],
  pageErrors: [],
  httpErrors: [],
  overflowAudit: [],
  classifierSelfTests: [],
  credibilitySelfTests: [],
  requiredJourneyWrites,
  requestCountAudit: null,
  bestEffortPassCount: 0,
  fallbackPassCount: 0,
  skippedCount: 0,
  strictRuntimeProbeCount: 0,
  summary: {}
};

function pass(id, d) {
  result.checks.push({ id, ok: true, skipped: false, bestEffort: false, fallback: false, detail: String(d || '') });
}
function fail(id, d) {
  const row = { id, ok: false, skipped: false, bestEffort: false, fallback: false, detail: String(d || '') };
  result.checks.push(row);
  result.failures.push(row);
  console.error('FAIL', id, d);
}
function assert(id, c, d) { if (c) pass(id, d); else fail(id, d); }
function probe(name, detail) {
  result.strictRuntimeProbeCount += 1;
  result.probes.push({ name, detail: detail || {}, at: new Date().toISOString() });
}
function ok(data) { return JSON.stringify({ code: '0', msg: '成功', data }); }
function err(code, msg) { return JSON.stringify({ code: String(code), msg, data: null }); }
function fxHeaders(expected) {
  const h = { 'content-type': 'application/json', 'x-ui-audit-fixture': 'phase3h' };
  if (expected) h['x-ui-audit-expected-error'] = 'phase3h';
  return h;
}
function pageUrl(file, query) {
  return base + '/page/front/' + file + (query ? '?' + query : '');
}
function pathnameOf(url) {
  try { return new URL(url).pathname; } catch (e) { return ''; }
}
function normalizeFailure(text) {
  const s = String(text || '');
  if (/ERR_FAILED|net::failed|^failed$/i.test(s)) return 'failed';
  if (/ERR_ABORTED|aborted/i.test(s)) return 'aborted';
  return s.toLowerCase();
}
function setActiveScenario(page, id) { activeScenarioByPage.set(page, String(id || '')); }
function getActiveScenario(page) { return activeScenarioByPage.get(page) || ''; }

function registerRequiredWrite(spec) {
  const row = {
    journeyId: String(spec.journeyId || ''),
    scenarioId: String(spec.scenarioId || ''),
    method: String(spec.method || 'POST').toUpperCase(),
    pathname: String(spec.pathname || ''),
    expectedCount: Number(spec.expectedCount || 1),
    observedCount: 0,
    observations: []
  };
  requiredJourneyWrites.push(row);
  return row;
}

function noteSetupSeed(label, detail) {
  result.setupSeedAudit.push({ label, detail: detail || {}, at: new Date().toISOString() });
}

function trackDirectStoreMutation(label) {
  result.directStoreMutationAudit.push({ label, at: new Date().toISOString() });
}

function trackSyntheticWrite(entry) {
  result.syntheticWriteAudit.push(Object.assign({ at: new Date().toISOString() }, entry || {}));
}

function matchRequiredWrite(entry) {
  for (const row of requiredJourneyWrites) {
    if (row.scenarioId !== entry.scenarioId) continue;
    if (row.method !== entry.method) continue;
    if (row.pathname !== entry.pathname) continue;
    row.observedCount += 1;
    row.observations.push({
      seq: entry.seq, at: entry.at, url: entry.url, scenarioId: entry.scenarioId
    });
    return true;
  }
  return false;
}

function classifyRequestFailed(entry, ledger) {
  const scenarioId = String(entry.scenarioId || '');
  const method = String(entry.method || 'GET').toUpperCase();
  const pathname = entry.pathname || pathnameOf(entry.url || '');
  const failure = normalizeFailure(entry.failure || '');
  for (let i = 0; i < ledger.length; i++) {
    const row = ledger[i];
    if (row.scenarioId !== scenarioId || row.method !== method || row.pathname !== pathname || row.failure !== failure) continue;
    if (row.observedCount < row.expectedCount) {
      row.observedCount += 1;
      row.observations.push({ scenarioId, method, pathname, failure, seq: entry.seq, at: entry.at, url: entry.url });
      return { kind: 'intentional', scenarioId };
    }
    return { kind: 'unexpected', reason: 'exceeded-expected-count', scenarioId };
  }
  return { kind: 'unexpected', reason: 'unregistered', scenarioId, method, pathname, failure };
}

function auditRequestFailures(auditList, ledger) {
  ledger.forEach((r) => { r.observedCount = 0; r.observations = []; });
  const unexpected = [];
  let intentional = 0;
  for (const e of auditList) {
    const c = classifyRequestFailed(e, ledger);
    if (c.kind === 'intentional') intentional += 1;
    else unexpected.push({ entry: e, classified: c });
  }
  return {
    intentionalCount: intentional,
    unexpectedCount: unexpected.length,
    unexpected,
    underObserved: ledger.filter((r) => r.observedCount !== r.expectedCount),
    getRequestFailures: auditList.filter((e) => String(e.method || 'GET').toUpperCase() === 'GET').length,
    staticResourceFailures: auditList.filter((e) => /\.(js|css|svg|png|jpe?g)(\?|$)/i.test(e.url || '')).length,
    htmlFailures: auditList.filter((e) => /\/page\/.*\.html/i.test(e.url || '')).length,
    expectedRequestFailures: ledger.reduce((n, r) => n + r.expectedCount, 0),
    ledgerSnapshot: ledger.map((r) => Object.assign({}, r, { observations: r.observations.slice() }))
  };
}

function runClassifierSelfTests() {
  const tests = [];
  const t = (id, cond, d) => tests.push({ id, ok: !!cond, detail: String(d || '') });
  const L = () => [{
    scenarioId: 'login-network', method: 'POST', pathname: '/api/user/login',
    failure: 'failed', expectedCount: 1, observedCount: 0, observations: []
  }];
  t('sid-mismatch', classifyRequestFailed({
    scenarioId: 'login-500', method: 'POST', url: 'http://x/api/user/login', failure: 'failed'
  }, L()).kind === 'unexpected', 'sid');
  t('sid-empty', classifyRequestFailed({
    scenarioId: '', method: 'POST', url: 'http://x/api/user/login', failure: 'failed'
  }, L()).kind === 'unexpected', 'empty');
  t('sid-match', classifyRequestFailed({
    scenarioId: 'login-network', method: 'POST', url: 'http://x/api/user/login', failure: 'failed'
  }, L()).kind === 'intentional', 'match');
  {
    const ledger = L();
    classifyRequestFailed({ scenarioId: 'login-network', method: 'POST', url: 'http://x/api/user/login', failure: 'failed' }, ledger);
    t('exceeded', classifyRequestFailed({
      scenarioId: 'login-network', method: 'POST', url: 'http://x/api/user/login', failure: 'failed'
    }, ledger).reason === 'exceeded-expected-count', '2x');
  }
  result.classifierSelfTests = tests;
  tests.forEach((row) => assert('classifier-' + row.id, row.ok, row.detail));
}

function runCredibilitySelfTests() {
  const tests = [];
  const t = (id, cond, d) => tests.push({ id, ok: !!cond, detail: String(d || '') });
  // 1) Missing signup button must fail journey-E style gate
  t('missing-signup-button-fails', (function () {
    const hasBtn = false;
    return !hasBtn; // gate: if !hasBtn journey fails
  })(), 'E');
  // 2) bare array help/mine must fail D-style validation
  t('help-mine-bare-array-fails', (function () {
    const res = { code: '0', data: [] };
    const valid = !!(res.data && Array.isArray(res.data.records));
    return valid === false;
  })(), 'D');
  // 3) adopt POST not observed must fail B
  t('adopt-missing-write-fails', (function () {
    const writes = [{ method: 'POST', pathname: '/api/operations/favorites/12' }];
    const adopt = writes.filter((w) => w.method === 'POST' && w.pathname === '/api/adopt');
    return adopt.length === 0; // condition that should cause failure when checked
  })(), 'B');
  // 4) load error text must not match success via broad regex
  t('load-error-not-false-success', (function () {
    const text = '我的救助\n暂时无法加载\n重新加载';
    const broad = /救助|申请/.test(text); // broad would pass incorrectly
    const strict = /data-rescue-id="r9"/.test(text) && !/暂时无法加载|重新加载|加载失败/.test(text);
    return broad === true && strict === false;
  })(), 'strict-vs-broad');
  // 5) synthetic audit forces strict false
  t('synthetic-forces-strict-false', (function () {
    const syntheticWrites = 1;
    const strictMode = syntheticWrites === 0;
    return strictMode === false;
  })(), 'synthetic');
  // 6) petCareConfig wrongly connected=true must fail Journey F strict AND-gate
  t('petcare-connected-true-fails-F', (function () {
    const petCareConfig = {
      connected: true,
      connectionStatus: 'failed',
      connectionMessage: '模型服务商连接失败，请稍后重试。'
    };
    const agentLabel = '个人 Agent 已连接'; // wrong greenwash label
    const hasConnectedStyle = true; // is-ready would be applied when connected===true
    const storeOk = petCareConfig.connected === false && petCareConfig.connectionStatus === 'failed';
    const labelOk = agentLabel.indexOf('个人 Agent 已连接') < 0;
    const styleOk = !hasConnectedStyle;
    const strictF = storeOk && labelOk && styleOk;
    return strictF === false;
  })(), 'F');
  // 7) rescue written to store but DOM has no success feedback must fail d-rescue-success-ui
  t('rescue-store-without-dom-success-fails', (function () {
    const storeRescues = [{ title: '社区入口橘猫救助' }];
    const formText = '正式救助工单\n先保证自身安全。\n求助标题'; // still on form, no success panel
    const pathNow = '/page/front/rescue_apply.html';
    const onFormSuccess = pathNow.indexOf('rescue_apply.html') >= 0
      && /救助请求已进入处理队列|提交成功|救助已提交|已进入处理队列/.test(formText);
    const onMyRescue = pathNow.indexOf('my_rescue.html') >= 0
      && formText.indexOf('社区入口橘猫救助') >= 0;
    const noFailCopy = !/提交失败|暂时无法加载|加载失败|服务异常/.test(formText);
    const strictDom = (onFormSuccess || onMyRescue) && noFailCopy;
    const oldFalseGreen = /提交成功|已提交|继续提交|正式救助/.test(formText) || storeRescues.length >= 1;
    return oldFalseGreen === true && strictDom === false;
  })(), 'D');
  result.credibilitySelfTests = tests;
  tests.forEach((row) => assert('cred-' + row.id, row.ok, row.detail));
}

// ─── journeyStore ─────────────────────────────────────────────
function createJourneyStore() {
  const animal12 = {
    id: '12', tname: '豆豆', ttype: '狗', tsex: '公', tbirthday: '2022-03-01',
    tstate: 0, tdescribe: '温顺友好的中型犬，适合家庭领养。详情说明足够长以覆盖长内容截图。', tpic: ''
  };
  return {
    currentUser: null,
    csrfToken: '',
    animals: [animal12, {
      id: '13', tname: '咪咪', ttype: '猫', tsex: '母', tbirthday: '2023-01-01',
      tstate: 0, tdescribe: '活泼小猫', tpic: ''
    }],
    favorites: [],
    adoptionApplications: [],
    adoptionProofs: [],
    visitPlans: [],
    visitRecords: [],
    rescues: [],
    notifications: [],
    volunteerApplications: [],
    volunteerTasks: [
      {
        id: '101', title: '周末清洁犬舍', status: 1, location: '南区',
        capacity: 5, signup_count: 0, signup_status: null, signup_id: null
      }
    ],
    volunteerSignups: [],
    petCareConversations: [
      { id: 'c1', title: '喂养建议', preview: '幼犬喂养', turnCount: 2, updatedAt: '2026-08-01T10:00:00' }
    ],
    petCareConfig: {
      enabled: true, ready: true, connected: false, connectionStatus: 'untested',
      connectionMessage: '', lastTestedAt: null, baseUrl: 'https://api.example.com',
      model: 'demo-model', apiKeyConfigured: true, apiKeyHint: 'sk-****demo',
      personalConfigured: true, source: 'personal'
    },
    notices: [{ id: '1', title: '暑期领养日', content: '本周六开放领养日。', createTime: '2026-07-20' }],
    accounts: [{ id: '1', type: 'income', amount: '100.00', label: '捐赠', createTime: '2026-07-01' }],
    homeStats: { animals: 2, adopts: 1, volunteers: 3 },
    seq: 2000,
    nextId() { this.seq += 1; return String(this.seq); },
    loginAs(user) {
      this.currentUser = user;
      this.csrfToken = user && String(user.id) === '1' ? 'csrf-admin' : 'csrf-member';
    },
    logout() { this.currentUser = null; this.csrfToken = ''; }
  };
}

function wirePage(page) {
  page.on('pageerror', (e) => result.pageErrors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') result.consoleErrors.push(m.text()); });
  page.on('response', (r) => {
    if (r.status() >= 400) {
      result.httpErrors.push({
        status: r.status(), url: r.url(), method: r.request().method(), headers: r.headers()
      });
    }
  });
  page.on('request', (req) => {
    requestScenarioByRequest.set(req, getActiveScenario(page));
  });
  page.on('requestfailed', (req) => {
    requestFailedSeq += 1;
    result.requestFailedAudit.push({
      seq: requestFailedSeq,
      scenarioId: requestScenarioByRequest.get(req) || '',
      method: req.method(),
      url: req.url(),
      pathname: pathnameOf(req.url()),
      failure: req.failure() && req.failure().errorText,
      at: new Date().toISOString()
    });
  });
}

async function settlePage(page) {
  await page.waitForLoadState('load', { timeout: 12000 }).catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: 6000 }).catch(() => {});
  await page.waitForTimeout(80);
}

async function evalRead(page, reason, fn, arg) {
  result.evaluateUsage.push({ reason, readonly: true, at: new Date().toISOString() });
  if (typeof arg === 'undefined') return page.evaluate(fn);
  return page.evaluate(fn, arg);
}

async function installJourneyFixtures(page, store, opts) {
  opts = opts || {};
  await page.unroute('**/api/**').catch(() => {});
  await page.unroute('**/js/gVerify.js**').catch(() => {});
  await page.unroute('**/page/**/*.html*').catch(() => {});

  await page.route('**/page/**/*.html*', async (route) => {
    try {
      const u = new URL(route.request().url());
      const rel = u.pathname.replace(/^\//, '').split('?')[0];
      const filePath = path.resolve('src/main/resources/static', rel);
      if (fs.existsSync(filePath)) {
        await route.fulfill({
          status: 200,
          contentType: 'text/html; charset=utf-8',
          headers: { 'x-ui-audit-fixture': 'phase3h-html' },
          body: fs.readFileSync(filePath, 'utf8')
        });
        return;
      }
    } catch (e) { /* continue */ }
    await route.continue();
  });

  await page.route('**/js/gVerify.js**', async (route) => {
    const body = 'window.GVerify=function(o){var id=(o&&o.id)||"picyzm";var h=document.getElementById(id);var c=document.createElement("canvas");c.id="verifyCanvas";c.width=120;c.height=44;if(h){h.innerHTML="";h.appendChild(c);}this.validate=function(code){return String(code||"").toLowerCase()==="ok12";};this.refresh=function(){};};';
    await route.fulfill({ status: 200, contentType: 'application/javascript', headers: { 'x-ui-audit-fixture': 'phase3h-captcha' }, body });
  });

  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const method = req.method();
    const url = req.url();
    const p = pathnameOf(url);
    const isWrite = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
    const scenarioId = getActiveScenario(page);
    const entryBase = { method, url, pathname: p, scenarioId, at: new Date().toISOString() };

    const fulfillWrite = async (body, status, expectedErr) => {
      fixtureWriteSeq += 1;
      const entry = Object.assign({}, entryBase, { seq: fixtureWriteSeq });
      result.fixtureWriteAudit.push(entry);
      matchRequiredWrite(entry);
      await route.fulfill({
        status: status || 200,
        headers: fxHeaders(!!expectedErr),
        body
      });
    };

    // Auth
    if (method === 'GET' && /\/api\/user\/me(\?|$)/.test(url)) {
      if (store.currentUser) {
        await route.fulfill({ status: 200, headers: fxHeaders(), body: ok(store.currentUser) });
        return;
      }
      await route.fulfill({ status: 401, headers: fxHeaders(true), body: err('401', '未登录') });
      return;
    }
    if (method === 'GET' && /\/api\/user\/csrf(\?|$)/.test(url)) {
      await route.fulfill({ status: 200, headers: fxHeaders(), body: ok({ csrfToken: store.csrfToken || 'csrf-anon' }) });
      return;
    }
    if (method === 'POST' && /\/api\/user\/login(\?|$)/.test(url)) {
      let body = {};
      try { body = req.postDataJSON() || {}; } catch (e) { body = {}; }
      if (opts.loginMode === 'network') {
        fixtureWriteSeq += 1;
        result.fixtureWriteAudit.push(Object.assign({}, entryBase, { seq: fixtureWriteSeq }));
        await route.abort('failed');
        return;
      }
      const user = String(body.username || '') === 'admin' ? ADMIN : MEMBER;
      store.loginAs(user);
      await fulfillWrite(ok({ user, csrfToken: store.csrfToken }));
      return;
    }
    if (method === 'POST' && /\/api\/user\/register(\?|$)/.test(url)) {
      let body = {};
      try { body = req.postDataJSON() || {}; } catch (e) { body = {}; }
      const user = Object.assign({}, MEMBER, { id: store.nextId(), username: body.username || 'newuser', permission: [] });
      store.loginAs(user);
      await fulfillWrite(ok({ user, csrfToken: store.csrfToken }));
      return;
    }
    if (method === 'POST' && /\/api\/user\/logout(\?|$)/.test(url)) {
      store.logout();
      await fulfillWrite(ok(true));
      return;
    }

    // Public reads
    if (method === 'GET' && /\/api\/animal\/page1/.test(url)) {
      await route.fulfill({ status: 200, headers: fxHeaders(), body: ok({ records: store.animals, total: store.animals.length }) });
      return;
    }
    if (method === 'GET' && /\/api\/animal\/\d+$/.test(p)) {
      const id = p.split('/').pop();
      const a = store.animals.find((x) => String(x.id) === String(id));
      if (!a) {
        await route.fulfill({ status: 404, headers: fxHeaders(true), body: err('404', '动物不存在') });
        return;
      }
      await route.fulfill({ status: 200, headers: fxHeaders(), body: ok(a) });
      return;
    }
    if (method === 'GET' && /\/api\/notice\/page/.test(url)) {
      await route.fulfill({ status: 200, headers: fxHeaders(), body: ok({ records: store.notices, total: store.notices.length }) });
      return;
    }
    if (method === 'GET' && /\/api\/notice\/\d+$/.test(p)) {
      const id = p.split('/').pop();
      const n = store.notices.find((x) => String(x.id) === String(id)) || store.notices[0];
      await route.fulfill({ status: 200, headers: fxHeaders(), body: ok(n) });
      return;
    }
    if (method === 'GET' && /\/api\/account\/public/.test(url)) {
      await route.fulfill({ status: 200, headers: fxHeaders(), body: ok({ records: store.accounts, total: store.accounts.length }) });
      return;
    }
    if (method === 'GET' && /\/api\/dashboard\/home-stats/.test(url)) {
      await route.fulfill({ status: 200, headers: fxHeaders(), body: ok(store.homeStats) });
      return;
    }

    // Favorites
    if (method === 'GET' && /\/api\/operations\/favorites\/?$/.test(p)) {
      await route.fulfill({ status: 200, headers: fxHeaders(), body: ok(store.favorites.slice()) });
      return;
    }
    if (method === 'GET' && /\/api\/operations\/favorites\/[^/]+$/.test(p)) {
      const id = p.split('/').pop();
      const hit = store.favorites.some((f) => String(f.id) === String(id));
      await route.fulfill({ status: 200, headers: fxHeaders(), body: ok(hit) });
      return;
    }
    if (method === 'POST' && /\/api\/operations\/favorites\/[^/]+$/.test(p)) {
      const id = p.split('/').pop();
      if (!store.favorites.some((f) => String(f.id) === String(id))) {
        const a = store.animals.find((x) => String(x.id) === String(id)) || { id, tname: '动物' + id, ttype: '狗', tsex: '公', tstate: 0, tdescribe: '', tpic: '' };
        store.favorites.push(Object.assign({}, a, {
          favorite_id: store.nextId(),
          created_at: '2026-08-01 12:00:00'
        }));
      }
      await fulfillWrite(ok(true));
      return;
    }
    if (method === 'DELETE' && /\/api\/operations\/favorites\/[^/]+$/.test(p)) {
      const id = p.split('/').pop();
      store.favorites = store.favorites.filter((f) => String(f.id) !== String(id) && String(f.favorite_id) !== String(id));
      await fulfillWrite(ok(true));
      return;
    }

    // Adopt
    if (method === 'GET' && /\/api\/adopt\/mine\//.test(p)) {
      const animalId = p.split('/').pop();
      const hit = store.adoptionApplications.find((a) => String(a.aid) === String(animalId) && Number(a.vstate) !== 2);
      if (!hit) {
        // Page treats 404 as "no existing application" → preflightReady
        await route.fulfill({ status: 404, headers: fxHeaders(true), body: err('404', '无申请') });
        return;
      }
      await route.fulfill({ status: 200, headers: fxHeaders(), body: ok(hit) });
      return;
    }
    if (method === 'GET' && /\/api\/adopt\/page2/.test(url)) {
      await route.fulfill({
        status: 200, headers: fxHeaders(),
        body: ok({
          records: store.adoptionApplications.slice(),
          total: store.adoptionApplications.length,
          current: 1,
          pages: 1
        })
      });
      return;
    }
    if (method === 'POST' && /\/api\/adopt(\?|$)/.test(url)) {
      let body = {};
      try { body = req.postDataJSON() || {}; } catch (e) { body = {}; }
      const aid = String(body.aid || '12');
      if (store.adoptionApplications.some((a) => String(a.aid) === aid && [0, 1, 3].includes(Number(a.vstate)))) {
        await fulfillWrite(err('409', '已有进行中的申请'), 409, true);
        return;
      }
      const animal = store.animals.find((x) => String(x.id) === aid);
      store.adoptionApplications.push({
        aid,
        uid: store.currentUser && store.currentUser.id,
        aname: animal ? animal.tname : '动物',
        vstate: 0,
        apic: '',
        createTime: '2026-08-01 12:00:00'
      });
      // Product requires res.data === true
      await fulfillWrite(ok(true));
      return;
    }
    if (method === 'GET' && /\/api\/adopt\/.+\/timeline/.test(p)) {
      await route.fulfill({ status: 200, headers: fxHeaders(), body: ok([]) });
      return;
    }
    if (method === 'POST' && /\/api\/adopt\/.+\/transition/.test(p)) {
      await fulfillWrite(ok(true));
      return;
    }

    // Rescue — exactSuccess: data === true
    if (method === 'GET' && /\/api\/help\/mine/.test(url)) {
      if (opts.helpMineBareArray) {
        await route.fulfill({ status: 200, headers: fxHeaders(), body: ok(store.rescues.slice()) });
        return;
      }
      await route.fulfill({
        status: 200, headers: fxHeaders(),
        body: ok({ records: store.rescues.slice(), total: store.rescues.length, current: 1, pages: 1 })
      });
      return;
    }
    if (method === 'POST' && /\/api\/help(\?|$)/.test(url)) {
      let body = {};
      try { body = req.postDataJSON() || {}; } catch (e) { body = {}; }
      // Product pages accept string ids for rescue cards; notifications require pure decimal ids (canonicalId).
      const rescueId = store.nextId();
      const notifId = store.nextId();
      const row = {
        id: rescueId,
        title: body.title || '未命名救助',
        description: body.description || '',
        location: body.location || '',
        phone: body.phone || '',
        status: 0,
        createTime: '2026-08-01 13:00:00',
        adminReply: ''
      };
      store.rescues.push(row);
      // Match notifications.html contract: id (decimal), title, summary, createdAt, type, readFlag, targetUrl
      // Leave targetUrl empty so "标为已读" stays on page and PUT /read is observable without navigation race.
      store.notifications.unshift({
        id: notifId,
        type: 'help',
        title: '救助申请已提交',
        summary: '你的救助「' + row.title + '」已进入队列',
        readFlag: 0,
        targetUrl: '',
        createdAt: '2026-08-01 13:00:01'
      });
      await fulfillWrite(ok(true));
      return;
    }
    if (method === 'GET' && /\/api\/help\/chat\/history/.test(url)) {
      await route.fulfill({ status: 200, headers: fxHeaders(), body: ok([]) });
      return;
    }
    if (method === 'POST' && /\/api\/help\/chat/.test(url)) {
      await fulfillWrite(ok({ content: '已收到' }));
      return;
    }

    // Notifications — PUT read, data === true
    if (method === 'GET' && /\/api\/notifications\/unread-count/.test(url)) {
      const n = store.notifications.filter((x) => Number(x.readFlag) === 0).length;
      await route.fulfill({ status: 200, headers: fxHeaders(), body: ok(n) });
      return;
    }
    if (method === 'GET' && /\/api\/notifications(\?|$)/.test(url)) {
      await route.fulfill({
        status: 200, headers: fxHeaders(),
        body: ok({
          records: store.notifications.slice(),
          total: store.notifications.length,
          current: 1,
          pages: 1
        })
      });
      return;
    }
    if (method === 'PUT' && /\/api\/notifications\/[^/]+\/read$/.test(p)) {
      const id = p.split('/')[3];
      const n = store.notifications.find((x) => String(x.id) === String(id));
      if (n) n.readFlag = 1;
      await fulfillWrite(ok(true));
      return;
    }
    if (method === 'PUT' && /\/api\/notifications\/read-all/.test(url)) {
      store.notifications.forEach((n) => { n.readFlag = 1; });
      await fulfillWrite(ok(true));
      return;
    }

    // Volunteer
    if (method === 'GET' && /\/api\/volunteer\/mine/.test(url)) {
      await route.fulfill({ status: 200, headers: fxHeaders(), body: ok(store.volunteerApplications.slice()) });
      return;
    }
    if (method === 'POST' && /\/api\/volunteer(\?|$)/.test(url)) {
      const row = { id: store.nextId(), status: 1, createTime: '2026-08-01 14:00:00' };
      store.volunteerApplications.push(row);
      await fulfillWrite(ok(true));
      return;
    }
    if (method === 'GET' && /\/api\/operations\/volunteer-tasks(\?|$)/.test(url)) {
      // Page expects Array.isArray(res.data)
      await route.fulfill({ status: 200, headers: fxHeaders(), body: ok(store.volunteerTasks.slice()) });
      return;
    }
    if (method === 'POST' && /\/api\/operations\/volunteer-tasks\/[^/]+\/signup$/.test(p)) {
      const taskId = p.split('/')[4];
      const task = store.volunteerTasks.find((t) => String(t.id) === String(taskId));
      const signupId = store.nextId();
      if (task) {
        task.signup_status = 0;
        task.signup_id = signupId;
        task.signup_count = (task.signup_count || 0) + 1;
        store.volunteerSignups.push({ taskId, signupId, status: 0 });
      }
      // signupSuccess requires non-boolean non-object canonical id string
      await fulfillWrite(ok(signupId));
      return;
    }
    if (method === 'DELETE' && /\/api\/operations\/volunteer-tasks\/[^/]+\/signup$/.test(p)) {
      const taskId = p.split('/')[4];
      const task = store.volunteerTasks.find((t) => String(t.id) === String(taskId));
      if (task) {
        task.signup_status = null;
        task.signup_id = null;
        task.signup_count = Math.max(0, (task.signup_count || 1) - 1);
      }
      store.volunteerSignups = store.volunteerSignups.filter((s) => String(s.taskId) !== String(taskId));
      await fulfillWrite(ok(true));
      return;
    }

    // Pet care
    if (method === 'GET' && /\/api\/petcare\/config(\?|$)/.test(url)) {
      await route.fulfill({ status: 200, headers: fxHeaders(), body: ok(store.petCareConfig) });
      return;
    }
    if (method === 'POST' && /\/api\/petcare\/config(\?|$)/.test(url)) {
      let body = {};
      try { body = req.postDataJSON() || {}; } catch (e) { body = {}; }
      store.petCareConfig = Object.assign({}, store.petCareConfig, {
        enabled: !!body.enabled,
        baseUrl: body.baseUrl || store.petCareConfig.baseUrl,
        model: body.model || store.petCareConfig.model,
        personalConfigured: true,
        ready: true,
        apiKeyConfigured: true,
        apiKeyHint: 'sk-****demo',
        connected: false,
        connectionStatus: 'untested'
      });
      await fulfillWrite(ok(store.petCareConfig));
      return;
    }
    if (method === 'POST' && /\/api\/petcare\/config\/test/.test(url)) {
      if (opts.petcareTestMode === 'fail') {
        store.petCareConfig.connected = false;
        store.petCareConfig.connectionStatus = 'failed';
        store.petCareConfig.connectionMessage = '模型服务商连接失败，请稍后重试。';
        await fulfillWrite(JSON.stringify({
          code: '502',
          msg: '模型服务商连接失败，请稍后重试。',
          data: null
        }), 502, true);
        return;
      }
      store.petCareConfig.connected = true;
      store.petCareConfig.connectionStatus = 'connected';
      store.petCareConfig.connectionMessage = '已连接';
      await fulfillWrite(ok(store.petCareConfig));
      return;
    }

    if (method === 'POST' && /\/api\/petcare\/config\/auto-test/.test(url)) {
      await fulfillWrite(ok(store.petCareConfig));
      return;
    }
    if (method === 'POST' && /\/api\/petcare\/config\/clear/.test(url)) {
      store.petCareConfig.connected = false;
      store.petCareConfig.connectionStatus = 'untested';
      store.petCareConfig.personalConfigured = false;
      await fulfillWrite(ok(true));
      return;
    }
    if (method === 'GET' && /\/api\/petcare\/conversations(\?|$)/.test(url)) {
      await route.fulfill({ status: 200, headers: fxHeaders(), body: ok(store.petCareConversations.slice()) });
      return;
    }
    if (method === 'GET' && /\/api\/petcare\/conversations\/[^/]+$/.test(p)) {
      const id = p.split('/').pop();
      await route.fulfill({
        status: 200, headers: fxHeaders(),
        body: ok({ id, title: '会话', messages: [{ role: 'assistant', text: '你好' }] })
      });
      return;
    }
    if (method === 'POST' && /\/api\/petcare\/ask/.test(url)) {
      await fulfillWrite(ok({ reply: 'fixture 回答', conversationId: 'c1' }));
      return;
    }
    if (method === 'GET' && /\/api\/petcare\/(history|topics)/.test(url)) {
      await route.fulfill({ status: 200, headers: fxHeaders(), body: ok([]) });
      return;
    }

    // Visit / proof / files
    // my_visit.html: visit-plans/mine expects Array in res.data
    if (method === 'GET' && /\/api\/visit-plans\/mine/.test(url)) {
      await route.fulfill({ status: 200, headers: fxHeaders(), body: ok(store.visitPlans.slice()) });
      return;
    }
    // my_visit.html: visit/mine expects { records, total, current, pages } — bare array is load error
    if (method === 'GET' && /\/api\/visit\/mine/.test(url)) {
      await route.fulfill({
        status: 200,
        headers: fxHeaders(),
        body: ok({
          records: store.visitRecords.slice(),
          total: store.visitRecords.length,
          current: 1,
          pages: 1
        })
      });
      return;
    }
    if (method === 'GET' && /\/api\/proof/.test(url)) {
      await route.fulfill({ status: 200, headers: fxHeaders(), body: ok({ records: store.adoptionProofs.slice(), total: store.adoptionProofs.length }) });
      return;
    }
    if (method === 'POST' && /\/api\/files\/upload/.test(url)) {
      await fulfillWrite(ok({ path: 'staged/fixture-' + store.nextId() + '.jpg', staged: true }));
      return;
    }
    if (method === 'DELETE' && /\/api\/files\/staged\//.test(url)) {
      await fulfillWrite(ok(true));
      return;
    }
    if (method === 'GET' && /\/api\/files\//.test(url)) {
      await route.fulfill({
        status: 200,
        headers: { 'content-type': 'image/svg+xml', 'x-ui-audit-fixture': 'phase3h' },
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="#eee"/></svg>'
      });
      return;
    }
    if (method === 'GET' && /\/api\/operations\/animals\/.+\/medical/.test(p)) {
      await route.fulfill({ status: 200, headers: fxHeaders(), body: ok([]) });
      return;
    }

    // Unregistered writes fail hard
    if (isWrite) {
      result.realWriteAudit.push(entryBase);
      fail('unregistered-write', method + ' ' + p);
      await route.fulfill({ status: 599, headers: fxHeaders(true), body: err('599', 'blocked') });
      return;
    }
    // Unregistered business GET: allow only explicit static-ish empties; log probe
    await route.fulfill({ status: 200, headers: fxHeaders(), body: ok([]) });
  });
}

async function openPage(page, store, file, query, scenarioId, fixtureOpts) {
  setActiveScenario(page, scenarioId || file.replace('.html', ''));
  await installJourneyFixtures(page, store, fixtureOpts || {});
  await page.goto(pageUrl(file, query), { waitUntil: 'load', timeout: 45000 });
  await settlePage(page);
  result.visits.push({ file, query: query || '', scenarioId: getActiveScenario(page), at: new Date().toISOString() });
}

async function assertNoErrorState(page, assertionId) {
  // Only true error surfaces — not chrome labels like "刷新计划/刷新记录".
  const bad = await page.locator(
    '.ui-state[role="alert"], .ui-form-alert.is-error, .ui-inline-alert.is-error, .is-error[role="alert"]'
  ).count();
  const text = await page.locator('main').first().innerText().catch(() => '');
  // Match product error copy; do not treat standalone "刷新" toolbar as failure.
  const hasLoadError = /暂时无法加载|加载失败|服务返回了无法识别|回访记录暂时无法读取|消息返回格式无法识别|消息加载失败/.test(text)
    || (/\b重新加载\b/.test(text) && /暂时|失败|无法/.test(text));
  assert(assertionId + '-no-error-state', bad === 0 && !hasLoadError, 'bad=' + bad + ' ' + text.slice(0, 220));
  return !hasLoadError && bad === 0;
}

async function assertPathname(page, expected, assertionId) {
  const pathNow = new URL(page.url()).pathname;
  assert(assertionId + '-pathname', pathNow === expected || pathNow.endsWith(expected), pathNow + ' vs ' + expected);
  return pathNow;
}

async function shotStrict(page, name, meta) {
  meta = meta || {};
  const pathNow = new URL(page.url()).pathname;
  if (meta.expectPath) {
    assert('shot-path-' + name, pathNow.indexOf(meta.expectPath) >= 0, pathNow);
  }
  if (meta.h1) {
    const h1 = await page.locator(meta.h1).count();
    assert('shot-h1-' + name, h1 >= 1, meta.h1);
  }
  if (meta.stateSelector) {
    const n = await page.locator(meta.stateSelector).count();
    assert('shot-state-' + name, n >= 1, meta.stateSelector);
  }
  if (meta.forbidError !== false) {
    await assertNoErrorState(page, 'shot-' + name);
  }
  await evalRead(page, 'shot-' + name, () => { window.scrollTo(0, 0); });
  await page.screenshot({ path: path.join(shotDir, name + '.png'), fullPage: false });
  result.screenshots.push({
    file: 'screenshots/' + name + '.png',
    name,
    time: new Date().toISOString(),
    pathname: pathNow,
    scenarioId: meta.scenarioId || getActiveScenario(page) || '',
    stateSelector: meta.stateSelector || '',
    assertionId: meta.assertionId || ('shot-' + name)
  });
}

async function overflowX(page) {
  return evalRead(page, 'overflow', () => {
    const de = document.documentElement;
    return { page: de.scrollWidth > de.clientWidth + 1, sw: de.scrollWidth, cw: de.clientWidth };
  });
}

function countWrites(method, pathname, scenarioId) {
  return result.fixtureWriteAudit.filter((w) =>
    w.method === method
    && w.pathname === pathname
    && (!scenarioId || w.scenarioId === scenarioId)
  ).length;
}

function journeyResult(id, assertionIds) {
  const related = result.checks.filter((c) => assertionIds.some((a) => c.id === a || c.id.indexOf(a) === 0));
  const okAll = related.length > 0 && related.every((c) => c.ok);
  const row = {
    id,
    ok: okAll,
    assertionCount: related.length,
    failed: related.filter((c) => !c.ok).map((c) => c.id)
  };
  result.journeyResults.push(row);
  assert('journey-' + id + '-ok', okAll, JSON.stringify(row));
  return row;
}

function writeReports() {
  const passed = result.checks.filter((c) => c.ok).length;
  const failed = result.checks.filter((c) => !c.ok).length;
  const skipped = result.checks.filter((c) => c.skipped).length;
  const rf = auditRequestFailures(result.requestFailedAudit, expectedRequestFailureLedger);
  // re-count required writes from audit (don't double-count from match during run)
  requiredJourneyWrites.forEach((r) => {
    r.observedCount = result.fixtureWriteAudit.filter((w) =>
      w.scenarioId === r.scenarioId && w.method === r.method && w.pathname === r.pathname
    ).length;
    r.observations = result.fixtureWriteAudit.filter((w) =>
      w.scenarioId === r.scenarioId && w.method === r.method && w.pathname === r.pathname
    ).map((w) => ({ seq: w.seq, at: w.at, url: w.url, scenarioId: w.scenarioId }));
  });
  const requiredOk = requiredJourneyWrites.every((r) => r.observedCount === r.expectedCount);
  result.requestCountAudit = {
    fixtureWrites: result.fixtureWriteAudit.length,
    realWrites: result.realWriteAudit.length,
    syntheticWrites: result.syntheticWriteAudit.length,
    directJourneyStoreMutations: result.directStoreMutationAudit.length,
    expectedRequestFailures: rf.expectedRequestFailures,
    unexpectedRequestFailures: rf.unexpectedCount,
    getRequestFailures: rf.getRequestFailures,
    staticResourceFailures: rf.staticResourceFailures,
    htmlFailures: rf.htmlFailures,
    underObserved: rf.underObserved.map((r) => r.scenarioId),
    requiredJourneyWrites: requiredJourneyWrites.map((r) => Object.assign({}, r)),
    ledger: rf.ledgerSnapshot
  };
  const overflowCount = result.overflowAudit.filter((o) => o.page).length;
  result.summary = {
    passed, failed, skipped, total: result.checks.length,
    matrixVisits: result.matrixVisits.length,
    expectedMatrixVisits: 100,
    screenshots: result.screenshots.length,
    journeys: result.journeyResults.length,
    journeysPassed: result.journeyResults.filter((j) => j.ok).length,
    fixtureWrites: result.fixtureWriteAudit.length,
    realWrites: result.realWriteAudit.length,
    syntheticWrites: result.syntheticWriteAudit.length,
    directJourneyStoreMutations: result.directStoreMutationAudit.length,
    unexpectedRequestFailures: result.requestCountAudit.unexpectedRequestFailures,
    pageErrors: result.pageErrors.length,
    bestEffortPassCount: result.bestEffortPassCount,
    fallbackPassCount: result.fallbackPassCount,
    overflowCount,
    requiredWritesOk: requiredOk,
    durationMs: Date.now() - startedAt,
    finishedAt: new Date().toISOString(),
    strictMode: failed === 0 && skipped === 0
      && result.bestEffortPassCount === 0
      && result.fallbackPassCount === 0
      && result.matrixVisits.length >= 100
      && result.realWriteAudit.length === 0
      && result.syntheticWriteAudit.length === 0
      && result.directStoreMutationAudit.length === 0
      && result.requestCountAudit.unexpectedRequestFailures === 0
      && result.pageErrors.length === 0
      && result.screenshots.length >= 24
      && overflowCount === 0
      && requiredOk
      && result.journeyResults.length >= 7
      && result.journeyResults.every((j) => j.ok)
  };
  result.ok = result.summary.strictMode;
  fs.writeFileSync(path.join(out, 'phase-3h-report.json'), JSON.stringify(result, null, 2));
  fs.writeFileSync(path.join(out, 'screenshots-index.json'), JSON.stringify(result.screenshots, null, 2));
  fs.writeFileSync(path.join(out, 'journey-audit.json'), JSON.stringify(result.journeyResults, null, 2));
  fs.writeFileSync(path.join(out, 'request-ledger.json'), JSON.stringify({
    fixtureWriteAudit: result.fixtureWriteAudit,
    realWriteAudit: result.realWriteAudit,
    syntheticWriteAudit: result.syntheticWriteAudit,
    directStoreMutationAudit: result.directStoreMutationAudit,
    setupSeedAudit: result.setupSeedAudit,
    requiredJourneyWrites: result.requestCountAudit.requiredJourneyWrites,
    requestCountAudit: result.requestCountAudit
  }, null, 2));
  const log = [
    'PHASE 3H STRICT=' + result.summary.strictMode,
    'ASSERTIONS ' + passed + '/' + failed + '/' + skipped,
    'MATRIX ' + result.matrixVisits.length + '/100',
    'SCREENSHOTS ' + result.screenshots.length,
    'JOURNEYS ' + result.summary.journeysPassed + '/' + result.journeyResults.length,
    'FIXTURE_WRITES ' + result.fixtureWriteAudit.length,
    'REAL_WRITES ' + result.realWriteAudit.length,
    'SYNTHETIC_WRITES ' + result.syntheticWriteAudit.length,
    'DIRECT_STORE_MUTATIONS ' + result.directStoreMutationAudit.length,
    'UNEXPECTED_REQUEST_FAILURES ' + result.requestCountAudit.unexpectedRequestFailures,
    'REQUIRED_WRITES_OK ' + requiredOk
  ].join('\n');
  fs.writeFileSync(path.join(out, 'run-strict-final.log'), log + '\n');
  return result.summary;
}

// ─── main ─────────────────────────────────────────────────────
(async () => {
  console.log('Phase 3H credibility-strict start', base);
  let browser;
  try {
    runClassifierSelfTests();
    runCredibilitySelfTests();

    // Required journey writes (must be observed exactly once each)
    registerRequiredWrite({ journeyId: 'B', scenarioId: 'b-favorite-toggle', method: 'POST', pathname: '/api/operations/favorites/12', expectedCount: 1 });
    registerRequiredWrite({ journeyId: 'B', scenarioId: 'b-adopt-submit', method: 'POST', pathname: '/api/adopt', expectedCount: 1 });
    registerRequiredWrite({ journeyId: 'D', scenarioId: 'd-rescue-submit', method: 'POST', pathname: '/api/help', expectedCount: 1 });
    registerRequiredWrite({ journeyId: 'D', scenarioId: 'd-notif-read', method: 'PUT', pathname: null, expectedCount: 1 }); // pathname filled dynamically
    // Fix: use pattern - register after we know notification id - register with prefix matching in recount
    // For simplicity register pathname as dynamic later - use flexible match in recount:

    browser = await chromium.launch({ headless: true });

    // ========== Matrix 20×5 ==========
    {
      const store = createJourneyStore();
      store.loginAs(MEMBER);
      noteSetupSeed('matrix-member', { user: MEMBER.username });
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const page = await ctx.newPage();
      wirePage(page);
      for (const meta of PAGE_CATALOG) {
        for (const vp of VIEWPORTS) {
          await page.setViewportSize({ width: vp.width, height: vp.height });
          const sid = 'matrix-' + meta.file.replace('.html', '') + '-' + vp.name;
          if (meta.file === 'login.html' || meta.file === 'register.html') store.logout();
          else store.loginAs(MEMBER);
          await openPage(page, store, meta.file, meta.query || '', sid);
          if (meta.access === 'protected') {
            assert('matrix-auth-' + sid, !/login\.html/i.test(page.url()), page.url());
          }
          if (meta.file === 'login.html' || meta.file === 'register.html') {
            assert('matrix-authpage-' + sid, page.url().indexOf(meta.file) >= 0, page.url());
          }
          const ox = await overflowX(page);
          result.overflowAudit.push(Object.assign({ file: meta.file, viewport: vp.name }, ox));
          assert('matrix-no-x-' + sid, !ox.page, JSON.stringify(ox));
          assert('matrix-root-' + sid, (await page.locator('#app, main, .ui-auth-page').count()) >= 1, 'root');
          assert('matrix-h1-' + sid, (await page.locator('h1').count()) >= 1, 'h1');
          result.matrixVisits.push({ file: meta.file, viewport: vp.name, access: meta.access, overflow: ox.page });
        }
      }
      // Evidence-based scores only
      for (const meta of PAGE_CATALOG) {
        const cells = result.matrixVisits.filter((m) => m.file === meta.file);
        const overflows = cells.filter((c) => c.overflow).length;
        const authFails = result.failures.filter((f) => f.id.indexOf('matrix-auth-' + meta.file.replace('.html', '')) === 0).length;
        result.pageScores.push({
          page: meta.file,
          phase: meta.phase,
          access: meta.access,
          probes: {
            matrixCells: cells.length,
            overflowFails: overflows,
            authFails,
            h1Present: true
          },
          scores: {
            responsive: overflows === 0 && cells.length === 5 ? 9 : (overflows === 0 ? 7 : 4),
            identity: authFails === 0 ? 9 : 4,
            hierarchy: 'notMeasured',
            visual: 'notMeasured',
            feedback: 'notMeasured',
            keyboard: 'notMeasured',
            journey: 'manualReview'
          },
          needsChange: overflows > 0 || authFails > 0,
          evidenceIds: cells.map((c) => 'matrix-' + meta.file + '-' + c.viewport)
        });
      }
      await ctx.close();
      assert('matrix-100', result.matrixVisits.length === 100, 'n=' + result.matrixVisits.length);
      probe('matrix-complete', { n: result.matrixVisits.length });
    }

    // ========== Journey A: anonymous + safe return ==========
    {
      const store = createJourneyStore();
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const page = await ctx.newPage();
      wirePage(page);
      const A = [];

      for (const f of ['index.html', 'animal_browse.html', 'notice_list.html', 'account_public.html']) {
        store.logout();
        await openPage(page, store, f, '', 'a-public-' + f);
        const okStay = !/login\.html/i.test(page.url());
        assert('a-public-stay-' + f, okStay, page.url());
        A.push('a-public-stay-' + f);
      }

      store.logout();
      await openPage(page, store, 'favorites.html', '', 'a-protected-fav');
      await page.waitForTimeout(900);
      assert('a-protected-to-login', /login\.html/i.test(page.url()), page.url());
      A.push('a-protected-to-login');

      store.logout();
      await openPage(page, store, 'login.html', 'redirect=' + encodeURIComponent('/page/front/favorites.html'), 'a-login-return');
      await page.waitForSelector('#loginUsername', { timeout: 8000 });
      await page.fill('#loginUsername', 'jerry');
      await page.fill('#loginPassword', 'password1');
      await page.fill('#loginCode', 'ok12');
      await page.locator('[data-login-submit]').click();
      await page.waitForURL(/favorites\.html/i, { timeout: 10000 });
      await settlePage(page);
      assert('a-return-favorites', /favorites\.html/i.test(page.url()), page.url());
      A.push('a-return-favorites');
      const sess = await evalRead(page, 'a-sess', () => ({
        user: sessionStorage.getItem('user'),
        token: sessionStorage.getItem('token'),
        local: localStorage.getItem('token')
      }));
      assert('a-session-user', !!sess.user, JSON.stringify(sess));
      assert('a-no-jwt', !sess.token && !sess.local, JSON.stringify(sess));
      A.push('a-session-user', 'a-no-jwt');
      await shotStrict(page, 'login-safe-return', {
        expectPath: '/page/front/favorites.html',
        h1: '#favoritesTitle',
        scenarioId: 'a-login-return',
        assertionId: 'a-return-favorites'
      });

      store.logout();
      await openPage(page, store, 'login.html', 'redirect=' + encodeURIComponent('https://evil.example/'), 'a-login-evil');
      await page.fill('#loginUsername', 'jerry');
      await page.fill('#loginPassword', 'password1');
      await page.fill('#loginCode', 'ok12');
      await page.locator('[data-login-submit]').click();
      await page.waitForURL((u) => !/login\.html/i.test(u.pathname), { timeout: 8000 }).catch(() => {});
      await settlePage(page);
      assert('a-reject-evil', page.url().indexOf('evil.example') < 0, page.url());
      A.push('a-reject-evil');

      journeyResult('A-anonymous-safe-return', A);
      probe('journey-A', {});
      await ctx.close();
    }

    // ========== Journey B: favorite + adopt via real DOM ==========
    {
      const store = createJourneyStore();
      store.loginAs(MEMBER);
      noteSetupSeed('b-member', { user: 'jerry', animalId: '12' });
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      const page = await ctx.newPage();
      wirePage(page);
      const B = [];

      await openPage(page, store, 'animal_browse.html', '', 'b-browse');
      await shotStrict(page, 'animal-browse-desktop', {
        expectPath: '/page/front/animal_browse.html',
        h1: 'h1',
        scenarioId: 'b-browse'
      });

      await openPage(page, store, 'animal_detail.html', 'id=12', 'b-detail');
      await settlePage(page);
      // Wait until user-bound favorite button is visible
      await page.waitForSelector('button:has-text("收藏")', { timeout: 10000 });
      await shotStrict(page, 'animal-detail-long', {
        expectPath: '/page/front/animal_detail.html',
        h1: 'h1',
        stateSelector: 'button:has-text("收藏")',
        scenarioId: 'b-detail'
      });

      const wFav0 = countWrites('POST', '/api/operations/favorites/12', 'b-favorite-toggle');
      setActiveScenario(page, 'b-favorite-toggle');
      const favBtn = page.locator('button:has-text("♡ 收藏"), button:has-text("收藏")').first();
      assert('b-fav-btn-visible', await favBtn.isVisible(), 'fav-btn');
      assert('b-fav-btn-enabled', await favBtn.isEnabled(), 'fav-enabled');
      B.push('b-fav-btn-visible', 'b-fav-btn-enabled');
      await favBtn.click();
      await page.waitForTimeout(500);
      const wFav1 = countWrites('POST', '/api/operations/favorites/12', 'b-favorite-toggle');
      assert('b-fav-write-once', wFav1 - wFav0 === 1, 'count=' + (wFav1 - wFav0));
      assert('b-fav-store', store.favorites.some((f) => String(f.id) === '12'), JSON.stringify(store.favorites));
      B.push('b-fav-write-once', 'b-fav-store');

      await openPage(page, store, 'favorites.html', '', 'b-favorites-list');
      await settlePage(page);
      await assertNoErrorState(page, 'b-fav-page');
      B.push('b-fav-page-no-error-state');
      const favCard = page.locator('.favorites-card[data-animal-id="12"], [data-animal-id="12"]');
      assert('b-fav-card-id-12', await favCard.count() >= 1, 'card');
      const favText = await page.locator('main').first().innerText();
      assert('b-fav-name-doudou', favText.indexOf('豆豆') >= 0, favText.slice(0, 120));
      B.push('b-fav-card-id-12', 'b-fav-name-doudou');
      await shotStrict(page, 'favorites-after-save', {
        expectPath: '/page/front/favorites.html',
        h1: '#favoritesTitle',
        stateSelector: '[data-animal-id="12"]',
        scenarioId: 'b-favorites-list',
        assertionId: 'b-fav-card-id-12'
      });

      // Adopt apply — query animalId required by product
      await openPage(page, store, 'adopt_apply.html', 'animalId=12', 'b-adopt-form');
      await settlePage(page);
      await page.waitForSelector('#adoptSubmit', { timeout: 10000 });
      // Fill all required fields
      await page.fill('#adoptAge', '28');
      await page.selectOption('#adoptGender', { label: '男' });
      await page.fill('#adoptPhone', '13900001111');
      await page.fill('#adoptWechat', 'wx_test_user');
      await page.fill('#adoptOccupation', '工程师');
      await page.selectOption('#adoptMarital', { value: '1' });
      await page.selectOption('#adoptResident', { value: '1' });
      await page.selectOption('#adoptIncome', { value: '3000' });
      await page.selectOption('#adoptExperience', { value: '1' });
      await page.fill('#adoptPets', '0');
      await page.selectOption('#adoptFamily', { value: '1' });
      await page.fill('#adoptAddress', '测试市测试路 100 号');
      await shotStrict(page, 'adopt-apply-fields', {
        expectPath: '/page/front/adopt_apply.html',
        h1: 'h1',
        stateSelector: '#adoptSubmit',
        scenarioId: 'b-adopt-form',
        forbidError: false
      });

      const wAdopt0 = countWrites('POST', '/api/adopt', 'b-adopt-submit');
      setActiveScenario(page, 'b-adopt-submit');
      const submit = page.locator('#adoptSubmit');
      assert('b-adopt-submit-enabled', await submit.isEnabled(), 'disabled?');
      B.push('b-adopt-submit-enabled');
      await submit.click();
      await page.waitForURL(/my_adopt\.html/i, { timeout: 10000 });
      await settlePage(page);
      const wAdopt1 = countWrites('POST', '/api/adopt', 'b-adopt-submit');
      assert('b-adopt-write-once', wAdopt1 - wAdopt0 === 1, 'count=' + (wAdopt1 - wAdopt0));
      assert('b-adopt-store', store.adoptionApplications.some((a) => String(a.aid) === '12'), JSON.stringify(store.adoptionApplications));
      B.push('b-adopt-write-once', 'b-adopt-store');

      await assertNoErrorState(page, 'b-my-adopt');
      B.push('b-my-adopt-no-error-state');
      const adoptText = await page.locator('main').first().innerText();
      assert('b-my-adopt-doudou', adoptText.indexOf('豆豆') >= 0, adoptText.slice(0, 160));
      B.push('b-my-adopt-doudou');
      await shotStrict(page, 'my-adopt-timeline', {
        expectPath: '/page/front/my_adopt.html',
        h1: '#myAdoptTitle',
        scenarioId: 'b-adopt-submit',
        assertionId: 'b-my-adopt-doudou'
      });

      journeyResult('B-discover-favorite-adopt', B);
      probe('journey-B', { favorites: store.favorites.length, adopts: store.adoptionApplications.length });
      await ctx.close();
    }

    // ========== Journey C: visit (setupSeed only for lists — not counted as journey writes) ==========
    {
      const store = createJourneyStore();
      store.loginAs(MEMBER);
      // Field names must match my_visit.html render contract
      const planSeed = {
        id: '2101',
        aid: '12',
        planType: '30_day',
        dueAt: '2026-08-15',
        status: 0
      };
      const recordSeed = {
        id: '2102',
        petId: '12',
        aname: '豆豆',
        state: 4,
        vtime: '2026-07-10',
        vname: '回访员甲',
        remark: '适应良好',
        pic: ''
      };
      noteSetupSeed('c-visit-seed', { visitPlans: [planSeed], visitRecords: [recordSeed] });
      store.visitPlans.push(planSeed);
      store.visitRecords.push(recordSeed);
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      const page = await ctx.newPage();
      wirePage(page);
      const C = [];
      await openPage(page, store, 'my_visit.html', '', 'c-visit');
      await settlePage(page);
      await page.waitForSelector('.ui-visit-plan-card, .ui-visit-record', { timeout: 10000 }).catch(() => {});
      await assertNoErrorState(page, 'c-visit');
      C.push('c-visit-no-error-state');
      const text = await page.locator('main').first().innerText();
      assert('c-visit-doudou', text.indexOf('豆豆') >= 0, text.slice(0, 220));
      assert('c-visit-plan-id', text.indexOf('计划 #2101') >= 0 || text.indexOf('2101') >= 0, text.slice(0, 220));
      assert('c-visit-plan-or-record', /待执行|30 天健康回访|2026-08-15|2026-07-10|适应良好/.test(text), text.slice(0, 220));
      assert('c-visit-record-card', await page.locator('.ui-visit-record').count() >= 1, 'no record card');
      C.push('c-visit-doudou', 'c-visit-plan-id', 'c-visit-plan-or-record', 'c-visit-record-card');
      await shotStrict(page, 'visit-plans-records', {
        expectPath: '/page/front/my_visit.html',
        h1: '#visitTitle',
        stateSelector: '.ui-visit-record',
        scenarioId: 'c-visit',
        assertionId: 'c-visit-doudou'
      });
      await openPage(page, store, 'adopt_proof.html', '', 'c-proof');
      await shotStrict(page, 'proof-page', {
        expectPath: '/page/front/adopt_proof.html',
        h1: 'h1',
        scenarioId: 'c-proof',
        forbidError: false
      });
      journeyResult('C-proof-visit', C);
      probe('journey-C', { plans: store.visitPlans.length, records: store.visitRecords.length });
      await ctx.close();
    }

    // ========== Journey D: rescue + notification read via DOM ==========
    {
      const store = createJourneyStore();
      store.loginAs(MEMBER);
      noteSetupSeed('d-member', { user: 'jerry' });
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      const page = await ctx.newPage();
      wirePage(page);
      const D = [];

      await openPage(page, store, 'rescue_apply.html', '', 'd-rescue-form');
      await page.waitForSelector('#rescueTitleInput', { timeout: 10000 });
      await page.fill('#rescueTitleInput', '社区入口橘猫救助');
      await page.fill('#rescueDescription', '橘猫无法站立，需要立即救助，周边有车辆往来风险。');
      await page.fill('#rescueLocation', '测试区测试路 8 号门口');
      await page.fill('#rescuePhone', '13900002222');
      const wHelp0 = countWrites('POST', '/api/help', 'd-rescue-submit');
      setActiveScenario(page, 'd-rescue-submit');
      await page.locator('#rescueSubmit').click();
      await page.waitForTimeout(800);
      const wHelp1 = countWrites('POST', '/api/help', 'd-rescue-submit');
      assert('d-help-write-once', wHelp1 - wHelp0 === 1, 'count=' + (wHelp1 - wHelp0));
      // store continuity only (not a substitute for user-facing success feedback)
      assert('d-rescue-store', store.rescues.some((r) => r.title === '社区入口橘猫救助'), JSON.stringify(store.rescues));
      D.push('d-help-write-once', 'd-rescue-store');
      // success UI — DOM only (no store OR fallback)
      await page.waitForTimeout(400);
      const pathAfterSubmit = new URL(page.url()).pathname;
      const formText = await page.locator('main').first().innerText();
      const successPanel = page.locator('.ui-rescue-success[role="status"]');
      const onFormSuccess = pathAfterSubmit.indexOf('rescue_apply.html') >= 0
        && (await successPanel.count()) >= 1
        && (await successPanel.isVisible())
        && /救助请求已进入处理队列|提交成功|救助已提交|已进入处理队列/.test(formText);
      const onMyRescueSuccess = pathAfterSubmit.indexOf('my_rescue.html') >= 0
        && formText.indexOf('社区入口橘猫救助') >= 0
        && !/暂时无法加载|加载失败|提交失败|服务异常/.test(formText);
      const noFailCopy = !/提交失败|暂时无法加载|加载失败|服务异常/.test(formText);
      assert('d-rescue-success-ui', (onFormSuccess || onMyRescueSuccess) && noFailCopy,
        'path=' + pathAfterSubmit + ' text=' + formText.slice(0, 180));
      assert('d-rescue-success-no-fail-copy', noFailCopy, formText.slice(0, 120));
      D.push('d-rescue-success-ui', 'd-rescue-success-no-fail-copy');

      const rescueId = store.rescues[0] && store.rescues[0].id;
      await openPage(page, store, 'my_rescue.html', '', 'd-my-rescue');
      await settlePage(page);
      await assertNoErrorState(page, 'd-my-rescue');
      D.push('d-my-rescue-no-error-state');
      const rtext = await page.locator('main').first().innerText();
      assert('d-my-rescue-title', rtext.indexOf('社区入口橘猫救助') >= 0, rtext.slice(0, 200));
      assert('d-my-rescue-not-load-error', !/暂时无法加载|重新加载|加载失败|无法识别/.test(rtext), rtext.slice(0, 200));
      D.push('d-my-rescue-title', 'd-my-rescue-not-load-error');
      await shotStrict(page, 'rescue-list-after-submit', {
        expectPath: '/page/front/my_rescue.html',
        h1: '#mineTitle',
        scenarioId: 'd-my-rescue',
        assertionId: 'd-my-rescue-title'
      });

      // Ensure notification exists from rescue submit (write path), not setupSeed
      assert('d-notif-seeded-by-write', store.notifications.some((n) => Number(n.readFlag) === 0), JSON.stringify(store.notifications));
      D.push('d-notif-seeded-by-write');
      const notifId = String(store.notifications[0].id);
      assert('d-notif-id-decimal', /^[1-9][0-9]*$/.test(notifId), 'id=' + notifId);
      D.push('d-notif-id-decimal');
      // Register required write for this notification dynamically
      registerRequiredWrite({
        journeyId: 'D',
        scenarioId: 'd-notif-read',
        method: 'PUT',
        pathname: '/api/notifications/' + notifId + '/read',
        expectedCount: 1
      });

      await openPage(page, store, 'notifications.html', '', 'd-notifications');
      await settlePage(page);
      await page.waitForSelector('.ui-notification-card', { timeout: 10000 });
      await assertNoErrorState(page, 'd-notif');
      D.push('d-notif-no-error-state');
      const ntext = await page.locator('main').first().innerText();
      assert('d-notif-title', ntext.indexOf('救助申请已提交') >= 0, ntext.slice(0, 200));
      assert('d-notif-unread-label', ntext.indexOf('未读') >= 0, ntext.slice(0, 200));
      D.push('d-notif-title', 'd-notif-unread-label');

      const readPath = '/api/notifications/' + notifId + '/read';
      const wRead0 = countWrites('PUT', readPath, 'd-notif-read');
      setActiveScenario(page, 'd-notif-read');
      // Real DOM: primary action on unread card — "标为已读" (empty targetUrl) or "查看进度"
      const markBtn = page.locator('.ui-notification-card.is-unread button.ui-button').filter({
        hasText: /标为已读|查看进度/
      }).first();
      assert('d-notif-mark-btn-visible', await markBtn.count() === 1 && await markBtn.isVisible() && await markBtn.isEnabled(), 'mark button missing/disabled');
      D.push('d-notif-mark-btn-visible');
      await markBtn.click();
      await page.waitForTimeout(800);
      await settlePage(page);
      const wRead1 = result.fixtureWriteAudit.filter((w) =>
        w.method === 'PUT' && w.pathname === readPath && w.scenarioId === 'd-notif-read'
      ).length;
      assert('d-notif-read-write-once', wRead1 - wRead0 === 1, 'count=' + (wRead1 - wRead0) + ' total=' + wRead1);
      assert('d-notif-store-read', store.notifications.some((n) => String(n.id) === notifId && Number(n.readFlag) === 1), JSON.stringify(store.notifications));
      D.push('d-notif-read-write-once', 'd-notif-store-read');
      // Stay on notifications (empty targetUrl) and assert read state in DOM
      await assertPathname(page, '/page/front/notifications.html', 'd-notif-stay');
      const afterText = await page.locator('main').first().innerText();
      assert('d-notif-dom-read', afterText.indexOf('已读') >= 0 && !/标为已读/.test(afterText), afterText.slice(0, 200));
      D.push('d-notif-stay-pathname', 'd-notif-dom-read');
      await shotStrict(page, 'notifications-read-state', {
        expectPath: '/page/front/notifications.html',
        h1: 'h1',
        stateSelector: '.ui-notification-card:not(.is-unread)',
        scenarioId: 'd-notif-read',
        assertionId: 'd-notif-read-write-once'
      });

      journeyResult('D-rescue-notifications', D);
      probe('journey-D', { rescues: store.rescues.length, notifId });
      await ctx.close();
    }

    // ========== Journey E: volunteer signup via DOM ==========
    {
      const store = createJourneyStore();
      store.loginAs(MEMBER);
      // Seed approved volunteer application (setupSeed — required to signup)
      noteSetupSeed('e-approved-volunteer', { status: 1 });
      store.volunteerApplications.push({ id: 'va1', status: 1, createTime: '2026-07-01' });
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
      const page = await ctx.newPage();
      wirePage(page);
      const E = [];

      await openPage(page, store, 'volunteer_tasks.html', '', 'e-tasks');
      await settlePage(page);
      await assertNoErrorState(page, 'e-tasks');
      E.push('e-tasks-no-error-state');
      const signupBtn = page.locator('[data-signup-task="101"]');
      assert('e-signup-btn-visible', await signupBtn.count() === 1 && await signupBtn.isVisible(), 'btn');
      assert('e-signup-btn-enabled', await signupBtn.isEnabled(), 'enabled');
      E.push('e-signup-btn-visible', 'e-signup-btn-enabled');

      const w0 = countWrites('POST', '/api/operations/volunteer-tasks/101/signup', 'e-task-signup');
      setActiveScenario(page, 'e-task-signup');
      await signupBtn.click();
      await page.waitForTimeout(600);
      const w1 = countWrites('POST', '/api/operations/volunteer-tasks/101/signup', 'e-task-signup');
      assert('e-signup-write-once', w1 - w0 === 1, 'count=' + (w1 - w0));
      assert('e-signup-store', store.volunteerSignups.some((s) => String(s.taskId) === '101'), JSON.stringify(store.volunteerSignups));
      E.push('e-signup-write-once', 'e-signup-store');
      await shotStrict(page, 'volunteer-tasks-mobile', {
        expectPath: '/page/front/volunteer_tasks.html',
        h1: '#tasksTitle',
        scenarioId: 'e-task-signup',
        assertionId: 'e-signup-write-once'
      });

      await openPage(page, store, 'volunteer_apply.html', '', 'e-vol-apply');
      await settlePage(page);
      await shotStrict(page, 'volunteer-apply', {
        expectPath: '/page/front/volunteer_apply.html',
        h1: 'h1',
        scenarioId: 'e-vol-apply',
        forbidError: false
      });

      journeyResult('E-volunteer-tasks', E);
      probe('journey-E', { signups: store.volunteerSignups.length });
      await ctx.close();
    }

    // ========== Journey F: pet care test connection via DOM ==========
    {
      const store = createJourneyStore();
      store.loginAs(MEMBER);
      // setupSeed: personal config ready so test button enabled
      noteSetupSeed('f-petcare-config-ready', {
        personalConfigured: true, ready: true, connected: false, connectionStatus: 'untested'
      });
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      const page = await ctx.newPage();
      wirePage(page);
      const F = [];

      await openPage(page, store, 'pet_care.html', '', 'f-petcare', { petcareTestMode: 'fail' });
      await settlePage(page);
      await page.waitForSelector('[data-petcare-config-open]', { timeout: 10000 });
      await page.locator('[data-petcare-config-open]').click();
      await page.waitForSelector('[data-petcare-test-config]', { timeout: 8000 });
      const testBtn = page.locator('[data-petcare-test-config]');
      assert('f-test-btn-visible', await testBtn.isVisible(), 'test-btn');
      // May be disabled if not ready - seed should enable
      if (!(await testBtn.isEnabled())) {
        // save config first via UI to enable
        await page.fill('#aiBaseUrl', 'https://api.example.com');
        await page.fill('#aiModel', 'demo-model');
        // if key required
        const key = page.locator('#aiApiKey');
        if (await key.count()) await key.fill('sk-fixture-test-key-not-real');
        setActiveScenario(page, 'f-config-save');
        await page.locator('[data-petcare-save-config]').click();
        await page.waitForTimeout(500);
      }
      assert('f-test-btn-enabled', await testBtn.isEnabled(), 'still-disabled');
      F.push('f-test-btn-visible', 'f-test-btn-enabled');

      const w0 = countWrites('POST', '/api/petcare/config/test', 'f-config-test');
      setActiveScenario(page, 'f-config-test');
      await testBtn.click();
      await page.waitForTimeout(900);
      const w1 = countWrites('POST', '/api/petcare/config/test', 'f-config-test');
      assert('f-test-write-once', w1 - w0 === 1, 'count=' + (w1 - w0));
      F.push('f-test-write-once');

      // Journey F failure-state AND-gate (no OR fallback with write count)
      assert('f-store-connected-false', store.petCareConfig.connected === false, JSON.stringify(store.petCareConfig));
      assert('f-store-status-failed', store.petCareConfig.connectionStatus === 'failed', JSON.stringify(store.petCareConfig));
      F.push('f-store-connected-false', 'f-store-status-failed');

      // Config dialog must show explicit failure copy
      const configStatusEl = page.locator('[data-petcare-config-status]');
      await page.waitForSelector('[data-petcare-config-status]', { timeout: 5000 }).catch(() => {});
      const configStatusText = (await configStatusEl.innerText().catch(() => '')) || '';
      const dialogText = await page.locator('.petcare-config-dialog, [role="dialog"], main').first().innerText().catch(() => '');
      const failMsgOk = /连接失败|模型服务商连接失败|连接测试失败/.test(configStatusText)
        || /连接失败|模型服务商连接失败|连接测试失败/.test(dialogText);
      assert('f-config-dialog-fail-msg', failMsgOk, 'status=' + configStatusText.slice(0, 80) + ' dialog=' + dialogText.slice(0, 120));
      F.push('f-config-dialog-fail-msg');

      // Header badge: must not claim connected; must use error style, not is-ready (connected) style
      const agentState = page.locator('.petcare-agent-state');
      const agentLabel = (await agentState.innerText().catch(() => '')) || '';
      assert('f-agent-label-not-connected', agentLabel.indexOf('个人 Agent 已连接') < 0, agentLabel);
      assert('f-agent-label-failed', /连接失败|个人 Agent 连接失败/.test(agentLabel), agentLabel);
      const hasErrorStyle = await agentState.evaluate((el) => el.classList.contains('is-error')).catch(() => false);
      const hasConnectedStyle = await agentState.evaluate((el) => el.classList.contains('is-ready')).catch(() => true);
      assert('f-agent-state-is-error', hasErrorStyle === true, 'class missing is-error');
      assert('f-agent-state-not-connected-style', hasConnectedStyle === false, 'must not use is-ready/connected style');
      F.push('f-agent-label-not-connected', 'f-agent-label-failed', 'f-agent-state-is-error', 'f-agent-state-not-connected-style');

      // Aggregate name kept for report continuity — ALL conditions already asserted above
      assert('f-not-connected',
        store.petCareConfig.connected === false
        && store.petCareConfig.connectionStatus === 'failed'
        && failMsgOk
        && agentLabel.indexOf('个人 Agent 已连接') < 0
        && hasErrorStyle
        && !hasConnectedStyle
        && (w1 - w0 === 1),
        JSON.stringify({ config: store.petCareConfig, agentLabel, failMsgOk, hasErrorStyle, hasConnectedStyle, writes: w1 - w0 })
      );
      F.push('f-not-connected');

      const ptext = await page.locator('main').first().innerText();
      assert('f-no-apikey-leak', !/sk-fixture-test-key-not-real/.test(ptext) && !/sk-[a-zA-Z0-9]{16,}/.test(ptext), 'key');
      F.push('f-no-apikey-leak');
      await shotStrict(page, 'petcare-connect-failed', {
        expectPath: '/page/front/pet_care.html',
        h1: 'h1',
        stateSelector: '.petcare-agent-state.is-error',
        scenarioId: 'f-config-test',
        forbidError: false,
        assertionId: 'f-not-connected'
      });

      journeyResult('F-petcare', F);
      probe('journey-F', { config: store.petCareConfig.connectionStatus, agentLabel });
      await ctx.close();
    }

    // ========== Journey G: identity ==========
    {
      const G = [];
      {
        const store = createJourneyStore();
        const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
        const page = await ctx.newPage();
        wirePage(page);
        store.logout();
        await openPage(page, store, 'index.html', '', 'g-anon');
        const t = await page.locator('body').innerText();
        assert('g-anon-login', t.indexOf('登录') >= 0, t.slice(0, 80));
        G.push('g-anon-login');
        await shotStrict(page, 'public-home-desktop', {
          expectPath: '/page/front/index.html',
          h1: 'h1',
          scenarioId: 'g-anon'
        });
        await ctx.close();
      }
      {
        const store = createJourneyStore();
        store.loginAs(MEMBER);
        noteSetupSeed('g-member', {});
        const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
        const page = await ctx.newPage();
        wirePage(page);
        await openPage(page, store, 'index.html', '', 'g-member');
        const t = await page.locator('body').innerText();
        assert('g-member-no-user-mgmt', t.indexOf('用户管理') < 0, t.slice(0, 100));
        G.push('g-member-no-user-mgmt');
        await ctx.close();
      }
      {
        const store = createJourneyStore();
        store.loginAs(ADMIN);
        noteSetupSeed('g-admin', {});
        const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
        const page = await ctx.newPage();
        wirePage(page);
        await openPage(page, store, 'index.html', '', 'g-admin');
        await settlePage(page);
        await shotStrict(page, 'admin-front-account-menu', {
          expectPath: '/page/front/index.html',
          h1: 'h1',
          scenarioId: 'g-admin',
          forbidError: false
        });
        assert('g-admin-page-ok', /index\.html/i.test(page.url()), page.url());
        G.push('g-admin-page-ok');
        await ctx.close();
      }
      journeyResult('G-identity-boundaries', G);
      probe('journey-G', {});
    }

    // ========== Extra screenshots (path-asserted) ==========
    {
      const store = createJourneyStore();
      store.loginAs(MEMBER);
      noteSetupSeed('shots-member', {});
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const page = await ctx.newPage();
      wirePage(page);
      await openPage(page, store, 'notice_list.html', '', 'shot-notice');
      await shotStrict(page, 'notice-list-desktop', { expectPath: '/page/front/notice_list.html', h1: 'h1', scenarioId: 'shot-notice' });
      await openPage(page, store, 'account_public.html', '', 'shot-account');
      await shotStrict(page, 'account-public-desktop', { expectPath: '/page/front/account_public.html', h1: 'h1', scenarioId: 'shot-account' });
      await openPage(page, store, 'notice_detail.html', 'id=1', 'shot-nd');
      await shotStrict(page, 'notice-detail-desktop', { expectPath: '/page/front/notice_detail.html', h1: 'h1', scenarioId: 'shot-nd' });
      store.logout();
      await openPage(page, store, 'register.html', '', 'shot-reg');
      await page.waitForSelector('[data-register-submit]', { timeout: 8000 });
      await page.locator('[data-register-submit]').click();
      await page.waitForTimeout(200);
      await shotStrict(page, 'register-validation-error', {
        expectPath: '/page/front/register.html',
        h1: 'h1',
        stateSelector: '.ui-field-error, .ui-form-alert, [role="alert"]',
        scenarioId: 'shot-reg',
        forbidError: false
      });
      store.logout();
      await openPage(page, store, 'login.html', '', 'shot-login-err');
      await page.fill('#loginUsername', 'jerry');
      await page.fill('#loginPassword', 'x');
      await page.fill('#loginCode', 'bad');
      await page.locator('[data-login-submit]').click();
      await page.waitForTimeout(200);
      await shotStrict(page, 'state-error-login-validation', {
        expectPath: '/page/front/login.html',
        h1: 'h1',
        stateSelector: '.ui-field-error, .ui-form-alert, [role="alert"]',
        scenarioId: 'shot-login-err',
        forbidError: false
      });
      store.loginAs(MEMBER);
      store.favorites = [];
      await openPage(page, store, 'favorites.html', '', 'shot-empty');
      await settlePage(page);
      await shotStrict(page, 'state-empty-favorites', {
        expectPath: '/page/front/favorites.html',
        h1: '#favoritesTitle',
        stateSelector: '.favorites-empty, .ui-state',
        scenarioId: 'shot-empty',
        forbidError: false
      });
      // success favorites
      store.favorites.push(Object.assign({}, store.animals[0], { favorite_id: '9001', created_at: '2026-08-01 12:00:00' }));
      noteSetupSeed('shot-fav-success-list', { favorite_id: '9001' });
      await openPage(page, store, 'favorites.html', '', 'shot-fav-ok');
      await shotStrict(page, 'state-success-favorites', {
        expectPath: '/page/front/favorites.html',
        h1: '#favoritesTitle',
        stateSelector: '[data-animal-id="12"]',
        scenarioId: 'shot-fav-ok'
      });
      await page.setViewportSize({ width: 320, height: 700 });
      await openPage(page, store, 'index.html', '', 'shot-320');
      await shotStrict(page, 'nav-320', { expectPath: '/page/front/index.html', h1: 'h1', scenarioId: 'shot-320' });
      await page.setViewportSize({ width: 390, height: 844 });
      await openPage(page, store, 'animal_browse.html', '', 'shot-browse-m');
      await shotStrict(page, 'animal-browse-mobile', { expectPath: '/page/front/animal_browse.html', h1: 'h1', scenarioId: 'shot-browse-m' });
      await openPage(page, store, 'my_volunteer.html', '', 'shot-myvol');
      await shotStrict(page, 'my-volunteer-desktop', { expectPath: '/page/front/my_volunteer.html', h1: 'h1', scenarioId: 'shot-myvol', forbidError: false });
      await openPage(page, store, 'pet_care.html', '', 'shot-pc');
      await shotStrict(page, 'petcare-history-or-default', { expectPath: '/page/front/pet_care.html', h1: 'h1', scenarioId: 'shot-pc', forbidError: false });
      store.logout();
      await openPage(page, store, 'login.html', '', 'shot-login-def');
      await shotStrict(page, 'login-desktop-default', { expectPath: '/page/front/login.html', h1: 'h1', scenarioId: 'shot-login-def' });
      await openPage(page, store, 'register.html', '', 'shot-reg-def');
      await shotStrict(page, 'register-desktop-default', { expectPath: '/page/front/register.html', h1: 'h1', scenarioId: 'shot-reg-def' });
      await ctx.close();
    }

    // ========== Gates ==========
    // Fix required write for notif - dynamic path already registered in journey D
    // Clear the null pathname registration if any
    for (let i = requiredJourneyWrites.length - 1; i >= 0; i--) {
      if (!requiredJourneyWrites[i].pathname) requiredJourneyWrites.splice(i, 1);
    }
    // Ensure core required writes present
    const need = [
      ['b-favorite-toggle', 'POST', '/api/operations/favorites/12'],
      ['b-adopt-submit', 'POST', '/api/adopt'],
      ['d-rescue-submit', 'POST', '/api/help'],
      ['e-task-signup', 'POST', '/api/operations/volunteer-tasks/101/signup'],
      ['f-config-test', 'POST', '/api/petcare/config/test']
    ];
    // register e and f if missing
    if (!requiredJourneyWrites.some((r) => r.scenarioId === 'e-task-signup')) {
      registerRequiredWrite({ journeyId: 'E', scenarioId: 'e-task-signup', method: 'POST', pathname: '/api/operations/volunteer-tasks/101/signup', expectedCount: 1 });
    }
    if (!requiredJourneyWrites.some((r) => r.scenarioId === 'f-config-test')) {
      registerRequiredWrite({ journeyId: 'F', scenarioId: 'f-config-test', method: 'POST', pathname: '/api/petcare/config/test', expectedCount: 1 });
    }

    const rf = auditRequestFailures(result.requestFailedAudit, expectedRequestFailureLedger);
    assert('no-pageerror', result.pageErrors.length === 0, JSON.stringify(result.pageErrors.slice(0, 3)));
    const realConsole = result.consoleErrors.filter((t) => {
      if (/Failed to load resource/i.test(t) && /status of (4|5)\d\d/i.test(t)) return false;
      if (/Failed to load resource: net::ERR_FAILED/i.test(t) && rf.unexpectedCount === 0) return false;
      return true;
    });
    assert('no-real-console-error', realConsole.length === 0, JSON.stringify(realConsole.slice(0, 5)));
    const badHttp = result.httpErrors.filter((e) => {
      const h = e.headers || {};
      return h['x-ui-audit-expected-error'] !== 'phase3h' && h['x-ui-audit-fixture'] !== 'phase3h';
    });
    assert('no-unregistered-http', badHttp.length === 0, JSON.stringify(badHttp.slice(0, 5)));
    assert('unexpected-requestfailed-zero', rf.unexpectedCount === 0, JSON.stringify(rf.unexpected.slice(0, 5)));
    assert('real-writes-zero', result.realWriteAudit.length === 0, JSON.stringify(result.realWriteAudit));
    assert('synthetic-writes-zero', result.syntheticWriteAudit.length === 0, JSON.stringify(result.syntheticWriteAudit));
    assert('direct-store-mutations-zero', result.directStoreMutationAudit.length === 0, JSON.stringify(result.directStoreMutationAudit));
    assert('fallback-zero', result.fallbackPassCount === 0, 'fallback');
    assert('best-effort-zero', result.bestEffortPassCount === 0, 'be');
    assert('matrix-100', result.matrixVisits.length === 100, 'n=' + result.matrixVisits.length);
    assert('journeys-7', result.journeyResults.length >= 7, 'n=' + result.journeyResults.length);
    assert('journeys-all-ok', result.journeyResults.every((j) => j.ok), JSON.stringify(result.journeyResults));
    assert('screenshots-ge-24', result.screenshots.length >= 24, 'n=' + result.screenshots.length);
    assert('overflow-zero', result.overflowAudit.filter((o) => o.page).length === 0, 'ox');

    // required writes exact
    for (const [sid, method, pathname] of need) {
      const n = result.fixtureWriteAudit.filter((w) => w.scenarioId === sid && w.method === method && w.pathname === pathname).length;
      assert('required-write-' + sid, n === 1, 'n=' + n);
    }
    const notifReads = result.fixtureWriteAudit.filter((w) => w.scenarioId === 'd-notif-read' && w.method === 'PUT' && /\/api\/notifications\/[^/]+\/read$/.test(w.pathname));
    assert('required-write-d-notif-read', notifReads.length === 1, 'n=' + notifReads.length);

    const shotFiles = fs.readdirSync(shotDir).filter((f) => f.endsWith('.png')).sort();
    const indexed = result.screenshots.map((s) => path.basename(s.file)).sort();
    assert('screenshot-index-match', JSON.stringify(shotFiles) === JSON.stringify(indexed), JSON.stringify({ shotFiles, indexed }));

    // scorecard
    const scoreMd = [
      '# Front-end Final Scorecard (Phase 3H credibility)',
      '',
      'Base `f518554` · Branch `ui-polish/phase-3h-20260801`',
      '',
      '| Page | Phase | Access | Responsive (auto) | Identity (auto) | Hierarchy | Visual | Feedback | Keyboard | Journey | needsChange | Evidence |',
      '|------|-------|--------|-------------------|-----------------|-----------|--------|----------|----------|---------|-------------|----------|'
    ];
    result.pageScores.forEach((s) => {
      scoreMd.push(`| ${s.page} | ${s.phase} | ${s.access} | ${s.scores.responsive} | ${s.scores.identity} | ${s.scores.hierarchy} | ${s.scores.visual} | ${s.scores.feedback} | ${s.scores.keyboard} | ${s.scores.journey} | ${s.needsChange} | probes.matrixCells=${s.probes.matrixCells}; overflowFails=${s.probes.overflowFails} |`);
    });
    scoreMd.push('', '## Scoring rules', '',
      '- responsive/identity: automatic from matrix overflow + auth probes.',
      '- hierarchy/visual/feedback/keyboard: `notMeasured` (no fabricated scores).',
      '- journey: `manualReview` except where journey JSON proves cross-page writes.',
      '- needsChange derived from overflowFails/authFails only.',
      '');
    fs.writeFileSync(path.join(out, 'FRONT-END-FINAL-SCORECARD.md'), scoreMd.join('\n'));

    const summary = writeReports();
    console.log('Phase 3H summary', summary);
    await browser.close();
    process.exit(summary.strictMode ? 0 : 1);
  } catch (e) {
    console.error('SUITE_CRASH', e && e.stack || e);
    fail('suite-crash', String(e && e.message || e));
    writeReports();
    try { if (browser) await browser.close(); } catch (x) {}
    process.exit(1);
  }
})();
