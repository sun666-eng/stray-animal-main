/**
 * Real-browser verification for admin adopt questionnaire dialog.
 * Requires app on BASE_URL (default http://localhost:9999) and admin credentials.
 */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const BASE = process.env.BASE_URL || 'http://localhost:9999';
const ADMIN = process.env.ADMIN_USER || 'admin';
const PASS = process.env.ADMIN_PASS || 'admin';
const OUT = path.resolve('tools/adopt-questionnaire-artifacts');
fs.mkdirSync(OUT, { recursive: true });

const viewports = [
  { name: '1920x1080', width: 1920, height: 1080 },
  { name: '1440x900', width: 1440, height: 900 },
  { name: '1366x768', width: 1366, height: 768 },
  { name: '1024x768', width: 1024, height: 768 },
  { name: '768x1024', width: 768, height: 1024 },
  { name: '390x844', width: 390, height: 844 },
  { name: '320x568', width: 320, height: 568 },
];

const report = [];
function log(line) {
  report.push(line);
  console.log(line);
}

async function loginViaApi(context) {
  const res = await context.request.post(`${BASE}/api/user/login`, {
    data: { username: ADMIN, password: PASS },
    headers: { 'Content-Type': 'application/json' },
  });
  const json = await res.json();
  if (json.code !== '0') throw new Error('admin login failed: ' + JSON.stringify(json));
  return json.data;
}

async function measureDialog(page) {
  return page.evaluate(() => {
    const dialog = document.querySelector('.admin-edit-form')?.closest('.admin-dialog') ||
      document.querySelector('.admin-dialog');
    const closeBtn = dialog?.querySelector('.admin-dialog-head > button');
    const fields = Array.from(dialog?.querySelectorAll('.admin-edit-form .admin-form-grid .ui-form-field') || []);
    const pairFields = fields.filter((f) => !f.classList.contains('is-full'));
    const inputs = pairFields.map((f) => f.querySelector('input,select')).filter(Boolean);
    const labels = pairFields.map((f) => f.querySelector('label')).filter(Boolean);
    const actions = dialog?.querySelector('.admin-dialog-actions');
    const lastField = dialog?.querySelector('.admin-edit-form .admin-form-grid .ui-form-field.is-full') ||
      pairFields[pairFields.length - 1];
    const body = dialog?.querySelector('.admin-dialog-body');
    if (body) body.scrollTop = body.scrollHeight;
    const d = dialog ? dialog.getBoundingClientRect() : null;
    const c = closeBtn ? closeBtn.getBoundingClientRect() : null;
    const csClose = closeBtn ? getComputedStyle(closeBtn) : null;
    const heights = inputs.map((el) => Math.round(el.getBoundingClientRect().height));
    const tops = labels.map((el) => Math.round(el.getBoundingClientRect().top));
    let maxLabelTopDiff = 0;
    for (let i = 0; i + 1 < tops.length; i += 2) {
      maxLabelTopDiff = Math.max(maxLabelTopDiff, Math.abs(tops[i] - tops[i + 1]));
    }
    const lefts = inputs.filter((_, i) => i % 2 === 0).map((el) => Math.round(el.getBoundingClientRect().left));
    const rights = inputs.filter((_, i) => i % 2 === 1).map((el) => Math.round(el.getBoundingClientRect().left));
    const leftAligned = lefts.length <= 1 || lefts.every((v) => Math.abs(v - lefts[0]) <= 2);
    const rightAligned = rights.length <= 1 || rights.every((v) => Math.abs(v - rights[0]) <= 2);
    const actionRect = actions ? actions.getBoundingClientRect() : null;
    const lastRect = lastField ? lastField.getBoundingClientRect() : null;
    // 滚动到底后，最后字段底边应在操作栏顶边之上（允许 4px 误差）
    const obscured = actionRect && lastRect
      ? lastRect.bottom > actionRect.top + 4
      : false;
    return {
      dialog: d ? { w: Math.round(d.width), h: Math.round(d.height), top: Math.round(d.top), left: Math.round(d.left), bottom: Math.round(d.bottom), right: Math.round(d.right) } : null,
      close: c ? { w: Math.round(c.width), h: Math.round(c.height), whiteSpace: csClose.whiteSpace } : null,
      inputHeights: heights,
      heightUniform: heights.length ? heights.every((h) => Math.abs(h - heights[0]) <= 2) : false,
      minInputH: heights.length ? Math.min(...heights) : 0,
      maxLabelTopDiff,
      leftAligned,
      rightAligned,
      viewport: { w: window.innerWidth, h: window.innerHeight },
      scrollWidth: document.documentElement.scrollWidth,
      dialogFits: d ? d.width <= window.innerWidth + 1 && d.height <= window.innerHeight + 1 && d.top >= -2 && d.left >= -2 : false,
      lastFieldObscuredByActions: obscured,
      bodyScrollable: body ? body.scrollHeight > body.clientHeight + 2 : null,
      closeText: closeBtn ? closeBtn.textContent.trim().replace(/\s+/g, '') : '',
    };
  });
}

async function openQuestionnaire(page) {
  await page.goto(`${BASE}/page/end/adopt.html`, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForSelector('#workspace', { timeout: 20000 });
  await page.waitForTimeout(800);
  // table (desktop) or cards (narrow). Prefer currently visible control.
  const candidates = page.getByRole('button', { name: /编辑问卷|^编辑$/ });
  const n = await candidates.count();
  let clicked = false;
  for (let i = 0; i < n; i += 1) {
    const btn = candidates.nth(i);
    if (await btn.isVisible()) {
      await btn.click();
      clicked = true;
      break;
    }
  }
  if (!clicked) {
    throw new Error('No visible edit questionnaire button found (need pending adopt records)');
  }
  await page.waitForSelector('.admin-edit-form #adoptEditAge', { timeout: 10000 });
  await page.waitForTimeout(300);
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const consoleErrors = [];
  context.on('page', (page) => {
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => consoleErrors.push(err.message));
  });

  await loginViaApi(context);
  const page = await context.newPage();

  // Desktop baseline 1440
  await page.setViewportSize({ width: 1440, height: 900 });
  await openQuestionnaire(page);
  await page.screenshot({ path: path.join(OUT, 'after-desktop-1440.png'), fullPage: true });
  const m1440 = await measureDialog(page);
  log('=== MEASURE 1440x900 ===');
  log(JSON.stringify(m1440, null, 2));

  // Functional: cancel no save
  const ageBefore = await page.inputValue('#adoptEditAge');
  await page.fill('#adoptEditAge', '99');
  await page.click('.admin-dialog-actions button:has-text("取消")');
  await page.waitForTimeout(400);
  await openQuestionnaire(page);
  const ageAfterCancel = await page.inputValue('#adoptEditAge');
  log(`cancel-no-save: before=${ageBefore} afterCancelReopen=${ageAfterCancel} pass=${ageAfterCancel === ageBefore}`);

  // Close button single line
  const closeBtn = page.locator('.admin-dialog-head > button');
  const closeBox = await closeBtn.boundingBox();
  const closeStyle = await closeBtn.evaluate((el) => getComputedStyle(el).whiteSpace);
  log(`close-btn: ${JSON.stringify(closeBox)} whiteSpace=${closeStyle}`);

  // Double-click save guard: change a field then cancel
  await page.click('.admin-dialog-head > button');
  await page.waitForTimeout(200);

  // Extreme content
  await openQuestionnaire(page);
  await page.fill('#adoptEditOccupation', '超长职业名测试ABCDEFGHIJKLMNOP');
  await page.fill('#adoptEditLocation', 'A'.repeat(120) + '中文地址测试'.repeat(8));
  await page.screenshot({ path: path.join(OUT, 'after-long-content.png'), fullPage: true });
  const mLong = await measureDialog(page);
  log(`long-content dialogFits=${mLong.dialogFits} scrollWidth=${mLong.scrollWidth} vw=${mLong.viewport.w}`);
  await page.click('.admin-dialog-actions button:has-text("取消")');

  // Multi viewport
  for (const vp of viewports) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await openQuestionnaire(page);
    const m = await measureDialog(page);
    await page.screenshot({ path: path.join(OUT, `viewport-${vp.name}.png`), fullPage: true });
    const passClose = m.close && m.close.w >= 44 && m.close.h >= 44 && m.close.whiteSpace === 'nowrap';
    const passInput = m.minInputH >= 44 && m.heightUniform;
    const passFit = m.dialogFits && m.scrollWidth <= m.viewport.w + 2;
    log(`VP ${vp.name}: close=${passClose} input=${passInput} fit=${passFit} labelDiff=${m.maxLabelTopDiff} leftAlign=${m.leftAligned} obscured=${m.lastFieldObscuredByActions}`);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
  }

  // Zoom 125% / 200%
  for (const zoom of [1.25, 2]) {
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.evaluate((z) => { document.body.style.zoom = String(z); }, zoom);
    await openQuestionnaire(page);
    const m = await measureDialog(page);
    await page.screenshot({ path: path.join(OUT, `zoom-${zoom}.png`), fullPage: true });
    log(`ZOOM ${zoom}: fit=${m.dialogFits} closeH=${m.close && m.close.h} minInput=${m.minInputH}`);
    await page.evaluate(() => { document.body.style.zoom = '1'; });
    await page.keyboard.press('Escape');
  }

  // Permission: jerry cannot open adopt admin page usefully
  const userCtx = await browser.newContext();
  const loginUser = await userCtx.request.post(`${BASE}/api/user/login`, {
    data: { username: 'jerry', password: '123456' },
    headers: { 'Content-Type': 'application/json' },
  });
  const uj = await loginUser.json();
  log(`jerry-login=${uj.code}`);
  const put = await userCtx.request.put(`${BASE}/api/adopt/1/1`, {
    data: { gender: 'x' },
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': uj.data && uj.data.csrfToken },
  });
  log(`jerry-put-status=${put.status()}`);
  await userCtx.close();

  log(`console-errors=${consoleErrors.length}`);
  if (consoleErrors.length) log(consoleErrors.slice(0, 10).join('\n'));

  fs.writeFileSync(path.join(OUT, 'report.txt'), report.join('\n'), 'utf8');
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  fs.writeFileSync(path.join(OUT, 'report.txt'), report.join('\n') + '\nFATAL ' + e.stack, 'utf8');
  process.exit(1);
});
