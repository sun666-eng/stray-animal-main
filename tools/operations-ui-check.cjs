const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const base = process.env.BASE_URL || 'http://localhost:9999';
const out = path.resolve('output/playwright/operations-p1-p2');
fs.mkdirSync(out, { recursive: true });

async function login(browser, username, password, viewport) {
  const context = await browser.newContext({ viewport });
  const response = await context.request.post(base + '/api/user/login', { data: { username, password } });
  const json = await response.json();
  if (json.code !== '0') throw new Error(`login ${username}: ${json.msg}`);
  return context;
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const results = [];
  for (const viewport of [{ width: 1366, height: 768 }, { width: 390, height: 844 }]) {
    for (const spec of [
      { role: 'admin', user: 'admin', pass: 'admin', pages: [
        { route: '/page/end/operations.html', text: '统一运营中心' },
        { route: '/page/end/account.html', text: '资金公示' }
      ]},
      { role: 'user', user: 'jerry', pass: '123456', pages: [
        { route: '/page/front/volunteer_tasks.html', text: '一起把善意落到现场' },
        { route: '/page/front/favorites.html', text: '我的收藏' },
        { route: '/page/front/animal_detail.html?id=10011', text: '健康与医疗记录' }
      ]}
    ]) {
      const context = await login(browser, spec.user, spec.pass, viewport);
      const page = await context.newPage();
      for (const item of spec.pages) {
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
        const response = await page.goto(base + item.route, { waitUntil: 'networkidle' });
        await page.waitForTimeout(350);
        const body = await page.locator('body').innerText();
        const featureChecks = [];
        if (item.route === '/page/end/operations.html') {
          const medicalTab = page.getByRole('button', { name: '医疗档案', exact: true });
          await medicalTab.click();
          featureChecks.push({
            name: 'medical attachment control',
            ok: await page.locator('input[type=file][accept*="application/pdf"]').count() === 1
          });
          featureChecks.push({
            name: 'single dashboard request contract',
            ok: await page.locator('body').innerText().then(text => text.includes('动物医疗档案'))
          });
        }
        if (item.route === '/page/end/account.html') {
          const detailButton = page.getByRole('button', { name: /详情/ }).first();
          if (await detailButton.count()) {
            await detailButton.click();
            featureChecks.push({
              name: 'receipt detail surface',
              ok: await page.getByText('票据附件', { exact: true }).count() === 1
            });
          }
        }
        const geometry = await page.evaluate(() => ({
          horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          visibleDialogs: [...document.querySelectorAll('[role=dialog]')].filter(x => getComputedStyle(x).display !== 'none').length
        }));
        const ok = !!response && response.status() === 200 && body.includes(item.text)
          && errors.length === 0 && geometry.horizontalOverflow <= 2
          && featureChecks.every(check => check.ok);
        const slug = path.basename(item.route.split('?')[0], '.html');
        await page.screenshot({ path: path.join(out, `${spec.role}-${viewport.width}-${slug}.png`), fullPage: true });
        results.push({ role: spec.role, viewport: `${viewport.width}x${viewport.height}`, route: item.route,
          status: response && response.status(), expectedText: body.includes(item.text), errors,
          featureChecks, ...geometry, ok });
      }
      await context.close();
    }
  }
  await browser.close();
  const failed = results.filter(item => !item.ok);
  console.log(JSON.stringify({ total: results.length, failed: failed.length, results }, null, 2));
  process.exit(failed.length ? 1 : 0);
})().catch(error => { console.error(error); process.exit(1); });
