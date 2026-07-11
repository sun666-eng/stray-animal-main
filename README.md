# 基于 Web 的流浪动物救助管理系统的设计与开发

## 项目介绍

本项目是一个基于 Web 的流浪动物救助与领养管理系统。救助组织可以通过系统管理用户、动物信息、领养申请、义工申请、救助请求、回访记录、公告公示和收支记录；普通用户可以浏览待领养动物、提交领养申请、提交义工申请、提交救助请求并查看相关公示信息。

## 技术栈

客户端：Vue.js、Ajax、jQuery、Element UI。

服务端：Spring Boot 2.7.x、MyBatis Plus、MyBatis、JWT、BCrypt、WebSocket、Redis 可选。

数据库：MySQL。

构建工具：Maven。

## 推荐运行环境

- JDK：8 或 17。当前项目按 Java 8 字节码目标编译，不建议在生产环境混用未验证的 JDK 版本。
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

启动项目：

```bash
mvn spring-boot:run
```

启动后访问：

```text
http://localhost:9999/page/end
```

默认后台账号需以数据库初始化数据为准。若启用了 `DATA_FIX_ENABLED=true`，系统会尝试修复部分默认权限数据。

## 安全注意事项

- 不要在生产环境使用弱数据库密码或弱 Redis 密码。
- 不要在生产环境使用默认 `JWT_SECRET`。
- 上传目录不要指向项目源码目录或临时目录。
- 生产环境必须收紧 CORS 允许来源。
- WebSocket 聊天连接需要使用登录后获取的 JWT token。

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
