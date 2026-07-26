# 演示/发布前一键检查（不启动服务：需服务已在跑）
#   $env:SPRING_PROFILES_ACTIVE="dev"; mvn spring-boot:run
#   powershell -ExecutionPolicy Bypass -File tools/pre-demo-check.ps1

param(
  [string]$BaseUrl = "http://localhost:9999",
  [switch]$SkipMavenTests
)

$ErrorActionPreference = "Continue"
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root
$fail = 0

function Step($name, $scriptBlock) {
  Write-Host "`n>>> $name" -ForegroundColor Cyan
  & $scriptBlock
  if ($LASTEXITCODE -ne 0 -and $null -ne $LASTEXITCODE) {
    Write-Host "STEP FAIL exit=$LASTEXITCODE" -ForegroundColor Red
    $script:fail++
  }
}

if (-not $SkipMavenTests) {
  Step "mvn test" { mvn -q test }
} else {
  Write-Host "`n>>> skip mvn test (L3_PARTIAL if only this flag)" -ForegroundColor Yellow
}

Step "file-asset-db-and-disk" {
  # 孤儿物理文件默认 WARN；严格 meta 缺失才 fail
  powershell -ExecutionPolicy Bypass -File "$PSScriptRoot\verify-file-asset-db.ps1" -AllowOrphans
}

Step "smoke-test" {
  powershell -ExecutionPolicy Bypass -File "$PSScriptRoot\smoke-test.ps1" -BaseUrl $BaseUrl
}

Step "adversarial-auth" {
  powershell -ExecutionPolicy Bypass -File "$PSScriptRoot\adversarial-auth-test.ps1" -BaseUrl $BaseUrl
}

Step "adversarial-auth-matrix" {
  powershell -ExecutionPolicy Bypass -File "$PSScriptRoot\adversarial-auth-matrix.ps1" -BaseUrl $BaseUrl
}

Step "adversarial-upload" {
  powershell -ExecutionPolicy Bypass -File "$PSScriptRoot\adversarial-upload-test.ps1" -BaseUrl $BaseUrl
}

Step "frontend-adversarial" {
  powershell -ExecutionPolicy Bypass -File "$PSScriptRoot\frontend-adversarial-check.ps1" -BaseUrl $BaseUrl
}

Step "schema-readonly-matrix" {
  # 只读 MySQL 契约（非破坏性）；破坏性自愈请单独：
  #   tools/adversarial-schema-test.ps1 -Destructive -ConfirmToken DESTROY_SCHEMA_TEST
  powershell -ExecutionPolicy Bypass -File "$PSScriptRoot\p0-mysql-collation-matrix.ps1" -BaseUrl $BaseUrl
}

Step "p0-session-identity-probes" {
  powershell -ExecutionPolicy Bypass -File "$PSScriptRoot\p0-session-identity-probes.ps1" -BaseUrl $BaseUrl
}

$mode = if ($SkipMavenTests) { "L3_PARTIAL" } else { "L3_FULL_LOCAL" }
Write-Host "`n=== pre-demo-check done mode=$mode fail=$fail ===" -ForegroundColor Cyan
if ($fail -gt 0) { exit 1 } else { exit 0 }
