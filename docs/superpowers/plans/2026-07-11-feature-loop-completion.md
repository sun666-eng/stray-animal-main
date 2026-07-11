# 功能闭环补全 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在唯一权威仓库 `D:\Documents\日期归档\2026\2026.4.7\Myproject\stray-animal-main` 中，把「有入口/有半套代码但业务未闭环」的功能补齐，使领养、凭证、回访、义工、救助、注册等主流程均可端到端走通，并附带测试与清理。

**Architecture:** 保持现有 Spring Boot 2.7 + 静态多页（`page/end` 管理端、`page/front` 用户端）架构。业务规则下沉到 Service；Controller 做鉴权与 DTO 组装；前端沿用 jQuery/Vue/Element 风格。闭环标准为：**入口 → 写操作 → 状态机 → 对端可见结果 →（可选）后续动作**。不引入新框架。

**Tech Stack:** Java 8 / Spring Boot 2.7.18、MyBatis-Plus、MySQL、JWT、静态 HTML + Vue2 + jQuery + Element UI、Maven、JUnit 5。

## Global Constraints

- **唯一工作目录：** `D:\Documents\日期归档\2026\2026.4.7\Myproject\stray-animal-main`（忽略其他副本）。
- **兼容现有库表：** 优先 `ALTER TABLE` 增量字段；提供 `docs/sql/` 迁移脚本，避免要求全量重建。
- **权限模型：** 继续用 `flag` + `AuthInterceptor`；新增页面必须同时改拦截器/白名单与 `DataFixRunner`（或 SQL）里的 path。
- **状态约定（统一）：**
  - 动物 `tstate`：`0` 可领养，`1` 申请中，`2` 已领养
  - 领养 `vstate`：`0` 待审核，`1` 已通过，`2` 已驳回，`3` 已取消
  - 义工 `vstate`：`0` 待审核，`1` 已通过，`2` 已驳回
  - 救助 `status`：保持现有 0/1/2/3 文案与管理端一致
  - 凭证 `pstatus`（新增）：`0` 待审核，`1` 已通过，`2` 已驳回
- **YAGNI：** 不做站内信/邮件系统（Phase 4 可选）；IM 保持公共聊天室，仅补文案与可选 helpId 关联字段时再扩展。
- **测试：** 每个后端业务 Task 至少 1 个单元/服务测试；前端以手工验收清单为准。
- **提交：** 每完成一个 Task 单独 commit，中文或英文 commit message 均可，但需说明业务含义。

---

## 0. 当前基线（勿重复做）

以下在本仓库**已具备**，计划中仅做验收与小修，不推倒重写：

| 能力 | 现状证据 |
|------|----------|
| 用户端凭证页 | `static/page/front/adopt_proof.html` 已存在，可上传/列表/删除 |
| 凭证入口链接 | `front/my_adopt.html` → `./adopt_proof.html?aid=` |
| Legacy 跳转 | `AuthInterceptor`：`end/adopt_proof` → `front/adopt_proof` |
| 领养动物状态机 | `AdoptService.syncAnimalState` 按 pending/approved 计数回写 `tstate` |
| 凭证提交鉴权 | `ProofController.save` 校验「本人 + 领养已通过」 |
| 义工绑定用户 | `Volunteer.uid` + `POST` 写入 + `/mine` 按 uid 查 |

**仍需补齐的缺口（本计划范围）：**

1. 领养状态前端文案错误（0/1/2/3）
2. 凭证无审核状态机（管理端只是 CRUD）
3. 回访仅管理端，用户不可见
4. 义工免冠照 UI 有字段、表/实体无 `apic`
5. 义工通过后不升级角色（产品可选，计划内做成开关式实现）
6. 用户注册落在管理端注册页且跳转后台首页
7. `my_rescue` 详情死 UI；救助导出无按钮
8. 导航未登记 `adopt_proof.html`；在线用户 API 无 UI
9. 权限数据/重复菜单与 legacy 清理

---

## File Map（将创建/修改的主要文件）

| 路径 | 职责 |
|------|------|
| `docs/sql/2026-07-11-loop-completion.sql` | 增量 DDL：`t_proof.pstatus`、`t_volunteer.apic` 等 |
| `src/main/java/com/example/entity/Proof.java` | 增加 `pstatus` |
| `src/main/java/com/example/entity/Volunteer.java` | 增加 `apic` |
| `src/main/java/com/example/service/ProofService.java` | 凭证审核业务（新建或扩写） |
| `src/main/java/com/example/service/VolunteerService.java` | 审核通过可选赋角色 |
| `src/main/java/com/example/controller/ProofController.java` | audit / 用户查询带状态 |
| `src/main/java/com/example/controller/VisitController.java` | `GET /mine` |
| `src/main/java/com/example/controller/UserController.java` | 注册响应后前端跳转依赖；可选清理 online |
| `src/main/java/com/example/common/AuthInterceptor.java` | front 回访页、注册页规则 |
| `src/main/java/com/example/common/WebMvcConfig.java` | 公开页/排除路径 |
| `src/main/resources/static/page/front/my_adopt.html` | 状态文案 + 凭证入口文案 |
| `src/main/resources/static/page/front/adopt_proof.html` | 展示 `pstatus` |
| `src/main/resources/static/page/front/my_visit.html` | 新建：我的回访 |
| `src/main/resources/static/page/front/register.html` | 新建：用户端注册 |
| `src/main/resources/static/page/front/login.html` | 注册链接改 front |
| `src/main/resources/static/page/end/proof.html` | 审核下拉 |
| `src/main/resources/static/page/end/volunteer.html` | 与 apic 对齐 |
| `src/main/resources/static/page/end/help.html` | 导出按钮 + 聊天室说明 |
| `src/main/resources/static/page/front/my_rescue.html` | 详情面板绑定 |
| `src/main/resources/static/js/front-nav.js` | 登记新页面与导航项 |
| `src/test/java/com/example/service/*` | 闭环单测 |
| `docs/superpowers/plans/2026-07-11-feature-loop-completion-acceptance.md` | 手工验收清单（Task 末输出） |

---

## Phase A — P0 主路径正确性（约 1～1.5 天）

### Task 1: 统一领养申请状态展示（用户端）

**Files:**
- Modify: `src/main/resources/static/page/front/my_adopt.html`（`stateText` / `stateClass`）
- Optional Modify: `src/main/resources/static/page/end/adopt.html`（确认与 0/1/2/3 一致即可）

**Interfaces:**
- Consumes: `Adopt.vstate` 整型 0/1/2/3
- Produces: 文案映射：`0→待审核`，`1→已通过`，`2→已驳回`，`3→已取消`

- [x] **Step 1: 改 `stateText` / `stateClass`**

```javascript
stateText(state) {
  const s = Number(state);
  if (s === 0) return '待审核';
  if (s === 1) return '已通过';
  if (s === 2) return '已驳回';
  if (s === 3) return '已取消';
  return '未知状态';
},
stateClass(state) {
  const s = Number(state);
  if (s === 1) return 'state-pass';
  if (s === 0) return 'state-pending';
  if (s === 2 || s === 3) return 'state-reject';
  return 'state-pending';
},
```

- [ ] **Step 2: 手工验收**
  - 后台把同一用户申请分别设为 0/1/2/3，刷新 `my_adopt.html`，四种文案正确。
  - `vstate===1` 时仍显示「上传凭证」链接且可打开 `adopt_proof.html?aid=`。

- [ ] **Step 3: Commit**

```bash
git add src/main/resources/static/page/front/my_adopt.html
git commit -m "fix: 用户端领养状态 0/1/2/3 文案与样式对齐"
```

---

### Task 2: 凭证审核状态机（库表 + 后端）

**Files:**
- Create: `docs/sql/2026-07-11-loop-completion.sql`（本 Task 先写 proof 段）
- Modify: `src/main/java/com/example/entity/Proof.java`
- Modify: `src/main/java/com/example/controller/ProofController.java`
- Create or Modify: `src/main/java/com/example/service/ProofService.java`
- Test: `src/test/java/com/example/service/ProofServiceTest.java`（或 Controller 单测）

**Interfaces:**
- Produces:
  - `Proof.pstatus: Integer`（0 待审 / 1 通过 / 2 驳回）
  - `POST /api/proof`：普通用户新建时强制 `pstatus=0`，禁止自设通过
  - `PUT /api/proof/audit/{id}/{state}`：仅 `proof` 权限；`state ∈ {0,1,2}`
  - 用户改自己凭证：仅 `pstatus!=1` 时可改/删（已通过锁定，防抵赖）

- [ ] **Step 1: SQL 迁移**

```sql
-- docs/sql/2026-07-11-loop-completion.sql
ALTER TABLE t_proof
  ADD COLUMN pstatus INT NOT NULL DEFAULT 0 COMMENT '0待审核 1已通过 2已驳回' AFTER ptitle;

UPDATE t_proof SET pstatus = 0 WHERE pstatus IS NULL;
```

- [ ] **Step 2: 实体**

```java
// Proof.java 增加
private Integer pstatus;
```

- [ ] **Step 3: 写失败测试（示例）**

```java
@Test
void userSubmit_forcesPendingStatus() {
    // mock session user without proof flag
    // when save with pstatus=1 -> service/controller sets 0
}
```

- [ ] **Step 4: 实现 `save` 规则**
  - 无 `proof` flag：覆盖 `puid/uname`，`pstatus=0`，校验领养 `vstate=1`（已有）
  - 有 `proof` flag：允许代录，但若未传 `pstatus` 则默认 0

- [ ] **Step 5: 实现 `audit` 接口**

```java
@PutMapping("/audit/{id}/{state}")
public Result<?> audit(@PathVariable Long id, @PathVariable Integer state, HttpServletRequest request) {
    User user = (User) request.getSession().getAttribute("user");
    if (!PermissionUtil.hasFlag(user, "proof")) {
        return Result.error("403", "无权审核凭证");
    }
    if (state == null || state < 0 || state > 2) {
        return Result.error("400", "非法审核状态");
    }
    Proof p = proofService.getById(id);
    if (p == null) return Result.error("404", "凭证不存在");
    p.setPstatus(state);
    return Result.success(proofService.updateById(p));
}
```

- [ ] **Step 6: `verifyOwner` 扩展**
  - 用户删除/更新：`existing.pstatus == 1` 时返回 403「已通过的凭证不可修改」

- [ ] **Step 7: AuthInterceptor**
  - 确认 `/api/proof` 仍按 `proof` / `my_proof` 规则；`audit` 走 `proof` 管理权限（`startsWith("/api/proof")` + flag 列表已含 `proof`）。
  - 若 `my_proof` 用户被误拦 `POST`，保持现有「POST 允许 my_proof」分支（检查 `AuthInterceptor.hasApiPermission`）。

- [ ] **Step 8: 跑测试**

```bash
mvn -q -Dtest=ProofServiceTest,ProofControllerTest test
```

Expected: PASS（无则只跑新增用例）

- [ ] **Step 9: Commit**

```bash
git add docs/sql/2026-07-11-loop-completion.sql src/main/java/com/example/entity/Proof.java \
  src/main/java/com/example/controller/ProofController.java src/main/java/com/example/service/ProofService.java \
  src/test/java/com/example/
git commit -m "feat: 领养凭证增加审核状态机 pstatus 与 audit 接口"
```

---

### Task 3: 凭证闭环前端（用户端展示 + 管理端审核）

**Files:**
- Modify: `src/main/resources/static/page/front/adopt_proof.html`
- Modify: `src/main/resources/static/page/end/proof.html`
- Modify: `src/main/resources/static/js/front-nav.js`（登记 `adopt_proof.html`）

**Interfaces:**
- Consumes: Task 2 的 `pstatus`、`PUT /api/proof/audit/{id}/{state}`
- Produces: 用户可见「待审核/已通过/已驳回」；管理员可改状态

- [ ] **Step 1: `front-nav.js`**

```javascript
// FRONT_PAGES 增加
'adopt_proof.html': true,
// NAV_ITEMS 不强制加一级菜单（从我的领养进入即可）；若要加：
// { href: 'my_adopt.html', text: '我的领养申请' } 已存在
```

- [ ] **Step 2: 用户页列表列「审核状态」**

```javascript
statusText(s) {
  const n = Number(s);
  if (n === 1) return '已通过';
  if (n === 2) return '已驳回';
  return '待审核';
}
// 删除按钮：v-if="Number(item.pstatus) !== 1"
```

- [ ] **Step 3: 管理端 `proof.html`**
  - 表格增加 `pstatus` 列
  - 操作列增加：

```html
<el-select v-model="scope.row.pstatus" size="mini" @change="audit(scope.row)">
  <el-option :value="0" label="待审核"></el-option>
  <el-option :value="1" label="已通过"></el-option>
  <el-option :value="2" label="已驳回"></el-option>
</el-select>
```

```javascript
audit(row) {
  $.ajax({
    url: '/api/proof/audit/' + row.id + '/' + row.pstatus,
    type: 'PUT'
  }).then(res => {
    if (res.code === '0') this.$message.success('审核已更新');
    else this.$message.error(res.msg || '审核失败');
    this.load(); // 现有加载方法名以页面为准
  });
}
```

- [ ] **Step 4: 端到端手工验收**
  1. 用户领养通过 → 上传凭证 → 列表显示待审核  
  2. 管理员改为通过 → 用户刷新见已通过且不能删  
  3. 管理员驳回 → 用户可删后重传  

- [ ] **Step 5: Commit**

```bash
git add src/main/resources/static/page/front/adopt_proof.html \
  src/main/resources/static/page/end/proof.html \
  src/main/resources/static/js/front-nav.js
git commit -m "feat: 凭证用户展示与管理端审核 UI 闭环"
```

---

## Phase B — P1 业务补环（约 1.5～2 天）

### Task 4: 回访用户可见闭环

**Files:**
- Modify: `src/main/java/com/example/controller/VisitController.java`
- Modify: `src/main/java/com/example/common/AuthInterceptor.java`（API/页面规则）
- Create: `src/main/resources/static/page/front/my_visit.html`
- Modify: `src/main/resources/static/js/front-nav.js`
- Modify: `src/main/resources/static/page/front/my_adopt.html`（可选入口：通过后「查看回访」）
- Test: `src/test/java/com/example/controller/VisitControllerTest.java`（可用 MockMvc 或服务层）

**Interfaces:**
- Produces: `GET /api/visit/mine?uid={id}&pageNum=&pageSize=`  
  - 非 `visit` 权限：只能查 `session.user.id == uid`  
  - 过滤：`eq(Visit::getUid, uid)`，`orderByDesc(id)`
- 管理端录入仍用现有 `POST /api/visit`；建议录入时校验 `uid/petId` 非空（轻量）

- [ ] **Step 1: 后端 `mine` 接口**

```java
@GetMapping("/mine")
public Result<IPage<Visit>> mine(@RequestParam Long uid,
                                 @RequestParam(defaultValue = "1") Integer pageNum,
                                 @RequestParam(defaultValue = "10") Integer pageSize,
                                 HttpServletRequest request) {
    User user = (User) request.getSession().getAttribute("user");
    if (!PermissionUtil.hasFlag(user, "visit")
            && (user == null || user.getId() == null || !user.getId().equals(uid))) {
        return Result.error("403", "只能查看自己的回访记录");
    }
    return Result.success(visitService.page(new Page<>(pageNum, pageSize),
            Wrappers.<Visit>lambdaQuery().eq(Visit::getUid, uid).orderByDesc(Visit::getId)));
}
```

- [ ] **Step 2: 鉴权**
  - `AuthInterceptor`：`/api/visit/mine` 允许已登录用户（可在 `hasApiPermission` 增加：path 以 `/api/visit/mine` 开头则 `return true`，归属在 Controller 校验）。
  - 页面：`LOGIN_REQUIRED_PAGE_PATHS` 增加 `/page/front/my_visit.html`。

- [ ] **Step 3: 新建 `my_visit.html`**
  - 复用 `my_volunteer.html` 布局：表格列 = 动物名、回访人、日期、健康评分/状态、备注、图片。
  - 数据：`$.get('/api/visit/mine', { uid: user.id, pageNum, pageSize })`。

- [ ] **Step 4: 导航**
  - `front-nav.js`：`FRONT_PAGES['my_visit.html']=true`；`NAV_ITEMS` 增加「我的回访」。

- [ ] **Step 5: 验收**
  - 管理端从领养页「回访录入」写入 `uid`  
  - 对应用户打开「我的回访」可见；换账号 403/空  

- [ ] **Step 6: Commit**

```bash
git commit -m "feat: 用户端我的回访列表与 /api/visit/mine"
```

---

### Task 5: 义工免冠照字段闭环

**Files:**
- Modify: `docs/sql/2026-07-11-loop-completion.sql`（追加 apic）
- Modify: `src/main/java/com/example/entity/Volunteer.java`
- Modify: `src/main/resources/static/page/front/volunteer_apply.html`（用户上传）
- Modify: `src/main/resources/static/page/end/volunteer.html`（已有 apic UI，对齐实体即可）

**Interfaces:**
- Produces: `Volunteer.apic: String` 存文件 flag

- [ ] **Step 1: SQL**

```sql
ALTER TABLE t_volunteer
  ADD COLUMN apic VARCHAR(255) NULL COMMENT '本人免冠照文件flag' AFTER uid;
```

- [ ] **Step 2: 实体字段 `private String apic;`**

- [ ] **Step 3: 用户申请页**
  - 增加文件选择 → `POST /api/files/upload` → `form.apic = flag`
  - 提交 body 带 `apic`

- [ ] **Step 4: 验收**
  - 申请带照片 → 管理端列表/编辑弹窗显示圆图  
  - 刷新数据库 `t_volunteer.apic` 非空  

- [ ] **Step 5: Commit**

```bash
git commit -m "feat: 义工申请免冠照 apic 落库与前后端对齐"
```

---

### Task 6: 义工审核通过后角色同步（可选但建议做）

**Files:**
- Modify: `src/main/java/com/example/service/VolunteerService.java`（新建审核方法）
- Modify: `src/main/java/com/example/controller/VolunteerController.java`
- Modify: `src/main/java/com/example/service/UserService.java`（必要时提供 `appendRole`）
- Config: `application.yml` → `app.volunteer.auto-grant-role-id: 2`（志愿者角色 id，与 test.sql 一致）

**Interfaces:**
- When `vstate` 变为 `1`：给 `volunteer.uid` 对应用户角色列表追加角色 id=2（去重）
- When 变为 `2`：不自动剥夺（避免误伤手工赋权）；文档写明

- [ ] **Step 1: 配置**

```yaml
app:
  volunteer:
    auto-grant-role-id: ${VOLUNTEER_ROLE_ID:2}
```

- [ ] **Step 2: Service 方法**

```java
@Transactional
public boolean updateWithRoleSync(Volunteer volunteer) {
    boolean ok = updateById(volunteer);
    if (ok && Integer.valueOf(1).equals(volunteer.getVstate()) && volunteer.getUid() != null) {
        userService.ensureHasRole(volunteer.getUid(), autoGrantRoleId);
    }
    return ok;
}
```

- [ ] **Step 3: `UserService.ensureHasRole(Long userId, Long roleId)`**
  - 读用户 → 解析 role JSON 列表 → 无则 append `roleService.getById(roleId)` 摘要 → `updateById`

- [ ] **Step 4: 管理端 `changeState` 走新接口/原 PUT 内部调用**

- [ ] **Step 5: 测试**
  - mock 用户无志愿者角色 → 审核通过 → 用户 role 含 id=2

- [ ] **Step 6: Commit**

```bash
git commit -m "feat: 义工审核通过自动授予志愿者角色"
```

---

### Task 7: 用户端注册闭环

**Files:**
- Create: `src/main/resources/static/page/front/register.html`
- Modify: `src/main/resources/static/page/front/login.html`（注册链接）
- Modify: `src/main/resources/static/page/end/register.html`（成功后若无管理权限可提示去用户端；或保持管理端注册给管理员）
- Modify: `src/main/java/com/example/common/WebMvcConfig.java` 排除 `/page/front/register.html`
- Modify: `src/main/java/com/example/service/UserService.java` **强制**注册角色仅默认普通用户（忽略客户端 role）

**Interfaces:**
- Consumes: 现有 `POST /api/user/register`
- Produces: 注册成功 → `sessionStorage` 写 token/user → 跳转 `/page/front/animal_browse.html`

- [ ] **Step 1: 安全加固 register（必做）**

```java
// UserService.register 开头强制：
user.setRole(null); // 丢弃客户端传入
// 再分配 role id=3
```

- [ ] **Step 2: front 注册页**
  - UI 对齐 `front/login.html`
  - 成功逻辑对齐 login：存 token、user，跳转 animal_browse

- [ ] **Step 3: login 链接改为 `/page/front/register.html`**

- [ ] **Step 4: 验收**
  - 未登录可打开注册  
  - 注册后进用户端而非后台  
  - 用 body 带管理员 role 注册仍是普通用户  

- [ ] **Step 5: Commit**

```bash
git commit -m "feat: 用户端注册页 + 注册强制默认角色防提权"
```

---

### Task 8: 救助体验补齐（详情 + 导出 + IM 文案）

**Files:**
- Modify: `src/main/resources/static/page/front/my_rescue.html`
- Modify: `src/main/resources/static/page/end/help.html`
- Modify: `src/main/resources/static/page/front/rescue_apply.html`（聊天室标题说明）

- [ ] **Step 1: `my_rescue` 详情**
  - 行操作增加「查看」：`@click="detail = item"`
  - 详情面板 `v-if="detail"` 展示 title/description/status/remark/pic

- [ ] **Step 2: help 导出**

```html
<el-button size="mini" type="primary" @click="exp">导出</el-button>
```

```javascript
exp() { window.open('/api/help/export'); }
```

- [ ] **Step 3: IM 文案**
  - 聊天标题改为：「救助公共聊天室（非一对一工单，正式请求请提交下方/表单）」
  - 避免用户误以为私聊客服

- [ ] **Step 4: Commit**

```bash
git commit -m "fix: 我的救助详情、救助导出与聊天室定位文案"
```

---

## Phase C — P2 清理与工程化（约 0.5～1 天）

### Task 9: 在线用户能力收口

**Files:**
- Option A（推荐课设）：Modify `end/index.html` 或 `end/user.html` 增加「当前内存在线」列表，调用 `GET /api/user/online`
- Option B：删除 `UserController.MAP` 与 `/online`（需同步删引用）

**建议 Option A：**

- [ ] 在 `user.html` 工具栏增加按钮「查看在线」弹窗表格（username、id）
- [ ] 注明：仅本机内存会话，重启清空
- [ ] Commit: `feat: 管理端展示 /api/user/online 内存在线列表`

---

### Task 10: 权限数据与 Legacy 清理

**Files:**
- Modify: `repair_permissions.sql` 或新建 `docs/sql/2026-07-11-permission-paths.sql`
- Modify: `DataFixRunner` permission path（已有 my_proof → adopt_proof，核对 visit/my_visit）
- Optional: 删除或 README 标明废弃页：`end/plugins.html`、`end/im.html` 等（**不要删**若实验报告截图需要；可加 HTML 顶部注释 `DEPRECATED`）

- [ ] **Step 1: SQL 修正普通用户权限 path**
  - `my_proof` → `/page/front/adopt_proof.html`
  - `im` → `/page/front/rescue_apply.html`
  - 去掉重复 `adopt_view` id（保留一个）

- [ ] **Step 2: 启用一次 `DATA_FIX_ENABLED=true` 本地跑通后改回 false**

- [ ] **Step 3: Commit**

```bash
git commit -m "chore: 权限 path 与菜单数据修复脚本"
```

---

### Task 11: 回归测试与验收文档

**Files:**
- Create: `docs/superpowers/plans/2026-07-11-feature-loop-completion-acceptance.md`
- Run: `mvn test`

- [ ] **Step 1: 全量单测**

```bash
cd "D:\Documents\日期归档\2026\2026.4.7\Myproject\stray-animal-main"
mvn -q test
```

Expected: BUILD SUCCESS

- [ ] **Step 2: 手工验收清单（写入 acceptance 文档）**

| # | 场景 | 预期 |
|---|------|------|
| 1 | 用户注册 | 进 animal_browse，角色为普通用户 |
| 2 | 浏览→申请→后台审核通过/驳回 | my_adopt 文案正确；动物 tstate 正确 |
| 3 | 通过后上传凭证→后台审核 | 用户见 pstatus；通过后不可删 |
| 4 | 后台回访录入 | 用户 my_visit 可见 |
| 5 | 义工申请+照片→审核通过 | 照片可显示；用户角色含志愿者（若启用） |
| 6 | 救助提交→后台回复 | my_rescue 详情可见 remark |
| 7 | 公共聊天 | 双方能收发；文案标明公共室 |
| 8 | 公告/资金公示 | 仍可用（回归） |

- [ ] **Step 3: Commit 验收文档**

```bash
git commit -m "docs: 功能闭环补全验收清单"
```

---

## 推荐实施顺序与依赖图

```
Task1 状态文案 ──────────────┐
Task2 凭证后端 ─► Task3 凭证前端 ┼─► 领养全链路闭环
Task4 回访 ──────────────────┤
Task5 义工照片 ─► Task6 角色 ┤
Task7 注册 ──────────────────┤
Task8 救助体验 ──────────────┤
Task9 在线 ── Task10 权限清理 ─► Task11 总验收
```

可并行：`Task1 ∥ Task2`，`Task4 ∥ Task5 ∥ Task7 ∥ Task8`（在 Task2 合并 SQL 时注意同一迁移文件追加）。

---

## 工作量粗估

| Phase | 内容 | 预估 |
|-------|------|------|
| A | 状态文案 + 凭证审核闭环 | 1～1.5 人日 |
| B | 回访 / 义工 / 注册 / 救助 | 1.5～2 人日 |
| C | 清理 + 验收 | 0.5～1 人日 |
| **合计** | | **约 3～4.5 人日** |

---

## 明确不在本期范围（防 scope creep）

- 真实消息推送（WebSocket 私信、短信、邮件）
- 前后端分离重构 / 升级 Spring Boot 3
- 支付/押金流水业务
- 删除全部 legacy HTML（报告可能依赖截图）
- 多实例在线用户一致性（需 Redis Session）

---

## 启动前检查清单（执行计划的人）

1. 工作目录仅使用：  
   `D:\Documents\日期归档\2026\2026.4.7\Myproject\stray-animal-main`
2. MySQL 已导入业务库；执行本计划 `docs/sql/2026-07-11-loop-completion.sql`
3. 配置 `JWT_SECRET`（≥32 且非开发默认串）、`DB_*`
4. `mvn test` 基线先绿，再开 Task1
5. 每 Task 完成后按 acceptance 勾选对应场景

---

## Self-Review（计划自检）

| 原缺口 | 对应 Task |
|--------|-----------|
| 领养状态文案错误 | Task 1 |
| 凭证无审核闭环 | Task 2 + 3 |
| 回访用户不可见 | Task 4 |
| 义工 apic 落库失败 | Task 5 |
| 义工通过不赋权 | Task 6 |
| 注册跳后台/可提权 | Task 7 |
| 救助详情/导出/IM 定位 | Task 8 |
| online 无 UI | Task 9 |
| 权限脏数据/legacy | Task 10 |
| 总验收 | Task 11 |
| 动物状态写错（旧副本问题） | 本仓库已修复，Task11 回归确认 |

无 TBD 占位；接口名与文件路径均锚定当前权威目录。
