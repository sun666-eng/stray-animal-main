'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');

const baseUrl = process.env.PETCARE_TEST_BASE_URL || 'http://localhost:9999';
const outputDir = path.resolve(__dirname, '../output/playwright');
const answer = [
  '根据查询，您在「归途计划」通过领养审核的动物是**小白（猫咪）**，并非小狗哦🐱。如果您想了解**通用的小狗健康增重方法**，以下建议供参考：',
  '',
  '---',
  '',
  '**🥩 让小狗增重不伤肠胃的要点**',
  '',
  '1. **少量多餐**',
  '   - 每天喂 **3~4 次**，单次只给七八分饱。',
  '',
  '2. **提高食物营养密度**',
  '   - 可少量添加 **水煮鸡胸肉、蛋黄**。',
  '   - 不要喂人类油腻剩菜。',
  '',
  '3. **定时定量，不要自助餐**',
  '   - 15 分钟内吃完收起。',
  '',
  '⚠️ **重要提醒**：不能替代兽医诊断，异常请及时就医。<img src=x onerror=alert(1)>'
].join('\n');

async function mockApi(page) {
  await page.route('**/page/front/pet_care.html', async route => {
    const html = fs.readFileSync(path.resolve(__dirname, '../src/main/resources/static/page/front/pet_care.html'), 'utf8');
    await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html });
  });
  await page.route('**/api/**', async route => {
    const pathname = new URL(route.request().url()).pathname;
    let data = null;
    if (pathname === '/api/user/me') {
      data = { id: 43, username: 'markdown-test', role: { id: 2 }, permission: [] };
    } else if (pathname === '/api/petcare/topics') {
      data = ['新手养猫需要准备什么？'];
    } else if (pathname === '/api/petcare/config') {
      data = { enabled: false, connected: false, connectionStatus: 'untested', personalConfigured: false };
    } else if (pathname === '/api/petcare/conversations') {
      data = [];
    }
    await route.fulfill({ status: 200, contentType: 'application/json; charset=utf-8', body: JSON.stringify({ code: '0', data }) });
  });
}

async function checkViewport(browser, viewport, fileName) {
  const page = await browser.newPage({ viewport });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await mockApi(page);
  await page.goto(`${baseUrl}/page/front/pet_care.html`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.querySelector('#app') && document.querySelector('#app').__vue__);
  await page.evaluate(sample => {
    const vm = document.querySelector('#app').__vue__;
    vm.historyPanelOpen = false;
    vm.messages = [{ role: 'assistant', text: sample, time: new Date().toISOString(), source: 'ai' }];
  }, answer);
  await page.waitForSelector('.petcare-rich-answer ol > li');

  assert.equal(await page.locator('.petcare-rich-answer ol > li').count(), 3);
  assert.equal(await page.locator('.petcare-rich-answer ol > li').nth(1).locator('ul > li').count(), 2);
  assert.equal(await page.locator('.petcare-rich-answer hr').count(), 1);
  assert.equal(await page.locator('.petcare-rich-answer strong').count() > 0, true);
  assert.equal(await page.locator('.petcare-rich-answer img').count(), 0);
  const visible = await page.locator('.petcare-rich-answer').innerText();
  assert.equal(visible.includes('**'), false);
  assert.equal(visible.split('\n').some(line => line.trim() === '---'), false);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), true);
  assert.deepEqual(errors, []);

  await page.screenshot({ path: path.join(outputDir, fileName), fullPage: true });
  await page.close();
}

(async () => {
  fs.mkdirSync(outputDir, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    await checkViewport(browser, { width: 1280, height: 900 }, 'pet-care-markdown-desktop.png');
    await checkViewport(browser, { width: 390, height: 844 }, 'pet-care-markdown-mobile.png');
    console.log('pet-care-markdown-visual: PASS');
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exit(1);
});
