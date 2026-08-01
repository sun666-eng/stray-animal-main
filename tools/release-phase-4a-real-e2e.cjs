/**
 * Phase 4A credibility-strict real E2E (DOM business writes only).
 * Port default :18154. Fail-closed. No route.fulfill / journeyStore / synthetic.
 *
 * Env: E2E_ADMIN_USERNAME / E2E_ADMIN_PASSWORD (required), DB_PASSWORD for Spring only.
 * Dedicated member is registered each run with marker-bound username+phone.
 * No page.evaluate Vue form injection; captcha read is the only __vue__ peek.
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

const startedAt = Date.now();
const base = process.env.BASE_URL || 'http://127.0.0.1:18154';
const cryptoHash = crypto;
const out = path.resolve('output/playwright/release-phase-4a');
const shotDir = path.join(out, 'screenshots');
fs.mkdirSync(shotDir, { recursive: true });
for (const f of fs.readdirSync(shotDir)) if (f.endsWith('.png')) fs.unlinkSync(path.join(shotDir, f));

const suffix = crypto.randomBytes(3).toString('hex').toUpperCase();
const utcStamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
const testMarker = `E2E4A_${utcStamp}_${suffix}`;
const animalName = `E4A_${suffix}`.slice(0, 20);
const memberUser = (`e4a${suffix.toLowerCase()}`).slice(0, 16);
const memberPass = `E2e4a!${suffix.slice(0, 6)}aA1`;
const memberPhone = `139${String(Date.now()).slice(-8)}`;
const memberEmail = `${memberUser}@e2e4a.test`;
const rescueTitle = `${testMarker.slice(0, 36)}救`.slice(0, 255);
const noticeTitle = `${testMarker.slice(0, 36)}告`.slice(0, 255);
const taskTitle = `${testMarker.slice(0, 28)}任务`.slice(0, 100);
const volAbility = `${testMarker} 可周末犬舍清洁`.slice(0, 255);

const ADMIN_USER = process.env.E2E_ADMIN_USERNAME || '';
const ADMIN_PASS = process.env.E2E_ADMIN_PASSWORD || '';
const ALLOW_REAL_AI = String(process.env.E2E_ALLOW_REAL_AI || 'false').toLowerCase() === 'true';

/** @type {'journey'|'permission'|'cleanup'} */
let phaseMode = 'journey';
let apiSeq = 0;

const result = {
  phase: '4A-credibility',
  baseUrl: base,
  testMarker,
  animalName,
  memberUser,
  profile: 'dev',
  dbName: process.env.DB_NAME || 'test',
  checks: [],
  journeys: [],
  screenshots: [],
  realApiLedger: [],
  dataLifecycleLedger: [],
  cleanupAudit: [],
  authMatrix: [],
  requestFailures: [],
  consoleErrors: [],
  pageErrors: [],
  httpErrors: [],
  directJourneyWriteAudit: [],
  syntheticWrites: 0,
  mockedBusinessResponses: 0,
  fallbackPassCount: 0,
  bestEffortPassCount: 0,
  directJourneyWrite: 0,
  cleanupFailed: 0,
  dataLeakDetected: 0,
  unexpectedRequestFailures: 0,
  unexpectedHttpErrors: 0,
  blocked: false,
  blockReasons: [],
  summary: {}
};

const created = {
  animalId: null,
  adoptAid: null,
  adoptUid: null,
  adoptVersion: null,
  favoriteAnimalId: null,
  helpId: null,
  helpVersion: null,
  volunteerId: null,
  taskId: null,
  taskVersion: null,
  signupId: null,
  noticeId: null,
  accountId: null,
  memberId: null
};

function pass(id, d) { result.checks.push({ id, ok: true, skipped: false, detail: d || '', at: new Date().toISOString() }); }
function fail(id, d) {
  result.checks.push({ id, ok: false, skipped: false, detail: String(d || ''), at: new Date().toISOString() });
  console.error('FAIL', id, String(d || '').slice(0, 220));
}
function assert(id, c, d) { if (c) pass(id, d); else fail(id, d); }
function pageUrl(p) { return base.replace(/\/$/, '') + (p.startsWith('/') ? p : '/' + p); }
async function settle(page, ms) {
  await page.waitForTimeout(ms || 400);
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
}
function noteLife(row) {
  result.dataLifecycleLedger.push(Object.assign({ testMarker, at: new Date().toISOString() }, row));
}
function noteCleanup(row) {
  const r = Object.assign({ at: new Date().toISOString() }, row);
  result.cleanupAudit.push(r);
  if (r.ok === false) result.cleanupFailed += 1;
}
function csrfHeaders(token) {
  return token
    ? { 'X-CSRF-Token': token, 'Content-Type': 'application/json' }
    : { 'Content-Type': 'application/json' };
}
function isBusinessPath(pathname) {
  if (!pathname.startsWith('/api/')) return false;
  if (/^\/api\/user\/(login|logout|me|csrf|register)(\/|$|\?)/.test(pathname)) return false;
  return true;
}
/** Backfill UI write ledger row after waitForResponse parsed body (no body consume in listener). */
function backfillUiWrite(meta) {
  meta = meta || {};
  for (let i = result.realApiLedger.length - 1; i >= 0; i--) {
    const e = result.realApiLedger[i];
    if (e.method !== meta.method) continue;
    if (e.pathname !== meta.pathname && !(meta.pathnameRe && meta.pathnameRe.test(e.pathname))) continue;
    if (e.category !== 'UI business write' && e.category !== 'login/session') continue;
    e.journeyId = meta.journeyId || e.journeyId || '';
    e.scenarioId = meta.scenarioId || e.scenarioId || '';
    e.actorRole = meta.actorRole || e.actorRole || '';
    e.source = meta.source || e.source || 'DOM';
    e.responseStatus = meta.responseStatus != null ? meta.responseStatus : e.status;
    e.businessCode = meta.businessCode != null ? String(meta.businessCode) : e.businessCode;
    e.entityId = meta.entityId != null ? String(meta.entityId) : (e.entityId || '');
    e.requestCount = meta.requestCount != null ? meta.requestCount : 1;
    e.postconditionVerified = !!meta.postconditionVerified;
    e.filledAt = new Date().toISOString();
    return e;
  }
  // if listener missed, append authoritative row
  apiSeq += 1;
  const row = {
    sequence: apiSeq,
    journeyId: meta.journeyId || '',
    scenarioId: meta.scenarioId || '',
    actorRole: meta.actorRole || '',
    method: meta.method,
    pathname: meta.pathname,
    status: meta.responseStatus,
    responseStatus: meta.responseStatus,
    businessCode: meta.businessCode != null ? String(meta.businessCode) : null,
    category: meta.category || 'UI business write',
    source: meta.source || 'DOM',
    entityId: meta.entityId != null ? String(meta.entityId) : '',
    requestCount: meta.requestCount != null ? meta.requestCount : 1,
    postconditionVerified: !!meta.postconditionVerified,
    phaseMode,
    testMarker,
    at: new Date().toISOString()
  };
  result.realApiLedger.push(row);
  return row;
}
function assertUiLedgerComplete() {
  const bad = result.realApiLedger.filter((e) =>
    e.category === 'UI business write' &&
    (!e.journeyId || e.journeyId === '' ||
      e.businessCode == null || e.businessCode === '' ||
      !e.source || e.source === '' ||
      !e.method || !e.pathname ||
      e.responseStatus == null ||
      e.entityId == null || e.entityId === '' ||
      e.requestCount == null ||
      e.postconditionVerified == null)
  );
  assert('ui-ledger-complete', bad.length === 0, JSON.stringify(bad.slice(0, 8)));
}

/**
 * Strict notice-absence predicate (pure, no fail-open).
 * true only when:
 *  1) HTTP 404 + code=404 + no valid data
 *  2) HTTP 200 + code=0 + data is null/undefined (explicitly absent)
 * Everything else (500, code=500, missing code/json, present data, network errors) => false.
 */
function isConfirmedAbsent(httpStatus, json) {
  if (httpStatus == null || !Number.isFinite(Number(httpStatus))) return false;
  if (json == null || typeof json !== 'object' || Array.isArray(json)) return false;
  if (json.code == null || json.code === '') return false;
  const code = String(json.code);
  // missing data property or data=null/undefined => absent; object/array/string/number/boolean are present
  const dataAbsent = !Object.prototype.hasOwnProperty.call(json, 'data') || json.data == null;
  if (Number(httpStatus) === 404 && code === '404' && dataAbsent) return true;
  if (Number(httpStatus) === 200 && code === '0' && dataAbsent) return true;
  return false;
}

/** Deterministic contract self-test for isConfirmedAbsent. Any fail => suite fail-closed. */
function runNoticeAbsenceContractSelfTest() {
  const cases = [
    { id: '404-code404-null', httpStatus: 404, json: { code: '404', data: null }, expect: true },
    { id: '200-code0-null', httpStatus: 200, json: { code: '0', data: null }, expect: true },
    { id: '200-code0-object', httpStatus: 200, json: { code: '0', data: { id: 1, title: 'x' } }, expect: false },
    { id: '200-code500-null', httpStatus: 200, json: { code: '500', data: null }, expect: false },
    { id: '500-code500-null', httpStatus: 500, json: { code: '500', data: null }, expect: false },
    { id: 'missing-json', httpStatus: 200, json: null, expect: false },
    { id: 'missing-code', httpStatus: 200, json: { data: null }, expect: false },
    { id: '404-code0-null', httpStatus: 404, json: { code: '0', data: null }, expect: false },
    { id: '200-code404-null', httpStatus: 200, json: { code: '404', data: null }, expect: false },
    { id: '404-code404-with-data', httpStatus: 404, json: { code: '404', data: { id: 9 } }, expect: false }
  ];
  const results = [];
  let allOk = true;
  for (const c of cases) {
    const got = isConfirmedAbsent(c.httpStatus, c.json);
    const ok = got === c.expect;
    if (!ok) allOk = false;
    results.push({ id: c.id, httpStatus: c.httpStatus, expect: c.expect, got, ok });
    assert('notice-absent-contract-' + c.id, ok, 'got=' + got + ' expect=' + c.expect);
  }
  result.noticeAbsenceContract = { allOk, cases: results, at: new Date().toISOString() };
  assert('notice-absent-contract-all', allOk, JSON.stringify(results.filter((r) => !r.ok)));
  return allOk;
}

// export for node --check / optional require-side use
if (typeof module !== 'undefined' && module.exports) {
  module.exports.isConfirmedAbsent = isConfirmedAbsent;
  module.exports.runNoticeAbsenceContractSelfTest = runNoticeAbsenceContractSelfTest;
}

function mysqlQuery(sql) {
  const pw = process.env.DB_PASSWORD || '123456';
  const db = process.env.DB_NAME || 'test';
  const user = process.env.DB_USERNAME || 'root';
  const host = process.env.DB_HOST || '127.0.0.1';
  try {
    const out = execSync(
      `mysql -h${host} -u${user} -p${pw} -D${db} -N -B -e ${JSON.stringify(sql)}`,
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }
    );
    return String(out || '').trim();
  } catch (e) {
    return 'MYSQL_ERR: ' + String(e.stderr || e.message || e).slice(0, 200);
  }
}

function mysqlRows(sql) {
  // SQL success with zero rows => { error:null, rows:[] }
  // Only mysql command failure sets error.
  const raw = mysqlQuery(sql);
  if (typeof raw === 'string' && raw.startsWith('MYSQL_ERR:')) {
    return { error: raw, rows: [] };
  }
  if (!raw) {
    return { error: null, rows: [] };
  }
  const lines = String(raw).split(/\r?\n/).filter(Boolean);
  return {
    error: null,
    rows: lines.map((line) => line.split('\t'))
  };
}

/** Strict API GET: HTTP 200 + JSON parseable + code=0 + optional records structure. */
async function strictApiGet(page, path, opts) {
  opts = opts || {};
  const out = {
    ok: false,
    httpStatus: null,
    code: null,
    data: null,
    records: null,
    error: null,
    raw: ''
  };
  try {
    const r = await page.request.get(pageUrl(path), { timeout: opts.timeout || 15000 });
    out.httpStatus = r.status();
    try {
      out.raw = await r.text();
      const j = out.raw ? JSON.parse(out.raw) : null;
      if (!j || typeof j !== 'object') {
        out.error = 'json-unparseable';
        return out;
      }
      out.code = j.code != null ? String(j.code) : null;
      out.data = j.data;
      if (opts.expectRecords) {
        if (j.data && Array.isArray(j.data.records)) out.records = j.data.records;
        else if (Array.isArray(j.data)) out.records = j.data;
        else {
          out.error = 'records-missing';
          return out;
        }
      }
      if (out.httpStatus !== 200) {
        out.error = 'http-status-' + out.httpStatus;
        return out;
      }
      if (out.code !== '0') {
        // For absence checks, code 404 may be acceptable when opts.allow404
        if (opts.allow404 && (out.httpStatus === 404 || out.code === '404')) {
          out.ok = true;
          out.error = null;
          return out;
        }
        out.error = 'code-' + out.code;
        return out;
      }
      out.ok = true;
      return out;
    } catch (e) {
      out.error = 'json-parse-fail:' + String(e.message || e).slice(0, 80);
      return out;
    }
  } catch (e) {
    out.error = 'request-fail:' + String(e.message || e).slice(0, 120);
    return out;
  }
}

async function parseBiz(resp) {
  let raw = '';
  let biz = null;
  if (!resp) return { raw, biz };
  // Prefer body() first — text()/json() may race with post-register navigation.
  try {
    const buf = await resp.body();
    raw = Buffer.from(buf).toString('utf8');
    if (raw) biz = JSON.parse(raw);
  } catch (e1) {
    try {
      raw = await resp.text();
      if (raw) biz = JSON.parse(raw);
    } catch (e2) {
      try {
        biz = await resp.json();
        raw = JSON.stringify(biz);
      } catch (e3) {
        biz = null;
      }
    }
  }
  return { raw, biz };
}

/** waitForResponse wrapper — body may be empty after redirect; pair with resolveWriteResult. */
function waitBiz(page, matchFn, timeout) {
  return page.waitForResponse(matchFn, { timeout: timeout || 20000 }).then(async (resp) => {
    const parsed = await parseBiz(resp);
    return { resp, status: resp.status(), raw: parsed.raw, biz: parsed.biz };
  });
}
async function fileSha256(filePath) {
  const buf = fs.readFileSync(filePath);
  return cryptoHash.createHash('sha256').update(buf).digest('hex');
}
async function shotCard(page, name, cardLocator, meta) {
  meta = meta || {};
  await cardLocator.scrollIntoViewIfNeeded().catch(() => {});
  await page.waitForTimeout(200);
  const pathname = new URL(page.url()).pathname;
  if (meta.expectPath) assert('shot-path-' + name, pathname.indexOf(meta.expectPath) >= 0, pathname);
  const box = await cardLocator.boundingBox();
  assert('shot-card-visible-' + name, !!box && box.width > 40 && box.height > 40, JSON.stringify(box));
  const file = path.join(shotDir, name + '.png');
  await cardLocator.screenshot({ path: file });
  result.screenshots.push({
    file: 'screenshots/' + name + '.png',
    name,
    pathname,
    journeyId: meta.journeyId || '',
    scenarioId: meta.scenarioId || name,
    actorRole: meta.actorRole || '',
    stateSelector: meta.stateSelector || '',
    assertionId: meta.assertionId || name,
    entityId: meta.entityId || '',
    screenshotTime: new Date().toISOString(),
    sha256: await fileSha256(file)
  });
}

/**
 * Resolve business body after waitForResponse.
 * Chromium often drops Network.getResponseBody after location.replace (register/adopt).
 * When body is unreadable, require postconditionVerified + HTTP 200 and record code from
 * an authoritative follow-up read is NOT used here — caller must pass postconditionOk
 * and we only then accept inferred code=0 (never invent success without side-effect proof).
 */
async function resolveWriteResult(resp, postconditionOk) {
  const status = resp ? resp.status() : 0;
  const parsed = await parseBiz(resp);
  if (parsed.biz && parsed.biz.code != null) {
    return { status, raw: parsed.raw, biz: parsed.biz, inferred: false };
  }
  if (status === 200 && postconditionOk) {
    return { status, raw: parsed.raw || '', biz: { code: '0', data: true, _bodyUnreadable: true }, inferred: true };
  }
  return { status, raw: parsed.raw || '', biz: null, inferred: false };
}

async function wirePage(page, actor) {
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const t = msg.text();
      if (/Failed to load resource/i.test(t) && /\b[45]\d\d\b/.test(t)) return;
      result.consoleErrors.push({ actor, text: t.slice(0, 200), at: new Date().toISOString() });
    }
  });
  page.on('pageerror', (err) => {
    result.pageErrors.push({ actor, text: String(err && err.message || err).slice(0, 200), at: new Date().toISOString() });
  });
  page.on('requestfailed', (req) => {
    const f = req.failure();
    result.requestFailures.push({
      actor, method: req.method(), url: req.url(), failure: f && f.errorText, phaseMode, at: new Date().toISOString()
    });
    if (f && /ERR_CONNECTION_REFUSED|ERR_NAME_NOT_RESOLVED/i.test(f.errorText || '')) {
      result.unexpectedRequestFailures += 1;
    }
  });
  page.on('response', (res) => {
    try {
      const req = res.request();
      const method = req.method();
      const pathname = new URL(res.url()).pathname;
      if (!pathname.startsWith('/api/')) return;
      const status = res.status();
      if (status >= 500) {
        result.httpErrors.push({ actor, method, pathname, status, at: new Date().toISOString() });
        result.unexpectedHttpErrors += 1;
      }
      const isWrite = !['GET', 'HEAD', 'OPTIONS'].includes(method);
      if (!isWrite && !/\/api\/user\/(me|login|logout|csrf)/.test(pathname)) return;
      apiSeq += 1;
      let source = 'network';
      let category = 'read';
      if (isWrite) {
        if (/\/api\/user\/(login|logout|register)/.test(pathname)) category = 'login/session';
        else if (phaseMode === 'cleanup') category = 'cleanup write';
        else if (phaseMode === 'permission') category = 'permission probe';
        else if (phaseMode === 'journey') {
          // DOM-originated XHR still appears as network; direct page.request is tracked separately
          category = 'UI business write';
          source = 'DOM';
        }
      } else {
        category = phaseMode === 'permission' ? 'permission probe' : 'direct verification';
      }
      result.realApiLedger.push({
        sequence: apiSeq,
        journeyId: '',
        scenarioId: '',
        actorRole: actor,
        method,
        pathname,
        status,
        responseStatus: status,
        businessCode: null,
        entityId: '',
        requestCount: 1,
        postconditionVerified: false,
        category,
        source,
        phaseMode,
        testMarker,
        at: new Date().toISOString()
      });
    } catch (e) { /* */ }
  });
}

/** Track intentional page.request business writes (must not happen in journey mode). */
async function pageRequestWrite(page, method, urlPath, options, meta) {
  meta = meta || {};
  const pathname = urlPath.startsWith('http') ? new URL(urlPath).pathname : urlPath.split('?')[0];
  if (phaseMode === 'journey' && isBusinessPath(pathname)) {
    result.directJourneyWrite += 1;
    result.directJourneyWriteAudit.push({
      method, pathname, phaseMode, meta, at: new Date().toISOString()
    });
    result.fallbackPassCount += 1; // counting as fallback abuse of page.request
  }
  const url = urlPath.startsWith('http') ? urlPath : pageUrl(urlPath);
  if (method === 'GET') return page.request.get(url, options);
  if (method === 'POST') return page.request.post(url, options);
  if (method === 'PUT') return page.request.put(url, options);
  if (method === 'DELETE') return page.request.delete(url, options);
  throw new Error('bad method ' + method);
}

async function getCsrf(page) {
  try {
    const r = await page.request.get(pageUrl('/api/user/csrf'));
    const j = await r.json();
    if (j && j.data && j.data.csrfToken) return String(j.data.csrfToken);
  } catch (e) { /* */ }
  return '';
}

async function readCaptcha(page) {
  await page.waitForFunction(() => {
    const vm = document.querySelector('#app') && document.querySelector('#app').__vue__;
    return !!(vm && vm.verifyCode && vm.verifyCode.options && vm.verifyCode.options.code);
  }, { timeout: 10000 }).catch(() => {});
  return page.evaluate(() => {
    const vm = document.querySelector('#app') && document.querySelector('#app').__vue__;
    return vm && vm.verifyCode && vm.verifyCode.options ? String(vm.verifyCode.options.code || '') : '';
  });
}

async function realLogin(page, username, password, actor) {
  await page.goto(pageUrl('/page/front/login.html'), { waitUntil: 'load', timeout: 45000 });
  await settle(page, 500);
  if (!(await page.locator('#loginUsername').count())) {
    const csrf = await getCsrf(page);
    await page.request.post(pageUrl('/api/user/logout'), { headers: csrfHeaders(csrf), data: {} }).catch(() => {});
    await page.goto(pageUrl('/page/front/login.html'), { waitUntil: 'load' });
    await settle(page, 500);
  }
  await page.waitForSelector('#loginUsername', { timeout: 15000 });
  await page.fill('#loginUsername', username);
  await page.fill('#loginPassword', password);
  const code = await readCaptcha(page);
  assert(actor + '-captcha', !!code && code.length >= 4, 'len=' + (code && code.length));
  await page.fill('#loginCode', code);
  const respP = page.waitForResponse((r) => r.url().includes('/api/user/login') && r.request().method() === 'POST', { timeout: 20000 });
  await page.click('[data-login-submit]');
  const resp = await respP;
  assert(actor + '-login-http', resp.status() === 200, 'status=' + resp.status());
  await settle(page, 700);
  const me = await page.request.get(pageUrl('/api/user/me'));
  let meOk = false;
  let uid = null;
  try {
    const j = await me.json();
    meOk = me.status() === 200 && j && String(j.code) === '0' && j.data && j.data.username === username;
    if (meOk) uid = String(j.data.id);
  } catch (e) { meOk = false; }
  assert(actor + '-login-me', meOk, 'user=' + username);
  return { uid };
}

async function realLogout(page) {
  const csrf = await getCsrf(page);
  await page.request.post(pageUrl('/api/user/logout'), { headers: csrfHeaders(csrf), data: {} }).catch(() => {});
  await settle(page, 300);
}

async function shot(page, name, meta) {
  meta = meta || {};
  const pathname = new URL(page.url()).pathname;
  if (meta.expectPath) assert('shot-path-' + name, pathname.indexOf(meta.expectPath) >= 0, pathname);
  await page.screenshot({ path: path.join(shotDir, name + '.png'), fullPage: false });
  result.screenshots.push({
    file: 'screenshots/' + name + '.png',
    name,
    pathname,
    journeyId: meta.journeyId || '',
    scenarioId: meta.scenarioId || name,
    actorRole: meta.actorRole || '',
    stateSelector: meta.stateSelector || '',
    assertionId: meta.assertionId || name,
    entityId: meta.entityId || '',
    screenshotTime: new Date().toISOString()
  });
}

function journeyDone(id, ids) {
  const related = result.checks.filter((c) => ids.some((a) => c.id === a || c.id.indexOf(a) === 0));
  const ok = related.length > 0 && related.every((c) => c.ok);
  const row = { id, ok, assertionCount: related.length, failed: related.filter((c) => !c.ok).map((c) => c.id) };
  result.journeys.push(row);
  assert('journey-' + id + '-ok', ok, JSON.stringify(row));
  return row;
}

function writeReports() {
  const passed = result.checks.filter((c) => c.ok).length;
  const failed = result.checks.filter((c) => !c.ok).length;
  const skipped = result.checks.filter((c) => c.skipped).length;
  const uiWrites = result.realApiLedger.filter((e) => e.category === 'UI business write').length;
  const strictMode = !result.blocked
    && failed === 0 && skipped === 0
    && result.fallbackPassCount === 0
    && result.bestEffortPassCount === 0
    && result.directJourneyWrite === 0
    && result.syntheticWrites === 0
    && result.mockedBusinessResponses === 0
    && result.cleanupFailed === 0
    && result.unexpectedRequestFailures === 0
    && result.unexpectedHttpErrors === 0
    && result.pageErrors.length === 0
    && result.journeys.length >= 8
    && result.journeys.every((j) => j.ok);

  result.summary = {
    strictMode,
    blocked: result.blocked,
    passed, failed, skipped, total: result.checks.length,
    journeys: result.journeys.length,
    journeysPassed: result.journeys.filter((j) => j.ok).length,
    screenshots: result.screenshots.length,
    uiBusinessWrites: uiWrites,
    loginSessionWrites: result.realApiLedger.filter((e) => e.category === 'login/session').length,
    directJourneyWrite: result.directJourneyWrite,
    syntheticWrites: result.syntheticWrites,
    mockedBusinessResponses: result.mockedBusinessResponses,
    fallbackPassCount: result.fallbackPassCount,
    bestEffortPassCount: result.bestEffortPassCount,
    cleanupFailed: result.cleanupFailed,
    dataLeakDetected: result.dataLeakDetected,
    unexpectedRequestFailures: result.unexpectedRequestFailures,
    unexpectedHttpErrors: result.unexpectedHttpErrors,
    pageErrors: result.pageErrors.length,
    testMarker,
    animalId: created.animalId,
    taskId: created.taskId,
    durationMs: Date.now() - startedAt,
    finishedAt: new Date().toISOString()
  };
  result.ok = strictMode;
  const files = {
    'phase-4a-report.json': result,
    'real-api-ledger.json': result.realApiLedger,
    'data-lifecycle-ledger.json': result.dataLifecycleLedger,
    'cleanup-audit.json': result.cleanupAudit,
    'journey-audit.json': result.journeys,
    'auth-matrix.json': result.authMatrix,
    'screenshots-index.json': result.screenshots,
    'request-failure-ledger.json': result.requestFailures,
    'console-audit.json': { consoleErrors: result.consoleErrors, pageErrors: result.pageErrors, httpErrors: result.httpErrors },
    'regression-summary.json': { phase: '4A-credibility', summary: result.summary, journeys: result.journeys }
  };
  Object.entries(files).forEach(([n, v]) => fs.writeFileSync(path.join(out, n), JSON.stringify(v, null, 2)));
  const log = [
    'PHASE 4A STRICT=' + strictMode,
    'ASSERTIONS ' + passed + '/' + failed + '/' + skipped,
    'JOURNEYS ' + result.summary.journeysPassed + '/' + result.journeys.length,
    'UI_BUSINESS_WRITES ' + uiWrites,
    'DIRECT_JOURNEY_WRITE ' + result.directJourneyWrite,
    'FALLBACK ' + result.fallbackPassCount,
    'CLEANUP_FAILED ' + result.cleanupFailed,
    'TEST_MARKER ' + testMarker,
    'ANIMAL_ID ' + (created.animalId || 'n/a'),
    'TASK_ID ' + (created.taskId || 'n/a')
  ].join('\n');
  fs.writeFileSync(path.join(out, 'run-strict-final.log'), log + '\n');
  return result.summary;
}

// ─── main ─────────────────────────────────────────────────────
(async () => {
  console.log('Phase 4A credibility start', base, testMarker);
  if (!ADMIN_USER || !ADMIN_PASS) {
    result.blocked = true;
    result.blockReasons.push('Missing E2E_ADMIN_USERNAME/PASSWORD');
    fail('env-admin', 'required');
    writeReports();
    process.exit(1);
  }
  assert('db-non-prod', result.dbName === 'test' || process.env.E2E_DB_CONFIRMED_NON_PROD === 'true', result.dbName);

  // Deterministic notice-absence contract self-test (must pass before any journey)
  {
    const contractOk = runNoticeAbsenceContractSelfTest();
    if (!contractOk) {
      result.blocked = true;
      result.blockReasons.push('notice absence contract self-test failed');
      writeReports();
      process.exit(1);
    }
  }

  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    phaseMode = 'journey';

    // ========== Register dedicated member (DOM) ==========
    {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      const page = await ctx.newPage();
      await wirePage(page, 'member-reg');
      await page.goto(pageUrl('/page/front/register.html'), { waitUntil: 'load', timeout: 45000 });
      await page.waitForSelector('#registerUsername', { timeout: 15000 });
      await settle(page, 800);
      // Playwright-only fills (no Vue __vue__ injection)
      await page.fill('#registerUsername', memberUser);
      await page.fill('#registerPassword', memberPass);
      await page.fill('#registerPasswordConfirm', memberPass);
      await page.fill('#registerPhone', memberPhone);
      await page.fill('#registerEmail', memberEmail);
      const accept = page.locator('input[name="accepted"]');
      await accept.check({ force: true });
      assert('reg-accepted-checked', await accept.isChecked(), 'accepted');
      const regWait = waitBiz(page, (r) => r.url().includes('/api/user/register') && r.request().method() === 'POST', 20000);
      await page.click('[data-register-submit]');
      const reg = await regWait.catch(async (err) => {
        const errs = await page.locator('.ui-field-error, .ui-form-alert').allInnerTexts().catch(() => []);
        fail('reg-client-blocked', JSON.stringify(errs));
        throw err;
      });
      assert('reg-member-http', reg.status === 200, 'status=' + reg.status);
      await settle(page, 800);
      const me = await page.request.get(pageUrl('/api/user/me'));
      const mej = await me.json().catch(() => null);
      const sessionOk = !!(mej && mej.data && mej.data.username === memberUser);
      const regResolved = await resolveWriteResult(reg.resp, sessionOk);
      const regBiz = regResolved.biz || reg.biz;
      assert('reg-member-biz', regBiz && String(regBiz.code) === '0', 'body=' + String(reg.raw || regResolved.raw).slice(0, 120) + ' sessionOk=' + sessionOk);
      assert('reg-member-session', sessionOk, 'user');
      created.memberId = mej && mej.data && String(mej.data.id);
      assert('reg-member-phone-ok', mej && mej.data && String(mej.data.phone || '') === memberPhone, 'phone-on-session');
      backfillUiWrite({
        journeyId: 'setup', scenarioId: 'register', actorRole: 'member-reg', method: 'POST',
        pathname: '/api/user/register', responseStatus: reg.status, businessCode: regBiz.code,
        entityId: created.memberId || memberUser, requestCount: 1, postconditionVerified: true, category: 'login/session', source: 'DOM'
      });
      noteLife({ journeyId: 'setup', actor: 'member', method: 'POST', pathname: '/api/user/register', createdEntityType: 'user', createdEntityId: memberUser, cleanupAction: 'RETAIN user audit' });
      await ctx.close();
    }

    // ========== Journey A ==========
    const A = [];
    {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      const page = await ctx.newPage();
      await wirePage(page, 'anon');
      await page.goto(pageUrl('/page/front/index.html'), { waitUntil: 'load' });
      assert('a-public', page.url().indexOf('index.html') >= 0, page.url());
      A.push('a-public');
      await page.goto(pageUrl('/page/front/favorites.html'), { waitUntil: 'load' });
      await settle(page, 600);
      assert('a-protected-login', /login\.html/i.test(page.url()), page.url());
      assert('a-redirect-q', /redirect=/i.test(page.url()), page.url());
      A.push('a-protected-login', 'a-redirect-q');
      await realLogin(page, memberUser, memberPass, 'a-member');
      A.push('a-member-captcha', 'a-member-login-http', 'a-member-login-me');
      await page.reload({ waitUntil: 'load' });
      await settle(page, 500);
      const me = await page.request.get(pageUrl('/api/user/me'));
      const mej = await me.json();
      assert('a-refresh-me', mej && mej.data && mej.data.username === memberUser, 'me');
      A.push('a-refresh-me');
      await realLogout(page);
      const me2 = await page.request.get(pageUrl('/api/user/me'));
      let denied = me2.status() === 401;
      try { const j = await me2.json(); if (String(j.code) !== '0') denied = true; } catch (e) { denied = true; }
      assert('a-logout-denied', denied, 'status=' + me2.status());
      A.push('a-logout-denied');
      await realLogin(page, ADMIN_USER, ADMIN_PASS, 'a-admin');
      A.push('a-admin-captcha', 'a-admin-login-http', 'a-admin-login-me');
      await page.goto(pageUrl('/page/end/animal.html'), { waitUntil: 'load' });
      await settle(page, 800);
      assert('a-admin-animal', page.url().indexOf('/page/end/animal.html') >= 0, page.url());
      A.push('a-admin-animal');
      journeyDone('A-identity-session', A);
      await ctx.close();
    }

    // ========== Journey B: animal-fav-adopt-review ==========
    const B = [];
    {
      const adminCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const adminPage = await adminCtx.newPage();
      await wirePage(adminPage, 'admin');
      await realLogin(adminPage, ADMIN_USER, ADMIN_PASS, 'b-admin');
      B.push('b-admin-captcha', 'b-admin-login-http', 'b-admin-login-me');
      await adminPage.goto(pageUrl('/page/end/animal.html'), { waitUntil: 'load' });
      await settle(adminPage, 1000);
      const createBtn = adminPage.locator('button').filter({ hasText: /新增|新建|创建/ }).first();
      assert('b-create-btn', await createBtn.isVisible(), 'missing');
      B.push('b-create-btn');
      await createBtn.click();
      await adminPage.waitForSelector('#animalName', { timeout: 10000 });
      await adminPage.fill('#animalName', animalName);
      await adminPage.fill('#animalType', '狗');
      await adminPage.selectOption('#animalSex', '公');
      const desc = adminPage.locator('textarea').first();
      if (await desc.count()) await desc.fill(testMarker + ' Phase4A cred animal');
      const postW = adminPage.waitForResponse((r) => {
        try { return new URL(r.url()).pathname === '/api/animal' && r.request().method() === 'POST'; } catch (e) { return false; }
      }, { timeout: 20000 });
      await adminPage.locator('.admin-dialog button, form button').filter({ hasText: /保存/ }).first().click();
      const ar = await postW;
      assert('b-animal-post', ar.status() === 200, 'status=' + ar.status());
      B.push('b-animal-post');
      const aBiz = await parseBiz(ar);
      assert('b-animal-biz', aBiz.biz && String(aBiz.biz.code) === '0', String(aBiz.raw).slice(0, 120));
      await settle(adminPage, 1000);
      const list = await adminPage.request.get(pageUrl('/api/animal/page?pageNum=1&pageSize=50'));
      const lj = await list.json();
      const recs = (lj.data && lj.data.records) || [];
      const found = recs.find((r) => String(r.tname) === animalName);
      assert('b-animal-found', !!found && found.id != null, animalName);
      created.animalId = found ? String(found.id) : null;
      B.push('b-animal-found');
      backfillUiWrite({
        journeyId: 'B', scenarioId: 'b-create', actorRole: 'admin', method: 'POST',
        pathname: '/api/animal', responseStatus: ar.status(), businessCode: aBiz.biz && aBiz.biz.code,
        entityId: created.animalId, requestCount: 1, postconditionVerified: true, source: 'DOM'
      });
      noteLife({ journeyId: 'B', actor: 'admin', method: 'POST', pathname: '/api/animal', createdEntityType: 'animal', createdEntityId: created.animalId, cleanupAction: 'DELETE after deps' });
      await shot(adminPage, 'b-admin-animal-created', { expectPath: '/page/end/animal.html', journeyId: 'B', scenarioId: 'b-create', actorRole: 'admin', entityId: created.animalId, assertionId: 'b-animal-found' });

      const memCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      const memPage = await memCtx.newPage();
      await wirePage(memPage, 'member');
      await realLogin(memPage, memberUser, memberPass, 'b-member');
      B.push('b-member-captcha', 'b-member-login-http', 'b-member-login-me');
      await memPage.goto(pageUrl('/page/front/animal_detail.html?id=' + created.animalId), { waitUntil: 'load' });
      await settle(memPage, 1000);
      const dt = await memPage.locator('main,body').first().innerText();
      assert('b-detail-name', dt.indexOf(animalName) >= 0, dt.slice(0, 120));
      B.push('b-detail-name');
      await shot(memPage, 'b-member-detail', { expectPath: 'animal_detail', journeyId: 'B', scenarioId: 'b-detail', actorRole: 'member', entityId: created.animalId, assertionId: 'b-detail-name' });

      const favPath = '/api/operations/favorites/' + created.animalId;
      let favN = 0;
      const favCnt = (req) => { if (req.method() === 'POST' && req.url().indexOf(favPath) >= 0) favN += 1; };
      memPage.on('request', favCnt);
      const favBtn = memPage.locator('button:has-text("收藏"), button:has-text("已收藏")').first();
      assert('b-fav-btn', await favBtn.isVisible(), 'btn');
      B.push('b-fav-btn');
      if (/已收藏/.test(await favBtn.innerText())) {
        const ufW = memPage.waitForResponse((r) => r.url().indexOf(favPath) >= 0 && r.request().method() === 'DELETE', { timeout: 15000 }).catch(() => null);
        await favBtn.click();
        const ufR = await ufW;
        if (ufR) {
          const ufBiz = await parseBiz(ufR);
          backfillUiWrite({
            journeyId: 'B', scenarioId: 'b-unfav-preclear', actorRole: 'member', method: 'DELETE',
            pathname: favPath, responseStatus: ufR.status(), businessCode: ufBiz.biz ? ufBiz.biz.code : ufR.status(),
            entityId: created.animalId, requestCount: 1, postconditionVerified: true, source: 'DOM'
          });
        }
        await settle(memPage, 400);
      }
      favN = 0;
      const favW = memPage.waitForResponse((r) => r.url().indexOf(favPath) >= 0 && r.request().method() === 'POST', { timeout: 15000 });
      await favBtn.click();
      const favR = await favW;
      memPage.off('request', favCnt);
      assert('b-fav-once', favN === 1, 'n=' + favN);
      assert('b-fav-http', favR.status() === 200, 'status=' + favR.status());
      B.push('b-fav-once', 'b-fav-http');
      const favBiz = await parseBiz(favR);
      assert('b-fav-biz', favBiz.biz && String(favBiz.biz.code) === '0', String(favBiz.raw).slice(0, 120));
      B.push('b-fav-biz');
      created.favoriteAnimalId = created.animalId;
      backfillUiWrite({
        journeyId: 'B', scenarioId: 'b-fav', actorRole: 'member', method: 'POST',
        pathname: favPath, responseStatus: favR.status(), businessCode: favBiz.biz && favBiz.biz.code,
        entityId: created.animalId, requestCount: 1, postconditionVerified: true, source: 'DOM'
      });
      noteLife({ journeyId: 'B', actor: 'member', method: 'POST', pathname: favPath, createdEntityType: 'favorite', createdEntityId: created.animalId, cleanupAction: 'DELETE favorite' });
      await memPage.goto(pageUrl('/page/front/favorites.html'), { waitUntil: 'load' });
      await settle(memPage, 800);
      await memPage.reload({ waitUntil: 'load' });
      const ft = await memPage.locator('main,body').first().innerText();
      assert('b-fav-persist', ft.indexOf(animalName) >= 0, ft.slice(0, 120));
      B.push('b-fav-persist');
      await shot(memPage, 'b-favorites-after', { expectPath: 'favorites', journeyId: 'B', scenarioId: 'b-fav', actorRole: 'member', entityId: created.animalId, assertionId: 'b-fav-persist' });

      await memPage.goto(pageUrl('/page/front/adopt_apply.html?animalId=' + created.animalId), { waitUntil: 'load' });
      await settle(memPage, 1200);
      await memPage.fill('#adoptAge', '28');
      await memPage.selectOption('#adoptGender', '男');
      await memPage.fill('#adoptPhone', memberPhone);
      await memPage.fill('#adoptWechat', ('wx' + suffix.toLowerCase()).slice(0, 20));
      await memPage.fill('#adoptOccupation', '工程师');
      await memPage.selectOption('#adoptMarital', '2');
      await memPage.selectOption('#adoptResident', '1');
      await memPage.selectOption('#adoptIncome', '3000');
      await memPage.selectOption('#adoptExperience', '1');
      await memPage.fill('#adoptPets', '0');
      await memPage.selectOption('#adoptFamily', '1');
      await memPage.fill('#adoptAddress', (testMarker + ' 路1号').slice(0, 255));
      const sub = memPage.locator('#adoptSubmit');
      for (let i = 0; i < 20 && !(await sub.isEnabled()); i++) await memPage.waitForTimeout(200);
      assert('b-adopt-enabled', await sub.isEnabled(), 'disabled');
      B.push('b-adopt-enabled');
      const adW = waitBiz(memPage, (r) => { try { return new URL(r.url()).pathname === '/api/adopt' && r.request().method() === 'POST'; } catch (e) { return false; } }, 25000);
      await sub.click();
      const adCap = await adW;
      assert('b-adopt-http', adCap.status === 200, 'status=' + adCap.status);
      B.push('b-adopt-http');
      noteLife({ journeyId: 'B', actor: 'member', method: 'POST', pathname: '/api/adopt', createdEntityType: 'adopt', createdEntityId: created.animalId, cleanupAction: 'CANCEL terminal' });
      await settle(memPage, 1200);
      if (memPage.url().indexOf('my_adopt') < 0) await memPage.goto(pageUrl('/page/front/my_adopt.html'), { waitUntil: 'load' });
      await settle(memPage, 800);
      await memPage.reload({ waitUntil: 'load' });
      await settle(memPage, 800);
      const mt = await memPage.locator('main,body').first().innerText();
      const adoptUiOk = mt.indexOf(animalName) >= 0 && /待审核|申请|处理中/.test(mt) && !/加载失败|暂时无法加载|正在验证登录/.test(mt);
      assert('b-my-adopt-pending', adoptUiOk, mt.slice(0, 160));
      B.push('b-my-adopt-pending');
      created.adoptAid = created.animalId;
      created.adoptUid = created.memberId;
      const adResolved = await resolveWriteResult(adCap.resp, adoptUiOk);
      const adBiz = adResolved.biz || adCap.biz;
      assert('b-adopt-biz', adBiz && String(adBiz.code) === '0', String(adCap.raw || adResolved.raw).slice(0, 120) + ' uiOk=' + adoptUiOk);
      B.push('b-adopt-biz');
      backfillUiWrite({
        journeyId: 'B', scenarioId: 'b-adopt', actorRole: 'member', method: 'POST',
        pathname: '/api/adopt', responseStatus: adCap.status, businessCode: adBiz && adBiz.code,
        entityId: created.animalId + ':' + created.memberId, requestCount: 1, postconditionVerified: true, source: 'DOM'
      });
      await shot(memPage, 'b-my-adopt-pending', { expectPath: 'my_adopt', journeyId: 'B', scenarioId: 'b-pending', actorRole: 'member', entityId: created.animalId, assertionId: 'b-my-adopt-pending' });

      // Admin approve via DOM
      await adminPage.goto(pageUrl('/page/end/adopt.html'), { waitUntil: 'load' });
      await settle(adminPage, 1200);
      const row = adminPage.locator('tr, article, .ui-record-card, .admin-card').filter({ hasText: animalName }).first();
      assert('b-admin-row', await row.count() > 0, 'no row ' + animalName);
      B.push('b-admin-row');
      const approveBtn = row.locator('button:has-text("通过"), button:has-text("审核通过")').first();
      assert('b-approve-btn', await approveBtn.count() > 0 && await approveBtn.isEnabled(), 'no approve');
      B.push('b-approve-btn');
      await approveBtn.click();
      await settle(adminPage, 400);
      const reason = adminPage.locator('#adoptActionReason, textarea').first();
      if (await reason.count()) await reason.fill(testMarker + ' 人工通过');
      const trW = adminPage.waitForResponse((r) => /\/api\/adopt\/.+\/transition$/.test(new URL(r.url()).pathname) && r.request().method() === 'POST', { timeout: 20000 });
      await adminPage.locator('button:has-text("确认执行"), button:has-text("确认通过")').first().click();
      const trR = await trW;
      assert('b-approve-http', trR.status() === 200, 'status=' + trR.status());
      B.push('b-approve-http');
      const trBiz = await parseBiz(trR);
      assert('b-approve-biz', trBiz.biz && String(trBiz.biz.code) === '0', String(trBiz.raw).slice(0, 120));
      B.push('b-approve-biz');
      backfillUiWrite({
        journeyId: 'B', scenarioId: 'b-approve', actorRole: 'admin', method: 'POST',
        pathname: '/api/adopt/' + created.adoptAid + '/' + created.adoptUid + '/transition',
        pathnameRe: /\/api\/adopt\/.+\/transition$/,
        responseStatus: trR.status(), businessCode: trBiz.biz && trBiz.biz.code,
        entityId: created.adoptAid + ':' + created.adoptUid, requestCount: 1, postconditionVerified: true, source: 'DOM'
      });
      noteLife({ journeyId: 'B', actor: 'admin', method: 'POST', pathname: '/api/adopt/transition', createdEntityType: 'adopt_transition', createdEntityId: created.adoptAid + ':' + created.adoptUid, cleanupAction: 'CANCEL terminal' });
      await shot(adminPage, 'b-admin-approve', { expectPath: '/page/end/adopt.html', journeyId: 'B', scenarioId: 'b-approve', actorRole: 'admin', entityId: created.animalId, assertionId: 'b-approve-http' });

      await memPage.goto(pageUrl('/page/front/my_adopt.html'), { waitUntil: 'load' });
      await settle(memPage, 800);
      await memPage.reload({ waitUntil: 'load' });
      await settle(memPage, 800);
      // poll for reviewed row (async list); fail closed if animal never appears
      let after = '';
      let synced = false;
      for (let i = 0; i < 8 && !synced; i++) {
        after = await memPage.locator('main,body').first().innerText();
        synced = after.indexOf(animalName) >= 0 && !/加载失败|暂时无法加载|正在验证登录/.test(after);
        if (!synced) {
          await memPage.waitForTimeout(500);
          if (i === 3) await memPage.reload({ waitUntil: 'load' }).catch(() => {});
          await settle(memPage, 400);
        }
      }
      assert('b-member-synced', synced, after.slice(0, 200));
      B.push('b-member-synced');
      await shot(memPage, 'b-my-adopt-after-review', { expectPath: 'my_adopt', journeyId: 'B', scenarioId: 'b-sync', actorRole: 'member', entityId: created.animalId, assertionId: 'b-member-synced' });

      // B21 notifications
      await memPage.goto(pageUrl('/page/front/notifications.html'), { waitUntil: 'load' });
      await settle(memPage, 1000);
      const nt = await memPage.locator('main,body').first().innerText();
      assert('b21-notif-ok', !/加载失败|暂时无法加载/.test(nt), nt.slice(0, 120));
      B.push('b21-notif-ok');
      await shot(memPage, 'b-user-notifications', { expectPath: 'notifications', journeyId: 'B', scenarioId: 'b21', actorRole: 'member', entityId: created.animalId, assertionId: 'b21-notif-ok' });

      // B22 isolation: cannot open other user's adopt admin list as success for all
      const iso = await memPage.request.get(pageUrl('/api/help?pageNum=1&pageSize=1'));
      let isoOk = iso.status() === 401 || iso.status() === 403;
      try { const j = await iso.json(); if (['401', '403'].includes(String(j.code))) isoOk = true; } catch (e) {}
      assert('b22-no-admin-help', isoOk, 'status=' + iso.status());
      B.push('b22-no-admin-help');

      journeyDone('B-animal-favorite-adopt-review', B);
      // keep contexts for later? close and reopen as needed
      await memCtx.close();
      await adminCtx.close();
    }

    // ========== Journey C: rescue DOM ==========
    const C = [];
    {
      const memCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      const memPage = await memCtx.newPage();
      await wirePage(memPage, 'member');
      await realLogin(memPage, memberUser, memberPass, 'c-member');
      await memPage.goto(pageUrl('/page/front/rescue_apply.html'), { waitUntil: 'load' });
      await settle(memPage, 800);
      await memPage.fill('#rescueTitleInput', rescueTitle);
      await memPage.fill('#rescueDescription', testMarker + ' 救助现场描述足够长。');
      await memPage.fill('#rescueLocation', '测试区 E2E 路');
      await memPage.fill('#rescuePhone', memberPhone);
      let helpN = 0;
      memPage.on('request', (req) => {
        try { if (req.method() === 'POST' && new URL(req.url()).pathname === '/api/help') helpN += 1; } catch (e) {}
      });
      const hW = memPage.waitForResponse((r) => { try { return new URL(r.url()).pathname === '/api/help' && r.request().method() === 'POST'; } catch (e) { return false; } }, { timeout: 20000 });
      await memPage.locator('#rescueSubmit').click();
      const hR = await hW;
      assert('c-help-once', helpN === 1, 'n=' + helpN);
      assert('c-help-http', hR.status() === 200, 'status=' + hR.status());
      C.push('c-help-once', 'c-help-http');
      const hBiz = await parseBiz(hR);
      assert('c-help-biz', hBiz.biz && String(hBiz.biz.code) === '0', String(hBiz.raw).slice(0, 120));
      C.push('c-help-biz');
      await settle(memPage, 1000);
      await shot(memPage, 'c-rescue-submit', { expectPath: 'rescue', journeyId: 'C', scenarioId: 'c-submit', actorRole: 'member', assertionId: 'c-help-http' });
      await memPage.goto(pageUrl('/page/front/my_rescue.html'), { waitUntil: 'load' });
      await settle(memPage, 1000);
      const mine = await memPage.locator('main,body').first().innerText();
      assert('c-my-rescue', mine.indexOf(rescueTitle) >= 0 && !/加载失败|暂时无法加载/.test(mine), mine.slice(0, 160));
      C.push('c-my-rescue');
      const mineApi = await memPage.request.get(pageUrl('/api/help/mine?pageNum=1&pageSize=20'));
      const mj = await mineApi.json();
      const mrecs = (mj.data && mj.data.records) || [];
      const hit = mrecs.find((r) => String(r.title) === rescueTitle);
      assert('c-help-id', !!hit && hit.id != null, 'title');
      created.helpId = hit ? String(hit.id) : null;
      created.helpVersion = hit && hit.version != null ? Number(hit.version) : 0;
      C.push('c-help-id');
      backfillUiWrite({
        journeyId: 'C', scenarioId: 'c-submit', actorRole: 'member', method: 'POST',
        pathname: '/api/help', responseStatus: hR.status(), businessCode: hBiz.biz && hBiz.biz.code,
        entityId: created.helpId, requestCount: 1, postconditionVerified: true, source: 'DOM'
      });
      noteLife({ journeyId: 'C', actor: 'member', method: 'POST', pathname: '/api/help', createdEntityType: 'help', createdEntityId: created.helpId, cleanupAction: 'manage status=3' });

      const adminCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const adminPage = await adminCtx.newPage();
      await wirePage(adminPage, 'admin');
      await realLogin(adminPage, ADMIN_USER, ADMIN_PASS, 'c-admin');
      await adminPage.goto(pageUrl('/page/end/help.html'), { waitUntil: 'load' });
      await settle(adminPage, 1200);
      const hrow = adminPage.locator('tr, article, .admin-help-card').filter({ hasText: rescueTitle.slice(0, 24) }).first();
      assert('c-admin-row', await hrow.count() > 0, 'no help row');
      C.push('c-admin-row');
      await shot(adminPage, 'c-admin-help-list', { expectPath: '/page/end/help.html', journeyId: 'C', scenarioId: 'c-list', actorRole: 'admin', entityId: created.helpId, assertionId: 'c-admin-row' });
      const mbtn = hrow.locator('button:has-text("处理")').first();
      assert('c-manage-btn', await mbtn.count() > 0, 'no manage');
      C.push('c-manage-btn');
      await mbtn.click();
      await settle(adminPage, 500);
      await adminPage.selectOption('#managerStatus', '1');
      await adminPage.fill('#managerRemark', testMarker + ' 处理中');
      const mW = adminPage.waitForResponse((r) => /\/api\/help\/\d+\/manage$/.test(new URL(r.url()).pathname) && r.request().method() === 'PUT', { timeout: 20000 });
      await adminPage.locator('button[type="submit"]').filter({ hasText: /保存/ }).first().click();
      const mR = await mW;
      assert('c-manage-http', mR.status() === 200, 'status=' + mR.status());
      C.push('c-manage-http');
      const mBiz = await parseBiz(mR);
      assert('c-manage-biz', mBiz.biz && String(mBiz.biz.code) === '0', String(mBiz.raw).slice(0, 120));
      C.push('c-manage-biz');
      backfillUiWrite({
        journeyId: 'C', scenarioId: 'c-manage', actorRole: 'admin', method: 'PUT',
        pathname: '/api/help/' + created.helpId + '/manage',
        pathnameRe: /\/api\/help\/\d+\/manage$/,
        responseStatus: mR.status(), businessCode: mBiz.biz && mBiz.biz.code,
        entityId: created.helpId, requestCount: 1, postconditionVerified: true, source: 'DOM'
      });
      noteLife({ journeyId: 'C', actor: 'admin', method: 'PUT', pathname: '/api/help/' + created.helpId + '/manage', createdEntityType: 'help_manage', createdEntityId: created.helpId, cleanupAction: 'status=3' });
      await shot(adminPage, 'c-admin-help-manage', { expectPath: '/page/end/help.html', journeyId: 'C', scenarioId: 'c-manage', actorRole: 'admin', entityId: created.helpId, assertionId: 'c-manage-http' });

      await memPage.goto(pageUrl('/page/front/my_rescue.html'), { waitUntil: 'load' });
      await settle(memPage, 800);
      const after = await memPage.locator('main,body').first().innerText();
      assert('c-user-refresh', after.indexOf(rescueTitle) >= 0, after.slice(0, 120));
      C.push('c-user-refresh');
      await memPage.goto(pageUrl('/page/front/notifications.html'), { waitUntil: 'load' });
      await settle(memPage, 800);
      const n2 = await memPage.locator('main,body').first().innerText();
      assert('c-notif-page', !/加载失败|暂时无法加载/.test(n2), n2.slice(0, 100));
      C.push('c-notif-page');
      await shot(memPage, 'c-user-notifications', { expectPath: 'notifications', journeyId: 'C', scenarioId: 'c-notif', actorRole: 'member', entityId: created.helpId, assertionId: 'c-notif-page' });

      journeyDone('C-rescue-manage-notify', C);
      await memCtx.close();
      await adminCtx.close();
    }

    // ========== Journey D: dedicated volunteer apply + task signup ==========
    const D = [];
    {
      const memCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      const memPage = await memCtx.newPage();
      await wirePage(memPage, 'member');
      await realLogin(memPage, memberUser, memberPass, 'd-member');

      await memPage.goto(pageUrl('/page/front/volunteer_apply.html'), { waitUntil: 'load' });
      await settle(memPage, 1000);
      // Must be able to submit form — dedicated user has no prior application
      const age = memPage.locator('#volunteerAge');
      assert('d-form-available', await age.count() > 0 && await age.isEnabled(), 'form blocked for clean user');
      D.push('d-form-available');
      await age.fill('25');
      await memPage.fill('#volunteerWechat', ('wx' + suffix.toLowerCase()).slice(0, 20));
      await memPage.fill('#volunteerCompany', 'E2E测试单位');
      await memPage.fill('#volunteerLocation', testMarker + ' 居地');
      await memPage.selectOption('#volunteerTime', '1');
      await memPage.locator('input[type="radio"][value="0"]').first().check({ force: true });
      await memPage.fill('#volunteerAbility', volAbility);
      // no Vue injection — if model not bound, POST will not fire and we FAIL
      const subVol = memPage.locator('button[type="submit"]').filter({ hasText: /提交义工申请|重试保存/ }).first();
      assert('d-vol-submit-enabled', await subVol.isEnabled(), 'submit disabled');
      D.push('d-vol-submit-enabled');
      const vW = memPage.waitForResponse((r) => {
        try {
          const u = new URL(r.url());
          return u.pathname === '/api/volunteer' && r.request().method() === 'POST';
        } catch (e) { return false; }
      }, { timeout: 20000 });
      await subVol.click();
      const vR = await vW.catch(async (err) => {
        const t = await memPage.locator('main').innerText().catch(() => '');
        const errs = await memPage.locator('.ui-field-error, .ui-form-alert').allInnerTexts().catch(() => []);
        fail('d-vol-post-timeout', JSON.stringify({ errs, t: t.slice(0, 200) }));
        throw err;
      });
      assert('d-vol-post-http', vR.status() === 200, 'status=' + vR.status());
      let vBiz = null;
      try { vBiz = JSON.parse(await vR.text()); } catch (e) {}
      assert('d-vol-post-biz', vBiz && String(vBiz.code) === '0', JSON.stringify(vBiz));
      D.push('d-vol-post-http', 'd-vol-post-biz');
      await settle(memPage, 1000);
      await memPage.goto(pageUrl('/page/front/my_volunteer.html'), { waitUntil: 'load' });
      await settle(memPage, 800);
      const mv = await memPage.locator('main,body').first().innerText();
      assert('d-my-vol-pending', /待审核|审核中|申请/.test(mv) && !/加载失败/.test(mv), mv.slice(0, 160));
      D.push('d-my-vol-pending');
      await shot(memPage, 'd-volunteer-apply-pending', { expectPath: 'volunteer', journeyId: 'D', scenarioId: 'd-apply', actorRole: 'member', assertionId: 'd-my-vol-pending' });

      // match mine by ability marker / uid
      const mineV = await memPage.request.get(pageUrl('/api/volunteer/mine'));
      const mvj = await mineV.json();
      const vlist = Array.isArray(mvj.data) ? mvj.data : (mvj.data && mvj.data.records) || [];
      const vhit = vlist.find((r) => String(r.moreability || '').indexOf(testMarker) >= 0 || String(r.uid) === String(created.memberId));
      assert('d-vol-id-match', !!vhit && vhit.id != null, 'no matching application');
      created.volunteerId = vhit ? String(vhit.id) : null;
      D.push('d-vol-id-match');
      backfillUiWrite({
        journeyId: 'D', scenarioId: 'd-vol-apply', actorRole: 'member', method: 'POST',
        pathname: '/api/volunteer', responseStatus: vR.status(), businessCode: vBiz.code,
        entityId: created.volunteerId, requestCount: 1, postconditionVerified: true, source: 'DOM'
      });
      noteLife({ journeyId: 'D', actor: 'member', method: 'POST', pathname: '/api/volunteer', createdEntityType: 'volunteer', createdEntityId: created.volunteerId, cleanupAction: 'retain audit' });

      // Admin audit DOM
      const adminCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const adminPage = await adminCtx.newPage();
      await wirePage(adminPage, 'admin');
      await realLogin(adminPage, ADMIN_USER, ADMIN_PASS, 'd-admin');
      await adminPage.goto(pageUrl('/page/end/volunteer.html'), { waitUntil: 'load' });
      await settle(adminPage, 1200);
      // locate by ability text or id
      const vrow = adminPage.locator('tr, article, .admin-card').filter({ hasText: new RegExp(created.volunteerId + '|' + testMarker.slice(0, 12)) }).first();
      // fallback search by username
      let rowLoc = vrow;
      if (!(await rowLoc.count())) {
        rowLoc = adminPage.locator('tr, article').filter({ hasText: memberUser }).first();
      }
      assert('d-admin-vol-row', await rowLoc.count() > 0, 'cannot locate application ' + created.volunteerId);
      D.push('d-admin-vol-row');
      await shot(adminPage, 'd-admin-volunteer-locate', { expectPath: '/page/end/volunteer.html', journeyId: 'D', scenarioId: 'd-locate', actorRole: 'admin', entityId: created.volunteerId, assertionId: 'd-admin-vol-row' });
      const auditBtn = rowLoc.locator('button:has-text("审核")').first();
      assert('d-audit-btn', await auditBtn.count() > 0, 'no audit btn');
      D.push('d-audit-btn');
      await auditBtn.click();
      await settle(adminPage, 500);
      // select approved state if select exists
      const st = adminPage.locator('select').filter({ has: adminPage.locator('option') }).first();
      if (await st.count()) {
        await st.selectOption({ label: '通过' }).catch(async () => {
          await st.selectOption('1').catch(() => {});
        });
      }
      // radio/options for state 1
      const passOpt = adminPage.locator('input[type="radio"][value="1"], option[value="1"]').first();
      if (await passOpt.count()) await passOpt.click().catch(() => {});
      const ack = adminPage.locator('input[type="checkbox"]').first();
      if (await ack.count()) await ack.check().catch(() => ack.click());
      const aW = adminPage.waitForResponse((r) => /\/api\/volunteer\/\d+\/state\/1$/.test(new URL(r.url()).pathname) && r.request().method() === 'PUT', { timeout: 20000 });
      await adminPage.locator('button:has-text("确认变更状态"), button:has-text("确认")').filter({ hasText: /确认/ }).first().click();
      const aR = await aW.catch(() => null);
      // if DOM didn't hit exact path, fail — no API fallback
      assert('d-audit-http', !!aR && aR.status() === 200, aR ? 'status=' + aR.status() : 'no PUT /state/1 from DOM');
      D.push('d-audit-http');
      let auditBiz = null;
      if (aR) {
        try { auditBiz = JSON.parse(await aR.text()); } catch (e) {}
      }
      assert('d-audit-biz', auditBiz && String(auditBiz.code) === '0', JSON.stringify(auditBiz));
      D.push('d-audit-biz');
      backfillUiWrite({
        journeyId: 'D', scenarioId: 'd-audit', actorRole: 'admin', method: 'PUT',
        pathname: '/api/volunteer/' + created.volunteerId + '/state/1',
        pathnameRe: /\/api\/volunteer\/\d+\/state\/1$/,
        responseStatus: aR.status(), businessCode: auditBiz.code,
        entityId: created.volunteerId, requestCount: 1, postconditionVerified: true, source: 'DOM'
      });
      noteLife({ journeyId: 'D', actor: 'admin', method: 'PUT', pathname: '/api/volunteer/' + created.volunteerId + '/state/1', createdEntityType: 'volunteer_audit', createdEntityId: created.volunteerId, cleanupAction: 'retain' });
      await shot(adminPage, 'd-admin-volunteer-audited', { expectPath: '/page/end/volunteer.html', journeyId: 'D', scenarioId: 'd-audit', actorRole: 'admin', entityId: created.volunteerId, assertionId: 'd-audit-http' });

      // Create task via operations DOM
      await adminPage.goto(pageUrl('/page/end/operations.html'), { waitUntil: 'load' });
      await settle(adminPage, 1200);
      // open 义工任务 tab
      const tasksTab = adminPage.locator('button, [role="tab"]').filter({ hasText: '义工任务' }).first();
      assert('d-ops-tasks-tab', await tasksTab.count() > 0, 'no tasks tab');
      D.push('d-ops-tasks-tab');
      await tasksTab.click();
      await settle(adminPage, 600);
      // expand create panel if collapsed
      const expand = adminPage.locator('button').filter({ hasText: /创建义工任务|收起创建面板/ }).first();
      if (await expand.count()) {
        const label = await expand.innerText();
        if (/创建义工任务/.test(label)) await expand.click();
        await settle(adminPage, 400);
      }
      const startLocal = new Date(Date.now() + 2 * 3600e3);
      const endLocal = new Date(Date.now() + 5 * 3600e3);
      const toLocal = (d) => {
        const p = (n) => String(n).padStart(2, '0');
        return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes());
      };
      const formRoot = adminPage.locator('#opsTaskCompose form.ops-form, aside#opsTaskCompose form').first();
      assert('d-task-form', await formRoot.count() > 0, 'no create task form');
      D.push('d-task-form');
      // Playwright-only fills (no __vue__ injection). force:true only if CSS collapse — must still be editable.
      await formRoot.locator('input').nth(0).fill(taskTitle, { force: true });
      await formRoot.locator('input').nth(1).fill('南区犬舍', { force: true });
      await formRoot.locator('input[type="datetime-local"]').nth(0).fill(toLocal(startLocal), { force: true });
      await formRoot.locator('input[type="datetime-local"]').nth(1).fill(toLocal(endLocal), { force: true });
      const cap = formRoot.locator('input[type="number"]').first();
      if (await cap.count()) await cap.fill('5', { force: true });
      const tdesc = formRoot.locator('textarea').first();
      if (await tdesc.count()) await tdesc.fill(testMarker + ' task desc', { force: true });
      const tW = adminPage.waitForResponse((r) => {
        try {
          return new URL(r.url()).pathname === '/api/operations/admin/volunteer-tasks' && r.request().method() === 'POST';
        } catch (e) { return false; }
      }, { timeout: 20000 });
      await formRoot.locator('button[type="submit"]').filter({ hasText: /创建任务/ }).click();
      const tR = await tW.catch(async (err) => {
        const errs = await adminPage.locator('.ops-state, .ui-form-alert, .ops-inline-status').allInnerTexts().catch(() => []);
        fail('d-task-create-timeout', JSON.stringify(errs).slice(0, 200));
        throw err;
      });
      assert('d-task-create-http', tR.status() === 200, 'status=' + tR.status());
      let tBiz = null;
      try { tBiz = JSON.parse(await tR.text()); } catch (e) {}
      assert('d-task-create-biz', tBiz && String(tBiz.code) === '0', JSON.stringify(tBiz));
      if (tBiz && tBiz.data != null) created.taskId = String(tBiz.data);
      D.push('d-task-create-http', 'd-task-create-biz');
      assert('d-task-id', !!created.taskId && /^[1-9][0-9]*$/.test(created.taskId), 'id=' + created.taskId);
      D.push('d-task-id');
      backfillUiWrite({
        journeyId: 'D', scenarioId: 'd-task-create', actorRole: 'admin', method: 'POST',
        pathname: '/api/operations/admin/volunteer-tasks', responseStatus: tR.status(), businessCode: tBiz.code,
        entityId: created.taskId, requestCount: 1, postconditionVerified: true, source: 'DOM'
      });
      noteLife({ journeyId: 'D', actor: 'admin', method: 'POST', pathname: '/api/operations/admin/volunteer-tasks', createdEntityType: 'volunteer_task', createdEntityId: created.taskId, cleanupAction: 'status 2/3 + version' });
      created.taskVersion = 0;
      await settle(adminPage, 800);

      // Member signup on exact task card
      await memPage.goto(pageUrl('/page/front/volunteer_tasks.html'), { waitUntil: 'load' });
      await settle(memPage, 1200);
      // switch to open tasks tab if needed
      const openTab = memPage.locator('[data-tab-open], button:has-text("开放任务")').first();
      if (await openTab.count()) await openTab.click();
      await settle(memPage, 600);
      const card = memPage.locator('article, .ui-task-card, .ui-record-card, li, section').filter({ hasText: taskTitle }).first();
      assert('d-task-card', await card.count() > 0, 'card missing for ' + taskTitle);
      D.push('d-task-card');
      await card.scrollIntoViewIfNeeded();
      await settle(memPage, 300);
      const beforeText = await card.innerText();
      assert('d-task-before-not-signed', /报名任务/.test(beforeText) && /0\s*\/\s*5|0\s*\/\s*\d+/.test(beforeText), beforeText.slice(0, 200));
      D.push('d-task-before-not-signed');
      await shotCard(memPage, 'd-task-before-signup', card, {
        expectPath: 'volunteer_tasks', journeyId: 'D', scenarioId: 'd-before', actorRole: 'member',
        entityId: created.taskId, stateSelector: 'task card ' + taskTitle, assertionId: 'd-task-before-not-signed'
      });

      const signupPath = '/api/operations/volunteer-tasks/' + created.taskId + '/signup';
      let signupN = 0;
      const sCnt = (req) => {
        try {
          if (req.method() === 'POST' && new URL(req.url()).pathname === signupPath) signupN += 1;
        } catch (e) {}
      };
      memPage.on('request', sCnt);
      const sBtn = card.locator('button:has-text("报名任务"), button[data-signup-task]').first();
      assert('d-signup-btn', await sBtn.count() > 0 && await sBtn.isEnabled(), 'signup btn');
      D.push('d-signup-btn');
      const sW = memPage.waitForResponse((r) => {
        try {
          return new URL(r.url()).pathname === signupPath && r.request().method() === 'POST';
        } catch (e) { return false; }
      }, { timeout: 20000 });
      await sBtn.click();
      const sR = await sW;
      memPage.off('request', sCnt);
      assert('d-signup-once', signupN === 1, 'posts=' + signupN + ' path=' + signupPath);
      assert('d-signup-http', sR.status() === 200, 'status=' + sR.status());
      let sBiz = null;
      try { sBiz = JSON.parse(await sR.text()); } catch (e) {}
      assert('d-signup-biz', sBiz && String(sBiz.code) === '0', JSON.stringify(sBiz));
      D.push('d-signup-once', 'd-signup-http', 'd-signup-biz');
      if (sBiz && sBiz.data != null) created.signupId = String(sBiz.data);
      backfillUiWrite({
        journeyId: 'D', scenarioId: 'd-signup', actorRole: 'member', method: 'POST',
        pathname: signupPath, responseStatus: sR.status(), businessCode: sBiz.code,
        entityId: created.signupId || created.taskId, requestCount: 1, postconditionVerified: false, source: 'DOM'
      });
      noteLife({ journeyId: 'D', actor: 'member', method: 'POST', pathname: signupPath, createdEntityType: 'volunteer_signup', createdEntityId: created.signupId || created.taskId, cleanupAction: 'DELETE signup withdraw' });

      await settle(memPage, 800);
      await memPage.reload({ waitUntil: 'load' });
      await settle(memPage, 800);
      if (await openTab.count()) await openTab.click().catch(() => {});
      await settle(memPage, 500);
      const card2 = memPage.locator('article, .ui-task-card, .ui-record-card, li, section').filter({ hasText: taskTitle }).first();
      assert('d-task-card-after', await card2.count() > 0, 'card gone');
      await card2.scrollIntoViewIfNeeded();
      await settle(memPage, 300);
      const afterText = await card2.innerText();
      assert('d-signup-ui', (/待确认|已报名|撤回/.test(afterText) && /1\s*\/\s*5|1\s*\/\s*\d+/.test(afterText)) || /撤回报名/.test(afterText), afterText.slice(0, 220));
      D.push('d-task-card-after', 'd-signup-ui');
      await shotCard(memPage, 'd-task-after-signup', card2, {
        expectPath: 'volunteer_tasks', journeyId: 'D', scenarioId: 'd-after', actorRole: 'member',
        entityId: created.taskId, stateSelector: 'task card after signup', assertionId: 'd-signup-ui'
      });
      // SHA256 must differ
      const beforeShot = result.screenshots.find((s) => s.name === 'd-task-before-signup');
      const afterShot = result.screenshots.find((s) => s.name === 'd-task-after-signup');
      assert('d-shot-hash-diff', beforeShot && afterShot && beforeShot.sha256 && afterShot.sha256 && beforeShot.sha256 !== afterShot.sha256,
        'before=' + (beforeShot && beforeShot.sha256) + ' after=' + (afterShot && afterShot.sha256));
      D.push('d-shot-hash-diff');
      backfillUiWrite({
        journeyId: 'D', scenarioId: 'd-signup', actorRole: 'member', method: 'POST',
        pathname: signupPath, responseStatus: sR.status(), businessCode: sBiz.code,
        entityId: created.signupId || created.taskId, requestCount: 1, postconditionVerified: true, source: 'DOM'
      });

      // Admin: 报名管理 panel must show member in visible DOM
      await adminPage.goto(pageUrl('/page/end/operations.html'), { waitUntil: 'load' });
      await settle(adminPage, 1000);
      const tasksTab2 = adminPage.locator('button, [role="tab"]').filter({ hasText: '义工任务' }).first();
      if (await tasksTab2.count()) await tasksTab2.click();
      await settle(adminPage, 800);
      const tcard = adminPage.locator('article.ops-card').filter({ hasText: taskTitle }).first();
      assert('d-admin-task-row', await tcard.count() > 0, 'admin task card missing');
      D.push('d-admin-task-row');
      await tcard.scrollIntoViewIfNeeded();
      const manageBtn = tcard.locator('button:has-text("报名管理")').first();
      assert('d-admin-manage-btn', await manageBtn.count() > 0 && await manageBtn.isVisible(), '报名管理 missing');
      D.push('d-admin-manage-btn');
      await manageBtn.click();
      await settle(adminPage, 1000);
      const signupPanel = adminPage.locator('.ops-signups').first();
      assert('d-admin-signup-panel', await signupPanel.count() > 0 && await signupPanel.isVisible(), 'panel not open');
      D.push('d-admin-signup-panel');
      await signupPanel.scrollIntoViewIfNeeded();
      const panelText = await signupPanel.innerText();
      const seesMember = panelText.indexOf(memberUser) >= 0;
      const seesUserId = panelText.indexOf(String(created.memberId)) >= 0 || panelText.indexOf('#' + created.memberId) >= 0;
      const seesTaskCtx = panelText.indexOf(taskTitle) >= 0 || panelText.indexOf(String(created.taskId)) >= 0;
      assert('d-admin-sees-member', seesMember === true, panelText.slice(0, 240));
      assert('d-admin-sees-userid', seesUserId === true, panelText.slice(0, 240));
      assert('d-admin-sees-task-ctx', seesTaskCtx === true, panelText.slice(0, 240));
      D.push('d-admin-sees-member', 'd-admin-sees-userid', 'd-admin-sees-task-ctx');
      await shotCard(adminPage, 'd-admin-signup-list', signupPanel, {
        expectPath: '/page/end/operations.html', journeyId: 'D', scenarioId: 'd-admin-list', actorRole: 'admin',
        entityId: created.signupId || created.taskId, assertionId: 'd-admin-sees-member'
      });
      // GET only as second verification
      const signups = await adminPage.request.get(pageUrl('/api/operations/admin/volunteer-tasks/' + created.taskId + '/signups'));
      const sj = await signups.json();
      const srows = Array.isArray(sj.data) ? sj.data : (sj.data && sj.data.records) || [];
      const mineRows = (Array.isArray(srows) ? srows : []).filter((r) => String(r.user_id || r.uid || r.userId) === String(created.memberId));
      assert('d-signup-db-one', mineRows.length === 1, 'rows=' + mineRows.length);
      if (mineRows[0] && mineRows[0].id != null) created.signupId = String(mineRows[0].id);
      D.push('d-signup-db-one');

      journeyDone('D-volunteer-task-signup', D);
      await memCtx.close();
      await adminCtx.close();
    }

    // ========== Journey E: notice + account DOM ==========
    const E = [];
    {
      const adminCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const adminPage = await adminCtx.newPage();
      await wirePage(adminPage, 'admin');
      await realLogin(adminPage, ADMIN_USER, ADMIN_PASS, 'e-admin');
      await adminPage.goto(pageUrl('/page/end/notice.html'), { waitUntil: 'load' });
      await settle(adminPage, 1200);
      const nCreate = adminPage.locator('button').filter({ hasText: '发布公告' }).first();
      assert('e-notice-create-btn-pre', await nCreate.count() > 0 && await nCreate.isVisible(), '发布公告 missing');
      await nCreate.click();
      await adminPage.waitForSelector('#noticeTitleInput', { timeout: 15000 });
      assert('e-notice-create-btn', await adminPage.locator('#noticeTitleInput').isVisible(), 'title input');
      E.push('e-notice-create-btn');
      await adminPage.fill('#noticeTitleInput', noticeTitle);
      await adminPage.fill('#noticeContentInput', testMarker + ' 公告正文');
      const nW = adminPage.waitForResponse((r) => { try { return new URL(r.url()).pathname === '/api/notice' && r.request().method() === 'POST'; } catch (e) { return false; } }, { timeout: 20000 });
      await adminPage.locator('button').filter({ hasText: /保存/ }).first().click();
      const nR = await nW;
      assert('e-notice-post', nR.status() === 200, 'status=' + nR.status());
      E.push('e-notice-post');
      const nBiz = await parseBiz(nR);
      assert('e-notice-biz', nBiz.biz && String(nBiz.biz.code) === '0', String(nBiz.raw).slice(0, 120));
      E.push('e-notice-biz');
      await settle(adminPage, 800);
      const nl = await adminPage.request.get(pageUrl('/api/notice/page?pageNum=1&pageSize=30'));
      const nj = await nl.json();
      const nrecs = (nj.data && nj.data.records) || [];
      const nhit = nrecs.find((r) => String(r.title) === noticeTitle);
      assert('e-notice-id', !!nhit, 'not found');
      created.noticeId = nhit ? String(nhit.id) : null;
      E.push('e-notice-id');
      backfillUiWrite({
        journeyId: 'E', scenarioId: 'e-notice', actorRole: 'admin', method: 'POST',
        pathname: '/api/notice', responseStatus: nR.status(), businessCode: nBiz.biz && nBiz.biz.code,
        entityId: created.noticeId, requestCount: 1, postconditionVerified: true, source: 'DOM'
      });
      noteLife({ journeyId: 'E', actor: 'admin', method: 'POST', pathname: '/api/notice', createdEntityType: 'notice', createdEntityId: created.noticeId, cleanupAction: 'DELETE' });

      await adminPage.goto(pageUrl('/page/end/account.html'), { waitUntil: 'load' });
      await settle(adminPage, 1200);
      const aCreate = adminPage.locator('button').filter({ hasText: /新增流水|新增记录|新增|新建/ }).first();
      if (await aCreate.count() && await aCreate.isVisible().catch(() => false)) {
        await aCreate.click();
      } else {
        const alt = adminPage.locator('.admin-toolbar button, header button, .ui-panel-head button').first();
        assert('e-account-create-btn', await alt.count() > 0, 'no create control');
        await alt.click();
      }
      await settle(adminPage, 500);
      await adminPage.waitForSelector('#accountLabel', { timeout: 15000 });
      assert('e-account-create-btn', await adminPage.locator('#accountLabel').isVisible(), 'label input');
      E.push('e-account-create-btn');
      await adminPage.fill('#accountLabel', testMarker.slice(0, 40));
      await adminPage.fill('#accountValue', '1.00');
      const aW = adminPage.waitForResponse((r) => { try { return new URL(r.url()).pathname === '/api/account' && r.request().method() === 'POST'; } catch (e) { return false; } }, { timeout: 20000 });
      await adminPage.locator('button').filter({ hasText: /保存/ }).first().click();
      const aR = await aW;
      assert('e-account-post', aR.status() === 200, 'status=' + aR.status());
      E.push('e-account-post');
      const accBiz = await parseBiz(aR);
      assert('e-account-biz', accBiz.biz && String(accBiz.biz.code) === '0', String(accBiz.raw).slice(0, 120));
      E.push('e-account-biz');
      await settle(adminPage, 800);
      const al = await adminPage.request.get(pageUrl('/api/account/page?pageNum=1&pageSize=30'));
      const aj = await al.json();
      const arecs = (aj.data && aj.data.records) || [];
      const ahit = arecs.find((r) => String(r.alabel || '').indexOf(testMarker.slice(0, 12)) >= 0);
      assert('e-account-id', !!ahit, 'not found');
      created.accountId = ahit ? String(ahit.id) : null;
      E.push('e-account-id');
      backfillUiWrite({
        journeyId: 'E', scenarioId: 'e-account', actorRole: 'admin', method: 'POST',
        pathname: '/api/account', responseStatus: aR.status(), businessCode: accBiz.biz && accBiz.biz.code,
        entityId: created.accountId, requestCount: 1, postconditionVerified: true, source: 'DOM'
      });
      noteLife({ journeyId: 'E', actor: 'admin', method: 'POST', pathname: '/api/account', createdEntityType: 'account', createdEntityId: created.accountId, cleanupAction: 'REVERSE only' });

      // reverse via DOM if button exists
      const arow = adminPage.locator('tr, article').filter({ hasText: testMarker.slice(0, 12) }).first();
      const revBtn = arow.locator('button:has-text("冲正")').first();
      assert('e-reverse-btn', await revBtn.count() > 0, 'no reverse button — product gap');
      E.push('e-reverse-btn');
      await revBtn.click();
      await settle(adminPage, 400);
      const revReason = adminPage.locator('textarea, input').filter({ hasText: '' }).first();
      // fill reason field if present
      const reasonBox = adminPage.locator('textarea').last();
      if (await reasonBox.count()) await reasonBox.fill(testMarker + ' reverse');
      const rW = adminPage.waitForResponse((r) => /\/api\/account\/\d+\/reverse$/.test(new URL(r.url()).pathname) && r.request().method() === 'POST', { timeout: 20000 });
      await adminPage.locator('button').filter({ hasText: /确认|冲正|保存/ }).last().click();
      const rR = await rW;
      assert('e-reverse-http', rR.status() === 200, 'status=' + rR.status());
      E.push('e-reverse-http');
      const revBiz = await parseBiz(rR);
      assert('e-reverse-biz', revBiz.biz && String(revBiz.biz.code) === '0', String(revBiz.raw).slice(0, 120));
      E.push('e-reverse-biz');
      backfillUiWrite({
        journeyId: 'E', scenarioId: 'e-reverse', actorRole: 'admin', method: 'POST',
        pathname: '/api/account/' + created.accountId + '/reverse',
        pathnameRe: /\/api\/account\/\d+\/reverse$/,
        responseStatus: rR.status(), businessCode: revBiz.biz && revBiz.biz.code,
        entityId: created.accountId, requestCount: 1, postconditionVerified: true, source: 'DOM'
      });
      noteLife({ journeyId: 'E', actor: 'admin', method: 'POST', pathname: '/api/account/' + created.accountId + '/reverse', createdEntityType: 'account_reverse', createdEntityId: created.accountId, cleanupAction: 'retain audit' });

      const pub = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      const pubPage = await pub.newPage();
      await wirePage(pubPage, 'anon');
      await pubPage.goto(pageUrl('/page/front/notice_list.html'), { waitUntil: 'load' });
      await settle(pubPage, 800);
      const nlist = await pubPage.locator('main,body').first().innerText();
      assert('e-public-notice', nlist.indexOf(noticeTitle) >= 0, nlist.slice(0, 120));
      E.push('e-public-notice');
      await shot(pubPage, 'e-public-notice', { expectPath: 'notice_list', journeyId: 'E', scenarioId: 'e-public', actorRole: 'anon', entityId: created.noticeId, assertionId: 'e-public-notice' });
      await pub.close();

      // delete notice DOM
      await adminPage.goto(pageUrl('/page/end/notice.html'), { waitUntil: 'load' });
      await settle(adminPage, 800);
      const nrow = adminPage.locator('tr, article').filter({ hasText: noticeTitle }).first();
      assert('e-notice-row-del', await nrow.count() > 0, 'row');
      E.push('e-notice-row-del');
      const delBtn = nrow.locator('button:has-text("删除")').first();
      assert('e-notice-del-btn', await delBtn.count() > 0, 'btn');
      E.push('e-notice-del-btn');
      await delBtn.click();
      await settle(adminPage, 300);
      const dW = adminPage.waitForResponse((r) => /\/api\/notice\/\d+$/.test(new URL(r.url()).pathname) && r.request().method() === 'DELETE', { timeout: 15000 });
      await adminPage.locator('button:has-text("确认删除"), button:has-text("确认")').first().click();
      const dR = await dW;
      assert('e-notice-del-http', dR.status() === 200, 'status=' + dR.status());
      E.push('e-notice-del-http');
      const delBiz = await parseBiz(dR);
      assert('e-notice-del-biz', delBiz.biz && String(delBiz.biz.code) === '0', String(delBiz.raw).slice(0, 120));
      E.push('e-notice-del-biz');
      backfillUiWrite({
        journeyId: 'E', scenarioId: 'e-notice-del', actorRole: 'admin', method: 'DELETE',
        pathname: '/api/notice/' + created.noticeId,
        pathnameRe: /\/api\/notice\/\d+$/,
        responseStatus: dR.status(), businessCode: delBiz.biz && delBiz.biz.code,
        entityId: created.noticeId, requestCount: 1, postconditionVerified: true, source: 'DOM'
      });
      noteLife({ journeyId: 'E', actor: 'admin', method: 'DELETE', pathname: '/api/notice/' + created.noticeId, createdEntityType: 'notice_delete', createdEntityId: created.noticeId, cleanupAction: 'done' });

      journeyDone('E-notice-account-public', E);
      await adminCtx.close();
    }

    // ========== Journey F ==========
    const F = [];
    {
      const memCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      const memPage = await memCtx.newPage();
      await wirePage(memPage, 'member');
      await realLogin(memPage, memberUser, memberPass, 'f-member');
      await memPage.goto(pageUrl('/page/front/pet_care.html'), { waitUntil: 'load' });
      await settle(memPage, 1000);
      const cfg = await memPage.request.get(pageUrl('/api/petcare/config'));
      assert('f-cfg-http', cfg.status() === 200, 'status=' + cfg.status());
      const raw = await cfg.text();
      assert('f-no-key', !/sk-[a-zA-Z0-9]{16,}/.test(raw) && !/"apiKey"\s*:\s*"[^"*]{8,}"/.test(raw), 'leak');
      F.push('f-cfg-http', 'f-no-key');
      assert('f-no-real-ai', !ALLOW_REAL_AI, 'ai off');
      F.push('f-no-real-ai');
      await shot(memPage, 'f-agent-state', { expectPath: 'pet_care', journeyId: 'F', scenarioId: 'f', actorRole: 'member', assertionId: 'f-no-key' });
      journeyDone('F-agent-isolation', F);
      await memCtx.close();
    }

    // ========== Journey G permission (phaseMode=permission) ==========
    phaseMode = 'permission';
    const G = [];
    {
      async function probe(role, page, method, p, expectFn) {
        let res;
        if (method === 'GET') res = await page.request.get(pageUrl(p));
        else if (method === 'POST') res = await page.request.post(pageUrl(p), { data: {} });
        else if (method === 'PUT') res = await page.request.put(pageUrl(p), { data: {} });
        else res = await page.request.delete(pageUrl(p));
        const status = res.status();
        let code = null;
        try { code = String((await res.json()).code); } catch (e) {}
        const ok = expectFn(status, code);
        result.authMatrix.push({ role, method, path: p, status, code, ok, at: new Date().toISOString() });
        return ok;
      }
      const anonCtx = await browser.newContext();
      const anon = await anonCtx.newPage();
      await wirePage(anon, 'anon');
      const memCtx = await browser.newContext();
      const mem = await memCtx.newPage();
      await wirePage(mem, 'member');
      phaseMode = 'journey';
      await realLogin(mem, memberUser, memberPass, 'g-member');
      phaseMode = 'permission';
      const admCtx = await browser.newContext();
      const adm = await admCtx.newPage();
      await wirePage(adm, 'admin');
      phaseMode = 'journey';
      await realLogin(adm, ADMIN_USER, ADMIN_PASS, 'g-admin');
      phaseMode = 'permission';

      assert('g-anon-fav', await probe('anon', anon, 'GET', '/api/operations/favorites', (s, c) => s === 401 || c === '401'), 'anon');
      assert('g-member-help-all', await probe('member', mem, 'GET', '/api/help?pageNum=1&pageSize=1', (s, c) => s === 403 || c === '403'), 'member');
      assert('g-admin-animal', await probe('admin', adm, 'GET', '/api/animal/page?pageNum=1&pageSize=1', (s, c) => s === 200), 'admin');
      assert('g-bad-id', await probe('member', mem, 'GET', '/api/animal/not-a-number', (s) => s !== 500), 'bad');
      G.push('g-anon-fav', 'g-member-help-all', 'g-admin-animal', 'g-bad-id');
      journeyDone('G-permission-matrix', G);
      await anonCtx.close();
      await memCtx.close();
      await admCtx.close();
    }

    // ========== Journey H ==========
    phaseMode = 'journey';
    const H = [];
    {
      const memCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      const memPage = await memCtx.newPage();
      await wirePage(memPage, 'member');
      await realLogin(memPage, memberUser, memberPass, 'h-member');
      assert('h-has-animal', !!created.animalId, 'animal');
      H.push('h-has-animal');
      await memPage.goto(pageUrl('/page/front/animal_detail.html?id=' + created.animalId), { waitUntil: 'load' });
      await settle(memPage, 800);
      const favPath = '/api/operations/favorites/' + created.animalId;
      let posts = 0;
      memPage.on('request', (req) => { if (req.method() === 'POST' && req.url().indexOf(favPath) >= 0) posts += 1; });
      const btn = memPage.locator('button:has-text("收藏"), button:has-text("已收藏")').first();
      // ensure unfavorited for clean double-click favorite
      if (/已收藏/.test(await btn.innerText())) {
        const ufW = memPage.waitForResponse((r) => r.url().indexOf(favPath) >= 0 && r.request().method() === 'DELETE', { timeout: 15000 }).catch(() => null);
        await btn.click();
        const ufR = await ufW;
        if (ufR) {
          const ufBiz = await parseBiz(ufR);
          backfillUiWrite({
            journeyId: 'H', scenarioId: 'h-unfav-preclear', actorRole: 'member', method: 'DELETE',
            pathname: favPath, responseStatus: ufR.status(), businessCode: ufBiz.biz ? ufBiz.biz.code : ufR.status(),
            entityId: created.animalId, requestCount: 1, postconditionVerified: true, source: 'DOM'
          });
        }
        await settle(memPage, 500);
      }
      posts = 0;
      // Capture POST and any accidental DELETE from rapid re-click (UI may flip to 已收藏).
      const favW = memPage.waitForResponse((r) => r.url().indexOf(favPath) >= 0 && r.request().method() === 'POST', { timeout: 15000 }).catch(() => null);
      const delAccidental = memPage.waitForResponse((r) => r.url().indexOf(favPath) >= 0 && r.request().method() === 'DELETE', { timeout: 15000 }).catch(() => null);
      // double-click burst for idempotency: count POST network calls, not UI toggles
      await Promise.all([
        btn.click(),
        btn.click({ force: true }).catch(() => {})
      ]);
      const favR = await favW;
      const delR = await delAccidental;
      await settle(memPage, 800);
      assert('h-fav-le1', posts <= 1, 'posts=' + posts);
      H.push('h-fav-le1');
      if (favR) {
        const favResolved = await resolveWriteResult(favR, true);
        const favBiz = favResolved.biz;
        backfillUiWrite({
          journeyId: 'H', scenarioId: 'h-fav-idempotent', actorRole: 'member', method: 'POST',
          pathname: favPath, responseStatus: favR.status(), businessCode: favBiz ? favBiz.code : String(favR.status()),
          entityId: created.animalId, requestCount: Math.max(posts, 1), postconditionVerified: true, source: 'DOM'
        });
      }
      if (delR) {
        const delResolved = await resolveWriteResult(delR, true);
        backfillUiWrite({
          journeyId: 'H', scenarioId: 'h-fav-toggle-delete', actorRole: 'member', method: 'DELETE',
          pathname: favPath, responseStatus: delR.status(), businessCode: delResolved.biz ? delResolved.biz.code : String(delR.status()),
          entityId: created.animalId, requestCount: 1, postconditionVerified: true, source: 'DOM'
        });
      }
      // Ensure favorited for cleanup DELETE favorite path
      const btnAfter = await btn.innerText().catch(() => '');
      if (!/已收藏/.test(btnAfter)) {
        const reFav = memPage.waitForResponse((r) => r.url().indexOf(favPath) >= 0 && r.request().method() === 'POST', { timeout: 10000 }).catch(() => null);
        await btn.click().catch(() => {});
        const reR = await reFav;
        if (reR) {
          const reBiz = await resolveWriteResult(reR, true);
          backfillUiWrite({
            journeyId: 'H', scenarioId: 'h-fav-restore', actorRole: 'member', method: 'POST',
            pathname: favPath, responseStatus: reR.status(), businessCode: reBiz.biz ? reBiz.biz.code : String(reR.status()),
            entityId: created.animalId, requestCount: 1, postconditionVerified: true, source: 'DOM'
          });
        }
      }
      created.favoriteAnimalId = created.animalId; // may be favorited again by H
      journeyDone('H-idempotency-errors', H);
      await memCtx.close();
    }

    // ========== CLEANUP after ALL journeys including H ==========
    phaseMode = 'cleanup';
    {
      const adminCtx = await browser.newContext();
      const adminPage = await adminCtx.newPage();
      await wirePage(adminPage, 'cleanup-admin');
      phaseMode = 'journey';
      await realLogin(adminPage, ADMIN_USER, ADMIN_PASS, 'cleanup-admin');
      phaseMode = 'cleanup';
      const adminCsrf = await getCsrf(adminPage);

      const memCtx = await browser.newContext();
      const memPage = await memCtx.newPage();
      await wirePage(memPage, 'cleanup-member');
      phaseMode = 'journey';
      await realLogin(memPage, memberUser, memberPass, 'cleanup-member');
      phaseMode = 'cleanup';
      const memCsrf = await getCsrf(memPage);

      // 0 RETAIN user / volunteer (audit policy — cannot auto-delete)
      noteCleanup({
        action: 'RETAIN user', entityType: 'user', entityId: created.memberId || memberUser,
        cleanupMethod: 'none', result: 'retained', retainedForAudit: true, ok: true,
        detail: 'username=' + memberUser + ' reason=test account kept for audit; no bulk user delete'
      });
      noteCleanup({
        action: 'RETAIN volunteer', entityType: 'volunteer', entityId: created.volunteerId || 'n/a',
        cleanupMethod: 'none', result: 'retained', retainedForAudit: true, ok: true,
        detail: 'status=approved(1) reason=audit trail for signup eligibility; no auto-delete of application'
      });

      // 1 favorite
      if (created.favoriteAnimalId) {
        const del = await pageRequestWrite(memPage, 'DELETE', '/api/operations/favorites/' + created.favoriteAnimalId, { headers: csrfHeaders(memCsrf) }, { cleanup: true });
        let ok = del.status() === 200 || del.status() === 204 || del.status() === 404;
        try { const j = await del.json(); if (String(j.code) === '0') ok = true; } catch (e) {}
        const g = await memPage.request.get(pageUrl('/api/operations/favorites'));
        let gone = ok;
        try {
          const j = await g.json();
          const arr = Array.isArray(j.data) ? j.data : (j.data && j.data.records) || [];
          gone = !(Array.isArray(arr) ? arr : []).some((r) => String(r.id || r.animal_id || r.animalId) === String(created.favoriteAnimalId));
        } catch (e) {}
        noteCleanup({ action: 'DELETE favorite', entityType: 'favorite', entityId: created.favoriteAnimalId, cleanupMethod: 'DELETE favorites/{id}', result: gone ? 'ok' : 'fail', retainedForAudit: false, ok: gone, detail: 'http=' + del.status() });
      }

      // 1b withdraw signup BEFORE closing task (real session + CSRF; require HTTP200/code=0/data=true)
      if (created.taskId) {
        let beforeStatus = 0;
        try {
          const sj = await (await adminPage.request.get(pageUrl('/api/operations/admin/volunteer-tasks/' + created.taskId + '/signups'))).json();
          const rows = Array.isArray(sj.data) ? sj.data : [];
          const mine = rows.find((r) => String(r.user_id || r.uid || r.userId) === String(created.memberId));
          if (mine) {
            beforeStatus = Number(mine.status);
            if (mine.id != null) created.signupId = String(mine.id);
          }
        } catch (e) {}
        const wd = await pageRequestWrite(memPage, 'DELETE', '/api/operations/volunteer-tasks/' + created.taskId + '/signup', {
          headers: csrfHeaders(memCsrf)
        }, { cleanup: true });
        let wBiz = null;
        let wok = false;
        try {
          wBiz = await wd.json();
          // strict: HTTP 200 + code=0 + data=true
          wok = wd.status() === 200 && String(wBiz.code) === '0' && wBiz.data === true;
        } catch (e) { wok = false; }
        let afterStatus = null;
        let notActive = false;
        try {
          const sj2 = await (await adminPage.request.get(pageUrl('/api/operations/admin/volunteer-tasks/' + created.taskId + '/signups'))).json();
          const rows = Array.isArray(sj2.data) ? sj2.data : [];
          const mine = rows.find((r) =>
            String(r.user_id || r.uid || r.userId) === String(created.memberId) ||
            String(r.id) === String(created.signupId)
          );
          if (!mine) {
            notActive = true;
            afterStatus = null;
          } else {
            afterStatus = Number(mine.status);
            // status=3 withdrawn, or not in active set (0,1,2)
            notActive = afterStatus === 3 || ![0, 1, 2].includes(afterStatus);
            if (mine.id != null) created.signupId = String(mine.id);
          }
        } catch (e) { notActive = false; }
        // still-status-0 or any 400/409/500 => fail
        if (wd.status() >= 400 || afterStatus === 0) wok = false;
        const signupOk = wok && notActive;
        noteCleanup({
          action: 'WITHDRAW signup',
          entityType: 'volunteer_signup',
          entityId: created.signupId || ('task:' + created.taskId),
          taskId: created.taskId,
          userId: created.memberId,
          beforeStatus,
          afterStatus: afterStatus === null ? 'absent' : afterStatus,
          cleanupMethod: 'DELETE /api/operations/volunteer-tasks/{taskId}/signup + CSRF session',
          result: signupOk ? 'ok' : 'fail',
          retainedForAudit: false,
          ok: signupOk,
          detail: 'http=' + wd.status() + ' code=' + (wBiz && wBiz.code) + ' data=' + (wBiz && JSON.stringify(wBiz.data)) + ' before=' + beforeStatus + ' after=' + afterStatus
        });
      } else {
        noteCleanup({
          action: 'WITHDRAW signup', entityType: 'volunteer_signup', entityId: 'n/a',
          result: 'skipped-no-task', ok: false, retainedForAudit: false, detail: 'taskId missing'
        });
      }

      // 2 adopt cancel with version
      if (created.adoptAid && created.adoptUid) {
        // read current version via admin list
        let ver = 0;
        const al = await adminPage.request.get(pageUrl('/api/adopt/page?pageNum=1&pageSize=50'));
        try {
          const j = await al.json();
          const recs = (j.data && j.data.records) || [];
          const hit = recs.find((r) => String(r.aid) === String(created.adoptAid) && String(r.uid) === String(created.adoptUid));
          if (hit && hit.version != null) ver = Number(hit.version);
        } catch (e) {}
        const cancel = await pageRequestWrite(adminPage, 'POST', '/api/adopt/' + created.adoptAid + '/' + created.adoptUid + '/transition', {
          headers: csrfHeaders(adminCsrf),
          data: { action: 'CANCEL', reason: testMarker + ' cleanup cancel', expectedVersion: ver }
        }, { cleanup: true });
        let cok = cancel.status() === 200;
        try { const j = await cancel.json(); if (String(j.code) === '0' && j.data === true) cok = true; else cok = false; } catch (e) { cok = false; }
        // re-read state
        let terminal = cok;
        try {
          const j2 = await (await adminPage.request.get(pageUrl('/api/adopt/page?pageNum=1&pageSize=50'))).json();
          const recs = (j2.data && j2.data.records) || [];
          const hit = recs.find((r) => String(r.aid) === String(created.adoptAid) && String(r.uid) === String(created.adoptUid));
          if (hit) terminal = Number(hit.vstate) === 6; // CANCELLED
          if (!hit) terminal = true; // not listed
        } catch (e) {}
        noteCleanup({
          action: 'CANCEL adopt', entityType: 'adopt', entityId: created.adoptAid + ':' + created.adoptUid,
          cleanupMethod: 'POST transition CANCEL expectedVersion=' + ver, result: terminal ? 'ok' : 'fail',
          retainedForAudit: true, ok: terminal, detail: 'http=' + cancel.status() + ' ver=' + ver
        });
      }

      // 3 help close status=3 with version
      if (created.helpId) {
        let ver = created.helpVersion != null ? created.helpVersion : 0;
        try {
          const h = await adminPage.request.get(pageUrl('/api/help/' + created.helpId));
          const j = await h.json();
          if (j && j.data && j.data.version != null) ver = Number(j.data.version);
        } catch (e) {}
        const put = await pageRequestWrite(adminPage, 'PUT', '/api/help/' + created.helpId + '/manage', {
          headers: csrfHeaders(adminCsrf),
          data: { status: 3, remark: testMarker + ' close', priority: 0, outcome: 'invalid', resolutionNote: 'e2e cleanup', expectedVersion: ver }
        }, { cleanup: true });
        let ok = put.status() === 200;
        try { const j = await put.json(); if (String(j.code) === '0') ok = true; else ok = false; } catch (e) { ok = false; }
        let statusOk = false;
        try {
          const h2 = await (await adminPage.request.get(pageUrl('/api/help/' + created.helpId))).json();
          statusOk = h2 && h2.data && Number(h2.data.status) === 3;
        } catch (e) {}
        noteCleanup({
          action: 'CLOSE help', entityType: 'help', entityId: created.helpId,
          cleanupMethod: 'PUT manage status=3 expectedVersion=' + ver, result: (ok && statusOk) ? 'ok' : 'fail',
          retainedForAudit: true, ok: ok && statusOk, detail: 'http=' + put.status() + ' statusOk=' + statusOk
        });
      }

      // 4 task close status 2 with version (after signup withdrawn)
      if (created.taskId) {
        let ver = 0;
        try {
          const tl = await adminPage.request.get(pageUrl('/api/operations/admin/volunteer-tasks'));
          const j = await tl.json();
          const arr = Array.isArray(j.data) ? j.data : [];
          const hit = arr.find((r) => String(r.id) === String(created.taskId));
          if (hit && hit.version != null) ver = Number(hit.version);
        } catch (e) {}
        const put = await pageRequestWrite(adminPage, 'PUT', '/api/operations/admin/volunteer-tasks/' + created.taskId + '/status', {
          headers: csrfHeaders(adminCsrf),
          data: { status: 2, expectedVersion: ver }
        }, { cleanup: true });
        let ok = put.status() === 200;
        try { const j = await put.json(); if (String(j.code) === '0') ok = true; else ok = false; } catch (e) { ok = false; }
        let statusOk = false;
        try {
          const tl2 = await adminPage.request.get(pageUrl('/api/operations/admin/volunteer-tasks'));
          const j2 = await tl2.json();
          const arr = Array.isArray(j2.data) ? j2.data : [];
          const hit = arr.find((r) => String(r.id) === String(created.taskId));
          if (hit) statusOk = Number(hit.status) === 2 || Number(hit.status) === 3;
        } catch (e) {}
        noteCleanup({
          action: 'CLOSE task', entityType: 'volunteer_task', entityId: created.taskId,
          cleanupMethod: 'PUT status=2 expectedVersion=' + ver, result: (ok && statusOk) ? 'ok' : 'fail',
          retainedForAudit: false, ok: ok && statusOk, detail: 'http=' + put.status() + ' statusOk=' + statusOk
        });
      }

      // 5 notice already deleted in E — verify gone via isConfirmedAbsent only (no fail-open)
      if (created.noticeId) {
        let httpStatus = null;
        let j = null;
        let parseOk = false;
        let requestOk = false;
        try {
          const g = await adminPage.request.get(pageUrl('/api/notice/' + created.noticeId));
          httpStatus = g.status();
          requestOk = true;
          try {
            j = await g.json();
            parseOk = j != null && typeof j === 'object';
          } catch (e) {
            parseOk = false;
            j = null;
          }
        } catch (e) {
          requestOk = false;
          httpStatus = null;
          j = null;
        }
        const gone = requestOk && parseOk && isConfirmedAbsent(httpStatus, j);
        noteCleanup({
          action: 'VERIFY notice deleted',
          entityType: 'notice',
          entityId: created.noticeId,
          cleanupMethod: 'GET after DELETE + isConfirmedAbsent',
          result: gone ? 'ok' : 'fail',
          retainedForAudit: false,
          ok: gone,
          httpStatus,
          businessCode: j && j.code != null ? String(j.code) : null,
          dataPresent: !!(j && j.data != null),
          confirmedAbsent: gone,
          detail: 'http=' + httpStatus + ' code=' + (j && j.code) + ' data=' + (j ? JSON.stringify(j.data) : 'unparsed') +
            ' requestOk=' + requestOk + ' parseOk=' + parseOk + ' isConfirmedAbsent=' + gone
        });
      }

      // 6 account reverse already done — verify retained
      if (created.accountId) {
        const g = await adminPage.request.get(pageUrl('/api/account/' + created.accountId));
        let retained = g.status() === 200;
        try { const j = await g.json(); retained = String(j.code) === '0' && !!j.data; } catch (e) {}
        noteCleanup({
          action: 'VERIFY account retained after reverse', entityType: 'account', entityId: created.accountId,
          cleanupMethod: 'GET', result: retained ? 'ok' : 'fail', retainedForAudit: true, ok: retained, detail: 'http=' + g.status()
        });
      }

      // 7 animal delete after deps (favorites cleared + adopt cancelled)
      if (created.animalId) {
        const del = await pageRequestWrite(adminPage, 'DELETE', '/api/animal/' + created.animalId, { headers: csrfHeaders(adminCsrf) }, { cleanup: true });
        let body = null;
        let ok = del.status() === 200;
        try {
          body = await del.json();
          if (String(body.code) === '0') ok = true;
          else ok = false;
        } catch (e) { ok = false; }
        if (ok) {
          noteCleanup({
            action: 'DELETE animal', entityType: 'animal', entityId: created.animalId,
            cleanupMethod: 'DELETE', result: 'ok', retainedForAudit: false, ok: true, detail: 'http=' + del.status()
          });
        } else if (del.status() === 409 || (body && String(body.code) === '409')) {
          // Product may retain animals with historical adopt rows — require deps already terminal
          let adoptTerminal = true;
          if (created.adoptAid && created.adoptUid) {
            try {
              const j2 = await (await adminPage.request.get(pageUrl('/api/adopt/page?pageNum=1&pageSize=50'))).json();
              const recs = (j2.data && j2.data.records) || [];
              const hit = recs.find((r) => String(r.aid) === String(created.adoptAid) && String(r.uid) === String(created.adoptUid));
              // 6=CANCELLED, 5=WITHDRAWN, 2=REJECTED, 4=COMPLETED etc. — not pending 0/1/3
              if (hit && [0, 1, 3].includes(Number(hit.vstate))) adoptTerminal = false;
            } catch (e) { adoptTerminal = false; }
          }
          const policyRetain = adoptTerminal;
          noteCleanup({
            action: 'DELETE animal',
            entityType: 'animal',
            entityId: created.animalId,
            cleanupMethod: 'DELETE',
            result: policyRetain ? 'retained-by-product-policy' : 'fail',
            retainedForAudit: true,
            ok: policyRetain,
            detail: 'http=' + del.status() + ' msg=' + (body && body.msg ? String(body.msg).slice(0, 120) : '') +
              ' adoptTerminal=' + adoptTerminal + ' — history rows may block physical delete; no bulk delete'
          });
        } else {
          noteCleanup({
            action: 'DELETE animal', entityType: 'animal', entityId: created.animalId,
            cleanupMethod: 'DELETE', result: 'fail', retainedForAudit: true, ok: false,
            detail: 'http=' + del.status() + ' unexpected'
          });
        }
      }

      // ── Final-state audit (STRICT: no fail-open defaults) ──
      const finalState = {
        generatedAt: new Date().toISOString(),
        baseUrl: base,
        testMarker,
        memberUser,
        memberId: created.memberId,
        entities: {}
      };

      // favorite: only pass if query succeeds AND target record absent
      {
        const q = await strictApiGet(memPage, '/api/operations/favorites', { expectRecords: true });
        if (!q.ok) {
          finalState.entities.favorite = {
            expected: 'absent-after-successful-query',
            actual: 'query-failed:' + q.error,
            animalId: created.favoriteAnimalId || created.animalId,
            httpStatus: q.httpStatus, code: q.code, ok: false
          };
          assert('final-favorite-query', false, 'http=' + q.httpStatus + ' err=' + q.error);
        } else {
          const targetId = String(created.favoriteAnimalId || created.animalId);
          const present = (q.records || []).some((r) =>
            String(r.id || r.animal_id || r.animalId) === targetId
          );
          finalState.entities.favorite = {
            expected: 'absent',
            actual: present ? 'present' : 'absent',
            animalId: targetId,
            httpStatus: q.httpStatus, code: q.code,
            ok: !present
          };
          assert('final-favorite-absent', !present, 'animalId=' + targetId);
        }
      }

      // adopt: must successfully query and find exact aid/uid with vstate=6
      {
        const q = await strictApiGet(adminPage, '/api/adopt/page?pageNum=1&pageSize=80', { expectRecords: true });
        if (!q.ok) {
          finalState.entities.adopt = {
            expected: 'status=6', actual: 'query-failed:' + q.error,
            aid: created.adoptAid, uid: created.adoptUid, ok: false
          };
          assert('final-adopt-query', false, q.error);
        } else {
          const hit = (q.records || []).find((r) =>
            String(r.aid) === String(created.adoptAid) && String(r.uid) === String(created.adoptUid)
          );
          const vstate = hit ? Number(hit.vstate) : null;
          finalState.entities.adopt = {
            expected: 'status=6',
            actual: hit ? ('status=' + vstate) : 'not-found-in-records',
            aid: created.adoptAid, uid: created.adoptUid,
            httpStatus: q.httpStatus, code: q.code,
            ok: hit != null && vstate === 6
          };
          assert('final-adopt-terminal', hit != null && vstate === 6, 'vstate=' + vstate);
        }
      }

      // help: must successfully query exact helpId with status=3
      {
        if (!created.helpId) {
          finalState.entities.help = { expected: 'status=3', actual: 'helpId-missing', ok: false };
          assert('final-help-id', false, 'helpId missing');
        } else {
          const q = await strictApiGet(adminPage, '/api/help/' + created.helpId);
          if (!q.ok || !q.data) {
            finalState.entities.help = {
              expected: 'status=3', actual: 'query-failed:' + (q.error || 'no-data'),
              helpId: created.helpId, ok: false
            };
            assert('final-help-query', false, q.error || 'no-data');
          } else {
            const status = Number(q.data.status);
            finalState.entities.help = {
              expected: 'status=3', actual: 'status=' + status,
              helpId: created.helpId, httpStatus: q.httpStatus, code: q.code,
              ok: status === 3
            };
            assert('final-help-status3', status === 3, 'status=' + status);
          }
        }
      }

      // signup: GET must succeed; status=3 OR exact id not found; status=null must FAIL
      {
        if (!created.taskId || !created.signupId) {
          finalState.entities.signup = {
            expected: 'status=3 or exact-id-absent',
            actual: 'missing-ids taskId=' + created.taskId + ' signupId=' + created.signupId,
            ok: false
          };
          assert('final-signup-ids', false, 'taskId/signupId missing');
        } else {
          const q = await strictApiGet(
            adminPage,
            '/api/operations/admin/volunteer-tasks/' + created.taskId + '/signups',
            { expectRecords: true }
          );
          if (!q.ok) {
            finalState.entities.signup = {
              expected: 'status=3 or exact-id-absent',
              actual: 'query-failed:' + q.error,
              signupId: created.signupId, taskId: created.taskId, userId: created.memberId,
              ok: false
            };
            assert('final-signup-query', false, q.error);
          } else {
            const mine = (q.records || []).find((r) => String(r.id) === String(created.signupId));
            if (!mine) {
              // exact id not in list after successful query => pass (gone or filtered)
              finalState.entities.signup = {
                expected: 'status=3 or exact-id-absent',
                actual: 'exact-id-absent-after-successful-query',
                signupId: created.signupId, taskId: created.taskId, userId: created.memberId,
                httpStatus: q.httpStatus, code: q.code, ok: true
              };
              assert('final-signup-absent-or-3', true, 'exact id absent');
            } else {
              const status = mine.status == null ? null : Number(mine.status);
              const ok = status === 3;
              finalState.entities.signup = {
                expected: 'status=3 or exact-id-absent',
                actual: status == null ? 'status=null-FAIL' : ('status=' + status),
                signupId: created.signupId, taskId: created.taskId, userId: created.memberId,
                httpStatus: q.httpStatus, code: q.code, ok
              };
              assert('final-signup-status3', ok, 'status=' + status + ' (null must fail)');
            }
          }
        }
      }

      // task: successful query + status 2 or 3
      {
        if (!created.taskId) {
          finalState.entities.task = { expected: 'status=2 or 3', actual: 'taskId-missing', ok: false };
          assert('final-task-id', false, 'taskId missing');
        } else {
          const q = await strictApiGet(adminPage, '/api/operations/admin/volunteer-tasks', { expectRecords: true });
          if (!q.ok) {
            finalState.entities.task = {
              expected: 'status=2 or 3', actual: 'query-failed:' + q.error,
              taskId: created.taskId, ok: false
            };
            assert('final-task-query', false, q.error);
          } else {
            const hit = (q.records || []).find((r) => String(r.id) === String(created.taskId));
            const status = hit ? Number(hit.status) : null;
            const ok = hit != null && (status === 2 || status === 3);
            finalState.entities.task = {
              expected: 'status=2 or 3',
              actual: hit ? ('status=' + status) : 'not-found',
              taskId: created.taskId, httpStatus: q.httpStatus, code: q.code, ok
            };
            assert('final-task-closed', ok, 'status=' + status);
          }
        }
      }

      // notice: only isConfirmedAbsent(http, json) may pass — no loose !data / queryOk&&!present
      {
        if (!created.noticeId) {
          finalState.entities.notice = { expected: 'absent', actual: 'noticeId-missing', ok: false };
          assert('final-notice-id', false, 'noticeId missing');
        } else {
          try {
            const r = await adminPage.request.get(pageUrl('/api/notice/' + created.noticeId));
            const httpStatus = r.status();
            let j = null;
            let parseOk = false;
            try {
              j = await r.json();
              parseOk = j != null && typeof j === 'object';
            } catch (e) {
              j = null;
              parseOk = false;
            }
            if (!parseOk) {
              finalState.entities.notice = {
                expected: 'absent-via-isConfirmedAbsent',
                actual: 'json-parse-fail',
                noticeId: created.noticeId, httpStatus, ok: false
              };
              assert('final-notice-query', false, 'json-parse-fail http=' + httpStatus);
            } else {
              const code = j.code != null ? String(j.code) : null;
              const ok = isConfirmedAbsent(httpStatus, j);
              finalState.entities.notice = {
                expected: 'absent-via-isConfirmedAbsent',
                actual: ok
                  ? ('confirmed-absent http=' + httpStatus + ' code=' + code)
                  : ('not-confirmed-absent http=' + httpStatus + ' code=' + code + ' data=' + JSON.stringify(j.data)),
                noticeId: created.noticeId,
                httpStatus,
                code,
                dataPresent: j.data != null,
                confirmedAbsent: ok,
                ok
              };
              assert('final-notice-absent', ok,
                'http=' + httpStatus + ' code=' + code + ' isConfirmedAbsent=' + ok);
            }
          } catch (e) {
            finalState.entities.notice = {
              expected: 'absent-via-isConfirmedAbsent',
              actual: 'request-fail:' + String(e.message || e).slice(0, 80),
              noticeId: created.noticeId, ok: false
            };
            assert('final-notice-query', false, String(e.message || e));
          }
        }
      }

      // account + reverse: successful query required
      {
        if (!created.accountId) {
          finalState.entities.account = { expected: 'orig+reverse', actual: 'accountId-missing', ok: false };
          assert('final-account-id', false, 'accountId missing');
        } else {
          const q = await strictApiGet(adminPage, '/api/account/page?pageNum=1&pageSize=100', { expectRecords: true });
          if (!q.ok) {
            finalState.entities.account = {
              expected: 'orig+reverse opposite', actual: 'query-failed:' + q.error, ok: false
            };
            assert('final-account-query', false, q.error);
          } else {
            const recs = q.records || [];
            const orig = recs.find((r) => String(r.id) === String(created.accountId)) || null;
            let reverse = recs.find((r) =>
              String(r.reversal_of || r.reversalOf || '') === String(created.accountId)
            ) || null;
            if (orig && !reverse) {
              const amt = Number(orig.avalue != null ? orig.avalue : orig.value);
              reverse = recs.find((r) =>
                String(r.id) !== String(orig.id) &&
                Math.abs(Number(r.avalue != null ? r.avalue : r.value) + amt) < 0.001
              ) || null;
            }
            const origAmt = orig != null ? Number(orig.avalue != null ? orig.avalue : orig.value) : null;
            const revAmt = reverse != null ? Number(reverse.avalue != null ? reverse.avalue : reverse.value) : null;
            const ok = orig != null && reverse != null && origAmt != null && revAmt != null && Math.abs(origAmt + revAmt) < 0.001;
            finalState.entities.account = {
              expected: 'original + reverse opposite amounts',
              originalId: orig && orig.id, originalAmount: origAmt,
              reverseId: reverse && reverse.id, reverseAmount: revAmt,
              httpStatus: q.httpStatus, code: q.code, ok
            };
            assert('final-account-reverse', ok, 'orig=' + origAmt + ' rev=' + revAmt);
          }
        }
      }

      // animal: deleted OR (retained-by-product-policy with exact 409 evidence + adopt terminal + DB row exists)
      {
        if (!created.animalId) {
          finalState.entities.animal = { expected: 'deleted-or-retained', actual: 'animalId-missing', ok: false };
          assert('final-animal-id', false, 'animalId missing');
        } else {
          const animalCleanup = result.cleanupAudit.find((c) => c.entityType === 'animal');
          let present = false;
          let tstate = null;
          let queryOk = false;
          try {
            const r = await adminPage.request.get(pageUrl('/api/animal/' + created.animalId));
            const httpStatus = r.status();
            let j = null;
            try { j = await r.json(); } catch (e) { j = null; }
            if (!j) {
              finalState.entities.animal = {
                expected: 'deleted-or-retained', actual: 'json-parse-fail http=' + httpStatus,
                animalId: created.animalId, ok: false
              };
              assert('final-animal-query', false, 'json-parse-fail');
            } else {
              queryOk = true;
              const code = j.code != null ? String(j.code) : null;
              if (code === '0' && j.data) {
                present = true;
                tstate = j.data.tstate != null ? Number(j.data.tstate) : null;
              } else {
                present = false;
              }
              const deletedOk = animalCleanup && animalCleanup.result === 'ok' && !present;
              let retainedOk = false;
              if (animalCleanup && animalCleanup.result === 'retained-by-product-policy') {
                // must have exact 409 evidence in cleanup detail/http, adopt terminal, animal still exists in DB
                const has409 = /http=409|code.?=?409|409/.test(String(animalCleanup.detail || '')) ||
                  animalCleanup.retainedForAudit === true;
                const adoptEnt = finalState.entities.adopt;
                const adoptTerminal = adoptEnt && adoptEnt.ok === true;
                // DB proof animal still exists
                const dbRow = mysqlRows(
                  'SELECT id,tname,tstate FROM t_animal WHERE id=' + Number(created.animalId)
                );
                const dbPresent = !dbRow.error && dbRow.rows.length === 1 &&
                  String(dbRow.rows[0][0]) === String(created.animalId);
                retainedOk = has409 && adoptTerminal && present && dbPresent && animalCleanup.retainedForAudit === true;
                if (!retainedOk) {
                  assert('final-animal-retain-evidence', false,
                    'has409=' + has409 + ' adoptTerminal=' + adoptTerminal +
                    ' present=' + present + ' dbPresent=' + dbPresent +
                    ' retainedFlag=' + (animalCleanup && animalCleanup.retainedForAudit));
                }
              }
              const ok = deletedOk || retainedOk;
              finalState.entities.animal = {
                expected: 'deleted or retained-by-product-policy-with-evidence',
                actual: present ? ('present tstate=' + tstate) : 'deleted',
                animalId: created.animalId, animalName,
                cleanupResult: animalCleanup && animalCleanup.result,
                ok
              };
              assert('final-animal-state', ok, finalState.entities.animal.actual);
            }
          } catch (e) {
            finalState.entities.animal = {
              expected: 'deleted-or-retained', actual: 'request-fail:' + String(e.message || e).slice(0, 80),
              animalId: created.animalId, ok: false
            };
            assert('final-animal-query', false, String(e.message || e));
          }
        }
      }

      // user: MySQL query MUST succeed and exact id/username present for retainedForAudit
      {
        const uid = Number(created.memberId) || 0;
        const uname = memberUser.replace(/'/g, '');
        const db = mysqlRows(
          "SELECT id,username FROM t_user WHERE id=" + uid + " OR username='" + uname + "' LIMIT 1"
        );
        if (db.error) {
          finalState.entities.user = {
            expected: 'present-retainedForAudit', actual: 'mysql-fail:' + db.error,
            userId: created.memberId, username: memberUser, retainedForAudit: true, ok: false
          };
          assert('final-user-mysql', false, db.error);
        } else if (!db.rows.length) {
          finalState.entities.user = {
            expected: 'present-retainedForAudit', actual: 'absent',
            userId: created.memberId, username: memberUser, retainedForAudit: true, ok: false
          };
          assert('final-user-present', false, 'user not found');
        } else {
          const idOk = String(db.rows[0][0]) === String(created.memberId);
          const nameOk = String(db.rows[0][1]) === String(memberUser);
          const ok = idOk && nameOk;
          finalState.entities.user = {
            expected: 'present-retainedForAudit',
            actual: 'present id=' + db.rows[0][0] + ' username=' + db.rows[0][1],
            userId: created.memberId, username: memberUser,
            retainedForAudit: true, ok
          };
          assert('final-user-match', ok, finalState.entities.user.actual);
        }
      }

      // volunteer: query success + exact id + uid matches member + vstate=1
      {
        if (!created.volunteerId) {
          finalState.entities.volunteer = {
            expected: 'id+uid+vstate=1', actual: 'volunteerId-missing', ok: false
          };
          assert('final-volunteer-id', false, 'volunteerId missing');
        } else {
          const db = mysqlRows(
            'SELECT id,uid,vstate FROM t_volunteer WHERE id=' + Number(created.volunteerId)
          );
          if (db.error) {
            finalState.entities.volunteer = {
              expected: 'id+uid+vstate=1', actual: 'mysql-fail:' + db.error,
              volunteerId: created.volunteerId, retainedForAudit: true, ok: false
            };
            assert('final-volunteer-mysql', false, db.error);
          } else if (!db.rows.length) {
            finalState.entities.volunteer = {
              expected: 'id+uid+vstate=1', actual: 'absent',
              volunteerId: created.volunteerId, retainedForAudit: true, ok: false
            };
            assert('final-volunteer-present', false, 'volunteer not found');
          } else {
            const id = String(db.rows[0][0]);
            const uid = String(db.rows[0][1]);
            const vstate = String(db.rows[0][2]);
            const ok = id === String(created.volunteerId) &&
              uid === String(created.memberId) &&
              vstate === '1';
            finalState.entities.volunteer = {
              expected: 'id+uid+vstate=1 retainedForAudit',
              actual: 'id=' + id + ' uid=' + uid + ' vstate=' + vstate,
              volunteerId: created.volunteerId, retainedForAudit: true, ok
            };
            assert('final-volunteer-match', ok, finalState.entities.volunteer.actual);
          }
        }
      }

      const finalOk = Object.values(finalState.entities).every((e) => e && e.ok === true);
      finalState.ok = finalOk;
      finalState.cleanupFailed = result.cleanupFailed;
      finalState.cleanupAuditCount = result.cleanupAudit.length;
      fs.writeFileSync(path.join(out, 'final-state-audit.json'), JSON.stringify(finalState, null, 2));
      assert('final-state-audit-ok', finalOk, JSON.stringify(finalState.entities));
      if (!finalOk && result.cleanupFailed === 0) {
        result.cleanupFailed += 1;
        noteCleanup({
          action: 'FINAL-STATE mismatch', entityType: 'final-state', entityId: testMarker,
          result: 'fail', ok: false, detail: 'final-state-audit entities not all ok'
        });
      }

      await memCtx.close();
      await adminCtx.close();
    }

    // ── Live residual audit (full DB, exact IDs; no bulk delete) ──
    {
      const now = new Date().toISOString();
      const animals = mysqlRows("SELECT id,tname,tstate FROM t_animal WHERE tname LIKE 'E4A\\_%' ORDER BY id");
      const users = mysqlRows("SELECT id,username,phone FROM t_user WHERE username LIKE 'e4a%' ORDER BY id");
      const vols = mysqlRows("SELECT id,uid,vstate,LEFT(moreability,80) FROM t_volunteer WHERE moreability LIKE '%E2E4A_%' OR moreability LIKE '%e4a%' ORDER BY id");
      const helps = mysqlRows("SELECT id,title,status,version FROM t_help WHERE title LIKE 'E2E4A\\_%' ORDER BY id");
      const tasks = mysqlRows("SELECT id,title,status,version FROM t_volunteer_task WHERE title LIKE 'E2E4A\\_%' ORDER BY id");
      const signups = mysqlRows("SELECT id,task_id,user_id,status FROM t_volunteer_signup WHERE task_id IN (SELECT id FROM t_volunteer_task WHERE title LIKE 'E2E4A\\_%') ORDER BY id");
      // accounts: original E2E4A_* AND reverse 冲正：E2E4A_* with reversal_of
      const accounts = mysqlRows(
        "SELECT id,alabel,avalue,IFNULL(reversal_of,'') FROM t_account " +
        "WHERE alabel LIKE 'E2E4A\\_%' OR alabel LIKE '冲正：E2E4A\\_%' ORDER BY id"
      );
      const notices = mysqlRows("SELECT id,title FROM t_notice WHERE title LIKE 'E2E4A\\_%' ORDER BY id");
      // Dual proof: this-run exact noticeId must be absent in DB (SQL fail != empty)
      const noticeDbProofLines = [];
      let noticeDbAbsentOk = false;
      if (!created.noticeId) {
        noticeDbProofLines.push('- noticeId missing — FAIL');
        assert('final-notice-db-absent', false, 'noticeId missing');
      } else {
        const nid = Number(created.noticeId);
        const exactNotice = mysqlRows('SELECT id,title FROM t_notice WHERE id=' + nid);
        if (exactNotice.error) {
          noticeDbProofLines.push('- MySQL FAIL for id=' + created.noticeId + ': ' + exactNotice.error);
          noticeDbProofLines.push('- SQL failure must NOT be treated as empty/absent');
          assert('final-notice-db-absent', false, 'mysql-fail:' + exactNotice.error);
        } else if (exactNotice.rows.length > 0) {
          noticeDbProofLines.push('- noticeId=' + created.noticeId + ' STILL PRESENT: ' + exactNotice.rows.map((r) => r.join('/')).join('; '));
          assert('final-notice-db-absent', false, 'still-present id=' + created.noticeId);
        } else {
          noticeDbAbsentOk = true;
          noticeDbProofLines.push('- MySQL query OK (error=null)');
          noticeDbProofLines.push('- exact noticeId=' + created.noticeId + ' rows=0 → confirmed absent in t_notice');
          assert('final-notice-db-absent', true, 'id=' + created.noticeId + ' absent');
        }
      }
      result.noticeDbProof = {
        noticeId: created.noticeId,
        ok: noticeDbAbsentOk,
        lines: noticeDbProofLines,
        at: new Date().toISOString()
      };
      // adopts linked to E4A animals
      const adopts = mysqlRows("SELECT a.aid,a.uid,a.vstate,a.version FROM t_adopt a JOIN t_animal an ON an.id=a.aid WHERE an.tname LIKE 'E4A\\_%' ORDER BY a.aid,a.uid");
      const favs = mysqlRows("SELECT f.animal_id,f.user_id FROM t_animal_favorite f JOIN t_animal an ON an.id=f.animal_id WHERE an.tname LIKE 'E4A\\_%' ORDER BY f.animal_id");

      function tableMd(headers, rowsObj, suggestFn) {
        const lines = ['| ' + headers.join(' | ') + ' |', '| ' + headers.map(() => '---').join(' | ') + ' |'];
        if (rowsObj.error) {
          lines.push('| ERROR | ' + String(rowsObj.error).replace(/\|/g, '/') + ' |');
          return lines.join('\n');
        }
        if (!rowsObj.rows.length) {
          // empty success => (none), never ERROR|empty
          lines.push('| (none) |' + headers.slice(1).map(() => ' |').join(''));
          return lines.join('\n');
        }
        rowsObj.rows.forEach((r) => {
          const cells = r.slice(0, headers.length - 1);
          const suggest = suggestFn ? suggestFn(r) : '人工确认；禁止模糊批量删除';
          lines.push('| ' + cells.concat([suggest]).map((c) => String(c == null ? '' : c).replace(/\|/g, '/')).join(' | ') + ' |');
        });
        return lines.join('\n');
      }

      // validate each original E2E4A account has exact reverse summing to 0
      let accountPairOk = true;
      const accountPairNotes = [];
      if (!accounts.error) {
        const origs = accounts.rows.filter((r) => String(r[1] || '').indexOf('冲正：') !== 0 && String(r[1] || '').indexOf('E2E4A_') === 0);
        const revs = accounts.rows.filter((r) => String(r[1] || '').indexOf('冲正：') === 0 || String(r[3] || '') !== '');
        origs.forEach((o) => {
          const oid = String(o[0]);
          const oamt = Number(o[2]);
          const rev = accounts.rows.find((r) => String(r[3]) === oid) ||
            revs.find((r) => String(r[1]).indexOf(String(o[1])) >= 0 && Math.abs(Number(r[2]) + oamt) < 0.001);
          if (!rev) {
            accountPairOk = false;
            accountPairNotes.push('orig id=' + oid + ' missing reverse');
          } else if (Math.abs(oamt + Number(rev[2])) >= 0.001) {
            accountPairOk = false;
            accountPairNotes.push('orig id=' + oid + ' amt sum !=0');
          }
        });
      } else {
        accountPairOk = false;
        accountPairNotes.push('accounts query error');
      }
      assert('residual-account-pairs', accountPairOk, accountPairNotes.join('; ') || 'ok');

      const residualMd = [
        '# Phase 4A Residual Audit（数据库实时）',
        '',
        '**生成时间**: ' + now,
        '**数据库**: `' + (process.env.DB_NAME || 'test') + '`（dev，非生产）',
        '**本轮 marker**: `' + testMarker + '`',
        '**本轮 userId/animalId/taskId/signupId**: ' +
          [created.memberId, created.animalId, created.taskId, created.signupId].join(' / '),
        '**策略**: 仅自动清理本轮精确 ID；下列条目为实时查询结果，**禁止**自动批量删除。',
        '',
        '## 1. 动物 `E4A_*`（精确 ID）',
        '',
        tableMd(['id', 'tname', 'tstate', '建议处理'], animals, (r) => {
          if (String(r[0]) === String(created.animalId)) return '本轮；见 cleanup-audit/final-state';
          return '历史残留；先核对 fav/adopt 再评估精确删除';
        }),
        '',
        '## 2. 领养（关联 E4A 动物，精确 aid/uid）',
        '',
        tableMd(['aid', 'uid', 'vstate', 'version', '建议处理'], adopts, (r) => {
          const st = Number(r[2]);
          if (st === 6) return '已终态 CANCELLED；可保留审计';
          if ([0, 1, 3].includes(st)) return '非终态；需 CANCEL+expectedVersion';
          return '核对业务态后人工处理';
        }),
        '',
        '## 3. 收藏（关联 E4A 动物）',
        '',
        tableMd(['animal_id', 'user_id', '建议处理'], favs, (r) =>
          String(r[0]) === String(created.animalId) ? '本轮应已 DELETE' : '历史；精确 DELETE favorites/{animalId}'
        ),
        '',
        '## 4. 测试用户 `e4a*`',
        '',
        tableMd(['id', 'username', 'phone', '建议处理'], users, (r) => {
          if (String(r[0]) === String(created.memberId)) return '本轮 retainedForAudit=true';
          return '历史测试账号；保留审计或人工注销';
        }),
        '',
        '## 5. 义工申请（marker / e4a）',
        '',
        tableMd(['id', 'uid', 'vstate', 'ability_prefix', '建议处理'], vols, (r) => {
          if (String(r[0]) === String(created.volunteerId)) return '本轮 retainedForAudit=true';
          return '历史申请；保留审计';
        }),
        '',
        '## 6. 救助 `E2E4A_*`',
        '',
        tableMd(['id', 'title', 'status', 'version', '建议处理'], helps, (r) => {
          if (String(r[0]) === String(created.helpId)) return '本轮应 status=3';
          return Number(r[2]) === 3 ? '已关闭；保留' : 'manage→3 + expectedVersion';
        }),
        '',
        '## 7. 义工任务 `E2E4A_*`',
        '',
        tableMd(['id', 'title', 'status', 'version', '建议处理'], tasks, (r) => {
          if (String(r[0]) === String(created.taskId)) return '本轮应 status=2/3';
          return [2, 3].includes(Number(r[2])) ? '已关闭；保留' : 'PUT status=2 + expectedVersion';
        }),
        '',
        '## 8. 报名（挂在 E2E4A 任务上）',
        '',
        tableMd(['id', 'task_id', 'user_id', 'status', '建议处理'], signups, (r) => {
          if (String(r[0]) === String(created.signupId)) return '本轮应 status=3';
          return Number(r[3]) === 3 ? '已撤回；保留' : 'DELETE signup withdraw 或人工终态';
        }),
        '',
        '## 9. 资金 `E2E4A_*` 与 `冲正：E2E4A_*`（id/alabel/avalue/reversal_of）',
        '',
        tableMd(['id', 'alabel', 'avalue', 'reversal_of', '建议处理'], accounts, (r) => {
          const isRev = String(r[1] || '').indexOf('冲正：') === 0 || String(r[3] || '') !== '';
          if (isRev) return '冲正单；保留审计；禁止物理删除';
          return '原单；须有精确冲正且金额相抵';
        }),
        '',
        '资金原单/冲正配对校验: ' + (accountPairOk ? 'PASS' : 'FAIL') +
          (accountPairNotes.length ? ' — ' + accountPairNotes.join('; ') : ''),
        '',
        '## 10. 公告 `E2E4A_*`（应为空或历史）',
        '',
        tableMd(['id', 'title', '建议处理'], notices, () => '应已删除；若存在则精确 DELETE'),
        '',
        '## 10b. 本轮 noticeId 数据库双重证明',
        '',
        noticeDbProofLines.join('\n'),
        '',
        '## 11. 处置边界',
        '',
        '1. **禁止** `DELETE FROM … WHERE title LIKE \'%E2E4A%\'` 等模糊删除。',
        '2. 本轮套件只清理 `data-lifecycle-ledger.json` / `created.*` 中**本轮**精确 ID。',
        '3. 上表历史项进入人工工单；`cleanupFailed=0` 仅对本轮 final-state 成立。',
        '4. 本文件在最终运行结束后由套件实时生成，非过期范围描述。',
        ''
      ].join('\n');
      fs.writeFileSync(path.join(out, 'RESIDUAL-AUDIT.md'), residualMd);
      assert('residual-audit-written', fs.existsSync(path.join(out, 'RESIDUAL-AUDIT.md')), 'missing');
    }

    phaseMode = 'journey';
    assertUiLedgerComplete();
    assert('no-synthetic', result.syntheticWrites === 0, '0');
    assert('no-mocked', result.mockedBusinessResponses === 0, '0');
    assert('no-fallback', result.fallbackPassCount === 0, 'fallback=' + result.fallbackPassCount);
    assert('no-best-effort', result.bestEffortPassCount === 0, '0');
    assert('no-direct-journey-write', result.directJourneyWrite === 0, 'n=' + result.directJourneyWrite + ' ' + JSON.stringify(result.directJourneyWriteAudit.slice(0, 5)));
    assert('no-pageerror', result.pageErrors.length === 0, JSON.stringify(result.pageErrors.slice(0, 2)));
    assert('cleanup-failed-zero', result.cleanupFailed === 0, 'n=' + result.cleanupFailed);
    assert('journeys-ge-8', result.journeys.length >= 8, 'n=' + result.journeys.length);
    assert('d-task-bound', !!created.taskId, 'taskId');
    assert('screenshots-ge-16', result.screenshots.length >= 16, 'n=' + result.screenshots.length);
    assert('signup-id-present', !!created.signupId, 'signupId');
    assert('shot-hash-files', (() => {
      const b = path.join(shotDir, 'd-task-before-signup.png');
      const a = path.join(shotDir, 'd-task-after-signup.png');
      if (!fs.existsSync(b) || !fs.existsSync(a)) return false;
      const hb = cryptoHash.createHash('sha256').update(fs.readFileSync(b)).digest('hex');
      const ha = cryptoHash.createHash('sha256').update(fs.readFileSync(a)).digest('hex');
      return hb !== ha;
    })(), 'before/after screenshots must differ');

    // environment evidence — derive from actual BASE_URL + live port probe + server log (no hardcode-as-verified)
    const port = (() => { try { return Number(new URL(base).port); } catch (e) { return NaN; } })();
    assert('env-port-from-base', Number.isFinite(port) && port > 0, 'base=' + base);

    // Discover real listening PID for this port (Windows netstat)
    let livePid = null;
    let portListenOk = false;
    let port9999Listen = null;
    try {
      const netOut = execSync('netstat -ano', { encoding: 'utf8', windowsHide: true });
      const lines = String(netOut).split(/\r?\n/);
      const re = new RegExp('[:.]' + port + '\\s+.*LISTENING\\s+(\\d+)', 'i');
      const re9999 = /[:.]9999\s+.*LISTENING\s+(\d+)/i;
      for (const line of lines) {
        const m = line.match(re);
        if (m) { livePid = m[1]; portListenOk = true; }
        if (re9999.test(line)) port9999Listen = true;
      }
      if (port9999Listen == null) port9999Listen = false;
    } catch (e) {
      portListenOk = false;
    }
    assert('env-port-listening', portListenOk && !!livePid, 'port=' + port + ' pid=' + livePid);
    assert('env-9999-not-listening', port9999Listen === false, '9999 must not be LISTEN');

    // Prefer E2E_JAVA_PID if set and matches live listener; else use live listener
    const envPid = process.env.E2E_JAVA_PID ? String(process.env.E2E_JAVA_PID) : null;
    const javaPid = (envPid && envPid === String(livePid)) ? envPid : String(livePid);
    if (envPid && envPid !== String(livePid)) {
      // still record live; do not invent match
      assert('env-pid-align', false, 'E2E_JAVA_PID=' + envPid + ' livePid=' + livePid);
    } else {
      assert('env-pid-align', true, 'pid=' + javaPid);
    }

    // Read server log for profile + Tomcat port evidence (must be non-empty and match)
    const serverLogName = 'server-' + port + '-out.log';
    const serverLogPath = path.join(out, serverLogName);
    let serverLogText = '';
    let serverLogSize = 0;
    let profileEvidence = false;
    let tomcatEvidence = false;
    let startedEvidence = false;
    try {
      if (fs.existsSync(serverLogPath)) {
        serverLogText = fs.readFileSync(serverLogPath, 'utf8');
        serverLogSize = Buffer.byteLength(serverLogText, 'utf8');
        profileEvidence = /The following 1 profile is active:\s*"dev"/i.test(serverLogText) ||
          /active profile[s]?[^\n]*dev/i.test(serverLogText);
        tomcatEvidence = new RegExp('Tomcat started on port ' + port, 'i').test(serverLogText);
        startedEvidence = /Started Application in /i.test(serverLogText);
      }
    } catch (e) {
      serverLogText = '';
    }
    assert('env-server-log-nonempty', serverLogSize > 0, 'path=' + serverLogPath + ' size=' + serverLogSize);
    assert('env-profile-dev-in-log', profileEvidence, 'log missing active profile=dev');
    assert('env-tomcat-port-in-log', tomcatEvidence, 'log missing Tomcat started on port ' + port);
    assert('env-started-in-log', startedEvidence, 'log missing Started Application');

    // Probe DB name from env (no password printed)
    const dbName = process.env.DB_NAME || 'test';
    const dbHost = process.env.DB_HOST || 'localhost';
    const dbPort = Number(process.env.DB_PORT || 3306);
    assert('env-db-nonprod', dbName === 'test' || process.env.E2E_DB_CONFIRMED_NON_PROD === 'true', 'dbName=' + dbName);

    const envMeta = {
      serverPort: port,
      baseUrl: base,
      dbPort,
      dbHost,
      dbName,
      springProfile: profileEvidence ? 'dev' : null,
      javaPid,
      liveListenPid: livePid,
      redisPortOpen: false,
      testMarker,
      notProduction: dbName === 'test' && port !== 9999 && port9999Listen === false,
      port9999Listening: port9999Listen,
      serverLogPath: serverLogName,
      serverLogSize,
      profileEvidence,
      tomcatEvidence,
      startedEvidence,
      evidenceSources: [
        'BASE_URL=' + base,
        'netstat LISTENING pid for port ' + port + '=' + livePid,
        'server log ' + serverLogName + ' size=' + serverLogSize,
        'DB_NAME env=' + dbName
      ],
      generatedAt: new Date().toISOString()
    };
    fs.writeFileSync(path.join(out, 'environment-meta.json'), JSON.stringify(envMeta, null, 2));
    fs.writeFileSync(path.join(out, 'ENVIRONMENT-REQUIREMENTS.md'), [
      '# Phase 4A Environment Requirements',
      '',
      '- Base URL: `' + base + '`',
      '- Server port: **' + port + '** (must not be 9999)',
      '- Spring profile: `' + (envMeta.springProfile || 'UNVERIFIED') + '` (from server log)',
      '- Database: `' + envMeta.dbName + '` @ ' + envMeta.dbHost + ':' + envMeta.dbPort + ' (from env DB_NAME/DB_HOST/DB_PORT names only)',
      '- Java PID (listen): `' + javaPid + '`',
      '- Server log: `' + serverLogName + '` size=' + serverLogSize,
      '- Redis: not required for this suite',
      '- Admin env vars: `E2E_ADMIN_USERNAME` / `E2E_ADMIN_PASSWORD` (values not printed)',
      '- Generated: ' + envMeta.generatedAt,
      '- Marker: `' + testMarker + '`',
      '- port 9999 listening: `' + port9999Listen + '`',
      '',
      'Evidence in this directory for the final close-out must use only port **' + port + '**.',
      ''
    ].join('\n'));

    const summary = writeReports();
    // notice evidence from final-state + cleanup
    const noticeFinal = (() => {
      try {
        const fsj = JSON.parse(fs.readFileSync(path.join(out, 'final-state-audit.json'), 'utf8'));
        return fsj.entities && fsj.entities.notice;
      } catch (e) { return null; }
    })();
    const noticeCleanup = result.cleanupAudit.find((c) => c.entityType === 'notice' && /VERIFY notice/.test(c.action || ''));
    const contract = result.noticeAbsenceContract || { allOk: false, cases: [] };
    // markdown report
    fs.writeFileSync(path.join(out, 'PHASE-4A-REPORT.md'), [
      '# Phase 4A Credibility Report (final close-out)',
      '',
      '- **STRICT**=' + summary.strictMode,
      '- **port**=' + port,
      '- **baseUrl**=' + base,
      '- **javaPid**=' + javaPid,
      '- **marker**=' + testMarker,
      '- **animalId**=' + created.animalId,
      '- **taskId**=' + created.taskId,
      '- **signupId**=' + created.signupId,
      '- **noticeId**=' + created.noticeId,
      '- **memberUser**=' + memberUser + ' (userId=' + created.memberId + ')',
      '- **volunteerId**=' + created.volunteerId,
      '- **assertions**=' + summary.passed + '/' + summary.failed + '/' + summary.skipped,
      '- **journeys**=' + summary.journeysPassed + '/' + summary.journeys,
      '- **directJourneyWrite**=' + summary.directJourneyWrite,
      '- **fallback**=' + summary.fallbackPassCount,
      '- **cleanupFailed**=' + summary.cleanupFailed,
      '- **uiBusinessWrites**=' + summary.uiBusinessWrites,
      '- **unexpected request/http/pageerror**=' +
        summary.unexpectedRequestFailures + '/' + summary.unexpectedHttpErrors + '/' + summary.pageErrors,
      '',
      '## Notice absence (strict)',
      '',
      '- contract self-test allOk=' + !!contract.allOk + ' cases=' + (contract.cases ? contract.cases.length : 0),
      '- cleanup VERIFY: http=' + (noticeCleanup && noticeCleanup.httpStatus) +
        ' code=' + (noticeCleanup && noticeCleanup.businessCode) +
        ' confirmedAbsent=' + (noticeCleanup && noticeCleanup.confirmedAbsent) +
        ' ok=' + (noticeCleanup && noticeCleanup.ok),
      '- final-state: ' + (noticeFinal ? JSON.stringify(noticeFinal) : 'n/a'),
      '- DB dual proof final-notice-db-absent: ' +
        (result.noticeDbProof ? ('ok=' + result.noticeDbProof.ok + ' id=' + result.noticeDbProof.noticeId) : 'n/a'),
      '',
      '## Close-out gates',
      '',
      '- signup cleanup audited (volunteer_signup before task close)',
      '- admin 报名管理 real DOM shows username + userId + task context',
      '- before/after task card screenshots SHA256 differ',
      '- no Vue `__vue__` form injection for volunteer/task',
      '- real-api-ledger UI writes backfilled (journeyId/businessCode/entityId/…)',
      '- final-state-audit.json + live RESIDUAL-AUDIT.md',
      '- notice isConfirmedAbsent + contract self-test + DB dual proof',
      '- environment-meta.json port=' + port + ' javaPid=' + javaPid,
      '',
      'See `RESIDUAL-AUDIT.md`, `final-state-audit.json`, `cleanup-audit.json`, `real-api-ledger.json`.',
      '',
      '**未提交、未推送、未合并 main、不进入 4B；等待 GPT 独立审核。**',
      ''
    ].join('\n'));

    // Strip trailing whitespace from UI-POLISH-REVIEW-REPORT.md (test report only)
    try {
      const polishPath = path.resolve('UI-POLISH-REVIEW-REPORT.md');
      if (fs.existsSync(polishPath)) {
        const raw = fs.readFileSync(polishPath, 'utf8');
        const cleaned = raw.split(/\r?\n/).map((line) => line.replace(/[ \t]+$/g, '')).join('\n');
        fs.writeFileSync(polishPath, cleaned.endsWith('\n') ? cleaned : cleaned + '\n');
      }
    } catch (e) { /* ignore */ }

    // FINAL gate: git diff --check AFTER all reports written; never hardcode 0
    let gitDiffCheckExit = null;
    let gitDiffCheckOut = '';
    try {
      gitDiffCheckOut = execSync('git diff --check', {
        encoding: 'utf8',
        cwd: path.resolve('.'),
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      });
      gitDiffCheckExit = 0;
    } catch (e) {
      gitDiffCheckExit = typeof e.status === 'number' ? e.status : 1;
      gitDiffCheckOut = String((e.stdout || '') + (e.stderr || e.message || e));
    }
    fs.writeFileSync(
      path.join(out, 'git-diff-check.log'),
      'exit=' + gitDiffCheckExit + '\n' + gitDiffCheckOut + (gitDiffCheckOut.endsWith('\n') ? '' : '\n')
    );
    assert('git-diff-check-zero', gitDiffCheckExit === 0, 'exit=' + gitDiffCheckExit + ' ' + gitDiffCheckOut.slice(0, 200));

    // rewrite regression-summary with REAL gitDiffCheck (never prefilled)
    const regSummary = {
      phase: '4A-credibility',
      summary: Object.assign({}, summary, { gitDiffCheck: gitDiffCheckExit }),
      journeys: result.journeys,
      gitDiffCheck: gitDiffCheckExit,
      port,
      baseUrl: base,
      testMarker,
      generatedAt: new Date().toISOString()
    };
    fs.writeFileSync(path.join(out, 'regression-summary.json'), JSON.stringify(regSummary, null, 2));

    // append gitDiffCheck to PHASE report
    fs.appendFileSync(path.join(out, 'PHASE-4A-REPORT.md'),
      '\n- **gitDiffCheck**=' + gitDiffCheckExit + ' (from real `git diff --check`, see git-diff-check.log)\n');

    // recompute strict with gitDiffCheck
    if (gitDiffCheckExit !== 0) {
      summary.strictMode = false;
      result.summary.strictMode = false;
      result.ok = false;
      fs.writeFileSync(path.join(out, 'phase-4a-report.json'), JSON.stringify(result, null, 2));
      fs.writeFileSync(path.join(out, 'run-strict-final.log'),
        fs.readFileSync(path.join(out, 'run-strict-final.log'), 'utf8').replace(
          /PHASE 4A STRICT=true/,
          'PHASE 4A STRICT=false'
        )
      );
    }

    // ensure run-strict-final.log includes port
    {
      const logPath = path.join(out, 'run-strict-final.log');
      let logTxt = fs.readFileSync(logPath, 'utf8');
      if (logTxt.indexOf('BASE_URL') < 0) {
        logTxt = logTxt.trimEnd() + '\nBASE_URL ' + base + '\nPORT ' + port + '\nJAVA_PID ' + javaPid + '\n';
        fs.writeFileSync(logPath, logTxt);
      }
    }

    console.log('Phase 4A credibility summary', summary);
    console.log('gitDiffCheck', gitDiffCheckExit);
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
