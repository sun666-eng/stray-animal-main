'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');

const root = path.resolve(__dirname, '..');
const staticRoot = path.join(root, 'src/main/resources/static');
const outputDir = path.join(root, 'output/playwright');
const baseUrl = 'http://phase3c.test';

const status = {
  configured: true, enabled: true, apiKeyConfigured: true, canConfigure: true,
  connected: true, connectionStatus: 'connected', connectionMessage: '真实模型连接成功',
  baseUrl: 'https://api.example.com', model: 'test-model', apiKeyHint: '••••1234'
};
const initialAutomation = {
  config: { enabled: false, mode: 'shadow', maxBatch: 3, version: 1, updatedAt: '2026-07-28 19:00:00' },
  recentRuns: [], superAdminOnly: true,
  safetyNotice: '只在超级管理员手动运行时工作'
};
const completedRun = {
  run: { id: '9001', mode: 'guarded', status: 'completed', candidateCount: 2,
    shadowCount: 0, autoApprovedCount: 1, manualCount: 1, failedCount: 0,
    detail: '运行完成；自动驳回数固定为 0', startedAt: '2026-07-28 19:05:00', completedAt: '2026-07-28 19:05:08' },
  items: [
    { id: '9101', animalId: '10011', applicantId: '43', recommendation: 'approve', riskLevel: 'low',
      hardGatePass: true, missingInfo: '无', rationale: '硬规则全部满足', outcome: 'auto_approved',
      reason: '受控模式自动通过；执行前已重新校验配置、硬规则和申请状态' },
    { id: '9102', animalId: '10012', applicantId: '44', recommendation: 'manual_review', riskLevel: 'medium',
      hardGatePass: false, missingInfo: '需要补充材料', rationale: '资料不完整', outcome: 'manual_review',
      reason: '<img src=x onerror=alert(1)> 模型指出仍有缺失信息，已转人工复核' }
  ]
};

function mime(file) {
  if (file.endsWith('.css')) return 'text/css; charset=utf-8';
  if (file.endsWith('.js')) return 'application/javascript; charset=utf-8';
  if (file.endsWith('.html')) return 'text/html; charset=utf-8';
  return 'application/octet-stream';
}

async function installRoutes(page, captured) {
  await page.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const pathname = url.pathname;
    if (pathname === '/page/end/admin_agent.html' || pathname.startsWith('/css/') || pathname.startsWith('/js/')) {
      const file = path.join(staticRoot, pathname.replace(/^\//, ''));
      if (fs.existsSync(file)) return route.fulfill({ status: 200, contentType: mime(file), body: fs.readFileSync(file) });
    }
    let data = null;
    if (pathname === '/api/user/me') {
      data = { id: 1, username: 'admin', avatar: '', role: [{ id: 1 }], permission: [
        { flag: 'admin_agent', path: '/page/end/admin_agent.html' },
        { flag: 'adopt', path: '/page/end/adopt.html' }, { flag: 'animal', path: '/page/end/animal.html' }
      ] };
    } else if (pathname === '/api/admin-agent/status') data = status;
    else if (pathname === '/api/admin-agent/overview') data = { pending_adoptions: 2, pending_proofs: 0,
      pending_volunteers: 1, open_rescues: 3, available_animals: 4 };
    else if (pathname === '/api/admin-agent/conversations') data = [];
    else if (pathname === '/api/admin-agent/automation/status') data = initialAutomation;
    else if (pathname === '/api/admin-agent/automation/config') {
      captured.configCalls += 1;
      captured.configBody = request.postDataJSON();
      if (!captured.configBody.acknowledgeNoAutoReject || !captured.configBody.acknowledgeHumanFallback
          || captured.configBody.confirmationText !== '启用受控自动通过') {
        return route.fulfill({ status: 400, contentType: 'application/json; charset=utf-8',
          body: JSON.stringify({ code: '400', msg: '启用受控模式前必须确认两项安全边界' }) });
      }
      data = { ...initialAutomation, config: { enabled: true, mode: 'guarded', maxBatch: 2,
        version: 2, updatedAt: '2026-07-28 19:04:00' } };
    } else if (pathname === '/api/admin-agent/automation/run') {
      captured.runCalls += 1;
      captured.runBody = request.postDataJSON();
      data = completedRun;
    } else if (pathname === '/api/admin-agent/automation/runs') data = [completedRun.run];
    else if (pathname === '/api/admin-agent/automation/runs/9001') data = completedRun;
    else if (pathname.startsWith('/api/adopt/audit/')) {
      captured.directAuditCalls += 1; data = true;
    } else {
      return route.fulfill({ status: 404, contentType: 'application/json; charset=utf-8', body: '{}' });
    }
    return route.fulfill({ status: 200, contentType: 'application/json; charset=utf-8',
      body: JSON.stringify({ code: '0', data }) });
  });
}

async function runViewport(browser, viewport, name, exercise) {
  const page = await browser.newPage({ viewport });
  const captured = { configCalls: 0, runCalls: 0, directAuditCalls: 0, configBody: null, runBody: null };
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await installRoutes(page, captured);
  await page.goto(`${baseUrl}/page/end/admin_agent.html`, { waitUntil: 'domcontentloaded' });
  const open = page.getByRole('button', { name: /受控自动审核/ });
  await open.waitFor();
  await open.click();
  await page.getByRole('heading', { name: '受控自动审核' }).waitFor();

  assert.equal(await page.locator('.admin-agent-mode-grid').evaluate(el => getComputedStyle(el).display), 'grid');
  assert.equal(await page.getByText('自动驳回永久为 0').count(), 1);
  assert.equal(await page.locator('.admin-agent-automation-actions .ui-button.is-primary').isDisabled(), true);

  if (exercise) {
    await page.locator('.admin-agent-automation-switch').click();
    await page.locator('.admin-agent-mode-card.is-guarded').click();
    await page.locator('#automationBatch').selectOption('2');
    const save = page.getByRole('button', { name: '保存控制设置' });
    const run = page.getByRole('button', { name: '手动运行一次' });
    assert.equal(await save.isEnabled(), true);
    assert.equal(await run.isDisabled(), true);

    await save.click();
    await page.getByText('启用受控模式前必须确认两项安全边界').waitFor();
    await page.locator('.admin-agent-guarded-checks input[type="checkbox"]').nth(0).check();
    await page.locator('.admin-agent-guarded-checks input[type="checkbox"]').nth(1).check();
    await page.locator('#automationPhrase').fill('启动受控自动通过');
    await save.click();
    await page.getByText(/第 2 个字应为“用”/).first().waitFor();
    assert.equal(captured.configCalls, 1);
    assert.equal(await page.locator('#automationPhrase').getAttribute('aria-invalid'), 'true');
    await page.locator('#automationPhrase').fill('启用受控自动通过');
    await page.getByText('确认短语一致，可以保存。').waitFor();
    await save.click();
    await page.getByText('控制设置已保存').waitFor();
    assert.equal(await run.isEnabled(), true);
    await run.click();
    await page.getByText(/本批次完成：自动通过 1，转人工 1，自动驳回 0/).waitFor();
    await page.getByText('动物 #10011 · 申请人 #43').waitFor();

    assert.equal(captured.configCalls, 2);
    assert.equal(captured.configBody.mode, 'guarded');
    assert.equal(captured.configBody.maxBatch, 2);
    assert.equal(captured.runCalls, 1);
    assert.match(captured.runBody.requestId, /^[A-Za-z0-9_-]{1,64}$/);
    assert.equal(captured.directAuditCalls, 0);
    assert.equal(await page.locator('.admin-agent-run-detail img[src="x"]').count(), 0);
  }

  await page.locator('.admin-agent-automation-dialog').scrollIntoViewIfNeeded();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), true);
  assert.deepEqual(errors, []);
  await page.screenshot({ path: path.join(outputDir, name), fullPage: true });
  await page.close();
}

(async () => {
  fs.mkdirSync(outputDir, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    await runViewport(browser, { width: 1440, height: 1000 }, 'admin-agent-phase3c-desktop.png', true);
    await runViewport(browser, { width: 912, height: 1326 }, 'admin-agent-phase3c-tablet.png', false);
    await runViewport(browser, { width: 390, height: 844 }, 'admin-agent-phase3c-mobile.png', false);
    console.log('admin-agent-phase3c-ui: PASS');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
