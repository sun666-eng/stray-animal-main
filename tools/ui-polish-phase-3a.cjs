/**
 * Phase 3A strict audit — front navigation, account entry and mobile shell.
 * Read-only browser flows only. No business write is permitted.
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const startedAt = Date.now();
const base = process.env.BASE_URL || 'http://127.0.0.1:18120';
const out = path.resolve('output/playwright/ui-polish-phase-3a');
const shotDir = path.join(out, 'screenshots');
fs.mkdirSync(shotDir, { recursive: true });
for (const file of fs.readdirSync(shotDir)) {
  if (file.endsWith('.png')) fs.unlinkSync(path.join(shotDir, file));
}

const PAGES = [
  'account_public.html', 'adopt_apply.html', 'adopt_proof.html',
  'animal_browse.html', 'animal_detail.html', 'favorites.html', 'index.html',
  'my_adopt.html', 'my_rescue.html', 'my_visit.html', 'my_volunteer.html',
  'notice_detail.html', 'notice_list.html', 'notifications.html', 'pet_care.html',
  'rescue_apply.html', 'volunteer_apply.html', 'volunteer_tasks.html'
];
const PUBLIC_PAGES = new Set([
  'account_public.html', 'animal_browse.html', 'animal_detail.html',
  'index.html', 'notice_detail.html', 'notice_list.html'
]);
const ADOPTION_PAGES = new Set([
  'adopt_apply.html', 'adopt_proof.html', 'my_adopt.html', 'my_visit.html'
]);
const RESCUE_NOTIFICATION_PAGES = new Set([
  'rescue_apply.html', 'my_rescue.html', 'notifications.html'
]);
// User UI release cache is governed by tools/front-asset-version.txt.
const VOLUNTEER_SERVICE_PAGES = new Set([
  'volunteer_apply.html', 'my_volunteer.html', 'volunteer_tasks.html'
]);
// Phase 3F favorites + pet care workspace pages.
const AUTH_ONBOARDING_PAGES = new Set([
  'login.html', 'register.html'
]);
const FAVORITES_PETCARE_PAGES = new Set([
  'favorites.html', 'pet_care.html'
]);
function expectedProductCache(file) {
  return '20260809u1';
}
const VIEWPORTS = [
  { name: '1440x900', width: 1440, height: 900 },
  { name: '1280x800', width: 1280, height: 800 },
  { name: '768x1024', width: 768, height: 1024 },
  { name: '390x844', width: 390, height: 844 },
  { name: '320x700', width: 320, height: 700 }
];
const EXPECTED_PUBLIC_NAV = ['首页', '等待一个家', '救助动态', '透明公示'];
const EXPECTED_ACCOUNT_GROUPS = ['我的行动', '工具与账户'];
const EXPECTED_ACCOUNT_LINKS = [
  '我的领养', '消息通知', '我的救助', '我的义工', '回访记录', '义工任务',
  '照顾知识助手', '我的收藏', '个人资料'
];

const result = {
  phase: '3A',
  base,
  startedAt: new Date().toISOString(),
  branch: 'ui-polish/phase-3a-front-navigation-shell-20260731',
  baseline: '456b47b712044c51f43e5d29da8985a9b32ca738',
  checks: [],
  failures: [],
  visits: [],
  screenshots: [],
  consoleAudit: [],
  httpAudit: [],
  requestFailedAudit: [],
  writeRequestAudit: [],
  controlledRequests: [],
  roleMatrix: {},
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
  result.controlledRequests.push({ name, detail, at: new Date().toISOString() });
}
function safeName(value) {
  return String(value).replace(/\.html$/, '').replace(/[^a-z0-9_-]+/gi, '-');
}
function pageUrl(file, ids) {
  const query = {
    'animal_detail.html': `?id=${encodeURIComponent(ids.animalId)}`,
    'adopt_apply.html': `?animalId=${encodeURIComponent(ids.animalId)}`,
    'adopt_proof.html': `?aid=${encodeURIComponent(ids.adoptId)}`,
    'notice_detail.html': `?id=${encodeURIComponent(ids.noticeId)}`
  }[file] || '';
  return `${base}/page/front/${file}${query}`;
}
async function login(context, username, password) {
  const response = await context.request.post(`${base}/api/user/login`, {
    data: { username, password }
  });
  const body = await response.json();
  if (response.status() !== 200 || body.code !== '0') {
    throw new Error(`login failed ${username}: ${response.status()} ${JSON.stringify(body)}`);
  }
  return body.data && body.data.user;
}
async function discoverIds(context) {
  const ids = { animalId: 10011, adoptId: 10011, noticeId: 1 };
  try {
    const animalResponse = await context.request.get(`${base}/api/animal/page1?pageNum=1&pageSize=1`);
    const animalBody = await animalResponse.json();
    const animalRecords = animalBody && animalBody.data && animalBody.data.records;
    if (Array.isArray(animalRecords) && animalRecords[0] && animalRecords[0].id) ids.animalId = animalRecords[0].id;
  } catch (error) {
    fail('discover-animal-id', error.message);
  }
  try {
    const adoptResponse = await context.request.get(`${base}/api/adopt/page2?pageNum=1&pageSize=1`);
    const adoptBody = await adoptResponse.json();
    const adoptRecords = adoptBody && adoptBody.data && adoptBody.data.records;
    if (Array.isArray(adoptRecords) && adoptRecords[0] && adoptRecords[0].aid) ids.adoptId = adoptRecords[0].aid;
  } catch (error) {
    fail('discover-adopt-id', error.message);
  }
  try {
    const noticeResponse = await context.request.get(`${base}/api/notice/page?pageNum=1&pageSize=1`);
    const noticeBody = await noticeResponse.json();
    const noticeRecords = noticeBody && noticeBody.data && noticeBody.data.records;
    if (Array.isArray(noticeRecords) && noticeRecords[0] && noticeRecords[0].id) ids.noticeId = noticeRecords[0].id;
  } catch (error) {
    fail('discover-notice-id', error.message);
  }
  probe('discover-read-only-ids', ids);
  return ids;
}
function expectedHttp(row, role, file) {
  if (row.status === 401 && role === 'anonymous' && /\/api\/user\/me(?:[?#]|$)/.test(row.url)) return true;
  if (row.status === 404 && /\/api\/files\/[A-Za-z0-9-]+(?:[?#]|$)/.test(row.url)) return true;
  if (row.status === 404 && /\/favicon\.ico(?:[?#]|$)/.test(row.url)) return true;
  if (row.status === 404 && role === 'jerry' && file === 'adopt_apply.html' && /\/api\/adopt\/mine\/[1-9][0-9]*(?:[?#]|$)/.test(row.url)) return true;
  return false;
}
function consoleExpected(text, httpRows, role, file) {
  const match = String(text).match(/status of (\d+)/i);
  if (!match) return false;
  const status = Number(match[1]);
  return httpRows.some((row) => row.status === status && expectedHttp(row, role, file));
}
async function installReadOnlyGuard(page) {
  await page.route('**/api/petcare/config/test', async (route) => {
    if (route.request().method() === 'POST') {
      probe('petcare-auto-connection-test-fixture', { url: route.request().url(), method: 'POST' });
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ code: '0', msg: '成功', data: { connected: true, connectionStatus: 'ok' } })
      });
      return;
    }
    await route.continue();
  });
}
async function visitPage(context, file, viewport, role, ids) {
  const page = await context.newPage();
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  await installReadOnlyGuard(page);
  const consoleRows = [];
  const pageErrors = [];
  const httpRows = [];
  const requestFailedRows = [];
  const writeRows = [];

  page.on('console', (message) => {
    if (message.type() === 'error') consoleRows.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('response', (response) => {
    if (response.status() >= 400) {
      httpRows.push({
        status: response.status(),
        method: response.request().method(),
        url: response.url()
      });
    }
  });
  page.on('requestfailed', (request) => {
    requestFailedRows.push({
      method: request.method(),
      url: request.url(),
      error: request.failure() && request.failure().errorText
    });
  });
  page.on('request', (request) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
      const row = { method: request.method(), url: request.url(), file, role, viewport: viewport.name };
      writeRows.push(row);
      result.writeRequestAudit.push(row);
    }
  });

  let navigationError = '';
  try {
    await page.goto(pageUrl(file, ids), { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.locator('.ui-front-header').waitFor({ state: 'visible', timeout: 8000 });
    await page.locator('.ui-front-footer').waitFor({ state: 'attached', timeout: 8000 });
    await page.waitForTimeout(420);
  } catch (error) {
    navigationError = error.message;
  }

  const prefix = `visit-${safeName(file)}-${viewport.name}-${role}`;
  assert(`${prefix}-navigation`, !navigationError, navigationError || page.url());
  if (!navigationError) {
    const productCacheVersion = expectedProductCache(file);
    const state = await page.evaluate((productCacheVersion) => {
      const header = document.querySelector('.ui-front-header');
      const footer = document.querySelector('.ui-front-footer');
      const desktopNav = document.querySelector('.ui-front-desktop-nav');
      const mobileToggle = document.querySelector('.ui-front-mobile-toggle');
      const cssResources = performance.getEntriesByType('resource').map((entry) => entry.name);
      const rect = header && header.getBoundingClientRect();
      return {
        headerCount: document.querySelectorAll('.ui-front-header').length,
        footerCount: document.querySelectorAll('.ui-front-footer').length,
        desktopCount: desktopNav ? desktopNav.querySelectorAll('a').length : 0,
        desktopDisplay: desktopNav ? getComputedStyle(desktopNav).display : '',
        mobileDisplay: mobileToggle ? getComputedStyle(mobileToggle).display : '',
        overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        headerInside: !!rect && rect.left >= -1 && rect.right <= innerWidth + 1,
        productCache: cssResources.some((url) => url.includes(`product-ui.css?v=${productCacheVersion}`)),
        shellCache: cssResources.some((url) => /front-shell\.js\?v=20260809u1/.test(url)),
        workspaceCache: cssResources.some((url) => /user-workspace\.js\?v=20260809u1/.test(url)),
        unresolved: document.querySelectorAll('front-site-header, front-site-footer').length,
        mainCount: document.querySelectorAll('main').length
      };
    }, productCacheVersion);
    assert(`${prefix}-shell-singleton`, state.headerCount === 1 && state.footerCount === 1, JSON.stringify(state));
    assert(`${prefix}-compiled`, state.unresolved === 0, `unresolved=${state.unresolved}`);
    assert(`${prefix}-cache`, state.productCache && state.shellCache && state.workspaceCache, JSON.stringify(state));
    assert(`${prefix}-horizontal-overflow`, !state.overflow && state.headerInside, `${state.scrollWidth}/${state.clientWidth}`);
    assert(`${prefix}-main`, state.mainCount === 1, `main=${state.mainCount}`);
    if (viewport.width > 960) {
      assert(`${prefix}-desktop-nav`, state.desktopDisplay !== 'none' && state.desktopCount === 4 && state.mobileDisplay === 'none', JSON.stringify(state));
    } else {
      assert(`${prefix}-mobile-toggle`, state.desktopDisplay === 'none' && state.mobileDisplay !== 'none', JSON.stringify(state));
    }

    if (viewport.name === '390x844') {
      const shotName = `${safeName(file)}-${role}-390`;
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(80);
      await page.screenshot({ path: path.join(shotDir, `${shotName}.png`), fullPage: false });
      result.screenshots.push({ name: shotName, file: `screenshots/${shotName}.png`, viewport: viewport.name, page: file, role });
    }
  }

  const unexpectedHttp = httpRows.filter((row) => !expectedHttp(row, role, file));
  const unexpectedConsole = consoleRows.filter((text) => !consoleExpected(text, httpRows, role, file));
  const unexpectedWrites = writeRows.filter((row) => !/\/api\/petcare\/config\/test(?:[?#]|$)/.test(row.url));
  assert(`${prefix}-pageerror`, pageErrors.length === 0, pageErrors.join(' | '));
  assert(`${prefix}-http`, unexpectedHttp.length === 0, JSON.stringify(unexpectedHttp));
  assert(`${prefix}-console`, unexpectedConsole.length === 0, JSON.stringify(unexpectedConsole));
  assert(`${prefix}-requestfailed`, requestFailedRows.length === 0, JSON.stringify(requestFailedRows));
  assert(`${prefix}-read-only`, unexpectedWrites.length === 0, JSON.stringify(unexpectedWrites));

  result.consoleAudit.push(...consoleRows.map((text) => ({ file, role, viewport: viewport.name, text, expected: consoleExpected(text, httpRows, role, file) })));
  result.httpAudit.push(...httpRows.map((row) => Object.assign({ file, role, viewport: viewport.name, expected: expectedHttp(row, role, file) }, row)));
  result.requestFailedAudit.push(...requestFailedRows.map((row) => Object.assign({ file, role, viewport: viewport.name }, row)));
  result.visits.push({ file, role, viewport: viewport.name, url: page.url(), navigationError });
  await page.close();
}
async function staticAudit() {
  const frontDir = path.resolve('src/main/resources/static/page/front');
  for (const file of PAGES) {
    const html = fs.readFileSync(path.join(frontDir, file), 'utf8');
    const prefix = `static-${safeName(file)}`;
    const beforeMain = html.split(/<main\b/i)[0];
    const afterMain = html.split(/<\/main>/i).slice(1).join('</main>');
    assert(`${prefix}-header`,
      (html.match(/<front-site-header\b/g) || []).length === 1 && !/<header\b/i.test(beforeMain),
      'shared header before main; semantic content headers allowed inside main');
    assert(`${prefix}-footer`,
      (html.match(/<front-site-footer\b/g) || []).length === 1 && !/<footer\b/i.test(afterMain),
      'shared footer after main');
    const productCacheVersion = expectedProductCache(file);
    assert(`${prefix}-css-cache`, new RegExp(`product-ui\\.css\\?v=${productCacheVersion}`).test(html), productCacheVersion);
    assert(`${prefix}-workspace-cache`, (html.match(/user-workspace\.js\?v=20260809u1/g) || []).length === 1, 'workspace');
    assert(`${prefix}-shell-cache`, (html.match(/front-shell\.js\?v=20260809u1/g) || []).length === 1, 'shell');
    assert(`${prefix}-user-binding`, /<front-site-header\s+:user="user"/.test(html) && /\buser\s*:/.test(html), 'reactive user');
  }
  for (const file of ['login.html', 'register.html']) {
    const html = fs.readFileSync(path.join(frontDir, file), 'utf8');
    assert(`static-${safeName(file)}-excluded`, !/front-site-(?:header|footer)/.test(html), 'Phase 3A scope preserved');
  }
  const workspace = fs.readFileSync('src/main/resources/static/js/user-workspace.js', 'utf8');
  const shell = fs.readFileSync('src/main/resources/static/js/front-shell.js', 'utf8');
  const css = fs.readFileSync('src/main/resources/static/css/product-ui.css', 'utf8');
  const ownSource = fs.readFileSync('tools/ui-polish-phase-3a.cjs', 'utf8');
  assert('static-public-nav-four', EXPECTED_PUBLIC_NAV.every((label) => workspace.includes(`label: '${label}'`)), 'four primary links');
  assert('static-account-links', EXPECTED_ACCOUNT_LINKS.every((label) => workspace.includes(`label: '${label}'`)), 'account information architecture');
  assert('static-admin-by-permission', shell.includes('hasAdminAccess(this.user)') && !/username\s*={2,3}\s*['"]admin/.test(shell), 'permission-based');
  assert('static-no-native-dialog', !/(?:window\.)?(?:prompt|alert|confirm)\s*\(/.test(shell), 'no native dialogs');
  assert('static-focus-trap', shell.includes('focusableElements') && shell.includes("event.key !== 'Tab'"), 'keyboard trap');
  assert('static-body-lock', shell.includes('ui-front-drawer-open') && css.includes('body.ui-front-drawer-open'), 'body scroll lock');
  assert('static-drawer-css', css.includes('.ui-front-drawer-scrim') && css.includes('.ui-front-drawer-group'), 'drawer CSS');
  assert('static-warm-editorial', css.includes('#fffefb') && css.includes('backdrop-filter: none'), 'editorial warm paper');
  assert('suite-no-best-effort', !/bestEffort:\s*true|fallback:\s*true|\.skip\s*\(/.test(ownSource), 'strict source');
  assert('suite-no-trivial-assert', !/assert\s*\(\s*['"`][^'"`]+['"`]\s*,\s*true\s*,/.test(ownSource), 'no hard-coded pass');
}
async function interactionAudit(browser, ids) {
  const jerry = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await login(jerry, 'jerry', '123456');
  const desktop = await jerry.newPage();
  await desktop.goto(pageUrl('index.html', ids), { waitUntil: 'domcontentloaded' });
  await desktop.locator('.ui-account-trigger').waitFor({ state: 'visible' });
  await desktop.locator('.ui-account-trigger').click();
  const groupLabels = await desktop.locator('.ui-front-account-group > strong').allTextContents();
  const linkLabels = await desktop.locator('.ui-front-account-menu a').allTextContents();
  assert('interaction-account-groups', EXPECTED_ACCOUNT_GROUPS.every((label) => groupLabels.includes(label)), JSON.stringify(groupLabels));
  assert('interaction-account-links', EXPECTED_ACCOUNT_LINKS.every((label) => linkLabels.includes(label)), JSON.stringify(linkLabels));
  assert('role-jerry-no-admin-desktop', await desktop.locator('.ui-front-account-admin').count() === 0, 'no admin link');
  await desktop.keyboard.press('Escape');
  assert('interaction-account-escape-close', await desktop.locator('.ui-front-account-menu').count() === 0, 'closed');
  assert('interaction-account-focus-restore', await desktop.evaluate(() => document.activeElement === document.querySelector('.ui-account-trigger')), 'trigger focused');
  await desktop.locator('.ui-account-trigger').click();
  await desktop.locator('main').click({ position: { x: 1, y: 1 } });
  assert('interaction-account-outside-close', await desktop.locator('.ui-front-account-menu').count() === 0, 'closed');
  const currentLinks = await desktop.locator('.ui-front-desktop-nav [aria-current="page"]').allTextContents();
  assert('interaction-active-desktop', currentLinks.length === 1 && currentLinks[0] === '首页', JSON.stringify(currentLinks));
  await desktop.locator('.ui-account-trigger').click();
  await desktop.locator('.ui-front-account-menu').waitFor({ state: 'visible' });
  await desktop.screenshot({ path: path.join(shotDir, 'jerry-account-desktop.png'), fullPage: false });
  result.screenshots.push({ name: 'jerry-account-desktop', file: 'screenshots/jerry-account-desktop.png', viewport: '1440x900', page: 'index.html', role: 'jerry' });
  await desktop.close();

  const mobile = await jerry.newPage();
  await mobile.setViewportSize({ width: 390, height: 844 });
  await mobile.goto(pageUrl('index.html', ids), { waitUntil: 'domcontentloaded' });
  await mobile.locator('.ui-front-mobile-toggle').click();
  const drawer = mobile.locator('.ui-front-drawer');
  await drawer.waitFor({ state: 'visible' });
  assert('interaction-mobile-open', await drawer.count() === 1, 'drawer visible');
  assert('interaction-mobile-body-lock', await mobile.locator('body').evaluate((node) => node.classList.contains('ui-front-drawer-open') && getComputedStyle(node).overflow === 'hidden'), 'locked');
  assert('role-jerry-no-admin-mobile', await drawer.locator('a[href="/page/end/index.html"]').count() === 0, 'no admin link');
  const mobileGroups = await drawer.locator('.ui-front-drawer-group > strong').allTextContents();
  assert('interaction-mobile-groups', ['浏览平台', '我的行动', '工具与账户'].every((label) => mobileGroups.includes(label)), JSON.stringify(mobileGroups));
  await mobile.keyboard.press('Shift+Tab');
  assert('interaction-mobile-focus-trap-backward', await mobile.evaluate(() => !!document.activeElement.closest('.ui-front-drawer')), await mobile.evaluate(() => document.activeElement.outerHTML));
  await mobile.keyboard.press('Escape');
  assert('interaction-mobile-escape-close', await drawer.count() === 0, 'closed');
  assert('interaction-mobile-focus-restore', await mobile.evaluate(() => document.activeElement === document.querySelector('.ui-front-mobile-toggle')), 'toggle focused');
  await mobile.locator('.ui-account-trigger').click();
  assert('interaction-mobile-account-open', await mobile.locator('.ui-front-account-menu').count() === 1, 'account open');
  await mobile.locator('.ui-front-mobile-toggle').click();
  assert('interaction-mutual-exclusion', await mobile.locator('.ui-front-account-menu').count() === 0 && await drawer.count() === 1, 'only drawer');
  await mobile.screenshot({ path: path.join(shotDir, 'jerry-mobile-drawer.png'), fullPage: false });
  result.screenshots.push({ name: 'jerry-mobile-drawer', file: 'screenshots/jerry-mobile-drawer.png', viewport: '390x844', page: 'index.html', role: 'jerry' });
  await mobile.setViewportSize({ width: 768, height: 1024 });
  const drawerWidth = await drawer.evaluate((node) => node.getBoundingClientRect().width);
  assert('interaction-tablet-scrim-visible', drawerWidth < 768, `drawerWidth=${drawerWidth}`);
  await mobile.locator('.ui-front-drawer-scrim').click({ position: { x: 4, y: 4 } });
  assert('interaction-mobile-scrim-close', await drawer.count() === 0, 'closed');
  await mobile.close();
  result.roleMatrix.jerry = { loggedIn: true, adminEntry: false, accountGroups: groupLabels };
  await jerry.close();

  const admin = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await login(admin, 'admin', 'admin');
  const adminPage = await admin.newPage();
  await adminPage.goto(pageUrl('index.html', ids), { waitUntil: 'domcontentloaded' });
  await adminPage.locator('.ui-front-mobile-toggle').click();
  const adminLinkCount = await adminPage.locator('.ui-front-drawer a[href="/page/end/index.html"]').count();
  assert('role-admin-mobile-entry', adminLinkCount === 1, `count=${adminLinkCount}`);
  await adminPage.locator('.ui-front-drawer-body').evaluate((node) => { node.scrollTop = node.scrollHeight; });
  await adminPage.waitForTimeout(80);
  await adminPage.screenshot({ path: path.join(shotDir, 'admin-mobile-drawer.png'), fullPage: false });
  result.screenshots.push({ name: 'admin-mobile-drawer', file: 'screenshots/admin-mobile-drawer.png', viewport: '390x844', page: 'index.html', role: 'admin' });
  result.roleMatrix.admin = { loggedIn: true, adminEntry: adminLinkCount === 1 };
  await adminPage.close();
  await admin.close();

  const anonymous = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const anonymousPage = await anonymous.newPage();
  await anonymousPage.goto(pageUrl('index.html', ids), { waitUntil: 'domcontentloaded' });
  assert('role-anonymous-no-account', await anonymousPage.locator('.ui-account-trigger').count() === 0, 'no account trigger');
  assert('role-anonymous-auth-actions', await anonymousPage.locator('.ui-front-auth-actions a').count() === 2, 'login/register');
  await anonymousPage.locator('.ui-front-mobile-toggle').click();
  assert('role-anonymous-mobile-auth', await anonymousPage.locator('.ui-front-drawer-auth a').count() === 2, 'login/register');
  result.roleMatrix.anonymous = { loggedIn: false, loginRegister: true };
  await anonymousPage.close();
  await anonymous.close();
  probe('role-and-interaction-matrix', result.roleMatrix);
}
async function authSmoke(browser) {
  for (const viewport of [VIEWPORTS[0], VIEWPORTS[3]]) {
    for (const file of ['login.html', 'register.html']) {
      const page = await browser.newPage({ viewport });
      const consoleErrors = [];
      const pageErrors = [];
      const httpErrors = [];
      page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
      page.on('pageerror', (error) => pageErrors.push(error.message));
      page.on('response', (response) => {
        if (response.status() >= 400) httpErrors.push({ status: response.status(), url: response.url() });
      });
      await page.goto(`${base}/page/front/${file}`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(100);
      const state = await page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
        form: document.querySelectorAll('form').length,
        shell: document.querySelectorAll('.ui-front-header').length
      }));
      const expectedAuthProbe = httpErrors.length === 1
        && httpErrors[0].status === 401
        && /\/api\/user\/me(?:[?#]|$)/.test(httpErrors[0].url);
      const expectedConsole = consoleErrors.length === 1 && /status of 401/i.test(consoleErrors[0]) && expectedAuthProbe;
      assert(
        `auth-smoke-${safeName(file)}-${viewport.name}`,
        !state.overflow && state.form === 1 && state.shell === 0 && expectedAuthProbe && expectedConsole && pageErrors.length === 0,
        JSON.stringify({ state, consoleErrors, pageErrors, httpErrors })
      );
      await page.close();
    }
  }
}
function writeReports() {
  const passed = result.checks.filter((row) => row.ok).length;
  const failed = result.checks.filter((row) => !row.ok).length;
  const skipped = result.checks.filter((row) => row.skipped).length;
  const bestEffortPassCount = result.checks.filter((row) => row.ok && row.bestEffort).length;
  const fallbackPassCount = result.checks.filter((row) => row.ok && row.fallback).length;
  result.bestEffortPassCount = bestEffortPassCount;
  result.fallbackPassCount = fallbackPassCount;
  result.skippedCount = skipped;
  result.summary = {
    passed,
    failed,
    skipped,
    total: result.checks.length,
    visits: result.visits.length,
    expectedVisits: PAGES.length * VIEWPORTS.length,
    screenshots: result.screenshots.length,
    strictRuntimeProbeCount: result.strictRuntimeProbeCount,
    bestEffortPassCount,
    fallbackPassCount,
    strictMode: failed === 0 && skipped === 0 && bestEffortPassCount === 0 && fallbackPassCount === 0,
    durationMs: Date.now() - startedAt,
    finishedAt: new Date().toISOString()
  };
  result.ok = result.summary.strictMode && result.visits.length === result.summary.expectedVisits;
  fs.writeFileSync(path.join(out, 'phase-3a-report.json'), JSON.stringify(result, null, 2));
  fs.writeFileSync(path.join(out, 'screenshots-index.json'), JSON.stringify(result.screenshots, null, 2));
  const markdown = [
    '# UI Polish Phase 3A 严格验收报告',
    '',
    `- 基线：\`${result.baseline}\``,
    `- 分支：\`${result.branch}\``,
    `- 测试地址：\`${base}\``,
    `- 断言：**${passed} / ${failed} / ${skipped}**（通过 / 失败 / 跳过）`,
    `- 页面矩阵：**${result.visits.length} / ${result.summary.expectedVisits}**`,
    `- 截图：**${result.screenshots.length}**`,
    `- strictMode：**${result.summary.strictMode}**`,
    `- bestEffort / fallback：**${bestEffortPassCount} / ${fallbackPassCount}**`,
    '',
    '## 覆盖范围',
    '',
    `18 个用户端页面 × 5 个视口（${VIEWPORTS.map((item) => item.name).join('、')}），以及登录/注册页双视口冒烟。`,
    '身份矩阵覆盖匿名用户、jerry 普通用户与 admin 管理员；未执行任何业务数据写入。',
    '',
    '## 核心交互',
    '',
    '- 桌面公共导航、账户分组、活动态、外部点击关闭、Escape 与焦点恢复。',
    '- 移动抽屉、遮罩关闭、滚动锁、焦点圈、Escape、互斥弹层与 320px 横向溢出。',
    '- 管理工作台入口按权限出现；普通用户与匿名用户不可见。',
    '',
    '## 错误门禁',
    '',
    `- pageerror：${result.failures.filter((row) => row.id.endsWith('-pageerror')).length} 项失败`,
    `- 未登记 HTTP：${result.httpAudit.filter((row) => !row.expected).length}`,
    `- requestfailed：${result.requestFailedAudit.length}`,
    `- 页面加载业务写请求：${result.writeRequestAudit.filter((row) => !String(row.url).includes('/api/petcare/config/test')).length}`,
    '',
    '## 结论',
    '',
    result.ok ? '**Phase 3A 严格验收通过，可进入人工视觉确认与封存。**' : '**Phase 3A 尚未通过，必须根据 JSON 中 failures 返修后重跑。**',
    '',
    '权威机器结果：`phase-3a-report.json`；截图索引：`screenshots-index.json`。'
  ].join('\n');
  fs.writeFileSync(path.join(out, 'PHASE-3A-REPORT.md'), markdown);
}

(async () => {
  console.log('Phase 3A strict start', base);
  let browser;
  try {
    await staticAudit();
    browser = await chromium.launch({ headless: true });
    const discoveryContext = await browser.newContext();
    await login(discoveryContext, 'jerry', '123456');
    const ids = await discoverIds(discoveryContext);
    await discoveryContext.close();

    for (const viewport of VIEWPORTS) {
      const anonymous = await browser.newContext({ viewport });
      const jerry = await browser.newContext({ viewport });
      await login(jerry, 'jerry', '123456');
      for (const file of PAGES) {
        const role = PUBLIC_PAGES.has(file) ? 'anonymous' : 'jerry';
        const context = role === 'anonymous' ? anonymous : jerry;
        await visitPage(context, file, viewport, role, ids);
      }
      await anonymous.close();
      await jerry.close();
    }
    assert('matrix-exact-90', result.visits.length === PAGES.length * VIEWPORTS.length, `${result.visits.length}/90`);
    await interactionAudit(browser, ids);
    await authSmoke(browser);
  } catch (error) {
    fail('suite-fatal', error && error.stack ? error.stack : String(error));
  } finally {
    if (browser) await browser.close();
    writeReports();
  }
  console.log(JSON.stringify(result.summary));
  if (!result.ok) process.exitCode = 1;
})();
