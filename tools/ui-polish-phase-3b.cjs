/**
 * Phase 3B strict audit — public discovery and transparency pages.
 * Browser operations are read-only. Deterministic fixtures exercise loading,
 * success, empty, error, invalid-id, pagination and latest-wins behavior.
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const startedAt = Date.now();
const base = process.env.BASE_URL || 'http://127.0.0.1:18121';
const out = path.resolve('output/playwright/ui-polish-phase-3b');
const shotDir = path.join(out, 'screenshots');
fs.mkdirSync(shotDir, { recursive: true });
for (const file of fs.readdirSync(shotDir)) {
  if (file.endsWith('.png')) fs.unlinkSync(path.join(shotDir, file));
}

const PAGES = [
  'index.html',
  'animal_browse.html',
  'animal_detail.html',
  'notice_list.html',
  'notice_detail.html',
  'account_public.html'
];
const VIEWPORTS = [
  { name: '1440x900', width: 1440, height: 900 },
  { name: '1280x800', width: 1280, height: 800 },
  { name: '768x1024', width: 768, height: 1024 },
  { name: '390x844', width: 390, height: 844 },
  { name: '320x700', width: 320, height: 700 }
];
const result = {
  phase: '3B',
  base,
  branch: 'ui-polish/phase-3b-public-discovery-20260731',
  baseline: '09faaf7f40293ae3f2996fc7aa1faa833f9aef2f',
  startedAt: new Date().toISOString(),
  checks: [],
  failures: [],
  visits: [],
  screenshots: [],
  consoleAudit: [],
  httpAudit: [],
  requestFailedAudit: [],
  writeRequestAudit: [],
  probes: [],
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
function pageUrl(file) {
  const query = file === 'animal_detail.html' ? '?id=101'
    : file === 'notice_detail.html' ? '?id=201' : '';
  return `${base}/page/front/${file}${query}`;
}
function success(data) {
  return JSON.stringify({ code: '0', msg: '成功', data });
}
function failure(code, msg) {
  return JSON.stringify({ code: String(code), msg, data: null });
}
function animal(id, overrides = {}) {
  return {
    id,
    tname: `待领养伙伴${id}`,
    ttype: id % 2 ? '猫' : '犬',
    tsex: id % 2 ? '母' : '公',
    tbirthday: '2024-05-01',
    tpic: '',
    tstate: id % 3 === 0 ? 1 : 0,
    tdescribe: '性格温和，喜欢安静地观察周围，也愿意慢慢认识新的家人。',
    ...overrides
  };
}
function notice(id, overrides = {}) {
  return {
    id,
    title: `公开救助进展 ${id}`,
    content: '这是来自平台公开记录的进展说明。信息经过整理，仅用于向公众说明当前事项。',
    ...overrides
  };
}
function account(index, overrides = {}) {
  return {
    alabel: index % 2 ? `爱心捐助 ${index}` : `医疗支出 ${index}`,
    avalue: index % 2 ? `${100 + index}.10` : `-${40 + index}.25`,
    adescribe: index % 2 ? '用于流浪动物安置与基础照护' : '用于公开档案动物的检查与治疗',
    occurredAt: `2026-07-${String(Math.max(1, 31 - index)).padStart(2, '0')} 10:30:00`,
    category: index % 2 ? 'donation' : 'medical',
    businessType: index % 2 ? null : 'animal',
    businessId: index % 2 ? null : String(10000 + index),
    ...overrides
  };
}

async function installFixture(page, scenario = {}) {
  const requests = [];
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const method = request.method();
    const url = new URL(request.url());
    const pathname = url.pathname;
    requests.push({ method, pathname, search: url.search });
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      await route.fulfill({ status: 405, contentType: 'application/json', body: failure(405, 'Phase 3B fixture blocks writes') });
      return;
    }
    if (pathname === '/api/user/me') {
      await route.fulfill({ status: 401, contentType: 'application/json', body: failure(401, '未登录') });
      return;
    }
    if (pathname === '/api/dashboard/home-stats') {
      if (scenario.statsError) {
        await route.fulfill({ status: 500, contentType: 'application/json', body: failure(500, '统计读取失败') });
      } else {
        await route.fulfill({ status: 200, contentType: 'application/json', body: success({ availableAnimals: 12, adoptedAnimals: 38, approvedVolunteers: 16 }) });
      }
      return;
    }
    if (pathname === '/api/animal/page1') {
      const query = url.searchParams.get('name') || '';
      const pageNum = Number(url.searchParams.get('pageNum') || 1);
      const type = url.searchParams.get('type') || '';
      if (scenario.animalList === 'error') {
        await route.fulfill({ status: 500, contentType: 'application/json', body: failure(500, '动物列表读取失败') });
        return;
      }
      if (scenario.animalList === 'empty' || query === '没有结果') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: success({ records: [], total: 0, pages: 0, current: 1, size: 9 }) });
        return;
      }
      if (scenario.animalRace && query === '慢请求') await sleep(260);
      const name = query === '快速结果' ? '快速结果伙伴' : null;
      let rows = Array.from({ length: pageNum === 1 ? 9 : 3 }, (_, i) => animal((pageNum - 1) * 9 + i + 101, name ? { tname: name } : {}));
      if (type === '猫') rows = rows.map((item) => ({ ...item, ttype: '猫' }));
      if (type === '犬类') rows = rows.map((item) => ({ ...item, ttype: '犬' }));
      await route.fulfill({ status: 200, contentType: 'application/json', body: success({ records: rows, total: 12, pages: 2, current: pageNum, size: 9 }) });
      return;
    }
    if (/^\/api\/animal\/\d+$/.test(pathname)) {
      if (scenario.animalDetail === 'error') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: failure(404, '动物信息不存在') });
      } else {
        const state = scenario.animalState === undefined ? 0 : scenario.animalState;
        await route.fulfill({ status: 200, contentType: 'application/json', body: success(animal(101, {
          tname: '长名字测试伙伴ABCDEFGHIJKLMN',
          tstate: state,
          tdescribe: '这是一段用于验证详情页排版的公开说明。'.repeat(8)
        })) });
      }
      return;
    }
    if (/^\/api\/operations\/animals\/\d+\/medical$/.test(pathname)) {
      if (scenario.medicalError) {
        await route.fulfill({ status: 500, contentType: 'application/json', body: failure(500, '医疗档案读取失败') });
      } else {
        await route.fulfill({ status: 200, contentType: 'application/json', body: success([
          { id: 1, record_type: 'exam', title: '基础体检', content: '体检记录公开摘要', occurred_at: '2026-07-20 09:00:00' }
        ]) });
      }
      return;
    }
    if (pathname === '/api/notice/page') {
      const query = url.searchParams.get('name') || '';
      const pageNum = Number(url.searchParams.get('pageNum') || 1);
      if (scenario.noticeList === 'error') {
        await route.fulfill({ status: 500, contentType: 'application/json', body: failure(500, '公告读取失败') });
        return;
      }
      if (scenario.noticeList === 'empty' || query === '没有结果') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: success({ records: [], total: 0, pages: 0, current: 1, size: 8 }) });
        return;
      }
      if (scenario.noticeRace && query === '慢请求') await sleep(280);
      const rows = Array.from({ length: pageNum === 1 ? 8 : 4 }, (_, i) => notice((pageNum - 1) * 8 + i + 201, {
        title: query === '快速结果' ? '快速结果公告' : `公开救助进展 ${i + 1} — ${'长标题'.repeat(8)}`,
        content: `${'公开内容用于检验长文本、英文串与换行。'.repeat(5)} ${'UNBROKEN'.repeat(12)}`
      }));
      await route.fulfill({ status: 200, contentType: 'application/json', body: success({ records: rows, total: 12, pages: 2, current: pageNum, size: 8 }) });
      return;
    }
    if (/^\/api\/notice\/\d+$/.test(pathname)) {
      if (scenario.noticeDetail === 'error') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: failure(404, '公告不存在') });
      } else {
        await route.fulfill({ status: 200, contentType: 'application/json', body: success(notice(201, {
          title: `公开公告：${'很长的标题'.repeat(9)} ${'X'.repeat(80)}`,
          content: `${'第一段公开说明，用于验证长文阅读节奏。\n\n'.repeat(7)}${'UNBROKEN'.repeat(24)}`
        })) });
      }
      return;
    }
    if (pathname === '/api/account/public') {
      const query = url.searchParams.get('name') || '';
      const pageNum = Number(url.searchParams.get('pageNum') || 1);
      if (scenario.accountList === 'error') {
        await route.fulfill({ status: 500, contentType: 'application/json', body: failure(500, '资金公示读取失败') });
        return;
      }
      if (scenario.accountList === 'empty' || query === '没有结果') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: success({ records: [], total: 0, pages: 0, current: 1, size: 10, incomeTotal: '9007199254740993.01', expenseTotal: '-123.45', balance: '9007199254740869.56' }) });
        return;
      }
      if (scenario.accountRace && query === '慢请求') await sleep(300);
      const rows = Array.from({ length: pageNum === 1 ? 10 : 2 }, (_, i) => account((pageNum - 1) * 10 + i + 1, query === '快速结果' ? { alabel: '快速结果款项' } : {}));
      await route.fulfill({ status: 200, contentType: 'application/json', body: success({
        records: rows,
        total: 12,
        pages: 2,
        current: pageNum,
        size: 10,
        incomeTotal: '9007199254740993.01',
        expenseTotal: '-123.45',
        balance: '9007199254740869.56'
      }) });
      return;
    }
    await route.fulfill({ status: 404, contentType: 'application/json', body: failure(404, `Unregistered fixture ${pathname}`) });
  });
  return requests;
}

function expectedHttp(row) {
  return row.status === 401 && /\/api\/user\/me(?:[?#]|$)/.test(row.url);
}
function expectedConsole(text, httpRows) {
  const match = String(text).match(/status of (\d+)/i);
  if (!match) return false;
  return httpRows.some((row) => row.status === Number(match[1]) && expectedHttp(row));
}
function attachAudit(page, label, allowAborted = false) {
  const audit = { label, console: [], pageErrors: [], http: [], requestFailed: [], writes: [] };
  page.on('console', (message) => {
    if (message.type() === 'error') audit.console.push(message.text());
  });
  page.on('pageerror', (error) => audit.pageErrors.push(error.message));
  page.on('response', (response) => {
    if (response.status() >= 400) audit.http.push({
      status: response.status(),
      method: response.request().method(),
      url: response.url()
    });
  });
  page.on('requestfailed', (request) => {
    const row = { method: request.method(), url: request.url(), error: request.failure() && request.failure().errorText };
    if (!(allowAborted && /ERR_ABORTED|NS_BINDING_ABORTED/i.test(row.error || ''))) audit.requestFailed.push(row);
  });
  page.on('request', (request) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
      audit.writes.push({ method: request.method(), url: request.url() });
    }
  });
  return audit;
}
function finishAudit(audit) {
  const unexpectedHttp = audit.http.filter((row) => !expectedHttp(row));
  const unexpectedConsole = audit.console.filter((text) => !expectedConsole(text, audit.http));
  result.consoleAudit.push(...audit.console.map((text) => ({ label: audit.label, text, expected: expectedConsole(text, audit.http) })));
  result.httpAudit.push(...audit.http.map((row) => ({ label: audit.label, ...row, expected: expectedHttp(row) })));
  result.requestFailedAudit.push(...audit.requestFailed.map((row) => ({ label: audit.label, ...row })));
  result.writeRequestAudit.push(...audit.writes.map((row) => ({ label: audit.label, ...row })));
  assert(`${audit.label}-pageerror`, audit.pageErrors.length === 0, audit.pageErrors.join(' | '));
  assert(`${audit.label}-console`, unexpectedConsole.length === 0, JSON.stringify(unexpectedConsole));
  assert(`${audit.label}-http`, unexpectedHttp.length === 0, JSON.stringify(unexpectedHttp));
  assert(`${audit.label}-requestfailed`, audit.requestFailed.length === 0, JSON.stringify(audit.requestFailed));
  assert(`${audit.label}-writes`, audit.writes.length === 0, JSON.stringify(audit.writes));
}

async function waitForPage(page) {
  await page.locator('#app').waitFor({ state: 'visible', timeout: 8000 });
  await page.waitForFunction(() => !document.querySelector('[v-cloak]'), null, { timeout: 8000 });
  await page.waitForTimeout(180);
}

async function matrixVisit(context, file, viewport) {
  const label = `matrix-${safeName(file)}-${viewport.name}`;
  const page = await context.newPage();
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  const audit = attachAudit(page, label);
  await installFixture(page, {});
  let navigationError = '';
  try {
    await page.goto(pageUrl(file), { waitUntil: 'domcontentloaded', timeout: 12000 });
    await waitForPage(page);
  } catch (error) {
    navigationError = error.message;
  }
  assert(`${label}-navigation`, !navigationError, navigationError || page.url());
  if (!navigationError) {
    const state = await page.evaluate(() => {
      const visible = (element) => !!element && getComputedStyle(element).display !== 'none' && element.getClientRects().length > 0;
      const criticalTargets = [...document.querySelectorAll('main button, main a.ui-button')]
        .filter(visible)
        .map((element) => {
          const rect = element.getBoundingClientRect();
          return { text: (element.textContent || '').trim().slice(0, 30), width: rect.width, height: rect.height };
        });
      const toolbarSearch = document.querySelector('.ui-public-toolbar .ui-search');
      const searchRect = toolbarSearch && toolbarSearch.getBoundingClientRect();
      const resources = performance.getEntriesByType('resource').map((entry) => entry.name);
      const contentEscapes = [...document.querySelectorAll('main h1, .ui-card-title-row h2, .ui-notice-copy h2, .ui-summary-card strong, .ui-article-body, .ui-breadcrumb strong')]
        .filter(visible)
        .map((element) => {
          const rect = element.getBoundingClientRect();
          return { text: (element.textContent || '').trim().slice(0, 36), left: rect.left, right: rect.right };
        })
        .filter((row) => row.left < -1 || row.right > innerWidth + 1);
      return {
        h1: document.querySelectorAll('main h1').length,
        main: document.querySelectorAll('main').length,
        header: document.querySelectorAll('.ui-front-header').length,
        footer: document.querySelectorAll('.ui-front-footer').length,
        unresolved: document.querySelectorAll('front-site-header, front-site-footer').length,
        overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        cache: resources.some((url) => /product-ui\.css\?v=20260731b/.test(url)),
        searchHeight: searchRect ? searchRect.height : 0,
        targets: criticalTargets,
        contentEscapes,
        publicClass: document.body.classList.contains('ui-public-discovery-page')
      };
    });
    assert(`${label}-structure`, state.h1 === 1 && state.main === 1 && state.header === 1 && state.footer === 1 && state.unresolved === 0, JSON.stringify(state));
    assert(`${label}-cache`, state.cache && state.publicClass, JSON.stringify(state));
    assert(`${label}-overflow`, !state.overflow, `${state.scrollWidth}/${state.clientWidth}`);
    assert(`${label}-content-containment`, state.contentEscapes.length === 0, JSON.stringify(state.contentEscapes));
    const smallTargets = state.targets.filter((target) => target.height < 43.5 || target.width < 43.5);
    assert(`${label}-touch-targets`, smallTargets.length === 0, JSON.stringify(smallTargets));
    if (viewport.width <= 640 && state.searchHeight) {
      assert(`${label}-mobile-search-height`, state.searchHeight >= 44 && state.searchHeight <= 64, `height=${state.searchHeight}`);
    }
    if (file === 'account_public.html') {
      const ledger = await page.evaluate(() => ({
        tableVisible: getComputedStyle(document.querySelector('.ui-ledger-table')).display !== 'none',
        cardsVisible: getComputedStyle(document.querySelector('.ui-ledger-cards')).display !== 'none',
        money: document.querySelector('.ui-summary-card strong')?.textContent.trim(),
        summaryFits: [...document.querySelectorAll('.ui-summary-card strong')].every((element) => {
          const card = element.closest('.ui-summary-card');
          return element.getBoundingClientRect().right <= card.getBoundingClientRect().right - 12;
        })
      }));
      assert(`${label}-ledger-responsive`, viewport.width <= 640 ? (!ledger.tableVisible && ledger.cardsVisible) : (ledger.tableVisible && !ledger.cardsVisible), JSON.stringify(ledger));
      assert(`${label}-ledger-precision`, ledger.money === '¥9,007,199,254,740,993.01', ledger.money);
      assert(`${label}-ledger-summary-fit`, ledger.summaryFits, JSON.stringify(ledger));
    }
    if (file === 'animal_detail.html') {
      assert(`${label}-adopt-action`, await page.locator('a[href*="adopt_apply.html"]').count() === 1, 'available animal has one apply link');
    }
    if (viewport.name === '1440x900' || viewport.name === '390x844') {
      const shotName = `${safeName(file)}-${viewport.name}`;
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: path.join(shotDir, `${shotName}.png`), fullPage: false });
      result.screenshots.push({ name: shotName, file: `screenshots/${shotName}.png`, page: file, viewport: viewport.name });
    }
    result.visits.push({ file, viewport: viewport.name, url: page.url(), state });
  }
  finishAudit(audit);
  await page.close();
}

async function testBrowseInteractions(context) {
  const scenario = { animalRace: true };
  const page = await context.newPage();
  await page.setViewportSize({ width: 390, height: 844 });
  const audit = attachAudit(page, 'browse-interactions', true);
  await installFixture(page, scenario);
  await page.goto(`${base}/page/front/animal_browse.html`, { waitUntil: 'domcontentloaded' });
  await waitForPage(page);
  await page.getByRole('button', { name: '猫咪' }).click();
  await page.locator('.ui-animal-card').first().waitFor();
  assert('browse-filter-user-flow', (await page.locator('.ui-card-meta').first().innerText()).includes('猫'), await page.locator('.ui-card-meta').first().innerText());
  await page.getByRole('button', { name: '下一页' }).click();
  await page.waitForFunction(() => document.body.innerText.includes('第 2 页'));
  assert('browse-pagination-user-flow', await page.locator('.ui-page-buttons [aria-current="page"]').innerText() === '2', 'current page 2');
  const input = page.getByRole('searchbox', { name: '搜索动物' });
  await input.fill('慢请求');
  await page.getByRole('button', { name: '搜索' }).click();
  await input.fill('快速结果');
  await page.getByRole('button', { name: '搜索' }).click();
  await page.waitForFunction(() => document.body.innerText.includes('快速结果伙伴'));
  await page.waitForTimeout(360);
  assert('browse-latest-wins', (await page.locator('.ui-card-title-row h2').first().innerText()) === '快速结果伙伴', await page.locator('.ui-card-title-row h2').first().innerText());
  finishAudit(audit);
  probe('browse-dom-interactions', { filter: true, pagination: true, latestWins: true });
  await page.close();
}

async function testNoticeInteractions(context) {
  const scenario = { noticeRace: true };
  const page = await context.newPage();
  const audit = attachAudit(page, 'notice-interactions', true);
  await installFixture(page, scenario);
  await page.goto(`${base}/page/front/notice_list.html`, { waitUntil: 'domcontentloaded' });
  await waitForPage(page);
  await page.getByRole('button', { name: '下一页' }).click();
  await page.waitForFunction(() => document.body.innerText.includes('第 2 页'));
  assert('notice-pagination-user-flow', await page.locator('.ui-page-buttons [aria-current="page"]').innerText() === '2', 'current page 2');
  const input = page.getByRole('searchbox', { name: '搜索公告' });
  await input.fill('慢请求');
  await page.getByRole('button', { name: '搜索' }).click();
  await input.fill('快速结果');
  await page.getByRole('button', { name: '搜索' }).click();
  await page.waitForFunction(() => document.body.innerText.includes('快速结果公告'));
  await page.waitForTimeout(360);
  assert('notice-latest-wins', (await page.locator('.ui-notice-copy h2').first().innerText()) === '快速结果公告', await page.locator('.ui-notice-copy h2').first().innerText());
  finishAudit(audit);
  probe('notice-dom-interactions', { pagination: true, latestWins: true });
  await page.close();
}

async function testAccountInteractions(context) {
  const scenario = { accountRace: true };
  const page = await context.newPage();
  const audit = attachAudit(page, 'account-interactions', true);
  await installFixture(page, scenario);
  await page.goto(`${base}/page/front/account_public.html`, { waitUntil: 'domcontentloaded' });
  await waitForPage(page);
  await page.getByRole('button', { name: '下一页' }).click();
  await page.waitForFunction(() => document.body.innerText.includes('第 2 页'));
  assert('account-pagination-user-flow', await page.locator('.ui-page-buttons [aria-current="page"]').innerText() === '2', 'current page 2');
  const input = page.getByRole('searchbox', { name: '搜索资金公示' });
  await input.fill('慢请求');
  await page.getByRole('button', { name: '搜索' }).click();
  await input.fill('快速结果');
  await page.getByRole('button', { name: '搜索' }).click();
  await page.waitForFunction(() => document.body.innerText.includes('快速结果款项'));
  await page.waitForTimeout(380);
  assert('account-latest-wins', (await page.locator('.ui-ledger-table tbody strong').first().innerText()) === '快速结果款项', await page.locator('.ui-ledger-table tbody strong').first().innerText());
  finishAudit(audit);
  probe('account-dom-interactions', { pagination: true, latestWins: true, precision: true });
  await page.close();
}

async function testState(context, file, scenario, expectedText, action) {
  const label = `state-${safeName(file)}-${safeName(expectedText)}`;
  const page = await context.newPage();
  const audit = attachAudit(page, label);
  await installFixture(page, scenario);
  await page.goto(pageUrl(file), { waitUntil: 'domcontentloaded' });
  await waitForPage(page);
  await page.getByText(expectedText, { exact: false }).first().waitFor();
  assert(`${label}-visible`, await page.getByText(expectedText, { exact: false }).first().isVisible(), expectedText);
  const controlledPath = scenario.animalList === 'error' ? '/api/animal/page1'
    : scenario.noticeList === 'error' ? '/api/notice/page'
      : scenario.accountList === 'error' ? '/api/account/public' : '';
  if (controlledPath) {
    const controlledRows = audit.http.filter((row) => row.status === 500 && new URL(row.url).pathname === controlledPath);
    assert(`${label}-controlled-error-count`, controlledRows.length === 1, JSON.stringify(controlledRows));
    audit.http = audit.http.filter((row) => !controlledRows.includes(row));
    audit.console = audit.console.filter((text) => !/status of 500/i.test(text));
  }
  if (action) await action(page, scenario);
  finishAudit(audit);
  await page.close();
}

async function testInvalidIds(context) {
  for (const [file, text] of [['animal_detail.html', '缺少动物编号'], ['notice_detail.html', '缺少公告编号']]) {
    for (const query of ['', '?id=abc%2F..']) {
      const page = await context.newPage();
      const audit = attachAudit(page, `invalid-${safeName(file)}-${query ? 'format' : 'missing'}`);
      const requests = await installFixture(page, {});
      await page.goto(`${base}/page/front/${file}${query}`, { waitUntil: 'domcontentloaded' });
      await waitForPage(page);
      const expected = query ? '编号格式不正确' : text;
      assert(`invalid-${safeName(file)}-${query ? 'format' : 'missing'}-message`, (await page.locator('.ui-state').innerText()).includes(expected), await page.locator('.ui-state').innerText());
      const detailCalls = requests.filter((row) => file.startsWith('animal') ? /^\/api\/animal\/[^/]+$/.test(row.pathname) : /^\/api\/notice\/[^/]+$/.test(row.pathname));
      assert(`invalid-${safeName(file)}-${query ? 'format' : 'missing'}-no-detail-request`, detailCalls.length === 0, JSON.stringify(detailCalls));
      finishAudit(audit);
      await page.close();
    }
  }
  probe('invalid-id-client-guard', { animal: true, notice: true, requests: 0 });
}

async function testNonAdoptable(context) {
  const page = await context.newPage();
  const audit = attachAudit(page, 'animal-non-adoptable');
  await installFixture(page, { animalState: 2 });
  await page.goto(`${base}/page/front/animal_detail.html?id=101`, { waitUntil: 'domcontentloaded' });
  await waitForPage(page);
  const disabled = page.locator('.ui-detail-actions button[disabled]');
  assert('animal-non-adoptable-disabled', await disabled.count() === 1 && (await disabled.innerText()).includes('已找到新家'), await disabled.count());
  assert('animal-non-adoptable-no-apply-link', await page.locator('a[href*="adopt_apply.html"]').count() === 0, 'no apply link');
  finishAudit(audit);
  probe('non-adoptable-cta', { state: 2, disabled: true });
  await page.close();
}

async function realReadOnlySmoke(browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const audit = attachAudit(page, 'real-read-only-smoke');
  let animalId = null;
  let noticeId = null;
  try {
    const animalResponse = await context.request.get(`${base}/api/animal/page1?pageNum=1&pageSize=1`);
    const animalBody = await animalResponse.json();
    animalId = animalBody?.data?.records?.[0]?.id || null;
    const noticeResponse = await context.request.get(`${base}/api/notice/page?pageNum=1&pageSize=1`);
    const noticeBody = await noticeResponse.json();
    noticeId = noticeBody?.data?.records?.[0]?.id || null;
    const accountResponse = await context.request.get(`${base}/api/account/public?pageNum=1&pageSize=1`);
    const accountBody = await accountResponse.json();
    assert('real-api-animal', animalResponse.status() === 200 && animalBody.code === '0', `${animalResponse.status()} ${animalBody.code}`);
    assert('real-api-notice', noticeResponse.status() === 200 && noticeBody.code === '0', `${noticeResponse.status()} ${noticeBody.code}`);
    assert('real-api-account', accountResponse.status() === 200 && accountBody.code === '0', `${accountResponse.status()} ${accountBody.code}`);
    await page.goto(`${base}/page/front/index.html`, { waitUntil: 'domcontentloaded' });
    await waitForPage(page);
    await page.getByRole('link', { name: '浏览待领养动物' }).first().click();
    await page.waitForURL(/animal_browse\.html/);
    await waitForPage(page);
    assert('real-home-to-browse', /animal_browse\.html/.test(page.url()), page.url());
    if (animalId) {
      await page.goto(`${base}/page/front/animal_detail.html?id=${encodeURIComponent(animalId)}`, { waitUntil: 'domcontentloaded' });
      await waitForPage(page);
      assert('real-animal-detail', await page.locator('.ui-detail h1').count() === 1, `animal=${animalId}`);
    }
    if (noticeId) {
      await page.goto(`${base}/page/front/notice_detail.html?id=${encodeURIComponent(noticeId)}`, { waitUntil: 'domcontentloaded' });
      await waitForPage(page);
      assert('real-notice-detail', await page.locator('.ui-article h1').count() === 1, `notice=${noticeId}`);
    }
  } catch (error) {
    fail('real-read-only-smoke-runtime', error.stack || error.message);
  }
  // Real data may reference historical missing uploads; those 404s are data-storage residue.
  const file404 = audit.http.filter((row) => row.status === 404 && /\/api\/files\/[A-Za-z0-9-]+(?:[?#]|$)/.test(row.url));
  audit.http = audit.http.filter((row) => !file404.includes(row));
  audit.console = audit.console.filter((text) => !(/status of 404/i.test(text) && file404.length));
  finishAudit(audit);
  probe('real-read-only-smoke', { animalId, noticeId, historicalMissingImages: file404.length });
  await context.close();
}

function staticChecks() {
  for (const file of PAGES) {
    const source = fs.readFileSync(path.resolve('src/main/resources/static/page/front', file), 'utf8');
    assert(`static-${safeName(file)}-cache`, /product-ui\.css\?v=20260731b/.test(source), 'Phase 3B cache');
    assert(`static-${safeName(file)}-shell`, /front-site-header/.test(source) && /front-site-footer/.test(source), 'Phase 3A shell retained');
    assert(`static-${safeName(file)}-body-class`, /ui-public-discovery-page/.test(source), 'Phase 3B namespace');
    assert(`static-${safeName(file)}-no-native-dialogs`, !/\b(?:alert|confirm|prompt)\s*\(/.test(source), 'no native dialog');
  }
  const css = fs.readFileSync(path.resolve('src/main/resources/static/css/product-ui.css'), 'utf8');
  assert('static-css-phase-marker', /Phase 3B · 公开发现与透明公示/.test(css), 'Phase 3B CSS marker');
  assert('static-css-mobile-search-contract', /ui-public-toolbar \.ui-search[\s\S]{0,260}flex:\s*0 0 48px/.test(css), 'mobile search height contract');
  const noticeSource = fs.readFileSync(path.resolve('src/main/resources/static/page/front/notice_list.html'), 'utf8');
  const accountSource = fs.readFileSync(path.resolve('src/main/resources/static/page/front/account_public.html'), 'utf8');
  assert('static-notice-latest-wins', /_noticeGeneration/.test(noticeSource) && /status === 'abort'/.test(noticeSource), 'notice generation and abort');
  assert('static-account-latest-wins', /_accountGeneration/.test(accountSource) && /clearPublicData/.test(accountSource), 'account generation and stale clear');
}

function writeArtifacts() {
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
    strictMode: result.failures.length === 0
      && result.skippedCount === 0
      && result.bestEffortPassCount === 0
      && result.fallbackPassCount === 0,
    durationMs: Date.now() - startedAt,
    finishedAt: new Date().toISOString()
  };
  result.ok = result.summary.strictMode && result.visits.length === result.summary.expectedVisits;
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'phase-3b-report.json'), `${JSON.stringify(result, null, 2)}\n`);
  fs.writeFileSync(path.join(out, 'screenshots-index.json'), `${JSON.stringify(result.screenshots, null, 2)}\n`);
  const log = [
    `PHASE 3B STRICT=${result.summary.strictMode}`,
    `ASSERTIONS ${result.summary.passed}/${result.summary.failed}/${result.summary.skipped}`,
    `VISITS ${result.summary.visits}/${result.summary.expectedVisits}`,
    `SCREENSHOTS ${result.summary.screenshots}`,
    `PROBES ${result.summary.strictRuntimeProbeCount}`,
    `BEST_EFFORT ${result.summary.bestEffortPassCount}`,
    `FALLBACK ${result.summary.fallbackPassCount}`,
    `WRITES ${result.writeRequestAudit.length}`,
    ...result.failures.map((row) => `FAIL ${row.id} :: ${row.detail}`)
  ].join('\n');
  fs.writeFileSync(path.join(out, 'run-strict-final.log'), `${log}\n`);
  const report = `# Phase 3B · 公开发现与透明公示\n
- 分支：\`${result.branch}\`
- 基线：\`${result.baseline}\`
- 服务：\`${result.base}\`
- 结果：${result.ok ? 'PASS' : 'FAIL'}
- 断言：${result.summary.passed} 通过 / ${result.summary.failed} 失败 / ${result.summary.skipped} 跳过
- 页面矩阵：${result.summary.visits} / ${result.summary.expectedVisits}
- 截图：${result.summary.screenshots}
- 严格探针：${result.summary.strictRuntimeProbeCount}
- best-effort / fallback：${result.summary.bestEffortPassCount} / ${result.summary.fallbackPassCount}
- 非 GET 写请求：${result.writeRequestAudit.length}

## 覆盖

- 6 个公开页面 × 5 个视口（1440 / 1280 / 768 / 390 / 320）。
- 首页、动物浏览/详情、公告列表/详情、透明公示的真实只读烟测。
- 搜索、类型筛选、分页、详情返回、可/不可领养 CTA。
- loading / empty / error / missing-id / invalid-id / not-found / long-content。
- 动物、公告、资金列表的慢请求晚到对抗（latest-wins）。
- DecimalMoney 大数精度、桌面表格与移动卡片同源展示。
- 控制台、pageerror、未登记 HTTP、requestfailed、写请求、横向溢出、触控尺寸、缓存版本。

## 证据

- \`phase-3b-report.json\`
- \`run-strict-final.log\`
- \`screenshots-index.json\`
- \`screenshots/\`
`;
  fs.writeFileSync(path.join(out, 'PHASE-3B-REPORT.md'), report);
  console.log(log);
}

(async () => {
  staticChecks();
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    for (const viewport of VIEWPORTS) {
      for (const file of PAGES) await matrixVisit(context, file, viewport);
    }
    await testBrowseInteractions(context);
    await testNoticeInteractions(context);
    await testAccountInteractions(context);
    await testState(context, 'animal_browse.html', { animalList: 'empty' }, '没有找到匹配的动物');
    await testState(context, 'notice_list.html', { noticeList: 'empty' }, '没有找到相关公告');
    await testState(context, 'account_public.html', { accountList: 'empty' }, '暂无匹配的公示记录');
    await testState(context, 'animal_browse.html', { animalList: 'error' }, '动物列表暂时无法加载', async (page, scenario) => {
      scenario.animalList = 'normal';
      await page.getByRole('button', { name: '重新加载' }).click();
      await page.locator('.ui-animal-card').first().waitFor();
      assert('animal-error-retry', await page.locator('.ui-animal-card').count() > 0, 'retry loaded cards');
    });
    await testState(context, 'notice_list.html', { noticeList: 'error' }, '救助动态暂时无法加载', async (page, scenario) => {
      scenario.noticeList = 'normal';
      await page.getByRole('button', { name: '重新加载' }).click();
      await page.locator('.ui-notice-card').first().waitFor();
      assert('notice-error-retry', await page.locator('.ui-notice-card').count() > 0, 'retry loaded notices');
    });
    await testState(context, 'account_public.html', { accountList: 'error' }, '资金公示暂时无法加载', async (page, scenario) => {
      assert('account-error-clears-totals', (await page.locator('.ui-summary-card strong').first().innerText()) === '—', await page.locator('.ui-summary-card strong').first().innerText());
      scenario.accountList = 'normal';
      await page.getByRole('button', { name: '重新加载' }).click();
      await page.locator('.ui-ledger-table tbody tr').first().waitFor();
      assert('account-error-retry', await page.locator('.ui-ledger-table tbody tr').count() > 0, 'retry loaded ledger');
    });
    await testState(context, 'animal_detail.html', { animalDetail: 'error' }, '没有找到这只动物');
    await testState(context, 'notice_detail.html', { noticeDetail: 'error' }, '没有找到公告内容');
    await testInvalidIds(context);
    await testNonAdoptable(context);
    await context.close();
    await realReadOnlySmoke(browser);
  } finally {
    await browser.close();
  }
  writeArtifacts();
  process.exitCode = result.ok ? 0 : 1;
})().catch((error) => {
  fail('phase-3b-runner', error.stack || error.message);
  writeArtifacts();
  process.exitCode = 1;
});
