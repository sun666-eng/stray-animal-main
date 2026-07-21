# 长期稳定性：如何「彻底」降低 3 个月后翻车概率

没有银弹。彻底 = **工程防护 + 运维纪律 + 验收门禁**，而不是再改一两个业务 if。

## 数据库漂移（已按契约闭环）

| 层级 | 机制 |
|------|------|
| 基线 | `test.sql` 已含 `pstatus` / `apic` / TEXT / 角色4 |
| 手工 | `docs/sql/bootstrap-all.sql` 幂等补齐旧库 |
| 运行时 | `SchemaGuardRunner` 启动检查+自动 DDL+断言，写入 `app_schema_meta.schema_version=2026.07.12-loop-v2` |
| 对抗验收 | `tools/adversarial-schema-test.ps1`：删列→重启→自愈→接口可用 |

## 五层防护（对应五类风险）

| 风险 | 彻底做法 | 本仓库已落地 |
|------|----------|--------------|
| 库结构漂移 | 启动 SchemaGuard 自动补列/角色；统一 bootstrap SQL | `SchemaGuardRunner` + `docs/sql/bootstrap-all.sql` + 对抗脚本 |
| 权限改坏 | 角色契约 Guard + 冒烟 + 对抗脚本 | `RolePermissionGuardRunner` + `RoleContracts` + `tools/adversarial-permission-test.ps1` |
| 脏状态数据 | DataStateGuard 启动修复 + DataHealth 复核 + 业务审核时驳回竞争 | `DataStateGuardRunner` + `DataHealthRunner` + `tools/adversarial-datastate-test.ps1` |
| 登录态假死 | auth-session + `/api/user/me` 静默校验；JWT+Session 双通道；401 清本地 | `auth-session.js` + `UserController.me` + `tools/adversarial-auth-test.ps1` |
| 上传目录漂移 | `FileStorage` 强制绝对路径+可写探针；meta 记录路径；相对路径锚定 home | `FileStorage` + `FileStorageHealthRunner` + `tools/adversarial-upload-test.ps1` |

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
