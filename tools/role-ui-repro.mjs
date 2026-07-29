const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const login = await ctx.request.post('http://127.0.0.1:9999/api/user/login', {
    data: { username: 'admin', password: 'admin' },
    headers: { 'Content-Type': 'application/json' },
  });
  console.log('login', (await login.json()).code);
  const page = await ctx.newPage();
  const nets = [];
  page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE', m.text()); });
  page.on('response', (r) => {
    if (/\/api\/(role|permission)/.test(r.url())) nets.push(r.status() + ' ' + r.request().method() + ' ' + r.url());
  });
  await page.goto('http://127.0.0.1:9999/page/end/role.html', { waitUntil: 'networkidle', timeout: 45000 });
  await page.waitForTimeout(1000);
  const state = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.admin-record-table tbody tr')].map((tr) => {
      const btns = [...tr.querySelectorAll('button')].map((b) => ({
        text: b.textContent.trim(),
        disabled: b.disabled,
        opacity: getComputedStyle(b).opacity,
        pointerEvents: getComputedStyle(b).pointerEvents,
      }));
      return { text: tr.innerText.replace(/\s+/g, ' ').slice(0, 90), btns };
    });
    return { rows, createExists: [...document.querySelectorAll('button')].some((b) => b.textContent.includes('新增角色')) };
  });
  console.log('STATE', JSON.stringify(state, null, 2));
  await page.screenshot({ path: 'output/system-audit/screenshots/role-page-initial.png', fullPage: true });

  await page.getByRole('button', { name: '新增角色' }).click();
  await page.waitForTimeout(400);
  const dlg = await page.evaluate(() => {
    const d = document.querySelector('.admin-dialog');
    return {
      open: !!d,
      checks: d ? d.querySelectorAll('input[type=checkbox]').length : 0,
      title: d?.querySelector('h2')?.textContent || '',
    };
  });
  console.log('DIALOG', dlg);
  await page.fill('#roleName', 'ui-test-role');
  await page.fill('#roleDesc', 'from playwright');
  const boxes = page.locator('.admin-checkbox-grid input[type=checkbox]');
  if ((await boxes.count()) > 0) await boxes.nth(0).check();
  await page.getByRole('button', { name: '保存角色' }).click();
  await page.waitForTimeout(1500);
  const afterCreate = await page.evaluate(() => ({
    msg: document.querySelector('.admin-inline-message')?.textContent || '',
    editErr: document.querySelector('.admin-dialog .is-error')?.textContent || '',
    dialogOpen: !!document.querySelector('.admin-dialog'),
    rows: [...document.querySelectorAll('.admin-record-table tbody tr')].map((tr) =>
      tr.innerText.replace(/\s+/g, ' ').slice(0, 100)
    ),
    enabledEdit: [...document.querySelectorAll('.admin-record-table button')].filter(
      (b) => b.textContent.includes('编辑') && !b.disabled
    ).length,
  }));
  console.log('AFTER_CREATE', afterCreate);
  await page.screenshot({ path: 'output/system-audit/screenshots/role-page-after-create.png', fullPage: true });

  const editBtn = page.locator('.admin-record-table tbody tr button:not([disabled])', { hasText: '编辑' }).first();
  if ((await editBtn.count()) > 0) {
    await editBtn.click();
    await page.waitForTimeout(400);
    await page.fill('#roleName', 'ui-test-role-edited');
    await page.getByRole('button', { name: '保存角色' }).click();
    await page.waitForTimeout(1200);
    console.log(
      'AFTER_EDIT',
      await page.evaluate(() => ({
        msg: document.querySelector('.admin-inline-message')?.textContent || '',
        editErr: document.querySelector('.admin-dialog .is-error')?.textContent || '',
        dialogOpen: !!document.querySelector('.admin-dialog'),
      }))
    );
  } else {
    console.log('NO_ENABLED_EDIT');
  }

  const delBtn = page.locator('.admin-record-table tbody tr button.is-danger:not([disabled])').first();
  if ((await delBtn.count()) > 0) {
    await delBtn.click();
    await page.waitForTimeout(300);
    await page.getByRole('button', { name: '确认删除' }).click();
    await page.waitForTimeout(1200);
    console.log(
      'AFTER_DEL',
      await page.evaluate(() => ({
        msg: document.querySelector('.admin-inline-message')?.textContent || '',
        rows: document.querySelectorAll('.admin-record-table tbody tr').length,
      }))
    );
  } else {
    console.log('NO_ENABLED_DELETE');
  }

  // Try clicking disabled edit on built-in
  const disabledEdit = page.locator('.admin-record-table tbody tr button[disabled]', { hasText: '编辑' }).first();
  if ((await disabledEdit.count()) > 0) {
    const box = await disabledEdit.boundingBox();
    console.log('DISABLED_EDIT_BOX', box);
    await disabledEdit.click({ force: true }).catch((e) => console.log('force click', e.message));
    await page.waitForTimeout(300);
    console.log(
      'AFTER_DISABLED_CLICK',
      await page.evaluate(() => ({
        dialogOpen: !!document.querySelector('.admin-dialog'),
        msg: document.querySelector('.admin-inline-message')?.textContent || '',
      }))
    );
  }

  console.log('NETS', nets);
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
