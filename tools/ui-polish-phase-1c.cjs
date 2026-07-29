/**
 * Phase 1C strict verification — no best-effort PASS.
 * 15 admin pages × 6 viewports + icon/a11y/permission/loading/danger-confirm.
 *
 * Env:
 *   BASE_URL   default http://127.0.0.1:10097
 *   ADMIN_USER / ADMIN_PASS default admin/admin
 *   TOM_USER / TOM_PASS default tom/123456
 *   JERRY_USER / JERRY_PASS default jerry/123456
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const base = process.env.BASE_URL || 'http://127.0.0.1:10097';
const out = path.resolve('output/playwright/ui-polish-phase-1c');
const shotDir = path.join(out, 'screenshots');
fs.mkdirSync(shotDir, { recursive: true });

const VIEWPORTS = [
  { name: '1440x900', width: 1440, height: 900 },
  { name: '1280x800', width: 1280, height: 800 },
  { name: '1024x768', width: 1024, height: 768 },
  { name: '768x1024', width: 768, height: 1024 },
  { name: '390x844', width: 390, height: 844 },
  { name: '360x800', width: 360, height: 800 }
];

const ADMIN_PAGES = [
  'account', 'admin_agent', 'adopt', 'animal', 'help', 'index', 'notice',
  'operations', 'permission', 'person', 'proof', 'role', 'user', 'visit', 'volunteer'
];

const REQUIRED_SYMBOLS = [
  'icon-menu', 'icon-close', 'icon-chevron-down', 'icon-chevron-left', 'icon-more-horizontal',
  'icon-search', 'icon-plus', 'icon-edit', 'icon-trash', 'icon-eye', 'icon-save', 'icon-check',
  'icon-x-circle', 'icon-alert-triangle', 'icon-refresh', 'icon-download', 'icon-upload',
  'icon-history', 'icon-settings', 'icon-bot', 'icon-user', 'icon-logout', 'icon-filter',
  'icon-archive', 'icon-external-link'
];

const CREDS = {
  admin: { user: process.env.ADMIN_USER || 'admin', pass: process.env.ADMIN_PASS || 'admin' },
  tom: { user: process.env.TOM_USER || 'tom', pass: process.env.TOM_PASS || '123456' },
  jerry: { user: process.env.JERRY_USER || 'jerry', pass: process.env.JERRY_PASS || '123456' }
};

const results = {
  startedAt: new Date().toISOString(),
  base,
  checks: [],
  failures: [],
  screenshots: [],
  pages: {},
  viewportMatrix: [],
  viewportSummary: {},
  permissions: { real: [], simulation: [] },
  midCourseFailures: [],
  summary: {}
};

function pass(id, detail) {
  results.checks.push({ id, ok: true, detail: String(detail || '') });
}
function fail(id, detail) {
  const d = String(detail || '');
  results.checks.push({ id, ok: false, detail: d });
  results.failures.push({ id, detail: d });
  console.error('FAIL', id, d);
}
function note(msg) {
  console.log(msg);
}

async function login(context, username, password) {
  const response = await context.request.post(base + '/api/user/login', {
    data: { username, password }
  });
  const json = await response.json();
  if (json.code !== '0') throw new Error(`login ${username}: ${JSON.stringify(json)}`);
  const csrf = (json.data && json.data.csrfToken) || '';
  context._csrfToken = csrf;
  return json;
}

function csrfHeaders(context) {
  const token = context._csrfToken || '';
  return token ? { 'X-CSRF-Token': token } : {};
}

async function shot(page, name, meta) {
  const file = path.join(shotDir, name + '.png');
  await page.screenshot({ path: file, fullPage: false });
  const entry = {
    file: path.relative(out, file).replace(/\\/g, '/'),
    name,
    page: meta.page || '',
    role: meta.role || '',
    viewport: meta.viewport || '',
    state: meta.state || '',
    menu: meta.menu || '',
    goal: meta.goal || '',
    time: new Date().toISOString()
  };
  results.screenshots.push(entry);
  return entry;
}

function isResourceNoise404(url) {
  return /\.(png|jpe?g|gif|webp|ico)(\?|$)/i.test(url)
    || /\/file\//i.test(url)
    || /\/upload\//i.test(url);
}

async function measurePage(page) {
  return page.evaluate(() => {
    const overflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
    const uses = [...document.querySelectorAll('use')].map((u) =>
      u.getAttribute('href') || u.getAttribute('xlink:href')
      || u.getAttributeNS('http://www.w3.org/1999/xlink', 'href') || ''
    );
    const iconOnlyBad = [];
    const missingAria = [];
    for (const el of document.querySelectorAll('.ui-icon-button, .ui-mobile-toggle')) {
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) continue;
      const aria = el.getAttribute('aria-label') || el.getAttribute('title') || '';
      if (!aria.trim()) missingAria.push((el.className || '').toString().slice(0, 40));
      if (r.width < 44 || r.height < 44) {
        iconOnlyBad.push({ w: Math.round(r.width), h: Math.round(r.height) });
      }
    }
    // rough button overlap among visible interactive controls in toolbar/hero/row
    const zones = [...document.querySelectorAll('.admin-section-head, .ui-toolbar, .admin-row-actions, .admin-dialog-actions')];
    let overlapPairs = 0;
    for (const zone of zones) {
      const btns = [...zone.querySelectorAll('button, a.ui-button')].filter((b) => {
        const r = b.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      });
      for (let i = 0; i < btns.length; i++) {
        for (let j = i + 1; j < btns.length; j++) {
          const a = btns[i].getBoundingClientRect();
          const b = btns[j].getBoundingClientRect();
          const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
          const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
          if (ox > 4 && oy > 4) overlapPairs++;
        }
      }
    }
    // icon clip: svg with zero size while parent visible
    let iconClipped = 0;
    for (const svg of document.querySelectorAll('.ui-icon, svg.ui-icon')) {
      const r = svg.getBoundingClientRect();
      const p = svg.parentElement && svg.parentElement.getBoundingClientRect();
      if (p && p.width > 0 && p.height > 0 && (r.width < 1 || r.height < 1)) iconClipped++;
    }
    // search label wrap: span inside .ui-search taller than one line
    let searchLabelWrap = 0;
    for (const span of document.querySelectorAll('.ui-search > span')) {
      const r = span.getBoundingClientRect();
      if (r.height > 22) searchLabelWrap++;
    }
    // dialog footer occlusion (if open)
    let dialogFooterOccluded = 0;
    const dialog = document.querySelector('.admin-dialog-backdrop .admin-dialog, [role="dialog"], [role="alertdialog"]');
    if (dialog) {
      const actions = dialog.querySelector('.admin-dialog-actions');
      if (actions) {
        const ar = actions.getBoundingClientRect();
        const dr = dialog.getBoundingClientRect();
        if (ar.bottom > window.innerHeight + 2 || ar.top < dr.top - 2) dialogFooterOccluded = 1;
      }
    }
    const mobileChrome = !!document.querySelector('.ui-mobile-toggle')
      && getComputedStyle(document.querySelector('.ui-mobile-toggle')).display !== 'none';
    const desktopNav = !!document.querySelector('.admin-desktop-nav')
      && getComputedStyle(document.querySelector('.admin-desktop-nav')).display !== 'none';
    return {
      overflow,
      uses,
      iconOnlyBad,
      missingAria,
      overlapPairs,
      iconClipped,
      searchLabelWrap,
      dialogFooterOccluded,
      mobileChrome,
      desktopNav
    };
  });
}

async function checkSprite(request) {
  const res = await request.get(base + '/icons/ui-icons.svg?v=20260729c');
  const status = res.status();
  const body = await res.text();
  const ids = [...body.matchAll(/id="(icon-[\w-]+)"/g)].map((m) => m[1]);
  const dup = ids.filter((s, i) => ids.indexOf(s) !== i);
  const missingRequired = REQUIRED_SYMBOLS.filter((s) => !ids.includes(s));
  return { status, ids, dup, missingRequired, length: body.length };
}

function attachCollectors(page, bag) {
  page.on('pageerror', (e) => bag.consoleErrors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') bag.consoleErrors.push(m.text());
  });
  page.on('response', (r) => {
    if (r.status() === 404) {
      const u = r.url();
      if (isResourceNoise404(u)) {
        bag.ignored404.push(u);
        return;
      }
      bag.network404.push(u);
    }
  });
}

(async () => {
  const t0 = Date.now();
  note('Phase 1C strict start ' + base);

  if (!fs.existsSync('src/main/resources/static/icons/ui-icons.svg')) {
    fail('sprite-file', 'missing ui-icons.svg');
  } else {
    pass('sprite-file', 'present');
  }

  const browser = await chromium.launch({ headless: true });
  let tempRoleId = null;
  let tempRoleName = null;

  try {
    // ——— Sprite ———
    const probe = await browser.newContext();
    const sprite = await checkSprite(probe.request);
    results.sprite = sprite;
    if (sprite.status === 200) pass('sprite-http', '200 len=' + sprite.length);
    else fail('sprite-http', 'status ' + sprite.status);
    if (!sprite.dup.length) pass('sprite-no-dup', 'ids=' + sprite.ids.length);
    else fail('sprite-no-dup', sprite.dup.join(','));
    if (!sprite.missingRequired.length) pass('sprite-required', 'ok');
    else fail('sprite-required', sprite.missingRequired.join(','));
    await probe.close();

    // ——— Admin context ———
    const adminCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await login(adminCtx, CREDS.admin.user, CREDS.admin.pass);
    const page = await adminCtx.newPage();
    const bag = { consoleErrors: [], network404: [], ignored404: [] };
    attachCollectors(page, bag);

    // ——— Full 15 × 6 viewport matrix ———
    let matrixPass = 0;
    let matrixFail = 0;
    for (const vp of VIEWPORTS) {
      const vpAgg = {
        name: vp.name,
        pages: 0,
        overflow: 0,
        overlap: 0,
        iconClipped: 0,
        touchFail: 0,
        searchWrap: 0,
        consolePhase1c: 0,
        net404: 0,
        failed: 0
      };
      await page.setViewportSize({ width: vp.width, height: vp.height });
      for (const id of ADMIN_PAGES) {
        bag.consoleErrors.length = 0;
        bag.network404.length = 0;
        const cell = { page: id, viewport: vp.name, ok: true, issues: [] };
        try {
          await page.goto(base + `/page/end/${id}.html`, { waitUntil: 'domcontentloaded', timeout: 45000 });
          await page.waitForTimeout(450);
          const m = await measurePage(page);
          vpAgg.pages++;

          const badUses = m.uses.filter((href) => {
            if (!href) return false;
            if (!href.includes('ui-icons.svg') && !href.startsWith('#')) return true;
            const sym = href.split('#')[1];
            return sym && !sprite.ids.includes(sym);
          });
          if (badUses.length) {
            cell.ok = false;
            cell.issues.push({ type: 'bad-use', badUses: badUses.slice(0, 3) });
          }
          if (m.overflow > 1) {
            cell.ok = false;
            cell.issues.push({ type: 'overflow', overflow: m.overflow });
            vpAgg.overflow++;
          }
          if (m.overlapPairs > 0) {
            cell.ok = false;
            cell.issues.push({ type: 'overlap', pairs: m.overlapPairs });
            vpAgg.overlap += m.overlapPairs;
          }
          if (m.iconClipped > 0) {
            cell.ok = false;
            cell.issues.push({ type: 'icon-clipped', n: m.iconClipped });
            vpAgg.iconClipped += m.iconClipped;
          }
          if (m.iconOnlyBad.length) {
            cell.ok = false;
            cell.issues.push({ type: 'touch', items: m.iconOnlyBad });
            vpAgg.touchFail += m.iconOnlyBad.length;
          }
          if (m.missingAria.length) {
            cell.ok = false;
            cell.issues.push({ type: 'aria', items: m.missingAria });
          }
          if (m.searchLabelWrap > 0) {
            cell.ok = false;
            cell.issues.push({ type: 'search-label-wrap', n: m.searchLabelWrap });
            vpAgg.searchWrap += m.searchLabelWrap;
          }
          const phaseConsole = bag.consoleErrors.filter((e) =>
            /ui-icons|ui-icon|TypeError|ReferenceError|is not defined/i.test(e)
          );
          if (phaseConsole.length) {
            cell.ok = false;
            cell.issues.push({ type: 'console', items: phaseConsole.slice(0, 2) });
            vpAgg.consolePhase1c += phaseConsole.length;
          }
          const phase404 = bag.network404.filter((u) =>
            /ui-icons|\/icons\/|product-ui\.css|admin-workspace\.css|admin-auth\.js/i.test(u)
          );
          if (phase404.length) {
            cell.ok = false;
            cell.issues.push({ type: '404', items: phase404.slice(0, 2) });
            vpAgg.net404 += phase404.length;
          }

          const checkId = `matrix-${id}-${vp.name}`;
          if (cell.ok) {
            pass(checkId, 'ok');
            matrixPass++;
          } else {
            fail(checkId, JSON.stringify(cell.issues).slice(0, 400));
            matrixFail++;
            vpAgg.failed++;
          }
          results.viewportMatrix.push(cell);
        } catch (e) {
          cell.ok = false;
          cell.issues.push({ type: 'exception', message: String(e) });
          fail(`matrix-${id}-${vp.name}`, String(e));
          matrixFail++;
          vpAgg.failed++;
          results.viewportMatrix.push(cell);
        }
      }
      results.viewportSummary[vp.name] = vpAgg;
      if (vpAgg.overflow === 0) pass(`vp-overflow-${vp.name}`, '0');
      else fail(`vp-overflow-${vp.name}`, String(vpAgg.overflow));
    }
    results.matrix = { total: matrixPass + matrixFail, pass: matrixPass, fail: matrixFail };

    // Desktop key screenshots after matrix
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(base + '/page/end/index.html', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(500);
    await shot(page, '01-index-desktop-admin', { page: 'index', role: 'admin', viewport: '1440x900', goal: '管理首页桌面' });

    // ——— More menu keyboard ———
    {
      const moreBtn = page.locator('.admin-nav-more-trigger').first();
      if (!(await moreBtn.count())) {
        fail('more-enter', 'more trigger not found');
      } else {
        await moreBtn.focus();
        await page.keyboard.press('Enter');
        await page.waitForTimeout(200);
        const open = await page.evaluate(() => {
          const t = document.querySelector('.admin-nav-more-trigger');
          const m = document.querySelector('.admin-nav-more-menu');
          return {
            expanded: t && t.getAttribute('aria-expanded') === 'true',
            visible: m && !m.hasAttribute('hidden') && getComputedStyle(m).display !== 'none'
          };
        });
        if (open.expanded && open.visible) pass('more-enter', JSON.stringify(open));
        else fail('more-enter', JSON.stringify(open));
        await shot(page, '02-index-more-menu', { page: 'index', role: 'admin', viewport: '1440x900', menu: 'more', goal: 'More 菜单' });
        await page.keyboard.press('Escape');
        await page.waitForTimeout(150);
        const closed = await page.evaluate(() => {
          const t = document.querySelector('.admin-nav-more-trigger');
          const m = document.querySelector('.admin-nav-more-menu');
          return {
            expanded: t && t.getAttribute('aria-expanded') === 'true',
            hidden: !m || m.hasAttribute('hidden') || getComputedStyle(m).display === 'none'
          };
        });
        if (!closed.expanded && closed.hidden) pass('more-escape', JSON.stringify(closed));
        else fail('more-escape', JSON.stringify(closed));
      }
    }

    // ——— Account menu strict ———
    {
      const acc = page.locator('.admin-account-trigger, .ui-account-trigger').first();
      if (!(await acc.count())) {
        fail('account-enter', 'account trigger not found');
      } else {
        await acc.focus();
        await page.keyboard.press('Enter');
        await page.waitForTimeout(200);
        const open = await page.evaluate(() => {
          const t = document.querySelector('.admin-account-trigger, .ui-account-trigger');
          const m = document.querySelector('#adminAccountMenu, .admin-account-menu, .ui-account-menu');
          const visible = m && !m.hasAttribute('hidden') && getComputedStyle(m).display !== 'none' && m.getBoundingClientRect().height > 0;
          return {
            expanded: t && (t.getAttribute('aria-expanded') === 'true' || t.getAttribute('aria-expanded') === true),
            aria: t && t.getAttribute('aria-expanded'),
            visible: !!visible
          };
        });
        if (open.visible && (open.aria === 'true' || open.expanded)) pass('account-enter', JSON.stringify(open));
        else fail('account-enter', JSON.stringify(open));
        await page.keyboard.press('Escape');
        await page.waitForTimeout(150);
        const closed = await page.evaluate(() => {
          const t = document.querySelector('.admin-account-trigger, .ui-account-trigger');
          const m = document.querySelector('#adminAccountMenu, .admin-account-menu, .ui-account-menu');
          const hidden = !m || m.hasAttribute('hidden') || getComputedStyle(m).display === 'none' || m.getBoundingClientRect().height === 0;
          return {
            aria: t && t.getAttribute('aria-expanded'),
            hidden
          };
        });
        if ((closed.aria === 'false' || closed.aria === false || closed.aria === 'false') && closed.hidden) {
          pass('account-escape', JSON.stringify(closed));
        } else if (closed.aria === 'false' && closed.hidden) {
          pass('account-escape', JSON.stringify(closed));
        } else {
          // Vue binds :aria-expanded="String(accountOpen)" so false => "false"
          if (String(closed.aria) === 'false' && closed.hidden) pass('account-escape', JSON.stringify(closed));
          else fail('account-escape', JSON.stringify(closed));
        }
      }
    }

    // ——— User / permission / operations screenshots ———
    for (const [id, name, goal] of [
      ['user', '03-user-row-actions', '用户管理行操作'],
      ['permission', '07-permission', '权限管理'],
      ['operations', '08-operations', '运营中心'],
      ['adopt', '09-adopt', '领养管理'],
      ['help', '10-help', '救助管理'],
      ['admin_agent', '11-admin-agent', 'AI 管理助手']
    ]) {
      await page.goto(base + `/page/end/${id}.html`, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForTimeout(700);
      await shot(page, name, { page: id, role: 'admin', viewport: '1440x900', goal });
    }

    // ——— Danger confirm with temporary role ———
    {
      tempRoleName = 'UI_AUDIT_1C_' + Date.now();
      const createRes = await adminCtx.request.post(base + '/api/role', {
        headers: csrfHeaders(adminCtx),
        data: {
          name: tempRoleName,
          description: 'phase-1c automated audit role — safe to delete',
          permission: []
        }
      });
      const createJson = await createRes.json().catch(() => ({}));
      if (createRes.status() >= 400 || !createJson || createJson.code !== '0') {
        fail('danger-role-create', `status=${createRes.status()} body=${JSON.stringify(createJson)}`);
      } else {
        pass('danger-role-create', tempRoleName);
        // find id
        const listRes = await adminCtx.request.get(base + '/api/role/page', {
          params: { name: tempRoleName, pageNum: 1, pageSize: 10 }
        });
        const listJson = await listRes.json();
        const rec = (listJson.data && listJson.data.records || []).find((r) => r.name === tempRoleName);
        if (!rec || !rec.id) {
          fail('danger-role-locate', JSON.stringify(listJson).slice(0, 300));
        } else {
          tempRoleId = rec.id;
          if (Number(tempRoleId) <= 4) {
            fail('danger-role-id-builtin', 'refusing to touch built-in id ' + tempRoleId);
            tempRoleId = null;
          } else {
            pass('danger-role-locate', 'id=' + tempRoleId);
            await page.goto(base + '/page/end/role.html', { waitUntil: 'domcontentloaded', timeout: 45000 });
            await page.waitForTimeout(800);
            // filter to the role
            const search = page.locator('.ui-search input').first();
            if (await search.count()) {
              await search.fill(tempRoleName);
              await page.locator('button[type="submit"]').filter({ hasText: '查询' }).click();
              await page.waitForTimeout(700);
            }
            await shot(page, '04-role-list', { page: 'role', role: 'admin', viewport: '1440x900', goal: '角色列表含临时角色' });

            const delBtn = page.locator('button.is-danger').filter({ hasText: /删除/ }).filter({ hasNotText: /禁止/ }).first();
            if (!(await delBtn.count())) {
              fail('danger-delete-click', 'delete button for temp role not found');
            } else {
              await delBtn.click();
              await page.waitForTimeout(300);
              const dlg = page.locator('[role="alertdialog"]');
              if (!(await dlg.count())) {
                fail('danger-alertdialog', 'alertdialog not present');
              } else {
                const text = (await dlg.innerText()).replace(/\s+/g, ' ');
                const hasName = text.includes(tempRoleName);
                const hasCancel = await dlg.locator('button', { hasText: '取消' }).count();
                const confirm = dlg.locator('button.is-danger-solid, button', { hasText: '确认删除角色' }).first();
                const confirmCount = await confirm.count();
                let solid = false;
                if (confirmCount) {
                  solid = await confirm.evaluate((el) => el.classList.contains('is-danger-solid'));
                }
                if (hasName && hasCancel && confirmCount && solid) {
                  pass('danger-confirm-ui', `name+cancel+solid name=${tempRoleName}`);
                } else {
                  fail('danger-confirm-ui', JSON.stringify({ hasName, hasCancel, confirmCount, solid, text: text.slice(0, 120) }));
                }
                await shot(page, '06-role-danger-confirm', {
                  page: 'role', role: 'admin', viewport: '1440x900',
                  state: 'danger-confirm-real', goal: '真实危险确认弹窗'
                });
                await dlg.locator('button', { hasText: '取消' }).click();
                await page.waitForTimeout(200);
                const still = await adminCtx.request.get(base + '/api/role/' + tempRoleId);
                const stillJson = await still.json();
                if (stillJson && stillJson.code === '0' && stillJson.data && String(stillJson.data.id) === String(tempRoleId)) {
                  pass('danger-cancel-keeps-role', 'role still exists');
                } else {
                  fail('danger-cancel-keeps-role', JSON.stringify(stillJson).slice(0, 200));
                }
              }
            }
          }
        }
      }

      // edit dialog screenshot (non-destructive)
      await page.goto(base + '/page/end/role.html', { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForTimeout(600);
      const editBtn = page.locator('.admin-row-actions button, .admin-card-actions button').filter({ hasText: /编辑|查看/ }).first();
      if (await editBtn.count()) {
        await editBtn.click();
        await page.waitForTimeout(350);
        await shot(page, '05-role-edit-dialog', { page: 'role', role: 'admin', viewport: '1440x900', state: 'edit-dialog', goal: '保存弹窗' });
        const close = page.locator('.admin-dialog-close, .admin-dialog-actions button:has-text("取消"), .admin-dialog-actions button:has-text("关闭")').first();
        if (await close.count()) await close.click().catch(() => {});
      } else {
        fail('event-edit-opens', 'no edit button');
      }
    }

    // ——— Disabled strict (permission 禁止删除) ———
    {
      await page.goto(base + '/page/end/permission.html', { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForTimeout(800);
      const dis = page.locator('button[disabled], button:disabled').filter({ hasText: /禁止删除|删除/ }).first();
      if (!(await dis.count())) {
        fail('disabled-btn', 'target disabled button not found');
      } else {
        const isDis = await dis.isDisabled();
        const attr = await dis.evaluate((el) => ({
          disabled: !!el.disabled,
          aria: el.getAttribute('aria-disabled'),
          text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 30)
        }));
        let clickCount = 0;
        await dis.evaluate((el) => {
          el.addEventListener('click', (e) => {
            e.preventDefault();
            el.dataset.probeClicks = String(Number(el.dataset.probeClicks || 0) + 1);
          }, true);
        });
        await dis.click({ force: true }).catch(() => {});
        await page.keyboard.press('Enter').catch(() => {});
        clickCount = await dis.evaluate((el) => Number(el.dataset.probeClicks || 0));
        // native disabled buttons typically do not fire click; force:true may still fire in Playwright
        // Requirement: programmatic handler path — with force click, if browser fires, we still require disabled true
        if (isDis && attr.disabled === true) {
          // Prefer zero handler fires; if force click bypasses, still require disabled flags
          if (clickCount === 0) pass('disabled-btn', JSON.stringify({ isDis, attr, clickCount }));
          else {
            // force:true can synthesize events on disabled elements in some engines — recheck without force
            clickCount = 0;
            await dis.evaluate((el) => { el.dataset.probeClicks = '0'; });
            try {
              await dis.click({ timeout: 800 });
            } catch (_) { /* expected */ }
            clickCount = await dis.evaluate((el) => Number(el.dataset.probeClicks || 0));
            if (clickCount === 0) pass('disabled-btn', JSON.stringify({ isDis, attr, clickCount, mode: 'normal-click' }));
            else fail('disabled-btn', JSON.stringify({ isDis, attr, clickCount }));
          }
        } else {
          fail('disabled-btn', JSON.stringify({ isDis, attr, clickCount }));
        }
        await shot(page, '12-disabled-state', { page: 'permission', role: 'admin', viewport: '1440x900', state: 'disabled', goal: 'disabled 状态' });
      }
    }

    // ——— Real loading via route delay on role query ———
    {
      await page.goto(base + '/page/end/role.html', { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForTimeout(600);
      let requestCount = 0;
      await page.route('**/api/role/page**', async (route) => {
        requestCount++;
        await new Promise((r) => setTimeout(r, 1800));
        await route.continue();
      });
      const queryBtn = page.locator('form.ui-toolbar button[type="submit"], form.admin-review-toolbar button[type="submit"]').filter({ hasText: /查询/ }).first();
      if (!(await queryBtn.count())) {
        fail('loading-real', 'query button not found');
      } else {
        await queryBtn.click();
        // wait until loading class appears
        let sawLoading = false;
        for (let i = 0; i < 20; i++) {
          const st = await queryBtn.evaluate((el) => ({
            loading: el.classList.contains('is-loading'),
            disabled: !!el.disabled,
            ariaBusy: el.getAttribute('aria-busy'),
            ariaDisabled: el.getAttribute('aria-disabled'),
            text: (el.textContent || '').replace(/\s+/g, ' ').trim()
          }));
          if (st.loading && st.disabled && st.ariaBusy === 'true') {
            sawLoading = true;
            await shot(page, '17-loading-state', {
              page: 'role', role: 'admin', viewport: '1440x900',
              state: 'loading-real', goal: '真实 loading 状态'
            });
            // second click must not send another request
            const before = requestCount;
            await queryBtn.click({ force: true }).catch(() => {});
            await page.waitForTimeout(100);
            if (requestCount === before || requestCount === 1) {
              pass('loading-no-double-submit', 'requests=' + requestCount);
            } else {
              fail('loading-no-double-submit', 'requests=' + requestCount + ' beforeSecond=' + before);
            }
            if (st.text.includes('查询')) pass('loading-accessible-name', st.text);
            else fail('loading-accessible-name', st.text);
            break;
          }
          await page.waitForTimeout(100);
        }
        if (sawLoading) pass('loading-real', 'is-loading+disabled+aria-busy');
        else fail('loading-real', 'did not observe loading state');
        // wait recovery
        await page.waitForTimeout(2200);
        const after = await queryBtn.evaluate((el) => ({
          loading: el.classList.contains('is-loading'),
          disabled: !!el.disabled,
          ariaBusy: el.getAttribute('aria-busy')
        }));
        if (!after.loading && after.ariaBusy !== 'true') pass('loading-recover', JSON.stringify(after));
        else fail('loading-recover', JSON.stringify(after));
      }
      await page.unroute('**/api/role/page**').catch(() => {});
    }

    // ——— focus-visible strict ———
    {
      await page.goto(base + '/page/end/index.html', { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForTimeout(400);
      // Tab until we hit a button or link
      let focused = null;
      for (let i = 0; i < 20; i++) {
        await page.keyboard.press('Tab');
        focused = await page.evaluate(() => {
          const el = document.activeElement;
          if (!el || el === document.body) return null;
          const s = getComputedStyle(el);
          const tag = el.tagName.toLowerCase();
          const interactive = tag === 'button' || tag === 'a' || el.getAttribute('tabindex') != null;
          return {
            tag,
            className: (el.className || '').toString().slice(0, 60),
            interactive,
            outlineWidth: parseFloat(s.outlineWidth) || 0,
            outlineStyle: s.outlineStyle,
            boxShadow: s.boxShadow,
            outline: s.outline
          };
        });
        if (focused && focused.interactive) break;
      }
      if (!focused || !focused.interactive) {
        fail('focus-visible', 'no interactive activeElement after Tab');
      } else {
        const hasOutline = focused.outlineWidth > 0 && focused.outlineStyle !== 'none';
        const hasShadow = focused.boxShadow && focused.boxShadow !== 'none';
        if (hasOutline || hasShadow) {
          pass('focus-visible', JSON.stringify(focused));
        } else {
          fail('focus-visible', JSON.stringify(focused));
        }
        await shot(page, '13-focus-visible', { page: 'index', role: 'admin', viewport: '1440x900', state: 'focus', goal: 'focus-visible' });
      }
    }

    // ——— Mobile menu 390/360 ———
    for (const vp of [{ name: '390x844', width: 390, height: 844, shot: '14-index-mobile-menu-390' }, { name: '360x800', width: 360, height: 800, shot: '15-index-360' }]) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto(base + '/page/end/index.html', { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForTimeout(400);
      const toggle = page.locator('.ui-mobile-toggle').first();
      if (!(await toggle.count())) {
        fail(`mobile-menu-${vp.name}`, 'toggle missing');
        continue;
      }
      await toggle.click();
      await page.waitForTimeout(250);
      const open = await page.evaluate(() => !!document.querySelector('.admin-mobile-nav.is-open'));
      if (open) pass(`mobile-menu-${vp.name}`, 'open');
      else fail(`mobile-menu-${vp.name}`, 'not open');
      await shot(page, vp.shot, { page: 'index', role: 'admin', viewport: vp.name, menu: 'mobile', goal: '移动端菜单' });
      if (vp.name === '360x800') {
        const overlap = await page.evaluate(() => {
          const btns = [...document.querySelectorAll('.admin-mobile-nav.is-open a, .ui-mobile-toggle')];
          let pairs = 0;
          for (let i = 0; i < btns.length; i++) {
            for (let j = i + 1; j < btns.length; j++) {
              const a = btns[i].getBoundingClientRect();
              const b = btns[j].getBoundingClientRect();
              const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
              const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
              if (ox > 4 && oy > 4) pairs++;
            }
          }
          return pairs;
        });
        if (overlap === 0) pass('no-overlap-360', 'ok');
        else fail('no-overlap-360', 'pairs=' + overlap);
      }
      await page.keyboard.press('Escape');
    }

    // ——— 200% equivalent: CSS viewport 720×450 (half of 1440×900) ———
    {
      await page.setViewportSize({ width: 720, height: 450 });
      await page.goto(base + '/page/end/user.html', { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForTimeout(600);
      const z = await page.evaluate(() => {
        const overflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
        const toggle = document.querySelector('.ui-mobile-toggle');
        const mobileChrome = toggle && getComputedStyle(toggle).display !== 'none';
        const h1 = document.querySelector('h1, .admin-hero h1');
        const hero = h1 && h1.getBoundingClientRect();
        const actions = document.querySelector('.admin-section-head, .ui-toolbar');
        const ar = actions && actions.getBoundingClientRect();
        const primary = document.querySelector('.ui-button.is-primary, button.is-primary');
        const pr = primary && primary.getBoundingClientRect();
        return {
          overflow,
          mobileChrome,
          titleVisible: !!(hero && hero.width > 0 && hero.top < window.innerHeight),
          actionsVisible: !!(ar && ar.width > 0 && ar.top < window.innerHeight),
          primaryReachable: !!(pr && pr.width > 0 && pr.height >= 40)
        };
      });
      if (z.overflow > 1) fail('zoom-200-overflow', String(z.overflow));
      else pass('zoom-200-overflow', '0');
      if (z.mobileChrome) pass('zoom-200-compact-nav', 'mobile chrome');
      else fail('zoom-200-compact-nav', JSON.stringify(z));
      if (z.titleVisible && z.actionsVisible && z.primaryReachable) pass('zoom-200-usable', JSON.stringify(z));
      else fail('zoom-200-usable', JSON.stringify(z));

      // account menu still works at compact size
      const acc = page.locator('.admin-account-trigger, .ui-account-trigger').first();
      if (!(await acc.count())) {
        fail('zoom-200-account', 'trigger missing');
      } else {
        await acc.click();
        await page.waitForTimeout(200);
        const open = await page.evaluate(() => {
          const t = document.querySelector('.admin-account-trigger, .ui-account-trigger');
          const m = document.querySelector('#adminAccountMenu, .admin-account-menu, .ui-account-menu');
          return {
            aria: t && t.getAttribute('aria-expanded'),
            visible: m && !m.hasAttribute('hidden') && getComputedStyle(m).display !== 'none'
          };
        });
        if (open.visible && String(open.aria) === 'true') pass('zoom-200-account', JSON.stringify(open));
        else fail('zoom-200-account', JSON.stringify(open));
        await page.keyboard.press('Escape');
      }
      await shot(page, '16-zoom-200', {
        page: 'user', role: 'admin', viewport: '720x450-equiv-200pct',
        state: 'css-viewport-half-of-1440x900', goal: '等效 200% 缩放（CSS viewport 720×450）'
      });
      results.zoom200 = { method: 'css-viewport-720x450-equiv-of-1440x900-at-200pct', measure: z };
    }

    // edit event regression
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(base + '/page/end/role.html', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(600);
    const edit = page.locator('.admin-row-actions button, .admin-card-actions button').filter({ hasText: /编辑|查看/ }).first();
    if (!(await edit.count())) fail('event-edit-opens', 'no edit button');
    else {
      await edit.click();
      await page.waitForTimeout(300);
      const dlg = await page.locator('.admin-dialog-backdrop, [role="dialog"]').count();
      if (dlg > 0) pass('event-edit-opens', 'dialog open');
      else fail('event-edit-opens', 'no dialog');
    }

    await adminCtx.close();

    // ——— Permission matrix (real accounts) ———
    async function checkRoleAccess(roleKey, pageId, expect) {
      // expect: { pageOk: boolean, adminChrome: boolean, apiPath?, apiStatus? }
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      const cred = CREDS[roleKey];
      const row = { role: roleKey, page: pageId, type: 'real-account', expect, actual: {}, ok: false };
      try {
        if (roleKey === 'anon') {
          // no login
        } else {
          await login(ctx, cred.user, cred.pass);
        }
        const p = await ctx.newPage();
        const res = await p.goto(base + `/page/end/${pageId}.html`, {
          waitUntil: 'domcontentloaded',
          timeout: 45000
        });
        await p.waitForTimeout(700);
        const url = p.url();
        const status = res ? res.status() : 0;
        const hasCrud = await p.locator('button.is-primary:has-text("新增"), .admin-row-actions button:has-text("删除"), .admin-row-actions button:has-text("编辑")').count();
        const hasShell = await p.locator('#workspace .admin-main, .admin-hero h1').count();
        row.actual = { url, status, hasCrud, hasShell };

        if (expect.redirectLogin) {
          row.ok = /login/i.test(url) || status === 401;
        } else if (expect.denied) {
          row.ok = /error=(need_admin|forbidden)/i.test(url) || /login/i.test(url) || hasCrud === 0;
        } else if (expect.adminChrome) {
          row.ok = !/login/i.test(url) && !/error=/i.test(url) && hasShell > 0;
        } else {
          row.ok = true;
        }

        if (expect.apiPath) {
          const apiRes = await ctx.request.get(base + expect.apiPath);
          row.actual.apiStatus = apiRes.status();
          if (expect.apiStatus != null && apiRes.status() !== expect.apiStatus) {
            // some APIs return 200 with code 403 body — check both
            const body = await apiRes.json().catch(() => ({}));
            const code = body && body.code;
            if (expect.apiStatus === 403 && (apiRes.status() === 403 || code === '403' || code === 403)) {
              row.actual.apiOk = true;
            } else if (expect.apiStatus === 200 && apiRes.status() === 200 && (code === '0' || code === 0 || code == null)) {
              row.actual.apiOk = true;
            } else if (expect.apiStatus === 401 && (apiRes.status() === 401 || code === '401')) {
              row.actual.apiOk = true;
            } else {
              row.actual.apiOk = false;
              row.ok = false;
            }
          } else {
            row.actual.apiOk = true;
          }
        }

        const checkId = `perm-${roleKey}-${pageId}`;
        if (row.ok) pass(checkId, JSON.stringify(row.actual));
        else fail(checkId, JSON.stringify(row));
        results.permissions.real.push(row);
      } catch (e) {
        row.ok = false;
        row.actual.error = String(e);
        fail(`perm-${roleKey}-${pageId}`, String(e));
        results.permissions.real.push(row);
      } finally {
        await ctx.close();
      }
    }

    await checkRoleAccess('jerry', 'user', {
      denied: true,
      adminChrome: false,
      apiPath: '/api/user/page?pageNum=1&pageSize=1',
      apiStatus: 403
    });
    await checkRoleAccess('jerry', 'role', {
      denied: true,
      adminChrome: false,
      apiPath: '/api/role/page?pageNum=1&pageSize=1',
      apiStatus: 403
    });
    await checkRoleAccess('tom', 'animal', {
      adminChrome: true,
      denied: false,
      apiPath: '/api/animal/page?pageNum=1&pageSize=1',
      apiStatus: 200
    });
    await checkRoleAccess('tom', 'user', {
      denied: true,
      adminChrome: false,
      apiPath: '/api/user/page?pageNum=1&pageSize=1',
      apiStatus: 403
    });
    await checkRoleAccess('tom', 'role', {
      denied: true,
      adminChrome: false,
      apiPath: '/api/role/page?pageNum=1&pageSize=1',
      apiStatus: 403
    });
    await checkRoleAccess('admin', 'role', {
      adminChrome: true,
      denied: false,
      apiPath: '/api/role/page?pageNum=1&pageSize=1',
      apiStatus: 200
    });

    // anonymous
    {
      const ctx = await browser.newContext();
      const p = await ctx.newPage();
      const res = await p.goto(base + '/page/end/role.html', { waitUntil: 'domcontentloaded', timeout: 45000 });
      await p.waitForTimeout(500);
      const url = p.url();
      const api = await ctx.request.get(base + '/api/role/page?pageNum=1&pageSize=1');
      const apiStatus = api.status();
      const apiBody = await api.json().catch(() => ({}));
      const pageDenied = /login/i.test(url);
      const apiDenied = apiStatus === 401 || apiStatus === 403 || apiBody.code === '401' || apiBody.code === '403';
      const row = {
        role: 'anon', page: 'role', type: 'real-account',
        actual: { url, apiStatus, apiCode: apiBody.code },
        ok: pageDenied && apiDenied
      };
      if (row.ok) pass('perm-anon-role', JSON.stringify(row.actual));
      else fail('perm-anon-role', JSON.stringify(row));
      results.permissions.real.push(row);
      await ctx.close();
    }

    // CSS static contracts
    const css = fs.readFileSync('src/main/resources/static/css/product-ui.css', 'utf8');
    if (css.includes('.ui-button.is-loading') && css.includes('prefers-reduced-motion')) pass('css-loading-rm', 'present');
    else fail('css-loading-rm', 'missing');
    if (css.includes('.ui-button.is-primary') && css.includes('.ui-button.is-danger-solid')) pass('css-hierarchy', 'present');
    else fail('css-hierarchy', 'missing');
    const iconBtnDefs = (css.match(/\.ui-icon-button\s*\{/g) || []).length;
    if (iconBtnDefs === 1) pass('css-icon-button-single', '1 base def');
    else fail('css-icon-button-single', 'count=' + iconBtnDefs);
    if (css.includes('.ui-search > span') && css.includes('white-space: nowrap')) pass('css-search-nowrap', 'present');
    else fail('css-search-nowrap', 'missing');

  } finally {
    // cleanup temp role
    if (tempRoleId && Number(tempRoleId) > 4) {
      try {
        const ctx = await browser.newContext();
        await login(ctx, CREDS.admin.user, CREDS.admin.pass);
        const del = await ctx.request.delete(base + '/api/role/' + tempRoleId, {
          headers: csrfHeaders(ctx)
        });
        const delJson = await del.json().catch(() => ({}));
        const check = await ctx.request.get(base + '/api/role/' + tempRoleId);
        const checkJson = await check.json().catch(() => ({}));
        const gone = check.status() === 404
          || (checkJson && checkJson.code !== '0')
          || !checkJson.data
          || (checkJson.data && !checkJson.data.id);
        if (del.ok() || delJson.code === '0' || gone) pass('danger-role-cleanup', 'id=' + tempRoleId);
        else fail('danger-role-cleanup', JSON.stringify({ del: delJson, check: checkJson }).slice(0, 300));
        await ctx.close();
      } catch (e) {
        fail('danger-role-cleanup', String(e));
      }
    }
    await browser.close();
  }

  const passed = results.checks.filter((c) => c.ok).length;
  const failed = results.checks.filter((c) => !c.ok).length;
  results.summary = {
    passed,
    failed,
    total: results.checks.length,
    pagesCovered: ADMIN_PAGES.length,
    viewports: VIEWPORTS.length,
    matrixCells: ADMIN_PAGES.length * VIEWPORTS.length,
    matrixPass: results.matrix ? results.matrix.pass : 0,
    matrixFail: results.matrix ? results.matrix.fail : 0,
    screenshots: results.screenshots.length,
    durationMs: Date.now() - t0,
    finishedAt: new Date().toISOString(),
    strictMode: true,
    noBestEffortPass: true
  };
  results.ok = failed === 0;

  fs.writeFileSync(path.join(out, 'phase-1c-report.json'), JSON.stringify(results, null, 2));
  fs.writeFileSync(path.join(out, 'screenshots-index.json'), JSON.stringify(results.screenshots, null, 2));
  console.log(JSON.stringify(results.summary, null, 2));
  console.log(failed ? `FAILED ${failed}/${results.checks.length}` : `ALL CHECKS PASSED ${passed}`);
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  results.fatal = String(e);
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'phase-1c-report.json'), JSON.stringify(results, null, 2));
  process.exit(1);
});
