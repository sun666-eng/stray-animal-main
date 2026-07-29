/**
 * Real Chrome/Playwright UI regression for the PetCare assistant.
 *
 * This intentionally uses the login, config, test, and ask controls in the page. It does not
 * seed cookies or mutate PetCare configuration through Playwright's request API.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright';

const usage = `
Usage:
  node tools/petcare-browser-ui.mjs \\
    --base-url http://localhost:9999 \\
    --username <account> --password <password> --confirm-account <account> \\
    --api-base-url http://127.0.0.1:18080/v1 \\
    --api-key <key> --model <model> \\
    --artifact-dir tools/petcare-artifacts/browser

Options:
  --headed                    Show Chrome instead of running headless.
  --browser-channel <name>    Playwright browser channel; default: chrome.
  --timeout-ms <number>       UI/action timeout; default: 30000.

The selected account's PetCare config is cleared and rewritten. --confirm-account must exactly
match --username. Values may alternatively come from BASE_URL, PETCARE_USER, PETCARE_PASSWORD,
PETCARE_CONFIRM_ACCOUNT, PETCARE_API_BASE_URL, PETCARE_API_KEY, PETCARE_MODEL, ARTIFACT_DIR,
BROWSER_CHANNEL, and HEADED.
`.trim();

function parseArgs(argv) {
  const values = {};
  const booleans = new Set(['headed', 'help']);
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) throw new Error(`Unexpected argument: ${token}`);
    const name = token.slice(2);
    if (booleans.has(name)) {
      values[name] = true;
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for --${name}`);
    values[name] = value;
    index += 1;
  }
  return values;
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log(usage);
  process.exit(0);
}

const options = {
  baseUrl: (args['base-url'] || process.env.BASE_URL || 'http://localhost:9999').replace(/\/+$/, ''),
  username: args.username || process.env.PETCARE_USER || '',
  password: args.password || process.env.PETCARE_PASSWORD || '',
  confirmAccount: args['confirm-account'] || process.env.PETCARE_CONFIRM_ACCOUNT || '',
  apiBaseUrl: (args['api-base-url'] || process.env.PETCARE_API_BASE_URL || '').replace(/\/+$/, ''),
  apiKey: args['api-key'] || process.env.PETCARE_API_KEY || '',
  model: args.model || process.env.PETCARE_MODEL || '',
  artifactDir: path.resolve(args['artifact-dir'] || process.env.ARTIFACT_DIR || 'tools/petcare-artifacts/browser'),
  browserChannel: args['browser-channel'] || process.env.BROWSER_CHANNEL || 'chrome',
  headed: Boolean(args.headed || /^(1|true|yes)$/i.test(process.env.HEADED || '')),
  timeoutMs: Number(args['timeout-ms'] || 30000),
};

for (const [name, value] of Object.entries({
  username: options.username,
  password: options.password,
  'api-base-url': options.apiBaseUrl,
  'api-key': options.apiKey,
  model: options.model,
})) {
  if (!value) throw new Error(`--${name} is required\n\n${usage}`);
}
if (options.confirmAccount !== options.username) {
  throw new Error('--confirm-account must exactly match --username because this test clears and rewrites that account configuration');
}
if (!Number.isFinite(options.timeoutMs) || options.timeoutMs < 1000 || options.timeoutMs > 120000) {
  throw new Error('--timeout-ms must be between 1000 and 120000');
}

const viewports = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'mobile', width: 390, height: 844 },
];
const startedAt = new Date();
const assertions = [];
const diagnostics = [];
const screenshots = [];
const observedConfigPosts = [];
let browser;
let fatalError = null;

fs.mkdirSync(options.artifactDir, { recursive: true });

function redact(value) {
  let text = String(value ?? '');
  for (const secret of [options.password, options.apiKey]) {
    if (secret) text = text.split(secret).join('[REDACTED]');
  }
  return text;
}

function check(name, condition, detail) {
  const item = {
    name,
    status: condition ? 'PASS' : 'FAIL',
    detail: redact(detail),
    at: new Date().toISOString(),
  };
  assertions.push(item);
  console.log(`${item.status.padEnd(4)} ${name} :: ${item.detail}`);
  return condition;
}

function attachDiagnostics(page, label) {
  page.on('console', (message) => {
    if (message.type() === 'error') {
      const onLogin = new URL(page.url()).pathname.endsWith('/login.html');
      const expectedAnonymousProbe = onLogin &&
        /^Failed to load resource: the server responded with a status of 401 \(\)$/.test(message.text());
      if (expectedAnonymousProbe) return;
      diagnostics.push({ type: 'console', page: label, message: redact(message.text()) });
    }
  });
  page.on('pageerror', (error) => {
    diagnostics.push({ type: 'pageerror', page: label, message: redact(error.stack || error.message) });
  });
  page.on('requestfailed', (request) => {
    diagnostics.push({
      type: 'requestfailed',
      page: label,
      method: request.method(),
      url: request.url(),
      message: redact(request.failure()?.errorText || 'unknown network failure'),
    });
  });
  page.on('response', (response) => {
    if (response.status() >= 400) {
      const target = new URL(response.url());
      const isExpectedAnonymousProbe = response.status() === 401 &&
        target.pathname === '/api/user/me' && new URL(page.url()).pathname.endsWith('/login.html');
      if (isExpectedAnonymousProbe) return;
      diagnostics.push({
        type: 'http',
        page: label,
        method: response.request().method(),
        url: response.url(),
        status: response.status(),
      });
    }
  });
  page.on('request', (request) => {
    const target = new URL(request.url());
    if (request.method() !== 'POST' || target.pathname !== '/api/petcare/config') return;
    try {
      const body = request.postDataJSON();
      observedConfigPosts.push({
        page: label,
        enabled: body.enabled,
        baseUrl: body.baseUrl,
        model: body.model,
        apiKeyEmpty: body.apiKey === '',
        apiKeyLength: typeof body.apiKey === 'string' ? body.apiKey.length : null,
      });
    } catch (error) {
      observedConfigPosts.push({ page: label, parseError: redact(error.message) });
    }
  });
}

async function screenshot(page, name, fullPage = true) {
  const file = path.join(options.artifactDir, `${name}.png`);
  await page.screenshot({ path: file, fullPage });
  screenshots.push(path.basename(file));
}

async function loginThroughUi(page) {
  await page.goto(`${options.baseUrl}/page/front/login.html`, { waitUntil: 'domcontentloaded' });
  await page.locator('#loginUsername').waitFor({ state: 'visible' });
  check('login-username-autocomplete', await page.locator('#loginUsername').getAttribute('autocomplete') === 'username', 'username autocomplete is declared');
  check('login-password-autocomplete', await page.locator('#loginPassword').getAttribute('autocomplete') === 'current-password', 'current-password autocomplete is declared');

  const filled = await page.evaluate(({ username, password }) => {
    function setAutofillValue(selector, value) {
      const input = document.querySelector(selector);
      if (!input) return false;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
    return {
      username: setAutofillValue('input[autocomplete="username"]', username),
      password: setAutofillValue('input[autocomplete="current-password"]', password),
    };
  }, { username: options.username, password: options.password });
  check('login-password-manager-fill', filled.username && filled.password, 'simulated autocomplete fill reached both login controls');

  const captcha = await page.evaluate(() => globalThis.verifyCode?.options?.code || '');
  if (!captcha) throw new Error('Could not read the page-generated captcha for UI login');
  await page.locator('#loginCode').fill(captcha);
  await Promise.all([
    page.waitForURL((url) => !url.pathname.endsWith('/login.html'), { timeout: options.timeoutMs }),
    page.locator('.ui-auth-submit').click(),
  ]);
  check('login-ui-completed', !new URL(page.url()).pathname.endsWith('/login.html'), `navigated to ${new URL(page.url()).pathname}`);
}

async function openPetCare(page) {
  await page.goto(`${options.baseUrl}/page/front/pet_care.html`, { waitUntil: 'domcontentloaded' });
  await page.locator('#authWait').waitFor({ state: 'hidden' });
  await page.locator('.petcare-config-button').waitFor({ state: 'visible' });
  await page.waitForFunction(() => document.querySelector('.petcare-config-button')?.disabled === false);
}

async function openConfig(page) {
  await page.locator('.petcare-config-button').click();
  await page.locator('.petcare-config-dialog').waitFor({ state: 'visible' });
  await page.waitForFunction(() => !document.querySelector('.petcare-config-dialog button[type="submit"]')?.disabled);
}

async function closeConfig(page) {
  const close = page.locator('.ui-dialog-head button', { hasText: '关闭' });
  if (await close.isVisible().catch(() => false)) {
    await close.click();
    await page.locator('.petcare-config-dialog').waitFor({ state: 'detached' });
  }
}

async function clearExistingConfigThroughUi(page) {
  await openConfig(page);
  const clear = page.locator('.petcare-clear-button');
  if (await clear.count()) {
    page.once('dialog', (dialog) => dialog.accept());
    await clear.click();
    await page.waitForFunction(() => !document.querySelector('.petcare-clear-button'));
    check('config-clear-ui', true, 'existing account config cleared through confirmation UI');
  } else {
    check('config-clear-ui', true, 'account already had no personal config');
  }
  await closeConfig(page);
}

async function firstConfigurationFlow(page) {
  await openConfig(page);
  check('config-key-autocomplete', await page.locator('#aiApiKey').getAttribute('autocomplete') === 'new-password', 'API key uses new-password autocomplete');
  check('config-key-password-type', await page.locator('#aiApiKey').getAttribute('type') === 'password', 'API key is initially masked');
  await screenshot(page, 'desktop-config-empty');
  await page.locator('#aiBaseUrl').fill(options.apiBaseUrl);
  await page.locator('#aiModel').fill(options.model);
  await page.locator('#aiApiKey').fill(options.apiKey);

  const postStart = observedConfigPosts.length;
  await page.locator('.petcare-config-dialog button[type="submit"]').click();
  await page.locator('.petcare-saved-secret').waitFor({ state: 'visible' });
  await page.waitForFunction(() => !document.querySelector('.petcare-config-dialog button[type="submit"]')?.disabled);
  check('config-first-save-posted-once', observedConfigPosts.length - postStart === 1, `config POST count=${observedConfigPosts.length - postStart}`);
  check('config-first-save-had-key', observedConfigPosts.at(-1)?.apiKeyLength === options.apiKey.length, 'first save carried the entered key once');
  check('config-saved-key-not-rendered', await page.locator('#aiApiKey').count() === 0, 'saved state removes the API key input');
  check('config-saved-indicator', (await page.locator('.petcare-saved-secret').innerText()).includes('已按账号加密保存'), 'saved-key indicator is visible');
  await screenshot(page, 'desktop-config-saved');

  const storageContainsKey = await page.evaluate((secret) => {
    const values = [];
    for (const storage of [localStorage, sessionStorage]) {
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        values.push(key, storage.getItem(key));
      }
    }
    return JSON.stringify(values).includes(secret);
  }, options.apiKey);
  check('config-key-not-in-browser-storage', !storageContainsKey, 'localStorage/sessionStorage do not contain API key');

  await page.locator('.petcare-saved-secret button', { hasText: '更换 Key' }).click();
  const passwordManagerResult = await page.evaluate((replacement) => {
    const input = document.querySelector('input[autocomplete="new-password"]');
    if (!input) return { found: false, valueLength: 0 };
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, replacement);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return { found: true, valueLength: input.value.length };
  }, `${options.apiKey}-password-manager-simulation`);
  check('replacement-password-manager-fill', passwordManagerResult.found && passwordManagerResult.valueLength > 0, 'simulated new-password autofill populated only the explicit replacement control');
  await page.locator('.petcare-cancel-secret').click();
  check('replacement-cancel-restores-saved-key', await page.locator('.petcare-saved-secret').isVisible() && await page.locator('#aiApiKey').count() === 0, 'cancel discarded simulated replacement and restored saved-key state');

  const noReplacementStart = observedConfigPosts.length;
  await page.locator('.petcare-config-dialog button[type="submit"]').evaluate((button) => {
    button.click();
    button.click();
  });
  await page.waitForFunction(() => !document.querySelector('.petcare-config-dialog button[type="submit"]')?.disabled);
  const noReplacementPosts = observedConfigPosts.slice(noReplacementStart);
  check('rapid-save-single-request', noReplacementPosts.length === 1, `double click produced ${noReplacementPosts.length} config POST(s)`);
  check('saved-key-not-overwritten', noReplacementPosts.length === 1 && noReplacementPosts[0].apiKeyEmpty, 'no-replacement save sent an empty API key');
  check('saved-key-still-present', await page.locator('.petcare-saved-secret').isVisible(), 'saved-key state remains visible');

  const testButton = page.locator('.petcare-config-dialog button', { hasText: '测试连接' });
  await testButton.click();
  await page.waitForFunction(() => document.querySelector('.petcare-config-message')?.textContent?.includes('连接成功'));
  check('config-test-ui-connected', (await page.locator('.petcare-config-message').innerText()).includes('连接成功'), 'connection tested through UI');
  await screenshot(page, 'desktop-config-connected');
  await closeConfig(page);
  check('agent-state-connected', (await page.locator('.petcare-agent-state').innerText()).includes('已连接'), 'page-level status shows connected');
}

async function askThroughUi(page) {
  const assistantMessages = page.locator('.ui-chat-message:not(.is-self) .ui-chat-bubble');
  const before = await assistantMessages.count();
  await page.locator('#petCareInput').fill('新手养猫需要准备什么？');
  await page.locator('.ui-chat-compose button[type="submit"]').click();
  await page.waitForFunction(
    (count) => document.querySelectorAll('.ui-chat-message:not(.is-self) .ui-chat-bubble').length > count &&
      !document.querySelector('.ui-chat-compose button[type="submit"]')?.textContent?.includes('请稍候'),
    before,
    { timeout: options.timeoutMs },
  );
  check('ask-ui-answer', await assistantMessages.count() > before, 'question submitted and answer rendered through UI');
  await screenshot(page, 'desktop-after-ask');
}

async function multiTabFlow(context, firstPage) {
  const tab2 = await context.newPage();
  const tab3 = await context.newPage();
  attachDiagnostics(tab2, 'tab-2');
  attachDiagnostics(tab3, 'tab-3');
  await Promise.all([openPetCare(tab2), openPetCare(tab3)]);
  await Promise.all([openConfig(tab2), openConfig(tab3)]);
  const savedStates = await Promise.all([
    tab2.locator('.petcare-saved-secret').isVisible(),
    tab3.locator('.petcare-saved-secret').isVisible(),
  ]);
  check('multi-tab-saved-config-visible', savedStates.every(Boolean), 'both additional tabs loaded the account-scoped saved-key state');

  await tab2.locator('#aiBaseUrl').fill(`${options.apiBaseUrl}/unsaved-tab-change`);
  await tab3.reload({ waitUntil: 'domcontentloaded' });
  await tab3.locator('#authWait').waitFor({ state: 'hidden' });
  await openConfig(tab3);
  check('multi-tab-unsaved-form-isolated', await tab3.locator('#aiBaseUrl').inputValue() === options.apiBaseUrl, 'unsaved tab-local edit did not leak into another tab');
  await screenshot(tab2, 'multi-tab-unsaved-edit');
  await screenshot(tab3, 'multi-tab-persisted-config');
  await Promise.all([tab2.close(), tab3.close()]);
  check('multi-tab-primary-page-alive', !firstPage.isClosed(), 'primary workflow page remained active');
}

async function measureViewport(page, viewport) {
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  await page.goto(`${options.baseUrl}/page/front/pet_care.html`, { waitUntil: 'domcontentloaded' });
  await page.locator('#authWait').waitFor({ state: 'hidden' });
  await page.locator('.petcare-config-button').waitFor({ state: 'visible' });
  const mainMetrics = await page.evaluate(() => ({
    viewportWidth: innerWidth,
    viewportHeight: innerHeight,
    documentClientWidth: document.documentElement.clientWidth,
    documentScrollWidth: document.documentElement.scrollWidth,
    bodyScrollWidth: document.body.scrollWidth,
    horizontalOverflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) > innerWidth + 2,
  }));
  await screenshot(page, `${viewport.name}-main`);
  await openConfig(page);
  const dialogMetrics = await page.locator('.petcare-config-dialog').evaluate((dialog) => {
    const rect = dialog.getBoundingClientRect();
    const style = getComputedStyle(dialog);
    return {
      rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height },
      clientWidth: dialog.clientWidth,
      scrollWidth: dialog.scrollWidth,
      clientHeight: dialog.clientHeight,
      scrollHeight: dialog.scrollHeight,
      overflowX: style.overflowX,
      overflowY: style.overflowY,
      exceedsViewportHorizontally: rect.left < -2 || rect.right > innerWidth + 2,
      exceedsViewportVertically: rect.top < -2 || rect.bottom > innerHeight + 2,
      clipsHorizontally: dialog.scrollWidth > dialog.clientWidth + 2,
    };
  });
  check(`${viewport.name}-main-no-horizontal-overflow`, !mainMetrics.horizontalOverflow, JSON.stringify(mainMetrics));
  check(`${viewport.name}-dialog-no-horizontal-overflow`, !dialogMetrics.exceedsViewportHorizontally && !dialogMetrics.clipsHorizontally, JSON.stringify(dialogMetrics));
  check(`${viewport.name}-dialog-vertical-access`, !dialogMetrics.exceedsViewportVertically || ['auto', 'scroll'].includes(dialogMetrics.overflowY), JSON.stringify(dialogMetrics));
  await screenshot(page, `${viewport.name}-config`);
  return { viewport, main: mainMetrics, dialog: dialogMetrics };
}

async function run() {
  browser = await chromium.launch({ channel: options.browserChannel, headless: !options.headed });
  const context = await browser.newContext({
    viewport: { width: viewports[0].width, height: viewports[0].height },
    acceptDownloads: false,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(options.timeoutMs);
  page.setDefaultNavigationTimeout(options.timeoutMs);
  attachDiagnostics(page, 'primary');

  await loginThroughUi(page);
  await openPetCare(page);
  await clearExistingConfigThroughUi(page);
  await firstConfigurationFlow(page);
  await askThroughUi(page);
  await multiTabFlow(context, page);

  const measurements = [];
  for (const viewport of viewports) measurements.push(await measureViewport(page, viewport));
  return measurements;
}

let measurements = [];
try {
  measurements = await run();
} catch (error) {
  fatalError = redact(error.stack || error.message);
  check('fatal', false, fatalError);
} finally {
  if (browser) await browser.close().catch(() => {});
  const finishedAt = new Date();
  const report = {
    schemaVersion: 1,
    script: 'petcare-browser-ui.mjs',
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationSeconds: Number(((finishedAt - startedAt) / 1000).toFixed(3)),
    target: {
      baseUrl: options.baseUrl,
      username: options.username,
      apiBaseUrl: options.apiBaseUrl,
      model: options.model,
      browserChannel: options.browserChannel,
      headed: options.headed,
    },
    summary: {
      pass: assertions.filter((item) => item.status === 'PASS').length,
      fail: assertions.filter((item) => item.status === 'FAIL').length,
      diagnosticErrors: diagnostics.length,
    },
    assertions,
    diagnostics,
    measurements,
    configPosts: observedConfigPosts,
    screenshots,
    fatalError,
  };
  const jsonPath = path.join(options.artifactDir, 'browser-ui-report.json');
  const textPath = path.join(options.artifactDir, 'browser-ui-report.txt');
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  const text = [
    'PetCare browser UI report',
    `Started: ${report.startedAt}`,
    `Finished: ${report.finishedAt}`,
    `PASS=${report.summary.pass} FAIL=${report.summary.fail} DIAGNOSTICS=${report.summary.diagnosticErrors}`,
    '',
    ...assertions.map((item) => `${item.status} ${item.name} :: ${item.detail}`),
    '',
    ...diagnostics.map((item) => `DIAGNOSTIC ${item.type} ${item.page} :: ${item.status || ''} ${item.url || ''} ${item.message || ''}`.trim()),
  ].join('\n');
  fs.writeFileSync(textPath, `${text}\n`, 'utf8');
  console.log(`Artifacts: ${jsonPath}; ${textPath}`);
}

if (assertions.some((item) => item.status === 'FAIL') || diagnostics.length > 0) process.exit(1);
