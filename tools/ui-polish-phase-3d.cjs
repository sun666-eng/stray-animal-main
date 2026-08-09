/**
 * Phase 3D strict audit — user rescue, public rescue chat and notifications.
 * Every business write is intercepted by deterministic fixtures.
 * The real-service smoke is authenticated and read-only.
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const startedAt = Date.now();
const base = process.env.BASE_URL || 'http://127.0.0.1:18123';
const out = path.resolve('output/playwright/ui-polish-phase-3d');
const shotDir = path.join(out, 'screenshots');
fs.mkdirSync(shotDir, { recursive: true });
for (const file of fs.readdirSync(shotDir)) {
  if (file.endsWith('.png')) fs.unlinkSync(path.join(shotDir, file));
}

const PAGES = ['rescue_apply.html', 'my_rescue.html', 'notifications.html'];
const VIEWPORTS = [
  { name: '1440x900', width: 1440, height: 900 },
  { name: '1280x800', width: 1280, height: 800 },
  { name: '768x1024', width: 768, height: 1024 },
  { name: '390x844', width: 390, height: 844 },
  { name: '320x800', width: 320, height: 800 }
];

const result = {
  phase: '3D',
  base,
  branch: 'ui-polish/phase-3d-user-rescue-notifications-20260731',
  baseline: 'ef80d887cf28f2030439d65e0b9f8d1f4bf4b97b',
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
function success(data) {
  return JSON.stringify({ code: '0', msg: '成功', data });
}
function failure(code, msg) {
  return JSON.stringify({ code: String(code), msg, data: null });
}
function fixtureHeaders(expectedError = false) {
  const headers = { 'x-ui-audit-fixture': 'phase3d' };
  if (expectedError) headers['x-ui-audit-expected-error'] = 'phase3d';
  return headers;
}
function safeName(value) {
  return String(value).replace(/\.html$/, '').replace(/[^a-z0-9_-]+/gi, '-');
}
function canonicalId(value) {
  const normalized = value == null ? '' : String(value).trim();
  return /^[1-9][0-9]{0,18}$/.test(normalized) ? normalized : '';
}
function rescueRecord(index = 1, overrides = {}) {
  return {
    id: String(8100 + index),
    uid: '43',
    uname: 'jerry',
    title: `社区入口救助记录 ${index} ${'长标题'.repeat(index)}`,
    description: `动物行动困难，需要工作人员确认。${'这是用于验证长描述安全换行的内容。'.repeat(index)}`,
    location: `上海市测试区测试街道 ${'长地址'.repeat(index * 3)}`,
    phone: '13800138000',
    pic: '',
    status: (index - 1) % 4,
    priority: index % 3,
    remark: index % 2 ? '工作人员已经联系现场，请注意保持安全距离。' : '',
    resolutionNote: index % 4 === 2 ? '动物已接收入站并建立档案。' : '',
    animalId: index % 4 === 2 ? '10011' : null,
    createTime: `2026-07-${String(20 + index).padStart(2, '0')} 09:20:00`,
    updateTime: `2026-07-${String(20 + index).padStart(2, '0')} 11:30:00`,
    resolvedAt: index % 4 >= 2 ? `2026-07-${String(20 + index).padStart(2, '0')} 12:00:00` : null,
    ...overrides
  };
}
function chatMessage(index = 1, overrides = {}) {
  return {
    id: String(900000000000000000n + BigInt(index)),
    username: index % 2 ? 'jerry' : '社区成员',
    text: `社区消息 ${index} ${'用于验证长消息换行。'.repeat(index)}`,
    createdTime: `2026-07-31 10:${String(index).padStart(2, '0')}:00`,
    ...overrides
  };
}
function notificationRecord(index = 1, overrides = {}) {
  const types = ['adopt', 'proof', 'help', 'volunteer_task', 'unknown_type'];
  const targets = [
    '/page/front/my_adopt.html',
    '/page/front/adopt_proof.html?aid=10011',
    '/page/front/my_rescue.html',
    '/page/front/volunteer_tasks.html',
    null
  ];
  return {
    id: String(7100 + index),
    type: types[(index - 1) % types.length],
    title: `业务状态通知 ${index} ${'长标题'.repeat(index)}`,
    summary: `业务状态已经发生变化。${'这是用于验证通知摘要换行的内容。'.repeat(index)}`,
    businessType: types[(index - 1) % types.length],
    businessId: String(100 + index),
    targetUrl: targets[(index - 1) % targets.length],
    readFlag: index % 2,
    createdAt: `2026-07-31 11:${String(index).padStart(2, '0')}:00`,
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

function pageUrl(file) {
  return `${base}/page/front/${file}`;
}

function defaultScenario() {
  return {
    delayMs: 0,
    helpFailures: 0,
    helpFailureStatus: 500,
    chatWriteStatus: 200,
    readStatus: 200,
    markAllStatus: 200,
    rescueListError: false,
    notificationListError: false,
    countError: false,
    rescueRace: false,
    notificationRace: false,
    historyRace: false
  };
}

async function installFixture(page, custom = {}) {
  const scenario = Object.assign(defaultScenario(), custom);
  const state = {
    scenario,
    requests: [],
    writes: [],
    uploadCount: 0,
    helpPostCount: 0,
    stagedDeleteCount: 0,
    chatPostCount: 0,
    historyCount: 0,
    rescueListCount: 0,
    notificationListCount: 0,
    countReadCount: 0,
    readWriteCount: 0,
    markAllCount: 0
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
      await reply(200, success({ id: '43', username: 'jerry', phone: '13800138000', permissions: [] }));
      return;
    }
    if (pathname === '/api/user/csrf') {
      await reply(200, success({ csrfToken: 'phase3d-fixture' }));
      return;
    }
    if (method === 'GET' && pathname === '/api/notifications/unread-count') {
      state.countReadCount += 1;
      if (scenario.countError) {
        await reply(500, failure(500, '未读统计读取失败'), true);
      } else {
        await reply(200, success(3));
      }
      return;
    }
    if (method === 'GET' && pathname === '/api/help/chat/history') {
      state.historyCount += 1;
      const call = state.historyCount;
      if (scenario.historyRace && call % 2 === 0) await sleep(260);
      const label = scenario.historyRace && call % 2 === 1 ? '快速消息' : '社区消息';
      await reply(200, success([
        chatMessage(call * 10 + 1, { text: `${label} A` }),
        chatMessage(call * 10 + 2, { text: `${label} B` })
      ]));
      return;
    }
    if (method === 'GET' && pathname === '/api/help/mine') {
      state.rescueListCount += 1;
      const pageNum = Math.max(1, Number(url.searchParams.get('pageNum') || 1));
      if (scenario.rescueRace && pageNum === 2) await sleep(260);
      if (scenario.rescueListError) {
        await reply(500, failure(500, '救助记录读取失败'), true);
        return;
      }
      const label = pageNum === 1 ? '快速页救助' : '慢页救助';
      await reply(200, success({
        records: Array.from({ length: 3 }, (_, index) => rescueRecord(index + 1, {
          title: `${label} ${index + 1}`,
          status: index
        })),
        total: 6,
        pages: 2,
        current: pageNum,
        size: 8
      }));
      return;
    }
    if (method === 'GET' && pathname === '/api/notifications') {
      state.notificationListCount += 1;
      const pageNum = Math.max(1, Number(url.searchParams.get('pageNum') || 1));
      if (scenario.notificationRace && pageNum === 2) await sleep(260);
      if (scenario.notificationListError) {
        await reply(500, failure(500, '消息列表读取失败'), true);
        return;
      }
      const unreadOnly = url.searchParams.get('unreadOnly') === 'true';
      const label = pageNum === 1 ? '快速页通知' : '慢页通知';
      const records = Array.from({ length: 4 }, (_, index) => notificationRecord(index + 1, {
        title: `${label} ${index + 1}`,
        readFlag: unreadOnly ? 0 : index % 2
      }));
      await reply(200, success({ records, total: 8, pages: 2, current: pageNum, size: 20 }));
      return;
    }
    if (method === 'GET' && /^\/api\/files\/[a-zA-Z0-9-]+$/.test(pathname)) {
      await route.fulfill({
        status: 200,
        contentType: 'image/svg+xml',
        headers: fixtureHeaders(false),
        body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 90"><rect width="120" height="90" fill="#e5e3dd"/><circle cx="60" cy="43" r="20" fill="#777"/></svg>'
      });
      return;
    }

    if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      const write = { method, pathname, at: Date.now(), postData: request.postData() };
      state.writes.push(write);
      result.fixtureWriteAudit.push(write);
    }

    if (method === 'POST' && pathname === '/api/files/upload') {
      state.uploadCount += 1;
      if (scenario.delayMs) await sleep(scenario.delayMs);
      await reply(200, success({ flag: 'phase3d-staged-flag' }));
      return;
    }
    if (method === 'DELETE' && /^\/api\/files\/staged\/[a-zA-Z0-9-]+$/.test(pathname)) {
      state.stagedDeleteCount += 1;
      await reply(200, success(true));
      return;
    }
    if (method === 'POST' && pathname === '/api/help') {
      state.helpPostCount += 1;
      if (scenario.delayMs) await sleep(scenario.delayMs);
      if (state.helpPostCount <= Number(scenario.helpFailures || 0)) {
        const status = Number(scenario.helpFailureStatus || 500);
        await reply(status, failure(status, status === 422 ? '救助信息校验失败' : '救助请求保存失败'), true);
      } else {
        await reply(200, success(true));
      }
      return;
    }
    if (method === 'POST' && pathname === '/api/help/chat') {
      state.chatPostCount += 1;
      if (scenario.delayMs) await sleep(scenario.delayMs);
      const status = Number(scenario.chatWriteStatus || 200);
      if (status !== 200) {
        await reply(status, failure(status, status === 429 ? '发送过于频繁' : '消息保存失败'), true);
      } else {
        await reply(200, success(chatMessage(90 + state.chatPostCount, {
          text: JSON.parse(request.postData() || '{}').text || 'fixture',
          createdTime: `2026-07-31 12:${String(state.chatPostCount).padStart(2, '0')}:00`
        })));
      }
      return;
    }
    if (method === 'PUT' && /^\/api\/notifications\/[1-9][0-9]*\/read$/.test(pathname)) {
      state.readWriteCount += 1;
      if (scenario.delayMs) await sleep(scenario.delayMs);
      const status = Number(scenario.readStatus || 200);
      if (status !== 200) {
        await reply(status, failure(status, '通知状态已经变化'), true);
      } else {
        await reply(200, success(true));
      }
      return;
    }
    if (method === 'PUT' && pathname === '/api/notifications/read-all') {
      state.markAllCount += 1;
      if (scenario.delayMs) await sleep(scenario.delayMs);
      const status = Number(scenario.markAllStatus || 200);
      if (status !== 200) {
        await reply(status, failure(status, '全部标记失败'), true);
      } else {
        await reply(200, success(true));
      }
      return;
    }

    await reply(500, failure(500, `Phase 3D 未登记夹具：${method} ${pathname}`), false);
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
        expected: headers['x-ui-audit-expected-error'] === 'phase3d'
      });
    }
  });
  page.on('requestfailed', (request) => {
    const row = {
      method: request.method(),
      url: request.url(),
      error: request.failure() && request.failure().errorText
    };
    if (!(allowAbort && /ERR_ABORTED|NS_BINDING_ABORTED/i.test(row.error || ''))) {
      audit.requestFailed.push(row);
    }
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
    const contentOffenders = Array.from(document.querySelectorAll(
      'main h1,main h2,main h3,main p,main strong,main .ui-panel,main .ui-rescue-record-card,main .ui-notification-card'
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
    const touch = Array.from(document.querySelectorAll('main button,main .ui-button,main label.ui-button'))
      .filter(visible).map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          text: (element.textContent || element.getAttribute('aria-label') || '').trim(),
          width: rect.width,
          height: rect.height
        };
      }).filter((row) => row.width < 44 || row.height < 44);
    return {
      viewport: innerWidth,
      bodyScrollWidth: document.documentElement.scrollWidth,
      contentOffenders,
      touch
    };
  });
}

async function staticAudit() {
  const root = path.resolve('src/main/resources/static');
  const css = fs.readFileSync(path.join(root, 'css/product-ui.css'), 'utf8');
  for (const file of PAGES) {
    const html = fs.readFileSync(path.join(root, 'page/front', file), 'utf8');
    assert(`static-${file}-viewport`, /width=device-width/.test(html), 'responsive viewport');
    assert(`static-${file}-cache`, /product-ui\.css\?v=20260809u1a/.test(html), 'front cache');
    assert(`static-${file}-shell-cache`, /front-shell\.js\?v=20260809u1a/.test(html), 'shared shell retained');
    assert(`static-${file}-auth`, /requireAuth:\s*true/.test(html), 'authoritative auth');
    assert(`static-${file}-no-native-dialog`, !/\b(?:alert|confirm|prompt)\s*\(/.test(html), 'no native dialog');
    assert(`static-${file}-no-unsafe-html`, !/v-html|innerHTML\s*=/.test(html), 'no unsafe HTML sink');
    assert(`static-${file}-no-jwt-storage`, !/(?:local|session)Storage\.(?:setItem|getItem)\([^)]*(?:token|jwt)/i.test(html), 'no browser token storage');
  }
  const apply = fs.readFileSync(path.join(root, 'page/front/rescue_apply.html'), 'utf8');
  const mine = fs.readFileSync(path.join(root, 'page/front/my_rescue.html'), 'utf8');
  const notices = fs.readFileSync(path.join(root, 'page/front/notifications.html'), 'utf8');
  assert('static-rescue-stage-machine',
    /stagedFlag/.test(apply) && /retiredFlags/.test(apply)
      && /\/api\/files\/staged\//.test(apply) && /keepalive:\s*true/.test(apply),
    'staged retry and cleanup');
  assert('static-rescue-purpose-help', /appendUploadPurpose\(upload,\s*'help'\)/.test(apply), 'help upload purpose');
  assert('static-rescue-no-websocket', !/WebSocket|EventSource/.test(apply), 'HTTP-only community room');
  assert('static-rescue-safe-payload',
    /mutablePayload/.test(apply) && !/payload\.(?:uid|status|remark|animalId)\s*=/.test(apply),
    'no server-owned payload');
  assert('static-mine-session-owned',
    /\/api\/help\/mine/.test(mine) && !/data\s*:\s*\{[^}]*uid/.test(mine),
    'no uid query');
  assert('static-notification-exact-success',
    /exactSuccess/.test(notices) && !/\.always\(go\)/.test(notices),
    'writes do not navigate on failure');
  assert('static-notification-target-allowlist',
    /ALLOWED_TARGETS/.test(notices) && /\/page\/front\/adopt_proof\.html/.test(notices)
      && /parsed\.origin\s*!==\s*window\.location\.origin/.test(notices),
    'strict same-origin allowlist');
  assert('static-phase3d-css',
    /\.ui-user-rescue-page/.test(css) && /\.ui-notification-main/.test(css)
      && /\.ui-visually-hidden/.test(css) && /clip:\s*rect\(0,0,0,0\)/.test(css)
      && /prefers-reduced-motion/.test(css),
    'namespaced visual system');
}

async function waitForPageReady(page, file) {
  await page.locator('.ui-front-header').waitFor({ state: 'visible', timeout: 8000 });
  if (file === 'rescue_apply.html') {
    await page.locator('.ui-rescue-intake-form').waitFor();
    await page.locator('.ui-rescue-chat').waitFor();
  } else if (file === 'my_rescue.html') {
    await page.locator('.ui-rescue-record-card').first().waitFor();
  } else {
    await page.locator('.ui-notification-card').first().waitFor();
  }
}

async function matrix(browser) {
  for (const viewport of VIEWPORTS) {
    for (const file of PAGES) {
      const context = await browser.newContext({ viewport });
      await login(context);
      const page = await context.newPage();
      await installFixture(page);
      const audit = attachAudit(page, `matrix-${file}-${viewport.name}`);
      await page.goto(pageUrl(file), { waitUntil: 'domcontentloaded' });
      await waitForPageReady(page, file);
      const geometry = await pageGeometry(page);
      assert(`matrix-${file}-${viewport.name}-no-page-overflow`,
        geometry.bodyScrollWidth <= viewport.width + 1,
        JSON.stringify(geometry));
      assert(`matrix-${file}-${viewport.name}-content-bounds`,
        geometry.contentOffenders.length === 0,
        JSON.stringify(geometry.contentOffenders));
      assert(`matrix-${file}-${viewport.name}-touch`,
        geometry.touch.length === 0,
        JSON.stringify(geometry.touch));
      const stylesheets = await page.evaluate(() => performance.getEntriesByType('resource')
        .map((row) => row.name).filter((name) => name.includes('product-ui.css')));
      assert(`matrix-${file}-${viewport.name}-cache`,
        stylesheets.some((name) => name.includes('v=20260809u1a')),
        JSON.stringify(stylesheets));
      if (viewport.name === '1440x900' || viewport.name === '390x844') {
        const fileName = `${safeName(file)}-${viewport.name}.png`;
        await page.screenshot({ path: path.join(shotDir, fileName), fullPage: true });
        result.screenshots.push({
          file: `screenshots/${fileName}`,
          page: file,
          viewport: viewport.name
        });
      }
      finishAudit(audit);
      result.visits.push({ file, viewport: viewport.name, url: page.url(), geometry });
      await page.close();
      await context.close();
    }
  }
}

async function fillRescueForm(page, suffix = '') {
  await page.locator('#rescueTitleInput').fill(`测试救助 ${suffix}`);
  await page.locator('#rescueDescription').fill(`动物需要帮助 ${suffix}`);
  await page.locator('#rescueLocation').fill(`测试地点 ${suffix}`);
  await page.locator('#rescuePhone').fill('13800138000');
}

async function setPhoto(page, name = 'rescue.png') {
  await page.locator('#rescuePhoto').setInputFiles({
    name,
    mimeType: 'image/png',
    buffer: Buffer.from(`phase3d-${name}`)
  });
}

async function formValidationAndWriteProbe(browser) {
  const context = await browser.newContext();
  await login(context);
  const page = await context.newPage();
  const state = await installFixture(page, { helpFailures: 1, helpFailureStatus: 422, delayMs: 140 });
  const audit = attachAudit(page, 'rescue-form-validation-write');
  await page.goto(pageUrl('rescue_apply.html'), { waitUntil: 'domcontentloaded' });
  await page.locator('#rescueSubmit').click();
  assert('rescue-validation-focus',
    await page.locator('#rescueTitleInput').evaluate((element) => element === document.activeElement),
    'first invalid field focused');
  assert('rescue-validation-no-write', state.helpPostCount === 0 && state.uploadCount === 0, JSON.stringify(state));
  await fillRescueForm(page, '422');
  await page.locator('#rescueSubmit').evaluate((button) => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await page.getByRole('alert').filter({ hasText: '校验失败' }).waitFor();
  assert('rescue-double-click-one-write', state.helpPostCount === 1, `help=${state.helpPostCount}`);
  assert('rescue-422-keeps-input',
    await page.locator('#rescueTitleInput').inputValue() === '测试救助 422',
    'title preserved');
  const payload = JSON.parse(state.requests.find((row) => row.method === 'POST' && row.pathname === '/api/help').postData);
  assert('rescue-safe-payload',
    !['uid', 'status', 'remark', 'priority', 'animalId'].some((key) => Object.prototype.hasOwnProperty.call(payload, key)),
    JSON.stringify(payload));
  finishAudit(audit);
  probe('rescue-validation-double-write-422', { writes: state.helpPostCount, payload });
  await page.close();
  await context.close();
}

async function stagedRetryProbe(browser) {
  const context = await browser.newContext();
  await login(context);
  const page = await context.newPage();
  const state = await installFixture(page, { helpFailures: 1, delayMs: 60 });
  const audit = attachAudit(page, 'rescue-stage-retry');
  await page.goto(pageUrl('rescue_apply.html'), { waitUntil: 'domcontentloaded' });
  await fillRescueForm(page, 'stage');
  await setPhoto(page, 'stage.png');
  await page.locator('#rescueSubmit').click();
  await page.getByRole('alert').filter({ hasText: '保存失败' }).waitFor();
  await page.locator('.ui-stage-note').waitFor();
  assert('rescue-stage-first-counts',
    state.uploadCount === 1 && state.helpPostCount === 1 && state.stagedDeleteCount === 0,
    JSON.stringify(state));
  await page.locator('#rescueSubmit').click();
  await page.locator('.ui-rescue-success').waitFor();
  assert('rescue-stage-retry-no-upload',
    state.uploadCount === 1 && state.helpPostCount === 2,
    JSON.stringify(state));
  await page.evaluate(() => {
    window.dispatchEvent(new PageTransitionEvent('pagehide'));
    window.dispatchEvent(new PageTransitionEvent('pagehide'));
  });
  await sleep(180);
  assert('rescue-bound-stage-not-deleted', state.stagedDeleteCount === 0, `delete=${state.stagedDeleteCount}`);
  finishAudit(audit);
  probe('rescue-stage-retry-and-success-bind', {
    uploads: state.uploadCount,
    saves: state.helpPostCount,
    stagedDeletes: state.stagedDeleteCount
  });
  await page.close();
  await context.close();
}

async function stagedRetirementProbe(browser, mode) {
  const context = await browser.newContext();
  await login(context);
  const page = await context.newPage();
  const state = await installFixture(page, { helpFailures: 1 });
  const audit = attachAudit(page, `rescue-stage-${mode}`);
  await page.goto(pageUrl('rescue_apply.html'), { waitUntil: 'domcontentloaded' });
  await fillRescueForm(page, mode);
  await setPhoto(page, `${mode}.png`);
  await page.locator('#rescueSubmit').click();
  await page.locator('.ui-stage-note').waitFor();
  if (mode === 'replace') {
    await setPhoto(page, 'replacement.png');
  } else if (mode === 'reset') {
    await page.getByRole('button', { name: '清空表单' }).click();
  } else {
    await page.evaluate(() => {
      window.dispatchEvent(new PageTransitionEvent('pagehide'));
      window.dispatchEvent(new PageTransitionEvent('pagehide'));
    });
  }
  await sleep(220);
  assert(`rescue-stage-${mode}-delete-once`, state.stagedDeleteCount === 1, JSON.stringify(state));
  if (mode === 'replace') {
    assert('rescue-stage-replace-no-early-upload', state.uploadCount === 1, `upload=${state.uploadCount}`);
    assert('rescue-stage-replacement-file-kept',
      await page.locator('#rescuePhoto').evaluate((input) => input.files.length === 1 && input.files[0].name === 'replacement.png'),
      'replacement selected');
  }
  finishAudit(audit);
  probe(`rescue-stage-${mode}-cleanup-once`, {
    uploads: state.uploadCount,
    stagedDeletes: state.stagedDeleteCount
  });
  await page.close();
  await context.close();
}

async function chatWriteProbe(browser) {
  const context = await browser.newContext();
  await login(context);
  const page = await context.newPage();
  const state = await installFixture(page, { chatWriteStatus: 500, delayMs: 130 });
  const audit = attachAudit(page, 'chat-write');
  await page.goto(pageUrl('rescue_apply.html'), { waitUntil: 'domcontentloaded' });
  await page.locator('#communityMessage').fill('需要保留的公共消息');
  await page.locator('#communitySend').evaluate((button) => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await page.getByText('消息保存失败', { exact: false }).waitFor();
  assert('chat-double-click-one-write', state.chatPostCount === 1, `chat=${state.chatPostCount}`);
  assert('chat-failure-keeps-text',
    await page.locator('#communityMessage').inputValue() === '需要保留的公共消息',
    'text retained');
  await page.locator('#communitySend').waitFor({ state: 'visible' });
  await page.waitForFunction(() => !document.querySelector('#communitySend').disabled);
  state.scenario.chatWriteStatus = 200;
  await page.locator('#communitySend').click();
  await page.waitForFunction(() => document.querySelector('#communityMessage').value === '');
  assert('chat-success-second-write', state.chatPostCount === 2, `chat=${state.chatPostCount}`);
  assert('chat-success-single-render',
    await page.getByText('需要保留的公共消息', { exact: true }).count() === 1,
    'one rendered message');
  finishAudit(audit);
  probe('chat-write-lock-failure-retention', { writes: state.chatPostCount });
  await page.close();
  await context.close();
}

async function chatPollingProbe(browser) {
  const context = await browser.newContext();
  await login(context);
  const page = await context.newPage();
  const state = await installFixture(page);
  const audit = attachAudit(page, 'chat-polling', true);
  await page.goto(pageUrl('rescue_apply.html'), { waitUntil: 'domcontentloaded' });
  await page.getByText('社区消息 A', { exact: false }).first().waitFor();
  state.scenario.historyRace = true;
  await page.evaluate(() => {
    const vm = document.querySelector('#app').__vue__;
    vm.loadHistory();
    setTimeout(() => vm.loadHistory(), 20);
  });
  await sleep(380);
  const texts = await page.locator('.ui-chat-bubble').allTextContents();
  assert('chat-history-latest-wins',
    texts.some((text) => text.includes('快速消息')) && !texts.some((text) => text.includes('社区消息 2')),
    JSON.stringify(texts));
  const before = state.historyCount;
  await page.evaluate(() => {
    const vm = document.querySelector('#app').__vue__;
    vm.suspendPolling();
    vm.suspendPolling();
    vm.startPolling();
    vm.startPolling();
  });
  await sleep(360);
  assert('chat-resume-bounded-loads', state.historyCount <= before + 2, `before=${before} after=${state.historyCount}`);
  finishAudit(audit);
  probe('chat-history-race-and-polling-lifecycle', {
    historyCalls: state.historyCount,
    finalTexts: texts
  });
  await page.close();
  await context.close();
}

async function rescueListAndDialogProbe(browser) {
  const context = await browser.newContext();
  await login(context);
  const page = await context.newPage();
  const state = await installFixture(page);
  const audit = attachAudit(page, 'rescue-list-dialog', true);
  await page.goto(pageUrl('my_rescue.html'), { waitUntil: 'domcontentloaded' });
  const trigger = page.getByRole('button', { name: '查看完整详情' }).first();
  await trigger.waitFor();
  await trigger.click();
  const dialog = page.locator('.ui-rescue-detail-dialog');
  await dialog.waitFor();
  assert('rescue-detail-initial-focus',
    await dialog.evaluate((element) => element === document.activeElement),
    'dialog focused');
  await page.keyboard.press('Tab');
  const firstFocus = await page.evaluate(() => document.activeElement && document.activeElement.getAttribute('aria-label'));
  assert('rescue-detail-tab-enters', firstFocus === '关闭救助详情', `focus=${firstFocus}`);
  await page.keyboard.press('Shift+Tab');
  const lastText = await page.evaluate(() => document.activeElement && document.activeElement.textContent.trim());
  assert('rescue-detail-focus-wrap', lastText === '关闭详情', `focus=${lastText}`);
  await page.keyboard.press('Escape');
  assert('rescue-detail-esc-restores',
    await trigger.evaluate((element) => element === document.activeElement),
    'trigger restored');

  state.scenario.rescueRace = true;
  await page.evaluate(() => {
    const vm = document.querySelector('#app').__vue__;
    vm.load(2);
    setTimeout(() => vm.load(1), 20);
  });
  await page.getByText('快速页救助 1', { exact: true }).waitFor();
  await sleep(340);
  assert('rescue-list-latest-wins',
    await page.getByText('快速页救助 1', { exact: true }).count() === 1
      && await page.getByText('慢页救助 1', { exact: true }).count() === 0,
    'fast page retained');
  state.scenario.rescueRace = false;
  state.scenario.rescueListError = true;
  await page.getByRole('button', { name: '刷新记录' }).click();
  await page.getByText('救助记录读取失败', { exact: false }).waitFor();
  assert('rescue-list-error-clears-stale',
    await page.locator('.ui-rescue-record-card').count() === 0,
    'old cards cleared');
  finishAudit(audit);
  probe('rescue-list-race-error-and-dialog-focus', {
    listCalls: state.rescueListCount
  });
  await page.close();
  await context.close();
}

async function notificationRaceProbe(browser) {
  const context = await browser.newContext();
  await login(context);
  const page = await context.newPage();
  const state = await installFixture(page);
  const audit = attachAudit(page, 'notification-race', true);
  await page.goto(pageUrl('notifications.html'), { waitUntil: 'domcontentloaded' });
  await page.locator('.ui-notification-card').first().waitFor();
  state.scenario.notificationRace = true;
  await page.evaluate(() => {
    const vm = document.querySelector('#app').__vue__;
    vm.load(2);
    setTimeout(() => vm.load(1), 20);
  });
  await page.getByText('快速页通知 1', { exact: true }).waitFor();
  await sleep(340);
  assert('notification-list-latest-wins',
    await page.getByText('快速页通知 1', { exact: true }).count() === 1
      && await page.getByText('慢页通知 1', { exact: true }).count() === 0,
    'fast list retained');
  state.scenario.notificationRace = false;
  state.scenario.notificationListError = true;
  await page.evaluate(() => document.querySelector('#app').__vue__.load(1));
  await page.getByText('消息列表读取失败', { exact: false }).waitFor();
  assert('notification-error-clears-stale',
    await page.locator('.ui-notification-card').count() === 0,
    'old notifications cleared');
  state.scenario.countError = true;
  await page.evaluate(() => document.querySelector('#app').__vue__.loadUnreadCount());
  await page.getByRole('button', { name: '重试统计' }).waitFor();
  assert('notification-count-error-independent',
    await page.locator('.ui-notification-counter strong').textContent() === '—',
    'count unavailable, not zero');
  finishAudit(audit);
  probe('notification-list-count-independent-race', {
    listCalls: state.notificationListCount,
    countCalls: state.countReadCount
  });
  await page.close();
  await context.close();
}

async function notificationWriteProbe(browser) {
  const context = await browser.newContext();
  await login(context);
  const page = await context.newPage();
  const state = await installFixture(page, { readStatus: 409, markAllStatus: 500, delayMs: 130 });
  const audit = attachAudit(page, 'notification-write');
  await page.goto(pageUrl('notifications.html'), { waitUntil: 'domcontentloaded' });
  await page.locator('.ui-notification-card').first().waitFor();
  await page.evaluate(() => {
    const vm = document.querySelector('#app').__vue__;
    const unread = vm.items.find((item) => Number(item.readFlag) === 0);
    if (unread) unread.targetUrl = '';
  });
  const unreadCard = page.locator('.ui-notification-card.is-unread').first();
  const unreadTitle = String(await unreadCard.locator('h2').textContent()).trim();
  const stableUnreadCard = page.locator('.ui-notification-card').filter({ hasText: unreadTitle });
  const readButton = unreadCard.getByRole('button');
  await readButton.evaluate((button) => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await page.getByRole('alert').filter({ hasText: '已经变化' }).waitFor();
  assert('notification-read-double-one-write', state.readWriteCount === 1, `read=${state.readWriteCount}`);
  assert('notification-read-conflict-not-fake',
    await unreadCard.getByText('未读', { exact: true }).count() === 1,
    'still unread');
  await page.waitForFunction(() => {
    const button = document.querySelector('.ui-notification-card.is-unread button');
    return button && !button.disabled;
  });
  state.scenario.readStatus = 200;
  await readButton.click();
  await stableUnreadCard.getByText('已读', { exact: true }).waitFor();
  assert('notification-read-retry-success', state.readWriteCount === 2, `read=${state.readWriteCount}`);

  const markAll = page.locator('#markAllNotifications');
  await markAll.evaluate((button) => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await page.getByRole('alert').filter({ hasText: '全部标记失败' }).waitFor();
  assert('notification-mark-all-double-one-write', state.markAllCount === 1, `all=${state.markAllCount}`);
  assert('notification-mark-all-failure-not-zero',
    Number(await page.locator('.ui-notification-counter strong').textContent()) > 0,
    'unread retained');
  state.scenario.markAllStatus = 200;
  await markAll.click();
  await page.waitForFunction(() => document.querySelector('.ui-notification-counter strong').textContent.trim() === '0');
  assert('notification-mark-all-retry-success', state.markAllCount === 2, `all=${state.markAllCount}`);
  finishAudit(audit);
  probe('notification-single-all-write-locks', {
    singleWrites: state.readWriteCount,
    allWrites: state.markAllCount
  });
  await page.close();
  await context.close();
}

async function targetAllowlistProbe(browser) {
  const context = await browser.newContext();
  await login(context);
  const page = await context.newPage();
  await installFixture(page);
  const audit = attachAudit(page, 'notification-target');
  await page.goto(pageUrl('notifications.html'), { waitUntil: 'domcontentloaded' });
  await page.locator('.ui-notification-card').first().waitFor();
  const rows = await page.evaluate(() => {
    const vm = document.querySelector('#app').__vue__;
    const candidates = [
      '/page/front/my_adopt.html',
      '/page/front/adopt_proof.html?aid=10011',
      '/page/front/adopt_proof.html?aid=01',
      '/page/front/adopt_proof.html?aid=10011&x=1',
      '/page/end/index.html',
      '//evil.example/path',
      '/page/front/my_adopt.html%2f..%2f..',
      '/page/front\\my_adopt.html',
      'https://evil.example/page/front/my_adopt.html'
    ];
    return candidates.map((value) => ({ value, result: vm.safeTargetUrl(value) }));
  });
  const byValue = Object.fromEntries(rows.map((row) => [row.value, row.result]));
  assert('target-valid-adopt', byValue['/page/front/my_adopt.html'] === '/page/front/my_adopt.html', JSON.stringify(rows));
  assert('target-valid-proof', byValue['/page/front/adopt_proof.html?aid=10011'] === '/page/front/adopt_proof.html?aid=10011', JSON.stringify(rows));
  assert('target-rejects-invalid',
    rows.slice(2).every((row) => row.result === ''),
    JSON.stringify(rows));
  finishAudit(audit);
  probe('notification-target-url-allowlist', rows);
  await page.close();
  await context.close();
}

async function realReadOnlySmoke(browser) {
  const context = await browser.newContext();
  await login(context);
  for (const file of PAGES) {
    const page = await context.newPage();
    const writes = [];
    const pageErrors = [];
    const unexpectedHttp = [];
    await page.route('**/*', async (route) => {
      const request = route.request();
      if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
        writes.push({ method: request.method(), url: request.url() });
        result.realWriteAudit.push({ file, method: request.method(), url: request.url() });
        await route.fulfill({
          status: 418,
          contentType: 'application/json',
          body: failure(418, 'Phase 3D read-only smoke blocked write')
        });
        return;
      }
      await route.continue();
    });
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('response', (response) => {
      if (response.status() < 400) return;
      const pathname = new URL(response.url()).pathname;
      const allowedMissingAsset = response.status() === 404 && /^\/api\/files\/[a-zA-Z0-9-]+$/.test(pathname);
      if (!allowedMissingAsset) {
        unexpectedHttp.push({ status: response.status(), url: response.url() });
      }
    });
    let error = '';
    try {
      await page.goto(pageUrl(file), { waitUntil: 'domcontentloaded', timeout: 15000 });
      await page.locator('.ui-front-header').waitFor({ state: 'visible', timeout: 8000 });
    } catch (caught) {
      error = caught.message;
    }
    assert(`real-smoke-${file}-page`, !error, error || page.url());
    assert(`real-smoke-${file}-pageerror`, pageErrors.length === 0, JSON.stringify(pageErrors));
    assert(`real-smoke-${file}-http`, unexpectedHttp.length === 0, JSON.stringify(unexpectedHttp));
    assert(`real-smoke-${file}-writes`, writes.length === 0, JSON.stringify(writes));
    result.realSmoke.push({ file, url: page.url(), error, writes, pageErrors, unexpectedHttp });
    await page.close();
  }
  probe('real-service-read-only-smoke', { pages: PAGES.length });
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
  result.ok = result.summary.strictMode
    && result.summary.visits === result.summary.expectedVisits
    && result.summary.screenshots === PAGES.length * 2;

  fs.writeFileSync(path.join(out, 'phase-3d-report.json'), JSON.stringify(result, null, 2));
  fs.writeFileSync(path.join(out, 'screenshots-index.json'), JSON.stringify(result.screenshots, null, 2));
  const log = [
    `PHASE 3D STRICT=${result.summary.strictMode}`,
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
  const report = `# Phase 3D · 用户救助与站内通知闭环

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

- 3 个救助/通知页面 × 5 个视口。
- 正式救助字段验证、写锁、422 输入保留和暂存图片完整生命周期。
- 公共聊天室发送锁、失败保留、历史竞态和可见性轮询生命周期。
- 我的救助列表 latest-wins、错误清旧数据和详情弹窗焦点闭环。
- 通知列表/未读统计独立竞态、单条/全部已读精确 Boolean 与严格跳转白名单。
- jerry 真实服务只读烟测；所有业务写入均由夹具拦截。

## 证据

- \`phase-3d-report.json\`
- \`run-strict-final.log\`
- \`screenshots-index.json\`
- \`screenshots/\`
`;
  fs.writeFileSync(path.join(out, 'PHASE-3D-REPORT.md'), report);
}

(async () => {
  console.log('Phase 3D strict start', base);
  const browser = await chromium.launch({ headless: true });
  try {
    await staticAudit();
    await matrix(browser);
    await formValidationAndWriteProbe(browser);
    await stagedRetryProbe(browser);
    await stagedRetirementProbe(browser, 'replace');
    await stagedRetirementProbe(browser, 'reset');
    await stagedRetirementProbe(browser, 'pagehide');
    await chatWriteProbe(browser);
    await chatPollingProbe(browser);
    await rescueListAndDialogProbe(browser);
    await notificationRaceProbe(browser);
    await notificationWriteProbe(browser);
    await targetAllowlistProbe(browser);
    await realReadOnlySmoke(browser);
  } catch (error) {
    fail('phase-3d-runner', error && error.stack ? error.stack : error);
  } finally {
    await browser.close();
    writeReports();
  }
  console.log(JSON.stringify(result.summary, null, 2));
  if (!result.ok) process.exitCode = 1;
})().catch((error) => {
  fail('phase-3d-fatal', error && error.stack ? error.stack : error);
  writeReports();
  console.error(error);
  process.exitCode = 1;
});
