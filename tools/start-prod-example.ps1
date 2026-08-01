# Production start example (crash-hardening P0.4).
# Does not embed secrets. Calls tools/prod-preflight.ps1 first.
# See docs/PRODUCTION-DEPLOYMENT-RUNBOOK.md

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location -Path $Root

$Jar = Join-Path $Root "target\animal-home-1.0-SNAPSHOT.jar"
if (-not (Test-Path -LiteralPath $Jar)) {
  Write-Error "JAR missing: run mvn clean verify first"
  exit 2
}

if (-not $env:SPRING_PROFILES_ACTIVE) {
  Write-Error "Set SPRING_PROFILES_ACTIVE=prod (and other required env names; values not shown here)"
  exit 2
}

$preflight = Join-Path $PSScriptRoot "prod-preflight.ps1"
if (-not (Test-Path -LiteralPath $preflight)) {
  Write-Error "prod-preflight.ps1 missing"
  exit 2
}

$serverPort = 0
if ($env:SERVER_PORT) { [void][int]::TryParse($env:SERVER_PORT, [ref]$serverPort) }

& $preflight -JarPath $Jar -Port $serverPort
if ($LASTEXITCODE -ne 0) {
  Write-Error "prod-preflight failed; refusing to start Java"
  exit $LASTEXITCODE
}

# Prefer JAVA_HOME; otherwise require a resolvable `java` on PATH (no hardcoded machine paths).
$JavaExe = if ($env:JAVA_HOME -and (Test-Path (Join-Path $env:JAVA_HOME "bin\java.exe"))) {
  Join-Path $env:JAVA_HOME "bin\java.exe"
} else {
  $cmd = Get-Command java -ErrorAction SilentlyContinue
  if (-not $cmd) {
    Write-Error "Java not found: set JAVA_HOME or put java on PATH"
    exit 2
  }
  $cmd.Source
}

# Fixed heap + ExitOnOutOfMemoryError; secrets only via process environment (already set by operator).
& $JavaExe `
  -Xms512m -Xmx1024m `
  -XX:+ExitOnOutOfMemoryError `
  -Dfile.encoding=UTF-8 `
  -jar $Jar

exit $LASTEXITCODE
