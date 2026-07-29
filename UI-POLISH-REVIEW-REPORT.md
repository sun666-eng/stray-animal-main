# 归途计划 · 前端视觉与可用性精修 — 阶段复核报告

> 本文件为跨阶段累计报告。每完成一个阶段在文末续写，不覆盖历史章节。
> 审查方请结合：本报告、`git diff`、截图目录与 `output/playwright/ui-polish-phase-1/`。

---

## 总览

| 项 | 值 |
|----|-----|
| 基线提交 | `66943d1` — fix: complete operations closure before UI polish |
| Phase 1B 提交 | `14c4bc5` — feat(ui): unify permission-aware admin navigation |
| 当前分支 | `ui-polish/phase-1c-buttons-icons-20260729`（自 1B 提交创建） |
| 工作区 | Phase 1C 改动**尚未提交**（按要求等待审核；未合并 main） |
| 风格 | Editorial Rescue Journal（暖纸 / 墨黑 / 朱红 / 鼠尾草绿） |
| 后端改动 | **无** |
| 缓存版本 | `20260729c`（1B 为 `20260729b`） |

---

## Phase 1A — 管理导航方向（已通过）

### 范围

- 建立桌面「主入口 + 更多」与移动分组抽屉
- 落地页：index、operations、role、permission

### 视觉决策

- 暖白纸张顶栏，非玻璃拟态
- 主入口固定：档案 / 领养 / 运营 / 救助 / AI
- 治理与次要入口进入「更多」
- 移动三分区：账号治理 / 档案与领养 / 运营与服务

### 测试（1A）

- Playwright 多视口抽样通过
- 产物：`output/playwright/ui-polish-phase-1/`（含 1A 截图与早期 REPORT）

---

## Phase 1B — 全管理页导航推广与交互验收

### 基线与分支

- **基线提交**: `66943d1`
- **当前分支**: `ui-polish/phase-1-admin-nav-20260729`
- **缓存版本**: `admin-auth.js` / `product-ui.css` / `admin-workspace.css` → `?v=20260729b`

### 全部修改文件

#### 源码 / 静态

1. `src/main/resources/static/js/admin-auth.js`
2. `src/main/resources/static/css/admin-workspace.css`
3. `src/main/resources/static/css/product-ui.css`
4. `src/main/resources/static/page/end/index.html`
5. `src/main/resources/static/page/end/operations.html`
6. `src/main/resources/static/page/end/role.html`
7. `src/main/resources/static/page/end/permission.html`
8. `src/main/resources/static/page/end/account.html`
9. `src/main/resources/static/page/end/admin_agent.html`
10. `src/main/resources/static/page/end/adopt.html`
11. `src/main/resources/static/page/end/animal.html`
12. `src/main/resources/static/page/end/help.html`
13. `src/main/resources/static/page/end/notice.html`
14. `src/main/resources/static/page/end/person.html`
15. `src/main/resources/static/page/end/proof.html`
16. `src/main/resources/static/page/end/user.html`
17. `src/main/resources/static/page/end/visit.html`
18. `src/main/resources/static/page/end/volunteer.html`

#### 工具 / 检查

19. `tools/frontend-adversarial-check.ps1`（缓存戳断言随版本更新）
20. `tools/apply-admin-nav-phase1b.cjs`（批量导航壳）
21. `tools/ui-polish-phase-1b.cjs`（Playwright 矩阵）
22. `tools/ui-polish-phase-1.cjs`（1A）
23. `tools/fix-person-flag.cjs`

#### 报告 / 产物

24. `output/playwright/ui-polish-phase-1/REPORT.md`
25. `output/playwright/ui-polish-phase-1/phase-1b-report.json`
26. `output/playwright/ui-polish-phase-1/1b-*.png`（代表截图）
27. `UI-POLISH-REVIEW-REPORT.md`（本文件）

### 15 个管理页面覆盖矩阵

| 页面 | desktopNav | menuGroups | 更多 | 移动分组 | currentNavFlag | 5 视口 |
|------|:----------:|:----------:|:----:|:--------:|:--------------:|:------:|
| index.html | ✅ | ✅ | ✅ | ✅ | `''`（概览） | 5/5 |
| animal.html | ✅ | ✅ | ✅ | ✅ | animal | 5/5 |
| adopt.html | ✅ | ✅ | ✅ | ✅ | adopt | 5/5 |
| operations.html | ✅ | ✅ | ✅ | ✅ | operations | 5/5 |
| help.html | ✅ | ✅ | ✅ | ✅ | help | 5/5 |
| admin_agent.html | ✅ | ✅ | ✅ | ✅ | admin_agent | 5/5 |
| user.html | ✅ | ✅ | ✅ | ✅ | user（更多内） | 5/5 |
| role.html | ✅ | ✅ | ✅ | ✅ | role（更多内） | 5/5 |
| permission.html | ✅ | ✅ | ✅ | ✅ | permission（更多内） | 5/5 |
| proof.html | ✅ | ✅ | ✅ | ✅ | proof（更多内） | 5/5 |
| visit.html | ✅ | ✅ | ✅ | ✅ | visit（更多内） | 5/5 |
| volunteer.html | ✅ | ✅ | ✅ | ✅ | volunteer（更多内） | 5/5 |
| account.html | ✅ | ✅ | ✅ | ✅ | account（更多内） | 5/5 |
| notice.html | ✅ | ✅ | ✅ | ✅ | notice（更多内） | 5/5 |
| person.html | ✅ | ✅ | ✅ | ✅ | person（非业务入口） | 5/5 |

**矩阵合计：75/75 通过**（admin × 15 页 × 5 视口）

菜单一律由 `AdminWorkspace.navigation(permissions)` / `navigationGroups` / `desktopNavigation` 生成，**禁止硬编码完整菜单**。

当前页在「更多」时：

- 触发器 `.admin-nav-more-trigger.is-current`
- 菜单项 `.is-active` + `aria-current="page"`

### 角色权限结果

| 角色 | 方式 | 结果 |
|------|------|------|
| **admin** | 登录 `admin/admin` | 全量授权入口可见；75 页视口导航通过 |
| **部分权限管理员** | 登录后以 `AdminWorkspace` 过滤 `animal+adopt+help`（与真实 permission 同一代码路径） | 仅见相关入口；无用户/角色/权限/凭证等未授权入口 |
| **普通用户** | 登录 `jerry/123456` | person 无管理业务菜单；访问 `user.html` 被重定向 `index.html?error=need_admin` |

### 五种视口测试结果

| 视口 | 通过 | 横向溢出 | 备注 |
|------|:----:|----------|------|
| 1440×900 | 15/15 | ≤0（scrollbar-gutter 负值属正常） | 全称标签 |
| 1280×800 | 15/15 | ≤0 | 短标签 / 中宽防挤压 |
| 768×1024 | 15/15 | 0 | 移动抽屉 |
| 390×844 | 15/15 | 0 | 触控 ≥44 |
| 360×800 | 15/15 | 0 | 触控 ≥44 |

### Maven / 静态检查 / Playwright

| 命令 | 结果 |
|------|------|
| `mvn test` | **473 tests，0 failures / 0 errors** |
| `powershell -ExecutionPolicy Bypass -File tools/frontend-adversarial-check.ps1 -SkipHttp` | **728 pass / 0 fail** |
| `node tools/ui-polish-phase-1b.cjs`（BASE_URL=10094） | **matrix 75/75，交互 6/6，partial/user 通过** |

交互细项：Enter / Space 打开更多、Escape 关闭、外部点击关闭、账号与更多互斥、更多菜单可滚动样式、移动 scrim。

### 修改前后截图路径

| 说明 | 路径 |
|------|------|
| 阶段产物根目录 | `output/playwright/ui-polish-phase-1/` |
| 1A 桌面概览 | `output/playwright/ui-polish-phase-1/index-1440x900.png` |
| 1A 更多展开 | `output/playwright/ui-polish-phase-1/index-1440x900-more-open.png` |
| 1A 移动运营 | `output/playwright/ui-polish-phase-1/operations-390x844-mobile-open-final.png` |
| 1B 桌面主栏 | `output/playwright/ui-polish-phase-1/1b-index-1440x900.png` |
| 1B 更多内高亮 | `output/playwright/ui-polish-phase-1/1b-user-1440x900-more.png` |
| 1B 动物档案 | `output/playwright/ui-polish-phase-1/1b-animal-1440x900.png` |
| 1B 移动分组 | `output/playwright/ui-polish-phase-1/1b-animal-390x844-mobile-open.png` |
| 1B 部分权限 | `output/playwright/ui-polish-phase-1/1b-partial-animal-1440.png` |
| 1B 普通用户 | `output/playwright/ui-polish-phase-1/1b-user-person-1440.png` |
| 1B 交互互斥 | `output/playwright/ui-polish-phase-1/1b-interaction-account-open.png` |
| 机器可读报告 | `output/playwright/ui-polish-phase-1/phase-1b-report.json` |

### 控制台错误与横向溢出统计

| 指标 | 结果 |
|------|------|
| 导航矩阵 pageerror | 0（最终跑次） |
| 资源 404（历史图片缺失） | 存在于 animal 等业务页，**与导航无关**；最终判定已忽略纯 404 资源噪音 |
| 横向溢出 360/390 | 全部 0 |
| 横向溢出 1280/1440 | ≤0（稳定滚动条槽位） |
| 脚本错误导致失败 | 0 |

### 未解决问题与残余风险

1. **未做**：运营中心内容布局、角色权限弹窗分组、业务表格/按钮图标系统（下阶段）。
2. **partial admin** 使用与生产相同的 `AdminWorkspace.navigation*` 过滤仿真；未在 DB 新建 partial 账号。
3. **operations 合成入口**：持有 animal/adopt/help 等 flag 时仍会出现「运营中心」（既有 `admin-auth.js` 规则，未改权限后端）。
4. **person** 使用 `currentNavFlag:'person'`，故意不激活「概览」。
5. 各管理页 header 仍为页面内联复制（非 runtime 注入壳组件）；数据源统一为 AdminWorkspace。

### 是否修改接口、权限或后端

| 类别 | 是否修改 |
|------|----------|
| Controller / Service / Mapper | **否** |
| 数据库 / 状态机 | **否** |
| 权限规则 / AuthSession 契约 | **否**（仅前端过滤展示） |
| 请求路径 / 字段 / 响应解析 | **否** |
| CSRF / 鉴权绕过 | **否** |

### git diff --stat（截至 Phase 1B 完成）

```
 src/main/resources/static/css/admin-workspace.css  | 291 ++++++++++++++++++++-
 src/main/resources/static/css/product-ui.css       |  40 ++-
 src/main/resources/static/js/admin-auth.js         | 177 +++++++++++--
 src/main/resources/static/page/end/account.html    | 184 +++++++-------
 src/main/resources/static/page/end/admin_agent.html|  91 +++++--
 src/main/resources/static/page/end/adopt.html      | 158 ++++++-----
 src/main/resources/static/page/end/animal.html     | 185 +++++++-------
 src/main/resources/static/page/end/help.html       | 105 +++++++-
 src/main/resources/static/page/end/index.html      |  91 +++++--
 src/main/resources/static/page/end/notice.html     | 185 +++++++-------
 src/main/resources/static/page/end/operations.html | 131 ++++++++--
 src/main/resources/static/page/end/permission.html |  93 +++++--
 src/main/resources/static/page/end/person.html     |  91 +++++--
 src/main/resources/static/page/end/proof.html      | 160 +++++++-----
 src/main/resources/static/page/end/role.html       |  93 +++++--
 src/main/resources/static/page/end/user.html       |  90 ++++++-
 src/main/resources/static/page/end/visit.html      | 165 +++++++------
 src/main/resources/static/page/end/volunteer.html  | 100 ++++++-
 tools/frontend-adversarial-check.ps1               |   2 +-
 19 files changed, 1779 insertions(+), 653 deletions(-)
```

另有未跟踪工具脚本：`tools/apply-admin-nav-phase1b.cjs`、`tools/ui-polish-phase-1*.cjs`、`tools/fix-person-flag.cjs`。

### 建议保留或回退的改动

| 改动 | 建议 |
|------|------|
| `admin-auth.js` 导航 API + flagsMatch | **保留**（1B 核心） |
| 15 页统一 header 壳 | **保留** |
| admin-workspace 导航 CSS / scrim | **保留** |
| product-ui 移动触控 | **保留** |
| adversarial 缓存戳更新 | **保留**（与版本一致） |
| 工具脚本 tools/ui-polish-* | **保留**（验收可复跑） |
| 业务内容/表格/运营中心布局 | **未改** — 无需回退 |

### 硬性边界核对

- 未终止用户 9999 进程；测试端口 10094/10095 用于验收后已清理
- 未 `git reset` / `git clean` / 提交 main
- 未引入 React/Vite/CDN/远程字体图标
- 未使用 innerHTML / v-html

---

## Phase 1B 验收收尾（Acceptance Close-out）

**日期**: 2026-07-29
**分支**: `ui-polish/phase-1-admin-nav-20260729`
**基线**: `66943d1`
**范围**: Git 卫生、临时脚本清理、真实 partial 账号 E2E、全量回归。
**未做**: 导航设计变更、Phase 1C、合并 main、后端改动。

### Git 卫生

| 项 | 结果 |
|----|------|
| `git diff --check` | **退出码 0，无 trailing whitespace 输出** |
| 处理 | 清理 page/end 导航注入引入的行尾空格 |
| 绕过 | **无** |

### 一次性脚本

| 文件 | 处理 |
|------|------|
| `tools/apply-admin-nav-phase1b.cjs` | **已删除** |
| `tools/fix-person-flag.cjs` | **已删除** |
| `tools/ui-polish-phase-1.cjs` | **保留** |
| `tools/ui-polish-phase-1b.cjs` | **保留**（含真实 tom E2E） |
| `tools/frontend-adversarial-check.ps1` | **保留** |
| `tools/admin-nav-unit-check.cjs` | **新增保留**（navigation/flagsMatch 静态单元） |

### 测试类型区分（禁止混称）

| 类型 | 说明 | 结果 |
|------|------|------|
| **实际账号 E2E** | 真实登录 `tom`（部分管理权限） | **8/8 通过** |
| **前端数据模拟** | admin 登录后 patch Vue 菜单 | 通过（仅过滤函数） |
| **静态检查** | adversarial -SkipHttp | **728 / 0** |
| **导航单元** | admin-nav-unit-check | **16 / 0** |
| **Maven** | `mvn test` | **473 / 0** |
| **Playwright 矩阵** | 15 页 × 5 视口 | **75 / 0 fail** |
| **交互** | Enter/Space/Escape/外点/互斥/滚动 | **6 / 6** |

### 真实部分管理员 tom E2E

服务端下发 flags（观测）：`animal, visit, adopt, proof, volunteer, account, notice`
（客户端按既有规则合成 `operations`；无 user/role/permission/help/admin_agent）

| 检查 | 结果 |
|------|------|
| 桌面导航仅授权入口 | ✅ |
| 「更多」无未授权页 | ✅（凭证/回访/义工/资金/公告） |
| 移动分组无未授权页 | ✅ |
| 访问 `/page/end/user.html` | ✅ → `index.html?error=forbidden` |
| `/api/user/page` | ✅ **403** |
| 有权限页 + `/api/animal/page` | ✅ **200** |
| 退出后 | ✅ API **401**，跳转 login |

截图：`1b-partial-real-tom-1440-animal.png`、`1b-partial-real-tom-390-mobile.png`

### 回归命令记录

1. `git diff --check` → 0
2. `mvn test` → 473/0
3. `tools/frontend-adversarial-check.ps1 -SkipHttp` → 728/0
4. `tools/ui-polish-phase-1.cjs` → exit 0
5. `tools/ui-polish-phase-1b.cjs` → 75/75 + real partial
6. 真实 partial → **已完成（tom）**
7. 测试端口 10095 已清理；**9999 仍 Listen**
8. `tools/admin-nav-unit-check.cjs` → 16/0

### 建议提交文件（尚未 commit）

应纳入：

- `src/main/resources/static/js/admin-auth.js`
- `src/main/resources/static/css/admin-workspace.css`
- `src/main/resources/static/css/product-ui.css`
- `src/main/resources/static/page/end/*.html`（15）
- `tools/frontend-adversarial-check.ps1`
- `tools/ui-polish-phase-1.cjs`
- `tools/ui-polish-phase-1b.cjs`
- `tools/admin-nav-unit-check.cjs`
- `UI-POLISH-REVIEW-REPORT.md`
- （可选）`output/playwright/ui-polish-phase-1/**` 证据

已移除勿提交：`apply-admin-nav-phase1b.cjs`、`fix-person-flag.cjs`

---

## 阶段状态

| 阶段 | 状态 |
|------|------|
| Phase 1A 管理导航方向 | ✅ 通过 |
| Phase 1B 全页推广 + 交互 | ✅ 已提交 `14c4bc5` |
| Phase 1B 验收收尾 | ✅ 已完成 |
| Phase 1C 按钮层级与本地图标 | ✅ **严格验收通过，待审核后提交** |
| Phase 2 / 后续 | ⏸ 未开始（停止条件禁止进入） |

---

# Phase 1C：按钮层级与本地图标体系

**日期**: 2026-07-29（含验收修复轮）
**分支**: `ui-polish/phase-1c-buttons-icons-20260729`
**1B 基线**: `14c4bc5`
**HEAD**: `14c4bc5`（1C 改动全部在工作区，未 commit）
**独立报告**: [`output/playwright/ui-polish-phase-1c/PHASE-1C-REPORT.md`](output/playwright/ui-polish-phase-1c/PHASE-1C-REPORT.md)
**JSON**: `output/playwright/ui-polish-phase-1c/phase-1c-report.json`
**截图索引**: `output/playwright/ui-polish-phase-1c/screenshots-index.json`

### 执行结论（严格模式）

| 项 | 结论 | 依据 |
|----|------|------|
| Phase 1C 完成 | **是** | 134/134；15×6=90 矩阵；危险确认/loading/200%/权限严格断言 |
| P0 / P1 / P2 / P3 | **0 / 0 / 1 / 1** | 行内 class 未全量统一；次要图标非强制 |
| 建议提交 1C | **是** | 假通过已消除 |
| 建议进入 Phase 2 | **否** | 停止条件 |
| 后端 / API / DB / 权限规则 | **均未改** | 仅静态资源与对抗缓存戳 |
| 按钮事件 / 1B 导航结构 | **未改结构** | 保留 @click、AdminWorkspace、More/互斥/键盘 |

### 验收修复（相对首轮）

| 问题 | 修复 |
|------|------|
| 账户菜单 best-effort PASS | Enter/Escape + `aria-expanded` 严格 |
| 无可删角色仍 PASS | 临时角色 `UI_AUDIT_1C_*` 创建→弹窗→取消→清理 |
| disabled 宽松 | 必须找到 + `isDisabled` + 普通 click 计数 0 |
| focus-visible 兜底 | outline/box-shadow 必须可见 |
| `style.zoom=2` 假 200% | CSS viewport **720×450** 等效 1440×900@200% |
| 5 页视口抽样 | **15×6=90** 全矩阵 |
| 注入 class 冒充 loading | route 延迟真实查询 + `is-loading`/`aria-busy` |
| 搜索标签换行 | `.ui-search > span { white-space: nowrap }` |
| 重复 `.ui-icon-button` | 合并为单一 44×44 定义 |
| 一次性 apply/fix 脚本 | **已删除**（仅保留 1c / inventory / verify） |

### 自动化终态（端口 10097）

| 命令 | 通过 | 失败 | 退出码 | 耗时 |
|------|-----:|-----:|-------:|-----:|
| `git diff --check` | — | 0 | 0 | 106ms |
| `mvn test` | 全绿 | 0 | 0 | 13779ms |
| `frontend-adversarial-check.ps1 -BaseUrl http://localhost:10097` | **851** | **0** | 0 | 3653ms |
| `admin-nav-unit-check.cjs` | 16 | 0 | 0 | 51ms |
| `ui-polish-phase-1.cjs` | 25 | 0 | 0 | 38035ms |
| `ui-polish-phase-1b.cjs` | 75+交互/角色 | 0 | 0 | 178592ms |
| `ui-polish-phase-1c.cjs`（严格） | **134** | **0** | 0 | 66993ms |

矩阵 **90/90**。截图 **17**（真实危险弹窗 + 真实 loading + 等效 200%）。

### 中途失败（已修复）

- 临时角色 POST 缺 CSRF → 已加 `X-CSRF-Token`；终态 0 fail

### 端口

| 阶段 | 9999 | 10097 |
|------|------|-------|
| 测试前 | 未监听 | 未监听 |
| 测试中 | **未触碰** | Listen |
| 测试后 | 未监听 | **已停止** |

### 停止

- **不提交、不推送、不进入 Phase 2**，等待 GPT 复审。

---

*报告生成/更新日：2026-07-29。后续阶段请在本文件末尾续写同级章节。*
