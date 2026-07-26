# 基于 Web 的流浪动物救助管理系统的设计与开发

## 项目介绍

本项目是一个基于 Web 的流浪动物救助与领养管理系统。救助组织可以通过系统管理用户、动物信息、领养申请、义工申请、救助请求、回访记录、公告公示和收支记录；普通用户可以浏览待领养动物、提交领养申请、提交义工申请、提交救助请求并查看相关公示信息。

## 技术栈

客户端：Vue.js、Ajax、jQuery、Element UI。

服务端：Spring Boot 3.4.x（Java 17+）、MyBatis Plus、JWT、BCrypt、WebSocket、Redis 可选。

数据库：MySQL。

构建工具：Maven。

## 推荐运行环境

- JDK：17 或 21（Spring Boot 3.x 最低要求 17；按 Java 17 字节码编译）。
- Maven：3.6+
- MySQL：5.7+ 或 8.x
- Redis：可选，仅在启用多实例 WebSocket 广播时需要。

## 环境变量

启动前建议显式配置以下环境变量：

```text
DB_HOST=localhost
DB_PORT=3306
DB_NAME=test
DB_USERNAME=root
DB_PASSWORD=your_password
JWT_SECRET=your-32-char-minimum-secret-value
FILE_UPLOAD_DIR=D:/animal-home/upload
REDIS_ENABLED=false
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=your_redis_password
CORS_ALLOWED_ORIGIN_PATTERNS=http://localhost:*,http://127.0.0.1:*
DATA_FIX_ENABLED=false
```

说明：

- `JWT_SECRET` 生产环境必须配置，长度至少 32 个字符。
- `FILE_UPLOAD_DIR` 建议使用固定绝对路径，避免部署后文件写入不可预期目录。
- `REDIS_ENABLED=false` 时 WebSocket 使用本机广播；多实例部署时可启用 Redis 广播。
- 生产环境应将 `CORS_ALLOWED_ORIGIN_PATTERNS` 收紧为实际前端域名。

## 配置说明

主配置文件位于：

```text
src/main/resources/application.yml
```

重要配置：

```yaml
server:
  port: 9999

spring:
  datasource:
    url: jdbc:mysql://${DB_HOST:localhost}:${DB_PORT:3306}/${DB_NAME:test}?useUnicode=true&characterEncoding=utf-8&useSSL=false&serverTimezone=GMT%2b8
    username: ${DB_USERNAME:root}
    password: ${DB_PASSWORD:}
  servlet:
    multipart:
      max-file-size: 10MB
      max-request-size: 20MB

app:
  redis:
    enabled: ${REDIS_ENABLED:false}
  jwt:
    secret: ${JWT_SECRET:}
```

未显式指定 profile 时默认使用 `dev`，允许本地开发密钥直接启动。生产部署必须使用
`--spring.profiles.active=prod` 并设置长度至少 32 个字符的 `JWT_SECRET`，否则应用会拒绝启动。

## 启动方式

编译：

```bash
mvn clean compile
```

运行测试：

```bash
mvn test
```

启动项目（**本地须显式 dev profile**）：

```bash
# Windows PowerShell
$env:SPRING_PROFILES_ACTIVE="dev"
mvn spring-boot:run

# 或
mvn spring-boot:run -Dspring-boot.run.profiles=dev
```

生产示例：

```bash
$env:SPRING_PROFILES_ACTIVE="prod"
$env:JWT_SECRET="至少32位随机串-勿用开发密钥"
$env:DB_PASSWORD="强库密"
# 空库首启管理员（可选）：
# $env:INITIAL_ADMIN_ENABLED="true"
# $env:INITIAL_ADMIN_USERNAME="opsadmin"
# $env:INITIAL_ADMIN_PASSWORD="长随机密码至少10位"
mvn spring-boot:run
```

启动后访问：

```text
http://localhost:9999/page/end
```

`test.sql` 不再内置任何默认账号（明文弱口令种子已移除）。空库首个管理员请通过 `INITIAL_ADMIN_*` 环境变量引导创建（见 `docs/sql/dev-seed-notes.md`）。若启用了 `DATA_FIX_ENABLED=true`，系统会尝试修复部分默认权限数据。

## 安全注意事项

- 不要在生产环境使用弱数据库密码或弱 Redis 密码。
- 不要在生产环境使用默认 / 开发 `JWT_SECRET`；`prod` 与 `prod,dev` 均强制生产密钥规则。
- 本地开发请显式 `SPRING_PROFILES_ACTIVE=dev`（已取消默认 dev）。
- 上传目录不要指向项目源码目录或临时目录。
- 生产环境必须收紧 CORS 允许来源。
- 状态变更 API 须带 `X-CSRF-Token`（登录响应或 `GET /api/user/csrf`）。
- 文件上传建议带 `purpose`：`animal`/`avatar`/`notice`（公开），`proof`/`visit`/`volunteer`/`help`（私有）。
- 上传走 `/api/files/{flag}`，**不要**再依赖 `/file/**` 直链上传目录。
- WebSocket 聊天连接使用登录后 `/api/user/ws-ticket` 一次性票据。

## 发布前检查

```powershell
$env:SPRING_PROFILES_ACTIVE="dev"
# 终端1: mvn spring-boot:run
# 终端2:
powershell -ExecutionPolicy Bypass -File tools/pre-demo-check.ps1
# 人工: docs/L4-manual-checklist.md
```

## 主要模块

- 用户管理
- 角色权限管理
- 动物信息管理
- 领养申请与审核
- 义工申请管理
- 救助请求与在线咨询
- 回访记录管理
- 领养凭证管理
- 公告公示管理
- 收支记录管理
