const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.request.post('http://127.0.0.1:9999/api/user/login', {
    data: { username: 'admin', password: 'admin' },
    headers: { 'Content-Type': 'application/json' },
  });
  const page = await ctx.newPage();
  const nets = [];
  page.on('response', (r) => {
    if (r.url().includes('/api/role') && r.request().method() !== 'GET') {
      nets.push(r.status() + ' ' + r.request().method() + ' ' + r.url());
    }
  });
  await page.goto('http://127.0.0.1:9999/page/end/role.html', { waitUntil: 'networkidle', timeout: 45000 });
  await page.waitForTimeout(800);

  // Edit built-in volunteer (#2)
  const row2 = page.locator('.admin-record-table tbody tr', { hasText: '#2' });
  await row2.getByRole('button', { name: '编辑' }).click();
  await page.waitForTimeout(400);
  await page.fill('#roleDesc', '部分权限-UI可编辑验证');
  await page.getByRole('button', { name: '保存角色' }).click();
  await page.waitForTimeout(1200);
  const afterBuiltIn = await page.evaluate(() => ({
    msg: document.querySelector('.admin-inline-message')?.textContent || '',
    err: document.querySelector('.admin-dialog .is-error')?.textContent || '',
    dialogOpen: !!document.querySelector('.admin-dialog'),
    row2: [...document.querySelectorAll('.admin-record-table tbody tr')].find((tr) => tr.innerText.includes('#2'))?.innerText.replace(/\s+/g, ' '),
  }));
  console.log('AFTER_BUILTIN_EDIT', afterBuiltIn);

  // Super admin view only
  const row1 = page.locator('.admin-record-table tbody tr', { hasText: '#1' });
  await row1.getByRole('button', { name: '查看' }).click();
  await page.waitForTimeout(300);
  const viewOnly = await page.evaluate(() => ({
    title: document.querySelector('#roleEditTitle')?.textContent,
    saveExists: [...document.querySelectorAll('.admin-dialog button')].some((b) => b.textContent.includes('保存角色')),
    nameDisabled: document.querySelector('#roleName')?.disabled,
  }));
  console.log('VIEW_SUPER', viewOnly);
  await page.getByRole('button', { name: '关闭' }).first().click();
  await page.waitForTimeout(300);

  // custom create + delete
  await page.getByRole('button', { name: '新增角色' }).click();
  await page.fill('#roleName', 'ui-custom-role');
  await page.fill('#roleDesc', 'tmp');
  const boxes = page.locator('.admin-checkbox-grid input[type=checkbox]');
  if ((await boxes.count()) > 0) await boxes.nth(0).check();
  await page.getByRole('button', { name: '保存角色' }).click();
  await page.waitForTimeout(1200);
  const del = page.locator('.admin-record-table tbody tr', { hasText: 'ui-custom-role' }).getByRole('button', { name: '删除' });
  await del.click();
  await page.getByRole('button', { name: '确认删除' }).click();
  await page.waitForTimeout(1000);
  console.log('NETS', nets);
  await page.screenshot({ path: 'output/system-audit/screenshots/role-page-fixed.png', fullPage: true });
  await browser.close();
  if (!afterBuiltIn.msg.includes('已保存') || afterBuiltIn.dialogOpen) process.exit(2);
  if (viewOnly.saveExists || !viewOnly.nameDisabled) process.exit(3);
  console.log('UI_PASS');
})().catch((e) => { console.error(e); process.exit(1); });
