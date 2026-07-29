/**
 * Phase 1B: all 15 admin pages × 3 roles × key viewports nav verification + screenshots.
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const base = process.env.BASE_URL || 'http://127.0.0.1:10092';
const out = path.resolve('output/playwright/ui-polish-phase-1');
fs.mkdirSync(out, { recursive: true });

const VIEWPORTS = [
  { name: '1440x900', width: 1440, height: 900 },
  { name: '1280x800', width: 1280, height: 800 },
  { name: '768x1024', width: 768, height: 1024 },
  { name: '390x844', width: 390, height: 844 },
  { name: '360x800', width: 360, height: 800 }
];

const ADMIN_PAGES = [
  { id: 'index', route: '/page/end/index.html', flag: '', text: '工作台概览', inMore: false },
  { id: 'animal', route: '/page/end/animal.html', flag: 'animal', text: '动物', inMore: false },
  { id: 'adopt', route: '/page/end/adopt.html', flag: 'adopt', text: '领养', inMore: false },
  { id: 'operations', route: '/page/end/operations.html', flag: 'operations', text: '运营', inMore: false },
  { id: 'help', route: '/page/end/help.html', flag: 'help', text: '救助', inMore: false },
  { id: 'admin_agent', route: '/page/end/admin_agent.html', flag: 'admin_agent', text: 'AI', inMore: false },
  { id: 'user', route: '/page/end/user.html', flag: 'user', text: '用户', inMore: true },
  { id: 'role', route: '/page/end/role.html', flag: 'role', text: '角色', inMore: true },
  { id: 'permission', route: '/page/end/permission.html', flag: 'permission', text: '权限', inMore: true },
  { id: 'proof', route: '/page/end/proof.html', flag: 'proof', text: '凭证', inMore: true },
  { id: 'visit', route: '/page/end/visit.html', flag: 'visit', text: '回访', inMore: true },
  { id: 'volunteer', route: '/page/end/volunteer.html', flag: 'volunteer', text: '义工', inMore: true },
  { id: 'account', route: '/page/end/account.html', flag: 'account', text: '资金', inMore: true },
  { id: 'notice', route: '/page/end/notice.html', flag: 'notice', text: '公告', inMore: true },
  { id: 'person', route: '/page/end/person.html', flag: 'person', text: '个人资料', inMore: false, overview: false }
];

const PARTIAL_FLAGS = ['animal', 'adopt', 'help'];

async function login(context, username, password) {
  const response = await context.request.post(base + '/api/user/login', {
    data: { username, password }
  });
  const json = await response.json();
  if (json.code !== '0') throw new Error(`login ${username}: ${JSON.stringify(json)}`);
  const user = json.data && json.data.user ? json.data.user : (json.data || {});
  const csrfToken = (json.data && json.data.csrfToken) || '';
  return { user, csrfToken };
}

async function measure(page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const overflow = doc.scrollWidth - doc.clientWidth;
    const links = [...document.querySelectorAll('.admin-desktop-nav > a, .admin-nav-more-menu a, .admin-mobile-nav a')];
    const labels = links.map((a) => (a.textContent || '').replace(/\s+/g, ' ').trim()).filter(Boolean);
    const active = [...document.querySelectorAll('.admin-desktop-nav a.is-active, .admin-nav-more-menu a.is-active, .admin-mobile-nav a.is-active, .admin-mobile-nav a[aria-current=page]')]
      .map((a) => (a.textContent || '').replace(/\s+/g, ' ').trim());
    const moreCurrent = !!document.querySelector('.admin-nav-more-trigger.is-current');
    const moreOpen = !!document.querySelector('.admin-nav-more-menu:not([hidden])');
    const mobileOpen = !!document.querySelector('.admin-mobile-nav.is-open');
    const primaryCount = document.querySelectorAll('.admin-desktop-nav > a').length;
    const moreCount = document.querySelectorAll('.admin-nav-more-menu a').length;
    const groupCount = document.querySelectorAll('.admin-mobile-nav strong').length;
    const touchBad = [...document.querySelectorAll('.admin-mobile-nav.is-open a, .admin-nav-more-menu a, .ui-mobile-toggle, .admin-nav-more-trigger')]
      .map((el) => {
        const r = el.getBoundingClientRect();
        return { h: Math.round(r.height), w: Math.round(r.width), t: (el.textContent || '').trim().slice(0, 12) };
      })
      .filter((x) => x.h > 0 && x.h < 44);
    const brandBox = document.querySelector('.ui-brand');
    const navBox = document.querySelector('.admin-desktop-nav');
    const actionsBox = document.querySelector('.ui-header-actions');
    const squeeze = (() => {
      if (!brandBox || !navBox || !actionsBox) return null;
      const b = brandBox.getBoundingClientRect();
      const n = navBox.getBoundingClientRect();
      const a = actionsBox.getBoundingClientRect();
      return {
        brandRight: Math.round(b.right),
        navLeft: Math.round(n.left),
        navRight: Math.round(n.right),
        actionsLeft: Math.round(a.left),
        overlapBrandNav: b.right > n.left + 2,
        overlapNavActions: n.right > a.left + 2
      };
    })();
    return { overflow, labels, active, moreCurrent, moreOpen, mobileOpen, primaryCount, moreCount, groupCount, touchBad, squeeze };
  });
}

async function applyPartialNav(page) {
  await page.waitForFunction(() => window.AdminWorkspace && document.querySelector('#workspace') && document.querySelector('#workspace').__vue__);
  await page.evaluate((flags) => {
    const perms = flags.map((flag) => ({ flag }));
    const vm = document.querySelector('#workspace').__vue__;
    vm.menuItems = AdminWorkspace.navigation(perms);
    vm.menuGroups = AdminWorkspace.navigationGroups(perms);
    vm.desktopNav = AdminWorkspace.desktopNavigation(perms);
  }, PARTIAL_FLAGS);
  await page.waitForTimeout(150);
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const report = {
    phase: '1B',
    base,
    matrix: [],
    roles: {},
    interactions: [],
    failed: []
  };

  // ---- Role: admin full matrix (all pages × all viewports for coverage summary; heavy shots on selected) ----
  for (const vp of VIEWPORTS) {
    const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
    await login(context, 'admin', 'admin'); // cookies only
    const page = await context.newPage();
    const consoleErrors = [];
    page.on('pageerror', (e) => consoleErrors.push(e.message));
    // 业务页缺失历史图片 404 不计入导航失败；仅保留脚本/样式类错误
    page.on('console', (m) => {
      if (m.type() !== 'error') return;
      const t = m.text() || '';
      if (/Failed to load resource:.*404/.test(t)) return;
      if (/net::ERR_/.test(t) && /\/api\/files\//.test(t)) return;
      consoleErrors.push(t);
    });

    for (const spec of ADMIN_PAGES) {
      const row = {
        role: 'admin',
        page: spec.id,
        viewport: vp.name,
        ok: false,
        status: 0,
        hasText: false,
        overflow: 0,
        activeOk: false,
        moreCurrentOk: true,
        mobileOk: true,
        touchOk: true,
        squeezeOk: true,
        errors: []
      };
      try {
        const res = await page.goto(base + spec.route, { waitUntil: 'networkidle', timeout: 45000 });
        row.status = res ? res.status() : 0;
        await page.waitForTimeout(400);
        // wait vue
        await page.waitForFunction(() => {
          const el = document.querySelector('#workspace');
          return el && el.__vue__ && el.__vue__.desktopNav;
        }, { timeout: 15000 }).catch(() => {});

        const body = await page.locator('body').innerText();
        row.hasText = body.includes(spec.text) || body.length > 40;
        let geo = await measure(page);

        // highlight checks desktop
        if (vp.width >= 961) {
          if (spec.flag && spec.flag !== 'person') {
            if (spec.inMore) {
              row.moreCurrentOk = geo.moreCurrent === true;
              await page.locator('.admin-nav-more-trigger').click({ timeout: 3000 }).catch(() => {});
              await page.waitForTimeout(150);
              geo = await measure(page);
              const activeInMore = geo.active.some((t) => t.includes(spec.text) || (spec.flag === 'admin_agent' && t.includes('AI')));
              // map short labels
              const flagLabelHints = {
                user: '用户', role: '角色', permission: '权限', proof: '凭证', visit: '回访',
                volunteer: '义工', account: '资金', notice: '公告'
              };
              const hint = flagLabelHints[spec.flag] || spec.text;
              row.activeOk = geo.active.some((t) => t.includes(hint));
              // close more via Escape
              await page.keyboard.press('Escape');
              await page.waitForTimeout(100);
            } else {
              const hints = {
                animal: '档案', adopt: '领养', operations: '运营', help: '救助', admin_agent: 'AI'
              };
              const hint = hints[spec.flag] || spec.text;
              row.activeOk = geo.active.some((t) => t.includes(hint));
              row.moreCurrentOk = geo.moreCurrent === false;
            }
          } else if (spec.id === 'index') {
            row.activeOk = geo.active.some((t) => t.includes('概览'));
          } else if (spec.id === 'person') {
            row.activeOk = !geo.active.some((t) => t.includes('概览')) || geo.primaryCount >= 0;
            // person should not mark overview active
            const overviewActive = await page.locator('.admin-desktop-nav > a.is-active').first().textContent().catch(() => '');
            row.activeOk = !(overviewActive || '').includes('概览');
          }
        } else {
          // mobile
          const toggle = page.locator('.ui-mobile-toggle').first();
          if (await toggle.count()) {
            await toggle.click();
            await page.waitForTimeout(200);
            geo = await measure(page);
            row.mobileOk = geo.mobileOpen === true && geo.groupCount >= 1;
            row.touchOk = geo.touchBad.length === 0;
            if (spec.flag && spec.flag !== 'person') {
              const hints = {
                animal: '动物', adopt: '领养', operations: '运营', help: '救助', admin_agent: 'AI',
                user: '用户', role: '角色', permission: '权限', proof: '凭证', visit: '回访',
                volunteer: '义工', account: '资金', notice: '公告'
              };
              const hint = hints[spec.flag] || spec.text;
              row.activeOk = geo.active.some((t) => t.includes(hint));
            } else {
              row.activeOk = true;
            }
            // exclusive: open account should close mobile
            await page.locator('.admin-account-trigger').click().catch(() => {});
            await page.waitForTimeout(120);
            const after = await measure(page);
            if (after.mobileOpen && after.moreOpen) {
              row.errors.push('menus not exclusive');
            }
            await page.keyboard.press('Escape');
            await page.waitForTimeout(80);
          }
        }

        row.overflow = geo.overflow;
        if (geo.squeeze && vp.width >= 1280 && vp.width <= 1366) {
          row.squeezeOk = !geo.squeeze.overlapBrandNav && !geo.squeeze.overlapNavActions;
        }
        row.errors = row.errors.concat(consoleErrors.splice(0));
        row.ok = row.status === 200 && row.hasText && row.overflow <= 4 && row.activeOk && row.moreCurrentOk && row.mobileOk && row.touchOk && row.squeezeOk && row.errors.length === 0;

        // representative screenshots
        const shotKey = `${spec.id}-${vp.name}`;
        if (['index', 'animal', 'user', 'person', 'operations', 'admin_agent'].includes(spec.id) || vp.name === '390x844') {
          await page.screenshot({ path: path.join(out, `1b-${shotKey}.png`), fullPage: false });
        }
        if (vp.width >= 961 && spec.inMore && spec.id === 'user') {
          await page.locator('.admin-nav-more-trigger').click().catch(() => {});
          await page.waitForTimeout(150);
          await page.screenshot({ path: path.join(out, `1b-${shotKey}-more.png`), fullPage: false });
          await page.keyboard.press('Escape');
        }
        if (vp.width < 961 && spec.id === 'animal') {
          await page.locator('.ui-mobile-toggle').click().catch(() => {});
          await page.waitForTimeout(150);
          await page.screenshot({ path: path.join(out, `1b-${shotKey}-mobile-open.png`), fullPage: false });
          await page.keyboard.press('Escape');
        }
      } catch (e) {
        row.errors.push(String(e));
        row.ok = false;
        await page.screenshot({ path: path.join(out, `1b-${spec.id}-${vp.name}-error.png`), fullPage: false }).catch(() => {});
      }
      report.matrix.push(row);
      if (!row.ok) report.failed.push(row);
      consoleErrors.length = 0;
    }
    await context.close();
  }

  // ---- Interaction deep check on index (admin, 1440) ----
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await login(context, 'admin', 'admin');
    const page = await context.newPage();
    await page.goto(base + '/page/end/index.html', { waitUntil: 'networkidle' });
    await page.waitForTimeout(400);
    const steps = [];
    // focus helper
    // Tab to more, Enter open
    await page.locator('.admin-nav-more-trigger').focus();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(120);
    let geo = await measure(page);
    steps.push({ name: 'Enter opens more', ok: geo.moreOpen });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);
    geo = await measure(page);
    steps.push({ name: 'Escape closes more', ok: !geo.moreOpen });
    // Space toggle
    await page.locator('.admin-nav-more-trigger').focus();
    await page.keyboard.press('Space');
    await page.waitForTimeout(120);
    geo = await measure(page);
    steps.push({ name: 'Space opens more', ok: geo.moreOpen });
    // outside click
    await page.locator('main').click({ position: { x: 20, y: 20 } });
    await page.waitForTimeout(100);
    geo = await measure(page);
    steps.push({ name: 'outside click closes more', ok: !geo.moreOpen });
    // exclusive more vs account
    await page.locator('.admin-nav-more-trigger').click();
    await page.locator('.admin-account-trigger').click();
    await page.waitForTimeout(100);
    geo = await measure(page);
    const accountOpen = await page.locator('#adminAccountMenu').isVisible().catch(() => false);
    steps.push({ name: 'account/more exclusive', ok: !geo.moreOpen && accountOpen });
    // long menu scroll exists
    const moreScroll = await page.evaluate(() => {
      const el = document.querySelector('.admin-nav-more-menu');
      if (!el) return false;
      const style = getComputedStyle(el);
      return style.maxHeight !== 'none' && (style.overflowY === 'auto' || style.overflowY === 'scroll');
    });
    steps.push({ name: 'more menu scrollable style', ok: moreScroll });
    report.interactions = steps;
    await page.screenshot({ path: path.join(out, '1b-interaction-account-open.png'), fullPage: false });
    await context.close();
  }

  // ---- Partial admin SIMULATED (frontend filter only; not a real session) ----
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await login(context, 'admin', 'admin');
    const page = await context.newPage();
    await page.goto(base + '/page/end/animal.html', { waitUntil: 'networkidle' });
    await applyPartialNav(page);
    const geo = await measure(page);
    const labels = geo.labels.join('|');
    const onlyAllowed = !/用户管理|角色管理|权限管理|凭证|回访|义工|资金|公告|AI/.test(labels.replace(/\s/g, ''));
    const hasAnimal = labels.includes('档案') || labels.includes('动物');
    const hasAdopt = labels.includes('领养');
    const hasHelp = labels.includes('救助');
    const partialOk = hasAnimal && hasAdopt && hasHelp && geo.primaryCount <= 5;
    report.roles.partialSimulated = {
      type: 'frontend-data-simulation',
      ok: partialOk,
      labels: geo.labels,
      primaryCount: geo.primaryCount,
      moreCount: geo.moreCount,
      onlyAllowedHint: onlyAllowed,
      note: 'Patches Vue menuItems after admin login; proves AdminWorkspace filter only, not real RBAC session.'
    };
    await page.screenshot({ path: path.join(out, '1b-partial-sim-animal-1440.png'), fullPage: false });
    await context.close();
  }

  // ---- Partial admin REAL session (tom) ----
  // tom flags observed via login API: animal, adopt, proof, visit, volunteer, account, notice
  // (operations is synthesized client-side from those flags; user/role/permission/help/admin_agent absent)
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const { user, csrfToken } = await login(context, 'tom', '123456');
    const flags = Array.isArray(user.permission) ? user.permission.map((p) => p.flag) : [];
    const page = await context.newPage();
    const checks = [];

    await page.goto(base + '/page/end/animal.html', { waitUntil: 'networkidle' });
    await page.waitForFunction(() => {
      const el = document.querySelector('#workspace');
      return el && el.__vue__ && el.__vue__.desktopNav;
    }, { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(300);
    let geo = await measure(page);
    const joined = geo.labels.join(' | ');
    const forbiddenLabels = ['用户管理', '角色管理', '权限管理', '救助咨询', 'AI 管理助手', 'AI管理助手'];
    const hasForbidden = forbiddenLabels.some((t) => joined.includes(t));
    const hasAllowed = ['档案', '动物', '领养', '运营'].some((t) => joined.includes(t));
    checks.push({ name: 'desktop nav only authorized', ok: hasAllowed && !hasForbidden, labels: geo.labels });

    // open 更多 and ensure forbidden not present
    if (await page.locator('.admin-nav-more-trigger').count()) {
      await page.locator('.admin-nav-more-trigger').click();
      await page.waitForTimeout(150);
      geo = await measure(page);
      const moreText = (await page.locator('.admin-nav-more-menu').innerText().catch(() => '')) || '';
      const moreForbidden = forbiddenLabels.some((t) => moreText.includes(t));
      checks.push({ name: 'more menu no unauthorized', ok: !moreForbidden, moreText: moreText.slice(0, 200) });
      await page.keyboard.press('Escape');
    } else {
      checks.push({ name: 'more menu no unauthorized', ok: true, note: 'no more menu (all primary)' });
    }

    // mobile groups
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(base + '/page/end/animal.html', { waitUntil: 'networkidle' });
    await page.waitForTimeout(300);
    await page.locator('.ui-mobile-toggle').click();
    await page.waitForTimeout(200);
    const mobileText = (await page.locator('.admin-mobile-nav.is-open').innerText().catch(() => '')) || '';
    const mobileForbidden = forbiddenLabels.some((t) => mobileText.includes(t));
    checks.push({ name: 'mobile groups no unauthorized', ok: !mobileForbidden && /动物|领养|档案/.test(mobileText), mobileSample: mobileText.slice(0, 180) });
    await page.screenshot({ path: path.join(out, '1b-partial-real-tom-390-mobile.png'), fullPage: false });

    // forbidden page redirect
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(base + '/page/end/user.html', { waitUntil: 'networkidle' });
    await page.waitForTimeout(400);
    const forbiddenUrl = page.url();
    const forbiddenBody = await page.locator('body').innerText();
    const pageDenied = /index\.html|error=|forbidden|need_admin|无权|没有权限|工作台概览/.test(forbiddenUrl + forbiddenBody)
      && !/新增用户/.test(forbiddenBody);
    checks.push({ name: 'forbidden page denied', ok: pageDenied, url: forbiddenUrl });

    // allowed page works
    await page.goto(base + '/page/end/adopt.html', { waitUntil: 'networkidle' });
    await page.waitForTimeout(400);
    const adoptBody = await page.locator('body').innerText();
    checks.push({ name: 'allowed page works', ok: /领养/.test(adoptBody) && !/login\.html/.test(page.url()), url: page.url() });
    await page.screenshot({ path: path.join(out, '1b-partial-real-tom-1440-animal.png'), fullPage: false });

    // API: allowed 200, forbidden 403
    const apiAnimal = await context.request.get(base + '/api/animal/page?pageNum=1&pageSize=5');
    const apiUser = await context.request.get(base + '/api/user/page?pageNum=1&pageSize=5');
    checks.push({ name: 'allowed API 200', ok: apiAnimal.status() === 200, status: apiAnimal.status() });
    checks.push({ name: 'forbidden API 403', ok: apiUser.status() === 403, status: apiUser.status() });

    // logout then unauthenticated
    const logoutRes = await context.request.post(base + '/api/user/logout', {
      headers: csrfToken ? { 'X-CSRF-Token': csrfToken } : {},
      data: {}
    });
    const afterLogout = await context.request.get(base + '/api/animal/page?pageNum=1&pageSize=5');
    const afterPage = await page.goto(base + '/page/end/animal.html', { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    const afterUrl = page.url();
    const logoutOk = afterLogout.status() === 401
      || /login\.html/.test(afterUrl)
      || /login\.html|error=/.test(afterUrl)
      || (afterPage && [302, 401].includes(afterPage.status()));
    checks.push({
      name: 'logout then 401 or login redirect',
      ok: logoutOk,
      logoutStatus: logoutRes.status(),
      apiStatus: afterLogout.status(),
      url: afterUrl
    });

    const realOk = checks.every((c) => c.ok);
    report.roles.partialReal = {
      type: 'real-account-e2e',
      account: 'tom',
      loginFlags: flags,
      ok: realOk,
      checks
    };
    // backward-compatible alias used by summary
    report.roles.partial = report.roles.partialReal;
    await context.close();
  }

  // ---- Normal user jerry: no admin menu items on person/index ----
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await login(context, 'jerry', '123456'); // cookies only
    const page = await context.newPage();
    await page.goto(base + '/page/end/person.html', { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    const geo = await measure(page);
    // jerry may be redirected or see empty menu
    const body = await page.locator('body').innerText();
    const hasAdminLinks = geo.labels.some((t) => /用户管理|角色管理|权限管理|动物档案|领养审核/.test(t));
    const forbidden = await page.goto(base + '/page/end/user.html', { waitUntil: 'networkidle' }).then(async (res) => {
      await page.waitForTimeout(400);
      const url = page.url();
      const text = await page.locator('body').innerText();
      return {
        status: res && res.status(),
        redirected: /index\.html|login\.html|forbidden/.test(url) || /无权|没有权限|forbidden|工作台概览/.test(text),
        url,
        hasUserCrud: /新增用户|用户治理/.test(text) && /查询/.test(text)
      };
    });
    report.roles.user = {
      ok: !hasAdminLinks || geo.primaryCount <= 1,
      labels: geo.labels,
      personBodySample: body.slice(0, 80),
      forbiddenAccess: forbidden
    };
    await page.screenshot({ path: path.join(out, '1b-user-person-1440.png'), fullPage: false });
    await context.close();
  }

  // ---- admin role summary ----
  report.roles.admin = {
    total: report.matrix.filter((r) => r.role === 'admin').length,
    failed: report.matrix.filter((r) => r.role === 'admin' && !r.ok).length,
    pagesCovered: [...new Set(report.matrix.filter((r) => r.role === 'admin').map((r) => r.page))].sort()
  };

  const interactionFail = report.interactions.filter((s) => !s.ok).length;
  const summary = {
    matrixTotal: report.matrix.length,
    matrixFailed: report.failed.length,
    interactionFail,
    partialSimulatedOk: !!(report.roles.partialSimulated && report.roles.partialSimulated.ok),
    partialRealOk: !!(report.roles.partialReal && report.roles.partialReal.ok),
    partialOk: !!(report.roles.partialReal && report.roles.partialReal.ok),
    userOk: report.roles.user && report.roles.user.ok
  };
  report.summary = summary;
  fs.writeFileSync(path.join(out, 'phase-1b-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({
    summary,
    failedSample: report.failed.slice(0, 8),
    interactions: report.interactions,
    roles: {
      admin: report.roles.admin,
      user: report.roles.user,
      partialSimulated: report.roles.partialSimulated,
      partialReal: report.roles.partialReal
    }
  }, null, 2));
  const hardFail = summary.matrixFailed > 0 || interactionFail > 0 || !summary.partialRealOk || !summary.userOk;
  process.exit(hardFail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
