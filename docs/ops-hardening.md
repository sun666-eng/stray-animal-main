# 长期稳定性：如何「彻底」降低 3 个月后翻车概率

没有银弹。彻底 = **工程防护 + 运维纪律 + 验收门禁**，而不是再改一两个业务 if。

## 五层防护（对应五类风险）

| 风险 | 彻底做法 | 本仓库已落地 |
|------|----------|--------------|
| 库结构漂移 | 启动 SchemaGuard 自动补列/角色；统一 bootstrap SQL | `SchemaGuardRunner` + `docs/sql/bootstrap-all.sql` |
| 权限改坏 | 固定三类账号冒烟；义工只用轻量角色 4 | `tools/smoke-test.ps1`；`VOLUNTEER_ROLE_ID=4` |
| 脏状态数据 | 启动 DataHealth 告警；业务上通过时驳回竞争申请 | `DataHealthRunner`；`AdoptService.rejectCompetingPending` |
| 登录态假死 | 前台统一带 JWT；401 清本地 user/token | `front-nav.js` / `admin-auth.js` |
| 上传目录漂移 | 绝对路径默认 `${user.home}/.stray-animal/upload` | `application.yml` `file.upload-dir` |

## 每次部署必做（5 分钟）

```powershell
# 1. 环境变量
$env:JWT_SECRET = "至少32位随机串-生产务必改"
$env:DB_PASSWORD = "你的库密码"
# 可选固定上传目录
$env:FILE_UPLOAD_DIR = "D:\data\stray-animal\upload"

# 2. 启动后冒烟
powershell -ExecutionPolicy Bypass -File tools/smoke-test.ps1
```

冒烟失败 = **禁止对外演示/上线**。

## 生产建议（更彻底）

1. **密钥**：生产 `JWT_SECRET` 固定且 ≥32 位，不要用 dev 默认空密钥逻辑。  
2. **备份**：MySQL + `%USERPROFILE%\.stray-animal\upload`（或 `FILE_UPLOAD_DIR`）一起备份。  
3. **权限变更流程**：改 `t_role` 后必须跑 smoke-test；不要只点页面看一眼。  
4. **（可选升级）** 引入 Flyway/Liquibase 管理版本化迁移，逐步替代手工 SQL。  
5. **（可选）** CI 里跑 `mvn test` + 对测试库执行 bootstrap + smoke。

## 配置开关

| 配置 | 默认 | 含义 |
|------|------|------|
| `app.schema-guard.enabled` | true | 启动结构检查 |
| `app.schema-guard.auto-migrate` | true | 自动补列/角色 |
| `app.schema-guard.fail-fast` | false | true=结构不对直接拒绝启动 |
| `app.data-health.enabled` | true | 脏数据告警 |
| `app.volunteer.auto-grant-role-id` | 4 | 义工轻量角色 |

生产若不允许自动 DDL：设 `SCHEMA_GUARD_AUTO_MIGRATE=false` 且部署流水线先执行 `bootstrap-all.sql`，并设 `SCHEMA_GUARD_FAIL_FAST=true`。
