/**
 * Phase 4C real self-attack — semantic gate must fail for each sabotage (round 3).
 * Usage: node tools/release-phase-4c-self-attack.cjs <outDir> <formalRunId> [baseline] [branch] [head] [jar] [gitStatusSha] [diffSha]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const outDir = process.argv[2];
const formalRunId = process.argv[3];
const baseline = process.argv[4] || '893e024b70e9117c89c204ffac67ad3655eb1f4a';
const branch = process.argv[5] || 'release/phase-4c-security-privacy-20260801';
const head = process.argv[6] || 'deadbeef';
const jar = process.argv[7] || ('a'.repeat(64));
const gitStatusSha = process.argv[8] || ('c'.repeat(64));
const diffSha = process.argv[9] || ('d'.repeat(64));

if (!outDir || !formalRunId) {
  console.error('usage: self-attack <outDir> <formalRunId> ...');
  process.exit(2);
}

const root = path.resolve(__dirname, '..');
const gateScript = path.join(root, 'tools/release-phase-4c-ledger-gate.cjs');
const attacks = [];

function sha256File(p) {
  if (!fs.existsSync(p)) return '0'.repeat(64);
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}
const agentJavaRel = 'src/test/java/com/example/service/AdminAgentToolsTest.java';
const sessionJavaRel = 'src/test/java/com/example/controller/SessionRotationSecurityTest.java';
const agentClassSha = sha256File(path.join(root, agentJavaRel));
const sessionClassSha = sha256File(path.join(root, sessionJavaRel));
// Match suite @Test counts used in seed XML (must equal ledger counters)
const AGENT_SUITE_TESTS = 6;
const SESSION_SUITE_TESTS = 2;

function writeJson(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj, null, 2));
}

function baseMeta(extra) {
  return Object.assign({
    phase: '4C', formalRunId, runId: formalRunId, baseline4b: baseline, branch, head,
    jarSha256: jar, startedAt: new Date().toISOString(), endedAt: new Date().toISOString(),
    strictMode: true, residualRisk: false, status: 'COMPLETE', failureCount: 0, passCount: 1
  }, extra || {});
}

function seedHealthy(dir) {
  const sessionRows = [
    { scenarioId: 'httponly', ok: true },
    {
      scenarioId: 'session-id-rotation', ok: true, source: 'unit-test',
      surefireXml: path.join(dir, 'surefire', 'TEST-com.example.controller.SessionRotationSecurityTest.xml'),
      testcaseName: 'login_rotatesPreAuthSessionId_andOldSessionLosesAuthCapability',
      testClassSha256: sessionClassSha,
      tests: SESSION_SUITE_TESTS, failures: 0, errors: 0, skipped: 0
    },
    { scenarioId: 'failed-login-no-auth', ok: true },
    { scenarioId: 'logout-invalidates', ok: true },
    { scenarioId: 'health-live-no-session-cookie', ok: true }
  ];
  // minimal surefire xml for session rotation + agent tools (semantic gate parses these)
  fs.mkdirSync(path.join(dir, 'surefire'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'surefire', 'TEST-com.example.controller.SessionRotationSecurityTest.xml'),
    `<?xml version="1.0"?><testsuite tests="${SESSION_SUITE_TESTS}" failures="0" errors="0" skipped="0">` +
    `<testcase name="login_rotatesPreAuthSessionId_andOldSessionLosesAuthCapability" classname="com.example.controller.SessionRotationSecurityTest"/>` +
    `<testcase name="failedLogin_doesNotAuthenticatePreAuthSession" classname="com.example.controller.SessionRotationSecurityTest"/></testsuite>`);
  fs.writeFileSync(path.join(dir, 'surefire', 'TEST-com.example.service.AdminAgentToolsTest.xml'),
    `<?xml version="1.0"?><testsuite tests="${AGENT_SUITE_TESTS}" failures="0" errors="0" skipped="0">` +
    `<testcase name="toolSpecs_returnsControlledAllowlistedToolSet" classname="com.example.service.AdminAgentToolsTest"/>` +
    `<testcase name="execute_unknownTool_returnsUnknownTool_andDoesNotTouchJdbc" classname="com.example.service.AdminAgentToolsTest"/>` +
    `<testcase name="execute_allowlistedReadTool_runsForSuperAdmin" classname="com.example.service.AdminAgentToolsTest"/>` +
    `<testcase name="modulePermissionIsEnforcedBeforeAnyQuery" classname="com.example.service.AdminAgentToolsTest"/>` +
    `<testcase name="rescueToolExcludesContactAndExactLocationAndClosedRecords" classname="com.example.service.AdminAgentToolsTest"/>` +
    `<testcase name="freeTextContactAndSecretAreRedactedBeforeLeavingToolBoundary" classname="com.example.service.AdminAgentToolsTest"/></testsuite>`);

  const ssrfRows = [
    'ssrf-loopback-ipv4', 'ssrf-loopback-hostname', 'ssrf-private-rfc1918',
    'ssrf-link-local-metadata', 'ssrf-loopback-ipv6', 'ssrf-dns-private',
    'ssrf-userinfo', 'ssrf-query', 'ssrf-fragment', 'ssrf-file-scheme',
    'ssrf-http-scheme', 'ssrf-admin-agent-loopback'
  ].map(scenarioId => ({
    scenarioId, category: scenarioId, ok: true, accepted: false,
    externalConnectAttempted: false, errorType: 'URL_POLICY',
    requestId: 'R_SSRF_' + scenarioId, bodyField: 'baseUrl'
  }));
  const ownership = [
    'help-owner-read', 'help-foreign-read', 'help-foreign-delete', 'help-anonymous-read',
    'adopt-owner-read', 'adopt-foreign-read', 'adopt-foreign-update',
    'notif-owner-read', 'notif-foreign-mark',
    'file-owner-upload', 'file-foreign-download',
    'favorite-owner-add', 'favorite-cross-user-isolation',
    'petcare-conv-owner-read', 'petcare-conv-foreign-read', 'petcare-conv-foreign-delete',
    'petcare-config-owner-save', 'petcare-config-isolation-clear',
    'proof-owner-read', 'proof-foreign-read',
    'visit-owner-read', 'visit-foreign-read',
    'volunteer-cross-user-cancel'
  ].map(scenarioId => ({
    scenarioId, ok: true, requestId: 'R_OWN_' + scenarioId,
    resourceId: 1000 + Math.abs(scenarioId.length), actor: 'userA', target: 'userB', status: 200
  }));
  const csrf = ['csrf-missing-token', 'csrf-invalid-token', 'csrf-cross-user-token',
    'csrf-admin-write-missing', 'csrf-upload-missing'].map(scenarioId => ({ scenarioId, ok: true, requestId: 'R_CSRF_' + scenarioId }));
  const cors = [
    { scenarioId: 'cors-evil-origin', origin: 'https://evil.example.com', acao: null, ok: true },
    { scenarioId: 'cors-allowed-origin', origin: 'https://app.example.local', acao: 'https://app.example.local', ok: true },
    { scenarioId: 'cors-origin-null', acao: null, ok: true },
    { scenarioId: 'cors-options-preflight-evil', acao: null, ok: true },
    { scenarioId: 'cors-no-wildcard-credentials', ok: true }
  ];
  const files = [
    'file-upload-png-private', 'file-canonical-or-sanitized', 'file-traversal-no-escape',
    'file-cross-user-download', 'file-svg-rejected', 'file-exe-rejected', 'file-log-crlf-sanitized'
  ].map(scenarioId => ({ scenarioId, ok: true, requestId: 'R_FILE_' + scenarioId }));
  const aiRes = [
    { scenarioId: 'ai-long-input-rejected', status: 400, ok: true, requestId: 'R_AI_LONG' },
    {
      scenarioId: 'ai-concurrent-limit', ok: true, someLimit: true, statuses: [200, 503, 503],
      codes: ['0', '503', '503'], requestCount: 3, maxInFlight: 2, upstreamHitCount: 2,
      rejected429or503Count: 2, requestId: 'R_AI_CONC'
    },
    { scenarioId: 'ai-tool-allow-deny', ok: true, requestId: 'R_AI_TOOL' }
  ];
  const agent = [
    {
      scenarioId: 'agent-tool-allowlisted', ok: true, source: 'unit-test',
      surefireXml: path.join(dir, 'surefire', 'TEST-com.example.service.AdminAgentToolsTest.xml'),
      testcaseName: 'toolSpecs_returnsControlledAllowlistedToolSet',
      testClassSha256: agentClassSha,
      tests: AGENT_SUITE_TESTS, failures: 0, errors: 0, skipped: 0
    },
    {
      scenarioId: 'agent-tool-unknown-denied', ok: true, source: 'unit-test',
      surefireXml: path.join(dir, 'surefire', 'TEST-com.example.service.AdminAgentToolsTest.xml'),
      testcaseName: 'execute_unknownTool_returnsUnknownTool_andDoesNotTouchJdbc',
      testClassSha256: agentClassSha,
      tests: AGENT_SUITE_TESTS, failures: 0, errors: 0, skipped: 0
    },
    { scenarioId: 'user-forbidden-admin-agent', ok: true, requestId: 'R_AGT_USER' }
  ];
  const aiCfg = [
    { scenarioId: 'ai-config-save-A', ok: true, requestId: 'R_CFG_A' },
    { scenarioId: 'ai-config-save-B', ok: true, requestId: 'R_CFG_B' },
    { scenarioId: 'ai-config-no-key-plaintext-A', ok: true },
    { scenarioId: 'ai-config-no-key-plaintext-B', ok: true },
    { scenarioId: 'ai-config-clear-A-B-unchanged', ok: true, requestId: 'R_CFG_CLR' }
  ];

  const requests = [];
  function addReq(id) { requests.push({ requestId: id, method: 'GET', path: '/api/x', status: 200 }); }
  [...ssrfRows, ...ownership, ...csrf, ...files, ...aiRes, ...agent, ...aiCfg].forEach(r => {
    if (r.requestId) addReq(r.requestId);
  });
  addReq('R_BASE');

  const filesMap = {
    'assert-ledger.json': baseMeta({
      rows: [{ scenarioId: 'baseline', ok: true }],
      assertionCount: 1, passCount: 1, failureCount: 0, strictMode: true
    }),
    'api-inventory.json': baseMeta({ endpoints: [{ method: 'GET', path: '/api/health/live' }], endpointCount: 1 }),
    'function-auth-matrix.json': baseMeta({ rows: [{ scenarioId: 'anon', ok: true }] }),
    'object-ownership-matrix.json': baseMeta({ rows: ownership }),
    'property-security-ledger.json': baseMeta({ rows: [{ scenarioId: 'mass-assign', ok: true }] }),
    'session-security-ledger.json': baseMeta({ rows: sessionRows }),
    'csrf-matrix.json': baseMeta({ rows: csrf }),
    'cors-matrix.json': baseMeta({ rows: cors }),
    'websocket-security-ledger.json': baseMeta({
      status: 'NOT_APPLICABLE',
      reason: 'WebSocket product chat disabled',
      evidence: { path: '/api/user/ws-ticket', code: 410 }
    }),
    'file-security-ledger.json': baseMeta({ rows: files }),
    'input-security-ledger.json': baseMeta({ rows: [{ scenarioId: 'sqli-bounded', ok: true }] }),
    'xss-browser-ledger.json': baseMeta({ rows: [{ scenarioId: 'xss-help', ok: true }] }),
    'error-disclosure-ledger.json': baseMeta({ rows: [{ scenarioId: 'no-stack', ok: true }] }),
    'ai-config-isolation-ledger.json': baseMeta({ rows: aiCfg }),
    'ssrf-matrix.json': baseMeta({ rows: ssrfRows }),
    'ai-resource-limit-ledger.json': baseMeta({ rows: aiRes }),
    'agent-tool-boundary-ledger.json': baseMeta({ rows: agent }),
    'secret-scan.json': baseMeta({ hits: [], ok: true, rows: [{ ok: true }] }),
    'log-redaction-ledger.json': baseMeta({ rows: [{ ok: true }] }),
    'export-security-ledger.json': baseMeta({ rows: [{ ok: true }] }),
    'resource-abuse-ledger.json': baseMeta({ rows: [{ scenarioId: 'pageSize-cap', ok: true }] }),
    'security-headers-ledger.json': baseMeta({ rows: [{ ok: true }] }),
    'production-exposure-ledger.json': baseMeta({ rows: [{ ok: true }] }),
    'request-ledger.json': baseMeta({ requests }),
    'db-before-after-ledger.json': baseMeta({
      snapshots: [{ scenario: 'mass-assign', before: { id: 1 }, after: { id: 1 }, requestId: 'R_BASE', expected: 'unchanged', actual: 'unchanged', ok: true }]
    }),
    'file-before-after-ledger.json': baseMeta({
      snapshots: [{ scenario: 'upload', before: { count: 0 }, after: { count: 1 }, requestId: 'R_FILE_file-upload-png-private', expected: 'inside-root', actual: 'inside-root', ok: true }]
    }),
    'cleanup-ledger.json': baseMeta({ ok: true, rows: [{ ok: true }] }),
    'self-attack-summary.json': baseMeta({ attacks: [{ id: 'seed', ok: true }], rows: [{ id: 'seed', ok: true }] }),
    'phase-4c-report.json': baseMeta({
      p0: 0, p1: 0, p2: 0, p3: 0, assertionCount: 1, passCount: 1, failureCount: 0,
      strictMode: true, sealRecommendation: 'YES_CANDIDATE_FOR_SEAL',
      worktreeDirty: true, gitStatusSha256: gitStatusSha, worktreeDiffSha256: diffSha
    }),
    'worktree-evidence.json': baseMeta({
      worktreeDirty: true, gitStatusSha256: gitStatusSha, worktreeDiffSha256: diffSha, jarSha256: jar,
      testToolManifest: [
        { path: agentJavaRel, exists: true, sha256: agentClassSha },
        { path: sessionJavaRel, exists: true, sha256: sessionClassSha }
      ]
    })
  };
  for (const [name, obj] of Object.entries(filesMap)) {
    writeJson(path.join(dir, name), obj);
  }
}

function runGate(dir) {
  const r = spawnSync(process.execPath, [
    gateScript, dir, formalRunId, baseline, branch, head, jar, gitStatusSha, diffSha
  ], { encoding: 'utf8', cwd: root, windowsHide: true, timeout: 60000 });
  return {
    exitCode: r.status == null ? 99 : r.status,
    stdout: (r.stdout || ''),
    stderr: (r.stderr || ''),
    error: r.error ? String(r.error.message || r.error) : null
  };
}

function runCase(id, expectedCodes, sabotage, description) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `e2e4c-sa3-${id}-`));
  let sabotageApplied = false;
  let gateExecuted = false;
  let result = { exitCode: -1, stdout: '', stderr: '', error: 'not-run' };
  let actualCodes = [];
  try {
    seedHealthy(dir);
    sabotage(dir);
    sabotageApplied = true;
    result = runGate(dir);
    gateExecuted = true;
    try {
      const parsed = JSON.parse(result.stdout.trim().split('\n').filter(Boolean).pop() || '{}');
      actualCodes = parsed.codes || [];
    } catch { actualCodes = []; }
  } catch (e) {
    result = { exitCode: -1, stdout: '', stderr: String(e.message || e), error: String(e.message || e) };
  }
  const exitOk = result.exitCode !== 0 && result.exitCode !== -1;
  const spawnOk = !result.error;
  const codeHit = expectedCodes.some(c =>
    actualCodes.includes(c) || (result.stdout + result.stderr).includes(c)
  );
  const ok = sabotageApplied && gateExecuted && spawnOk && exitOk && codeHit;
  const row = {
    id, description, sabotageApplied, gateExecuted,
    expectedFailureCode: expectedCodes.join('|'),
    actualFailureCode: actualCodes.join('|') || (result.error ? 'SPAWN_ERROR' : 'NONE'),
    exitCode: result.exitCode, expectedNonZero: true, spawnError: result.error, ok,
    command: `node tools/release-phase-4c-ledger-gate.cjs <tmpdir> ${formalRunId}`,
    stdout: (result.stdout || '').slice(0, 400)
  };
  attacks.push(row);
  console.log(JSON.stringify({ id, exitCode: result.exitCode, sabotageApplied, gateExecuted, ok, expected: expectedCodes, actual: actualCodes.slice(0, 6) }));
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  return row;
}

function patch(dir, name, fn) {
  const p = path.join(dir, name);
  const o = JSON.parse(fs.readFileSync(p, 'utf8'));
  fn(o);
  writeJson(p, o);
}

// Core attacks
runCase('missing-request-ledger', ['MISSING'], d => fs.unlinkSync(path.join(d, 'request-ledger.json')), 'delete request-ledger');
runCase('wrong-runid', ['RUNID_MISMATCH'], d => patch(d, 'assert-ledger.json', o => { o.formalRunId = 'WRONG'; o.runId = 'WRONG'; }), 'wrong formalRunId');
runCase('partial-ledger', ['STATUS_NOT_COMPLETE'], d => patch(d, 'websocket-security-ledger.json', o => { o.status = 'PARTIAL'; o.residualRisk = true; delete o.reason; }), 'PARTIAL');
runCase('residual-risk-true', ['RESIDUAL_RISK'], d => patch(d, 'ssrf-matrix.json', o => { o.residualRisk = true; }), 'residualRisk');
runCase('row-ok-false', ['ROW_NOT_OK'], d => patch(d, 'session-security-ledger.json', o => { o.rows[0].ok = false; }), 'ok false');
runCase('row-ok-undefined', ['ROW_NOT_OK'], d => patch(d, 'csrf-matrix.json', o => { delete o.rows[0].ok; }), 'ok undefined');
runCase('empty-rows', ['EMPTY_ROWS', 'SCENARIO_MISSING'], d => patch(d, 'csrf-matrix.json', o => { o.rows = []; }), 'empty csrf');
runCase('cors-allowed-wrong', ['ROW_NOT_OK'], d => patch(d, 'cors-matrix.json', o => {
  const row = o.rows.find(r => r.scenarioId === 'cors-allowed-origin');
  if (row) { row.acao = 'https://evil.example.com'; row.ok = true; }
}), 'cors evil acao');
runCase('ssrf-wrong-field-apiBaseUrl', ['ROW_NOT_OK', 'SCENARIO_MISSING'], d => patch(d, 'ssrf-matrix.json', o => {
  o.rows = o.rows.map(r => Object.assign({}, r, { bodyField: 'apiBaseUrl', ok: true }));
  o.rows = o.rows.filter(r => r.scenarioId !== 'ssrf-dns-private');
}), 'apiBaseUrl field');
runCase('ai-concurrent-someLimit-false', ['AI_CONCURRENT_WEAK'], d => patch(d, 'ai-resource-limit-ledger.json', o => {
  const r = o.rows.find(x => x.scenarioId === 'ai-concurrent-limit');
  if (r) { r.someLimit = false; r.statuses = [200, 200, 200]; r.ok = true; r.upstreamHitCount = 3; r.maxInFlight = 2; }
}), 'someLimit false');
runCase('ai-concurrent-all-400', ['AI_CONCURRENT_WEAK'], d => patch(d, 'ai-resource-limit-ledger.json', o => {
  const r = o.rows.find(x => x.scenarioId === 'ai-concurrent-limit');
  if (r) {
    r.someLimit = false; r.statuses = [400, 400, 400]; r.codes = ['400', '400', '400'];
    r.ok = true; r.upstreamHitCount = 0; r.maxInFlight = 0;
  }
}), 'three 400s');
runCase('ownership-missing-resourceId', ['ROW_NOT_OK'], d => patch(d, 'object-ownership-matrix.json', o => {
  const r = o.rows.find(x => x.scenarioId === 'proof-owner-read');
  if (r) { r.resourceId = null; r.ok = true; }
}), 'proof missing resourceId');
runCase('ownership-fake-id', ['ROW_NOT_OK'], d => patch(d, 'object-ownership-matrix.json', o => {
  const r = o.rows.find(x => x.scenarioId === 'visit-owner-read');
  if (r) { r.resourceId = 999999991; r.ok = true; }
}), 'fake 999999991');
runCase('agent-missing-surefire', ['AGENT_EVIDENCE_MISSING'], d => patch(d, 'agent-tool-boundary-ledger.json', o => {
  const r = o.rows.find(x => x.scenarioId === 'agent-tool-allowlisted');
  if (r) { delete r.surefireXml; delete r.testClassSha256; r.source = 'static-source'; r.ok = true; }
}), 'agent static source');
runCase('session-missing-surefire', ['SESSION_EVIDENCE_MISSING'], d => patch(d, 'session-security-ledger.json', o => {
  const r = o.rows.find(x => x.scenarioId === 'session-id-rotation');
  if (r) { delete r.surefireXml; delete r.testcaseName; delete r.testClassSha256; r.ok = true; }
}), 'session rotation missing surefire');
runCase('scenario-missing-volunteer', ['SCENARIO_MISSING'], d => patch(d, 'object-ownership-matrix.json', o => {
  o.rows = o.rows.filter(r => r.scenarioId !== 'volunteer-cross-user-cancel');
}), 'missing volunteer scenario');
runCase('worktree-hash-mismatch', ['WORKTREE_HASH_MISMATCH'], d => patch(d, 'worktree-evidence.json', o => {
  o.gitStatusSha256 = '0'.repeat(64);
}), 'gitStatusSha mismatch');
runCase('worktree-diff-hash-mismatch', ['WORKTREE_HASH_MISMATCH'], d => patch(d, 'worktree-evidence.json', o => {
  o.worktreeDiffSha256 = '1'.repeat(64);
}), 'worktreeDiffSha mismatch on evidence');
runCase('phase-report-diff-hash-mismatch', ['WORKTREE_HASH_MISMATCH'], d => patch(d, 'phase-4c-report.json', o => {
  o.worktreeDiffSha256 = '2'.repeat(64);
}), 'worktreeDiffSha mismatch on phase report');
runCase('wrong-testcase-name', ['SUREFIRE_SEMANTIC'], d => patch(d, 'agent-tool-boundary-ledger.json', o => {
  const r = o.rows.find(x => x.scenarioId === 'agent-tool-allowlisted');
  if (r) { r.testcaseName = 'definitely_not_a_real_testcase'; r.ok = true; }
}), 'wrong surefire testcase name');
runCase('wrong-test-class-sha', ['SUREFIRE_SEMANTIC'], d => patch(d, 'agent-tool-boundary-ledger.json', o => {
  const r = o.rows.find(x => x.scenarioId === 'agent-tool-allowlisted');
  if (r) { r.testClassSha256 = '9'.repeat(64); r.ok = true; }
}), 'wrong testClassSha256');
runCase('surefire-failure-count', ['SUREFIRE_SEMANTIC'], d => patch(d, 'agent-tool-boundary-ledger.json', o => {
  const r = o.rows.find(x => x.scenarioId === 'agent-tool-allowlisted');
  if (r) { r.failures = 1; r.ok = true; }
}), 'ledger failures counter != xml');
runCase('baseline-wrong', ['BASELINE_MISMATCH'], d => patch(d, 'phase-4c-report.json', o => {
  o.baseline4b = '0'.repeat(40);
}), 'wrong baseline');
runCase('db-snapshot-no-after', ['SNAPSHOT_INCOMPLETE'], d => patch(d, 'db-before-after-ledger.json', o => {
  o.snapshots = [{ scenario: 'x', before: {}, requestId: 'R_BASE', ok: true }];
}), 'db missing after');
runCase('requestid-dup', ['REQUESTID_DUP'], d => patch(d, 'request-ledger.json', o => {
  const id = o.requests[0].requestId;
  o.requests.push({ requestId: id, method: 'GET', path: '/dup', status: 200 });
}), 'dup requestId');
runCase('server-died-midrun', ['MISSING'], d => {
  for (const f of ['assert-ledger.json', 'ssrf-matrix.json', 'request-ledger.json']) fs.unlinkSync(path.join(d, f));
}, 'critical missing');
runCase('failurecount-mismatch', ['FAILURE_COUNT_MISMATCH', 'ROW_NOT_OK'], d => patch(d, 'assert-ledger.json', o => {
  o.status = 'COMPLETE'; o.rows = [{ scenarioId: 'x', ok: false }]; o.failureCount = 0; o.strictMode = true;
}), 'failureCount mismatch');

const allOk = attacks.every(a => a.ok);
const summary = {
  phase: '4C', formalRunId, runId: formalRunId, baseline4b: baseline, branch, head, jarSha256: jar,
  status: allOk ? 'COMPLETE' : 'FAILED', residualRisk: !allOk, strictMode: allOk,
  startedAt: new Date().toISOString(), endedAt: new Date().toISOString(),
  attacks, rows: attacks, attackCount: attacks.length,
  passed: attacks.filter(a => a.ok).length, failed: attacks.filter(a => !a.ok).length, ok: allOk
};
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'self-attack-summary.json'), JSON.stringify(summary, null, 2));
fs.writeFileSync(path.join(outDir, 'SELF-ATTACK-REPORT.md'), [
  '# Phase 4C Self-Attack Report (round 3)',
  '', `formalRunId: \`${formalRunId}\``, '',
  '| ID | sabotage | gate | exit | expected | actual | Result |',
  '|----|----------|------|------|----------|--------|--------|',
  ...attacks.map(a => `| ${a.id} | ${a.sabotageApplied} | ${a.gateExecuted} | ${a.exitCode} | ${a.expectedFailureCode} | ${a.actualFailureCode} | ${a.ok ? 'PASS' : 'FAIL'} |`),
  '', `Overall: **${allOk ? 'PASS' : 'FAIL'}** (${summary.passed}/${summary.attackCount})`, ''
].join('\n'));
console.log(JSON.stringify({ ok: allOk, passed: summary.passed, total: summary.attackCount }));
process.exit(allOk ? 0 : 1);
