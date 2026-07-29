'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');

const baseUrl = process.env.PHASE3C_BASE_URL || 'http://localhost:9999';
const username = process.env.PHASE3C_ADMIN || 'admin';
const password = process.env.PHASE3C_ADMIN_PASS || 'admin';
const output = path.resolve(__dirname, '../output/playwright/admin-agent-phase3c-live.png');

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const login = await context.request.post(`${baseUrl}/api/user/login`, {
      data: { username, password }, headers: { 'Content-Type': 'application/json' }
    });
    assert.equal(login.status(), 200);
    assert.equal((await login.json()).code, '0');
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${baseUrl}/page/end/admin_agent.html`, { waitUntil: 'domcontentloaded' });
    const button = page.getByRole('button', { name: /受控自动审核/ });
    await button.waitFor();
    await button.click();
    await page.getByRole('heading', { name: '受控自动审核' }).waitFor();
    assert.equal(await page.locator('.admin-agent-automation-dialog').count(), 1);
    assert.equal(await page.getByText('自动驳回永久为 0').count(), 1);
    assert.equal(await page.locator('.admin-agent-automation-actions .ui-button.is-primary').isDisabled(), true);
    assert.deepEqual(errors, []);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    await page.screenshot({ path: output, fullPage: true });
    console.log('admin-agent-phase3c-live-smoke: PASS (read-only; no model call or mutation)');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
