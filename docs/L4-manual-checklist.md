# L4 独立/人工复审清单（收尾）

在代码与 L3 证据就绪后，由**非实现者**或本机人工按下列项勾选。  
**当前策略**：在未满足 VERIFIED 六条硬标准前，STATUS 保持 `IMPLEMENTED`，勿提前标 `REVIEWED`。

## 前置

- [ ] `SPRING_PROFILES_ACTIVE=dev` 启动成功
- [ ] `mvn clean package` 全绿
- [ ] `tools/pre-demo-check.ps1` 全绿（**不要**仅靠 `-SkipMavenTests` 宣称完整 L3）
- [ ] `tools/verify-file-asset-db.ps1 -AllowOrphans` → STRICT PASS
- [ ] `tools/adversarial-auth-matrix.ps1` → fail=0

## 浏览器认证（Session 唯一权威）

- [ ] 登录后 `sessionStorage` 有 user / csrfToken；**无** `sessionStorage.token` / `localStorage.token`
- [ ] 登录 JSON **无** `data.token` 字段（或为 null）
- [ ] 开发者工具 Network：业务请求 **不** 带 `Authorization: Bearer`
- [ ] POST 带 `X-CSRF-Token` 成功；去掉 CSRF 的 POST 为 403
- [ ] 统一退出：点退出后 Network 为 **POST** `/api/user/logout`，随后跳转登录
- [ ] GET `/api/user/logout` 为 **405**
- [ ] 退出后 `/api/user/me` 401；用任意历史 Bearer 访问 `/me` 仍 401

## 浏览器业务 / XSS

- [ ] 管理端 `help.html` 聊天：恶意用户名历史消息**不执行脚本**（textContent）
- [ ] 上传动物图 `purpose=animal`（管理员）后前台可匿名看到
- [ ] 上传凭证图 `purpose=proof` 后匿名打开 `/api/files/{flag}` 为 403
- [ ] 缺文件附件 404（非头像）；无元数据 403

## 权限

- [ ] 普通用户无法打开 `/api/user/online` 用户列表
- [ ] 普通用户无法 `export` 凭证/领养
- [ ] 仅 `user` 管理不能把账号升为超管（roleId=1）
- [ ] 资金公示页无经手人 / 无 `allRecords`
- [ ] 管理端资金 CRUD 使用 `/api/account/page`（有 id）

## 文件旁路

- [ ] 使用**真实** `stored_name` 访问 `/file/{stored_name}` 不得 200 直出私有文件
- [ ] `/api/files/{flag}` 权限与元数据一致

## 部署约束

- [ ] 生产 profile：Session Cookie `secure=true`、HTTPS 入口
- [ ] WebSocket **单实例**（`app.websocket.single-instance-only`）

## 通过准则

全部勾选且无 P0/P1 遗留，方可评估将核心项升 `VERIFIED` 并宣称完整安全闭环。  
物理孤儿文件若仍存在，须在答辩说明「未入 active 元数据、不经 `/api/files` 暴露」。
