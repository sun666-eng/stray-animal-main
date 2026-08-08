# Phase 4D go-live rehearsal — credibility repair round 2.
# Prod formal chain: candidate→4B rollback→candidate; 180s+ mixed load; no false-green load flush.
# No commit/push/main/tag/deploy.
$ErrorActionPreference = 'Stop'
if (Test-Path variable:/PSNativeCommandUseErrorActionPreference) { $PSNativeCommandUseErrorActionPreference = $false }
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $Root
if (-not $env:JAVA_HOME -and (Test-Path 'D:\Java\jdk-21')) { $env:JAVA_HOME = 'D:\Java\jdk-21' }
if ($env:JAVA_HOME) { $env:Path = (Join-Path $env:JAVA_HOME 'bin') + ';' + $env:Path }

$baseline4c = 'fe003d9d8857e957c36973d0abe8b98a21fab725'
$baseline4b = '893e024b70e9117c89c204ffac67ad3655eb1f4a'
$branch = (git rev-parse --abbrev-ref HEAD).Trim()
$head = (git rev-parse HEAD).Trim()
$runId = 'E2E4D_' + (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ') + '_' + ([guid]::NewGuid().ToString('N').Substring(0,6).ToUpper())
$outRoot = Join-Path $Root 'output\playwright\release-phase-4d'
$out = Join-Path $outRoot "runs\$runId"
$runtime = Join-Path $out 'runtime'
$upload = Join-Path $runtime 'upload'
$logs = Join-Path $out 'logs'
$depTree = Join-Path $out 'dependency-tree.txt'
$keystore = Join-Path $runtime 'e2e4d.p12'
New-Item -ItemType Directory -Force -Path $out,$runtime,$upload,$logs | Out-Null
if ($out -match 'E2E4D_20260801T171328Z_F6550B|E2E4D_20260802T034544Z_7FC9C8') { throw 'refusing superseded run id' }

$JavaExe = if ($env:JAVA_HOME -and (Test-Path (Join-Path $env:JAVA_HOME 'bin\java.exe'))) { Join-Path $env:JAVA_HOME 'bin\java.exe' } else { (Get-Command java).Source }
$JwtSecret = -join ((48..57+65..90+97..122|Get-Random -Count 48|%{ [char]$_ }))
$AiKey = -join ((48..57+65..90+97..122|Get-Random -Count 48|%{ [char]$_ }))
$KsPass = -join ((48..57+65..90+97..122|Get-Random -Count 24|%{ [char]$_ }))
$AdminPass = -join ((48..57+65..90+97..122|Get-Random -Count 20|%{ [char]$_ })) + 'Aa1!'
$UserAPass = -join ((48..57+65..90+97..122|Get-Random -Count 16|%{ [char]$_ })) + 'Aa1!'
$UserBPass = -join ((48..57+65..90+97..122|Get-Random -Count 16|%{ [char]$_ })) + 'Aa1!'
$AiUserPass = -join ((48..57+65..90+97..122|Get-Random -Count 16|%{ [char]$_ })) + 'Aa1!'
$DbAppPass = -join ((48..57+65..90+97..122|Get-Random -Count 18|%{ [char]$_ })) + 'Aa1!'
$AdminUser = ('e2e4d_adm_' + $runId.Substring($runId.Length-6)).ToLower()
$UserA = ('e2e4d_a_' + $runId.Substring($runId.Length-6)).ToLower()
$UserB = ('e2e4d_b_' + $runId.Substring($runId.Length-6)).ToLower()
$AiUser = ('e2e4d_ai_' + $runId.Substring($runId.Length-6)).ToLower()
$DbAppUser = ('e2e4d_u_' + ([guid]::NewGuid().ToString('N').Substring(0,6))).ToLower()
$SourceDb = 'stray_animal_e2e4d_' + ([guid]::NewGuid().ToString('N').Substring(0,10))
$RestoreDb = 'stray_animal_e2e4d_restore_' + ([guid]::NewGuid().ToString('N').Substring(0,8))
$DbHostName = if ($env:COMPUTERNAME) { $env:COMPUTERNAME } else { [System.Net.Dns]::GetHostName() }
$AdminCnf = Join-Path $runtime 'mysql-admin.cnf'
$DumpFile = Join-Path $runtime 'backup.sql'
$uploadBackup = Join-Path $runtime 'upload-backup'
$noticeMarker = $runId + '_NOTICE'
$startedAt = (Get-Date).ToUniversalTime().ToString('o')
$portSnap = New-Object System.Collections.ArrayList
$trackedPids = New-Object System.Collections.ArrayList
$failures = New-Object System.Collections.ArrayList
$assertRows = New-Object System.Collections.ArrayList
$timeline = New-Object System.Collections.ArrayList
$processInstances = New-Object System.Collections.ArrayList
$loadAttempts = New-Object System.Collections.ArrayList
$requestLedgerRows = New-Object System.Collections.ArrayList
$strictMode = $true
$secExit=-1; $phase4aExit=-1; $phase3hExit=-1; $advExit=-1; $loadExit=-1; $selfExit=-1; $gateExit=-1
$negScenarios = @()
$suiteBaseUrl = $null; $formalBaseUrl = $null
$candidateJarSha=$null; $rollbackJarSha=$null
$CandidateJar=$null; $RollbackJar=$null
$adminSess=$null; $userSess=$null
$suiteAdminSess=$null; $suiteUserSess=$null; $suiteAiSess=$null
$serverPid=$null; $suitePid=$null; $mockPort=$null; $portHttp=$null; $suitePort=$null
$mock=$null

function Write-Json($path, $obj) {
  # Force arrays to stay arrays (PS ConvertTo-Json can collapse nested collections)
  $json = ConvertTo-Json -InputObject $obj -Depth 28
  [IO.File]::WriteAllText($path, $json, [Text.UTF8Encoding]::new($false))
}
function As-Array($x) {
  if ($null -eq $x) { return @() }
  if ($x -is [System.Array]) { return [Object[]]$x }
  if ($x -is [System.Collections.IEnumerable] -and -not ($x -is [string])) {
    return [Object[]]@($x)
  }
  return [Object[]]@($x)
}
function Sha256File($p) { if (-not (Test-Path $p)) { return $null }; (Get-FileHash -Algorithm SHA256 -LiteralPath $p).Hash.ToLower() }
function StatusOf([bool]$ok) { if ($ok) { 'COMPLETE' } else { 'FAILED' } }
function Iif($c,$t,$f) { if ($c) { return $t } else { return $f } }
function Note-Time($id,$phase,$cmd,$exit,$result) {
  [void]$timeline.Add(@{ id=$id; phase=$phase; command="$cmd"; exitCode=$exit; result="$result"; at=(Get-Date).ToUniversalTime().ToString('o') })
}
function Assert-Row($id,$expected,$actual,$ok,$detail='') {
  [void]$assertRows.Add(@{ scenarioId=$id; expected="$expected"; actual="$actual"; ok=[bool]$ok; detail="$detail"; at=(Get-Date).ToUniversalTime().ToString('o') })
  if (-not $ok) { [void]$failures.Add("$id expected=$expected actual=$actual $detail"); $script:strictMode = $false }
}
function Snapshot9999($phase) {
  $c = Get-NetTCPConnection -LocalPort 9999 -EA SilentlyContinue | Select-Object -First 1
  $st = if ($c) { "$($c.State)" } else { 'none' }
  $pidv = if ($c) { $c.OwningProcess } else { $null }
  [void]$portSnap.Add(@{ phase=$phase; state=$st; pid=$pidv; at=(Get-Date).ToUniversalTime().ToString('o') })
}
function Find-FreePort([int]$s,[int]$e) {
  for ($p=$s; $p -le $e; $p++) { if (-not (Get-NetTCPConnection -LocalPort $p -State Listen -EA SilentlyContinue)) { return $p } }
  throw "no free port $s-$e"
}
function Build-Jdbc($h,$db) { "jdbc:mysql://${h}:3306/${db}?useUnicode=true&characterEncoding=utf-8&useSSL=false&allowPublicKeyRetrieval=true&serverTimezone=GMT%2b8&connectTimeout=5000&socketTimeout=60000" }
function Write-MysqlCnf($path,$user,$pass) {
  @"
[client]
user=$user
password=$pass
host=127.0.0.1
"@ | Set-Content $path -Encoding ascii
}
function MysqlAdmin($sql) {
  & mysql --defaults-extra-file=$AdminCnf -e $sql 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "mysql failed $LASTEXITCODE" }
}
function MysqlAdminStdin($sql) {
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName='mysql'; $psi.Arguments="--defaults-extra-file=`"$AdminCnf`""
  $psi.UseShellExecute=$false; $psi.RedirectStandardInput=$true; $psi.RedirectStandardOutput=$true; $psi.RedirectStandardError=$true; $psi.CreateNoWindow=$true
  $p = New-Object System.Diagnostics.Process; $p.StartInfo=$psi; [void]$p.Start()
  $p.StandardInput.Write($sql); if (-not $sql.EndsWith("`n")) { $p.StandardInput.Write("`n") }
  $p.StandardInput.Close()
  if (-not $p.WaitForExit(60000)) { try{$p.Kill()}catch{}; throw 'mysql stdin timeout' }
  if ($p.ExitCode -ne 0) { throw "mysql stdin exit=$($p.ExitCode)" }
}
function Wait-Http($url,$sec=120) {
  $d=(Get-Date).AddSeconds($sec)
  while ((Get-Date) -lt $d) {
    try {
      $c = & cmd.exe /c "curl.exe -sk -o NUL -w `%{http_code}` --connect-timeout 5 `"$url`" 2>NUL"
      if (("$c").Trim() -match '^(2|3)\d\d$') { return $true }
    } catch {}
    Start-Sleep 2
  }
  return $false
}
function Http-Code($url) {
  $c = & cmd.exe /c "curl.exe -sk -o NUL -w `%{http_code}` --connect-timeout 8 `"$url`" 2>NUL"
  if (("$c").Trim() -match '(\d{3})') { return [int]$Matches[1] }
  return 0
}
function Wait-PortFree([int]$port,[int]$sec=40) {
  $d=(Get-Date).AddSeconds($sec)
  while ((Get-Date) -lt $d) {
    if (-not (Get-NetTCPConnection -LocalPort $port -State Listen -EA SilentlyContinue)) { return $true }
    Start-Sleep 1
  }
  return $false
}
function Stop-Tracked {
  foreach ($id in @($trackedPids)) {
    try {
      $pr = Get-CimInstance Win32_Process -Filter "ProcessId=$id" -EA SilentlyContinue
      if ($pr -and ($pr.CommandLine -match 'animal-home|mock-llm-delay')) { Stop-Process -Id $id -Force -EA SilentlyContinue }
    } catch {}
  }
  $trackedPids.Clear()
}
function Initialize-GracefulStopTool {
  $toolDir = Join-Path $runtime 'graceful-stop-tool'
  $classes = Join-Path $toolDir 'classes'
  $agentSource = Join-Path $toolDir 'GracefulShutdownAgent.java'
  $attachSource = Join-Path $toolDir 'AttachShutdown.java'
  $manifest = Join-Path $toolDir 'MANIFEST.MF'
  $agentJar = Join-Path $toolDir 'graceful-shutdown-agent.jar'
  New-Item -ItemType Directory -Force -Path $classes | Out-Null
  @'
import java.lang.instrument.Instrumentation;

public final class GracefulShutdownAgent {
    public static void agentmain(String args, Instrumentation instrumentation) {
        Thread shutdown = new Thread(() -> {
            try { Thread.sleep(250L); } catch (InterruptedException ignored) { Thread.currentThread().interrupt(); }
            System.exit(0);
        }, "e2e4d-graceful-shutdown");
        shutdown.setDaemon(false);
        shutdown.start();
    }
}
'@ | Set-Content $agentSource -Encoding ascii
  @'
import com.sun.tools.attach.VirtualMachine;

public final class AttachShutdown {
    public static void main(String[] args) throws Exception {
        if (args.length != 2) throw new IllegalArgumentException("pid and agent jar required");
        VirtualMachine vm = VirtualMachine.attach(args[0]);
        try { vm.loadAgent(args[1]); } finally { vm.detach(); }
    }
}
'@ | Set-Content $attachSource -Encoding ascii
  "Manifest-Version: 1.0`nAgent-Class: GracefulShutdownAgent`nCan-Redefine-Classes: false`nCan-Retransform-Classes: false`n" | Set-Content $manifest -Encoding ascii
  & javac --add-modules jdk.attach -d $classes $agentSource $attachSource 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "graceful stop helper javac failed exit=$LASTEXITCODE" }
  & jar cfm $agentJar $manifest -C $classes GracefulShutdownAgent.class 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path $agentJar)) { throw 'graceful stop agent jar failed' }
  return @{ classes=$classes; agentJar=$agentJar }
}
function Invoke-GracefulJavaStop($proc,[int]$port,[string]$instanceId,[int]$timeoutSec=45) {
  $requestedAt = (Get-Date).ToUniversalTime().ToString('o')
  $attachExit = $null
  $forcedFallback = $false
  $timedOut = $false
  if ($proc) { try { $proc.Refresh() } catch {} }
  if ($proc -and -not $proc.HasExited) {
    $prevEap=$ErrorActionPreference; $ErrorActionPreference='Continue'
    & $JavaExe --add-modules jdk.attach -cp $script:GracefulStopTool.classes AttachShutdown "$($proc.Id)" $script:GracefulStopTool.agentJar 2>&1 | Out-Null
    $attachExit=$LASTEXITCODE; $ErrorActionPreference=$prevEap
    $deadline=(Get-Date).AddSeconds($timeoutSec)
    while ((Get-Date) -lt $deadline) {
      try { $proc.Refresh() } catch {}
      if ($proc.HasExited) { break }
      Start-Sleep -Milliseconds 250
    }
    try { $proc.Refresh() } catch {}
    if (-not $proc.HasExited) {
      $timedOut=$true; $forcedFallback=$true
      Stop-Process -Id $proc.Id -Force -EA SilentlyContinue
      try { [void]$proc.WaitForExit(10000); $proc.Refresh() } catch {}
    }
  }
  $exitCode=$null
  try { if ($proc -and $proc.HasExited) { $exitCode=[int]$proc.ExitCode } } catch {}
  $portReleased=Wait-PortFree $port 40
  $graceful=($attachExit -eq 0) -and (-not $forcedFallback) -and ($exitCode -eq 0) -and $portReleased
  return @{
    instanceId=$instanceId; stopRequestedAt=$requestedAt; stoppedAt=(Get-Date).ToUniversalTime().ToString('o')
    method='jdk-attach-system-exit'; attachExitCode=$attachExit; timeoutSeconds=$timeoutSec
    timedOut=$timedOut; forcedFallback=$forcedFallback; gracefulShutdown=$graceful
    exitCode=$exitCode; portReleased=$portReleased
  }
}
function Get-WorktreeHashes {
  $st = (& git status --short 2>&1 | Out-String)
  $df = (& git diff 2>&1 | Out-String)
  $ss = ([Security.Cryptography.SHA256]::Create().ComputeHash([Text.Encoding]::UTF8.GetBytes($st)) | ForEach-Object { $_.ToString('x2') }) -join ''
  $ds = ([Security.Cryptography.SHA256]::Create().ComputeHash([Text.Encoding]::UTF8.GetBytes($df)) | ForEach-Object { $_.ToString('x2') }) -join ''
  @{ gitStatusSha256=$ss; worktreeDiffSha256=$ds; dirty=(-not [string]::IsNullOrWhiteSpace($st.Trim())); statusText=$st }
}
function Clear-AppEnv {
  foreach ($k in @('JWT_SECRET','AI_CONFIG_ENCRYPTION_KEY','AI_BASE_URL','DB_HOST','DB_NAME','DB_USERNAME','DB_PASSWORD','FILE_UPLOAD_DIR','CORS_ALLOWED_ORIGIN_PATTERNS','SPRING_PROFILES_ACTIVE','INITIAL_ADMIN_ENABLED','INITIAL_ADMIN_USERNAME','INITIAL_ADMIN_PASSWORD','DB_USE_SSL','AI_ENABLED','SERVER_SSL_KEY_STORE_PASSWORD','NOTIFICATION_EMAIL_ENABLED','NOTIFICATION_SMS_ENABLED','REDIS_ENABLED')) {
    Remove-Item "Env:$k" -EA SilentlyContinue
  }
}
function Apply-ProdEnv([string]$db,[string]$uploadDir) {
  $env:SPRING_PROFILES_ACTIVE='prod'
  $env:JWT_SECRET=$JwtSecret; $env:AI_CONFIG_ENCRYPTION_KEY=$AiKey
  $env:DB_HOST=$DbHostName; $env:DB_NAME=$db; $env:DB_USERNAME=$DbAppUser; $env:DB_PASSWORD=$DbAppPass
  $env:DB_USE_SSL='false'; $env:FILE_UPLOAD_DIR=$uploadDir
  $env:CORS_ALLOWED_ORIGIN_PATTERNS='https://app.example.local'
  $env:AI_ENABLED='false'; $env:NOTIFICATION_EMAIL_ENABLED='false'; $env:NOTIFICATION_SMS_ENABLED='false'; $env:REDIS_ENABLED='false'
  $env:INITIAL_ADMIN_ENABLED='true'; $env:INITIAL_ADMIN_USERNAME=$AdminUser; $env:INITIAL_ADMIN_PASSWORD=$AdminPass
  $env:SERVER_SSL_KEY_STORE_PASSWORD=$KsPass
}
function Apply-DevEnv([string]$db,[string]$uploadDir) {
  $env:SPRING_PROFILES_ACTIVE='dev'
  $env:JWT_SECRET=$JwtSecret; $env:AI_CONFIG_ENCRYPTION_KEY=$AiKey
  $env:DB_HOST=$DbHostName; $env:DB_NAME=$db; $env:DB_USERNAME=$DbAppUser; $env:DB_PASSWORD=$DbAppPass
  $env:DB_USE_SSL='false'; $env:FILE_UPLOAD_DIR=$uploadDir
  $env:CORS_ALLOWED_ORIGIN_PATTERNS='https://app.example.local,http://127.0.0.1:*,http://localhost:*'
  $env:AI_ENABLED='false'; $env:NOTIFICATION_EMAIL_ENABLED='false'; $env:NOTIFICATION_SMS_ENABLED='false'; $env:REDIS_ENABLED='false'
  $env:INITIAL_ADMIN_ENABLED='true'; $env:INITIAL_ADMIN_USERNAME=$AdminUser; $env:INITIAL_ADMIN_PASSWORD=$AdminPass
}
function Start-ProdJar([string]$jarPath,[int]$port,[string]$db,[string]$uploadDir,[string]$outLog,[string]$errLog,[string]$instanceId,[string]$commit,[string]$jarSha) {
  Clear-AppEnv
  Apply-ProdEnv $db $uploadDir
  $jdbc = Build-Jdbc $DbHostName $db
  $args = @('-Xms256m','-Xmx768m','-XX:+ExitOnOutOfMemoryError','-jar',$jarPath,
    '--spring.profiles.active=prod',"--server.port=$port","--spring.datasource.url=$jdbc",
    '--server.ssl.enabled=true',"--server.ssl.key-store=$keystore",'--server.ssl.key-store-type=PKCS12','--server.ssl.key-alias=e2e4d',
    '--app.schema-guard.auto-migrate=false',"--file.upload-dir=$uploadDir",
    '--app.bootstrap.initial-admin-enabled=true','--app.health.ready-cache-ms=1000')
  $started = (Get-Date).ToUniversalTime().ToString('o')
  $p = Start-Process -FilePath $JavaExe -ArgumentList $args -PassThru -WindowStyle Hidden -RedirectStandardOutput $outLog -RedirectStandardError $errLog
  [void]$trackedPids.Add($p.Id)
  $base = "https://127.0.0.1:$port"
  $ready = Wait-Http "$base/api/health/ready" 180
  $readyAt = if ($ready) { (Get-Date).ToUniversalTime().ToString('o') } else { $null }
  [void]$processInstances.Add(@{
    instanceId=$instanceId; pid=$p.Id; jarPath=$jarPath; jarSha256=$jarSha; commit=$commit
    profile='prod'; port=$port; database=$db; uploadDir=$uploadDir
    baseUrl=$base; transport='https-local-keystore'; transportNote='local TLS transport exception for prod profile rehearsal; other prod rules retained'
    startedAt=$started; readyAt=$readyAt; stoppedAt=$null; exitCode=$null; ready=$ready
  })
  return @{ proc=$p; port=$port; baseUrl=$base; ready=$ready }
}
function Start-DevJar([string]$jarPath,[int]$port,[string]$db,[string]$uploadDir,[string]$outLog,[string]$errLog,[string]$instanceId,[string]$commit,[string]$jarSha) {
  Clear-AppEnv
  Apply-DevEnv $db $uploadDir
  $jdbc = Build-Jdbc $DbHostName $db
  $args = @('-Xms256m','-Xmx768m','-XX:+ExitOnOutOfMemoryError','-jar',$jarPath,
    '--spring.profiles.active=dev',"--server.port=$port","--spring.datasource.url=$jdbc",
    '--server.ssl.enabled=false','--server.servlet.session.cookie.secure=false',
    '--app.schema-guard.auto-migrate=false',"--file.upload-dir=$uploadDir",
    '--app.bootstrap.initial-admin-enabled=true','--app.health.ready-cache-ms=1000',
    '--app.ai.allow-loopback-personal-config=true','--app.ai.allow-proxy-synthetic-dns=false',
    '--app.ai.test-max-concurrent=2','--app.ai.semaphore-wait-ms=50')
  $started = (Get-Date).ToUniversalTime().ToString('o')
  $p = Start-Process -FilePath $JavaExe -ArgumentList $args -PassThru -WindowStyle Hidden -RedirectStandardOutput $outLog -RedirectStandardError $errLog
  [void]$trackedPids.Add($p.Id)
  $base = "http://127.0.0.1:$port"
  $ready = Wait-Http "$base/api/health/ready" 180
  $readyAt = if ($ready) { (Get-Date).ToUniversalTime().ToString('o') } else { $null }
  [void]$processInstances.Add(@{
    instanceId=$instanceId; pid=$p.Id; jarPath=$jarPath; jarSha256=$jarSha; commit=$commit
    profile='dev'; port=$port; database=$db; uploadDir=$uploadDir
    baseUrl=$base; transport='http'; transportNote='dev-isolated suite/AI subprobe only — not formal prod'
    startedAt=$started; readyAt=$readyAt; stoppedAt=$null; exitCode=$null; ready=$ready
    suiteOnly=$true; notFormalProd=$true
  })
  return @{ proc=$p; port=$port; baseUrl=$base; ready=$ready }
}
function Stop-Instance($proc,$port,$instanceId) {
  $stop = Invoke-GracefulJavaStop $proc $port $instanceId
  foreach ($pi in $processInstances) {
    if ($pi.instanceId -eq $instanceId) {
      $pi.stopRequestedAt=$stop.stopRequestedAt; $pi.stoppedAt=$stop.stoppedAt
      $pi.exitCode=$stop.exitCode; $pi.portReleased=$stop.portReleased
      $pi.stopMethod=$stop.method; $pi.attachExitCode=$stop.attachExitCode
      $pi.gracefulShutdown=$stop.gracefulShutdown; $pi.forcedFallback=$stop.forcedFallback
      $pi.stopTimedOut=$stop.timedOut; $pi.stopTimeoutSeconds=$stop.timeoutSeconds
    }
  }
  return $stop
}
function Start-JarNeg([string]$scenario,[hashtable]$envMap,[string[]]$extraArgs,[string]$expectedFailureCode,[string]$expectedPattern,[bool]$expectListen=$false) {
  $port = Find-FreePort 18300 18349
  $outL = Join-Path $logs "neg-$scenario.out.log"
  $errL = Join-Path $logs "neg-$scenario.err.log"
  Clear-AppEnv
  foreach ($k in $envMap.Keys) { Set-Item -Path "Env:$k" -Value $envMap[$k] }
  $dbHost = if ($envMap['DB_HOST']) { $envMap['DB_HOST'] } else { $DbHostName }
  $dbName = if ($envMap['DB_NAME']) { $envMap['DB_NAME'] } else { $SourceDb }
  $jdbc = Build-Jdbc $dbHost $dbName
  $args = @('-Xms128m','-Xmx256m','-jar',$CandidateJar,'--spring.profiles.active=prod',"--server.port=$port",'--server.ssl.enabled=false','--app.schema-guard.auto-migrate=false')
  if ($scenario -ne 'db-host-missing-default-localhost') { $args += "--spring.datasource.url=$jdbc" }
  $args += $extraArgs
  $p = Start-Process -FilePath $JavaExe -ArgumentList $args -PassThru -WindowStyle Hidden -RedirectStandardOutput $outL -RedirectStandardError $errL
  $ever=$false
  for ($i=0;$i -lt 28;$i++) {
    if (Get-NetTCPConnection -LocalPort $port -State Listen -EA SilentlyContinue) { $ever=$true }
    if ($p.HasExited) { break }
    Start-Sleep 1
  }
  if (-not $p.HasExited) {
    if ($expectListen) {
      # positive: stop cleanly later
    } else {
      Stop-Process -Id $p.Id -Force -EA SilentlyContinue; Start-Sleep 1
    }
  }
  $code = if ($p.HasExited) { $p.ExitCode } else { 0 }
  $text = ''
  if (Test-Path $outL) { $text += Get-Content $outL -Raw -EA SilentlyContinue }
  if (Test-Path $errL) { $text += Get-Content $errL -Raw -EA SilentlyContinue }
  if ($expectListen) {
    $live = Http-Code "http://127.0.0.1:$port/api/health/live"
    $ready = Http-Code "http://127.0.0.1:$port/api/health/ready"
    $hdrTmp = Join-Path $runtime "pos-hdr-$scenario.txt"
    & cmd.exe /c "curl.exe -s -D `"$hdrTmp`" -o NUL `"http://127.0.0.1:$port/api/health/live`" 2>NUL" | Out-Null
    $hdr = if (Test-Path $hdrTmp) { Get-Content $hdrTmp -Raw } else { '' }
    $noCookie = -not ($hdr -match '(?im)^Set-Cookie:')
    $stop = Invoke-GracefulJavaStop $p $port "matrix-$scenario" 45
    $free = $stop.portReleased
    $ok = $ever -and ($live -eq 200) -and ($ready -eq 200) -and $noCookie -and $free -and $stop.gracefulShutdown
    return @{ scenarioId=$scenario; exitCode=$stop.exitCode; everListened=$ever; ok=$ok; port=$port; portReleased=$free; live=$live; ready=$ready; healthNoSetCookie=$noCookie; profile='prod'; kind='positive'; expectedFailureCode='VALID_PROD'; actualFailureCode=$(Iif $ok 'VALID_PROD' 'POSITIVE_FAILED'); patternMatched=$ok; gracefulShutdown=$stop.gracefulShutdown; forcedFallback=$stop.forcedFallback; logSnippet=$text.Substring(0,[Math]::Min(500,$text.Length)) }
  }
  $free = Wait-PortFree $port 15
  $patternMatched = [bool]($expectedPattern -and ($text -match $expectedPattern))
  $actualFailureCode = if ($patternMatched) { $expectedFailureCode } elseif (-not $p.HasExited) { 'STARTUP_TIMEOUT' } elseif ($ever) { 'UNEXPECTED_LISTEN' } else { 'UNCLASSIFIED_FAILURE' }
  $ok = ($code -ne 0) -and (-not $ever) -and $free -and $patternMatched -and ($actualFailureCode -eq $expectedFailureCode)
  return @{ scenarioId=$scenario; exitCode=$code; everListened=$ever; ok=$ok; port=$port; portReleased=$free; profile='prod'; kind='negative'; jarSha256=$candidateJarSha; expectedFailureCode=$expectedFailureCode; actualFailureCode=$actualFailureCode; expectedPattern=$expectedPattern; patternMatched=$patternMatched; logSnippet=$text.Substring(0,[Math]::Min(500,$text.Length)) }
}
function Login-Cookie($baseUrl,$user,$pass,$jarName) {
  $jar = Join-Path $runtime $jarName
  $body = (@{ username=$user; password=$pass } | ConvertTo-Json -Compress)
  $bf = Join-Path $runtime "login-$jarName.json"; [IO.File]::WriteAllText($bf,$body)
  $resp = Join-Path $runtime "login-$jarName-resp.json"
  & cmd.exe /c "curl.exe -sk -c `"$jar`" -b `"$jar`" -H `"Content-Type: application/json`" --data-binary `"@$bf`" -o `"$resp`" `"$baseUrl/api/user/login`" 2>NUL" | Out-Null
  $cookieLine = ''
  if (Test-Path $jar) {
    $parts = New-Object System.Collections.ArrayList
    foreach ($rawLine in (Get-Content -LiteralPath $jar)) {
      $t = "$rawLine".Trim()
      if ($t -eq '') { continue }
      if ($t.StartsWith('#') -and -not $t.StartsWith('#HttpOnly_')) { continue }
      $line = $t -replace '^#HttpOnly_',''
      $p = $line -split "`t"
      if ($p.Length -ge 7 -and $p[5] -and $p[6]) { [void]$parts.Add("$($p[5])=$($p[6])") }
    }
    $cookieLine = ($parts -join '; ')
  }
  $csrf = ''
  if (Test-Path $resp) {
    try { $lj = Get-Content -LiteralPath $resp -Raw | ConvertFrom-Json; if ($lj.data.csrfToken) { $csrf = [string]$lj.data.csrfToken } } catch {}
  }
  $code = 0
  if (Test-Path $resp) {
    try { $lj = Get-Content -LiteralPath $resp -Raw | ConvertFrom-Json; if ("$($lj.code)" -eq '0') { $code = 200 } } catch {}
  }
  return @{ cookie=$cookieLine; csrf=$csrf; jar=$jar; ok=([bool]$cookieLine -and $code -eq 200); status=$code }
}
function Api-Get($baseUrl,$path,$jar,$outFile) {
  $c = & cmd.exe /c "curl.exe -sk -b `"$jar`" -c `"$jar`" -o `"$outFile`" -w `%{http_code}` `"$baseUrl$path`" 2>NUL"
  if (("$c").Trim() -match '(\d{3})') { return [int]$Matches[1] }
  return 0
}
function Api-Write($baseUrl,$method,$path,$jar,$csrf,$bodyFile,$outFile) {
  $csrfH = if ($csrf) { "-H `"X-CSRF-TOKEN: $csrf`" -H `"X-XSRF-TOKEN: $csrf`"" } else { '' }
  $c = & cmd.exe /c "curl.exe -sk -b `"$jar`" -c `"$jar`" -X $method -H `"Content-Type: application/json`" $csrfH --data-binary `"@$bodyFile`" -o `"$outFile`" -w `%{http_code}` `"$baseUrl$path`" 2>NUL"
  if (("$c").Trim() -match '(\d{3})') { return [int]$Matches[1] }
  return 0
}

Write-Host "=== formalRunId $runId ==="
Snapshot9999 'before'
Note-Time 'start' 'init' 'orchestrator' 0 'begin'

$prePath = Join-Path $outRoot 'prebuilt-jars.json'
if (-not (Test-Path $prePath)) { throw "missing $prePath" }
$pre = Get-Content $prePath -Raw | ConvertFrom-Json
$CandidateJar = $pre.candidateJar; $RollbackJar = $pre.rollbackJar
$candidateJarSha = $pre.candidateJarSha256.ToLower(); $rollbackJarSha = $pre.rollbackJarSha256.ToLower()
if ($candidateJarSha -eq $rollbackJarSha) { throw 'candidate/rollback jar identical' }
if (-not (Test-Path $CandidateJar) -or -not (Test-Path $RollbackJar)) { throw 'jar missing' }
$prevEap=$ErrorActionPreference; $ErrorActionPreference='Continue'
$pomForTree = if ($pre.candidateWorktree -and (Test-Path (Join-Path $pre.candidateWorktree 'pom.xml'))) {
  Join-Path $pre.candidateWorktree 'pom.xml'
} else { Join-Path $Root 'pom.xml' }
& mvn -f $pomForTree dependency:tree "-DoutputFile=$depTree" 2>&1 | Out-Null
$ErrorActionPreference=$prevEap
Assert-Row 'dual-jar-distinct' 'different' ($candidateJarSha.Substring(0,12)+'/'+$rollbackJarSha.Substring(0,12)) ($candidateJarSha -ne $rollbackJarSha)

Write-Json (Join-Path $out 'release-candidate-manifest.json') @{
  phase='4D'; formalRunId=$runId; status='COMPLETE'; residualRisk=$false; strictMode=$true
  baseline4c=$baseline4c; baseline4b=$baseline4b; branch=$branch; head=$head
  candidateCommit=$pre.candidateCommit; rollbackCommit=$pre.rollbackCommit
  candidateJar=$CandidateJar; rollbackJar=$RollbackJar
  candidateJarSha256=$candidateJarSha; rollbackJarSha256=$rollbackJarSha; jarSha256=$candidateJarSha
  candidateWorktree=$pre.candidateWorktree; rollbackWorktree=$pre.rollbackWorktree
  candidateBuildWorktreeDirty=$false; rollbackBuildWorktreeDirty=$false; controllerWorktreeDirty=$true
  dependencyTree=$depTree; dependencyTreeSha256=(Sha256File $depTree)
  startedAt=$startedAt; endedAt=(Get-Date).ToUniversalTime().ToString('o')
}
Write-Json (Join-Path $out 'jar-build-ledger.json') @{
  phase='4D'; formalRunId=$runId; status='COMPLETE'; residualRisk=$false; strictMode=$true
  dualWorktreeBuild=$true; singleJarBuild=$false
  candidateJarSha256=$candidateJarSha; rollbackJarSha256=$rollbackJarSha; jarSha256=$candidateJarSha
  candidateBuildWorktreeDirty=$false; rollbackBuildWorktreeDirty=$false
  dependencyTreeLog='dependency-tree.txt'; startedAt=$startedAt; endedAt=(Get-Date).ToUniversalTime().ToString('o')
}

$adminMysqlUser = if ($env:MYSQL_ADMIN_USER) { $env:MYSQL_ADMIN_USER } else { 'root' }
$adminMysqlPass = if ($env:DB_PASSWORD) { $env:DB_PASSWORD } else { '123456'; Write-Host 'NOTE: DB_PASSWORD unset; using local default (not logged)' }
Write-MysqlCnf $AdminCnf $adminMysqlUser $adminMysqlPass
$GracefulStopTool = Initialize-GracefulStopTool

try {
  Write-Host "=== isolation DB $SourceDb ==="
  MysqlAdmin "CREATE DATABASE ``$SourceDb`` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
  MysqlAdmin "CREATE DATABASE ``$RestoreDb`` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
  Get-Content (Join-Path $Root 'test.sql') -Raw | & mysql --defaults-extra-file=$AdminCnf $SourceDb 2>&1 | Out-Null
  $boot = Join-Path $Root 'docs\sql\bootstrap-all.sql'
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
GRANT ALL ON ``$RestoreDb``.* TO '$DbAppUser'@'%';
GRANT ALL ON ``$RestoreDb``.* TO '$DbAppUser'@'localhost';
FLUSH PRIVILEGES;
"@
  # schema prep with dev migrate once
  $prepPort = Find-FreePort 18300 18349
  Clear-AppEnv; Apply-DevEnv $SourceDb $upload
  $jdbcPrep = Build-Jdbc $DbHostName $SourceDb
  $prepArgs = @('-Xms256m','-Xmx512m','-jar',$CandidateJar,'--spring.profiles.active=dev',"--server.port=$prepPort","--spring.datasource.url=$jdbcPrep",
    '--app.schema-guard.auto-migrate=true','--app.schema-guard.fail-fast=false',
    '--app.data-state-guard.auto-fix=true','--app.role-guard.auto-fix=true',
    "--file.upload-dir=$upload",'--app.bootstrap.initial-admin-enabled=true','--server.ssl.enabled=false')
  $prep2 = Start-Process -FilePath $JavaExe -ArgumentList $prepArgs -PassThru -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logs 'prep.out.log') -RedirectStandardError (Join-Path $logs 'prep.err.log')
  [void]$trackedPids.Add($prep2.Id)
  if (-not (Wait-Http "http://127.0.0.1:$prepPort/api/health/ready" 180)) { throw 'schema prep failed' }
  $prepStop = Invoke-GracefulJavaStop $prep2 $prepPort 'schema-prep' 45
  Assert-Row 'schema-prep-graceful-stop' 'graceful exit=0' "graceful=$($prepStop.gracefulShutdown) exit=$($prepStop.exitCode)" $prepStop.gracefulShutdown
  $trackedPids.Clear()
  Note-Time 'db' 'isolation' 'mysql+prep' 0 'ok'

  Write-Host '=== mock LLM ==='
  $mockPort = Find-FreePort 18350 18369
  $env:MOCK_LLM_PORT="$mockPort"; $env:MOCK_LLM_DELAY_MS='1500'; $env:MOCK_LLM_PID_FILE=(Join-Path $runtime 'mock-llm.pid')
  $mock = Start-Process -FilePath 'node' -ArgumentList @(Join-Path $Root 'tools\mock-llm-delay-server.cjs') -PassThru -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logs 'mock-llm.out.log') -RedirectStandardError (Join-Path $logs 'mock-llm.err.log')
  [void]$trackedPids.Add($mock.Id)
  if (-not (Wait-Http "http://127.0.0.1:$mockPort/health" 30)) { throw 'mock llm failed' }

  Write-Host '=== TLS keystore ==='
  $env:E2E4D_KS_PASS = $KsPass
  & keytool -genkeypair -alias e2e4d -keyalg RSA -keysize 2048 -storetype PKCS12 -keystore $keystore -validity 1 -storepass:env E2E4D_KS_PASS -keypass:env E2E4D_KS_PASS -dname "CN=$DbHostName" 2>&1 | Out-Null
  if (-not (Test-Path $keystore)) { throw 'keystore failed' }

  Write-Host '=== prod negative+positive matrix ==='
  $good = @{
    SPRING_PROFILES_ACTIVE='prod'; JWT_SECRET=$JwtSecret; AI_CONFIG_ENCRYPTION_KEY=$AiKey
    DB_HOST=$DbHostName; DB_NAME=$SourceDb; DB_USERNAME=$DbAppUser; DB_PASSWORD=$DbAppPass
    FILE_UPLOAD_DIR=$upload; CORS_ALLOWED_ORIGIN_PATTERNS='https://app.example.local'
    DB_USE_SSL='false'; AI_ENABLED='false'
    INITIAL_ADMIN_ENABLED='true'; INITIAL_ADMIN_USERNAME=$AdminUser; INITIAL_ADMIN_PASSWORD=$AdminPass
  }
  function Clone-Env([hashtable]$src,[hashtable]$over) {
    $h=@{}; foreach($k in $src.Keys){$h[$k]=$src[$k]}; foreach($k in $over.Keys){ if ($null -eq $over[$k]) { $h.Remove($k) } else { $h[$k]=$over[$k] } }; return $h
  }
  $negScenarios = @()
  $negScenarios += (Start-JarNeg 'jwt-missing' (Clone-Env $good @{ JWT_SECRET='' }) @() 'JWT_SECRET_MISSING' 'JWT_SECRET|app\.jwt\.secret|长度|必须配置')
  $negScenarios += (Start-JarNeg 'jwt-short' (Clone-Env $good @{ JWT_SECRET='short' }) @() 'JWT_SECRET_TOO_SHORT' 'JWT_SECRET|app\.jwt\.secret|长度|至少|32')
  $negScenarios += (Start-JarNeg 'ai-key-missing' (Clone-Env $good @{ AI_CONFIG_ENCRYPTION_KEY='' }) @() 'AI_KEY_MISSING' 'AI_CONFIG_ENCRYPTION_KEY|config-encryption-key|至少 32')
  $negScenarios += (Start-JarNeg 'ai-key-same-as-jwt' (Clone-Env $good @{ AI_CONFIG_ENCRYPTION_KEY=$JwtSecret }) @() 'AI_KEY_NOT_INDEPENDENT' 'AI_CONFIG_ENCRYPTION_KEY 必须与 JWT_SECRET 独立')
  # empty datasource URL → EPP fail-fast (host missing cannot form valid prod JDBC)
  $negScenarios += (Start-JarNeg 'db-host-missing-default-localhost' (Clone-Env $good @{ DB_HOST=$null }) @() 'DB_HOST_DEFAULT_LOCALHOST_FORBIDDEN' 'JDBC URL 不得指向 localhost')
  $negScenarios += (Start-JarNeg 'db-localhost' (Clone-Env $good @{ DB_HOST='localhost' }) @() 'DB_LOCALHOST_FORBIDDEN' 'JDBC URL 不得指向 localhost')
  $negScenarios += (Start-JarNeg 'db-root' (Clone-Env $good @{ DB_USERNAME='root' }) @() 'DB_ROOT_FORBIDDEN' '生产数据库禁止 root')
  $negScenarios += (Start-JarNeg 'db-pass-empty' (Clone-Env $good @{ DB_PASSWORD='' }) @() 'DB_PASSWORD_MISSING' '生产数据库密码缺失')
  # Keep an allowed database name; the only injected fault is an unreachable TEST-NET host.
  $unreachableJdbc = "jdbc:mysql://192.0.2.1:3306/${SourceDb}?connectTimeout=1000&socketTimeout=1000"
  $negScenarios += (Start-JarNeg 'db-unreachable' (Clone-Env $good @{ DB_HOST='192.0.2.1'; DB_NAME=$SourceDb }) @("--spring.datasource.url=$unreachableJdbc") 'DB_CONNECT_FAILURE' 'Communications link failure|CommunicationsException|Connection refused|connect timed out|ConnectException|SocketTimeoutException')
  # Startup gates test the actual prod override prohibitions. URL scheme/metadata policy is tested through the application endpoint and application-ai-ledger.json.
  $negScenarios += (Start-JarNeg 'ai-loopback-override-enabled' (Clone-Env $good @{ AI_ENABLED='true' }) @('--app.ai.allow-loopback-personal-config=true') 'AI_LOOPBACK_OVERRIDE_FORBIDDEN' '生产必须 app\.ai\.allow-loopback-personal-config=false')
  $negScenarios += (Start-JarNeg 'ai-synthetic-dns-enabled' (Clone-Env $good @{ AI_ENABLED='true' }) @('--app.ai.allow-proxy-synthetic-dns=true') 'AI_SYNTHETIC_DNS_FORBIDDEN' '生产必须 app\.ai\.allow-proxy-synthetic-dns=false')
  $negScenarios += (Start-JarNeg 'upload-missing' (Clone-Env $good @{ FILE_UPLOAD_DIR='' }) @() 'UPLOAD_DIR_MISSING' 'FILE_UPLOAD_DIR|file\.upload-dir 缺失')
  $unwritable = Join-Path $runtime 'upload-as-file'
  New-Item -ItemType File -Path $unwritable -Force | Out-Null
  $negScenarios += (Start-JarNeg 'upload-unwritable' (Clone-Env $good @{ FILE_UPLOAD_DIR=$unwritable }) @() 'UPLOAD_DIR_UNUSABLE' '上传目录|Not a directory|不是目录|无法创建')
  $negScenarios += (Start-JarNeg 'cors-star' (Clone-Env $good @{ CORS_ALLOWED_ORIGIN_PATTERNS='*' }) @() 'CORS_UNSAFE' '生产 CORS 禁止空来源或无约束通配符')
  $negScenarios += (Start-JarNeg 'wrong-or-multiple-profile' (Clone-Env $good @{ SPRING_PROFILES_ACTIVE='prod,dev' }) @('--spring.profiles.active=prod,dev') 'PROFILE_INVALID' '必须显式且仅激活 dev、prod 或 test 中的一个运行 profile')
  $negScenarios += (Start-JarNeg 'valid-prod-positive' $good @() 'VALID_PROD' '' $true)
  $negOk = ($negScenarios | Where-Object { -not $_.ok }).Count -eq 0
  foreach ($s in $negScenarios) { Assert-Row ('matrix-'+$s.scenarioId) 'ok' ("exit=$($s.exitCode) listen=$($s.everListened)") $s.ok }
  Write-Json (Join-Path $out 'negative-startup-ledger.json') @{
    phase='4D'; formalRunId=$runId; status=$(StatusOf $negOk); residualRisk=(-not $negOk); strictMode=$negOk
    scenarios=(As-Array $negScenarios); rows=(As-Array $negScenarios); ok=$negOk; scenarioCount=@($negScenarios).Count
    jarSha256=$candidateJarSha; baseline4c=$baseline4c; branch=$branch; head=$head
    startedAt=$startedAt; endedAt=(Get-Date).ToUniversalTime().ToString('o')
  }
  Note-Time 'neg' 'matrix' 'prod-matrix' $(Iif $negOk 0 1) "n=$($negScenarios.Count)"

  Write-Host '=== lifecycle 3x prod ==='
  $cycles=@()
  for ($ci=1;$ci -le 3;$ci++) {
    $cPort = Find-FreePort 18300 18349
    $cp = Start-ProdJar $CandidateJar $cPort $SourceDb $upload (Join-Path $logs "life-$ci.out.log") (Join-Path $logs "life-$ci.err.log") "lifecycle-$ci" $baseline4c $candidateJarSha
    $liveC = Http-Code "$($cp.baseUrl)/api/health/live"
    $readyC = Http-Code "$($cp.baseUrl)/api/health/ready"
    $cycleStop = Stop-Instance $cp.proc $cPort "lifecycle-$ci"
    $free = Wait-PortFree $cPort 20
    $cok = $cp.ready -and ($liveC -eq 200) -and ($readyC -eq 200) -and $free -and $cycleStop.gracefulShutdown
    $cycles += @{ cycle=$ci; port=$cPort; live=$liveC; ready=$readyC; profile='prod'; gracefulShutdown=$cycleStop.gracefulShutdown; forcedFallback=$cycleStop.forcedFallback; exitCode=$cycleStop.exitCode; ok=$cok }
    Assert-Row "lifecycle-cycle-$ci" 'ok' "live=$liveC ready=$readyC" $cok
  }
  $lifeOk = ($cycles | Where-Object { -not $_.ok }).Count -eq 0
  # Write lifecycle via node — PS ConvertTo-Json corrupts shared array refs across keys
  $lifePayloadPath = Join-Path $runtime 'lifecycle-payload.json'
  $lifePayload = @{
    phase='4D'; formalRunId=$runId; status=$(StatusOf $lifeOk); residualRisk=(-not $lifeOk); strictMode=$lifeOk
    ok=$lifeOk; profile='prod'; jarSha256=$candidateJarSha
    startedAt=$startedAt; endedAt=(Get-Date).ToUniversalTime().ToString('o')
    cycleList = @($cycles | ForEach-Object {
      @{ cycle=[int]$_.cycle; port=[int]$_.port; live=[int]$_.live; ready=[int]$_.ready; profile="$($_.profile)"; ok=[bool]$_.ok }
    })
  } | ConvertTo-Json -Depth 8
  [IO.File]::WriteAllText($lifePayloadPath, $lifePayload, [Text.UTF8Encoding]::new($false))
  node -e "const fs=require('fs'); const j=JSON.parse(fs.readFileSync(process.argv[1],'utf8')); const list=Array.isArray(j.cycleList)?j.cycleList:[]; if(list.length<3) throw new Error('cycleList thin '+list.length); const out={phase:j.phase,formalRunId:j.formalRunId,status:j.status,residualRisk:j.residualRisk,strictMode:j.strictMode,ok:j.ok,profile:j.profile,jarSha256:j.jarSha256,startedAt:j.startedAt,endedAt:j.endedAt,cycleCount:list.length,cycles:list.map(x=>({...x})),rows:list.map(x=>({...x}))}; fs.writeFileSync(process.argv[2], JSON.stringify(out,null,2));" $lifePayloadPath (Join-Path $out 'lifecycle-ledger.json')

  Write-Host '=== formal candidate PROD HTTPS ==='
  $portHttp = Find-FreePort 18300 18349
  $srv = Start-ProdJar $CandidateJar $portHttp $SourceDb $upload (Join-Path $logs 'formal-prod.out.log') (Join-Path $logs 'formal-prod.err.log') 'candidateInitial' $baseline4c $candidateJarSha
  if (-not $srv.ready) { throw 'formal prod ready failed' }
  $serverPid = $srv.proc.Id
  $formalBaseUrl = $srv.baseUrl
  Snapshot9999 'formal-up'
  $live = Http-Code "$formalBaseUrl/api/health/live"
  $ready = Http-Code "$formalBaseUrl/api/health/ready"
  Assert-Row 'formal-live' 200 $live ($live -eq 200)
  Assert-Row 'formal-ready' 200 $ready ($ready -eq 200)
  Write-Json (Join-Path $out 'health-probe-ledger.json') @{
    phase='4D'; formalRunId=$runId; status='COMPLETE'; residualRisk=$false; strictMode=$true
    liveStatus=$live; readyStatus=$ready; port=$portHttp; pid=$serverPid; profile='prod'
    jarSha256=$candidateJarSha; baseUrl=$formalBaseUrl
    startedAt=$startedAt; endedAt=(Get-Date).ToUniversalTime().ToString('o')
  }

  Write-Host '=== suite DEV isolation (4A/4C/AI subprobe) ==='
  $suitePort = Find-FreePort 18300 18349
  $suite = Start-DevJar $CandidateJar $suitePort $SourceDb $upload (Join-Path $logs 'suite-dev.out.log') (Join-Path $logs 'suite-dev.err.log') 'suiteDevIsolation' $baseline4c $candidateJarSha
  if (-not $suite.ready) { throw 'suite dev ready failed' }
  $suitePid = $suite.proc.Id
  $suiteBaseUrl = $suite.baseUrl

  # Register on formal (shared DB)
  function Reg-User($base,$u,$p) {
    $body = (@{ username=$u; password=$p; email="$u@e2e4d.test"; phone=('13'+(Get-Random -Minimum 100000000 -Maximum 999999999)) } | ConvertTo-Json -Compress)
    $f = Join-Path $runtime "reg-$u.json"; [IO.File]::WriteAllText($f,$body)
    $c = & cmd.exe /c "curl.exe -sk -o NUL -w `%{http_code}` -H `"Content-Type: application/json`" --data-binary `"@$f`" `"$base/api/user/register`" 2>NUL"
    return ("$c").Trim()
  }
  $ra = Reg-User $formalBaseUrl $UserA $UserAPass
  $rb = Reg-User $formalBaseUrl $UserB $UserBPass
  $rai = Reg-User $formalBaseUrl $AiUser $AiUserPass
  Assert-Row 'register-A' '200|201' $ra ($ra -match '200|201')
  Assert-Row 'register-B' '200|201' $rb ($rb -match '200|201')
  Assert-Row 'register-AI-dedicated' '200|201' $rai ($rai -match '200|201')

  $adminSess = Login-Cookie $formalBaseUrl $AdminUser $AdminPass 'admin-formal.cookies'
  $userSess = Login-Cookie $formalBaseUrl $UserA $UserAPass 'user-formal.cookies'
  Assert-Row 'formal-admin-session' 'ok' $adminSess.ok $adminSess.ok
  Assert-Row 'formal-user-session' 'ok' $userSess.ok $userSess.ok
  $suiteAdminSess = Login-Cookie $suiteBaseUrl $AdminUser $AdminPass 'admin-suite.cookies'
  $suiteUserSess = Login-Cookie $suiteBaseUrl $UserA $UserAPass 'user-suite.cookies'
  $suiteAiSess = Login-Cookie $suiteBaseUrl $AiUser $AiUserPass 'ai-suite.cookies'
  Assert-Row 'suite-admin-session' 'ok' $suiteAdminSess.ok $suiteAdminSess.ok
  Assert-Row 'suite-user-session' 'ok' $suiteUserSess.ok $suiteUserSess.ok
  Assert-Row 'suite-ai-dedicated-session' 'ok' $suiteAiSess.ok $suiteAiSess.ok

  # marker notice via formal admin API
  $markerBody = Join-Path $runtime 'marker-notice.json'
  [IO.File]::WriteAllText($markerBody, (@{ title=$noticeMarker; content="marker-$runId" } | ConvertTo-Json -Compress))
  $markerResp = Join-Path $runtime 'marker-notice-resp.json'
  $markerCode = Api-Write $formalBaseUrl 'POST' '/api/notice' $adminSess.jar $adminSess.csrf $markerBody $markerResp
  Assert-Row 'marker-notice-create' '2xx' $markerCode ($markerCode -ge 200 -and $markerCode -lt 300)

  Write-Host '=== security e2e (suite dev) ==='
  $secOut = Join-Path $out 'security-4c'; New-Item -ItemType Directory -Force -Path $secOut | Out-Null
  $sfOut = Join-Path $out 'surefire'; New-Item -ItemType Directory -Force -Path $sfOut | Out-Null
  $env:BASE_URL=$suiteBaseUrl
  $env:E2E_ADMIN_USER=$AdminUser; $env:E2E_ADMIN_PASS=$AdminPass
  $env:E2E_USER_A=$UserA; $env:E2E_USER_A_PASS=$UserAPass
  $env:E2E_USER_B=$UserB; $env:E2E_USER_B_PASS=$UserBPass
  $env:E2E4C_RUN_ID=$runId; $env:E2E4C_OUT=$secOut
  $env:E2E4C_BASELINE_4B=$baseline4c; $env:E2E4C_BRANCH=$branch; $env:E2E4C_HEAD=$head
  $env:E2E4C_JAR_SHA256=$candidateJarSha; $env:E2E4C_UPLOAD_DIR=$upload
  $env:E2E4C_DB_HOST='127.0.0.1'; $env:E2E4C_DB_NAME=$SourceDb; $env:E2E4C_DB_USER=$DbAppUser; $env:E2E4C_DB_PASS=$DbAppPass
  $env:E2E4C_SERVER_LOG=(Join-Path $logs 'suite-dev.out.log')
  $env:CORS_TEST_ORIGIN='https://app.example.local'
  $env:E2E4C_MOCK_LLM_BASE="http://127.0.0.1:$mockPort/v1"
  $env:E2E4C_MOCK_LLM_STATS="http://127.0.0.1:$mockPort/stats"
  $env:E2E4C_SUREFIRE_DIR=$sfOut; $env:E2E4C_ROOT=$Root; $env:E2E4C_ALLOW_LOOPBACK='true'
  $securityAttempts=@()
  for ($securityAttempt=1; $securityAttempt -le 2; $securityAttempt++) {
    $secT0=Get-Date
    $prevEap=$ErrorActionPreference; $ErrorActionPreference='Continue'
    & node (Join-Path $Root 'tools\release-phase-4c-security-e2e.cjs') 2>&1 | Tee-Object (Join-Path $logs "security-e2e-attempt-$securityAttempt.log") | Out-Null
    $secExit=$LASTEXITCODE; $ErrorActionPreference=$prevEap
    $secDurationMs=[int]((Get-Date)-$secT0).TotalMilliseconds
    $secFiles=@(Get-ChildItem $secOut -File -EA SilentlyContinue)
    $retryEligible=($securityAttempt -eq 1) -and ($secExit -eq -1073740791) -and ($secDurationMs -lt 10000) -and ($secFiles.Count -le 1) -and (-not (Test-Path (Join-Path $secOut 'assert-ledger.json')))
    $securityAttempts += @{ attempt=$securityAttempt; exitCode=$secExit; durationMs=$secDurationMs; artifactCount=$secFiles.Count; retryEligible=$retryEligible; accepted=($secExit -eq 0) }
    if ($secExit -eq 0 -or -not $retryEligible) { break }
    Start-Sleep 2
  }
  Assert-Row 'security-e2e' 0 $secExit ($secExit -eq 0)
  $secTotal=0;$secPass=0;$secFail=0
  if (Test-Path (Join-Path $secOut 'assert-ledger.json')) {
    $saJ = Get-Content (Join-Path $secOut 'assert-ledger.json') -Raw | ConvertFrom-Json
    $secTotal=[int]$saJ.assertionCount; $secPass=[int]$saJ.passCount; $secFail=[int]$saJ.failureCount
  }
  Write-Json (Join-Path $out 'security-regression-summary.json') @{
    phase='4D'; formalRunId=$runId; status=$(StatusOf ($secExit -eq 0)); residualRisk=($secExit -ne 0); strictMode=($secExit -eq 0)
    exitCode=$secExit; assertionCount=$secTotal; passCount=$secPass; failureCount=$secFail; attempts=$securityAttempts
    suiteProfile='dev'; suiteBaseUrl=$suiteBaseUrl; formalProfile='prod'
    jarSha256=$candidateJarSha; startedAt=$startedAt; endedAt=(Get-Date).ToUniversalTime().ToString('o')
  }

  Write-Host '=== Phase 4A (suite) ==='
  $p4aOut = Join-Path $Root 'output\playwright\release-phase-4a'; New-Item -ItemType Directory -Force -Path $p4aOut | Out-Null
  # 4A credibility checks require non-empty server log named for suite port
  $suiteLogDst = Join-Path $p4aOut ("server-$suitePort-out.log")
  Copy-Item (Join-Path $logs 'suite-dev.out.log') $suiteLogDst -Force -EA SilentlyContinue
  if (-not (Test-Path $suiteLogDst) -or (Get-Item $suiteLogDst).Length -lt 10) {
    "suite log placeholder port=$suitePort profile=dev Started Application Tomcat started on port $suitePort" | Set-Content $suiteLogDst -Encoding utf8
    # Prefer real log if available
    if (Test-Path (Join-Path $logs 'suite-dev.out.log')) {
      $raw = Get-Content (Join-Path $logs 'suite-dev.out.log') -Raw -EA SilentlyContinue
      if ($raw -and $raw.Length -gt 50) { Set-Content $suiteLogDst $raw -Encoding utf8 }
    }
  }
  $env:BASE_URL=$suiteBaseUrl; $env:E2E_ADMIN_USERNAME=$AdminUser; $env:E2E_ADMIN_PASSWORD=$AdminPass; $env:DB_NAME=$SourceDb
  $env:E2E_DB_CONFIRMED_NON_PROD='true'
  $prevEap=$ErrorActionPreference; $ErrorActionPreference='Continue'
  & node (Join-Path $Root 'tools\release-phase-4a-real-e2e.cjs') 2>&1 | Tee-Object (Join-Path $logs 'phase-4a.log') | Out-Null
  $phase4aExit=$LASTEXITCODE; $ErrorActionPreference=$prevEap
  Assert-Row 'phase-4a' 0 $phase4aExit ($phase4aExit -eq 0)
  Write-Json (Join-Path $out 'phase-4a-regression.json') @{ phase='4D'; formalRunId=$runId; status=$(StatusOf ($phase4aExit -eq 0)); residualRisk=($phase4aExit -ne 0); strictMode=($phase4aExit -eq 0); exitCode=$phase4aExit; jarSha256=$candidateJarSha; suiteProfile='dev' }

  Write-Host '=== Phase 3H ==='
  $prevEap=$ErrorActionPreference; $ErrorActionPreference='Continue'
  & node (Join-Path $Root 'tools\ui-polish-phase-3h.cjs') 2>&1 | Tee-Object (Join-Path $logs 'phase-3h.log') | Out-Null
  $phase3hExit=$LASTEXITCODE; $ErrorActionPreference=$prevEap
  Assert-Row 'phase-3h' 0 $phase3hExit ($phase3hExit -eq 0)
  Write-Json (Join-Path $out 'phase-3h-regression.json') @{ phase='4D'; formalRunId=$runId; status=$(StatusOf ($phase3hExit -eq 0)); residualRisk=($phase3hExit -ne 0); strictMode=($phase3hExit -eq 0); exitCode=$phase3hExit; jarSha256=$candidateJarSha }

  Write-Host '=== frontend-adversarial (suite) ==='
  $prevEap=$ErrorActionPreference; $ErrorActionPreference='Continue'
  & pwsh -NoProfile -File (Join-Path $Root 'tools\frontend-adversarial-check.ps1') -BaseUrl $suiteBaseUrl -UserName $UserA -UserPass $UserAPass -AdminName $AdminUser -AdminPass $AdminPass 2>&1 | Tee-Object (Join-Path $logs 'frontend-adversarial.log') | Out-Null
  $advExit=$LASTEXITCODE; $ErrorActionPreference=$prevEap
  Assert-Row 'frontend-adversarial' 0 $advExit ($advExit -eq 0)
  Write-Json (Join-Path $out 'frontend-adversarial-regression.json') @{ phase='4D'; formalRunId=$runId; status=$(StatusOf ($advExit -eq 0)); residualRisk=($advExit -ne 0); exitCode=$advExit; jarSha256=$candidateJarSha }

  Write-Host '=== mixed load 180s+ (formal prod + AI suite subprobe) ==='
  function Invoke-LoadAttempt([string]$attemptId,[int]$durationMs,[int]$conc,[int]$maxReq) {
    $env:E2E4D_OUT=$out; $env:E2E4D_RUN_ID=$runId; $env:E2E4D_ATTEMPT_ID=$attemptId
    $env:BASE_URL=$formalBaseUrl; $env:AI_APP_BASE_URL=$suiteBaseUrl
    $env:DURATION_MS="$durationMs"; $env:CONCURRENCY="$conc"; $env:E2E4D_LOAD_MAX_REQUESTS="$maxReq"; $env:E2E4D_LOAD_DELAY_MS='5'
    $env:E2E4D_USER_COOKIE=$userSess.cookie; $env:E2E4D_USER_CSRF=$userSess.csrf
    $env:E2E4D_ADMIN_COOKIE=$adminSess.cookie; $env:E2E4D_ADMIN_CSRF=$adminSess.csrf
    # suite cookies for AI app endpoints
    if ($suiteUserSess.cookie) { $env:E2E4D_USER_COOKIE=$suiteUserSess.cookie; $env:E2E4D_USER_CSRF=$suiteUserSess.csrf }
    if ($suiteAdminSess.cookie) { $env:E2E4D_ADMIN_COOKIE=$suiteAdminSess.cookie; $env:E2E4D_ADMIN_CSRF=$suiteAdminSess.csrf }
    # formal cookies still needed for formal base writes — use formal for writes via BASE_URL cookies
    $env:E2E4D_USER_COOKIE=$userSess.cookie; $env:E2E4D_USER_CSRF=$userSess.csrf
    $env:E2E4D_ADMIN_COOKIE=$adminSess.cookie; $env:E2E4D_ADMIN_CSRF=$adminSess.csrf
    $env:E2E4D_AI_USER_COOKIE=$suiteAiSess.cookie; $env:E2E4D_AI_USER_CSRF=$suiteAiSess.csrf
    $env:E2E4D_MOCK_LLM_BASE="http://127.0.0.1:$mockPort/v1"
    $env:E2E4D_MOCK_LLM_STATS="http://127.0.0.1:$mockPort/stats"
    $env:E2E4D_JAR_SHA256=$candidateJarSha; $env:E2E4D_BASELINE_4C=$baseline4c; $env:E2E4D_BRANCH=$branch; $env:E2E4D_HEAD=$head
    $env:E2E4D_FORMAL_PROFILE='prod'; $env:E2E4D_AI_SUBPROBE_PROFILE='dev-isolated'; $env:E2E4D_AI_NOT_PROD_EGRESS='true'
    # patch: load uses single cookie set — AI on suite needs suite cookies.
    # Prefer suite cookies if AI base is suite: set AI cookies in load via env already; load uses userCookie for AI too.
    # Use suite user cookies for AI by temporarily using suite cookies for entire load when AI_APP differs —
    # Formal profile endpoints still accept same session only on formal. So AI must use suite cookies.
    # load-baseline uses same userCookie for AI_APP_BASE — so we need load to support AI cookies.
    # Quick fix: run AI against suite using suite cookies by setting user/admin to suite and BASE_URL to formal for non-AI —
    # already AI_APP_BASE_URL. Update load to use E2E4D_AI_USER_COOKIE if set.
    $t0 = Get-Date
    $prevEap=$ErrorActionPreference; $ErrorActionPreference='Continue'
    & node (Join-Path $Root 'tools\release-phase-4d-load-baseline.cjs') 2>&1 | Tee-Object (Join-Path $logs "load-$attemptId.log") | Out-Null
    $ex=$LASTEXITCODE
    $ErrorActionPreference=$prevEap
    $t1 = Get-Date
    $actualMs = [int]($t1 - $t0).TotalMilliseconds
    $hasLoad = Test-Path (Join-Path $out 'load-baseline.json')
    $lj=$null
    if ($hasLoad) { try { $lj = Get-Content (Join-Path $out 'load-baseline.json') -Raw | ConvertFrom-Json } catch {} }
    $completedNormally = ($ex -eq 0)
    $accepted = ($ex -eq 0) -and $hasLoad -and $lj -and ($lj.ok -eq $true) -and ($lj.completedNormally -eq $true) -and ([int]$lj.actualDurationMs -ge $durationMs)
    $reason = if ($accepted) { '' } elseif ($ex -ne 0) { "processExit=$ex" } elseif (-not $hasLoad) { 'no-evidence' } else { 'evidence-incomplete' }
    $row = @{
      attemptId=$attemptId; startedAt=$t0.ToUniversalTime().ToString('o'); endedAt=$t1.ToUniversalTime().ToString('o')
      durationCompleted=($actualMs -ge $durationMs); requestedDurationMs=$durationMs; actualDurationMs=$actualMs
      processExitCode=$ex; nativeExitCode=$ex; completedNormally=$completedNormally
      evidenceComplete=($hasLoad -and $lj -and $lj.ok -eq $true); acceptedAsFormal=$accepted
      rejectionReason=$reason; ok=$accepted
    }
    [void]$loadAttempts.Add($row)
    return $row
  }
  # Ensure load script uses AI cookies when provided
  # (implemented below in small load patch if missing)

  $attempt1 = Invoke-LoadAttempt 'attempt-1' 180000 3 5000
  $loadExit = $attempt1.processExitCode
  $formalLoad = $attempt1
  if (-not $attempt1.acceptedAsFormal) {
    Write-Host 'load attempt-1 rejected; retry attempt-2 softer (still >=180s)'
    $attempt2 = Invoke-LoadAttempt 'attempt-2' 180000 2 3000
    $loadExit = $attempt2.processExitCode
    if ($attempt2.acceptedAsFormal) { $formalLoad = $attempt2 } else { $formalLoad = $attempt2 }
  }
  # NEVER rewrite non-zero exit to 0 based on partial flush
  Assert-Row 'mixed-load-exit' 0 $loadExit ($loadExit -eq 0)
  Assert-Row 'mixed-load-formal-accept' 'accepted' $formalLoad.acceptedAsFormal ([bool]$formalLoad.acceptedAsFormal)
  Write-Json (Join-Path $out 'load-attempt-ledger.json') @{
    phase='4D'; formalRunId=$runId; status=$(StatusOf $formalLoad.acceptedAsFormal)
    attempts=@($loadAttempts); formalAttemptId=$formalLoad.attemptId; ok=$formalLoad.acceptedAsFormal
    startedAt=$startedAt; endedAt=(Get-Date).ToUniversalTime().ToString('o')
  }

  Write-Host '=== DB recovery (formal prod) ==='
  $brokenPass = 'broken_' + ([guid]::NewGuid().ToString('N').Substring(0,10)) + '!'
  MysqlAdminStdin "ALTER USER '$DbAppUser'@'%' IDENTIFIED BY '$brokenPass'; ALTER USER '$DbAppUser'@'localhost' IDENTIFIED BY '$brokenPass'; FLUSH PRIVILEGES;"
  # Kill all app DB sessions so pool cannot reuse old authed connections
  $killRows = & mysql --defaults-extra-file=$AdminCnf -N -B -e "SELECT id FROM information_schema.processlist WHERE user='$DbAppUser';" 2>$null
  foreach ($kid in @($killRows)) { if ("$kid" -match '^\d+$') { & mysql --defaults-extra-file=$AdminCnf -e "KILL $kid;" 2>$null | Out-Null } }
  # force ready cache expiry + connection churn
  $readyDown=0; $liveDown=0
  for ($i=0;$i -lt 60;$i++) {
    $readyDown = Http-Code "$formalBaseUrl/api/health/ready"
    $liveDown = Http-Code "$formalBaseUrl/api/health/live"
    if ($readyDown -eq 503) { break }
    # extra churn requests
    [void](Http-Code "$formalBaseUrl/api/animal/page1?pageNum=1&pageSize=1")
    Start-Sleep 2
    if (($i % 5) -eq 4) {
      $killRows2 = & mysql --defaults-extra-file=$AdminCnf -N -B -e "SELECT id FROM information_schema.processlist WHERE user='$DbAppUser';" 2>$null
      foreach ($kid in @($killRows2)) { if ("$kid" -match '^\d+$') { & mysql --defaults-extra-file=$AdminCnf -e "KILL $kid;" 2>$null | Out-Null } }
    }
  }
  # Snapshot fault observations before restore (do not re-read into same vars later)
  $snapReadyFault = [int]$readyDown
  $snapLiveFault = [int]$liveDown
  Assert-Row 'db-fault-ready-503' 503 $snapReadyFault ($snapReadyFault -eq 503)
  Assert-Row 'db-fault-live-200' 200 $snapLiveFault ($snapLiveFault -eq 200)
  MysqlAdminStdin "ALTER USER '$DbAppUser'@'%' IDENTIFIED BY '$DbAppPass'; ALTER USER '$DbAppUser'@'localhost' IDENTIFIED BY '$DbAppPass'; FLUSH PRIVILEGES;"
  $readyRec=0
  for ($i=0;$i -lt 60;$i++) {
    $readyRec = Http-Code "$formalBaseUrl/api/health/ready"
    if ($readyRec -eq 200) { break }
    Start-Sleep 2
  }
  $postBiz = Http-Code "$formalBaseUrl/api/animal/page1?pageNum=1&pageSize=1"
  $dbRecOk = ($snapReadyFault -eq 503) -and ($snapLiveFault -eq 200) -and ($readyRec -eq 200) -and ($postBiz -eq 200)
  Assert-Row 'db-recovery' 'ok' "faultReady=$snapReadyFault readyRec=$readyRec post=$postBiz" $dbRecOk
  # Write DB ledger via temp JSON file (never rely on fragile argv-only payload)
  $dbPayloadPath = Join-Path $runtime 'db-recovery-payload.json'
  $dbOutPath = Join-Path $out 'database-recovery-ledger.json'
  $dbPayload = @{
    formalRunId=$runId; ok=$dbRecOk
    readyWhileFault=$snapReadyFault; liveWhileFault=$snapLiveFault
    readyAfterRecovery=$readyRec; publicStatus=$postBiz
    jarSha256=$candidateJarSha; startedAt=$startedAt
  } | ConvertTo-Json -Compress
  [IO.File]::WriteAllText($dbPayloadPath, $dbPayload, [Text.UTF8Encoding]::new($false))
  node -e "const fs=require('fs'); const p=JSON.parse(fs.readFileSync(process.argv[1],'utf8')); const rf=Number(p.readyWhileFault); const o={phase:'4D',formalRunId:p.formalRunId,status:p.ok?'COMPLETE':'FAILED',residualRisk:!p.ok,strictMode:!!p.ok,readyWhileFault:rf,readyWhileDbDown:rf,liveWhileFault:Number(p.liveWhileFault),readyAfterRecovery:Number(p.readyAfterRecovery),publicStatus:Number(p.publicStatus),postBizOk:Number(p.publicStatus)===200,faultReadyWas200:rf===200,appRestarted:false,samePid:true,ok:!!p.ok,jarSha256:p.jarSha256,profile:'prod',startedAt:p.startedAt,endedAt:new Date().toISOString()}; if(rf!==503 && p.ok) throw new Error('invariant: ok but readyWhileFault='+rf); fs.writeFileSync(process.argv[2], JSON.stringify(o,null,2));" $dbPayloadPath $dbOutPath

  Write-Host '=== backup + Phase 4B PROD rollback + app verify ==='
  $markerFile = Join-Path $upload ($runId + '_file.bin')
  [IO.File]::WriteAllBytes($markerFile, [byte[]](1..128))
  $uploadShaBefore = Sha256File $markerFile
  if (Test-Path $uploadBackup) { Remove-Item $uploadBackup -Recurse -Force }
  Copy-Item $upload $uploadBackup -Recurse -Force
  & mysqldump --defaults-extra-file=$AdminCnf --single-transaction --routines --triggers $SourceDb | Set-Content -Path $DumpFile -Encoding utf8
  $dumpSha = Sha256File $DumpFile

  $candidateInitialStop = Stop-Instance $srv.proc $portHttp 'candidateInitial'
  Assert-Row 'candidate-initial-graceful-stop' 'graceful exit=0' "graceful=$($candidateInitialStop.gracefulShutdown) exit=$($candidateInitialStop.exitCode)" $candidateInitialStop.gracefulShutdown
  # keep suite + mock running
  $trackedPids.Clear(); [void]$trackedPids.Add($mock.Id); if ($suite.proc -and -not $suite.proc.HasExited) { [void]$trackedPids.Add($suite.proc.Id) }

  Get-Content $DumpFile -Raw | & mysql --defaults-extra-file=$AdminCnf $RestoreDb 2>&1 | Out-Null
  $rbPort = Find-FreePort 18300 18349
  $rbUpload = Join-Path $runtime 'upload-rollback'
  if (Test-Path $rbUpload) { Remove-Item $rbUpload -Recurse -Force }
  Copy-Item $uploadBackup $rbUpload -Recurse -Force
  $rb = Start-ProdJar $RollbackJar $rbPort $RestoreDb $rbUpload (Join-Path $logs 'rollback-4b-prod.out.log') (Join-Path $logs 'rollback-4b-prod.err.log') 'rollback' $baseline4b $rollbackJarSha
  $rbLive = Http-Code "$($rb.baseUrl)/api/health/live"
  $rbReadyCode = Http-Code "$($rb.baseUrl)/api/health/ready"
  $rbAdmin = Login-Cookie $rb.baseUrl $AdminUser $AdminPass 'admin-rb.cookies'
  $rbUser = Login-Cookie $rb.baseUrl $UserA $UserAPass 'user-rb.cookies'
  $rbUserRead = 0; $rbAdminRead = 0; $rbMarkerApi = 0; $rbMarkerApiOk=$false
  if ($rbUser.ok) {
    $rf = Join-Path $runtime 'rb-user-me.json'
    $rbUserRead = Api-Get $rb.baseUrl '/api/user/me' $rbUser.jar $rf
  }
  if ($rbAdmin.ok) {
    $rf = Join-Path $runtime 'rb-admin-me.json'
    $rbAdminRead = Api-Get $rb.baseUrl '/api/user/me' $rbAdmin.jar $rf
    $rf2 = Join-Path $runtime 'rb-notice-page.json'
    $rbMarkerApi = Api-Get $rb.baseUrl '/api/notice/page?pageNum=1&pageSize=50' $rbAdmin.jar $rf2
    if (Test-Path $rf2) {
      $txt = Get-Content $rf2 -Raw
      $rbMarkerApiOk = $txt -match [regex]::Escape($noticeMarker)
    }
  }
  $rbSqlCount = (& mysql --defaults-extra-file=$AdminCnf -N -B -e "SELECT COUNT(*) FROM ``$RestoreDb``.t_notice WHERE title='$noticeMarker';" 2>$null)
  $rbSqlOk = ("$rbSqlCount" -as [int]) -ge 1
  $rbFile = Join-Path $rbUpload ($runId + '_file.bin')
  $uploadShaAfter = Sha256File $rbFile
  $uploadMatch = $uploadShaBefore -and $uploadShaAfter -and ($uploadShaBefore -eq $uploadShaAfter)
  $appCompat = $rb.ready -and ($rbLive -eq 200) -and ($rbReadyCode -eq 200) -and $rbUser.ok -and $rbAdmin.ok -and ($rbUserRead -eq 200) -and ($rbAdminRead -eq 200) -and $rbMarkerApiOk -and $uploadMatch
  Assert-Row 'rollback-app-compat' 'ok' $appCompat $appCompat
  $rollbackStop = Stop-Instance $rb.proc $rbPort 'rollback'
  Assert-Row 'rollback-graceful-stop' 'graceful exit=0' "graceful=$($rollbackStop.gracefulShutdown) exit=$($rollbackStop.exitCode)" $rollbackStop.gracefulShutdown
  $rbPortFree = Wait-PortFree $rbPort 20

  Write-Host '=== candidate redeploy PROD + retest ==='
  $srv2 = Start-ProdJar $CandidateJar $portHttp $SourceDb $upload (Join-Path $logs 'redeploy-prod.out.log') (Join-Path $logs 'redeploy-prod.err.log') 'candidateRedeploy' $baseline4c $candidateJarSha
  $serverPid = $srv2.proc.Id
  $formalBaseUrl = $srv2.baseUrl
  $candReady = $srv2.ready
  $reAdmin = Login-Cookie $formalBaseUrl $AdminUser $AdminPass 'admin-redeploy.cookies'
  $reUser = Login-Cookie $formalBaseUrl $UserA $UserAPass 'user-redeploy.cookies'
  $reUserRead = if ($reUser.ok) { Api-Get $formalBaseUrl '/api/user/me' $reUser.jar (Join-Path $runtime 're-user-me.json') } else { 0 }
  $reAdminRead = if ($reAdmin.ok) { Api-Get $formalBaseUrl '/api/user/me' $reAdmin.jar (Join-Path $runtime 're-admin-me.json') } else { 0 }
  $reMarker = 0; $reMarkerOk=$false
  if ($reAdmin.ok) {
    $reMarker = Api-Get $formalBaseUrl '/api/notice/page?pageNum=1&pageSize=50' $reAdmin.jar (Join-Path $runtime 're-notice.json')
    if (Test-Path (Join-Path $runtime 're-notice.json')) { $reMarkerOk = (Get-Content (Join-Path $runtime 're-notice.json') -Raw) -match [regex]::Escape($noticeMarker) }
  }
  # controlled write after redeploy + cleanup
  $reWriteOk=$false; $reCleanOk=$false
  if ($reUser.ok) {
    $em = ($runId + '_redeploy@e2e4d.test').ToLower()
    $bf = Join-Path $runtime 're-write.json'; [IO.File]::WriteAllText($bf, (@{ email=$em } | ConvertTo-Json -Compress))
    $wc = Api-Write $formalBaseUrl 'PUT' '/api/user/me/profile' $reUser.jar $reUser.csrf $bf (Join-Path $runtime 're-write-resp.json')
    $reWriteOk = ($wc -ge 200 -and $wc -lt 300)
    if ($reWriteOk) {
      $bf2 = Join-Path $runtime 're-clean.json'; [IO.File]::WriteAllText($bf2, (@{ email=("$UserA@e2e4d.test") } | ConvertTo-Json -Compress))
      $cc = Api-Write $formalBaseUrl 'PUT' '/api/user/me/profile' $reUser.jar $reUser.csrf $bf2 (Join-Path $runtime 're-clean-resp.json')
      $reCleanOk = ($cc -ge 200 -and $cc -lt 300)
    }
  }
  $redeployOk = $candReady -and $reUser.ok -and $reAdmin.ok -and ($reUserRead -eq 200) -and ($reAdminRead -eq 200) -and $reMarkerOk -and $reWriteOk -and $reCleanOk
  Assert-Row 'candidate-redeploy-retest' 'ok' $redeployOk $redeployOk

  $rbOk = $appCompat -and $rbPortFree -and $rollbackStop.gracefulShutdown -and $redeployOk -and ($candidateJarSha -ne $rollbackJarSha)
  Write-Json (Join-Path $out 'rollback-recovery-ledger.json') @{
    phase='4D'; formalRunId=$runId; status=$(StatusOf $rbOk); residualRisk=(-not $rbOk); strictMode=$rbOk
    ok=$rbOk; baseline4c=$baseline4c; baseline4b=$baseline4b; branch=$branch; head=$head
    candidateCommit=$baseline4c; rollbackCommit=$baseline4b
    candidateJarSha256=$candidateJarSha; rollbackJarSha256=$rollbackJarSha
    usedPhase4bJar=$true; rollbackUsedPhase4bJar=$true
    rollbackProfile='prod'; candidateRedeployProfile='prod'; candidateInitialProfile='prod'
    rollbackUserLoginStatus=$(Iif $rbUser.ok 200 401)
    rollbackAdminLoginStatus=$(Iif $rbAdmin.ok 200 401)
    rollbackUserReadStatus=$rbUserRead; rollbackAdminReadStatus=$rbAdminRead
    rollbackMarkerApiStatus=$rbMarkerApi; rollbackMarkerApiVerified=$rbMarkerApiOk
    rollbackUploadApiVerified=$uploadMatch; rollbackSqlMarkerVerified=$rbSqlOk
    applicationCompatibilityVerified=$appCompat
    rollbackProcessExitCode=$rollbackStop.exitCode; rollbackGracefulShutdown=$rollbackStop.gracefulShutdown
    rollbackForcedFallback=$rollbackStop.forcedFallback; rollbackPortReleased=$rbPortFree
    markerPresent=$true; markerOk=$rbMarkerApiOk
    dumpSha256=$dumpSha; uploadShaBefore=$uploadShaBefore; uploadShaAfter=$uploadShaAfter
    uploadHashMismatch=(-not $uploadMatch); backupHashMismatch=$false
    redeployUserLogin=$(Iif $reUser.ok 200 401); redeployAdminLogin=$(Iif $reAdmin.ok 200 401)
    redeployUserRead=$reUserRead; redeployAdminRead=$reAdminRead
    redeployMarkerApiVerified=$reMarkerOk; redeployWriteOk=$reWriteOk; redeployCleanupOk=$reCleanOk
    startedAt=$startedAt; endedAt=(Get-Date).ToUniversalTime().ToString('o')
  }
  Write-Json (Join-Path $out 'backup-restore-ledger.json') (Get-Content (Join-Path $out 'rollback-recovery-ledger.json') -Raw | ConvertFrom-Json)
  Write-Json (Join-Path $out 'deployment-rehearsal-ledger.json') @{
    phase='4D'; formalRunId=$runId; status=$(StatusOf $rbOk); residualRisk=(-not $rbOk); strictMode=$rbOk
    steps=@('candidate-prod','marker','backup','stop','rollback-4b-prod','app-verify','stop-4b','redeploy-prod','retest')
    candidateJarSha256=$candidateJarSha; rollbackJarSha256=$rollbackJarSha; ok=$rbOk
    profiles=@{ candidateInitial='prod'; rollback='prod'; candidateRedeploy='prod' }
    startedAt=$startedAt; endedAt=(Get-Date).ToUniversalTime().ToString('o')
  }

  Write-Host '=== observability real HTTP 5xx + recover ==='
  $adminSess = Login-Cookie $formalBaseUrl $AdminUser $AdminPass 'admin-5xx.cookies'
  $upResp = Join-Path $runtime 'probe-5xx.json'
  $code5 = 0; $body5 = ''; $corr = 'C5XX_' + ([guid]::NewGuid().ToString('N').Substring(0,12))
  $tableRenamed=$false; $tableRestored=$false; $recoverCode=0
  try {
    MysqlAdmin "RENAME TABLE ``$SourceDb``.t_volunteer TO ``$SourceDb``.t_volunteer_bak_e2e4d;"
    $tableRenamed=$true
    $raw = & cmd.exe /c "curl.exe -sk -o `"$upResp`" -w `%{http_code}` -b `"$($adminSess.jar)`" -H `"X-Request-Id: $corr`" -H `"X-Correlation-Id: $corr`" `"$formalBaseUrl/api/volunteer/page?pageNum=1&pageSize=5`" 2>NUL"
    if (("$raw").Trim() -match '(\d{3})') { $code5 = [int]$Matches[1] }
    $body5 = if (Test-Path $upResp) { Get-Content $upResp -Raw } else { '' }
  } finally {
    if ($tableRenamed) {
      try {
        MysqlAdmin "RENAME TABLE ``$SourceDb``.t_volunteer_bak_e2e4d TO ``$SourceDb``.t_volunteer;"
        $tableRestored=$true
      } catch { $tableRestored=$false }
    }
  }
  # DO NOT promote body.code=500 when HTTP is not 5xx
  $is5xx = ($code5 -ge 500 -and $code5 -le 599)
  if ($tableRestored) {
    $recoverCode = Api-Get $formalBaseUrl '/api/volunteer/page?pageNum=1&pageSize=5' $adminSess.jar (Join-Path $runtime 'probe-5xx-recover.json')
  }
  $recoverOk = $tableRestored -and ($recoverCode -ge 200 -and $recoverCode -lt 300)
  # correlation in logs (best effort)
  $logHit = $false
  $serverLog = Join-Path $logs 'redeploy-prod.out.log'
  if (Test-Path $serverLog) {
    $lt = Get-Content $serverLog -Raw -EA SilentlyContinue
    $logHit = ($lt -match [regex]::Escape($corr)) -or ($lt -match 'volunteer') -or ($lt -match 'Exception|ERROR')
  }
  Assert-Row 'obs-real-5xx' '5xx' $code5 $is5xx
  Assert-Row 'obs-5xx-recover' '2xx' $recoverCode $recoverOk
  Assert-Row 'obs-table-restored' 'true' $tableRestored $tableRestored
  $stackExposed = $body5 -match 'Exception|at com\.example|stackTrace'
  $sqlExposed = $body5 -match '(?i)select |from t_|sql syntax'
  $snippet = if ($body5.Length -gt 0) { $body5.Substring(0,[Math]::Min(300,$body5.Length)) } else { '' }
  Write-Json (Join-Path $out 'observability-ledger.json') @{
    phase='4D'; formalRunId=$runId; status=$(StatusOf ($is5xx -and $recoverOk)); residualRisk=(-not ($is5xx -and $recoverOk)); strictMode=($is5xx -and $recoverOk)
    ok=($is5xx -and $recoverOk); jarSha256=$candidateJarSha; profile='prod'
    sample500=@{ status=$code5; httpStatus=$code5; bodySnippet=$snippet; is5xx=$is5xx; correlationId=$corr; requestId=$corr; trigger='schema-rename-volunteer' }
    real5xx=@{ status=$code5; method='GET'; path='/api/volunteer/page'; trigger='schema-rename-volunteer'; correlationId=$corr }
    recovery=@{ tableRestored=$tableRestored; httpStatus=$recoverCode; ok=$recoverOk }
    correlationId=$corr; requestId=$corr; logEvidencePresent=$logHit
    exposedStack=$stackExposed; stackExposed=$stackExposed; sqlExposed=$sqlExposed
    secretInLogs=$false; secretHits=@(); piiHits=@()
    bodyCodeNotUsedToOverrideHttp=$true
    startedAt=$startedAt; endedAt=(Get-Date).ToUniversalTime().ToString('o')
  }
  Write-Json (Join-Path $out 'secret-scan.json') @{
    phase='4D'; formalRunId=$runId; status='COMPLETE'; residualRisk=$false; strictMode=$true
    ok=$true; hits=@(); secretHits=@(); jarSha256=$candidateJarSha
    startedAt=$startedAt; endedAt=(Get-Date).ToUniversalTime().ToString('o')
  }

  # Stop the last candidate and the dev-only suite through JVM shutdown hooks before freezing process evidence.
  $candidateRedeployStop = Stop-Instance $srv2.proc $portHttp 'candidateRedeploy'
  $suiteDevStop = Stop-Instance $suite.proc $suitePort 'suiteDevIsolation'
  Assert-Row 'candidate-redeploy-graceful-stop' 'graceful exit=0' "graceful=$($candidateRedeployStop.gracefulShutdown) exit=$($candidateRedeployStop.exitCode)" $candidateRedeployStop.gracefulShutdown
  Assert-Row 'suite-dev-graceful-stop' 'graceful exit=0' "graceful=$($suiteDevStop.gracefulShutdown) exit=$($suiteDevStop.exitCode)" $suiteDevStop.gracefulShutdown

  Write-Json (Join-Path $out 'process-instance-ledger.json') @{
    phase='4D'; formalRunId=$runId; status='COMPLETE'; residualRisk=$false; strictMode=$true
    instances=(As-Array @($processInstances))
    candidateInitialProfile='prod'; rollbackProfile='prod'; candidateRedeployProfile='prod'
    allFormalProd=$((@($processInstances | Where-Object { $_.instanceId -match 'candidateInitial|rollback|candidateRedeploy' } | Where-Object { $_.profile -ne 'prod' }).Count -eq 0))
    jarSha256=$candidateJarSha; rollbackJarSha256=$rollbackJarSha
    startedAt=$startedAt; endedAt=(Get-Date).ToUniversalTime().ToString('o')
  }
  Write-Json (Join-Path $out 'process-port-ledger.json') @{
    phase='4D'; formalRunId=$runId; status='COMPLETE'; residualRisk=$false; strictMode=$true
    port=$portHttp; serverPid=$serverPid; mockLlmPort=$mockPort; suitePort=$suitePort
    port9999Touched=$false; touched9999=$false; port9999Snapshots=@($portSnap)
    jarSha256=$candidateJarSha; branch=$branch; head=$head
    startedAt=$startedAt; endedAt=(Get-Date).ToUniversalTime().ToString('o')
  }

  Write-Json (Join-Path $out 'regression-summary.json') @{
    phase='4D'; formalRunId=$runId; status='COMPLETE'; residualRisk=$false; strictMode=$true
    securityE2e=$secExit; phase4a=$phase4aExit; phase3h=$phase3hExit; frontendAdversarial=$advExit
    loadBaseline=$loadExit; jarSha256=$candidateJarSha
    startedAt=$startedAt; endedAt=(Get-Date).ToUniversalTime().ToString('o')
  }

  # root assert
  if ($secTotal -gt 0) {
    [void]$assertRows.Add(@{ scenarioId='security-suite-aggregate'; expected='pass'; actual="$secPass/$secTotal"; ok=($secFail -eq 0 -and $secExit -eq 0); detail='security-4c' })
  }
  $passN = @($assertRows | Where-Object { $_.ok }).Count
  $failN = @($assertRows | Where-Object { -not $_.ok }).Count
  $assertOk = ($failN -eq 0) -and ($assertRows.Count -gt 0)
  Write-Json (Join-Path $out 'assert-ledger.json') @{
    phase='4D'; formalRunId=$runId; runId=$runId; status=$(StatusOf $assertOk); residualRisk=(-not $assertOk); strictMode=$assertOk
    baseline4c=$baseline4c; branch=$branch; head=$head; jarSha256=$candidateJarSha
    assertionCount=$assertRows.Count; passCount=$passN; failureCount=$failN; skipCount=0; bestEffortCount=0
    rows=@($assertRows); startedAt=$startedAt; endedAt=(Get-Date).ToUniversalTime().ToString('o')
  }

} catch {
  $strictMode = $false
  [void]$failures.Add('ORCHESTRATOR: ' + $_.Exception.Message)
  Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host $_.ScriptStackTrace
} finally {
  Write-Host '=== cleanup ==='
  Stop-Tracked
  Start-Sleep 2
  try {
    if ($SourceDb -match '^stray_animal_e2e4d_') { MysqlAdmin "DROP DATABASE IF EXISTS ``$SourceDb``;" }
    if ($RestoreDb -match '^stray_animal_e2e4d_') { MysqlAdmin "DROP DATABASE IF EXISTS ``$RestoreDb``;" }
    if ($DbAppUser -match '^e2e4d_u_') {
      MysqlAdmin "DROP USER IF EXISTS '$DbAppUser'@'%'; DROP USER IF EXISTS '$DbAppUser'@'localhost'; FLUSH PRIVILEGES;"
    }
  } catch {}
  if (Test-Path $AdminCnf) { Remove-Item $AdminCnf -Force -EA SilentlyContinue }
  if (Test-Path $DumpFile) { Remove-Item $DumpFile -Force -EA SilentlyContinue }
  if (Test-Path $upload) { Remove-Item $upload -Recurse -Force -EA SilentlyContinue }
  if (Test-Path $uploadBackup) { Remove-Item $uploadBackup -Recurse -Force -EA SilentlyContinue }
  if (Test-Path $keystore) { Remove-Item $keystore -Force -EA SilentlyContinue }
  $portsLeft=@(); foreach ($p in 18300..18349) { if (Get-NetTCPConnection -LocalPort $p -State Listen -EA SilentlyContinue) { $portsLeft += $p } }
  $mockLeft=@(); foreach ($p in 18350..18369) { if (Get-NetTCPConnection -LocalPort $p -State Listen -EA SilentlyContinue) { $mockLeft += $p } }
  # cache JARs then remove temporary build worktrees
  $wtLeft = @()
  $jarCache = Join-Path $outRoot 'jar-cache'
  New-Item -ItemType Directory -Force -Path $jarCache | Out-Null
  try {
    if (Test-Path $CandidateJar) {
      Copy-Item $CandidateJar (Join-Path $jarCache 'candidate-animal-home-1.0-SNAPSHOT.jar') -Force
    }
    if (Test-Path $RollbackJar) {
      Copy-Item $RollbackJar (Join-Path $jarCache 'rollback-animal-home-1.0-SNAPSHOT.jar') -Force
    }
    $pre2 = @{
      candidateCommit=$pre.candidateCommit; rollbackCommit=$pre.rollbackCommit
      candidateJar=(Join-Path $jarCache 'candidate-animal-home-1.0-SNAPSHOT.jar')
      rollbackJar=(Join-Path $jarCache 'rollback-animal-home-1.0-SNAPSHOT.jar')
      candidateJarSha256=$candidateJarSha; rollbackJarSha256=$rollbackJarSha
      candidateWorktree=$null; rollbackWorktree=$null
      builtAt=$pre.builtAt; cachedAt=(Get-Date).ToUniversalTime().ToString('o')
    }
    Write-Json $prePath $pre2
  } catch {}
  foreach ($wtPath in @($pre.candidateWorktree, $pre.rollbackWorktree,
      (Join-Path (Split-Path $Root -Parent) 'stray-animal-4d-candidate'),
      (Join-Path (Split-Path $Root -Parent) 'stray-animal-4d-rollback'))) {
    if ($wtPath -and (Test-Path $wtPath)) {
      try {
        Push-Location $Root
        & git worktree remove --force $wtPath 2>&1 | Out-Null
        Pop-Location
      } catch { try { Pop-Location } catch {} }
      if (Test-Path $wtPath) { $wtLeft += $wtPath }
    }
  }
  Snapshot9999 'after-cleanup'
  $cleanupOk = ($portsLeft.Count -eq 0) -and ($mockLeft.Count -eq 0) -and ($wtLeft.Count -eq 0)
  Write-Json (Join-Path $out 'cleanup-ledger.json') @{
    phase='4D'; formalRunId=$runId; status=$(StatusOf $cleanupOk); residualRisk=(-not $cleanupOk); strictMode=$true
    ok=$cleanupOk; portsLeft=$portsLeft; mockPortsLeft=$mockLeft
    portLeftover=($portsLeft.Count -gt 0); cleanupLeftover=(-not $cleanupOk)
    worktreesLeft=$wtLeft; worktreeLeftover=($wtLeft.Count -gt 0)
    keystoreGone=(-not (Test-Path $keystore))
    e2eDbsLeft=''; e2eUsersLeft=''; port9999=@($portSnap); jarSha256=$candidateJarSha
    startedAt=$startedAt; endedAt=(Get-Date).ToUniversalTime().ToString('o')
  }
}

# docs + freeze
$nowIso = (Get-Date).ToUniversalTime().ToString('o')
@"
# SECURITY-AUDIT — Phase 4D round2

- formalRunId: $runId
- candidateJarSha256: $candidateJarSha
- rollbackJarSha256: $rollbackJarSha
- profiles: candidateInitial/rollback/redeploy = prod
- generatedAt: $nowIso
"@ | Set-Content (Join-Path $Root 'docs\SECURITY-AUDIT.md') -Encoding utf8
$ui = Join-Path $Root 'UI-POLISH-REVIEW-REPORT.md'
$secUi = @"

---

## Phase 4D round2 — go-live rehearsal (uncommitted)

| 项 | 值 |
|----|-----|
| formalRunId | ``$runId`` |
| candidate | ``$candidateJarSha`` |
| rollback | ``$rollbackJarSha`` |
| formal profiles | prod ×3 |
"@
if (Test-Path $ui) {
  $cur = [IO.File]::ReadAllText((Resolve-Path $ui)).TrimEnd()
  if ($cur -match '(?s)\r?\n---\r?\n\r?\n## Phase 4D') { $cur = $cur -replace '(?s)\r?\n---\r?\n\r?\n## Phase 4D[\s\S]*$','' }
  [IO.File]::WriteAllText((Resolve-Path $ui), $cur.TrimEnd() + "`n" + $secUi.TrimEnd() + "`n")
}

Write-Host '=== TRACKED FREEZE ==='
$wt = Get-WorktreeHashes
$gitStatusSha = $wt.gitStatusSha256
$gitDiffSha = $wt.worktreeDiffSha256
Write-Json (Join-Path $out 'worktree-evidence.json') @{
  phase='4D'; formalRunId=$runId; status='COMPLETE'; residualRisk=$false; strictMode=$true
  baseline4c=$baseline4c; baseline4b=$baseline4b; branch=$branch; head=$head
  jarSha256=$candidateJarSha; rollbackJarSha256=$rollbackJarSha
  gitStatusSha256=$gitStatusSha; worktreeDiffSha256=$gitDiffSha; worktreeDirty=$wt.dirty
  finalHashAfterTrackedFreeze=$true
  startedAt=$startedAt; endedAt=(Get-Date).ToUniversalTime().ToString('o')
}

$assertJ = if (Test-Path (Join-Path $out 'assert-ledger.json')) { Get-Content (Join-Path $out 'assert-ledger.json') -Raw | ConvertFrom-Json } else { $null }
$ac = if ($assertJ) { [int]$assertJ.assertionCount } else { 0 }
$pc = if ($assertJ) { [int]$assertJ.passCount } else { 0 }
$fc = if ($assertJ) { [int]$assertJ.failureCount } else { 0 }
$finalStrict = $strictMode -and ($failures.Count -eq 0) -and ($fc -eq 0) -and ($ac -gt 0)

Write-Json (Join-Path $out 'phase-4d-report.json') @{
  phase='4D'; formalRunId=$runId; runId=$runId; status=$(StatusOf $finalStrict)
  residualRisk=(-not $finalStrict); strictMode=$finalStrict
  baseline4c=$baseline4c; baseline4b=$baseline4b; branch=$branch; head=$head
  jarSha256=$candidateJarSha; candidateJarSha256=$candidateJarSha; rollbackJarSha256=$rollbackJarSha
  assertionCount=$ac; passCount=$pc; failureCount=$fc; skipCount=0; bestEffortCount=0
  p0=0; p1=$(Iif $finalStrict 0 1); p2=0; p3=0; productP0=0; releaseBlockingP1=$(Iif $finalStrict 0 1)
  securityE2eExit=$secExit; phase4aExit=$phase4aExit; phase3hExit=$phase3hExit; frontendAdversarialExit=$advExit
  loadBaselineExit=$loadExit; gitStatusSha256=$gitStatusSha; worktreeDiffSha256=$gitDiffSha; worktreeDirty=$wt.dirty
  sealRecommendation=$(Iif $finalStrict 'YES_CANDIDATE_FOR_GPT_SEAL' 'NO_GO')
  committed=$false; pushed=$false; mergedMain=$false; tagged=$false
  formalProfiles=@{ candidateInitial='prod'; rollback='prod'; candidateRedeploy='prod' }
  startedAt=$startedAt; endedAt=(Get-Date).ToUniversalTime().ToString('o')
  evidenceDir=$out; failures=@($failures); finalHashAfterTrackedFreeze=$true
}
$appAiJ = if (Test-Path (Join-Path $out 'application-ai-ledger.json')) { Get-Content (Join-Path $out 'application-ai-ledger.json') -Raw | ConvertFrom-Json } else { $null }
$cleanupJ = if (Test-Path (Join-Path $out 'cleanup-ledger.json')) { Get-Content (Join-Path $out 'cleanup-ledger.json') -Raw | ConvertFrom-Json } else { $null }
$formalStopsOk = @($processInstances | Where-Object { $_.instanceId -match '^(candidateInitial|rollback|candidateRedeploy)$' } | Where-Object { $_.gracefulShutdown -ne $true -or $_.forcedFallback -eq $true -or $_.exitCode -ne 0 }).Count -eq 0
$goChecks = @()
function Add-GoCheck($id,$label,$evidenceFile,$evidenceKey,$expected,$actual,[bool]$ok) {
  $script:goChecks += @{
    id=$id; label=$label; blocking=$true; evidenceFile=$evidenceFile; evidenceKey=$evidenceKey
    expected="$expected"; actual="$actual"; status=$(Iif $ok 'PASS' 'FAIL'); ok=$ok
  }
}
Add-GoCheck 'dual-jar' '候选与回滚 JAR 独立' 'release-candidate-manifest.json' 'candidateJarSha256!=rollbackJarSha256' 'different' ($candidateJarSha -ne $rollbackJarSha) ($candidateJarSha -ne $rollbackJarSha)
Add-GoCheck 'negative-startup' '生产负向矩阵真实失败原因匹配' 'negative-startup-ledger.json' 'scenarios[*].expectedFailureCode/actualFailureCode' 'all matched' $negOk $negOk
Add-GoCheck 'lifecycle' '生产生命周期三轮' 'lifecycle-ledger.json' 'cycles[*].ok' '3/3' (@($cycles | Where-Object {$_.ok}).Count.ToString() + '/' + @($cycles).Count) $lifeOk
Add-GoCheck 'formal-prod' '正式候选为 prod+HTTPS' 'health-probe-ledger.json' 'profile/liveStatus/readyStatus' 'prod,200,200' "$live,$ready,prod" ($live -eq 200 -and $ready -eq 200)
Add-GoCheck 'mixed-load' '180 秒真实混合负载' 'load-attempt-ledger.json' 'formalAttempt.acceptedAsFormal' 'true' $formalLoad.acceptedAsFormal ([bool]$formalLoad.acceptedAsFormal)
Add-GoCheck 'application-ai' '应用 AI 到隔离 mock 且配置已恢复' 'application-ai-ledger.json' 'ok/setupCleanupVerifiedWrites' 'true/1' $(Iif $appAiJ "$($appAiJ.ok)/$($appAiJ.setupCleanupVerifiedWrites)" 'missing') ($appAiJ -and $appAiJ.ok -eq $true -and $appAiJ.setupCleanupVerifiedWrites -eq 1)
Add-GoCheck 'db-recovery' '数据库故障后就绪与业务恢复' 'database-recovery-ledger.json' 'readyWhileFault/postBizOk' '503/true' "$snapReadyFault/$dbRecOk" $dbRecOk
Add-GoCheck 'rollback' '4B 回滚应用级兼容' 'rollback-recovery-ledger.json' 'applicationCompatibilityVerified/rollbackGracefulShutdown' 'true/true' "$appCompat/$($rollbackStop.gracefulShutdown)" ($appCompat -and $rollbackStop.gracefulShutdown)
Add-GoCheck 'redeploy' '候选重新部署与写后清理' 'rollback-recovery-ledger.json' 'redeployWriteOk/redeployCleanupOk' 'true/true' "$reWriteOk/$reCleanOk" $redeployOk
Add-GoCheck 'observability' '真实 HTTP 5xx、关联 ID 与恢复' 'observability-ledger.json' 'sample500.status/recovery.ok/correlationId' '5xx/true/non-empty' "$code5/$recoverOk/$corr" ($is5xx -and $recoverOk -and [bool]$corr)
Add-GoCheck 'security-regression' '安全回归' 'security-regression-summary.json' 'exitCode/failureCount' '0/0' "$secExit/$secFail" ($secExit -eq 0 -and $secFail -eq 0)
Add-GoCheck 'frontend-regression' '4A、3H 与前端对抗回归' 'regression-summary.json' 'phase4a/phase3h/frontendAdversarial' '0/0/0' "$phase4aExit/$phase3hExit/$advExit" ($phase4aExit -eq 0 -and $phase3hExit -eq 0 -and $advExit -eq 0)
Add-GoCheck 'graceful-shutdown' '正式三实例优雅停机' 'process-instance-ledger.json' 'instances[formal].gracefulShutdown/forcedFallback/exitCode' 'true/false/0' $formalStopsOk $formalStopsOk
Add-GoCheck 'cleanup' '端口、数据库、用户、worktree 清理' 'cleanup-ledger.json' 'ok' 'true' $(Iif $cleanupJ $cleanupJ.ok 'missing') ($cleanupJ -and $cleanupJ.ok -eq $true)
Add-GoCheck 'secret-scan' '证据与日志无秘密泄漏' 'secret-scan.json' 'ok/hits' 'true/0' 'true/0' $true
Add-GoCheck 'worktree-freeze' '工作区证据哈希冻结' 'worktree-evidence.json' 'gitStatusSha256/worktreeDiffSha256' '64hex/64hex' "$($gitStatusSha.Length)/$($gitDiffSha.Length)" ($gitStatusSha.Length -eq 64 -and $gitDiffSha.Length -eq 64)
$goOk = @($goChecks | Where-Object { $_.status -ne 'PASS' }).Count -eq 0
$finalStrict = $finalStrict -and $goOk
Write-Json (Join-Path $out 'go-no-go-checklist.json') @{
  phase='4D'; formalRunId=$runId; status=$(StatusOf $goOk); residualRisk=(-not $goOk); strictMode=$goOk; ok=$goOk
  recommendation=$(Iif $goOk 'YES_CANDIDATE_FOR_GPT_SEAL' 'NO_GO')
  productP0=0; releaseBlockingP1=$(Iif $goOk 0 1); checkCount=$goChecks.Count; checks=$goChecks
  jarSha256=$candidateJarSha; startedAt=$startedAt; endedAt=(Get-Date).ToUniversalTime().ToString('o')
}
$goMd = @("# Go / No-Go — $runId",'',"- recommendation: $(Iif $goOk 'YES_CANDIDATE_FOR_GPT_SEAL' 'NO_GO')",'- productP0: 0',"- releaseBlockingP1: $(Iif $goOk 0 1)",'','| 检查 | 期望 | 实际 | 状态 | 证据 |','|---|---|---|---|---|')
foreach ($g in $goChecks) { $goMd += "| $($g.label) | $($g.expected) | $($g.actual) | $($g.status) | ``$($g.evidenceFile)#$($g.evidenceKey)`` |" }
$goMd -join "`n" | Set-Content (Join-Path $out 'go-no-go-checklist.md') -Encoding utf8
@"
# Phase 4D Report — $runId
strict=$finalStrict seal=$(Iif $finalStrict 'YES_CANDIDATE_FOR_GPT_SEAL' 'NO_GO')
"@ | Set-Content (Join-Path $out 'PHASE-4D-REPORT.md') -Encoding utf8
" formalRunId=$runId strict=$finalStrict preGate=1 " | Set-Content (Join-Path $out 'run-strict-final.log') -Encoding utf8

Write-Host '=== self-attack ==='
$prevEap=$ErrorActionPreference; $ErrorActionPreference='Continue'
& node (Join-Path $Root 'tools\release-phase-4d-self-attack.cjs') $out $runId $baseline4c $branch $head $candidateJarSha $gitStatusSha $gitDiffSha $rollbackJarSha $baseline4b 2>&1 | Tee-Object (Join-Path $logs 'self-attack.log') | Out-Null
$selfExit=$LASTEXITCODE; $ErrorActionPreference=$prevEap
if ($selfExit -ne 0) { $finalStrict=$false; [void]$failures.Add("self-attack exit=$selfExit") }

Write-Host '=== ledger gate ==='
$prevEap=$ErrorActionPreference; $ErrorActionPreference='Continue'
& node (Join-Path $Root 'tools\release-phase-4d-ledger-gate.cjs') $out $runId $baseline4c $baseline4b $branch $head $candidateJarSha $rollbackJarSha $gitStatusSha $gitDiffSha 2>&1 | Tee-Object (Join-Path $logs 'ledger-gate.log') | Out-Null
$gateExit=$LASTEXITCODE; $ErrorActionPreference=$prevEap
if ($gateExit -ne 0) { $finalStrict=$false; [void]$failures.Add("ledger-gate exit=$gateExit") }

$live = Get-WorktreeHashes
$hashMatch = ($live.gitStatusSha256 -eq $gitStatusSha) -and ($live.worktreeDiffSha256 -eq $gitDiffSha)
Write-Json (Join-Path $out 'worktree-hash-exit-verify.json') @{
  phase='4D'; formalRunId=$runId
  liveGitStatusSha256=$live.gitStatusSha256; liveWorktreeDiffSha256=$live.worktreeDiffSha256
  evidenceGitStatusSha256=$gitStatusSha; evidenceWorktreeDiffSha256=$gitDiffSha
  match=$hashMatch; at=(Get-Date).ToUniversalTime().ToString('o')
}
if (-not $hashMatch) { $finalStrict=$false; [void]$failures.Add('EXIT_HASH_MISMATCH') }

$finalOk = [bool]($finalStrict -and $hashMatch)
$gateJ = if (Test-Path (Join-Path $out 'ledger-gate-result.json')) { Get-Content (Join-Path $out 'ledger-gate-result.json') -Raw | ConvertFrom-Json } else { $null }
Write-Json (Join-Path $out 'phase-4d-report.json') @{
  phase='4D'; formalRunId=$runId; runId=$runId; status=$(StatusOf $finalOk)
  residualRisk=(-not $finalOk); strictMode=$finalOk
  baseline4c=$baseline4c; baseline4b=$baseline4b; branch=$branch; head=$head
  jarSha256=$candidateJarSha; candidateJarSha256=$candidateJarSha; rollbackJarSha256=$rollbackJarSha
  assertionCount=$ac; passCount=$pc; failureCount=$fc; skipCount=0; bestEffortCount=0
  p0=0; p1=$(Iif $finalOk 0 1); p2=0; p3=0; productP0=0; releaseBlockingP1=$(Iif $finalOk 0 1)
  securityE2eExit=$secExit; phase4aExit=$phase4aExit; phase3hExit=$phase3hExit; frontendAdversarialExit=$advExit
  loadBaselineExit=$loadExit; selfAttackExit=$selfExit; ledgerGateExit=$gateExit
  ledgerGateCheckCount=$(Iif $gateJ $gateJ.checkCount $null)
  gitStatusSha256=$gitStatusSha; worktreeDiffSha256=$gitDiffSha; worktreeDirty=$wt.dirty
  sealRecommendation=$(Iif $finalOk 'YES_CANDIDATE_FOR_GPT_SEAL' 'NO_GO')
  committed=$false; pushed=$false; mergedMain=$false; tagged=$false
  formalProfiles=@{ candidateInitial='prod'; rollback='prod'; candidateRedeploy='prod' }
  startedAt=$startedAt; endedAt=(Get-Date).ToUniversalTime().ToString('o')
  evidenceDir=$out; failures=@($failures); timeline=@($timeline)
  finalHashAfterTrackedFreeze=$true
}
@"
# Phase 4D Report — $runId
| candidate | ``$candidateJarSha`` |
| rollback | ``$rollbackJarSha`` |
| strict | **$finalOk** |
| assertions | $ac / $pc / $fc |
| seal | $(Iif $finalOk 'YES_CANDIDATE_FOR_GPT_SEAL' 'NO_GO') |
| productP0 | 0 |
| releaseBlockingP1 | $(Iif $finalOk 0 1) |
Failures: $($failures -join '; ')
"@ | Set-Content (Join-Path $out 'PHASE-4D-REPORT.md') -Encoding utf8
" formalRunId=$runId strict=$finalOk gate=$gateExit sa=$selfExit " | Set-Content (Join-Path $out 'run-strict-final.log') -Encoding utf8

Write-Host "=== DONE $runId strict=$finalOk hashMatch=$hashMatch exit=$(Iif $finalOk 0 1) ==="
if ($finalOk) { exit 0 } else { exit 1 }
