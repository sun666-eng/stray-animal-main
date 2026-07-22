# REPAIR-PLAN-90 实施状态

> **本文件是完成态的唯一事实来源。**  
> 计划正文：`REPAIR-PLAN-90.md`（v3.1 决策锁定）。  
> **测试策略（锁定）**：修复前复现 → 单项完成即对抗 → Phase 集成对抗 → 全部完成后独立黑盒复审。  
> 任何测试方案都不能绝对保证零漏洞；本分层方式用于**最大限度降低遗漏与回归**。

---

## 0. 状态枚举（唯一允许值）

| 状态 | 含义 | 可否计入完成率 |
|------|------|----------------|
| `NOT_STARTED` | 未开始 | 否 |
| `TEST_REPRODUCED` | **修复前**攻击用例已复现（红灯基线） | 否 |
| `IN_PROGRESS` | 正在改代码 | 否 |
| `IMPLEMENTED` | 代码已改，**尚未**完成对抗与业务回归 | 否 |
| `VERIFIED` | 攻击转绿 + 正常业务通过 + 相关测试 + `mvn test` 绿 + 证据已记 | **是（阶段内完成）** |
| `REVIEWED` | 在 `VERIFIED` 基础上，**独立/最终对抗复审**无阻断 P0/P1 | **是（发布级）** |
| `BLOCKED` | 阻塞 | 否 |
| `DEFERRED` | 明确后置 | 否 |

### 单项「完成」硬标准（缺一不可）

```text
1. 修复前攻击用例能够复现（先有 TEST_REPRODUCED 或等价证据）
2. 修复后攻击用例失败（攻击不可再成功）
3. 正常业务流程仍通过
4. 相关单元测试 / MockMvc / 脚本通过
5. mvn test 全绿
6. 验证结果写入本文件「验证证据」
→ 状态方可标 VERIFIED
```

**禁止**：把 `IMPLEMENTED` 或「能演示」当成完成。  
**禁止**：未 `VERIFIED` 进入下一项（紧急 BLOCKED 须写原因）。

### 验证维度列说明

| 列 | 含义 |
|----|------|
| 复现 | 修复前红灯是否建立 |
| 单元 | Service/工具类测试 |
| MockMvc | HTTP/鉴权/归属接口测试 |
| 集成/对抗 | 脚本、DB、文件、WS、浏览器载荷等 |
| 独立复审 | 非实现者视角或最终黑盒；未做前填 `PENDING` |
| 总状态 | 上表枚举 |

---

## 1. 基线

| 项 | 值 |
|----|-----|
| 分支 | `animal` |
| 基线提交 | `c2ed94f47968081bad8ab1da647d7f2066bcf074` |
| 远端 | `origin/animal`（拍板时与远端一致） |
| 计划版本 | v3.1 决策锁定 |
| 测试策略版本 | **分层对抗 v1**（本文 §2–§7） |
| 开始日期 | 2026-07-21 |
| 当前负责人 | 实施中（本会话） |
| 独立复审人 | （最终黑盒时填写；建议非本模块主实现者） |
| 初始 `mvn test` | **通过**（exit 0，基线提交 c2ed94f） |
| 最近 `mvn test` | **通过**；**本地 test 库迁移已演练**（2026-07-22：apply 29 行、幂等 0、stored_name 回填 28/28 active（flag_loop_ok 软删）） |
| 数据库备份 | （请在改库前自行备份；本批未改 schema） |
| 上传目录备份 | （本批未改文件存储模型） |

---

## 2. 分层对抗策略（锁定 · 整合结论）

### 2.1 总模式（必须同时采用，不可二选一）

```text
先写攻击复现用例（红）
  → 实施一个最小修复
  → 立即执行该项对抗测试 + 正常业务回归 + mvn test
  → 通过后该项 → VERIFIED，再进入下一项
  → 每个 Phase / 里程碑完成后做集成对抗门禁
  → 全部完成后做一次独立黑盒/灰盒对抗复审
  → 修复最终发现 → 发布门禁
```

| 方式 | 结论 |
|------|------|
| 仅全部完成后统一对抗 | **禁止单独依赖**（定位难、返工大） |
| 仅单项测试取消最终复审 | **禁止**（漏组合漏洞） |
| **单项即时对抗 + 阶段门禁 + 最终独立复审** | **锁定采用** |

### 2.2 四层定义

| 层 | 名称 | 时机 | 作用 |
|----|------|------|------|
| L1 | 修复前攻击复现 | 改代码前 | 证明漏洞真实；建立红灯基线 |
| L2 | 单项即时对抗 | 每项 `IMPLEMENTED` 后立刻 | 攻击转绿 + 业务不回归 + `mvn test` |
| L3 | Phase / 里程碑集成对抗 | Gate1、M1、M2、Phase A/B 结束 | 组合漏洞、跨模块 |
| L4 | 最终独立黑盒复审 | M1+M2（R2）代码完成后 | 攻击者视角；不迎合实现 |

### 2.3 测试金字塔（原则，比例可浮动）

| 层 | 约占比 | 作用 | 不能单独依赖时 |
|----|--------|------|----------------|
| Service/工具单元 | ~35% | 状态机、密码、角色、限流算法 | 权限只测 Service |
| MockMvc 拦截器/Controller | ~35% | HTTP 状态、认证、授权、归属、导出 | — |
| DB/文件/WS 集成 | ~20% | 事务、并发、绑定、静态旁路 | 文件只测 Controller |
| 浏览器 + 最终黑盒 | ~10% | DOM XSS、Cookie/Session、完整攻击链 | XSS 只测 escape 函数 |

**原则**：权限问题不能只测 Service；XSS 不能只测字符串函数；文件权限不能只测 FileController。

### 2.4 手段 × 风险对照

| 风险 | 最合适手段 |
|------|------------|
| JWT/profile | 配置/启动测试 + 单元 |
| 限流算法 | 单元 + MockMvc |
| Service 状态转换 | Mockito；**并发须真实 DB** |
| HTTP 状态与接口权限 | MockMvc（**双断言** status + body.code） |
| Session 生命周期/固定 | MockMvc Session |
| Controller 归属 | MockMvc + scoped query |
| 存储型 XSS | DOM/浏览器真实载荷（**必做**） |
| `/file/**` 旁路 | HTTP 黑盒双路径 |
| 文件元数据绑定 | 集成 + 真实磁盘/DB |
| 领养并发 | **真实 MySQL 集成**，不单靠 Mockito |
| SQL/Guard | 全新库启动 |
| WebSocket 披露 | WS 客户端集成 |
| 全站回归 | smoke + 人工演示路径 |

### 2.5 提交级 / Phase 级 / 发布级门禁

**提交级（每次提交）**

- `mvn test`
- 当前改动对应的定向攻击测试 + 正常路径测试

**Phase / 里程碑级（未通过不得进入下一阶段）**

- `tools/smoke-test.ps1`
- `tools/adversarial-auth-test.ps1`
- `tools/adversarial-permission-test.ps1`
- `tools/adversarial-upload-test.ps1`
- `tools/adversarial-datastate-test.ps1`
- `tools/adversarial-schema-test.ps1`  
- **注意**：Session 权威、CSRF、HTTP 契约落地后，**上述脚本必须同步更新**，不得用旧语义冒充通过。

**最终发布门禁（R2 完整交付）**

- [ ] A0.1–A0.8 均为 `VERIFIED`（建议最终 `REVIEWED`）
- [ ] A1–A3、B1/B1.1、B2/B2.1、B4、B6、B7 均为 `VERIFIED`
- [ ] B3-F 为 `VERIFIED`（R2 锁定）；若退回仅 M1，B3 必须写清 **未修/遗留** 且不宣称完整闭环
- [ ] `mvn clean test` 全绿；`mvn clean package` 成功
- [ ] 全部冒烟 + 对抗脚本通过（已按新模型更新）
- [ ] 新库初始化 + prod profile 缺配置拒绝启动
- [ ] 浏览器 XSS 真实载荷不执行
- [ ] 普通用户越权矩阵全部失败（攻击失败=安全通过）
- [ ] 文件 `/api/files` 与 `/file` 双路径验证
- [ ] Session/Cookie（及过渡期 JWT）重放验证
- [ ] 领养并发审批验证
- [ ] 独立最终对抗无未处理 P0/P1
- [ ] 遗留风险全部写入本文件 §9

---

## 3. 修复前复现清单（L1 · 红灯基线）

> 改代码前尽量建立。状态：`NOT_STARTED` / `TEST_REPRODUCED` / 不适用 `N/A`。

| 编号 | 攻击命题（修复前应能成功/不安全） | 复现状态 | 证据（测试名/脚本/截图） | 日期 |
|------|----------------------------------|----------|--------------------------|------|
| A0.1 | 无 profile 或 prod,dev 误用开发密钥可启动 | `TEST_REPRODUCED` | `JwtProfileConfigTest` | 2026-07-21 |
| A0.2 | 基线/种子 `admin/admin` 或弱口令可登录 | `TEST_REPRODUCED` | `InitialAdminBootstrap` + prod 弱密探测（test.sql 种子清理未做） | 2026-07-21 |
| A0.4 | 恶意用户名进管理端聊天形成可执行节点 | `TEST_REPRODUCED` | `HtmlEscapesTest.unsafeConcat_wouldKeepExecutableShape`；help/im 历史形态 | 2026-07-21 |
| A0.5 | 仅旧 Session / 省略 Bearer 仍用旧权限 | `TEST_REPRODUCED` | `AuthInterceptorSessionTest` 先复现再修 | 2026-07-21 |
| A0.6 | body.code=401 但 HTTP 200，前端不清理登录 | `TEST_REPRODUCED` | `ResultHttpStatusAdviceTest` | 2026-07-21 |
| A0.7 | 退出后 Session/JWT 仍可用；登录未换 SessionId | `TEST_REPRODUCED` | 代码审查确认旧 logout 仅 removeAttribute | 2026-07-21 |
| A0.8 | 无 CSRF 可跨站式状态变更（同源模拟缺 token） | `TEST_REPRODUCED` | `CsrfInterceptorTest.postWithoutTokenIsRejected` | 2026-07-21 |
| A1 | 管理员新增用户默认 123456 | `TEST_REPRODUCED` | `UserServicePasswordTest.save_rejectsEmptyPassword` | 2026-07-21 |
| B1.1 | 仅 user flag 给自己 roleId=1 | `TEST_REPRODUCED` | `RoleAssignmentPolicyTest.userFlagOnly_cannotAssignSuperAdmin` | 2026-07-21 |
| B2 | A 读 B 的凭证/回访；export 过宽；detail/online 探测 | `TEST_REPRODUCED` | Controller 归属校验 + export 403 | 2026-07-21 |
| B3-F | 知 flag 或 `/file/**` 匿名读私有文件 | `NOT_STARTED` | | |
| B6 | 一动物两个通过 / 驳回后再改通过破坏不变量 | `NOT_STARTED` | | |
| B7 | 公开资金接口暴露内部字段或全表 | `NOT_STARTED` | | |

---

## 4. 决策记录

| 决策 | 结论 | 日期 | 备注 |
|------|------|------|------|
| 范围 | **R2**（里程碑 M1 → M2） | 2026-07-14 | 工期不足可只交付 M1 并声明文件遗留 |
| 文件 OLAC | **B3-F**（M2） | 2026-07-14 | M1 不得宣称完整安全闭环 |
| 认证权威 | **浏览器 Session**；Session 仅 **userId** | 2026-07-14 | JWT 不作为浏览器独立认证；WS 用一次性 ticket |
| CSRF | **MUST** | 2026-07-14 | 配套 Session Cookie |
| 种子账号 | **S1-dev + prod `INITIAL_ADMIN_*`** | 2026-07-14 | 非纯 S2 |
| JWT 存储 | **最终浏览器不保存** | 2026-07-14 | 过渡禁 localStorage |
| Account 公示 | **匿名公开专用 DTO** | 2026-07-14 | 统计 SQL 聚合 |
| `/online` | **普通用户不可枚举用户名** | 2026-07-14 | 不参与鉴权 |
| **测试策略** | **L1 复现 + L2 单项对抗 + L3 阶段门禁 + L4 独立复审** | 2026-07-14 | 禁止只最终测 / 禁止只单测 |
| 进度管理 | **本 STATUS 唯一** | 2026-07-14 | |

---

## 5. 里程碑与阶段门禁

| 里程碑 | 含义 | 状态 | 完成条件 |
|--------|------|------|----------|
| **Security Gate 1** | A0.1–A0.8 全部 **VERIFIED** + §6.1 清单通过 | `NOT_STARTED` | 通过后才大规模 B2 |
| **Phase A 门禁** | A1–A3 VERIFIED + 与 A0 组合回归 | `NOT_STARTED` | |
| **Phase B 门禁（M1 部分）** | B1–B2/B4/B6/B7 VERIFIED + §6.2 | `NOT_STARTED` | B3 此时仍为遗留 |
| **M1** | 核心认证与授权安全基线 | `NOT_STARTED` | Gate1 + A + B（除 B3-F）+ 基础 C |
| **M2 / R2** | 完整安全闭环 | `NOT_STARTED` | M1 + B3-F VERIFIED + §6.3 + L4 |
| **最终发布** | §2.5 发布门禁 | `NOT_STARTED` | 关键项建议达 **REVIEWED** |

### 对外表述

| 条件 | 允许 | 禁止 |
|------|------|------|
| Gate 1 未过 | — | 「安全加固完成」 |
| 仅 M1 VERIFIED | 已修认证/XSS/提权/越权/会话；**文件 OLAC 已知遗留** | 「完整安全闭环」 |
| M1+M2 VERIFIED 且 L4 无阻断 | 完整安全闭环 | — |

---

## 6. 阶段对抗清单（L3）

### 6.1 Security Gate 1 / A0 完成后（必须全过）

- [ ] XSS 载荷管理端不执行（含 help/im 及同类页）
- [ ] 无 profile 不能用开发密钥；prod,dev 走生产规则
- [ ] 删用户 / 降权 / 改密后旧会话失效（真实 HTTP 401/403）
- [ ] 登录轮换 Session ID；退出 invalidate；POST logout
- [ ] HTTP 400/401/403/404/429/500 与 body.code 一致
- [ ] 前端识别真实 HTTP 401 并 clearSession
- [ ] CSRF：无 token 状态变更拒绝
- [ ] WebSocket ticket 正常；MAP/sessionMap 不鉴权
- [ ] 浏览器不再依赖 localStorage JWT（或过渡策略已文档化且测过）

### 6.2 Phase B / M1 完成后（B3 除外）

- [ ] 普通用户无法分配 role 1 / 任意提权
- [ ] 所有 export 权限正确
- [ ] 用户只能读本人敏感数据；水平越权失败
- [ ] 公开动物、公告、资金公示（DTO）仍可访问
- [ ] 领养不出现多个通过者；二次批准/并发测过
- [ ] `/online` 普通用户不可枚举用户名
- [ ] 管理端列表/审核/导出正常
- [ ] **明确记录**：文件 OLAC 仍为遗留（若 M2 未做）

### 6.3 M2 / B3-F 完成后

- [ ] 私有文件 `/api/files/**` 与 `/file/**` 均不可匿名
- [ ] 跨用户绑定 flag 失败
- [ ] 公开动物图/必要头像仍可展示
- [ ] 历史迁移策略执行结果可核对
- [ ] 未绑定文件策略（清理或隔离）已验证

### 6.4 最终黑盒审查（L4）建议流程

```text
新库初始化
  → prod profile 启动（缺配置应失败；配齐后成功）
  → 种子/INITIAL_ADMIN 验证
  → 完整 smoke
  → 全部 adversarial 脚本
  → 手工浏览器 XSS
  → 文件双路径
  → 角色提权
  → Session/Cookie/ticket 重放
  → 并发领养审批
  → WS 在线信息（若适用）
```

审查人尽量**非该模块主实现者**；只给：接口清单、账号、权限矩阵、部署地址、业务规则——避免「迎合实现」的测试。

---

## 7. 实施状态（含验证维度）

| 编号 | 名称 | 复现 | 单元 | MockMvc | 集成/对抗 | 独立复审 | 总状态 | 提交 | 备注 |
|------|------|------|------|---------|-----------|----------|--------|------|------|
| A0.1 | JWT / profile | `TEST_REPRODUCED` | `VERIFIED` | `N/A` | `VERIFIED` | `PENDING` | `VERIFIED` | 未提交 | prod 优先；取消默认 dev；allow-dev-secret 仅 dev |
| A0.2 | 种子 / INITIAL_ADMIN | `TEST_REPRODUCED` | `N/A` | `N/A` | `VERIFIED` | `PENDING` | `VERIFIED` | 未提交 | Bootstrap+prod 弱密探测+dev-seed-notes；test.sql 历史段保留作旧库兼容但文档禁止生产导入 |
| A0.3 | prod 配置与 Guard | `N/A` | `N/A` | `N/A` | `VERIFIED` | `PENDING` | `VERIFIED` | 未提交 | application-prod.yml 关 auto-fix/migrate |
| A0.4 | 存储型 XSS | `TEST_REPRODUCED` | `VERIFIED` | `N/A` | `VERIFIED` | `PENDING` | `VERIFIED` | 未提交 | DOM 渲染+UsernamePolicy；浏览器独立复审 PENDING |
| A0.5 | Session 权限刷新 | `TEST_REPRODUCED` | `VERIFIED` | `VERIFIED` | `VERIFIED` | `PENDING` | `VERIFIED` | 未提交 | 每请求 DB 重载；JWT 过渡仍签发（TTL 30m） |
| A0.6 | HTTP 状态契约 | `TEST_REPRODUCED` | `VERIFIED` | `VERIFIED` | `VERIFIED` | `PENDING` | `VERIFIED` | 未提交 | Handler+ResultHttpStatusAdvice |
| A0.7 | 登录退出 / Session 固定 | `TEST_REPRODUCED` | `N/A` | `N/A` | `VERIFIED` | `PENDING` | `VERIFIED` | 未提交 | changeSessionId+invalidate |
| A0.8 | CSRF | `TEST_REPRODUCED` | `VERIFIED` | `VERIFIED` | `VERIFIED` | `PENDING` | `VERIFIED` | 未提交 | 拦截器+LoginVO+auth-session；浏览器全站回归 PENDING |
| A1 | 默认密码 123456 | `TEST_REPRODUCED` | `VERIFIED` | `N/A` | `VERIFIED` | `PENDING` | `VERIFIED` | 未提交 | save/register 禁空密与默认 123456 |
| A2 | 明文密码兼容 | `TEST_REPRODUCED` | `VERIFIED` | `N/A` | `VERIFIED` | `PENDING` | `VERIFIED` | 未提交 | allow-plaintext-login；prod false/dev true |
| A3 | 登录注册限流 | `TEST_REPRODUCED` | `VERIFIED` | `N/A` | `VERIFIED` | `PENDING` | `VERIFIED` | 未提交 | LoginRateLimiter + HTTP 429 |
| A4 | 文档（非修复） | `N/A` | `N/A` | `N/A` | `N/A` | `N/A` | `NOT_STARTED` | | 不计入安全完成率 |
| B1 | 用户更新白名单 | `N/A` | `VERIFIED` | `N/A` | `VERIFIED` | `PENDING` | `VERIFIED` | 未提交 | 本人/管理拆分；空密不覆盖 |
| B1.1 | 角色分配授权 | `TEST_REPRODUCED` | `VERIFIED` | `N/A` | `VERIFIED` | `PENDING` | `VERIFIED` | 未提交 | RoleAssignmentPolicy；禁 user 提权 role1 |
| B2 | 读/导出/探测面 | `TEST_REPRODUCED` | `N/A` | `N/A` | `IMPLEMENTED` | `PENDING` | `IMPLEMENTED` | 未提交 | 主模块归属；L3 矩阵未跑 |
| B2.1 | 公共接口精确白名单 | `TEST_REPRODUCED` | `N/A` | `N/A` | `IMPLEMENTED` | `PENDING` | `IMPLEMENTED` | 未提交 | animal/notice 精确 GET；**account 匿名仅 `/public`（已去掉 `/{id}`）** |
| B3-F | 文件 OLAC + `/file/**` | `TEST_REPRODUCED` | `VERIFIED` | `IMPLEMENTED` | `IMPLEMENTED` | `PENDING` | `IMPLEMENTED` | 未提交 | stored_name 优先读；附件缺 404；FOR UPDATE；解绑影响行；**迁移草案 precheck/apply+SIGNAL**；**副本库未演练→非 VERIFIED** |
| B4 | 在线 MAP 降级 | `N/A` | `N/A` | `N/A` | `IMPLEMENTED` | `PENDING` | `IMPLEMENTED` | 未提交 | 后端+前端 onlineCount；单机约束 |
| B6 | 领养状态机 | `TEST_REPRODUCED` | `VERIFIED` | `N/A` | `IMPLEMENTED` | `PENDING` | `IMPLEMENTED` | 未提交 | CAS+禁 PUT vstate；真库并发未测 |
| B7 | 资金公示 DTO | `N/A` | `N/A` | `N/A` | `IMPLEMENTED` | `PENDING` | `IMPLEMENTED` | 未提交 | 管理 `/page`+auname 搜；stats 分收支；CRUD 真失败码 |
| C1 | MockMvc / 回归框架 | `N/A` | `NOT_STARTED` | `NOT_STARTED` | `NOT_STARTED` | `PENDING` | `NOT_STARTED` | | |
| C2 | 冒烟/发布清单 | `N/A` | `N/A` | `N/A` | `VERIFIED` | `PENDING` | `VERIFIED` | 未提交 | smoke+auth+upload 脚本已适配 CSRF；pre-demo-check；L4 清单 |
| C3 | CI（可选） | `N/A` | `N/A` | `N/A` | `NOT_STARTED` | `PENDING` | `NOT_STARTED` | | |
| D/E | Flyway/Docker/前端 | `N/A` | `N/A` | `N/A` | `N/A` | `N/A` | `DEFERRED` | | |

### B2 端点原子化进度（禁止先全局放宽拦截器）

每个端点顺序：`归属校验 → MockMvc 对抗 → 拦截器规则（若需）→ 该端点回归 → 下一项`。

| 端点/模块 | 复现 | 校验 | MockMvc | 拦截器 | 回归 | 总状态 |
|-----------|------|------|---------|--------|------|--------|
| Proof 读/export | `TEST_REPRODUCED` | done | unit | n/a | code | `VERIFIED` |
| Visit 读/export | `TEST_REPRODUCED` | done | unit | n/a | code | `VERIFIED` |
| Help 读/export | `TEST_REPRODUCED` | done | unit | n/a | code | `VERIFIED` |
| Adopt 读/export | `TEST_REPRODUCED` | done | unit | n/a | code | `VERIFIED` |
| User detail/online/export | `TEST_REPRODUCED` | done | unit | n/a | code | `VERIFIED` |
| Animal export | `N/A` | done | n/a | n/a | code | `VERIFIED` |
| Account 公开 DTO/export | `N/A` | done | n/a | n/a | code | `VERIFIED` |
| Role/Permission export | `N/A` | done | n/a | n/a | code | `VERIFIED` |
| Notice export | `N/A` | done | n/a | n/a | code | `VERIFIED` |
| Volunteer export | `N/A` | done | n/a | n/a | code | `VERIFIED` |

---

## 8. 验证证据日志

| 日期 | 关联编号 | 层级 L1–L4 | 命令/载荷 | 预期 | 实际 | 结论 |
|------|----------|------------|-----------|------|------|------|
| 2026-07-21 | baseline | L2 | `mvn test`（开工前） | 全绿 | exit 0 | PASS |
| 2026-07-21 | A0.4 | L1 | `HtmlEscapesTest.unsafeConcat_*` | 未转义保留 &lt;img | 断言成立 | REPRODUCED |
| 2026-07-21 | A0.4 | L2 | `HtmlEscapesTest` + `UsernamePolicyTest` + `UserServicePasswordTest.register_rejectsXssUsername` | 载荷被拒/转义 | 全绿 | PASS |
| 2026-07-21 | A0.5 | L2 | `AuthInterceptorSessionTest` | 旧快照重载；删用户 invalidate；无会话 401 | 全绿 | PASS |
| 2026-07-21 | A0.6 | L2 | `HttpStatusExceptionTest` + `ResultHttpStatusAdviceTest` | code→HTTP | 全绿 | PASS |
| 2026-07-21 | batch | L2 | `mvn test`（本批改动后） | 全绿 | exit 0 | PASS |
| 2026-07-21 | A0.8 | L2 | `CsrfInterceptorTest` | 无 token 403；有 token 通过 | 全绿 | PASS |
| 2026-07-21 | A0.1 | L2 | `JwtProfileConfigTest` | prod/prod+dev 拒开发密钥 | 全绿 | PASS |
| 2026-07-21 | batch2 | L2 | `mvn test`（CSRF/profile 后） | 全绿 | exit 0 | PASS |
| 2026-07-21 | B1.1 | L2 | `RoleAssignmentPolicyTest` | user 不能提权 role1 | 全绿 | PASS |
| 2026-07-21 | batch3 | L2 | `mvn test`（B1.1/B2/B7） | 全绿 | exit 0 | PASS |
| 2026-07-21 | A2/A3/B6 | L2 | Password/RateLimit/AdoptService 测试 | 契约通过 | 全绿 | PASS |
| 2026-07-21 | B3-F | L2 | FileAssetServiceTest/FileControllerTest | 私有 403；animal public | 全绿 | PASS |
| 2026-07-21 | batch4 | L2 | `mvn test` 全量 | 全绿 | exit 0 | PASS |
| 2026-07-21 | batch5 | L2 | `mvn test`（绑定/avatar/WS/B7/batch） | 全绿 | exit 0 | PASS |
| 2026-07-21 | B3-F | L2 | FileAssetServiceTest 扩展 | avatar private/图-only；purpose 裁定 | 全绿 | PASS |
| 2026-07-21 | B3-F | 工具 | migrate-file-asset-report.ps1 | 扫描 upload+legacy | 95 文件/92 可解析 | INFO（非迁移正确性证据） |
| 2026-07-21 | batch6 | L2 | `mvn test`（解绑/清图/Visit/Account） | 全绿 | exit 0 | PASS |
| 2026-07-21 | B3-F | L2 | FileAssetBindRulesTest | private→avatar 禁；跨用途；409 | 全绿 | PASS |
| 2026-07-22 | batch7 | L2 | `mvn test` Pack A/B/C | 全绿 | exit 0 | PASS |
| 2026-07-22 | B3-F | 文档 | migrate-precheck/apply + RUNBOOK | 草案可 SIGNAL | 未在副本执行 | DRAFT |
| 2026-07-22 | migrate | 本地 MySQL test | precheck conflict MULTI_BUSINESS shared avatar | 阻断 SIGNAL | 先清共享后放行 | PASS |
| 2026-07-22 | migrate | 本地 MySQL test | apply 1093 bug 修复后 CALL | inserted=29 | 幂等二次 0 | PASS |
| 2026-07-22 | migrate | 本地 MySQL test | stored_name 磁盘回填 | 26/29 真实名 | 0 legacy 名残留 | PASS/PARTIAL |
| 2026-07-22 | migrate | 本地 MySQL test | verify-file-asset-db.ps1 | total=29 orphan_proof=0 unbind NULL probe | PASS | PASS |
| 2026-07-22 | L3 | pre-demo-check -SkipMavenTests | smoke+auth+upload | fail=0 | 全 PASS（修复 PS 头粘滞/Session 优先） | PASS |
| 2026-07-22 | L3 | animal 公开图 /api/files | stored_name+legacy-uploads | HTTP 200 | 1313815 bytes | PASS |
| 2026-07-22 | L3 | 无元数据 flag | fail-closed | HTTP 403 | PASS | PASS |

| 2026-07-21 | wrap | L2 | `mvn test` 收尾批 | 全绿 | exit 0 | PASS |
| 2026-07-21 | wrap | L2 | 前端 purpose/headers 静态检查 | el-upload=7 methods=7 bad=0 | ok | PASS |

（必记示例：XSS 用户名、prod 启动失败、撤权后 401、无 CSRF 拒绝、export 403、`/file` 与 `/api/files` 双路径、并发领养。）

---

## 9. 偏差与遗留风险

| 项 | 原计划 | 实际处理 | 原因 | 后续动作 | 是否阻断发布 |
|----|--------|----------|------|----------|--------------|
| A0.5 完整 Session 权威 | Session 只存 userId，浏览器不存 JWT | 本批：每请求 DB 重载 + logout invalidate；**仍签发 JWT，前端仍存 token** | 避免一次改爆前端 | A0.8 CSRF 后；再去 localStorage JWT / 收紧 auth-session | 是（Gate1 未完） |
| A0.4 浏览器 XSS 人工载荷 | 真实浏览器验证 | 自动化 + DOM 改写；**独立浏览器复审 PENDING** | 环境限制 | 人工用恶意用户名走 help 页 | 是（REVIEWED 前） |
| A0.8 CSRF | MUST | 已实现拦截器+前端 | — | 浏览器全站点验 | 否（代码 VERIFIED） |
| A0.2 test.sql 弱种子 | 正式基线无特权弱口令 | Bootstrap+文档；历史 SQL 仍可能被导入 | 兼容旧演示 | 生产禁导用户段 | 否（有文档与 prod 防护） |
| A0.5 JWT 浏览器 | 最终不存 JWT | sessionStorage + TTL 30m；仍签发 | 渐进 | 可再删 token | 否 |
| B3-F 无元数据历史文件 | 全量迁移后私有默认 | **无元数据 fail-closed 403**；**precheck/apply 草案** | 安全优先 | 副本库演练 precheck→apply 后图才可读 | 是（演示前须迁移或接受图裂） |
| B3-F 业务绑定 API | purpose 上传+绑定 | **submit/update 事务绑定** Help/Volunteer/Proof/Animal/User avatar | — | L3 真机对抗 | 否（代码已做，门禁未跑） |

---

## 10. 下一步（开发入口 · 与策略对齐）


## 收尾结论（Batch1+2+3 局部 · 2026-07-22 认证唯一权威）

**保持 IMPLEMENTED，不升 VERIFIED/M2/R2。**

### Batch1 认证（已实现）
- 登录/注册 **不再返回 JWT**（LoginVO 仅 csrf+user）
- AuthInterceptor **不再 JWT 回落建 Session**
- logout **仅 POST** + CSRF；前端 AuthSession.logout 统一
- prod Cookie **secure=true**
- 对抗：cookie-only OK；jwt-only 401；logout 后 cookie/JWT 均 401；登录无 token

### Batch2 文件（已实现）
- 非 legacy stored_name 精确失败 → 404（禁止前缀回退）
- verifier 严格：DB+磁盘；ambiguous 阻断回填
- migrate 编排 blocking 机器判断；FixSharedAvatars 仅显式开关
- STRICT PASS：meta=31 全命中物理文件；legacyPending=0；bizMissing=0

### Batch3 L3（本机 L3_PARTIAL）
- pre-demo-check fail=0（含 verifier + auth-matrix + upload SHA256 + 真实 /file 旁路）
- -SkipMavenTests 标记 L3_PARTIAL 非完整 L3

### Batch4 收尾（本段）
- GET logout 显式 **405**
- CSRF 403 强制 forceRefresh（不重放业务）
- list-file-orphans.ps1（64 orphan 导出）
- L4 清单更新（Session-only）
- app.websocket.single-instance-only
- pre-demo L3_PARTIAL fail=0；GET logout=405

### 未完成（不能 VERIFIED）
- L4 浏览器 XSS
- 真 MySQL 换图并发压力
- 物理孤儿 64 个（AllowOrphans WARN）
- 未 git commit

---

## 11. 策略整合说明（相对 Codex / 先前建议）

| 来源 | 采纳要点 |
|------|----------|
| 先前建议 | 每目标定点对抗 + Gate/M1/M2 关卡 + 最终总对抗；STATUS 记证据 |
| Codex | 修复前复现、`TEST_REPRODUCED`/`REVIEWED`、四层门禁、手段矩阵、B2 原子、脚本同步更新、独立审查人、发布清单 |
| **整合锁定** | 本文 §0–§2、§6–§7、§10；**不得**只做单测或只做终测 |

---

*更新规则：状态只能使用 §0 枚举；`VERIFIED` 必须满足六条完成标准；`REVIEWED` 仅在独立/最终复审后使用；完成率只统计 `VERIFIED`/`REVIEWED`，不统计 `IMPLEMENTED`。*
