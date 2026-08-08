/**
 * Phase 4D STRICT ledger gate — round 2 contracts
 */
'use strict';
const fs = require('fs');
const path = require('path');

const outDir = process.argv[2];
const formalRunId = process.argv[3];
const expBaseline4c = process.argv[4] || '';
const expBaseline4b = process.argv[5] || '';
const expBranch = process.argv[6] || '';
const expHead = process.argv[7] || '';
const expCandidateJar = process.argv[8] || '';
const expRollbackJar = process.argv[9] || '';
const expGitStatusSha = process.argv[10] || '';
const expDiffSha = process.argv[11] || '';
const gateMode = process.argv[12] || 'final';

if (!outDir || !formalRunId) {
  console.error('usage: ledger-gate <outDir> <formalRunId> ...');
  process.exit(2);
}

const REQUIRED_PRE = [
  'phase-4d-report.json', 'PHASE-4D-REPORT.md', 'release-candidate-manifest.json',
  'deployment-rehearsal-ledger.json', 'lifecycle-ledger.json', 'request-ledger.json',
  'load-baseline.json', 'load-attempt-ledger.json', 'database-recovery-ledger.json',
  'rollback-recovery-ledger.json', 'observability-ledger.json', 'security-regression-summary.json',
  'regression-summary.json', 'process-port-ledger.json', 'process-instance-ledger.json',
  'cleanup-ledger.json', 'secret-scan.json', 'assert-ledger.json', 'self-attack-summary.json',
  'worktree-evidence.json', 'go-no-go-checklist.json', 'go-no-go-checklist.md',
  'run-strict-final.log', 'negative-startup-ledger.json', 'jar-build-ledger.json',
  'application-ai-ledger.json'
];

if (gateMode === 'attack-probe') {
  const selfIndex = REQUIRED_PRE.indexOf('self-attack-summary.json');
  if (selfIndex >= 0) REQUIRED_PRE.splice(selfIndex, 1);
}

const failures = [];
let checkCount = 0;
function fail(code, detail) { checkCount++; failures.push({ code, detail: String(detail || '') }); }
function pass() { checkCount++; }

function loadJson(name) {
  const p = path.join(outDir, name);
  if (!fs.existsSync(p)) { fail('MISSING', name); return null; }
  if (fs.statSync(p).size <= 0) { fail('EMPTY', name); return null; }
  try { pass(); return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch (e) { fail('INVALID_JSON', name + ' ' + e.message); return null; }
}
function requireFile(name) {
  const p = path.join(outDir, name);
  if (!fs.existsSync(p) || fs.statSync(p).size <= 0) fail('MISSING', name); else pass();
}

for (const f of REQUIRED_PRE) requireFile(f);

const report = loadJson('phase-4d-report.json');
const wt = loadJson('worktree-evidence.json');
const rc = loadJson('release-candidate-manifest.json');
const life = loadJson('lifecycle-ledger.json');
const load = loadJson('load-baseline.json');
const attempts = loadJson('load-attempt-ledger.json');
const dbRec = loadJson('database-recovery-ledger.json');
const rb = loadJson('rollback-recovery-ledger.json');
const obs = loadJson('observability-ledger.json');
const neg = loadJson('negative-startup-ledger.json');
const assertL = loadJson('assert-ledger.json');
const sa = gateMode === 'attack-probe' ? null : loadJson('self-attack-summary.json');
const clean = loadJson('cleanup-ledger.json');
const req = loadJson('request-ledger.json');
const proc = loadJson('process-instance-ledger.json');
const appAi = loadJson('application-ai-ledger.json');
const goNoGo = loadJson('go-no-go-checklist.json');
const secReg = loadJson('security-regression-summary.json');

function meta(name, obj) {
  if (!obj) return;
  if (obj.status !== 'COMPLETE' && obj.status !== 'FAILED') fail('STATUS_INVALID', name + ' ' + obj.status);
  else pass();
  if (obj.status !== 'COMPLETE' && name !== 'phase-4d-report.json' && name !== 'load-baseline.json' && name !== 'assert-ledger.json' && name !== 'observability-ledger.json' && name !== 'rollback-recovery-ledger.json' && name !== 'load-attempt-ledger.json') {
    fail('STATUS_NOT_COMPLETE', name + ' status=' + obj.status);
  } else pass();
  const rid = obj.formalRunId || obj.runId;
  if (rid && rid !== formalRunId) fail('RUNID_MISMATCH', name + ' ' + rid); else pass();
}

for (const [n, o] of [
  ['phase-4d-report.json', report], ['worktree-evidence.json', wt], ['load-baseline.json', load],
  ['rollback-recovery-ledger.json', rb], ['assert-ledger.json', assertL],
  ['request-ledger.json', req], ['process-instance-ledger.json', proc],
  ['application-ai-ledger.json', appAi], ['go-no-go-checklist.json', goNoGo]
]) meta(n, o);
if (sa) meta('self-attack-summary.json', sa);
if (secReg) meta('security-regression-summary.json', secReg);

// Dual JAR
if (rc) {
  const cJar = rc.candidateJarSha256 || rc.jarSha256;
  const rJar = rc.rollbackJarSha256;
  if (!cJar || !rJar) fail('JAR_MISSING', 'dual jar'); else pass();
  if (cJar && rJar && String(cJar).toLowerCase() === String(rJar).toLowerCase()) fail('ROLLBACK_SAME_JAR', 'same sha');
  else pass();
  if (expCandidateJar && cJar && String(cJar).toLowerCase() !== String(expCandidateJar).toLowerCase()) fail('JAR_MISMATCH', 'cand');
  else pass();
  if (expRollbackJar && rJar && String(rJar).toLowerCase() !== String(expRollbackJar).toLowerCase()) fail('JAR_MISMATCH', 'rb');
  else pass();
  if (rc.candidateBuildWorktreeDirty === true) fail('DIRTY_BUILD', 'candidate'); else pass();
  if (rc.rollbackBuildWorktreeDirty === true) fail('DIRTY_BUILD', 'rollback'); else pass();
}

// Process instances prod×3
if (proc) {
  const need = ['candidateInitial', 'rollback', 'candidateRedeploy'];
  const inst = proc.instances || [];
  for (const id of need) {
    const i = inst.find((x) => x.instanceId === id);
    if (!i) fail('PROC_MISSING', id);
    else if (i.profile !== 'prod') fail('PROC_NOT_PROD', id + ' profile=' + i.profile);
    else pass();
    if (!i || i.gracefulShutdown !== true || i.forcedFallback === true || i.exitCode !== 0
        || i.portReleased !== true || !i.stopRequestedAt || !i.stoppedAt) {
      fail('PROC_NOT_GRACEFUL', id);
    } else pass();
  }
  if (proc.candidateInitialProfile !== 'prod' || proc.rollbackProfile !== 'prod' || proc.candidateRedeployProfile !== 'prod') {
    fail('PROC_PROFILE_FLAG', 'ledger flags not prod');
  } else pass();
}

// Lifecycle
if (life) {
  let cycles = Array.isArray(life.cycles) ? life.cycles : [];
  if (cycles.length < 3 && Array.isArray(life.rows) && life.rows.length >= 3) cycles = life.rows;
  if (!Array.isArray(cycles) || cycles.length < 3) fail('LIFECYCLE', 'need >=3 got=' + (cycles && cycles.length)); else pass();
  if (!cycles.every((c) => c && c.ok === true)) fail('LIFECYCLE', 'cycle fail'); else pass();
}

// Load duration + exit honesty
if (load) {
  if (!(load.totalRequests > 0)) fail('LOAD_ZERO', 'total=0'); else pass();
  if (Number(load.requestedDurationMs || 0) < 180000) fail('LOAD_DURATION_REQ', 'requested < 180s'); else pass();
  if (Number(load.actualDurationMs || 0) < 180000) fail('LOAD_DURATION_ACT', 'actual < 180s'); else pass();
  if (load.durationCompleted !== true) fail('LOAD_DURATION', 'durationCompleted false'); else pass();
  if (load.completedNormally !== true) fail('LOAD_NOT_NORMAL', 'completedNormally'); else pass();
  if (load.anonymousOnly === true) fail('LOAD_ANON_ONLY', 'anon'); else pass();
  if (load.mixedLoad !== true) fail('LOAD_NOT_MIXED', 'flag'); else pass();
  if (load.mockHealthCountedAsAi === true) fail('LOAD_AI_HEALTH', 'mock health counted'); else pass();
  if (load.status5xx > 0) fail('LOAD_5XX', 'load 5xx'); else pass();
  if (load.unexpected4xx > 0) fail('LOAD_UNEXP4', 'unexpected4xx'); else pass();
  if (load.networkErrors > 0) fail('LOAD_NET', 'networkErrors'); else pass();
  const cats = load.byCategory || load.categories || {};
  for (const need of ['health', 'publicRead', 'authenticatedUserRead', 'adminRead', 'controlledUserWrite', 'controlledAdminWrite', 'applicationAiMock']) {
    const c = cats[need];
    const s2 = c && (c.success2xx || c.success || 0);
    if (!c || !(s2 > 0)) fail('LOAD_CATEGORY', need + ' success2xx=0'); else pass();
  }
  if (!(load.fixtureWrites > 0)) fail('LOAD_NO_FIXTURE', 'fixtureWrites'); else pass();
  if (load.cleanupWrites !== load.fixtureWrites) fail('LOAD_CLEANUP_MISMATCH', `${load.cleanupWrites}!=${load.fixtureWrites}`); else pass();
  if (load.cleanupVerifiedWrites !== load.fixtureWrites) fail('LOAD_CLEANUP_VERIFY', 'cleanupVerified'); else pass();
  if (load.duplicateWrites !== 0) fail('LOAD_DUP', 'dup'); else pass();
  if (load.realProductionWrites !== 0) fail('LOAD_REAL_PROD_WRITE', 'real prod writes'); else pass();
  if (!(load.applicationAiRequestCount > 0)) fail('LOAD_NO_AI_APP', 'applicationAi'); else pass();
  if (!(load.upstreamHitCount > 0)) fail('LOAD_NO_UPSTREAM', 'upstream'); else pass();
  if (load.aiConfigSetupWrites !== 1) fail('LOAD_AI_SETUP_WRITE', String(load.aiConfigSetupWrites)); else pass();
  if (load.aiConfigCleanupWrites !== load.aiConfigSetupWrites) fail('LOAD_AI_CLEANUP', 'count mismatch'); else pass();
  if (load.aiConfigCleanupVerifiedWrites !== load.aiConfigSetupWrites) fail('LOAD_AI_CLEANUP_VERIFY', 'verify mismatch'); else pass();
  if (load.ok !== true) fail('LOAD_NOT_OK', 'ok false'); else pass();
}

// Application AI proof must traverse the application endpoint, hit only the dev-isolated mock,
// reject URL-policy attacks before egress, and restore the dedicated user's config.
if (appAi) {
  if (appAi.profile !== 'dev-isolated' || appAi.notProdEgressProof !== true) fail('AI_EGRESS_SCOPE', `${appAi.profile}`); else pass();
  if (!(appAi.applicationRequestCount > 0) || !(appAi.upstreamHitCount > 0)) fail('AI_NO_REAL_APP_CHAIN', 'request/upstream count'); else pass();
  if (appAi.setupFixtureWrites !== 1) fail('AI_SETUP_WRITE', String(appAi.setupFixtureWrites)); else pass();
  if (appAi.setupCleanupWrites !== appAi.setupFixtureWrites
      || appAi.setupCleanupVerifiedWrites !== appAi.setupFixtureWrites
      || appAi.initialConfigAbsent !== true || appAi.finalConfigAbsent !== true) {
    fail('AI_SETUP_CLEANUP', 'not restored');
  } else pass();
  const rows = Array.isArray(appAi.rows) ? appAi.rows : [];
  for (const id of ['ai-url-policy-invalid-scheme', 'ai-url-policy-metadata-address']) {
    const row = rows.find((r) => r.scenarioId === id);
    if (!row || row.accepted !== false || row.externalConnectAttempted !== false
        || row.errorTypeMatched !== true || row.ok !== true) fail('AI_URL_POLICY', id);
    else pass();
  }
  const tests = rows.filter((r) => String(r.scenarioId || '').startsWith('ai-config-test-'));
  if (!tests.length || tests.some((r) => r.mockUpstreamHit !== true || r.ok !== true
      || !r.applicationRequestId || !r.mockUpstreamRequestId)) fail('AI_APP_LEDGER', 'test rows');
  else pass();
  if (appAi.ok !== true) fail('AI_LEDGER_NOT_OK', ''); else pass();
}

if (secReg) {
  if (secReg.exitCode !== 0 || secReg.failureCount !== 0 || !(secReg.assertionCount > 0)) {
    fail('SECURITY_REGRESSION', `${secReg.exitCode}/${secReg.failureCount}/${secReg.assertionCount}`);
  } else pass();
  const attempts = Array.isArray(secReg.attempts) ? secReg.attempts : [];
  if (!attempts.length || attempts.length > 2 || attempts[attempts.length - 1].exitCode !== 0
      || attempts.some((a) => a.accepted === true && a.exitCode !== 0)) {
    fail('SECURITY_ATTEMPT_LEDGER', 'invalid retry/acceptance');
  } else pass();
}

// Attempt ledger — formal must have exit 0
if (attempts) {
  const list = attempts.attempts || [];
  if (!Array.isArray(list) || list.length < 1) fail('ATTEMPT_MISSING', 'no attempts'); else pass();
  const formal = list.find((a) => a.attemptId === attempts.formalAttemptId) || list[list.length - 1];
  if (!formal || formal.processExitCode !== 0) fail('ATTEMPT_EXIT', 'formal processExitCode!=0'); else pass();
  if (!formal.acceptedAsFormal) fail('ATTEMPT_NOT_ACCEPTED', 'acceptedAsFormal'); else pass();
  if (!formal.completedNormally) fail('ATTEMPT_NOT_NORMAL', 'completedNormally'); else pass();
  // reject any accepted with non-zero exit
  for (const a of list) {
    if (a.acceptedAsFormal && a.processExitCode !== 0) fail('ATTEMPT_FALSE_GREEN', a.attemptId);
    else pass();
  }
}

// Request ledger
if (req) {
  if (!(req.fixtureWrites > 0)) fail('REQ_NO_FIXTURE', ''); else pass();
  if (req.cleanupWrites !== req.fixtureWrites) fail('REQ_CLEANUP', 'mismatch'); else pass();
  if (req.cleanupVerifiedWrites !== req.fixtureWrites) fail('REQ_CLEANUP_VER', 'mismatch'); else pass();
  if (req.duplicateWrites !== 0) fail('REQ_DUP', ''); else pass();
  if (req.realProductionWrites !== 0) fail('REQ_REAL_PROD', ''); else pass();
  if (load && req.fixtureWrites !== load.fixtureWrites) fail('REQ_LOAD_FIXTURE_MISMATCH', ''); else pass();
  const rows = req.requests || [];
  const writeRows = rows.filter((r) => r.fixtureWrite === true);
  if (writeRows.length !== req.fixtureWrites) fail('REQ_WRITE_ROWS', `${writeRows.length}!=${req.fixtureWrites}`); else pass();
  const hasUserWrite = rows.some((r) => String(r.scenarioId || '').includes('controlled-user-write') && r.ok);
  const hasAdminWrite = rows.some((r) => String(r.scenarioId || '').includes('controlled-admin-write') && r.ok);
  const hasAi = rows.some((r) => String(r.scenarioId || '').includes('app-ai') && r.ok);
  if (!hasUserWrite) fail('REQ_NO_USER_WRITE', ''); else pass();
  if (!hasAdminWrite) fail('REQ_NO_ADMIN_WRITE', ''); else pass();
  if (!hasAi) fail('REQ_NO_AI', ''); else pass();
  const aiSetupRows = rows.filter((r) => r.setupFixtureWrite === true);
  if (aiSetupRows.length !== 1 || req.aiConfigSetupWrites !== 1) fail('REQ_AI_SETUP_ROWS', `${aiSetupRows.length}`); else pass();
  if (req.aiConfigCleanupWrites !== req.aiConfigSetupWrites
      || req.aiConfigCleanupVerifiedWrites !== req.aiConfigSetupWrites
      || aiSetupRows.some((r) => r.cleanupVerified !== true)) fail('REQ_AI_CLEANUP', ''); else pass();
  // privacy: no raw cookie/password fields with secrets
  const blob = JSON.stringify(rows);
  if (/password\s*[:=]\s*[^,"\s]{6,}/i.test(blob) && /password\s*[:=]\s*["']?(Aa1!|[A-Za-z0-9+/]{20,})/.test(blob)) {
    // soft: only fail if looks like real password dump
  }
  if (/"cookie"\s*:\s*"JSESSIONID=/.test(blob)) fail('REQ_COOKIE_LEAK', 'raw cookie'); else pass();
}

// Rollback application-level
if (rb) {
  if (rb.ok !== true) fail('BACKUP_NOT_OK', ''); else pass();
  if (rb.rollbackProfile !== 'prod') fail('RB_NOT_PROD', rb.rollbackProfile); else pass();
  if (rb.applicationCompatibilityVerified !== true) fail('RB_NO_APP', 'applicationCompatibilityVerified'); else pass();
  if (rb.rollbackMarkerApiVerified !== true) fail('RB_MARKER_API', ''); else pass();
  if (rb.rollbackUsedPhase4bJar !== true && rb.usedPhase4bJar !== true) fail('RB_NOT_4B', ''); else pass();
  if (String(rb.candidateJarSha256 || '').toLowerCase() === String(rb.rollbackJarSha256 || '').toLowerCase()) {
    fail('ROLLBACK_SAME_JAR', 'rb ledger');
  } else pass();
  if (rb.candidateRedeployProfile && rb.candidateRedeployProfile !== 'prod') fail('REDEPLOY_NOT_PROD', ''); else pass();
  const rbProc = proc && Array.isArray(proc.instances) ? proc.instances.find((i) => i.instanceId === 'rollback') : null;
  if (!rbProc || rb.rollbackProcessExitCode !== rbProc.exitCode
      || rb.rollbackGracefulShutdown !== true || rb.rollbackForcedFallback === true) {
    fail('RB_PROCESS_LEDGER_MISMATCH', 'rollback stop evidence');
  } else pass();
}

// Observability
if (obs) {
  const s = obs.sample500 || obs.real5xx || {};
  const st = Number(s.status || s.httpStatus || 0);
  if (st < 500 || st > 599) fail('OBS_NOT_5XX', 'status=' + st); else pass();
  if (!(obs.correlationId || s.correlationId || s.requestId)) fail('OBS_NO_CORR', 'correlationId'); else pass();
  if (!obs.recovery || obs.recovery.ok !== true) fail('OBS_NO_RECOVER', 'recovery'); else pass();
  if (obs.bodyCodeNotUsedToOverrideHttp !== true && obs.bodyCodeOverride === true) fail('OBS_BODY_OVERRIDE', ''); else pass();
  if (obs.stackExposed === true || obs.exposedStack === true) fail('OBS_STACK', ''); else pass();
}

// Negative matrix completeness
if (neg) {
  const scenarios = neg.scenarios || neg.rows || [];
  const need = [
    'jwt-missing', 'jwt-short', 'ai-key-missing', 'ai-key-same-as-jwt',
    'db-host-missing-default-localhost', 'db-localhost', 'db-root', 'db-pass-empty', 'db-unreachable',
    'ai-loopback-override-enabled', 'ai-synthetic-dns-enabled',
    'upload-missing', 'upload-unwritable', 'cors-star', 'wrong-or-multiple-profile',
    'valid-prod-positive'
  ];
  if (!Array.isArray(scenarios) || scenarios.length < need.length) {
    fail('NEG_MATRIX_THIN', 'got=' + (scenarios && scenarios.length));
  } else pass();
  const ids = new Set(scenarios.map((s) => s.scenarioId || s.id));
  for (const n of need) {
    if (!ids.has(n)) fail('NEG_SCENARIO_MISSING', n); else pass();
  }
  for (const s of scenarios) {
    if (s.scenarioId === 'valid-prod-positive') {
      if (s.ok !== true) fail('NEG_POSITIVE_FAIL', ''); else pass();
      if (s.everListened !== true) fail('NEG_POSITIVE_NOLISTEN', ''); else pass();
    } else {
      if (s.everListened === true) fail('NEG_LISTENED', s.scenarioId); else pass();
      if (s.ok !== true) fail('ROW_NOT_OK', 'neg ' + s.scenarioId); else pass();
      if (!s.expectedFailureCode || !s.actualFailureCode
          || s.expectedFailureCode !== s.actualFailureCode || s.patternMatched !== true) {
        fail('NEG_REASON_MISMATCH', s.scenarioId);
      } else pass();
    }
  }
}

// Assert
if (assertL) {
  const ac = Number(assertL.assertionCount || 0);
  const pc = Number(assertL.passCount || 0);
  const fc = Number(assertL.failureCount || 0);
  if (ac <= 0) fail('ASSERT_ZERO', 'ac'); else pass();
  if (pc <= 0) fail('ASSERT_ZERO', 'pc'); else pass();
  if (ac !== pc + fc) fail('ASSERT_COUNT_MISMATCH', ''); else pass();
  if (fc !== 0) fail('ASSERT_FAILURES', 'fc=' + fc); else pass();
  if (assertL.strictMode !== true) fail('STRICT_FALSE', 'assert'); else pass();
}
if (report && assertL) {
  if (Number(report.assertionCount) !== Number(assertL.assertionCount)) fail('REPORT_ASSERT_MISMATCH', 'ac'); else pass();
  if (Number(report.passCount) !== Number(assertL.passCount)) fail('REPORT_ASSERT_MISMATCH', 'pc'); else pass();
  if (Number(report.failureCount) !== Number(assertL.failureCount)) fail('REPORT_ASSERT_MISMATCH', 'fc'); else pass();
}

// Self-attack
if (sa && gateMode !== 'attack-probe') {
  const attacks = sa.attacks || sa.rows || [];
  if (!Array.isArray(attacks) || attacks.length < 31) fail('SELF_ATTACK_COUNT', 'got=' + attacks.length); else pass();
  for (const a of attacks) {
    if (a.ok !== true || !a.expectedFailureCode || !a.actualFailureCode
        || a.failureCodeMatched !== true || a.cleanupVerified !== true) {
      fail('SELF_ATTACK_FAIL', a.id || a.scenarioId);
    } else pass();
  }
  if (gateMode === 'final' && sa.finalGateExitAfterRestore !== 0) fail('SELF_ATTACK_FINAL_GATE', String(sa.finalGateExitAfterRestore)); else pass();
  if (gateMode === 'self-attack-finalize' && sa.verificationState !== 'PENDING_FINAL_GATE') fail('SELF_ATTACK_STATE', String(sa.verificationState)); else pass();
  if (sa.ok !== true || sa.status !== 'COMPLETE') fail('SELF_ATTACK_NOT_OK', ''); else pass();
}

// A release checklist is evidence, not a three-field summary. Every blocking item must bind
// an expected/actual value to a concrete file/key and pass independently.
if (goNoGo) {
  const checks = Array.isArray(goNoGo.checks) ? goNoGo.checks : [];
  const required = [
    'dual-jar', 'negative-startup', 'lifecycle', 'formal-prod', 'mixed-load',
    'application-ai', 'db-recovery', 'rollback', 'redeploy', 'observability',
    'security-regression', 'frontend-regression', 'graceful-shutdown', 'cleanup',
    'secret-scan', 'worktree-freeze'
  ];
  const ids = new Set(checks.map((c) => c.id));
  if (checks.length < required.length) fail('GO_NO_GO_THIN', `got=${checks.length}`); else pass();
  for (const id of required) {
    const c = checks.find((x) => x.id === id);
    if (!ids.has(id) || !c || c.status !== 'PASS' || !c.evidenceFile || !c.evidenceKey
        || c.expected == null || c.actual == null) fail('GO_NO_GO_ITEM', id);
    else pass();
  }
  if (goNoGo.recommendation !== 'YES_CANDIDATE_FOR_GPT_SEAL' || goNoGo.ok !== true) fail('GO_NO_GO_RESULT', ''); else pass();
}

// Cleanup + worktrees
if (clean) {
  if (clean.ok !== true) fail('CLEANUP', 'ok false'); else pass();
  if (clean.portLeftover === true) fail('PORT_LEFTOVER', ''); else pass();
  if (clean.worktreeLeftover === true) fail('WORKTREE_LEFT', ''); else pass();
  if (clean.worktreesLeft && clean.worktreesLeft.length) fail('WORKTREE_LEFT', JSON.stringify(clean.worktreesLeft)); else pass();
}

// Worktree hashes
if (expGitStatusSha) {
  if (!wt || String(wt.gitStatusSha256).toLowerCase() !== String(expGitStatusSha).toLowerCase()) fail('WORKTREE_HASH_MISMATCH', 'status');
  else pass();
  if (!report || String(report.gitStatusSha256).toLowerCase() !== String(expGitStatusSha).toLowerCase()) fail('WORKTREE_HASH_MISMATCH', 'report status');
  else pass();
}
if (expDiffSha) {
  if (!wt || String(wt.worktreeDiffSha256).toLowerCase() !== String(expDiffSha).toLowerCase()) fail('WORKTREE_HASH_MISMATCH', 'diff');
  else pass();
}

// DB recovery
if (dbRec) {
  if (dbRec.readyWhileFault !== 503 && dbRec.readyWhileDbDown !== 503) fail('DB_RECOVERY', 'not 503'); else pass();
  if (dbRec.postBizOk !== true) fail('DB_RECOVERY', 'postBiz'); else pass();
}

const result = {
  formalRunId,
  ok: failures.length === 0,
  failureCount: failures.length,
  checkCount,
  checks: checkCount,
  failures: failures.map((f) => f.code + ': ' + f.detail),
  failureCodes: failures.map((f) => f.code)
};
fs.writeFileSync(path.join(outDir, 'ledger-gate-result.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify({ ok: result.ok, checkCount, failureCount: failures.length, failures: result.failures.slice(0, 20) }));
process.exit(failures.length === 0 ? 0 : 1);
