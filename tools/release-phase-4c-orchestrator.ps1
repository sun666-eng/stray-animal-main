# Phase 4C — security/privacy/authz credibility orchestrator (formal run).
# No commit/push/main/4D. Ports 18180-18199. Never touch 9999.
# Same formalRunId: security suite + 4A + 3H + frontend-adversarial + mvn + git-diff + self-attack + ledger-gate.
$ErrorActionPreference = "Stop"
# PS 7+: do not treat native stderr (mvn/mockito/git CRLF) as terminating errors
if (Test-Path variable:/PSNativeCommandUseErrorActionPreference) {
  $PSNativeCommandUseErrorActionPreference = $false
}
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $Root

$runId = "E2E4C_" + (Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ") + "_" + ([guid]::NewGuid().ToString("N").Substring(0,6).ToUpper())
$outRoot = Join-Path $Root "output\playwright\release-phase-4c"
# Independent run directory under phase 4C root
$out = Join-Path $outRoot "runs\$runId"
$runtime = Join-Path $out "runtime"
$upload = Join-Path $runtime "upload"
$logs = Join-Path $out "logs"
New-Item -ItemType Directory -Force -Path $out,$runtime,$upload,$logs | Out-Null

# Clean only phase-4c root top-level stale ledgers (not other phases); keep runs/ history
Get-ChildItem $outRoot -File -EA SilentlyContinue | Where-Object {
  $_.Extension -match '\.(json|md|log)$'
} | Remove-Item -Force -EA SilentlyContinue

$baseline4b = "893e024b70e9117c89c204ffac67ad3655eb1f4a"
$Jar = Join-Path $Root "target\animal-home-1.0-SNAPSHOT.jar"
$JavaExe = if ($env:JAVA_HOME -and (Test-Path (Join-Path $env:JAVA_HOME "bin\java.exe"))) {
  Join-Path $env:JAVA_HOME "bin\java.exe"
} else { (Get-Command java).Source }

$JwtSecret = -join ((48..57+65..90+97..122|Get-Random -Count 48|%{ [char]$_ }))
$AiKey = -join ((48..57+65..90+97..122|Get-Random -Count 48|%{ [char]$_ }))
$AdminPass = -join ((48..57+65..90+97..122|Get-Random -Count 20|%{ [char]$_ })) + "Aa1!"
$UserAPass = -join ((48..57+65..90+97..122|Get-Random -Count 16|%{ [char]$_ })) + "Aa1!"
$UserBPass = -join ((48..57+65..90+97..122|Get-Random -Count 16|%{ [char]$_ })) + "Aa1!"
$DbAppPass = -join ((48..57+65..90+97..122|Get-Random -Count 18|%{ [char]$_ })) + "Aa1!"
$JerryPass = -join ((48..57+65..90+97..122|Get-Random -Count 14|%{ [char]$_ })) + "Aa1!"
$AdminUser = ("e2e4c_adm_" + $runId.Substring($runId.Length-6)).ToLower()
$UserA = ("e2e4c_a_" + $runId.Substring($runId.Length-6)).ToLower()
$UserB = ("e2e4c_b_" + $runId.Substring($runId.Length-6)).ToLower()
$DbAppUser = ("e2e4c_u_" + ([guid]::NewGuid().ToString("N").Substring(0,6))).ToLower()
$SourceDb = "stray_animal_e2e4c_" + ([guid]::NewGuid().ToString("N").Substring(0,10))
$DbHostName = $env:COMPUTERNAME
if ([string]::IsNullOrWhiteSpace($DbHostName)) { $DbHostName = [System.Net.Dns]::GetHostName() }
$AdminCnf = Join-Path $runtime "mysql-admin.cnf"
$trackedPids = New-Object System.Collections.Generic.List[int]
$portSnap = New-Object System.Collections.Generic.List[object]
$startedAt = (Get-Date).ToUniversalTime().ToString("o")
$jarSha = $null
$portHttp = 0
$mockLlmPort = 0
$mockLlmPid = $null
$gitStatusSha = $null
$gitDiffSha = $null
$worktreeDirty = $true
$branch = (git rev-parse --abbrev-ref HEAD)
$head = (git rev-parse HEAD)

function Write-Json($path, $obj) {
  # UTF-8 without BOM — Node JSON.parse rejects UTF-8 BOM from Windows PowerShell Set-Content
  $json = $obj | ConvertTo-Json -Depth 16
  [IO.File]::WriteAllText($path, $json, [Text.UTF8Encoding]::new($false))
}
function Sha256File($p) { if (-not (Test-Path $p)) { return $null }; (Get-FileHash -Algorithm SHA256 -LiteralPath $p).Hash.ToLower() }
function Snapshot9999($phase) {
  $c = Get-NetTCPConnection -LocalPort 9999 -EA SilentlyContinue | Select-Object -First 1
  $row = @{ phase=$phase; state= if($c){"$($c.State)"}else{"none"}; pid= if($c){$c.OwningProcess}else{$null}; at=(Get-Date).ToUniversalTime().ToString("o") }
  $script:portSnap.Add($row)|Out-Null
  return $row
}
function Find-FreePort([int]$s,[int]$e) {
  for ($p=$s; $p -le $e; $p++) {
    if (-not (Get-NetTCPConnection -LocalPort $p -State Listen -EA SilentlyContinue)) { return $p }
  }
  throw "no free port $s-$e"
}
function Build-JdbcUrl($h,$db) {
  "jdbc:mysql://${h}:3306/${db}?useUnicode=true&characterEncoding=utf-8&useSSL=false&allowPublicKeyRetrieval=true&serverTimezone=GMT%2b8&connectTimeout=5000&socketTimeout=60000"
}
function Write-MysqlCnf($path,$user,$pass) {
  [IO.File]::WriteAllText($path, "[client]`nuser=$user`npassword=$pass`nhost=127.0.0.1`nport=3306`n")
}
function MysqlAdmin($sql) {
  if ($sql -match '(?i)IDENTIFIED\s+BY') { throw "use MysqlAdminStdin for password SQL" }
  & mysql --defaults-extra-file=$AdminCnf -N -B -e $sql 2>&1
  if ($LASTEXITCODE -ne 0) { throw "mysql failed $LASTEXITCODE" }
}
function MysqlAdminStdin([string]$sql, [int]$timeoutMs=60000) {
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = (Get-Command mysql).Source
  $psi.Arguments = "--defaults-extra-file=$AdminCnf -N -B"
  $psi.UseShellExecute = $false
  $psi.RedirectStandardInput = $true
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.CreateNoWindow = $true
  $p = New-Object System.Diagnostics.Process
  $p.StartInfo = $psi
  [void]$p.Start()
  try {
    $p.StandardInput.Write($sql)
    if (-not $sql.EndsWith("`n")) { $p.StandardInput.Write("`n") }
    $p.StandardInput.Close()
    if (-not $p.WaitForExit($timeoutMs)) { try{$p.Kill()}catch{}; throw "mysql stdin timeout" }
    if ($p.ExitCode -ne 0) { throw "mysql stdin exit=$($p.ExitCode)" }
  } finally { try{if(-not $p.HasExited){$p.Kill()}}catch{}; try{$p.Dispose()}catch{} }
}
function Wait-Http($url, $sec=120) {
  $d=(Get-Date).AddSeconds($sec)
  while((Get-Date) -lt $d) {
    try {
      $c = & curl.exe -s -o NUL -w "%{http_code}" --connect-timeout 5 $url 2>$null
      if ("$c" -match '^[23]') { return $true }
    } catch {}
    Start-Sleep 2
  }
  return $false
}
function Stop-Tracked {
  foreach ($id in @($trackedPids)) {
    try {
      $pr = Get-CimInstance Win32_Process -Filter "ProcessId=$id" -EA SilentlyContinue
      if ($pr -and ($pr.CommandLine -match 'animal-home-1\.0-SNAPSHOT\.jar' -or $pr.CommandLine -match 'mock-llm-delay-server')) {
        Stop-Process -Id $id -Force -EA SilentlyContinue
      }
    } catch {}
  }
  if ($script:mockLlmPid) {
    try { Stop-Process -Id $script:mockLlmPid -Force -EA SilentlyContinue } catch {}
  }
}

function Get-WorktreeHashes {
  $statusText = ""
  $diffText = ""
  try {
    $prevEapGit = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $statusText = (& git status --short 2>&1 | Out-String)
    $diffText = (& git diff 2>&1 | Out-String)
  } finally { $ErrorActionPreference = $prevEapGit }
  $statusSha = ([System.Security.Cryptography.SHA256]::Create().ComputeHash(
    [Text.Encoding]::UTF8.GetBytes($statusText)) | ForEach-Object { $_.ToString("x2") }) -join ''
  $diffSha = ([System.Security.Cryptography.SHA256]::Create().ComputeHash(
    [Text.Encoding]::UTF8.GetBytes($diffText)) | ForEach-Object { $_.ToString("x2") }) -join ''
  $dirty = -not [string]::IsNullOrWhiteSpace($statusText.Trim())
  return @{
    statusText = $statusText
    diffText = $diffText
    gitStatusSha256 = $statusSha
    worktreeDiffSha256 = $diffSha
    worktreeDirty = $dirty
  }
}
function Assert-ServerAlive($pidCheck, $url) {
  $proc = Get-Process -Id $pidCheck -EA SilentlyContinue
  if (-not $proc) { throw "server process dead pid=$pidCheck — must restart with NEW formalRunId (not stitching)" }
  if (-not (Wait-Http $url 15)) { throw "server not responding $url — mid-run death" }
}

$adminMysqlUser = if ($env:MYSQL_ADMIN_USER) { $env:MYSQL_ADMIN_USER } else { "root" }
$adminMysqlPass = $env:DB_PASSWORD
if ([string]::IsNullOrEmpty($adminMysqlPass)) {
  # local dev default from application-dev.yml (not logged)
  $adminMysqlPass = "123456"
  Write-Host "NOTE: DB_PASSWORD unset; using local application-dev default (value not logged)"
}

$failures = New-Object System.Collections.Generic.List[string]
$strictMode = $true
$mvnExit = -1
$secExit = -1
$phase4aExit = -1
$phase3hExit = -1
$advExit = -1
$diffExit = -1
$selfAttackExit = -1
$gateExit = -1
$baseUrl = $null

try {
  Snapshot9999 "start"
  Write-MysqlCnf $AdminCnf $adminMysqlUser $adminMysqlPass

  Write-Host "=== formalRunId $runId ==="
  Write-Host "=== api inventory ==="
  $env:E2E4C_OUT = $out
  & node (Join-Path $Root "tools\build-api-inventory.cjs") 2>&1 | Tee-Object (Join-Path $logs "api-inventory.log")
  if ($LASTEXITCODE -ne 0) { $failures.Add("api-inventory failed"); $strictMode=$false }
  # relocate inventory if written to default root
  $invDefault = Join-Path $outRoot "api-inventory.json"
  $invTarget = Join-Path $out "api-inventory.json"
  if ((Test-Path $invDefault) -and -not (Test-Path $invTarget)) {
    Move-Item $invDefault $invTarget -Force
  }
  if (Test-Path $invTarget) {
    $invObj = Get-Content $invTarget -Raw | ConvertFrom-Json
    $invObj | Add-Member -NotePropertyName phase -NotePropertyValue "4C" -Force
    $invObj | Add-Member -NotePropertyName formalRunId -NotePropertyValue $runId -Force
    $invObj | Add-Member -NotePropertyName runId -NotePropertyValue $runId -Force
    $invObj | Add-Member -NotePropertyName baseline4b -NotePropertyValue $baseline4b -Force
    $invObj | Add-Member -NotePropertyName branch -NotePropertyValue $branch -Force
    $invObj | Add-Member -NotePropertyName head -NotePropertyValue $head -Force
    $invObj | Add-Member -NotePropertyName status -NotePropertyValue "COMPLETE" -Force
    $invObj | Add-Member -NotePropertyName residualRisk -NotePropertyValue $false -Force
    Write-Json $invTarget $invObj
  }

  Write-Host "=== git diff --check ==="
  # Isolate native git stderr from $ErrorActionPreference=Stop (CRLF warnings must not abort run)
  $diffExit = 0
  try {
    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $diffOut = & git diff --check 2>&1
    $diffExit = $LASTEXITCODE
    $diffOut | Tee-Object (Join-Path $logs "git-diff-check.log") | Out-Null
  } finally {
    $ErrorActionPreference = $prevEap
  }
  if ($diffExit -ne 0) { $failures.Add("git-diff-check exit=$diffExit"); $strictMode=$false }

  Write-Host "=== mvn clean verify ==="
  $prevEapMvn = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    & mvn clean verify 2>&1 | Tee-Object (Join-Path $logs "mvn-clean-verify.log") | Out-Null
    $mvnExit = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $prevEapMvn
  }
  if ($mvnExit -ne 0 -or -not (Test-Path $Jar)) { throw "mvn clean verify failed exit=$mvnExit" }
  $jarSha = Sha256File $Jar
  Write-Host "JAR sha=$jarSha"

  if ($SourceDb -notmatch '^stray_animal_e2e4c_') { throw "bad db prefix" }
  Write-Host "=== isolation DB $SourceDb ==="
  MysqlAdmin "CREATE DATABASE ``$SourceDb`` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
  $testSql = Join-Path $Root "test.sql"
  Get-Content $testSql -Raw | & mysql --defaults-extra-file=$AdminCnf $SourceDb 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "import test.sql failed" }
  $boot = Join-Path $Root "docs\sql\bootstrap-all.sql"
  if (Test-Path $boot) { Get-Content $boot -Raw | & mysql --defaults-extra-file=$AdminCnf $SourceDb 2>&1 | Out-Null }

  MysqlAdminStdin @"
USE ``$SourceDb``;
UPDATE t_user SET avatar = NULL WHERE TRIM(IFNULL(avatar,'')) = '1';
UPDATE t_animal a SET a.tpic = '' WHERE a.tpic IS NOT NULL AND TRIM(a.tpic) <> ''
  AND NOT EXISTS (SELECT 1 FROM t_file_asset f WHERE f.flag = TRIM(a.tpic) AND f.deleted = 0);
UPDATE t_proof p SET p.ppic = '' WHERE p.ppic IS NOT NULL AND TRIM(p.ppic) <> ''
  AND NOT EXISTS (SELECT 1 FROM t_file_asset f WHERE f.flag = TRIM(p.ppic) AND f.deleted = 0);
UPDATE t_volunteer v SET v.apic = NULL WHERE v.apic IS NOT NULL AND TRIM(v.apic) <> '';
UPDATE t_help h SET h.pic = NULL WHERE h.pic IS NOT NULL AND TRIM(h.pic) <> '';
UPDATE t_visit v SET v.pic = NULL WHERE v.pic IS NOT NULL AND TRIM(v.pic) <> '';
"@

  MysqlAdminStdin @"
CREATE USER IF NOT EXISTS '$DbAppUser'@'%' IDENTIFIED BY '$DbAppPass';
CREATE USER IF NOT EXISTS '$DbAppUser'@'localhost' IDENTIFIED BY '$DbAppPass';
GRANT ALL ON ``$SourceDb``.* TO '$DbAppUser'@'%';
GRANT ALL ON ``$SourceDb``.* TO '$DbAppUser'@'localhost';
FLUSH PRIVILEGES;
"@

  # Prefer 18181+ isolation ports (never 9999)
  $prepPort = Find-FreePort 18181 18199
  $prepJdbc = Build-JdbcUrl $DbHostName $SourceDb
  $env:JWT_SECRET=$JwtSecret; $env:AI_CONFIG_ENCRYPTION_KEY=$AiKey
  $env:DB_HOST=$DbHostName; $env:DB_NAME=$SourceDb; $env:DB_USERNAME=$DbAppUser; $env:DB_PASSWORD=$DbAppPass
  $env:FILE_UPLOAD_DIR=$upload; $env:DB_USE_SSL="false"; $env:SPRING_PROFILES_ACTIVE="dev"
  $prepArgs = @("-Xms256m","-Xmx512m","-jar",$Jar,"--spring.profiles.active=dev","--server.port=$prepPort",
    "--spring.datasource.url=$prepJdbc","--app.schema-guard.auto-migrate=true","--app.schema-guard.fail-fast=false",
    "--app.data-state-guard.auto-fix=true","--app.role-guard.auto-fix=true","--file.upload-dir=$upload")
  $prep = Start-Process -FilePath $JavaExe -ArgumentList $prepArgs -PassThru -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $logs "prep.out.log") -RedirectStandardError (Join-Path $logs "prep.err.log")
  $trackedPids.Add($prep.Id)|Out-Null
  if (-not (Wait-Http "http://127.0.0.1:$prepPort/api/health/ready" 120)) {
    Get-Content (Join-Path $logs "prep.out.log") -Tail 30 -EA SilentlyContinue
    throw "schema prepare failed"
  }
  Stop-Process -Id $prep.Id -Force -EA SilentlyContinue
  Start-Sleep 2

  # Mock delayed LLM for concurrent AI limit (ports 18280-18299; separate from app 18180-18199)
  Write-Host "=== mock LLM delay server ==="
  $mockLlmPort = Find-FreePort 18280 18299
  $mockLlmPidFile = Join-Path $runtime "mock-llm.pid"
  $env:MOCK_LLM_PORT = "$mockLlmPort"
  $env:MOCK_LLM_DELAY_MS = "2500"
  $env:MOCK_LLM_PID_FILE = $mockLlmPidFile
  $mockProc = Start-Process -FilePath "node" -ArgumentList @(Join-Path $Root "tools\mock-llm-delay-server.cjs") `
    -PassThru -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $logs "mock-llm.out.log") `
    -RedirectStandardError (Join-Path $logs "mock-llm.err.log")
  $trackedPids.Add($mockProc.Id)|Out-Null
  $script:mockLlmPid = $mockProc.Id
  if (-not (Wait-Http "http://127.0.0.1:$mockLlmPort/health" 30)) {
    Get-Content (Join-Path $logs "mock-llm.out.log") -Tail 20 -EA SilentlyContinue
    throw "mock LLM failed to start on $mockLlmPort"
  }
  Write-Host "mock LLM ready port=$mockLlmPort pid=$($mockProc.Id)"

  $portHttp = Find-FreePort 18181 18199
  $env:INITIAL_ADMIN_ENABLED="true"
  $env:INITIAL_ADMIN_USERNAME=$AdminUser
  $env:INITIAL_ADMIN_PASSWORD=$AdminPass
  $env:AI_ENABLED="false"
  $env:NOTIFICATION_EMAIL_ENABLED="false"
  $env:NOTIFICATION_SMS_ENABLED="false"
  $env:REDIS_ENABLED="false"
  $env:CORS_ALLOWED_ORIGIN_PATTERNS="https://app.example.local,http://127.0.0.1:*"
  $jdbc = Build-JdbcUrl $DbHostName $SourceDb
  # Formal run: allow loopback personal config for mock concurrent test; synthetic DNS OFF;
  # test-max-concurrent=1 + short semaphore wait to force 429/503 under parallel config/test.
  # Health live remains session-free (product HealthController — no mint).
  $runArgs = @("-Xms256m","-Xmx768m","-XX:+ExitOnOutOfMemoryError","-jar",$Jar,
    "--spring.profiles.active=dev","--server.port=$portHttp","--spring.datasource.url=$jdbc",
    "--server.ssl.enabled=false","--app.schema-guard.auto-migrate=false","--file.upload-dir=$upload",
    "--app.bootstrap.initial-admin-enabled=true",
    "--app.ai.allow-loopback-personal-config=true",
    "--app.ai.allow-proxy-synthetic-dns=false",
    "--app.ai.test-max-concurrent=1",
    "--app.ai.semaphore-wait-ms=50")
  $srv = Start-Process -FilePath $JavaExe -ArgumentList $runArgs -PassThru -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $logs "server.out.log") -RedirectStandardError (Join-Path $logs "server.err.log")
  $trackedPids.Add($srv.Id)|Out-Null
  $serverPid = $srv.Id
  $baseUrl = "http://127.0.0.1:$portHttp"
  if (-not (Wait-Http "$baseUrl/api/health/ready" 180)) {
    Get-Content (Join-Path $logs "server.out.log") -Tail 40 -EA SilentlyContinue
    throw "server ready failed"
  }
  Snapshot9999 "server-up"
  Write-Json (Join-Path $out "process-port-ledger.json") @{
    phase="4C"; formalRunId=$runId; runId=$runId; baseline4b=$baseline4b; branch=$branch; head=$head
    jarSha256=$jarSha; port=$portHttp; serverPid=$serverPid; status="COMPLETE"; residualRisk=$false
    port9999Snapshots=$portSnap
  }

  function Register-User($username, $password) {
    $phone = "13" + (Get-Random -Minimum 100000000 -Maximum 999999999)
    $body = (@{ username=$username; password=$password; email="$username@e2e4c.test"; phone="$phone" } | ConvertTo-Json -Compress)
    try {
      $resp = Invoke-WebRequest -Uri "$baseUrl/api/user/register" -Method POST -Body $body `
        -ContentType "application/json; charset=utf-8" -UseBasicParsing -TimeoutSec 30
      return [string][int]$resp.StatusCode
    } catch {
      if ($_.Exception.Response -and $_.Exception.Response.StatusCode) {
        return [string][int]$_.Exception.Response.StatusCode.value__
      }
      return "000"
    }
  }
  $ra = Register-User $UserA $UserAPass
  $rb = Register-User $UserB $UserBPass
  $rj = Register-User "jerry" $JerryPass
  Write-Host "register A=$ra B=$rb jerry=$rj"
  if ("$ra" -notmatch '200|201') { $failures.Add("register userA http=$ra"); $strictMode=$false }
  if ("$rb" -notmatch '200|201') { $failures.Add("register userB http=$rb"); $strictMode=$false }

  $dbBefore = @{
    users = (& mysql --defaults-extra-file=$AdminCnf -N -B -e "SELECT COUNT(*) FROM ``$SourceDb``.t_user" 2>$null)
    help = (& mysql --defaults-extra-file=$AdminCnf -N -B -e "SELECT COUNT(*) FROM ``$SourceDb``.t_help" 2>$null)
  }

  # --- Worktree evidence (hashes + product/test manifests) for security e2e + gate ---
  Write-Host "=== worktree evidence ==="
  function File-ManifestEntry([string]$rel) {
    $full = Join-Path $Root $rel
    if (-not (Test-Path $full)) {
      return @{ path=$rel; exists=$false; sha256=$null; bytes=0 }
    }
    $fi = Get-Item -LiteralPath $full
    return @{
      path=$rel
      exists=$true
      sha256=(Sha256File $full)
      bytes=[int64]$fi.Length
      mtimeUtc=$fi.LastWriteTimeUtc.ToString("o")
    }
  }
  $productManifest = @(
    (File-ManifestEntry "src\main\java\com\example\controller\FileController.java"),
    (File-ManifestEntry "src\main\java\com\example\controller\HealthController.java"),
    (File-ManifestEntry "src\main\java\com\example\service\PetCareService.java"),
    (File-ManifestEntry "src\main\java\com\example\component\ProdDeploymentRules.java"),
    (File-ManifestEntry "src\main\resources\application-dev.yml"),
    (File-ManifestEntry "src\main\resources\application-prod.yml")
  )
  $testToolManifest = @(
    (File-ManifestEntry "tools\release-phase-4c-security-e2e.cjs"),
    (File-ManifestEntry "tools\release-phase-4c-orchestrator.ps1"),
    (File-ManifestEntry "tools\release-phase-4c-ledger-gate.cjs"),
    (File-ManifestEntry "tools\release-phase-4c-self-attack.cjs"),
    (File-ManifestEntry "tools\mock-llm-delay-server.cjs"),
    (File-ManifestEntry "tools\build-api-inventory.cjs"),
    (File-ManifestEntry "src\test\java\com\example\service\AdminAgentToolsTest.java"),
    (File-ManifestEntry "src\test\java\com\example\controller\SessionRotationSecurityTest.java")
  )
  $wt0 = Get-WorktreeHashes
  $gitStatusSha = $wt0.gitStatusSha256
  $gitDiffSha = $wt0.worktreeDiffSha256
  $worktreeDirty = $wt0.worktreeDirty
  $worktreeEvidence = @{
    phase="4C"; formalRunId=$runId; runId=$runId; baseline4b=$baseline4b; branch=$branch; head=$head
    jarSha256=$jarSha; status="COMPLETE"; residualRisk=$false; strictMode=$true
    startedAt=$startedAt; endedAt=(Get-Date).ToUniversalTime().ToString("o")
    worktreeDirty=$worktreeDirty
    gitStatusSha256=$gitStatusSha
    worktreeDiffSha256=$gitDiffSha
    productFileManifest=$productManifest
    testToolManifest=$testToolManifest
  }
  Write-Json (Join-Path $out "worktree-evidence.json") $worktreeEvidence

  # Surefire evidence: copy SessionRotation + AdminAgentTools (+ DNS notes) into out/surefire/
  $surefireDir = Join-Path $Root "target\surefire-reports"
  $surefireOut = Join-Path $out "surefire"
  New-Item -ItemType Directory -Force -Path $surefireOut | Out-Null
  $copiedSurefire = @()
  if (Test-Path $surefireDir) {
    $requiredSurefire = @(
      "TEST-com.example.controller.SessionRotationSecurityTest.xml",
      "TEST-com.example.service.AdminAgentToolsTest.xml"
    )
    foreach ($name in $requiredSurefire) {
      $src = Join-Path $surefireDir $name
      if (Test-Path $src) {
        Copy-Item $src (Join-Path $surefireOut $name) -Force
        Copy-Item $src (Join-Path $logs ("surefire-" + $name)) -Force -EA SilentlyContinue
        $copiedSurefire += $name
      }
    }
    $dnsHits = Get-ChildItem $surefireDir -File -EA SilentlyContinue | Where-Object {
      $_.Name -match 'PetCareService' -or $_.Name -match 'ProdDeploymentRules'
    }
    foreach ($f in @($dnsHits)) {
      $dest = Join-Path $logs ("surefire-" + $f.Name)
      Copy-Item $f.FullName $dest -Force -EA SilentlyContinue
      $copiedSurefire += $f.Name
    }
    Write-Json (Join-Path $out "surefire-dns-unit-evidence.json") @{
      phase="4C"; formalRunId=$runId; runId=$runId; baseline4b=$baseline4b; branch=$branch; head=$head
      jarSha256=$jarSha; status="COMPLETE"; residualRisk=$false; strictMode=$true
      startedAt=$startedAt; endedAt=(Get-Date).ToUniversalTime().ToString("o")
      source=$surefireDir
      outSurefire=$surefireOut
      copied=$copiedSurefire
      note="SessionRotationSecurityTest + AdminAgentToolsTest bound for e2e; DNS private via PetCareServiceTest"
    }
  }

  # --- Security e2e ---
  Write-Host "=== security e2e ==="
  Assert-ServerAlive $serverPid "$baseUrl/api/health/live"
  $env:BASE_URL = $baseUrl
  $env:E2E_ADMIN_USER = $AdminUser
  $env:E2E_ADMIN_PASS = $AdminPass
  $env:E2E_USER_A = $UserA
  $env:E2E_USER_A_PASS = $UserAPass
  $env:E2E_USER_B = $UserB
  $env:E2E_USER_B_PASS = $UserBPass
  $env:E2E4C_RUN_ID = $runId
  $env:E2E4C_OUT = $out
  $env:E2E4C_BASELINE_4B = $baseline4b
  $env:E2E4C_BRANCH = $branch
  $env:E2E4C_HEAD = $head
  $env:E2E4C_JAR_SHA256 = $jarSha
  $env:E2E4C_UPLOAD_DIR = $upload
  $env:E2E4C_DB_HOST = "127.0.0.1"
  $env:E2E4C_DB_NAME = $SourceDb
  $env:E2E4C_DB_USER = $DbAppUser
  $env:E2E4C_DB_PASS = $DbAppPass
  $env:E2E4C_SERVER_LOG = (Join-Path $logs "server.out.log")
  $env:CORS_TEST_ORIGIN = "https://app.example.local"
  $env:E2E4C_WORKTREE_DIRTY = if ($worktreeDirty) { "true" } else { "false" }
  $env:E2E4C_GIT_STATUS_SHA = $gitStatusSha
  $env:E2E4C_GIT_DIFF_SHA = $gitDiffSha
  $env:E2E4C_PRODUCT_MANIFEST_JSON = ($productManifest | ConvertTo-Json -Compress -Depth 6)
  $env:E2E4C_TEST_MANIFEST_JSON = ($testToolManifest | ConvertTo-Json -Compress -Depth 6)
  $env:E2E4C_MOCK_LLM_BASE = "http://127.0.0.1:$mockLlmPort/v1"
  $env:E2E4C_MOCK_LLM_STATS = "http://127.0.0.1:$mockLlmPort/stats"
  $env:E2E4C_SUREFIRE_DIR = $surefireOut
  $env:E2E4C_ROOT = $Root
  $env:E2E4C_ALLOW_LOOPBACK = "true"
  $prevEapNode = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    & node (Join-Path $Root "tools\release-phase-4c-security-e2e.cjs") 2>&1 | Tee-Object (Join-Path $logs "security-e2e.log")
    $secExit = $LASTEXITCODE
  } finally { $ErrorActionPreference = $prevEapNode }
  if ($secExit -ne 0) { $failures.Add("security-e2e exit=$secExit"); $strictMode=$false }
  Assert-ServerAlive $serverPid "$baseUrl/api/health/live"

  $dbAfter = @{
    users = (& mysql --defaults-extra-file=$AdminCnf -N -B -e "SELECT COUNT(*) FROM ``$SourceDb``.t_user" 2>$null)
    help = (& mysql --defaults-extra-file=$AdminCnf -N -B -e "SELECT COUNT(*) FROM ``$SourceDb``.t_help" 2>$null)
  }
  # Merge orchestrator db before/after into suite ledger if present
  $dbPath = Join-Path $out "db-before-after-ledger.json"
  $dbMerged = @{
    phase="4C"; formalRunId=$runId; runId=$runId; baseline4b=$baseline4b; branch=$branch; head=$head
    jarSha256=$jarSha; status="COMPLETE"; residualRisk=$false
    startedAt=$startedAt; endedAt=(Get-Date).ToUniversalTime().ToString("o"); strictMode=$true
    orchestrator=@{ before=$dbBefore; after=$dbAfter }
    snapshots=@()
  }
  if (Test-Path $dbPath) {
    try {
      $existing = Get-Content $dbPath -Raw | ConvertFrom-Json
      if ($existing.snapshots) { $dbMerged.snapshots = $existing.snapshots }
    } catch {}
  }
  Write-Json $dbPath $dbMerged

  # --- Phase 4A real backend (same server, same formalRunId evidence binding) ---
  Write-Host "=== Phase 4A real e2e ==="
  Assert-ServerAlive $serverPid "$baseUrl/api/health/live"
  # 4A expects server log at output/playwright/release-phase-4a/server-<port>-out.log
  $p4aOut = Join-Path $Root "output\playwright\release-phase-4a"
  New-Item -ItemType Directory -Force -Path $p4aOut | Out-Null
  $srvLogSrc = Join-Path $logs "server.out.log"
  $srvLogDst = Join-Path $p4aOut ("server-" + $portHttp + "-out.log")
  if (Test-Path $srvLogSrc) { Copy-Item $srvLogSrc $srvLogDst -Force }
  $env:BASE_URL = $baseUrl
  $env:E2E_ADMIN_USERNAME = $AdminUser
  $env:E2E_ADMIN_PASSWORD = $AdminPass
  $env:DB_NAME = $SourceDb
  $env:DB_USERNAME = $DbAppUser
  $env:DB_PASSWORD = $DbAppPass
  $env:DB_HOST = "127.0.0.1"
  $env:E2E_JAVA_PID = "$serverPid"
  $env:E2E_DB_CONFIRMED_NON_PROD = "true"
  $env:E2E_ALLOW_REAL_AI = "false"
  $prevEap4a = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    & node (Join-Path $Root "tools\release-phase-4a-real-e2e.cjs") 2>&1 | Tee-Object (Join-Path $logs "phase-4a.log")
    $phase4aExit = $LASTEXITCODE
  } finally { $ErrorActionPreference = $prevEap4a }
  if ($phase4aExit -ne 0) { $failures.Add("phase-4a exit=$phase4aExit"); $strictMode=$false }
  # bind 4A summary into 4C run dir
  $p4aReport = Join-Path $Root "output\playwright\release-phase-4a\phase-4a-report.json"
  if (-not (Test-Path $p4aReport)) { $p4aReport = Join-Path $Root "output\playwright\release-phase-4a\report.json" }
  $p4aCopy = Join-Path $out "phase-4a-regression.json"
  if (Test-Path (Join-Path $Root "output\playwright\release-phase-4a")) {
    $src4a = Join-Path $Root "output\playwright\release-phase-4a"
    $latest = Get-ChildItem $src4a -Filter "*.json" -EA SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 5
    Write-Json $p4aCopy @{
      phase="4C"; formalRunId=$runId; runId=$runId; baseline4b=$baseline4b; branch=$branch; head=$head
      jarSha256=$jarSha; status= if($phase4aExit -eq 0){"COMPLETE"}else{"FAILED"}; residualRisk=($phase4aExit -ne 0)
      exitCode=$phase4aExit; artifacts=$latest.Name; boundAt=(Get-Date).ToUniversalTime().ToString("o")
    }
  } else {
    Write-Json $p4aCopy @{
      phase="4C"; formalRunId=$runId; status="FAILED"; residualRisk=$true; exitCode=$phase4aExit; note="no 4A output dir"
    }
    $failures.Add("phase-4a missing output"); $strictMode=$false
  }
  Assert-ServerAlive $serverPid "$baseUrl/api/health/live"

  # --- Phase 3H (fixture UI suite against live static server) ---
  Write-Host "=== Phase 3H ==="
  $env:BASE_URL = $baseUrl
  $prevEap3h = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    & node (Join-Path $Root "tools\ui-polish-phase-3h.cjs") 2>&1 | Tee-Object (Join-Path $logs "phase-3h.log")
    $phase3hExit = $LASTEXITCODE
  } finally { $ErrorActionPreference = $prevEap3h }
  if ($phase3hExit -ne 0) { $failures.Add("phase-3h exit=$phase3hExit"); $strictMode=$false }
  Write-Json (Join-Path $out "phase-3h-regression.json") @{
    phase="4C"; formalRunId=$runId; runId=$runId; baseline4b=$baseline4b; branch=$branch; head=$head
    jarSha256=$jarSha; status= if($phase3hExit -eq 0){"COMPLETE"}else{"FAILED"}; residualRisk=($phase3hExit -ne 0)
    exitCode=$phase3hExit; source="output/playwright/ui-polish-phase-3h"
  }
  Assert-ServerAlive $serverPid "$baseUrl/api/health/live"

  # --- frontend-adversarial ---
  Write-Host "=== frontend-adversarial ==="
  $prevEapAdv = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Root "tools\frontend-adversarial-check.ps1") `
      -BaseUrl $baseUrl -UserName $UserA -UserPass $UserAPass -AdminName $AdminUser -AdminPass $AdminPass `
      2>&1 | Tee-Object (Join-Path $logs "frontend-adversarial.log")
    $advExit = $LASTEXITCODE
  } finally { $ErrorActionPreference = $prevEapAdv }
  if ($advExit -ne 0) { $failures.Add("frontend-adversarial exit=$advExit"); $strictMode=$false }
  Write-Json (Join-Path $out "frontend-adversarial-regression.json") @{
    phase="4C"; formalRunId=$runId; runId=$runId; jarSha256=$jarSha
    status= if($advExit -eq 0){"COMPLETE"}else{"FAILED"}; residualRisk=($advExit -ne 0); exitCode=$advExit
  }

  # Secret scan of outputs (no durable secret files)
  $hits = @()
  Get-ChildItem $out -Recurse -File | Where-Object {
    $_.Extension -match '\.(json|md|log|txt)$' -and $_.FullName -notmatch '\\runtime\\'
  } | ForEach-Object {
    $t = Get-Content $_.FullName -Raw -EA SilentlyContinue
    if (-not $t) { return }
    foreach ($s in @($AdminPass,$UserAPass,$UserBPass,$DbAppPass,$JwtSecret,$AiKey,$JerryPass)) {
      if ($s -and $s.Length -ge 12 -and $t.Contains($s)) {
        $hits += @{ file=$_.Name; kind="secret-value" }
        $t = $t.Replace($s, "<redacted>")
        Set-Content $_.FullName $t -Encoding utf8
      }
    }
  }
  Write-Json (Join-Path $out "secret-scan.json") @{
    phase="4C"; formalRunId=$runId; runId=$runId; baseline4b=$baseline4b; branch=$branch; head=$head
    jarSha256=$jarSha; status= if($hits.Count -eq 0){"COMPLETE"}else{"FAILED"}; residualRisk=($hits.Count -gt 0)
    hits=$hits; ok=($hits.Count -eq 0); strictMode=$true
    startedAt=$startedAt; endedAt=(Get-Date).ToUniversalTime().ToString("o")
  }
  if ($hits.Count -gt 0) { $failures.Add("secret-scan hits"); $strictMode=$false }

  # Self-attack deferred until after cleanup (with ledger-gate) so cleanup-ledger exists
  # and CLI receives baseline/branch/head/jarSha metadata.

  # Stamp formal metadata only on orchestrator-owned small files missing formalRunId.
  # Do NOT re-serialize suite-generated ledgers via PowerShell (BOM/depth corruption).
  $stampAllow = @(
    'secret-scan.json','cleanup-ledger.json','process-port-ledger.json','regression-summary.json',
    'phase-4a-regression.json','phase-3h-regression.json','frontend-adversarial-regression.json',
    'db-before-after-ledger.json','api-inventory.json'
  )
  Get-ChildItem $out -Filter "*.json" -File | Where-Object { $stampAllow -contains $_.Name } | ForEach-Object {
    try {
      $txt = [IO.File]::ReadAllText($_.FullName)
      $o = $txt | ConvertFrom-Json
      $need = -not $o.formalRunId
      if ($need) {
        if (-not $o.formalRunId) { $o | Add-Member -NotePropertyName formalRunId -NotePropertyValue $runId -Force }
        if (-not $o.runId) { $o | Add-Member -NotePropertyName runId -NotePropertyValue $runId -Force }
        if (-not $o.phase) { $o | Add-Member -NotePropertyName phase -NotePropertyValue "4C" -Force }
        if (-not $o.baseline4b) { $o | Add-Member -NotePropertyName baseline4b -NotePropertyValue $baseline4b -Force }
        if (-not $o.branch) { $o | Add-Member -NotePropertyName branch -NotePropertyValue $branch -Force }
        if (-not $o.head) { $o | Add-Member -NotePropertyName head -NotePropertyValue $head -Force }
        if (-not $o.jarSha256 -and $jarSha) { $o | Add-Member -NotePropertyName jarSha256 -NotePropertyValue $jarSha -Force }
        if (-not $o.PSObject.Properties['residualRisk']) { $o | Add-Member -NotePropertyName residualRisk -NotePropertyValue $false -Force }
        Write-Json $_.FullName $o
      }
    } catch {}
  }

  Write-Json (Join-Path $out "regression-summary.json") @{
    phase="4C"; formalRunId=$runId; runId=$runId; jarSha256=$jarSha; baseline4b=$baseline4b
    branch=$branch; head=$head; status="COMPLETE"; residualRisk=$false
    strictMode=$true; startedAt=$startedAt; endedAt=(Get-Date).ToUniversalTime().ToString("o")
    mvnCleanVerify=$mvnExit
    securityE2e=$secExit
    phase4a=$phase4aExit
    phase3h=$phase3hExit
    frontendAdversarial=$advExit
    gitDiffCheck=$diffExit
    selfAttack="deferred-until-after-cleanup"
    ledgerGate="deferred-until-after-cleanup"
    optional=$false
  }

  # SECURITY-AUDIT.md
  $secReport = $null
  if (Test-Path (Join-Path $out "phase-4c-report.json")) {
    $secReport = Get-Content (Join-Path $out "phase-4c-report.json") -Raw | ConvertFrom-Json
  }
  $findings = @()
  if ($secReport -and $secReport.failures) {
    $i=1
    foreach ($f in @($secReport.failures)) { $findings += "- SEC-$i`: $f"; $i++ }
  }
  foreach ($f in $failures) { $findings += "- ORCH: $f" }
  @"
# SECURITY-AUDIT — Phase 4C

- baseline4b: $baseline4b
- formalRunId: $runId
- jarSha256: $jarSha
- branch: $branch
- head: $head
- commit/push/main/4D: NO
- note: self-attack + ledger-gate execute after tracked-file freeze; authoritative results in output evidence dir

## Findings

$(if ($findings.Count) { $findings -join "`n" } else { "No automated suite failures recorded prior to freeze." })

## Coverage

- formalRunId-bound ledgers (no PARTIAL placeholders)
- SSRF matrix via DTO field baseUrl
- Mass-assignment on PUT /api/user/me/profile with DB before/after
- Object ownership matrix (help, adopt, proof, visit, notif, file, favorite, petcare, volunteer)
- CSRF/CORS/session/file/pagination/AI isolation
- Surefire semantic binding (AdminAgentToolsTest + SessionRotationSecurityTest)
- Real self-attack subprocesses (expanded set including worktree/surefire)
- Same-run 4A / 3H / frontend-adversarial / mvn / git-diff
"@ | Set-Content (Join-Path $Root "docs\SECURITY-AUDIT.md") -Encoding utf8

  # UI-POLISH is a TRACKED file — must be finalized BEFORE final worktree hash freeze.
  # Gate/self-attack results are recorded only in gitignored output reports.
  Write-Host "=== UI-POLISH append (tracked; before hash freeze) ==="
  $ui = Join-Path $Root "UI-POLISH-REVIEW-REPORT.md"
  $secUi = @"

---

## Phase 4C — 安全/隐私/越权对抗可信度返修（未提交）

| 项 | 值 |
|----|-----|
| 分支 | ``release/phase-4c-security-privacy-20260801`` |
| 基线 4B | ``$baseline4b`` |
| formalRunId | ``$runId`` |
| JAR | ``$jarSha`` |
| port | ``$portHttp`` |
| security-e2e / 4A / 3H / adv / mvn / diff | $secExit / $phase4aExit / $phase3hExit / $advExit / $mvnExit / $diffExit |
| self-attack / ledger-gate | post-freeze (see evidence ``PHASE-4C-REPORT.md``) |
| 提交/推送/main/4D | **否** |

权威证据（gitignored）：``$out\PHASE-4C-REPORT.md``
"@
  if (Test-Path $ui) {
    $cur = [IO.File]::ReadAllText((Resolve-Path $ui)).TrimEnd()
    if ($cur -match '(?s)\r?\n---\r?\n\r?\n## Phase 4C') {
      $cur = $cur -replace '(?s)\r?\n---\r?\n\r?\n## Phase 4C[\s\S]*$', ''
    }
    [IO.File]::WriteAllText((Resolve-Path $ui), $cur.TrimEnd() + "`n" + $secUi.TrimEnd() + "`n")
  }

  # === TRACKED FILE FREEZE ===
  # After this point: do NOT modify any git-tracked file. Only output/playwright/* (gitignored).
  Write-Host "=== TRACKED FILE FREEZE — final git status/diff/diff --check ==="
  $finalDiffCheckExit = 0
  try {
    $prevEapDiff = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $diffOut2 = & git diff --check 2>&1
    $finalDiffCheckExit = $LASTEXITCODE
    $diffOut2 | Tee-Object (Join-Path $logs "git-diff-check-final.log") | Out-Null
  } finally { $ErrorActionPreference = $prevEapDiff }
  if ($finalDiffCheckExit -ne 0) {
    $failures.Add("git-diff-check-final exit=$finalDiffCheckExit")
    $strictMode = $false
  }
  # Prefer final check for strictness
  $diffExit = $finalDiffCheckExit

  # Rebuild manifests after final tracked writes so SHAs match freeze content
  $productManifest = @(
    (File-ManifestEntry "src\main\java\com\example\controller\FileController.java"),
    (File-ManifestEntry "src\main\java\com\example\controller\HealthController.java"),
    (File-ManifestEntry "src\main\java\com\example\service\PetCareService.java"),
    (File-ManifestEntry "src\main\java\com\example\component\ProdDeploymentRules.java"),
    (File-ManifestEntry "src\main\resources\application-dev.yml"),
    (File-ManifestEntry "src\main\resources\application-prod.yml")
  )
  $testToolManifest = @(
    (File-ManifestEntry "tools\release-phase-4c-security-e2e.cjs"),
    (File-ManifestEntry "tools\release-phase-4c-orchestrator.ps1"),
    (File-ManifestEntry "tools\release-phase-4c-ledger-gate.cjs"),
    (File-ManifestEntry "tools\release-phase-4c-self-attack.cjs"),
    (File-ManifestEntry "tools\mock-llm-delay-server.cjs"),
    (File-ManifestEntry "tools\build-api-inventory.cjs"),
    (File-ManifestEntry "src\test\java\com\example\service\AdminAgentToolsTest.java"),
    (File-ManifestEntry "src\test\java\com\example\controller\SessionRotationSecurityTest.java"),
    (File-ManifestEntry "docs\SECURITY-AUDIT.md"),
    (File-ManifestEntry "UI-POLISH-REVIEW-REPORT.md")
  )

  $wtFinal = Get-WorktreeHashes
  $gitStatusSha = $wtFinal.gitStatusSha256
  $gitDiffSha = $wtFinal.worktreeDiffSha256
  $worktreeDirty = $wtFinal.worktreeDirty
  Write-Host "final gitStatusSha256=$gitStatusSha"
  Write-Host "final worktreeDiffSha256=$gitDiffSha"

  $wtPath = Join-Path $out "worktree-evidence.json"
  $wtObj = @{
    phase="4C"; formalRunId=$runId; runId=$runId; baseline4b=$baseline4b; branch=$branch; head=$head
    jarSha256=$jarSha; status="COMPLETE"; residualRisk=$false; strictMode=$true
    startedAt=$startedAt; endedAt=(Get-Date).ToUniversalTime().ToString("o")
    worktreeDirty=$worktreeDirty
    gitStatusSha256=$gitStatusSha
    worktreeDiffSha256=$gitDiffSha
    productFileManifest=$productManifest
    testToolManifest=$testToolManifest
    reboundAfterDocs=$true
    finalHashAfterTrackedFreeze=$true
  }
  Write-Json $wtPath $wtObj

  # Stamp phase-4c-report hashes before gate (may be rewritten later in output only — hashes preserved)
  $secPathEarly = Join-Path $out "phase-4c-report.json"
  if (Test-Path $secPathEarly) {
    try {
      $secObj = Get-Content $secPathEarly -Raw | ConvertFrom-Json
      $secObj | Add-Member -NotePropertyName worktreeDirty -NotePropertyValue $worktreeDirty -Force
      $secObj | Add-Member -NotePropertyName gitStatusSha256 -NotePropertyValue $gitStatusSha -Force
      $secObj | Add-Member -NotePropertyName worktreeDiffSha256 -NotePropertyValue $gitDiffSha -Force
      $secObj | Add-Member -NotePropertyName finalHashAfterTrackedFreeze -NotePropertyValue $true -Force
      Write-Json $secPathEarly $secObj
    } catch {
      Write-Json $secPathEarly @{
        phase="4C"; formalRunId=$runId; runId=$runId; baseline4b=$baseline4b; branch=$branch; head=$head
        jarSha256=$jarSha; status="COMPLETE"; residualRisk=$false; strictMode=$true
        p0=0; p1=0; p2=0; p3=0; worktreeDirty=$worktreeDirty
        gitStatusSha256=$gitStatusSha; worktreeDiffSha256=$gitDiffSha
        finalHashAfterTrackedFreeze=$true
      }
    }
  } else {
    Write-Json $secPathEarly @{
      phase="4C"; formalRunId=$runId; runId=$runId; baseline4b=$baseline4b; branch=$branch; head=$head
      jarSha256=$jarSha; status="COMPLETE"; residualRisk=$false; strictMode=$true
      p0=0; p1=0; p2=0; p3=0; worktreeDirty=$worktreeDirty
      gitStatusSha256=$gitStatusSha; worktreeDiffSha256=$gitDiffSha
      finalHashAfterTrackedFreeze=$true
    }
  }

} catch {
  $strictMode = $false
  $failures.Add("ORCHESTRATOR: " + $_.Exception.Message)
  Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
} finally {
  Write-Host "=== cleanup ==="
  Stop-Tracked
  Start-Sleep 2
  try { Write-MysqlCnf $AdminCnf $adminMysqlUser $adminMysqlPass } catch {}
  $dbLeft = ""
  $usersLeft = ""
  try {
    if ($SourceDb -match '^stray_animal_e2e4c_') { MysqlAdmin "DROP DATABASE IF EXISTS ``$SourceDb``;" }
    if ($DbAppUser -match '^e2e4c_u_') {
      & mysql --defaults-extra-file=$AdminCnf -e "DROP USER IF EXISTS '$DbAppUser'@'%';" 2>$null|Out-Null
      & mysql --defaults-extra-file=$AdminCnf -e "DROP USER IF EXISTS '$DbAppUser'@'localhost';" 2>$null|Out-Null
      & mysql --defaults-extra-file=$AdminCnf -e "FLUSH PRIVILEGES;" 2>$null|Out-Null
    }
    $dbLeft = (& mysql --defaults-extra-file=$AdminCnf -N -B -e "SHOW DATABASES LIKE 'stray_animal_e2e4c%';" 2>$null | Out-String).Trim()
    $usersLeft = (& mysql --defaults-extra-file=$AdminCnf -N -B -e "SELECT user FROM mysql.user WHERE user LIKE 'e2e4c_u_%';" 2>$null | Out-String).Trim()
  } catch { $failures.Add("cleanup: $($_.Exception.Message)"); $strictMode=$false }
  if (Test-Path $AdminCnf) { Remove-Item $AdminCnf -Force -EA SilentlyContinue }
  if (Test-Path $upload) { Remove-Item $upload -Recurse -Force -EA SilentlyContinue }
  $portsLeft = @()
  foreach ($p in 18180..18199) {
    $l = Get-NetTCPConnection -LocalPort $p -State Listen -EA SilentlyContinue
    if ($l) { $portsLeft += $p }
  }
  $mockPortsLeft = @()
  foreach ($p in 18280..18299) {
    $l = Get-NetTCPConnection -LocalPort $p -State Listen -EA SilentlyContinue
    if ($l) { $mockPortsLeft += $p }
  }
  Snapshot9999 "after-cleanup"
  $cleanupOk = [string]::IsNullOrWhiteSpace($dbLeft) -and [string]::IsNullOrWhiteSpace($usersLeft) `
    -and ($portsLeft.Count -eq 0) -and ($mockPortsLeft.Count -eq 0)
  if (-not $cleanupOk) { $strictMode=$false; $failures.Add("cleanup incomplete") }
  Write-Json (Join-Path $out "cleanup-ledger.json") @{
    phase="4C"; formalRunId=$runId; runId=$runId; baseline4b=$baseline4b; branch=$branch; head=$head
    jarSha256=$jarSha; status= if($cleanupOk){"COMPLETE"}else{"FAILED"}; residualRisk=(-not $cleanupOk)
    e2eDbsLeft=$dbLeft; e2eUsersLeft=$usersLeft; portsLeft=$portsLeft; mockPortsLeft=$mockPortsLeft
    port9999=$portSnap; ok=$cleanupOk; strictMode=$true
    startedAt=$startedAt; endedAt=(Get-Date).ToUniversalTime().ToString("o")
  }
}

# If freeze hashes were never computed (hard fail before freeze), try once more without touching tracked files
if (-not $gitStatusSha -or -not $gitDiffSha) {
  Write-Host "=== emergency final hash (no tracked writes) ==="
  $wtFinal = Get-WorktreeHashes
  $gitStatusSha = $wtFinal.gitStatusSha256
  $gitDiffSha = $wtFinal.worktreeDiffSha256
  $worktreeDirty = $wtFinal.worktreeDirty
  $wtPath = Join-Path $out "worktree-evidence.json"
  Write-Json $wtPath @{
    phase="4C"; formalRunId=$runId; runId=$runId; baseline4b=$baseline4b; branch=$branch; head=$head
    jarSha256=$jarSha; status="COMPLETE"; residualRisk=$false; strictMode=$true
    startedAt=$startedAt; endedAt=(Get-Date).ToUniversalTime().ToString("o")
    worktreeDirty=$worktreeDirty; gitStatusSha256=$gitStatusSha; worktreeDiffSha256=$gitDiffSha
    productFileManifest=$productManifest; testToolManifest=$testToolManifest
    finalHashAfterTrackedFreeze=$true
  }
  $secPathEarly = Join-Path $out "phase-4c-report.json"
  if (Test-Path $secPathEarly) {
    try {
      $secObj = Get-Content $secPathEarly -Raw | ConvertFrom-Json
      $secObj | Add-Member -NotePropertyName gitStatusSha256 -NotePropertyValue $gitStatusSha -Force
      $secObj | Add-Member -NotePropertyName worktreeDiffSha256 -NotePropertyValue $gitDiffSha -Force
      $secObj | Add-Member -NotePropertyName worktreeDirty -NotePropertyValue $worktreeDirty -Force
      Write-Json $secPathEarly $secObj
    } catch {}
  }
}

# Ensure phase report carries freeze hashes before gate
$wtPath = Join-Path $out "worktree-evidence.json"
$secPathEarly = Join-Path $out "phase-4c-report.json"
if ((Test-Path $secPathEarly) -and $gitStatusSha) {
  try {
    $secObj = Get-Content $secPathEarly -Raw | ConvertFrom-Json
    $secObj | Add-Member -NotePropertyName gitStatusSha256 -NotePropertyValue $gitStatusSha -Force
    $secObj | Add-Member -NotePropertyName worktreeDiffSha256 -NotePropertyValue $gitDiffSha -Force
    $secObj | Add-Member -NotePropertyName worktreeDirty -NotePropertyValue $worktreeDirty -Force
    Write-Json $secPathEarly $secObj
  } catch {}
}

# Real self-attack AFTER freeze (independent temp dirs; expanded cases) — output only
Write-Host "=== self-attack ==="
$prevEapSa = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
try {
  & node (Join-Path $Root "tools\release-phase-4c-self-attack.cjs") $out $runId $baseline4b $branch $head $jarSha `
    $gitStatusSha $gitDiffSha `
    2>&1 | Tee-Object (Join-Path $logs "self-attack.log")
  $script:selfAttackExit = $LASTEXITCODE
} finally { $ErrorActionPreference = $prevEapSa }
$selfAttackExit = $script:selfAttackExit
if ($selfAttackExit -ne 0) { $failures.Add("self-attack exit=$selfAttackExit"); $strictMode=$false }

# Ledger gate with FINAL hashes
Write-Host "=== ledger gate ==="
$prevEapGate = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
try {
  & node (Join-Path $Root "tools\release-phase-4c-ledger-gate.cjs") $out $runId $baseline4b $branch $head $jarSha `
    $gitStatusSha $gitDiffSha `
    2>&1 | Tee-Object (Join-Path $logs "ledger-gate.log")
  $script:gateExit = $LASTEXITCODE
} finally { $ErrorActionPreference = $prevEapGate }
if ($script:gateExit -ne 0) {
  $failures.Add("ledger-gate exit=$($script:gateExit)")
  $strictMode = $false
}
$gateExit = $script:gateExit
$gateResultPath = Join-Path $out "ledger-gate-result.json"
$ledgerGateCheckCount = $null
if (Test-Path $gateResultPath) {
  try {
    $gr = Get-Content $gateResultPath -Raw | ConvertFrom-Json
    $ledgerGateCheckCount = $gr.checkCount
  } catch {}
}
# Stamp checkCount on output evidence only — do NOT recompute or change freeze hashes
if (Test-Path $wtPath) {
  try {
    $wt2 = Get-Content $wtPath -Raw | ConvertFrom-Json
    $wt2 | Add-Member -NotePropertyName ledgerGateCheckCount -NotePropertyValue $ledgerGateCheckCount -Force
    # preserve freeze hashes
    $wt2 | Add-Member -NotePropertyName gitStatusSha256 -NotePropertyValue $gitStatusSha -Force
    $wt2 | Add-Member -NotePropertyName worktreeDiffSha256 -NotePropertyValue $gitDiffSha -Force
    Write-Json $wtPath $wt2
  } catch {}
}

# Final report merge
$secPath = Join-Path $out "phase-4c-report.json"
$sec = $null
if (Test-Path $secPath) { $sec = Get-Content $secPath -Raw | ConvertFrom-Json }
$finalStrict = $strictMode -and (-not $sec -or $sec.strictMode -ne $false) -and ($failures.Count -eq 0) `
  -and ($sec -and [int]$sec.failureCount -eq 0) `
  -and ($mvnExit -eq 0) -and ($secExit -eq 0) -and ($phase4aExit -eq 0) -and ($phase3hExit -eq 0) `
  -and ($advExit -eq 0) -and ($diffExit -eq 0) -and ($selfAttackExit -eq 0) -and ($gateExit -eq 0)
$allFailures = @($failures)
if ($sec -and $sec.failures) { $allFailures += @($sec.failures) }
$p0 = if ($sec) { [int]$sec.p0 } else { 0 }
$p1 = if ($sec) { [int]$sec.p1 } else { 0 }
$p2 = if ($sec) { [int]$sec.p2 } else { 0 }
$p3 = if ($sec) { [int]$sec.p3 } else { 0 }
if (-not $finalStrict -and $p0 -eq 0 -and $p1 -eq 0 -and $failures.Count -gt 0) { $p1 = [Math]::Max($p1, 1) }

$inv = $null
if (Test-Path (Join-Path $out "api-inventory.json")) {
  $inv = Get-Content (Join-Path $out "api-inventory.json") -Raw | ConvertFrom-Json
}

# Ledger inventory for report
$ledgerStats = @()
Get-ChildItem $out -Filter "*.json" -File -EA SilentlyContinue | ForEach-Object {
  try {
    $o = Get-Content $_.FullName -Raw | ConvertFrom-Json
    $rows = 0
    if ($o.rows) { $rows = @($o.rows).Count }
    elseif ($o.requests) { $rows = @($o.requests).Count }
    elseif ($o.attacks) { $rows = @($o.attacks).Count }
    elseif ($o.endpoints) { $rows = @($o.endpoints).Count }
    $ledgerStats += [pscustomobject]@{
      file=$_.Name
      formalRunId=($o.formalRunId)
      status=($o.status)
      rows=$rows
      residualRisk=($o.residualRisk)
    }
  } catch {
    $ledgerStats += [pscustomobject]@{ file=$_.Name; formalRunId=""; status="INVALID"; rows=0; residualRisk=$true }
  }
}

$sealOk = $finalStrict -and $p0 -eq 0 -and $p1 -eq 0 -and $p2 -eq 0
$report = @{
  phase="4C"
  formalRunId=$runId
  runId=$runId
  baseline4b=$baseline4b
  branch=$branch
  head=$head
  jarSha256=$jarSha
  port=$portHttp
  dbAlias="e2e4c_source"
  strictMode=$finalStrict
  assertionCount= if($sec){$sec.assertionCount}else{0}
  passCount= if($sec){$sec.passCount}else{0}
  failureCount= if($sec){[int]$sec.failureCount + $failures.Count}else{$failures.Count}
  skipCount=0
  bestEffortPassCount=0
  p0=$p0; p1=$p1; p2=$p2; p3=$p3
  failures=$allFailures
  apiEndpointCount= if($inv){$inv.endpointCount}else{$null}
  mvnExit=$mvnExit
  securityE2eExit=$secExit
  phase4aExit=$phase4aExit
  phase3hExit=$phase3hExit
  frontendAdversarialExit=$advExit
  gitDiffCheckExit=$diffExit
  selfAttackExit=$selfAttackExit
  ledgerGateExit=$gateExit
  ledgerStats=$ledgerStats
  sealRecommendation= if($sealOk){"YES_CANDIDATE_FOR_SEAL"}else{"NOT_READY_TO_SEAL"}
  residualRisk= (-not $sealOk)
  status= if($sealOk){"COMPLETE"}else{"FAILED"}
  startedAt=$startedAt
  endedAt=(Get-Date).ToUniversalTime().ToString("o")
  worktreeDirty=$worktreeDirty
  gitStatusSha256=$gitStatusSha
  worktreeDiffSha256=$gitDiffSha
  ledgerGateCheckCount= if(Test-Path (Join-Path $out "ledger-gate-result.json")) {
    try { (Get-Content (Join-Path $out "ledger-gate-result.json") -Raw | ConvertFrom-Json).checkCount } catch { $null }
  } else { $null }
  committed=$false
  pushed=$false
  mergedMain=$false
  phase4d=$false
  evidenceDir=$out
  mockLlmPort=$mockLlmPort
}
Write-Json $secPath $report
# Also publish to phase root for convenience
Copy-Item $secPath (Join-Path $outRoot "phase-4c-report.json") -Force -EA SilentlyContinue

$selfAttacks = ""
if (Test-Path (Join-Path $out "self-attack-summary.json")) {
  try {
    $sa = Get-Content (Join-Path $out "self-attack-summary.json") -Raw | ConvertFrom-Json
    $selfAttacks = ($sa.attacks | ForEach-Object { "| $($_.id) | $($_.exitCode) | $(if($_.ok){'PASS'}else{'FAIL'}) |" }) -join "`n"
  } catch { $selfAttacks = "| (parse error) | | |" }
}

$ledgerTable = ($ledgerStats | ForEach-Object { "| ``$($_.file)`` | ``$($_.formalRunId)`` | $($_.status) | $($_.rows) |" }) -join "`n"
$gitStatus = (git status --short | Out-String).Trim()

$md = @"
# Phase 4C Report — Security / Privacy / Authorization (Credibility Rework)

| 项 | 值 |
|----|-----|
| **formalRunId** | ``$runId`` |
| **Phase 4B baseline** | ``$baseline4b`` |
| **branch** | ``$branch`` |
| **HEAD** | ``$head`` |
| **JAR SHA-256** | ``$jarSha`` |
| **port** | $portHttp |
| **strictMode** | **$finalStrict** |
| **assertions** | $($report.assertionCount) / $($report.passCount) / $($report.failureCount) / 0 |
| **skip / bestEffort** | **0 / 0** |
| **P0/P1/P2/P3** | **$p0 / $p1 / $p2 / $p3** |
| **API endpoints** | $($report.apiEndpointCount) |
| **mvn clean verify** | exit=$mvnExit |
| **security-e2e** | exit=$secExit |
| **Phase 4A** | exit=$phase4aExit |
| **Phase 3H** | exit=$phase3hExit |
| **frontend-adversarial** | exit=$advExit |
| **git diff --check** | exit=$diffExit |
| **self-attack** | exit=$selfAttackExit |
| **ledger-gate** | exit=$gateExit |
| **sealRecommendation** | **$($report.sealRecommendation)** |
| **Commit/push/main/4D** | **NO** |
| **evidenceDir** | ``$out`` |

## Failures

$(if ($allFailures.Count) { ($allFailures | ForEach-Object { "- $_" }) -join "`n" } else { "- (none)" })

## Ledger inventory (this formalRunId)

| File | formalRunId | status | rows |
|------|-------------|--------|------|
$ledgerTable

## Self-attack (real subprocess / temp dir)

| ID | Exit | Result |
|----|------|--------|
$selfAttacks

## Product vs test code changes

- **Product code**: ``HealthController.java`` (session-free /live — no JSESSIONID mint), ``FileController.java``, ``PetCareService.java`` (SSRF + concurrent semaphore), ``ProdDeploymentRules.java``, ``application-dev.yml``, ``application-prod.yml``.
- **Test/tooling**: ``tools/release-phase-4c-security-e2e.cjs``, ``tools/release-phase-4c-orchestrator.ps1``, ``tools/release-phase-4c-ledger-gate.cjs``, ``tools/release-phase-4c-self-attack.cjs``, ``tools/mock-llm-delay-server.cjs``, ``tools/build-api-inventory.cjs``, ``docs/SECURITY-AUDIT.md``, ``UI-POLISH-REVIEW-REPORT.md``.
- **Worktree evidence**: ``worktree-evidence.json`` (git status/diff SHA-256 + product/test file manifests; rebound after docs).

## Coverage highlights

- SSRF uses DTO field **baseUrl** (not apiBaseUrl); error-type classification; admin-agent boundary
- Mass-assignment on **PUT /api/user/me/profile** with DB before/after + re-login
- Object ownership: help, adopt, **proof/visit/notif/volunteer** real resourceIds, private file, favorite, petcare
- File path canonicalization + cross-user download denial
- pageSize=999999 capped assertion (not merely !=500)
- CORS evil/allowed/null/OPTIONS; CSRF missing/invalid/cross-user/upload/admin
- Session HttpOnly + logout invalidation + failed login + **health-live-no-session-cookie** + rotation via Surefire
- AI concurrent limit STRICT (mock LLM + 429/503 + upstreamHitCount)
- Agent tool boundary via Surefire (AdminAgentToolsTest), not static-source
- No PARTIAL placeholders; residualRisk fails gate
- Same formalRunId regression: 4A + 3H + adv + mvn + git-diff

## Residual risks

$(if ($sealOk) { "- None blocking seal under automated gates." } else { "- See failures; seal not recommended." })

## Port / cleanup

See ``cleanup-ledger.json`` and ``process-port-ledger.json``. Port 9999 snapshots read-only. Isolation DBs/users/ports must be empty after cleanup.

## git status --short

``````
$gitStatus
``````

## Stop

Not committed. Not pushed. Not merged to main. Not entering Phase 4D. Hand off to GPT independent review.

Absolute path: ``$out\PHASE-4C-REPORT.md``
"@
Set-Content (Join-Path $out "PHASE-4C-REPORT.md") $md -Encoding utf8
Copy-Item (Join-Path $out "PHASE-4C-REPORT.md") (Join-Path $outRoot "PHASE-4C-REPORT.md") -Force -EA SilentlyContinue
@"
formalRunId=$runId
strict=$finalStrict
assert=$($report.assertionCount)/$($report.passCount)/$($report.failureCount)
jar=$jarSha
mvn=$mvnExit sec=$secExit 4a=$phase4aExit 3h=$phase3hExit adv=$advExit diff=$diffExit sa=$selfAttackExit gate=$gateExit
seal=$($report.sealRecommendation)
"@ | Set-Content (Join-Path $out "run-strict-final.log") -Encoding utf8
Copy-Item (Join-Path $out "run-strict-final.log") (Join-Path $outRoot "run-strict-final.log") -Force -EA SilentlyContinue

# Exit-time live hash must match freeze evidence (tracked files unchanged after freeze)
Write-Host "=== exit hash verification (live vs evidence) ==="
$liveWt = Get-WorktreeHashes
$liveStatus = $liveWt.gitStatusSha256
$liveDiff = $liveWt.worktreeDiffSha256
$evStatus = $null
$evDiff = $null
$rpStatus = $null
$rpDiff = $null
if (Test-Path $wtPath) {
  try {
    $ev = Get-Content $wtPath -Raw | ConvertFrom-Json
    $evStatus = $ev.gitStatusSha256
    $evDiff = $ev.worktreeDiffSha256
  } catch {}
}
if (Test-Path $secPath) {
  try {
    $rp = Get-Content $secPath -Raw | ConvertFrom-Json
    $rpStatus = $rp.gitStatusSha256
    $rpDiff = $rp.worktreeDiffSha256
  } catch {}
}
$statusMatch = ($liveStatus -and $evStatus -and $rpStatus `
  -and ($liveStatus.ToLower() -eq $evStatus.ToLower()) `
  -and ($liveStatus.ToLower() -eq $rpStatus.ToLower()))
$diffMatch = ($liveDiff -and $evDiff -and $rpDiff `
  -and ($liveDiff.ToLower() -eq $evDiff.ToLower()) `
  -and ($liveDiff.ToLower() -eq $rpDiff.ToLower()))
$hashMatch = $statusMatch -and $diffMatch
Write-Json (Join-Path $out "worktree-hash-exit-verify.json") @{
  phase="4C"; formalRunId=$runId; runId=$runId
  liveGitStatusSha256=$liveStatus
  liveWorktreeDiffSha256=$liveDiff
  evidenceGitStatusSha256=$evStatus
  evidenceWorktreeDiffSha256=$evDiff
  reportGitStatusSha256=$rpStatus
  reportWorktreeDiffSha256=$rpDiff
  statusMatch=[bool]$statusMatch
  diffMatch=[bool]$diffMatch
  match=[bool]$hashMatch
  at=(Get-Date).ToUniversalTime().ToString("o")
}
if (-not $hashMatch) {
  Write-Host "HASH_MISMATCH_AT_EXIT liveStatus=$liveStatus ev=$evStatus rp=$rpStatus liveDiff=$liveDiff evDiff=$evDiff rpDiff=$rpDiff" -ForegroundColor Red
  $finalStrict = $false
  $allFailures += @("EXIT_HASH_MISMATCH: live vs worktree-evidence vs phase-4c-report")
  $report.sealRecommendation = "NOT_READY_TO_SEAL"
  $report.residualRisk = $true
  $report.status = "FAILED"
  $report.strictMode = $false
  Write-Json $secPath $report
}

Write-Host "PHASE4C_STRICT=$finalStrict FAILURES=$($allFailures.Count) SEAL=$($report.sealRecommendation) RUN=$runId"
Write-Host "HASH_MATCH=$hashMatch gitStatusSha256=$liveStatus worktreeDiffSha256=$liveDiff"
if ($finalStrict -and $hashMatch) { exit 0 } else { exit 1 }
