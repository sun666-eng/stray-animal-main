# 开发种子账号说明（A0.2）

## 现状

历史 `test.sql` 可能包含：

- `admin` / `admin`（超管，明文或弱口令）
- 其他演示账号 `123456`

**生产基线不得依赖这些账号。**

## 推荐做法

### 本地开发

1. 使用已有开发库时：登录后会在 `allow-plaintext-login=true` 下自动升级为 BCrypt。
2. 新库：执行结构脚本后，用管理员功能创建用户，或：

```text
INITIAL_ADMIN_ENABLED=true
INITIAL_ADMIN_USERNAME=devadmin
INITIAL_ADMIN_PASSWORD=至少10位非弱口令
SPRING_PROFILES_ACTIVE=dev
```

### 生产

- 正式库 **不要** 导入带弱口令的 `test.sql` 用户段。
- 空库用 `INITIAL_ADMIN_*` 引导首个超管，创建后删除环境变量。
- `prod` 下 `admin` 明文密码会 **拒绝启动**（见 `InitialAdminBootstrap`）。

### 可选：手工改密 SQL 思路

不要在仓库写入真实强密码哈希。运维在安全环境生成 BCrypt 后更新：

```sql
UPDATE t_user SET password = '$2a$...' WHERE username = 'admin';
```

## 与计划关系

- A0.2 代码：`InitialAdminBootstrap` + prod 弱密探测
- 本文件：明确 dev/prod 种子策略，避免把公开弱口令当作正式交付基线
