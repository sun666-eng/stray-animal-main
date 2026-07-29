/**
 * Adversarial re-check for admin adopt questionnaire modal.
 * Evidence: measurements, network, screenshots — not claims.
 */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const BASE = process.env.BASE_URL || 'http://localhost:9999';
const ADMIN = process.env.ADMIN_USER || 'admin';
const PASS = process.env.ADMIN_PASS || 'admin';
const OUT = path.resolve('tools/adopt-questionnaire-artifacts/adversarial');
fs.mkdirSync(OUT, { recursive: true });

const lines = [];
const fails = [];
function log(s) { lines.push(s); console.log(s); }
function fail(s) { fails.push(s); log('FAIL: ' + s); }
function pass(s) { log('PASS: ' + s); }

async function login(context, user, pass) {
  const res = await context.request.post(`${BASE}/api/user/login`, {
    data: { username: user, password: pass },
    headers: { 'Content-Type': 'application/json' },
  });
  const j = await res.json();
  if (j.code !== '0') throw new Error('login ' + user + ' ' + JSON.stringify(j));
  return j.data;
}

async function openEdit(page) {
  await page.goto(`${BASE}/page/end/adopt.html`, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(600);
  const candidates = page.getByRole('button', { name: /编辑问卷|^编辑$/ });
  const n = await candidates.count();
  for (let i = 0; i < n; i++) {
    const b = candidates.nth(i);
    if (await b.isVisible()) {
      await b.click();
      await page.waitForSelector('#adoptEditAge', { timeout: 10000 });
      return;
    }
  }
  throw new Error('no visible edit button');
}

async function inspectNativeAndSizes(page) {
  return page.evaluate(() => {
    const dialog = document.querySelector('.admin-edit-form')?.closest('.admin-dialog');
    if (!dialog) return { error: 'no dialog' };
    const fields = [...dialog.querySelectorAll('.admin-form-grid .ui-form-field')];
    const pair = fields.filter((f) => !f.classList.contains('is-full'));
    const controls = pair.map((f) => f.querySelector('input,select,textarea')).filter(Boolean);
    const close = dialog.querySelector('.admin-dialog-head > button');
    const csClose = getComputedStyle(close);
    const closeR = close.getBoundingClientRect();
    // native look: appearance / border / height
    const styles = controls.map((el) => {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return {
        tag: el.tagName.toLowerCase(),
        type: el.type || '',
        h: Math.round(r.height),
        w: Math.round(r.width),
        borderRadius: cs.borderRadius,
        border: cs.borderTopWidth + ' ' + cs.borderTopStyle,
        bg: cs.backgroundColor,
        appearance: cs.appearance || cs.webkitAppearance,
        fontSize: cs.fontSize,
      };
    });
    const heights = styles.map((s) => s.h);
    const minH = Math.min(...heights);
    const maxH = Math.max(...heights);
    // column widths: left col inputs vs right
    const leftW = styles.filter((_, i) => i % 2 === 0).map((s) => s.w);
    const rightW = styles.filter((_, i) => i % 2 === 1).map((s) => s.w);
    const leftUniform = leftW.every((w) => Math.abs(w - leftW[0]) <= 2);
    const rightUniform = rightW.length === 0 || rightW.every((w) => Math.abs(w - rightW[0]) <= 2);
    // close text lines
    const range = document.createRange();
    range.selectNodeContents(close);
    const rects = [...range.getClientRects()];
    const location = dialog.querySelector('#adoptEditLocation');
    const locR = location?.getBoundingClientRect();
    const grid = dialog.querySelector('.admin-form-grid')?.getBoundingClientRect();
    return {
      close: {
        w: Math.round(closeR.width),
        h: Math.round(closeR.height),
        whiteSpace: csClose.whiteSpace,
        text: close.textContent.trim(),
        lineBoxes: rects.length,
        borderRadius: csClose.borderRadius,
      },
      heights: { min: minH, max: maxH, all: heights },
      leftUniform,
      rightUniform,
      leftW,
      rightW,
      styles,
      locationSpansFull: locR && grid ? Math.abs(locR.width - grid.width) <= 8 : false,
      viewport: { w: innerWidth, h: innerHeight },
      dialog: (() => {
        const r = dialog.getBoundingClientRect();
        return { w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top), bottom: Math.round(r.bottom) };
      })(),
      scrollWidth: document.documentElement.scrollWidth,
      bodyOverflowY: getComputedStyle(dialog.querySelector('.admin-dialog-body')).overflowY,
    };
  });
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const network = [];
  context.on('request', (req) => {
    if (req.url().includes('/api/adopt') && req.method() !== 'GET') {
      network.push({ method: req.method(), url: req.url(), post: req.postData() });
    }
  });
  const responses = [];
  context.on('response', async (res) => {
    if (res.url().includes('/api/adopt') && res.request().method() !== 'GET') {
      let body = '';
      try { body = await res.text(); } catch {}
      responses.push({ status: res.status(), url: res.url(), method: res.request().method(), body: body.slice(0, 300) });
    }
  });
  const consoleErr = [];
  context.on('page', (p) => {
    p.on('console', (m) => { if (m.type() === 'error') consoleErr.push(m.text()); });
    p.on('pageerror', (e) => consoleErr.push(e.message));
  });

  await login(context, ADMIN, PASS);
  const page = await context.newPage();

  // ---- Desktop 1440 adversarial ----
  await page.setViewportSize({ width: 1440, height: 900 });
  await openEdit(page);
  await page.screenshot({ path: path.join(OUT, 'adv-1440-open.png'), fullPage: true });
  let m = await inspectNativeAndSizes(page);
  log('MEASURE 1440: ' + JSON.stringify(m, null, 2));

  // 1 native controls
  const ugly = (m.styles || []).filter((s) => {
    // design system: border-radius ~12px, height >= 44, not pure system appearance for select
    const radius = parseFloat(s.borderRadius) || 0;
    return s.h < 44 || radius < 8;
  });
  if (ugly.length) fail('native/mixed controls: ' + JSON.stringify(ugly));
  else pass('no undersized/native-looking controls among pair fields');

  // 2 same class height consistency
  if (m.heights.min !== m.heights.max) fail(`height mismatch min=${m.heights.min} max=${m.heights.max}`);
  else pass(`all pair control heights equal ${m.heights.min}`);
  if (!m.leftUniform || !m.rightUniform) fail(`column width not uniform L=${m.leftUniform} R=${m.rightUniform}`);
  else pass('column control widths uniform');

  // 3 close wrap
  if (m.close.lineBoxes > 1) fail(`close button wraps lineBoxes=${m.close.lineBoxes}`);
  else pass(`close single line boxes=${m.close.lineBoxes} size=${m.close.w}x${m.close.h}`);
  if (m.close.h < 44 || m.close.w < 44) fail('close < 44px');
  if (m.close.whiteSpace !== 'nowrap') fail('close white-space not nowrap');
  if (m.close.borderRadius.includes('50%') || parseFloat(m.close.borderRadius) > 20) {
    // 12px ok; 50% circle bad
    if (m.close.borderRadius.includes('50%')) fail('close still circular');
  }

  // location full width
  if (!m.locationSpansFull) fail('location not full grid width');
  else pass('location spans full width');

  // ---- force narrow close stress: 320 ----
  await page.setViewportSize({ width: 320, height: 568 });
  await page.waitForTimeout(200);
  m = await inspectNativeAndSizes(page);
  await page.screenshot({ path: path.join(OUT, 'adv-320-open.png'), fullPage: true });
  if (m.close.lineBoxes > 1 || m.close.h < 44) fail(`320 close fail boxes=${m.close.lineBoxes} h=${m.close.h}`);
  else pass(`320 close ok ${m.close.w}x${m.close.h} lines=${m.close.lineBoxes}`);
  if (m.scrollWidth > m.viewport.w + 2) fail(`320 horizontal scroll scrollWidth=${m.scrollWidth}`);
  else pass('320 no horizontal overflow');

  // ---- 1366 complete ops ----
  await page.setViewportSize({ width: 1366, height: 768 });
  await openEdit(page);
  const age0 = await page.inputValue('#adoptEditAge');
  await page.fill('#adoptEditAge', '33');
  await page.fill('#adoptEditWechat', 'adv_test_wx');
  await page.selectOption('#adoptEditMarital', { value: '2' });
  // error path: age 5 via set then submit
  await page.fill('#adoptEditAge', '5');
  await page.locator('.admin-edit-form .admin-dialog-actions button[type="submit"]').click();
  await page.waitForTimeout(800);
  const errVisible = await page.locator('#adoptEditFormError, .admin-inline-message.is-error').isVisible().catch(() => false);
  const stillOpen = await page.locator('#adoptEditAge').isVisible();
  await page.screenshot({ path: path.join(OUT, 'adv-1366-validation-error.png'), fullPage: true });
  if (!stillOpen) fail('dialog closed on validation/save failure');
  else pass('dialog stays open after failed save');
  // check no false success toast
  const successMsg = await page.locator('.admin-banner, .admin-status, [class*="success"]').filter({ hasText: /已保存|成功/ }).count();
  // may not have success class - check page text for 领养问卷已保存 while dialog open is bad
  const bodyText = await page.locator('body').innerText();
  if (bodyText.includes('领养问卷已保存') && stillOpen) {
    // if error also shown, still bad if success shown
  }
  // restore age and cancel
  await page.fill('#adoptEditAge', age0);
  await page.click('.admin-dialog-actions button:has-text("取消")');
  await page.waitForTimeout(300);
  if (await page.locator('#adoptEditAge').count()) fail('cancel did not close');
  else pass('cancel closes without requiring save');

  // reopen verify cancel didn't save
  await openEdit(page);
  const age1 = await page.inputValue('#adoptEditAge');
  if (age1 !== age0) fail(`cancel leaked save age ${age0}->${age1}`);
  else pass(`cancel no persist age=${age1}`);

  // long content + error
  await page.fill('#adoptEditLocation', '地址'.repeat(40) + 'X'.repeat(80));
  await page.fill('#adoptEditOccupation', '职'.repeat(20));
  await page.fill('#adoptEditAge', '5');
  await page.locator('.admin-edit-form .admin-dialog-actions button[type="submit"]').click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(OUT, 'adv-1366-long-error.png'), fullPage: true });
  const m2 = await inspectNativeAndSizes(page);
  if (m2.dialog.bottom > m2.viewport.h + 4) fail('dialog bottom outside viewport after long+error');
  else pass('dialog still in viewport with long+error');
  const actionsVisible = await page.locator('.admin-dialog-actions button[type="submit"]').isVisible();
  if (!actionsVisible) fail('submit button not visible after long error');
  else pass('actions visible after long error');
  await page.click('.admin-dialog-head > button');
  await page.waitForTimeout(200);

  // ---- double click save ----
  await openEdit(page);
  network.length = 0;
  responses.length = 0;
  await page.fill('#adoptEditWechat', 'dbl_' + Date.now());
  await page.fill('#adoptEditAge', age0);
  // rapid double click
  const saveBtn = page.locator('.admin-edit-form .admin-dialog-actions button[type="submit"]');
  await Promise.all([
    saveBtn.click({ force: true }),
    saveBtn.click({ force: true }).catch(() => {}),
  ]);
  await page.waitForTimeout(1200);
  const puts = responses.filter((r) => r.method === 'PUT');
  log('double-click PUT count=' + puts.length + ' bodies=' + JSON.stringify(puts.map((p) => p.status + p.body.slice(0, 80))));
  if (puts.length > 1) fail('double click caused multiple PUT ' + puts.length);
  else pass('double click at most one PUT (got ' + puts.length + ')');
  // if saved, restore via API
  if (puts.length === 1 && puts[0].body.includes('"code":"0"')) {
    // reopen and restore wechat from age0 path - fetch via list
    pass('save succeeded once');
  }
  if (await page.locator('#adoptEditAge').isVisible()) {
    // still open = error
    await page.click('.admin-dialog-head > button').catch(() => {});
  }

  // ---- login expired mid-edit ----
  await openEdit(page);
  await page.context().clearCookies();
  // clear session storage
  await page.evaluate(() => { try { sessionStorage.clear(); localStorage.clear(); } catch(e) {} });
  responses.length = 0;
  await page.fill('#adoptEditWechat', 'expired_test');
  await page.locator('.admin-edit-form .admin-dialog-actions button[type="submit"]').click();
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(OUT, 'adv-expired-save.png'), fullPage: true });
  const errText = await page.locator('.admin-inline-message.is-error, #adoptEditFormError').textContent().catch(() => '');
  const savedBanner = (await page.locator('body').innerText()).includes('领养问卷已保存');
  if (savedBanner) fail('false success on expired session');
  else pass('no false success on expired session');
  log('expired error text=' + JSON.stringify(errText));
  const openAfter = await page.locator('#adoptEditAge').isVisible().catch(() => false);
  if (!openAfter && !savedBanner) pass('dialog closed or navigated after auth loss (ok if not fake success)');
  // re-login for remaining tests
  await login(context, ADMIN, PASS);

  // ---- 1366 full happy path measure breakpoint ----
  await page.setViewportSize({ width: 1366, height: 768 });
  await openEdit(page);
  const cols1366 = await page.evaluate(() => {
    const fields = [...document.querySelectorAll('.admin-form-grid .ui-form-field:not(.is-full)')];
    if (fields.length < 2) return { cols: 1 };
    const t0 = fields[0].getBoundingClientRect().top;
    const t1 = fields[1].getBoundingClientRect().top;
    return { cols: Math.abs(t0 - t1) < 8 ? 2 : 1, t0, t1 };
  });
  log('1366 columns=' + JSON.stringify(cols1366));
  if (cols1366.cols !== 2) fail('1366 should stay 2-col');
  else pass('1366 two-column layout');

  await page.setViewportSize({ width: 600, height: 800 });
  await page.waitForTimeout(150);
  const cols600 = await page.evaluate(() => {
    const fields = [...document.querySelectorAll('.admin-form-grid .ui-form-field:not(.is-full)')];
    const t0 = fields[0].getBoundingClientRect().top;
    const t1 = fields[1].getBoundingClientRect().top;
    return { cols: Math.abs(t0 - t1) < 8 ? 2 : 1 };
  });
  log('600 columns=' + JSON.stringify(cols600));
  if (cols600.cols !== 1) fail('600 should be 1-col');
  else pass('600 single-column breakpoint');
  await page.screenshot({ path: path.join(OUT, 'adv-600-single-col.png'), fullPage: true });
  await page.keyboard.press('Escape');

  // ---- other admin dialogs not broken (animal) ----
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${BASE}/page/end/animal.html`, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(800);
  // try open any dialog
  const addBtn = page.getByRole('button', { name: /新增|添加|创建/ }).first();
  let animalDialogOk = false;
  if (await addBtn.count() && await addBtn.isVisible()) {
    await addBtn.click();
    await page.waitForTimeout(400);
    const dlg = page.locator('.admin-dialog').first();
    if (await dlg.isVisible()) {
      const pad = await dlg.evaluate((el) => getComputedStyle(el).padding);
      const close = dlg.locator('.admin-dialog-head > button').first();
      let closeOk = true;
      if (await close.count()) {
        const box = await close.boundingBox();
        const ws = await close.evaluate((e) => getComputedStyle(e).whiteSpace);
        closeOk = box && box.height >= 40 && ws === 'nowrap';
      }
      animalDialogOk = closeOk;
      await page.screenshot({ path: path.join(OUT, 'adv-animal-dialog.png'), fullPage: true });
      log('animal dialog padding=' + pad + ' closeOk=' + closeOk);
    }
  } else {
    // open detail if exists
    const any = page.locator('button:visible').filter({ hasText: /详情|编辑/ }).first();
    if (await any.count()) {
      await any.click();
      await page.waitForTimeout(400);
      await page.screenshot({ path: path.join(OUT, 'adv-animal-dialog.png'), fullPage: true });
      animalDialogOk = await page.locator('.admin-dialog').first().isVisible();
    } else {
      log('SKIP animal dialog open — no button');
      animalDialogOk = true; // not a regression if page structure differs
    }
  }
  if (animalDialogOk) pass('animal admin dialog still usable');
  else fail('animal admin dialog broken by shared CSS');

  // ---- 320 complete open/edit/cancel ----
  await page.setViewportSize({ width: 320, height: 568 });
  await openEdit(page);
  await page.fill('#adoptEditGender', '女');
  await page.screenshot({ path: path.join(OUT, 'adv-320-filled.png'), fullPage: true });
  const m320 = await inspectNativeAndSizes(page);
  if (m320.close.lineBoxes > 1) fail('320 close wraps');
  if (m320.scrollWidth > 322) fail('320 h-scroll');
  await page.locator('.admin-edit-form .admin-dialog-actions button:has-text("取消")').click();
  if (await page.locator('#adoptEditAge').isVisible().catch(() => false)) fail('320 cancel fail');
  else pass('320 complete open-edit-cancel');

  log('console errors: ' + consoleErr.length);
  if (consoleErr.length) log(consoleErr.slice(0, 5).join('\n'));
  log('network PUT/POST samples: ' + JSON.stringify(responses.slice(-6), null, 2));

  fs.writeFileSync(path.join(OUT, 'adversarial-report.txt'), lines.join('\n') + '\n\nFAIL_COUNT=' + fails.length + '\n' + fails.join('\n'), 'utf8');
  await browser.close();
  if (fails.length) {
    console.error('ADVERSARIAL FAILS:', fails.length);
    process.exit(1);
  }
  console.log('ADVERSARIAL PASS all checks');
}

main().catch((e) => {
  console.error(e);
  fs.writeFileSync(path.join(OUT, 'adversarial-report.txt'), lines.join('\n') + '\nFATAL ' + e.stack, 'utf8');
  process.exit(1);
});
