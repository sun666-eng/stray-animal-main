/**
 * U0/U1 user discovery experience acceptance suite.
 *
 * Runs the production HTML/CSS/JS in Chromium against contract-faithful API
 * fixtures. The server is local and read-only; no real business data is used.
 */
const { chromium } = require('playwright');
const fs = require('fs');
const http = require('http');
const path = require('path');

const root = path.resolve('src/main/resources/static');
const out = path.resolve('.codex-artifacts/user-ui-u1');
const shots = path.join(out, 'screenshots');
fs.mkdirSync(shots, { recursive: true });
for (const file of fs.readdirSync(shots)) {
  if (file.endsWith('.png')) fs.unlinkSync(path.join(shots, file));
}

const report = {
  phase: 'U0/U1',
  strict: true,
  startedAt: new Date().toISOString(),
  checks: [],
  failures: [],
  screenshots: [],
  consoleErrors: [],
  pageErrors: [],
  unexpectedWrites: [],
  fixtureWrites: []
};

function assert(id, condition, detail) {
  const row = { id, ok: !!condition, detail: String(detail || '') };
  report.checks.push(row);
  if (!row.ok) {
    report.failures.push(row);
    console.error('FAIL', id, row.detail);
  }
}

function result(data, msg = '成功') {
  return JSON.stringify({ code: '0', msg, data });
}

function animal(id, overrides) {
  return Object.assign({
    id: String(id),
    tname: id === 10013 ? '小黑' : `动物${id}`,
    ttype: id % 2 ? '狗' : '猫',
    tsex: id % 2 ? '公' : '母',
    tbirthday: '2024-05-01',
    tstate: id === 10015 ? 2 : 0,
    tpic: id === 10013 ? 'real-photo-10013' : '',
    tdescribe: '由真实动物档案字段驱动的介绍，用于验证卡片排版与长文本换行。'
  }, overrides || {});
}

const animals = [animal(10013), animal(10014), animal(10015), animal(10016, { tstate: 1 })];
const favorites = [
  Object.assign({ favorite_id: '501', created_at: '2026-08-08 10:00:00' }, animals[0]),
  Object.assign({ favorite_id: '502', created_at: '2026-08-08 11:00:00' }, animals[2]),
  Object.assign({ favorite_id: '503', created_at: '2026-08-08 12:00:00' }, animals[3])
];
const writes = { favoriteToggle: 0, favoriteDelete: 0, toggleMode: 'false' };

function mime(file) {
  return ({
    '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg'
  })[path.extname(file).toLowerCase()] || 'application/octet-stream';
}

function safeFile(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0]);
  const relative = decoded.replace(/^\/+/, '').replaceAll('/', path.sep);
  const resolved = path.resolve(root, relative);
  return resolved.startsWith(root + path.sep) ? resolved : '';
}

function createServer() {
  return http.createServer((req, res) => {
    const file = safeFile(req.url || '/');
    if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('not found');
      return;
    }
    res.writeHead(200, { 'content-type': mime(file), 'cache-control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  });
}

async function installFixtures(page) {
  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const method = req.method();
    const url = new URL(req.url());
    const pathname = url.pathname;
    const headers = { 'content-type': 'application/json', 'x-u1-fixture': 'true' };
    const fulfill = (data, status = 200) => route.fulfill({ status, headers, body: data });

    if (method === 'GET' && pathname === '/api/user/me') {
      await fulfill(result({ id: '43', username: '121212', name: '121212' })); return;
    }
    if (method === 'GET' && pathname === '/api/dashboard/home-stats') {
      await fulfill(result({ availableAnimals: 4, adoptedAnimals: 17, monthlyRescues: 12, approvedVolunteers: 9 })); return;
    }
    if (method === 'GET' && pathname === '/api/animal/page1') {
      const name = (url.searchParams.get('name') || '').trim();
      const type = (url.searchParams.get('type') || '').trim();
      const filtered = animals.filter((row) => (!name || row.tname.includes(name)) && (!type || row.ttype === type));
      await fulfill(result({ records: filtered, total: filtered.length, pages: 1, current: 1, size: 9 })); return;
    }
    const animalMatch = pathname.match(/^\/api\/animal\/(\d+)$/);
    if (method === 'GET' && animalMatch) {
      await fulfill(result(animals.find((row) => row.id === animalMatch[1]) || null)); return;
    }
    const medicalMatch = pathname.match(/^\/api\/operations\/animals\/(\d+)\/medical$/);
    if (method === 'GET' && medicalMatch) {
      await fulfill(result([{ id: '71', record_type: 'vaccine', record_date: '2026-07-01', title: '基础免疫' }])); return;
    }
    const favMatch = pathname.match(/^\/api\/operations\/favorites\/(\d+)$/);
    if (method === 'GET' && favMatch) {
      await fulfill(result(false)); return;
    }
    if ((method === 'POST' || method === 'DELETE') && favMatch) {
      writes.favoriteToggle += 1;
      report.fixtureWrites.push({ method, pathname });
      await fulfill(writes.toggleMode === 'false' ? result(false, '业务未完成') : result(true)); return;
    }
    if (method === 'GET' && pathname === '/api/operations/favorites') {
      await fulfill(result(favorites)); return;
    }
    if (method === 'DELETE' && favMatch) {
      writes.favoriteDelete += 1;
      report.fixtureWrites.push({ method, pathname });
      await fulfill(result(true)); return;
    }
    if (method === 'GET' && pathname === '/api/files/real-photo-10013') {
      await route.fulfill({
        status: 200,
        headers: { 'content-type': 'image/svg+xml', 'x-u1-fixture': 'true' },
        body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600"><rect width="800" height="600" fill="#d9d6ce"/><circle cx="400" cy="290" r="170" fill="#181a18"/><text x="400" y="535" text-anchor="middle" font-size="52" fill="#fff">REAL TPIC</text></svg>'
      }); return;
    }
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      report.unexpectedWrites.push({ method, pathname });
      await fulfill(JSON.stringify({ code: '599', msg: 'unregistered fixture write', data: null }), 599); return;
    }
    await fulfill(result([]));
  });
}

async function waitReady(page, selector) {
  await page.waitForSelector('[v-cloak]', { state: 'hidden', timeout: 15000 }).catch(() => {});
  await page.waitForSelector(selector, { state: 'visible', timeout: 15000 });
  await page.waitForTimeout(100);
}

async function noOverflow(page, id) {
  const value = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  assert(id, value.sw <= value.cw + 1, JSON.stringify(value));
}

async function screenshot(page, name) {
  const file = path.join(shots, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  report.screenshots.push({ name, file: `screenshots/${name}.png` });
}

async function run() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  report.base = base;
  const browser = await chromium.launch({ headless: true });
  try {
    for (const viewport of [
      { name: '1440', width: 1440, height: 900 },
      { name: '1280', width: 1280, height: 800 },
      { name: '390', width: 390, height: 844 }
    ]) {
      const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
      const page = await context.newPage();
      page.on('console', (message) => {
        if (message.type() === 'error') report.consoleErrors.push({ page: page.url(), text: message.text() });
      });
      page.on('pageerror', (error) => report.pageErrors.push({ page: page.url(), text: error.message }));
      await installFixtures(page);

      await page.goto(`${base}/page/front/index.html`, { waitUntil: 'domcontentloaded' });
      await waitReady(page, '[data-front-surface="discovery-home"] .ui-animal-card');
      assert(`home-${viewport.name}-surface`, await page.locator('[data-front-surface="discovery-home"]').count() === 1, 'surface');
      assert(`home-${viewport.name}-profile-card`, await page.locator('.ui-home-profile-card .ui-home-profile-body').count() === 1, 'profile card');
      assert(`home-${viewport.name}-legacy-overlay-removed`, await page.locator('.ui-home-float').count() === 0, 'legacy overlay absent');
      const heroSrc = await page.locator('.ui-home-photo img').getAttribute('src');
      assert(`home-${viewport.name}-real-tpic`, (heroSrc || '').includes('/api/files/real-photo-10013'), heroSrc);
      const homeMetrics = (await page.locator('.ui-trust-item').allTextContents()).join('|');
      assert(`home-${viewport.name}-metric-count`, await page.locator('.ui-trust-item').count() === 4, 'four metrics');
      assert(`home-${viewport.name}-monthly-rescue`, homeMetrics.includes('本月救助') && homeMetrics.includes('12'), homeMetrics);
      const homeSections = await page.locator('.ui-home-section').allTextContents();
      assert(`home-${viewport.name}-animals-before-services`, homeSections[0].includes('正在等家的它们') && homeSections[1].includes('我的服务'), homeSections.map((text) => text.trim().slice(0, 20)).join('|'));
      await noOverflow(page, `home-${viewport.name}-no-overflow`);
      await screenshot(page, `home-${viewport.name}`);

      await page.goto(`${base}/page/front/animal_browse.html`, { waitUntil: 'domcontentloaded' });
      await waitReady(page, '[data-front-surface="discovery-catalog"] .ui-animal-card');
      assert(`browse-${viewport.name}-count`, await page.locator('.ui-animal-card').count() === 4, `count=${await page.locator('.ui-animal-card').count()}`);
      await noOverflow(page, `browse-${viewport.name}-no-overflow`);
      await screenshot(page, `browse-${viewport.name}`);

      await page.goto(`${base}/page/front/animal_detail.html?id=10013`, { waitUntil: 'domcontentloaded' });
      await waitReady(page, '[data-front-surface="discovery-detail"]');
      await page.waitForSelector('text=小黑', { state: 'visible' });
      assert(`detail-${viewport.name}-path`, await page.locator('.ui-public-adoption-path').count() === 1, 'adoption path');
      assert(`detail-${viewport.name}-real-image`, (await page.locator('.ui-detail-photo img').getAttribute('src') || '').includes('/api/files/real-photo-10013'), await page.locator('.ui-detail-photo img').getAttribute('src'));
      await noOverflow(page, `detail-${viewport.name}-no-overflow`);
      await screenshot(page, `detail-${viewport.name}`);

      await page.goto(`${base}/page/front/favorites.html`, { waitUntil: 'domcontentloaded' });
      await waitReady(page, '[data-front-surface="discovery-favorites"] .favorites-card');
      const summary = (await page.locator('.ui-member-summary').innerText()).replace(/\s+/g, ' ');
      assert(`favorites-${viewport.name}-summary`, /全部收藏\s*3/.test(summary) && /可提交申请\s*2/.test(summary) && /暂不可申请\s*1/.test(summary), summary);
      assert(`favorites-${viewport.name}-active`, await page.locator('.ui-member-sidebar a.is-active[aria-current="page"]').count() === 1, 'active sidebar');
      await noOverflow(page, `favorites-${viewport.name}-no-overflow`);
      await screenshot(page, `favorites-${viewport.name}`);

      await context.close();
    }

    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    await installFixtures(page);
    await page.goto(`${base}/page/front/animal_detail.html?id=10013`, { waitUntil: 'domcontentloaded' });
    await waitReady(page, '[data-front-surface="discovery-detail"]');
    await page.locator('[data-favorite-action]').click();
    await page.waitForTimeout(150);
    assert('detail-data-false-does-not-toggle', await page.locator('[data-favorite-action]').getAttribute('aria-pressed') !== 'true', `writes=${writes.favoriteToggle}`);
    assert('detail-single-write', writes.favoriteToggle === 1, `writes=${writes.favoriteToggle}`);
    await context.close();
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }

  assert('console-errors-zero', report.consoleErrors.length === 0, JSON.stringify(report.consoleErrors));
  assert('page-errors-zero', report.pageErrors.length === 0, JSON.stringify(report.pageErrors));
  assert('unexpected-writes-zero', report.unexpectedWrites.length === 0, JSON.stringify(report.unexpectedWrites));
  assert('screenshots-twelve', report.screenshots.length === 12, `count=${report.screenshots.length}`);
  report.finishedAt = new Date().toISOString();
  report.summary = {
    passed: report.checks.filter((row) => row.ok).length,
    failed: report.failures.length,
    total: report.checks.length,
    screenshots: report.screenshots.length,
    unexpectedWrites: report.unexpectedWrites.length
  };
  fs.writeFileSync(path.join(out, 'user-ui-u1-report.json'), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(out, 'run-strict-final.log'), [
    `USER UI U1 STRICT=${report.strict}`,
    `ASSERTIONS ${report.summary.passed}/${report.summary.failed}/${report.summary.total}`,
    `SCREENSHOTS ${report.summary.screenshots}`,
    `CONSOLE_ERRORS ${report.consoleErrors.length}`,
    `PAGE_ERRORS ${report.pageErrors.length}`,
    `UNEXPECTED_WRITES ${report.unexpectedWrites.length}`
  ].join('\n') + '\n');
  console.log(JSON.stringify(report.summary));
  if (report.failures.length) process.exitCode = 1;
}

run().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
