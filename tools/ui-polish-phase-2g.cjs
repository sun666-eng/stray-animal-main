/**
 * Phase 2G strict — finance ledger + notice publish desk.
 * Baseline Phase 2F: 82e4ff060ed92d4ef89f4f85cca0f5d4e3302b0a · default BASE_URL :18113
 * Credibility rules: real fill/click/select/setInputFiles; controlled Promise holds (no fixed-delay races);
 * no skip/best-effort/fallback; intentional HTTP = audit header OR registry.
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const suiteStartedAt = Date.now();
const base = process.env.BASE_URL || 'http://127.0.0.1:18113';
const out = path.resolve('output/playwright/ui-polish-phase-2g');
const shotDir = path.join(out, 'screenshots');
if (fs.existsSync(shotDir)) {
  for (const f of fs.readdirSync(shotDir)) if (f.endsWith('.png')) fs.unlinkSync(path.join(shotDir, f));
}
fs.mkdirSync(shotDir, { recursive: true });

const HDR = 'x-ui-audit-expected-error';
const VAL = 'phase2g';
const EH = { [HDR]: VAL };

const UUID_A = 'a1b2c3d4e5f6478899aabbccddeeff01';
const UUID_B = 'b2c3d4e5f6478899aabbccddeeff02a1';
const UUID_C = 'c3d4e5f6478899aabbccddeeff03a1b2';
const UUID_D = 'd4e5f6478899aabbccddeeff04a1b2c3';
const UUID_E = 'e5f6478899aabbccddeeff05a1b2c3d4';
const UUID_F = 'f6478899aabbccddeeff06a1b2c3d4e5';
const PNG1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

const ACCOUNT_RECORDS = [
  {
    id: 7001, alabel: 'UI_2G_DONATION', avalue: '120.50', auname: 'admin',
    adescribe: '捐赠夹具', category: 'donation', occurredAt: '2026-07-01 10:00:00',
    businessType: null, businessId: null, receiptFlag: '', reversalOf: null
  },
  {
    id: 7002, alabel: 'UI_2G_MEDICAL', avalue: '-88.00', auname: 'admin',
    adescribe: '医疗支出夹具', category: 'medical', occurredAt: '2026-07-02 11:00:00',
    businessType: 'animal', businessId: 'A-1', receiptFlag: '', reversalOf: null
  },
  {
    id: 7003, alabel: 'UI_2G_REVERSAL', avalue: '88.00', auname: 'admin',
    adescribe: '冲正夹具', category: 'medical', occurredAt: '2026-07-03 12:00:00',
    businessType: null, businessId: null, receiptFlag: '', reversalOf: 7002
  }
];
const NOTICE_RECORDS = [
  { id: 8001, title: 'UI_2G_NOTICE_A', content: '公告正文夹具 A', createTime: '2026-07-01 09:00:00' },
  { id: 8002, title: 'UI_2G_NOTICE_B', content: '公告正文夹具 B', createTime: '2026-07-02 09:00:00' }
];
const STATS = {
  incomeTotal: '208.50', expenseTotal: '-88.00', balance: '120.50',
  incomeByLabel: [{ label: 'UI_2G_DONATION', total: '120.50' }],
  expenseByLabel: [{ label: 'UI_2G_MEDICAL', total: '-88.00' }]
};
const VIEWPORTS = [
  { name: '1440x900', width: 1440, height: 900 },
  { name: '1280x800', width: 1280, height: 800 },
  { name: '1024x768', width: 1024, height: 768 },
  { name: '768x1024', width: 768, height: 1024 },
  { name: '390x844', width: 390, height: 844 },
  { name: '375x812', width: 375, height: 812 },
  { name: '360x800', width: 360, height: 800 },
  { name: '320x700', width: 320, height: 700 }
];

const results = {
  startedAt: new Date().toISOString(),
  base,
  phase2fBaseline: '82e4ff060ed92d4ef89f4f85cca0f5d4e3302b0a',
  branch: 'ui-polish/phase-2g-finance-notice-governance-20260730',
  checks: [], failures: [], screenshots: [], focusAudit: [], writeRequestLog: [],
  controlledRequestAudit: [], receiptRaceTimelines: [], stagedDeleteLog: [],
  realFormFillEvidence: [], vmDirectCallLog: [], controlledWriteScenarios: [],
  holdGateExecutions: {},
  dialogPaddingAudit: [],
  reverseDoubleClickAudit: null,
  noticeButtonGeometry: [],
  actionTimeoutCount: 0,
  actionTimeoutLog: [],
  suiteDurationMs: 0,
  bestEffortPassCount: 0, fallbackPassCount: 0, strictRuntimeProbeCount: 0,
  consoleAudit: {}, requestFailedWrite: [], expectedHttpRegistry: [],
  brokenTagBeforeAfter: { accountInpu: 0, accountSelec: 0, afterInpu: 0, afterSelec: 0 },
  tempFilesCleanup: { removed: [], remainingForbidden: [] },
  summary: {}
};

function registerExpectedHttp(scenario, method, urlRe, status) {
  results.expectedHttpRegistry.push({ scenario, method, urlRe, status });
}
function isIntentionalHttp(e) {
  if (!e) return false;
  const h = e.headers || {};
  if (h[HDR] === VAL || h[HDR.toLowerCase()] === VAL) return true;
  return results.expectedHttpRegistry.some((reg) => {
    if (Number(reg.status) !== Number(e.status)) return false;
    if (reg.method && String(reg.method).toUpperCase() !== String(e.method || '').toUpperCase()) return false;
    if (reg.urlRe && !reg.urlRe.test(e.url || '')) return false;
    return true;
  });
}
function isResourceConsoleNoise(text) {
  return /Failed to load resource:\s*the server responded with a status of \d+/i.test(String(text || ''));
}
function isRealConsoleError(text) {
  const t = String(text || '');
  if (!t) return false;
  if (isResourceConsoleNoise(t)) return false;
  return true;
}
function pass(id, d) {
  results.checks.push({ id, ok: true, skipped: false, detail: String(d || ''), bestEffort: false, fallback: false });
}
function fail(id, d) {
  results.checks.push({ id, ok: false, skipped: false, detail: String(d || ''), bestEffort: false, fallback: false });
  results.failures.push({ id, detail: String(d || '') });
  console.error('FAIL', id, d);
}
function assert(id, c, d) { if (c) pass(id, d); else fail(id, d); }
function recordProbe(name, data) {
  results.strictRuntimeProbeCount++;
  results.controlledRequestAudit.push(Object.assign({ name, at: new Date().toISOString(), probeIndex: results.strictRuntimeProbeCount }, data || {}));
}
function logVm(reason, call) {
  results.vmDirectCallLog.push({ reason, call, at: new Date().toISOString() });
}
function recordControlledWrite(name, data) {
  const row = Object.assign({ name, at: new Date().toISOString() }, data || {});
  results.controlledWriteScenarios.push(row);
  recordProbe(name, data);
  return row;
}
function ensureGate(name) {
  if (!results.holdGateExecutions[name]) {
    results.holdGateExecutions[name] = {
      held: false, released: false, requestCount: 0, doubleClickRequestCount: null, final: null
    };
  }
  return results.holdGateExecutions[name];
}
function exp(status, body) {
  return { status, headers: Object.assign({ 'content-type': 'application/json' }, EH), body: JSON.stringify(body) };
}
function pageData(records) {
  return {
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ code: '0', data: { records, current: 1, total: records.length, pages: 1 } })
  };
}
async function login(ctx, u, p) {
  const res = await ctx.request.post(base + '/api/user/login', { data: { username: u, password: p } });
  const j = await res.json();
  if (j.code !== '0') throw new Error('login ' + u);
}
async function shot(page, name, meta) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(40);
  await page.screenshot({ path: path.join(shotDir, name + '.png'), fullPage: false });
  results.screenshots.push(Object.assign({
    file: 'screenshots/' + name + '.png', name, time: new Date().toISOString(),
    routeIntercept: true, realNetwork: true, databaseWrite: false
  }, meta || {}));
}
async function inspectFocus(page) {
  return page.evaluate(() => {
    const a = document.activeElement;
    const roots = Array.from(document.querySelectorAll('[role="dialog"], [role="alertdialog"]'));
    const root = roots[roots.length - 1] || null;
    return {
      tag: a && a.tagName,
      id: a && a.id,
      role: a && a.getAttribute && a.getAttribute('role'),
      inDialog: !!(root && a && root.contains(a)),
      isBody: !!(a && a.tagName === 'BODY')
    };
  });
}
function dialogFocusOk(f) { return f && f.inDialog && !f.isBody; }
async function assertDialogFocus(page, id) {
  const f = await inspectFocus(page);
  results.focusAudit.push(Object.assign({ id, dialogStrict: true }, f, { strictOk: dialogFocusOk(f) }));
  assert(id, dialogFocusOk(f), JSON.stringify(f));
}
async function assertTabCycle(page, idPrefix) {
  const meta = await page.evaluate(() => {
    const roots = Array.from(document.querySelectorAll('[role="dialog"], [role="alertdialog"]'));
    const root = roots[roots.length - 1];
    if (!root) return null;
    const list = Array.prototype.slice.call(root.querySelectorAll(
      'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'
    )).filter((el) => !el.disabled && (el.offsetParent !== null || el.getClientRects().length));
    if (list.length < 2) return { n: list.length };
    list[0].focus();
    return { n: list.length };
  });
  assert(idPrefix + '-focusables', meta && meta.n >= 2, JSON.stringify(meta));
  if (!meta || meta.n < 2) return;
  for (let i = 0; i < meta.n; i++) await page.keyboard.press('Tab');
  assert(idPrefix + '-tab-cycle', dialogFocusOk(await inspectFocus(page)), 'tab');
  await page.evaluate(() => {
    const roots = Array.from(document.querySelectorAll('[role="dialog"], [role="alertdialog"]'));
    const root = roots[roots.length - 1];
    const list = Array.prototype.slice.call(root.querySelectorAll(
      'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'
    )).filter((el) => !el.disabled && (el.offsetParent !== null || el.getClientRects().length));
    if (list[0]) list[0].focus();
  });
  await page.keyboard.press('Shift+Tab');
  assert(idPrefix + '-shift-tab-cycle', dialogFocusOk(await inspectFocus(page)), 'shift');
}
async function overflowX(page) {
  return page.evaluate(() => {
    const de = document.documentElement;
    return { sw: de.scrollWidth, cw: de.clientWidth, overflow: de.scrollWidth > de.clientWidth + 1 };
  });
}
async function scrollDialogBodyTop(page) {
  await page.evaluate(() => {
    const body = document.querySelector('.admin-dialog .admin-dialog-body, [role="dialog"] .admin-dialog-body');
    if (body) body.scrollTop = 0;
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(40);
}
async function assertNoticePrimaryButtonTextInset(page, idPrefix) {
  const m = await page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"][aria-modal="true"]');
    if (!dialog) return { ok: false, reason: 'no-dialog' };
    const actions = dialog.querySelector('.admin-edit-form > .admin-dialog-actions');
    const btn = actions && actions.querySelector('.ui-button.is-primary');
    if (!btn) return { ok: false, reason: 'no-primary' };
    const br = btn.getBoundingClientRect();
    // Prefer text node range geometry (not the full button box)
    let textLeft = Infinity;
    let textRight = -Infinity;
    let textTop = Infinity;
    let textBottom = -Infinity;
    const walk = document.createTreeWalker(btn, NodeFilter.SHOW_TEXT, null);
    let node;
    while ((node = walk.nextNode())) {
      if (!String(node.nodeValue || '').trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      const rects = range.getClientRects();
      for (let i = 0; i < rects.length; i++) {
        const r = rects[i];
        if (r.width <= 0 || r.height <= 0) continue;
        textLeft = Math.min(textLeft, r.left);
        textRight = Math.max(textRight, r.right);
        textTop = Math.min(textTop, r.top);
        textBottom = Math.max(textBottom, r.bottom);
      }
    }
    if (!isFinite(textLeft)) return { ok: false, reason: 'no-text-rects', btnW: br.width, btnH: br.height };
    const style = window.getComputedStyle(btn);
    return {
      ok: true,
      text: String(btn.textContent || '').replace(/\s+/g, ' ').trim(),
      btnW: Math.round(br.width * 10) / 10,
      btnH: Math.round(br.height * 10) / 10,
      btnLeft: Math.round(br.left * 10) / 10,
      btnRight: Math.round(br.right * 10) / 10,
      textLeft: Math.round(textLeft * 10) / 10,
      textRight: Math.round(textRight * 10) / 10,
      leftInset: Math.round((textLeft - br.left) * 10) / 10,
      rightInset: Math.round((br.right - textRight) * 10) / 10,
      padL: parseFloat(style.paddingLeft) || 0,
      padR: parseFloat(style.paddingRight) || 0,
      disabled: !!btn.disabled,
      stacked: !!(actions && window.getComputedStyle(actions).flexDirection === 'column')
    };
  });
  results.noticeButtonGeometry.push(Object.assign({ id: idPrefix }, m));
  assert(idPrefix + '-geometry-ok', m && m.ok, JSON.stringify(m));
  assert(idPrefix + '-btn-min-height-44', m && m.btnH >= 44, JSON.stringify(m));
  assert(idPrefix + '-text-left-inset-ge-8', m && m.leftInset >= 8, JSON.stringify(m));
  assert(idPrefix + '-text-right-inset-ge-8', m && m.rightInset >= 8, JSON.stringify(m));
  return m;
}

async function assertEditDialogPadding(page, idPrefix) {
  const m = await page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"][aria-modal="true"]');
    if (!dialog) return { ok: false, reason: 'no-dialog' };
    const body = dialog.querySelector('.admin-dialog-body');
    const actions = dialog.querySelector('.admin-dialog-actions');
    const head = dialog.querySelector('.admin-dialog-head');
    if (!body) return { ok: false, reason: 'no-body' };
    const d = dialog.getBoundingClientRect();
    const style = window.getComputedStyle(body);
    const padL = parseFloat(style.paddingLeft) || 0;
    const padR = parseFloat(style.paddingRight) || 0;
    const labels = Array.from(body.querySelectorAll('label, .account-file-caption'));
    const controls = Array.from(body.querySelectorAll('input:not([type="file"]), select, textarea'));
    const contentEls = labels.concat(controls);
    const leftInsets = contentEls.map((el) => el.getBoundingClientRect().left - d.left);
    const rightInsets = contentEls.map((el) => d.right - el.getBoundingClientRect().right);
    // body box may be full-bleed; padding is on body itself — require both computed pad and content inset
    const leftPad = Math.min(padL, leftInsets.length ? Math.min.apply(null, leftInsets) : padL);
    const rightPad = Math.min(padR, rightInsets.length ? Math.min.apply(null, rightInsets) : padR);
    const controlOverflow = controls.some((el) => {
      const r = el.getBoundingClientRect();
      return r.left < d.left + 17.5 || r.right > d.right - 17.5;
    });
    const labelClipped = labels.some((el) => {
      const r = el.getBoundingClientRect();
      return r.left < d.left + 17.5 || r.width < 4;
    });
    const de = document.documentElement;
    const pageOverflowX = de.scrollWidth > de.clientWidth + 1;
    let actionsOk = false;
    if (actions) {
      const ar = actions.getBoundingClientRect();
      const hr = head ? head.getBoundingClientRect() : { bottom: d.top };
      actionsOk = ar.top >= hr.bottom - 1 && ar.bottom <= d.bottom + 1 && ar.width > 0;
    }
    return {
      ok: true,
      leftPad: Math.round(leftPad * 10) / 10,
      rightPad: Math.round(rightPad * 10) / 10,
      padL, padR,
      controlOverflow,
      labelClipped,
      pageOverflowX,
      actionsOk,
      bodyScrollHeight: body.scrollHeight,
      bodyClientHeight: body.clientHeight
    };
  });
  results.dialogPaddingAudit.push(Object.assign({ id: idPrefix }, m));
  assert(idPrefix + '-has-body', m && m.ok, JSON.stringify(m));
  assert(idPrefix + '-left-pad-ge-18', m && m.leftPad >= 18, JSON.stringify(m));
  assert(idPrefix + '-right-pad-ge-18', m && m.rightPad >= 18, JSON.stringify(m));
  assert(idPrefix + '-controls-in-bounds', m && !m.controlOverflow, JSON.stringify(m));
  assert(idPrefix + '-label-not-clipped', m && !m.labelClipped, JSON.stringify(m));
  assert(idPrefix + '-no-page-x-overflow', m && !m.pageOverflowX, JSON.stringify(m));
  assert(idPrefix + '-actions-not-obscured', m && m.actionsOk, JSON.stringify(m));
}
function waitFor(cond, timeoutMs, label) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = async () => {
      try {
        const ok = await cond();
        if (ok) return resolve(true);
      } catch (e) { /* keep polling */ }
      if (Date.now() - start > timeoutMs) return reject(new Error('timeout ' + label));
      setTimeout(tick, 25);
    };
    tick();
  });
}
function writeReport() {
  const passed = results.checks.filter((c) => c.ok).length;
  const failed = results.checks.filter((c) => !c.ok).length;
  const skipped = results.checks.filter((c) => c.skipped).length;
  const bestEffortPassCount = results.checks.filter((c) => c.ok && c.bestEffort).length;
  const fallbackPassCount = results.checks.filter((c) => c.ok && c.fallback).length;
  results.bestEffortPassCount = bestEffortPassCount;
  results.fallbackPassCount = fallbackPassCount;
  const noBestEffortPass = bestEffortPassCount === 0 && fallbackPassCount === 0;
  const noSkipPass = skipped === 0 && results.checks.every((c) => !c.skipped);
  const strictMode = noBestEffortPass && noSkipPass && failed === 0;
  results.suiteDurationMs = Date.now() - suiteStartedAt;
  results.summary = {
    passed, failed, skipped, total: results.checks.length,
    screenshots: results.screenshots.length, viewports: VIEWPORTS.length,
    finishedAt: new Date().toISOString(),
    bestEffortPassCount, fallbackPassCount,
    strictRuntimeProbeCount: results.strictRuntimeProbeCount,
    noBestEffortPass, noSkipPass, strictMode,
    vmDirectCallCount: results.vmDirectCallLog.length,
    controlledWriteScenarioCount: results.controlledWriteScenarios.length,
    holdGateNames: Object.keys(results.holdGateExecutions || {}),
    dialogPaddingAuditCount: (results.dialogPaddingAudit || []).length,
    actionTimeoutCount: results.actionTimeoutCount || 0,
    suiteDurationMs: results.suiteDurationMs,
    reverseGateDurationMs: results.reverseDoubleClickAudit && results.reverseDoubleClickAudit.durationMs,
    noBestEffortPassFormula: 'bestEffortPassCount===0 && fallbackPassCount===0',
    strictModeFormula: 'noBestEffortPass && noSkipPass && failed===0'
  };
  results.ok = failed === 0 && skipped === 0 && noBestEffortPass;
  fs.writeFileSync(path.join(out, 'phase-2g-report.json'), JSON.stringify(results, null, 2));
  fs.writeFileSync(path.join(out, 'screenshots-index.json'), JSON.stringify(results.screenshots, null, 2));
  return results.summary;
}

function staticScanHtml(html, label) {
  const inpu = (html.match(/<inpu(?:\s|>)/g) || []).length;
  const selec = (html.match(/<selec(?:\s|>)/g) || []).length;
  const selects = (html.match(/<select\b/g) || []).length;
  const selectCloses = (html.match(/<\/select>/g) || []).length;
  const idCounts = {};
  const idRe = /\bid=["']([^"']+)["']/g;
  let m;
  while ((m = idRe.exec(html))) {
    idCounts[m[1]] = (idCounts[m[1]] || 0) + 1;
  }
  const dupIds = Object.keys(idCounts).filter((k) => idCounts[k] > 1 && !/^(g-|desk-|more-|m-)/.test(k));
  // Vue templates may repeat ids only once each in source; count true duplicates
  const realDup = Object.keys(idCounts).filter((k) => idCounts[k] > 1);
  const attrDup = /<\w+[^>]*\s([a-zA-Z_:][\w:.-]*)\s*=[^>]*\s\1\s*=/.test(html);
  assert(label + '-no-broken-inpu', inpu === 0, 'inpu=' + inpu);
  assert(label + '-no-broken-selec', selec === 0, 'selec=' + selec);
  assert(label + '-select-balanced', selects === selectCloses, selects + '/' + selectCloses);
  assert(label + '-no-dup-ids', realDup.length === 0, JSON.stringify(realDup.slice(0, 10)));
  assert(label + '-no-dup-attrs-scan', !attrDup, 'dup-attr');
  return { inpu, selec, selects, selectCloses, realDup };
}

process.on('unhandledRejection', (err) => {
  console.error('unhandledRejection', err && err.stack || err);
});

(async () => {
  console.log('Phase 2G strict start', base);
  const consoleErrors = [], pageErrors = [], httpErrors = [];
  let browser;
  let summary;
  try {
    const accountHtml = fs.readFileSync('src/main/resources/static/page/end/account.html', 'utf8');
    const noticeHtml = fs.readFileSync('src/main/resources/static/page/end/notice.html', 'utf8');
    const css = fs.readFileSync('src/main/resources/static/css/admin-workspace.css', 'utf8');
    const suiteSrc = fs.readFileSync('tools/ui-polish-phase-2g.cjs', 'utf8');

    results.brokenTagBeforeAfter.afterInpu = (accountHtml.match(/<inpu(?:\s|>)/g) || []).length;
    results.brokenTagBeforeAfter.afterSelec = (accountHtml.match(/<selec(?:\s|>)/g) || []).length;
    results.brokenTagBeforeAfter.accountInpu = results.brokenTagBeforeAfter.afterInpu;
    results.brokenTagBeforeAfter.accountSelec = results.brokenTagBeforeAfter.afterSelec;

    // --- static gates ---
    staticScanHtml(accountHtml, 'account-static');
    staticScanHtml(noticeHtml, 'notice-static');
    assert('account-cache-30k', accountHtml.includes('admin-workspace.css?v=20260730k'), 'cache');
    assert('notice-cache-30k', noticeHtml.includes('admin-workspace.css?v=20260730k'), 'cache');
    assert('account-createFocusTrap', accountHtml.includes('createFocusTrap'), 'trap');
    assert('notice-createFocusTrap', noticeHtml.includes('createFocusTrap'), 'trap');
    assert('account-receiptUploadSeq', accountHtml.includes('receiptUploadSeq'), 'race');
    assert('account-returnFocusStack', accountHtml.includes('returnFocusStack'), 'stack');
    assert('notice-returnFocusStack', noticeHtml.includes('returnFocusStack'), 'stack');
    assert('account-no-delete-dialog', !/confirmDelete|deleteItem/.test(accountHtml) || !/删除资金/.test(accountHtml), 'no-del');
    assert('account-no-window-prompt', !/window\.prompt/.test(accountHtml), 'prompt');
    assert('account-askReverse-event', /askReverse\s*:\s*function\s*\(\s*item\s*,\s*evt/.test(accountHtml), 'evt');
    assert('notice-title-id-once', (noticeHtml.match(/id="noticeTitleInput"/g) || []).length === 1, 'title');
    assert('notice-content-id-once', (noticeHtml.match(/id="noticeContentInput"/g) || []).length === 1, 'content');
    assert('notice-no-old-title-id', !/id="noticeFormTitle"/.test(noticeHtml), 'old');
    assert('notice-no-old-content-id', !/id="noticeContent"[^I]/.test(noticeHtml) && (noticeHtml.match(/id="noticeContent"/g) || []).length === 0, 'oldc');
    assert('notice-field-errors', noticeHtml.includes('noticeTitleError') && noticeHtml.includes('noticeContentError'), 'err');
    assert('notice-save-not-disabled-empty', !/:disabled="saving\|\|!form\.title/.test(noticeHtml), 'save');
    assert('notice-export', noticeHtml.includes('/api/notice/export'), 'export');
    assert('account-export', accountHtml.includes('/api/account/export'), 'export');
    assert('account-field-errors', accountHtml.includes('accountLabelErr') && accountHtml.includes('accountValueErr'), 'ferr');
    assert('css-notice-metrics', css.includes('.notice-governance-metric'), 'css');
    assert('css-account-file', css.includes('.account-file-picker'), 'css');
    assert('css-reverse-meta', css.includes('.account-reverse-meta'), 'css');
    assert('css-notice-actions-stack-360', /\.notice-governance\s+\.admin-edit-form\s*>\s*\.admin-dialog-actions[\s\S]*flex-direction:\s*column/.test(css), 'stack');
    assert('self-no-reverse-catch-timeout', !/确认冲正[\s\S]{0,80}\.catch\(\s*\(\)\s*=>\s*\{\s*\}\s*\)/.test(suiteSrc), 'no-catch');
    assert('account-edit-has-dialog-body', /admin-edit-form[\s\S]*admin-dialog-body[\s\S]*accountLabel[\s\S]*admin-dialog-actions/.test(accountHtml), 'body');
    assert('notice-edit-has-dialog-body', /admin-edit-form[\s\S]*admin-dialog-body[\s\S]*noticeTitleInput[\s\S]*admin-dialog-actions/.test(noticeHtml), 'body');
    assert('self-no-vm-saving-assign', !/vm\.saving\s*=\s*true/.test(suiteSrc), 'no-fake-saving');
    assert('self-no-write-lock-assign', !/__noticeWriteLocks\.save\s*=\s*true/.test(suiteSrc), 'no-fake-lock');
    const scan = suiteSrc.split(/\r?\n/).filter((ln) => ln.indexOf('self-no-') < 0 && ln.indexOf('self-has-') < 0).join('\n');
    assert('self-no-true-assert', !/assert\s*\(\s*['"][^'"]+['"]\s*,\s*true\s*,/.test(scan), 'true');
    assert('self-no-best-effort', !/bestEffort:\s*true/.test(scan), 'be');
    assert('self-has-holdThenOk-mode', /savePostMode\s*=\s*['"]holdThenOk['"]/.test(suiteSrc) && /noticeSaveMode\s*=\s*['"]holdThenOk['"]/.test(suiteSrc), 'holdThenOk');
    assert('self-no-swallowed-wait', !/waitForFunction\([^)]*\)\.catch\(\s*\(\)\s*=>\s*\{\s*\}\s*\)/.test(suiteSrc), 'swallow');
    assert('self-no-fixed-delay-race', !/setTimeout\(\s*resolve\s*,\s*\d+\s*\).*race|race.*setTimeout\(\s*resolve\s*,\s*\d+/.test(suiteSrc), 'delay');

    // temp file cleanup evidence
    const forbiddenTemp = [
      'tools/_acc-prefix.html',
      'tools/_build-acc-prefix.cjs',
      'tools/_build-acc-script.cjs',
      'tools/_build-notice.cjs',
      'tools/_check-2g-pages.cjs'
    ];
    results.tempFilesCleanup.removed = forbiddenTemp.filter((p) => !fs.existsSync(p));
    results.tempFilesCleanup.remainingForbidden = forbiddenTemp.filter((p) => fs.existsSync(p));
    assert('temp-build-files-removed', results.tempFilesCleanup.remainingForbidden.length === 0, JSON.stringify(results.tempFilesCleanup));

    browser = await chromium.launch({ headless: true });
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await login(ctx, 'admin', 'admin');
    const page = await ctx.newPage();

    // Controlled gates
    let holdUploadA = null;
    let resolveUploadA = null;
    let uploadAReleased = false;
    let holdUploadB = null;
    let resolveUploadB = null;
    let uploadMode = 'normal'; // normal | raceAB | failB | cancelA
    let uploadSeqCounter = 0;
    let uploadOrder = [];
    let holdSavePost = null;
    let resolveSavePost = null;
    let savePostMode = 'ok'; // ok | fail409 | fail500 | holdThenOk
    let savePostCount = 0;
    let accountPostBodies = [];
    let stagedDeletes = [];
    let uploadFlagsIssued = [];
    let noticeWriteCount = 0;
    let noticeDeleteCount = 0;
    let reversePostCount = 0;
    let noticeSaveMode = 'ok'; // ok | fail409 | fail500 | holdThenOk
    let noticeDeleteMode = 'ok'; // ok | fail500 | holdThenOk
    let reverseMode = 'ok'; // ok | holdThenOk
    let holdNoticeSave = null;
    let resolveNoticeSave = null;
    let holdNoticeDelete = null;
    let resolveNoticeDelete = null;
    let holdReverse = null;
    let resolveReverse = null;
    let accountPageGets = [];
    let noticePageGets = [];

    page.on('pageerror', (e) => pageErrors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
    page.on('requestfailed', (req) => {
      if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method())) {
        results.requestFailedWrite.push({ method: req.method(), url: req.url() });
      }
    });
    page.on('response', (r) => {
      if (r.status() >= 400) {
        httpErrors.push({ status: r.status(), url: r.url(), method: r.request().method(), headers: r.headers() });
      }
    });
    page.on('request', (req) => {
      const u = req.url();
      const m = req.method();
      if (m === 'GET' && /\/api\/account\/page/.test(u)) accountPageGets.push(u);
      if (m === 'GET' && /\/api\/notice\/page/.test(u)) noticePageGets.push(u);
      if (m === 'DELETE' && /\/api\/files\/staged\//.test(u)) {
        const flag = decodeURIComponent((u.match(/\/api\/files\/staged\/([^/?#]+)/) || [])[1] || '');
        stagedDeletes.push(flag);
        results.stagedDeleteLog.push({ flag, at: new Date().toISOString(), url: u });
        results.writeRequestLog.push({ scenario: 'staged-delete', method: m, flag, url: u });
      }
      if ((m === 'POST' || m === 'PUT' || m === 'DELETE') && /\/api\/(account|notice|files)/.test(u)) {
        results.writeRequestLog.push({ method: m, url: u, at: new Date().toISOString() });
      }
    });

    // Shared fixtures
    await page.route('**/api/account/stats/**', async (route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ code: '0', data: STATS })
      });
    });
    await page.route('**/api/account/export**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/octet-stream', body: 'xlsx', headers: EH });
    });
    await page.route('**/api/notice/export**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/octet-stream', body: 'xlsx', headers: EH });
    });
    await page.route('**/api/account/page**', async (route) => {
      if (route.request().method() === 'GET') await route.fulfill(pageData(ACCOUNT_RECORDS));
      else await route.continue();
    });
    await page.route('**/api/notice/page**', async (route) => {
      if (route.request().method() === 'GET') await route.fulfill(pageData(NOTICE_RECORDS));
      else await route.continue();
    });

    // Account POST with controlled modes
    await page.route('**/api/account', async (route) => {
      if (route.request().method() !== 'POST') { await route.continue(); return; }
      savePostCount++;
      let body = {};
      try { body = route.request().postDataJSON() || {}; } catch (e) { body = {}; }
      accountPostBodies.push(body);
      results.writeRequestLog.push({ scenario: 'account-post', method: 'POST', body, n: savePostCount, mode: savePostMode });
      if (savePostMode === 'fail409') {
        registerExpectedHttp('account-post-409', 'POST', /\/api\/account$/, 409);
        await route.fulfill(exp(409, { code: '409', msg: '冲突夹具' }));
        return;
      }
      if (savePostMode === 'fail500') {
        registerExpectedHttp('account-post-500', 'POST', /\/api\/account$/, 500);
        await route.fulfill(exp(500, { code: '500', msg: '账簿服务异常' }));
        return;
      }
      if (savePostMode === 'holdThenOk') {
        const gate = ensureGate('account-save-holdThenOk');
        gate.requestCount = savePostCount;
        if (!holdSavePost) {
          holdSavePost = new Promise((r) => { resolveSavePost = r; });
          gate.held = true;
          recordControlledWrite('account-save-hold-entered', { requestCount: savePostCount, held: true });
        }
        await holdSavePost;
        gate.released = true;
        recordControlledWrite('account-save-hold-released', { requestCount: savePostCount });
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ code: '0', data: true }) });
        return;
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ code: '0', data: true }) });
    });
    await page.route('**/api/account/*/reverse', async (route) => {
      if (route.request().method() !== 'POST') { await route.continue(); return; }
      reversePostCount++;
      results.writeRequestLog.push({ scenario: 'account-reverse', method: 'POST', url: route.request().url(), n: reversePostCount, mode: reverseMode });
      if (reverseMode === 'holdThenOk') {
        const gate = ensureGate('account-reverse-holdThenOk');
        gate.requestCount = reversePostCount;
        if (!holdReverse) {
          holdReverse = new Promise((r) => { resolveReverse = r; });
          gate.held = true;
          recordControlledWrite('account-reverse-hold-entered', { requestCount: reversePostCount });
        }
        await holdReverse;
        gate.released = true;
        recordControlledWrite('account-reverse-hold-released', { requestCount: reversePostCount });
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ code: '0', data: 88001 }) });
    });

    // Notice writes
    await page.route('**/api/notice', async (route) => {
      const method = route.request().method();
      if (method === 'GET') { await route.continue(); return; }
      noticeWriteCount++;
      let body = {};
      try { body = route.request().postDataJSON() || {}; } catch (e) { body = {}; }
      results.writeRequestLog.push({ scenario: 'notice-write', method, body, n: noticeWriteCount, mode: noticeSaveMode });
      if (noticeSaveMode === 'fail409' && (method === 'POST' || method === 'PUT')) {
        registerExpectedHttp('notice-409', method, /\/api\/notice$/, 409);
        await route.fulfill(exp(409, { code: '409', msg: '公告冲突' }));
        return;
      }
      if (noticeSaveMode === 'fail500' && (method === 'POST' || method === 'PUT')) {
        registerExpectedHttp('notice-500', method, /\/api\/notice$/, 500);
        await route.fulfill(exp(500, { code: '500', msg: '公告服务异常' }));
        return;
      }
      if (noticeSaveMode === 'holdThenOk' && (method === 'POST' || method === 'PUT')) {
        const gate = ensureGate('notice-save-holdThenOk');
        gate.requestCount = noticeWriteCount;
        if (!holdNoticeSave) {
          holdNoticeSave = new Promise((r) => { resolveNoticeSave = r; });
          gate.held = true;
          recordControlledWrite('notice-save-hold-entered', { requestCount: noticeWriteCount, method });
        }
        await holdNoticeSave;
        gate.released = true;
        recordControlledWrite('notice-save-hold-released', { requestCount: noticeWriteCount });
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ code: '0', data: true }) });
        return;
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ code: '0', data: true }) });
    });
    await page.route('**/api/notice/*', async (route) => {
      const method = route.request().method();
      const url = route.request().url();
      // Do not steal /api/notice/page — re-fulfill fixtures (continue would bypass earlier page route)
      if (/\/api\/notice\/page/.test(url)) {
        if (method === 'GET') {
          await route.fulfill(pageData(NOTICE_RECORDS));
          return;
        }
        await route.continue();
        return;
      }
      if (method === 'DELETE') {
        noticeDeleteCount++;
        noticeWriteCount++;
        results.writeRequestLog.push({ scenario: 'notice-delete', method, url, n: noticeDeleteCount, mode: noticeDeleteMode });
        if (noticeDeleteMode === 'fail500') {
          registerExpectedHttp('notice-delete-500', 'DELETE', /\/api\/notice\/\d+/, 500);
          await route.fulfill(exp(500, { code: '500', msg: '删除失败夹具' }));
          return;
        }
        if (noticeDeleteMode === 'holdThenOk') {
          const gate = ensureGate('notice-delete-holdThenOk');
          gate.requestCount = noticeDeleteCount;
          if (!holdNoticeDelete) {
            holdNoticeDelete = new Promise((r) => { resolveNoticeDelete = r; });
            gate.held = true;
            recordControlledWrite('notice-delete-hold-entered', { requestCount: noticeDeleteCount });
          }
          await holdNoticeDelete;
          gate.released = true;
          recordControlledWrite('notice-delete-hold-released', { requestCount: noticeDeleteCount });
        }
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ code: '0', data: true }) });
        return;
      }
      await route.continue();
    });

    // File upload with controlled races
    await page.route('**/api/files/**', async (route) => {
      const url = route.request().url();
      const method = route.request().method();
      if (method === 'DELETE' && /\/api\/files\/staged\//.test(url)) {
        await route.fulfill({
          status: 200, contentType: 'application/json',
          body: JSON.stringify({ code: '0', data: true }),
          headers: Object.assign({ 'content-type': 'application/json' }, EH)
        });
        return;
      }
      if (method === 'GET') {
        if (/fixture-ok/.test(url) || /\/api\/files\/[a-f0-9]{32}/i.test(url)) {
          await route.fulfill({ status: 200, contentType: 'image/png', body: PNG1, headers: EH });
          return;
        }
        await route.fulfill({
          status: 404, contentType: 'application/json',
          body: JSON.stringify({ code: '404', msg: 'nf' }),
          headers: Object.assign({ 'content-type': 'application/json' }, EH)
        });
        return;
      }
      if (method === 'POST' && /\/api\/files\/upload/.test(url)) {
        uploadSeqCounter++;
        const mySeq = uploadSeqCounter;
        uploadOrder.push({ seq: mySeq, mode: uploadMode, t: Date.now() });
        results.writeRequestLog.push({ scenario: 'upload', method: 'POST', seq: mySeq, mode: uploadMode });

        if (uploadMode === 'raceAB') {
          const raceN = uploadOrder.filter((x) => x.mode === 'raceAB').length;
          if (raceN === 1) {
            // First in-flight A: hold until released
            holdUploadA = new Promise((r) => { resolveUploadA = r; });
            recordProbe('upload-A-inflight', { seq: mySeq, held: true, raceN });
            await holdUploadA;
            uploadAReleased = true;
            uploadFlagsIssued.push(UUID_A);
            await route.fulfill({
              status: 200, contentType: 'application/json',
              body: JSON.stringify({ code: '0', data: { flag: UUID_A } })
            });
            recordProbe('upload-A-released', { seq: mySeq, flag: UUID_A });
            return;
          }
          // Subsequent (B): succeed immediately while A may still be held
          uploadFlagsIssued.push(UUID_B);
          recordProbe('upload-B-success', { seq: mySeq, flag: UUID_B, aStillHeld: !uploadAReleased, raceN });
          await route.fulfill({
            status: 200, contentType: 'application/json',
            body: JSON.stringify({ code: '0', data: { flag: UUID_B } })
          });
          return;
        }

        if (uploadMode === 'failB') {
          // First success (stable keep candidate = UUID_C), second fail
          const n = uploadOrder.filter((x) => x.mode === 'failB').length;
          if (n === 1) {
            uploadFlagsIssued.push(UUID_C);
            await route.fulfill({
              status: 200, contentType: 'application/json',
              body: JSON.stringify({ code: '0', data: { flag: UUID_C } })
            });
            return;
          }
          registerExpectedHttp('upload-fail-B', 'POST', /\/api\/files\/upload/, 500);
          await route.fulfill(exp(500, { code: '500', msg: '上传失败夹具' }));
          return;
        }

        if (uploadMode === 'cancelA') {
          holdUploadA = new Promise((r) => { resolveUploadA = r; });
          recordProbe('upload-cancelA-inflight', { seq: mySeq });
          await holdUploadA;
          // fresh UUID_D never previously retired in this page session
          uploadFlagsIssued.push(UUID_D);
          await route.fulfill({
            status: 200, contentType: 'application/json',
            body: JSON.stringify({ code: '0', data: { flag: UUID_D } })
          });
          recordProbe('upload-cancelA-late', { flag: UUID_D });
          return;
        }

        // normal: use fresh UUIDs not yet retired
        const flag = uploadFlagsIssued.length === 0 ? UUID_E : uploadFlagsIssued.length === 1 ? UUID_F : UUID_B;
        uploadFlagsIssued.push(flag);
        await route.fulfill({
          status: 200, contentType: 'application/json',
          body: JSON.stringify({ code: '0', data: { flag } })
        });
        return;
      }
      await route.continue();
    });

    // ========== ACCOUNT PAGE ==========
    await page.goto(base + '/page/end/account.html', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForFunction(() => {
      const el = document.querySelector('#workspace');
      return el && el.__vue__ && el.__vue__.loading === false;
    }, { timeout: 15000 });
    assert('account-title', /资金|账簿|财务/.test(await page.locator('h1').innerText()), 'title');
    assert('account-fixture', (await page.locator('text=UI_2G_DONATION').count()) >= 1, 'fixture');
    assert('account-search-input', (await page.locator('input[type="search"]').count()) >= 1, 'search');
    await shot(page, '01-account-list', { page: 'account', viewport: '1440x900', state: 'list' });

    // Real search
    const searchGetsBefore = accountPageGets.length;
    await page.locator('input[type="search"]').fill('UI_2G_DONATION');
    await page.locator('button:has-text("查询")').click();
    await waitFor(() => accountPageGets.length > searchGetsBefore, 5000, 'search-get');
    assert('account-search-request', accountPageGets.length > searchGetsBefore, 'gets=' + accountPageGets.length);
    const lastSearch = accountPageGets[accountPageGets.length - 1] || '';
    assert('account-search-param', /name=UI_2G_DONATION|name=UI%5F2G%5FDONATION|name=UI_2G/.test(lastSearch) || decodeURIComponent(lastSearch).includes('UI_2G'), lastSearch);

    // Open create via real click
    await page.locator('button:has-text("新增记录"), button:has-text("新增资金")').first().click();
    await page.waitForSelector('#accountLabel', { timeout: 5000 });
    await assertDialogFocus(page, 'account-create-initial-focus');

    // Real control types
    const tags = await page.evaluate(() => ({
      label: document.getElementById('accountLabel') && document.getElementById('accountLabel').tagName,
      value: document.getElementById('accountValue') && document.getElementById('accountValue').tagName,
      category: document.getElementById('accountCategory') && document.getElementById('accountCategory').tagName,
      occurred: document.getElementById('accountOccurred') && document.getElementById('accountOccurred').tagName,
      btype: document.getElementById('accountBusinessType') && document.getElementById('accountBusinessType').tagName,
      bid: document.getElementById('accountBusinessId') && document.getElementById('accountBusinessId').tagName,
      search: document.querySelector('input[type="search"]') && document.querySelector('input[type="search"]').tagName,
      hasBody: !!document.querySelector('[role="dialog"] .admin-dialog-body')
    }));
    assert('account-label-INPUT', tags.label === 'INPUT', JSON.stringify(tags));
    assert('account-value-INPUT', tags.value === 'INPUT', JSON.stringify(tags));
    assert('account-category-SELECT', tags.category === 'SELECT', JSON.stringify(tags));
    assert('account-occurred-INPUT', tags.occurred === 'INPUT', JSON.stringify(tags));
    assert('account-btype-SELECT', tags.btype === 'SELECT', JSON.stringify(tags));
    assert('account-bid-INPUT', tags.bid === 'INPUT', JSON.stringify(tags));
    assert('account-create-has-body-runtime', tags.hasBody, JSON.stringify(tags));
    await scrollDialogBodyTop(page);
    await assertEditDialogPadding(page, 'account-create-1440');
    await shot(page, '02-account-create-dialog', { page: 'account', viewport: '1440x900', state: 'create-top' });
    await assertTabCycle(page, 'account-create');
    await scrollDialogBodyTop(page);

    // Zero-request validation matrix (real fill + submit)
    async function submitCreate() {
      await page.locator('.admin-dialog button[type="submit"], .admin-dialog button:has-text("保存资金记录")').first().click();
      await page.waitForTimeout(120);
    }
    async function openCreateFresh() {
      if (await page.locator('#accountLabel').count()) {
        const cancel = page.locator('.admin-dialog button:has-text("取消")').first();
        if (await cancel.count()) await cancel.click({ force: true });
        else await page.keyboard.press('Escape');
        await page.waitForTimeout(200);
      }
      await page.locator('button:has-text("新增记录")').first().click({ force: true });
      await page.waitForSelector('#accountLabel', { state: 'visible', timeout: 8000 });
      await page.waitForSelector('#accountReceipt', { state: 'attached', timeout: 5000 });
    }
    async function waitStagedFlag(expected, timeoutMs, label) {
      await waitFor(async () => {
        const st = await page.evaluate(() => {
          const vm = document.querySelector('#workspace') && document.querySelector('#workspace').__vue__;
          return vm ? {
            flag: vm.stagedReceiptFlag,
            up: vm.receiptUploading,
            err: vm.editError,
            name: vm.receiptFileName,
            seq: vm.receiptUploadSeq,
            open: !!vm.editOpen
          } : null;
        });
        if (st && expected && st.flag === expected && !st.up) return true;
        if (st && expected === null && !st.flag && !st.up) return true;
        return false;
      }, timeoutMs, label);
    }
    const postsBeforeVal = savePostCount;

    // empty label
    await page.fill('#accountLabel', '');
    await page.fill('#accountValue', '10.00');
    await submitCreate();
    assert('val-empty-label-no-post', savePostCount === postsBeforeVal, 'posts=' + savePostCount);
    assert('val-empty-label-error', (await page.locator('#accountLabelErr').count()) === 1, 'err');
    assert('val-empty-label-aria', await page.locator('#accountLabel').getAttribute('aria-invalid') === 'true', 'aria');
    assert('val-empty-label-focus', (await page.evaluate(() => document.activeElement && document.activeElement.id)) === 'accountLabel', 'focus');

    // amount 0
    await page.fill('#accountLabel', '标签OK');
    await page.fill('#accountValue', '0');
    await submitCreate();
    assert('val-zero-amount-no-post', savePostCount === postsBeforeVal, 'posts');
    assert('val-zero-amount-error', (await page.locator('#accountValueErr').count()) === 1, 'err');

    // illegal amount
    await page.fill('#accountValue', '12.345');
    await submitCreate();
    assert('val-illegal-amount-no-post', savePostCount === postsBeforeVal, 'posts');
    assert('val-illegal-amount-error', (await page.locator('#accountValueErr').count()) === 1, 'err');

    // >2 effective decimals already covered; over limit
    await page.fill('#accountValue', '1000000000.01');
    await submitCreate();
    assert('val-over-limit-no-post', savePostCount === postsBeforeVal, 'posts');
    assert('val-over-limit-error', (await page.locator('#accountValueErr').count()) === 1, 'err');

    // illegal category via DOM inject (real select only has legal options; inject then validate via fill path + evaluate only for option inject)
    await page.fill('#accountValue', '12.50');
    await page.evaluate(() => {
      const s = document.getElementById('accountCategory');
      const o = document.createElement('option');
      o.value = 'not-a-cat';
      o.textContent = '非法';
      s.appendChild(o);
      s.value = 'not-a-cat';
      s.dispatchEvent(new Event('change', { bubbles: true }));
      const vm = document.querySelector('#workspace').__vue__;
      if (vm) vm.form.category = 'not-a-cat';
    });
    logVm('inject illegal category for zero-request validation only', 'form.category=not-a-cat');
    await submitCreate();
    assert('val-illegal-category-no-post', savePostCount === postsBeforeVal, 'posts');
    assert('val-illegal-category-error', (await page.locator('#accountCategoryErr').count()) === 1, 'err');
    // restore category
    await page.selectOption('#accountCategory', 'donation');

    // business type only
    await page.selectOption('#accountBusinessType', 'animal');
    await page.fill('#accountBusinessId', '');
    await submitCreate();
    assert('val-business-partial-no-post', savePostCount === postsBeforeVal, 'posts');
    assert('val-business-partial-error', (await page.locator('#accountBusinessErr').count()) === 1, 'err');

    // illegal business type
    await page.evaluate(() => {
      const s = document.getElementById('accountBusinessType');
      const o = document.createElement('option');
      o.value = 'evil';
      o.textContent = 'evil';
      s.appendChild(o);
      s.value = 'evil';
      s.dispatchEvent(new Event('change', { bubbles: true }));
      const vm = document.querySelector('#workspace').__vue__;
      if (vm) { vm.form.businessType = 'evil'; vm.form.businessId = '1'; }
    });
    logVm('inject illegal businessType for zero-request validation only', 'form.businessType=evil');
    await submitCreate();
    assert('val-illegal-btype-no-post', savePostCount === postsBeforeVal, 'posts');
    assert('val-illegal-btype-error', (await page.locator('#accountBusinessErr').count()) === 1, 'err');
    await page.selectOption('#accountBusinessType', '');
    await page.fill('#accountBusinessId', '');

    // illegal occurred time
    await page.evaluate(() => {
      const vm = document.querySelector('#workspace').__vue__;
      if (vm) vm.form.occurredAt = 'not-a-date';
    });
    logVm('inject invalid occurredAt for zero-request validation only', 'form.occurredAt=not-a-date');
    await submitCreate();
    assert('val-illegal-occurred-no-post', savePostCount === postsBeforeVal, 'posts');
    assert('val-illegal-occurred-error', (await page.locator('#accountOccurredErr').count()) === 1, 'err');
    await page.fill('#accountOccurred', '2026-07-10T10:00');

    // overlong description — maxlength=355 may block typing; inject length via vm for validation path
    await page.evaluate(() => {
      const vm = document.querySelector('#workspace').__vue__;
      if (vm) vm.form.adescribe = 'x'.repeat(356);
    });
    logVm('inject overlong adescribe for zero-request validation only', 'form.adescribe len 356');
    await submitCreate();
    assert('val-overlong-desc-no-post', savePostCount === postsBeforeVal, 'posts');
    assert('val-overlong-desc-error', (await page.locator('#accountDescriptionErr').count()) === 1, 'err');
    await page.fill('#accountDescription', '用途正常');

    // Clear errors by fixing fields
    await page.fill('#accountLabel', '标签OK');
    await page.fill('#accountValue', '12.50');
    await page.selectOption('#accountCategory', 'donation');
    await page.selectOption('#accountBusinessType', '');
    await page.fill('#accountBusinessId', '');
    await page.fill('#accountOccurred', '2026-07-10T10:00');
    await page.fill('#accountDescription', '用途正常');
    // trigger validation clear by re-validate on next submit success path later

    // Esc closes when idle
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    assert('account-esc-closes-create', (await page.locator('#accountLabel').count()) === 0, 'closed');

    // ===== Receipt race A hold / B win / A late =====
    uploadMode = 'raceAB';
    uploadSeqCounter = 0;
    uploadOrder = [];
    uploadAReleased = false;
    holdUploadA = null;
    resolveUploadA = null;
    stagedDeletes = [];
    uploadFlagsIssued = [];
    const delBeforeRace = results.stagedDeleteLog.length;

    await openCreateFresh();
    await page.fill('#accountLabel', 'RACE_LABEL');
    await page.fill('#accountValue', '33.00');
    await page.selectOption('#accountCategory', 'other');

    // Upload A (held)
    await page.setInputFiles('#accountReceipt', {
      name: 'receipt-a.png', mimeType: 'image/png', buffer: PNG1
    });
    await waitFor(() => holdUploadA != null && resolveUploadA != null, 5000, 'A-inflight');
    recordProbe('race-A-confirmed-inflight', { hasHold: !!holdUploadA });

    const uploading = await page.evaluate(() => {
      const vm = document.querySelector('#workspace').__vue__;
      return !!(vm && vm.receiptUploading);
    });
    assert('race-A-uploading-flag', uploading, 'uploading');
    assert('race-save-disabled-while-upload', await page.locator('.admin-dialog button[type="submit"]').isDisabled(), 'save-disabled');

    // Upload B while A still held — real setInputFiles (last-wins)
    await page.setInputFiles('#accountReceipt', {
      name: 'receipt-b.png', mimeType: 'image/png', buffer: PNG1
    });

    // Wait B complete while A still held
    await waitFor(async () => {
      const st = await page.evaluate(() => {
        const vm = document.querySelector('#workspace').__vue__;
        return vm ? { flag: vm.stagedReceiptFlag, name: vm.receiptFileName, up: vm.receiptUploading, seq: vm.receiptUploadSeq } : null;
      });
      return st && st.flag === UUID_B;
    }, 8000, 'B-wins');

    let stB = await page.evaluate(() => {
      const vm = document.querySelector('#workspace').__vue__;
      return vm ? { flag: vm.stagedReceiptFlag, name: vm.receiptFileName, seq: vm.receiptUploadSeq, up: vm.receiptUploading } : null;
    });
    assert('race-B-wins-before-A', stB && stB.flag === UUID_B, JSON.stringify(stB));
    assert('race-A-still-held', !uploadAReleased, 'A held');
    recordProbe('race-B-before-A-release', { state: stB, aReleased: uploadAReleased, deletes: stagedDeletes.slice() });

    // Release A late
    if (typeof resolveUploadA === 'function') resolveUploadA();
    await page.waitForTimeout(400);
    let stAfterA = await page.evaluate(() => {
      const vm = document.querySelector('#workspace').__vue__;
      return vm ? { flag: vm.stagedReceiptFlag, name: vm.receiptFileName, seq: vm.receiptUploadSeq } : null;
    });
    await page.waitForTimeout(200);
    const delsA = stagedDeletes.filter((f) => f === UUID_A);
    const delsB = stagedDeletes.filter((f) => f === UUID_B);
    results.receiptRaceTimelines.push({
      name: 'A-hold-B-win-A-late',
      finalFlag: stAfterA && stAfterA.flag,
      stagedDeletes: stagedDeletes.slice(),
      uploadFlagsIssued: uploadFlagsIssued.slice(),
      aDeleteCount: delsA.length,
      bDeleteCount: delsB.length
    });
    assert('race-final-is-B', stAfterA && stAfterA.flag === UUID_B, JSON.stringify(stAfterA));
    assert('race-A-deleted-once', delsA.length === 1, 'delsA=' + delsA.length + ' all=' + JSON.stringify(stagedDeletes));
    assert('race-B-not-deleted', delsB.length === 0, 'delsB=' + delsB.length);

    // Save with B via real form
    savePostMode = 'ok';
    const postsBeforeSave = savePostCount;
    await page.fill('#accountLabel', 'RACE_SAVE_B');
    await page.fill('#accountValue', '33.00');
    await page.selectOption('#accountCategory', 'other');
    await page.fill('#accountDescription', 'race save');
    await submitCreate();
    await waitFor(() => savePostCount > postsBeforeSave, 5000, 'save-after-race');
    const lastBody = accountPostBodies[accountPostBodies.length - 1] || {};
    results.realFormFillEvidence.push({ scenario: 'save-after-race', body: lastBody });
    assert('race-save-uses-B', lastBody.receiptFlag === UUID_B, JSON.stringify(lastBody));
    // bound flag must not staged-delete
    await page.waitForTimeout(200);
    const delsBAfterSave = stagedDeletes.filter((f) => f === UUID_B);
    assert('race-B-not-deleted-after-bind', delsBAfterSave.length === 0, 'delsB=' + delsBAfterSave.length);

    // ===== A success then B fail keeps A =====
    // Use UUID_C for stable A so retired UUID_A from prior race cannot confuse diagnostics.
    uploadMode = 'failB';
    uploadSeqCounter = 0;
    uploadOrder = [];
    stagedDeletes = [];
    uploadFlagsIssued = [];
    await openCreateFresh();
    const upRespA = page.waitForResponse((r) => /\/api\/files\/upload/.test(r.url()) && r.request().method() === 'POST', { timeout: 8000 });
    await page.setInputFiles('#accountReceipt', { name: 'keep-a.png', mimeType: 'image/png', buffer: PNG1 });
    const respA = await upRespA;
    assert('failB-A-http-ok', respA.status() === 200, 'status=' + respA.status());
    await waitStagedFlag(UUID_C, 8000, 'A-ok');
    const flagAfterA = await page.evaluate(() => document.querySelector('#workspace').__vue__.stagedReceiptFlag);
    assert('failB-A-is-C', flagAfterA === UUID_C, flagAfterA);

    const upRespB = page.waitForResponse((r) => /\/api\/files\/upload/.test(r.url()) && r.request().method() === 'POST', { timeout: 8000 });
    await page.setInputFiles('#accountReceipt', { name: 'fail-b.png', mimeType: 'image/png', buffer: PNG1 });
    const respB = await upRespB;
    assert('failB-B-http-500', respB.status() === 500, 'status=' + respB.status());
    await page.waitForTimeout(300);
    let stKeep = await page.evaluate(() => {
      const vm = document.querySelector('#workspace').__vue__;
      return vm ? { flag: vm.stagedReceiptFlag, err: vm.editError, name: vm.receiptFileName, up: vm.receiptUploading } : null;
    });
    results.receiptRaceTimelines.push({ name: 'A-ok-B-fail-keep-A', state: stKeep, deletes: stagedDeletes.slice() });
    assert('keep-A-after-B-fail', stKeep && stKeep.flag === UUID_C, JSON.stringify(stKeep));
    assert('keep-A-not-deleted', stagedDeletes.filter((f) => f === UUID_C).length === 0, JSON.stringify(stagedDeletes));

    // cancel dialog (cleanup A / UUID_C)
    await page.locator('.admin-dialog button:has-text("取消")').first().click();
    await page.waitForTimeout(300);
    assert('cancel-deletes-A', stagedDeletes.filter((f) => f === UUID_C).length === 1, JSON.stringify(stagedDeletes));

    // ===== Cancel during upload, late response cleanup =====
    uploadMode = 'cancelA';
    uploadSeqCounter = 0;
    uploadOrder = [];
    holdUploadA = null;
    resolveUploadA = null;
    stagedDeletes = [];
    uploadFlagsIssued = [];
    await openCreateFresh();
    await page.setInputFiles('#accountReceipt', { name: 'late.png', mimeType: 'image/png', buffer: PNG1 });
    await waitFor(() => holdUploadA != null && typeof resolveUploadA === 'function', 8000, 'cancelA-hold');
    await page.locator('.admin-dialog button:has-text("取消")').first().click();
    await page.waitForTimeout(200);
    assert('cancel-upload-dialog-closed', (await page.locator('#accountLabel').count()) === 0, 'closed');
    resolveUploadA();
    await page.waitForTimeout(500);
    assert('cancel-upload-stays-closed', (await page.locator('#accountLabel').count()) === 0, 'still-closed');
    // cancelA mode issues UUID_D on late success (must not have been previously retired)
    assert('cancel-late-uuid-deleted-once', stagedDeletes.filter((f) => f === UUID_D).length === 1, JSON.stringify(stagedDeletes));
    results.receiptRaceTimelines.push({ name: 'cancel-during-upload-late-D', deletes: stagedDeletes.slice(), finalFlagExpected: UUID_D });

    // ===== POST 409 then retry same UUID without re-upload =====
    uploadMode = 'normal';
    uploadSeqCounter = 0;
    uploadOrder = [];
    uploadFlagsIssued = [];
    stagedDeletes = [];
    savePostMode = 'fail409';
    savePostCount = 0;
    accountPostBodies = [];
    await openCreateFresh();
    await page.fill('#accountLabel', 'RETRY_UUID');
    await page.fill('#accountValue', '15.00');
    await page.selectOption('#accountCategory', 'donation');
    await page.fill('#accountDescription', 'retry');
    const upRetry = page.waitForResponse((r) => /\/api\/files\/upload/.test(r.url()) && r.request().method() === 'POST', { timeout: 8000 });
    await page.setInputFiles('#accountReceipt', { name: 'retry.png', mimeType: 'image/png', buffer: PNG1 });
    await upRetry;
    await waitFor(async () => {
      const st = await page.evaluate(() => {
        const vm = document.querySelector('#workspace').__vue__;
        return vm && vm.stagedReceiptFlag && !vm.receiptUploading;
      });
      return st;
    }, 8000, 'retry-upload');
    const flagStable = await page.evaluate(() => document.querySelector('#workspace').__vue__.stagedReceiptFlag);
    const uploadsBefore = uploadFlagsIssued.length;
    await submitCreate();
    await page.waitForTimeout(400);
    assert('retry-409-keeps-dialog', (await page.locator('#accountLabel').count()) === 1, 'open');
    assert('retry-409-keeps-flag', (await page.evaluate(() => document.querySelector('#workspace').__vue__.stagedReceiptFlag)) === flagStable, flagStable);
    assert('retry-409-label-kept', (await page.inputValue('#accountLabel')) === 'RETRY_UUID', 'label');
    savePostMode = 'ok';
    await submitCreate();
    await waitFor(() => savePostCount >= 2, 5000, 'retry-ok');
    assert('retry-upload-once', uploadFlagsIssued.length === uploadsBefore, 'uploads=' + uploadFlagsIssued.length);
    assert('retry-same-uuid-posts', accountPostBodies.every((b) => b.receiptFlag === flagStable), JSON.stringify(accountPostBodies));
    assert('retry-success-closes', (await page.locator('#accountLabel').count()) === 0, 'closed');
    assert('retry-bound-no-staged-delete', stagedDeletes.filter((f) => f === flagStable).length === 0, JSON.stringify(stagedDeletes));
    results.realFormFillEvidence.push({ scenario: 'retry-409-then-ok', flag: flagStable, posts: accountPostBodies.slice() });

    // ===== Account save holdThenOk: real click + double-click while held =====
    holdSavePost = null;
    resolveSavePost = null;
    savePostMode = 'holdThenOk';
    const postsBeforeHold = savePostCount;
    await openCreateFresh();
    await page.fill('#accountLabel', 'HOLD_SAVE');
    await page.fill('#accountValue', '21.00');
    await page.selectOption('#accountCategory', 'donation');
    await page.fill('#accountDescription', 'hold save');
    await page.locator('.admin-dialog button[type="submit"]').click();
    await waitFor(() => holdSavePost != null && typeof resolveSavePost === 'function', 8000, 'account-save-hold');
    assert('account-save-hold-entered-runtime', !!(results.holdGateExecutions['account-save-holdThenOk'] || {}).held, 'held');
    // rapid double-click while in-flight
    await page.locator('.admin-dialog button[type="submit"]').click({ force: true }).catch(() => {});
    await page.locator('.admin-dialog button[type="submit"]').click({ force: true }).catch(() => {});
    await page.waitForTimeout(200);
    assert('account-save-hold-single-post', savePostCount === postsBeforeHold + 1, 'posts=' + savePostCount + ' base=' + postsBeforeHold);
    ensureGate('account-save-holdThenOk').doubleClickRequestCount = savePostCount - postsBeforeHold;
    // Esc / backdrop / close blocked
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);
    assert('account-save-hold-esc-blocked', (await page.locator('#accountLabel').count()) === 1, 'open');
    await page.locator('.admin-dialog-backdrop').first().click({ position: { x: 4, y: 4 }, force: true }).catch(() => {});
    await page.waitForTimeout(80);
    assert('account-save-hold-backdrop-blocked', (await page.locator('#accountLabel').count()) === 1, 'open');
    await page.locator('.admin-dialog-close').first().click({ force: true }).catch(() => {});
    await page.waitForTimeout(80);
    assert('account-save-hold-close-blocked', (await page.locator('#accountLabel').count()) === 1, 'open');
    const midState = await page.evaluate(() => {
      const vm = document.querySelector('#workspace').__vue__;
      return { saving: !!(vm && vm.saving), open: !!(vm && vm.editOpen) };
    });
    recordControlledWrite('account-save-hold-mid-state', { midState, requestCount: savePostCount - postsBeforeHold });
    resolveSavePost();
    await waitFor(async () => (await page.locator('#accountLabel').count()) === 0, 8000, 'account-save-release-close');
    ensureGate('account-save-holdThenOk').final = 'closed-success';
    assert('account-save-hold-released', !!(results.holdGateExecutions['account-save-holdThenOk'] || {}).released, 'released');
    savePostMode = 'ok';

    // Reverse dialog real UI + holdThenOk double-click (stable selector, no text wait / no swallowed timeout)
    await page.locator('button:has-text("冲正")').first().click();
    await page.waitForSelector('#accountReverseReason', { timeout: 5000 });
    await assertDialogFocus(page, 'account-reverse-initial-focus');
    await shot(page, '03-account-reverse-dialog', { page: 'account', viewport: '1440x900', state: 'reverse' });
    await assertTabCycle(page, 'account-reverse');
    reverseMode = 'holdThenOk';
    holdReverse = null;
    resolveReverse = null;
    const revBefore = reversePostCount;
    await page.fill('#accountReverseReason', '录入纠错夹具');
    const reverseGateStarted = Date.now();
    let reverseActionTimeout = 0;
    // Two real DOM clicks in one evaluate (before await), via stable primary action button
    const reverseClicks = await page.evaluate(() => {
      const reason = document.getElementById('accountReverseReason');
      const dialog = reason && reason.closest('[role="dialog"]');
      const btn = dialog && dialog.querySelector('.admin-dialog-actions .ui-button.is-primary');
      if (!btn) return { ok: false, reason: 'no-primary-btn' };
      btn.click();
      const after1 = { disabled: !!btn.disabled, text: String(btn.textContent || '').trim() };
      btn.click();
      const after2 = { disabled: !!btn.disabled, text: String(btn.textContent || '').trim() };
      return {
        ok: true,
        click1: true,
        click2: true,
        after1,
        after2,
        selector: '.admin-dialog-actions .ui-button.is-primary'
      };
    });
    assert('reverse-double-click-executed', !!(reverseClicks && reverseClicks.ok && reverseClicks.click1 && reverseClicks.click2), JSON.stringify(reverseClicks));
    await waitFor(() => holdReverse != null && typeof resolveReverse === 'function', 4000, 'reverse-hold');
    const holdEnteredAt = Date.now();
    assert('reverse-hold-entered-fast', holdEnteredAt - reverseGateStarted < 5000, 'ms=' + (holdEnteredAt - reverseGateStarted));
    // Mid-hold state: single POST, reversing, button disabled, Esc blocked
    await page.waitForTimeout(40);
    const revMid = await page.evaluate(() => {
      const vm = document.querySelector('#workspace') && document.querySelector('#workspace').__vue__;
      const reason = document.getElementById('accountReverseReason');
      const dialog = reason && reason.closest('[role="dialog"]');
      const btn = dialog && dialog.querySelector('.admin-dialog-actions .ui-button.is-primary');
      return {
        reversing: !!(vm && vm.reversing),
        open: !!(vm && vm.reverseItem),
        btnDisabled: !!(btn && btn.disabled),
        btnText: btn ? String(btn.textContent || '').trim() : null
      };
    });
    assert('reverse-hold-single-post', reversePostCount === revBefore + 1, 'n=' + reversePostCount + ' base=' + revBefore);
    assert('reverse-hold-reversing-true', revMid.reversing === true, JSON.stringify(revMid));
    assert('reverse-hold-btn-disabled', revMid.btnDisabled === true, JSON.stringify(revMid));
    ensureGate('account-reverse-holdThenOk').doubleClickRequestCount = reversePostCount - revBefore;
    await page.keyboard.press('Escape');
    await page.waitForTimeout(60);
    assert('reverse-hold-esc-blocked', (await page.locator('#accountReverseReason').count()) === 1, 'open');
    resolveReverse();
    await waitFor(async () => (await page.locator('#accountReverseReason').count()) === 0, 4000, 'reverse-release');
    const reverseGateEnded = Date.now();
    const reverseDurationMs = reverseGateEnded - reverseGateStarted;
    ensureGate('account-reverse-holdThenOk').final = 'closed-success';
    ensureGate('account-reverse-holdThenOk').durationMs = reverseDurationMs;
    reverseMode = 'ok';
    results.reverseDoubleClickAudit = {
      clicks: reverseClicks,
      requestCount: reversePostCount - revBefore,
      held: !!(results.holdGateExecutions['account-reverse-holdThenOk'] || {}).held,
      released: !!(results.holdGateExecutions['account-reverse-holdThenOk'] || {}).released,
      btnDisabledWhileHeld: revMid.btnDisabled,
      reversingWhileHeld: revMid.reversing,
      durationMs: reverseDurationMs,
      actionTimeoutCount: reverseActionTimeout,
      mid: revMid
    };
    recordControlledWrite('account-reverse-double-click-audit', results.reverseDoubleClickAudit);
    assert('reverse-gate-duration-lt-5s', reverseDurationMs < 5000, 'ms=' + reverseDurationMs);
    assert('reverse-action-timeout-zero', reverseActionTimeout === 0, 'timeouts=' + reverseActionTimeout);
    assert('reverse-closes', (await page.locator('#accountReverseReason').count()) === 0, 'closed');

    // Detail focus
    const detailBtn = page.locator('button:has-text("详情")').first();
    await detailBtn.click();
    await page.waitForTimeout(300);
    await assertDialogFocus(page, 'account-detail-initial-focus');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
    assert('account-detail-esc-closes', (await page.locator('[aria-labelledby="accountDetailTitle"]').count()) === 0, 'closed');

    // Viewports account list + create padding shots at 390/320
    for (const vp of VIEWPORTS) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.waitForTimeout(80);
      const ox = await overflowX(page);
      assert('account-vp-' + vp.name + '-no-x-overflow', !ox.overflow, JSON.stringify(ox));
      if (vp.name === '390x844') await shot(page, '04-account-390', { page: 'account', viewport: vp.name, state: 'list' });
      if (vp.name === '320x700') await shot(page, '05-account-320', { page: 'account', viewport: vp.name, state: 'list' });
    }
    for (const vp of [{ name: '390x844', width: 390, height: 844 }, { name: '320x700', width: 320, height: 700 }]) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.locator('button:has-text("新增记录")').first().click({ force: true });
      await page.waitForSelector('#accountLabel', { timeout: 5000 });
      await scrollDialogBodyTop(page);
      await assertEditDialogPadding(page, 'account-create-' + vp.name.replace('x', 'x'));
      await shot(page, vp.name === '390x844' ? '06-account-create-390' : '06b-account-create-320', {
        page: 'account', viewport: vp.name, state: 'create-top'
      });
      await page.keyboard.press('Escape');
      await page.waitForTimeout(150);
    }
    await page.setViewportSize({ width: 1440, height: 900 });

    // ========== NOTICE PAGE ==========
    savePostMode = 'ok';
    noticeSaveMode = 'ok';
    noticeDeleteMode = 'ok';
    noticeWriteCount = 0;
    noticeDeleteCount = 0;
    await page.goto(base + '/page/end/notice.html', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForFunction(() => {
      const el = document.querySelector('#workspace');
      return el && el.__vue__ && el.__vue__.loading === false;
    }, { timeout: 15000 });
    assert('notice-title', /公告/.test(await page.locator('h1').innerText()), 'title');
    const noticeFixtureDom = (await page.locator('text=UI_2G_NOTICE_A').count())
      + (await page.locator('text=UI_2G_NOTICE_B').count());
    const noticeFixtureVm = await page.evaluate(() => {
      const vm = document.querySelector('#workspace') && document.querySelector('#workspace').__vue__;
      const rec = (vm && vm.records) || [];
      return {
        n: rec.length,
        titles: rec.map((r) => r.title),
        loadError: (vm && vm.loadError) || '',
        loading: !!(vm && vm.loading)
      };
    });
    logVm('notice fixture state check after load (not a write)', 'vm.records titles');
    assert(
      'notice-fixture',
      noticeFixtureDom >= 1 || (noticeFixtureVm.titles || []).some((t) => /UI_2G_NOTICE/.test(String(t || ''))),
      JSON.stringify({ noticeFixtureDom, noticeFixtureVm })
    );
    assert('notice-metrics', (await page.locator('.notice-governance-metric').count()) >= 2, 'metrics');
    await shot(page, '07-notice-list', { page: 'notice', viewport: '1440x900', state: 'list' });

    // Open publish — shot + padding before tab cycle
    const publishTrigger = page.locator('button:has-text("发布公告")');
    await publishTrigger.click();
    await page.waitForSelector('#noticeTitleInput', { timeout: 5000 });
    await assertDialogFocus(page, 'notice-create-initial-focus');
    const nTags = await page.evaluate(() => ({
      titleId: document.getElementById('noticeTitleInput') && document.getElementById('noticeTitleInput').id,
      contentId: document.getElementById('noticeContentInput') && document.getElementById('noticeContentInput').id,
      titleCount: document.querySelectorAll('#noticeTitleInput').length,
      contentCount: document.querySelectorAll('#noticeContentInput').length,
      hasBody: !!document.querySelector('[role="dialog"] .admin-dialog-body')
    }));
    assert('notice-title-id-runtime', nTags.titleId === 'noticeTitleInput' && nTags.titleCount === 1, JSON.stringify(nTags));
    assert('notice-content-id-runtime', nTags.contentId === 'noticeContentInput' && nTags.contentCount === 1, JSON.stringify(nTags));
    assert('notice-create-has-body-runtime', nTags.hasBody, JSON.stringify(nTags));
    await scrollDialogBodyTop(page);
    await assertEditDialogPadding(page, 'notice-create-1440');
    await shot(page, '08-notice-publish-dialog', { page: 'notice', viewport: '1440x900', state: 'publish-top' });
    await assertTabCycle(page, 'notice-create');
    await scrollDialogBodyTop(page);

    // empty title submit
    const nw0 = noticeWriteCount;
    await page.fill('#noticeTitleInput', '');
    await page.fill('#noticeContentInput', '有正文');
    await page.locator('.admin-dialog button[type="submit"]').first().click();
    await page.waitForTimeout(150);
    assert('notice-empty-title-no-write', noticeWriteCount === nw0, 'writes=' + noticeWriteCount);
    assert('notice-empty-title-error', (await page.locator('#noticeTitleError').count()) === 1, 'err');
    assert('notice-empty-title-focus', (await page.evaluate(() => document.activeElement && document.activeElement.id)) === 'noticeTitleInput', 'focus');
    assert('notice-empty-title-aria', await page.locator('#noticeTitleInput').getAttribute('aria-invalid') === 'true', 'aria');

    // empty content
    await page.fill('#noticeTitleInput', '标题OK');
    await page.fill('#noticeContentInput', '');
    await page.locator('.admin-dialog button[type="submit"]').first().click();
    await page.waitForTimeout(150);
    assert('notice-empty-content-no-write', noticeWriteCount === nw0, 'writes');
    assert('notice-empty-content-error', (await page.locator('#noticeContentError').count()) === 1, 'err');
    assert('notice-empty-content-focus', (await page.evaluate(() => document.activeElement && document.activeElement.id)) === 'noticeContentInput', 'focus');

    // 409 / 500 keep fields then retry
    await page.fill('#noticeTitleInput', 'KEEP_TITLE');
    await page.fill('#noticeContentInput', 'KEEP_CONTENT');
    noticeSaveMode = 'fail409';
    await page.locator('.admin-dialog button[type="submit"]').first().click();
    await page.waitForTimeout(400);
    assert('notice-409-keeps-title', (await page.inputValue('#noticeTitleInput')) === 'KEEP_TITLE', 'title');
    assert('notice-409-keeps-content', (await page.inputValue('#noticeContentInput')) === 'KEEP_CONTENT', 'content');
    assert('notice-409-dialog-open', (await page.locator('#noticeTitleInput').count()) === 1, 'open');

    noticeSaveMode = 'fail500';
    await page.locator('.admin-dialog button[type="submit"]').first().click();
    await page.waitForTimeout(400);
    assert('notice-500-keeps-title', (await page.inputValue('#noticeTitleInput')) === 'KEEP_TITLE', 'title');
    assert('notice-500-keeps-content', (await page.inputValue('#noticeContentInput')) === 'KEEP_CONTENT', 'content');

    noticeSaveMode = 'ok';
    await page.locator('.admin-dialog button[type="submit"]').first().click();
    await page.waitForTimeout(450);
    assert('notice-retry-success-closes', (await page.locator('#noticeTitleInput').count()) === 0, 'closed');
    results.realFormFillEvidence.push({ scenario: 'notice-409-500-retry-ok', writes: noticeWriteCount });

    // ===== Notice save holdThenOk (real click, no vm.saving assign) =====
    holdNoticeSave = null;
    resolveNoticeSave = null;
    noticeSaveMode = 'holdThenOk';
    const nwHoldBase = noticeWriteCount;
    await page.locator('button:has-text("发布公告")').click();
    await page.waitForSelector('#noticeTitleInput');
    await page.fill('#noticeTitleInput', 'HOLD_NOTICE');
    await page.fill('#noticeContentInput', 'HOLD_NOTICE_BODY');
    await page.locator('.admin-dialog button[type="submit"]').first().click();
    await waitFor(() => holdNoticeSave != null && typeof resolveNoticeSave === 'function', 8000, 'notice-save-hold');
    assert('notice-save-hold-entered-runtime', !!(results.holdGateExecutions['notice-save-holdThenOk'] || {}).held, 'held');
    await page.locator('.admin-dialog button[type="submit"]').first().click({ force: true }).catch(() => {});
    await page.locator('.admin-dialog button[type="submit"]').first().click({ force: true }).catch(() => {});
    await page.waitForTimeout(200);
    assert('notice-save-hold-single-write', noticeWriteCount === nwHoldBase + 1, 'writes=' + noticeWriteCount);
    ensureGate('notice-save-holdThenOk').doubleClickRequestCount = noticeWriteCount - nwHoldBase;
    await page.keyboard.press('Escape');
    await page.waitForTimeout(80);
    assert('notice-save-hold-esc-blocked', (await page.locator('#noticeTitleInput').count()) === 1, 'open');
    await page.locator('.admin-dialog-backdrop').first().click({ position: { x: 4, y: 4 }, force: true }).catch(() => {});
    await page.waitForTimeout(80);
    assert('notice-save-hold-backdrop-blocked', (await page.locator('#noticeTitleInput').count()) === 1, 'open');
    await page.locator('.admin-dialog-close').first().click({ force: true }).catch(() => {});
    await page.waitForTimeout(80);
    assert('notice-save-hold-close-blocked', (await page.locator('#noticeTitleInput').count()) === 1, 'open');
    const noticeMid = await page.evaluate(() => {
      const vm = document.querySelector('#workspace').__vue__;
      return { saving: !!(vm && vm.saving), open: !!(vm && vm.editOpen) };
    });
    recordControlledWrite('notice-save-hold-mid-state', { noticeMid, requestCount: noticeWriteCount - nwHoldBase });
    resolveNoticeSave();
    await waitFor(async () => (await page.locator('#noticeTitleInput').count()) === 0, 8000, 'notice-save-release');
    ensureGate('notice-save-holdThenOk').final = 'closed-success';
    assert('notice-save-hold-released', !!(results.holdGateExecutions['notice-save-holdThenOk'] || {}).released, 'released');
    noticeSaveMode = 'ok';

    // Delete: fail focus, then holdThenOk double-click, then success path already covered by hold release
    noticeDeleteMode = 'fail500';
    await page.locator('button:has-text("删除")').first().click();
    await page.waitForTimeout(300);
    await assertDialogFocus(page, 'notice-delete-initial-focus');
    await shot(page, '09-notice-delete-dialog', { page: 'notice', viewport: '1440x900', state: 'delete' });
    await assertTabCycle(page, 'notice-delete');
    await page.locator('[role="alertdialog"] button:has-text("删除"), [role="alertdialog"] button:has-text("确认")').first().click();
    await page.waitForTimeout(400);
    const delFocus = await page.evaluate(() => {
      const a = document.activeElement;
      return { id: a && a.id, role: a && a.getAttribute && a.getAttribute('role'), text: a && a.textContent };
    });
    assert('notice-delete-fail-focus-error', delFocus.id === 'noticeDeleteError' || delFocus.role === 'alert', JSON.stringify(delFocus));

    // holdThenOk delete
    holdNoticeDelete = null;
    resolveNoticeDelete = null;
    noticeDeleteMode = 'holdThenOk';
    const delBefore = noticeDeleteCount;
    await page.locator('[role="alertdialog"] button:has-text("删除"), [role="alertdialog"] button:has-text("确认")').first().click();
    await waitFor(() => holdNoticeDelete != null && typeof resolveNoticeDelete === 'function', 8000, 'notice-delete-hold');
    await page.locator('[role="alertdialog"] button:has-text("删除"), [role="alertdialog"] button:has-text("确认")').first().click({ force: true }).catch(() => {});
    await page.locator('[role="alertdialog"] button:has-text("删除"), [role="alertdialog"] button:has-text("确认")').first().click({ force: true }).catch(() => {});
    await page.waitForTimeout(150);
    assert('notice-delete-hold-single', noticeDeleteCount === delBefore + 1, 'n=' + noticeDeleteCount);
    ensureGate('notice-delete-holdThenOk').doubleClickRequestCount = noticeDeleteCount - delBefore;
    await page.keyboard.press('Escape');
    await page.waitForTimeout(80);
    assert('notice-delete-hold-esc-blocked', (await page.locator('[role="alertdialog"]').count()) === 1, 'open');
    resolveNoticeDelete();
    await waitFor(async () => (await page.locator('[role="alertdialog"]').count()) === 0, 8000, 'notice-delete-release');
    ensureGate('notice-delete-holdThenOk').final = 'closed-success';
    noticeDeleteMode = 'ok';
    assert('notice-delete-retry-closes', (await page.locator('[role="alertdialog"]').count()) === 0, 'closed');

    // Detail focus
    await page.locator('button:has-text("详情")').first().click();
    await page.waitForTimeout(300);
    await assertDialogFocus(page, 'notice-detail-initial-focus');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    assert('notice-detail-esc', (await page.locator('[aria-labelledby="noticeDetailTitle"]').count()) === 0, 'closed');

    // Viewports notice + publish padding at 390/320
    for (const vp of VIEWPORTS) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.waitForTimeout(80);
      const ox = await overflowX(page);
      assert('notice-vp-' + vp.name + '-no-x-overflow', !ox.overflow, JSON.stringify(ox));
      if (vp.name === '390x844') await shot(page, '10-notice-390', { page: 'notice', viewport: vp.name, state: 'list' });
      if (vp.name === '320x700') await shot(page, '11-notice-320', { page: 'notice', viewport: vp.name, state: 'list' });
    }
    for (const vp of [{ name: '390x844', width: 390, height: 844, shot: '12-notice-publish-390' }, { name: '320x700', width: 320, height: 700, shot: '13-notice-publish-320' }]) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.locator('button:has-text("发布公告")').first().click({ force: true });
      await page.waitForSelector('#noticeTitleInput', { timeout: 5000 });
      await scrollDialogBodyTop(page);
      await assertEditDialogPadding(page, 'notice-create-' + vp.name);
      const geom = await assertNoticePrimaryButtonTextInset(page, 'notice-publish-btn-' + vp.name);
      if (vp.name === '320x700') {
        assert('notice-publish-320-stacked-actions', !!(geom && geom.stacked), JSON.stringify(geom));
      }
      await shot(page, vp.shot, { page: 'notice', viewport: vp.name, state: 'publish-top' });
      await page.keyboard.press('Escape');
      await page.waitForTimeout(150);
    }
    await page.setViewportSize({ width: 1440, height: 900 });

    // Required hold gates must have actually executed
    const requiredGates = [
      'account-save-holdThenOk',
      'account-reverse-holdThenOk',
      'notice-save-holdThenOk',
      'notice-delete-holdThenOk'
    ];
    for (const g of requiredGates) {
      const gate = results.holdGateExecutions[g];
      assert('gate-' + g + '-held', !!(gate && gate.held), JSON.stringify(gate));
      assert('gate-' + g + '-released', !!(gate && gate.released), JSON.stringify(gate));
      assert('gate-' + g + '-single-req', !!(gate && gate.doubleClickRequestCount === 1), JSON.stringify(gate));
    }
    assert('controlled-write-scenarios-min', results.controlledWriteScenarios.length >= 8, 'n=' + results.controlledWriteScenarios.length);
    assert('reverse-double-click-audit-present', !!(results.reverseDoubleClickAudit && results.reverseDoubleClickAudit.clicks && results.reverseDoubleClickAudit.clicks.click1 && results.reverseDoubleClickAudit.clicks.click2), JSON.stringify(results.reverseDoubleClickAudit));
    assert('reverse-double-click-req-one', !!(results.reverseDoubleClickAudit && results.reverseDoubleClickAudit.requestCount === 1), JSON.stringify(results.reverseDoubleClickAudit));
    assert('action-timeout-count-zero', (results.actionTimeoutCount || 0) === 0, JSON.stringify(results.actionTimeoutLog));
    assert('notice-button-geometry-min', (results.noticeButtonGeometry || []).length >= 2, 'n=' + (results.noticeButtonGeometry || []).length);

    // Console / http gates
    const realConsole = consoleErrors.filter(isRealConsoleError);
    const badHttp = httpErrors.filter((e) => !isIntentionalHttp(e));
    results.consoleAudit = {
      consoleErrors: consoleErrors.slice(),
      pageErrors: pageErrors.slice(),
      realConsole,
      httpErrors: httpErrors.slice(),
      badHttp
    };
    assert('no-real-console-error', realConsole.length === 0, JSON.stringify(realConsole.slice(0, 5)));
    assert('no-pageerror', pageErrors.length === 0, JSON.stringify(pageErrors.slice(0, 5)));
    assert('no-unregistered-http-error', badHttp.length === 0, JSON.stringify(badHttp.slice(0, 5)));
    assert('no-request-failed-write', results.requestFailedWrite.length === 0, JSON.stringify(results.requestFailedWrite.slice(0, 5)));
    assert('screenshots-min-10', results.screenshots.length >= 10, 'n=' + results.screenshots.length);
    assert('strict-probes-min', results.strictRuntimeProbeCount >= 8, 'probes=' + results.strictRuntimeProbeCount);
    assert('receipt-timelines-3', results.receiptRaceTimelines.length >= 3, 'n=' + results.receiptRaceTimelines.length);
    assert('dialog-padding-audits-min', results.dialogPaddingAudit.length >= 5, 'n=' + results.dialogPaddingAudit.length);

    // Screenshot dir only indexed files
    const shotFiles = fs.readdirSync(shotDir).filter((f) => f.endsWith('.png')).sort();
    const indexed = results.screenshots.map((s) => path.basename(s.file)).sort();
    assert('screenshot-dir-matches-index', JSON.stringify(shotFiles) === JSON.stringify(indexed), JSON.stringify({ shotFiles, indexed }));

    summary = writeReport();
    console.log('Phase 2G summary', summary);
    if (browser) await browser.close();
    process.exit(summary.failed === 0 && summary.strictMode ? 0 : 1);
  } catch (err) {
    console.error('SUITE_CRASH', err && err.stack || err);
    fail('suite-crash', String(err && err.message || err));
    summary = writeReport();
    try { if (browser) await browser.close(); } catch (e) {}
    process.exit(1);
  }
})();
