/**
 * Optional preload: force ignoreHTTPSErrors on every Playwright browser context.
 * Used only for local Phase 4B isolation HTTPS self-signed drills.
 * node -r ./tools/e2e-ignore-https-preload.cjs <suite.cjs>
 */
'use strict';
const Module = require('module');
const origRequire = Module.prototype.require;
Module.prototype.require = function (id) {
  const mod = origRequire.apply(this, arguments);
  if (id === 'playwright' || id === 'playwright-core') {
    if (mod && mod.chromium && !mod.chromium.__e2eIgnoreHttpsPatched) {
      const launch = mod.chromium.launch.bind(mod.chromium);
      mod.chromium.launch = async function patchedLaunch(...args) {
        const browser = await launch(...args);
        const newContext = browser.newContext.bind(browser);
        browser.newContext = function patchedContext(opts = {}) {
          return newContext(Object.assign({ ignoreHTTPSErrors: true }, opts));
        };
        return browser;
      };
      mod.chromium.__e2eIgnoreHttpsPatched = true;
    }
  }
  return mod;
};
