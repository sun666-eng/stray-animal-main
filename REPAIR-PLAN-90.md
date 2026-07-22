# 流浪动物救助管理系统 — 安全加固计划（v3.1 · 决策已锁定）

> **文档用途**：可执行的安全整改方案（范围与架构决策已拍板）。
> **文档状态**：**计划已锁定 · 代码尚未实施**。清单中 `MUST` / `IN SCOPE` / `OUT OF SCOPE` / `DEFER` 只表示计划范围，**不表示已完成**。
> **完成态唯一来源**：`REPAIR-PLAN-90-STATUS.md`。
> **原则**：先写失败测试再修；端点原子化；禁止用文档/随机 flag/WARN 冒充修复；**Security Gate 1 未通过不得宣称安全加固完成**。

---

## 0. 背景与目标

### 0.1 当前定位

| 口径 | 大致分数 | 说明 |
|------|----------|------|
| 课设 / 可演示工程 | **~78–82** | 存在可利用存储型 XSS、Session 旧权限、默认 dev 密钥、种子弱口令、导出/文件暴露 |
| 生产级严格标准 | **~65–70** | 认证模型与对象级控制未闭环 |

### 0.2 主目标

- **最终交付按 R2**：含完整文件 OLAC（B3-F），课设口径目标约 **88–90**。
- **分两里程碑交付**，降低一次性改动风险：
  - **M1** = 原 R1 范围 → **核心认证与授权安全基线**（**不是**「最小安全闭环」）
  - **M2** = B3-F + 历史迁移 + 双路径测试 → **完整安全闭环**（仅 M1+M2 均 VERIFIED 后可宣称）
- 每项 MUST：**代码 + 可复现测试 + 验收命令**；状态只写 STATUS。

### 0.3 对外表述纪律

| 阶段 | 允许宣称 | 禁止宣称 |
|------|----------|----------|
| Gate 1 未过 | 无「安全加固完成」 | 任何安全闭环表述 |
| **仅 M1 VERIFIED** | 已修复核心认证、角色提权、存储型 XSS、接口越权与会话失效；**文件 OLAC 为已知遗留风险** | 「整个系统已完成安全闭环」 |
| **M1+M2 VERIFIED** | 完整安全闭环（含文件对象级访问） | — |
| 工期不足退回仅 M1 | 同「仅 M1」+ 文档标明后续；**敏感附件环境不公网部署**；必要时临时停用敏感上传 | 完整闭环 |

### 0.4 非目标

1. 不重写 Vue3 SPA / 不换完整 Spring Security / 不上微服务。
2. 不改领养联合主键（可加状态机与约束）。
3. 不批量改论文。
4. 不把文档、随机 flag、WARN 算高风险已修。
5. 完整 Flyway 全库改造 / Docker / 前端 layout 重构 → **DEFER**（文件表可用可重复 SQL/轻量版本脚本，不必等全量 Flyway）。

### 0.5 勾选语义

| 标记 | 含义 |
|------|------|
| `MUST` | 必须做 |
| `IN SCOPE` | 本轮范围（未完成） |
| `OUT OF SCOPE` | 明确不做并写原因 |
| `DEFER` | 后置 |

**禁止**在本文件用 `[x]` 表示已实施。

### 0.6 Security Gate 1（进入大规模 B2 前）

```text
Security Gate 1 = 下列全部 STATUS=VERIFIED：
  A0.1 + A0.2 + A0.3 + A0.4 + A0.5 + A0.6 + A0.7
```

- **A0.4 / A0.5 为账号接管边界与权限撤销边界**：任一项未 VERIFIED → 不得宣称管理员端安全闭环 / 认证闭环 / 实时撤权。
- Gate 1 通过后，才进入大规模 B2 端点整改。

---

## 1. 已锁定决策（§13 正式结论）

| 决策项 | 锁定结论 |
|--------|----------|
| **范围** | **R2**，分 **M1 → M2** 两里程碑 |
| **B3** | **B3-F**（M2）；M1 阶段文件 OLAC 为已知遗留，**不**标为已修复 |
| **认证权威** | **浏览器 Session 权威**；Session **仅存 userId**；每次受保护请求按 userId 查库并重算权限；**JWT 不再作为浏览器请求的独立认证凭据**；WebSocket 用一次性 ticket |
| **CSRF** | Session 权威后 **MUST** 增加 CSRF（见 A0.5/A0.8） |
| **种子账号** | **改良 S1**：dev 固定演示账号（BCrypt）；正式基线 **不含** 特权管理员；prod 用 `INITIAL_ADMIN_*` 引导；弱种子 prod fail-fast；**不**采用纯 S2 随机密码打日志 |
| **JWT 浏览器存储** | **最终态：浏览器不保存 JWT**（删 localStorage/sessionStorage token）；过渡期若必须保留：仅 sessionStorage + TTL 15–30 分钟，**禁止 localStorage** |
| **Account 公示** | 匿名公开 **专用 DTO**（名称/金额/用途/日期/分类）；不返回内部 ID 经手人联系方式/allRecords/审核字段；统计用 SQL 聚合 |
| **`/online`** | 普通用户 **不可枚举用户名**；管理端可按需保留或仅人数；WS 不向全员广播完整用户名列表；在线数据不参与鉴权 |
| **进度** | 仅 `REPAIR-PLAN-90-STATUS.md` |
| **测试策略** | **L1 复现 + L2 单项即时对抗 + L3 阶段门禁 + L4 独立最终复审**（细则见 STATUS） |
| **工期** | M1 约 5–7 日；M2 约 2–4 日；R2 合计 **7–10 日**（含测试门禁；历史文件乱则缓冲 **8–12 日**） |

---

## 2. 里程碑与工期

| 里程碑 | 内容 | 交付性质 | 工期 |
|--------|------|----------|------|
| **M1** | A0 全量（含 CSRF）、A1–A3、B1/B1.1、B2/B2.1、B4、B6、B7、基础 C | **核心认证与授权安全基线** | 5–7 日 |
| **M2** | B3-F（元数据、绑定、迁移、`/file/**` 旁路、双路径测试）+ 加固测试 | **完整安全闭环** | 2–4 日（合计进 R2 7–10 日） |

```text
Phase A0  信任面 + XSS + Session 权威 + CSRF + HTTP + 种子/profile   MUST · 约 2.5–3.5 天
Phase A   口令 / 限流（登录退出并入 A0.7）                           MUST · 约 0.5–1 天
Phase B   角色 / 接口越权 / 业务状态 / 资金面 /（M2）文件 OLAC         MUST · 约 3–5 天
Phase C   MockMvc 与回归（与上并行/收尾）                             MUST · 约 1.5–2 天
Phase D/E DEFER
```

---

## 3. Phase A0 — P0 底座（MUST · Gate 1）

### A0.1 JWT 密钥与 profile 优先级

| 规则 | ① active 含 **prod** → 生产规则无条件优先，禁止 DEV_SECRET/空密钥；② 删除或不再依赖 `spring.profiles.default: dev`，本地显式 `dev`；③ 无 profile → **安全默认**（禁止开发密钥），或 `allow-dev-secret=true` **且** profile=dev 双条件；④ WARN 不算控制 |
| 测试 | 无 profile / dev / test / prod / prod,dev / 未知 |
| 说明 | 浏览器最终不依赖 JWT 后，密钥治理仍必须（过渡期、WS ticket 签发依赖、防误配） |

### A0.2 种子账号（改良 S1 · 已锁定）

| 规则 | 正式基线 SQL **无**特权管理员；`test.sql` 中 `admin/admin` 与明文 `123456` 移除或迁到 **仅 dev** 脚本；dev 演示账号 BCrypt 固定口令且文档标明仅本地；prod：`INITIAL_ADMIN_USERNAME` + `INITIAL_ADMIN_PASSWORD` 创建首个管理员（应用内 BCrypt）；已有管理员则跳过；无管理员且无 env → **拒绝启动**；**日志不打印明文密码**；创建后轮换/删除 env；smoke 从 env 读账号；prod 检测已知弱种子 → fail-fast |
| 不采用 | 纯 S2「随机密码打印日志」 |

### A0.3 生产配置与 Guard

| 规则 | `application-prod.yml`：JWT（若仍签发）/CORS/全部自动改数 Guard 默认关或 fail-fast；非 dev/test 启动校验 |

### A0.4 存储型 XSS（P0 · 账号接管边界）

| 链 | 恶意用户名 → 聊天 → `help.html`/`im.html` 未转义 username + `insertAdjacentHTML` → 管理端同源脚本 → 读 token / 调管理 API |
| MUST | 输出转义或 DOM+textContent；用户名长度/字符集（纵深）；公告/描述/回复纯文本 vs 富文本策略；统一 `AuthSession.clearSession()`；**最终浏览器不存 JWT**（见 §1） |
| 验收 | `<img onerror=...>` 等载荷管理端不执行 |
| 纪律 | **未 VERIFIED 不得宣称管理员端安全闭环** |

### A0.5 Session 权威与权限刷新（P0 · 权限撤销边界 · 已锁定模型）

| 锁定模型 | **浏览器页面/API：Session 唯一权威**；Session **只存 userId**；每次受保护请求查库用户 + 按 DB 角色重算权限；用户不存在 → 401 + `invalidate`；撤权/改密立即在下次请求生效；**JWT 不作为浏览器独立认证**；WS：Session 登录后申请 **一次性短时 ticket**；`UserController.MAP` / WS `sessionMap` **不参与鉴权** |
| 禁止 | Bearer 缺失时信任 Session 内完整旧 User/role JSON；JWT 与 Session 双权威并行放行 |
| 测试 | 删用户/撤权/改密后拒绝；省略 Authorization 行为符合 Session 模型；无「JWT 过期但旧 Session 仍按旧角色」类漏洞 |
| 纪律 | **未 VERIFIED 不得宣称实时撤权 / 认证闭环** |

### A0.6 HTTP 状态契约

| HTTP | 400 校验 / 401 未登录 / 403 无权限 / 404 / 429 限流 / 500 |
| 实现 | `ResponseEntity` 或全局异常设 status；**双断言** status + body.code + msg；对齐 `auth-session.js` |
| 顺序 | **大批量 C1 之前完成**，避免固化 200+code |

### A0.7 登录/退出与 Session 固定

| MUST | 登录 `changeSessionId()`；logout `invalidate()` + POST；全站 `clearSession()`；改密/撤权使现有 Session 失效；浏览器最终不保留 JWT |
| 测试 | Session 固定；退出后旧 JWT（过渡期）/ 旧 Cookie 重放 |

### A0.8 CSRF（Session 权威配套 · MUST）

| 原因 | 从 Authorization 头转向 Cookie Session 后，仅 CORS 不足 |
| MUST | JSESSIONID **HttpOnly**；prod **Secure**；**SameSite=Lax**（或按流程 Strict）；POST/PUT/PATCH/DELETE 校验 CSRF（轻量拦截器：Session 存 token，前端 `X-CSRF-Token`）；敏感请求可加 Origin 校验；**GET 不得**登出/删除/审核 |
| 实现 | 可不引入完整 Spring Security：登录发 CSRF token；受保护接口提供获取方式；状态变更带 header |
| 测试 | 无 CSRF token 的状态变更 → 拒绝 |

---

## 4. Phase A — 口令与限流

### A1 默认 123456

| 事实 | 注册 DTO 已非空；改 **`UserController.save`** 与 **`UserService.register` 兜底** |
| MUST | 无默认密码；管理员创建必填；与 BCrypt 编码路径对齐 |

### A2 明文兼容

| MUST | 开关；**仅登录成功后**升级 BCrypt；禁止盲目批量转码 |

### A3 限流

| MUST | 内存窗口；容量与过期；**HTTP 429**；代理策略写清 |

### A4 文档

| 定性 | 仅部署说明，**非**安全收口 |

---

## 5. Phase B — 授权、暴露面、业务与文件

### B1 / B1.1 用户更新与角色分配

| 规则 | 资料：本人或 `user`；改本人密码：旧密码；重置他人：仅超管（课设）；分配普通角色：需 `role` 等，**不能**仅凭 `user`；roleId=1 仅超管；不得删/降最后一个超管；只接受角色 ID 列表，服务端查 Role |
| 测试 | 仅 `user` 给自己 role 1 → 403 |

### B2 / B2.1 读·导出·探测 + 精确白名单

| 覆盖 | User online/detail/export、Proof/Visit/Help/Adopt/Animal/Account/Role/Permission/Notice/Volunteer |
| `/online` | 见 §1 锁定：普通用户不可枚举用户名 |
| 顺序 | **端点原子化**：Controller/Service 校验 → 测试 → 再改拦截器；**禁止先放宽拦截器** |

### B3-F 文件 OLAC（M2 · R2 MUST）

| 元数据表 `t_file_asset` | flag, stored_name, original_name, owner_id, purpose, visibility, business_type, business_id, content_type, size, created_at, bound_at, deleted |
| MUST | 按用途上传；记 owner；业务事务绑定；禁绑他人私有 flag；历史迁移；未绑定清理；公开/私有规则 |
| **`/file/**` 旁路** | 删除上传根静态映射，或仅 public 目录，或公私分盘；私有仅认证 Controller |
| 验收 | **同时**测 `/api/files/...` 与 `/file/...` |
| 工期 | **2–3+ 日**（含迁移）；历史引用乱则更长 |
| 版本化 SQL | 即使全量 Flyway DEFER，文件表仍需 **可重复执行的版本化 SQL**（如 `docs/sql/YYYY-MM-DD-file-asset.sql`） |

### B3 在 M1 的表述

| M1 | B3 **未修**；已知遗留；不公网部署敏感附件环境；必要时临时停敏感上传 |
| M2 | B3-F VERIFIED 后才可宣称完整闭环 |

### B4 在线 MAP

| MUST | 降级 API；不鉴权；与 `/online` 决策一致；审计 WS 用户名披露 |

### B6 领养状态机

| MUST | 单一有效通过、并发双审、非法迁移拒绝；与 `rejectCompetingPending`/`syncAnimalState` 对齐 + 测试 |

### B7 资金公示（已锁定）

| MUST | 公开专用 DTO 字段集；export 需管理 flag；统计 SQL 聚合，**禁止** `list()` 全表给公开统计 |

---

## 6. Phase C — 测试（策略锁定 · 详见 STATUS）

**完整分层对抗策略、状态枚举、门禁清单与证据表以 `REPAIR-PLAN-90-STATUS.md` 为准。**

### 6.1 锁定模式（禁止二选一）

```text
L1 修复前攻击复现（红）
 → 最小修复
 → L2 该项即时对抗 + 业务回归 + mvn test → VERIFIED
 → 下一项
 → L3 每 Phase / Gate1 / M1 / M2 集成对抗
 → L4 全部完成后独立黑盒复审
 → 发布门禁
```

- **禁止**只在全部完成后统一测试。
- **禁止**只做单项/单元测试而取消阶段门禁与最终复审。
- 任何测试都不能保证零漏洞；本模式用于最大限度降遗漏与回归。

### 6.2 状态与完成标准

| 状态 | 含义 |
|------|------|
| `TEST_REPRODUCED` | 修复前漏洞已复现 |
| `IMPLEMENTED` | 代码已改，未完成对抗 |
| `VERIFIED` | 攻击转绿 + 业务通过 + 相关测试 + `mvn test` + 证据入 STATUS |
| `REVIEWED` | VERIFIED + 独立/最终复审无阻断 P0/P1 |

**只有 `VERIFIED`/`REVIEWED` 计入完成率。** 六条硬标准见 STATUS §0。

### 6.3 手段原则

| 风险 | 不能只靠 |
|------|----------|
| 权限 | 不能只测 Service |
| XSS | 不能只测 escape 函数；须浏览器/DOM 载荷 |
| 文件 | 不能只测 FileController；须 `/file/**` 双路径 |
| 领养并发 | 不能只靠 Mockito；须真实 DB |
| HTTP 契约 | MockMvc **双断言** status + body.code |

对抗脚本（smoke / adversarial-*）在 Session 权威与 CSRF 落地后**必须同步更新**，不得用旧语义冒充通过。

### 6.4 优先红灯用例（开工前/并行建立）

恶意用户名 XSS；降权/删用户旧 Session；省略 Bearer；user 自提 role1；A 读 B 数据；export 匿名；退出重放；双通过领养；R2 下文件双路径匿名读。

---

## 7. 范围标记（锁定）

### M1 — 核心认证与授权安全基线（原 R1 内容 · 更名）

| 项 | 范围 |
|----|------|
| A0.1–A0.8 | MUST |
| A1–A3 | MUST |
| B1/B1.1/B2/B2.1/B4/B6/B7 | MUST |
| B3 | **M1 未修 · 已知遗留**（非「已完成 O 选项的安全闭环」） |
| C1–C2 基础 | MUST |
| D/E | DEFER |

### M2 — 完整安全闭环（R2 增量）

B3-F 全量 + 双路径测试 + 相关 C 加固 + C3 可选。

### R3 — DEFER

Flyway 全量、Docker、前端 layout。

---

## 8. 实施顺序（锁定）

```text
 0. 更新本计划 §1 决策 + 建立 STATUS + 备份库与 upload + 记录基线提交
 1. 失败向测试骨架：JWT/profile、XSS、旧 Session、角色提权
 2. A0.4 XSS + clearSession 统一
 3. A0.5 Session 权威（只存 userId）+ A0.7 固定/退出 + A0.8 CSRF
 4. A0.6 HTTP 契约
 5. A0.1–A0.3 profile / 种子 / prod Guard
 6. ── Security Gate 1 验收 ──
 7. B1 / B1.1
 8. B2 端点原子化
 9. B6 / B7
10. A1–A3
11. M1 冒烟/对抗 → STATUS 标记 M1
12. M2：文件表 SQL → 上传/绑定 → 去 /file 旁路 → 迁移 → 双路径测试
13. 全量测试 + 文档；STATUS 标记 M2 / R2
14. DEFER D/E
```

---

## 9. 风险与回滚

| 风险 | 应对 |
|------|------|
| Session 改造断前端 | 同源 Cookie + 统一 auth-session；冒烟全流程 |
| CSRF 漏改页面 | 全局 ajax 拦截器注入 token |
| 删 JWT 字段兼容 | 登录响应可暂留字段但前端忽略，再删 |
| B2 顺序错误 | 禁止先放宽拦截器 |
| B3 迁移图裂 | 动物图标 public；先迁后切静态映射 |
| 工期不足 | 交付 M1 + 诚实遗留 B3；不公网；不写完整闭环 |

---

## 10. 文件改动地图

| 主题 | 触达 |
|------|------|
| XSS | `help.html`、`im.html`、前台聊天、用户名校验、公告等 |
| Session 权威 | `AuthInterceptor`、`UserController`、Session 配置、前端 auth |
| CSRF | 新拦截器/过滤器、前端 ajax、logout POST |
| HTTP | `GlobalExceptionHandler`、Result 写出 |
| 种子 | SQL、bootstrap、`INITIAL_ADMIN_*` Runner |
| 角色 | `UserService`/`UserController` |
| B2 | 各 Controller + 拦截器（原子） |
| 文件 | `FileController`、`WebMvcConfig`、元数据表、绑定、迁移 SQL |
| 领养/资金 | `AdoptService`、`AccountController`/DTO |
| 测试 | MockMvc 为主 |

---

## 11. Codex 意见与拍板对照

| 主题 | 处理 |
|------|------|
| XSS / Session / HTTP / 角色 / 原子 B2 / 文件模型 /file 旁路 | 已纳入 MUST |
| R1 勿称「最小安全闭环」 | **已更名为 M1 基线** |
| Session 权威 + CSRF | **已锁定** |
| 改良 S1 种子 | **已锁定** |
| 浏览器去 JWT | **已锁定** |
| R2 + M1/M2 | **已锁定** |

---

## 12. 可行性（决策后）

| 阶段 | 可行性 | 条件 |
|------|--------|------|
| A0.4–A0.8 | 高–中高 | 前端联动 CSRF/Session |
| B2 | 高 | 原子化 |
| B3-F | 中 | 元数据+迁移+旁路；预留缓冲 |
| 整体 R2 | 中高 | 7–10 日；乱数据 8–12 日 |

---

## 13. 决策记录（已拍板 · 勿再空置）

| 决策 | 结论 | 日期 | 备注 |
|------|------|------|------|
| 范围 | **R2**（M1+M2） | 2026-07-14 | 工期不足可只交 M1 并声明遗留 |
| 文件 OLAC | **B3-F**（M2） | 2026-07-14 | M1 不宣称闭环 |
| 认证权威 | **Session**，仅 userId | 2026-07-14 | JWT 非浏览器权威 |
| CSRF | **MUST** | 2026-07-14 | 配套 Session |
| 种子 | **S1-dev + prod env bootstrap** | 2026-07-14 | 非纯 S2 |
| JWT 存储 | **最终浏览器不保存** | 2026-07-14 | 过渡 sessionStorage≤30m |
| Account | **匿名公开 DTO** | 2026-07-14 | 无 allRecords |
| /online | **普通用户不可枚举用户名** | 2026-07-14 | 可仅人数/管理端 |
| 进度文件 | **STATUS 唯一** | 2026-07-14 | 本文件无完成勾选 |
| 测试策略 | **L1+L2+L3+L4 分层对抗** | 2026-07-14 | 细则与清单在 STATUS |

---

## 14. 文档维护

| 项 | 值 |
|----|----|
| 计划 | `REPAIR-PLAN-90.md` **v3.1 决策锁定**（测试策略摘要见 §6） |
| 状态 | `REPAIR-PLAN-90-STATUS.md`（**完成态 + 对抗门禁 + 证据**） |
| 关联 | README、ops-hardening、docs/sql、smoke/adversarial 脚本 |

---

## 15. 版本演进

| 版本 | 说明 |
|------|------|
| v1 | 初稿，缺 A0 |
| v2 | 补 JWT/种子/B2 扩大 |
| v3 | 补 XSS/Session/HTTP/文件模型 |
| **v3.1** | **§13 拍板：R2+M1/M2、Session 权威、CSRF、改良 S1、去浏览器 JWT、Account/online、表述纪律** |

---

*本文件 v3.1 仅锁定计划与架构决策，不代表代码已落地。完成态见 STATUS。Gate 1 未 VERIFIED 前禁止对外宣称安全加固完成。*
