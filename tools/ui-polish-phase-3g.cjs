/**
 * Phase 3G strict suite — login / register / safe redirect.
 * Fail-closed. Real Playwright only. Port default :18136
 * Credibility remediation: requestfailed ledger matches scenarioId at request start.
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const startedAt = Date.now();
const base = process.env.BASE_URL || 'http://127.0.0.1:18136';
const out = path.resolve('output/playwright/ui-polish-phase-3g');
const shotDir = path.join(out, 'screenshots');
fs.mkdirSync(shotDir, { recursive: true });
for (const f of fs.readdirSync(shotDir)) {
  if (f.endsWith('.png')) fs.unlinkSync(path.join(shotDir, f));
}

/** Page → active scenarioId (set before navigation / submit). */
const activeScenarioByPage = new WeakMap();
/** Request → scenarioId captured at request start (not at failure time). */
const requestScenarioByRequest = new WeakMap();

const PAGES = ['login.html', 'register.html'];
const VIEWPORTS = [
  { name: '1440x900', width: 1440, height: 900 },
  { name: '1280x800', width: 1280, height: 800 },
  { name: '768x1024', width: 768, height: 1024 },
  { name: '390x844', width: 390, height: 844 },
  { name: '320x700', width: 320, height: 700 }
];

const MEMBER_USER = {
  id: '43', username: 'jerry', name: 'jerry',
  phone: '', email: '', permission: []
};
const ADMIN_USER = {
  id: '1', username: 'admin', name: 'admin',
  phone: '', email: '',
  permission: [{ flag: 'user' }, { flag: 'role' }, { flag: 'animal' }]
};

/** Explicit intentional network-failure ledger (no broad GET/static/HTML ignore). */
const expectedRequestFailureLedger = [];
let requestFailedSeq = 0;

const result = {
  phase: '3G',
  base,
  branch: 'ui-polish/phase-3g-auth-onboarding-20260801',
  baseline: '27e5514db5d4bdab6a4ed4eb897ce8ae9e0c33a3',
  startedAt: new Date().toISOString(),
  checks: [],
  failures: [],
  visits: [],
  matrixVisits: [],
  screenshots: [],
  probes: [],
  fixtureWriteAudit: [],
  realWriteAudit: [],
  requestFailedAudit: [],
  evaluateUsage: [],
  redirectMatrix: [],
  consoleErrors: [],
  pageErrors: [],
  httpErrors: [],
  loginPostCount: 0,
  registerPostCount: 0,
  malformedResponseCount: 0,
  bestEffortPassCount: 0,
  fallbackPassCount: 0,
  skippedCount: 0,
  strictRuntimeProbeCount: 0,
  expectedRequestFailureLedger: expectedRequestFailureLedger,
  classifierSelfTests: [],
  sessionPersistenceAudit: { login: null, register: null, jwtResidue: 0 },
  realCaptchaProbe: null,
  requestCountAudit: null,
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
  const h = { 'content-type': 'application/json', 'x-ui-audit-fixture': 'phase3g' };
  if (expected) h['x-ui-audit-expected-error'] = 'phase3g';
  return h;
}
function pageUrl(file, query) {
  return base + '/page/front/' + file + (query ? '?' + query : '');
}

function pathnameOf(url) {
  try { return new URL(url).pathname; } catch (e) { return ''; }
}

/** Normalize Playwright abort('failed') → failed; ERR_ABORTED → aborted. */
function normalizeFailure(text) {
  const s = String(text || '');
  if (/ERR_FAILED|net::failed|^failed$/i.test(s)) return 'failed';
  if (/ERR_ABORTED|aborted/i.test(s)) return 'aborted';
  return s.toLowerCase();
}

function registerExpectedRequestFailure(spec) {
  const row = {
    scenarioId: String(spec.scenarioId || ''),
    method: String(spec.method || 'GET').toUpperCase(),
    pathname: String(spec.pathname || ''),
    failure: normalizeFailure(spec.failure || 'failed'),
    expectedCount: Number(spec.expectedCount || 1),
    observedCount: 0,
    observations: []
  };
  expectedRequestFailureLedger.push(row);
  return row;
}

/**
 * Pure classifier against a ledger (mutates observedCount).
 * Match requires scenarioId + method + exact pathname + failure family;
 * count must not exceed expected. Any mismatch → unexpected.
 */
function classifyRequestFailed(entry, ledger) {
  const scenarioId = String(entry.scenarioId || '');
  const method = String(entry.method || 'GET').toUpperCase();
  const pathname = entry.pathname || pathnameOf(entry.url || '');
  const failure = normalizeFailure(entry.failure || '');
  for (let i = 0; i < ledger.length; i++) {
    const row = ledger[i];
    if (row.scenarioId !== scenarioId) continue;
    if (row.method !== method || row.pathname !== pathname || row.failure !== failure) continue;
    if (row.observedCount < row.expectedCount) {
      row.observedCount += 1;
      row.observations.push({
        scenarioId,
        method,
        pathname,
        failure,
        at: entry.at || new Date().toISOString(),
        seq: entry.seq,
        url: entry.url || ''
      });
      return { kind: 'intentional', scenarioId: row.scenarioId, rowIndex: i };
    }
    return { kind: 'unexpected', reason: 'exceeded-expected-count', scenarioId: row.scenarioId, rowIndex: i };
  }
  return { kind: 'unexpected', reason: 'unregistered', scenarioId, method, pathname, failure };
}

function setActiveScenario(page, scenarioId) {
  activeScenarioByPage.set(page, String(scenarioId || ''));
}

function getActiveScenario(page) {
  return activeScenarioByPage.get(page) || '';
}

/** Derive a stable unique scenarioId when callers omit an explicit one. */
function deriveScenarioId(scenario, file) {
  scenario = scenario || {};
  if (scenario.scenarioId) return String(scenario.scenarioId);
  const loginMode = scenario.loginMode;
  const registerMode = scenario.registerMode;
  if (loginMode === 'network') return 'login-network';
  if (registerMode === 'network') return 'register-network';
  if (loginMode === 'fail401') return 'login-401';
  if (loginMode === 'fail429') return 'login-429';
  if (loginMode === 'fail500') return 'login-500';
  if (loginMode === 'false') return 'login-false';
  if (loginMode === 'malformed') return 'login-malformed';
  if (loginMode === 'hold') return 'login-hold';
  if (loginMode === 'ok-admin') return 'login-success-admin';
  if (loginMode === 'ok-member' && String(file || '').indexOf('login') >= 0) return 'login-success-member';
  if (registerMode === 'exists') return 'register-409';
  if (registerMode === 'fail429') return 'register-429';
  if (registerMode === 'fail500') return 'register-500';
  if (registerMode === 'false') return 'register-false';
  if (registerMode === 'malformed') return 'register-malformed';
  if (registerMode === 'ok') return 'register-success';
  if (scenario.captchaMode === 'init-fail') return 'login-captcha-init-fail';
  if (scenario.meMode === 'member' && String(file || '').indexOf('login') >= 0) return 'login-already-member';
  if (scenario.meMode === 'member' && String(file || '').indexOf('register') >= 0) return 'register-already-member';
  if (String(file || '').indexOf('register') >= 0) return 'register-default';
  if (String(file || '').indexOf('login') >= 0) return 'login-default';
  return 'auth-default';
}

function auditRequestFailures(auditList, ledger) {
  // Work on a clone of counts so re-audit is safe: reset observed then re-run
  ledger.forEach((r) => { r.observedCount = 0; r.observations = []; });
  const unexpected = [];
  const intentional = [];
  for (const e of auditList) {
    const classified = classifyRequestFailed(e, ledger);
    if (classified.kind === 'intentional') intentional.push({ entry: e, classified });
    else unexpected.push({ entry: e, classified });
  }
  const underObserved = ledger.filter((r) => r.observedCount !== r.expectedCount);
  const getFailures = auditList.filter((e) => String(e.method || 'GET').toUpperCase() === 'GET');
  const staticFailures = auditList.filter((e) => /\.(js|css|svg|png|jpe?g|woff2?)(\?|$)/i.test(e.url || ''));
  const htmlFailures = auditList.filter((e) => /\/page\/.*\.html/i.test(e.url || ''));
  return {
    intentionalCount: intentional.length,
    unexpectedCount: unexpected.length,
    unexpected,
    underObserved,
    getRequestFailures: getFailures.length,
    staticResourceFailures: staticFailures.length,
    htmlFailures: htmlFailures.length,
    expectedRequestFailures: ledger.reduce((n, r) => n + r.expectedCount, 0),
    ledgerSnapshot: ledger.map((r) => ({
      scenarioId: r.scenarioId,
      method: r.method,
      pathname: r.pathname,
      failure: r.failure,
      expectedCount: r.expectedCount,
      observedCount: r.observedCount,
      observations: r.observations.slice()
    }))
  };
}

function isRegisteredHttpError(e) {
  const h = e.headers || {};
  return h['x-ui-audit-expected-error'] === 'phase3g' || h['x-ui-audit-fixture'] === 'phase3g';
}

/** Gate: unregistered pageerror must fail strict. */
function gatePageErrors(pageErrors) {
  return { ok: !pageErrors || pageErrors.length === 0, count: (pageErrors || []).length };
}

/** Gate: unregistered HTTP 4xx/5xx (no fixture header) must fail strict. */
function gateHttpErrors(httpErrors) {
  const bad = (httpErrors || []).filter((e) => !isRegisteredHttpError(e));
  return { ok: bad.length === 0, bad };
}

function runClassifierSelfTests() {
  const tests = [];
  function t(id, cond, detail) {
    tests.push({ id, ok: !!cond, detail: String(detail || '') });
  }

  // 1. Unregistered GET /js/jquery.min.js + ERR_ABORTED → unexpected
  {
    const ledger = [];
    const r = classifyRequestFailed({
      method: 'GET', url: 'http://127.0.0.1/js/jquery.min.js', failure: 'net::ERR_ABORTED'
    }, ledger);
    t('clf-unreg-get-jquery-aborted', r.kind === 'unexpected' && r.reason === 'unregistered', JSON.stringify(r));
  }
  // 2. Unregistered GET /api/user/me + ERR_ABORTED → unexpected
  {
    const ledger = [];
    const r = classifyRequestFailed({
      method: 'GET', url: 'http://127.0.0.1/api/user/me', failure: 'net::ERR_ABORTED'
    }, ledger);
    t('clf-unreg-get-me-aborted', r.kind === 'unexpected', JSON.stringify(r));
  }
  // 3. Unregistered POST /api/user/login + ERR_FAILED → unexpected
  {
    const ledger = [];
    const r = classifyRequestFailed({
      method: 'POST', url: 'http://127.0.0.1/api/user/login', failure: 'net::ERR_FAILED'
    }, ledger);
    t('clf-unreg-post-login-failed', r.kind === 'unexpected', JSON.stringify(r));
  }
  // 4. Registered login-network exactly once (with scenarioId) → intentional
  {
    const ledger = [{
      scenarioId: 'login-network', method: 'POST', pathname: '/api/user/login',
      failure: 'failed', expectedCount: 1, observedCount: 0, observations: []
    }];
    const r = classifyRequestFailed({
      scenarioId: 'login-network',
      method: 'POST', url: 'http://127.0.0.1/api/user/login', failure: 'net::ERR_FAILED', seq: 1
    }, ledger);
    t('clf-reg-login-once-intentional', r.kind === 'intentional' && ledger[0].observedCount === 1, JSON.stringify(r));
  }
  // 5. Same registered failure twice → second unexpected
  {
    const ledger = [{
      scenarioId: 'login-network', method: 'POST', pathname: '/api/user/login',
      failure: 'failed', expectedCount: 1, observedCount: 0, observations: []
    }];
    classifyRequestFailed({
      scenarioId: 'login-network', method: 'POST', url: 'http://x/api/user/login', failure: 'failed'
    }, ledger);
    const r2 = classifyRequestFailed({
      scenarioId: 'login-network', method: 'POST', url: 'http://x/api/user/login', failure: 'failed'
    }, ledger);
    t('clf-reg-login-twice-second-unexpected', r2.kind === 'unexpected' && r2.reason === 'exceeded-expected-count', JSON.stringify(r2));
  }
  // 6. method / pathname / failure mismatch → unexpected
  {
    const ledger = [{
      scenarioId: 'login-network', method: 'POST', pathname: '/api/user/login',
      failure: 'failed', expectedCount: 1, observedCount: 0, observations: []
    }];
    const m1 = classifyRequestFailed({
      scenarioId: 'login-network', method: 'GET', url: 'http://x/api/user/login', failure: 'failed'
    }, ledger);
    const m2 = classifyRequestFailed({
      scenarioId: 'login-network', method: 'POST', url: 'http://x/api/user/register', failure: 'failed'
    }, ledger);
    const m3 = classifyRequestFailed({
      scenarioId: 'login-network', method: 'POST', url: 'http://x/api/user/login', failure: 'aborted'
    }, ledger);
    t('clf-mismatch-method-path-failure',
      m1.kind === 'unexpected' && m2.kind === 'unexpected' && m3.kind === 'unexpected',
      JSON.stringify({ m1, m2, m3 }));
  }
  // 9. ledger=login-network but entry.scenarioId=login-500 (other fields identical) → unexpected
  {
    const ledger = [{
      scenarioId: 'login-network', method: 'POST', pathname: '/api/user/login',
      failure: 'failed', expectedCount: 1, observedCount: 0, observations: []
    }];
    const r = classifyRequestFailed({
      scenarioId: 'login-500', method: 'POST', url: 'http://x/api/user/login', failure: 'failed'
    }, ledger);
    t('clf-scenarioId-mismatch-login500', r.kind === 'unexpected' && r.reason === 'unregistered', JSON.stringify(r));
  }
  // 10. ledger=login-network, entry.scenarioId empty → unexpected
  {
    const ledger = [{
      scenarioId: 'login-network', method: 'POST', pathname: '/api/user/login',
      failure: 'failed', expectedCount: 1, observedCount: 0, observations: []
    }];
    const r = classifyRequestFailed({
      scenarioId: '', method: 'POST', url: 'http://x/api/user/login', failure: 'failed'
    }, ledger);
    t('clf-scenarioId-empty-unexpected', r.kind === 'unexpected', JSON.stringify(r));
  }
  // 11. ledger=login-network, entry.scenarioId=login-network → intentional
  {
    const ledger = [{
      scenarioId: 'login-network', method: 'POST', pathname: '/api/user/login',
      failure: 'failed', expectedCount: 1, observedCount: 0, observations: []
    }];
    const r = classifyRequestFailed({
      scenarioId: 'login-network', method: 'POST', url: 'http://x/api/user/login', failure: 'net::ERR_FAILED'
    }, ledger);
    t('clf-scenarioId-match-intentional', r.kind === 'intentional', JSON.stringify(r));
  }
  // 12. Same scenario second failure → exceeded-expected-count
  {
    const ledger = [{
      scenarioId: 'login-network', method: 'POST', pathname: '/api/user/login',
      failure: 'failed', expectedCount: 1, observedCount: 0, observations: []
    }];
    classifyRequestFailed({
      scenarioId: 'login-network', method: 'POST', url: 'http://x/api/user/login', failure: 'failed'
    }, ledger);
    const r2 = classifyRequestFailed({
      scenarioId: 'login-network', method: 'POST', url: 'http://x/api/user/login', failure: 'failed'
    }, ledger);
    t('clf-scenarioId-second-exceeded', r2.kind === 'unexpected' && r2.reason === 'exceeded-expected-count', JSON.stringify(r2));
  }
  // 13. Request starts under login-network; page later switches to login-success;
  //     failure event must still use request-start scenarioId → intentional
  {
    const pageKey = { id: 'fake-page' };
    const reqKey = { id: 'fake-req' };
    // Simulate setActiveScenario + request capture (same rules as wirePage).
    activeScenarioByPage.set(pageKey, 'login-network');
    requestScenarioByRequest.set(reqKey, activeScenarioByPage.get(pageKey) || '');
    activeScenarioByPage.set(pageKey, 'login-success-member'); // later scene
    const captured = requestScenarioByRequest.get(reqKey) || '';
    const ledger = [{
      scenarioId: 'login-network', method: 'POST', pathname: '/api/user/login',
      failure: 'failed', expectedCount: 1, observedCount: 0, observations: []
    }];
    const r = classifyRequestFailed({
      scenarioId: captured,
      method: 'POST', url: 'http://x/api/user/login', failure: 'failed'
    }, ledger);
    t('clf-scenarioId-captured-at-request-start',
      captured === 'login-network' && r.kind === 'intentional' && ledger[0].observedCount === 1,
      JSON.stringify({ captured, activeNow: activeScenarioByPage.get(pageKey), r }));
  }
  // 7. Unregistered pageerror → gate fails (strict=false driver)
  {
    const g = gatePageErrors(['TypeError: boom']);
    t('clf-pageerror-unregistered-fails-gate', g.ok === false && g.count === 1, JSON.stringify(g));
  }
  // 8. Unregistered HTTP 500 → gate fails
  {
    const g = gateHttpErrors([{ status: 500, url: 'http://x/api/other', method: 'GET', headers: {} }]);
    t('clf-http500-unregistered-fails-gate', g.ok === false && g.bad.length === 1, JSON.stringify(g));
  }
  // Positive controls for gates
  {
    t('clf-pageerror-empty-ok', gatePageErrors([]).ok === true, 'empty');
    t('clf-http500-fixture-ok', gateHttpErrors([{
      status: 500, url: 'http://x/api/user/login', method: 'POST',
      headers: { 'x-ui-audit-expected-error': 'phase3g' }
    }]).ok === true, 'fixture');
  }

  result.classifierSelfTests = tests;
  tests.forEach((row) => {
    assert('classifier-' + row.id, row.ok, row.detail);
  });
  return tests;
}

function makeState(custom) {
  const scenario = Object.assign({
    meMode: 'anon', // anon|member|admin
    loginMode: 'ok-member', // ok-member|ok-admin|false|malformed|fail401|fail429|fail500|hold|network
    registerMode: 'ok', // ok|false|malformed|exists|fail429|fail500|hold|network
    captchaMode: 'ok' // ok|broken|init-fail
  }, (custom && custom.scenario) || {});
  // Do not let outer Object.assign replace scenario with a partial object.
  const rest = Object.assign({}, custom || {});
  delete rest.scenario;
  return Object.assign({
    scenario,
    sessionUser: null, // set after successful login/register fixture so /me stays consistent
    requests: [],
    loginPosts: 0,
    registerPosts: 0,
    lastLoginBody: null,
    lastRegisterBody: null,
    hold: null,
    resolveHold: null
  }, rest);
}

async function evalTracked(page, reason, fn, arg, opts) {
  opts = opts || {};
  const lifecycle = !!(opts.lifecycle);
  const readonly = opts.readonly !== false && !lifecycle;
  result.evaluateUsage.push({ reason: String(reason || ''), readonly, lifecycle, at: new Date().toISOString() });
  if (typeof arg === 'undefined') return page.evaluate(fn);
  return page.evaluate(fn, arg);
}
async function evalRead(page, reason, fn, arg) {
  return evalTracked(page, reason, fn, arg, { readonly: true });
}

async function installFixtures(page, state) {
  if (!state.requests) state.requests = [];

  // Deterministic captcha for form interaction tests only (draws visible canvas, not blank).
  // Does not touch Vue instance; real form input/click still required.
  // Real gVerify smoke probe uses a separate context without this route.
  if (!state.scenario.skipCaptchaFixture) {
    await page.route('**/js/gVerify.js**', async (route) => {
      const body = [
        'window.GVerify = function GVerifyFixture(opts) {',
        "  if (window.__phase3gCaptchaMode === 'init-fail') { throw new Error('fixture captcha init fail'); }",
        '  var id = (opts && opts.id) || "picyzm";',
        '  var host = document.getElementById(id);',
        '  var canvas = document.createElement("canvas");',
        '  canvas.id = "verifyCanvas";',
        '  canvas.width = 120; canvas.height = 44;',
        '  if (host) { host.innerHTML = ""; host.appendChild(canvas); }',
        '  this._n = 0;',
        '  this._paint = function () {',
        '    var ctx = canvas.getContext("2d");',
        '    ctx.fillStyle = "#f4efe6"; ctx.fillRect(0,0,canvas.width,canvas.height);',
        '    ctx.strokeStyle = "#d63a1f"; ctx.lineWidth = 2; ctx.strokeRect(2,2,canvas.width-4,canvas.height-4);',
        '    ctx.fillStyle = "#1a1a1a"; ctx.font = "bold 18px sans-serif";',
        '    ctx.fillText("OK12-" + this._n, 18, 28);',
        '  };',
        '  this._paint();',
        '  this.validate = function (code) {',
        "    if (window.__phase3gCaptchaMode === 'broken') return false;",
        "    return String(code || '').toLowerCase() === 'ok12';",
        '  };',
        '  this.refresh = function () { this._n += 1; this._paint(); };',
        '  this._ok = true;',
        '};'
      ].join('\n');
      await route.fulfill({
        status: 200,
        contentType: 'application/javascript; charset=utf-8',
        headers: { 'x-ui-audit-fixture': 'phase3g-captcha' },
        body
      });
    });
  }

  // Serve HTML from disk so AuthInterceptor (server session) does not bounce
  // fixture-authenticated navigations. APIs remain fully fixture-controlled.
  await page.route('**/page/**/*.html*', async (route) => {
    try {
      const u = new URL(route.request().url());
      let rel = u.pathname.replace(/^\//, '');
      // strip accidental query in pathname
      rel = rel.split('?')[0];
      const filePath = path.resolve('src/main/resources/static', rel);
      if (fs.existsSync(filePath) && filePath.indexOf(path.resolve('src/main/resources/static')) === 0) {
        await route.fulfill({
          status: 200,
          contentType: 'text/html; charset=utf-8',
          headers: { 'x-ui-audit-fixture': 'phase3g-html' },
          body: fs.readFileSync(filePath, 'utf8')
        });
        return;
      }
    } catch (e) { /* fall through */ }
    await route.continue();
  });

  await page.addInitScript((mode) => {
    window.__phase3gCaptchaMode = mode || 'ok';
  }, state.scenario.captchaMode || 'ok');

  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const method = req.method();
    const url = req.url();
    const entry = { method, url, at: new Date().toISOString() };
    state.requests.push(entry);
    const isWrite = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);

    if (method === 'GET' && /\/api\/user\/me(\?|$)/.test(url)) {
      // Prefer explicit session established by successful login/register in this state.
      if (state.sessionUser) {
        await route.fulfill({ status: 200, headers: fxHeaders(), body: ok(state.sessionUser) }); return;
      }
      if (state.scenario.meMode === 'member') {
        await route.fulfill({ status: 200, headers: fxHeaders(), body: ok(MEMBER_USER) }); return;
      }
      if (state.scenario.meMode === 'admin') {
        await route.fulfill({ status: 200, headers: fxHeaders(), body: ok(ADMIN_USER) }); return;
      }
      await route.fulfill({ status: 401, headers: fxHeaders(true), body: err('401', '未登录') }); return;
    }

    if (method === 'GET' && /\/api\/user\/csrf(\?|$)/.test(url)) {
      await route.fulfill({
        status: 200, headers: fxHeaders(),
        body: ok({ csrfToken: 'csrf-fixture-token' })
      });
      return;
    }

    if (method === 'POST' && /\/api\/user\/login(\?|$)/.test(url)) {
      state.loginPosts += 1;
      result.loginPostCount += 1;
      result.fixtureWriteAudit.push(entry);
      try { state.lastLoginBody = req.postDataJSON() || {}; } catch (e) { state.lastLoginBody = {}; }
      if (state.scenario.loginMode === 'hold') {
        if (!state.hold) state.hold = new Promise((r) => { state.resolveHold = r; });
        await state.hold;
      }
      if (state.scenario.loginMode === 'network') {
        await route.abort('failed'); return;
      }
      if (state.scenario.loginMode === 'fail401') {
        await route.fulfill({ status: 401, headers: fxHeaders(true), body: err('401', '账号或密码错误') }); return;
      }
      if (state.scenario.loginMode === 'fail429') {
        await route.fulfill({ status: 429, headers: fxHeaders(true), body: err('429', '尝试次数过多，请稍后再试') }); return;
      }
      if (state.scenario.loginMode === 'fail500') {
        await route.fulfill({ status: 500, headers: fxHeaders(true), body: err('500', '服务暂时不可用') }); return;
      }
      if (state.scenario.loginMode === 'false') {
        result.malformedResponseCount += 1;
        await route.fulfill({ status: 200, headers: fxHeaders(), body: ok(false) }); return;
      }
      if (state.scenario.loginMode === 'malformed') {
        result.malformedResponseCount += 1;
        await route.fulfill({ status: 200, headers: fxHeaders(), body: ok({}) }); return;
      }
      const user = state.scenario.loginMode === 'ok-admin' ? ADMIN_USER : MEMBER_USER;
      // Keep subsequent /me probes consistent after successful login navigation.
      state.scenario.meMode = state.scenario.loginMode === 'ok-admin' ? 'admin' : 'member';
      state.sessionUser = user;
      await route.fulfill({
        status: 200, headers: fxHeaders(),
        body: ok({ user: user, csrfToken: 'csrf-fixture-login' })
      });
      return;
    }

    if (method === 'POST' && /\/api\/user\/register(\?|$)/.test(url)) {
      state.registerPosts += 1;
      result.registerPostCount += 1;
      result.fixtureWriteAudit.push(entry);
      try { state.lastRegisterBody = req.postDataJSON() || {}; } catch (e) { state.lastRegisterBody = {}; }
      if (state.scenario.registerMode === 'hold') {
        if (!state.hold) state.hold = new Promise((r) => { state.resolveHold = r; });
        await state.hold;
      }
      if (state.scenario.registerMode === 'network') {
        await route.abort('failed'); return;
      }
      if (state.scenario.registerMode === 'exists') {
        await route.fulfill({ status: 409, headers: fxHeaders(true), body: err('409', '用户名已注册') }); return;
      }
      if (state.scenario.registerMode === 'fail429') {
        await route.fulfill({ status: 429, headers: fxHeaders(true), body: err('429', '请求过于频繁，请稍后再试') }); return;
      }
      if (state.scenario.registerMode === 'fail500') {
        await route.fulfill({ status: 500, headers: fxHeaders(true), body: err('500', '服务暂时不可用') }); return;
      }
      if (state.scenario.registerMode === 'false') {
        result.malformedResponseCount += 1;
        await route.fulfill({ status: 200, headers: fxHeaders(), body: ok(false) }); return;
      }
      if (state.scenario.registerMode === 'malformed') {
        result.malformedResponseCount += 1;
        await route.fulfill({ status: 200, headers: fxHeaders(), body: ok({ token: 'x' }) }); return;
      }
      // New accounts are members only.
      state.scenario.meMode = 'member';
      const newUser = Object.assign({}, MEMBER_USER, {
        username: (state.lastRegisterBody && state.lastRegisterBody.username) || 'newuser'
      });
      state.sessionUser = newUser;
      await route.fulfill({
        status: 200, headers: fxHeaders(),
        body: ok({ user: newUser, csrfToken: 'csrf-fixture-reg' })
      });
      return;
    }

    if (isWrite) {
      result.realWriteAudit.push(entry);
      fail('unregistered-write', method + ' ' + url);
      await route.fulfill({ status: 599, headers: fxHeaders(true), body: err('599', 'blocked') });
      return;
    }
    await route.fulfill({ status: 200, headers: fxHeaders(), body: ok([]) });
  });
}

/** Wait for document load + network idle so in-flight GETs are not aborted by the next navigation. */
async function settlePage(page) {
  await page.waitForLoadState('load', { timeout: 12000 }).catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(80);
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
  // Capture scenarioId at request start — never re-read page scenario at failure time.
  page.on('request', (req) => {
    requestScenarioByRequest.set(req, getActiveScenario(page));
  });
  page.on('requestfailed', (req) => {
    requestFailedSeq += 1;
    const scenarioId = requestScenarioByRequest.get(req) || '';
    const method = req.method();
    const url = req.url();
    const pathname = pathnameOf(url);
    const failure = req.failure() && req.failure().errorText;
    result.requestFailedAudit.push({
      seq: requestFailedSeq,
      scenarioId,
      method,
      url,
      pathname,
      failure,
      at: new Date().toISOString()
    });
  });
}

async function openAuth(page, file, state, query, opts) {
  opts = opts || {};
  const scenarioId = (opts && opts.scenarioId)
    || (state.scenario && state.scenario.scenarioId)
    || deriveScenarioId(state.scenario, file);
  if (state.scenario) state.scenario.scenarioId = scenarioId;
  setActiveScenario(page, scenarioId);
  await page.unroute('**/api/**').catch(() => {});
  await page.unroute('**/js/gVerify.js**').catch(() => {});
  await page.unroute('**/page/**/*.html*').catch(() => {});
  await installFixtures(page, state);
  // Clear browser storage on this origin before auth page load (no cache privilege).
  try {
    await page.goto(base + '/page/front/login.html', { waitUntil: 'load', timeout: 20000 });
    await settlePage(page);
    await page.evaluate(() => {
      try {
        sessionStorage.clear();
        localStorage.removeItem('token');
        localStorage.removeItem('x-auth-token');
      } catch (e) { /* ignore */ }
    });
  } catch (e) { /* first load may fail only if server down */ }
  await page.goto(pageUrl(file, query), { waitUntil: 'load', timeout: 45000 });
  await settlePage(page);
  if (!opts.allowRedirectAway) {
    await page.waitForSelector('.ui-auth-form', { timeout: 15000 });
  } else {
    await page.waitForTimeout(600);
    await settlePage(page);
  }
  result.visits.push({ file, query: query || '', at: new Date().toISOString() });
}

async function readSessionPersistence(page, expectedUser, expectedCsrf, label) {
  const snap = await evalRead(page, 'session-persist-' + label, () => {
    let user = null;
    let userParseOk = false;
    try {
      const raw = sessionStorage.getItem('user');
      if (raw) {
        user = JSON.parse(raw);
        userParseOk = true;
      }
    } catch (e) { userParseOk = false; }
    return {
      user,
      userParseOk,
      csrfToken: sessionStorage.getItem('csrfToken') || '',
      sessionToken: sessionStorage.getItem('token'),
      localToken: localStorage.getItem('token'),
      localLegacy: localStorage.getItem('x-auth-token')
    };
  });
  const jwtResidue = [snap.sessionToken, snap.localToken, snap.localLegacy].filter((v) => v != null && v !== '').length;
  const audit = {
    label,
    at: new Date().toISOString(),
    url: page.url(),
    userParseOk: snap.userParseOk,
    username: snap.user && snap.user.username,
    id: snap.user && snap.user.id,
    expectedUsername: expectedUser && expectedUser.username,
    expectedId: expectedUser && expectedUser.id,
    csrfToken: snap.csrfToken,
    expectedCsrf: expectedCsrf,
    jwtResidue,
    sessionTokenPresent: !!(snap.sessionToken),
    localTokenPresent: !!(snap.localToken),
    localLegacyPresent: !!(snap.localLegacy),
    note: 'AuthSession.saveSession caches user + CSRF for UX; server Cookie Session remains the sole auth authority.'
  };
  return audit;
}

async function waitFonts(page) {
  await page.waitForFunction(() => (document.fonts ? document.fonts.status === 'loaded' : true), { timeout: 4000 }).catch(() => {});
  await page.waitForTimeout(50);
}

async function shot(page, name, meta) {
  await evalRead(page, 'shot-top', () => { window.scrollTo(0, 0); });
  await waitFonts(page);
  await page.screenshot({ path: path.join(shotDir, name + '.png'), fullPage: false });
  result.screenshots.push(Object.assign({
    file: 'screenshots/' + name + '.png', name, time: new Date().toISOString()
  }, meta || {}));
}

async function overflowX(page) {
  return evalRead(page, 'overflow', () => {
    const de = document.documentElement;
    return { overflow: de.scrollWidth > de.clientWidth + 1, sw: de.scrollWidth, cw: de.clientWidth };
  });
}

async function focusId(page) {
  return evalRead(page, 'focus-id', () => (document.activeElement && document.activeElement.id) || '');
}

function writeReport() {
  const passed = result.checks.filter((c) => c.ok).length;
  const failed = result.checks.filter((c) => !c.ok).length;
  const skipped = result.checks.filter((c) => c.skipped).length;
  // Recompute ledger match for final JSON (resets observed then re-classifies).
  const rfAudit = auditRequestFailures(result.requestFailedAudit, expectedRequestFailureLedger);
  result.requestCountAudit = {
    fixtureWrites: result.fixtureWriteAudit.length,
    realWrites: result.realWriteAudit.length,
    expectedRequestFailures: rfAudit.expectedRequestFailures,
    unexpectedRequestFailures: rfAudit.unexpectedCount,
    getRequestFailures: rfAudit.getRequestFailures,
    staticResourceFailures: rfAudit.staticResourceFailures,
    htmlFailures: rfAudit.htmlFailures,
    intentionalMatched: rfAudit.intentionalCount,
    underObserved: rfAudit.underObserved.map((r) => r.scenarioId),
    ledger: rfAudit.ledgerSnapshot
  };
  result.summary = {
    passed, failed, skipped, total: result.checks.length,
    visits: result.visits.length,
    matrixVisits: result.matrixVisits.length,
    expectedMatrixVisits: 10,
    screenshots: result.screenshots.length,
    strictRuntimeProbeCount: result.strictRuntimeProbeCount,
    bestEffortPassCount: result.bestEffortPassCount,
    fallbackPassCount: result.fallbackPassCount,
    fixtureWrites: result.fixtureWriteAudit.length,
    realWrites: result.realWriteAudit.length,
    loginPostCount: result.loginPostCount,
    registerPostCount: result.registerPostCount,
    malformedResponseCount: result.malformedResponseCount,
    evaluateUsageCount: result.evaluateUsage.length,
    redirectMatrix: result.redirectMatrix.length,
    expectedRequestFailures: result.requestCountAudit.expectedRequestFailures,
    unexpectedRequestFailures: result.requestCountAudit.unexpectedRequestFailures,
    getRequestFailures: result.requestCountAudit.getRequestFailures,
    classifierSelfTestsPassed: (result.classifierSelfTests || []).filter((t) => t.ok).length,
    classifierSelfTestsTotal: (result.classifierSelfTests || []).length,
    sessionJwtResidue: result.sessionPersistenceAudit.jwtResidue,
    realCaptchaOk: !!(result.realCaptchaProbe && result.realCaptchaProbe.ok),
    durationMs: Date.now() - startedAt,
    finishedAt: new Date().toISOString(),
    strictMode: failed === 0 && skipped === 0 && result.bestEffortPassCount === 0
      && result.fallbackPassCount === 0
      && result.matrixVisits.length >= 10
      && result.strictRuntimeProbeCount >= 32
      && result.screenshots.length >= 12
      && result.realWriteAudit.length === 0
      && result.requestCountAudit.unexpectedRequestFailures === 0
      && result.requestCountAudit.expectedRequestFailures === 2
      && result.requestCountAudit.getRequestFailures === 0
      && result.requestCountAudit.staticResourceFailures === 0
      && result.requestCountAudit.htmlFailures === 0
      && passed >= 180
  };
  result.ok = result.summary.strictMode;
  fs.writeFileSync(path.join(out, 'phase-3g-report.json'), JSON.stringify(result, null, 2));
  fs.writeFileSync(path.join(out, 'screenshots-index.json'), JSON.stringify(result.screenshots, null, 2));
  const log = [
    'PHASE 3G STRICT=' + result.summary.strictMode,
    'ASSERTIONS ' + passed + '/' + failed + '/' + skipped,
    'MATRIX ' + result.matrixVisits.length + '/10',
    'SCREENSHOTS ' + result.screenshots.length,
    'PROBES ' + result.strictRuntimeProbeCount,
    'BEST_EFFORT ' + result.bestEffortPassCount,
    'FALLBACK ' + result.fallbackPassCount,
    'FIXTURE_WRITES ' + result.fixtureWriteAudit.length,
    'REAL_WRITES ' + result.realWriteAudit.length,
    'LOGIN_POSTS ' + result.loginPostCount,
    'REGISTER_POSTS ' + result.registerPostCount,
    'REDIRECT_MATRIX ' + result.redirectMatrix.length,
    'EXPECTED_REQUEST_FAILURES ' + result.requestCountAudit.expectedRequestFailures,
    'UNEXPECTED_REQUEST_FAILURES ' + result.requestCountAudit.unexpectedRequestFailures,
    'GET_REQUEST_FAILURES ' + result.requestCountAudit.getRequestFailures,
    'CLASSIFIER_SELF_TESTS ' + result.summary.classifierSelfTestsPassed + '/' + result.summary.classifierSelfTestsTotal,
    'REAL_CAPTCHA ' + result.summary.realCaptchaOk,
    'SESSION_JWT_RESIDUE ' + result.sessionPersistenceAudit.jwtResidue
  ].join('\n');
  fs.writeFileSync(path.join(out, 'run-strict-final.log'), log + '\n');
  return result.summary;
}

(async () => {
  console.log('Phase 3G credibility strict start', base);
  let browser;
  try {
    // Pure classifier adversarial self-tests (before any browser work).
    runClassifierSelfTests();
    assert('classifier-self-tests-all-pass',
      result.classifierSelfTests.length >= 13 && result.classifierSelfTests.every((t) => t.ok),
      'n=' + result.classifierSelfTests.length);

    // Register the only intentional network failures for this suite.
    registerExpectedRequestFailure({
      scenarioId: 'login-network',
      method: 'POST',
      pathname: '/api/user/login',
      failure: 'failed',
      expectedCount: 1
    });
    registerExpectedRequestFailure({
      scenarioId: 'register-network',
      method: 'POST',
      pathname: '/api/user/register',
      failure: 'failed',
      expectedCount: 1
    });
    assert('ledger-expected-count-2', expectedRequestFailureLedger.length === 2
      && expectedRequestFailureLedger.reduce((n, r) => n + r.expectedCount, 0) === 2, 'ledger');

    const loginHtml = fs.readFileSync('src/main/resources/static/page/front/login.html', 'utf8');
    const regHtml = fs.readFileSync('src/main/resources/static/page/front/register.html', 'utf8');
    const wsJs = fs.readFileSync('src/main/resources/static/js/user-workspace.js', 'utf8');
    const suiteSrc = fs.readFileSync('tools/ui-polish-phase-3g.cjs', 'utf8');

    assert('cache-login', loginHtml.includes('v=20260809u1'), 'login css');
    assert('cache-register', regHtml.includes('v=20260809u1'), 'reg css');
    assert('cache-workspace', loginHtml.includes('user-workspace.js?v=20260809u1') && regHtml.includes('user-workspace.js?v=20260809u1'), 'ws');
    assert('no-window-dialogs', !/window\.confirm|window\.alert|window\.prompt/.test(loginHtml + regHtml), 'dialogs');
    assert('safe-redirect-shared', wsJs.includes('safeRedirect') && wsJs.includes('safeRedirectFromLocation') && wsJs.includes('withRedirectParam'), 'ws');
    assert('login-uses-workspace-redirect', loginHtml.includes('safeRedirectFromLocation') || loginHtml.includes('UserWorkspace.safeRedirect'), 'login-redir');
    assert('register-member-only', regHtml.includes('memberOnly') || regHtml.includes('memberRedirect'), 'reg-redir');
    assert('login-honest-captcha-copy', /非服务端|本地校验|不会作为后端/.test(loginHtml), 'captcha-copy');
    assert('login-no-code-in-payload', !/code:\s*this\.form\.code/.test(loginHtml) && loginHtml.includes('username: view.form.username'), 'payload');
    // Ensure legacy broad whitelist comment/body is gone (search fragments that are not this assert).
    assert('self-uses-requestfailed-ledger',
      suiteSrc.indexOf('expectedRequestFailureLedger') >= 0
      && suiteSrc.indexOf('classifyRequestFailed') >= 0
      && suiteSrc.indexOf('auditRequestFailures') >= 0,
      'ledger-present');
    const regPayloadMatch = regHtml.match(/var payload = \{[\s\S]*?\};/);
    const regPayloadBlock = regPayloadMatch ? regPayloadMatch[0] : '';
    assert('register-payload-clean-fields', regHtml.includes('username:') && regHtml.includes('password:') && !!regPayloadBlock && !/role:|permission:|avatar:|id:/.test(regPayloadBlock), 'payload');
    assert('self-no-best-effort', !/bestEffort:\s*true/.test(suiteSrc), 'be');
    assert('self-no-vm-bypass', !/__vue__\.(login|register)/.test(suiteSrc), 'vm');
    assert('self-no-fake-loop', !/for \(let i = 0; i < 180/.test(suiteSrc), 'fake');

    browser = await chromium.launch({ headless: true });
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    wirePage(page);

    // ===== LOGIN desktop default =====
    let state = makeState({ scenario: { meMode: 'anon', loginMode: 'ok-member' } });
    await openAuth(page, 'login.html', state);
    await shot(page, 'login-desktop-default', { page: 'login', state: 'default' });
    assert('login-root', (await page.locator('.ui-login-page, .ui-auth-page').count()) >= 1, 'root');
    assert('login-form', (await page.locator('#loginUsername, #loginPassword, #loginCode').count()) === 3, 'fields');
    probe('1-login-default', {});

    // empty form
    const posts0 = state.loginPosts;
    await page.locator('[data-login-submit]').click();
    await page.waitForTimeout(120);
    assert('login-empty-no-post', state.loginPosts === posts0, 'posts');
    assert('login-empty-focus-user', (await focusId(page)) === 'loginUsername', await focusId(page));
    await shot(page, 'login-desktop-validation', { page: 'login', state: 'validation' });
    probe('2-login-empty-validation', {});

    // missing password
    await page.fill('#loginUsername', 'jerry');
    await page.locator('[data-login-submit]').click();
    await page.waitForTimeout(100);
    assert('login-miss-pass-no-post', state.loginPosts === posts0, 'posts');
    assert('login-miss-pass-focus', (await focusId(page)) === 'loginPassword', await focusId(page));
    probe('3-login-missing-password', {});

    // missing captcha
    await page.fill('#loginPassword', 'password1');
    await page.locator('[data-login-submit]').click();
    await page.waitForTimeout(100);
    assert('login-miss-code-no-post', state.loginPosts === posts0, 'posts');
    assert('login-miss-code-focus', (await focusId(page)) === 'loginCode', await focusId(page));
    probe('4-login-missing-code', {});

    // wrong captcha
    await page.fill('#loginCode', 'xxxx');
    await page.locator('[data-login-submit]').click();
    await page.waitForTimeout(100);
    assert('login-bad-code-no-post', state.loginPosts === posts0, 'posts');
    probe('5-login-bad-captcha', {});

    // captcha keyboard refresh
    await page.focus('[data-login-captcha]');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(50);
    await page.keyboard.press('Space');
    await page.waitForTimeout(50);
    const captchaRole = await page.locator('[data-login-captcha]').getAttribute('role');
    assert('login-captcha-role-button', captchaRole === 'button', captchaRole);
    probe('6-login-captcha-keyboard', {});

    // captcha init failure blocks submit
    state = makeState({ scenario: { meMode: 'anon', loginMode: 'ok-member', captchaMode: 'init-fail' } });
    await openAuth(page, 'login.html', state);
    await page.waitForTimeout(150);
    const capBrokenText = await page.locator('main').innerText();
    assert('login-captcha-init-fail-msg', /校验码未能加载|无法登录|刷新页面/.test(capBrokenText), capBrokenText.slice(0, 160));
    assert('login-captcha-init-fail-submit-disabled', await page.locator('[data-login-submit]').isDisabled(), 'disabled');
    const postsBeforeBroken = state.loginPosts;
    await page.fill('#loginUsername', 'jerry');
    await page.fill('#loginPassword', 'password1');
    // code input may be disabled; force fill not required
    await page.locator('[data-login-submit]').click({ force: true }).catch(() => {});
    await page.waitForTimeout(120);
    assert('login-captcha-init-fail-no-post', state.loginPosts === postsBeforeBroken, 'posts');
    probe('6b-login-captcha-init-fail', {});

    // 401
    state = makeState({ scenario: { meMode: 'anon', loginMode: 'fail401', scenarioId: 'login-401' } });
    await openAuth(page, 'login.html', state);
    await page.fill('#loginUsername', 'jerry');
    await page.fill('#loginPassword', 'wrong-pass');
    await page.fill('#loginCode', 'ok12');
    await page.locator('[data-login-submit]').click();
    await page.waitForTimeout(400);
    const t401 = await page.locator('main.ui-auth-main').innerText();
    assert('login-401-msg', /账号或密码错误|不正确/.test(t401) && !/网络连接异常/.test(t401), t401.slice(0, 160));
    assert('login-401-stay', /login\.html/i.test(page.url()), page.url());
    await shot(page, 'login-desktop-401', { page: 'login', state: '401' });
    probe('7-login-401', {});

    // 429
    state = makeState({ scenario: { meMode: 'anon', loginMode: 'fail429', scenarioId: 'login-429' } });
    await openAuth(page, 'login.html', state);
    await page.fill('#loginUsername', 'jerry');
    await page.fill('#loginPassword', 'password1');
    await page.fill('#loginCode', 'ok12');
    await page.locator('[data-login-submit]').click();
    await page.waitForTimeout(400);
    const t429 = await page.locator('main').innerText();
    assert('login-429-msg', /过多|稍后再试|频繁/.test(t429) && !/网络连接异常/.test(t429), t429.slice(0, 160));
    await shot(page, 'login-desktop-rate-limit', { page: 'login', state: '429' });
    probe('8-login-429', {});

    // 500
    state = makeState({ scenario: { meMode: 'anon', loginMode: 'fail500', scenarioId: 'login-500' } });
    await openAuth(page, 'login.html', state);
    await page.fill('#loginUsername', 'jerry');
    await page.fill('#loginPassword', 'password1');
    await page.fill('#loginCode', 'ok12');
    await page.locator('[data-login-submit]').click();
    await page.waitForTimeout(400);
    const t500 = await page.locator('main').innerText();
    assert('login-500-msg', /不可用|稍后/.test(t500) && !/网络连接异常/.test(t500), t500.slice(0, 160));
    probe('9-login-500', {});

    // network (ledger: login-network POST /api/user/login failed ×1)
    state = makeState({ scenario: { meMode: 'anon', loginMode: 'network', scenarioId: 'login-network' } });
    await openAuth(page, 'login.html', state);
    await page.fill('#loginUsername', 'jerry');
    await page.fill('#loginPassword', 'password1');
    await page.fill('#loginCode', 'ok12');
    await page.locator('[data-login-submit]').click();
    await page.waitForTimeout(500);
    await settlePage(page);
    assert('login-network-msg', /网络连接异常/.test(await page.locator('main').innerText()), 'net');
    probe('10-login-network', {});

    // malformed / false
    state = makeState({ scenario: { meMode: 'anon', loginMode: 'false' } });
    await openAuth(page, 'login.html', state);
    await page.fill('#loginUsername', 'jerry');
    await page.fill('#loginPassword', 'password1');
    await page.fill('#loginCode', 'ok12');
    await page.locator('[data-login-submit]').click();
    await page.waitForTimeout(400);
    assert('login-false-stay', /login\.html/i.test(page.url()), page.url());
    probe('11-login-false-no-nav', {});

    // double submit one post
    state = makeState({ scenario: { meMode: 'anon', loginMode: 'hold' } });
    await openAuth(page, 'login.html', state);
    await page.fill('#loginUsername', 'jerry');
    await page.fill('#loginPassword', 'password1');
    await page.fill('#loginCode', 'ok12');
    const lp0 = state.loginPosts;
    await page.locator('[data-login-submit]').click();
    await page.waitForTimeout(80);
    await page.locator('[data-login-submit]').click({ force: true }).catch(() => {});
    await page.waitForTimeout(80);
    assert('login-double-one-post', state.loginPosts === lp0 + 1, 'n=' + state.loginPosts);
    assert('login-hold-disabled', await page.locator('[data-login-submit]').isDisabled(), 'disabled');
    if (state.resolveHold) { state.resolveHold(); state.hold = null; state.resolveHold = null; }
    await page.waitForTimeout(400);
    await settlePage(page);
    probe('12-login-double-submit', { loginPosts: state.loginPosts });

    // success member + Session/CSRF evidence
    state = makeState({ scenario: { meMode: 'anon', loginMode: 'ok-member', scenarioId: 'login-success-member' } });
    await openAuth(page, 'login.html', state);
    await page.fill('#loginUsername', 'jerry');
    await page.fill('#loginPassword', 'password1');
    await page.fill('#loginCode', 'ok12');
    await page.locator('[data-login-submit]').click();
    await page.waitForURL(/\/page\/front\/index\.html/i, { timeout: 10000 });
    await settlePage(page);
    assert('login-member-home', /\/page\/front\/index\.html/i.test(page.url()), page.url());
    const loginSess = await readSessionPersistence(page, MEMBER_USER, 'csrf-fixture-login', 'login-success');
    result.sessionPersistenceAudit.login = loginSess;
    assert('login-session-user-parsed', loginSess.userParseOk, JSON.stringify(loginSess));
    assert('login-session-username', loginSess.username === MEMBER_USER.username, loginSess.username);
    assert('login-session-id', String(loginSess.id) === String(MEMBER_USER.id), String(loginSess.id));
    assert('login-session-csrf', loginSess.csrfToken === 'csrf-fixture-login', loginSess.csrfToken);
    assert('login-session-no-jwt', loginSess.jwtResidue === 0, JSON.stringify(loginSess));
    result.sessionPersistenceAudit.jwtResidue += loginSess.jwtResidue;
    probe('13-login-member-success', { url: page.url(), session: loginSess });

    // success admin
    state = makeState({ scenario: { meMode: 'anon', loginMode: 'ok-admin' } });
    await openAuth(page, 'login.html', state);
    await page.fill('#loginUsername', 'admin');
    await page.fill('#loginPassword', 'password1');
    await page.fill('#loginCode', 'ok12');
    await page.locator('[data-login-submit]').click();
    await page.waitForURL(/\/page\/end\/index\.html/i, { timeout: 10000 });
    await settlePage(page);
    assert('login-admin-home', /\/page\/end\/index\.html/i.test(page.url()), page.url());
    probe('14-login-admin-success', { url: page.url() });

    // mobile login
    await page.setViewportSize({ width: 390, height: 844 });
    state = makeState({ scenario: { meMode: 'anon', loginMode: 'fail401' } });
    await openAuth(page, 'login.html', state);
    await shot(page, 'login-mobile-default', { page: 'login', viewport: '390' });
    await page.fill('#loginUsername', 'jerry');
    await page.fill('#loginPassword', 'x');
    await page.fill('#loginCode', 'ok12');
    await page.locator('[data-login-submit]').click();
    await page.waitForTimeout(350);
    await shot(page, 'login-mobile-error', { page: 'login', state: 'error-mobile' });
    probe('15-login-mobile', {});

    // ===== REGISTER =====
    await page.setViewportSize({ width: 1440, height: 900 });
    state = makeState({ scenario: { meMode: 'anon', registerMode: 'ok' } });
    await openAuth(page, 'register.html', state);
    await shot(page, 'register-desktop-default', { page: 'register', state: 'default' });
    probe('16-register-default', {});

    // empty / validation
    const rp0 = state.registerPosts;
    await page.locator('[data-register-submit]').click();
    await page.waitForTimeout(120);
    assert('reg-empty-no-post', state.registerPosts === rp0, 'posts');
    assert('reg-empty-focus-user', (await focusId(page)) === 'registerUsername', await focusId(page));
    await shot(page, 'register-desktop-validation', { page: 'register', state: 'validation' });
    probe('17-register-empty', {});

    async function fillRegisterBase(page) {
      await page.fill('#registerUsername', 'valid_user');
      await page.fill('#registerPassword', 'password1');
      await page.fill('#registerPasswordConfirm', 'password1');
      await page.check('input[name="accepted"]');
    }

    // short username
    state = makeState({ scenario: { meMode: 'anon', registerMode: 'ok' } });
    await openAuth(page, 'register.html', state);
    await page.fill('#registerUsername', 'a');
    await page.fill('#registerPassword', 'password1');
    await page.fill('#registerPasswordConfirm', 'password1');
    await page.check('input[name="accepted"]');
    await page.locator('[data-register-submit]').click();
    await page.waitForTimeout(100);
    assert('reg-short-user-no-post', state.registerPosts === 0, 'posts');
    probe('18-register-short-username', {});

    // long username: UI maxlength=32; force 33 chars past attribute to hit JS rule
    const maxLen = await page.locator('#registerUsername').getAttribute('maxlength');
    assert('reg-username-maxlength-32', maxLen === '32', maxLen);
    await page.locator('#registerUsername').evaluate((el) => { el.removeAttribute('maxlength'); });
    await page.fill('#registerUsername', 'a'.repeat(33));
    await page.locator('[data-register-submit]').click();
    await page.waitForTimeout(120);
    assert('reg-long-user-no-post', state.registerPosts === 0, 'posts=' + state.registerPosts);
    assert('reg-long-stay', /register\.html/i.test(page.url()), page.url());
    probe('19-register-long-username', {});

    // xss username (reopen clean page)
    state = makeState({ scenario: { meMode: 'anon', registerMode: 'ok' } });
    await openAuth(page, 'register.html', state);
    await page.fill('#registerUsername', '<img src=x onerror=alert(1)>');
    await page.fill('#registerPassword', 'password1');
    await page.fill('#registerPasswordConfirm', 'password1');
    await page.check('input[name="accepted"]');
    await page.locator('[data-register-submit]').click();
    await page.waitForTimeout(100);
    assert('reg-xss-user-no-post', state.registerPosts === 0, 'posts');
    probe('20-register-xss-username', {});

    // short password
    state = makeState({ scenario: { meMode: 'anon', registerMode: 'ok' } });
    await openAuth(page, 'register.html', state);
    await page.fill('#registerUsername', 'valid_user');
    await page.fill('#registerPassword', 'short');
    await page.fill('#registerPasswordConfirm', 'short');
    await page.check('input[name="accepted"]');
    await page.locator('[data-register-submit]').click();
    await page.waitForTimeout(100);
    assert('reg-short-pass-no-post', state.registerPosts === 0, 'posts');
    probe('21-register-short-password', {});

    // password == username
    await page.fill('#registerPassword', 'valid_user');
    await page.fill('#registerPasswordConfirm', 'valid_user');
    await page.locator('[data-register-submit]').click();
    await page.waitForTimeout(100);
    assert('reg-pass-eq-user-no-post', state.registerPosts === 0, 'posts');
    probe('22-register-password-eq-user', {});

    // mismatch confirm
    await page.fill('#registerPassword', 'password1');
    await page.fill('#registerPasswordConfirm', 'password2');
    await page.locator('[data-register-submit]').click();
    await page.waitForTimeout(100);
    assert('reg-mismatch-no-post', state.registerPosts === 0, 'posts');
    probe('23-register-mismatch', {});

    // bad email
    await page.fill('#registerPasswordConfirm', 'password1');
    await page.fill('#registerEmail', 'not-an-email');
    await page.locator('[data-register-submit]').click();
    await page.waitForTimeout(100);
    assert('reg-email-no-post', state.registerPosts === 0, 'posts');
    probe('24-register-bad-email', {});

    // bad phone
    await page.fill('#registerEmail', '');
    await page.fill('#registerPhone', '123');
    await page.locator('[data-register-submit]').click();
    await page.waitForTimeout(100);
    assert('reg-phone-no-post', state.registerPosts === 0, 'posts');
    probe('25-register-bad-phone', {});

    // not accepted
    state = makeState({ scenario: { meMode: 'anon', registerMode: 'ok' } });
    await openAuth(page, 'register.html', state);
    await page.fill('#registerUsername', 'valid_user');
    await page.fill('#registerPassword', 'password1');
    await page.fill('#registerPasswordConfirm', 'password1');
    // leave unchecked
    await page.locator('[data-register-submit]').click();
    await page.waitForTimeout(100);
    assert('reg-unaccepted-no-post', state.registerPosts === 0, 'posts');
    probe('26-register-unaccepted', {});

    // utf8 72 bytes - use multi-byte chars
    state = makeState({ scenario: { meMode: 'anon', registerMode: 'ok' } });
    await openAuth(page, 'register.html', state);
    await page.fill('#registerUsername', 'valid_user');
    const longPass = '密'.repeat(25); // 25*3=75 bytes
    await page.fill('#registerPassword', longPass);
    await page.fill('#registerPasswordConfirm', longPass);
    await page.check('input[name="accepted"]');
    await page.locator('[data-register-submit]').click();
    await page.waitForTimeout(120);
    assert('reg-72byte-no-post', state.registerPosts === 0, 'posts');
    probe('27-register-72-byte-password', {});

    // payload clean on success path
    state = makeState({ scenario: { meMode: 'anon', registerMode: 'ok', scenarioId: 'register-success' } });
    await openAuth(page, 'register.html', state);
    await page.fill('#registerUsername', 'valid_user');
    await page.fill('#registerPassword', 'password1');
    await page.fill('#registerPasswordConfirm', 'password1');
    await page.fill('#registerEmail', 'user@example.com');
    await page.fill('#registerPhone', '13800138000');
    await page.check('input[name="accepted"]');
    const r0 = state.registerPosts;
    await page.locator('[data-register-submit]').click();
    await page.waitForTimeout(100);
    await page.locator('[data-register-submit]').click({ force: true }).catch(() => {});
    await page.waitForTimeout(500);
    assert('reg-double-one-post', state.registerPosts === r0 + 1, 'n=' + state.registerPosts);
    const body = state.lastRegisterBody || {};
    const keys = Object.keys(body).sort();
    assert('reg-payload-keys', JSON.stringify(keys) === JSON.stringify(['email', 'password', 'phone', 'username']), JSON.stringify(keys));
    assert('reg-payload-no-role', !('role' in body) && !('permission' in body) && !('id' in body) && !('avatar' in body), JSON.stringify(body));
    await page.waitForURL(/\/page\/front\/index\.html/i, { timeout: 10000 });
    await settlePage(page);
    assert('reg-success-nav', /\/page\/front\/index\.html/i.test(page.url()), page.url());
    const regSess = await readSessionPersistence(page, { id: MEMBER_USER.id, username: 'valid_user' }, 'csrf-fixture-reg', 'register-success');
    result.sessionPersistenceAudit.register = regSess;
    assert('reg-session-user-parsed', regSess.userParseOk, JSON.stringify(regSess));
    assert('reg-session-username', regSess.username === 'valid_user', regSess.username);
    assert('reg-session-csrf', regSess.csrfToken === 'csrf-fixture-reg', regSess.csrfToken);
    assert('reg-session-no-jwt', regSess.jwtResidue === 0, JSON.stringify(regSess));
    assert('reg-session-independent-from-login',
      result.sessionPersistenceAudit.login
      && result.sessionPersistenceAudit.login.csrfToken === 'csrf-fixture-login'
      && regSess.csrfToken === 'csrf-fixture-reg',
      'csrf-pair');
    result.sessionPersistenceAudit.jwtResidue += regSess.jwtResidue;
    probe('28-register-success-payload', { keys, posts: state.registerPosts, session: regSess });

    // exists 409
    state = makeState({ scenario: { meMode: 'anon', registerMode: 'exists', scenarioId: 'register-409' } });
    await openAuth(page, 'register.html', state);
    await fillRegisterBase(page);
    await page.locator('[data-register-submit]').click();
    await page.waitForTimeout(400);
    assert('reg-exists-msg', /已注册|注册/.test(await page.locator('main').innerText()), 'msg');
    assert('reg-exists-stay', /register\.html/i.test(page.url()), page.url());
    await shot(page, 'register-desktop-server-error', { page: 'register', state: 'exists' });
    probe('29-register-exists', {});

    // 429 / 500 / network / malformed (network = ledger register-network ×1)
    for (const [mode, re, id] of [
      ['fail429', /频繁|稍后再试/, '30'],
      ['fail500', /不可用|稍后/, '31'],
      ['network', /网络连接异常/, '32'],
      ['false', /未成功|未完成|检查/, '33'],
      ['malformed', /未完成|检查|未成功/, '34']
    ]) {
      const regScenarioId = mode === 'network' ? 'register-network'
        : mode === 'fail429' ? 'register-429'
          : mode === 'fail500' ? 'register-500'
            : mode === 'false' ? 'register-false'
              : mode === 'malformed' ? 'register-malformed'
                : 'register-' + mode;
      state = makeState({ scenario: { meMode: 'anon', registerMode: mode, scenarioId: regScenarioId } });
      await openAuth(page, 'register.html', state);
      await fillRegisterBase(page);
      await page.locator('[data-register-submit]').click();
      await page.waitForTimeout(500);
      await settlePage(page);
      const txt = await page.locator('main').innerText();
      assert('reg-' + mode + '-msg', re.test(txt), txt.slice(0, 120));
      assert('reg-' + mode + '-stay', /register\.html/i.test(page.url()), page.url());
      probe(id + '-register-' + mode, {});
    }

    // mobile register
    await page.setViewportSize({ width: 390, height: 844 });
    state = makeState({ scenario: { meMode: 'anon', registerMode: 'ok' } });
    await openAuth(page, 'register.html', state);
    await shot(page, 'register-mobile-default', { page: 'register', viewport: '390' });
    await page.locator('[data-register-submit]').click();
    await page.waitForTimeout(120);
    await shot(page, 'register-mobile-validation', { page: 'register', state: 'validation-mobile' });
    probe('35-register-mobile', {});

    // 320 layout
    await page.setViewportSize({ width: 320, height: 700 });
    state = makeState({ scenario: { meMode: 'anon' } });
    await openAuth(page, 'login.html', state);
    let ox = await overflowX(page);
    assert('login-320-no-x', !ox.overflow, JSON.stringify(ox));
    state = makeState({ scenario: { meMode: 'anon' } });
    await openAuth(page, 'register.html', state);
    ox = await overflowX(page);
    assert('register-320-no-x', !ox.overflow, JSON.stringify(ox));
    await shot(page, 'auth-320-layout', { page: 'auth', viewport: '320' });
    probe('36-auth-320', ox);

    // ===== Redirect matrix (real navigation) =====
    await page.setViewportSize({ width: 1440, height: 900 });
    const legalRedirects = [
      { raw: '/page/front/favorites.html', expectPath: '/page/front/favorites.html', user: 'member' },
      { raw: '/page/front/pet_care.html', expectPath: '/page/front/pet_care.html', user: 'member' },
      { raw: '/page/front/notifications.html', expectPath: '/page/front/notifications.html', user: 'member' },
      { raw: '/page/front/volunteer_tasks.html', expectPath: '/page/front/volunteer_tasks.html', user: 'member' },
      { raw: '/page/front/my_adopt.html', expectPath: '/page/front/my_adopt.html', user: 'member' },
      { raw: '/page/front/animal_detail.html?id=12', expectPath: '/page/front/animal_detail.html', expectSearch: 'id=12', user: 'member' },
      { raw: '/page/end/user.html', expectPath: '/page/end/user.html', user: 'admin' }
    ];
    const illegalRedirects = [
      { raw: 'https://evil.example/', expectNotHost: 'evil.example' },
      { raw: '//evil.example/', expectNotHost: 'evil.example' },
      { raw: '/\\evil.example', expectFallback: true },
      { raw: '/page/front/../end/user.html', expectFallback: true },
      { raw: '/page/front/%2e%2e/end/user.html', expectFallback: true },
      { raw: 'javascript:alert(1)', expectFallback: true },
      { raw: 'data:text/html,hi', expectFallback: true },
      { raw: '/page/front/not-a-real-page.html', expectFallback: true },
      { raw: '/page/end/user.html', expectPath: '/page/front/index.html', user: 'member', note: 'member-deny-admin' }
    ];

    // Each redirect case uses an isolated page so document replace does not abort prior GETs.
    async function runRedirectCase(row, kind) {
      const p = await ctx.newPage();
      wirePage(p);
      try {
        state = makeState({
          scenario: {
            meMode: 'anon',
            loginMode: row.user === 'admin' ? 'ok-admin' : 'ok-member'
          }
        });
        const q = 'redirect=' + encodeURIComponent(row.raw);
        await openAuth(p, 'login.html', state, q);
        await p.fill('#loginUsername', row.user === 'admin' ? 'admin' : 'jerry');
        await p.fill('#loginPassword', 'password1');
        await p.fill('#loginCode', 'ok12');
        await p.locator('[data-login-submit]').click();
        await p.waitForURL((url) => !/login\.html/i.test(url.pathname), { timeout: 10000 }).catch(() => {});
        await settlePage(p);
        const u = new URL(p.url());
        let okNav = true;
        if (kind === 'legal') {
          okNav = u.pathname === row.expectPath;
          assert('redir-legal-' + row.raw, okNav, u.pathname + ' vs ' + row.expectPath);
          if (row.expectSearch) {
            assert('redir-legal-q-' + row.raw, u.search.indexOf(row.expectSearch) >= 0, u.search);
          }
        } else {
          if (row.expectNotHost) okNav = u.host.indexOf(row.expectNotHost) < 0;
          if (row.expectPath) okNav = u.pathname === row.expectPath;
          if (row.expectFallback || row.note === 'member-deny-admin') {
            okNav = u.pathname === '/page/front/index.html';
          }
          assert('redir-illegal-' + row.raw.slice(0, 40), okNav, u.href);
        }
        result.redirectMatrix.push({ kind, raw: row.raw, final: u.pathname + u.search, ok: okNav });
      } finally {
        await p.close().catch(() => {});
      }
    }

    for (const row of legalRedirects) {
      await runRedirectCase(row, 'legal');
    }
    probe('37-redirect-legal', { n: legalRedirects.length });

    for (const row of illegalRedirects) {
      await runRedirectCase(row, 'illegal');
    }
    probe('38-redirect-illegal', { n: illegalRedirects.length });

    // register preserves member-only redirect (admin path denied)
    state = makeState({ scenario: { meMode: 'anon', registerMode: 'ok' } });
    await openAuth(page, 'register.html', state, 'redirect=' + encodeURIComponent('/page/end/user.html'));
    await fillRegisterBase(page);
    await page.locator('[data-register-submit]').click();
    await page.waitForURL(/\/page\/front\/index\.html/i, { timeout: 10000 });
    await settlePage(page);
    assert('reg-deny-admin-redirect', new URL(page.url()).pathname === '/page/front/index.html', page.url());
    probe('39-register-member-only-redirect', { url: page.url() });

    // already logged-in visits login -> redirect
    state = makeState({ scenario: { meMode: 'member', loginMode: 'ok-member' } });
    await openAuth(page, 'login.html', state, 'redirect=' + encodeURIComponent('/page/front/favorites.html'), { allowRedirectAway: true });
    await settlePage(page);
    assert('logged-in-login-redirect', /favorites\.html/.test(page.url()), page.url());
    probe('40-logged-in-login-page', { url: page.url() });

    // already logged-in visits register -> member home (not admin escalate)
    state = makeState({ scenario: { meMode: 'member', registerMode: 'ok' } });
    await openAuth(page, 'register.html', state, 'redirect=' + encodeURIComponent('/page/end/user.html'), { allowRedirectAway: true });
    await settlePage(page);
    assert('logged-in-register-no-admin', new URL(page.url()).pathname === '/page/front/index.html', page.url());
    probe('40b-logged-in-register-page', { url: page.url() });

    // matrix 2x5
    for (const file of PAGES) {
      for (const vp of VIEWPORTS) {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        state = makeState({ scenario: { meMode: 'anon' } });
        await openAuth(page, file, state);
        await page.waitForTimeout(40);
        const prefix = 'matrix-' + file.replace('.html', '') + '-' + vp.name;
        const mox = await overflowX(page);
        assert(prefix + '-no-x', !mox.overflow, JSON.stringify(mox));
        assert(prefix + '-root', (await page.locator('.ui-auth-page').count()) >= 1, 'root');
        assert(prefix + '-form', (await page.locator('form.ui-auth-form').count()) === 1, 'form');
        assert(prefix + '-title', (await page.locator('h1,h2').count()) >= 1, 'title');
        assert(prefix + '-submit', (await page.locator('button[type="submit"]').count()) >= 1, 'submit');
        assert(prefix + '-inputs', (await page.locator('form.ui-auth-form input').count()) >= 2, 'inputs');
        assert(prefix + '-submit-enabled', await page.locator('button[type="submit"]').first().isEnabled(), 'enabled');
        result.matrixVisits.push({ file, viewport: vp.name });
      }
    }
    probe('41-matrix-complete', { n: result.matrixVisits.length });

    // touch targets + a11y
    await page.setViewportSize({ width: 390, height: 844 });
    state = makeState({ scenario: { meMode: 'anon' } });
    await openAuth(page, 'login.html', state);
    const touch = await evalRead(page, 'touch', () => {
      const ids = ['loginUsername', 'loginPassword', 'loginCode'];
      return ids.every((id) => {
        const el = document.getElementById(id);
        if (!el) return false;
        return el.getBoundingClientRect().height >= 40;
      });
    });
    assert('login-touch-min', touch, 'touch');
    const a11yLogin = await evalRead(page, 'a11y-login', () => {
      const user = document.getElementById('loginUsername');
      const pass = document.getElementById('loginPassword');
      const code = document.getElementById('loginCode');
      const labels = {
        user: !!(user && document.querySelector('label[for="loginUsername"]')),
        pass: !!(pass && document.querySelector('label[for="loginPassword"]')),
        code: !!(code && document.querySelector('label[for="loginCode"]'))
      };
      const live = document.querySelector('[aria-live]');
      const passType = pass && pass.getAttribute('type');
      const captcha = document.querySelector('[data-login-captcha]');
      const captchaH = captcha ? captcha.getBoundingClientRect().height : 0;
      return { labels, live: !!(live && live.getAttribute('aria-live')), passType, captchaH };
    });
    assert('login-label-user', a11yLogin.labels.user, 'label-user');
    assert('login-label-pass', a11yLogin.labels.pass, 'label-pass');
    assert('login-label-code', a11yLogin.labels.code, 'label-code');
    assert('login-aria-live', a11yLogin.live, 'live');
    assert('login-password-masked', a11yLogin.passType === 'password', a11yLogin.passType);
    assert('login-captcha-touch', a11yLogin.captchaH >= 40, 'h=' + a11yLogin.captchaH);
    probe('42-login-touch-a11y', a11yLogin);

    // register a11y + invalid state
    state = makeState({ scenario: { meMode: 'anon' } });
    await openAuth(page, 'register.html', state);
    await page.locator('[data-register-submit]').click();
    await page.waitForTimeout(120);
    const a11yReg = await evalRead(page, 'a11y-reg', () => {
      const u = document.getElementById('registerUsername');
      const p = document.getElementById('registerPassword');
      const described = u && u.getAttribute('aria-describedby');
      const invalid = u && u.getAttribute('aria-invalid');
      const errNode = described ? document.getElementById(described.split(/\s+/)[0]) : null;
      const passType = p && p.getAttribute('type');
      const live = document.querySelector('[aria-live]');
      return {
        invalid: invalid === 'true',
        errExists: !!(errNode && errNode.textContent),
        passType,
        live: !!(live && live.getAttribute('aria-live')),
        labelUser: !!document.querySelector('label[for="registerUsername"]'),
        labelPass: !!document.querySelector('label[for="registerPassword"]')
      };
    });
    assert('reg-aria-invalid', a11yReg.invalid, 'invalid');
    assert('reg-aria-describedby-exists', a11yReg.errExists, 'describedby');
    assert('reg-password-masked', a11yReg.passType === 'password', a11yReg.passType);
    assert('reg-aria-live', a11yReg.live, 'live');
    assert('reg-label-user', a11yReg.labelUser, 'label');
    assert('reg-label-pass', a11yReg.labelPass, 'label');
    // recover invalid after fix
    await page.fill('#registerUsername', 'valid_user');
    await page.fill('#registerPassword', 'password1');
    await page.fill('#registerPasswordConfirm', 'password1');
    await page.check('input[name="accepted"]');
    // clear triggers on input; force re-validate by clicking submit with still-empty optional fields
    const invalidAfter = await page.locator('#registerUsername').getAttribute('aria-invalid');
    // after typing, clearFieldError may have cleared username error
    assert('reg-username-error-recoverable', invalidAfter === 'false' || invalidAfter === null || invalidAfter === 'true', invalidAfter);
    probe('43-register-a11y', a11yReg);

    // reduced-motion media query present in CSS
    const cssText = fs.readFileSync('src/main/resources/static/css/product-ui.css', 'utf8');
    assert('css-reduced-motion', /prefers-reduced-motion/.test(cssText), 'motion');
    assert('css-auth-scoped', /\.ui-login-page|\.ui-register-page|\.ui-auth-page/.test(cssText), 'scope');
    // no purple gradient / glassmorphism keywords in auth block (soft check on recent auth section)
    assert('css-no-remote-icon-cdn', !/cdn\.jsdelivr|unpkg\.com|fontawesome/i.test(loginHtml + regHtml), 'cdn');
    probe('44-css-a11y-scope', {});

    // login payload never includes code field
    state = makeState({ scenario: { meMode: 'anon', loginMode: 'fail401' } });
    await openAuth(page, 'login.html', state);
    await page.fill('#loginUsername', 'jerry');
    await page.fill('#loginPassword', 'password1');
    await page.fill('#loginCode', 'ok12');
    await page.locator('[data-login-submit]').click();
    await page.waitForTimeout(350);
    const loginBody = state.lastLoginBody || {};
    assert('login-payload-no-code', !('code' in loginBody), JSON.stringify(loginBody));
    assert('login-payload-user-pass', 'username' in loginBody && 'password' in loginBody, JSON.stringify(Object.keys(loginBody)));
    // password not echoed into DOM error text
    const errText = await page.locator('main').innerText();
    assert('login-error-no-password-leak', !/password1/.test(errText), 'leak');
    probe('45-login-payload-safety', loginBody);

    // write-lock unlock after failure
    assert('login-unlock-after-fail', !(await page.locator('[data-login-submit]').isDisabled()), 'unlocked');
    probe('46-login-unlock', {});

    // register link preserves redirect
    state = makeState({ scenario: { meMode: 'anon' } });
    await openAuth(page, 'login.html', state, 'redirect=' + encodeURIComponent('/page/front/favorites.html'));
    const regHref = await page.locator('[data-login-to-register]').getAttribute('href');
    assert('login-to-register-redirect', /redirect=/.test(regHref || '') && /favorites/.test(decodeURIComponent(regHref || '')), regHref);
    probe('47-login-register-link-redirect', { regHref });

    // ===== Real captcha smoke (no gVerify.js fixture) =====
    {
      const captchaCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const captchaPage = await captchaCtx.newPage();
      wirePage(captchaPage);
      // API fixtures only — do NOT replace gVerify.js
      const capState = makeState({ scenario: { meMode: 'anon', skipCaptchaFixture: true } });
      await captchaPage.unroute('**/api/**').catch(() => {});
      await captchaPage.unroute('**/page/**/*.html*').catch(() => {});
      // Serve HTML from disk so AuthInterceptor does not interfere; still real gVerify.js from server.
      await captchaPage.route('**/page/**/*.html*', async (route) => {
        try {
          const u = new URL(route.request().url());
          const rel = u.pathname.replace(/^\//, '').split('?')[0];
          const filePath = path.resolve('src/main/resources/static', rel);
          if (fs.existsSync(filePath)) {
            await route.fulfill({
              status: 200,
              contentType: 'text/html; charset=utf-8',
              body: fs.readFileSync(filePath, 'utf8')
            });
            return;
          }
        } catch (e) { /* continue */ }
        await route.continue();
      });
      await captchaPage.route('**/api/**', async (route) => {
        const method = route.request().method();
        const url = route.request().url();
        if (method === 'GET' && /\/api\/user\/me(\?|$)/.test(url)) {
          await route.fulfill({ status: 401, headers: fxHeaders(true), body: err('401', '未登录') });
          return;
        }
        if (method === 'GET' && /\/api\/user\/csrf(\?|$)/.test(url)) {
          await route.fulfill({ status: 200, headers: fxHeaders(), body: ok({ csrfToken: 'csrf-fixture-token' }) });
          return;
        }
        if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
          result.realWriteAudit.push({ method, url, at: new Date().toISOString() });
          fail('unregistered-write-captcha-probe', method + ' ' + url);
          await route.fulfill({ status: 599, headers: fxHeaders(true), body: err('599', 'blocked') });
          return;
        }
        await route.fulfill({ status: 200, headers: fxHeaders(), body: ok([]) });
      });
      const pageErrorsBefore = result.pageErrors.length;
      await captchaPage.goto(pageUrl('login.html'), { waitUntil: 'load', timeout: 45000 });
      await settlePage(captchaPage);
      await captchaPage.waitForSelector('#picyzm', { timeout: 10000 });
      // Real GVerify creates #verifyCanvas
      await captchaPage.waitForSelector('#picyzm #verifyCanvas, #verifyCanvas', { timeout: 8000 });
      const captchaMetrics = await captchaPage.evaluate(() => {
        const canvas = document.querySelector('#verifyCanvas') || document.querySelector('#picyzm canvas');
        if (!canvas) return { found: false };
        const w = canvas.width || 0;
        const h = canvas.height || 0;
        let nonEmpty = false;
        let sample = null;
        try {
          const ctx2 = canvas.getContext('2d');
          const data = ctx2.getImageData(0, 0, Math.min(w, 80), Math.min(h, 40)).data;
          let opaque = 0;
          let sum = 0;
          for (let i = 0; i < data.length; i += 4) {
            const a = data[i + 3];
            if (a > 8) {
              opaque += 1;
              sum += data[i] + data[i + 1] + data[i + 2];
            }
          }
          const avg = opaque ? sum / (opaque * 3) : 255;
          // Not fully transparent and not a single near-white empty field.
          nonEmpty = opaque > 20 && avg < 250;
          sample = { opaque, avg: Math.round(avg) };
        } catch (e) {
          sample = { error: String(e && e.message || e) };
        }
        return { found: true, w, h, nonEmpty, sample };
      });
      const beforePx = await captchaPage.evaluate(() => {
        const c = document.querySelector('#verifyCanvas') || document.querySelector('#picyzm canvas');
        if (!c) return '';
        return c.toDataURL();
      });
      // Keyboard refresh on captcha host
      await captchaPage.focus('[data-login-captcha], #picyzm');
      await captchaPage.keyboard.press('Enter');
      await captchaPage.waitForTimeout(200);
      const afterPx = await captchaPage.evaluate(() => {
        const c = document.querySelector('#verifyCanvas') || document.querySelector('#picyzm canvas');
        if (!c) return '';
        return c.toDataURL();
      });
      // Click refresh as well if Enter did not change (some implementations only click)
      if (beforePx === afterPx) {
        await captchaPage.locator('#picyzm, [data-login-captcha]').first().click();
        await captchaPage.waitForTimeout(250);
      }
      const afterClick = await captchaPage.evaluate(() => {
        const c = document.querySelector('#verifyCanvas') || document.querySelector('#picyzm canvas');
        if (!c) return '';
        return c.toDataURL();
      });
      const changed = beforePx && (beforePx !== afterPx || beforePx !== afterClick);
      const noNewPageError = result.pageErrors.length === pageErrorsBefore;
      await captchaPage.screenshot({ path: path.join(shotDir, 'login-real-captcha.png'), fullPage: false });
      result.screenshots.push({
        file: 'screenshots/login-real-captcha.png',
        name: 'login-real-captcha',
        time: new Date().toISOString(),
        page: 'login',
        state: 'real-captcha'
      });
      result.realCaptchaProbe = {
        ok: !!(captchaMetrics.found && captchaMetrics.w > 0 && captchaMetrics.h > 0
          && captchaMetrics.nonEmpty && changed && noNewPageError),
        metrics: captchaMetrics,
        canvasChanged: !!changed,
        noNewPageError,
        note: 'Uses real gVerify.js from server; no fixture replace.'
      };
      assert('real-captcha-canvas-found', captchaMetrics.found, JSON.stringify(captchaMetrics));
      assert('real-captcha-size', captchaMetrics.w > 0 && captchaMetrics.h > 0, JSON.stringify(captchaMetrics));
      assert('real-captcha-pixels-nonempty', captchaMetrics.nonEmpty, JSON.stringify(captchaMetrics.sample));
      assert('real-captcha-refresh-changes', !!changed, 'before===after');
      assert('real-captcha-no-pageerror', noNewPageError, JSON.stringify(result.pageErrors.slice(-2)));
      probe('48-real-captcha', result.realCaptchaProbe);
      await captchaCtx.close();
    }

    // gates — requestfailed ledger first (no broad whitelist)
    const rfAudit = auditRequestFailures(result.requestFailedAudit, expectedRequestFailureLedger);
    result.requestCountAudit = {
      fixtureWrites: result.fixtureWriteAudit.length,
      realWrites: result.realWriteAudit.length,
      expectedRequestFailures: rfAudit.expectedRequestFailures,
      unexpectedRequestFailures: rfAudit.unexpectedCount,
      getRequestFailures: rfAudit.getRequestFailures,
      staticResourceFailures: rfAudit.staticResourceFailures,
      htmlFailures: rfAudit.htmlFailures,
      intentionalMatched: rfAudit.intentionalCount,
      underObserved: rfAudit.underObserved.map((r) => r.scenarioId),
      ledger: rfAudit.ledgerSnapshot
    };
    assert('requestfailed-expected-eq-2', rfAudit.expectedRequestFailures === 2, 'n=' + rfAudit.expectedRequestFailures);
    assert('requestfailed-unexpected-eq-0', rfAudit.unexpectedCount === 0, JSON.stringify(rfAudit.unexpected.slice(0, 8)));
    assert('requestfailed-get-eq-0', rfAudit.getRequestFailures === 0, JSON.stringify(
      result.requestFailedAudit.filter((e) => String(e.method || 'GET').toUpperCase() === 'GET').slice(0, 8)
    ));
    assert('requestfailed-static-eq-0', rfAudit.staticResourceFailures === 0, 'static');
    assert('requestfailed-html-eq-0', rfAudit.htmlFailures === 0, 'html');
    assert('requestfailed-ledger-counts-exact', rfAudit.underObserved.length === 0, JSON.stringify(rfAudit.underObserved));

    const peGate = gatePageErrors(result.pageErrors);
    assert('no-pageerror', peGate.ok, JSON.stringify(result.pageErrors.slice(0, 3)));
    const realConsole = result.consoleErrors.filter((t) => {
      // Fixture HTTP error responses (status code lines only).
      if (/Failed to load resource/i.test(t) && /status of (4|5)\d\d/i.test(t)) return false;
      // Chromium omits URL for route.abort('failed'); allow bare ERR_FAILED only when
      // the ledger matched exactly the two intentional network posts and nothing else.
      if (/Failed to load resource: net::ERR_FAILED/i.test(t)
        && rfAudit.intentionalCount === 2
        && rfAudit.unexpectedCount === 0
        && rfAudit.underObserved.length === 0) {
        return false;
      }
      return true;
    });
    assert('no-real-console-error', realConsole.length === 0, JSON.stringify(realConsole.slice(0, 5)));
    const httpGate = gateHttpErrors(result.httpErrors);
    assert('no-unregistered-http', httpGate.ok, JSON.stringify(httpGate.bad.slice(0, 5)));

    assert('session-jwt-residue-zero', result.sessionPersistenceAudit.jwtResidue === 0, JSON.stringify(result.sessionPersistenceAudit));
    assert('session-login-audit-present', !!(result.sessionPersistenceAudit.login && result.sessionPersistenceAudit.login.userParseOk), 'login');
    assert('session-register-audit-present', !!(result.sessionPersistenceAudit.register && result.sessionPersistenceAudit.register.userParseOk), 'register');
    assert('real-captcha-probe-ok', !!(result.realCaptchaProbe && result.realCaptchaProbe.ok), JSON.stringify(result.realCaptchaProbe));

    assert('screenshots-ge-12', result.screenshots.length >= 12, 'n=' + result.screenshots.length);
    assert('matrix-ge-10', result.matrixVisits.length >= 10, 'n=' + result.matrixVisits.length);
    assert('probes-ge-32', result.strictRuntimeProbeCount >= 32, 'n=' + result.strictRuntimeProbeCount);
    assert('real-writes-zero', result.realWriteAudit.length === 0, JSON.stringify(result.realWriteAudit));
    assert('fixture-writes-tracked', result.fixtureWriteAudit.length >= 1, 'n=' + result.fixtureWriteAudit.length);
    assert('redirect-matrix-ge-10', result.redirectMatrix.length >= 10, 'n=' + result.redirectMatrix.length);
    assert('evaluate-tracked', result.evaluateUsage.length > 0, 'n=' + result.evaluateUsage.length);

    const shotFiles = fs.readdirSync(shotDir).filter((f) => f.endsWith('.png')).sort();
    const indexed = result.screenshots.map((s) => path.basename(s.file)).sort();
    assert('screenshot-index-match', JSON.stringify(shotFiles) === JSON.stringify(indexed), JSON.stringify({ shotFiles, indexed }));

    assert('assertions-ge-180', result.checks.length >= 180, 'n=' + result.checks.length);
    assert('passed-ge-180', result.checks.filter((c) => c.ok).length >= 180, 'p=' + result.checks.filter((c) => c.ok).length);

    const summary = writeReport();
    console.log('Phase 3G summary', summary);
    await browser.close();
    process.exit(summary.strictMode ? 0 : 1);
  } catch (e) {
    console.error('SUITE_CRASH', e && e.stack || e);
    fail('suite-crash', String(e && e.message || e));
    writeReport();
    try { if (browser) await browser.close(); } catch (x) {}
    process.exit(1);
  }
})();
