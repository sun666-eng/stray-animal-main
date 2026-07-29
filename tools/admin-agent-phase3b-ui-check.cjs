'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');

const baseUrl = process.env.PHASE3B_BASE_URL || 'http://localhost:9999';
const outputDir = path.resolve(__dirname, '../output/playwright');
const htmlPath = path.resolve(__dirname, '../src/main/resources/static/page/end/adopt.html');

const record = {
  aid: '10011', uid: '43', aname: '咪咪', uname: '测试申请人', tel: '13800000000',
  age: 26, gender: '女', occupation: '教师', income: '稳定', maritalstatus: 0,
  fixresident: 1, experience: 1, petnum: 0, familyagree: 1,
  location: '<img src=x onerror=alert(1)> 测试地址', vstate: 0
};
const draft = {
  id: '7001', animalId: '10011', applicantId: '43', recommendation: 'manual_review',
  riskLevel: 'medium', rationale: '固定住所、家庭同意和养宠经验均已记录。',
  missingInfo: '需要管理员结合完整问卷进行人工确认。',
  reviewNote: '请复核原始资料后作出最终决定。', model: 'test-model', status: 'draft', version: 3
};

async function installRoutes(page, captured) {
  await page.route('**/page/end/adopt.html', async route => route.fulfill({
    status: 200, contentType: 'text/html; charset=utf-8', body: fs.readFileSync(htmlPath, 'utf8')
  }));
  await page.route('**/api/**', async route => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    let data = null;
    if (pathname === '/api/user/me') {
      data = { id: 1, username: 'admin', role: { id: 1 }, permission: [
        { flag: 'admin_agent' }, { flag: 'adopt' }, { flag: 'visit' }
      ] };
    } else if (pathname === '/api/adopt/page') {
      data = { records: [record], current: 1, total: 1, pages: 1 };
    } else if (pathname === '/api/admin-agent/adoption-drafts/generate') {
      data = draft;
    } else if (pathname === '/api/admin-agent/adoption-drafts/7001/finalize') {
      captured.finalizeCalls += 1;
      captured.finalizeBody = request.postDataJSON();
      captured.finalizeRequestIds.push(captured.finalizeBody.requestId);
      if (captured.finalizeCalls === 1) {
        await route.fulfill({ status: 504, contentType: 'application/json; charset=utf-8',
          body: JSON.stringify({ code: '504', msg: '模拟响应丢失' }) });
        return;
      }
      data = Object.assign({}, draft, {
        status: 'executed', version: 4, finalDecision: captured.finalizeBody.decision,
        overrideReason: captured.finalizeBody.overrideReason, finalizedAt: '2026-07-28 17:30:00'
      });
    } else if (pathname === '/api/adopt/audit/10011/43/1' || pathname === '/api/adopt/audit/10011/43/2') {
      captured.directAuditCalls += 1;
      data = true;
    }
    await route.fulfill({ status: 200, contentType: 'application/json; charset=utf-8',
      body: JSON.stringify({ code: '0', data }) });
  });
}

async function runViewport(browser, viewport, screenshotName, exerciseFlow) {
  const page = await browser.newPage({ viewport });
  const captured = { finalizeCalls: 0, directAuditCalls: 0, finalizeBody: null, finalizeRequestIds: [] };
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await installRoutes(page, captured);
  await page.goto(`${baseUrl}/page/end/adopt.html`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'AI 草稿' }).first().click();
  await page.getByRole('heading', { name: '领养审核草稿' }).waitFor();

  assert.equal(await page.locator('.admin-agent-draft-boundary').innerText().then(v => v.includes('管理员执行')), true);
  assert.equal(await page.locator('.admin-agent-finalize-panel').count(), 0);
  assert.equal(await page.locator('.admin-agent-draft-dialog img[src="x"]').count(), 0);

  if (exerciseFlow) {
    const rationale = page.locator('#aiDraftRationale');
    const original = await rationale.inputValue();
    await rationale.fill(`${original} 已编辑`);
    await page.getByRole('button', { name: '进入人工确认' }).click();
    await page.getByText('草稿内容尚未保存').waitFor();
    assert.equal(await page.locator('.admin-agent-finalize-panel').count(), 0);
    await rationale.fill(original);

    await page.getByRole('button', { name: '进入人工确认' }).click();
    await page.getByRole('heading', { name: '人工复核与最终确认' }).waitFor();
    await assertStructuredLayout(page);
    assert.match(await page.locator('.admin-agent-human-evidence').innerText(), /测试地址/);
    assert.equal(await page.locator('.admin-agent-finalize-choice input[type="radio"]:checked').count(), 0);
    const submit = page.locator('.admin-agent-finalize-actions button').last();
    assert.equal(await submit.isDisabled(), true);

    await page.locator('input[type="radio"][value="approve"]').check();
    await page.locator('#aiFinalizeReason').fill('太短');
    await page.locator('.admin-agent-finalize-ack input').nth(0).check();
    await page.locator('.admin-agent-finalize-ack input').nth(1).check();
    assert.equal(await submit.isDisabled(), true);
    await page.locator('#aiFinalizeReason').fill('管理员已复核完整资料，确认可以通过');
    assert.equal(await submit.isEnabled(), true);
    await page.locator('.admin-agent-finalize-panel').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(outputDir, 'admin-agent-phase3b-confirm-desktop.png'), fullPage: true });
    await submit.click();
    await page.getByText('模拟响应丢失').waitFor();
    assert.equal(await submit.isEnabled(), true);
    await submit.click();
    await page.getByText('人工确认已完成：领养申请已通过。').waitFor();

    assert.equal(captured.finalizeCalls, 2);
    assert.equal(captured.finalizeRequestIds[0], captured.finalizeRequestIds[1]);
    assert.equal(captured.directAuditCalls, 0);
    assert.equal(captured.finalizeBody.decision, 'approve');
    assert.equal(captured.finalizeBody.expectedVersion, 3);
    assert.equal(captured.finalizeBody.reviewedApplication, true);
    assert.equal(captured.finalizeBody.acknowledgeConsequences, true);
    assert.equal(Object.hasOwn(captured.finalizeBody, 'animalId'), false);
    assert.equal(Object.hasOwn(captured.finalizeBody, 'applicantId'), false);
  } else {
    await page.getByRole('button', { name: '进入人工确认' }).click();
    await page.getByRole('heading', { name: '人工复核与最终确认' }).waitFor();
    await page.locator('.admin-agent-finalize-panel').scrollIntoViewIfNeeded();
    await assertStructuredLayout(page);
  }

  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), true);
  assert.deepEqual(pageErrors, []);
  await page.screenshot({ path: path.join(outputDir, screenshotName), fullPage: true });
  await page.close();
}

async function assertStructuredLayout(page) {
  assert.equal(await page.locator('.admin-agent-finalize-grid').evaluate(el => getComputedStyle(el).display), 'grid');
  assert.equal(await page.locator('.admin-agent-finalize-choice').evaluate(el => getComputedStyle(el).display), 'grid');
  assert.equal(await page.locator('.admin-agent-draft-dialog').evaluate(el => getComputedStyle(el).display), 'flex');
}

(async () => {
  fs.mkdirSync(outputDir, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    await runViewport(browser, { width: 1440, height: 1000 }, 'admin-agent-phase3b-desktop.png', true);
    await runViewport(browser, { width: 912, height: 1326 }, 'admin-agent-phase3b-912.png', false);
    await runViewport(browser, { width: 390, height: 844 }, 'admin-agent-phase3b-mobile.png', false);
    console.log('admin-agent-phase3b-ui: PASS');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exit(1); });
