# Production preflight — validates env names only; never prints secret values.
# Exit non-zero on any failure. Does not start Java or mutate databases.
param(
  [string]$JarPath = "",
  [int]$Port = 0
)

$ErrorActionPreference = "Stop"
$failures = New-Object System.Collections.Generic.List[string]

function Fail([string]$name, [string]$reason) {
  $script:failures.Add("$name : $reason")
  Write-Host "PREFLIGHT FAIL: $name — $reason" -ForegroundColor Red
}

function Pass([string]$name) {
  Write-Host "PREFLIGHT PASS: $name" -ForegroundColor Green
}

# Profile
$profile = $env:SPRING_PROFILES_ACTIVE
if ([string]::IsNullOrWhiteSpace($profile)) {
  Fail "SPRING_PROFILES_ACTIVE" "missing"
} elseif ($profile.Trim() -ne "prod") {
  Fail "SPRING_PROFILES_ACTIVE" "must be exactly 'prod' (got non-secret length=$($profile.Length))"
} else {
  Pass "SPRING_PROFILES_ACTIVE"
}

# JAR
if ([string]::IsNullOrWhiteSpace($JarPath)) {
  $root = Split-Path -Parent $PSScriptRoot
  $JarPath = Join-Path $root "target\animal-home-1.0-SNAPSHOT.jar"
}
if (-not (Test-Path -LiteralPath $JarPath)) {
  Fail "JAR" "not found at configured path"
} elseif (-not (Get-Item -LiteralPath $JarPath).Length -gt 0) {
  Fail "JAR" "empty or unreadable"
} else {
  Pass "JAR"
}

# Java 17+ via JAVA_HOME or PATH only (no hardcoded machine paths)
$javaCandidates = @()
if ($env:JAVA_HOME) { $javaCandidates += (Join-Path $env:JAVA_HOME "bin\java.exe") }
$javaCmd = Get-Command java -ErrorAction SilentlyContinue
if ($javaCmd) { $javaCandidates += $javaCmd.Source }
$javaOk = $false
foreach ($jc in $javaCandidates) {
  try {
    if (-not (Test-Path -LiteralPath $jc)) { continue }
    $jv = & $jc -version 2>&1 | Out-String
    if ($jv -match 'version "1[7-9]|version "[2-9]\d') {
      $javaOk = $true
      break
    }
  } catch { }
}
if (-not $javaOk) { Fail "JAVA" "Java 17+ required (set JAVA_HOME or PATH)" } else { Pass "JAVA" }

# Secrets presence/length only (never print values)
$jwt = $env:JWT_SECRET
if ([string]::IsNullOrEmpty($jwt)) {
  Fail "JWT_SECRET" "missing"
} elseif ($jwt.Length -lt 32) {
  Fail "JWT_SECRET" "length < 32"
} else {
  Pass "JWT_SECRET"
}

$aiKey = $env:AI_CONFIG_ENCRYPTION_KEY
if ([string]::IsNullOrEmpty($aiKey)) {
  Fail "AI_CONFIG_ENCRYPTION_KEY" "missing"
} else {
  $aiBytes = [System.Text.Encoding]::UTF8.GetByteCount($aiKey)
  if ($aiBytes -lt 32) {
    Fail "AI_CONFIG_ENCRYPTION_KEY" "UTF-8 bytes < 32"
  } else {
    Pass "AI_CONFIG_ENCRYPTION_KEY"
  }
}

if (-not [string]::IsNullOrEmpty($jwt) -and -not [string]::IsNullOrEmpty($aiKey) -and $jwt -eq $aiKey) {
  Fail "SECRET_PAIR" "JWT_SECRET and AI_CONFIG_ENCRYPTION_KEY must differ"
} elseif (-not [string]::IsNullOrEmpty($jwt) -and -not [string]::IsNullOrEmpty($aiKey)) {
  Pass "SECRET_PAIR"
}

# DB
$dbHost = $env:DB_HOST
if ([string]::IsNullOrWhiteSpace($dbHost)) {
  Fail "DB_HOST" "missing"
} elseif ($dbHost -match '^(localhost|127\.0\.0\.1)$') {
  Fail "DB_HOST" "localhost/127.0.0.1 forbidden in prod"
} else {
  Pass "DB_HOST"
}

$dbName = $env:DB_NAME
if ([string]::IsNullOrWhiteSpace($dbName)) {
  Fail "DB_NAME" "missing"
} elseif ($dbName -match '^(test|mysql|information_schema|performance_schema|sys)$') {
  Fail "DB_NAME" "forbidden system/test database name"
} else {
  Pass "DB_NAME"
}

$dbUser = $env:DB_USERNAME
if ([string]::IsNullOrWhiteSpace($dbUser)) {
  Fail "DB_USERNAME" "missing"
} elseif ($dbUser -eq "root") {
  Fail "DB_USERNAME" "root forbidden"
} else {
  Pass "DB_USERNAME"
}

if ([string]::IsNullOrEmpty($env:DB_PASSWORD)) {
  Fail "DB_PASSWORD" "missing"
} else {
  Pass "DB_PASSWORD"
}

# Upload dir
$upload = $env:FILE_UPLOAD_DIR
if ([string]::IsNullOrWhiteSpace($upload)) {
  Fail "FILE_UPLOAD_DIR" "missing"
} elseif (-not [System.IO.Path]::IsPathRooted($upload)) {
  Fail "FILE_UPLOAD_DIR" "must be absolute"
} elseif ($upload -match '\.stray-animal') {
  Fail "FILE_UPLOAD_DIR" "must not be development .stray-animal path"
} else {
  try {
    if (-not (Test-Path -LiteralPath $upload)) {
      New-Item -ItemType Directory -Path $upload -Force | Out-Null
    }
    $probe = Join-Path $upload (".preflight-probe-" + [guid]::NewGuid().ToString("N"))
    [IO.File]::WriteAllBytes($probe, [byte[]](1))
    Remove-Item -LiteralPath $probe -Force -ErrorAction Stop
    Pass "FILE_UPLOAD_DIR"
  } catch {
    Fail "FILE_UPLOAD_DIR" "not writable or probe cleanup failed"
    if (Test-Path $probe -ErrorAction SilentlyContinue) {
      Remove-Item -LiteralPath $probe -Force -ErrorAction SilentlyContinue
    }
  }
}

# Port free (optional)
if ($Port -gt 0) {
  $busy = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
  if ($busy) {
    Fail "PORT" "port $Port already LISTEN"
  } else {
    Pass "PORT"
  }
}

# Schema pure-check expectation (config names only)
if ($env:APP_SCHEMA_GUARD_AUTO_MIGRATE -eq "true") {
  Fail "SCHEMA_AUTO_MIGRATE" "must be false for prod pure-check"
} else {
  Pass "SCHEMA_PURE_CHECK_HINT"
}

# CORS — reject empty and unrestricted wildcards (app also enforces)
$cors = $env:CORS_ALLOWED_ORIGIN_PATTERNS
function Test-UnsafeCors([string]$c) {
  if ([string]::IsNullOrWhiteSpace($c)) { return $true }
  foreach ($part in ($c -split '\s*,\s*')) {
    $p = $part.Trim()
    if (-not $p) { continue }
    if ($p -eq '*' -or $p -match '^(?i)https?://\*$' -or $p -eq '*://*' -or $p -match '^(?i)\*://\*$') {
      return $true
    }
  }
  return $false
}
if (Test-UnsafeCors $cors) {
  Fail "CORS_ALLOWED_ORIGIN_PATTERNS" "empty or unrestricted wildcard forbidden"
} else {
  Pass "CORS_ALLOWED_ORIGIN_PATTERNS"
}

Write-Host ""
if ($failures.Count -gt 0) {
  Write-Host "PREFLIGHT SUMMARY: FAILED ($($failures.Count))" -ForegroundColor Red
  $failures | ForEach-Object { Write-Host " - $_" }
  exit 1
}
Write-Host "PREFLIGHT SUMMARY: OK" -ForegroundColor Green
exit 0
