/**
 * Phase 4D self-attack — sabotage evidence then re-run ledger gate; expect fail.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const outDir = process.argv[2];
const formalRunId = process.argv[3];
const baseline4c = process.argv[4] || '';
const branch = process.argv[5] || '';
const head = process.argv[6] || '';
const candidateJar = process.argv[7] || '';
const gitStatusSha = process.argv[8] || '';
const gitDiffSha = process.argv[9] || '';
const rollbackJar = process.argv[10] || '';
const baseline4b = process.argv[11] || '';

if (!outDir || !formalRunId) {
  console.error('usage: self-attack <outDir> <formalRunId> ...');
  process.exit(2);
}

const gateJs = path.join(__dirname, 'release-phase-4d-ledger-gate.cjs');
const attacks = [];

function read(name) {
  const p = path.join(outDir, name);
  if (!fs.existsSync(p)) return null;
  return fs.readFileSync(p, 'utf8');
}
function write(name, text) {
  fs.writeFileSync(path.join(outDir, name), text);
}
function load(name) {
  const t = read(name);
  return t ? JSON.parse(t) : null;
}
function save(name, obj) {
  write(name, JSON.stringify(obj, null, 2));
}
function runGate(mode = 'attack-probe') {
  const r = spawnSync(process.execPath, [
    gateJs, outDir, formalRunId, baseline4c, baseline4b, branch, head,
    candidateJar, rollbackJar, gitStatusSha, gitDiffSha, mode
  ], { encoding: 'utf8' });
  return { code: r.status == null ? 1 : r.status, out: (r.stdout || '') + (r.stderr || '') };
}

const EXPECTED_CODES = {
  'same-jar-rollback': 'ROLLBACK_SAME_JAR',
  'load-anon-only': 'LOAD_ANON_ONLY',
  'load-short-duration': 'LOAD_DURATION_REQ',
  'load-flush-false-green': 'ATTEMPT_EXIT',
  'load-write-4xx-as-success': 'LOAD_NO_FIXTURE',
  'mock-health-as-ai': 'LOAD_AI_HEALTH',
  'obs-401-as-5xx': 'OBS_NOT_5XX',
  'obs-body-code-override': 'OBS_BODY_OVERRIDE',
  'obs-no-recover': 'OBS_NO_RECOVER',
  'obs-no-correlation': 'OBS_NO_CORR',
  'proc-dev-formal': 'PROC_NOT_PROD',
  'rb-sql-only': 'RB_NO_APP',
  'rb-not-prod': 'RB_NOT_PROD',
  'assert-zero': 'ASSERT_ZERO',
  'missing-request-ledger': 'MISSING',
  'cleanup-worktree-left': 'WORKTREE_LEFT',
  'neg-matrix-thin': 'NEG_MATRIX_THIN',
  'req-cleanup-mismatch': 'REQ_CLEANUP',
  'load-no-upstream': 'LOAD_NO_UPSTREAM',
  'dirty-build-flag': 'DIRTY_BUILD',
  'seal-while-assert-fail': 'ASSERT_FAILURES',
  'missing-load-attempt': 'MISSING',
  'lifecycle-thin': 'LIFECYCLE',
  'db-recovery-fake': 'DB_RECOVERY',
  'hash-mismatch': 'WORKTREE_HASH_MISMATCH',
  'missing-application-ai-ledger': 'MISSING',
  'go-no-go-empty-shell': 'GO_NO_GO_THIN',
  'negative-reason-mismatch': 'NEG_REASON_MISMATCH',
  'forced-shutdown-hidden': 'PROC_NOT_GRACEFUL',
  'ai-config-cleanup-unverified': 'AI_SETUP_CLEANUP',
  'ai-url-policy-false-green': 'AI_URL_POLICY'
};

function attack(id, apply) {
  const backups = {};
  const names = [
    'phase-4d-report.json', 'load-baseline.json', 'load-attempt-ledger.json',
    'request-ledger.json', 'rollback-recovery-ledger.json', 'observability-ledger.json',
    'negative-startup-ledger.json', 'assert-ledger.json', 'process-instance-ledger.json',
    'cleanup-ledger.json', 'release-candidate-manifest.json', 'worktree-evidence.json',
    'lifecycle-ledger.json', 'database-recovery-ledger.json', 'jar-build-ledger.json',
    'deployment-rehearsal-ledger.json', 'security-regression-summary.json',
    'regression-summary.json', 'process-port-ledger.json', 'secret-scan.json',
    'go-no-go-checklist.json', 'application-ai-ledger.json'
  ];
  for (const n of names) {
    const t = read(n);
    if (t != null) backups[n] = t;
  }
  let sabotageApplied = false;
  try {
    apply();
    sabotageApplied = true;
  } catch (e) {
    attacks.push({ id, ok: false, sabotageApplied: false, gateExecuted: false, detail: String(e.message || e) });
    return;
  }
  const g = runGate('attack-probe');
  const gateFailed = g.code !== 0;
  let gateResult = null;
  try { gateResult = load('ledger-gate-result.json'); } catch (_) {}
  const failureCodes = gateResult && Array.isArray(gateResult.failureCodes) ? gateResult.failureCodes : [];
  const expectedFailureCode = EXPECTED_CODES[id];
  const actualFailureCode = failureCodes.includes(expectedFailureCode)
    ? expectedFailureCode : (failureCodes[0] || 'GATE_DID_NOT_FAIL');
  const failureCodeMatched = gateFailed && actualFailureCode === expectedFailureCode;
  attacks.push({
    id,
    ok: failureCodeMatched,
    sabotageApplied: true,
    gateExecuted: true,
    gateExit: g.code,
    expectFail: true,
    expectedFailureCode,
    actualFailureCode,
    failureCodeMatched,
    cleanupVerified: false,
    detail: failureCodeMatched ? 'gate-failed-with-expected-code' : 'GATE_FALSE_GREEN_OR_WRONG_REASON'
  });
  // restore
  for (const n of Object.keys(backups)) write(n, backups[n]);
  const cleanupVerified = Object.entries(backups).every(([name, text]) => read(name) === text);
  attacks[attacks.length - 1].cleanupVerified = cleanupVerified;
  attacks[attacks.length - 1].ok = attacks[attacks.length - 1].ok && cleanupVerified;
}

// 1 baseline must currently pass when evidence is good — still run sabotage cases

attack('same-jar-rollback', () => {
  const rb = load('rollback-recovery-ledger.json');
  if (!rb) throw new Error('no rb');
  rb.rollbackJarSha256 = rb.candidateJarSha256;
  rb.ok = true;
  save('rollback-recovery-ledger.json', rb);
  const rc = load('release-candidate-manifest.json');
  if (rc) { rc.rollbackJarSha256 = rc.candidateJarSha256; save('release-candidate-manifest.json', rc); }
});

attack('load-anon-only', () => {
  const l = load('load-baseline.json');
  if (!l) throw new Error('no load');
  l.anonymousOnly = true;
  l.byCategory = l.byCategory || {};
  for (const k of Object.keys(l.byCategory)) {
    if (k !== 'health' && k !== 'publicRead') {
      l.byCategory[k].success2xx = 0;
      l.byCategory[k].success = 0;
      l.byCategory[k].requestCount = 0;
    }
  }
  l.ok = true;
  save('load-baseline.json', l);
});

attack('load-short-duration', () => {
  const l = load('load-baseline.json');
  if (!l) throw new Error('no load');
  l.requestedDurationMs = 30000;
  l.actualDurationMs = 30000;
  l.durationCompleted = true;
  l.ok = true;
  save('load-baseline.json', l);
});

attack('load-flush-false-green', () => {
  const a = load('load-attempt-ledger.json');
  if (!a) throw new Error('no attempts');
  const list = a.attempts || [];
  if (!list.length) throw new Error('empty attempts');
  list[list.length - 1].processExitCode = -1073740791;
  list[list.length - 1].acceptedAsFormal = true;
  list[list.length - 1].completedNormally = false;
  a.ok = true;
  save('load-attempt-ledger.json', a);
});

attack('load-write-4xx-as-success', () => {
  const l = load('load-baseline.json');
  if (!l) throw new Error('no load');
  l.fixtureWrites = 0;
  l.cleanupWrites = 0;
  l.cleanupVerifiedWrites = 0;
  l.byCategory.controlledUserWrite = { success2xx: 0, success: 0, requestCount: 5, expected4xx: 5 };
  l.ok = true;
  save('load-baseline.json', l);
});

attack('mock-health-as-ai', () => {
  const l = load('load-baseline.json');
  if (!l) throw new Error('no load');
  l.mockHealthCountedAsAi = true;
  l.applicationAiRequestCount = 0;
  l.upstreamHitCount = 0;
  l.byCategory.applicationAiMock = { success2xx: 10, requestCount: 10 };
  l.ok = true;
  save('load-baseline.json', l);
});

attack('obs-401-as-5xx', () => {
  const o = load('observability-ledger.json');
  if (!o) throw new Error('no obs');
  o.sample500 = { status: 401, httpStatus: 401, is5xx: true };
  o.ok = true;
  o.status = 'COMPLETE';
  save('observability-ledger.json', o);
});

attack('obs-body-code-override', () => {
  const o = load('observability-ledger.json');
  if (!o) throw new Error('no obs');
  o.sample500 = { status: 500, httpStatus: 200, is5xx: true, bodySnippet: '{"code":"500"}' };
  o.bodyCodeNotUsedToOverrideHttp = false;
  o.bodyCodeOverride = true;
  o.ok = true;
  save('observability-ledger.json', o);
});

attack('obs-no-recover', () => {
  const o = load('observability-ledger.json');
  if (!o) throw new Error('no obs');
  o.recovery = { ok: false, httpStatus: 500 };
  o.ok = true;
  save('observability-ledger.json', o);
});

attack('obs-no-correlation', () => {
  const o = load('observability-ledger.json');
  if (!o) throw new Error('no obs');
  delete o.correlationId;
  if (o.sample500) { delete o.sample500.correlationId; delete o.sample500.requestId; }
  if (o.real5xx) { delete o.real5xx.correlationId; }
  o.ok = true;
  save('observability-ledger.json', o);
});

attack('proc-dev-formal', () => {
  const p = load('process-instance-ledger.json');
  if (!p) throw new Error('no proc');
  for (const i of (p.instances || [])) {
    if (i.instanceId === 'candidateInitial') i.profile = 'dev';
  }
  p.candidateInitialProfile = 'dev';
  save('process-instance-ledger.json', p);
});

attack('rb-sql-only', () => {
  const rb = load('rollback-recovery-ledger.json');
  if (!rb) throw new Error('no rb');
  rb.applicationCompatibilityVerified = false;
  rb.rollbackMarkerApiVerified = false;
  rb.rollbackSqlMarkerVerified = true;
  rb.ok = true;
  save('rollback-recovery-ledger.json', rb);
});

attack('rb-not-prod', () => {
  const rb = load('rollback-recovery-ledger.json');
  if (!rb) throw new Error('no rb');
  rb.rollbackProfile = 'dev';
  rb.ok = true;
  save('rollback-recovery-ledger.json', rb);
});

attack('assert-zero', () => {
  const a = load('assert-ledger.json');
  if (!a) throw new Error('no assert');
  a.assertionCount = 0; a.passCount = 0; a.failureCount = 0; a.ok = true; a.strictMode = true;
  save('assert-ledger.json', a);
  const r = load('phase-4d-report.json');
  if (r) { r.assertionCount = 0; r.passCount = 0; r.failureCount = 0; save('phase-4d-report.json', r); }
});

attack('missing-request-ledger', () => {
  const p = path.join(outDir, 'request-ledger.json');
  if (fs.existsSync(p)) fs.unlinkSync(p);
});

attack('cleanup-worktree-left', () => {
  const c = load('cleanup-ledger.json');
  if (!c) throw new Error('no clean');
  c.worktreeLeftover = true;
  c.worktreesLeft = ['stray-animal-4d-candidate'];
  c.ok = true;
  save('cleanup-ledger.json', c);
});

attack('neg-matrix-thin', () => {
  const n = load('negative-startup-ledger.json');
  if (!n) throw new Error('no neg');
  n.scenarios = (n.scenarios || []).slice(0, 3);
  n.ok = true;
  save('negative-startup-ledger.json', n);
});

attack('req-cleanup-mismatch', () => {
  const r = load('request-ledger.json');
  if (!r) throw new Error('no req');
  r.cleanupWrites = 0;
  r.cleanupVerifiedWrites = 0;
  r.ok = true;
  save('request-ledger.json', r);
});

attack('load-no-upstream', () => {
  const l = load('load-baseline.json');
  if (!l) throw new Error('no load');
  l.upstreamHitCount = 0;
  l.ok = true;
  save('load-baseline.json', l);
});

attack('dirty-build-flag', () => {
  const rc = load('release-candidate-manifest.json');
  if (!rc) throw new Error('no rc');
  rc.candidateBuildWorktreeDirty = true;
  save('release-candidate-manifest.json', rc);
});

// Additional sabotage covering report seal while broken
attack('seal-while-assert-fail', () => {
  const a = load('assert-ledger.json');
  if (!a) throw new Error('no assert');
  a.failureCount = 2;
  a.passCount = Math.max(0, (a.assertionCount || 2) - 2);
  a.strictMode = false;
  a.status = 'FAILED';
  save('assert-ledger.json', a);
  const r = load('phase-4d-report.json');
  if (r) {
    r.sealRecommendation = 'YES_CANDIDATE_FOR_GPT_SEAL';
    r.failureCount = 0;
    r.strictMode = true;
    save('phase-4d-report.json', r);
  }
});

attack('missing-load-attempt', () => {
  const p = path.join(outDir, 'load-attempt-ledger.json');
  if (fs.existsSync(p)) fs.unlinkSync(p);
});

attack('lifecycle-thin', () => {
  const life = load('lifecycle-ledger.json');
  if (!life) throw new Error('no life');
  life.cycles = (life.cycles || []).slice(0, 1);
  life.rows = (life.rows || []).slice(0, 1);
  life.ok = true;
  save('lifecycle-ledger.json', life);
});

attack('db-recovery-fake', () => {
  const d = load('database-recovery-ledger.json');
  if (!d) throw new Error('no db');
  d.readyWhileFault = 200;
  d.readyWhileDbDown = 200;
  d.faultReadyWas200 = true;
  d.ok = true;
  save('database-recovery-ledger.json', d);
});

attack('hash-mismatch', () => {
  const w = load('worktree-evidence.json');
  if (!w) throw new Error('no wt');
  w.gitStatusSha256 = '0'.repeat(64);
  save('worktree-evidence.json', w);
});

attack('missing-application-ai-ledger', () => {
  const p = path.join(outDir, 'application-ai-ledger.json');
  if (fs.existsSync(p)) fs.unlinkSync(p);
});

attack('go-no-go-empty-shell', () => {
  const g = load('go-no-go-checklist.json');
  if (!g) throw new Error('no go/no-go');
  g.checks = [];
  g.ok = true;
  g.recommendation = 'YES_CANDIDATE_FOR_GPT_SEAL';
  save('go-no-go-checklist.json', g);
});

attack('negative-reason-mismatch', () => {
  const n = load('negative-startup-ledger.json');
  if (!n) throw new Error('no negative ledger');
  const row = (n.scenarios || []).find((x) => x.scenarioId === 'db-unreachable');
  if (!row) throw new Error('no db-unreachable row');
  row.actualFailureCode = 'DB_FORBIDDEN_NAME';
  row.patternMatched = false;
  row.ok = true;
  save('negative-startup-ledger.json', n);
});

attack('forced-shutdown-hidden', () => {
  const p = load('process-instance-ledger.json');
  if (!p) throw new Error('no process ledger');
  const row = (p.instances || []).find((x) => x.instanceId === 'candidateInitial');
  if (!row) throw new Error('no candidateInitial');
  row.gracefulShutdown = true;
  row.forcedFallback = true;
  row.exitCode = -1;
  save('process-instance-ledger.json', p);
});

attack('ai-config-cleanup-unverified', () => {
  const a = load('application-ai-ledger.json');
  if (!a) throw new Error('no application AI ledger');
  a.setupCleanupVerifiedWrites = 0;
  a.finalConfigAbsent = false;
  a.ok = true;
  save('application-ai-ledger.json', a);
});

attack('ai-url-policy-false-green', () => {
  const a = load('application-ai-ledger.json');
  if (!a) throw new Error('no application AI ledger');
  const row = (a.rows || []).find((x) => x.scenarioId === 'ai-url-policy-metadata-address');
  if (!row) throw new Error('no metadata policy row');
  row.accepted = true;
  row.externalConnectAttempted = true;
  row.errorTypeMatched = false;
  row.ok = true;
  save('application-ai-ledger.json', a);
});

const attacksOk = attacks.every((a) => a.ok);
let summary = {
  phase: '4D',
  formalRunId,
  status: attacksOk ? 'COMPLETE' : 'FAILED',
  residualRisk: !attacksOk,
  strictMode: attacksOk,
  ok: attacksOk,
  attacks,
  attackCount: attacks.length,
  passCount: attacks.filter((a) => a.ok).length,
  failCount: attacks.filter((a) => !a.ok).length,
  verificationState: 'PENDING_FINAL_GATE',
  finalGateExitAfterRestore: null,
  finalVerificationGateExit: null,
  jarSha256: candidateJar,
  rollbackJarSha256: rollbackJar,
  baseline4c,
  baseline4b,
  branch,
  head,
  startedAt: new Date().toISOString(),
  endedAt: new Date().toISOString()
};
fs.writeFileSync(path.join(outDir, 'self-attack-summary.json'), JSON.stringify(summary, null, 2));

// First pass validates restored evidence and attack rows while allowing the pending final-exit field.
const finalizeGate = runGate('self-attack-finalize');
summary.finalGateExitAfterRestore = finalizeGate.code;
summary.verificationState = finalizeGate.code === 0 ? 'VERIFIED' : 'FAILED';
summary.ok = summary.ok && finalizeGate.code === 0;
summary.strictMode = summary.ok;
summary.residualRisk = !summary.ok;
summary.status = summary.ok ? 'COMPLETE' : 'FAILED';
fs.writeFileSync(path.join(outDir, 'self-attack-summary.json'), JSON.stringify(summary, null, 2));

const finalGate = runGate('final');
summary.finalVerificationGateExit = finalGate.code;
summary.ok = summary.ok && finalGate.code === 0;
summary.strictMode = summary.ok;
summary.residualRisk = !summary.ok;
summary.status = summary.ok ? 'COMPLETE' : 'FAILED';
fs.writeFileSync(path.join(outDir, 'self-attack-summary.json'), JSON.stringify(summary, null, 2));
const persistedGate = runGate('final');
summary.finalVerificationGateExit = persistedGate.code;
summary.ok = summary.ok && persistedGate.code === 0;
summary.strictMode = summary.ok;
summary.residualRisk = !summary.ok;
summary.status = summary.ok ? 'COMPLETE' : 'FAILED';
fs.writeFileSync(path.join(outDir, 'self-attack-summary.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ ok: summary.ok, attacks: summary.attackCount, pass: summary.passCount, fail: summary.failCount, finalGateExitAfterRestore: summary.finalGateExitAfterRestore, finalVerificationGateExit: summary.finalVerificationGateExit }));
process.exit(summary.ok ? 0 : 1);
