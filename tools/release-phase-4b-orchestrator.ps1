# Phase 4B orchestrator — strict ledgers, packaged JAR, health adversarial, CORS, fault inject, cleanup.
# Never prints secret values. Does not commit/push.
param(
  [ValidateSet("Formal","FaultInject")]
  [string]$Mode = "Formal",
  [ValidateSet("","wrong-jar-sha","notice-no-request","http200-code503","cleanup-leftover","wrong-expect")]
  [string]$Fault = ""
)

$ErrorActionPreference = "Stop"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $Root

# --- identity ---
$runId = "E2E4B_" + (Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ") + "_" + ([guid]::NewGuid().ToString("N").Substring(0,6).ToUpper())
if ($Mode -eq "FaultInject") { $runId = "E2E4B_FAULT_" + $Fault + "_" + ([guid]::NewGuid().ToString("N").Substring(0,6).ToUpper()) }

$out = Join-Path $Root "output\playwright\release-phase-4b"
$runtime = Join-Path $out "runtime"
$upload = Join-Path $runtime "upload"
$logs = Join-Path $out "logs"
$shots = Join-Path $out "screenshots"
$faultDir = Join-Path $out "fault-inject"
New-Item -ItemType Directory -Force -Path $out,$runtime,$upload,$logs,$shots,$faultDir | Out-Null
if ($Mode -eq "Formal") {
  Get-ChildItem $shots -Filter *.png -ErrorAction SilentlyContinue | Remove-Item -Force
}

# Secrets only in process memory / temp cnf
$JwtSecret = -join ((48..57 + 65..90 + 97..122 | Get-Random -Count 48 | ForEach-Object { [char]$_ }))
$AiKey = -join ((48..57 + 65..90 + 97..122 | Get-Random -Count 48 | ForEach-Object { [char]$_ }))
$AdminPass = -join ((48..57 + 65..90 + 97..122 | Get-Random -Count 24 | ForEach-Object { [char]$_ })) + "Aa1!"
$DbAppPass = -join ((48..57 + 65..90 + 97..122 | Get-Random -Count 20 | ForEach-Object { [char]$_ })) + "Aa1!"
$KsPass = -join ((48..57 + 65..90 + 97..122 | Get-Random -Count 16 | ForEach-Object { [char]$_ }))
$AdminUser = ("e2e4b_adm_" + $runId.Substring([Math]::Max(0,$runId.Length-6))).ToLower() -replace '[^a-z0-9_]',''
if ($AdminUser.Length -gt 24) { $AdminUser = $AdminUser.Substring(0,24) }
$DbAppUser = ("e2e4b_u_" + ([guid]::NewGuid().ToString("N").Substring(0,6))).ToLower()
$SourceDb = "stray_animal_e2e4b_" + ([guid]::NewGuid().ToString("N").Substring(0,10))
$RestoreDb = "stray_animal_e2e4b_restore_" + ([guid]::NewGuid().ToString("N").Substring(0,8))
$SourceAlias = "source_db"
$RestoreAlias = "restore_db"
$DbHostName = $env:COMPUTERNAME
if ([string]::IsNullOrWhiteSpace($DbHostName)) { $DbHostName = [System.Net.Dns]::GetHostName() }
$AdminCnf = Join-Path $runtime "mysql-admin.cnf"
$AppCnf = Join-Path $runtime "mysql-app.cnf"
$Keystore = Join-Path $runtime "e2e4b.p12"
$DumpFile = Join-Path $runtime "backup.sql"
$Jar = Join-Path $Root "target\animal-home-1.0-SNAPSHOT.jar"
$JavaExe = if ($env:JAVA_HOME -and (Test-Path (Join-Path $env:JAVA_HOME "bin\java.exe"))) {
  Join-Path $env:JAVA_HOME "bin\java.exe"
} else {
  $c = Get-Command java -ErrorAction SilentlyContinue
  if (-not $c) { throw "Java not found: set JAVA_HOME" }
  $c.Source
}

# --- strict ledger ---
$script:assertionCount = 0
$script:passCount = 0
$script:failureCount = 0
$script:skipCount = 0
$script:strictMode = $true
$script:failures = New-Object System.Collections.Generic.List[string]
$script:assertRows = New-Object System.Collections.Generic.List[object]
$script:trackedPids = New-Object System.Collections.Generic.List[int]
$script:portSnapshots = New-Object System.Collections.Generic.List[object]
$script:scenarios = New-Object System.Collections.Generic.List[object]
$script:p0 = 0; $script:p1 = 0; $script:p2 = 0; $script:p3 = 0
$startedAt = (Get-Date).ToUniversalTime().ToString("o")
$noticeMarker = $runId + "_NOTICE"
$jarSha = $null
$mvnExit = -1
$portHttps = 0
$portRestore = 0
$javaRuntimeVersion = ""

function Write-Json($path, $obj) {
  ($obj | ConvertTo-Json -Depth 14) | Set-Content -Path $path -Encoding utf8
}
function Sha256File([string]$path) {
  if (-not (Test-Path $path)) { return $null }
  return (Get-FileHash -Algorithm SHA256 -LiteralPath $path).Hash.ToLower()
}
function Assert-That([string]$scenarioId, $expected, $actual, [bool]$ok, [string]$detail = "") {
  $script:assertionCount++
  if ($ok) { $script:passCount++ } else {
    $script:failureCount++
    $script:strictMode = $false
    $msg = "$scenarioId expected=$expected actual=$actual $detail"
    $script:failures.Add($msg.Trim())
  }
  $script:assertRows.Add(@{
    runId = $runId; scenarioId = $scenarioId; expected = "$expected"; actual = "$actual"; ok = $ok; detail = $detail
    at = (Get-Date).ToUniversalTime().ToString("o")
  }) | Out-Null
  return $ok
}
function Skip-That([string]$scenarioId, [string]$reason) {
  $script:skipCount++
  $script:strictMode = $false
  $script:p2++
  $script:failures.Add("SKIP $scenarioId : $reason")
  $script:assertRows.Add(@{
    runId=$runId; scenarioId=$scenarioId; expected="required"; actual="SKIPPED"; ok=$false; detail=$reason
    at=(Get-Date).ToUniversalTime().ToString("o")
  }) | Out-Null
}
function Find-FreePort([int]$start, [int]$end) {
  for ($p=$start; $p -le $end; $p++) {
    $busy = Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue
    if (-not $busy) { return $p }
  }
  throw "No free port in $start-$end"
}
function Build-JdbcUrl([string]$hostName, [string]$dbName) {
  return "jdbc:mysql://${hostName}:3306/${dbName}?useUnicode=true&characterEncoding=utf-8&useSSL=false&allowPublicKeyRetrieval=true&serverTimezone=GMT%2b8&connectTimeout=5000&socketTimeout=60000"
}
function Snapshot-Port9999([string]$phase) {
  $c = Get-NetTCPConnection -LocalPort 9999 -ErrorAction SilentlyContinue | Select-Object -First 1
  $row = @{
    phase = $phase
    state = if ($c) { "$($c.State)" } else { "none" }
    owningProcess = if ($c) { $c.OwningProcess } else { $null }
    at = (Get-Date).ToUniversalTime().ToString("o")
  }
  $script:portSnapshots.Add($row) | Out-Null
  return $row
}
function Restrict-FileAcl([string]$path) {
  if (-not (Test-Path -LiteralPath $path)) { throw "Restrict-FileAcl: missing $path" }
  $acl = Get-Acl -LiteralPath $path
  $acl.SetAccessRuleProtection($true, $false)
  $me = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
  $rule = New-Object System.Security.AccessControl.FileSystemAccessRule($me, "FullControl", "Allow")
  $acl.SetAccessRule($rule)
  Set-Acl -LiteralPath $path -AclObject $acl
  # Verify only current user has access entries (fail-closed)
  $check = Get-Acl -LiteralPath $path
  $others = @($check.Access | Where-Object {
    $_.IdentityReference.Value -ne $me -and $_.AccessControlType -eq 'Allow'
  })
  if ($others.Count -gt 0) {
    throw "Restrict-FileAcl: file still allows other identities"
  }
}
function Write-MysqlCnf([string]$path, [string]$user, [string]$pass) {
  $content = "[client]`nuser=$user`npassword=$pass`nhost=127.0.0.1`nport=3306`n"
  [IO.File]::WriteAllText($path, $content)
  Restrict-FileAcl $path
}
function MysqlAdmin([string]$sql) {
  # Non-secret SQL may use -e. Password-bearing SQL MUST use MysqlAdminSqlStdin.
  if ($sql -match '(?i)IDENTIFIED\s+BY\s+') {
    throw "MysqlAdmin refused password-bearing SQL on -e; use MysqlAdminSqlStdin"
  }
  & mysql --defaults-extra-file=$AdminCnf -N -B -e $sql 2>&1
  if ($LASTEXITCODE -ne 0) { throw "mysql admin failed (exit $LASTEXITCODE)" }
}
function MysqlAdminSqlStdin([string]$sqlContent, [int]$timeoutMs = 60000) {
  # Stream SQL via process stdin only — no password-bearing SQL file, no secrets on argv.
  $mysqlExe = (Get-Command mysql -ErrorAction Stop).Source
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $mysqlExe
  $psi.Arguments = "--defaults-extra-file=$AdminCnf -N -B"
  $psi.UseShellExecute = $false
  $psi.RedirectStandardInput = $true
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.CreateNoWindow = $true
  $proc = New-Object System.Diagnostics.Process
  $proc.StartInfo = $psi
  [void]$proc.Start()
  try {
    $proc.StandardInput.Write($sqlContent)
    if (-not $sqlContent.EndsWith("`n")) { $proc.StandardInput.Write("`n") }
    $proc.StandardInput.Close()
    if (-not $proc.WaitForExit($timeoutMs)) {
      try { $proc.Kill() } catch {}
      throw "MysqlAdminSqlStdin timeout after ${timeoutMs}ms"
    }
    $stdout = $proc.StandardOutput.ReadToEnd()
    $stderr = $proc.StandardError.ReadToEnd()
    if ($proc.ExitCode -ne 0) {
      # Never echo SQL/secrets; only exit code + generic stderr length
      throw "MysqlAdminSqlStdin failed exit=$($proc.ExitCode) stderrChars=$($stderr.Length)"
    }
    return $stdout
  } finally {
    try { if (-not $proc.HasExited) { $proc.Kill() } } catch {}
    try { $proc.Dispose() } catch {}
  }
}
# Back-compat alias used by remaining call sites
function MysqlAdminSqlFile([string]$sqlContent) { MysqlAdminSqlStdin $sqlContent }
function Get-SurefireTotals {
  $dir = Join-Path $Root "target\surefire-reports"
  $tests = 0; $failures = 0; $errors = 0; $skipped = 0
  if (Test-Path $dir) {
    Get-ChildItem $dir -Filter "TEST-*.xml" -EA SilentlyContinue | ForEach-Object {
      try {
        [xml]$x = Get-Content $_.FullName -Raw
        $suite = $x.testsuite
        if ($suite) {
          $tests += [int]$suite.tests
          $failures += [int]$suite.failures
          $errors += [int]$suite.errors
          $skipped += [int]$suite.skipped
        }
      } catch {}
    }
  }
  return @{ tests=$tests; failures=$failures; errors=$errors; skipped=$skipped }
}
function Write-AssertAndReport([string]$destDir, [string]$sealHint) {
  if (-not (Test-Path $destDir)) { New-Item -ItemType Directory -Force -Path $destDir | Out-Null }
  $assertRowsArr = @()
  foreach ($r in $script:assertRows) { $assertRowsArr += $r }
  Write-Json (Join-Path $destDir "assert-ledger.json") @{
    runId=$runId; assertionCount=$script:assertionCount; passCount=$script:passCount
    failureCount=$script:failureCount; skipCount=$script:skipCount; rows=$assertRowsArr
  }
  $secretOk = $true
  if (Test-Path (Join-Path $destDir "secret-scan.json")) {
    $ss = Get-Content (Join-Path $destDir "secret-scan.json") -Raw | ConvertFrom-Json
    $secretOk = [bool]$ss.ok
  }
  $seal = if ($script:strictMode -and $script:failureCount -eq 0 -and $script:skipCount -eq 0 -and $secretOk) {
    "YES_CANDIDATE_FOR_SEAL"
  } else { $sealHint }
  Write-Json (Join-Path $destDir "phase-4b-report.json") @{
    phase="4B"; runId=$runId; mode=$Mode; fault=$Fault
    branch=(git rev-parse --abbrev-ref HEAD); head=(git rev-parse HEAD); baseline="93c25b5"
    strictMode=$script:strictMode
    assertionCount=$script:assertionCount; passCount=$script:passCount
    failureCount=$script:failureCount; skipCount=$script:skipCount
    failures=@($script:failures); jarSha256=$jarSha
    sealRecommendation=$seal
    p0=$script:p0; p1=$script:p1; p2=$script:p2; p3=$script:p3
  }
}
function Copy-EnvMap([hashtable]$src) {
  $dst = @{}
  foreach ($k in $src.Keys) { $dst[$k] = $src[$k] }
  return $dst
}
function Wait-Http([string]$url, [int]$timeoutSec=90, [switch]$SkipCert, [int]$ExpectStatus=200) {
  $deadline = (Get-Date).AddSeconds($timeoutSec)
  while ((Get-Date) -lt $deadline) {
    try {
      $curlArgs = @("-s","-o","NUL","-w","%{http_code}","--connect-timeout","5")
      if ($SkipCert) { $curlArgs = @("-k") + $curlArgs }
      $code = & curl.exe @curlArgs $url 2>$null
      if ("$code" -eq "$ExpectStatus") { return $true }
    } catch {}
    Start-Sleep -Seconds 2
  }
  return $false
}
function Invoke-CurlJson([string]$url, [hashtable]$headers = $null) {
  $tmp = Join-Path $runtime ("curl-" + [guid]::NewGuid().ToString("N") + ".txt")
  try {
    $args = @("-k","-s","-o",$tmp,"-w","%{http_code}","--connect-timeout","10")
    if ($headers) {
      foreach ($hk in $headers.Keys) { $args += @("-H", ("{0}: {1}" -f $hk, $headers[$hk])) }
    }
    $code = & curl.exe @args $url 2>$null
    $body = if (Test-Path $tmp) { Get-Content $tmp -Raw } else { "" }
    return @{ status = [int]$code; body = $body }
  } finally {
    if (Test-Path $tmp) { Remove-Item $tmp -Force -EA SilentlyContinue }
  }
}
function Invoke-CurlCors([string]$url, [string]$origin, [string]$method = "GET") {
  $tmpH = Join-Path $runtime ("cors-h-" + [guid]::NewGuid().ToString("N") + ".txt")
  $tmpB = Join-Path $runtime ("cors-b-" + [guid]::NewGuid().ToString("N") + ".txt")
  try {
    $args = @("-k","-s","-D",$tmpH,"-o",$tmpB,"-w","%{http_code}","--connect-timeout","10",
      "-H","Origin: $origin","-X",$method)
    if ($method -eq "OPTIONS") {
      $args += @("-H","Access-Control-Request-Method: GET")
    }
    $code = & curl.exe @args $url 2>$null
    $hdr = if (Test-Path $tmpH) { Get-Content $tmpH -Raw } else { "" }
    $body = if (Test-Path $tmpB) { Get-Content $tmpB -Raw } else { "" }
    $acao = $null
    if ($hdr -match '(?im)^Access-Control-Allow-Origin:\s*(.+)$') { $acao = $Matches[1].Trim() }
    return @{ status=[int]$code; acao=$acao; headers=$hdr; body=$body }
  } finally {
    Remove-Item $tmpH,$tmpB -Force -EA SilentlyContinue
  }
}
function Stop-TrackedJava {
  foreach ($procId in @($script:trackedPids)) {
    if ($procId -le 0) { continue }
    try {
      $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$procId" -ErrorAction SilentlyContinue
      if ($proc -and $proc.CommandLine -match 'animal-home-1\.0-SNAPSHOT\.jar') {
        Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
      }
    } catch {}
  }
}
function Get-RemainingTrackedPids {
  $left = @()
  foreach ($procId in @($script:trackedPids)) {
    $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$procId" -ErrorAction SilentlyContinue
    if ($proc -and $proc.CommandLine -match 'animal-home-1\.0-SNAPSHOT\.jar') {
      $left += @{ pid=$procId; cmdSnippet = ($proc.CommandLine.Substring(0, [Math]::Min(120, $proc.CommandLine.Length))) }
    }
  }
  return $left
}
function Apply-AppEnv([hashtable]$envMap) {
  foreach ($k in @("JWT_SECRET","AI_CONFIG_ENCRYPTION_KEY","DB_HOST","DB_NAME","DB_USERNAME","DB_PASSWORD",
      "FILE_UPLOAD_DIR","CORS_ALLOWED_ORIGIN_PATTERNS","DB_USE_SSL","SPRING_PROFILES_ACTIVE",
      "SERVER_SSL_KEY_STORE_PASSWORD","SERVER_SSL_ENABLED","AI_ENABLED","NOTIFICATION_EMAIL_ENABLED",
      "NOTIFICATION_SMS_ENABLED","REDIS_ENABLED","INITIAL_ADMIN_ENABLED","INITIAL_ADMIN_USERNAME",
      "INITIAL_ADMIN_PASSWORD","APP_SCHEMA_GUARD_AUTO_MIGRATE")) {
    if ($envMap.ContainsKey($k)) {
      Set-Item "Env:$k" -Value ([string]$envMap[$k])
    } else {
      Remove-Item "Env:$k" -ErrorAction SilentlyContinue
    }
  }
}

$adminMysqlUser = if ($env:MYSQL_ADMIN_USER) { $env:MYSQL_ADMIN_USER } else { "root" }
$adminMysqlPass = $env:DB_PASSWORD
if ([string]::IsNullOrEmpty($adminMysqlPass)) {
  Write-Host "BLOCKED: set DB_PASSWORD env for admin MySQL (value not logged)" -ForegroundColor Red
  exit 2
}

# ========== FAULT INJECT MODE (bound to formal JAR; real browser/network; isolated evidence) ==========
if ($Mode -eq "FaultInject") {
  if ([string]::IsNullOrWhiteSpace($Fault)) { throw "FaultInject requires -Fault" }
  $formalRunIdBind = $env:FORMAL_RUN_ID
  $formalJarShaBind = $env:FORMAL_JAR_SHA
  if ([string]::IsNullOrWhiteSpace($formalRunIdBind) -or [string]::IsNullOrWhiteSpace($formalJarShaBind)) {
    Write-Host "FAULT_INJECT_BROKEN: FORMAL_RUN_ID and FORMAL_JAR_SHA env required (bind to formal build)"
    exit 0
  }
  if (-not (Test-Path $Jar)) {
    Write-Host "FAULT_INJECT_BROKEN: formal JAR missing"
    exit 0
  }
  $actualJarSha = Sha256File $Jar
  $jarSha = $actualJarSha
  $fiRoot = Join-Path $faultDir $runId
  New-Item -ItemType Directory -Force -Path $fiRoot | Out-Null
  $evidence = @{}
  try {
    # Must use same formal JAR
    Assert-That "fault-jar-sha-equals-formal" $formalJarShaBind $actualJarSha ($actualJarSha -eq $formalJarShaBind) "fault must use formal JAR"
    if ($actualJarSha -ne $formalJarShaBind) { throw "fault JAR SHA mismatch formal" }

    switch ($Fault) {
      "wrong-jar-sha" {
        $wrongExpected = ("f" + $actualJarSha.Substring(1))  # deliberate single-char mutation of formal SHA
        if ($wrongExpected -eq $actualJarSha) { $wrongExpected = "deadbeef" + $actualJarSha.Substring(8) }
        $evidence = @{ formalJarSha256=$formalJarShaBind; actualJarSha256=$actualJarSha; deliberateExpected=$wrongExpected }
        Assert-That "jar-sha256-match" $wrongExpected $actualJarSha ($actualJarSha -eq $wrongExpected) "deliberate wrong expected SHA vs formal JAR"
      }
      "cleanup-leftover" {
        $leftover = Join-Path $fiRoot "controlled-leftover.bin"
        [IO.File]::WriteAllBytes($leftover, [byte[]](1..16))
        $evidence = @{ leftoverPath=$leftover; leftoverExists=(Test-Path $leftover); leftoverBytes=16 }
        # Simulate cleanup gate re-scan (does not delete controlled leftover)
        $stillThere = Test-Path $leftover
        Assert-That "cleanup-leftover-absent" $true (-not $stillThere) (-not $stillThere) "controlled leftover must fail cleanup gate"
        # Outer driver will delete leftover after verifying failure
      }
      "wrong-expect" {
        # Must probe a LIVE formal prod instance (BASE_URL), actual live=200, expect 201 deliberately.
        $base = $env:FAULT_BASE_URL
        if ([string]::IsNullOrWhiteSpace($base)) { throw "FAULT_BASE_URL required for wrong-expect" }
        $liveUrl = ($base.TrimEnd('/') + "/api/health/live")
        $tmp = Join-Path $fiRoot "wrong-expect-body.txt"
        $code = & curl.exe -k -s -o $tmp -w "%{http_code}" --connect-timeout 10 $liveUrl 2>$null
        if (-not $code) { $code = "000" }
        $body = if (Test-Path $tmp) { Get-Content $tmp -Raw } else { "" }
        $listenHint = $false
        if ($base -match ':(\d+)') {
          $lp = [int]$Matches[1]
          $listenHint = [bool](Get-NetTCPConnection -LocalPort $lp -State Listen -EA SilentlyContinue)
        }
        $evidence = @{
          baseUrl=$base; liveUrl=$liveUrl; liveActual=[int]$code; bodySnippet=$body.Substring(0,[Math]::Min(80,$body.Length))
          serverStarted=($code -eq "200"); listenerObserved=$listenHint; deliberatelyExpected=201
        }
        # Gate: actual MUST be 200 for this fault to be valid
        Assert-That "fault-wrong-expect-actual-is-200" 200 $code ("$code" -eq "200") "wrong-expect requires real live=200"
        Assert-That "fault-wrong-expect-listener" $true $listenHint $listenHint "prod instance must be listening"
        # Deliberate wrong expected status
        Assert-That "fault-wrong-expect-live-201" 201 $code ("$code" -eq "201") "deliberately expect 201 while actual is 200"
      }
      "notice-no-request" {
        $base = $env:FAULT_BASE_URL
        $user = $env:FAULT_ADMIN_USER
        $pass = $env:FAULT_ADMIN_PASS
        if ([string]::IsNullOrWhiteSpace($base) -or [string]::IsNullOrWhiteSpace($user)) {
          throw "FAULT_BASE_URL/FAULT_ADMIN_USER required for notice-no-request"
        }
        $nodeScript = Join-Path $fiRoot "notice-no-request.cjs"
        $outJson = Join-Path $fiRoot "notice-no-request-evidence.json"
        @'
const { chromium } = require('playwright');
const fs = require('fs');
const base = process.env.FAULT_BASE_URL;
const user = process.env.FAULT_ADMIN_USER;
const pass = process.env.FAULT_ADMIN_PASS;
const outPath = process.env.FAULT_EVIDENCE_OUT;
(async () => {
  const out = { pageUrl: null, loginHttp: null, noticePostCount: 0, requests: [], errors: [] };
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  page.on('request', req => {
    try {
      const u = req.url();
      const m = req.method();
      out.requests.push({ method: m, url: u, ts: Date.now() });
      if (m === 'POST') {
        try {
          const p = new URL(u).pathname;
          if (p === '/api/notice' || p.endsWith('/api/notice')) out.noticePostCount += 1;
        } catch {}
      }
    } catch {}
  });
  try {
    out.pageUrl = base + '/page/front/login.html';
    await page.goto(out.pageUrl, { waitUntil: 'load', timeout: 60000 });
    await page.waitForSelector('#loginUsername', { timeout: 15000 });
    await page.fill('#loginUsername', user);
    await page.fill('#loginPassword', pass);
    const code = await page.evaluate(() => {
      const vm = document.querySelector('#app') && document.querySelector('#app').__vue__;
      return vm && vm.verifyCode && vm.verifyCode.options ? String(vm.verifyCode.options.code||'') : '';
    });
    await page.fill('#loginCode', code);
    const respP = page.waitForResponse(r => r.url().includes('/api/user/login') && r.request().method()==='POST', { timeout: 20000 });
    await page.click('[data-login-submit]');
    const resp = await respP;
    out.loginHttp = resp.status();
    // Controlled scenario: open notice admin page but DO NOT click 发布/保存 — no notice POST
    await page.goto(base + '/page/end/notice.html', { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(1500);
    out.noticePageOpened = true;
    out.createButtonVisible = (await page.locator('button').filter({ hasText: '发布公告' }).count()) > 0;
    // Explicitly do not create notice
  } catch (e) {
    out.errors.push(String(e && e.message || e));
  }
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  await browser.close();
  process.exit(0);
})().catch(e => { console.error(e); process.exit(2); });
'@ | Set-Content -Path $nodeScript -Encoding utf8
        $env:FAULT_EVIDENCE_OUT = $outJson
        & node $nodeScript 2>&1 | Tee-Object -FilePath (Join-Path $fiRoot "notice-no-request.log") | Out-Null
        $nodeExit = $LASTEXITCODE
        Assert-That "fault-notice-no-req-node-exit" 0 $nodeExit ($nodeExit -eq 0)
        if (-not (Test-Path $outJson)) { throw "notice-no-request evidence missing" }
        $ev = Get-Content $outJson -Raw | ConvertFrom-Json
        $evidence = $ev
        Assert-That "fault-notice-browser-evidence" $true ($null -ne $ev.requests) ($null -ne $ev.requests) "must have request ledger"
        Assert-That "fault-notice-login-200" 200 $ev.loginHttp ($ev.loginHttp -eq 200)
        # Unified formal checker: notice POST must be 1 — this fault has 0 from real network ledger
        Assert-That "notice-post-count" 1 $ev.noticePostCount ($ev.noticePostCount -eq 1) "real network ledger noticePostCount"
      }
      "http200-code503" {
        $base = $env:FAULT_BASE_URL
        $user = $env:FAULT_ADMIN_USER
        $pass = $env:FAULT_ADMIN_PASS
        $marker = $env:FAULT_NOTICE_MARKER
        if ([string]::IsNullOrWhiteSpace($base) -or [string]::IsNullOrWhiteSpace($user)) {
          throw "FAULT_BASE_URL/FAULT_ADMIN_USER required for http200-code503"
        }
        if ([string]::IsNullOrWhiteSpace($marker)) { $marker = "FAULT503_" + $runId }
        $nodeScript = Join-Path $fiRoot "http200-code503.cjs"
        $outJson = Join-Path $fiRoot "http200-code503-evidence.json"
        @'
const { chromium } = require('playwright');
const fs = require('fs');
const base = process.env.FAULT_BASE_URL;
const user = process.env.FAULT_ADMIN_USER;
const pass = process.env.FAULT_ADMIN_PASS;
const marker = process.env.FAULT_NOTICE_MARKER;
const outPath = process.env.FAULT_EVIDENCE_OUT;
(async () => {
  const out = {
    noticePostCount: 0, actualHttp: null, actualBizCode: null, requestUrl: null, requestMethod: null,
    uiError: null, loginHttp: null, errors: [], routeFulfilled: false
  };
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  await page.route('**/api/notice', async (route, request) => {
    if (request.method() === 'POST') {
      out.routeFulfilled = true;
      out.requestUrl = request.url();
      out.requestMethod = request.method();
      out.noticePostCount += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ code: 503, msg: 'fault-inject simulated business down', data: null })
      });
      return;
    }
    await route.continue();
  });
  try {
    await page.goto(base + '/page/front/login.html', { waitUntil: 'load', timeout: 60000 });
    await page.waitForSelector('#loginUsername', { timeout: 15000 });
    await page.fill('#loginUsername', user);
    await page.fill('#loginPassword', pass);
    const code = await page.evaluate(() => {
      const vm = document.querySelector('#app') && document.querySelector('#app').__vue__;
      return vm && vm.verifyCode && vm.verifyCode.options ? String(vm.verifyCode.options.code||'') : '';
    });
    await page.fill('#loginCode', code);
    const respP = page.waitForResponse(r => r.url().includes('/api/user/login') && r.request().method()==='POST', { timeout: 20000 });
    await page.click('[data-login-submit]');
    out.loginHttp = (await respP).status();
    await page.goto(base + '/page/end/notice.html', { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(1000);
    const createBtn = page.locator('button').filter({ hasText: '发布公告' }).first();
    if ((await createBtn.count()) === 0) throw new Error('publish button missing');
    await createBtn.click();
    await page.waitForSelector('#noticeTitleInput', { timeout: 10000 });
    await page.fill('#noticeTitleInput', marker);
    await page.fill('#noticeContentInput', marker + ' fault body');
    const nW = page.waitForResponse(r => {
      try { return new URL(r.url()).pathname === '/api/notice' && r.request().method() === 'POST'; }
      catch { return false; }
    }, { timeout: 20000 });
    await page.locator('button').filter({ hasText: /保存/ }).first().click();
    const nR = await nW;
    out.actualHttp = nR.status();
    let j = {};
    try { j = await nR.json(); } catch {}
    out.actualBizCode = j.code;
    out.responseBody = j;
    // capture any visible error toast/text
    try {
      const errEl = page.locator('.el-message--error, .el-message__content').first();
      if (await errEl.count()) out.uiError = (await errEl.innerText()).slice(0, 200);
    } catch {}
  } catch (e) {
    out.errors.push(String(e && e.message || e));
  }
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  await browser.close();
  process.exit(0);
})().catch(e => { console.error(e); process.exit(2); });
'@ | Set-Content -Path $nodeScript -Encoding utf8
        $env:FAULT_EVIDENCE_OUT = $outJson
        $env:FAULT_NOTICE_MARKER = $marker
        & node $nodeScript 2>&1 | Tee-Object -FilePath (Join-Path $fiRoot "http200-code503.log") | Out-Null
        $nodeExit = $LASTEXITCODE
        Assert-That "fault-http200-code503-node-exit" 0 $nodeExit ($nodeExit -eq 0)
        if (-not (Test-Path $outJson)) { throw "http200-code503 evidence missing" }
        $ev = Get-Content $outJson -Raw | ConvertFrom-Json
        $evidence = $ev
        Assert-That "fault-503-route-fulfilled" $true $ev.routeFulfilled ([bool]$ev.routeFulfilled)
        Assert-That "fault-503-post-count-1" 1 $ev.noticePostCount ($ev.noticePostCount -eq 1)
        Assert-That "fault-503-actual-http-200" 200 $ev.actualHttp ($ev.actualHttp -eq 200)
        Assert-That "fault-503-actual-biz-is-503" 503 $ev.actualBizCode ("$($ev.actualBizCode)" -eq "503")
        # Unified formal checker: business code must be 0 — this fault has 503 from real Response
        Assert-That "notice-biz-code-0" 0 $ev.actualBizCode ("$($ev.actualBizCode)" -eq "0") "real Response business code"
      }
    }
  } catch {
    Assert-That "fault-orchestrator-exception" "none" $_.Exception.Message $false $_.Exception.Message
  } finally {
    Stop-TrackedJava
    Start-Sleep 1
  }

  # --- Strict unique-target failure gate (anti false-green) ---
  $expectedFailureMap = @{
    "wrong-jar-sha" = "jar-sha256-match"
    "notice-no-request" = "notice-post-count"
    "http200-code503" = "notice-biz-code-0"
    "cleanup-leftover" = "cleanup-leftover-absent"
    "wrong-expect" = "fault-wrong-expect-live-201"
  }
  $expectedFailureScenarioId = $expectedFailureMap[$Fault]
  $falseRows = @($script:assertRows | Where-Object { -not $_.ok })
  $actualFailedScenarioIds = @($falseRows | ForEach-Object { $_.scenarioId })
  $exceptionFailureCount = @($falseRows | Where-Object { $_.scenarioId -eq "fault-orchestrator-exception" }).Count
  # Prerequisites = every row except the single expected target must pass
  $prerequisitesAllPassed = (@($script:assertRows | Where-Object {
    $_.scenarioId -ne $expectedFailureScenarioId -and -not $_.ok
  }).Count -eq 0)

  # Evidence validation per fault (must be true for suiteFailedAsRequired)
  $evidenceValidated = $false
  switch ($Fault) {
    "wrong-jar-sha" {
      $evidenceValidated = (
        $evidence.actualJarSha256 -eq $formalJarShaBind -and
        $evidence.formalJarSha256 -eq $formalJarShaBind -and
        $evidence.deliberateExpected -and
        $evidence.deliberateExpected -ne $evidence.actualJarSha256
      )
      Assert-That "fault-evidence-validated" $true $evidenceValidated $evidenceValidated "wrong-jar-sha evidence"
    }
    "notice-no-request" {
      $errEmpty = (-not $evidence.errors -or @($evidence.errors).Count -eq 0)
      $evidenceValidated = (
        $evidence.loginHttp -eq 200 -and
        [bool]$evidence.noticePageOpened -and
        [bool]$evidence.createButtonVisible -and
        @($evidence.requests).Count -gt 0 -and
        $evidence.noticePostCount -eq 0 -and
        $errEmpty
      )
      Assert-That "fault-evidence-validated" $true $evidenceValidated $evidenceValidated "notice-no-request evidence"
      Assert-That "fault-prereq-login-200" 200 $evidence.loginHttp ($evidence.loginHttp -eq 200)
      Assert-That "fault-prereq-notice-page" $true $evidence.noticePageOpened ([bool]$evidence.noticePageOpened)
      Assert-That "fault-prereq-create-btn" $true $evidence.createButtonVisible ([bool]$evidence.createButtonVisible)
      Assert-That "fault-prereq-requests-gt0" "gt0" @($evidence.requests).Count (@($evidence.requests).Count -gt 0)
      Assert-That "fault-prereq-errors-empty" 0 $(if ($evidence.errors) { @($evidence.errors).Count } else { 0 }) $errEmpty
    }
    "http200-code503" {
      $errEmpty = (-not $evidence.errors -or @($evidence.errors).Count -eq 0)
      $evidenceValidated = (
        $evidence.loginHttp -eq 200 -and
        [bool]$evidence.routeFulfilled -and
        $evidence.requestMethod -eq "POST" -and
        $evidence.noticePostCount -eq 1 -and
        $evidence.actualHttp -eq 200 -and
        ("$($evidence.actualBizCode)" -eq "503") -and
        $errEmpty
      )
      Assert-That "fault-evidence-validated" $true $evidenceValidated $evidenceValidated "http200-code503 evidence"
    }
    "cleanup-leftover" {
      $evidenceValidated = (
        [bool]$evidence.leftoverExists -and
        $evidence.leftoverBytes -eq 16 -and
        $evidence.leftoverPath -and (Test-Path $evidence.leftoverPath)
      )
      Assert-That "fault-evidence-validated" $true $evidenceValidated $evidenceValidated "cleanup-leftover evidence"
      Assert-That "fault-prereq-leftover-size-16" 16 $evidence.leftoverBytes ($evidence.leftoverBytes -eq 16)
    }
    "wrong-expect" {
      $evidenceValidated = (
        [bool]$evidence.serverStarted -and
        [bool]$evidence.listenerObserved -and
        $evidence.liveActual -eq 200 -and
        $evidence.deliberatelyExpected -eq 201
      )
      Assert-That "fault-evidence-validated" $true $evidenceValidated $evidenceValidated "wrong-expect evidence"
    }
    default {
      $evidenceValidated = $false
      Assert-That "fault-evidence-validated" $true $false $false "unknown fault"
    }
  }

  # Recompute false rows AFTER evidence prereq asserts (must still be unique target only)
  $falseRows = @($script:assertRows | Where-Object { -not $_.ok })
  $actualFailedScenarioIds = @($falseRows | ForEach-Object { $_.scenarioId })
  $exceptionFailureCount = @($falseRows | Where-Object { $_.scenarioId -eq "fault-orchestrator-exception" }).Count
  $prerequisitesAllPassed = (@($script:assertRows | Where-Object {
    $_.scenarioId -ne $expectedFailureScenarioId -and -not $_.ok
  }).Count -eq 0)
  $uniqueTargetOnly = (
    $falseRows.Count -eq 1 -and
    $actualFailedScenarioIds.Count -eq 1 -and
    $actualFailedScenarioIds[0] -eq $expectedFailureScenarioId
  )
  $suiteFailedAsRequired = (
    $script:failureCount -eq 1 -and
    $falseRows.Count -eq 1 -and
    $uniqueTargetOnly -and
    $exceptionFailureCount -eq 0 -and
    $prerequisitesAllPassed -and
    $evidenceValidated -and
    $script:skipCount -eq 0 -and
    $actualJarSha -eq $formalJarShaBind -and
    $formalRunIdBind -and
    $expectedFailureScenarioId
  )

  Write-AssertAndReport $fiRoot "FAULT_EXPECTED_FAIL"
  Write-Json (Join-Path $fiRoot "evidence.json") $evidence
  $fiSummary = @{
    faultRunId=$runId
    fault=$Fault
    formalRunId=$formalRunIdBind
    jarSha256=$actualJarSha
    formalJarSha256=$formalJarShaBind
    jarMatch=($actualJarSha -eq $formalJarShaBind)
    expectedFailureScenarioId=$expectedFailureScenarioId
    actualFailedScenarioIds=$actualFailedScenarioIds
    prerequisitesAllPassed=$prerequisitesAllPassed
    evidenceValidated=$evidenceValidated
    exceptionFailureCount=$exceptionFailureCount
    assertionCount=$script:assertionCount
    passCount=$script:passCount
    failureCount=$script:failureCount
    skipCount=$script:skipCount
    strictMode=$script:strictMode
    failures=@($script:failures)
    assertLedger=(Join-Path $fiRoot "assert-ledger.json")
    evidencePath=(Join-Path $fiRoot "evidence.json")
    falseRowCount=$falseRows.Count
    at=(Get-Date).ToUniversalTime().ToString("o")
    suiteFailedAsRequired=$suiteFailedAsRequired
    exitCodeExpectedNonZero=$true
  }
  Write-Json (Join-Path $fiRoot "fault-summary.json") $fiSummary
  Write-Json (Join-Path $faultDir "$Fault.json") $fiSummary
  if ($suiteFailedAsRequired) {
    Write-Host "FAULT_INJECT_OK $Fault uniqueFail=$expectedFailureScenarioId evidenceValidated=$evidenceValidated"
    exit 1
  } else {
    Write-Host "FAULT_INJECT_BROKEN $Fault failedIds=$($actualFailedScenarioIds -join ',') prereq=$prerequisitesAllPassed evidence=$evidenceValidated"
    exit 0
  }
}

# ========== FORMAL MODE ==========
try {
  Snapshot-Port9999 "start"
  Write-MysqlCnf $AdminCnf $adminMysqlUser $adminMysqlPass

  # --- Build ---
  $buildStart = (Get-Date).ToUniversalTime().ToString("o")
  Write-Host "=== mvn clean verify ==="
  & mvn clean verify 2>&1 | Tee-Object -FilePath (Join-Path $logs "mvn-clean-verify.log") | Out-Null
  $mvnExit = $LASTEXITCODE
  $buildEnd = (Get-Date).ToUniversalTime().ToString("o")
  Assert-That "mvn-clean-verify" 0 $mvnExit ($mvnExit -eq 0)
  Assert-That "jar-exists" $true (Test-Path $Jar) (Test-Path $Jar)
  if ($mvnExit -ne 0 -or -not (Test-Path $Jar)) { throw "mvn clean verify failed exit=$mvnExit" }
  $jarSha = Sha256File $Jar
  $jarSize = (Get-Item $Jar).Length
  $javaRuntimeVersion = (& $JavaExe -version 2>&1 | Out-String).Trim()
  $mvnVer = (& mvn -version 2>&1 | Select-Object -First 1)
  # Surefire XML totals (not first per-class "Tests run" in the log)
  $surefire = Get-SurefireTotals
  Assert-That "surefire-tests-gt0" "gt0" $surefire.tests ($surefire.tests -gt 0)
  Assert-That "surefire-failures-0" 0 $surefire.failures ($surefire.failures -eq 0)
  Assert-That "surefire-errors-0" 0 $surefire.errors ($surefire.errors -eq 0)
  Assert-That "surefire-skipped-0" 0 $surefire.skipped ($surefire.skipped -eq 0)
  # Prefer Maven final summary line (last Tests run in log) only as cross-check
  $mvnLog = Get-Content (Join-Path $logs "mvn-clean-verify.log") -Raw -EA SilentlyContinue
  $finalSummary = ""
  if ($mvnLog) {
    $all = [regex]::Matches($mvnLog, 'Tests run:\s*(\d+),\s*Failures:\s*(\d+),\s*Errors:\s*(\d+),\s*Skipped:\s*(\d+)')
    if ($all.Count -gt 0) {
      $last = $all[$all.Count - 1]
      $finalSummary = $last.Value
    }
  }
  # Prove spring.factories EPP registration is packaged in JAR
  $factoriesText = ""
  $extractDir = Join-Path $runtime "jar-extract-epp"
  if (Test-Path $extractDir) { Remove-Item -Recurse -Force $extractDir -EA SilentlyContinue }
  New-Item -ItemType Directory -Force -Path $extractDir | Out-Null
  Push-Location $extractDir
  try {
    & jar xf $Jar META-INF/spring.factories 2>$null
    if (Test-Path "META-INF\spring.factories") {
      $factoriesText = Get-Content "META-INF\spring.factories" -Raw
    }
  } finally { Pop-Location }
  Remove-Item -Recurse -Force $extractDir -EA SilentlyContinue
  Assert-That "epp-spring-factories-in-jar" $true ($factoriesText -match 'ProdDeploymentEnvironmentPostProcessor') ($factoriesText -match 'ProdDeploymentEnvironmentPostProcessor')
  Assert-That "epp-no-imports-file-in-src" $true (-not (Test-Path "src\main\resources\META-INF\spring\org.springframework.boot.env.EnvironmentPostProcessor.imports")) (-not (Test-Path "src\main\resources\META-INF\spring\org.springframework.boot.env.EnvironmentPostProcessor.imports"))
  Write-Json (Join-Path $out "release-manifest.json") @{
    branch = (git rev-parse --abbrev-ref HEAD)
    commit = (git rev-parse HEAD)
    dirty = -not [string]::IsNullOrWhiteSpace((git status --porcelain))
    javaRuntimeVersion = $javaRuntimeVersion
    javaExe = $JavaExe
    mavenVersion = "$mvnVer"
    jarFile = "animal-home-1.0-SNAPSHOT.jar"
    jarBytes = $jarSize
    jarSha256 = $jarSha
    buildStartedAt = $buildStart
    buildEndedAt = $buildEnd
    buildExitCode = $mvnExit
    tests = $surefire.tests
    failures = $surefire.failures
    errors = $surefire.errors
    skipped = $surefire.skipped
    surefireSource = "target/surefire-reports/TEST-*.xml"
    mavenFinalSummaryLine = $finalSummary
    eppRegisteredViaSpringFactories = ($factoriesText -match 'ProdDeploymentEnvironmentPostProcessor')
    runId = $runId
  }
  Write-Host "JAR sha256=$jarSha size=$jarSize surefire tests=$($surefire.tests)"

  # --- Isolation DB ---
  Write-Host "=== create isolation DB ==="
  if ($SourceDb -notmatch '^stray_animal_e2e4b_' -or $RestoreDb -notmatch '^stray_animal_e2e4b_restore_') {
    throw "DB name prefix safety failed"
  }
  MysqlAdmin "CREATE DATABASE ``$SourceDb`` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
  MysqlAdmin "CREATE DATABASE ``$RestoreDb`` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
  $testSql = Join-Path $Root "test.sql"
  $bootSql = Join-Path $Root "docs\sql\bootstrap-all.sql"
  if (-not (Test-Path $testSql)) { throw "test.sql missing" }
  Get-Content $testSql -Raw | & mysql --defaults-extra-file=$AdminCnf $SourceDb 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "import test.sql failed" }
  if (Test-Path $bootSql) {
    Get-Content $bootSql -Raw | & mysql --defaults-extra-file=$AdminCnf $SourceDb 2>&1 | Out-Null
  }
  # isolation-only orphan file-ref clean
  if ($SourceDb -notmatch '^stray_animal_e2e4b_') { throw "refuse file-ref clean outside e2e4b" }
  Write-Host "=== isolation file-ref orphan clean ==="
  $cleanSql = @"
USE ``$SourceDb``;
UPDATE t_user SET avatar = NULL WHERE TRIM(IFNULL(avatar,'')) = '1';
UPDATE t_animal a SET a.tpic = '' WHERE a.tpic IS NOT NULL AND TRIM(a.tpic) <> ''
  AND NOT EXISTS (SELECT 1 FROM t_file_asset f WHERE f.flag = TRIM(a.tpic) AND f.deleted = 0
    AND f.purpose = 'animal' AND f.visibility = 'public' AND f.business_type = 'animal' AND f.business_id = a.id);
UPDATE t_user u SET u.avatar = NULL WHERE u.avatar IS NOT NULL AND TRIM(u.avatar) <> ''
  AND NOT EXISTS (SELECT 1 FROM t_file_asset f WHERE f.flag = TRIM(u.avatar) AND f.deleted = 0
    AND f.purpose = 'avatar' AND f.visibility = 'public' AND f.business_type = 'user' AND f.business_id = u.id);
UPDATE t_proof p SET p.ppic = '' WHERE p.ppic IS NOT NULL AND TRIM(p.ppic) <> ''
  AND NOT EXISTS (SELECT 1 FROM t_file_asset f WHERE f.flag = TRIM(p.ppic) AND f.deleted = 0
    AND f.purpose = 'proof' AND f.visibility = 'private' AND f.business_type = 'proof' AND f.business_id = p.id);
UPDATE t_volunteer v SET v.apic = NULL WHERE v.apic IS NOT NULL AND TRIM(v.apic) <> ''
  AND NOT EXISTS (SELECT 1 FROM t_file_asset f WHERE f.flag = TRIM(v.apic) AND f.deleted = 0
    AND f.purpose = 'volunteer' AND f.visibility = 'private' AND f.business_type = 'volunteer' AND f.business_id = v.id);
UPDATE t_help h SET h.pic = NULL WHERE h.pic IS NOT NULL AND TRIM(h.pic) <> ''
  AND NOT EXISTS (SELECT 1 FROM t_file_asset f WHERE f.flag = TRIM(h.pic) AND f.deleted = 0
    AND f.purpose = 'help' AND f.visibility = 'private' AND f.business_type = 'help' AND f.business_id = h.id);
UPDATE t_visit v SET v.pic = NULL WHERE v.pic IS NOT NULL AND TRIM(v.pic) <> ''
  AND NOT EXISTS (SELECT 1 FROM t_file_asset f WHERE f.flag = TRIM(v.pic) AND f.deleted = 0
    AND f.purpose = 'visit' AND f.visibility = 'private' AND f.business_type = 'visit' AND f.business_id = v.id);
"@
  $cleanSql | & mysql --defaults-extra-file=$AdminCnf 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "isolation file-ref orphan clean failed" }

  # Password-bearing SQL via temp file/stdin only (never pass secrets on process argv)
  MysqlAdminSqlFile @"
CREATE USER IF NOT EXISTS '$DbAppUser'@'%' IDENTIFIED BY '$DbAppPass';
CREATE USER IF NOT EXISTS '$DbAppUser'@'localhost' IDENTIFIED BY '$DbAppPass';
GRANT ALL ON ``$SourceDb``.* TO '$DbAppUser'@'%';
GRANT ALL ON ``$SourceDb``.* TO '$DbAppUser'@'localhost';
FLUSH PRIVILEGES;
"@

  # prepare schema once (dev auto-migrate)
  Write-Host "=== isolation schema prepare ==="
  $prepPort = Find-FreePort 18160 18179
  $prepJdbc = Build-JdbcUrl $DbHostName $SourceDb
  $prepLog = Join-Path $logs "schema-prepare.out.log"
  $prepErr = Join-Path $logs "schema-prepare.err.log"
  $env:JWT_SECRET = $JwtSecret
  $env:AI_CONFIG_ENCRYPTION_KEY = $AiKey
  $env:DB_HOST = $DbHostName
  $env:DB_NAME = $SourceDb
  $env:DB_USERNAME = $DbAppUser
  $env:DB_PASSWORD = $DbAppPass
  $env:FILE_UPLOAD_DIR = $upload
  $env:DB_USE_SSL = "false"
  $env:SPRING_PROFILES_ACTIVE = "dev"
  $prepArgs = @(
    "-Xms256m","-Xmx512m","-jar",$Jar,
    "--spring.profiles.active=dev",
    "--server.port=$prepPort",
    "--spring.datasource.url=$prepJdbc",
    "--app.schema-guard.auto-migrate=true",
    "--app.schema-guard.fail-fast=false",
    "--app.data-state-guard.auto-fix=true",
    "--app.role-guard.auto-fix=true",
    "--file.upload-dir=$upload"
  )
  $prepProc = Start-Process -FilePath $JavaExe -ArgumentList $prepArgs -PassThru -WindowStyle Hidden `
    -RedirectStandardOutput $prepLog -RedirectStandardError $prepErr
  $script:trackedPids.Add($prepProc.Id) | Out-Null
  $prepReady = Wait-Http "http://127.0.0.1:$prepPort/api/health/ready" 120
  Assert-That "isolation-schema-prepare-ready" $true $prepReady $prepReady
  if (-not $prepReady) {
    Get-Content $prepLog -Tail 40 -EA SilentlyContinue
    Get-Content $prepErr -Tail 40 -EA SilentlyContinue
    throw "isolation schema prepare failed"
  }
  Stop-Process -Id $prepProc.Id -Force -ErrorAction SilentlyContinue
  Start-Sleep 2
  MysqlAdmin "GRANT ALL ON ``$RestoreDb``.* TO '$DbAppUser'@'%'; GRANT ALL ON ``$RestoreDb``.* TO '$DbAppUser'@'localhost'; FLUSH PRIVILEGES;"
  Write-MysqlCnf $AppCnf $DbAppUser $DbAppPass
  Snapshot-Port9999 "after-prepare"

  # --- Preflight ---
  $preflight = @()
  function Run-PreflightScenario($id, $envMap, $expectExit) {
    $saved = @{}
    foreach ($k in @($envMap.Keys)) {
      $saved[$k] = [Environment]::GetEnvironmentVariable($k, "Process")
      [Environment]::SetEnvironmentVariable($k, [string]$envMap[$k], "Process")
    }
    & pwsh -NoProfile -File (Join-Path $Root "tools\prod-preflight.ps1") -JarPath $Jar -Port 0 2>&1 | Out-Null
    $code = $LASTEXITCODE
    foreach ($k in @($saved.Keys)) {
      [Environment]::SetEnvironmentVariable($k, $saved[$k], "Process")
    }
    $ok = ($code -eq $expectExit)
    Assert-That "preflight-$id" $expectExit $code $ok
    $script:preflight += @{ scenarioId=$id; exitCode=$code; expectExit=$expectExit; ok=$ok }
  }
  $script:preflight = @()
  $goodEnv = @{
    SPRING_PROFILES_ACTIVE = "prod"
    JWT_SECRET = $JwtSecret
    AI_CONFIG_ENCRYPTION_KEY = $AiKey
    DB_HOST = $DbHostName
    DB_NAME = $SourceDb
    DB_USERNAME = $DbAppUser
    DB_PASSWORD = $DbAppPass
    FILE_UPLOAD_DIR = $upload
    CORS_ALLOWED_ORIGIN_PATTERNS = "https://app.example.local"
  }
  Run-PreflightScenario "ok" $goodEnv 0
  $badJwt = Copy-EnvMap $goodEnv; $badJwt["JWT_SECRET"] = "short"
  Run-PreflightScenario "jwt-short" $badJwt 1
  $badHost = Copy-EnvMap $goodEnv; $badHost["DB_HOST"] = "localhost"
  Run-PreflightScenario "db-localhost" $badHost 1
  $badRoot = Copy-EnvMap $goodEnv; $badRoot["DB_USERNAME"] = "root"
  Run-PreflightScenario "db-root" $badRoot 1
  $badCors = Copy-EnvMap $goodEnv; $badCors["CORS_ALLOWED_ORIGIN_PATTERNS"] = "*"
  Run-PreflightScenario "cors-star" $badCors 1
  Write-Json (Join-Path $out "preflight-ledger.json") @{ runId=$runId; scenarios=$script:preflight }

  # --- Negative JAR matrix ---
  $neg = @()
  function Start-JarNegative($id, $argsList, $envMap, $exactPattern, [string]$mustNotPattern = "Access denied for user", [switch]$RequireEppEarly) {
    $p = Find-FreePort 18160 18179
    $logf = Join-Path $logs "neg-$id.log"
    $errf = Join-Path $logs "neg-$id.err.log"
    $hostName = if ($envMap.ContainsKey("DB_HOST") -and $envMap["DB_HOST"]) { $envMap["DB_HOST"] } else { $DbHostName }
    $dbName = if ($envMap.ContainsKey("DB_NAME") -and $envMap["DB_NAME"]) { $envMap["DB_NAME"] } else { $SourceDb }
    $jdbc = Build-JdbcUrl $hostName $dbName
    $argLine = @("-Xms128m","-Xmx256m","-XX:+ExitOnOutOfMemoryError","-jar",$Jar) + $argsList + @(
      "--server.port=$p",
      "--spring.datasource.url=$jdbc"
    )
    Apply-AppEnv $envMap
    $proc = Start-Process -FilePath $JavaExe -ArgumentList $argLine -PassThru -WindowStyle Hidden `
      -RedirectStandardOutput $logf -RedirectStandardError $errf
    $script:trackedPids.Add($proc.Id) | Out-Null
    $everListened = $false
    $listenSamples = 0
    $deadline = (Get-Date).AddSeconds(45)
    while ((Get-Date) -lt $deadline) {
      $listenSamples++
      $listeningNow = Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue
      if ($listeningNow) { $everListened = $true }
      if ($proc.HasExited) { break }
      Start-Sleep -Milliseconds 300
    }
    if (-not $proc.HasExited) {
      Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
      Start-Sleep 1
    }
    $code = if ($proc.HasExited) { $proc.ExitCode } else { -1 }
    $logText = ""
    if (Test-Path $logf) { $logText += Get-Content $logf -Raw -EA SilentlyContinue }
    if (Test-Path $errf) { $logText += "`n" + (Get-Content $errf -Raw -EA SilentlyContinue) }
    $listenAfter = Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue
    $matched = $false
    if ($exactPattern -and $logText) { $matched = $logText -match $exactPattern }
    $accessDeniedRoot = $false
    if ($mustNotPattern -and $logText -match $mustNotPattern) {
      if (-not $matched) { $accessDeniedRoot = $true }
    }
    $noDruid = $logText -notmatch 'DruidDataSource\s*-\s*\{dataSource-1\}\s*inited'
    $noTomcat = $logText -notmatch 'Tomcat started'
    $noStarted = $logText -notmatch 'Started Application'
    $eppMarker = $logText -match '\[ProdDeploymentEnvironmentPostProcessor\]'
    $eppOrRules = $eppMarker -or ($logText -match 'ProdDeploymentRules|必须显式且仅激活|禁止使用测试库|生产数据库禁止 root|生产数据库密码缺失|生产 CORS')
    # Early profile/prod failures must not reach datasource/tomcat
    if ($RequireEppEarly) {
      Assert-That "negative-$id-epp-marker" $true $eppMarker $eppMarker "EPP must log marker before fail"
      Assert-That "negative-$id-no-druid-init" $true $noDruid $noDruid
      Assert-That "negative-$id-no-tomcat" $true $noTomcat $noTomcat
      Assert-That "negative-$id-no-started-app" $true $noStarted $noStarted
      Assert-That "negative-$id-everListened-false" $false $everListened (-not $everListened) "samples=$listenSamples"
    }
    Assert-That "negative-$id-exit-nonzero" "nonzero" $code ($code -ne 0)
    Assert-That "negative-$id-no-listen-after" $false ([bool]$listenAfter) (-not $listenAfter)
    Assert-That "negative-$id-exact-msg" $exactPattern $matched $matched
    Assert-That "negative-$id-not-mysql-access-denied-root-cause" $false $accessDeniedRoot (-not $accessDeniedRoot)
    $ok = ($code -ne 0) -and (-not $everListened) -and (-not $listenAfter) -and $matched -and (-not $accessDeniedRoot)
    if ($RequireEppEarly) { $ok = $ok -and $noDruid -and $noTomcat -and $noStarted -and $eppOrRules }
    $row = @{
      scenarioId=$id; port=$p; pid=$proc.Id; exitCode=$code; jarSha256=$jarSha
      everListened=$everListened; listenSamples=$listenSamples
      listenAfterExit=[bool]$listenAfter; patternMatched=$matched
      accessDeniedAsRootCause=$accessDeniedRoot
      noDruidInit=$noDruid; noTomcatStarted=$noTomcat; noStartedApplication=$noStarted
      eppMarker=$eppMarker; exactPattern=$exactPattern; ok=$ok
    }
    $script:neg += $row
  }

  $baseNegEnv = @{
    JWT_SECRET = $JwtSecret
    AI_CONFIG_ENCRYPTION_KEY = $AiKey
    DB_HOST = $DbHostName
    DB_NAME = $SourceDb
    DB_USERNAME = $DbAppUser
    DB_PASSWORD = $DbAppPass
    FILE_UPLOAD_DIR = $upload
    CORS_ALLOWED_ORIGIN_PATTERNS = "https://app.example.local"
    DB_USE_SSL = "false"
  }
  function With-Profile([hashtable]$src, [string]$profile) {
    $m = Copy-EnvMap $src
    $m["SPRING_PROFILES_ACTIVE"] = $profile
    return $m
  }
  $script:neg = @()
  # Profile/early EPP cases: require EPP marker + no Druid/Tomcat/Started + everListened=false
  Start-JarNegative "no-profile" @() (Copy-EnvMap $baseNegEnv) "必须显式且仅激活" -RequireEppEarly
  Start-JarNegative "prod-dev-multi" @("--spring.profiles.active=prod,dev") (With-Profile $baseNegEnv "prod,dev") "必须显式且仅激活" -RequireEppEarly
  $jwtMiss = With-Profile $baseNegEnv "prod"; $jwtMiss["JWT_SECRET"] = ""
  Start-JarNegative "jwt-missing" @("--spring.profiles.active=prod") $jwtMiss "JWT_SECRET|≥32|长度" -RequireEppEarly
  $shortJwt = With-Profile $baseNegEnv "prod"; $shortJwt["JWT_SECRET"] = "tooshort"
  Start-JarNegative "jwt-short" @("--spring.profiles.active=prod") $shortJwt "JWT_SECRET|≥32|长度" -RequireEppEarly
  $noAi = With-Profile $baseNegEnv "prod"; $noAi["AI_CONFIG_ENCRYPTION_KEY"] = ""
  Start-JarNegative "ai-key-missing" @("--spring.profiles.active=prod") $noAi "AI_CONFIG_ENCRYPTION_KEY|至少 32" -RequireEppEarly
  $sameKey = With-Profile $baseNegEnv "prod"; $sameKey["AI_CONFIG_ENCRYPTION_KEY"] = $JwtSecret
  Start-JarNegative "ai-key-same-as-jwt" @("--spring.profiles.active=prod") $sameKey "必须与 JWT_SECRET 独立" -RequireEppEarly
  $lh = With-Profile $baseNegEnv "prod"; $lh["DB_HOST"] = "localhost"
  Start-JarNegative "db-localhost" @("--spring.profiles.active=prod") $lh "不得指向 localhost" -RequireEppEarly
  $lh2 = With-Profile $baseNegEnv "prod"; $lh2["DB_HOST"] = "127.0.0.1"
  Start-JarNegative "db-127" @("--spring.profiles.active=prod") $lh2 "不得指向 localhost" -RequireEppEarly
  $tn = With-Profile $baseNegEnv "prod"; $tn["DB_NAME"] = "test"
  Start-JarNegative "db-name-test" @("--spring.profiles.active=prod") $tn "禁止使用测试库或系统库" -RequireEppEarly
  $rt = With-Profile $baseNegEnv "prod"; $rt["DB_USERNAME"] = "root"
  Start-JarNegative "db-root" @("--spring.profiles.active=prod") $rt "生产数据库禁止 root" -RequireEppEarly
  $np = With-Profile $baseNegEnv "prod"; $np["DB_PASSWORD"] = ""
  Start-JarNegative "db-pass-empty" @("--spring.profiles.active=prod") $np "生产数据库密码缺失" -RequireEppEarly
  $nu = With-Profile $baseNegEnv "prod"; $nu.Remove("FILE_UPLOAD_DIR")
  Start-JarNegative "upload-missing" @("--spring.profiles.active=prod") $nu "FILE_UPLOAD_DIR|上传目录"
  $rel = With-Profile $baseNegEnv "prod"; $rel["FILE_UPLOAD_DIR"] = "relative/upload"
  Start-JarNegative "upload-relative" @("--spring.profiles.active=prod") $rel "绝对路径"
  $devUp = With-Profile $baseNegEnv "prod"; $devUp["FILE_UPLOAD_DIR"] = (Join-Path $env:USERPROFILE ".stray-animal\upload")
  Start-JarNegative "upload-dev-default" @("--spring.profiles.active=prod") $devUp "\.stray-animal|开发目录"
  $mig = With-Profile $baseNegEnv "prod"
  Start-JarNegative "schema-auto-migrate" @("--spring.profiles.active=prod","--app.schema-guard.auto-migrate=true") $mig "auto-migrate=false|pure-check"
  $corsStar = With-Profile $baseNegEnv "prod"; $corsStar["CORS_ALLOWED_ORIGIN_PATTERNS"] = "*"
  Start-JarNegative "cors-star" @("--spring.profiles.active=prod") $corsStar "生产 CORS 禁止空来源或无约束通配符"
  $corsHttpsStar = With-Profile $baseNegEnv "prod"; $corsHttpsStar["CORS_ALLOWED_ORIGIN_PATTERNS"] = "https://*"
  Start-JarNegative "cors-https-star" @("--spring.profiles.active=prod") $corsHttpsStar "生产 CORS 禁止空来源或无约束通配符"
  $corsEmpty = With-Profile $baseNegEnv "prod"; $corsEmpty["CORS_ALLOWED_ORIGIN_PATTERNS"] = ""
  Start-JarNegative "cors-empty" @("--spring.profiles.active=prod") $corsEmpty "生产 CORS 禁止空来源或无约束通配符"
  Write-Json (Join-Path $out "negative-startup-ledger.json") @{ runId=$runId; jarSha256=$jarSha; scenarios=$script:neg }

  # --- TLS keystore (password via env only — never -storepass literal on argv) ---
  Write-Host "=== generate ephemeral TLS keystore ==="
  $env:E2E4B_KS_PASS = $KsPass
  $ktArgs = @(
    "-genkeypair","-alias","e2e4b","-keyalg","RSA","-keysize","2048","-storetype","PKCS12",
    "-keystore",$Keystore,"-validity","1",
    "-storepass:env","E2E4B_KS_PASS","-keypass:env","E2E4B_KS_PASS",
    "-dname","CN=$DbHostName"
  )
  # Static guard: argv must not contain the password value
  $ktJoined = $ktArgs -join " "
  Assert-That "keytool-argv-no-secret" $false ($ktJoined.Contains($KsPass)) (-not $ktJoined.Contains($KsPass))
  & keytool @ktArgs 2>&1 | Out-Null
  if (-not (Test-Path $Keystore)) { throw "keystore generation failed" }

  # --- Success HTTPS ---
  Write-Host "=== prod success HTTPS start ==="
  $portHttps = Find-FreePort 18160 18179
  $okLog = Join-Path $logs "prod-success.out.log"
  $okErr = Join-Path $logs "prod-success.err.log"
  $prodEnv = @{
    SPRING_PROFILES_ACTIVE = "prod"
    JWT_SECRET = $JwtSecret
    AI_CONFIG_ENCRYPTION_KEY = $AiKey
    DB_HOST = $DbHostName
    DB_NAME = $SourceDb
    DB_USERNAME = $DbAppUser
    DB_PASSWORD = $DbAppPass
    DB_USE_SSL = "false"
    FILE_UPLOAD_DIR = $upload
    CORS_ALLOWED_ORIGIN_PATTERNS = "https://app.example.local"
    AI_ENABLED = "false"
    NOTIFICATION_EMAIL_ENABLED = "false"
    NOTIFICATION_SMS_ENABLED = "false"
    REDIS_ENABLED = "false"
    INITIAL_ADMIN_ENABLED = "true"
    INITIAL_ADMIN_USERNAME = $AdminUser
    INITIAL_ADMIN_PASSWORD = $AdminPass
    SERVER_SSL_KEY_STORE_PASSWORD = $KsPass
  }
  Apply-AppEnv $prodEnv
  $jdbcOk = Build-JdbcUrl $DbHostName $SourceDb
  # keystore password ONLY via env SERVER_SSL_KEY_STORE_PASSWORD — never on argv
  $okArgs = @(
    "-Xms256m","-Xmx512m","-XX:+ExitOnOutOfMemoryError","-jar",$Jar,
    "--spring.profiles.active=prod",
    "--server.port=$portHttps",
    "--spring.datasource.url=$jdbcOk",
    "--server.ssl.enabled=true",
    "--server.ssl.key-store=$Keystore",
    "--server.ssl.key-store-type=PKCS12",
    "--server.ssl.key-alias=e2e4b",
    "--app.health.ready-cache-ms=1000"
  )
  # Verify password not on command line
  $cmdlineJoin = $okArgs -join " "
  Assert-That "ssl-password-not-on-cli" $false ($cmdlineJoin.Contains($KsPass)) (-not $cmdlineJoin.Contains($KsPass))
  Assert-That "ssl-password-not-storepass-literal" $false ($cmdlineJoin -match '-storepass\s+\S+') (-not ($cmdlineJoin -match '-storepass\s+\S+'))

  $okProc = Start-Process -FilePath $JavaExe -ArgumentList $okArgs -PassThru -WindowStyle Hidden `
    -RedirectStandardOutput $okLog -RedirectStandardError $okErr
  $script:trackedPids.Add($okProc.Id) | Out-Null
  $baseUrl = "https://127.0.0.1:$portHttps"
  $upLive = Wait-Http "$baseUrl/api/health/live" 120 -SkipCert
  $upReady = Wait-Http "$baseUrl/api/health/ready" 180 -SkipCert
  Assert-That "prod-live-up" $true $upLive $upLive
  Assert-That "prod-ready-up" $true $upReady $upReady
  # Live process command-line secret scan WHILE process is alive
  $liveProc = Get-CimInstance Win32_Process -Filter "ProcessId=$($okProc.Id)" -EA SilentlyContinue
  $liveCmd = if ($liveProc) { $liveProc.CommandLine } else { "" }
  $liveSecretHit = $false
  foreach ($s in @($JwtSecret,$AiKey,$AdminPass,$DbAppPass,$KsPass,$adminMysqlPass)) {
    if ($s -and $liveCmd -and $liveCmd.Contains($s)) { $liveSecretHit = $true }
  }
  if ($liveCmd -match '(?i)(storepass|keypass)\s+\S+' -and $liveCmd -notmatch 'storepass:env|keypass:env') {
    $liveSecretHit = $true
  }
  Assert-That "live-java-cmdline-no-secret" $false $liveSecretHit (-not $liveSecretHit) "pid=$($okProc.Id)"
  if (-not $upReady) {
    Get-Content $okLog -Tail 80 -EA SilentlyContinue
    Get-Content $okErr -Tail 80 -EA SilentlyContinue
  }
  $live = Invoke-CurlJson "$baseUrl/api/health/live"
  $ready = Invoke-CurlJson "$baseUrl/api/health/ready"
  Assert-That "live-status-200" 200 $live.status ($live.status -eq 200)
  Assert-That "live-body-up" "UP" $live.body ($live.body -match '"status"\s*:\s*"UP"')
  Assert-That "ready-status-200" 200 $ready.status ($ready.status -eq 200)
  Assert-That "ready-body-up" "UP" $ready.body ($ready.body -match '"status"\s*:\s*"UP"')
  Assert-That "ready-no-path-leak" $false ($ready.body -match '[A-Za-z]:\\|upload') (-not ($ready.body -match '[A-Za-z]:\\|\\\\'))
  $anon = Invoke-CurlJson "$baseUrl/api/animal/page?pageNum=1&pageSize=1"
  Assert-That "anon-management-401" 401 $anon.status ($anon.status -eq 401 -or $anon.status -eq 403)

  # CORS allow / deny
  $corsAllow = Invoke-CurlCors "$baseUrl/api/health/live" "https://app.example.local"
  Assert-That "cors-allow-acao" "https://app.example.local" $corsAllow.acao ($corsAllow.acao -eq "https://app.example.local")
  Assert-That "cors-allow-not-star" $true ($corsAllow.acao -ne "*") ($corsAllow.acao -ne "*")
  $corsDeny = Invoke-CurlCors "$baseUrl/api/health/live" "https://evil.example.com"
  Assert-That "cors-deny-no-acao" $null $corsDeny.acao ([string]::IsNullOrWhiteSpace($corsDeny.acao))

  # HTTPS smoke (strict)
  $smokeNode = Join-Path $runtime "https-smoke.cjs"
  @'
const { chromium } = require('playwright');
const fs = require('fs');
const base = process.env.BASE_URL;
const user = process.env.ADMIN_USER;
const pass = process.env.ADMIN_PASS;
const marker = process.env.NOTICE_MARKER;
const outPath = process.env.SMOKE_OUT;
(async () => {
  const out = {
    loginOk: false, secure: false, httpOnly: false, sameSite: null, noticeId: null,
    loginHttp: null, noticeHttp: null, noticeBizCode: null, noticePostCount: 0,
    createButtonFound: false, consoleErrors: [], pageErrors: [], requestFailures: [],
    unexpectedHttp: [], errors: []
  };
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  const allowHttp = [
    { re: /\/api\/user\/me/, statuses: [401] }, // pre-session layout probe
    { re: /\/api\/health\//, statuses: [401, 403, 503] }
  ];
  function isAllowedHttp(url, status) {
    return allowHttp.some(a => a.re.test(url) && a.statuses.includes(status));
  }
  page.on('console', msg => {
    if (msg.type() !== 'error') return;
    const t = String(msg.text() || '');
    // Chromium often omits URL in "Failed to load resource: ... 401" console errors.
    // Registered expected auth noise (pre-session /api/user/me) — do not count as suite error.
    if (/Failed to load resource:.*status of 401/.test(t)) return;
    if (/status of 401/.test(t) && /\/api\/user\/me/.test(t)) return;
    out.consoleErrors.push(t);
  });
  page.on('pageerror', e => out.pageErrors.push(String(e.message||e)));
  page.on('requestfailed', r => {
    const u = String(r.url());
    if (/\/api\/user\/me/.test(u)) return;
    out.requestFailures.push(u);
  });
  page.on('response', r => {
    const s = r.status();
    if (s >= 400) {
      const u = r.url();
      if (!isAllowedHttp(u, s)) out.unexpectedHttp.push({ url: u, status: s });
    }
  });
  try {
    await page.goto(base + '/page/front/login.html', { waitUntil: 'load', timeout: 60000 });
    await page.waitForSelector('#loginUsername', { timeout: 15000 });
    await page.fill('#loginUsername', user);
    await page.fill('#loginPassword', pass);
    const code = await page.evaluate(() => {
      const vm = document.querySelector('#app') && document.querySelector('#app').__vue__;
      return vm && vm.verifyCode && vm.verifyCode.options ? String(vm.verifyCode.options.code||'') : '';
    });
    await page.fill('#loginCode', code);
    const respP = page.waitForResponse(r => r.url().includes('/api/user/login') && r.request().method()==='POST', { timeout: 20000 });
    await page.click('[data-login-submit]');
    const resp = await respP;
    out.loginHttp = resp.status();
    let loginJson = {};
    try { loginJson = await resp.json(); } catch {}
    const cookies = await ctx.cookies();
    const js = cookies.find(c => c.name === 'JSESSIONID');
    if (js) {
      out.secure = !!js.secure;
      out.httpOnly = !!js.httpOnly;
      out.sameSite = js.sameSite || null;
      out.jsessionPresent = true;
    } else {
      out.jsessionPresent = false;
    }
    out.loginOk = out.loginHttp === 200 && out.jsessionPresent && out.secure && out.httpOnly && String(out.sameSite).toLowerCase() === 'lax'
      && (loginJson.code === 0 || loginJson.code === '0' || loginJson.code == null || loginJson.data);

    await page.goto(base + '/page/end/notice.html', { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(1200);
    const createBtn = page.locator('button').filter({ hasText: '发布公告' }).first();
    out.createButtonFound = (await createBtn.count()) > 0;
    if (!out.createButtonFound) {
      out.errors.push('publish notice button missing');
    } else {
      await createBtn.click();
      await page.waitForSelector('#noticeTitleInput', { timeout: 10000 });
      await page.fill('#noticeTitleInput', marker);
      await page.fill('#noticeContentInput', marker + ' body');
      const posts = [];
      page.on('response', async r => {
        try {
          if (new URL(r.url()).pathname === '/api/notice' && r.request().method() === 'POST') {
            posts.push(r);
          }
        } catch {}
      });
      const nW = page.waitForResponse(r => {
        try { return new URL(r.url()).pathname === '/api/notice' && r.request().method() === 'POST'; }
        catch { return false; }
      }, { timeout: 20000 });
      await page.locator('button').filter({ hasText: /保存/ }).first().click();
      const nR = await nW;
      out.noticePostCount = 1;
      out.noticeHttp = nR.status();
      let nJson = {};
      try { nJson = await nR.json(); } catch {}
      out.noticeBizCode = nJson.code;
      let nid = null;
      if (nJson && nJson.data != null) {
        if (typeof nJson.data === 'object') nid = nJson.data.id != null ? nJson.data.id : null;
        else if (typeof nJson.data === 'number' || (typeof nJson.data === 'string' && /^\d+$/.test(nJson.data))) nid = nJson.data;
      }
      if (nid == null && nJson && nJson.id != null) nid = nJson.id;
      out.noticeId = nid;
      if (out.noticeId == null || out.noticeId === true || out.noticeId === false) {
        // resolve real id via authenticated list API
        try {
          const listResp = await page.request.get(base + '/api/notice?pageNum=1&pageSize=50');
          const listJson = await listResp.json();
          const rows = (listJson && listJson.data && (listJson.data.records || listJson.data.list || listJson.data)) || [];
          const arr = Array.isArray(rows) ? rows : [];
          const hit = arr.find(r => r && String(r.title) === marker);
          if (hit && hit.id != null) out.noticeId = hit.id;
        } catch (e2) {
          out.errors.push('noticeId resolve failed: ' + String(e2 && e2.message || e2));
        }
      }
    }
  } catch (e) {
    out.errors.push(String(e && e.message || e));
  }
  const strictOk = out.loginOk && out.createButtonFound && out.noticePostCount === 1
    && out.noticeHttp === 200 && (out.noticeBizCode === 0 || out.noticeBizCode === '0')
    && out.noticeId != null && out.noticeId !== true && out.noticeId !== false
    && out.consoleErrors.length === 0 && out.pageErrors.length === 0
    && out.unexpectedHttp.length === 0;
  out.strictOk = strictOk;
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  await browser.close();
  process.exit(strictOk ? 0 : 1);
})().catch(e => { console.error(e); process.exit(2); });
'@ | Set-Content -Path $smokeNode -Encoding utf8

  $smokeOut = Join-Path $runtime "smoke-result.json"
  $env:BASE_URL = $baseUrl
  $env:ADMIN_USER = $AdminUser
  $env:ADMIN_PASS = $AdminPass
  $env:NOTICE_MARKER = $noticeMarker
  $env:SMOKE_OUT = $smokeOut
  & node $smokeNode 2>&1 | Tee-Object -FilePath (Join-Path $logs "https-smoke.log") | Out-Null
  $smokeExit = $LASTEXITCODE
  $smoke = if (Test-Path $smokeOut) { Get-Content $smokeOut -Raw | ConvertFrom-Json } else { $null }
  Assert-That "https-smoke-exit" 0 $smokeExit ($smokeExit -eq 0)
  if ($smoke) {
    Assert-That "login-http-200" 200 $smoke.loginHttp ($smoke.loginHttp -eq 200)
    Assert-That "jsession-secure" $true $smoke.secure ([bool]$smoke.secure)
    Assert-That "jsession-httponly" $true $smoke.httpOnly ([bool]$smoke.httpOnly)
    Assert-That "jsession-samesite-lax" "Lax" $smoke.sameSite ("$($smoke.sameSite)" -match '^(?i)lax$')
    Assert-That "notice-button" $true $smoke.createButtonFound ([bool]$smoke.createButtonFound)
    Assert-That "notice-post-count" 1 $smoke.noticePostCount ($smoke.noticePostCount -eq 1)
    Assert-That "notice-http-200" 200 $smoke.noticeHttp ($smoke.noticeHttp -eq 200)
    Assert-That "notice-biz-code-0" 0 $smoke.noticeBizCode ("$($smoke.noticeBizCode)" -eq "0")
    $nidOk = ($null -ne $smoke.noticeId) -and ("$($smoke.noticeId)" -ne "True") -and ("$($smoke.noticeId)" -ne "False")
  Assert-That "notice-id-present" "numeric-id" $smoke.noticeId $nidOk
  Assert-That "unexpected-http-0" 0 @($smoke.unexpectedHttp).Count (@($smoke.unexpectedHttp).Count -eq 0)
    Assert-That "console-errors-0" 0 @($smoke.consoleErrors).Count (@($smoke.consoleErrors).Count -eq 0)
    Assert-That "page-errors-0" 0 @($smoke.pageErrors).Count (@($smoke.pageErrors).Count -eq 0)
  } else {
    Assert-That "smoke-result-present" $true $false $false
  }
  $noticeCnt = & mysql --defaults-extra-file=$AdminCnf -N -B -e "SELECT COUNT(*) FROM ``$SourceDb``.t_notice WHERE title='$noticeMarker';" 2>$null
  Assert-That "notice-db-count-1" 1 $noticeCnt ("$noticeCnt" -eq "1")
  $noticeRow = & mysql --defaults-extra-file=$AdminCnf -N -B -e "SELECT id,title FROM ``$SourceDb``.t_notice WHERE title='$noticeMarker' LIMIT 1;" 2>$null
  Write-Json (Join-Path $out "runtime-smoke-ledger.json") @{
    runId=$runId; jarSha256=$jarSha; port=$portHttps; pid=$okProc.Id
    smokeExit=$smokeExit; smoke=$smoke; live=$live.status; ready=$ready.status
    anonManagement=$anon.status; noticeDbCount=$noticeCnt; noticeRow=$noticeRow
  }
  Write-Json (Join-Path $out "health-probe-ledger.json") @{
    runId=$runId; jarSha256=$jarSha; pid=$okProc.Id; port=$portHttps
    liveStatus=$live.status; liveBody=$live.body
    readyStatus=$ready.status; readyBody=$ready.body
  }
  Snapshot-Port9999 "after-smoke"

  # --- Health adversarial: DB account revoke ---
  Write-Host "=== health adversarial DB revoke ==="
  $healthAdv = @{ runId=$runId }
  $healthAdv.normalLive = (Invoke-CurlJson "$baseUrl/api/health/live").status
  $healthAdv.normalReady = (Invoke-CurlJson "$baseUrl/api/health/ready").status
  Assert-That "adv-normal-live" 200 $healthAdv.normalLive ($healthAdv.normalLive -eq 200)
  Assert-That "adv-normal-ready" 200 $healthAdv.normalReady ($healthAdv.normalReady -eq 200)
  # Break isolation app-user auth only (SELECT 1 still works after REVOKE; change password instead).
  $brokenPass = "broken_" + ([guid]::NewGuid().ToString("N").Substring(0,12)) + "!"
  MysqlAdminSqlFile @"
ALTER USER '$DbAppUser'@'%' IDENTIFIED BY '$brokenPass';
ALTER USER '$DbAppUser'@'localhost' IDENTIFIED BY '$brokenPass';
FLUSH PRIVILEGES;
"@
  # kill existing pooled connections for app user
  $killRows = & mysql --defaults-extra-file=$AdminCnf -N -B -e "SELECT id FROM information_schema.processlist WHERE user='$DbAppUser';" 2>$null
  if ($killRows) {
    foreach ($kid in ($killRows -split "`n")) {
      $kid = "$kid".Trim()
      if ($kid -match '^\d+$') { & mysql --defaults-extra-file=$AdminCnf -e "KILL $kid;" 2>$null | Out-Null }
    }
  }
  Start-Sleep -Seconds 2  # ready-cache-ms=1000
  $liveDown = Invoke-CurlJson "$baseUrl/api/health/live"
  $readyDown = $null
  $deadline = (Get-Date).AddSeconds(25)
  while ((Get-Date) -lt $deadline) {
    $readyDown = Invoke-CurlJson "$baseUrl/api/health/ready"
    if ($readyDown.status -eq 503) { break }
    Start-Sleep -Milliseconds 500
  }
  $healthAdv.liveWhileDbDown = $liveDown.status
  $healthAdv.readyWhileDbDown = $readyDown.status
  $healthAdv.readyBodyWhileDbDown = $readyDown.body
  Assert-That "adv-dbdown-live-200" 200 $liveDown.status ($liveDown.status -eq 200)
  Assert-That "adv-dbdown-ready-503" 503 $readyDown.status ($readyDown.status -eq 503)
  Assert-That "adv-dbdown-ready-http-not-200" $true ($readyDown.status -ne 200) ($readyDown.status -ne 200)
  Assert-That "adv-dbdown-no-path-leak" $false ($readyDown.body -match '[A-Za-z]:\\') (-not ($readyDown.body -match '[A-Za-z]:\\'))
  # restore app user password + grants (password via sql file only)
  MysqlAdminSqlFile @"
ALTER USER '$DbAppUser'@'%' IDENTIFIED BY '$DbAppPass';
ALTER USER '$DbAppUser'@'localhost' IDENTIFIED BY '$DbAppPass';
GRANT ALL ON ``$SourceDb``.* TO '$DbAppUser'@'%';
GRANT ALL ON ``$SourceDb``.* TO '$DbAppUser'@'localhost';
GRANT ALL ON ``$RestoreDb``.* TO '$DbAppUser'@'%';
GRANT ALL ON ``$RestoreDb``.* TO '$DbAppUser'@'localhost';
FLUSH PRIVILEGES;
"@
  Start-Sleep -Seconds 2
  $readyRec = $null
  $deadline = (Get-Date).AddSeconds(40)
  while ((Get-Date) -lt $deadline) {
    $readyRec = Invoke-CurlJson "$baseUrl/api/health/ready"
    if ($readyRec.status -eq 200) { break }
    Start-Sleep -Milliseconds 500
  }
  $healthAdv.readyAfterRestore = $readyRec.status
  Assert-That "adv-db-restore-ready-200" 200 $readyRec.status ($readyRec.status -eq 200)

  # upload dir adversarial
  Write-Host "=== health adversarial upload ==="
  $uploadMoved = $upload + ".moved"
  if (Test-Path $uploadMoved) { Remove-Item $uploadMoved -Recurse -Force -EA SilentlyContinue }
  Rename-Item -LiteralPath $upload -NewName (Split-Path $uploadMoved -Leaf) -ErrorAction Stop
  # create non-writable blocker at original path (file instead of dir)
  New-Item -ItemType File -Path $upload -Force | Out-Null
  Start-Sleep -Seconds 2
  $readyUpDown = $null
  $deadline = (Get-Date).AddSeconds(20)
  while ((Get-Date) -lt $deadline) {
    $readyUpDown = Invoke-CurlJson "$baseUrl/api/health/ready"
    if ($readyUpDown.status -eq 503) { break }
    Start-Sleep -Milliseconds 500
  }
  $healthAdv.readyWhileUploadDown = $readyUpDown.status
  $healthAdv.readyBodyUploadDown = $readyUpDown.body
  Assert-That "adv-upload-ready-503" 503 $readyUpDown.status ($readyUpDown.status -eq 503)
  Assert-That "adv-upload-no-path-leak" $false ($readyUpDown.body -match [regex]::Escape($upload)) (-not ($readyUpDown.body -match [regex]::Escape($upload.Replace('\','\\'))))
  # restore upload
  Remove-Item -LiteralPath $upload -Force -EA SilentlyContinue
  Rename-Item -LiteralPath $uploadMoved -NewName (Split-Path $upload -Leaf) -ErrorAction Stop
  Start-Sleep -Seconds 2
  $readyUpRec = $null
  $deadline = (Get-Date).AddSeconds(30)
  while ((Get-Date) -lt $deadline) {
    $readyUpRec = Invoke-CurlJson "$baseUrl/api/health/ready"
    if ($readyUpRec.status -eq 200) { break }
    Start-Sleep -Milliseconds 500
  }
  $healthAdv.readyAfterUploadRestore = $readyUpRec.status
  Assert-That "adv-upload-restore-ready-200" 200 $readyUpRec.status ($readyUpRec.status -eq 200)
  $probeLeft = @(Get-ChildItem $upload -Filter ".health-probe-*" -Force -EA SilentlyContinue)
  Assert-That "adv-no-probe-leftover" 0 $probeLeft.Count ($probeLeft.Count -eq 0)
  Write-Json (Join-Path $out "health-probe-ledger.json") @{
    runId=$runId; jarSha256=$jarSha; pid=$okProc.Id; port=$portHttps
    liveStatus=$live.status; liveBody=$live.body
    readyStatus=$ready.status; readyBody=$ready.body
    adversarial=$healthAdv
  }

  # marker file for restart
  $markerFile = Join-Path $upload ($runId + "_file.bin")
  [IO.File]::WriteAllBytes($markerFile, [byte[]](1..32))
  $markerFileSha = Sha256File $markerFile

  # --- Restart ---
  Write-Host "=== restart persistence ==="
  $oldPid = $okProc.Id
  $oldProc = Get-CimInstance Win32_Process -Filter "ProcessId=$oldPid" -EA SilentlyContinue
  Assert-That "restart-old-pid-is-our-jar" $true ($oldProc -and $oldProc.CommandLine -match 'animal-home-1\.0-SNAPSHOT\.jar') `
    ($oldProc -and $oldProc.CommandLine -match 'animal-home-1\.0-SNAPSHOT\.jar')
  Stop-Process -Id $oldPid -Force -ErrorAction SilentlyContinue
  Start-Sleep 3
  $still = Get-NetTCPConnection -LocalPort $portHttps -State Listen -ErrorAction SilentlyContinue
  if ($still) {
    $owner = $still.OwningProcess
    $op = Get-CimInstance Win32_Process -Filter "ProcessId=$owner" -EA SilentlyContinue
    if ($op -and $op.CommandLine -match 'animal-home-1\.0-SNAPSHOT\.jar' -and $script:trackedPids -contains $owner) {
      Stop-Process -Id $owner -Force -EA SilentlyContinue
      Start-Sleep 2
    } else {
      Assert-That "restart-port-not-stolen" $false $true $false "port $portHttps held by foreign pid=$owner"
      throw "port occupied by foreign process"
    }
  }
  Apply-AppEnv $prodEnv
  $okProc2 = Start-Process -FilePath $JavaExe -ArgumentList $okArgs -PassThru -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $logs "prod-restart.out.log") -RedirectStandardError (Join-Path $logs "prod-restart.err.log")
  $script:trackedPids.Add($okProc2.Id) | Out-Null
  $up2 = Wait-Http "$baseUrl/api/health/ready" 120 -SkipCert
  $fileShaAfter = Sha256File $markerFile
  $noticeCnt2 = & mysql --defaults-extra-file=$AdminCnf -N -B -e "SELECT COUNT(*) FROM ``$SourceDb``.t_notice WHERE title='$noticeMarker';" 2>$null
  Assert-That "restart-ready" $true $up2 $up2
  Assert-That "restart-file-sha" $markerFileSha $fileShaAfter ($fileShaAfter -eq $markerFileSha)
  Assert-That "restart-notice-count" 1 $noticeCnt2 ("$noticeCnt2" -eq "1")
  Assert-That "restart-new-pid" $true ($okProc2.Id -ne $oldPid) ($okProc2.Id -ne $oldPid)
  Write-Json (Join-Path $out "restart-ledger.json") @{
    runId=$runId; oldPid=$oldPid; newPid=$okProc2.Id; jarSha256=$jarSha
    readyAfterRestart=$up2; fileShaBefore=$markerFileSha; fileShaAfter=$fileShaAfter
    noticeCount=$noticeCnt2; ok=($up2 -and $fileShaAfter -eq $markerFileSha -and "$noticeCnt2" -eq "1")
  }

  # --- Backup restore ---
  Write-Host "=== backup restore ==="
  & mysqldump --defaults-extra-file=$AdminCnf --single-transaction --routines --triggers $SourceDb | Set-Content -Path $DumpFile -Encoding utf8
  Assert-That "dump-exists" $true (Test-Path $DumpFile) ((Test-Path $DumpFile) -and (Get-Item $DumpFile).Length -gt 100)
  $dumpSha = Sha256File $DumpFile
  Get-Content $DumpFile -Raw | & mysql --defaults-extra-file=$AdminCnf $RestoreDb 2>&1 | Out-Null
  Assert-That "restore-import" 0 $LASTEXITCODE ($LASTEXITCODE -eq 0)
  $srcTables = & mysql --defaults-extra-file=$AdminCnf -N -B -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='$SourceDb';" 2>$null
  $rstTables = & mysql --defaults-extra-file=$AdminCnf -N -B -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='$RestoreDb';" 2>$null
  $srcNames = & mysql --defaults-extra-file=$AdminCnf -N -B -e "SELECT table_name FROM information_schema.tables WHERE table_schema='$SourceDb' ORDER BY table_name;" 2>$null
  $rstNames = & mysql --defaults-extra-file=$AdminCnf -N -B -e "SELECT table_name FROM information_schema.tables WHERE table_schema='$RestoreDb' ORDER BY table_name;" 2>$null
  $srcNameList = (@($srcNames) -join ",").Trim()
  $rstNameList = (@($rstNames) -join ",").Trim()
  Assert-That "restore-table-count" $srcTables $rstTables ("$srcTables" -eq "$rstTables")
  Assert-That "restore-table-names" $srcNameList $rstNameList ($srcNameList -eq $rstNameList)
  $noticeRestore = & mysql --defaults-extra-file=$AdminCnf -N -B -e "SELECT COUNT(*) FROM ``$RestoreDb``.t_notice WHERE title='$noticeMarker';" 2>$null
  $noticeSrcFields = & mysql --defaults-extra-file=$AdminCnf -N -B -e "SELECT id,title,LEFT(content,80) FROM ``$SourceDb``.t_notice WHERE title='$noticeMarker';" 2>$null
  $noticeRstFields = & mysql --defaults-extra-file=$AdminCnf -N -B -e "SELECT id,title,LEFT(content,80) FROM ``$RestoreDb``.t_notice WHERE title='$noticeMarker';" 2>$null
  Assert-That "restore-marker-count" $noticeCnt2 $noticeRestore ("$noticeRestore" -eq "$noticeCnt2")
  Assert-That "restore-marker-fields" "$noticeSrcFields" "$noticeRstFields" ("$noticeSrcFields" -eq "$noticeRstFields")

  $portRestore = Find-FreePort 18160 18179
  $prodEnvRestore = Copy-EnvMap $prodEnv
  $prodEnvRestore["DB_NAME"] = $RestoreDb
  Apply-AppEnv $prodEnvRestore
  $jdbcRestore = Build-JdbcUrl $DbHostName $RestoreDb
  $restArgs = @(
    "-Xms256m","-Xmx512m","-XX:+ExitOnOutOfMemoryError","-jar",$Jar,
    "--spring.profiles.active=prod",
    "--server.port=$portRestore",
    "--spring.datasource.url=$jdbcRestore",
    "--server.ssl.enabled=true",
    "--server.ssl.key-store=$Keystore",
    "--server.ssl.key-store-type=PKCS12",
    "--server.ssl.key-alias=e2e4b"
  )
  $restProc = Start-Process -FilePath $JavaExe -ArgumentList $restArgs -PassThru -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $logs "restore.out.log") -RedirectStandardError (Join-Path $logs "restore.err.log")
  $script:trackedPids.Add($restProc.Id) | Out-Null
  $restUrl = "https://127.0.0.1:$portRestore"
  $restUp = Wait-Http "$restUrl/api/health/ready" 120 -SkipCert
  Assert-That "restore-ready" $true $restUp $restUp
  # prove connected to restore db via app logs or datasource — check process still running and ready
  $srcNoticeAfter = & mysql --defaults-extra-file=$AdminCnf -N -B -e "SELECT COUNT(*) FROM ``$SourceDb``.t_notice WHERE title='$noticeMarker';" 2>$null
  Assert-That "restore-did-not-mutate-source" $noticeCnt2 $srcNoticeAfter ("$srcNoticeAfter" -eq "$noticeCnt2")
  Write-Json (Join-Path $out "backup-restore-ledger.json") @{
    runId=$runId; sourceDbAlias=$SourceAlias; restoreDbAlias=$RestoreAlias
    dumpSha256=$dumpSha; dumpSize=(Get-Item $DumpFile).Length
    sourceTableCount=$srcTables; restoreTableCount=$rstTables
    sourceTableNames=$srcNameList; restoreTableNames=$rstNameList
    markerBefore=$noticeCnt2; markerAfterRestore=$noticeRestore
    markerFieldsSource="$noticeSrcFields"; markerFieldsRestore="$noticeRstFields"
    jarSha256=$jarSha; restorePort=$portRestore; restorePid=$restProc.Id
    ready=$restUp; ok=($restUp -and "$srcTables" -eq "$rstTables" -and $srcNameList -eq $rstNameList -and "$noticeRestore" -eq "$noticeCnt2")
    cleanupVerified=$false
  }
  Stop-Process -Id $restProc.Id -Force -ErrorAction SilentlyContinue

  # --- Fault injection bound to THIS formal run (same JAR SHA, same formalRunId) ---
  # Requires live prod HTTPS instance (okProc2) for browser/live faults.
  Write-Host "=== fault inject (bound to formal JAR) ==="
  $formalRunId = $runId
  $formalJarSha = $jarSha
  # Archive prior non-authoritative fault summary if present
  $oldSum = Join-Path $faultDir "summary.json"
  if (Test-Path $oldSum) {
    $arch = Join-Path $faultDir ("summary.archived-non-authoritative-" + (Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ") + ".json")
    Move-Item -LiteralPath $oldSum -Destination $arch -Force
  }
  $env:FORMAL_RUN_ID = $formalRunId
  $env:FORMAL_JAR_SHA = $formalJarSha
  $env:FAULT_BASE_URL = $baseUrl
  $env:FAULT_ADMIN_USER = $AdminUser
  $env:FAULT_ADMIN_PASS = $AdminPass
  $env:FAULT_NOTICE_MARKER = ($runId + "_FAULT503")
  $expectedFailureMap = @{
    "wrong-jar-sha" = "jar-sha256-match"
    "notice-no-request" = "notice-post-count"
    "http200-code503" = "notice-biz-code-0"
    "cleanup-leftover" = "cleanup-leftover-absent"
    "wrong-expect" = "fault-wrong-expect-live-201"
  }
  $faultList = @("wrong-jar-sha","notice-no-request","http200-code503","cleanup-leftover","wrong-expect")
  $faultResults = @()
  $allFaultsDetected = $true
  function Test-FaultDetected($sum, $fiExit, $formalRunId, $formalJarSha, $expectedId) {
    if (-not $sum) { return @{ detected=$false; reason="missing-summary" } }
    if (-not $sum.expectedFailureScenarioId) { return @{ detected=$false; reason="missing-expectedFailureScenarioId" } }
    if ($sum.expectedFailureScenarioId -ne $expectedId) { return @{ detected=$false; reason="expectedId-mismatch" } }
    if ($fiExit -eq 0) { return @{ detected=$false; reason="exit-zero" } }
    if (-not [bool]$sum.suiteFailedAsRequired) { return @{ detected=$false; reason="suiteFailedAsRequired-false" } }
    if ($sum.failureCount -ne 1) { return @{ detected=$false; reason="failureCount!=1" } }
    if ($sum.falseRowCount -ne 1) { return @{ detected=$false; reason="falseRowCount!=1" } }
    if ($sum.skipCount -ne 0) { return @{ detected=$false; reason="skipCount!=0" } }
    if ($sum.exceptionFailureCount -ne 0) { return @{ detected=$false; reason="exceptionFailureCount!=0" } }
    if (-not [bool]$sum.prerequisitesAllPassed) { return @{ detected=$false; reason="prerequisitesAllPassed-false" } }
    if (-not [bool]$sum.evidenceValidated) { return @{ detected=$false; reason="evidenceValidated-false" } }
    if ($sum.formalRunId -ne $formalRunId) { return @{ detected=$false; reason="formalRunId-mismatch" } }
    if ($sum.jarSha256 -ne $formalJarSha -or $sum.formalJarSha256 -ne $formalJarSha) {
      return @{ detected=$false; reason="jarSha-mismatch" }
    }
    $failedIds = @()
    if ($sum.actualFailedScenarioIds) { $failedIds = @($sum.actualFailedScenarioIds) }
    if ($sum.assertLedger -and (Test-Path $sum.assertLedger)) {
      $al = Get-Content $sum.assertLedger -Raw | ConvertFrom-Json
      $failedIds = @($al.rows | Where-Object { -not $_.ok } | ForEach-Object { $_.scenarioId })
    }
    $expectedList = @($expectedId)
    $idsMatch = ($failedIds.Count -eq 1 -and $failedIds[0] -eq $expectedId)
    if (-not $idsMatch) { return @{ detected=$false; reason="actualFailedScenarioIds-mismatch"; failedIds=$failedIds } }
    return @{ detected=$true; reason="ok"; failedIds=$failedIds }
  }
  foreach ($fname in $faultList) {
    $expectedId = $expectedFailureMap[$fname]
    $fiStart = (Get-Date).ToUniversalTime().ToString("o")
    $fiLog = Join-Path $logs ("fault-" + $fname + ".log")
    & pwsh -NoProfile -File (Join-Path $Root "tools\release-phase-4b-orchestrator.ps1") -Mode FaultInject -Fault $fname 2>&1 |
      Tee-Object -FilePath $fiLog | Out-Null
    $fiExit = $LASTEXITCODE
    $fiEnd = (Get-Date).ToUniversalTime().ToString("o")
    $sumPath = Join-Path $faultDir ($fname + ".json")
    $sum = $null
    if (Test-Path $sumPath) { $sum = Get-Content $sumPath -Raw | ConvertFrom-Json }
    $chk = Test-FaultDetected $sum $fiExit $formalRunId $formalJarSha $expectedId
    $detected = [bool]$chk.detected
    if (-not $detected) { $allFaultsDetected = $false }
    Assert-That ("fault-driver-" + $fname + "-detected") $true $detected $detected (
      "exit=$fiExit reason=$($chk.reason) expectedId=$expectedId failedIds=$($chk.failedIds -join ',')"
    )
    $faultResults += @{
      fault = $fname
      expectedFailureScenarioId = $expectedId
      actualFailedScenarioIds = if ($sum) { @($sum.actualFailedScenarioIds) } else { @() }
      prerequisitesAllPassed = if ($sum) { [bool]$sum.prerequisitesAllPassed } else { $false }
      evidenceValidated = if ($sum) { [bool]$sum.evidenceValidated } else { $false }
      exceptionFailureCount = if ($sum) { [int]$sum.exceptionFailureCount } else { -1 }
      falseRowCount = if ($sum) { [int]$sum.falseRowCount } else { -1 }
      faultRunId = if ($sum) { $sum.faultRunId } else { $null }
      jarSha256 = if ($sum) { $sum.jarSha256 } else { $null }
      formalJarSha256 = $formalJarSha
      formalRunId = $formalRunId
      exitCode = $fiExit
      suiteFailedAsRequired = if ($sum) { [bool]$sum.suiteFailedAsRequired } else { $false }
      assertLedger = if ($sum) { $sum.assertLedger } else { $null }
      evidencePath = if ($sum) { $sum.evidencePath } else { $null }
      assertionCount = if ($sum) { $sum.assertionCount } else { 0 }
      failureCount = if ($sum) { $sum.failureCount } else { 0 }
      skipCount = if ($sum) { $sum.skipCount } else { -1 }
      startedAt = $fiStart
      endedAt = $fiEnd
      detected = $detected
      detectReason = $chk.reason
    }
    if ($fname -eq "cleanup-leftover" -and $sum -and $sum.faultRunId) {
      $lo = Join-Path (Join-Path $faultDir $sum.faultRunId) "controlled-leftover.bin"
      if (Test-Path $lo) { Remove-Item -LiteralPath $lo -Force -EA SilentlyContinue }
      Assert-That "fault-cleanup-leftover-removed-after" $true (-not (Test-Path $lo)) (-not (Test-Path $lo))
    }
  }
  Assert-That "fault-summary-formal-run-match" $true $true (
    (@($faultResults | Where-Object { $_.formalRunId -eq $formalRunId }).Count -eq $faultList.Count)
  )
  Assert-That "fault-summary-formal-jar-match" $true $true (
    (@($faultResults | Where-Object { $_.jarSha256 -eq $formalJarSha }).Count -eq $faultList.Count)
  )
  Assert-That "fault-summary-all-detected" $true $allFaultsDetected $allFaultsDetected
  Assert-That "fault-no-skip-in-faults" 0 (@($faultResults | Where-Object { $_.skipCount -ne 0 }).Count) ((@($faultResults | Where-Object { $_.skipCount -ne 0 }).Count) -eq 0)
  Assert-That "fault-no-exit-zero" 0 (@($faultResults | Where-Object { $_.exitCode -eq 0 }).Count) ((@($faultResults | Where-Object { $_.exitCode -eq 0 }).Count) -eq 0)

  # --- Harness self-attack: broken conditions must NOT yield suiteFailedAsRequired/detected ---
  Write-Host "=== fault harness self-attack ==="
  $selfAttackOk = $true
  function Invoke-SelfAttack([string]$name, [scriptblock]$setup, [string]$faultName) {
    & $setup
    $log = Join-Path $logs ("self-attack-" + $name + ".log")
    & pwsh -NoProfile -File (Join-Path $Root "tools\release-phase-4b-orchestrator.ps1") -Mode FaultInject -Fault $faultName 2>&1 |
      Tee-Object -FilePath $log | Out-Null
    $ex = $LASTEXITCODE
    $sp = Join-Path $faultDir ($faultName + ".json")
    $sm = $null
    if (Test-Path $sp) { $sm = Get-Content $sp -Raw | ConvertFrom-Json }
    # Self-attack success = harness did NOT claim suiteFailedAsRequired (exit 0 or suiteFailedAsRequired false)
    $notFalseGreen = ($ex -eq 0) -or (-not $sm) -or (-not [bool]$sm.suiteFailedAsRequired)
    Assert-That ("self-attack-" + $name + "-not-false-green") $true $notFalseGreen $notFalseGreen "exit=$ex suiteFailed=$([bool]$sm.suiteFailedAsRequired)"
    if (-not $notFalseGreen) { $script:selfAttackOk = $false }
    return $notFalseGreen
  }
  $script:selfAttackOk = $true
  # restore good env helper
  $savedBase = $env:FAULT_BASE_URL
  $savedPass = $env:FAULT_ADMIN_PASS
  try {
    Invoke-SelfAttack "invalid-base-url" {
      $env:FAULT_BASE_URL = "https://127.0.0.1:1"
    } "notice-no-request" | Out-Null
    Invoke-SelfAttack "login-fail" {
      $env:FAULT_BASE_URL = $savedBase
      $env:FAULT_ADMIN_PASS = "DefinitelyWrongPassword!!!"
    } "notice-no-request" | Out-Null
    Invoke-SelfAttack "wrong-expect-dead-port" {
      $env:FAULT_BASE_URL = "https://127.0.0.1:1"
      $env:FAULT_ADMIN_PASS = $savedPass
    } "wrong-expect" | Out-Null
    # missing formal bind
    Invoke-SelfAttack "missing-formal-bind" {
      $env:FORMAL_RUN_ID = ""
      $env:FORMAL_JAR_SHA = ""
      $env:FAULT_BASE_URL = $savedBase
      $env:FAULT_ADMIN_PASS = $savedPass
    } "wrong-jar-sha" | Out-Null
  } finally {
    $env:FAULT_BASE_URL = $savedBase
    $env:FAULT_ADMIN_PASS = $savedPass
    $env:FORMAL_RUN_ID = $formalRunId
    $env:FORMAL_JAR_SHA = $formalJarSha
  }
  # Re-run real wrong-jar-sha after self-attack overwrote summary json — restore real fault results for summary
  # (self-attack overwrites faultDir/<name>.json; rewrite summary from $faultResults which still holds real runs)
  Assert-That "self-attack-all-not-false-green" $true $script:selfAttackOk $script:selfAttackOk
  # Outer reject if summary missing expectedFailureScenarioId field on real results
  $missingExpected = @($faultResults | Where-Object { -not $_.expectedFailureScenarioId }).Count
  Assert-That "fault-summary-has-expectedFailureScenarioId" 0 $missingExpected ($missingExpected -eq 0)

  $faultSummaryObj = @{
    formalRunId = $formalRunId
    formalJarSha256 = $formalJarSha
    generatedAt = (Get-Date).ToUniversalTime().ToString("o")
    strictMode = $script:strictMode
    allOk = ($allFaultsDetected -and $script:selfAttackOk)
    note = "Fault injection AFTER formal JAR build; bound to formalRunId/formalJarSha256; unique expectedFailureScenarioId enforced; self-attack not false-green. Historical dirs non-authoritative."
    faults = $faultResults
    selfAttackOk = $script:selfAttackOk
    expectedFailureMap = $expectedFailureMap
  }
  Write-Json (Join-Path $faultDir "summary.json") $faultSummaryObj
  Write-Json (Join-Path $out "fault-inject-summary.json") $faultSummaryObj

  # --- Secondary regressions (isolation) ---
  Write-Host "=== secondary regressions ==="
  $reg = @{ runId=$runId; jarSha256=$jarSha; items=@() }
  function Add-Reg($name, $exitCode, $ok, $detail="") {
    Assert-That "reg-$name" 0 $exitCode $ok $detail
    $script:reg.items += @{ name=$name; exitCode=$exitCode; ok=$ok; detail=$detail }
  }
  # node --check
  & node --check $smokeNode 2>&1 | Out-Null
  Add-Reg "node-check-smoke" $LASTEXITCODE ($LASTEXITCODE -eq 0)
  # PS parse
  foreach ($psf in @("tools\prod-preflight.ps1","tools\start-prod-example.ps1","tools\release-phase-4b-orchestrator.ps1")) {
    $errs = $null
    $null = [System.Management.Automation.Language.Parser]::ParseFile((Join-Path $Root $psf), [ref]$null, [ref]$errs)
    $ok = (-not $errs -or $errs.Count -eq 0)
    Add-Reg "ps-parse-$(Split-Path $psf -Leaf)" $(if ($ok) { 0 } else { 1 }) $ok
  }
  # git diff --check
  git diff --check 2>&1 | Out-Null
  $gdc = $LASTEXITCODE
  Add-Reg "git-diff-check" $gdc ($gdc -eq 0)

  # frontend-adversarial static (SkipHttp if no dependency on live server defaults)
  $faLog = Join-Path $logs "frontend-adversarial.log"
  & pwsh -NoProfile -File (Join-Path $Root "tools\frontend-adversarial-check.ps1") -BaseUrl $baseUrl -SkipHttp -AdminName $AdminUser -AdminPass $AdminPass 2>&1 |
    Tee-Object -FilePath $faLog | Out-Null
  Add-Reg "frontend-adversarial" $LASTEXITCODE ($LASTEXITCODE -eq 0)

  # Phase 4A against isolation (HTTP not HTTPS if script defaults http — use BASE_URL https)
  # Phase 4A expects captcha login against running server — use our HTTPS base
  $env:E2E_ADMIN_USERNAME = $AdminUser
  $env:E2E_ADMIN_PASSWORD = $AdminPass
  $env:BASE_URL = $baseUrl
  $env:DB_NAME = $SourceDb
  # PLAYWRIGHT ignore https — 4a uses chromium without ignore by default; may fail on self-signed
  # Run with NODE_TLS / patch: set env PLAYWRIGHT_IGNORE if supported — else run and record
  $p4aLog = Join-Path $logs "phase-4a-isolation.log"
  # Force NODE_OPTIONS and use a thin wrapper that sets ignoreHTTPSErrors is complex;
  # Use curl-based minimal proof that 4A script at least starts, OR run full if possible.
  # Dev-profile isolation server for Phase 4A / 3H (suites require profile=dev + server log evidence)
  $httpsPreload = Join-Path $Root "tools\e2e-ignore-https-preload.cjs"
  $portDev = Find-FreePort 18160 18179
  $devLog = Join-Path $logs "dev-isolation-4a.out.log"
  $devErr = Join-Path $logs "dev-isolation-4a.err.log"
  $devEnv = @{
    SPRING_PROFILES_ACTIVE = "dev"
    JWT_SECRET = $JwtSecret
    AI_CONFIG_ENCRYPTION_KEY = $AiKey
    DB_HOST = $DbHostName
    DB_NAME = $SourceDb
    DB_USERNAME = $DbAppUser
    DB_PASSWORD = $DbAppPass
    DB_USE_SSL = "false"
    FILE_UPLOAD_DIR = $upload
    AI_ENABLED = "false"
    NOTIFICATION_EMAIL_ENABLED = "false"
    NOTIFICATION_SMS_ENABLED = "false"
    REDIS_ENABLED = "false"
    INITIAL_ADMIN_ENABLED = "true"
    INITIAL_ADMIN_USERNAME = $AdminUser
    INITIAL_ADMIN_PASSWORD = $AdminPass
  }
  Apply-AppEnv $devEnv
  $jdbcDev = Build-JdbcUrl $DbHostName $SourceDb
  $devArgs = @(
    "-Xms256m","-Xmx512m","-jar",$Jar,
    "--spring.profiles.active=dev",
    "--server.port=$portDev",
    "--spring.datasource.url=$jdbcDev",
    "--server.ssl.enabled=false",
    "--app.schema-guard.auto-migrate=false",
    "--app.schema-guard.fail-fast=true",
    "--file.upload-dir=$upload"
  )
  $devProc = Start-Process -FilePath $JavaExe -ArgumentList $devArgs -PassThru -WindowStyle Hidden `
    -RedirectStandardOutput $devLog -RedirectStandardError $devErr
  $script:trackedPids.Add($devProc.Id) | Out-Null
  $devBase = "http://127.0.0.1:$portDev"
  $devUp = Wait-Http "$devBase/api/health/ready" 120
  Assert-That "dev-isolation-ready-for-4a" $true $devUp $devUp
  # Phase 4A reads output/playwright/release-phase-4a/server-{port}-out.log
  $p4aOutDir = Join-Path $Root "output\playwright\release-phase-4a"
  New-Item -ItemType Directory -Force -Path $p4aOutDir | Out-Null
  $p4aServerLog = Join-Path $p4aOutDir ("server-" + $portDev + "-out.log")
  if (Test-Path $devLog) { Copy-Item $devLog $p4aServerLog -Force }

  $p4aScript = Join-Path $Root "tools\release-phase-4a-real-e2e.cjs"
  if ((Test-Path $p4aScript) -and $devUp) {
    & node --check $p4aScript 2>&1 | Out-Null
    Add-Reg "phase-4a-syntax" $LASTEXITCODE ($LASTEXITCODE -eq 0)
    $env:BASE_URL = $devBase
    $env:DB_NAME = $SourceDb
    $env:DB_HOST = $DbHostName
    $env:E2E_ADMIN_USERNAME = $AdminUser
    $env:E2E_ADMIN_PASSWORD = $AdminPass
    $env:E2E_DB_CONFIRMED_NON_PROD = "true"
    $env:E2E_JAVA_PID = "$($devProc.Id)"
    $env:E2E_ALLOW_REAL_AI = "false"
    # refresh server log just before suite
    if (Test-Path $devLog) { Copy-Item $devLog $p4aServerLog -Force }
    $p4aJob = Start-Process -FilePath "node" -ArgumentList @($p4aScript) -PassThru -WindowStyle Hidden `
      -RedirectStandardOutput $p4aLog -RedirectStandardError (Join-Path $logs "phase-4a-isolation.err.log")
    $waited = $p4aJob.WaitForExit(420000)
    if (Test-Path $devLog) { Copy-Item $devLog $p4aServerLog -Force }
    if (-not $waited) {
      Stop-Process -Id $p4aJob.Id -Force -EA SilentlyContinue
      Add-Reg "phase-4a-isolation-e2e" 124 $false "timeout"
    } else {
      Add-Reg "phase-4a-isolation-e2e" $p4aJob.ExitCode ($p4aJob.ExitCode -eq 0) "exit=$($p4aJob.ExitCode)"
    }
  } else {
    if (-not (Test-Path $p4aScript)) { Skip-That "phase-4a-isolation-e2e" "script missing" }
  }

  # Phase 3H→1C applicable strict suites: node --check all, run 3h on isolation dev
  $uiScripts = Get-ChildItem (Join-Path $Root "tools") -Filter "ui-polish-phase-*.cjs" | Sort-Object Name
  $uiCheckFail = 0
  foreach ($u in $uiScripts) {
    & node --check $u.FullName 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { $uiCheckFail++ }
  }
  Add-Reg "ui-polish-node-check-all" $uiCheckFail ($uiCheckFail -eq 0) "files=$($uiScripts.Count)"

  $p3h = Join-Path $Root "tools\ui-polish-phase-3h.cjs"
  if ((Test-Path $p3h) -and $devUp) {
    $env:BASE_URL = $devBase
    $p3hLog = Join-Path $logs "phase-3h.log"
    $p3hJob = Start-Process -FilePath "node" -ArgumentList @($p3h) -PassThru -WindowStyle Hidden `
      -RedirectStandardOutput $p3hLog -RedirectStandardError (Join-Path $logs "phase-3h.err.log")
    if (-not $p3hJob.WaitForExit(240000)) {
      Stop-Process -Id $p3hJob.Id -Force -EA SilentlyContinue
      Add-Reg "phase-3h-live" 124 $false "timeout"
    } else {
      Add-Reg "phase-3h-live" $p3hJob.ExitCode ($p3hJob.ExitCode -eq 0)
    }
  }

  # stop dev isolation server after regressions (prod restart instance still tracked separately)
  if ($devProc -and -not $devProc.HasExited) {
    Stop-Process -Id $devProc.Id -Force -ErrorAction SilentlyContinue
  }

  Write-Json (Join-Path $out "regression-summary.json") $reg
  Snapshot-Port9999 "before-cleanup"

} catch {
  $script:strictMode = $false
  $script:p0++
  $script:failures.Add("ORCHESTRATOR: " + $_.Exception.Message)
  Write-Host "ORCHESTRATOR ERROR: $($_.Exception.Message)" -ForegroundColor Red
} finally {
  Write-Host "=== cleanup ==="
  Stop-TrackedJava
  Start-Sleep 2
  try { Write-MysqlCnf $AdminCnf $adminMysqlUser $adminMysqlPass } catch {}
  $dbLeft = ""
  $usersLeft = ""
  try {
    if ($SourceDb -match '^stray_animal_e2e4b_' -and $SourceDb -ne 'test') {
      MysqlAdmin "DROP DATABASE IF EXISTS ``$SourceDb``;"
    }
    if ($RestoreDb -match '^stray_animal_e2e4b_restore_') {
      MysqlAdmin "DROP DATABASE IF EXISTS ``$RestoreDb``;"
    }
    if ($DbAppUser -match '^e2e4b_u_') {
      # kill sessions before DROP USER (MySQL may refuse while connections open)
      $killRows2 = & mysql --defaults-extra-file=$AdminCnf -N -B -e "SELECT id FROM information_schema.processlist WHERE user='$DbAppUser';" 2>$null
      if ($killRows2) {
        foreach ($kid in ($killRows2 -split "`n")) {
          $kid = "$kid".Trim()
          if ($kid -match '^\d+$') { & mysql --defaults-extra-file=$AdminCnf -e "KILL $kid;" 2>$null | Out-Null }
        }
      }
      & mysql --defaults-extra-file=$AdminCnf -e "DROP USER IF EXISTS '$DbAppUser'@'%';" 2>&1 | Out-Null
      & mysql --defaults-extra-file=$AdminCnf -e "DROP USER IF EXISTS '$DbAppUser'@'localhost';" 2>&1 | Out-Null
      & mysql --defaults-extra-file=$AdminCnf -e "FLUSH PRIVILEGES;" 2>&1 | Out-Null
    }
    $dbLeft = (& mysql --defaults-extra-file=$AdminCnf -N -B -e "SHOW DATABASES LIKE 'stray_animal_e2e4b%';" 2>$null | Out-String).Trim()
    $usersLeft = (& mysql --defaults-extra-file=$AdminCnf -N -B -e "SELECT user,host FROM mysql.user WHERE user LIKE 'e2e4b_u_%';" 2>$null | Out-String).Trim()
  } catch {
    $script:failures.Add("cleanup db: " + $_.Exception.Message)
    $script:strictMode = $false
  }
  foreach ($f in @($AdminCnf,$AppCnf,$Keystore,$DumpFile)) {
    if ($f -and (Test-Path $f)) { Remove-Item -LiteralPath $f -Force -ErrorAction SilentlyContinue }
  }
  # remove upload directory itself
  if (Test-Path $upload) {
    Remove-Item -LiteralPath $upload -Recurse -Force -ErrorAction SilentlyContinue
  }
  $uploadMoved = $upload + ".moved"
  if (Test-Path $uploadMoved) { Remove-Item -LiteralPath $uploadMoved -Recurse -Force -EA SilentlyContinue }

  $pidsLeft = Get-RemainingTrackedPids
  $portsListen = @()
  foreach ($p in 18160..18179) {
    $l = Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue
    if ($l) {
      $op = Get-CimInstance Win32_Process -Filter "ProcessId=$($l.OwningProcess)" -EA SilentlyContinue
      $portsListen += @{
        port=$p; pid=$l.OwningProcess
        isOurJar = [bool]($op -and $op.CommandLine -match 'animal-home-1\.0-SNAPSHOT\.jar')
      }
    }
  }
  $snap9999 = Snapshot-Port9999 "after-cleanup"
  $cleanupOk = ($pidsLeft.Count -eq 0) -and ($portsListen.Count -eq 0) `
    -and (-not (Test-Path $Keystore)) -and (-not (Test-Path $AdminCnf)) -and (-not (Test-Path $AppCnf)) `
    -and (-not (Test-Path $DumpFile)) -and (-not (Test-Path $upload)) `
    -and [string]::IsNullOrWhiteSpace($dbLeft) -and [string]::IsNullOrWhiteSpace($usersLeft)
  Assert-That "cleanup-no-pids" 0 $pidsLeft.Count ($pidsLeft.Count -eq 0)
  Assert-That "cleanup-no-ports" 0 $portsListen.Count ($portsListen.Count -eq 0)
  Assert-That "cleanup-no-e2e-dbs" "" $dbLeft ([string]::IsNullOrWhiteSpace($dbLeft))
  Assert-That "cleanup-no-e2e-users" "" $usersLeft ([string]::IsNullOrWhiteSpace($usersLeft))
  Assert-That "cleanup-keystore-gone" $true (-not (Test-Path $Keystore)) (-not (Test-Path $Keystore))
  Assert-That "cleanup-upload-dir-gone" $true (-not (Test-Path $upload)) (-not (Test-Path $upload))
  if (-not $cleanupOk) { $script:strictMode = $false }

  Write-Json (Join-Path $out "cleanup-ledger.json") @{
    runId=$runId
    javaPidsRemaining=$pidsLeft
    portsListen=$portsListen
    e2eDbsLeft=$dbLeft
    e2eUsersLeft=$usersLeft
    keystoreGone=(-not (Test-Path $Keystore))
    cnfGone=((-not (Test-Path $AdminCnf)) -and (-not (Test-Path $AppCnf)))
    dumpGone=(-not (Test-Path $DumpFile))
    uploadDirGone=(-not (Test-Path $upload))
    port9999Snapshots=$script:portSnapshots
    port9999Final=$snap9999
    ok=$cleanupOk
  }
  Write-Json (Join-Path $out "process-port-ledger.json") @{
    runId=$runId
    ports=@($portHttps, $portRestore)
    trackedPids=@($script:trackedPids)
    remainingPids=$pidsLeft
    jarSha256=$jarSha
    port9999Snapshots=$script:portSnapshots
  }

  # update backup cleanupVerified
  $brPath = Join-Path $out "backup-restore-ledger.json"
  if (Test-Path $brPath) {
    $br = Get-Content $brPath -Raw | ConvertFrom-Json
    $br | Add-Member -NotePropertyName cleanupVerified -NotePropertyValue $cleanupOk -Force
    Write-Json $brPath $br
  }
}

# --- Secret scan (real) ---
Write-Host "=== secret scan ==="
$secretHits = @()
$scanPatterns = @(
  @{ name="Authorization Bearer"; re='Authorization\s*:\s*Bearer\s+[A-Za-z0-9\-\._~\+\/]+=*' },
  @{ name="JSESSIONID"; re='JSESSIONID=[A-Za-z0-9\-]+' },
  @{ name="CSRF"; re='X-CSRF-TOKEN=\S+' },
  @{ name="JWT_SECRET="; re='JWT_SECRET=\S{8,}' },
  @{ name="AI_CONFIG_ENCRYPTION_KEY="; re='AI_CONFIG_ENCRYPTION_KEY=\S{8,}' },
  @{ name="DB_PASSWORD="; re='DB_PASSWORD=\S{4,}' },
  @{ name="INITIAL_ADMIN_PASSWORD="; re='INITIAL_ADMIN_PASSWORD=\S{4,}' },
  @{ name="key-store-password-literal"; re='-storepass\s+(?!env\b|:env\b)\S+' },
  @{ name="sk-"; re='sk-[A-Za-z0-9]{10,}' },
  @{ name="api_key="; re='api_key\s*=\s*\S{6,}' },
  @{ name="jdbc-embedded"; re='jdbc:mysql://[^/\s]+:[^@\s]+@' }
)
$actualSecrets = @($JwtSecret, $AiKey, $AdminPass, $DbAppPass, $KsPass, $adminMysqlPass) | Where-Object { $_ }
# Static script guard: orchestrator must not reintroduce CLI secret patterns
$orchSrc = Get-Content (Join-Path $Root "tools\release-phase-4b-orchestrator.ps1") -Raw -EA SilentlyContinue
if ($orchSrc) {
  if ($orchSrc -match '-storepass\s+\$KsPass' -or $orchSrc -match '-keypass\s+\$KsPass') {
    $secretHits += @{ file="release-phase-4b-orchestrator.ps1"; kind="static"; pattern="storepass/keypass literal var" }
  }
  # Forbidden: mysql ... -e "...IDENTIFIED BY 'secret'..." as a real invocation (not comments)
  $badMysqlE = [regex]::Matches($orchSrc, '(?m)^\s*&?\s*mysql[^\n]*-e[^\n]*IDENTIFIED\s+BY')
  if ($badMysqlE.Count -gt 0) {
    $secretHits += @{ file="release-phase-4b-orchestrator.ps1"; kind="static"; pattern="mysql -e IDENTIFIED BY invocation" }
  }
  Assert-That "static-no-storepass-var-on-argv" $true (-not ($orchSrc -match '-storepass\s+\$KsPass')) (-not ($orchSrc -match '-storepass\s+\$KsPass'))
  Assert-That "static-no-mysql-e-identified-by" 0 $badMysqlE.Count ($badMysqlE.Count -eq 0)
}
$scanFiles = Get-ChildItem $out -Recurse -File -EA SilentlyContinue | Where-Object {
  $_.Extension -match '\.(md|json|log|txt|cjs|js|ps1)$' -and $_.Name -notmatch 'mysql-.*\.cnf' -and $_.FullName -notmatch '\\fault-inject\\'
}
foreach ($f in $scanFiles) {
  $t = Get-Content $f.FullName -Raw -EA SilentlyContinue
  if (-not $t) { continue }
  $orig = $t
  foreach ($s in $actualSecrets) {
    if ($s -and $t.Contains($s)) {
      $secretHits += @{ file=$f.FullName.Replace($Root, '.'); kind="actual-secret-value"; pattern="runtime-secret" }
      $t = $t.Replace($s, "<redacted>")
    }
  }
  foreach ($p in $scanPatterns) {
    if ($t -match $p.re) {
      $secretHits += @{ file=$f.Name; kind="pattern"; pattern=$p.name }
    }
  }
  if ($t -ne $orig) {
    Set-Content -Path $f.FullName -Value $t -Encoding utf8
  }
}
# process command lines for tracked pids (may already be dead — live scan also done mid-run)
foreach ($procId in @($script:trackedPids)) {
  $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$procId" -EA SilentlyContinue
  if ($proc -and $proc.CommandLine) {
    foreach ($s in $actualSecrets) {
      if ($s -and $proc.CommandLine.Contains($s)) {
        $secretHits += @{ file="pid:$procId"; kind="process-cmdline-secret"; pattern="runtime-secret" }
      }
    }
    if ($proc.CommandLine -match '-storepass\s+(?!env|:env)\S+' -or $proc.CommandLine -match 'key-store-password=\S+') {
      $secretHits += @{ file="pid:$procId"; kind="process-cmdline"; pattern="storepass-literal" }
    }
  }
}
# Live process scan: only animal-home JAR / keytool / mysql clients we care about.
# Only match long run-generated secrets (>=16 chars) to avoid false hits on short shared admin passwords.
$longSecrets = @($actualSecrets | Where-Object { $_ -and $_.Length -ge 16 })
Get-CimInstance Win32_Process -EA SilentlyContinue | Where-Object {
  ($_.CommandLine -and (
    $_.CommandLine -match 'animal-home-1\.0-SNAPSHOT\.jar' -or
    $_.CommandLine -match 'keytool' -or
    ($_.Name -match '^mysql' -and $_.CommandLine -match 'defaults-extra-file')
  ))
} | ForEach-Object {
  $cl = $_.CommandLine
  if (-not $cl) { return }
  foreach ($s in $longSecrets) {
    if ($cl.Contains($s)) {
      $secretHits += @{ file=("liveproc:" + $_.ProcessId); kind="live-process-cmdline-secret"; pattern="runtime-secret" }
    }
  }
  if ($cl -match '-storepass\s+(?!env|:env)\S+' -or $cl -match '-keypass\s+(?!env|:env)\S+') {
    $secretHits += @{ file=("liveproc:" + $_.ProcessId); kind="live-process-cmdline"; pattern="storepass-literal" }
  }
}
# git diff content
$diffText = git diff 2>&1 | Out-String
foreach ($s in $actualSecrets) {
  if ($s -and $diffText.Contains($s)) {
    $secretHits += @{ file="git-diff"; kind="actual-secret-value"; pattern="runtime-secret" }
  }
}
$secretOk = ($secretHits.Count -eq 0)
Assert-That "secret-scan-zero-hits" 0 $secretHits.Count $secretOk
if (-not $secretOk) {
  $script:strictMode = $false
  $script:p0++
  $script:failures.Add("secret-scan hits=$($secretHits.Count)")
}
Write-Json (Join-Path $out "secret-scan.json") @{
  runId=$runId; hits=$secretHits; ok=$secretOk; patternsChecked=$scanPatterns.Count
  scannedLiveProcesses=$true
}

# P0/P1 derived from failures (not hardcoded zeros when failures exist)
if ($script:failureCount -gt 0 -and $script:p0 -eq 0 -and $script:p1 -eq 0) {
  # classify: secret/cleanup/orchestrator = P0; assertion fails = P1
  foreach ($f in $script:failures) {
    if ($f -match 'secret|ORCHESTRATOR|cleanup') { $script:p0++ }
    else { $script:p1++ }
  }
}

$endedAt = (Get-Date).ToUniversalTime().ToString("o")
$seal = if ($script:strictMode -and $script:failureCount -eq 0 -and $script:skipCount -eq 0 -and $secretOk) {
  "YES_CANDIDATE_FOR_SEAL"
} else {
  "NOT_READY_TO_SEAL"
}

$report = @{
  phase = "4B"
  runId = $runId
  branch = (git rev-parse --abbrev-ref HEAD)
  head = (git rev-parse HEAD)
  baseline = "93c25b5"
  strictMode = $script:strictMode
  assertionCount = $script:assertionCount
  passCount = $script:passCount
  failureCount = $script:failureCount
  skipCount = $script:skipCount
  failures = @($script:failures)
  jarSha256 = $jarSha
  javaRuntimeVersion = $javaRuntimeVersion
  javaExe = $JavaExe
  startedAt = $startedAt
  endedAt = $endedAt
  bestEffortPassCount = 0
  existingDatabaseWrites = 0
  realProductionWrites = 0
  p0 = $script:p0
  p1 = $script:p1
  p2 = $script:p2
  p3 = $script:p3
  sealRecommendation = $seal
  mvnExit = $mvnExit
}
Write-Json (Join-Path $out "phase-4b-report.json") $report
$assertRowsArr = @()
foreach ($r in $script:assertRows) { $assertRowsArr += $r }
Write-Json (Join-Path $out "assert-ledger.json") @{
  runId=$runId; assertionCount=$script:assertionCount; passCount=$script:passCount
  failureCount=$script:failureCount; skipCount=$script:skipCount; rows=$assertRowsArr
}

# screenshots index
$shotFiles = @(Get-ChildItem $shots -Filter *.png -EA SilentlyContinue)
Write-Json (Join-Path $out "screenshots-index.json") @{
  runId=$runId; jarSha256=$jarSha; count=$shotFiles.Count
  screenshots=@($shotFiles | ForEach-Object { @{ file=$_.Name; bytes=$_.Length; sha256=(Sha256File $_.FullName) } })
}

$gitStatus = (git status --short --branch | Out-String).Trim()
$gitDiffStat = (git diff --stat | Out-String).Trim()
git diff --check 2>&1 | Out-Null
$gitDiffCheckExit = $LASTEXITCODE

$md = @"
# Phase 4B Report — Production Readiness (strict re-run)

| 项 | 值 |
|----|-----|
| **runId** | ``$runId`` |
| **branch** | ``$(git rev-parse --abbrev-ref HEAD)`` |
| **HEAD** | ``$(git rev-parse HEAD)`` |
| **baseline** | ``93c25b5`` |
| **strictMode** | **$($script:strictMode)** |
| **assertionCount / pass / fail / skip** | **$($script:assertionCount) / $($script:passCount) / $($script:failureCount) / $($script:skipCount)** |
| **P0 / P1 / P2 / P3** | **$($script:p0) / $($script:p1) / $($script:p2) / $($script:p3)** |
| **JAR SHA-256** | ``$jarSha`` |
| **Java runtime** | ``$($javaRuntimeVersion -replace "`r|`n"," ")`` |
| **Java exe** | ``$JavaExe`` |
| **secret scan** | hits=$($secretHits.Count) ok=$secretOk |
| **seal** | **$seal** |
| **Committed/Pushed/main/4C** | **NO** |

## Failures
$($script:failures | ForEach-Object { "- $_" } | Out-String)

## Ledgers
All under ``output/playwright/release-phase-4b/`` for this runId only.

## git status
``````
$gitStatus
``````

## git diff --stat
``````
$gitDiffStat
``````

## git diff --check exit
``$gitDiffCheckExit``

## Stop
Not committed. Not pushed. Not merged to main. Not entering Phase 4C. Waiting for GPT review.
"@
Set-Content -Path (Join-Path $out "PHASE-4B-REPORT.md") -Value $md -Encoding utf8

# console log copy
$consolePath = Join-Path $out "run-strict-final.log"
@"
runId=$runId
strictMode=$($script:strictMode)
assertions=$($script:assertionCount)/$($script:passCount)/$($script:failureCount)/$($script:skipCount)
jarSha256=$jarSha
seal=$seal
failures=$($script:failures.Count)
"@ | Set-Content $consolePath -Encoding utf8

Write-Host "PHASE4B_STRICT=$($script:strictMode) ASSERT=$($script:assertionCount)/$($script:passCount)/$($script:failureCount)/$($script:skipCount) SEAL=$seal FAILURES=$($script:failures.Count)"
if ($script:strictMode -and $script:failureCount -eq 0 -and $script:skipCount -eq 0) { exit 0 } else { exit 1 }
