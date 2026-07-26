# 生产启动示例（崩溃预防 P0.4，进程守护完整方案见 docs/crash-hardening-plan.md）
# 使用前：
#   1. mvn package 生成 target/animal-home-1.0-SNAPSHOT.jar
#   2. 按 docs/crash-hardening-plan.md 附录 checklist 设置全部环境变量
#   3. 建议用 winsw / 计划任务包装本脚本实现崩溃自动拉起
#
# 关键 JVM 参数说明：
#   -Xms/-Xmx                     固定堆，避免默认堆在小内存机器上不可预期
#   -XX:+ExitOnOutOfMemoryError   OOM 立即退出交给守护拉起，杜绝 OOM 后僵尸态
#   工作目录固定                    logback 输出到相对路径 ./logs，依赖 cwd

$ErrorActionPreference = "Stop"
Set-Location -Path (Split-Path -Parent $PSScriptRoot)   # 固定工作目录 = 仓库根

# ==== 必填环境变量（示例，请替换为真实值）====
# $env:SPRING_PROFILES_ACTIVE = "prod"
# $env:JWT_SECRET   = "<至少32位随机串>"
# $env:DB_HOST      = "<内网IP，prod 禁止 localhost>"
# $env:DB_USERNAME  = "<非root账号>"
# $env:DB_PASSWORD  = "<强密码>"
# $env:FILE_UPLOAD_DIR = "D:/data/stray-animal/upload"

if (-not $env:SPRING_PROFILES_ACTIVE) {
    Write-Error "请先设置 SPRING_PROFILES_ACTIVE 等环境变量（见脚本内注释与 docs/crash-hardening-plan.md）"
}

java `
    -Xms512m -Xmx1024m `
    -XX:+ExitOnOutOfMemoryError `
    -Dfile.encoding=UTF-8 `
    -jar target/animal-home-1.0-SNAPSHOT.jar
