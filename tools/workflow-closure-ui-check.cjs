const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const base = process.env.BASE_URL || 'http://localhost:9999';
const out = path.resolve('output/playwright/workflow-closure');
fs.mkdirSync(out, { recursive: true });

async function session(browser, username, password, viewport) {
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
    for (const role of [{name:'user',u:'jerry',p:'123456',pages:['/page/front/my_adopt.html','/page/front/notifications.html','/page/front/my_visit.html','/page/front/my_rescue.html']},{name:'admin',u:'admin',p:'admin',pages:['/page/end/adopt.html','/page/end/proof.html','/page/end/help.html']}]) {
      const context = await session(browser, role.u, role.p, viewport);
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
      for (const route of role.pages) {
        errors.length = 0;
        const response = await page.goto(base + route, { waitUntil: 'networkidle' });
        await page.waitForTimeout(250);
        const body = await page.locator('body').innerText();
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        const ok = response && response.status() === 200 && body.trim().length > 50 && errors.length === 0 && overflow <= 2;
        results.push({ role:role.name, viewport:`${viewport.width}x${viewport.height}`, route, ok, status:response&&response.status(), overflow, errors:[...errors] });
        await page.screenshot({ path:path.join(out,`${role.name}-${viewport.width}-${path.basename(route)}.png`), fullPage:true });
      }
      await context.close();
    }
  }
  await browser.close();
  const failed = results.filter(x => !x.ok);
  console.log(JSON.stringify({ total:results.length, failed:failed.length, results }, null, 2));
  process.exit(failed.length ? 1 : 0);
})().catch(error => { console.error(error); process.exit(1); });
