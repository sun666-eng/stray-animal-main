# 流浪动物救助管理系统 — 安全加固计划（v3 可实施稿）

> **文档用途**：供审查后实施；目标是成为可执行的安全整改方案，而非仅优先级清单。  
> **文档状态**：**计划稿 v3 · 尚未实施**（清单中 `IN SCOPE` / `OUT OF SCOPE` / `MUST` 均表示计划范围，**不表示已完成**）。  
> **修订说明**：吸收 Codex 第二轮审查——存储型 XSS、Session 旧权限、文件元数据与 `/file/**` 旁路、HTTP 状态契约、B2 原子化顺序、角色分配规则、登录/退出生命周期、profile 优先级、领养状态机、公开资金面、工期与勾选语义。  
> **原则**：先能复现再修；端点原子化；禁止用文档/随机 flag/WARN 日志冒充修复；完成态只写在独立 STATUS 文件。

---

## 0. 背景与目标

### 0.1 当前定位（v3）

| 口径 | 大致分数 | 说明 |
|------|----------|------|
| 课设 / 可演示工程 | **~78–82** | 功能与 Guard 有亮点；存在可利用存储型 XSS、Session 旧权限、默认 dev 密钥、种子弱口令、导出/文件暴露 |
| 生产级严格标准 | **~65–70** | 认证模型与对象级控制未闭环 |

> v1 基线 ~85、v2 ~80–83 均偏乐观。在 **XSS + Session 权限刷新 + 默认信任面** 未修前，不得宣称安全闭环。

### 0.2 主目标

- 完成 **P0/P1 安全闭环** 后，课设口径目标约 **86–90**（完整 R2 含文件 OLAC）。
- 每项 MUST 有：**代码改动 + 可复现攻击/回归测试 + 验收命令**。
- 完成记录仅写入 `REPAIR-PLAN-90-STATUS.md`，本文件勾选语义见 §0.5。

### 0.3 非目标

1. 不重写 Vue3 SPA / 不换完整 Spring Security / 不上微服务。  
2. 不改领养联合主键结构（可在其上加约束与状态机）。  
3. 不批量改论文 Word。  
4. 不把 A4 文档、随机 flag、仅 WARN 日志算作高风险项已修复。  
5. 完整 Flyway / Docker / 前端 layout 重构后置（D/E）。

### 0.4 验收总门禁

- `mvn test` 全绿，且含 **MockMvc / 拦截器 / XSS 载荷 / Session 生命周期 /（若做 B3-F）/file 与 /api/files 双路径**。  
- 冒烟与对抗脚本不回归。  
- **P0 全绿前禁止对外演示「已安全加固」表述。**

### 0.5 勾选语义（防误导）

| 标记 | 含义 |
|------|------|
| `MUST` | 本轮必须做 |
| `IN SCOPE` | 纳入本轮范围（未完成） |
| `OUT OF SCOPE` | 本轮明确不做，并写原因 |
| `DEFER` | 后置到 D/E 或后续迭代 |

**禁止**在本计划文件中使用 `[x]` 表示「已实施」。实施进度只维护在 `REPAIR-PLAN-90-STATUS.md`。

---

## 1. 总体阶段与工期（v3 现实估算）

```text
Phase A0  默认信任面 + XSS + Session + HTTP 契约 + 种子/profile   MUST · 约 2–3 天
Phase A   口令 / 限流 / 登录退出生命周期                           MUST · 约 1–1.5 天
Phase B   角色授权 / 接口越权 / 文件 OLAC / 业务状态 / 公开面       MUST(按选项) · 约 3–5 天
Phase C   MockMvc 与回归门禁                                       MUST · 与上并行/收尾 · 约 1.5–2 天
Phase D/E 迁移 / Docker / 前端整理                                 DEFER
```

| 方案 | 范围 | 现实工期 | 目标分带 |
|------|------|----------|----------|
| **R1** | A0 全量 + A + B1/B1.1 + B2 全量 + B3-**O** + B4 + B6/B7 最小 + C | **5–7 工作日** | ~86–88 |
| **R2** | R1 + B3-**F**（元数据 + 绑 + 去 `/file/**` 旁路）+ 更全测试 | **7–10 工作日** | ~88–90 |
| **R3** | R2 + Flyway + Docker + 前端去重 | **12–15 工作日** | ~90–93 观感 |

> v2 的 R2「5–6 天」**不含** XSS、Session、HTTP 契约、文件元数据迁移，已作废。

---

## 2. Phase A0 — P0 底座（MUST）

### A0.1 JWT 密钥与 profile 优先级（MUST）

| 项 | 内容 |
|----|------|
| 现状 | `spring.profiles.default: dev`；`JwtUtil` 用 `acceptsProfiles(dev,test)`，**prod+dev 并存时仍可能走开发密钥**；固定 `DEV_SECRET` 已在仓库公开 |
| 规则（必须写死） | ① **只要 active 含 `prod`，生产规则无条件优先**，禁止 DEV_SECRET / 空密钥；② 删除或不再依赖 `spring.profiles.default: dev`，本地须显式 `--spring.profiles.active=dev`；③ 无 profile 时采用 **安全默认（拒绝开发密钥）**，或要求显式 `app.jwt.allow-dev-secret=true` **且** profile=dev 双条件；④ WARN **不算**控制措施 |
| 测试组合 | 无 profile / dev / test / prod / prod,dev / 未知 profile |
| 工期 | 0.5–1 天 |

### A0.2 种子管理员与弱口令（MUST）

| 项 | 内容 |
|----|------|
| 现状 | `test.sql`：`admin/admin`；多用户 `123456` 明文 |
| 方案（实施前选定一种） | **方案 S1（推荐课设）**：基线改为 BCrypt(强随机或文档中的「仅本地」口令) + 启动时若检测到已知弱口令则 **prod fail-fast / dev 强 WARN**；**方案 S2**：首次启动无超管则生成随机密码打印一次后禁止默认账号 |
| 验收 | 新库无法用公开 `admin/admin` 在 prod 登录；README/smoke 与种子一致 |
| 工期 | 0.5 天 |

### A0.3 生产配置与 Guard 开关（MUST）

| 项 | 内容 |
|----|------|
| 改法 | `application-prod.yml`：JWT 必填、CORS 收紧、**所有自动改数 Guard**（data-fix / data-state auto-fix / role-guard auto-fix / schema auto-migrate）默认关闭或 fail-fast 可配；非 dev/test 启动校验 |
| 验收 | 缺关键项拒绝启动；prod 不默认自动 DDL/自动修脏数据（除非显式打开） |
| 工期 | 0.5 天 |

### A0.4 存储型 XSS 闭环（MUST · P0）

| 项 | 内容 |
|----|------|
| **可利用链（已核实）** | 注册用户名仅非空 → 聊天写入用户名 → `help.html` 将 **username 未转义** 拼进 HTML（`text` 已 `escapeAdminHtml`，**username 未转义**）→ `insertAdjacentHTML`；`im.html` 同类；JWT 在 `localStorage`（`auth-session.js`）→ 管理员打开聊天即可能在同源执行脚本，窃取 token、调用管理 API |
| 修复 MUST | ① `help.html` / `im.html`（及任何同类拼接）对 **username、系统消息、avatar URL** 等全部转义或改用 **DOM + textContent**；② 用户名长度 + 字符集限制（**纵深防御，不能替代输出转义**）；③ 扫描公告/描述/回复/救助内容：明确 **纯文本 vs 富文本**；允许富文本则白名单消毒，否则一律文本转义；④ 前端统一 `AuthSession.clearSession()`；⑤ **在 XSS 收口前**：评估取消 JWT 长期存 `localStorage`（改 sessionStorage 或缩短有效期 + HttpOnly Session 为主） |
| 验收载荷 | 用户名含 `<img src=x onerror=alert(1)>` / `<svg onload=...>` 注册并发消息，管理端打开 **不执行**；管理员 token 不被脚本可读（若仍用 localStorage，至少 XSS 不可达） |
| 工期 | 0.5–1 天 |
| **闭环声明** | **R1/R2 未完成 A0.4 不得宣称安全闭环** |

### A0.5 Session/JWT 生命周期与权限刷新（MUST · P0/P1）

| 项 | 内容 |
|----|------|
| 现状 | Bearer 有效时查库写 Session；**Bearer 缺失/失效则直接用 Session 内旧 User**，再 `fillPermissions` 时可能仍依赖 Session 内旧 role 集合路径 |
| 后果 | 用户删除/降权后旧 Session 仍可用；故意不带 Authorization 走旧 Session；JWT 过期 Session 仍活；改密后 Session 不失效 |
| 修复 MUST | ① **受保护请求**：以 Session 中 **userId**（或 JWT subject）**每次重新查库**；用户不存在 → 401 + `session.invalidate()`；② **权限只根据 DB 当前 role 计算**，不信任 Session 内嵌 role/permission JSON 为权威；③ 明确事实源：推荐 **「服务端 Session 为浏览器会话权威；JWT 为 API/WS 凭证」** 或 **「JWT 权威 + Session 仅缓存 userId」**——二选一写进文档与代码；④ 可选短 TTL 权限缓存 + 角色变更/删用户显式失效；⑤ 改密 / 角色变更 / 删除用户 → 提升 `tokenVersion` 或使 Session 失效 |
| 测试 MUST | 删用户后旧 Session 拒绝；撤权后旧 Session 拒绝；改密后旧 Session 失效；JWT 过期 + 仅 Session 的行为符合选定模型；故意省略 Bearer 的行为符合模型 |
| 工期 | 1–1.5 天 |
| 说明 | **B4 的 MAP 不是认证依据**；本项才是认证正确性核心 |

### A0.6 HTTP 状态码与统一错误响应契约（MUST · 先于或并行 C1）

| 场景 | HTTP 状态 | body.code（建议） |
|------|-----------|-------------------|
| 参数校验失败 | **400** | `400` |
| 未登录 / 凭据失效 | **401** | `401` |
| 已登录无权限 | **403** | `403` |
| 资源不存在 | **404** | `404` |
| 限流 | **429** | `429` |
| 未预期异常 | **500** | `-1` 或 `500` |

| 现状 | 拦截器会设真实 HTTP 状态；**Controller / `GlobalExceptionHandler` 常 HTTP 200 + `{code:"401"}`**；`auth-session.js` 依赖 **真实 HTTP 401** 清会话 → 行为不一致 |
| 实现 | `ResponseEntity` / 异常 `@ResponseStatus` / 统一 `Result` 写出工具；审计前端只看 `res.code` 或只看 `xhr.status` 的分支 |
| 测试 | **同时断言** HTTP status + body.code + body.msg |
| 工期 | 0.5–1 天 |
| 顺序 | **必须在大批量 C1 固化「错误的 200+code」之前完成** |

### A0.7 登录 / 退出与 Session 固定（MUST · 可与 A0.5 同迭代）

| 项 | 内容 |
|----|------|
| 现状 | 登录不 `changeSessionId()`；logout 只 `removeAttribute("user")`，不 `invalidate`；logout 为 GET；前端多页只清 `user` 不清 token；JWT 7 天无撤销 |
| 修复 MUST | 登录成功 `request.changeSessionId()`（或 invalidate 再建立）；logout `session.invalidate()` + 清 MAP（尽力）；logout 改为 **POST**；全站统一 `AuthSession.clearSession()`；JWT：黑名单 **或** 缩短有效期 + `tokenVersion` 与 DB 比对（改密/撤权递增） |
| 测试 | Session 固定；退出后旧 JWT 重放（按选定策略断言） |
| 工期 | 0.5–1 天 |

### Phase A0 工期合计

约 **2–3 工作日**（含测试骨架）。

---

## 3. Phase A — 口令与限流（MUST）

### A1 默认密码 123456（范围已修正）

| 事实 | 注册 DTO 已 `@NotBlank` 密码；真正落库默认的是 **`UserController.save`** 与 **`UserService.register` null 兜底** |
| 改法 | 删除默认 123456；管理员创建必须显式密码；Service 对 blank 抛错；前端 user 表单必填 |
| 备注 | `UserService.save` 路径若对显式密码 BCrypt，需确认管理员创建也走同一编码，避免明文入库 |

### A2 明文登录兼容

| 改法 | 配置开关；**仅成功登录后**升级为 BCrypt；禁止盲目批量「当明文 encode」损坏已是哈希的值 |
| 工期 | 0.5 天 |

### A3 登录/注册限流

| 改法 | 内存滑动窗口；容量上限 + 过期清理；**HTTP 429**；代理 IP 策略写清（单机课设默认 remoteAddr） |
| 工期 | 0.5 天 |

### A4 文档（非修复）

| 定性 | **仅部署说明**，交叉引用 A0 验收；**不能替代 A0** |

---

## 4. Phase B — 授权、暴露面与业务一致性

### B1 用户更新字段白名单（MUST）

资料 / 密码 / 角色分离处理；空密码不覆盖。

### B1.1 角色分配精确授权（MUST · 新增）

| 操作 | 授权规则 |
|------|----------|
| 修改个人资料 | 本人或持 `user` 管理 flag |
| 修改本人密码 | 本人 + 旧密码校验 |
| 管理员重置他人密码 | 超管或专门 reset 权限（课设可定为仅 roleId=1） |
| 分配普通角色 | 需 `role` 或 `user-role-admin`（**不能**仅凭 `user` flag） |
| 分配 roleId=1 | **仅当前超管** |
| 删除/降级超管 | 仅超管，且 **不得删除/降级最后一个超管** |

| 实现 | 只接受角色 **ID 列表**；服务端查完整 Role；**禁止**持久化客户端嵌套 permission JSON；校验可分配集合 |
| 测试 | 仅有 `user`、无 `role` 的账号给自己分配 role 1 → 403 |

### B2 读/导出/探测面全量（MUST）

覆盖 User（online/detail/export/page）、Proof/Visit/Help/Adopt/Animal/Account/Role/Permission/Notice/Volunteer 的读与 export（同 v2 清单，不重复展开）。

#### B2.1 公共接口方法与路径精确白名单（MUST）

| 改法 | 公开接口按 **方法 + 精确路径** 白名单（避免 `startsWith("/api/animal")` 过宽）；新增管理接口默认拒绝 |
| 验收 | 普通用户无法靠路径变体打到管理写接口 |

#### B2 实施顺序（关键 · 禁止先放宽拦截器）

```text
对每个端点原子化：
  1) Service/Controller 加入归属或管理校验
  2) 增加该端点测试（MockMvc）
  3) 再调整 AuthInterceptor 对该端点的规则（若需要）
  4) 同一提交内完成；测试绿后再做下一端点
```

**禁止**：先全局放宽模块前缀让普通用户到达 Controller，再补校验（会造成临时全量数据暴露）。

### B3 文件 OLAC

#### B3-F（完整 · R2 MUST）与数据模型

| 现状 | `FileVO` 仅 flag/fileName；磁盘存储；实体只存 flag；**无 owner/purpose/visibility/绑定** |
| 问题 | 未绑定上传、跨用户绑 flag、历史无主、公开/私有不可分、删业务是否删文件未知 |
| **元数据表建议 `t_file_asset`** | flag, stored_name, original_name, owner_id, purpose, visibility, business_type, business_id, content_type, size, created_at, bound_at, deleted |
| 行为 MUST | 按用途上传（如 `/upload/proof`、`/upload/animal`）；上传记 owner+purpose；业务保存事务绑定；禁止绑他人私有文件；历史迁移策略；未绑定清理；重复引用删除规则；公开用途白名单 |
| **工期** | **2–3 天**（含迁移与双路径测试），**不是 1 天** |

#### B3-F 必须治理 `/file/**` 旁路（P0 若做 F）

| 现状 | `WebMvcConfig` 将上传根映射到 `/file/**`；拦截器**不管** `/file/**` → 绕过 `FileController` 鉴权 |
| 选项（择一） | ① 删除上传根的 `/file/**` 映射；② `/file/**` 仅映射独立 **public** 目录；③ 公私存储分离，私有只走认证 Controller |
| 验收 | 同时测 `/api/files/...` **与** `/file/...`；私有资源两者均不可匿名读 |

#### B3-O（R1 可选）

| 规则 | 明确 **OUT OF SCOPE**；文档写风险；**不得**勾选为已修复 |

### B4 在线用户 MAP（IN SCOPE · 降级）

| 正确模型 | `Map<username, User>`，非会话真相源 |
| 改法 | `/online` 仅管理或删除；logout 尽力 remove；**不用于鉴权** |
| 延伸 | 审计 WebSocket 是否向前端披露他人用户名/在线列表（若有则收紧） |

### B6 领养状态机与单一通过约束（MUST · 新增）

| 项 | 内容 |
|----|------|
| 方向 | 保证一动物有效通过申请的一致性；审核并发下不出现双通过；非法状态迁移拒绝；与现有 `rejectCompetingPending` / `syncAnimalState` 对齐并补并发测试 |
| 测试 | 二次批准、并发双审、删申请后 tstate 回写 |
| 工期 | 0.5–1 天 |

### B7 公开资金接口收敛（MUST · 产品决策后）

| 项 | 内容 |
|----|------|
| 方向 | 公示只返回必要字段；export 必须管理 flag；避免公开接口带内部经手敏感细节（按产品定） |
| 可选 | 聚合查询替代全量 list |

---

## 5. Phase C — 测试门禁（MUST）

### C1 风险导向用例清单

| 主题 | 用例 |
|------|------|
| A0.1 | profile 组合；prod+dev 不得用 DEV_SECRET |
| A0.4 | 恶意用户名聊天 XSS（管理端渲染不执行） |
| A0.5 | 删用户/撤权/改密后 Session；省略 Bearer；JWT 过期策略 |
| A0.6 | HTTP status 与 body.code 双断言 |
| A0.7 | Session 固定；logout 后重放 |
| B1.1 | 无 role 权分配超管失败 |
| B2 | 各 export 403；detail/online；端点归属 |
| B3-F | `/api/files` 与 `/file` 双路径；绑他人 flag 失败 |
| B6 | 领养二次批准 / 竞争 |
| WS | 在线用户名披露（若适用） |

| 策略 | ~40% Service Mockito；~50% MockMvc/拦截器；~10% 启动/配置 |
| 条件 | 最好先完成 A0.6，避免把「200+code」测成正确行为 |

### C2 / C3

发布清单 + 可选 CI `mvn -B test`。

---

## 6. Phase D/E — DEFER

Flyway、Docker、前端 layout 去重、仓库清理：**不得替代** A0–C。

---

## 7. 方案范围标记（v3）

### R1 — 最小安全闭环 · `IN SCOPE` 约 5–7 日 · 目标 ~86–88

| 项 | 范围 |
|----|------|
| A0.1–A0.7 | MUST |
| A1–A3 | MUST |
| A4 | 文档 only |
| B1 + B1.1 | MUST |
| B2 + B2.1 | MUST（原子化顺序） |
| B3 | **OUT OF SCOPE（O）** 并写风险 |
| B4 | MUST 降级 |
| B6 + B7 | MUST 最小集 |
| C1–C2 | MUST |
| D/E | DEFER |

### R2 — 推荐加固 · `IN SCOPE` 约 7–10 日 · 目标 ~88–90

R1 全部 + **B3-F（元数据 + 绑定 + 去 `/file/**` 旁路）** + C3 + 更全 MockMvc。

### R3 — DEFER 工程化

R2 + Flyway + Docker + 前端去重（12–15 日）。

---

## 8. 建议实施顺序（v3 · 更安全）

```text
 1. 先写失败向回归测试骨架：JWT/profile、角色提权、存储型 XSS、旧 Session 权限
 2. A0.4 存储型 XSS + 前端 clearSession 统一
 3. A0.1 / A0.2 / A0.3 profile·种子·prod Guard
 4. A0.5 + A0.7 Session/JWT 刷新、固定与退出
 5. A0.6 HTTP 状态契约（再大批量写 C1）
 6. B1 + B1.1 资料/密码/角色拆分与提权修复
 7. B2 按端点原子化：校验 → 测试 → 拦截器
 8. B6 领养状态机；B7 资金公开面
 9. B3-F（若 R2）：元数据模型 → 绑定 → 移除/收窄 /file/** → 双路径测试
    或 B3-O 文档化风险
10. A3 限流；A1/A2 口令
11. 冒烟 / CI / A4 文档对齐
12. DEFER：D/E
```

---

## 9. 风险与回滚

| 风险 | 应对 |
|------|------|
| A0 导致本地难启动 | 显式 dev profile + 双条件开发密钥；文档一键命令 |
| XSS 修漏页面 | 全库搜 `insertAdjacentHTML` / 未转义变量 |
| Session 改模型破坏前端 | 统一 auth-session；冒烟登录全流程 |
| HTTP 状态变更导致前端只认 code | 同步改 auth-session 与各页 ajax |
| B2 顺序错误导致短暂裸奔 | **禁止先放宽拦截器**；按端点提交 |
| B3-F 工期爆炸 | R1 选 O；R2 预留 2–3 天 |
| 种子变更答辩翻车 | 同步 smoke 与演示账号文档 |

---

## 10. 文件改动地图（v3）

| 主题 | 预期触达 |
|------|----------|
| XSS | `help.html`、`im.html`、前台聊天页、用户名校验、公告/描述渲染点 |
| Session/JWT | `AuthInterceptor`、`UserController` login/logout/me、`JwtUtil`、可选 tokenVersion 字段 |
| HTTP 契约 | `GlobalExceptionHandler`、Controller 错误返回、`auth-session.js` |
| Profile/密钥 | `JwtUtil`、`application.yml`、新建 `application-prod.yml` |
| 种子 | `test.sql`、`docs/sql/*`、Guard |
| 角色 | `UserController`、`UserService` |
| B2 | 各 `*Controller` + `AuthInterceptor`（端点原子） |
| 文件 | `FileController`、`FileStorage`、`WebMvcConfig`、`FileVO`、新 entity/mapper/表、业务绑定点 |
| 领养 | `AdoptService` / 并发与状态 |
| 测试 | `src/test/java/**` MockMvc 为主 |

---

## 11. 对 Codex 第二轮意见的采纳结论

| 意见 | 结论 | 计划动作 |
|------|------|----------|
| 存储型 XSS 必须修 | **完全正确**（help 用户名未转义链已核实） | **A0.4 P0** |
| Session 旧权限 | **完全正确** | **A0.5** |
| B3-F 缺元数据、1 天不够 | **完全正确** | 元数据表 + **2–3 天**；R1 用 O |
| `/file/**` 旁路 | **完全正确** | B3-F 强制项 |
| HTTP 200+code vs 真实状态 | **完全正确** | **A0.6** |
| B2 先改拦截器危险 | **完全正确** | 端点原子化顺序 |
| B1 角色分配不清 | **完全正确** | **B1.1** |
| Session 固定 / logout 语义 | **完全正确** | **A0.7** |
| profile 默认 dev / prod+dev | **完全正确** | A0.1 规则重写 |
| `[x]` 误导已完成 | **完全正确** | 改为 MUST/IN SCOPE；STATUS 分离 |
| 领养状态机、资金公开面 | **采纳** | **B6/B7** |
| R2 工期 7–10 日 | **采纳** | 替换 v2 的 5–6 日 |

**细化保留：**

1. JWT 在非 dev 已有部分强制逻辑；A0.1 重点是 **默认 profile 与 prod 优先**，不是从零发明校验。  
2. Account 公开读是产品语义；B7 收敛字段而非必然全站登录。  
3. XSS 全站扫描器不承诺；**已知可利用链 + 同类拼接点清零** 为 MUST。

---

## 12. 可行性评估（v3）

| 阶段 | 可行性 | 补充条件 |
|------|--------|----------|
| A0.1 | 高 | profile 优先级；拒绝仓库已公开 DEV_SECRET |
| A0.2 | 高 | 选定 S1/S2 引导方案 |
| A0.3 | 高 | 覆盖全部自动改数 Guard |
| A0.4 | 高 | 管理端+遗留 im；真实载荷验收 |
| A0.5 | 中高 | 选定 Session vs JWT 权威模型 |
| A0.6 | 高 | 前后端一起改 |
| A0.7 | 高 | logout POST 需改前端 |
| A1 | 高 | 与 BCrypt 编码路径对齐 |
| A2 | 中高 | 仅登录成功后升级 |
| A3 | 高 | 429 + 容量清理 |
| B1.1 | 高 | user flag ≠ 分配任意角色 |
| B2 | 高 | 原子化 + 精确白名单 |
| B3-F | 中 | 元数据 + 迁移 + `/file/**` |
| B3-O | 高 | 诚实标 OUT OF SCOPE |
| B6/B7 | 高 | 业务规则写清 |
| C1 | 中高 | 先 A0.6 |
| D/E | 高但后置 | 不替代安全 |

---

## 13. 实施前拍板清单

- [ ] 方案：**R1** 或 **R2**  
- [ ] B3：**F** 或 **O**  
- [ ] 种子策略：**S1** 或 **S2**  
- [ ] 认证权威：**Session 权威** / **JWT 权威 + Session 仅 userId**  
- [ ] Account 公示：匿名公开字段列表  
- [ ] `/online`：仅管理 **或** 删除  
- [ ] JWT 存 localStorage：XSS 后是否降级为 sessionStorage / 缩短 TTL  
- [ ] 同意本文件 **无 `[x]` 已完成语义**；进度用 STATUS 文件  

---

## 14. 文档维护

| 项 | 值 |
|----|----|
| 本文件 | `REPAIR-PLAN-90.md` **v3** |
| 进度文件 | 实施时新建 `REPAIR-PLAN-90-STATUS.md`（唯一完成态来源） |
| 关联 | `README.md`、`docs/ops-hardening.md`、`docs/sql/*`、`tools/smoke-test.ps1` |

---

## 15. 总体评价（承接 Codex）

| 版本 | 作为「可实施安全方案」成熟度 |
|------|------------------------------|
| v1 | 方向性草案 |
| v2 | ~80–85% 规划准确度；仍缺 XSS/Session/文件模型等阻断项 |
| **v3** | 目标：**可直接排期实施的完整安全整改方案**（仍待你对 §13 拍板） |

**v3 相对 v2 新增的阻断级补丁：** A0.4 XSS、A0.5 Session 权限刷新、A0.6 HTTP 契约、A0.7 登录退出、B1.1 角色授权、B2 原子化、B3 元数据+`/file/**`、B6/B7、工期 7–10 日、勾选语义修正。

---

*本文件描述计划 v3，不代表任何修复已落地。P0（A0.1–A0.7 中标为 MUST 者）未完成前，不得宣称安全硬伤已收口。*
