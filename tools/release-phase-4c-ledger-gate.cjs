/**
 * Phase 4C SEMANTIC ledger gate (round 3).
 * Usage: node tools/release-phase-4c-ledger-gate.cjs <outDir> <formalRunId> [baseline4b] [branch] [head] [jarSha256]
 *        [gitStatusSha256] [worktreeDiffSha256]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const outDir = process.argv[2];
const formalRunId = process.argv[3];
const expBaseline = process.argv[4] || '893e024b70e9117c89c204ffac67ad3655eb1f4a';
const expBranch = process.argv[5] || '';
const expHead = process.argv[6] || '';
const expJar = process.argv[7] || '';
const expGitStatusSha = process.argv[8] || '';
const expDiffSha = process.argv[9] || '';

if (!outDir || !formalRunId) {
  console.error('usage: ledger-gate <outDir> <formalRunId> [baseline] [branch] [head] [jar] [gitStatusSha] [diffSha]');
  process.exit(2);
}

// Always resolve project root from this script (works for formal runs and self-attack temp dirs)
const projectRoot = path.resolve(__dirname, '..');

function sha256File(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function parseSurefireXml(xmlPath) {
  if (!xmlPath || !fs.existsSync(xmlPath)) {
    return { ok: false, error: 'missing-xml', tests: null, failures: null, errors: null, skipped: null, testcaseNames: [] };
  }
  const xml = fs.readFileSync(xmlPath, 'utf8');
  const suiteOpen = xml.match(/<testsuite\b([^>]*)>/);
  const attrs = suiteOpen ? suiteOpen[1] : '';
  const num = (name) => {
    const m = attrs.match(new RegExp('\\b' + name + '="(\\d+)"'));
    return m ? Number(m[1]) : null;
  };
  const names = [];
  const re = /<testcase\b[^>]*\bname="([^"]+)"/g;
  let m;
  while ((m = re.exec(xml)) !== null) names.push(m[1]);
  return {
    ok: true,
    tests: num('tests'),
    failures: num('failures'),
    errors: num('errors'),
    skipped: num('skipped') != null ? num('skipped') : 0,
    testcaseNames: names,
    hasTestcase: (n) => names.includes(n)
  };
}

function resolveSurefirePath(ref) {
  if (!ref) return null;
  if (path.isAbsolute(ref) && fs.existsSync(ref)) return ref;
  const candidates = [
    path.join(outDir, ref),
    path.join(outDir, path.basename(ref)),
    path.join(outDir, 'surefire', path.basename(ref)),
    path.join(projectRoot, 'target', 'surefire-reports', path.basename(ref))
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

/**
 * Semantic Surefire binding: real XML parse, testcase present, suite clean,
 * ledger counters match XML, testClassSha256 matches current test source.
 */
function validateSurefireBinding(row, javaRelPath, failCode, sid) {
  if (!row) return;
  if (!row.surefireXml || !row.testcaseName || !row.testClassSha256) {
    fail(failCode, sid + ' needs surefireXml+testcaseName+testClassSha256');
    return;
  }
  const xmlPath = resolveSurefirePath(row.surefireXml);
  if (!xmlPath) {
    fail(failCode, sid + ' surefire XML missing: ' + row.surefireXml);
    return;
  }
  passCheck();
  const suite = parseSurefireXml(xmlPath);
  if (!suite.ok) {
    fail('SUREFIRE_SEMANTIC', sid + ' surefire XML unreadable');
    return;
  }
  if (!suite.hasTestcase(row.testcaseName)) {
    fail('SUREFIRE_SEMANTIC', sid + ' testcase missing from XML: ' + row.testcaseName);
    return;
  }
  passCheck();
  if (suite.failures !== 0 || suite.errors !== 0 || suite.skipped !== 0) {
    fail('SUREFIRE_SEMANTIC', sid + ` suite not clean failures=${suite.failures} errors=${suite.errors} skipped=${suite.skipped}`);
    return;
  }
  passCheck();
  const fields = ['tests', 'failures', 'errors', 'skipped'];
  for (const f of fields) {
    if (row[f] == null) {
      fail('SUREFIRE_SEMANTIC', sid + ' ledger missing counter ' + f);
      return;
    }
    if (Number(row[f]) !== Number(suite[f])) {
      fail('SUREFIRE_SEMANTIC', sid + ` ledger ${f}=${row[f]} xml=${suite[f]}`);
      return;
    }
  }
  passCheck();
  const javaPath = path.join(projectRoot, javaRelPath.replace(/\//g, path.sep));
  const liveSha = sha256File(javaPath);
  if (!liveSha) {
    fail('SUREFIRE_SEMANTIC', sid + ' test source missing: ' + javaRelPath);
    return;
  }
  if (String(row.testClassSha256).toLowerCase() !== liveSha.toLowerCase()) {
    fail('SUREFIRE_SEMANTIC', sid + ' testClassSha256 mismatch live=' + liveSha.slice(0, 12));
    return;
  }
  passCheck();
}

const NA_ALLOWED = new Set(['websocket-security-ledger.json']);

const REQUIRED_SCENARIOS = {
  'session-security-ledger.json': [
    'httponly', 'session-id-rotation', 'failed-login-no-auth', 'logout-invalidates',
    'health-live-no-session-cookie'
  ],
  'ssrf-matrix.json': [
    'ssrf-loopback-ipv4', 'ssrf-loopback-hostname', 'ssrf-private-rfc1918',
    'ssrf-link-local-metadata', 'ssrf-loopback-ipv6', 'ssrf-dns-private',
    'ssrf-userinfo', 'ssrf-query', 'ssrf-fragment', 'ssrf-file-scheme',
    'ssrf-http-scheme', 'ssrf-admin-agent-loopback'
  ],
  'object-ownership-matrix.json': [
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
  ],
  'csrf-matrix.json': [
    'csrf-missing-token', 'csrf-invalid-token', 'csrf-cross-user-token',
    'csrf-admin-write-missing', 'csrf-upload-missing'
  ],
  'cors-matrix.json': [
    'cors-evil-origin', 'cors-allowed-origin', 'cors-origin-null',
    'cors-options-preflight-evil', 'cors-no-wildcard-credentials'
  ],
  'file-security-ledger.json': [
    'file-upload-png-private', 'file-canonical-or-sanitized',
    'file-traversal-no-escape', 'file-cross-user-download',
    'file-svg-rejected', 'file-exe-rejected', 'file-log-crlf-sanitized'
  ],
  'ai-resource-limit-ledger.json': [
    'ai-long-input-rejected', 'ai-concurrent-limit', 'ai-tool-allow-deny'
  ],
  'agent-tool-boundary-ledger.json': [
    'agent-tool-allowlisted', 'agent-tool-unknown-denied', 'user-forbidden-admin-agent'
  ],
  'ai-config-isolation-ledger.json': [
    'ai-config-save-A', 'ai-config-save-B', 'ai-config-no-key-plaintext-A',
    'ai-config-no-key-plaintext-B', 'ai-config-clear-A-B-unchanged'
  ]
};

const REQUIRED = [
  { name: 'assert-ledger.json', requireRows: true, requireAssert: true },
  { name: 'api-inventory.json', requireRows: false, altKey: 'endpoints' },
  { name: 'function-auth-matrix.json', requireRows: true },
  { name: 'object-ownership-matrix.json', requireRows: true },
  { name: 'property-security-ledger.json', requireRows: true },
  { name: 'session-security-ledger.json', requireRows: true },
  { name: 'csrf-matrix.json', requireRows: true },
  { name: 'cors-matrix.json', requireRows: true },
  { name: 'websocket-security-ledger.json', requireRows: false, allowNa: true },
  { name: 'file-security-ledger.json', requireRows: true },
  { name: 'input-security-ledger.json', requireRows: true },
  { name: 'xss-browser-ledger.json', requireRows: true },
  { name: 'error-disclosure-ledger.json', requireRows: true },
  { name: 'ai-config-isolation-ledger.json', requireRows: true },
  { name: 'ssrf-matrix.json', requireRows: true },
  { name: 'ai-resource-limit-ledger.json', requireRows: true },
  { name: 'agent-tool-boundary-ledger.json', requireRows: true },
  { name: 'secret-scan.json', requireRows: false },
  { name: 'log-redaction-ledger.json', requireRows: false },
  { name: 'export-security-ledger.json', requireRows: false },
  { name: 'resource-abuse-ledger.json', requireRows: true },
  { name: 'security-headers-ledger.json', requireRows: false },
  { name: 'production-exposure-ledger.json', requireRows: false },
  { name: 'request-ledger.json', requireRows: false, altKey: 'requests', requireNonEmptyAlt: true },
  { name: 'db-before-after-ledger.json', requireSnapshots: true },
  { name: 'file-before-after-ledger.json', requireSnapshots: true },
  { name: 'cleanup-ledger.json', requireRows: false },
  { name: 'self-attack-summary.json', requireRows: true, altKey: 'attacks' },
  { name: 'phase-4c-report.json', requireRows: false },
  { name: 'worktree-evidence.json', requireRows: false }
];

const failures = [];
let checkCount = 0;
function fail(code, detail) {
  checkCount++;
  failures.push({ code, detail: String(detail || '') });
}
function passCheck() { checkCount++; }

function loadJson(name) {
  const p = path.join(outDir, name);
  if (!fs.existsSync(p)) {
    fail('MISSING', name);
    return null;
  }
  try {
    passCheck();
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    fail('INVALID_JSON', name + ' ' + e.message);
    return null;
  }
}

function checkMeta(name, obj) {
  if (!obj) return;
  const status = obj.status;
  if (status === 'NOT_APPLICABLE') {
    if (!NA_ALLOWED.has(name) && !obj.allowNa) {
      fail('NA_NOT_ALLOWED', name);
      return;
    }
    if (!obj.reason || !obj.evidence) {
      fail('NA_WITHOUT_EVIDENCE', name);
    } else passCheck();
    return;
  }
  if (status !== 'COMPLETE') {
    fail('STATUS_NOT_COMPLETE', name + ' status=' + status);
  } else passCheck();
  if (obj.residualRisk === true) fail('RESIDUAL_RISK', name);
  else passCheck();
  if (obj.strictMode === false) fail('STRICT_FALSE', name);
  else if (obj.strictMode === true) passCheck();
  const rid = obj.formalRunId || obj.runId;
  if (!rid) fail('META_MISSING', name + ' formalRunId');
  else if (rid !== formalRunId) fail('RUNID_MISMATCH', name + ' got=' + rid);
  else passCheck();
  if (obj.phase && obj.phase !== '4C') fail('PHASE_MISMATCH', name + ' phase=' + obj.phase);
  if (obj.baseline4b && obj.baseline4b !== expBaseline) fail('BASELINE_MISMATCH', name + ' got=' + obj.baseline4b);
  if (expBranch && obj.branch && obj.branch !== expBranch) fail('BRANCH_MISMATCH', name + ' got=' + obj.branch);
  if (expHead && obj.head && obj.head !== expHead) fail('HEAD_MISMATCH', name + ' got=' + obj.head);
  if (expJar && obj.jarSha256 && obj.jarSha256 !== expJar) fail('JAR_MISMATCH', name + ' got=' + obj.jarSha256);
}

function rowScenarioId(row) {
  return row && (row.scenarioId || row.scenario || row.id || row.check || row.attack) || null;
}

function allRowsOk(name, rows) {
  if (!Array.isArray(rows)) return;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.ok !== true) {
      fail('ROW_NOT_OK', name + ' row=' + (rowScenarioId(r) || i) + ' ok=' + (r && r.ok));
    } else passCheck();
    if (r && (r.status === 'NOT_APPLICABLE' || r.notApplicable === true) && name !== 'websocket-security-ledger.json') {
      fail('NA_NOT_ALLOWED', name + ' row-level NA ' + (rowScenarioId(r) || i));
    }
  }
}

const requestLedger = loadJson('request-ledger.json');
const requestIds = new Set();
const requestIdCounts = {};
if (requestLedger && Array.isArray(requestLedger.requests)) {
  for (const r of requestLedger.requests) {
    const id = r.requestId;
    if (!id) continue;
    requestIdCounts[id] = (requestIdCounts[id] || 0) + 1;
    requestIds.add(id);
  }
  for (const [id, n] of Object.entries(requestIdCounts)) {
    if (n > 1) fail('REQUESTID_DUP', id + ' count=' + n);
  }
}

for (const req of REQUIRED) {
  const obj = loadJson(req.name);
  if (!obj) continue;
  checkMeta(req.name, obj);
  if (obj.status === 'NOT_APPLICABLE') continue;

  const rows = obj.rows || obj.attacks || obj.endpoints || (req.altKey ? obj[req.altKey] : null);

  if (req.requireRows) {
    if (!Array.isArray(rows) || rows.length === 0) fail('EMPTY_ROWS', req.name);
    else allRowsOk(req.name, rows);
  }
  if (req.requireNonEmptyAlt && req.altKey) {
    const alt = obj[req.altKey];
    if (!Array.isArray(alt) || alt.length === 0) fail('EMPTY_ROWS', req.name + ' ' + req.altKey);
  }
  if (req.requireSnapshots) {
    const snaps = obj.snapshots;
    if (!Array.isArray(snaps) || snaps.length === 0) {
      fail('SNAPSHOT_INCOMPLETE', req.name + ' empty snapshots');
    } else {
      for (let i = 0; i < snaps.length; i++) {
        const s = snaps[i];
        if (s.before === undefined || s.after === undefined) {
          fail('SNAPSHOT_INCOMPLETE', req.name + '[' + i + '] missing before/after');
        } else passCheck();
        if (s.ok !== true) fail('ROW_NOT_OK', req.name + ' snapshot[' + i + '] ok=' + s.ok);
        if (s.requestId && requestIds.size && !requestIds.has(s.requestId) && !String(s.requestId).startsWith('unit:')) {
          fail('REQUESTID_MISSING', req.name + ' snapshot requestId=' + s.requestId);
        }
      }
    }
  }

  if (req.requireAssert && obj) {
    const fc = obj.failureCount != null ? Number(obj.failureCount) : null;
    const badRows = Array.isArray(obj.rows) ? obj.rows.filter(r => !r || r.ok !== true).length : 0;
    if (fc !== null && fc !== badRows) fail('FAILURE_COUNT_MISMATCH', req.name + ' failureCount=' + fc + ' badRows=' + badRows);
    if (fc !== null && fc !== 0) fail('ROW_NOT_OK', req.name + ' failureCount=' + fc);
    if (obj.strictMode !== true) fail('STRICT_FALSE', req.name);
  }

  const need = REQUIRED_SCENARIOS[req.name];
  if (need && Array.isArray(rows)) {
    const have = new Set(rows.map(rowScenarioId).filter(Boolean));
    for (const sid of need) {
      if (!have.has(sid)) fail('SCENARIO_MISSING', req.name + ' ' + sid);
      else passCheck();
    }
  }

  if (Array.isArray(rows) && requestIds.size) {
    for (const r of rows) {
      if (r && r.requestId && !requestIds.has(r.requestId)) {
        if (String(r.requestId).startsWith('unit:') || r.source === 'unit-test') continue;
        fail('REQUESTID_MISSING', req.name + ' ' + r.requestId);
      }
    }
  }

  // Ownership rows must have real resourceId for core scenarios
  if (req.name === 'object-ownership-matrix.json' && Array.isArray(rows)) {
    const needRes = [
      'proof-owner-read', 'proof-foreign-read', 'visit-owner-read', 'visit-foreign-read',
      'notif-owner-read', 'notif-foreign-mark', 'volunteer-cross-user-cancel',
      'help-owner-read', 'help-foreign-read'
    ];
    for (const sid of needRes) {
      const r = rows.find(x => rowScenarioId(x) === sid);
      if (!r) continue;
      if (r.resourceId == null || r.resourceId === '' || String(r.resourceId).includes('999999')) {
        fail('ROW_NOT_OK', 'ownership missing real resourceId for ' + sid);
      } else passCheck();
      if (!r.actor) fail('ROW_NOT_OK', 'ownership missing actor for ' + sid);
    }
  }

  // AI concurrent: someLimit must be true + 429/503 present
  if (req.name === 'ai-resource-limit-ledger.json' && Array.isArray(rows)) {
    const conc = rows.find(r => rowScenarioId(r) === 'ai-concurrent-limit');
    if (conc) {
      if (conc.someLimit !== true) fail('AI_CONCURRENT_WEAK', 'someLimit!==true');
      else passCheck();
      const statuses = conc.statuses || [];
      const codes = (conc.codes || []).map(String);
      const hasLimit = statuses.some(s => s === 429 || s === 503) ||
        codes.some(c => c === '429' || c === '503');
      if (!hasLimit) fail('AI_CONCURRENT_WEAK', 'no 429/503 in concurrent results');
      else passCheck();
      if (!(conc.upstreamHitCount > 0) && !(conc.requestCount > 0 && conc.maxInFlight > 0)) {
        fail('AI_CONCURRENT_WEAK', 'missing upstreamHitCount/maxInFlight evidence');
      } else passCheck();
    }
  }

  // Agent tools must bind Surefire evidence (semantic XML + source SHA)
  if (req.name === 'agent-tool-boundary-ledger.json' && Array.isArray(rows)) {
    for (const sid of ['agent-tool-allowlisted', 'agent-tool-unknown-denied']) {
      const r = rows.find(x => rowScenarioId(x) === sid);
      if (!r) continue;
      if (r.source === 'static-source' || (r.source === 'unit-backed-source' && !r.surefireXml)) {
        fail('AGENT_EVIDENCE_MISSING', sid + ' static/unit-backed without surefire');
        continue;
      }
      if (!r.surefireXml || !r.testClassSha256 || !r.testcaseName) {
        fail('AGENT_EVIDENCE_MISSING', sid + ' needs surefireXml+testClassSha256+testcaseName');
        continue;
      }
      validateSurefireBinding(
        r,
        'src/test/java/com/example/service/AdminAgentToolsTest.java',
        'AGENT_EVIDENCE_MISSING',
        sid
      );
    }
  }

  // Session rotation must bind unit test evidence (semantic XML + source SHA)
  if (req.name === 'session-security-ledger.json' && Array.isArray(rows)) {
    const rot = rows.find(r => rowScenarioId(r) === 'session-id-rotation');
    if (rot) {
      if (!rot.surefireXml || !rot.testcaseName || !rot.testClassSha256) {
        fail('SESSION_EVIDENCE_MISSING', 'session-id-rotation needs surefire binding');
      } else {
        validateSurefireBinding(
          rot,
          'src/test/java/com/example/controller/SessionRotationSecurityTest.java',
          'SESSION_EVIDENCE_MISSING',
          'session-id-rotation'
        );
      }
    }
    const hl = rows.find(r => rowScenarioId(r) === 'health-live-no-session-cookie');
    if (hl && hl.ok !== true) fail('ROW_NOT_OK', 'health-live-no-session-cookie');
  }

  if (req.name === 'ssrf-matrix.json' && Array.isArray(rows)) {
    for (const r of rows) {
      if (!r) continue;
      const cat = String(r.category || r.scenarioId || '');
      if (r.bodyField === 'apiBaseUrl' && r.ok === true) fail('ROW_NOT_OK', 'ssrf used apiBaseUrl');
      if (/dns|private|loopback|link-local|metadata|rfc1918/i.test(cat) && r.externalConnectAttempted === true) {
        fail('ROW_NOT_OK', 'ssrf externalConnectAttempted on private ' + cat);
      }
      if (r.accepted === true && /private|file|ftp|metadata|rfc1918|link-local/i.test(cat)) {
        fail('ROW_NOT_OK', 'ssrf accepted dangerous ' + cat);
      }
      // Loopback may be unit-test rejection evidence (accepted=false) while live formal run
      // enables loopback only for mock LLM; never accept private non-loopback.
      if (r.errorType && /TLS|SSL|502|CONNECT|TIMEOUT|HANDSHAKE/i.test(String(r.errorType)) && r.ok === true) {
        fail('ROW_NOT_OK', 'ssrf network-error-as-ok ' + cat);
      }
      if (/loopback|private|dns|metadata|file|ftp/i.test(cat) && r.ok === true) {
        const et = String(r.errorType || '');
        if (!/URL_POLICY|PRIVATE_ADDRESS|DNS_POLICY|SCHEME_POLICY/i.test(et) && r.source !== 'unit-test') {
          fail('ROW_NOT_OK', 'ssrf weak errorType ' + et + ' for ' + cat);
        }
      }
    }
  }

  if (req.name === 'cors-matrix.json' && Array.isArray(rows)) {
    for (const r of rows) {
      if (r && (rowScenarioId(r) === 'cors-allowed-origin' || r.scenario === 'allowed-origin')) {
        if (!r.acao || r.acao === 'null' || r.acao === '*') {
          if (r.ok === true) fail('ROW_NOT_OK', 'cors-allowed missing exact acao');
        }
        if (r.origin && r.acao && r.acao !== r.origin && r.ok === true) {
          fail('ROW_NOT_OK', 'cors-allowed acao mismatch');
        }
      }
    }
  }
}

// Worktree hash rebind — both evidence + phase report must match CLI final hashes
const wt = loadJson('worktree-evidence.json');
const report = loadJson('phase-4c-report.json');
if (expGitStatusSha) {
  if (!wt || !wt.gitStatusSha256 || String(wt.gitStatusSha256).toLowerCase() !== String(expGitStatusSha).toLowerCase()) {
    fail('WORKTREE_HASH_MISMATCH', 'worktree-evidence.gitStatusSha256');
  } else passCheck();
  if (!report || !report.gitStatusSha256 || String(report.gitStatusSha256).toLowerCase() !== String(expGitStatusSha).toLowerCase()) {
    fail('WORKTREE_HASH_MISMATCH', 'phase-4c-report.gitStatusSha256');
  } else passCheck();
}
if (expDiffSha) {
  if (!wt || !wt.worktreeDiffSha256 || String(wt.worktreeDiffSha256).toLowerCase() !== String(expDiffSha).toLowerCase()) {
    fail('WORKTREE_HASH_MISMATCH', 'worktree-evidence.worktreeDiffSha256');
  } else passCheck();
  if (!report || !report.worktreeDiffSha256 || String(report.worktreeDiffSha256).toLowerCase() !== String(expDiffSha).toLowerCase()) {
    fail('WORKTREE_HASH_MISMATCH', 'phase-4c-report.worktreeDiffSha256');
  } else passCheck();
}

if (report) {
  if (report.strictMode !== true) fail('STRICT_FALSE', 'phase-4c-report');
  if (Number(report.p0) > 0 || Number(report.p1) > 0 || Number(report.p2) > 0) {
    fail('ROW_NOT_OK', 'phase-4c-report has P0/P1/P2');
  }
  if (report.sealRecommendation === 'YES_CANDIDATE_FOR_SEAL' && failures.length > 0) {
    fail('SEAL_BLOCKED', 'seal yes but gate failures exist');
  }
}

// testToolManifest must include Surefire-bound unit sources
if (wt && Array.isArray(wt.testToolManifest)) {
  const paths = wt.testToolManifest.map(e => String((e && e.path) || '').replace(/\\/g, '/'));
  const need = [
    'src/test/java/com/example/service/AdminAgentToolsTest.java',
    'src/test/java/com/example/controller/SessionRotationSecurityTest.java'
  ];
  for (const n of need) {
    const hit = paths.some(p => p.endsWith(n) || p === n || p.endsWith(n.replace(/\//g, '\\')));
    if (!hit) fail('SUREFIRE_SEMANTIC', 'testToolManifest missing ' + n);
    else passCheck();
  }
}

const result = {
  formalRunId,
  ok: failures.length === 0,
  failureCount: failures.length,
  checkCount: Math.max(checkCount, 1),
  failures: failures.map(f => f.code + ': ' + f.detail),
  failureCodes: failures.map(f => f.code),
  checks: failures.length
};
fs.writeFileSync(path.join(outDir, 'ledger-gate-result.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify({
  ok: result.ok,
  failures: failures.length,
  checkCount: result.checkCount,
  list: result.failures.slice(0, 30),
  codes: result.failureCodes.slice(0, 30)
}));
process.exit(result.ok ? 0 : 1);
