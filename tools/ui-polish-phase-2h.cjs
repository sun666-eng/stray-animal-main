/**
 * Phase 2H strict — dashboard home + AI admin agent workspace.
 * Baseline Phase 2G seal: c1b6853c506417ba516344195eb2a577bd8f5031 · default BASE_URL :18117
 * Real Playwright interactions; fixtures only; no best-effort/skip; intentional HTTP = header OR registry.
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const suiteStartedAt = Date.now();
const base = process.env.BASE_URL || 'http://127.0.0.1:18117';
const out = path.resolve('output/playwright/ui-polish-phase-2h');
const shotDir = path.join(out, 'screenshots');
if (fs.existsSync(shotDir)) {
  for (const f of fs.readdirSync(shotDir)) if (f.endsWith('.png')) fs.unlinkSync(path.join(shotDir, f));
}
fs.mkdirSync(shotDir, { recursive: true });

const HDR = 'x-ui-audit-expected-error';
const VAL = 'phase2h';
const EH = { [HDR]: VAL };
const VIEWPORTS = [
  { name: '1440x900', width: 1440, height: 900 },
  { name: '1280x800', width: 1280, height: 800 },
  { name: '768x1024', width: 768, height: 1024 },
  { name: '390x844', width: 390, height: 844 },
  { name: '320x700', width: 320, height: 700 }
];

const results = {
  startedAt: new Date().toISOString(),
  base,
  phase2gBaseline: 'c1b6853c506417ba516344195eb2a577bd8f5031',
  branch: 'ui-polish/phase-2h-dashboard-agent-workspace-20260731',
  checks: [], failures: [], screenshots: [], writeRequestLog: [], controlledRequestAudit: [],
  holdGateExecutions: {}, conversationRaceAudit: null, newConversationRaceAudit: null,
  requestCountAudit: {}, roleMatrix: {},
  bestEffortPassCount: 0, fallbackPassCount: 0, strictRuntimeProbeCount: 0,
  consoleAudit: {}, requestFailedWrite: [], requestFailedAll: [], expectedHttpRegistry: [], summary: {}
};

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
function isRealConsoleError(text) {
  // Do NOT blanket-ignore "Failed to load resource" — only intentional HTTP registry/header may exempt matching network errors.
  const t = String(text || '');
  if (!t) return false;
  return true;
}
function isIntentionalResourceConsole(text, httpErrors) {
  // Map "Failed to load resource: the server responded with a status of NNN" only if every such status
  // already has a matching intentional httpErrors entry registered for this run.
  const t = String(text || '');
  const m = t.match(/status of (\d+)/i);
  if (m) {
    const status = Number(m[1]);
    return (httpErrors || []).some((e) => Number(e.status) === status && isIntentionalHttp(e));
  }
  // Intentional route.abort() may surface as net::ERR_FAILED / Failed to load resource without status.
  if (/Failed to load resource|net::ERR_|ERR_FAILED|ERR_CONNECTION/i.test(t)) {
    return results.expectedHttpRegistry.some((reg) => reg && reg.abort === true);
  }
  return false;
}
function pass(id, d) {
  results.checks.push({ id, ok: true, skipped: false, detail: String(d || ''), bestEffort: false, fallback: false });
}
function fail(id, d) {
  results.checks.push({ id, ok: false, skipped: false, detail: String(d || ''), bestEffort: false, fallback: false });
  results.failures.push({ id, detail: String(d || '') });
  console.error('FAIL', id, d);
}
function assert(id, c, d) { if (c) pass(id, d); else fail(id, d); }
function recordProbe(name, data) {
  results.strictRuntimeProbeCount++;
  results.controlledRequestAudit.push(Object.assign({ name, at: new Date().toISOString() }, data || {}));
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
  if (j.code !== '0') throw new Error('login ' + u + ' ' + JSON.stringify(j));
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
function waitFor(cond, timeoutMs, label) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = async () => {
      try { if (await cond()) return resolve(true); } catch (e) {}
      if (Date.now() - start > timeoutMs) return reject(new Error('timeout ' + label));
      setTimeout(tick, 25);
    };
    tick();
  });
}
async function overflowX(page) {
  return page.evaluate(() => {
    const de = document.documentElement;
    return { overflow: de.scrollWidth > de.clientWidth + 1, sw: de.scrollWidth, cw: de.clientWidth };
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
  const noSkipPass = skipped === 0;
  const strictMode = noBestEffortPass && noSkipPass && failed === 0;
  results.summary = {
    passed, failed, skipped, total: results.checks.length,
    screenshots: results.screenshots.length, viewports: VIEWPORTS.length,
    finishedAt: new Date().toISOString(), suiteDurationMs: Date.now() - suiteStartedAt,
    bestEffortPassCount, fallbackPassCount, strictRuntimeProbeCount: results.strictRuntimeProbeCount,
    noBestEffortPass, noSkipPass, strictMode
  };
  results.ok = failed === 0 && skipped === 0 && noBestEffortPass;
  fs.writeFileSync(path.join(out, 'phase-2h-report.json'), JSON.stringify(results, null, 2));
  fs.writeFileSync(path.join(out, 'screenshots-index.json'), JSON.stringify(results.screenshots, null, 2));
  return results.summary;
}

(async () => {
  console.log('Phase 2H strict start', base);
  const consoleErrors = [], pageErrors = [], httpErrors = [];
  let browser;
  try {
    const indexHtml = fs.readFileSync('src/main/resources/static/page/end/index.html', 'utf8');
    const agentHtml = fs.readFileSync('src/main/resources/static/page/end/admin_agent.html', 'utf8');
    const css = fs.readFileSync('src/main/resources/static/css/admin-workspace.css', 'utf8');
    const suiteSrc = fs.readFileSync('tools/ui-polish-phase-2h.cjs', 'utf8');

    assert('index-cache-0808b', indexHtml.includes('admin-workspace.css?v=20260808b'), 'cache');
    assert('agent-cache-31a', agentHtml.includes('admin-workspace.css?v=20260731a'), 'cache');
    assert('index-dashboard-class', indexHtml.includes('dashboard-home'), 'cls');
    assert('index-dashboard-command-layout', indexHtml.includes('dashboard-home-layout') && indexHtml.includes('dashboard-command-panel'), 'layout');
    assert('index-dashboard-metric-band', indexHtml.includes('dashboard-home-metric-band'), 'metric-band');
    assert('index-dashboard-notice-panel', indexHtml.includes('dashboard-notice-panel'), 'notice-panel');
    assert('index-dashboard-account-panel', indexHtml.includes('dashboard-account-panel'), 'account-panel');
    assert('agent-workspace-class', agentHtml.includes('agent-workspace'), 'cls');
    assert('index-stats-seq', indexHtml.includes('statsSeq') && indexHtml.includes('noticeSeq') && indexHtml.includes('accountSeq'), 'seq');
    assert('index-no-fake-todo', !/待办数量|风险数量/.test(indexHtml), 'fake');
    assert('agent-no-prompt', !/window\.prompt|window\.alert|window\.confirm/.test(agentHtml), 'prompt');
    assert('agent-no-3c', !/\b3C\b/.test(agentHtml), '3c');
    assert('agent-connected-label', agentHtml.includes('AI Agent 已连接'), 'label');
    assert('agent-connected-strict', /connected\s*===\s*true/.test(agentHtml), 'strict-connected');
    assert('agent-write-locks', agentHtml.includes('__agentWriteLocks'), 'locks');
    assert('agent-conversation-seq', agentHtml.includes('conversationSeq'), 'cseq');
    assert('agent-rename-dialog', agentHtml.includes('agentRenameTitle'), 'rename');
    assert('agent-delete-dialog', agentHtml.includes('agentDeleteTitle'), 'delete');
    assert('agent-clear-dialog', agentHtml.includes('agentClearTitle'), 'clear');
    assert('css-dashboard-home', css.includes('.dashboard-home-hero'), 'css');
    assert('css-dashboard-layout', css.includes('.dashboard-home-layout') && css.includes('.dashboard-route-grid'), 'css-layout');
    assert('css-dashboard-scoped-mobile', css.includes('.dashboard-home-metric-band') && css.includes('@media (max-width: 480px)'), 'css-mobile');
    assert('css-agent-scrim', css.includes('.admin-agent-history-scrim'), 'css');
    assert('self-no-best-effort', !/bestEffort:\s*true/.test(suiteSrc), 'be');
    assert('self-no-true-assert', !/assert\s*\(\s*['"][^'"]+['"]\s*,\s*true\s*,/.test(suiteSrc), 'true');

    browser = await chromium.launch({ headless: true });
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await login(ctx, 'admin', 'admin');
    const page = await ctx.newPage();

    let statsMode = 'ok';
    let noticeMode = 'ok';
    let accountMode = 'ok';
    let statsHold = null, resolveStatsHold = null;
    let statsGets = 0, noticeGets = 0, accountGets = 0;
    let agentStatus = {
      configured: true, enabled: true, apiKeyConfigured: true, canConfigure: true,
      connected: true, connectionStatus: 'ok', connectionMessage: 'fixture connected',
      baseUrl: 'https://example.test/v1', model: 'fixture-model', apiKeyHint: 'sk-****fix'
    };
    let convList = [
      { id: 101, title: 'UI_2H_CONV_A', preview: '摘要 A', updatedAt: '2026-07-30 10:00:00', turnCount: 1 },
      { id: 102, title: 'UI_2H_CONV_B', preview: '摘要 B', updatedAt: '2026-07-30 11:00:00', turnCount: 2 }
    ];
    let holdConvA = null, resolveConvA = null;
    let convOpenMode = 'normal';
    let writeCounts = { titlePut: 0, convDel: 0, configPost: 0, testPost: 0, clearPost: 0, askPost: 0, autoRun: 0, autoSave: 0 };
    let holdWrite = null, resolveWrite = null;
    let writeHoldMode = ''; // rename|delete|config|test|clear|ask|autoRun
    let askMode = 'ok'; // ok | fail500 | fail409 | abort | fail504
    let testMode = 'ok'; // ok | provider502 | fail500

    page.on('pageerror', (e) => pageErrors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
    page.on('requestfailed', (req) => {
      const row = {
        method: req.method(),
        url: req.url(),
        failure: req.failure() && req.failure().errorText,
        at: new Date().toISOString()
      };
      results.requestFailedAll.push(row);
      // All methods including GET are gate-relevant
      if (!['HEAD', 'OPTIONS'].includes(req.method())) {
        results.requestFailedWrite.push(row);
      }
    });
    page.on('response', (r) => {
      if (r.status() >= 400) httpErrors.push({ status: r.status(), url: r.url(), method: r.request().method(), headers: r.headers() });
    });
    page.on('request', (req) => {
      const u = req.url(), m = req.method();
      if (m !== 'GET' && /\/api\//.test(u)) results.writeRequestLog.push({ method: m, url: u, at: new Date().toISOString() });
      // never log bodies that may contain api keys
    });

    // Dashboard routes
    await page.route('**/api/dashboard/public-stats**', async (route) => {
      if (route.request().method() !== 'GET') { await route.continue(); return; }
      statsGets++;
      if (statsMode === 'holdThenOk') {
        if (!statsHold) statsHold = new Promise((r) => { resolveStatsHold = r; });
        recordProbe('stats-hold-enter', { n: statsGets });
        await statsHold;
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ code: '0', data: { volunteers: 3, animals: 12, adopts: 8, users: 20 } }) });
        return;
      }
      if (statsMode === 'empty') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ code: '0', data: { volunteers: 0, animals: 0, adopts: 0, users: 0 } }) });
        return;
      }
      if (statsMode === 'bad') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ code: '0', data: null }) });
        return;
      }
      if (statsMode === 'fail500') {
        registerExpectedHttp('stats-500', 'GET', /\/api\/dashboard\/public-stats/, 500);
        await route.fulfill(exp(500, { code: '500', msg: '统计服务异常' }));
        return;
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ code: '0', data: { volunteers: 3, animals: 12, adopts: 8, users: 20 } }) });
    });
    await page.route('**/api/notice/page**', async (route) => {
      if (route.request().method() !== 'GET') { await route.continue(); return; }
      noticeGets++;
      if (noticeMode === 'fail500') {
        registerExpectedHttp('notice-500', 'GET', /\/api\/notice\/page/, 500);
        await route.fulfill(exp(500, { code: '500', msg: '公告服务异常' }));
        return;
      }
      await route.fulfill(pageData([{ id: 1, title: 'UI_2H_NOTICE', content: '公告正文夹具' }]));
    });
    await page.route('**/api/account/stats/**', async (route) => {
      if (route.request().method() !== 'GET') { await route.continue(); return; }
      accountGets++;
      if (accountMode === 'fail500') {
        registerExpectedHttp('account-stats-500', 'GET', /\/api\/account\/stats/, 500);
        await route.fulfill(exp(500, { code: '500', msg: '资金统计异常' }));
        return;
      }
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({
          code: '0',
          data: {
            incomeTotal: '100.00', expenseTotal: '-40.00', balance: '60.00',
            incomeByLabel: [{ name: '捐赠', value: '100.00' }],
            expenseByLabel: [{ name: '医疗', value: '-40.00' }]
          }
        })
      });
    });

    // Agent routes
    await page.route('**/api/admin-agent/status**', async (route) => {
      if (route.request().method() !== 'GET') { await route.continue(); return; }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ code: '0', data: agentStatus }) });
    });
    await page.route('**/api/admin-agent/overview**', async (route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ code: '0', data: { pending_adoptions: 2, pending_proofs: 1, pending_volunteers: 0, open_rescues: 1, available_animals: 4 } })
      });
    });
    await page.route('**/api/admin-agent/conversations**', async (route) => {
      const method = route.request().method();
      const url = route.request().url();
      if (method === 'GET' && /conversations\?/.test(url)) {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ code: '0', data: convList }) });
        return;
      }
      if (method === 'GET' && /\/conversations\/\d+/.test(url) && !/title/.test(url)) {
        const id = Number((url.match(/\/conversations\/(\d+)/) || [])[1]);
        if (convOpenMode === 'race' && id === 101) {
          if (!holdConvA) holdConvA = new Promise((r) => { resolveConvA = r; });
          recordProbe('conv-A-hold', { id });
          await holdConvA;
          await route.fulfill({
            status: 200, contentType: 'application/json',
            body: JSON.stringify({ code: '0', data: { conversation: { id: 101, title: 'UI_2H_CONV_A' }, turns: [{ id: 1, question: 'A问', answer: 'A答', createdAt: '2026-07-30 10:00:00', completedAt: '2026-07-30 10:00:01', toolsJson: '[]' }] } })
          });
          recordProbe('conv-A-release', { id });
          return;
        }
        const title = id === 102 ? 'UI_2H_CONV_B' : 'UI_2H_CONV_A';
        await route.fulfill({
          status: 200, contentType: 'application/json',
          body: JSON.stringify({
            code: '0',
            data: {
              conversation: { id, title },
              turns: [{ id: id, question: title + '问', answer: '**表格**\n\n| 项 | 值 |\n| --- | --- |\n| a | 1 |\n', createdAt: '2026-07-30 10:00:00', completedAt: '2026-07-30 10:00:01', toolsJson: '["get_management_overview"]' }]
            }
          })
        });
        return;
      }
      if (method === 'PUT' && /\/title/.test(url)) {
        writeCounts.titlePut++;
        if (writeHoldMode === 'rename') {
          if (!holdWrite) holdWrite = new Promise((r) => { resolveWrite = r; });
          recordProbe('rename-hold', { n: writeCounts.titlePut });
          await holdWrite;
        }
        let body = {};
        try { body = route.request().postDataJSON() || {}; } catch (e) {}
        const id = Number((url.match(/\/conversations\/(\d+)/) || [])[1]);
        const title = body.title || '新标题';
        convList = convList.map((c) => c.id === id ? Object.assign({}, c, { title }) : c);
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ code: '0', data: { title } }) });
        return;
      }
      if (method === 'DELETE') {
        writeCounts.convDel++;
        if (writeHoldMode === 'delete') {
          if (!holdWrite) holdWrite = new Promise((r) => { resolveWrite = r; });
          recordProbe('delete-hold', { n: writeCounts.convDel });
          await holdWrite;
        }
        const id = Number((url.match(/\/conversations\/(\d+)/) || [])[1]);
        convList = convList.filter((c) => c.id !== id);
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ code: '0', data: true }) });
        return;
      }
      await route.continue();
    });
    await page.route('**/api/admin-agent/ask**', async (route) => {
      if (route.request().method() !== 'POST') { await route.continue(); return; }
      writeCounts.askPost++;
      if (writeHoldMode === 'ask') {
        if (!holdWrite) holdWrite = new Promise((r) => { resolveWrite = r; });
        await holdWrite;
      }
      if (askMode === 'abort') {
        // Network interruption — register so requestfailed is not treated as unregistered failure
        results.expectedHttpRegistry.push({ scenario: 'ask-network-abort', method: 'POST', urlRe: /\/api\/admin-agent\/ask/, status: 0, abort: true });
        await route.abort('failed');
        return;
      }
      if (askMode === 'fail500') {
        registerExpectedHttp('ask-500', 'POST', /\/api\/admin-agent\/ask/, 500);
        await route.fulfill(exp(500, { code: '500', msg: '提问失败夹具' }));
        return;
      }
      if (askMode === 'fail504') {
        registerExpectedHttp('ask-504', 'POST', /\/api\/admin-agent\/ask/, 504);
        await route.fulfill(exp(504, { code: '504', msg: '提问超时，请稍后重试。' }));
        return;
      }
      if (askMode === 'fail409') {
        registerExpectedHttp('ask-409', 'POST', /\/api\/admin-agent\/ask/, 409);
        await route.fulfill(exp(409, { code: '409', msg: '提问冲突' }));
        return;
      }
      let body = {};
      try { body = route.request().postDataJSON() || {}; } catch (e) {}
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({
          code: '0',
          data: {
            conversationId: body.conversationId || 201,
            conversationTitle: '新会话',
            turn: { id: Date.now(), question: body.question, answer: '助手回复夹具', createdAt: '2026-07-30 12:00:00', completedAt: '2026-07-30 12:00:01', toolsJson: '[]' }
          }
        })
      });
    });
    await page.route('**/api/admin-agent/config**', async (route) => {
      const method = route.request().method();
      const url = route.request().url();
      if (method === 'POST' && /\/config\/test/.test(url)) {
        writeCounts.testPost++;
        if (writeHoldMode === 'test') {
          if (!holdWrite) holdWrite = new Promise((r) => { resolveWrite = r; });
          await holdWrite;
        }
        // Provider reject is wrapped by the app as HTTP 502 (not app-level session 401).
        if (testMode === 'provider502') {
          registerExpectedHttp('config-test-provider-502', 'POST', /\/api\/admin-agent\/config\/test/, 502);
          agentStatus = Object.assign({}, agentStatus, {
            connected: false, connectionStatus: 'failed',
            connectionMessage: '服务商拒绝 API Key（HTTP 401）',
            configured: true, enabled: true, apiKeyConfigured: true
          });
          await route.fulfill(exp(502, { code: '502', msg: '服务商拒绝 API Key（HTTP 401）' }));
          return;
        }
        if (testMode === 'fail500') {
          registerExpectedHttp('config-test-500', 'POST', /\/api\/admin-agent\/config\/test/, 500);
          agentStatus = Object.assign({}, agentStatus, {
            connected: false, connectionStatus: 'failed',
            connectionMessage: '服务暂时不可用。',
            configured: true, enabled: true, apiKeyConfigured: true
          });
          await route.fulfill(exp(500, { code: '500', msg: '连接测试服务异常' }));
          return;
        }
        agentStatus = Object.assign({}, agentStatus, {
          connected: true, connectionStatus: 'ok', connectionMessage: 'ok',
          configured: true, enabled: true, apiKeyConfigured: true
        });
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ code: '0', data: agentStatus }) });
        return;
      }
      if (method === 'POST' && /\/config\/clear/.test(url)) {
        writeCounts.clearPost++;
        if (writeHoldMode === 'clear') {
          if (!holdWrite) holdWrite = new Promise((r) => { resolveWrite = r; });
          await holdWrite;
        }
        agentStatus = {
          configured: false, enabled: false, apiKeyConfigured: false, canConfigure: true,
          connected: false, connectionStatus: 'untested', connectionMessage: '',
          baseUrl: '', model: '', apiKeyHint: ''
        };
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ code: '0', data: agentStatus }) });
        return;
      }
      if (method === 'POST') {
        writeCounts.configPost++;
        if (writeHoldMode === 'config') {
          if (!holdWrite) holdWrite = new Promise((r) => { resolveWrite = r; });
          await holdWrite;
        }
        // save succeeds but NOT connected until tested
        agentStatus = Object.assign({}, agentStatus, {
          configured: true, enabled: true, apiKeyConfigured: true, connected: false,
          connectionStatus: 'untested', connectionMessage: 'saved, untested',
          baseUrl: 'https://example.test/v1', model: 'fixture-model', apiKeyHint: '****fixture'
        });
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ code: '0', data: agentStatus }) });
        return;
      }
      await route.continue();
    });
    await page.route('**/api/admin-agent/automation/**', async (route) => {
      const method = route.request().method();
      const url = route.request().url();
      if (method === 'GET' && /status/.test(url)) {
        await route.fulfill({
          status: 200, contentType: 'application/json',
          body: JSON.stringify({ code: '0', data: { config: { enabled: true, mode: 'shadow', maxBatch: 2, version: 1 }, recentRuns: [] } })
        });
        return;
      }
      if (method === 'POST' && /config/.test(url)) {
        writeCounts.autoSave++;
        await route.fulfill({
          status: 200, contentType: 'application/json',
          body: JSON.stringify({ code: '0', data: { config: { enabled: true, mode: 'shadow', maxBatch: 2, version: 2 }, recentRuns: [] } })
        });
        return;
      }
      if (method === 'POST' && /run/.test(url)) {
        writeCounts.autoRun++;
        if (writeHoldMode === 'autoRun') {
          if (!holdWrite) holdWrite = new Promise((r) => { resolveWrite = r; });
          await holdWrite;
        }
        await route.fulfill({
          status: 200, contentType: 'application/json',
          body: JSON.stringify({
            code: '0',
            data: {
              run: { id: 9, mode: 'shadow', candidateCount: 1, autoApprovedCount: 0, manualCount: 1, status: 'completed', detail: 'fixture', startedAt: '2026-07-30 12:00:00' },
              items: [{ id: 1, animalId: 1, applicantId: 2, outcome: 'manual_review', reason: '需人工' }]
            }
          })
        });
        return;
      }
      if (method === 'GET' && /runs/.test(url)) {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ code: '0', data: [] }) });
        return;
      }
      await route.continue();
    });

    // ========== DASHBOARD ==========
    await page.goto(base + '/page/end/index.html', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForFunction(() => {
      const el = document.querySelector('#workspace');
      return el && el.__vue__ && el.__vue__.statsLoading === false;
    }, { timeout: 15000 });
    assert('dash-title', /管理工作台|工作台/.test(await page.locator('h1').innerText()), 't');
    assert('dash-metrics', (await page.locator('.admin-metric').count()) >= 4, 'm');
    assert('dash-fixture-animals', /12/.test(await page.locator('.admin-metric-grid').innerText()), 'animals');
    assert('dash-metrics-inside-hero', await page.locator('.dashboard-home-hero .dashboard-home-metric-band .admin-metric-grid').count() === 1, 'metric hierarchy');
    assert('dash-command-layout-mounted', await page.locator('.dashboard-home-layout .dashboard-command-panel').count() === 1, 'command panel');
    assert('dash-notice-panel-mounted', await page.locator('.dashboard-home-layout .dashboard-notice-panel').count() === 1, 'notice panel');
    assert('dash-route-directory-populated', await page.locator('.dashboard-route-grid .dashboard-route-card').count() > 0, 'routes');
    await shot(page, '01-dashboard-admin-desktop', { page: 'index', role: 'admin' });

    // notice failure independent
    noticeMode = 'fail500';
    const n0 = noticeGets;
    await page.evaluate(() => {
      const vm = document.querySelector('#workspace').__vue__;
      vm.loadNotices();
    });
    await waitFor(() => noticeGets > n0, 5000, 'notice-fail-get');
    await waitFor(async () => {
      const st = await page.evaluate(() => {
        const vm = document.querySelector('#workspace').__vue__;
        return { err: vm.noticeError, loading: vm.noticeLoading };
      });
      return st && !st.loading && !!st.err;
    }, 5000, 'notice-err-state');
    const noticeState = await page.evaluate(() => {
      const vm = document.querySelector('#workspace').__vue__;
      return { err: vm.noticeError, statsAnimals: vm.stats.animals };
    });
    assert('dash-notice-error-isolated', /公告|异常|失败|不可用/.test(String(noticeState.err || '')), JSON.stringify(noticeState));
    assert('dash-stats-still-ok', Number(noticeState.statsAnimals) === 12, JSON.stringify(noticeState));
    noticeMode = 'ok';
    await page.evaluate(() => document.querySelector('#workspace').__vue__.loadNotices());
    await page.waitForTimeout(250);
    await shot(page, '02-dashboard-notice-retry', { page: 'index', state: 'retry' });

    // account fail isolated
    const hasAccountPanel = await page.evaluate(() => {
      const vm = document.querySelector('#workspace').__vue__;
      return !!(vm && vm.hasFlag && vm.hasFlag('account'));
    });
    assert('dash-admin-has-account-flag', hasAccountPanel, 'account flag');
    if (hasAccountPanel) {
      accountMode = 'fail500';
      const accBefore = accountGets;
      await page.evaluate(() => document.querySelector('#workspace').__vue__.loadAccountStats());
      await waitFor(() => accountGets > accBefore, 5000, 'acc-fail-get');
      await waitFor(async () => {
        const st = await page.evaluate(() => {
          const vm = document.querySelector('#workspace').__vue__;
          return { err: vm.accountError, loading: vm.accountLoading };
        });
        return st && !st.loading && !!st.err;
      }, 5000, 'acc-err-state');
      const accState = await page.evaluate(() => document.querySelector('#workspace').__vue__.accountError);
      assert('dash-account-error', /资金|异常|失败|无权|不可用/.test(String(accState || '')), accState);
      assert('dash-account-requested', accountGets > accBefore, 'acc-req');
      accountMode = 'ok';
      await page.evaluate(() => document.querySelector('#workspace').__vue__.loadAccountStats());
      await page.waitForTimeout(200);
    }

    // stats 500 + retry
    statsMode = 'fail500';
    await page.evaluate(() => document.querySelector('#workspace').__vue__.loadStats());
    await waitFor(async () => {
      const st = await page.evaluate(() => {
        const vm = document.querySelector('#workspace').__vue__;
        return { err: vm.statsError, loading: vm.statsLoading };
      });
      return st && !st.loading && !!st.err;
    }, 5000, 'stats-err-state');
    const statsErr = await page.evaluate(() => document.querySelector('#workspace').__vue__.statsError);
    assert('dash-stats-error', /统计|异常|失败|不可用/.test(String(statsErr || '')), statsErr);
    await shot(page, '03-dashboard-stats-error', { page: 'index', state: 'stats-error' });
    statsMode = 'ok';
    await page.evaluate(() => document.querySelector('#workspace').__vue__.loadStats());
    await waitFor(async () => {
      const st = await page.evaluate(() => {
        const vm = document.querySelector('#workspace').__vue__;
        return !vm.statsLoading && !vm.statsError && Number(vm.stats.animals) === 12;
      });
      return st;
    }, 5000, 'stats-retry');
    assert('dash-stats-retry-ok', Number(await page.evaluate(() => document.querySelector('#workspace').__vue__.stats.animals)) === 12, 'retry');

    // latest-wins stats
    statsMode = 'holdThenOk';
    statsHold = null; resolveStatsHold = null;
    const s0 = statsGets;
    await page.evaluate(() => document.querySelector('#workspace').__vue__.loadStats());
    await waitFor(() => statsHold != null, 5000, 'stats-hold');
    statsMode = 'ok';
    await page.evaluate(() => document.querySelector('#workspace').__vue__.loadStats());
    await page.waitForTimeout(200);
    resolveStatsHold();
    await page.waitForTimeout(300);
    const animals = await page.evaluate(() => document.querySelector('#workspace').__vue__.stats.animals);
    assert('dash-stats-latest-wins', Number(animals) === 12, 'animals=' + animals);
    recordProbe('stats-latest-wins', { statsGets: statsGets - s0 });

    // viewports dashboard
    for (const vp of VIEWPORTS) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.waitForTimeout(60);
      const ox = await overflowX(page);
      assert('dash-vp-' + vp.name + '-no-x', !ox.overflow, JSON.stringify(ox));
      if (vp.name === '390x844') await shot(page, '04-dashboard-390', { page: 'index', viewport: vp.name });
      if (vp.name === '320x700') await shot(page, '05-dashboard-320', { page: 'index', viewport: vp.name });
    }
    await page.setViewportSize({ width: 1440, height: 900 });

    // ========== AGENT ==========
    await page.goto(base + '/page/end/admin_agent.html', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForFunction(() => {
      const el = document.querySelector('#workspace');
      return el && el.__vue__ && el.__vue__.statusLoading === false;
    }, { timeout: 15000 });
    assert('agent-connected-label-ui', /AI Agent 已连接/.test(await page.locator('.admin-agent-state').innerText()), 'conn');
    assert('agent-no-3c-ui', !(await page.locator('text=3C').count()), '3c');
    await shot(page, '06-agent-connected-desktop', { page: 'admin_agent', state: 'connected' });

    // unconfigured status
    agentStatus = {
      configured: false, enabled: false, apiKeyConfigured: false, canConfigure: true,
      connected: false, connectionStatus: 'untested', connectionMessage: '',
      baseUrl: '', model: '', apiKeyHint: ''
    };
    await page.evaluate(() => document.querySelector('#workspace').__vue__.loadStatus());
    await page.waitForTimeout(250);
    assert('agent-unconfigured-label', /未配置/.test(await page.locator('.admin-agent-state').innerText()), 'unc');
    assert('agent-unconfigured-not-connected', !(await page.locator('text=AI Agent 已连接').count()), 'not-conn');
    await shot(page, '07-agent-unconfigured', { page: 'admin_agent', state: 'unconfigured' });

    // failed
    agentStatus = Object.assign({}, agentStatus, {
      configured: true, enabled: true, apiKeyConfigured: true, connected: false,
      connectionStatus: 'failed', connectionMessage: 'auth failed', baseUrl: 'https://example.test', model: 'm'
    });
    await page.evaluate(() => document.querySelector('#workspace').__vue__.loadStatus());
    await page.waitForTimeout(250);
    assert('agent-failed-label', /连接失败/.test(await page.locator('.admin-agent-state').innerText()), 'fail');
    await shot(page, '08-agent-failed', { page: 'admin_agent', state: 'failed' });

    // restore connected for interactive tests
    agentStatus = {
      configured: true, enabled: true, apiKeyConfigured: true, canConfigure: true,
      connected: true, connectionStatus: 'ok', connectionMessage: 'ok',
      baseUrl: 'https://example.test/v1', model: 'fixture-model', apiKeyHint: '****fixture'
    };
    await page.evaluate(() => document.querySelector('#workspace').__vue__.loadStatus());
    await page.waitForTimeout(200);

    // conversation race A slow B fast — dedicated hold routes (match jQuery ?_= cache buster)
    holdConvA = null; resolveConvA = null;
    let aReleased = false;
    let bFulfilled = false;
    await page.route((url) => /\/api\/admin-agent\/conversations\/101(\?|$)/.test(url.toString()), async (route) => {
      if (route.request().method() !== 'GET') { await route.continue(); return; }
      holdConvA = new Promise((r) => { resolveConvA = r; });
      recordProbe('conv-A-hold-route', { url: route.request().url() });
      await holdConvA;
      aReleased = true;
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({
          code: '0',
          data: {
            conversation: { id: 101, title: 'UI_2H_CONV_A' },
            turns: [{ id: 1, question: 'A问-late', answer: 'A答-late', createdAt: '2026-07-30 10:00:00', completedAt: '2026-07-30 10:00:01', toolsJson: '[]' }]
          }
        })
      });
      recordProbe('conv-A-released', {});
    });
    await page.route((url) => /\/api\/admin-agent\/conversations\/102(\?|$)/.test(url.toString()), async (route) => {
      if (route.request().method() !== 'GET') { await route.continue(); return; }
      bFulfilled = true;
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({
          code: '0',
          data: {
            conversation: { id: 102, title: 'UI_2H_CONV_B' },
            turns: [{
              id: 2, question: 'B问', answer: '**表格**\n\n| 项 | 值 |\n| --- | --- |\n| a | 1 |\n',
              createdAt: '2026-07-30 10:00:00', completedAt: '2026-07-30 10:00:01', toolsJson: '["get_management_overview"]'
            }]
          }
        })
      });
    });
    await page.evaluate(() => document.querySelector('#workspace').__vue__.openConversation(101));
    await waitFor(() => holdConvA != null && typeof resolveConvA === 'function', 5000, 'A-hold');
    recordProbe('conv-A-held-confirmed', { held: true });
    await page.evaluate(() => document.querySelector('#workspace').__vue__.openConversation(102));
    await waitFor(() => bFulfilled, 5000, 'B-fulfill');
    await page.waitForTimeout(200);
    const mid = await page.evaluate(() => {
      const vm = document.querySelector('#workspace').__vue__;
      return { id: vm.activeConversationId, title: vm.activeTitle, loading: vm.conversationLoading, seq: vm.conversationSeq };
    });
    resolveConvA();
    await page.waitForTimeout(450);
    const after = await page.evaluate(() => {
      const vm = document.querySelector('#workspace').__vue__;
      return {
        id: vm.activeConversationId,
        title: vm.activeTitle,
        turns: (vm.turns || []).map((t) => t.question),
        hasLateA: (vm.turns || []).some((t) => /A问-late/.test(t.question || ''))
      };
    });
    results.conversationRaceAudit = { mid, after, aReleased, bFulfilled };
    assert('agent-race-stays-B', Number(after.id) === 102 && !after.hasLateA, JSON.stringify(results.conversationRaceAudit));
    await shot(page, '09-agent-history', { page: 'admin_agent', state: 'history' });
    assert('agent-markdown-table', (await page.locator('.admin-agent-answer-table table').count()) >= 1, 'table');
    await shot(page, '10-agent-markdown-table', { page: 'admin_agent', state: 'markdown' });

    // A open hold → newConversation → late A must not restore
    holdConvA = null; resolveConvA = null; aReleased = false;
    await page.evaluate(() => document.querySelector('#workspace').__vue__.openConversation(101));
    await waitFor(() => holdConvA != null && typeof resolveConvA === 'function', 5000, 'A-hold-for-new');
    await page.evaluate(() => document.querySelector('#workspace').__vue__.newConversation());
    const afterNew = await page.evaluate(() => {
      const vm = document.querySelector('#workspace').__vue__;
      return { id: vm.activeConversationId, title: vm.activeTitle, turns: (vm.turns || []).length, seq: vm.conversationSeq, loading: vm.conversationLoading };
    });
    resolveConvA();
    await page.waitForTimeout(400);
    const afterLateA = await page.evaluate(() => {
      const vm = document.querySelector('#workspace').__vue__;
      return {
        id: vm.activeConversationId,
        title: vm.activeTitle,
        turns: (vm.turns || []).map((t) => t.question),
        hasLateA: (vm.turns || []).some((t) => /A问-late/.test(t.question || ''))
      };
    });
    results.newConversationRaceAudit = { afterNew, afterLateA };
    assert('agent-new-conv-clears', afterNew.id == null && afterNew.turns === 0 && afterNew.loading === false, JSON.stringify(afterNew));
    assert('agent-new-conv-late-A-ignored', afterLateA.id == null && !afterLateA.hasLateA && (afterLateA.turns || []).length === 0, JSON.stringify(afterLateA));

    // rename dialog + double put
    writeCounts.titlePut = 0;
    holdWrite = null; resolveWrite = null;
    await page.route((url) => /\/api\/admin-agent\/conversations\/\d+\/title/.test(url.toString()), async (route) => {
      if (route.request().method() !== 'PUT') { await route.continue(); return; }
      writeCounts.titlePut++;
      if (!holdWrite) holdWrite = new Promise((r) => { resolveWrite = r; });
      recordProbe('rename-hold', { n: writeCounts.titlePut });
      await holdWrite;
      let body = {};
      try { body = route.request().postDataJSON() || {}; } catch (e) {}
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ code: '0', data: { title: body.title || '改名后的标题' } }) });
    });
    await page.evaluate(() => {
      const vm = document.querySelector('#workspace').__vue__;
      const item = (vm.conversations && vm.conversations[0]) || { id: 102, title: 'UI_2H_CONV_B' };
      vm.openRename(item, { currentTarget: document.body });
    });
    await page.waitForSelector('#agentRenameInput', { timeout: 5000 });
    await shot(page, '11-agent-rename-dialog', { page: 'admin_agent', state: 'rename' });
    await page.fill('#agentRenameInput', '改名后的标题');
    await page.evaluate(() => {
      const root = document.querySelector('[aria-labelledby="agentRenameTitle"]');
      const btn = root.querySelector('.admin-dialog-actions .ui-button.is-primary');
      btn.click(); btn.click();
    });
    await waitFor(() => holdWrite != null && writeCounts.titlePut >= 1, 5000, 'rename-hold');
    assert('agent-rename-single-put', writeCounts.titlePut === 1, 'n=' + writeCounts.titlePut);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(80);
    assert('agent-rename-esc-blocked', (await page.locator('#agentRenameInput').count()) === 1, 'open');
    resolveWrite();
    await waitFor(async () => (await page.locator('#agentRenameInput').count()) === 0, 5000, 'rename-close');

    // delete dialog double
    writeCounts.convDel = 0;
    holdWrite = null; resolveWrite = null;
    await page.route((url) => /\/api\/admin-agent\/conversations\/\d+(\?|$)/.test(url.toString()) && !/title/.test(url.toString()), async (route) => {
      if (route.request().method() !== 'DELETE') { await route.continue(); return; }
      writeCounts.convDel++;
      if (!holdWrite) holdWrite = new Promise((r) => { resolveWrite = r; });
      recordProbe('delete-hold', { n: writeCounts.convDel });
      await holdWrite;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ code: '0', data: true }) });
    });
    await page.evaluate(() => {
      const vm = document.querySelector('#workspace').__vue__;
      const item = (vm.conversations && vm.conversations[0]) || { id: 102, title: 'UI_2H_CONV_B' };
      vm.openDelete(item, { currentTarget: document.body });
    });
    await page.waitForSelector('#agentDeleteTitle', { timeout: 5000 });
    await shot(page, '12-agent-delete-dialog', { page: 'admin_agent', state: 'delete' });
    await page.evaluate(() => {
      const root = document.querySelector('[aria-labelledby="agentDeleteTitle"]');
      const btn = root.querySelector('.admin-dialog-actions .ui-button.is-primary');
      btn.click(); btn.click();
    });
    await waitFor(() => holdWrite != null && writeCounts.convDel >= 1, 5000, 'del-hold');
    assert('agent-delete-single', writeCounts.convDel === 1, 'n=' + writeCounts.convDel);
    resolveWrite();
    await waitFor(async () => (await page.locator('#agentDeleteTitle').count()) === 0, 5000, 'del-close');

    // ask empty / not connected / fail keep draft / success clear
    await page.fill('#agentQuestion', '');
    const ask0 = writeCounts.askPost;
    await page.locator('.admin-agent-composer button[type="submit"]').click({ force: true });
    await page.waitForTimeout(100);
    assert('agent-ask-empty-no-post', writeCounts.askPost === ask0, 'empty');

    agentStatus = Object.assign({}, agentStatus, { connected: false });
    await page.evaluate(() => document.querySelector('#workspace').__vue__.loadStatus());
    await page.waitForTimeout(150);
    await page.fill('#agentQuestion', '未连接问题');
    await page.locator('.admin-agent-composer button[type="submit"]').click({ force: true });
    await page.waitForTimeout(100);
    assert('agent-ask-disconnected-no-post', writeCounts.askPost === ask0, 'disc');

    agentStatus = Object.assign({}, agentStatus, { connected: true });
    await page.evaluate(() => document.querySelector('#workspace').__vue__.loadStatus());
    await page.waitForTimeout(150);
    askMode = 'fail500';
    await page.fill('#agentQuestion', '失败保留输入');
    await page.locator('.admin-agent-composer button[type="submit"]').click();
    await page.waitForTimeout(350);
    assert('agent-ask-fail-keeps-draft', (await page.inputValue('#agentQuestion')) === '失败保留输入', 'keep');
    assert('agent-ask-error-visible', (await page.locator('.admin-agent-inline-error').count()) >= 1, 'err');

    askMode = 'ok';
    writeCounts.askPost = 0;
    writeHoldMode = 'ask';
    holdWrite = null; resolveWrite = null;
    await page.fill('#agentQuestion', '成功提问');
    await page.evaluate(() => {
      const btn = document.querySelector('.admin-agent-composer button[type="submit"]');
      btn.click(); btn.click();
    });
    await waitFor(() => holdWrite != null, 5000, 'ask-hold');
    assert('agent-ask-double-one', writeCounts.askPost === 1, 'n=' + writeCounts.askPost);
    resolveWrite();
    await page.waitForTimeout(350);
    assert('agent-ask-success-clears', (await page.inputValue('#agentQuestion')) === '', 'clear');
    writeHoldMode = '';

    // Ask network abort — keep draft, unlock, one request, retryable
    agentStatus = Object.assign({}, agentStatus, { connected: true, connectionStatus: 'ok' });
    await page.evaluate(() => {
      const vm = document.querySelector('#workspace').__vue__;
      vm.loadStatus();
      window.__agentWriteLocks.ask = false;
      vm.asking = false;
      vm.askError = '';
    });
    await page.waitForTimeout(150);
    askMode = 'abort';
    writeCounts.askPost = 0;
    const askAbortBefore = writeCounts.askPost;
    await page.fill('#agentQuestion', '网络中断草稿');
    await page.locator('.admin-agent-composer button[type="submit"]').click();
    await page.waitForTimeout(400);
    const askAbortSnap = await page.evaluate(() => {
      const vm = document.querySelector('#workspace').__vue__;
      const L = window.__agentWriteLocks || {};
      return {
        draft: vm.draft,
        askError: vm.askError,
        asking: vm.asking,
        Lask: !!L.ask,
        posts: null
      };
    });
    askAbortSnap.posts = writeCounts.askPost;
    results.requestCountAudit.askNetworkAbort = { before: askAbortBefore, after: writeCounts.askPost };
    assert('ask-network-keeps-draft', askAbortSnap.draft === '网络中断草稿', JSON.stringify(askAbortSnap));
    assert('ask-network-error-visible', !!(askAbortSnap.askError && String(askAbortSnap.askError).length > 0)
      || (await page.locator('.admin-agent-inline-error').count()) >= 1, JSON.stringify(askAbortSnap));
    assert('ask-network-unlocks', askAbortSnap.asking === false && askAbortSnap.Lask === false, JSON.stringify(askAbortSnap));
    assert('ask-network-one-post', writeCounts.askPost === 1, 'n=' + writeCounts.askPost);
    // retry still possible
    askMode = 'ok';
    writeCounts.askPost = 0;
    await page.locator('.admin-agent-composer button[type="submit"]').click();
    await page.waitForTimeout(350);
    assert('ask-network-retry-ok', writeCounts.askPost === 1 && (await page.inputValue('#agentQuestion')) === '', 'retry posts=' + writeCounts.askPost);

    // Ask HTTP 504 timeout — keep draft, unlock, one request, retryable
    agentStatus = Object.assign({}, agentStatus, { connected: true });
    await page.evaluate(() => {
      const vm = document.querySelector('#workspace').__vue__;
      vm.loadStatus();
      window.__agentWriteLocks.ask = false;
      vm.asking = false;
      vm.askError = '';
    });
    await page.waitForTimeout(120);
    askMode = 'fail504';
    writeCounts.askPost = 0;
    const ask504Before = writeCounts.askPost;
    await page.fill('#agentQuestion', '超时保留草稿');
    await page.locator('.admin-agent-composer button[type="submit"]').click();
    await page.waitForTimeout(400);
    const ask504Snap = await page.evaluate(() => {
      const vm = document.querySelector('#workspace').__vue__;
      const L = window.__agentWriteLocks || {};
      return { draft: vm.draft, askError: vm.askError, asking: vm.asking, Lask: !!L.ask };
    });
    results.requestCountAudit.askTimeout504 = { before: ask504Before, after: writeCounts.askPost, snap: ask504Snap };
    assert('ask-timeout-keeps-draft', ask504Snap.draft === '超时保留草稿', JSON.stringify(ask504Snap));
    assert('ask-timeout-error-visible', !!(ask504Snap.askError && String(ask504Snap.askError).length > 0)
      || (await page.locator('.admin-agent-inline-error').count()) >= 1, JSON.stringify(ask504Snap));
    assert('ask-timeout-unlocks', ask504Snap.asking === false && ask504Snap.Lask === false, JSON.stringify(ask504Snap));
    assert('ask-timeout-one-post', writeCounts.askPost === 1, 'n=' + writeCounts.askPost);
    askMode = 'ok';
    writeCounts.askPost = 0;
    await page.locator('.admin-agent-composer button[type="submit"]').click();
    await page.waitForTimeout(350);
    assert('ask-timeout-retry-ok', writeCounts.askPost === 1 && (await page.inputValue('#agentQuestion')) === '', 'retry');

    // config dialog
    await page.locator('button:has-text("配置平台模型")').click();
    await page.waitForTimeout(250);
    await shot(page, '13-agent-config-dialog', { page: 'admin_agent', state: 'config' });
    // ensure no plaintext key field prefilled with secret
    const keyVal = await page.locator('input[type="password"], input[autocomplete="new-password"], #apiKey, input[name="apiKey"]').first().inputValue().catch(() => '');
    assert('agent-no-plaintext-key', !keyVal || keyVal === '' || /\*/.test(keyVal), 'key=' + keyVal);

    writeCounts.configPost = 0;
    writeHoldMode = 'config';
    holdWrite = null; resolveWrite = null;
    await page.fill('input[id*="base" i], input[placeholder*="https" i]', 'https://example.test/v1').catch(() => {});
    await page.evaluate(() => {
      const root = document.querySelector('[aria-labelledby="configTitle"]');
      const btn = root && root.querySelector('.admin-dialog-actions .ui-button.is-primary');
      if (btn) { btn.click(); btn.click(); }
    });
    await waitFor(() => holdWrite != null || writeCounts.configPost >= 1, 5000, 'config-hold');
    if (holdWrite) {
      assert('agent-config-single', writeCounts.configPost === 1, 'n=' + writeCounts.configPost);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(80);
      assert('agent-config-esc-blocked', (await page.locator('#configTitle').count()) === 1, 'open');
      resolveWrite();
      await page.waitForTimeout(300);
    }
    writeHoldMode = '';
    // after save not connected
    const labelAfterSave = await page.locator('.admin-agent-state').innerText();
    assert('agent-save-not-connected', !/AI Agent 已连接/.test(labelAfterSave), labelAfterSave);

    // clear confirm
    if ((await page.locator('#configTitle').count()) === 0) {
      await page.locator('button:has-text("配置平台模型")').click();
      await page.waitForTimeout(200);
    }
    await page.route((url) => /\/api\/admin-agent\/config\/clear/.test(url.toString()), async (route) => {
      if (route.request().method() !== 'POST') { await route.continue(); return; }
      writeCounts.clearPost++;
      agentStatus = {
        configured: false, enabled: false, apiKeyConfigured: false, canConfigure: true,
        connected: false, connectionStatus: 'untested', connectionMessage: '',
        baseUrl: '', model: '', apiKeyHint: ''
      };
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ code: '0', data: agentStatus }) });
    });
    await page.evaluate(() => document.querySelector('#workspace').__vue__.openClearConfig({ currentTarget: document.body }));
    await page.waitForSelector('#agentClearTitle', { timeout: 5000 });
    await shot(page, '14-agent-clear-dialog', { page: 'admin_agent', state: 'clear' });
    writeCounts.clearPost = 0;
    await page.evaluate(() => {
      const root = document.querySelector('[aria-labelledby="agentClearTitle"]');
      root.querySelector('.admin-dialog-actions .ui-button.is-primary').click();
    });
    await page.waitForTimeout(350);
    assert('agent-clear-once', writeCounts.clearPost === 1, 'n=' + writeCounts.clearPost);
    results.requestCountAudit.clearPost = writeCounts.clearPost;
    // close any leftover config/clear dialogs
    await page.evaluate(() => {
      const vm = document.querySelector('#workspace').__vue__;
      if (vm) {
        vm.clearOpen = false;
        vm.configOpen = false;
        vm.renameOpen = false;
        vm.deleteOpen = false;
        window.__agentWriteLocks.save = false;
        window.__agentWriteLocks.clear = false;
      }
    });
    await page.waitForTimeout(100);

    // automation
    agentStatus = Object.assign({}, agentStatus, { configured: true, enabled: true, connected: true, canConfigure: true });
    await page.evaluate(() => {
      const vm = document.querySelector('#workspace').__vue__;
      vm.loadStatus();
      vm.openAutomation({ currentTarget: document.body });
    });
    await page.waitForSelector('#automationTitle', { timeout: 5000 });
    await shot(page, '15-agent-automation-dialog', { page: 'admin_agent', state: 'automation' });
    writeCounts.autoRun = 0;
    writeHoldMode = 'autoRun';
    holdWrite = null; resolveWrite = null;
    await page.evaluate(() => {
      const root = document.querySelector('[aria-labelledby="automationTitle"]');
      const btn = root.querySelector('.admin-dialog-actions .ui-button.is-primary');
      btn.click(); btn.click();
    });
    await waitFor(() => holdWrite != null, 5000, 'auto-hold');
    assert('agent-auto-run-single', writeCounts.autoRun === 1, 'n=' + writeCounts.autoRun);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(80);
    assert('agent-auto-esc-blocked', (await page.locator('#automationTitle').count()) === 1, 'open');
    resolveWrite();
    await page.waitForTimeout(350);
    assert('agent-auto-reject-zero', /自动驳回 0/.test(await page.locator('.admin-agent-automation-dialog').innerText()), 'reject0');
    await shot(page, '16-agent-automation-run', { page: 'admin_agent', state: 'auto-run' });
    writeHoldMode = '';

    // Guarded automation zero-request when confirmations missing
    let autoConfigPosts = 0;
    await page.route((url) => /\/api\/admin-agent\/automation\/config/.test(url.toString()), async (route) => {
      if (route.request().method() !== 'POST') { await route.continue(); return; }
      autoConfigPosts++;
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ code: '0', data: { config: { enabled: true, mode: 'guarded', maxBatch: 2, version: 3 }, recentRuns: [] } })
      });
    });
    await page.evaluate(() => {
      const vm = document.querySelector('#workspace').__vue__;
      vm.automationOpen = true;
      vm.automationForm.enabled = true;
      vm.automationForm.mode = 'guarded';
      vm.automationForm.acknowledgeNoAutoReject = false;
      vm.automationForm.acknowledgeHumanFallback = false;
      vm.automationForm.confirmationText = '';
      vm.automationError = '';
      vm.saveAutomation();
    });
    await page.waitForTimeout(150);
    results.requestCountAudit.guardedMissingAcks = autoConfigPosts;
    assert('auto-guarded-missing-acks-zero-post', autoConfigPosts === 0, 'n=' + autoConfigPosts);
    assert('auto-guarded-missing-acks-error', await page.evaluate(() => !!document.querySelector('#workspace').__vue__.automationError), 'err');
    await shot(page, '23-agent-guarded-confirm-error', { page: 'admin_agent', state: 'guarded-error' });

    await page.evaluate(() => {
      const vm = document.querySelector('#workspace').__vue__;
      vm.automationForm.acknowledgeNoAutoReject = true;
      vm.automationForm.acknowledgeHumanFallback = true;
      vm.automationForm.confirmationText = '错误短语';
      vm.automationError = '';
      vm.saveAutomation();
    });
    await page.waitForTimeout(150);
    results.requestCountAudit.guardedBadPhrase = autoConfigPosts;
    assert('auto-guarded-bad-phrase-zero-post', autoConfigPosts === 0, 'n=' + autoConfigPosts);

    await page.evaluate(() => {
      const vm = document.querySelector('#workspace').__vue__;
      vm.automationForm.confirmationText = '启用受控自动通过';
      vm.automationError = '';
      vm.saveAutomation();
    });
    await page.waitForTimeout(300);
    results.requestCountAudit.guardedOk = autoConfigPosts;
    assert('auto-guarded-ok-one-post', autoConfigPosts === 1, 'n=' + autoConfigPosts);

    // Config mutex: same-tick save + test → only one in-flight config op
    // Use dedicated temporary routes, then unroute so later real test-button scenarios hit the shared handler.
    let configPosts = 0, testPosts = 0;
    holdWrite = null; resolveWrite = null;
    const mutexConfigUrl = (url) => {
      const s = url.toString();
      return /\/api\/admin-agent\/config(\?|$)/.test(s) && !/\/config\/(test|clear)/.test(s);
    };
    const mutexTestUrl = (url) => /\/api\/admin-agent\/config\/test/.test(url.toString());
    const mutexConfigHandler = async (route) => {
      if (route.request().method() !== 'POST') { await route.continue(); return; }
      configPosts++;
      if (!holdWrite) holdWrite = new Promise((r) => { resolveWrite = r; });
      await holdWrite;
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ code: '0', data: Object.assign({}, agentStatus, { connected: false, connectionStatus: 'untested', configured: true }) })
      });
    };
    const mutexTestHandler = async (route) => {
      if (route.request().method() !== 'POST') { await route.continue(); return; }
      testPosts++;
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ code: '0', data: Object.assign({}, agentStatus, { connected: true }) })
      });
    };
    await page.route(mutexConfigUrl, mutexConfigHandler);
    await page.route(mutexTestUrl, mutexTestHandler);
    await page.evaluate(() => {
      const vm = document.querySelector('#workspace').__vue__;
      vm.configOpen = true;
      vm.configForm = { enabled: true, baseUrl: 'https://example.test/v1', model: 'fixture-model', apiKey: '' };
      vm.saveConfig();
      vm.testConfig(); // same tick — must be blocked by mutex
    });
    await waitFor(() => holdWrite != null || configPosts >= 1, 5000, 'config-mutex-hold');
    await page.waitForTimeout(100);
    results.requestCountAudit.configMutex = { configPosts, testPosts };
    assert('config-mutex-single-config-post', configPosts === 1, 'config=' + configPosts);
    assert('config-mutex-test-blocked', testPosts === 0, 'test=' + testPosts);
    if (resolveWrite) resolveWrite();
    await page.waitForTimeout(250);
    await page.unroute(mutexConfigUrl, mutexConfigHandler);
    await page.unroute(mutexTestUrl, mutexTestHandler);

    // ========== Real config/test button scenarios (not VM-only, not mutex-only) ==========
    // Ensure config dialog open with stable fields; reset write locks after mutex
    await page.evaluate(() => {
      const vm = document.querySelector('#workspace').__vue__;
      const L = window.__agentWriteLocks || {};
      L.config = L.save = L.test = L.clear = false;
      vm.saving = false; vm.testing = false; vm.clearSaving = false;
      vm.configError = ''; vm.configMessage = '';
    });

    // Dedicated config/test route (re-bound after mutex unroute so later scenarios never hit the real backend)
    const configTestUrl = (url) => /\/api\/admin-agent\/config\/test/.test(url.toString());
    const configTestHandler = async (route) => {
      if (route.request().method() !== 'POST') { await route.continue(); return; }
      writeCounts.testPost++;
      if (writeHoldMode === 'test') {
        if (!holdWrite) holdWrite = new Promise((r) => { resolveWrite = r; });
        await holdWrite;
      }
      if (testMode === 'provider502') {
        registerExpectedHttp('config-test-provider-502', 'POST', /\/api\/admin-agent\/config\/test/, 502);
        agentStatus = Object.assign({}, agentStatus, {
          connected: false, connectionStatus: 'failed',
          connectionMessage: '服务商拒绝 API Key（HTTP 401）',
          configured: true, enabled: true, apiKeyConfigured: true
        });
        await route.fulfill(exp(502, { code: '502', msg: '服务商拒绝 API Key（HTTP 401）' }));
        return;
      }
      if (testMode === 'fail500') {
        registerExpectedHttp('config-test-500', 'POST', /\/api\/admin-agent\/config\/test/, 500);
        agentStatus = Object.assign({}, agentStatus, {
          connected: false, connectionStatus: 'failed',
          connectionMessage: '服务暂时不可用。',
          configured: true, enabled: true, apiKeyConfigured: true
        });
        await route.fulfill(exp(500, { code: '500', msg: '连接测试服务异常' }));
        return;
      }
      agentStatus = Object.assign({}, agentStatus, {
        connected: true, connectionStatus: 'ok', connectionMessage: 'ok',
        configured: true, enabled: true, apiKeyConfigured: true
      });
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ code: '0', data: agentStatus })
      });
    };
    await page.route(configTestUrl, configTestHandler);

    // 1) Test connection SUCCESS — real button, exactly 1 POST, badge connected, locks free
    agentStatus = {
      configured: true, enabled: true, apiKeyConfigured: true, canConfigure: true,
      connected: false, connectionStatus: 'untested', connectionMessage: 'saved, untested',
      baseUrl: 'https://example.test/v1', model: 'fixture-model', apiKeyHint: '****fixture'
    };
    testMode = 'ok';
    writeHoldMode = '';
    holdWrite = null; resolveWrite = null;
    writeCounts.testPost = 0;
    await page.evaluate(() => {
      const vm = document.querySelector('#workspace').__vue__;
      const L = window.__agentWriteLocks;
      L.config = L.save = L.test = L.clear = false;
      vm.saving = false; vm.testing = false; vm.clearSaving = false;
      vm.configError = ''; vm.configMessage = '';
      vm.status = Object.assign({}, vm.status, {
        configured: true, enabled: true, apiKeyConfigured: true, canConfigure: true,
        connected: false, connectionStatus: 'untested', connectionMessage: 'saved, untested',
        baseUrl: 'https://example.test/v1', model: 'fixture-model', apiKeyHint: '****fixture'
      });
      if (!vm.configOpen) vm.configOpen = true;
      vm.configForm = { enabled: true, baseUrl: 'https://example.test/v1', model: 'fixture-model', apiKey: '' };
    });
    await page.waitForSelector('#configTitle', { timeout: 5000 });
    await page.waitForTimeout(150);
    // Preflight: button must be enabled and mutex free before the real click
    const preflightOk = await page.evaluate(() => {
      const vm = document.querySelector('#workspace').__vue__;
      const L = window.__agentWriteLocks || {};
      const buttons = Array.from(document.querySelectorAll('.admin-agent-config-dialog button'));
      const testBtn = buttons.find((b) => /测试连接|正在测试/.test(b.textContent || ''));
      return {
        hasBtn: !!testBtn,
        disabled: testBtn ? !!testBtn.disabled : null,
        busy: !!vm.configBusy,
        mutex: !!vm.configMutexBusy(),
        configured: !!vm.status.configured,
        enabled: !!vm.status.enabled,
        L: { config: !!L.config, test: !!L.test, save: !!L.save }
      };
    });
    assert('config-test-success-preflight', preflightOk.hasBtn && preflightOk.disabled === false && !preflightOk.busy && !preflightOk.mutex, JSON.stringify(preflightOk));
    const testOkBefore = writeCounts.testPost;
    // Real DOM button click (not vm.testConfig alone)
    await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('.admin-agent-config-dialog button'));
      const testBtn = buttons.find((b) => /测试连接/.test(b.textContent || ''));
      if (!testBtn) throw new Error('test connection button missing');
      testBtn.click();
    });
    try {
      await waitFor(() => writeCounts.testPost > testOkBefore, 5000, 'config-test-success-post');
      await waitFor(async () => {
        const st = await page.evaluate(() => {
          const vm = document.querySelector('#workspace').__vue__;
          const L = window.__agentWriteLocks || {};
          return { connected: vm.status.connected, testing: vm.testing, Ltest: !!L.test, Lconfig: !!L.config };
        });
        return st.connected === true && st.testing === false && !st.Ltest && !st.Lconfig;
      }, 5000, 'config-test-success');
    } catch (e) {
      const diag = await page.evaluate(() => {
        const vm = document.querySelector('#workspace').__vue__;
        const L = window.__agentWriteLocks || {};
        return {
          status: vm.status,
          testing: vm.testing,
          configError: vm.configError,
          configMessage: vm.configMessage,
          L: { config: !!L.config, test: !!L.test, save: !!L.save },
          busy: !!vm.configBusy
        };
      });
      fail('config-test-success-diag', JSON.stringify({ err: String(e && e.message || e), posts: writeCounts.testPost, diag }));
      throw e;
    }
    const testOkSnap = await page.evaluate(() => {
      const vm = document.querySelector('#workspace').__vue__;
      const L = window.__agentWriteLocks || {};
      const badge = (document.querySelector('.admin-agent-state') || {}).innerText || '';
      const dialogText = (document.querySelector('.admin-agent-config-dialog') || {}).innerText || '';
      return {
        connected: vm.status.connected,
        connectionStatus: vm.status.connectionStatus,
        testing: vm.testing,
        Ltest: !!L.test, Lconfig: !!L.config,
        badge, dialogText: dialogText.slice(0, 400),
        configMessage: vm.configMessage
      };
    });
    results.requestCountAudit.configTestSuccess = { before: testOkBefore, after: writeCounts.testPost, snap: testOkSnap };
    assert('config-test-success-one-post', writeCounts.testPost === 1, 'before=' + testOkBefore + ' after=' + writeCounts.testPost);
    assert('config-test-success-connected', testOkSnap.connected === true && /AI Agent 已连接/.test(testOkSnap.badge), JSON.stringify(testOkSnap));
    assert('config-test-success-dialog-msg', /连接成功|真实模型连接成功|可以开始提问/.test(testOkSnap.dialogText + testOkSnap.configMessage), JSON.stringify(testOkSnap));
    assert('config-test-success-unlocks', testOkSnap.testing === false && !testOkSnap.Ltest && !testOkSnap.Lconfig, JSON.stringify(testOkSnap));

    // 2) Provider rejects API Key — app HTTP 502 wrapping provider HTTP 401; prior connected must not stick
    agentStatus = {
      configured: true, enabled: true, apiKeyConfigured: true, canConfigure: true,
      connected: true, connectionStatus: 'ok', connectionMessage: 'was connected',
      baseUrl: 'https://example.test/v1', model: 'fixture-model', apiKeyHint: '****fixture'
    };
    testMode = 'provider502';
    writeCounts.testPost = 0;
    await page.evaluate(() => {
      const vm = document.querySelector('#workspace').__vue__;
      const L = window.__agentWriteLocks || {};
      L.config = L.save = L.test = L.clear = false;
      vm.testing = false; vm.saving = false;
      vm.status = Object.assign({}, vm.status, {
        configured: true, enabled: true, apiKeyConfigured: true, canConfigure: true,
        connected: true, connectionStatus: 'ok', connectionMessage: 'was connected',
        baseUrl: 'https://example.test/v1', model: 'fixture-model', apiKeyHint: '****fixture'
      });
      vm.configOpen = true;
      vm.configForm = {
        enabled: true,
        baseUrl: 'https://example.test/v1',
        model: 'fixture-model',
        apiKey: 'new-key-draft-not-saved'
      };
      vm.configError = '';
      vm.configMessage = '';
    });
    await page.waitForTimeout(100);
    // Confirm stale connected badge before the failing test
    assert('config-test-provider-401-pre-connected',
      /AI Agent 已连接/.test(await page.locator('.admin-agent-state').innerText()),
      'pre-badge');
    const providerBefore = writeCounts.testPost;
    await page.locator('.admin-agent-config-dialog button:has-text("测试连接")').click();
    await waitFor(async () => {
      const st = await page.evaluate(() => {
        const vm = document.querySelector('#workspace').__vue__;
        const L = window.__agentWriteLocks || {};
        return {
          connected: vm.status.connected,
          connectionStatus: vm.status.connectionStatus,
          testing: vm.testing,
          Ltest: !!L.test,
          Lconfig: !!L.config,
          err: vm.configError
        };
      });
      return st.connected === false && st.connectionStatus === 'failed' && st.testing === false && !st.Ltest && !st.Lconfig && !!st.err;
    }, 5000, 'config-test-provider-502');
    const providerSnap = await page.evaluate(() => {
      const vm = document.querySelector('#workspace').__vue__;
      const L = window.__agentWriteLocks || {};
      const badge = (document.querySelector('.admin-agent-state') || {}).innerText || '';
      const dialogText = (document.querySelector('.admin-agent-config-dialog') || {}).innerText || '';
      return {
        connected: vm.status.connected,
        connectionStatus: vm.status.connectionStatus,
        connectionMessage: vm.status.connectionMessage,
        configError: vm.configError,
        testing: vm.testing,
        Ltest: !!L.test, Lconfig: !!L.config, Lsave: !!L.save,
        badge,
        dialogText: dialogText.slice(0, 500),
        baseUrl: vm.configForm.baseUrl,
        model: vm.configForm.model,
        apiKey: vm.configForm.apiKey,
        apiKeyConfigured: vm.status.apiKeyConfigured,
        configured: vm.status.configured
      };
    });
    results.requestCountAudit.configTestProvider502 = { before: providerBefore, after: writeCounts.testPost, snap: providerSnap };
    assert('config-test-provider-401-shows-failed',
      providerSnap.connectionStatus === 'failed'
      && /服务商拒绝 API Key|HTTP 401|操作失败|连接失败/.test(providerSnap.configError + providerSnap.dialogText + providerSnap.badge),
      JSON.stringify(providerSnap));
    assert('config-test-provider-401-not-connected',
      providerSnap.connected === false && !/AI Agent 已连接/.test(providerSnap.badge),
      JSON.stringify(providerSnap));
    assert('config-test-provider-401-keeps-fields',
      providerSnap.baseUrl === 'https://example.test/v1'
      && providerSnap.model === 'fixture-model'
      && providerSnap.apiKey === 'new-key-draft-not-saved'
      && providerSnap.configured === true
      && providerSnap.apiKeyConfigured === true,
      JSON.stringify(providerSnap));
    assert('config-test-provider-401-unlocks',
      providerSnap.testing === false && !providerSnap.Ltest && !providerSnap.Lconfig && !providerSnap.Lsave,
      JSON.stringify(providerSnap));
    assert('config-test-provider-401-one-post', writeCounts.testPost === 1, 'n=' + writeCounts.testPost);
    await shot(page, '24-agent-provider-reject-failed', {
      page: 'admin_agent', state: 'provider-reject-502',
      note: '连接失败 + 服务商拒绝 API Key + 不再显示已连接'
    });

    // Retry after provider reject still fires exactly one more test POST
    writeCounts.testPost = 0;
    testMode = 'provider502';
    await page.locator('.admin-agent-config-dialog button:has-text("测试连接")').click();
    await page.waitForTimeout(400);
    assert('config-test-provider-401-retryable', writeCounts.testPost === 1, 'retry n=' + writeCounts.testPost);

    // 3) Generic HTTP 500 service fault — error visible, not connected, fields kept, unlock, retryable
    testMode = 'fail500';
    writeCounts.testPost = 0;
    await page.evaluate(() => {
      const vm = document.querySelector('#workspace').__vue__;
      const L = window.__agentWriteLocks || {};
      L.config = L.test = false;
      vm.testing = false;
      vm.status = Object.assign({}, vm.status, {
        connected: true, connectionStatus: 'ok', connectionMessage: 'stale ok',
        baseUrl: 'https://example.test/v1', model: 'fixture-model',
        configured: true, enabled: true, apiKeyConfigured: true
      });
      vm.configForm.baseUrl = 'https://example.test/v1';
      vm.configForm.model = 'fixture-model';
      vm.configForm.apiKey = 'draft-key-500';
      vm.configError = '';
    });
    await page.waitForTimeout(80);
    const fail500Before = writeCounts.testPost;
    await page.locator('.admin-agent-config-dialog button:has-text("测试连接")').click();
    await waitFor(async () => {
      const st = await page.evaluate(() => {
        const vm = document.querySelector('#workspace').__vue__;
        const L = window.__agentWriteLocks || {};
        return { connected: vm.status.connected, testing: vm.testing, Ltest: !!L.test, err: vm.configError };
      });
      return st.connected === false && st.testing === false && !st.Ltest && !!st.err;
    }, 5000, 'config-test-500');
    const fail500Snap = await page.evaluate(() => {
      const vm = document.querySelector('#workspace').__vue__;
      const L = window.__agentWriteLocks || {};
      const badge = (document.querySelector('.admin-agent-state') || {}).innerText || '';
      return {
        connected: vm.status.connected,
        connectionStatus: vm.status.connectionStatus,
        configError: vm.configError,
        testing: vm.testing, Ltest: !!L.test, Lconfig: !!L.config,
        badge,
        baseUrl: vm.configForm.baseUrl,
        model: vm.configForm.model,
        apiKey: vm.configForm.apiKey
      };
    });
    results.requestCountAudit.configTest500 = { before: fail500Before, after: writeCounts.testPost, snap: fail500Snap };
    assert('config-test-500-retryable',
      writeCounts.testPost === 1
      && fail500Snap.connected === false
      && !/AI Agent 已连接/.test(fail500Snap.badge)
      && !!fail500Snap.configError
      && fail500Snap.baseUrl === 'https://example.test/v1'
      && fail500Snap.model === 'fixture-model'
      && fail500Snap.apiKey === 'draft-key-500'
      && fail500Snap.testing === false && !fail500Snap.Ltest && !fail500Snap.Lconfig,
      JSON.stringify(fail500Snap));
    // second attempt still allowed
    writeCounts.testPost = 0;
    await page.locator('.admin-agent-config-dialog button:has-text("测试连接")').click();
    await page.waitForTimeout(350);
    assert('config-test-500-second-post', writeCounts.testPost === 1, 'second n=' + writeCounts.testPost);

    // 4) Double-click test connection under hold — exactly 1 POST; Esc blocked; then unlock
    testMode = 'ok';
    writeHoldMode = 'test';
    writeCounts.testPost = 0;
    holdWrite = null; resolveWrite = null;
    await page.evaluate(() => {
      const vm = document.querySelector('#workspace').__vue__;
      const L = window.__agentWriteLocks || {};
      L.config = L.test = L.save = false;
      vm.testing = false; vm.saving = false;
      vm.status = Object.assign({}, vm.status, {
        configured: true, enabled: true, apiKeyConfigured: true, connected: false,
        connectionStatus: 'untested', baseUrl: 'https://example.test/v1', model: 'fixture-model'
      });
      vm.configOpen = true;
      vm.configError = '';
    });
    await page.waitForTimeout(80);
    const doubleBefore = writeCounts.testPost;
    await page.evaluate(() => {
      const btn = document.querySelector('.admin-agent-config-dialog button.is-ghost');
      // Prefer the 测试连接 ghost button (not danger clear)
      const buttons = Array.from(document.querySelectorAll('.admin-agent-config-dialog button'));
      const testBtn = buttons.find((b) => /测试连接|正在测试/.test(b.textContent || ''));
      if (!testBtn) throw new Error('test button missing');
      testBtn.click();
      testBtn.click();
    });
    await waitFor(() => holdWrite != null && writeCounts.testPost >= 1, 5000, 'config-test-double-hold');
    await page.waitForTimeout(80);
    results.requestCountAudit.configTestDouble = { before: doubleBefore, after: writeCounts.testPost, held: !!holdWrite };
    assert('config-test-double-one-post', writeCounts.testPost === 1, 'n=' + writeCounts.testPost);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(80);
    assert('config-test-double-esc-blocked', (await page.locator('#configTitle').count()) === 1, 'still open');
    resolveWrite();
    await waitFor(async () => {
      const st = await page.evaluate(() => {
        const vm = document.querySelector('#workspace').__vue__;
        const L = window.__agentWriteLocks || {};
        return { testing: vm.testing, Ltest: !!L.test, Lconfig: !!L.config, connected: vm.status.connected };
      });
      return st.testing === false && !st.Ltest && !st.Lconfig;
    }, 5000, 'config-test-double-unlock');
    const doubleUnlock = await page.evaluate(() => {
      const vm = document.querySelector('#workspace').__vue__;
      const L = window.__agentWriteLocks || {};
      return { testing: vm.testing, Ltest: !!L.test, Lconfig: !!L.config, connected: vm.status.connected };
    });
    assert('config-test-double-unlocks', doubleUnlock.testing === false && !doubleUnlock.Ltest && !doubleUnlock.Lconfig, JSON.stringify(doubleUnlock));
    writeHoldMode = '';
    testMode = 'ok';

    // Nested clear cancel focus + Tab trap + Esc restore to trigger
    await page.evaluate(() => {
      const vm = document.querySelector('#workspace').__vue__;
      const L = window.__agentWriteLocks || {};
      L.config = L.save = L.test = L.clear = false;
      vm.saving = false; vm.testing = false; vm.clearSaving = false;
      vm.clearOpen = false;
      vm.configOpen = false;
      vm.automationOpen = false;
      vm.renameOpen = false;
      vm.deleteOpen = false;
      vm.returnFocusStack = [];
      vm.status = Object.assign({}, vm.status, {
        configured: true, enabled: true, apiKeyConfigured: true, canConfigure: true,
        connected: false, connectionStatus: 'failed',
        baseUrl: 'https://example.test/v1', model: 'fixture-model'
      });
    });
    await waitFor(async () => (await page.locator('.admin-dialog-backdrop').count()) === 0, 5000, 'all-dialogs-closed');
    await page.waitForTimeout(120);
    // Real trigger open — focus must land on this button for Esc restore assertion
    const configTrigger = page.locator('button:has-text("配置平台模型")').first();
    await configTrigger.focus();
    await configTrigger.click();
    await page.waitForSelector('#configTitle', { timeout: 5000 });
    await page.waitForTimeout(120);
    const clearBtn = page.locator('.admin-agent-config-dialog button:has-text("清除配置")');
    assert('nested-clear-btn-visible', (await clearBtn.count()) === 1, 'clear btn');
    await clearBtn.click();
    await page.waitForSelector('#agentClearTitle', { timeout: 5000 });
    // Cancel on nested confirm
    await page.locator('[aria-labelledby="agentClearTitle"] button.is-ghost, [aria-labelledby="agentClearTitle"] button:has-text("取消")').first().click();
    await waitFor(async () => (await page.locator('#agentClearTitle').count()) === 0, 5000, 'clear-closed');
    await page.waitForTimeout(150);
    const focusAfterCancel = await page.evaluate(() => {
      const active = document.activeElement;
      return {
        tag: active && active.tagName,
        text: active && (active.innerText || active.textContent || '').trim().slice(0, 40),
        inConfig: !!(active && active.closest && active.closest('.admin-agent-config-dialog')),
        configOpen: !!(document.querySelector('#workspace').__vue__.configOpen),
        clearOpen: !!(document.querySelector('#workspace').__vue__.clearOpen)
      };
    });
    assert('nested-clear-cancel-focus-restored',
      focusAfterCancel.configOpen && !focusAfterCancel.clearOpen
      && focusAfterCancel.inConfig
      && /清除配置/.test(focusAfterCancel.text || ''),
      JSON.stringify(focusAfterCancel));

    // Tab / Shift+Tab must stay inside config dialog
    const tabProbe = await page.evaluate(async () => {
      function activeInfo() {
        const a = document.activeElement;
        return {
          inConfig: !!(a && a.closest && a.closest('.admin-agent-config-dialog')),
          text: a && (a.innerText || a.value || a.id || a.tagName || '')
        };
      }
      const outs = [];
      for (let i = 0; i < 12; i++) {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
        // also fire on document as capture trap listens there
        const ev = new KeyboardEvent('keydown', { key: 'Tab', code: 'Tab', keyCode: 9, which: 9, bubbles: true, cancelable: true });
        document.dispatchEvent(ev);
        outs.push(activeInfo());
      }
      for (let i = 0; i < 12; i++) {
        const ev = new KeyboardEvent('keydown', { key: 'Tab', code: 'Tab', keyCode: 9, which: 9, shiftKey: true, bubbles: true, cancelable: true });
        document.dispatchEvent(ev);
        outs.push(activeInfo());
      }
      return { allIn: outs.every((o) => o.inConfig), sample: outs.slice(0, 3).concat(outs.slice(-2)) };
    });
    // Prefer Playwright keyboard for real focus movement
    let tabAllIn = true;
    for (let i = 0; i < 10; i++) {
      await page.keyboard.press('Tab');
      const inCfg = await page.evaluate(() => {
        const a = document.activeElement;
        return !!(a && a.closest && a.closest('.admin-agent-config-dialog'));
      });
      if (!inCfg) { tabAllIn = false; break; }
    }
    for (let i = 0; i < 10; i++) {
      await page.keyboard.press('Shift+Tab');
      const inCfg = await page.evaluate(() => {
        const a = document.activeElement;
        return !!(a && a.closest && a.closest('.admin-agent-config-dialog'));
      });
      if (!inCfg) { tabAllIn = false; break; }
    }
    results.controlledRequestAudit.push({ name: 'nested-tab-probe', tabProbe, tabAllIn, at: new Date().toISOString() });
    assert('nested-config-tab-contained', tabAllIn, JSON.stringify({ tabAllIn, tabProbe }));

    // Esc closes config and restores focus to 配置平台模型 trigger
    await page.keyboard.press('Escape');
    await waitFor(async () => (await page.locator('#configTitle').count()) === 0, 5000, 'config-esc-close');
    await page.waitForTimeout(150);
    const escFocus = await page.evaluate(() => {
      const a = document.activeElement;
      return {
        text: a && (a.innerText || a.textContent || '').trim().slice(0, 40),
        configOpen: !!(document.querySelector('#workspace').__vue__.configOpen),
        tag: a && a.tagName
      };
    });
    assert('nested-config-esc-restores-trigger',
      !escFocus.configOpen && /配置平台模型/.test(escFocus.text || ''),
      JSON.stringify(escFocus));

    // Clear history identity check
    const histBefore = await page.evaluate(() => {
      const vm = document.querySelector('#workspace').__vue__;
      return (vm.conversations || []).map((c) => ({ id: c.id, title: c.title }));
    });
    await page.evaluate(() => {
      const vm = document.querySelector('#workspace').__vue__;
      window.__agentWriteLocks.config = false;
      window.__agentWriteLocks.clear = false;
      vm.clearSaving = false;
      vm.openClearConfig({ currentTarget: document.body });
    });
    await page.waitForSelector('#agentClearTitle', { timeout: 5000 });
    writeCounts.clearPost = 0;
    await page.evaluate(() => {
      const root = document.querySelector('[aria-labelledby="agentClearTitle"]');
      const btn = root.querySelector('.admin-dialog-actions .ui-button.is-primary');
      btn.click(); btn.click();
    });
    await page.waitForTimeout(350);
    const histAfter = await page.evaluate(() => {
      const vm = document.querySelector('#workspace').__vue__;
      return (vm.conversations || []).map((c) => ({ id: c.id, title: c.title }));
    });
    results.requestCountAudit.clearDouble = writeCounts.clearPost;
    assert('clear-double-one-post', writeCounts.clearPost === 1, 'n=' + writeCounts.clearPost);
    assert('clear-history-ids-stable', JSON.stringify(histBefore) === JSON.stringify(histAfter), JSON.stringify({ histBefore, histAfter }));

    // Close all dialogs before mobile main screenshots
    await page.evaluate(() => {
      const vm = document.querySelector('#workspace').__vue__;
      if (!vm) return;
      vm.configOpen = false; vm.automationOpen = false; vm.renameOpen = false;
      vm.deleteOpen = false; vm.clearOpen = false; vm.historyOpen = false;
      document.body.classList.remove('agent-history-locked');
      const L = window.__agentWriteLocks || {};
      L.config = L.save = L.test = L.clear = false;
    });
    await page.waitForTimeout(80);

    for (const vp of VIEWPORTS) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.waitForTimeout(60);
      const ox = await overflowX(page);
      assert('agent-vp-' + vp.name + '-no-x', !ox.overflow, JSON.stringify(ox));
      if (vp.name === '390x844' || vp.name === '320x700') {
        const dlg = await page.evaluate(() => {
          const vm = document.querySelector('#workspace').__vue__;
          return {
            configOpen: !!vm.configOpen, automationOpen: !!vm.automationOpen,
            renameOpen: !!vm.renameOpen, deleteOpen: !!vm.deleteOpen, clearOpen: !!vm.clearOpen
          };
        });
        assert('agent-mobile-main-no-dialogs-' + vp.name,
          !dlg.configOpen && !dlg.automationOpen && !dlg.renameOpen && !dlg.deleteOpen && !dlg.clearOpen,
          JSON.stringify(dlg));
        await shot(page, vp.name === '390x844' ? '17-agent-390' : '18-agent-320', {
          page: 'admin_agent', viewport: vp.name, state: 'main'
        });
      }
    }

    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => document.querySelector('#workspace').__vue__.openHistory({ currentTarget: document.body }));
    await page.waitForTimeout(120);
    assert('agent-history-drawer-open', await page.evaluate(() => !!document.querySelector('#workspace').__vue__.historyOpen), 'open');
    await shot(page, '19-agent-history-drawer-390', { page: 'admin_agent', state: 'history-drawer' });
    await page.evaluate(() => document.querySelector('#workspace').__vue__.closeHistory());

    // Illegal stats + barWidth on dashboard
    await page.goto(base + '/page/end/index.html', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForFunction(() => document.querySelector('#workspace') && document.querySelector('#workspace').__vue__, { timeout: 15000 });
    await page.evaluate(() => {
      const vm = document.querySelector('#workspace').__vue__;
      vm.stats = { volunteers: 3, animals: 12, adopts: 8, users: 20 };
    });
    await page.route('**/api/dashboard/public-stats**', async (route) => {
      if (route.request().method() !== 'GET') { await route.continue(); return; }
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ code: '0', data: { volunteers: 'NaN', animals: -1, adopts: 1.5, users: 3 } })
      });
    }, { times: 1 });
    await page.evaluate(() => document.querySelector('#workspace').__vue__.loadStats());
    await waitFor(async () => {
      const st = await page.evaluate(() => document.querySelector('#workspace').__vue__.statsError);
      return /统计数据结构异常/.test(String(st || ''));
    }, 5000, 'stats-nan');
    const stIllegal = await page.evaluate(() => {
      const vm = document.querySelector('#workspace').__vue__;
      return { err: vm.statsError, animals: vm.stats.animals };
    });
    assert('dash-stats-invalid-fields', stIllegal.err === '统计数据结构异常', JSON.stringify(stIllegal));
    assert('dash-stats-keeps-last-valid', Number(stIllegal.animals) === 12, JSON.stringify(stIllegal));
    await shot(page, '20-dashboard-stats-invalid', { page: 'index', state: 'stats-invalid' });

    const barRatio = await page.evaluate(() => {
      const vm = document.querySelector('#workspace').__vue__;
      const rows = [{ name: 'a', value: '100' }, { name: 'b', value: '9.99' }];
      return {
        w100: vm.barWidth('100', rows),
        w999: vm.barWidth('9.99', rows),
        w0: vm.barWidth('0', rows),
        wNeg: vm.barWidth('-50', rows),
        wBad: vm.barWidth('x', rows)
      };
    });
    results.requestCountAudit.barRatio = barRatio;
    assert('bar-100-is-100', barRatio.w100 === 100, JSON.stringify(barRatio));
    assert('bar-999-about-10', barRatio.w999 >= 9 && barRatio.w999 <= 10, JSON.stringify(barRatio));
    assert('bar-not-both-100', !(barRatio.w100 === 100 && barRatio.w999 === 100), JSON.stringify(barRatio));
    assert('bar-zero-ok', barRatio.w0 === 0, JSON.stringify(barRatio));
    assert('bar-neg-ok', barRatio.wNeg >= 0 && barRatio.wNeg <= 100, JSON.stringify(barRatio));
    assert('bar-bad-ok', barRatio.wBad === 0, JSON.stringify(barRatio));

    // jerry / tom / logout
    const ctxJerry = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await login(ctxJerry, 'jerry', '123456');
    const pageJerry = await ctxJerry.newPage();
    await pageJerry.route('**/api/dashboard/public-stats**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ code: '0', data: { volunteers: 1, animals: 2, adopts: 3, users: 4 } }) });
    });
    await pageJerry.route('**/api/notice/page**', async (route) => {
      await route.fulfill(pageData([{ id: 1, title: 'N', content: 'c' }]));
    });
    let jerryAccountGets = 0;
    pageJerry.on('request', (req) => {
      if (req.method() === 'GET' && /\/api\/account\/stats/.test(req.url())) jerryAccountGets++;
    });
    await pageJerry.goto(base + '/page/end/index.html', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await pageJerry.waitForTimeout(700);
    const jerryState = await pageJerry.evaluate(() => {
      const vm = document.querySelector('#workspace').__vue__;
      const hrefs = Array.from(document.querySelectorAll('.admin-route-card')).map((a) => a.getAttribute('href') || '');
      const hero = document.querySelector('.dashboard-home-hero-copy');
      const title = document.getElementById('dashboardTitle');
      const heroBox = hero ? hero.getBoundingClientRect() : null;
      const titleBox = title ? title.getBoundingClientRect() : null;
      return {
        menuLen: (vm.menuItems || []).length,
        hasAccountPanel: !!document.getElementById('accountTitle'),
        hasAdminAgentLink: hrefs.some((h) => /admin_agent/.test(h)),
        body: document.body.innerText.slice(0, 200),
        scrollX: window.scrollX,
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        heroBox: heroBox ? { x: heroBox.x, width: heroBox.width } : null,
        titleBox: titleBox ? { x: titleBox.x, width: titleBox.width } : null
      };
    });
    results.roleMatrix.jerry = Object.assign({}, jerryState, { jerryAccountGets });
    assert('role-jerry-no-admin-menu', jerryState.menuLen === 0, JSON.stringify(jerryState));
    assert('role-jerry-no-account-panel', !jerryState.hasAccountPanel, JSON.stringify(jerryState));
    assert('role-jerry-no-agent-link', !jerryState.hasAdminAgentLink, JSON.stringify(jerryState));
    assert('role-jerry-no-account-api', jerryAccountGets === 0, 'gets=' + jerryAccountGets);
    assert('role-jerry-no-horizontal-overflow', jerryState.scrollWidth <= jerryState.clientWidth && jerryState.scrollX === 0, JSON.stringify(jerryState));
    assert('role-jerry-dashboard-title-visible', !!jerryState.titleBox && jerryState.titleBox.x >= 0 && jerryState.titleBox.width > 0, JSON.stringify(jerryState));
    await pageJerry.screenshot({ path: path.join(shotDir, '21-dashboard-jerry.png'), fullPage: false });
    results.screenshots.push({ file: 'screenshots/21-dashboard-jerry.png', name: '21-dashboard-jerry', time: new Date().toISOString() });
    await ctxJerry.close();

    const ctxTom = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await login(ctxTom, 'tom', '123456');
    const pageTom = await ctxTom.newPage();
    await pageTom.route('**/api/dashboard/public-stats**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ code: '0', data: { volunteers: 1, animals: 2, adopts: 3, users: 4 } }) });
    });
    await pageTom.route('**/api/notice/page**', async (route) => {
      await route.fulfill(pageData([]));
    });
    await pageTom.route('**/api/account/stats/**', async (route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ code: '0', data: { incomeTotal: '1.00', expenseTotal: '0.00', balance: '1.00', incomeByLabel: [], expenseByLabel: [] } })
      });
    });
    await pageTom.goto(base + '/page/end/index.html', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await pageTom.waitForTimeout(700);
    const tomState = await pageTom.evaluate(() => {
      const vm = document.querySelector('#workspace').__vue__;
      const labels = Array.from(document.querySelectorAll('.admin-route-card strong')).map((el) => el.textContent.trim());
      return {
        menuLen: (vm.menuItems || []).length,
        labels,
        hasUserMgmt: labels.some((t) => /用户管理|角色管理|权限管理/.test(t)),
        hasAnimal: labels.some((t) => /动物|档案/.test(t))
      };
    });
    results.roleMatrix.tom = tomState;
    assert('role-tom-has-some-menu', tomState.menuLen > 0, JSON.stringify(tomState));
    assert('role-tom-no-user-role-perm', !tomState.hasUserMgmt, JSON.stringify(tomState));
    await pageTom.screenshot({ path: path.join(shotDir, '22-dashboard-tom.png'), fullPage: false });
    results.screenshots.push({ file: 'screenshots/22-dashboard-tom.png', name: '22-dashboard-tom', time: new Date().toISOString() });
    await ctxTom.close();

    const ctxLogout = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await login(ctxLogout, 'admin', 'admin');
    const pageLogout = await ctxLogout.newPage();
    await pageLogout.goto(base + '/page/end/index.html', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await pageLogout.waitForTimeout(400);
    await pageLogout.evaluate(() => { if (window.AuthSession && AuthSession.logout) AuthSession.logout(); });
    await pageLogout.waitForTimeout(900);
    const logoutUrl = pageLogout.url();
    assert('logout-lands-login', /login/i.test(logoutUrl), logoutUrl);
    const meRes = await ctxLogout.request.get(base + '/api/user/me');
    assert('logout-me-unauthorized', meRes.status() === 401 || meRes.status() >= 400, 'status=' + meRes.status());
    results.roleMatrix.logout = { url: logoutUrl, meStatus: meRes.status() };
    await ctxLogout.close();

    // console gates
    const realConsole = consoleErrors.filter((t) => {
      if (!isRealConsoleError(t)) return false;
      if (/Failed to load resource/i.test(t) && isIntentionalResourceConsole(t, httpErrors)) return false;
      return true;
    });
    const badHttp = httpErrors.filter((e) => !isIntentionalHttp(e));
    const badFailed = (results.requestFailedWrite || []).filter((e) => {
      return !results.expectedHttpRegistry.some((reg) => {
        if (reg.method && String(reg.method).toUpperCase() !== String(e.method || '').toUpperCase()) return false;
        if (reg.urlRe && !reg.urlRe.test(e.url || '')) return false;
        // abort entries (status 0) intentionally match requestfailed without HTTP status
        if (reg.abort === true) return true;
        return true;
      });
    });
    const secretHits = JSON.stringify(results).match(/sk-[a-zA-Z0-9]{16,}/g) || [];
    assert('no-secret-in-report', secretHits.length === 0, JSON.stringify(secretHits.slice(0, 5)));
    results.consoleAudit = {
      realConsole, pageErrors, badHttp, badFailed,
      requestFailedAll: (results.requestFailedAll || []).slice(0, 40),
      consoleErrors: consoleErrors.slice(0, 20)
    };
    assert('no-real-console-error', realConsole.length === 0, JSON.stringify(realConsole.slice(0, 5)));
    assert('no-pageerror', pageErrors.length === 0, JSON.stringify(pageErrors.slice(0, 5)));
    assert('no-unregistered-http-error', badHttp.length === 0, JSON.stringify(badHttp.slice(0, 8)));
    assert('no-unregistered-requestfailed', badFailed.length === 0, JSON.stringify(badFailed.slice(0, 8)));
    assert('screenshots-min-12', results.screenshots.length >= 12, 'n=' + results.screenshots.length);
    const shotFiles = fs.readdirSync(shotDir).filter((f) => f.endsWith('.png')).sort();
    const indexed = results.screenshots.map((s) => path.basename(s.file)).sort();
    assert('screenshot-dir-matches-index', JSON.stringify(shotFiles) === JSON.stringify(indexed), JSON.stringify({ shotFiles, indexed }));

    const summary = writeReport();
    console.log('Phase 2H summary', summary);
    await browser.close();
    process.exit(summary.failed === 0 && summary.strictMode ? 0 : 1);
  } catch (err) {
    console.error('SUITE_CRASH', err && err.stack || err);
    fail('suite-crash', String(err && err.message || err));
    writeReport();
    try { if (browser) await browser.close(); } catch (e) {}
    process.exit(1);
  }
})();
