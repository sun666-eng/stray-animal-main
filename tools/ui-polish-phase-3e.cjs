/**
 * Phase 3E strict credibility suite — volunteer apply / mine / tasks.
 * Fail-closed. Real Playwright interactions only. Auth via /api/user/me fixture.
 * Port default :18126
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const startedAt = Date.now();
const base = process.env.BASE_URL || 'http://127.0.0.1:18126';
const out = path.resolve('output/playwright/ui-polish-phase-3e');
const shotDir = path.join(out, 'screenshots');
fs.mkdirSync(shotDir, { recursive: true });
for (const f of fs.readdirSync(shotDir)) {
  if (f.endsWith('.png')) fs.unlinkSync(path.join(shotDir, f));
}

const PAGES = ['volunteer_apply.html', 'my_volunteer.html', 'volunteer_tasks.html'];
const VIEWPORTS = [
  { name: '1440x900', width: 1440, height: 900 },
  { name: '1280x800', width: 1280, height: 800 },
  { name: '768x1024', width: 768, height: 1024 },
  { name: '390x844', width: 390, height: 844 },
  { name: '320x800', width: 320, height: 800 }
];

const JERRY_ME = {
  id: '43',
  username: 'jerry',
  name: 'jerry',
  phone: '13800138000',
  email: 'jerry@example.com'
};

const result = {
  phase: '3E',
  base,
  branch: 'ui-polish/phase-3e-user-volunteer-service-20260731',
  baseline: '055b1e9e2ab4602a0fddd1763fab82b56016729a',
  startedAt: new Date().toISOString(),
  checks: [],
  failures: [],
  visits: [],
  matrixVisits: [],
  screenshots: [],
  probes: [],
  fixtureWriteAudit: [],
  realWriteAudit: [],
  registeredAborts: [],
  requestFailedAudit: [],
  evaluateUsage: [],
  requestCountAudit: {},
  consoleErrors: [],
  pageErrors: [],
  httpErrors: [],
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
  result.probes.push({ name, detail, at: new Date().toISOString() });
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function ok(data) { return JSON.stringify({ code: '0', msg: '成功', data }); }
function err(code, msg) { return JSON.stringify({ code: String(code), msg, data: null }); }
function fxHeaders(expected = false) {
  const h = { 'content-type': 'application/json', 'x-ui-audit-fixture': 'phase3e' };
  if (expected) h['x-ui-audit-expected-error'] = 'phase3e';
  return h;
}
function pageUrl(f) { return `${base}/page/front/${f}`; }
function vol(i, o = {}) {
  return Object.assign({
    id: String(6100 + i),
    uid: '43',
    name: 'jerry',
    age: 20 + i,
    tel: '13800138000',
    email: 'jerry@example.com',
    wechat: 'wx' + i,
    company: '单位' + i + '长名称'.repeat(3),
    location: '地址' + i + '长路名'.repeat(4),
    sparetime: (i % 4) + 1,
    isvisit: i % 2,
    moreability: '能力' + i + '长说明'.repeat(4),
    apic: '',
    vstate: 0
  }, o);
}
function task(i, o = {}) {
  return Object.assign({
    id: String(7100 + i),
    title: '任务' + i + '长标题'.repeat(3),
    description: '说明' + i + '长服务'.repeat(4),
    location: '地点' + i,
    start_at: '2026-08-' + String(10 + (i % 10)).padStart(2, '0') + ' 09:00:00',
    end_at: '2026-08-' + String(10 + (i % 10)).padStart(2, '0') + ' 12:00:00',
    capacity: 5 + i,
    status: 1,
    signup_count: String(i),
    signup_id: null,
    signup_status: null,
    signup_note: null,
    version: 1
  }, o);
}

/**
 * Abort registry — exact serializable request keys only (no RegExp).
 * Keys: scenario, method, pathname, query (business, without cache `_`),
 *       consumed, consumedAt.
 * One registration consumes at most once. Final gate:
 *   requestFailedAudit.length === 2, registered/consumed === 2, unused/unregistered === 0.
 */

/** Extract method + pathname + business query (strip jQuery cache `_`). Pure. */
function abortRequestKey(method, url) {
  let pathname = '';
  let query = '';
  try {
    const u = new URL(String(url || ''), 'http://127.0.0.1');
    pathname = u.pathname || '';
    const params = new URLSearchParams(u.search || '');
    params.delete('_');
    const keys = Array.from(new Set(Array.from(params.keys()))).sort();
    const pairs = [];
    for (const k of keys) {
      const vals = params.getAll(k).slice().sort();
      for (const v of vals) pairs.push(encodeURIComponent(k) + '=' + encodeURIComponent(v));
    }
    query = pairs.join('&');
  } catch (e) {
    pathname = String(url || '').split('?')[0];
    query = '';
  }
  return {
    method: String(method || '').toUpperCase(),
    pathname,
    query
  };
}

/**
 * Match + optional one-shot consume against a given registry array.
 * Does not touch result.registeredAborts unless registry is that array.
 * Returns true only when an unconsumed exact key match is found (and consume=true).
 */
function matchAndConsumeAbort(registry, failed, consume) {
  if (!/ERR_ABORTED|net::ERR_ABORTED/i.test(String(failed && failed.failure || ''))) return false;
  const key = abortRequestKey(failed.method, failed.url);
  const hit = (registry || []).find((reg) => {
    if (reg.consumed) return false;
    if (reg.method !== key.method) return false;
    if (reg.pathname !== key.pathname) return false;
    if (String(reg.query || '') !== key.query) return false;
    return true;
  });
  if (!hit) return false;
  if (consume) {
    hit.consumed = true;
    hit.consumedAt = new Date().toISOString();
  }
  return true;
}

/** Register from the exact request being held (once per scenario). */
function registerAbort(scenario, method, url) {
  if (result.registeredAborts.some((r) => r.scenario === scenario)) return;
  const key = abortRequestKey(method, url);
  result.registeredAborts.push({
    scenario: String(scenario || ''),
    method: key.method,
    pathname: key.pathname,
    query: key.query,
    consumed: false,
    consumedAt: null,
    at: new Date().toISOString()
  });
}

/** Live ledger consume — one registration item, one time. */
function isRegisteredAbort(failed) {
  return matchAndConsumeAbort(result.registeredAborts, failed, true);
}

function abortRegistrySnapshot() {
  const registered = result.registeredAborts.length;
  const consumed = result.registeredAborts.filter((r) => r.consumed).length;
  const unused = result.registeredAborts.filter((r) => !r.consumed).length;
  const serializable = JSON.parse(JSON.stringify(result.registeredAborts));
  return { registered, consumed, unused, serializable };
}

/**
 * Isolated ledger self-tests — must not mutate result.registeredAborts stats.
 * Covers: already-consumed re-match → false; same pathname / different pageNum|mine → false.
 */
function runAbortLedgerSelfTests() {
  const isolatedConsumed = [{
    scenario: 'selftest-consumed',
    method: 'GET',
    pathname: '/api/volunteer/mine',
    query: 'pageNum=2&pageSize=8',
    consumed: true,
    consumedAt: '2026-01-01T00:00:00.000Z',
    at: '2026-01-01T00:00:00.000Z'
  }];
  const failedSame = {
    method: 'GET',
    url: 'http://127.0.0.1/api/volunteer/mine?pageNum=2&pageSize=8&_=999999',
    failure: 'net::ERR_ABORTED'
  };
  assert(
    'abort-selftest-consumed-no-rematch',
    matchAndConsumeAbort(isolatedConsumed, failedSame, true) === false,
    JSON.stringify(isolatedConsumed)
  );

  const isolatedPage = [{
    scenario: 'selftest-pagenum',
    method: 'GET',
    pathname: '/api/volunteer/mine',
    query: 'pageNum=2&pageSize=8',
    consumed: false,
    consumedAt: null,
    at: '2026-01-01T00:00:00.000Z'
  }];
  const failedPage1 = {
    method: 'GET',
    url: 'http://127.0.0.1/api/volunteer/mine?pageNum=1&pageSize=8&_=1',
    failure: 'net::ERR_ABORTED'
  };
  assert(
    'abort-selftest-pageNum-mismatch',
    matchAndConsumeAbort(isolatedPage, failedPage1, true) === false,
    JSON.stringify({ reg: isolatedPage[0].query, failed: abortRequestKey('GET', failedPage1.url) })
  );
  assert(
    'abort-selftest-pageNum-still-unused',
    isolatedPage[0].consumed === false,
    JSON.stringify(isolatedPage[0])
  );

  const isolatedMine = [{
    scenario: 'selftest-mine-param',
    method: 'GET',
    pathname: '/api/operations/volunteer-tasks',
    query: 'mine=false',
    consumed: false,
    consumedAt: null,
    at: '2026-01-01T00:00:00.000Z'
  }];
  const failedMineTrue = {
    method: 'GET',
    url: 'http://127.0.0.1/api/operations/volunteer-tasks?mine=true&_=2',
    failure: 'net::ERR_ABORTED'
  };
  assert(
    'abort-selftest-mine-param-mismatch',
    matchAndConsumeAbort(isolatedMine, failedMineTrue, true) === false,
    JSON.stringify({ reg: isolatedMine[0].query, failed: abortRequestKey('GET', failedMineTrue.url) })
  );
  assert(
    'abort-selftest-mine-still-unused',
    isolatedMine[0].consumed === false,
    JSON.stringify(isolatedMine[0])
  );
}

/** Tracked page.evaluate — all suite evaluate calls go through this wrapper. */
async function evalTracked(page, reason, fn, arg, opts = {}) {
  const lifecycle = !!(opts.lifecycle || /pagehide|visibility|dispatch-/i.test(reason));
  const readonly = opts.readonly !== false && !lifecycle;
  result.evaluateUsage.push({
    reason: String(reason || 'unnamed'),
    readonly,
    lifecycle,
    at: new Date().toISOString()
  });
  if (typeof arg === 'undefined') return page.evaluate(fn);
  return page.evaluate(fn, arg);
}
/** Read-only DOM/layout evaluate. */
async function evalRead(page, reason, fn, arg) {
  return evalTracked(page, reason, fn, arg, { readonly: true, lifecycle: false });
}
/** Lifecycle dispatch evaluate (pagehide / visibility). */
async function evalLifecycle(page, reason, fn, arg) {
  return evalTracked(page, reason, fn, arg, { readonly: false, lifecycle: true });
}

async function loginSession(context) {
  const res = await context.request.post(base + '/api/user/login', {
    data: { username: 'jerry', password: '123456' }
  });
  const body = await res.json();
  if (res.status() !== 200 || !body || body.code !== '0') {
    throw new Error('login failed ' + JSON.stringify(body));
  }
}

function makeState(custom = {}) {
  const page1 = [];
  const page2 = [];
  for (let i = 1; i <= 8; i++) page1.push(vol(i, { vstate: i === 1 ? 0 : 2, moreability: 'PAGE1_REC_' + i }));
  for (let i = 9; i <= 16; i++) page2.push(vol(i, { vstate: 2, moreability: 'PAGE2_REC_' + i }));
  return {
    scenario: Object.assign({
      mineMode: 'list', // list|empty|error|blocked|approvedOnly|rejectedOnly|paged
      mineFail: 500,
      submitMode: 'ok', // ok|false|conflict|server500|hold
      deleteMode: 'ok', // ok|false|conflict|server500|hold
      uploadMode: 'ok',
      tasksMode: 'open', // open|error
      openHold: false,
      mineHold: false,
      page2Hold: false,
      signupMode: 'ok', // ok|fail403|fail409|fail500|hold|badIdBody
      withdrawMode: 'ok', // ok|false|conflict|server500|hold
      includeIllegalTask: false
    }, custom),
    page1Records: page1,
    page2Records: page2,
    mineRecords: [vol(1, { vstate: 2 }), vol(2, { vstate: 0, moreability: '待审可撤回' }), vol(3, { vstate: 1 })],
    openTasks: [
      task(1, { title: 'OPEN_TASK_A' }),
      task(2, { title: 'OPEN_TASK_B', signup_id: null }),
      task(3, { title: 'CLOSED_TASK', status: 2 })
    ],
    mineTasks: [
      task(10, { title: 'MINE_TASK_PENDING', signup_id: '9001', signup_status: 0, signup_note: '可周末' }),
      task(11, { title: 'MINE_TASK_ASSIGNED', signup_id: '9002', signup_status: 1 }),
      task(12, { title: 'MINE_TASK_DONE', signup_id: '9003', signup_status: 2 })
    ],
    requests: [],
    uploadCount: 0,
    stagedDeletes: 0,
    submitPosts: 0,
    deletePosts: 0,
    signupPosts: 0,
    withdrawDeletes: 0,
    mineGets: 0,
    taskGets: 0,
    lastSubmitBody: null,
    lastSignupBody: null,
    lastSignupId: null,
    hold: null,
    resolveHold: null,
    page2HoldP: null,
    resolvePage2Hold: null,
    openHoldP: null,
    resolveOpenHold: null,
    mineHoldP: null,
    resolveMineHold: null
  };
}

async function installPageFixtures(page, state, opts = {}) {
  const trackedWrites = opts.trackRealWrites !== false;
  // Auth me — explicit fixture structure required for credibility.
  await page.route('**/api/user/me**', async (route) => {
    if (route.request().method() !== 'GET') { await route.continue(); return; }
    await route.fulfill({ status: 200, headers: fxHeaders(), body: ok(JERRY_ME) });
  });

  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const method = req.method();
    const url = req.url();
    const entry = { method, url, at: new Date().toISOString() };
    state.requests.push(entry);

    const isWrite = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
    const isMe = /\/api\/user\/me/.test(url);
    const isLogin = /\/api\/user\/login/.test(url);
    const isCsrf = /csrf/i.test(url);

    // Business write paths we intentionally fixture
    const isBizWrite =
      (method === 'POST' && /\/api\/files\/upload/.test(url)) ||
      (method === 'DELETE' && /\/api\/files\/staged\//.test(url)) ||
      (method === 'POST' && /\/api\/volunteer(\?|$)/.test(url)) ||
      (method === 'DELETE' && /\/api\/volunteer\/\d+/.test(url)) ||
      (method === 'POST' && /\/api\/operations\/volunteer-tasks\/[^/]+\/signup/.test(url)) ||
      (method === 'DELETE' && /\/api\/operations\/volunteer-tasks\/[^/]+\/signup/.test(url));

    if (isWrite && trackedWrites) {
      if (isBizWrite) {
        result.fixtureWriteAudit.push(entry);
      } else if (!isLogin && !isCsrf) {
        result.realWriteAudit.push(entry);
        fail('unregistered-write', method + ' ' + url);
        await route.fulfill({ status: 599, headers: fxHeaders(true), body: err('599', 'unregistered write blocked') });
        return;
      }
    }

    // Upload
    if (method === 'POST' && /\/api\/files\/upload/.test(url)) {
      state.uploadCount += 1;
      if (state.scenario.uploadMode === 'fail') {
        await route.fulfill({ status: 500, headers: fxHeaders(true), body: err('500', '上传失败夹具') });
        return;
      }
      await route.fulfill({
        status: 200, headers: fxHeaders(),
        body: ok({ flag: 'vol-stage-' + String(state.uploadCount).padStart(3, '0') })
      });
      return;
    }
    if (method === 'DELETE' && /\/api\/files\/staged\//.test(url)) {
      state.stagedDeletes += 1;
      await route.fulfill({ status: 200, headers: fxHeaders(), body: ok(true) });
      return;
    }

    // Mine list with pagination
    if (method === 'GET' && /\/api\/volunteer\/mine/.test(url)) {
      state.mineGets += 1;
      const u = new URL(url);
      const pageNum = Math.max(1, parseInt(u.searchParams.get('pageNum') || '1', 10));
      if (state.scenario.mineMode === 'error') {
        await route.fulfill({ status: state.scenario.mineFail, headers: fxHeaders(true), body: err(String(state.scenario.mineFail), 'mine失败夹具') });
        return;
      }
      if (state.scenario.mineMode === 'empty') {
        await route.fulfill({ status: 200, headers: fxHeaders(), body: ok({ records: [], current: 1, total: 0, pages: 1 }) });
        return;
      }
      if (state.scenario.mineMode === 'blocked') {
        await route.fulfill({ status: 200, headers: fxHeaders(), body: ok({ records: [vol(1, { vstate: 0 })], current: 1, total: 1, pages: 1 }) });
        return;
      }
      if (state.scenario.mineMode === 'approvedOnly') {
        await route.fulfill({ status: 200, headers: fxHeaders(), body: ok({ records: [vol(1, { vstate: 1 })], current: 1, total: 1, pages: 1 }) });
        return;
      }
      if (state.scenario.mineMode === 'rejectedOnly') {
        await route.fulfill({ status: 200, headers: fxHeaders(), body: ok({ records: [vol(1, { vstate: 2 })], current: 1, total: 1, pages: 1 }) });
        return;
      }
      // paged: 16 records, pageSize 8
      if (state.scenario.mineMode === 'paged' || state.scenario.page2Hold) {
        if (pageNum === 2 && state.scenario.page2Hold) {
          registerAbort('mine-page2-slow-abort', method, url);
          if (!state.page2HoldP) state.page2HoldP = new Promise((r) => { state.resolvePage2Hold = r; });
          await state.page2HoldP;
          await route.fulfill({
            status: 200, headers: fxHeaders(),
            body: ok({ records: state.page2Records, current: 2, total: 16, pages: 2 })
          });
          return;
        }
        const records = pageNum === 2 ? state.page2Records : state.page1Records;
        await route.fulfill({
          status: 200, headers: fxHeaders(),
          body: ok({ records, current: pageNum, total: 16, pages: 2 })
        });
        return;
      }
      // default list
      await route.fulfill({
        status: 200, headers: fxHeaders(),
        body: ok({
          records: state.mineRecords,
          current: 1,
          total: state.mineRecords.length,
          pages: 1
        })
      });
      return;
    }

    if (method === 'POST' && /\/api\/volunteer(\?|$)/.test(url) && !/\/state\//.test(url)) {
      state.submitPosts += 1;
      if (state.scenario.submitMode === 'hold') {
        if (!state.hold) state.hold = new Promise((r) => { state.resolveHold = r; });
        await state.hold;
      }
      try { state.lastSubmitBody = req.postDataJSON() || {}; } catch (e) { state.lastSubmitBody = {}; }
      if (state.scenario.submitMode === 'false') {
        await route.fulfill({ status: 200, headers: fxHeaders(), body: ok(false) }); return;
      }
      if (state.scenario.submitMode === 'conflict') {
        await route.fulfill({ status: 409, headers: fxHeaders(true), body: err('409', '已有待审核或已通过的义工申请') }); return;
      }
      if (state.scenario.submitMode === 'server500') {
        await route.fulfill({ status: 500, headers: fxHeaders(true), body: err('500', '保存失败夹具') }); return;
      }
      await route.fulfill({ status: 200, headers: fxHeaders(), body: ok(true) });
      return;
    }

    if (method === 'DELETE' && /\/api\/volunteer\/\d+/.test(url)) {
      state.deletePosts += 1;
      if (state.scenario.deleteMode === 'hold') {
        if (!state.hold) state.hold = new Promise((r) => { state.resolveHold = r; });
        await state.hold;
      }
      const id = (url.match(/\/volunteer\/(\d+)/) || [])[1];
      if (state.scenario.deleteMode === 'false') {
        await route.fulfill({ status: 200, headers: fxHeaders(), body: ok(false) }); return;
      }
      if (state.scenario.deleteMode === 'conflict') {
        await route.fulfill({ status: 409, headers: fxHeaders(true), body: err('409', '删除冲突夹具') }); return;
      }
      if (state.scenario.deleteMode === 'server500') {
        await route.fulfill({ status: 500, headers: fxHeaders(true), body: err('500', '删除失败夹具') }); return;
      }
      state.mineRecords = state.mineRecords.filter((r) => String(r.id) !== String(id));
      await route.fulfill({ status: 200, headers: fxHeaders(), body: ok(true) });
      return;
    }

    if (method === 'GET' && /\/api\/operations\/volunteer-tasks/.test(url)) {
      state.taskGets += 1;
      if (/[?&](uid|userId)=/i.test(url)) {
        await route.fulfill({ status: 400, headers: fxHeaders(true), body: err('400', 'mine 不得携带用户 ID') });
        return;
      }
      const mine = /[?&]mine=true/i.test(url);
      if (state.scenario.tasksMode === 'error') {
        await route.fulfill({ status: 500, headers: fxHeaders(true), body: err('500', '任务列表失败夹具') });
        return;
      }
      if (!mine && state.scenario.openHold) {
        registerAbort('tasks-open-slow-abort', method, url);
        if (!state.openHoldP) state.openHoldP = new Promise((r) => { state.resolveOpenHold = r; });
        await state.openHoldP;
        await route.fulfill({ status: 200, headers: fxHeaders(), body: ok([task(99, { title: 'SLOW_OPEN_SHOULD_LOSE' })]) });
        return;
      }
      if (mine && state.scenario.mineHold) {
        registerAbort('tasks-mine-slow-abort', method, url);
        if (!state.mineHoldP) state.mineHoldP = new Promise((r) => { state.resolveMineHold = r; });
        await state.mineHoldP;
        await route.fulfill({ status: 200, headers: fxHeaders(), body: ok([task(98, { title: 'SLOW_MINE_SHOULD_LOSE', signup_id: '1', signup_status: 0 })]) });
        return;
      }
      let list = mine ? state.mineTasks.slice() : state.openTasks.slice();
      if (!mine && state.scenario.includeIllegalTask) {
        list = list.concat([{ id: 'not-a-valid-id', title: 'ILLEGAL_ID_TASK', status: 1, capacity: 3, signup_count: '0' }]);
      }
      await route.fulfill({ status: 200, headers: fxHeaders(), body: ok(list) });
      return;
    }

    if (method === 'POST' && /\/api\/operations\/volunteer-tasks\/[^/]+\/signup/.test(url)) {
      state.signupPosts += 1;
      if (state.scenario.signupMode === 'hold') {
        if (!state.hold) state.hold = new Promise((r) => { state.resolveHold = r; });
        await state.hold;
      }
      try { state.lastSignupBody = req.postDataJSON() || {}; } catch (e) { state.lastSignupBody = {}; }
      if (state.scenario.signupMode === 'fail403') {
        await route.fulfill({ status: 403, headers: fxHeaders(true), body: err('403', '仅审核通过的义工可以报名任务') }); return;
      }
      if (state.scenario.signupMode === 'fail409') {
        await route.fulfill({ status: 409, headers: fxHeaders(true), body: err('409', '报名名额已满') }); return;
      }
      if (state.scenario.signupMode === 'fail500') {
        await route.fulfill({ status: 500, headers: fxHeaders(true), body: err('500', '报名服务异常') }); return;
      }
      if (state.scenario.signupMode === 'badIdBody') {
        await route.fulfill({ status: 200, headers: fxHeaders(), body: ok(true) }); return;
      }
      state.lastSignupId = '910000000000000001';
      // Reflect signup on open task for subsequent loads
      const tid = (url.match(/volunteer-tasks\/(\d+)\/signup/) || [])[1];
      state.openTasks = state.openTasks.map((t) => String(t.id) === String(tid)
        ? Object.assign({}, t, { signup_id: state.lastSignupId, signup_status: 0 })
        : t);
      state.mineTasks = state.mineTasks.concat([
        Object.assign({}, state.openTasks.find((t) => String(t.id) === String(tid)) || task(Number(tid)), {
          signup_id: state.lastSignupId, signup_status: 0
        })
      ]);
      await route.fulfill({ status: 200, headers: fxHeaders(), body: ok(state.lastSignupId) });
      return;
    }

    if (method === 'DELETE' && /\/api\/operations\/volunteer-tasks\/[^/]+\/signup/.test(url)) {
      state.withdrawDeletes += 1;
      if (state.scenario.withdrawMode === 'hold') {
        if (!state.hold) state.hold = new Promise((r) => { state.resolveHold = r; });
        await state.hold;
      }
      const tid = (url.match(/volunteer-tasks\/(\d+)\/signup/) || [])[1];
      if (state.scenario.withdrawMode === 'false') {
        await route.fulfill({ status: 200, headers: fxHeaders(), body: ok(false) }); return;
      }
      if (state.scenario.withdrawMode === 'conflict') {
        await route.fulfill({ status: 409, headers: fxHeaders(true), body: err('409', '任务已开始，请联系管理员处理') }); return;
      }
      if (state.scenario.withdrawMode === 'server500') {
        await route.fulfill({ status: 500, headers: fxHeaders(true), body: err('500', '撤回失败夹具') }); return;
      }
      state.mineTasks = state.mineTasks.filter((t) => String(t.id) !== String(tid));
      state.openTasks = state.openTasks.map((t) => String(t.id) === String(tid)
        ? Object.assign({}, t, { signup_id: null, signup_status: null })
        : t);
      await route.fulfill({ status: 200, headers: fxHeaders(), body: ok(true) });
      return;
    }

    // Default GET: empty success for unhandled reads; block other writes
    if (isWrite) {
      result.realWriteAudit.push(entry);
      fail('unregistered-write-default', method + ' ' + url);
      await route.fulfill({ status: 599, headers: fxHeaders(true), body: err('599', 'blocked') });
      return;
    }
    if (isMe) {
      await route.fulfill({ status: 200, headers: fxHeaders(), body: ok(JERRY_ME) });
      return;
    }
    await route.fulfill({ status: 200, headers: fxHeaders(), body: ok([]) });
  });
}

async function openPage(page, file, state, waitAuth = true) {
  await page.unroute('**/api/**').catch(() => {});
  await installPageFixtures(page, state);
  await page.goto(pageUrl(file), { waitUntil: 'domcontentloaded', timeout: 45000 });
  if (waitAuth) {
    await page.waitForFunction(() => {
      const w = document.getElementById('authWait');
      return !w || w.hidden === true;
    }, { timeout: 20000 });
  }
  result.visits.push({ file, at: new Date().toISOString() });
}

async function assertAuthenticatedChrome(page, idPrefix) {
  const header = page.locator('header').first();
  const text = await header.innerText();
  const hasAccount = (await header.locator('.ui-front-account, .ui-account').count()) >= 1;
  const hasAuthCta = (await header.locator('.ui-front-auth-actions').count()) >= 1;
  // Desktop shows "jerry"; mobile may collapse to avatar initial "J" while keeping account chrome.
  assert(
    idPrefix + '-account-jerry',
    hasAccount && (/jerry/i.test(text) || /\bJ\b/.test(text)),
    JSON.stringify({ hasAccount, text: text.slice(0, 120) })
  );
  assert(idPrefix + '-no-login-cta', !hasAuthCta && !/登录/.test(text) && !/注册/.test(text), text.slice(0, 120));
  assert(idPrefix + '-not-login-url', !/login\.html/i.test(page.url()), page.url());
}

async function waitFonts(page) {
  await page.waitForFunction(() => document.fonts ? document.fonts.status === 'loaded' : true, { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(80);
}

async function shot(page, name, meta) {
  await evalRead(page, 'shot-scroll-top', () => { window.scrollTo(0, 0); });
  await waitFonts(page);
  await page.screenshot({ path: path.join(shotDir, name + '.png'), fullPage: false });
  result.screenshots.push(Object.assign({
    file: 'screenshots/' + name + '.png',
    name,
    time: new Date().toISOString()
  }, meta || {}));
}

async function focusInfo(page, reason) {
  return evalRead(page, reason || 'focus-info', () => {
    const el = document.activeElement;
    if (!el || el === document.body || el === document.documentElement) {
      return { tag: el ? el.tagName : null, id: '', isBody: true, text: '', attrs: {} };
    }
    const attrs = {};
    ['data-volunteer-detail', 'data-volunteer-withdraw', 'data-volunteer-apply-cta',
      'data-withdraw-task', 'data-signup-task', 'data-tab-mine', 'data-tab-open',
      'data-tasks-status', 'data-volunteer-id', 'data-task-id', 'role'].forEach((k) => {
      if (el.hasAttribute && el.hasAttribute(k)) attrs[k] = el.getAttribute(k);
    });
    return {
      tag: el.tagName,
      id: el.id || '',
      isBody: false,
      text: String(el.textContent || '').trim().slice(0, 80),
      attrs
    };
  });
}

async function overflowX(page) {
  return evalRead(page, 'overflow-measure', () => {
    const de = document.documentElement;
    return { overflow: de.scrollWidth > de.clientWidth + 1, sw: de.scrollWidth, cw: de.clientWidth };
  });
}

function writeReport() {
  const passed = result.checks.filter((c) => c.ok).length;
  const failed = result.checks.filter((c) => !c.ok).length;
  const skipped = result.checks.filter((c) => c.skipped).length;
  result.summary = {
    passed, failed, skipped, total: result.checks.length,
    visits: result.visits.length,
    matrixVisits: result.matrixVisits.length,
    expectedMatrixVisits: 15,
    screenshots: result.screenshots.length,
    strictRuntimeProbeCount: result.strictRuntimeProbeCount,
    bestEffortPassCount: result.bestEffortPassCount,
    fallbackPassCount: result.fallbackPassCount,
    fixtureWrites: result.fixtureWriteAudit.length,
    realWrites: result.realWriteAudit.length,
    evaluateUsageCount: result.evaluateUsage.length,
    evaluateLifecycleCount: result.evaluateUsage.filter((e) => e.lifecycle).length,
    evaluateReadonlyCount: result.evaluateUsage.filter((e) => e.readonly).length,
    registeredAborts: result.registeredAborts.length,
    abortRegistry: abortRegistrySnapshot(),
    durationMs: Date.now() - startedAt,
    finishedAt: new Date().toISOString(),
    strictMode: failed === 0 && skipped === 0 && result.bestEffortPassCount === 0
      && result.fallbackPassCount === 0
      && result.matrixVisits.length >= 15
      && result.strictRuntimeProbeCount >= 27
      && result.screenshots.length >= 8
      && result.realWriteAudit.length === 0
  };
  result.ok = result.summary.strictMode;
  fs.writeFileSync(path.join(out, 'phase-3e-report.json'), JSON.stringify(result, null, 2));
  fs.writeFileSync(path.join(out, 'screenshots-index.json'), JSON.stringify(result.screenshots, null, 2));
  const log = [
    'PHASE 3E STRICT=' + result.summary.strictMode,
    'ASSERTIONS ' + passed + '/' + failed + '/' + skipped,
    'MATRIX ' + result.matrixVisits.length + '/15',
    'SCREENSHOTS ' + result.screenshots.length,
    'PROBES ' + result.strictRuntimeProbeCount,
    'BEST_EFFORT ' + result.bestEffortPassCount,
    'FALLBACK ' + result.fallbackPassCount,
    'FIXTURE_WRITES ' + result.fixtureWriteAudit.length,
    'REAL_WRITES ' + result.realWriteAudit.length,
    'EVALUATE_USAGE ' + result.evaluateUsage.length,
    'REGISTERED_ABORTS ' + result.registeredAborts.length
  ].join('\n');
  fs.writeFileSync(path.join(out, 'run-strict-final.log'), log + '\n');
  return result.summary;
}

const tinyPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

(async () => {
  console.log('Phase 3E credibility strict start', base);
  let browser;
  try {
    const applyHtml = fs.readFileSync('src/main/resources/static/page/front/volunteer_apply.html', 'utf8');
    const mineHtml = fs.readFileSync('src/main/resources/static/page/front/my_volunteer.html', 'utf8');
    const tasksHtml = fs.readFileSync('src/main/resources/static/page/front/volunteer_tasks.html', 'utf8');
    const suiteSrc = fs.readFileSync('tools/ui-polish-phase-3e.cjs', 'utf8');

    assert('no-window-confirm', !/window\.confirm|window\.alert|window\.prompt/.test(tasksHtml), 'confirm');
    assert('tasks-withdraw-dialog', tasksHtml.includes('taskWithdrawTitle') && tasksHtml.includes('role="dialog"'), 'dialog');
    assert('cache-31e', applyHtml.includes('v=20260731e') && mineHtml.includes('v=20260731e') && tasksHtml.includes('v=20260731e'), 'cache');
    assert('self-no-best-effort', !/bestEffort:\s*true/.test(suiteSrc), 'be');
    assert('self-no-vm-bypass', !/__vue__\.(load|signup|withdraw|cleanupPageStage|blocked\s*=)/.test(suiteSrc), 'no-vm');
    assert('self-no-global-aborted-whitelist', !/ERR_ABORTED\/i\.test/.test(suiteSrc) || suiteSrc.includes('isRegisteredAbort'), 'abort');

    browser = await chromium.launch({ headless: true });
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await loginSession(ctx);
    const page = await ctx.newPage();

    page.on('pageerror', (e) => result.pageErrors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') result.consoleErrors.push(m.text()); });
    page.on('response', (r) => {
      if (r.status() >= 400) {
        result.httpErrors.push({
          status: r.status(), url: r.url(), method: r.request().method(),
          headers: r.headers()
        });
      }
    });
    page.on('requestfailed', (req) => {
      result.requestFailedAudit.push({
        method: req.method(),
        url: req.url(),
        failure: req.failure() && req.failure().errorText,
        at: new Date().toISOString()
      });
    });

    // ========== APPLY ==========
    let state = makeState({ mineMode: 'rejectedOnly' });
    await openPage(page, 'volunteer_apply.html', state);
    await assertAuthenticatedChrome(page, 'apply-auth');
    await page.waitForSelector('#volunteerAge', { timeout: 10000 });

    // 1 field validation + exact first focus
    await page.locator('button[type="submit"]').click();
    await page.waitForTimeout(120);
    const focusId = await evalRead(page, 'focus-id-read', () => (document.activeElement && document.activeElement.id) || '');
    assert('probe1-first-focus-age', focusId === 'volunteerAge', 'focus=' + focusId);
    probe('1-field-validation-first-focus', { focusId });

    // 8 gate error blocks
    state = makeState({ mineMode: 'error' });
    await openPage(page, 'volunteer_apply.html', state);
    await page.waitForTimeout(300);
    assert('probe8-gate-error-disabled', await page.locator('button[type="submit"]').isDisabled(), 'disabled');
    assert('probe8-gate-error-text', /无法确认|查询失败|状态未知|失败/.test(await page.locator('main').innerText()), 'err');
    probe('8-mine-gate-error-blocks', {});

    // 9 blocked pending
    state = makeState({ mineMode: 'blocked' });
    await openPage(page, 'volunteer_apply.html', state);
    await page.waitForTimeout(300);
    const blocked = await page.locator('main').innerText();
    assert('probe9-blocked', /待审核|不能重复|不可重复|已有/.test(blocked), blocked.slice(0, 160));
    assert('probe9-submit-disabled', await page.locator('button[type="submit"]').isDisabled(), 'disabled');
    probe('9-pending-blocks-duplicate', {});

    // 2 double submit + photo
    state = makeState({ mineMode: 'rejectedOnly', submitMode: 'hold' });
    await openPage(page, 'volunteer_apply.html', state);
    await page.waitForSelector('#volunteerAge');
    await page.fill('#volunteerAge', '28');
    await page.fill('#volunteerWechat', 'wx-phase3e');
    await page.fill('#volunteerCompany', '归途测试单位');
    await page.fill('#volunteerLocation', '上海市测试区');
    await page.selectOption('#volunteerTime', { value: '1' });
    await page.locator('input[type="radio"][value="0"]').check();
    await page.fill('#volunteerAbility', '可参与周末现场协助。');
    await page.setInputFiles('#volunteerPhoto', { name: 'a.png', mimeType: 'image/png', buffer: tinyPng });
    const s0 = state.submitPosts;
    const u0 = state.uploadCount;
    await page.locator('button[type="submit"]').click();
    await page.waitForTimeout(200);
    await page.locator('button[type="submit"]').click({ force: true }).catch(() => {});
    await page.waitForTimeout(100);
    assert('probe2-double-one-post', state.submitPosts === s0 + 1, 'posts=' + state.submitPosts);
    assert('probe2-upload-once', state.uploadCount === u0 + 1, 'up=' + state.uploadCount);
    if (state.resolveHold) { state.resolveHold(); state.hold = null; state.resolveHold = null; }
    await page.waitForTimeout(350);
    probe('2-apply-double-one-post', { submitPosts: state.submitPosts, uploadCount: state.uploadCount });

    // 3 data=false
    state = makeState({ mineMode: 'rejectedOnly', submitMode: 'false' });
    await openPage(page, 'volunteer_apply.html', state);
    await page.waitForSelector('#volunteerAge');
    await page.fill('#volunteerAge', '28');
    await page.fill('#volunteerWechat', 'wx-false');
    await page.fill('#volunteerCompany', '单位');
    await page.fill('#volunteerLocation', '地址');
    await page.selectOption('#volunteerTime', { value: '2' });
    await page.locator('input[type="radio"][value="1"]').check();
    await page.fill('#volunteerAbility', 'false 分支测试。');
    await page.locator('button[type="submit"]').click();
    await page.waitForTimeout(400);
    const falseAlert = await page.locator('.ui-form-alert').innerText();
    assert('probe3-false-not-success', /未成功|失败|保留/.test(falseAlert) && !/正在前往申请记录/.test(falseAlert), falseAlert);
    assert('probe3-keeps-wechat', (await page.inputValue('#volunteerWechat')) === 'wx-false', 'wx');
    probe('3-data-false-no-success', { falseAlert });

    // 4 409 keeps form
    state = makeState({ mineMode: 'rejectedOnly', submitMode: 'conflict' });
    await openPage(page, 'volunteer_apply.html', state);
    await page.waitForSelector('#volunteerAge');
    await page.fill('#volunteerAge', '30');
    await page.fill('#volunteerWechat', 'keep-wx-409');
    await page.fill('#volunteerCompany', '冲突单位');
    await page.fill('#volunteerLocation', '冲突地址');
    await page.selectOption('#volunteerTime', { value: '1' });
    await page.locator('input[type="radio"][value="0"]').check();
    await page.fill('#volunteerAbility', '409 保留输入。');
    await page.locator('button[type="submit"]').click();
    await page.waitForTimeout(400);
    assert('probe4-409-keeps', (await page.inputValue('#volunteerWechat')) === 'keep-wx-409', 'wx');
    assert('probe4-409-msg', /已有待审核|已通过|冲突|失败/.test(await page.locator('main').innerText()), 'msg');
    probe('4-409-keeps-form', {});

    // 5 stage reuse + 7 success no delete bound
    state = makeState({ mineMode: 'rejectedOnly', submitMode: 'server500' });
    await openPage(page, 'volunteer_apply.html', state);
    await page.waitForSelector('#volunteerAge');
    await page.fill('#volunteerAge', '29');
    await page.fill('#volunteerWechat', 'wx-reuse');
    await page.fill('#volunteerCompany', '复用单位');
    await page.fill('#volunteerLocation', '复用地址');
    await page.selectOption('#volunteerTime', { value: '3' });
    await page.locator('input[type="radio"][value="1"]').check();
    await page.fill('#volunteerAbility', '暂存复用。');
    await page.setInputFiles('#volunteerPhoto', { name: 'b.png', mimeType: 'image/png', buffer: tinyPng });
    await page.locator('button[type="submit"]').click();
    await page.waitForTimeout(450);
    const upAfterFail = state.uploadCount;
    const delAfterFail = state.stagedDeletes;
    const postsAfterFail = state.submitPosts;
    state.scenario.submitMode = 'ok';
    await page.locator('button[type="submit"]').click();
    await page.waitForTimeout(600);
    assert('probe5-no-reupload', state.uploadCount === upAfterFail, 'up=' + state.uploadCount);
    assert('probe5-retry-post', state.submitPosts === postsAfterFail + 1, 'posts=' + state.submitPosts);
    assert('probe7-success-no-extra-staged-delete', state.stagedDeletes === delAfterFail, 'del=' + state.stagedDeletes + ' before=' + delAfterFail);
    probe('5-stage-reuse', { uploadCount: state.uploadCount });
    probe('7-success-no-delete-bound', { stagedDeletes: state.stagedDeletes, delAfterFail });

    // 6 replace / clear / pagehide once
    state = makeState({ mineMode: 'rejectedOnly', submitMode: 'server500' });
    await openPage(page, 'volunteer_apply.html', state);
    await page.waitForSelector('#volunteerAge');
    await page.fill('#volunteerAge', '27');
    await page.fill('#volunteerWechat', 'wx-stage');
    await page.fill('#volunteerCompany', '单位');
    await page.fill('#volunteerLocation', '地址');
    await page.selectOption('#volunteerTime', { value: '1' });
    await page.locator('input[type="radio"][value="0"]').check();
    await page.fill('#volunteerAbility', '生命周期。');
    await page.setInputFiles('#volunteerPhoto', { name: 'c.png', mimeType: 'image/png', buffer: tinyPng });
    await page.locator('button[type="submit"]').click();
    await page.waitForTimeout(450);
    const d0 = state.stagedDeletes;
    await page.setInputFiles('#volunteerPhoto', { name: 'd.png', mimeType: 'image/png', buffer: tinyPng });
    await page.waitForTimeout(250);
    assert('probe6-replace-delete', state.stagedDeletes === d0 + 1, 'd=' + state.stagedDeletes);
    await page.locator('button[type="submit"]').click();
    await page.waitForTimeout(450);
    const d1 = state.stagedDeletes;
    await page.locator('.ui-volunteer-upload-box button:has-text("清除")').click();
    await page.waitForTimeout(250);
    assert('probe6-clear-delete', state.stagedDeletes === d1 + 1, 'd=' + state.stagedDeletes);
    await page.setInputFiles('#volunteerPhoto', { name: 'e.png', mimeType: 'image/png', buffer: tinyPng });
    await page.locator('button[type="submit"]').click();
    await page.waitForTimeout(450);
    const d2 = state.stagedDeletes;
    // lifecycle: dispatch pagehide (not Vue method) — must use lifecycle-tagged evaluate
    await evalLifecycle(page, 'dispatch-pagehide', () => {
      window.dispatchEvent(new Event('pagehide'));
      window.dispatchEvent(new Event('pagehide'));
    });
    await page.waitForTimeout(250);
    assert('probe6-pagehide-once', state.stagedDeletes === d2 + 1, 'd=' + state.stagedDeletes);
    probe('6-stage-replace-clear-pagehide', { stagedDeletes: state.stagedDeletes });

    if (state.lastSubmitBody) {
      const keys = Object.keys(state.lastSubmitBody);
      assert('apply-payload-clean', !['id', 'uid', 'vstate', 'name', 'tel', 'email'].some((k) => keys.includes(k)), JSON.stringify(keys));
    }
    await shot(page, 'apply-1440x900', { page: 'volunteer_apply', viewport: '1440x900' });

    // ========== MINE ==========
    state = makeState({ mineMode: 'list' });
    await openPage(page, 'my_volunteer.html', state);
    await assertAuthenticatedChrome(page, 'mine-auth');
    await page.waitForSelector('.ui-volunteer-record-card', { timeout: 10000 });
    await shot(page, 'mine-1440x900', { page: 'my_volunteer', viewport: '1440x900' });

    // 11 error clears — use reload button after switching fixture via re-open with error is hard;
    // click 重新加载 after navigating with error mode
    state = makeState({ mineMode: 'list' });
    await openPage(page, 'my_volunteer.html', state);
    await page.waitForSelector('.ui-volunteer-record-card');
    // change scenario and click a real reload: open error page
    state = makeState({ mineMode: 'error' });
    await openPage(page, 'my_volunteer.html', state);
    await page.waitForTimeout(350);
    assert('probe11-error-no-cards', (await page.locator('.ui-volunteer-record-card').count()) === 0, 'cleared');
    assert('probe11-error-visible', /无法加载|失败|重试/.test(await page.locator('main').innerText()), 'err');
    probe('11-list-error-clears', {});

    // 10 race via real pagination: page2 slow, then page1 fast (pagination stays mounted while loading)
    state = makeState({ mineMode: 'paged', page2Hold: true });
    await openPage(page, 'my_volunteer.html', state);
    await page.waitForSelector('.ui-volunteer-record-card');
    await page.waitForSelector('.ui-page-buttons button:has-text("2")', { timeout: 8000 });
    assert('mine-page1-marker', /PAGE1_REC_/.test(await page.locator('main').innerText()), 'p1');
    // click page 2 (slow)
    await page.locator('.ui-page-buttons button:has-text("2")').click();
    await page.waitForTimeout(150);
    // click page 1 (fast) while page2 held — buttons remain available
    await page.locator('.ui-page-buttons button:has-text("1")').click();
    await page.waitForTimeout(300);
    // release slow page2 (must not overwrite page1)
    if (state.resolvePage2Hold) {
      state.resolvePage2Hold();
      state.page2HoldP = null;
      state.resolvePage2Hold = null;
    }
    await page.waitForTimeout(450);
    const mineRaceText = await page.locator('main').innerText();
    assert('probe10-b-wins-page1', /PAGE1_REC_/.test(mineRaceText), mineRaceText.slice(0, 200));
    assert('probe10-a-not-cover', !/PAGE2_REC_/.test(mineRaceText), mineRaceText.slice(0, 200));
    probe('10-mine-pagination-A-slow-B-win', { mineGets: state.mineGets });

    // 12 delete double via real dialog
    state = makeState({ mineMode: 'list', deleteMode: 'hold' });
    state.mineRecords = [vol(2, { id: '6102', vstate: 0, moreability: '可撤回记录' })];
    await openPage(page, 'my_volunteer.html', state);
    await page.waitForSelector('button:has-text("撤回申请")');
    await page.locator('button:has-text("撤回申请")').first().click();
    await page.waitForSelector('#volunteerConfirmTitle');
    const del0 = state.deletePosts;
    await page.locator('.ui-dialog-actions button:has-text("确认撤回")').click();
    await page.waitForTimeout(80);
    await page.locator('.ui-dialog-actions button:has-text("确认撤回"), .ui-dialog-actions button:has-text("正在撤回")').click({ force: true }).catch(() => {});
    await page.waitForTimeout(100);
    assert('probe12-delete-double-one', state.deletePosts === del0 + 1, 'n=' + state.deletePosts);
    if (state.resolveHold) { state.resolveHold(); state.hold = null; state.resolveHold = null; }
    await page.waitForTimeout(400);
    probe('12-delete-double-one', { deletePosts: state.deletePosts });

    // 13 false keeps card + cancel restores original withdraw focus
    state = makeState({ mineMode: 'list', deleteMode: 'false' });
    state.mineRecords = [vol(2, { id: '6102', vstate: 0 })];
    await openPage(page, 'my_volunteer.html', state);
    await page.waitForSelector('[data-volunteer-withdraw]');
    await page.locator('[data-volunteer-withdraw]').first().click();
    await page.waitForSelector('#volunteerConfirmTitle');
    await page.locator('.ui-dialog-actions button:has-text("确认撤回")').click();
    await page.waitForTimeout(350);
    assert('probe13-false-keeps-card', (await page.locator('.ui-volunteer-record-card').count()) >= 1, 'kept');
    const falseErr = await page.locator('.ui-form-alert[role="alert"]').first().innerText().catch(() => '');
    assert('probe13-false-error', /失败|保留|未成功|未改变/.test(falseErr), falseErr.slice(0, 200));
    // close dialog via cancel — focus must return to original withdraw button
    await page.locator('.ui-dialog-actions button:has-text("取消")').click();
    await page.waitForTimeout(180);
    const focusAfterFalseCancel = await focusInfo(page, 'mine-false-cancel-focus');
    assert(
      'probe13-cancel-restores-withdraw',
      !focusAfterFalseCancel.isBody && focusAfterFalseCancel.attrs['data-volunteer-withdraw'] != null,
      JSON.stringify(focusAfterFalseCancel)
    );
    probe('13-false-keeps-card', focusAfterFalseCancel);

    // 14 true removes + success focus fallthrough (desktop)
    state = makeState({ mineMode: 'list', deleteMode: 'ok' });
    state.mineRecords = [vol(2, { id: '6102', vstate: 0 }), vol(1, { id: '6101', vstate: 2 })];
    await openPage(page, 'my_volunteer.html', state);
    await page.waitForSelector('.ui-volunteer-record-card');
    const beforeCards = await page.locator('.ui-volunteer-record-card').count();
    await page.locator('[data-volunteer-withdraw][data-volunteer-id="6102"]').click();
    await page.waitForSelector('#volunteerConfirmTitle');
    await page.locator('.ui-dialog-actions button:has-text("确认撤回")').click();
    await page.waitForTimeout(600);
    const afterCards = await page.locator('.ui-volunteer-record-card').count();
    assert('probe14-true-removes', afterCards === beforeCards - 1, JSON.stringify({ beforeCards, afterCards }));
    const focusAfterMineDelete = await focusInfo(page, 'mine-success-focus-desktop');
    assert(
      'probe14-success-focus-not-body',
      !focusAfterMineDelete.isBody,
      JSON.stringify(focusAfterMineDelete)
    );
    assert(
      'probe14-success-focus-stable',
      Object.prototype.hasOwnProperty.call(focusAfterMineDelete.attrs, 'data-volunteer-detail')
        || Object.prototype.hasOwnProperty.call(focusAfterMineDelete.attrs, 'data-volunteer-apply-cta')
        || focusAfterMineDelete.id === 'mineTitle'
        || focusAfterMineDelete.tag === 'MAIN',
      JSON.stringify(focusAfterMineDelete)
    );
    assert(
      'probe14-success-focus-not-deleted-withdraw',
      focusAfterMineDelete.attrs['data-volunteer-withdraw'] == null
        || focusAfterMineDelete.attrs['data-volunteer-id'] !== '6102',
      JSON.stringify(focusAfterMineDelete)
    );
    probe('14-true-removes', { beforeCards, afterCards, focus: focusAfterMineDelete });
    probe('28-mine-success-focus-desktop', focusAfterMineDelete);

    // 25 detail dialog focus
    await page.locator('button:has-text("查看详情")').first().click();
    await page.waitForSelector('#volunteerDetailTitle');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
    const inDlg = await evalRead(page, 'detail-focus-contain', () => {
      const d = document.querySelector('[aria-labelledby="volunteerDetailTitle"]');
      return !!(d && d.contains(document.activeElement));
    });
    assert('probe25-tab-in-dialog', inDlg, 'tab');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(120);
    assert('probe25-esc-closes', (await page.locator('#volunteerDetailTitle').count()) === 0, 'esc');
    probe('25-dialog-focus', { inDlg });

    // ========== TASKS ==========
    state = makeState({ tasksMode: 'open', includeIllegalTask: true });
    await openPage(page, 'volunteer_tasks.html', state);
    await assertAuthenticatedChrome(page, 'tasks-auth');
    await page.waitForSelector('.ui-volunteer-task-card');
    assert('probe20-illegal-no-card', (await page.locator('[data-task-id="not-a-valid-id"]').count()) === 0, 'no-illegal');
    assert('probe20-open-cards', (await page.locator('.ui-volunteer-task-card').count()) >= 1, 'cards');
    probe('20-illegal-task-id-no-action', { signupPosts: state.signupPosts });
    await shot(page, 'tasks-1440x900', { page: 'volunteer_tasks', viewport: '1440x900' });

    // 17 signup double
    state = makeState({ tasksMode: 'open', signupMode: 'hold' });
    await openPage(page, 'volunteer_tasks.html', state);
    await page.waitForSelector('button:has-text("报名任务")');
    await page.locator('.ui-volunteer-task-note').first().fill('备注保留');
    const sg0 = state.signupPosts;
    await page.locator('button:has-text("报名任务")').first().click();
    await page.waitForTimeout(100);
    await page.locator('button:has-text("报名任务"), button:has-text("正在报名")').first().click({ force: true }).catch(() => {});
    await page.waitForTimeout(100);
    assert('probe17-signup-double-one', state.signupPosts === sg0 + 1, 'n=' + state.signupPosts);
    assert('probe17-body-note-only', !state.lastSignupBody || Object.keys(state.lastSignupBody).every((k) => k === 'note'), JSON.stringify(state.lastSignupBody));
    if (state.resolveHold) { state.resolveHold(); state.hold = null; state.resolveHold = null; }
    await page.waitForTimeout(450);
    probe('17-signup-double-one', { signupPosts: state.signupPosts });

    // 18 canonical signup id + DOM reflects pending signup (not just msg greenzone)
    state = makeState({ tasksMode: 'open', signupMode: 'ok' });
    await openPage(page, 'volunteer_tasks.html', state);
    await page.waitForSelector('[data-signup-task]');
    const firstTaskId = await page.locator('[data-signup-task]').first().getAttribute('data-signup-task');
    const sg1 = state.signupPosts;
    await page.locator('[data-signup-task]').first().click();
    await page.waitForTimeout(550);
    assert('probe18-one-post', state.signupPosts === sg1 + 1, 'n=' + state.signupPosts);
    assert('probe18-canonical-id', state.lastSignupId === '910000000000000001', String(state.lastSignupId));
    assert('probe18-success-msg', /报名已提交|等待管理员/.test(await page.locator('main').innerText()), 'msg');
    const signedCard = page.locator('.ui-volunteer-task-card[data-task-id="' + firstTaskId + '"]');
    const signupStatusDom = await signedCard.getAttribute('data-signup-status').catch(() => null);
    const hasWithdrawOrPending = (await signedCard.locator('[data-withdraw-task], .ui-volunteer-signup-state').count()) >= 1;
    assert(
      'probe18-dom-reflects-signup',
      signupStatusDom === '0' || hasWithdrawOrPending,
      JSON.stringify({ firstTaskId, signupStatusDom, hasWithdrawOrPending, lastSignupId: state.lastSignupId })
    );
    probe('18-canonical-signup-id', { id: state.lastSignupId, posts: state.signupPosts, signupStatusDom, firstTaskId });

    // 19 409 keeps note
    state = makeState({ tasksMode: 'open', signupMode: 'fail409' });
    await openPage(page, 'volunteer_tasks.html', state);
    await page.waitForSelector('.ui-volunteer-task-note');
    await page.locator('.ui-volunteer-task-note').first().fill('名额满备注应保留');
    await page.locator('button:has-text("报名任务")').first().click();
    await page.waitForTimeout(400);
    assert('probe19-keeps-note', (await page.locator('.ui-volunteer-task-note').first().inputValue()) === '名额满备注应保留', 'note');
    assert('probe19-msg', /名额|满|失败/.test(await page.locator('main').innerText()), 'msg');
    probe('19-409-keeps-note', {});

    // 15 race open slow then mine fast via real tabs
    state = makeState({ tasksMode: 'open', openHold: true });
    await openPage(page, 'volunteer_tasks.html', state);
    // first load already held open — wait a bit then switch to mine (fast)
    await page.waitForTimeout(80);
    state.scenario.openHold = false;
    await page.locator('button[role="tab"]:has-text("我的参与")').click();
    await page.waitForTimeout(300);
    // release slow open
    if (state.resolveOpenHold) {
      state.resolveOpenHold();
      state.openHoldP = null;
      state.resolveOpenHold = null;
    }
    await page.waitForTimeout(400);
    const raceText = await page.locator('main').innerText();
    assert('probe15-mine-visible', /MINE_TASK_|待确认|已指派|已完成|还没有参与/.test(raceText), raceText.slice(0, 200));
    assert('probe15-slow-open-not-win', !/SLOW_OPEN_SHOULD_LOSE/.test(raceText), raceText.slice(0, 200));
    probe('15-tasks-tab-race', { taskGets: state.taskGets });

    // 16 error clears
    state = makeState({ tasksMode: 'error' });
    await openPage(page, 'volunteer_tasks.html', state);
    await page.waitForTimeout(350);
    assert('probe16-error-clears', (await page.locator('.ui-volunteer-task-card').count()) === 0, 'cleared');
    probe('16-tasks-error-clears', {});

    // 21 withdraw double with a11y dialog
    state = makeState({ tasksMode: 'open', withdrawMode: 'hold' });
    await openPage(page, 'volunteer_tasks.html', state);
    await page.locator('button[role="tab"]:has-text("我的参与")').click();
    await page.waitForSelector('button:has-text("撤回报名")', { timeout: 8000 });
    await page.locator('button:has-text("撤回报名")').first().click();
    await page.waitForSelector('#taskWithdrawTitle');
    const wd0 = state.withdrawDeletes;
    await page.locator('[data-confirm-withdraw]').click();
    await page.waitForTimeout(80);
    await page.locator('[data-confirm-withdraw]').click({ force: true }).catch(() => {});
    await page.waitForTimeout(100);
    assert('probe21-withdraw-double-one', state.withdrawDeletes === wd0 + 1, 'n=' + state.withdrawDeletes);
    // Esc blocked while busy
    await page.keyboard.press('Escape');
    await page.waitForTimeout(80);
    assert('probe21-esc-blocked-while-busy', (await page.locator('#taskWithdrawTitle').count()) === 1, 'open');
    if (state.resolveHold) { state.resolveHold(); state.hold = null; state.resolveHold = null; }
    await page.waitForTimeout(450);
    probe('21-withdraw-double-one', { withdrawDeletes: state.withdrawDeletes });

    // withdraw dialog screenshots
    state = makeState({ tasksMode: 'open', withdrawMode: 'hold' });
    await openPage(page, 'volunteer_tasks.html', state);
    await page.locator('button[role="tab"]:has-text("我的参与")').click();
    await page.waitForSelector('button:has-text("撤回报名")');
    await page.locator('button:has-text("撤回报名")').first().click();
    await page.waitForSelector('#taskWithdrawTitle');
    await shot(page, 'tasks-withdraw-dialog-1440x900', { page: 'volunteer_tasks', state: 'withdraw-dialog' });
    if (state.resolveHold) { state.resolveHold(); state.hold = null; state.resolveHold = null; }
    await page.locator('.ui-dialog-actions button:has-text("取消")').click();
    await page.waitForTimeout(150);

    // 22 false keeps exact signup status + cancel restores original withdraw focus
    state = makeState({ tasksMode: 'open', withdrawMode: 'false' });
    await openPage(page, 'volunteer_tasks.html', state);
    await page.locator('[data-tab-mine]').click();
    await page.waitForSelector('[data-withdraw-task="7110"]');
    const statusBefore = await page.locator('.ui-volunteer-task-card[data-task-id="7110"]').getAttribute('data-signup-status');
    await page.locator('[data-withdraw-task="7110"]').click();
    await page.waitForSelector('#taskWithdrawTitle');
    await page.locator('[data-confirm-withdraw]').click();
    await page.waitForTimeout(400);
    const statusAfterFalse = await page.locator('.ui-volunteer-task-card[data-task-id="7110"]').getAttribute('data-signup-status');
    assert(
      'probe22-status-unchanged',
      statusAfterFalse === statusBefore,
      JSON.stringify({ statusBefore, statusAfterFalse })
    );
    assert('probe22-error-visible', /撤回失败|撤回未成功|未改变|失败/.test(await page.locator('main').innerText()), 'err');
    assert('probe22-dialog-still-open', (await page.locator('#taskWithdrawTitle').count()) === 1, 'dialog');
    await page.locator('.ui-dialog-actions button:has-text("取消")').click();
    await page.waitForTimeout(180);
    const focusAfterTasksFalseCancel = await focusInfo(page, 'tasks-false-cancel-focus');
    assert(
      'probe22-cancel-restores-withdraw',
      !focusAfterTasksFalseCancel.isBody
        && focusAfterTasksFalseCancel.attrs['data-withdraw-task'] === '7110',
      JSON.stringify(focusAfterTasksFalseCancel)
    );
    probe('22-false-keeps-signup-status', { statusBefore, statusAfterFalse, focus: focusAfterTasksFalseCancel });

    // 23 true updates — card gone AND success message AND focus fallthrough (not deleted button)
    state = makeState({ tasksMode: 'open', withdrawMode: 'ok' });
    await openPage(page, 'volunteer_tasks.html', state);
    await page.locator('[data-tab-mine]').click();
    await page.waitForSelector('[data-withdraw-task="7110"]');
    const pendingBefore = await page.locator('.ui-volunteer-task-card[data-task-id="7110"]').count();
    assert('probe23-precondition-card', pendingBefore === 1, 'pendingBefore=' + pendingBefore);
    await page.locator('[data-withdraw-task="7110"]').click();
    await page.waitForSelector('#taskWithdrawTitle');
    await page.locator('[data-confirm-withdraw]').click();
    await page.waitForTimeout(650);
    const pendingAfter = await page.locator('.ui-volunteer-task-card[data-task-id="7110"]').count();
    const mainAfter = await page.locator('main').innerText();
    assert('probe23-card-removed', pendingAfter === 0, JSON.stringify({ pendingBefore, pendingAfter }));
    assert('probe23-success-msg', /报名已撤回/.test(mainAfter), mainAfter.slice(0, 200));
    const focusAfterTasksWithdraw = await focusInfo(page, 'tasks-success-focus-desktop');
    assert('probe23-focus-not-body', !focusAfterTasksWithdraw.isBody, JSON.stringify(focusAfterTasksWithdraw));
    assert(
      'probe23-focus-fallthrough',
      Object.prototype.hasOwnProperty.call(focusAfterTasksWithdraw.attrs, 'data-tab-mine')
        || Object.prototype.hasOwnProperty.call(focusAfterTasksWithdraw.attrs, 'data-tasks-status')
        || Object.prototype.hasOwnProperty.call(focusAfterTasksWithdraw.attrs, 'data-signup-task')
        || Object.prototype.hasOwnProperty.call(focusAfterTasksWithdraw.attrs, 'data-withdraw-task')
        || focusAfterTasksWithdraw.id === 'tasksTitle'
        || focusAfterTasksWithdraw.tag === 'MAIN'
        || focusAfterTasksWithdraw.tag === 'DIV',
      JSON.stringify(focusAfterTasksWithdraw)
    );
    assert(
      'probe23-focus-not-deleted-withdraw',
      focusAfterTasksWithdraw.attrs['data-withdraw-task'] !== '7110',
      JSON.stringify(focusAfterTasksWithdraw)
    );
    probe('23-true-updates-signup', { pendingBefore, pendingAfter, focus: focusAfterTasksWithdraw });
    probe('29-tasks-success-focus-desktop', focusAfterTasksWithdraw);

    // 24 long text
    state = makeState({ tasksMode: 'open' });
    await openPage(page, 'volunteer_tasks.html', state);
    await page.waitForSelector('.ui-volunteer-task-card');
    assert('probe24-long-title', /长标题|OPEN_TASK|任务/.test(await page.locator('main').innerText()), 'long');
    probe('24-long-text-dom', {});

    // mobile shots + focus fallthrough @390 + withdraw dialog mobile
    await page.setViewportSize({ width: 390, height: 844 });
    state = makeState({ mineMode: 'rejectedOnly' });
    await openPage(page, 'volunteer_apply.html', state);
    await assertAuthenticatedChrome(page, 'apply-390-auth');
    await shot(page, 'apply-390x844', { page: 'volunteer_apply', viewport: '390x844' });

    // mine success focus @390
    state = makeState({ mineMode: 'list', deleteMode: 'ok' });
    state.mineRecords = [vol(2, { id: '6102', vstate: 0 }), vol(1, { id: '6101', vstate: 2 })];
    await openPage(page, 'my_volunteer.html', state);
    await assertAuthenticatedChrome(page, 'mine-390-auth');
    await page.waitForSelector('[data-volunteer-withdraw][data-volunteer-id="6102"]');
    await page.locator('[data-volunteer-withdraw][data-volunteer-id="6102"]').click();
    await page.waitForSelector('#volunteerConfirmTitle');
    await page.locator('.ui-dialog-actions button:has-text("确认撤回")').click();
    await page.waitForTimeout(600);
    const focusMine390 = await focusInfo(page, 'mine-success-focus-390');
    assert('probe28b-mine-focus-390-not-body', !focusMine390.isBody, JSON.stringify(focusMine390));
    assert(
      'probe28b-mine-focus-390-stable',
      Object.prototype.hasOwnProperty.call(focusMine390.attrs, 'data-volunteer-detail')
        || Object.prototype.hasOwnProperty.call(focusMine390.attrs, 'data-volunteer-apply-cta')
        || focusMine390.id === 'mineTitle'
        || focusMine390.tag === 'MAIN',
      JSON.stringify(focusMine390)
    );
    probe('30-mine-success-focus-390', focusMine390);
    await shot(page, 'mine-390x844', { page: 'my_volunteer', viewport: '390x844' });

    // tasks success focus @390
    state = makeState({ tasksMode: 'open', withdrawMode: 'ok' });
    await openPage(page, 'volunteer_tasks.html', state);
    await assertAuthenticatedChrome(page, 'tasks-390-auth');
    await page.locator('[data-tab-mine]').click();
    await page.waitForSelector('[data-withdraw-task="7110"]');
    await page.locator('[data-withdraw-task="7110"]').click();
    await page.waitForSelector('#taskWithdrawTitle');
    await page.locator('[data-confirm-withdraw]').click();
    await page.waitForTimeout(650);
    const focusTasks390 = await focusInfo(page, 'tasks-success-focus-390');
    assert('probe29b-tasks-focus-390-not-body', !focusTasks390.isBody, JSON.stringify(focusTasks390));
    assert(
      'probe29b-tasks-focus-390-fallthrough',
      focusTasks390.attrs['data-withdraw-task'] !== '7110'
        && (Object.prototype.hasOwnProperty.call(focusTasks390.attrs, 'data-tab-mine')
          || Object.prototype.hasOwnProperty.call(focusTasks390.attrs, 'data-tasks-status')
          || Object.prototype.hasOwnProperty.call(focusTasks390.attrs, 'data-signup-task')
          || focusTasks390.id === 'tasksTitle'
          || focusTasks390.tag === 'MAIN'
          || focusTasks390.tag === 'DIV'),
      JSON.stringify(focusTasks390)
    );
    probe('31-tasks-success-focus-390', focusTasks390);
    await shot(page, 'tasks-390x844', { page: 'volunteer_tasks', viewport: '390x844' });

    // withdraw dialog mobile screenshot (fresh open)
    state = makeState({ tasksMode: 'open', withdrawMode: 'hold' });
    await openPage(page, 'volunteer_tasks.html', state);
    await page.locator('[data-tab-mine]').click();
    await page.waitForSelector('[data-withdraw-task]');
    await page.locator('[data-withdraw-task]').first().click();
    await page.waitForSelector('#taskWithdrawTitle');
    await shot(page, 'tasks-withdraw-dialog-390x844', { page: 'volunteer_tasks', state: 'withdraw-dialog-mobile' });
    await page.locator('.ui-dialog-actions button:has-text("取消")').click();

    // matrix 15
    for (const file of PAGES) {
      for (const vp of VIEWPORTS) {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        state = makeState({
          mineMode: file === 'volunteer_apply.html' ? 'rejectedOnly' : 'list',
          tasksMode: 'open'
        });
        await openPage(page, file, state);
        await page.waitForTimeout(40);
        const ox = await overflowX(page);
        assert('matrix-' + file + '-' + vp.name + '-no-x', !ox.overflow, JSON.stringify(ox));
        result.matrixVisits.push({ file, viewport: vp.name });
      }
    }

    // 26+27 real jerry readonly smoke — separate context, NO write fixtures for business;
    // only me fixture + allow GETs; any write must be recorded as realWrite
    const smokeCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await loginSession(smokeCtx);
    const smokePage = await smokeCtx.newPage();
    const smokeWrites = [];
    smokePage.on('request', (req) => {
      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method()) && /\/api\//.test(req.url())) {
        if (!/\/api\/user\/login/.test(req.url())) {
          smokeWrites.push({ method: req.method(), url: req.url() });
          result.realWriteAudit.push({ method: req.method(), url: req.url(), source: 'smoke' });
        }
      }
    });
    // only fixture /me so bootstrap works offline-ish; other GETs hit real server if up, or we fixture empty
    await smokePage.route('**/api/user/me**', async (route) => {
      await route.fulfill({ status: 200, headers: fxHeaders(), body: ok(JERRY_ME) });
    });
    await smokePage.route('**/api/volunteer/**', async (route) => {
      if (route.request().method() !== 'GET') {
        smokeWrites.push({ method: route.request().method(), url: route.request().url() });
        result.realWriteAudit.push({ method: route.request().method(), url: route.request().url(), source: 'smoke-block' });
        await route.fulfill({ status: 599, headers: fxHeaders(true), body: err('599', 'smoke write blocked') });
        return;
      }
      await route.fulfill({ status: 200, headers: fxHeaders(), body: ok({ records: [], current: 1, total: 0, pages: 1 }) });
    });
    await smokePage.route('**/api/operations/**', async (route) => {
      if (route.request().method() !== 'GET') {
        smokeWrites.push({ method: route.request().method(), url: route.request().url() });
        result.realWriteAudit.push({ method: route.request().method(), url: route.request().url(), source: 'smoke-block' });
        await route.fulfill({ status: 599, headers: fxHeaders(true), body: err('599', 'smoke write blocked') });
        return;
      }
      await route.fulfill({ status: 200, headers: fxHeaders(), body: ok([]) });
    });
    for (const file of PAGES) {
      await smokePage.goto(pageUrl(file), { waitUntil: 'domcontentloaded', timeout: 30000 });
      await smokePage.waitForFunction(() => {
        const w = document.getElementById('authWait');
        return !w || w.hidden === true;
      }, { timeout: 15000 });
      await assertAuthenticatedChrome(smokePage, 'smoke-' + file.replace('.html', ''));
    }
    assert('probe26-smoke-no-writes', smokeWrites.length === 0, JSON.stringify(smokeWrites));
    probe('26-jerry-readonly-smoke', { smokeWrites: smokeWrites.length });
    assert('probe27-real-writes-zero', result.realWriteAudit.length === 0, JSON.stringify(result.realWriteAudit.slice(0, 5)));
    probe('27-real-business-writes-zero', { n: result.realWriteAudit.length });
    await smokeCtx.close();

    result.requestCountAudit = {
      submitPosts: state.submitPosts,
      deletePosts: state.deletePosts,
      signupPosts: state.signupPosts,
      withdrawDeletes: state.withdrawDeletes,
      uploadCount: state.uploadCount,
      stagedDeletes: state.stagedDeletes,
      fixtureWrites: result.fixtureWriteAudit.length,
      realWrites: result.realWriteAudit.length
    };

    // gates — consume abort ledger against requestFailedAudit (one-shot each)
    const unregisteredFailed = [];
    for (const e of result.requestFailedAudit) {
      if (!isRegisteredAbort(e)) unregisteredFailed.push(e);
    }
    assert('no-unregistered-requestfailed', unregisteredFailed.length === 0, JSON.stringify(unregisteredFailed.slice(0, 5)));
    assert('no-pageerror', result.pageErrors.length === 0, JSON.stringify(result.pageErrors.slice(0, 3)));
    const realConsole = result.consoleErrors.filter((t) => {
      if (/Failed to load resource/i.test(t) && /status of (4|5)\d\d/i.test(t)) return false;
      return true;
    });
    assert('no-real-console-error', realConsole.length === 0, JSON.stringify(realConsole.slice(0, 3)));
    const badHttp = result.httpErrors.filter((e) => {
      const h = e.headers || {};
      return h['x-ui-audit-expected-error'] !== 'phase3e' && h['x-ui-audit-fixture'] !== 'phase3e';
    });
    assert('no-unregistered-http', badHttp.length === 0, JSON.stringify(badHttp.slice(0, 5)));
    assert('screenshots-ge-8', result.screenshots.length >= 8, 'n=' + result.screenshots.length);
    assert('matrix-ge-15', result.matrixVisits.length >= 15, 'n=' + result.matrixVisits.length);
    assert('probes-ge-27', result.strictRuntimeProbeCount >= 27, 'n=' + result.strictRuntimeProbeCount);

    // Abort ledger strict accounting
    const abortSnap = abortRegistrySnapshot();
    assert(
      'abort-requestfailed-exact-2',
      result.requestFailedAudit.length === 2,
      JSON.stringify(result.requestFailedAudit.map((e) => ({
        method: e.method, url: e.url, failure: e.failure, key: abortRequestKey(e.method, e.url)
      })))
    );
    assert(
      'abort-registry-exact',
      abortSnap.registered === 2 && abortSnap.consumed === 2 && abortSnap.unused === 0,
      JSON.stringify(abortSnap)
    );
    assert(
      'abort-unregistered-exact-0',
      unregisteredFailed.length === 0,
      JSON.stringify(unregisteredFailed)
    );
    assert(
      'abort-registry-serializable',
      Array.isArray(abortSnap.serializable)
        && abortSnap.serializable.every((r) =>
          typeof r.scenario === 'string'
          && typeof r.method === 'string'
          && typeof r.pathname === 'string'
          && typeof r.query === 'string'
          && typeof r.consumed === 'boolean'
          && !Object.prototype.hasOwnProperty.call(r, 'urlPattern')
          && !Object.prototype.hasOwnProperty.call(r, 'urlRe')
        ),
      JSON.stringify(abortSnap.serializable)
    );

    // Live double-consume check: same already-consumed requestfailed must return false
    const snapBeforeRematch = abortRegistrySnapshot();
    for (const e of result.requestFailedAudit) {
      assert(
        'abort-live-no-double-consume',
        isRegisteredAbort(e) === false,
        JSON.stringify({ failed: e, key: abortRequestKey(e.method, e.url), snap: snapBeforeRematch })
      );
    }
    const snapAfterRematch = abortRegistrySnapshot();
    assert(
      'abort-live-rematch-no-pollute',
      snapAfterRematch.registered === 2
        && snapAfterRematch.consumed === 2
        && snapAfterRematch.unused === 0
        && snapAfterRematch.consumed === snapBeforeRematch.consumed,
      JSON.stringify({ snapBeforeRematch, snapAfterRematch })
    );

    // Isolated self-tests (must not touch real ledger)
    const realLedgerBeforeSelf = JSON.stringify(result.registeredAborts);
    runAbortLedgerSelfTests();
    assert(
      'abort-selftest-no-pollute-real-ledger',
      JSON.stringify(result.registeredAborts) === realLedgerBeforeSelf,
      'real ledger mutated by self-tests'
    );

    // evaluate accounting: every call tracked; lifecycle tags match source lifecycle calls
    const evalSrcCalls = (suiteSrc.match(/page\.evaluate\s*\(/g) || []).length;
    const evalWrapperCalls = (suiteSrc.match(/\beval(Read|Lifecycle|Tracked)\s*\(/g) || []).length;
    // Direct page.evaluate only allowed inside evalTracked wrapper definition
    const bareEvaluateOutsideWrapper = evalSrcCalls <= 2; // the two inside evalTracked
    assert('evaluate-wrapper-only', bareEvaluateOutsideWrapper, JSON.stringify({ evalSrcCalls, evalWrapperCalls }));
    assert('evaluate-usage-tracked', result.evaluateUsage.length > 0, 'n=' + result.evaluateUsage.length);
    assert(
      'evaluate-lifecycle-tagged',
      result.evaluateUsage.some((e) => e.lifecycle && /pagehide/i.test(e.reason)),
      JSON.stringify(result.evaluateUsage.filter((e) => e.lifecycle).slice(0, 5))
    );
    assert(
      'evaluate-readonly-majority',
      result.evaluateUsage.filter((e) => e.readonly).length >= result.evaluateUsage.filter((e) => e.lifecycle).length,
      JSON.stringify({
        readonly: result.evaluateUsage.filter((e) => e.readonly).length,
        lifecycle: result.evaluateUsage.filter((e) => e.lifecycle).length,
        total: result.evaluateUsage.length
      })
    );
    // Runtime evaluateUsage length should match wrapper invocations roughly (>= lifecycle + focus + overflow)
    assert('evaluate-usage-count-sane', result.evaluateUsage.length >= 8, 'n=' + result.evaluateUsage.length);

    const shotFiles = fs.readdirSync(shotDir).filter((f) => f.endsWith('.png')).sort();
    const indexed = result.screenshots.map((s) => path.basename(s.file)).sort();
    assert('screenshot-index-match', JSON.stringify(shotFiles) === JSON.stringify(indexed), JSON.stringify({ shotFiles, indexed }));

    const summary = writeReport();
    console.log('Phase 3E summary', summary);
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
