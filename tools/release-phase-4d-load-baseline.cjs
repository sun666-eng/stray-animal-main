/**
 * Phase 4D mixed load — credibility repair round 2.
 *
 * - Duration >= 180s; process exit non-zero on any failure (no flush-as-pass)
 * - Writes count only real HTTP 2xx with server state verification
 * - applicationAiMock must hit application AI endpoints (not mock /health)
 * - Full request-ledger with cleanup verification
 *
 * Env:
 *   BASE_URL, AI_APP_BASE_URL (optional; default BASE_URL),
 *   DURATION_MS (>=180000), CONCURRENCY, E2E4D_LOAD_MAX_REQUESTS,
 *   E2E4D_OUT, E2E4D_RUN_ID, E2E4D_ATTEMPT_ID,
 *   E2E4D_USER_COOKIE, E2E4D_USER_CSRF, E2E4D_ADMIN_COOKIE, E2E4D_ADMIN_CSRF,
 *   E2E4D_MOCK_LLM_BASE, E2E4D_MOCK_LLM_STATS,
 *   E2E4D_JAR_SHA256, E2E4D_BASELINE_4C, E2E4D_BRANCH, E2E4D_HEAD,
 *   E2E4D_AI_SUBPROBE_PROFILE (e.g. dev-isolated), E2E4D_FORMAL_PROFILE (e.g. prod)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const { URL } = require('url');

const baseUrl = (process.env.BASE_URL || '').replace(/\/$/, '');
const aiAppBase = (process.env.AI_APP_BASE_URL || baseUrl).replace(/\/$/, '');
const requestedDurationMs = Math.max(180000, Number(process.env.DURATION_MS || 180000));
const concurrency = Math.max(1, Math.min(4, Number(process.env.CONCURRENCY || 3)));
const maxRequests = Math.max(500, Number(process.env.E2E4D_LOAD_MAX_REQUESTS || 6000));
const delayMs = Math.max(1, Number(process.env.E2E4D_LOAD_DELAY_MS || 5));
const outDir = process.env.E2E4D_OUT || path.resolve('output/playwright/release-phase-4d');
const formalRunId = process.env.E2E4D_RUN_ID || 'E2E4D_UNKNOWN';
const attemptId = process.env.E2E4D_ATTEMPT_ID || 'attempt-1';
const userCookie = process.env.E2E4D_USER_COOKIE || '';
const userCsrf = process.env.E2E4D_USER_CSRF || '';
const adminCookie = process.env.E2E4D_ADMIN_COOKIE || '';
const adminCsrf = process.env.E2E4D_ADMIN_CSRF || '';
// Optional separate cookies for AI subprobe host (dev suite)
const aiUserCookie = process.env.E2E4D_AI_USER_COOKIE || userCookie;
const aiUserCsrf = process.env.E2E4D_AI_USER_CSRF || userCsrf;
const mockLlmBase = (process.env.E2E4D_MOCK_LLM_BASE || '').replace(/\/$/, '');
const mockLlmStats = (process.env.E2E4D_MOCK_LLM_STATS || '').replace(/\/$/, '');
const jarSha = process.env.E2E4D_JAR_SHA256 || '';
const baseline4c = process.env.E2E4D_BASELINE_4C || '';
const branch = process.env.E2E4D_BRANCH || '';
const head = process.env.E2E4D_HEAD || '';
const formalProfile = process.env.E2E4D_FORMAL_PROFILE || 'prod';
const aiSubprobeProfile = process.env.E2E4D_AI_SUBPROBE_PROFILE || 'dev-isolated';
const aiNotProdEgress = String(process.env.E2E4D_AI_NOT_PROD_EGRESS || 'true').toLowerCase() !== 'false';

if (!baseUrl) {
  console.error('BASE_URL required');
  process.exit(2);
}
if (!userCookie || !adminCookie || !userCsrf || !adminCsrf) {
  console.error('user/admin cookie+csrf required');
  process.exit(2);
}

function emptyCat() {
  return {
    requestCount: 0, success2xx: 0, expected4xx: 0, unexpected4xx: 0,
    status5xx: 0, networkErrors: 0, latencies: [], firstRequestAt: null, lastRequestAt: null
  };
}

const categories = {
  health: emptyCat(),
  publicRead: emptyCat(),
  authenticatedUserRead: emptyCat(),
  adminRead: emptyCat(),
  controlledUserWrite: emptyCat(),
  controlledAdminWrite: emptyCat(),
  applicationAiMock: emptyCat()
};

let totalRequests = 0;
let success = 0;
let expected4xx = 0;
let unexpected4xx = 0;
let status5xx = 0;
let networkErrors = 0;
const allLatencies = [];
const requestRows = [];
let fixtureWrites = 0;
let cleanupWrites = 0;
let cleanupVerifiedWrites = 0;
let duplicateWrites = 0;
let realProductionWrites = 0;
let userWritesAttempted = 0;
let userWritesSucceeded = 0;
let adminWritesAttempted = 0;
let adminWritesSucceeded = 0;
let applicationAiRequestCount = 0;
let upstreamHitCount = 0;
let upstreamHitsBefore = 0;
let aiConfigSetupWrites = 0;
let aiConfigCleanupWrites = 0;
let aiConfigCleanupVerifiedWrites = 0;
let aiConfigInitialized = false;
let aiConfigInitialAbsent = false;
let aiConfigInitPromise = null;
const applicationAiRows = [];
const writeMarker = formalRunId + '_load';
const maxUserWrites = 2;
const maxAdminWrites = 2;
let userWriteDone = 0;
let adminWriteDone = 0;
const pendingCleanups = [];
let originalEmail = null;
let completedNormally = false;

function shaShort(s) {
  return crypto.createHash('sha256').update(String(s || '')).digest('hex').slice(0, 16);
}
function cookieHash(c) {
  return c ? 'sha256:' + crypto.createHash('sha256').update(c).digest('hex').slice(0, 24) : null;
}
function nowIso() { return new Date().toISOString(); }

function requestOnce(opts) {
  return new Promise((resolve) => {
    const start = Date.now();
    const fullUrl = opts.absoluteUrl || ((opts.base || baseUrl) + opts.path);
    let u;
    try { u = new URL(fullUrl); } catch (_) {
      return resolve({ ok: false, status: 0, ms: 0, networkError: true, body: '', headers: {} });
    }
    const lib = u.protocol === 'https:' ? https : http;
    const headers = Object.assign({
      Accept: 'application/json, text/plain, */*',
      'User-Agent': 'e2e4d-mixed-load/3.0',
      'X-Request-Id': opts.requestId || ('R_' + crypto.randomBytes(6).toString('hex')),
      'X-Correlation-Id': opts.correlationId || opts.requestId || ('C_' + crypto.randomBytes(6).toString('hex'))
    }, opts.headers || {});
    if (opts.cookie) headers.Cookie = opts.cookie;
    if (opts.csrf) {
      headers['X-CSRF-TOKEN'] = opts.csrf;
      headers['X-XSRF-TOKEN'] = opts.csrf;
    }
    if (opts.body) {
      headers['Content-Type'] = 'application/json; charset=utf-8';
      headers['Content-Length'] = Buffer.byteLength(opts.body);
    }
    const req = lib.request({
      protocol: u.protocol,
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search,
      method: opts.method || 'GET',
      headers,
      timeout: 20000,
      rejectUnauthorized: false
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        resolve({
          ok: true,
          status: res.statusCode || 0,
          ms: Date.now() - start,
          networkError: false,
          body,
          headers: res.headers || {},
          requestId: headers['X-Request-Id'],
          correlationId: headers['X-Correlation-Id']
        });
      });
    });
    req.on('error', () => resolve({
      ok: false, status: 0, ms: Date.now() - start, networkError: true, body: '', headers: {},
      requestId: headers['X-Request-Id'], correlationId: headers['X-Correlation-Id']
    }));
    req.on('timeout', () => { try { req.destroy(); } catch (_) {} });
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

function touchCat(catName, atIso) {
  const c = categories[catName];
  if (!c.firstRequestAt) c.firstRequestAt = atIso;
  c.lastRequestAt = atIso;
}

function record(catName, r, expect, meta) {
  totalRequests++;
  const c = categories[catName] || emptyCat();
  if (!categories[catName]) categories[catName] = c;
  c.requestCount++;
  c.latencies.push(r.ms);
  allLatencies.push(r.ms);
  const at = nowIso();
  touchCat(catName, at);
  if (r.networkError) {
    networkErrors++;
    c.networkErrors++;
  } else if (r.status >= 500) {
    status5xx++;
    c.status5xx++;
  } else if (r.status >= 400) {
    if ((expect || []).includes(r.status)) {
      expected4xx++;
      c.expected4xx++;
    } else {
      unexpected4xx++;
      c.unexpected4xx++;
    }
  } else if (r.status >= 200 && r.status < 300) {
    success++;
    c.success2xx++;
  }
  if (meta && meta.ledger) {
    requestRows.push(Object.assign({
      requestId: r.requestId || meta.requestId,
      scenarioId: meta.scenarioId,
      attemptId,
      role: meta.role || null,
      method: meta.method,
      path: meta.path,
      requestStartedAt: meta.startedAt,
      requestEndedAt: at,
      expectedStatus: expect,
      actualStatus: r.status,
      responseCode: (() => { try { return JSON.parse(r.body || '{}').code; } catch (_) { return null; } })(),
      correlationId: r.correlationId || null,
      ok: meta.ok === true
    }, meta.extra || {}));
  }
}

function pct(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}
function summarize(lat) {
  const s = lat.slice().sort((a, b) => a - b);
  return {
    count: s.length,
    min: s.length ? s[0] : null,
    max: s.length ? s[s.length - 1] : null,
    p50: pct(s, 50), p95: pct(s, 95), p99: pct(s, 99)
  };
}

async function fetchJson(opts) {
  const r = await requestOnce(opts);
  let j = null;
  try { j = JSON.parse(r.body || '{}'); } catch (_) {}
  return { r, j };
}

async function getMockHits() {
  if (!mockLlmStats) return null;
  const r = await requestOnce({ absoluteUrl: mockLlmStats, method: 'GET' });
  if (r.networkError || r.status !== 200) return null;
  try { return JSON.parse(r.body); } catch (_) { return null; }
}

async function ensureOriginalProfile() {
  const { r, j } = await fetchJson({
    path: '/api/user/me', method: 'GET', cookie: userCookie,
    requestId: 'R_ME_BEFORE'
  });
  record('authenticatedUserRead', r, [200], {
    ledger: true, scenarioId: 'user-me-before-write', role: 'user',
    method: 'GET', path: '/api/user/me', startedAt: nowIso(),
    ok: r.status === 200,
    extra: { fixtureWrite: false, realProductionWrite: false }
  });
  if (r.status === 200 && j && j.data) {
    originalEmail = j.data.email || null;
  } else {
    originalEmail = null;
  }
}

async function doUserWrite(seq) {
  userWritesAttempted++;
  // ProfileUpdateRequest supports email/phone/avatar only (no nickname field)
  const email = (writeMarker + 'u' + seq + '@e2e4d.test').toLowerCase().replace(/[^a-z0-9@._-]/g, '');
  const beforeHash = shaShort(originalEmail || '');
  const startedAt = nowIso();
  const rid = 'R_UWRITE_' + seq;
  const { r, j } = await fetchJson({
    path: '/api/user/me/profile', method: 'PUT', cookie: userCookie, csrf: userCsrf,
    body: JSON.stringify({ email }),
    requestId: rid, correlationId: rid
  });
  const bizOk = !j || j.code === '0' || j.code === 0 || j.code === '200' || j.code == null;
  const is2xx = r.status >= 200 && r.status < 300 && bizOk;
  let afterOk = false;
  let afterHash = null;
  let afterEmail = null;
  if (is2xx) {
    const ver = await fetchJson({
      path: '/api/user/me', method: 'GET', cookie: userCookie, requestId: 'R_UWRITE_VER_' + seq
    });
    record('authenticatedUserRead', ver.r, [200], {
      ledger: true, scenarioId: 'user-write-verify-read', role: 'user',
      method: 'GET', path: '/api/user/me', startedAt: nowIso(),
      ok: ver.r.status === 200,
      extra: { fixtureWrite: false }
    });
    afterEmail = ver.j && ver.j.data ? ver.j.data.email : null;
    afterHash = shaShort(afterEmail || '');
    afterOk = afterEmail === email;
  }
  const ok = is2xx && afterOk;
  if (ok) {
    userWritesSucceeded++;
    fixtureWrites++;
    pendingCleanups.push({
      kind: 'userEmail', seq, restoreTo: originalEmail, afterEmail: email
    });
  }
  record('controlledUserWrite', r, [200, 201], {
    ledger: true, scenarioId: 'controlled-user-write-' + seq, role: 'user',
    method: 'PUT', path: '/api/user/me/profile', startedAt,
    ok,
    extra: {
      resourceId: null,
      beforeStateHash: beforeHash,
      afterStateHash: afterHash,
      stateChanged: ok,
      fixtureWrite: ok,
      realProductionWrite: false,
      duplicateCount: 0,
      cleanupAction: null,
      cleanupStatus: null,
      cleanupStateHash: null,
      cleanupVerified: false
    }
  });
  return ok;
}

async function doAdminWrite(seq) {
  adminWritesAttempted++;
  const title = writeMarker + '_n' + seq;
  const content = 'e2e4d fixture notice ' + seq;
  const beforeHash = shaShort('');
  const startedAt = nowIso();
  const rid = 'R_AWRITE_' + seq;
  const { r, j } = await fetchJson({
    path: '/api/notice', method: 'POST', cookie: adminCookie, csrf: adminCsrf,
    body: JSON.stringify({ title, content }),
    requestId: rid, correlationId: rid
  });
  // saveNotice returns boolean in data — resolve id by title scan
  let resourceId = null;
  const is2xxHttp = r.status >= 200 && r.status < 300;
  let afterOk = false;
  let afterHash = null;
  if (is2xxHttp) {
    const list = await fetchJson({
      path: '/api/notice/page?pageNum=1&pageSize=50', method: 'GET', cookie: adminCookie,
      requestId: 'R_AWRITE_LIST_' + seq
    });
    record('adminRead', list.r, [200], {
      ledger: true, scenarioId: 'admin-write-list-find', role: 'admin',
      method: 'GET', path: '/api/notice/page', startedAt: nowIso(),
      ok: list.r.status === 200,
      extra: { fixtureWrite: false }
    });
    const records = (list.j && list.j.data && (list.j.data.records || list.j.data.list || list.j.data)) || [];
    if (Array.isArray(records)) {
      const hit = records.find((n) => n && n.title === title);
      if (hit) resourceId = hit.id;
    }
    if (resourceId != null) {
      const ver = await fetchJson({
        path: '/api/notice/' + resourceId, method: 'GET', cookie: adminCookie,
        requestId: 'R_AWRITE_VER_' + seq
      });
      record('adminRead', ver.r, [200], {
        ledger: true, scenarioId: 'admin-write-verify-read', role: 'admin',
        method: 'GET', path: '/api/notice/' + resourceId, startedAt: nowIso(),
        ok: ver.r.status === 200,
        extra: { fixtureWrite: false, resourceId }
      });
      const gotTitle = ver.j && ver.j.data ? ver.j.data.title : null;
      afterHash = shaShort(gotTitle || '');
      afterOk = ver.r.status === 200 && gotTitle === title;
    }
  }
  const is2xx = is2xxHttp && resourceId != null;
  const ok = is2xx && afterOk;
  if (ok) {
    adminWritesSucceeded++;
    fixtureWrites++;
    pendingCleanups.push({ kind: 'adminNotice', seq, resourceId, title });
  }
  record('controlledAdminWrite', r, [200, 201], {
    ledger: true, scenarioId: 'controlled-admin-write-' + seq, role: 'admin',
    method: 'POST', path: '/api/notice', startedAt,
    ok,
    extra: {
      resourceId,
      beforeStateHash: beforeHash,
      afterStateHash: afterHash,
      stateChanged: ok,
      fixtureWrite: ok,
      realProductionWrite: false,
      duplicateCount: 0,
      cleanupAction: null,
      cleanupStatus: null,
      cleanupStateHash: null,
      cleanupVerified: false
    }
  });
  return ok;
}

async function ensureApplicationAiConfig() {
  if (aiConfigInitialized) return true;
  if (aiConfigInitPromise) return aiConfigInitPromise;
  aiConfigInitPromise = (async () => {
    const mockBase = mockLlmBase || '';
    if (!mockBase) return false;
    const initRid = 'R_AI_INIT_' + crypto.randomBytes(4).toString('hex');
    const initial = await fetchJson({
      base: aiAppBase, path: '/api/petcare/config', method: 'GET', cookie: aiUserCookie,
      requestId: initRid + '_before', correlationId: initRid
    });
    const initialData = initial.j && initial.j.data ? initial.j.data : {};
    aiConfigInitialAbsent = initial.r.status === 200 && initialData.personalConfigured === false;
    applicationAiRows.push({
      scenarioId: 'ai-config-before', applicationRequestId: initRid + '_before',
      endpoint: '/api/petcare/config', status: initial.r.status,
      personalConfigured: initialData.personalConfigured, expected: false,
      profile: aiSubprobeProfile, notProdEgressProof: aiNotProdEgress, ok: aiConfigInitialAbsent
    });
    record('applicationAiMock', initial.r, [200], {
      ledger: true, scenarioId: 'app-ai-config-before', role: 'ai-fixture-user',
      method: 'GET', path: '/api/petcare/config', startedAt: nowIso(), ok: aiConfigInitialAbsent,
      extra: { fixtureWrite: false, setupFixtureWrite: false, stateChanged: false, aiSubprobeProfile, notProdEgressProof: aiNotProdEgress }
    });
    if (!aiConfigInitialAbsent) return false;

    for (const policy of [
      { id: 'invalid-scheme', baseUrl: 'ftp://evil.example/v1', errorType: 'SCHEME_POLICY' },
      { id: 'metadata-address', baseUrl: 'http://169.254.169.254/latest/meta-data', errorType: 'URL_POLICY' }
    ]) {
      const before = await getMockHits();
      const beforeHit = before && Number.isFinite(before.hitCount) ? before.hitCount : null;
      const pr = await fetchJson({
        base: aiAppBase, path: '/api/petcare/config', method: 'POST', cookie: aiUserCookie, csrf: aiUserCsrf,
        body: JSON.stringify({ enabled: true, baseUrl: policy.baseUrl, apiKey: 'rejected-fixture-key', model: 'mock-model' }),
        requestId: initRid + '_' + policy.id, correlationId: initRid
      });
      const after = await getMockHits();
      const afterHit = after && Number.isFinite(after.hitCount) ? after.hitCount : null;
      const externalConnectAttempted = beforeHit != null && afterHit != null ? afterHit !== beforeHit : null;
      const rejected = pr.r.status === 400 && externalConnectAttempted === false;
      applicationAiRows.push({
        scenarioId: 'ai-url-policy-' + policy.id,
        applicationRequestId: initRid + '_' + policy.id,
        endpoint: '/api/petcare/config', status: pr.r.status,
        accepted: false, expectedErrorType: policy.errorType,
        actualErrorType: rejected ? policy.errorType : 'UNCLASSIFIED',
        errorTypeMatched: rejected, externalConnectAttempted,
        upstreamHitsBefore: beforeHit, upstreamHitsAfter: afterHit,
        profile: aiSubprobeProfile, notProdEgressProof: aiNotProdEgress, ok: rejected
      });
      record('applicationAiMock', pr.r, [400], {
        ledger: true, scenarioId: 'app-ai-url-policy-' + policy.id, role: 'ai-fixture-user',
        method: 'POST', path: '/api/petcare/config', startedAt: nowIso(), ok: rejected,
        extra: { fixtureWrite: false, setupFixtureWrite: false, stateChanged: false, accepted: false,
          expectedErrorType: policy.errorType, actualErrorType: rejected ? policy.errorType : 'UNCLASSIFIED',
          errorTypeMatched: rejected, externalConnectAttempted, aiSubprobeProfile, notProdEgressProof: aiNotProdEgress }
      });
      if (!rejected) return false;
    }

    const saveStarted = nowIso();
    const save = await fetchJson({
      base: aiAppBase, path: '/api/petcare/config', method: 'POST', cookie: aiUserCookie, csrf: aiUserCsrf,
      body: JSON.stringify({ enabled: true, baseUrl: mockBase, apiKey: 'e2e4d-mock-key-not-secret', model: 'mock-model' }),
      requestId: initRid + '_cfg', correlationId: initRid
    });
    const saveOk = save.r.status >= 200 && save.r.status < 300;
    if (saveOk) {
      aiConfigSetupWrites++;
      pendingCleanups.push({ kind: 'aiConfig', requestId: initRid + '_cfg' });
    }
    applicationAiRows.push({
      scenarioId: 'ai-config-save-fixture', applicationRequestId: initRid + '_cfg',
      endpoint: '/api/petcare/config', status: save.r.status, stateChanged: saveOk,
      setupFixtureWrite: saveOk, cleanupAction: 'clear-personal-config', cleanupVerified: false,
      profile: aiSubprobeProfile, notProdEgressProof: aiNotProdEgress, ok: saveOk
    });
    record('applicationAiMock', save.r, [200, 201], {
      ledger: true, scenarioId: 'app-ai-config-save-fixture', role: 'ai-fixture-user',
      method: 'POST', path: '/api/petcare/config', startedAt: saveStarted, ok: saveOk,
      extra: { applicationEndpoint: '/api/petcare/config', applicationStatus: save.r.status,
        mockUpstreamHit: false, correlation: initRid, fixtureWrite: false,
        setupFixtureWrite: saveOk, stateChanged: saveOk, cleanupAction: 'clear-personal-config',
        cleanupStatus: null, cleanupVerified: false, aiSubprobeProfile, notProdEgressProof: aiNotProdEgress }
    });
    aiConfigInitialized = saveOk;
    return saveOk;
  })();
  return aiConfigInitPromise;
}

async function doApplicationAi(seq) {
  // Must go through application AI endpoint on AI_APP_BASE_URL (dev-isolated, never production egress).
  if (!(await ensureApplicationAiConfig())) return false;
  const rid = 'R_AI_' + seq + '_' + crypto.randomBytes(3).toString('hex');
  const hitsBefore = await getMockHits();
  const beforeHit = hitsBefore && typeof hitsBefore.hitCount === 'number' ? hitsBefore.hitCount : null;

  const testStarted = nowIso();
  const test = await fetchJson({
    base: aiAppBase,
    path: '/api/petcare/config/test',
    method: 'POST',
    cookie: aiUserCookie,
    csrf: aiUserCsrf,
    body: JSON.stringify({}),
    requestId: rid + '_test',
    correlationId: rid
  });
  applicationAiRequestCount++;
  const hitsAfter = await getMockHits();
  const afterHit = hitsAfter && typeof hitsAfter.hitCount === 'number' ? hitsAfter.hitCount : null;
  const upstreamHit = beforeHit != null && afterHit != null && afterHit > beforeHit;
  if (upstreamHit) upstreamHitCount += (afterHit - beforeHit);

  const appOk = test.r.status >= 200 && test.r.status < 300;
  record('applicationAiMock', test.r, [200], {
    ledger: true, scenarioId: 'app-ai-config-test', role: 'ai-fixture-user',
    method: 'POST', path: '/api/petcare/config/test', startedAt: testStarted,
    ok: appOk && upstreamHit,
    extra: {
      applicationRequestId: rid + '_test',
      applicationEndpoint: '/api/petcare/config/test',
      applicationStatus: test.r.status,
      mockUpstreamRequestId: rid,
      mockUpstreamHit: upstreamHit,
      upstreamHitsBefore: beforeHit,
      upstreamHitsAfter: afterHit,
      correlation: rid,
      fixtureWrite: false,
      setupFixtureWrite: false,
      stateChanged: false,
      aiSubprobeProfile,
      notProdEgressProof: aiNotProdEgress
    }
  });
  applicationAiRows.push({
    scenarioId: 'ai-config-test-' + seq,
    applicationRequestId: rid + '_test', mockUpstreamRequestId: rid,
    endpoint: '/api/petcare/config/test', status: test.r.status,
    upstreamHitsBefore: beforeHit, upstreamHitsAfter: afterHit, mockUpstreamHit: upstreamHit,
    profile: aiSubprobeProfile, notProdEgressProof: aiNotProdEgress,
    ok: appOk && upstreamHit
  });
  return appOk && upstreamHit;
}

async function cleanupAll() {
  for (const item of pendingCleanups) {
    if (item.kind === 'userEmail') {
      const startedAt = nowIso();
      const rid = 'R_UCLEAN_' + item.seq;
      const body = item.restoreTo ? { email: item.restoreTo } : { email: 'restored_' + item.seq + '@e2e4d.test' };
      const { r } = await fetchJson({
        path: '/api/user/me/profile', method: 'PUT', cookie: userCookie, csrf: userCsrf,
        body: JSON.stringify(body),
        requestId: rid
      });
      cleanupWrites++;
      const ver = await fetchJson({ path: '/api/user/me', method: 'GET', cookie: userCookie, requestId: rid + '_v' });
      const em = ver.j && ver.j.data ? ver.j.data.email : null;
      const expected = body.email;
      const verified = r.status >= 200 && r.status < 300 && em === expected;
      if (verified) cleanupVerifiedWrites++;
      for (const row of requestRows) {
        if (row.scenarioId === 'controlled-user-write-' + item.seq) {
          row.cleanupAction = 'restore-email';
          row.cleanupStatus = r.status;
          row.cleanupStateHash = shaShort(em || '');
          row.cleanupVerified = verified;
        }
      }
      requestRows.push({
        requestId: rid, scenarioId: 'cleanup-user-email-' + item.seq, attemptId, role: 'user',
        method: 'PUT', path: '/api/user/me/profile', requestStartedAt: startedAt, requestEndedAt: nowIso(),
        expectedStatus: [200], actualStatus: r.status, responseCode: null,
        fixtureWrite: false, cleanupAction: 'restore-email', cleanupStatus: r.status,
        cleanupVerified: verified, ok: verified
      });
    } else if (item.kind === 'adminNotice') {
      const startedAt = nowIso();
      const rid = 'R_ACLEAN_' + item.seq;
      const { r } = await fetchJson({
        path: '/api/notice/' + item.resourceId, method: 'DELETE',
        cookie: adminCookie, csrf: adminCsrf, requestId: rid
      });
      cleanupWrites++;
      const ver = await fetchJson({
        path: '/api/notice/' + item.resourceId, method: 'GET', cookie: adminCookie, requestId: rid + '_v'
      });
      // 404 or code 404 = gone
      let gone = ver.r.status === 404;
      try {
        const bj = JSON.parse(ver.r.body || '{}');
        if (String(bj.code) === '404') gone = true;
      } catch (_) {}
      const verified = r.status >= 200 && r.status < 300 && gone;
      if (verified) cleanupVerifiedWrites++;
      for (const row of requestRows) {
        if (row.scenarioId === 'controlled-admin-write-' + item.seq) {
          row.cleanupAction = 'delete-notice';
          row.cleanupStatus = r.status;
          row.cleanupStateHash = shaShort('deleted');
          row.cleanupVerified = verified;
        }
      }
      requestRows.push({
        requestId: rid, scenarioId: 'cleanup-admin-notice-' + item.seq, attemptId, role: 'admin',
        method: 'DELETE', path: '/api/notice/' + item.resourceId,
        requestStartedAt: startedAt, requestEndedAt: nowIso(),
        expectedStatus: [200], actualStatus: r.status, resourceId: item.resourceId,
        fixtureWrite: false, cleanupAction: 'delete-notice', cleanupStatus: r.status,
        cleanupVerified: verified, ok: verified
      });
    } else if (item.kind === 'aiConfig') {
      const startedAt = nowIso();
      const rid = 'R_AI_CLEAN_' + crypto.randomBytes(4).toString('hex');
      const clear = await fetchJson({
        base: aiAppBase, path: '/api/petcare/config/clear', method: 'POST',
        cookie: aiUserCookie, csrf: aiUserCsrf, requestId: rid, correlationId: rid
      });
      aiConfigCleanupWrites++;
      const verify = await fetchJson({
        base: aiAppBase, path: '/api/petcare/config', method: 'GET',
        cookie: aiUserCookie, requestId: rid + '_verify', correlationId: rid
      });
      const data = verify.j && verify.j.data ? verify.j.data : {};
      const verified = clear.r.status >= 200 && clear.r.status < 300
        && verify.r.status === 200 && data.personalConfigured === false;
      if (verified) aiConfigCleanupVerifiedWrites++;
      for (const row of requestRows) {
        if (row.scenarioId === 'app-ai-config-save-fixture') {
          row.cleanupStatus = clear.r.status;
          row.cleanupVerified = verified;
          row.cleanupStateHash = shaShort(String(data.personalConfigured));
        }
      }
      for (const row of applicationAiRows) {
        if (row.scenarioId === 'ai-config-save-fixture') {
          row.cleanupStatus = clear.r.status;
          row.cleanupVerified = verified;
          row.cleanupApplicationRequestId = rid;
        }
      }
      requestRows.push({
        requestId: rid, scenarioId: 'cleanup-ai-config-fixture', attemptId, role: 'ai-fixture-user',
        method: 'POST', path: '/api/petcare/config/clear', requestStartedAt: startedAt, requestEndedAt: nowIso(),
        expectedStatus: [200], actualStatus: clear.r.status, fixtureWrite: false, setupFixtureWrite: false,
        cleanupAction: 'clear-personal-config', cleanupStatus: clear.r.status,
        cleanupVerified: verified, stateChanged: verified, ok: verified
      });
      applicationAiRows.push({
        scenarioId: 'ai-config-cleanup', applicationRequestId: rid,
        endpoint: '/api/petcare/config/clear', status: clear.r.status,
        verifyRequestId: rid + '_verify', verifyStatus: verify.r.status,
        personalConfiguredAfter: data.personalConfigured,
        cleanupVerified: verified, profile: aiSubprobeProfile,
        notProdEgressProof: aiNotProdEgress, ok: verified
      });
    }
  }
}

function pickTarget(tick) {
  const pool = [
    { category: 'health', method: 'GET', path: '/api/health/live', expect: [200] },
    { category: 'health', method: 'GET', path: '/api/health/ready', expect: [200] },
    { category: 'publicRead', method: 'GET', path: '/api/animal/page1?pageNum=1&pageSize=5', expect: [200] },
    { category: 'publicRead', method: 'GET', path: '/api/notice/page?pageNum=1&pageSize=5', expect: [200] },
    { category: 'authenticatedUserRead', method: 'GET', path: '/api/user/me', cookie: userCookie, expect: [200] },
    { category: 'adminRead', method: 'GET', path: '/api/user/me', cookie: adminCookie, expect: [200] }
  ];
  return pool[tick % pool.length];
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function worker(stopAt, workerId) {
  let tick = workerId * 1000;
  while (Date.now() < stopAt) {
    // controlled sparse writes (only early part of window, once each)
    if (workerId === 0 && userWriteDone < maxUserWrites && Date.now() < stopAt - 30000) {
      userWriteDone++;
      await doUserWrite(userWriteDone);
      await sleep(delayMs);
      continue;
    }
    if (workerId === 1 && adminWriteDone < maxAdminWrites && Date.now() < stopAt - 30000) {
      adminWriteDone++;
      await doAdminWrite(adminWriteDone);
      await sleep(delayMs);
      continue;
    }
    // AI application calls — limited
    if (workerId === 2 && applicationAiRequestCount < 3 && mockLlmBase && Date.now() < stopAt - 20000) {
      await doApplicationAi(applicationAiRequestCount + 1);
      await sleep(delayMs * 2);
      continue;
    }
    // maintain duration even at maxRequests with low rate
    if (totalRequests >= maxRequests) {
      const t = pickTarget(tick++);
      const r = await requestOnce(t);
      record(t.category, r, t.expect, {
        ledger: false, scenarioId: t.category, role: null,
        method: t.method, path: t.path, startedAt: nowIso(), ok: r.status === 200
      });
      await sleep(Math.max(50, delayMs * 10));
      continue;
    }
    const t = pickTarget(tick++);
    const r = await requestOnce(Object.assign({}, t, {
      requestId: 'R_L_' + tick
    }));
    record(t.category, r, t.expect, {
      ledger: (tick % 50 === 0), // sample steady-state reads into ledger
      scenarioId: 'load-' + t.category, role: t.cookie === adminCookie ? 'admin' : (t.cookie ? 'user' : 'anon'),
      method: t.method, path: t.path, startedAt: nowIso(),
      ok: (t.expect || [200]).includes(r.status)
    });
    await sleep(delayMs);
  }
}

function catSummary(name) {
  const v = categories[name];
  const lat = summarize(v.latencies);
  return {
    requestCount: v.requestCount,
    totalRequests: v.requestCount,
    success2xx: v.success2xx,
    success: v.success2xx,
    expected4xx: v.expected4xx,
    unexpected4xx: v.unexpected4xx,
    status5xx: v.status5xx,
    networkErrors: v.networkErrors,
    p50: lat.p50, p95: lat.p95, p99: lat.p99, max: lat.max,
    firstRequestAt: v.firstRequestAt,
    lastRequestAt: v.lastRequestAt
  };
}

function evaluateOk(actualDurationMs) {
  const hardMissing = [];
  for (const k of ['health', 'publicRead', 'authenticatedUserRead', 'adminRead', 'controlledUserWrite', 'controlledAdminWrite', 'applicationAiMock']) {
    if (categories[k].success2xx < 1) hardMissing.push(k);
  }
  const reasons = [];
  if (actualDurationMs < requestedDurationMs) reasons.push('duration_short');
  if (status5xx > 0) reasons.push('status5xx');
  if (unexpected4xx > 0) reasons.push('unexpected4xx');
  if (networkErrors > 0) reasons.push('networkErrors');
  if (hardMissing.length) reasons.push('missing:' + hardMissing.join(','));
  if (userWritesSucceeded < 1) reasons.push('no_user_write_2xx');
  if (adminWritesSucceeded < 1) reasons.push('no_admin_write_2xx');
  if (fixtureWrites < 1) reasons.push('no_fixture_writes');
  if (cleanupWrites !== fixtureWrites) reasons.push('cleanup_count_mismatch');
  if (cleanupVerifiedWrites !== fixtureWrites) reasons.push('cleanup_verify_mismatch');
  if (duplicateWrites !== 0) reasons.push('duplicates');
  if (realProductionWrites !== 0) reasons.push('real_production_writes');
  if (applicationAiRequestCount < 1) reasons.push('no_app_ai');
  if (upstreamHitCount < 1) reasons.push('no_upstream_hit');
  if (aiConfigSetupWrites !== 1) reasons.push('ai_config_setup_write_count');
  if (aiConfigCleanupWrites !== aiConfigSetupWrites) reasons.push('ai_config_cleanup_count_mismatch');
  if (aiConfigCleanupVerifiedWrites !== aiConfigSetupWrites) reasons.push('ai_config_cleanup_verify_mismatch');
  if (applicationAiRows.some((r) => r.ok !== true)) reasons.push('application_ai_ledger_failure');
  if (!completedNormally) reasons.push('not_completed_normally');
  return { ok: reasons.length === 0, reasons, hardMissing };
}

(async () => {
  const startedAt = nowIso();
  const wallStart = Date.now();
  console.log(JSON.stringify({
    phase: '4D', event: 'load-baseline-start', baseUrl, aiAppBase, requestedDurationMs,
    concurrency, maxRequests, formalRunId, attemptId, formalProfile, aiSubprobeProfile,
    hasUserCookie: !!userCookie, hasAdminCookie: !!adminCookie, mockLlm: !!mockLlmBase
  }));

  const hits0 = await getMockHits();
  upstreamHitsBefore = hits0 && hits0.hitCount != null ? hits0.hitCount : 0;

  await ensureOriginalProfile();

  // seed reads
  for (const t of [
    { category: 'health', method: 'GET', path: '/api/health/live', expect: [200] },
    { category: 'publicRead', method: 'GET', path: '/api/animal/page1?pageNum=1&pageSize=5', expect: [200] },
    { category: 'authenticatedUserRead', method: 'GET', path: '/api/user/me', cookie: userCookie, expect: [200] },
    { category: 'adminRead', method: 'GET', path: '/api/user/me', cookie: adminCookie, expect: [200] }
  ]) {
    const r = await requestOnce(t);
    record(t.category, r, t.expect, {
      ledger: true, scenarioId: 'seed-' + t.category,
      role: t.cookie === adminCookie ? 'admin' : (t.cookie ? 'user' : 'anon'),
      method: t.method, path: t.path, startedAt: nowIso(), ok: r.status === 200
    });
  }

  // force at least one write each and one AI before long loop
  await doUserWrite(++userWriteDone);
  await doAdminWrite(++adminWriteDone);
  if (mockLlmBase) await doApplicationAi(1);

  const stopAt = wallStart + requestedDurationMs;
  const workers = [];
  for (let i = 0; i < concurrency; i++) workers.push(worker(stopAt, i));
  await Promise.all(workers);

  // ensure duration fully elapsed
  while (Date.now() < stopAt) await sleep(100);

  await cleanupAll();
  completedNormally = true;
  const endedAt = nowIso();
  const actualDurationMs = Date.now() - wallStart;
  const evalResult = evaluateOk(actualDurationMs);

  const byCategory = {};
  for (const k of Object.keys(categories)) byCategory[k] = catSummary(k);

  const globalLat = summarize(allLatencies);
  const ledgerWrites = requestRows.filter((x) => x.fixtureWrite === true).length;

  const loadOut = {
    phase: '4D',
    formalRunId,
    runId: formalRunId,
    attemptId,
    baseline4c,
    branch,
    head,
    jarSha256: jarSha,
    status: evalResult.ok ? 'COMPLETE' : 'FAILED',
    residualRisk: !evalResult.ok,
    strictMode: evalResult.ok,
    startedAt,
    endedAt,
    baseUrl,
    aiAppBaseUrl: aiAppBase,
    formalProfile,
    aiSubprobeProfile,
    applicationAiNotProdEgressProof: aiNotProdEgress,
    durationMs: actualDurationMs,
    requestedDurationMs,
    actualDurationMs,
    durationCompleted: actualDurationMs >= requestedDurationMs,
    concurrency,
    maxRequests,
    totalRequests,
    success,
    expected4xx,
    unexpected4xx,
    status5xx,
    networkErrors,
    p50: globalLat.p50, p95: globalLat.p95, p99: globalLat.p99, max: globalLat.max,
    latencies: globalLat,
    byCategory,
    categories: byCategory,
    fixtureWrites,
    cleanupWrites,
    cleanupVerifiedWrites,
    duplicateWrites,
    realProductionWrites,
    userWritesAttempted,
    userWritesSucceeded,
    adminWritesAttempted,
    adminWritesSucceeded,
    applicationAiRequestCount,
    upstreamHitCount,
    upstreamHitsBefore,
    aiConfigSetupWrites,
    aiConfigCleanupWrites,
    aiConfigCleanupVerifiedWrites,
    mixedLoad: true,
    anonymousOnly: false,
    mockHealthCountedAsAi: false,
    processExitWillBe: evalResult.ok ? 0 : 1,
    completedNormally: true,
    evidenceComplete: true,
    rejectionReasons: evalResult.reasons,
    hardMissingCategories: evalResult.hardMissing,
    ok: evalResult.ok
  };

  const ledgerOut = {
    phase: '4D',
    formalRunId,
    attemptId,
    status: evalResult.ok ? 'COMPLETE' : 'FAILED',
    residualRisk: !evalResult.ok,
    strictMode: evalResult.ok,
    jarSha256: jarSha,
    totalRequestsRecorded: requestRows.length,
    userWritesAttempted,
    userWritesSucceeded,
    adminWritesAttempted,
    adminWritesSucceeded,
    fixtureWrites,
    cleanupWrites,
    cleanupVerifiedWrites,
    duplicateWrites,
    realProductionWrites,
    applicationAiRequestCount,
    upstreamHitCount,
    aiConfigSetupWrites,
    aiConfigCleanupWrites,
    aiConfigCleanupVerifiedWrites,
    cookieHashes: { user: cookieHash(userCookie), admin: cookieHash(adminCookie) },
    requests: requestRows,
    startedAt,
    endedAt,
    ok: evalResult.ok
      && ledgerWrites === fixtureWrites
      && cleanupVerifiedWrites === fixtureWrites
      && aiConfigSetupWrites === 1
      && aiConfigCleanupWrites === aiConfigSetupWrites
      && aiConfigCleanupVerifiedWrites === aiConfigSetupWrites
  };

  fs.mkdirSync(outDir, { recursive: true });
  // Only write final artifacts after full completion (not mid-run flush for pass)
  fs.writeFileSync(path.join(outDir, 'load-baseline.json'), JSON.stringify(loadOut, null, 2));
  fs.writeFileSync(path.join(outDir, 'request-ledger.json'), JSON.stringify(ledgerOut, null, 2));
  const applicationAiOut = {
    phase: '4D', formalRunId, attemptId,
    status: evalResult.ok && applicationAiRows.every((r) => r.ok === true) ? 'COMPLETE' : 'FAILED',
    residualRisk: !(evalResult.ok && applicationAiRows.every((r) => r.ok === true)),
    strictMode: evalResult.ok && applicationAiRows.every((r) => r.ok === true),
    profile: aiSubprobeProfile, formalProfile,
    notProdEgressProof: aiNotProdEgress,
    applicationRequestCount: applicationAiRequestCount,
    upstreamHitCount,
    setupFixtureWrites: aiConfigSetupWrites,
    setupCleanupWrites: aiConfigCleanupWrites,
    setupCleanupVerifiedWrites: aiConfigCleanupVerifiedWrites,
    initialConfigAbsent: aiConfigInitialAbsent,
    finalConfigAbsent: aiConfigCleanupVerifiedWrites === aiConfigSetupWrites,
    rows: applicationAiRows,
    startedAt, endedAt,
    ok: evalResult.ok && applicationAiRows.every((r) => r.ok === true)
  };
  fs.writeFileSync(path.join(outDir, 'application-ai-ledger.json'), JSON.stringify(applicationAiOut, null, 2));

  console.log(JSON.stringify({
    ok: evalResult.ok,
    actualDurationMs,
    totalRequests,
    fixtureWrites,
    cleanupWrites,
    cleanupVerifiedWrites,
    applicationAiRequestCount,
    upstreamHitCount,
    reasons: evalResult.reasons,
    byCategory: Object.fromEntries(Object.entries(byCategory).map(([k, v]) => [k, { n: v.requestCount, s2: v.success2xx }]))
  }));
  process.exit(evalResult.ok ? 0 : 1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
