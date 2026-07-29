/**
 * Production-oriented system crawler: visit all static pages as anon + admin + user,
 * open dialogs, measure overflow/overlap signals, capture console/network.
 */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:9999';
const VIEWPORT_WIDTH = Number(process.env.VIEWPORT_WIDTH || 1366);
const VIEWPORT_HEIGHT = Number(process.env.VIEWPORT_HEIGHT || 768);
const PATH_FILTER = process.env.AUDIT_PATH_FILTER
  ? new RegExp(process.env.AUDIT_PATH_FILTER, 'i')
  : null;
const AUDIT_LABEL = (process.env.AUDIT_LABEL || `${VIEWPORT_WIDTH}x${VIEWPORT_HEIGHT}`)
  .replace(/[^a-zA-Z0-9_-]/g, '_');
const OUT = path.resolve('output/system-audit');
const SHOT = path.join(OUT, 'screenshots', AUDIT_LABEL);
const REP = path.join(OUT, 'reports');
for (const d of [SHOT, REP, path.join(OUT, 'console'), path.join(OUT, 'network')]) {
  fs.mkdirSync(d, { recursive: true });
}

async function resolveSampleIds() {
  let animalId = '10011';
  let noticeId = '1';
  try {
    const ar = await fetch(`${BASE}/api/animal/page1?pageNum=1&pageSize=1`);
    const aj = await ar.json();
    const rec = aj?.data?.records?.[0];
    if (rec?.id != null) animalId = String(rec.id);
  } catch (_) { /* keep fallback */ }
  try {
    const nr = await fetch(`${BASE}/api/notice/page?pageNum=1&pageSize=1`);
    const nj = await nr.json();
    const rec = nj?.data?.records?.[0];
    if (rec?.id != null) noticeId = String(rec.id);
  } catch (_) { /* keep fallback */ }
  return { animalId, noticeId };
}

function buildFront(ids) {
  return [
  '/page/front/index.html',
  '/page/front/login.html',
  '/page/front/register.html',
  '/page/front/animal_browse.html',
  `/page/front/animal_detail.html?id=${ids.animalId}`,
  '/page/front/notice_list.html',
  `/page/front/notice_detail.html?id=${ids.noticeId}`,
  '/page/front/account_public.html',
  '/page/front/adopt_apply.html',
  '/page/front/adopt_proof.html',
  '/page/front/my_adopt.html',
  '/page/front/my_visit.html',
  '/page/front/my_volunteer.html',
  '/page/front/my_rescue.html',
  '/page/front/volunteer_apply.html',
  '/page/front/rescue_apply.html',
  '/page/front/pet_care.html',
];
}
const ADMIN = [
  '/page/end/index.html',
  '/page/end/animal.html',
  '/page/end/adopt.html',
  '/page/end/proof.html',
  '/page/end/visit.html',
  '/page/end/volunteer.html',
  '/page/end/help.html',
  '/page/end/notice.html',
  '/page/end/account.html',
  '/page/end/user.html',
  '/page/end/role.html',
  '/page/end/permission.html',
  '/page/end/person.html',
  '/page/end/admin_agent.html',
];

const findings = [];
const pageResults = [];
function finding(sev, page, title, detail) {
  findings.push({ sev, page, title, detail, at: new Date().toISOString() });
  console.log(`[${sev}] ${page} :: ${title} — ${detail}`);
}

async function measurePage(page) {
  return page.evaluate(() => {
    const issues = [];
    if (document.documentElement.scrollWidth > window.innerWidth + 2) {
      issues.push(`h-overflow scrollW=${document.documentElement.scrollWidth} vw=${window.innerWidth}`);
    }
    if (document.querySelector('[v-cloak]')) issues.push('v-cloak still present');
    const bodyText = document.body.innerText || '';
    if (/\{\{[^}]+\}\}/.test(bodyText)) issues.push('unrendered mustache');
    return {
      issues,
      dialogs: document.querySelectorAll('[role=dialog], [role=alertdialog], .admin-dialog, .ui-dialog').length,
      forms: document.querySelectorAll('form').length,
      buttons: document.querySelectorAll('button').length,
      scrollW: document.documentElement.scrollWidth,
      vw: innerWidth,
      vh: innerHeight,
    };
  });
}

async function measureDialog(dialog) {
  return dialog.evaluate((root) => {
    const issues = [];
    const visible = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
    const box = root.getBoundingClientRect();
    if (box.left < -2 || box.right > innerWidth + 2) {
      issues.push(`dialog horizontal viewport overflow left=${Math.round(box.left)} right=${Math.round(box.right)} vw=${innerWidth}`);
    }
    if (box.top < -2 || box.bottom > innerHeight + 2) {
      issues.push(`dialog vertical viewport overflow top=${Math.round(box.top)} bottom=${Math.round(box.bottom)} vh=${innerHeight}`);
    }
    if (root.scrollWidth > root.clientWidth + 2) {
      issues.push(`dialog internal horizontal overflow scrollW=${root.scrollWidth} clientW=${root.clientWidth}`);
    }

    const controls = [...root.querySelectorAll('input:not([type=hidden]):not([type=file]):not([type=checkbox]):not([type=radio]), select, textarea')]
      .filter(visible);
    const nativeLike = controls.filter((el) => {
      const cs = getComputedStyle(el);
      const height = el.getBoundingClientRect().height;
      return parseFloat(cs.borderRadius) < 6 || height < 40;
    });
    if (nativeLike.length) issues.push(`native-like or undersized controls=${nativeLike.length}`);

    for (const btn of root.querySelectorAll('.admin-dialog-head > button, .ui-dialog-head > button')) {
      if (!visible(btn)) continue;
      const range = document.createRange();
      range.selectNodeContents(btn);
      const lines = range.getClientRects().length;
      const rect = btn.getBoundingClientRect();
      const whiteSpace = getComputedStyle(btn).whiteSpace;
      if (lines > 1 || whiteSpace !== 'nowrap') {
        issues.push(`close button wraps text="${btn.textContent.trim()}" lines=${lines} whiteSpace=${whiteSpace}`);
      }
      if (rect.width < 44 || rect.height < 44) {
        issues.push(`close button undersized ${Math.round(rect.width)}x${Math.round(rect.height)}`);
      }
    }

    const actions = root.querySelector('.admin-dialog-actions, .ui-dialog-actions');
    if (actions && visible(actions)) {
      for (const btn of actions.querySelectorAll('button, a')) {
        if (!visible(btn)) continue;
        const rect = btn.getBoundingClientRect();
        if (rect.width < 44 || rect.height < 40) {
          issues.push(`dialog action undersized "${btn.textContent.trim()}" ${Math.round(rect.width)}x${Math.round(rect.height)}`);
        }
      }
    }
    return {
      issues,
      box: { left: box.left, top: box.top, right: box.right, bottom: box.bottom, width: box.width, height: box.height },
      controls: controls.length,
    };
  });
}

async function login(context, user, pass) {
  const res = await context.request.post(`${BASE}/api/user/login`, {
    data: { username: user, password: pass },
    headers: { 'Content-Type': 'application/json' },
  });
  const j = await res.json();
  if (j.code !== '0') throw new Error(`login ${user}: ${JSON.stringify(j)}`);
  return j.data;
}

async function auditPage(page, role, urlPath) {
  const url = BASE + urlPath;
  const slug = `${role}__${urlPath.replace(/[/?=&]/g, '_')}`;
  const cons = [];
  const failedNet = [];
  const onCons = (msg) => {
    if (msg.type() === 'error') cons.push(msg.text());
  };
  const onPageErr = (err) => cons.push('pageerror:' + err.message);
  const onResp = (res) => {
    if (res.status() >= 400 && !res.url().includes('favicon')) {
      failedNet.push({ status: res.status(), url: res.url() });
    }
  };
  page.on('console', onCons);
  page.on('pageerror', onPageErr);
  page.on('response', onResp);

  let status = 0;
  let title = '';
  let metrics = {};
  const dialogResults = [];
  try {
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    status = resp ? resp.status() : 0;
    await page.waitForTimeout(900);
    title = await page.title();
    metrics = await measurePage(page);

    // try open first visible dialog trigger
    const triggers = page.locator('button:visible').filter({ hasText: /编辑|新增|添加|创建|配置|详情|审核|删除|通过|驳回|打开/ });
    const tcount = await triggers.count();
    let opened = 0;
    for (let i = 0; i < Math.min(tcount, 12); i++) {
      try {
        const t = triggers.nth(i);
        if (!(await t.isVisible())) continue;
        await t.click({ timeout: 2000 }).catch(() => {});
        await page.waitForTimeout(350);
        const dlg = page.locator('.admin-dialog:visible, .ui-dialog:visible, [role=dialog]:visible').first();
        if (await dlg.isVisible().catch(() => false)) {
          opened++;
          const dialogMetrics = await measureDialog(dlg);
          dialogResults.push(dialogMetrics);
          for (const issue of dialogMetrics.issues) {
            finding(issue.includes('overflow') || issue.includes('wraps') ? 'P1' : 'P2',
              urlPath, `dialog ${opened} layout`, issue);
          }
          await page.screenshot({ path: path.join(SHOT, `${slug}__dlg${opened}.png`), fullPage: true });
          // measure close
          const close = dlg.locator('.admin-dialog-head > button, .ui-dialog-head > button, button:has-text("关闭")').first();
          if (await close.count()) {
            const box = await close.boundingBox();
            const lines = await close.evaluate((el) => {
              const r = document.createRange();
              r.selectNodeContents(el);
              return r.getClientRects().length;
            });
            if (box && (box.height < 44 || box.width < 44 || lines > 1)) {
              finding('P1', urlPath, 'dialog close button issue', `h=${box?.height} lines=${lines}`);
            }
            await close.click({ timeout: 2000 }).catch(() => page.keyboard.press('Escape'));
          } else {
            await page.keyboard.press('Escape');
          }
          await page.waitForTimeout(200);
        }
      } catch { /* continue */ }
    }

    await page.screenshot({ path: path.join(SHOT, `${slug}.png`), fullPage: true });

    const brokenImages = await page.locator('img').evaluateAll((images) => images
      .filter((img) => img.complete && img.naturalWidth === 0)
      .map((img) => ({ src: img.currentSrc || img.src, alt: img.alt || '' })));

    for (const iss of metrics.issues || []) {
      finding(iss.includes('overflow') || iss.includes('wrap') ? 'P1' : 'P2', urlPath, 'layout/console', iss);
    }
    // filter expected auth failures for protected pages
    const expected401 = failedNet.filter((f) =>
      (f.status === 401 || f.status === 403) && f.url.includes('/api/user/me'));
    const unexpectedClientFailures = failedNet.filter((f) =>
      f.status >= 400 && f.status < 500
      && !((f.status === 401 || f.status === 403) && f.url.includes('/api/user/me'))
      && !(f.status === 404 && f.url.includes('/api/files/') && brokenImages.length === 0));
    const hardFails = failedNet.filter((f) => f.status >= 500 || (f.status === 404 && !f.url.includes('/api/')));
    if (hardFails.length) {
      finding('P1', urlPath, 'network failures', JSON.stringify(hardFails.slice(0, 5)));
    }
    if (unexpectedClientFailures.length) {
      finding('P2', urlPath, 'unexpected client/network failures', JSON.stringify(unexpectedClientFailures.slice(0, 5)));
    }
    if (cons.length) {
      const real = cons.filter((c) => !/favicon|DevTools|Download the Vue|Failed to load resource/i.test(c));
      if (real.length) finding('P2', urlPath, 'console errors', real.slice(0, 3).join(' | '));
    }

    pageResults.push({
      role, urlPath, status, title, openedDialogs: opened,
      metrics, dialogResults, console: cons.slice(0, 10), failedNet: failedNet.slice(0, 15),
      expectedAuthNoise: expected401.length, brokenImages,
    });
  } catch (e) {
    finding('P0', urlPath, 'page load failed', e.message);
    pageResults.push({ role, urlPath, status: 0, error: e.message });
  } finally {
    page.off('console', onCons);
    page.off('pageerror', onPageErr);
    page.off('response', onResp);
  }
}

async function runRole(browser, role, user, pass, paths) {
  const context = await browser.newContext({
    viewport: { width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT },
  });
  if (user) await login(context, user, pass);
  const page = await context.newPage();
  for (const p of paths) {
    console.log(`\n== ${role} ${p}`);
    await auditPage(page, role, p);
  }
  // API probe: jerry vs admin isolation sample
  if (role === 'user') {
    const r = await context.request.get(`${BASE}/api/user/page?pageNum=1&pageSize=5`);
    if (r.status() < 400) finding('P0', '/api/user/page', 'user can list users', `status=${r.status()}`);
    else console.log('PASS user blocked user/page', r.status());
  }
  await context.close();
}

async function main() {
  const ids = await resolveSampleIds();
  const FRONT = buildFront(ids);
  const selected = (paths) => PATH_FILTER ? paths.filter((p) => PATH_FILTER.test(p)) : paths;
  console.log('sample ids', ids);
  const browser = await chromium.launch({ headless: true });
  const anonPaths = selected(FRONT.filter((p) => !/my_|pet_care|adopt_apply|adopt_proof|volunteer_apply|rescue_apply/.test(p)).concat([
    '/page/front/login.html',
    '/page/end/index.html',
  ]));
  const userPaths = selected(FRONT);
  const adminPaths = selected(FRONT.concat(ADMIN));
  if (anonPaths.length) await runRole(browser, 'anon', null, null, anonPaths);
  if (userPaths.length) await runRole(browser, 'user', process.env.AUDIT_USER || 'jerry', process.env.AUDIT_USER_PASSWORD || '123456', userPaths);
  if (adminPaths.length) await runRole(browser, 'admin', process.env.AUDIT_ADMIN || 'admin', process.env.AUDIT_ADMIN_PASSWORD || 'admin', adminPaths);
  await browser.close();

  const report = {
    generatedAt: new Date().toISOString(),
    base: BASE,
    auditLabel: AUDIT_LABEL,
    viewport: { width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT },
    pagesVisited: pageResults.length,
    findings: findings,
    pageResults,
    summary: {
      p0: findings.filter((f) => f.sev === 'P0').length,
      p1: findings.filter((f) => f.sev === 'P1').length,
      p2: findings.filter((f) => f.sev === 'P2').length,
      p3: findings.filter((f) => f.sev === 'P3').length,
    },
  };
  fs.writeFileSync(path.join(REP, `crawler-report-${AUDIT_LABEL}.json`), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(REP, `findings-${AUDIT_LABEL}.md`), findings.map((f) => `- **${f.sev}** \`${f.page}\` ${f.title}: ${f.detail}`).join('\n') || '_none_');
  console.log('\n=== SUMMARY ===', report.summary, 'pages=', pageResults.length);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
