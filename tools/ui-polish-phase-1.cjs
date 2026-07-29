const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const base = process.env.BASE_URL || 'http://127.0.0.1:10091';
const out = path.resolve('output/playwright/ui-polish-phase-1');
fs.mkdirSync(out, { recursive: true });

const viewports = [
  { name: '1440x900', width: 1440, height: 900 },
  { name: '1280x800', width: 1280, height: 800 },
  { name: '768x1024', width: 768, height: 1024 },
  { name: '390x844', width: 390, height: 844 },
  { name: '360x800', width: 360, height: 800 }
];

const pages = [
  { id: 'index', route: '/page/end/index.html', text: '工作台概览', openMobile: true, openMore: true },
  { id: 'operations', route: '/page/end/operations.html', text: '统一运营中心', openMobile: true, openMore: true },
  { id: 'role', route: '/page/end/role.html', text: '角色治理', openMobile: true, openMore: true },
  { id: 'permission', route: '/page/end/permission.html', text: '权限治理', openMobile: true, openMore: false },
  { id: 'front-home', route: '/page/front/index.html', text: '归途计划', openMobile: true, openMore: false, public: true }
];

async function login(browser, viewport) {
  const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
  const response = await context.request.post(base + '/api/user/login', {
    data: { username: 'admin', password: 'admin' }
  });
  const json = await response.json();
  if (json.code !== '0') throw new Error('login failed: ' + JSON.stringify(json));
  return context;
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const results = [];

  for (const vp of viewports) {
    const context = await login(browser, vp);
    const page = await context.newPage();
    const consoleErrors = [];
    page.on('pageerror', e => consoleErrors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });

    for (const spec of pages) {
      const errors = [];
      const shotBase = `${spec.id}-${vp.name}`;
      try {
        const res = await page.goto(base + spec.route, { waitUntil: 'networkidle', timeout: 30000 });
        await page.waitForTimeout(500);
        const body = await page.locator('body').innerText();
        const hasText = body.includes(spec.text);
        const geometry = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
        }));

        // Desktop checks
        let desktopMoreVisible = false;
        let primaryCount = 0;
        if (vp.width >= 961) {
          desktopMoreVisible = await page.locator('.admin-nav-more-trigger').count() > 0;
          primaryCount = await page.locator('.admin-desktop-nav > a').count();
          if (spec.openMore && desktopMoreVisible) {
            await page.locator('.admin-nav-more-trigger').click();
            await page.waitForTimeout(200);
            await page.screenshot({ path: path.join(out, `${shotBase}-more-open.png`), fullPage: false });
            await page.keyboard.press('Escape');
            await page.waitForTimeout(150);
          }
        }

        await page.screenshot({ path: path.join(out, `${shotBase}.png`), fullPage: false });

        // Mobile nav open
        let mobileOpenOk = false;
        let groupCount = 0;
        let touchOk = true;
        if (vp.width <= 960 && spec.openMobile) {
          const toggle = page.locator('.ui-mobile-toggle').first();
          if (await toggle.count()) {
            await toggle.click();
            await page.waitForTimeout(250);
            const mobileNav = page.locator('.ui-mobile-nav.is-open, .admin-mobile-nav.is-open').first();
            mobileOpenOk = await mobileNav.count() > 0;
            if (mobileOpenOk) {
              groupCount = await page.locator('.admin-mobile-nav.is-open strong, .ui-mobile-nav.is-open strong').count();
              const sizes = await page.evaluate(() => {
                const links = [...document.querySelectorAll('.ui-mobile-nav.is-open a, .admin-mobile-nav.is-open a')];
                return links.slice(0, 8).map(a => {
                  const r = a.getBoundingClientRect();
                  return { h: Math.round(r.height), w: Math.round(r.width), text: (a.textContent || '').trim().slice(0, 20) };
                });
              });
              touchOk = sizes.every(s => s.h >= 44);
              await page.screenshot({ path: path.join(out, `${shotBase}-mobile-open.png`), fullPage: false });
              // close
              await toggle.click().catch(() => {});
            }
          }
        }

        const ok = !!res && res.status() === 200 && hasText && geometry.overflow <= 4;
        results.push({
          page: spec.id, viewport: vp.name, status: res && res.status(), hasText, ok,
          overflow: geometry.overflow, desktopMoreVisible, primaryCount,
          mobileOpenOk, groupCount, touchOk,
          errors: consoleErrors.slice(), consoleErrorCount: consoleErrors.length
        });
        consoleErrors.length = 0;
      } catch (e) {
        results.push({ page: spec.id, viewport: vp.name, ok: false, error: String(e) });
        await page.screenshot({ path: path.join(out, `${shotBase}-error.png`), fullPage: false }).catch(() => {});
      }
    }
    await context.close();
  }

  await browser.close();
  const report = {
    phase: 1,
    base,
    total: results.length,
    failed: results.filter(r => !r.ok).length,
    results
  };
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.failed ? 1 : 0);
})().catch(err => {
  console.error(err);
  process.exit(1);
});
