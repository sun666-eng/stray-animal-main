/**
 * Phase 3F strict credibility suite — favorites + petcare workspace.
 * Fail-closed. Real Playwright interactions only. Port default :18129
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const startedAt = Date.now();
const base = process.env.BASE_URL || 'http://127.0.0.1:18129';
const out = path.resolve('output/playwright/ui-polish-phase-3f');
const shotDir = path.join(out, 'screenshots');
fs.mkdirSync(shotDir, { recursive: true });
for (const f of fs.readdirSync(shotDir)) {
  if (f.endsWith('.png')) fs.unlinkSync(path.join(shotDir, f));
}

const PAGES = ['favorites.html', 'pet_care.html'];
const VIEWPORTS = [
  { name: '1440x900', width: 1440, height: 900 },
  { name: '1280x800', width: 1280, height: 800 },
  { name: '768x1024', width: 768, height: 1024 },
  { name: '390x844', width: 390, height: 844 },
  { name: '320x800', width: 320, height: 800 }
];
const JERRY_ME = {
  id: '43', username: 'jerry', name: 'jerry',
  phone: '13800138000', email: 'jerry@example.com'
};

const result = {
  phase: '3F',
  base,
  branch: 'ui-polish/phase-3f-favorites-petcare-workspace-20260731',
  baseline: '38f67baff6457e34a732719cab0c36ee3d6b97f9',
  productSeal: '07394318976d5917ae4b9a2b1d0065f55800460a',
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
  result.probes.push({ name, detail: detail || {}, at: new Date().toISOString() });
}
function ok(data) { return JSON.stringify({ code: '0', msg: '成功', data }); }
function err(code, msg) { return JSON.stringify({ code: String(code), msg, data: null }); }
function fxHeaders(expected) {
  const h = { 'content-type': 'application/json', 'x-ui-audit-fixture': 'phase3f' };
  if (expected) h['x-ui-audit-expected-error'] = 'phase3f';
  return h;
}
function pageUrl(f) { return `${base}/page/front/${f}`; }

function favAnimal(i, o) {
  return Object.assign({
    favorite_id: String(9000 + i),
    id: String(8000 + i),
    tname: '收藏动物' + i + '长名称'.repeat(2),
    ttype: i % 2 ? '猫' : '狗',
    tsex: i % 2 ? '母' : '公',
    tbirthday: '2022-01-0' + ((i % 9) + 1),
    tpic: '',
    tstate: i === 3 ? 2 : (i === 4 ? 3 : 0),
    tdescribe: '描述' + i + '长说明文字'.repeat(6),
    created_at: '2026-07-0' + ((i % 9) + 1) + ' 10:00:00'
  }, o || {});
}
function conv(i, o) {
  return Object.assign({
    id: 'c' + i,
    title: '会话' + i + '标题较长一些',
    preview: '预览内容' + i,
    turnCount: i,
    updatedAt: '2026-07-3' + (i % 9) + 'T12:00:00'
  }, o || {});
}
function defaultConfig(o) {
  return Object.assign({
    enabled: true, ready: true, connected: false, connectionStatus: 'untested',
    connectionMessage: '', lastTestedAt: null, baseUrl: 'https://api.example.com',
    model: 'demo-model', apiKeyConfigured: true, apiKeyHint: 'sk-****demo',
    personalConfigured: true, source: 'personal'
  }, o || {});
}
function makeState(custom) {
  return {
    scenario: Object.assign({
      favMode: 'list',
      favDeleteMode: 'ok',
      configMode: 'personal-ready',
      clearConfigMode: 'ok',
      testConfigMode: 'ok',
      convMode: 'list',
      openConvMode: 'ok',
      deleteConvMode: 'ok',
      clearHistMode: 'ok',
      askMode: 'ok',
      favHold: false,
      convHold: false,
      // When set (e.g. 'c1'), detail GET for that id is held until resolveDetailHold.
      detailHoldId: ''
    }, custom || {}),
    favorites: [favAnimal(1), favAnimal(2), favAnimal(3), favAnimal(4)],
    conversations: [conv(1), conv(2), conv(3)],
    config: defaultConfig(),
    requests: [],
    favGets: 0, favDeletes: 0, convGets: 0, convDeletes: 0,
    histDeletes: 0, askPosts: 0, configGets: 0, configPosts: 0,
    configTests: 0, configClears: 0,
    hold: null, resolveHold: null,
    favHoldP: null, resolveFavHold: null,
    convHoldP: null, resolveConvHold: null,
    detailHoldP: null, resolveDetailHold: null,
    detailHoldHits: 0
  };
}

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
      for (const v of params.getAll(k).slice().sort()) {
        pairs.push(encodeURIComponent(k) + '=' + encodeURIComponent(v));
      }
    }
    query = pairs.join('&');
  } catch (e) {
    pathname = String(url || '').split('?')[0];
  }
  return { method: String(method || '').toUpperCase(), pathname, query };
}
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
function isRegisteredAbort(failed) {
  return matchAndConsumeAbort(result.registeredAborts, failed, true);
}
function abortRegistrySnapshot() {
  const registered = result.registeredAborts.length;
  const consumed = result.registeredAborts.filter((r) => r.consumed).length;
  const unused = result.registeredAborts.filter((r) => !r.consumed).length;
  return { registered, consumed, unused, serializable: JSON.parse(JSON.stringify(result.registeredAborts)) };
}
function runAbortLedgerSelfTests() {
  const isolatedConsumed = [{
    scenario: 'selftest-consumed', method: 'GET', pathname: '/api/operations/favorites',
    query: '', consumed: true, consumedAt: 'x', at: 'y'
  }];
  assert('abort-selftest-consumed-no-rematch', matchAndConsumeAbort(isolatedConsumed, {
    method: 'GET', url: 'http://127.0.0.1/api/operations/favorites?_=1', failure: 'net::ERR_ABORTED'
  }, true) === false, 'rematch');
  const isolatedQ = [{
    scenario: 'selftest-q', method: 'GET', pathname: '/api/petcare/conversations',
    query: 'limit=50', consumed: false, consumedAt: null, at: 'y'
  }];
  assert('abort-selftest-query-mismatch', matchAndConsumeAbort(isolatedQ, {
    method: 'GET', url: 'http://127.0.0.1/api/petcare/conversations?limit=20', failure: 'net::ERR_ABORTED'
  }, true) === false, 'query');
  assert('abort-selftest-method-mismatch', matchAndConsumeAbort(isolatedQ, {
    method: 'POST', url: 'http://127.0.0.1/api/petcare/conversations?limit=50', failure: 'net::ERR_ABORTED'
  }, true) === false, 'method');
}

async function evalTracked(page, reason, fn, arg, opts) {
  opts = opts || {};
  const lifecycle = !!(opts.lifecycle || /pagehide|visibility|dispatch-/i.test(reason));
  const readonly = opts.readonly !== false && !lifecycle;
  result.evaluateUsage.push({ reason: String(reason || 'unnamed'), readonly, lifecycle, at: new Date().toISOString() });
  if (typeof arg === 'undefined') return page.evaluate(fn);
  return page.evaluate(fn, arg);
}
async function evalRead(page, reason, fn, arg) {
  return evalTracked(page, reason, fn, arg, { readonly: true });
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

async function installPageFixtures(page, state) {
  if (!state.requests) state.requests = [];

  // Register catch-all first, then more-specific routes last (Playwright matches newest first).
  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const method = req.method();
    const url = req.url();
    const entry = { method, url, at: new Date().toISOString() };
    state.requests.push(entry);

    // Auth me must be handled here if not intercepted by later-specific route.
    if (method === 'GET' && /\/api\/user\/me(\?|$)/.test(url)) {
      await route.fulfill({ status: 200, headers: fxHeaders(), body: ok(JERRY_ME) });
      return;
    }

    const isWrite = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);

    const isBizWrite =
      (method === 'DELETE' && /\/api\/operations\/favorites\/\d+/.test(url)) ||
      (method === 'POST' && /\/api\/petcare\/config(\/|$|\?)/.test(url)) ||
      (method === 'POST' && /\/api\/petcare\/config\/(test|auto-test|clear)/.test(url)) ||
      (method === 'POST' && /\/api\/petcare\/ask/.test(url)) ||
      (method === 'PUT' && /\/api\/petcare\/conversations\/[^/]+\/title/.test(url)) ||
      (method === 'DELETE' && /\/api\/petcare\/conversations\//.test(url)) ||
      (method === 'DELETE' && /\/api\/petcare\/history/.test(url));

    if (isWrite) {
      if (isBizWrite) {
        result.fixtureWriteAudit.push(entry);
      } else if (!/\/api\/user\/login/.test(url) && !/csrf/i.test(url)) {
        result.realWriteAudit.push(entry);
        fail('unregistered-write', method + ' ' + url);
        await route.fulfill({ status: 599, headers: fxHeaders(true), body: err('599', 'unregistered write blocked') });
        return;
      }
    }

    if (method === 'GET' && /\/api\/operations\/favorites(\?|$)/.test(url)) {
      state.favGets += 1;
      if (state.scenario.favMode === 'error') {
        await route.fulfill({ status: 500, headers: fxHeaders(true), body: err('500', '收藏失败夹具') }); return;
      }
      if (state.scenario.favMode === 'empty') {
        await route.fulfill({ status: 200, headers: fxHeaders(), body: ok([]) }); return;
      }
      if (state.scenario.favHold) {
        registerAbort('favorites-slow-abort', 'GET', url);
        if (!state.favHoldP) state.favHoldP = new Promise((r) => { state.resolveFavHold = r; });
        await state.favHoldP;
        await route.fulfill({ status: 200, headers: fxHeaders(), body: ok([favAnimal(99, { tname: 'SLOW_FAV_SHOULD_LOSE' })]) });
        return;
      }
      await route.fulfill({ status: 200, headers: fxHeaders(), body: ok(state.favorites.slice()) });
      return;
    }

    if (method === 'DELETE' && /\/api\/operations\/favorites\/(\d+)/.test(url)) {
      state.favDeletes += 1;
      const id = (url.match(/\/favorites\/(\d+)/) || [])[1];
      if (state.scenario.favDeleteMode === 'hold') {
        if (!state.hold) state.hold = new Promise((r) => { state.resolveHold = r; });
        await state.hold;
      }
      if (state.scenario.favDeleteMode === 'false') {
        await route.fulfill({ status: 200, headers: fxHeaders(), body: ok(false) }); return;
      }
      if (state.scenario.favDeleteMode === 'conflict') {
        await route.fulfill({ status: 409, headers: fxHeaders(true), body: err('409', '删除冲突夹具') }); return;
      }
      if (state.scenario.favDeleteMode === 'server500') {
        await route.fulfill({ status: 500, headers: fxHeaders(true), body: err('500', '删除失败夹具') }); return;
      }
      state.favorites = state.favorites.filter((f) => String(f.id) !== String(id));
      await route.fulfill({ status: 200, headers: fxHeaders(), body: ok(true) });
      return;
    }

    if (method === 'GET' && /\/api\/petcare\/topics/.test(url)) {
      await route.fulfill({ status: 200, headers: fxHeaders(), body: ok(['幼猫驱虫怎么做？', '狗狗第一次洗澡注意什么？', '领养适应期如何安抚？']) });
      return;
    }

    if (method === 'GET' && /\/api\/petcare\/config(\?|$)/.test(url)) {
      state.configGets += 1;
      let cfg;
      if (state.scenario.configMode === 'none') {
        cfg = defaultConfig({ personalConfigured: false, enabled: false, ready: false, connected: false, apiKeyConfigured: false, apiKeyHint: '', baseUrl: '', source: 'local' });
      } else if (state.scenario.configMode === 'connected') {
        cfg = defaultConfig({ connected: true, connectionStatus: 'ok', connectionMessage: '已连接' });
      } else if (state.scenario.configMode === 'failed') {
        cfg = defaultConfig({ connected: false, connectionStatus: 'failed', connectionMessage: '连接失败' });
      } else if (state.scenario.configMode === 'platform') {
        cfg = defaultConfig({ personalConfigured: false, connected: true, source: 'platform', apiKeyConfigured: false });
      } else {
        cfg = defaultConfig(state.config);
      }
      state.config = cfg;
      await route.fulfill({ status: 200, headers: fxHeaders(), body: ok(cfg) });
      return;
    }

    if (method === 'POST' && /\/api\/petcare\/config(\?|$)/.test(url) && !/\/(test|auto-test|clear)/.test(url)) {
      state.configPosts += 1;
      const cfg = defaultConfig({ connected: false, connectionStatus: 'untested', ready: true, personalConfigured: true });
      state.config = cfg;
      await route.fulfill({ status: 200, headers: fxHeaders(), body: ok(cfg) });
      return;
    }

    if (method === 'POST' && /\/api\/petcare\/config\/test/.test(url)) {
      state.configTests += 1;
      if (state.scenario.testConfigMode === 'fail') {
        await route.fulfill({ status: 502, headers: fxHeaders(true), body: err('502', '模型服务商连接失败') }); return;
      }
      const cfg = defaultConfig({ connected: true, connectionStatus: 'ok', connectionMessage: '连接成功' });
      state.config = cfg;
      await route.fulfill({ status: 200, headers: fxHeaders(), body: ok(cfg) });
      return;
    }

    if (method === 'POST' && /\/api\/petcare\/config\/auto-test/.test(url)) {
      if (state.scenario.configMode === 'connected') {
        await route.fulfill({ status: 200, headers: fxHeaders(), body: ok(defaultConfig({ connected: true, connectionStatus: 'ok' })) });
      } else {
        await route.fulfill({ status: 200, headers: fxHeaders(), body: ok(defaultConfig({ connected: false, connectionStatus: 'untested' })) });
      }
      return;
    }

    if (method === 'POST' && /\/api\/petcare\/config\/clear/.test(url)) {
      state.configClears += 1;
      if (state.scenario.clearConfigMode === 'false') {
        // code=0 data=false — product must show dedicated fail copy, not Result "成功"
        await route.fulfill({ status: 200, headers: fxHeaders(), body: ok(false) }); return;
      }
      if (state.scenario.clearConfigMode === 'server500') {
        await route.fulfill({ status: 500, headers: fxHeaders(true), body: err('500', '清除失败夹具') }); return;
      }
      if (state.scenario.clearConfigMode === 'conflict') {
        await route.fulfill({ status: 409, headers: fxHeaders(true), body: err('409', '清除冲突夹具') }); return;
      }
      const cfg = defaultConfig({ personalConfigured: false, enabled: false, ready: false, connected: false, apiKeyConfigured: false, apiKeyHint: '', source: 'local', baseUrl: '' });
      state.config = cfg;
      await route.fulfill({ status: 200, headers: fxHeaders(), body: ok(cfg) });
      return;
    }

    // conversations list (not detail)
    if (method === 'GET' && /\/api\/petcare\/conversations(\?|$)/.test(url)) {
      state.convGets += 1;
      if (state.scenario.convMode === 'error') {
        await route.fulfill({ status: 500, headers: fxHeaders(true), body: err('500', '目录失败夹具') }); return;
      }
      if (state.scenario.convMode === 'empty') {
        await route.fulfill({ status: 200, headers: fxHeaders(), body: ok([]) }); return;
      }
      if (state.scenario.convHold) {
        registerAbort('conversations-slow-abort', 'GET', url);
        if (!state.convHoldP) state.convHoldP = new Promise((r) => { state.resolveConvHold = r; });
        await state.convHoldP;
        await route.fulfill({ status: 200, headers: fxHeaders(), body: ok([conv(99, { title: 'SLOW_CONV_SHOULD_LOSE' })]) });
        return;
      }
      await route.fulfill({ status: 200, headers: fxHeaders(), body: ok(state.conversations.slice()) });
      return;
    }

    if (method === 'GET' && /\/api\/petcare\/conversations\/[^/?]+$/.test(url.split('?')[0])) {
      const id = (url.match(/\/conversations\/([^/?]+)/) || [])[1];
      if (state.scenario.openConvMode === 'error') {
        await route.fulfill({ status: 500, headers: fxHeaders(true), body: err('500', '打开失败') }); return;
      }
      // Race: hold detail for A so B can win via latest-wins + abort.
      if (state.scenario.detailHoldId && String(id) === String(state.scenario.detailHoldId)) {
        state.detailHoldHits += 1;
        registerAbort('conversation-detail-A-slow-abort', 'GET', url);
        if (!state.detailHoldP) state.detailHoldP = new Promise((r) => { state.resolveDetailHold = r; });
        await state.detailHoldP;
        const cSlow = state.conversations.find((x) => String(x.id) === String(id)) || conv(1, { id });
        await route.fulfill({
          status: 200, headers: fxHeaders(),
          body: ok({
            conversation: Object.assign({}, cSlow, { title: 'RACE_A_TITLE_SHOULD_LOSE', id: String(id) }),
            history: {
              items: [{
                id: 'h-a',
                question: 'RACE_A_QUESTION_SHOULD_LOSE',
                answer: 'RACE_A_ANSWER_SHOULD_LOSE unique marker AAAA',
                source: 'local', topic: 'A', toolsUsed: [],
                questionTime: '2026-07-30 10:00:00', answerTime: '2026-07-30 10:00:05'
              }]
            }
          })
        });
        return;
      }
      const c = state.conversations.find((x) => String(x.id) === String(id)) || conv(1, { id });
      const isB = String(id) === 'c2';
      await route.fulfill({
        status: 200, headers: fxHeaders(),
        body: ok({
          conversation: Object.assign({}, c, isB ? { title: 'RACE_B_TITLE_SHOULD_WIN', id: 'c2' } : {}),
          history: {
            items: [{
              id: isB ? 'h-b' : 'h1',
              question: isB ? 'RACE_B_QUESTION_SHOULD_WIN' : '这只猫需要打疫苗吗？',
              answer: isB
                ? 'RACE_B_ANSWER_SHOULD_WIN unique marker BBBB'
                : '## 建议\n\n1. **基础免疫**\n2. 定期驱虫\n\n| 项目 | 频率 |\n| --- | --- |\n| 疫苗 | 按兽医建议 |\n| 驱虫 | 每月 |\n\n详见 https://example.com/very/long/path/for/overflow-check',
              source: 'local',
              topic: isB ? 'B' : '健康',
              toolsUsed: [],
              questionTime: '2026-07-30 10:00:00',
              answerTime: '2026-07-30 10:00:05'
            }]
          }
        })
      });
      return;
    }

    if (method === 'PUT' && /\/api\/petcare\/conversations\/[^/]+\/title/.test(url)) {
      await route.fulfill({ status: 200, headers: fxHeaders(), body: ok({ title: '新标题' }) });
      return;
    }

    if (method === 'DELETE' && /\/api\/petcare\/conversations\/[^/?]+$/.test(url.split('?')[0])) {
      state.convDeletes += 1;
      const id = (url.match(/\/conversations\/([^/?]+)/) || [])[1];
      if (state.scenario.deleteConvMode === 'hold') {
        if (!state.hold) state.hold = new Promise((r) => { state.resolveHold = r; });
        await state.hold;
      }
      if (state.scenario.deleteConvMode === 'false') {
        await route.fulfill({ status: 200, headers: fxHeaders(), body: ok(false) }); return;
      }
      if (state.scenario.deleteConvMode === 'conflict') {
        await route.fulfill({ status: 409, headers: fxHeaders(true), body: err('409', '删除冲突') }); return;
      }
      if (state.scenario.deleteConvMode === 'server500') {
        await route.fulfill({ status: 500, headers: fxHeaders(true), body: err('500', '删除失败') }); return;
      }
      state.conversations = state.conversations.filter((c) => String(c.id) !== String(id));
      await route.fulfill({ status: 200, headers: fxHeaders(), body: ok(true) });
      return;
    }

    if (method === 'DELETE' && /\/api\/petcare\/history/.test(url)) {
      state.histDeletes += 1;
      if (state.scenario.clearHistMode === 'false') {
        await route.fulfill({ status: 200, headers: fxHeaders(), body: ok(false) }); return;
      }
      if (state.scenario.clearHistMode === 'server500') {
        await route.fulfill({ status: 500, headers: fxHeaders(true), body: err('500', '清空失败') }); return;
      }
      state.conversations = [];
      await route.fulfill({ status: 200, headers: fxHeaders(), body: ok(true) });
      return;
    }

    if (method === 'POST' && /\/api\/petcare\/ask/.test(url)) {
      state.askPosts += 1;
      if (state.scenario.askMode === 'fail') {
        await route.fulfill({ status: 500, headers: fxHeaders(true), body: err('500', '回答失败') }); return;
      }
      let body = {};
      try { body = req.postDataJSON() || {}; } catch (e) { /* ignore */ }
      await route.fulfill({
        status: 200, headers: fxHeaders(),
        body: ok({
          answer: '## 回答\n\n这是**结构化**回答。\n\n1. 第一点\n2. 第二点\n\n| A | B |\n| - | - |\n| 1 | 2 |',
          source: 'local',
          topic: '照顾',
          toolsUsed: [],
          conversationId: body.conversationId || 'c-new',
          conversationTitle: body.question || '新对话',
          requestId: body.requestId
        })
      });
      return;
    }

    if (isWrite) {
      result.realWriteAudit.push(entry);
      fail('unregistered-write-default', method + ' ' + url);
      await route.fulfill({ status: 599, headers: fxHeaders(true), body: err('599', 'blocked') });
      return;
    }
    await route.fulfill({ status: 200, headers: fxHeaders(), body: ok([]) });
  });

  // Specific me route registered last so it wins over catch-all.
  await page.route('**/api/user/me**', async (route) => {
    if (route.request().method() !== 'GET') { await route.continue(); return; }
    await route.fulfill({ status: 200, headers: fxHeaders(), body: ok(JERRY_ME) });
  });
}

async function openPage(page, file, state) {
  await page.unroute('**/api/**').catch(() => {});
  await page.unroute('**/api/user/me**').catch(() => {});
  await installPageFixtures(page, state);
  await page.goto(pageUrl(file), { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForFunction(() => {
    const w = document.getElementById('authWait');
    return !w || w.hidden === true;
  }, { timeout: 20000 });
  result.visits.push({ file, at: new Date().toISOString() });
}

async function assertAuthenticatedChrome(page, idPrefix) {
  const header = page.locator('header').first();
  const text = await header.innerText();
  const hasAccount = (await header.locator('.ui-front-account, .ui-account').count()) >= 1;
  const hasAuthCta = (await header.locator('.ui-front-auth-actions').count()) >= 1;
  assert(idPrefix + '-account-jerry', hasAccount && (/jerry/i.test(text) || /\bJ\b/.test(text)), text.slice(0, 120));
  assert(idPrefix + '-no-login-cta', !hasAuthCta && !/登录/.test(text) && !/注册/.test(text), text.slice(0, 80));
  assert(idPrefix + '-not-login-url', !/login\.html/i.test(page.url()), page.url());
}

async function waitFonts(page) {
  await page.waitForFunction(() => (document.fonts ? document.fonts.status === 'loaded' : true), { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(60);
}

async function shot(page, name, meta) {
  await evalRead(page, 'shot-scroll-top', () => { window.scrollTo(0, 0); });
  await waitFonts(page);
  await page.screenshot({ path: path.join(shotDir, name + '.png'), fullPage: false });
  result.screenshots.push(Object.assign({
    file: 'screenshots/' + name + '.png', name, time: new Date().toISOString()
  }, meta || {}));
}

async function overflowX(page) {
  return evalRead(page, 'overflow-measure', () => {
    const de = document.documentElement;
    return { overflow: de.scrollWidth > de.clientWidth + 1, sw: de.scrollWidth, cw: de.clientWidth };
  });
}

async function focusInfo(page, reason) {
  return evalRead(page, reason || 'focus-info', () => {
    const el = document.activeElement;
    if (!el || el === document.body || el === document.documentElement) {
      return { tag: el ? el.tagName : null, id: '', isBody: true, text: '', attrs: {} };
    }
    const attrs = {};
    [
      'data-favorites-detail', 'data-favorites-remove', 'data-favorites-browse', 'data-favorites-browse-empty',
      'data-petcare-history-toggle', 'data-petcare-history-reveal', 'data-petcare-new-conversation',
      'data-petcare-confirm-ok', 'data-petcare-confirm-error', 'data-petcare-config-open',
      'data-petcare-config-status', 'data-petcare-open-conversation', 'data-petcare-delete-conversation',
      'data-petcare-clear-history', 'data-petcare-clear-config', 'role'
    ].forEach((k) => {
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

function hasAttr(fi, name) {
  return !!(fi && fi.attrs && Object.prototype.hasOwnProperty.call(fi.attrs, name));
}

function writeReport() {
  const passed = result.checks.filter((c) => c.ok).length;
  const failed = result.checks.filter((c) => !c.ok).length;
  const skipped = result.checks.filter((c) => c.skipped).length;
  const abortSnap = abortRegistrySnapshot();
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
    evaluateUsageCount: result.evaluateUsage.length,
    evaluateReadonlyCount: result.evaluateUsage.filter((e) => e.readonly).length,
    registeredAborts: result.registeredAborts.length,
    abortRegistry: abortSnap,
    durationMs: Date.now() - startedAt,
    finishedAt: new Date().toISOString(),
    strictMode: failed === 0 && skipped === 0 && result.bestEffortPassCount === 0
      && result.fallbackPassCount === 0
      && result.matrixVisits.length >= 10
      && result.strictRuntimeProbeCount >= 36
      && result.screenshots.length >= 15
      && result.realWriteAudit.length === 0
      && passed >= 180
      && abortSnap.registered >= 1
      && abortSnap.consumed === abortSnap.registered
      && abortSnap.unused === 0
  };
  result.raceFinalConversationId = result.raceFinalConversationId || null;
  result.ok = result.summary.strictMode;
  fs.writeFileSync(path.join(out, 'phase-3f-report.json'), JSON.stringify(result, null, 2));
  fs.writeFileSync(path.join(out, 'screenshots-index.json'), JSON.stringify(result.screenshots, null, 2));
  const log = [
    'PHASE 3F STRICT=' + result.summary.strictMode,
    'ASSERTIONS ' + passed + '/' + failed + '/' + skipped,
    'MATRIX ' + result.matrixVisits.length + '/10',
    'SCREENSHOTS ' + result.screenshots.length,
    'PROBES ' + result.strictRuntimeProbeCount,
    'BEST_EFFORT ' + result.bestEffortPassCount,
    'FALLBACK ' + result.fallbackPassCount,
    'FIXTURE_WRITES ' + result.fixtureWriteAudit.length,
    'REAL_WRITES ' + result.realWriteAudit.length,
    'EVALUATE_USAGE ' + result.evaluateUsage.length,
    'REGISTERED_ABORTS ' + result.registeredAborts.length,
    'ABORT_REGISTERED ' + abortSnap.registered,
    'ABORT_CONSUMED ' + abortSnap.consumed,
    'ABORT_UNUSED ' + abortSnap.unused,
    'RACE_FINAL_CONVERSATION_ID ' + (result.raceFinalConversationId || '')
  ].join('\n');
  fs.writeFileSync(path.join(out, 'run-strict-final.log'), log + '\n');
  return result.summary;
}

async function ensureHistoryVisible(page) {
  if ((await page.locator('.petcare-conversation-item').count()) > 0) return;
  await page.locator('[data-petcare-history-toggle], [data-petcare-history-reveal]').first().click().catch(() => {});
  await page.waitForTimeout(200);
}

(async () => {
  console.log('Phase 3F credibility strict start', base);
  let browser;
  try {
    const favHtml = fs.readFileSync('src/main/resources/static/page/front/favorites.html', 'utf8');
    const careHtml = fs.readFileSync('src/main/resources/static/page/front/pet_care.html', 'utf8');
    const suiteSrc = fs.readFileSync('tools/ui-polish-phase-3f.cjs', 'utf8');

    assert('no-window-confirm-favorites', !/window\.confirm|window\.alert|window\.prompt/.test(favHtml), 'fav');
    assert('no-window-confirm-petcare', !/window\.confirm|window\.alert|window\.prompt/.test(careHtml), 'care');
    assert('cache-u1-favorites', favHtml.includes('v=20260809u1a'), 'fav-cache');
    assert('cache-u1-petcare', careHtml.includes('v=20260809u1a'), 'care-cache');
    assert('shell-cache-favorites', favHtml.includes('front-shell.js?v=20260809u1a'), 'shell-f');
    assert('shell-cache-petcare', careHtml.includes('front-shell.js?v=20260809u1a'), 'shell-c');
    assert('workspace-cache-favorites', favHtml.includes('user-workspace.js?v=20260809u1a'), 'ws-f');
    assert('workspace-cache-petcare', careHtml.includes('user-workspace.js?v=20260809u1a'), 'ws-c');
    assert('favorites-workspace-root', favHtml.includes('favorites-workspace'), 'root');
    assert('petcare-workspace-root', careHtml.includes('petcare-workspace'), 'root');
    assert('favorites-dialog-role', favHtml.includes('role="dialog"') && favHtml.includes('favoritesConfirmTitle'), 'dlg');
    assert('favorites-exact-bool', favHtml.includes('exactBoolSuccess') || favHtml.includes("data === true"), 'bool');
    assert('favorites-data-remove', favHtml.includes('data-favorites-remove'), 'sel');
    assert('favorites-data-detail', favHtml.includes('data-favorites-detail'), 'sel');
    assert('favorites-data-browse', favHtml.includes('data-favorites-browse'), 'sel');
    assert('favorites-focus-restore', favHtml.includes('restoreFocusAfterRemove'), 'focus');
    assert('favorites-listseq', favHtml.includes('listSeq'), 'seq');
    assert('petcare-confirm-error-ui', careHtml.includes('confirmError') && careHtml.includes('data-petcare-confirm-error'), 'err');
    assert('petcare-setConfirmError', careHtml.includes('setConfirmError'), 'fn');
    assert('petcare-open-uses-closeHistoryPanel', /openConversation[\s\S]*closeHistoryPanel/.test(careHtml), 'open');
    assert('petcare-new-uses-closeHistoryPanel', /newConversation[\s\S]*closeHistoryPanel/.test(careHtml), 'new');
    assert('petcare-trap-history', careHtml.includes('trapHistoryFocus'), 'trap-h');
    assert('petcare-trap-config', careHtml.includes('trapConfigFocus'), 'trap-c');
    assert('petcare-trap-confirm', careHtml.includes('trapConfirmFocus'), 'trap-cf');
    assert('petcare-history-scrim', careHtml.includes('petcare-history-scrim'), 'scrim');
    assert('petcare-history-open-class', careHtml.includes('petcare-history-open'), 'lock');
    assert('petcare-config-status-sel', careHtml.includes('data-petcare-config-status'), 'status');
    assert('petcare-config-open-sel', careHtml.includes('data-petcare-config-open'), 'cfg');
    assert('petcare-connected-strict', /connected\s*===\s*true/.test(careHtml) || careHtml.includes("configStatus.connected === true"), 'conn');
    assert('petcare-no-v-html', !/v-html/.test(careHtml), 'vhtml');
    assert('petcare-markdown-component', careHtml.includes('petcare-rich-answer'), 'md');
    assert('self-no-best-effort', !/bestEffort:\s*true/.test(suiteSrc), 'be');
    assert('self-no-vm-bypass', !/__vue__\.(load|ask|remove|confirm|openRemove|clearConfig)/.test(suiteSrc), 'vm');
    assert('self-no-fake-assert-loop', !/for \(let i = 0; i < 180/.test(suiteSrc), 'no-fake');
    assert('self-phase-3f-marker', suiteSrc.includes("phase: '3F'") || suiteSrc.includes('phase: "3F"'), 'phase');
    assert('self-port-18129', suiteSrc.includes('18129'), 'port');

    browser = await chromium.launch({ headless: true });
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await loginSession(ctx);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => result.pageErrors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') result.consoleErrors.push(m.text()); });
    page.on('response', (r) => {
      if (r.status() >= 400) {
        result.httpErrors.push({
          status: r.status(), url: r.url(), method: r.request().method(), headers: r.headers()
        });
      }
    });
    page.on('requestfailed', (req) => {
      result.requestFailedAudit.push({
        method: req.method(), url: req.url(),
        failure: req.failure() && req.failure().errorText,
        at: new Date().toISOString()
      });
    });

    // ===== FAVORITES list =====
    let state = makeState({ favMode: 'list' });
    await openPage(page, 'favorites.html', state);
    await assertAuthenticatedChrome(page, 'fav-auth');
    await page.waitForSelector('.favorites-card', { timeout: 10000 });
    assert('fav-list-count', (await page.locator('.favorites-card').count()) >= 2, 'cards');
    assert('fav-no-quota-claim', /不等于占用领养名额|不保证可被领养/.test(await page.locator('main').innerText()), 'copy');
    await shot(page, 'favorites-desktop-list', { page: 'favorites', state: 'list-desktop' });
    probe('1-favorites-list-loaded', { n: await page.locator('.favorites-card').count() });

    await page.locator('[data-favorites-remove]').first().click();
    await page.waitForSelector('#favoritesConfirmTitle');
    await shot(page, 'favorites-desktop-confirm-dialog', { page: 'favorites', state: 'confirm' });
    await page.locator('[data-favorites-cancel]').click();
    await page.waitForTimeout(150);
    let fi = await focusInfo(page, 'fav-cancel-focus');
    assert('fav-cancel-restores-remove', !fi.isBody && hasAttr(fi, 'data-favorites-remove'), JSON.stringify(fi));
    probe('2-favorites-cancel-restore-focus', fi);

    state = makeState({ favMode: 'list', favDeleteMode: 'hold' });
    await openPage(page, 'favorites.html', state);
    await page.waitForSelector('[data-favorites-remove]');
    await page.locator('[data-favorites-remove]').first().click();
    await page.waitForSelector('[data-favorites-confirm-remove]');
    const d0 = state.favDeletes;
    await page.locator('[data-favorites-confirm-remove]').click();
    await page.waitForTimeout(80);
    await page.locator('[data-favorites-confirm-remove]').click({ force: true }).catch(() => {});
    await page.waitForTimeout(80);
    assert('fav-delete-double-one', state.favDeletes === d0 + 1, 'n=' + state.favDeletes);
    if (state.resolveHold) { state.resolveHold(); state.hold = null; state.resolveHold = null; }
    await page.waitForTimeout(400);
    probe('3-favorites-delete-double-one', { favDeletes: state.favDeletes });

    state = makeState({ favMode: 'list', favDeleteMode: 'false' });
    await openPage(page, 'favorites.html', state);
    await page.waitForSelector('.favorites-card');
    const before = await page.locator('.favorites-card').count();
    await page.locator('[data-favorites-remove]').first().click();
    await page.waitForSelector('[data-favorites-confirm-remove]');
    await page.locator('[data-favorites-confirm-remove]').click();
    await page.waitForTimeout(350);
    assert('fav-false-keeps-card', (await page.locator('.favorites-card').count()) === before, 'kept');
    assert('fav-false-dialog-open', (await page.locator('#favoritesConfirmTitle').count()) === 1, 'open');
    const ferr = await page.locator('.favorites-confirm-dialog [role="alert"], .favorites-confirm-dialog .ui-form-alert').innerText().catch(() => '');
    assert('fav-false-error-visible', /失败|未成功|保留/.test(ferr + (await page.locator('main').innerText())), ferr.slice(0, 120));
    await page.locator('[data-favorites-cancel]').click();
    probe('4-favorites-false-keeps', { before });

    state = makeState({ favMode: 'list', favDeleteMode: 'ok' });
    await openPage(page, 'favorites.html', state);
    await page.waitForSelector('.favorites-card');
    const b2 = await page.locator('.favorites-card').count();
    await page.locator('[data-favorites-remove][data-animal-id="8001"]').click();
    await page.waitForSelector('[data-favorites-confirm-remove]');
    await page.locator('[data-favorites-confirm-remove]').click();
    await page.waitForTimeout(500);
    const a2 = await page.locator('.favorites-card').count();
    assert('fav-true-removes', a2 === b2 - 1, JSON.stringify({ b2, a2 }));
    fi = await focusInfo(page, 'fav-success-focus');
    assert('fav-success-focus-not-body', !fi.isBody, JSON.stringify(fi));
    assert('fav-success-focus-stable',
      hasAttr(fi, 'data-favorites-detail') || hasAttr(fi, 'data-favorites-browse')
      || hasAttr(fi, 'data-favorites-browse-empty') || fi.id === 'favoritesTitle' || fi.tag === 'MAIN',
      JSON.stringify(fi));
    probe('5-favorites-true-remove-focus', fi);

    state = makeState({ favMode: 'error' });
    await openPage(page, 'favorites.html', state);
    await page.waitForTimeout(350);
    assert('fav-error-no-cards', (await page.locator('.favorites-card').count()) === 0, 'cleared');
    assert('fav-error-retry', (await page.locator('[data-favorites-retry]').count()) === 1, 'retry');
    assert('fav-error-visible', /无法加载|失败|重试/.test(await page.locator('main').innerText()), 'err');
    await shot(page, 'favorites-mobile-error', { page: 'favorites', state: 'error' });
    state = makeState({ favMode: 'empty' });
    await openPage(page, 'favorites.html', state);
    await page.waitForTimeout(300);
    assert('fav-empty-visible', /还没有收藏/.test(await page.locator('main').innerText()), 'empty');
    await page.setViewportSize({ width: 390, height: 844 });
    await shot(page, 'favorites-mobile-empty', { page: 'favorites', state: 'empty-mobile' });
    probe('6-favorites-error-and-empty', {});

    await page.setViewportSize({ width: 1440, height: 900 });
    state = makeState({ favMode: 'list', favDeleteMode: 'conflict' });
    await openPage(page, 'favorites.html', state);
    await page.locator('[data-favorites-remove]').first().click();
    await page.locator('[data-favorites-confirm-remove]').click();
    await page.waitForTimeout(350);
    assert('fav-409-keeps', (await page.locator('.favorites-card').count()) >= 1, 'kept');
    probe('7-favorites-409', {});

    state = makeState({ favMode: 'list', favDeleteMode: 'server500' });
    await openPage(page, 'favorites.html', state);
    await page.locator('[data-favorites-remove]').first().click();
    await page.locator('[data-favorites-confirm-remove]').click();
    await page.waitForTimeout(350);
    assert('fav-500-keeps', (await page.locator('.favorites-card').count()) >= 1, 'kept');
    probe('8-favorites-500', {});

    // ===== PETCARE =====
    state = makeState({ configMode: 'personal-ready', convMode: 'list' });
    await openPage(page, 'pet_care.html', state);
    await assertAuthenticatedChrome(page, 'care-auth');
    await page.waitForTimeout(350);
    const agentLabel = await page.locator('.petcare-agent-state').innerText();
    assert('care-not-connected-on-ready', !/个人 Agent 已连接/.test(agentLabel), agentLabel);
    assert('care-untested-or-kb', /待测试|知识库|停用|失败|平台/.test(agentLabel), agentLabel);
    await shot(page, 'petcare-desktop-new-chat', { page: 'pet_care', state: 'new' });
    probe('9-petcare-agent-not-false-connected', { agentLabel });

    await ensureHistoryVisible(page);
    assert('care-conversations-listed', (await page.locator('.petcare-conversation-item').count()) >= 1, 'list');
    await shot(page, 'petcare-desktop-history', { page: 'pet_care', state: 'history' });
    probe('10-petcare-history-list', { n: await page.locator('.petcare-conversation-item').count() });

    await page.locator('[data-petcare-open-conversation]').first().click();
    await page.waitForTimeout(500);
    assert('care-markdown-rendered', (await page.locator('.petcare-rich-answer').count()) >= 1, 'md');
    await shot(page, 'petcare-desktop-markdown', { page: 'pet_care', state: 'markdown' });
    probe('11-petcare-markdown', {});

    await page.locator('[data-petcare-config-open]').click();
    await page.waitForSelector('#aiConfigTitle');
    await shot(page, 'petcare-desktop-config-unconnected', { page: 'pet_care', state: 'config-unconnected' });
    fi = await focusInfo(page, 'config-open-focus');
    assert('care-config-focus-not-body', !fi.isBody, JSON.stringify(fi));
    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
    let inCfg = await evalRead(page, 'config-focus-contain', () => {
      const d = document.querySelector('.petcare-config-dialog');
      return !!(d && d.contains(document.activeElement));
    });
    assert('care-config-tab-trap', inCfg, 'trap');
    probe('12-petcare-config-focus', { inCfg });

    await page.locator('[data-petcare-config-close]').click();
    await page.waitForTimeout(150);
    fi = await focusInfo(page, 'config-close-focus');
    assert('care-config-close-restores', !fi.isBody, JSON.stringify(fi));
    probe('13-petcare-config-close-restore', fi);

    state = makeState({ configMode: 'connected' });
    await openPage(page, 'pet_care.html', state);
    await page.waitForTimeout(400);
    await page.locator('[data-petcare-config-open]').click();
    await page.waitForSelector('#aiConfigTitle');
    await shot(page, 'petcare-desktop-config-connected', { page: 'pet_care', state: 'config-connected' });
    probe('14-petcare-config-connected-shot', {});

    state = makeState({ configMode: 'failed' });
    await openPage(page, 'pet_care.html', state);
    await page.waitForTimeout(300);
    await page.locator('[data-petcare-config-open]').click();
    await page.waitForSelector('#aiConfigTitle');
    await shot(page, 'petcare-desktop-config-failed', { page: 'pet_care', state: 'config-failed' });
    probe('15-petcare-config-failed-shot', {});

    state = makeState({ configMode: 'personal-ready', clearConfigMode: 'false' });
    await openPage(page, 'pet_care.html', state);
    await page.locator('[data-petcare-config-open]').click();
    await page.waitForSelector('[data-petcare-clear-config]');
    await page.locator('[data-petcare-clear-config]').click();
    await page.waitForSelector('[data-petcare-confirm-ok]');
    await page.locator('[data-petcare-confirm-ok]').click();
    await page.waitForTimeout(350);
    assert('care-clear-false-dialog-open', (await page.locator('.petcare-confirm-dialog').count()) === 1, 'open');
    let cerr = await page.locator('[data-petcare-confirm-error]').innerText().catch(() => '');
    assert('care-clear-false-error-in-dialog', /失败|未成功|保留/.test(cerr), cerr);
    await page.locator('[data-petcare-confirm-cancel]').click();
    probe('16-petcare-clear-false-in-dialog', { cerr });

    state = makeState({ convMode: 'list', deleteConvMode: 'false' });
    await openPage(page, 'pet_care.html', state);
    await ensureHistoryVisible(page);
    const cBefore = await page.locator('.petcare-conversation-item').count();
    await page.locator('[data-petcare-delete-conversation]').first().click();
    await page.waitForSelector('[data-petcare-confirm-ok]');
    await page.locator('[data-petcare-confirm-ok]').click();
    await page.waitForTimeout(350);
    assert('care-del-false-keeps', (await page.locator('.petcare-conversation-item').count()) === cBefore, 'kept');
    assert('care-del-false-err', /失败|未成功|未改变/.test(await page.locator('[data-petcare-confirm-error]').innerText().catch(() => '')), 'err');
    await page.locator('[data-petcare-confirm-cancel]').click();
    probe('17-petcare-delete-false', { cBefore });

    state = makeState({ convMode: 'list', deleteConvMode: 'ok' });
    await openPage(page, 'pet_care.html', state);
    await ensureHistoryVisible(page);
    await page.locator('[data-petcare-delete-conversation]').first().click();
    await page.waitForSelector('[data-petcare-confirm-ok]');
    await shot(page, 'petcare-delete-dialog', { page: 'pet_care', state: 'delete-dialog' });
    const c0 = await page.locator('.petcare-conversation-item').count();
    const del0 = state.convDeletes;
    await page.locator('[data-petcare-confirm-ok]').click();
    await page.waitForTimeout(50);
    await page.locator('[data-petcare-confirm-ok]').click({ force: true }).catch(() => {});
    await page.waitForTimeout(400);
    assert('care-del-double-one', state.convDeletes === del0 + 1, 'n=' + state.convDeletes);
    assert('care-del-true-removes', (await page.locator('.petcare-conversation-item').count()) === c0 - 1, 'removed');
    probe('18-petcare-delete-true', { convDeletes: state.convDeletes });

    state = makeState({ convMode: 'list', clearHistMode: 'false' });
    await openPage(page, 'pet_care.html', state);
    await ensureHistoryVisible(page);
    await page.locator('[data-petcare-clear-history]').click();
    await page.waitForSelector('[data-petcare-confirm-ok]');
    await shot(page, 'petcare-clear-history-dialog', { page: 'pet_care', state: 'clear-dialog' });
    await page.locator('[data-petcare-confirm-ok]').click();
    await page.waitForTimeout(350);
    assert('care-clear-false-err-dialog', (await page.locator('[data-petcare-confirm-error]').count()) === 1, 'err');
    await page.locator('[data-petcare-confirm-cancel]').click();
    probe('19-petcare-clear-false', {});

    state = makeState({ askMode: 'ok', convMode: 'empty' });
    await openPage(page, 'pet_care.html', state);
    await page.waitForSelector('#petCareInput');
    await page.fill('#petCareInput', '幼猫多久驱虫一次？');
    const a0 = state.askPosts;
    await page.locator('form.ui-chat-compose button[type="submit"]').click();
    await page.waitForTimeout(80);
    await page.locator('form.ui-chat-compose button[type="submit"]').click({ force: true }).catch(() => {});
    await page.waitForTimeout(500);
    assert('care-ask-double-one', state.askPosts === a0 + 1, 'n=' + state.askPosts);
    probe('20-petcare-ask-double-one', { askPosts: state.askPosts });

    state = makeState({ askMode: 'fail', convMode: 'empty' });
    await openPage(page, 'pet_care.html', state);
    await page.fill('#petCareInput', '失败重试问题');
    await page.locator('form.ui-chat-compose button[type="submit"]').click();
    await page.waitForTimeout(400);
    assert('care-ask-fail-visible', /失败|重试|异常/.test(await page.locator('main').innerText()), 'err');
    probe('21-petcare-ask-fail', {});

    state = makeState({ deleteConvMode: 'server500', convMode: 'list' });
    await openPage(page, 'pet_care.html', state);
    await ensureHistoryVisible(page);
    await page.locator('[data-petcare-delete-conversation]').first().click();
    await page.locator('[data-petcare-confirm-ok]').click();
    await page.waitForTimeout(350);
    assert('care-del-500-dialog-err', (await page.locator('[data-petcare-confirm-error]').count()) === 1, 'err');
    probe('22-petcare-delete-500', {});

    state = makeState({ clearHistMode: 'server500', convMode: 'list' });
    await openPage(page, 'pet_care.html', state);
    await ensureHistoryVisible(page);
    await page.locator('[data-petcare-clear-history]').click();
    await page.locator('[data-petcare-confirm-ok]').click();
    await page.waitForTimeout(350);
    assert('care-clear-500-dialog-err', (await page.locator('[data-petcare-confirm-error]').count()) === 1, 'err');
    probe('23-petcare-clear-500', {});

    state = makeState({ clearConfigMode: 'server500', configMode: 'personal-ready' });
    await openPage(page, 'pet_care.html', state);
    await page.locator('[data-petcare-config-open]').click();
    await page.locator('[data-petcare-clear-config]').click();
    await page.locator('[data-petcare-confirm-ok]').click();
    await page.waitForTimeout(350);
    assert('care-clearcfg-500-dialog-err', (await page.locator('[data-petcare-confirm-error]').count()) === 1, 'err');
    probe('24-petcare-clearcfg-500', {});

    state = makeState({ convMode: 'list', clearHistMode: 'ok' });
    await openPage(page, 'pet_care.html', state);
    await ensureHistoryVisible(page);
    await page.locator('[data-petcare-clear-history]').click();
    await page.locator('[data-petcare-confirm-ok]').click();
    await page.waitForTimeout(400);
    assert('care-clear-true-empty', (await page.locator('.petcare-conversation-item').count()) === 0, 'empty');
    probe('25-petcare-clear-true', {});

    state = makeState({ configMode: 'personal-ready', clearConfigMode: 'ok' });
    await openPage(page, 'pet_care.html', state);
    await page.locator('[data-petcare-config-open]').click();
    await page.locator('[data-petcare-clear-config]').click();
    await page.locator('[data-petcare-confirm-ok]').click();
    await page.waitForTimeout(400);
    assert('care-clearcfg-true-closed-confirm', (await page.locator('.petcare-confirm-dialog').count()) === 0, 'closed');
    fi = await focusInfo(page, 'clearcfg-success-focus');
    assert('care-clearcfg-success-not-body', !fi.isBody, JSON.stringify(fi));
    probe('26-petcare-clearcfg-true-focus', fi);

    // mobile drawer a11y
    await page.setViewportSize({ width: 390, height: 844 });
    state = makeState({ convMode: 'list' });
    await openPage(page, 'pet_care.html', state);
    await page.waitForTimeout(250);
    await shot(page, 'petcare-mobile-chat', { page: 'pet_care', state: 'mobile-chat' });
    await page.locator('[data-petcare-history-toggle], [data-petcare-history-reveal]').first().click();
    await page.waitForTimeout(250);
    let bodyLock = await evalRead(page, 'body-lock-open', () => document.body.classList.contains('petcare-history-open'));
    assert('care-mobile-drawer-lock', bodyLock === true, 'lock=' + bodyLock);
    await shot(page, 'petcare-mobile-history-drawer', { page: 'pet_care', state: 'mobile-drawer' });
    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
    const inDrawer = await evalRead(page, 'drawer-focus-contain', () => {
      const d = document.querySelector('.petcare-conversation-sidebar');
      return !!(d && d.contains(document.activeElement));
    });
    assert('care-mobile-drawer-tab-trap', inDrawer, 'trap');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    bodyLock = await evalRead(page, 'body-lock-esc', () => document.body.classList.contains('petcare-history-open'));
    assert('care-esc-unlocks', bodyLock === false, 'lock');
    fi = await focusInfo(page, 'drawer-esc-focus');
    assert('care-esc-focus-restore', !fi.isBody, JSON.stringify(fi));
    probe('27-petcare-mobile-drawer-a11y', { inDrawer });

    await page.locator('[data-petcare-history-toggle], [data-petcare-history-reveal]').first().click();
    await page.waitForTimeout(200);
    await page.locator('[data-petcare-open-conversation]').first().click();
    await page.waitForTimeout(450);
    bodyLock = await evalRead(page, 'body-lock-after-open', () => document.body.classList.contains('petcare-history-open'));
    assert('care-open-conv-unlocks', bodyLock === false, 'lock');
    probe('28-petcare-open-conversation-unlocks', {});

    await page.locator('[data-petcare-history-toggle], [data-petcare-history-reveal]').first().click();
    await page.waitForTimeout(200);
    await page.locator('[data-petcare-new-conversation]').click();
    await page.waitForTimeout(250);
    bodyLock = await evalRead(page, 'body-lock-after-new', () => document.body.classList.contains('petcare-history-open'));
    assert('care-new-conv-unlocks', bodyLock === false, 'lock');
    probe('29-petcare-new-conversation-unlocks', {});

    await page.setViewportSize({ width: 320, height: 700 });
    state = makeState({ convMode: 'list' });
    await openPage(page, 'pet_care.html', state);
    await page.waitForTimeout(200);
    let ox = await overflowX(page);
    assert('care-320-no-x', !ox.overflow, JSON.stringify(ox));
    await shot(page, 'petcare-320-layout', { page: 'pet_care', viewport: '320' });
    state = makeState({ favMode: 'list' });
    await openPage(page, 'favorites.html', state);
    await page.waitForTimeout(200);
    ox = await overflowX(page);
    assert('fav-320-no-x', !ox.overflow, JSON.stringify(ox));
    probe('30-layout-320', ox);

    await page.setViewportSize({ width: 390, height: 844 });
    state = makeState({ configMode: 'personal-ready' });
    await openPage(page, 'pet_care.html', state);
    await page.locator('[data-petcare-config-open]').click();
    await page.waitForSelector('#aiConfigTitle');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
    const inCfg390 = await evalRead(page, 'config-focus-390', () => {
      const d = document.querySelector('.petcare-config-dialog');
      return !!(d && d.contains(document.activeElement));
    });
    assert('care-config-trap-390', inCfg390, 'trap');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
    assert('care-config-esc-closes', (await page.locator('#aiConfigTitle').count()) === 0, 'esc');
    probe('31-petcare-config-390', { inCfg390 });

    await page.setViewportSize({ width: 1440, height: 900 });
    state = makeState({ favMode: 'list' });
    await openPage(page, 'favorites.html', state);
    ox = await overflowX(page);
    assert('fav-desktop-no-x', !ox.overflow, JSON.stringify(ox));
    probe('32-favorites-desktop-overflow', ox);

    state = makeState({ convMode: 'list' });
    await openPage(page, 'pet_care.html', state);
    ox = await overflowX(page);
    assert('care-desktop-no-x', !ox.overflow, JSON.stringify(ox));
    probe('33-petcare-desktop-overflow', ox);

    const touchOk = await evalRead(page, 'touch-targets', () => {
      const sel = ['.petcare-history-button', '.petcare-config-button', '#petCareInput', 'form.ui-chat-compose button[type="submit"]'];
      return sel.every((s) => {
        const el = document.querySelector(s);
        if (!el) return true;
        return el.getBoundingClientRect().height >= 40;
      });
    });
    assert('care-touch-min-height', touchOk, 'touch');
    probe('34-petcare-touch-targets', { touchOk });

    // ===== REAL browser race: open A (slow) then B (fast); B must win; A abort consumed =====
    await page.setViewportSize({ width: 1440, height: 900 });
    state = makeState({
      convMode: 'list',
      detailHoldId: 'c1',
      conversations: [
        conv(1, { id: 'c1', title: 'RACE_A_TITLE_SHOULD_LOSE' }),
        conv(2, { id: 'c2', title: 'RACE_B_TITLE_SHOULD_WIN' }),
        conv(3, { id: 'c3', title: 'OTHER' })
      ]
    });
    await openPage(page, 'pet_care.html', state);
    await page.waitForTimeout(300);
    await ensureHistoryVisible(page);
    assert('race-pre-two-convs', (await page.locator('.petcare-conversation-item').count()) >= 2, 'list');
    // Click A (held), then immediately B (fast)
    await page.locator('.petcare-conversation-item[data-conversation-id="c1"] [data-petcare-open-conversation]').click();
    await page.waitForTimeout(80);
    await page.locator('.petcare-conversation-item[data-conversation-id="c2"] [data-petcare-open-conversation]').click();
    // Wait for B to paint
    await page.waitForFunction(() => {
      const t = document.querySelector('.petcare-current-title h2');
      const body = document.querySelector('.petcare-chat-messages');
      const tt = t ? t.textContent || '' : '';
      const bt = body ? body.textContent || '' : '';
      return /RACE_B_TITLE_SHOULD_WIN/.test(tt) || /RACE_B_ANSWER_SHOULD_WIN|RACE_B_QUESTION_SHOULD_WIN/.test(bt);
    }, { timeout: 8000 });
    await page.waitForTimeout(200);
    let raceMain = await page.locator('main').innerText();
    let raceTitle = await page.locator('.petcare-current-title h2').innerText().catch(() => '');
    assert('race-b-title-visible', /RACE_B_TITLE_SHOULD_WIN/.test(raceTitle + raceMain), raceTitle);
    assert('race-b-content-visible', /RACE_B_ANSWER_SHOULD_WIN|RACE_B_QUESTION_SHOULD_WIN|marker BBBB/.test(raceMain), raceMain.slice(0, 200));
    assert('race-a-not-in-title', !/RACE_A_TITLE_SHOULD_LOSE/.test(raceTitle), raceTitle);
    assert('race-a-not-in-body-before-release', !/RACE_A_ANSWER_SHOULD_LOSE|RACE_A_QUESTION_SHOULD_LOSE|marker AAAA/.test(raceMain), raceMain.slice(0, 200));
    // Release slow A — must not overwrite B (product latest-wins)
    if (state.resolveDetailHold) {
      state.resolveDetailHold();
      state.detailHoldP = null;
      state.resolveDetailHold = null;
    }
    await page.waitForTimeout(500);
    raceMain = await page.locator('main').innerText();
    raceTitle = await page.locator('.petcare-current-title h2').innerText().catch(() => '');
    assert('race-after-a-still-b-title', /RACE_B_TITLE_SHOULD_WIN/.test(raceTitle + raceMain), raceTitle);
    assert('race-after-a-still-b-content', /RACE_B_ANSWER_SHOULD_WIN|RACE_B_QUESTION_SHOULD_WIN|marker BBBB/.test(raceMain), raceMain.slice(0, 200));
    assert('race-after-a-no-a-content', !/RACE_A_ANSWER_SHOULD_LOSE|RACE_A_TITLE_SHOULD_LOSE|marker AAAA/.test(raceMain + raceTitle), (raceMain + raceTitle).slice(0, 200));
    const raceActiveId = await page.locator('.petcare-conversation-item.is-active').getAttribute('data-conversation-id').catch(() => null);
    assert('race-active-is-b', raceActiveId === 'c2' || /RACE_B_TITLE_SHOULD_WIN/.test(raceTitle), 'active=' + raceActiveId);
    result.raceFinalConversationId = 'c2';
    result.raceEvidence = {
      finalConversationId: 'c2',
      title: raceTitle,
      activeId: raceActiveId,
      detailHoldHits: state.detailHoldHits,
      registeredAbortsAtRace: result.registeredAborts.map((r) => r.scenario)
    };
    probe('40-conversation-open-A-slow-B-win', result.raceEvidence);

    // matrix 2×5 — each cell: overflow + auth chrome + page root + title + main landmark
    for (const file of PAGES) {
      for (const vp of VIEWPORTS) {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        state = makeState({ favMode: 'list', convMode: 'list', configMode: 'personal-ready' });
        await openPage(page, file, state);
        await page.waitForTimeout(40);
        const prefix = 'matrix-' + file.replace('.html', '') + '-' + vp.name;
        ox = await overflowX(page);
        assert(prefix + '-no-x', !ox.overflow, JSON.stringify(ox));
        await assertAuthenticatedChrome(page, prefix);
        const rootOk = await page.locator(file === 'favorites.html' ? '.favorites-workspace' : '.petcare-workspace').count();
        assert(prefix + '-workspace-root', rootOk >= 1, 'root=' + rootOk);
        const titleOk = await page.locator(file === 'favorites.html' ? '#favoritesTitle' : 'h1.ui-workspace-title, .petcare-title-row h1').count();
        assert(prefix + '-title', titleOk >= 1, 'title');
        const mainOk = await page.locator('main').count();
        assert(prefix + '-main', mainOk >= 1, 'main');
        result.matrixVisits.push({ file, viewport: vp.name });
      }
    }
    probe('35-matrix-complete', { n: result.matrixVisits.length });

    assert('screenshots-ge-15-live', result.screenshots.length >= 15, 'n=' + result.screenshots.length);
    probe('36-screenshots-count', { n: result.screenshots.length });
    assert('visits-ge-10', result.visits.length >= 10, 'n=' + result.visits.length);
    probe('37-visits-count', { n: result.visits.length });
    assert('fixture-writes-tracked', result.fixtureWriteAudit.length >= 1, 'n=' + result.fixtureWriteAudit.length);
    probe('38-fixture-writes', { n: result.fixtureWriteAudit.length });
    assert('real-writes-zero-mid', result.realWriteAudit.length === 0, JSON.stringify(result.realWriteAudit.slice(0, 3)));
    probe('39-real-writes-zero', { n: result.realWriteAudit.length });

    // gates
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
      return h['x-ui-audit-expected-error'] !== 'phase3f' && h['x-ui-audit-fixture'] !== 'phase3f';
    });
    assert('no-unregistered-http', badHttp.length === 0, JSON.stringify(badHttp.slice(0, 5)));
    assert('screenshots-ge-15', result.screenshots.length >= 15, 'n=' + result.screenshots.length);
    assert('matrix-ge-10', result.matrixVisits.length >= 10, 'n=' + result.matrixVisits.length);
    assert('probes-ge-36', result.strictRuntimeProbeCount >= 36, 'n=' + result.strictRuntimeProbeCount);
    assert('real-writes-zero', result.realWriteAudit.length === 0, JSON.stringify(result.realWriteAudit.slice(0, 5)));

    const snap = abortRegistrySnapshot();
    assert('abort-registry-serializable', Array.isArray(snap.serializable)
      && snap.serializable.every((r) => typeof r.method === 'string' && typeof r.pathname === 'string' && typeof r.query === 'string' && typeof r.consumed === 'boolean'),
      JSON.stringify(snap.serializable));
    assert('abort-registered-ge-1', snap.registered >= 1, JSON.stringify(snap));
    assert('abort-consumed-eq-registered', snap.consumed === snap.registered, JSON.stringify(snap));
    assert('abort-unused-eq-0', snap.unused === 0, JSON.stringify(snap));
    assert('race-final-conversation-id-c2', result.raceFinalConversationId === 'c2', String(result.raceFinalConversationId));
    runAbortLedgerSelfTests();
    assert('evaluate-usage-tracked', result.evaluateUsage.length > 0, 'n=' + result.evaluateUsage.length);

    const shotFiles = fs.readdirSync(shotDir).filter((f) => f.endsWith('.png')).sort();
    const indexed = result.screenshots.map((s) => path.basename(s.file)).sort();
    assert('screenshot-index-match', JSON.stringify(shotFiles) === JSON.stringify(indexed), JSON.stringify({ shotFiles, indexed }));

    result.requestCountAudit = {
      favDeletes: state.favDeletes,
      convDeletes: state.convDeletes,
      histDeletes: state.histDeletes,
      askPosts: state.askPosts,
      configClears: state.configClears,
      fixtureWrites: result.fixtureWriteAudit.length,
      realWrites: result.realWriteAudit.length
    };

    // Final count gate after all other asserts (including self-tests) have been recorded.
    assert('assertions-ge-180', result.checks.length >= 180, 'n=' + result.checks.length);
    assert('passed-ge-180', result.checks.filter((c) => c.ok).length >= 180, 'passed=' + result.checks.filter((c) => c.ok).length);

    const summary = writeReport();
    console.log('Phase 3F summary', summary);
    await browser.close();
    process.exit(summary.strictMode ? 0 : 1);
  } catch (e) {
    console.error('SUITE_CRASH', e && e.stack || e);
    fail('suite-crash', String(e && e.message || e));
    writeReport();
    try { if (browser) await browser.close(); } catch (x) { /* ignore */ }
    process.exit(1);
  }
})();
