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
| Phase 2A 运营中心工作台 | ✅ **实现完成，待审核后提交** |
| Phase 2B / 后续 | ⏸ 未开始 |

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

---

# Phase 2A：统一运营中心信息架构与工作流界面

**日期**: 2026-07-29
**分支**: `ui-polish/phase-2a-operations-workspace-20260729`
**基线**: Phase 1C `c38c04a`
**独立报告**: `output/playwright/ui-polish-phase-2a/PHASE-2A-REPORT.md`
**JSON**: `output/playwright/ui-polish-phase-2a/phase-2a-report.json`

### 结论

| 项 | 值 |
|----|-----|
| 完成 | **是**（严格 2a **159/0** + 1a/1b/1c/adversarial/mvn 全绿） |
| 后端/API/DB/权限规则 | **未改** |
| 1B 导航 / 1C 按钮体系 | **保留** |
| 建议提交 | **是**（待 GPT 审核） |
| 建议 Phase 2B | **否** |

### 修改文件

- `src/main/resources/static/page/end/operations.html` — 权限 tab、ARIA 键盘、指标筛选、三面板布局、状态/busy/409、`opSeq` 反馈生命周期
- `src/main/resources/static/css/admin-workspace.css` — `.ops-*` 运营分诊台样式（自页面内联迁移）
- `tools/ui-polish-phase-2a.cjs` — 严格 Playwright（反馈残留 / 真实 loading / console 审计）

### 关键能力

1. 权限感知标签：待办 / 义工(volunteer) / 医疗(animal)
2. `role=tablist/tab/tabpanel` + Arrow/Home/End
3. 待办指标与客户端筛选（不改 API）
4. 卡片主次操作、busy、expectedVersion、409 冲突提示
5. 义工列表+创建侧栏（移动折叠）；报名桌面表/移动卡片
6. 医疗新增/查询双区；可见范围中文
7. 7 视口无水平滚动
8. 同标签 `opSeq` + 跨标签 `feedbackEpoch`；内部刷新 `preserveFeedback` 保留成功消息

### 自动化终态（端口 10100）

| 命令 | 结果 |
|------|------|
| ui-polish-phase-2a.cjs | **159/0** |
| ui-polish-phase-1 / 1b / 1c | 全过（1c 134/0，矩阵 90） |
| adversarial | **851/0** |
| mvn test | 0 |
| git diff --check | 0 |

### 端口

9999 未触碰；10100 测试后已停止。

### 停止

不提交、不推送、不进入 Phase 2B，等待审核。

### Phase 2A 验收修复轮（严格）

- 消除全部 best-effort PASS；tab 键盘固定序列；tom 必须 200；jerry/anon 页面+API 双拒绝
- 跨标签 `feedbackEpoch`/`notifyFor` + 三竞态测试
- 义工/医疗 API 全量路由拦截（创建/状态/报名/完成/上传/staged 清理）
- 3×7=21 视口；报名 ≥768 表 / <768 卡
- 历史：`ui-polish-phase-2a` 126/0（端口 10099）

### 状态反馈与证据补强（2026-07-30）

- 错误/刷新不再整块替换已有列表（banner + inline status）
- 历史：严格测试 134/0，截图 30；日志 `run-strict-feedback.log`

### 同标签反馈 + 真实 loading + 严格控制台（2026-07-30）

**三问题**（前序）：

1. **同标签旧反馈残留** — `opSeq` + `beginUserOp` / `beginLoad(preserveFeedback)` / `notifyFor(token)`
2. **真实 loading 证据** — 截图 `08`/`08b`/`12a`/`12b`/`12c`；pre-fix 隔离
3. **控制台** — 历史曾用宽泛 400/409/500 资源白名单（已在下轮废除）

历史：`ui-polish-phase-2a` 159/0（端口 10100）

### 错误白名单严格化（2026-07-30 终态）

**仅改** `tools/ui-polish-phase-2a.cjs`（未改 operations.html / CSS / 后端）。

| 规则 | 行为 |
|------|------|
| 故意错误标记 | `route.fulfill` 经 `expectedErrorFulfill` 写头 `x-ui-audit-expected-error: phase2a` |
| `intentionalErrorResponses` | 仅带该头的 4xx/5xx（本轮 **12**） |
| `unexpectedHttpErrors` | 其余 4xx/5xx → **必须 0**（不再因 `/api/operations/**` 放行） |
| `expectedConsoleNoise` | Failed-to-load 按 HTTP 状态与 tagged **1:1**；超出 → real |
| `realConsoleErrors` / `pageErrors` | 任一条失败 |
| 静态图 404 | 仅非 API 历史图片规则 |
| 分类器自检 | 未标记 500→unexpected；标记 409→expected；`UI_AUDIT_REAL_ERROR`→real；**7/0** |
| 删除 | 恒真 `ignoredConsole.length >= 0` |

**终态回归**：

| 命令 | 退出码 / 结果 |
|------|----------------|
| `ui-polish-phase-2a` | **0** · **168/0**（>159） |
| Phase 1C | **0** · 134/0 |
| adversarial | **0** · 851/0 |
| `mvn test` | **0** · **473/0** |
| `git diff --check` | **0** |

**端口**：请求 10101，因 Windows `excludedportrange 10016–10115` 无法绑定，实际 **10116**；结束后已停；**9999 未触碰**。

权威：`output/playwright/ui-polish-phase-2a/run-strict-final.log` · `PHASE-2A-REPORT.md` · `phase-2a-report.json`

**停止**：不提交、不推送、不进入 Phase 2B，等待 GPT 再审核。

### CSS 缓存失效修复（2026-07-30 终态）

**问题**：`admin-workspace.css` 新增 `.ops-*` 约 482 行，但 `operations.html` 仍引用 `?v=20260729c`；`/css/**` 7 天缓存会导致旧用户看不到 Phase 2A 样式。

**修复**（仅 `operations.html`）：

```
admin-workspace.css?v=20260729c  →  admin-workspace.css?v=20260730a
```

- `product-ui.css` / `admin-auth.js` / 图标版本：**未改**
- 其他 14 个管理页：**未改**（本轮 CSS 均为 `.ops-*` 专用）

**严格断言**：HTML 必须 `v=20260730a`、不得 `v=20260729c`；浏览器 request + performance resource 必须出现新版本；找不到 = FAIL。

**终态回归**（端口 **18082**，9999 未触碰）：

| 命令 | 结果 |
|------|------|
| `ui-polish-phase-2a` | **173/0**（≥168；含 cache-bust 断言） |
| Phase 1C | 134/0 |
| adversarial | 851/0 |
| `mvn test` | 473/0 |
| `git diff --check` | 0 |
| 错误分类器 | intentional/expected 精确核对；unexpected/real/pageerror = 0；classifier 7/0 |

权威：`output/playwright/ui-polish-phase-2a/run-strict-final.log` · `PHASE-2A-REPORT.md`

**停止**：不提交、不推送、不进入 Phase 2B，等待 GPT **最终放行**。

---

# Phase 2B：角色与权限治理工作台

**日期**: 2026-07-30
**分支**: `ui-polish/phase-2b-rbac-governance-20260730`
**Phase 2A 基线**: `cd24ab1`（已提交并推送，未合并 main）
**独立报告**: `output/playwright/ui-polish-phase-2b/PHASE-2B-REPORT.md`

### Phase 2A 封存

- Commit：`cd24ab1` · `feat(ui): refine operations workspace`
- 推送：`origin/ui-polish/phase-2a-operations-workspace-20260729`
- 自该 commit 拉出 2B 分支

### 结论

| 项 | 值 |
|----|-----|
| 完成 | **是**（严格 2b **81/0** + 2a 173/0 + 1c 134/0 + adversarial 851/0 + mvn 473/0） |
| 后端/API/DB/权限规则 | **未改** |
| 1B 导航 / 1C 按钮体系 | **保留**（1c 适配权限页页面级禁止删除） |
| 建议提交 2B | **是**（待 GPT） |
| 建议 Phase 2C | **否** |

### 修改文件

- `role.html` / `permission.html` — 治理台、指标、超管写入边界、权限选择器 / admin_agent、缓存 `v=20260730b`
- `admin-workspace.css` — `.rbac-*`
- `tools/ui-polish-phase-2b.cjs` — 严格套件
- `tools/ui-polish-phase-1c.cjs` — disabled-btn 接受页面级禁止删除策略

### 关键能力

1. 角色：全局 total + 本页内置/自定义；#1 只读；#2–4 可改不可删；自定义可删
2. 真实超管（`user.role` 含 id=1）才显示写操作；非超管只读横幅
3. 可搜索、分组权限选择器；payload 仅 `permission:[{id}]`
4. 角色 3/4 契约前端防错（用户闭环 / 禁止后台 flag）
5. 权限：补齐 `admin_agent`；前后端 flag/path 集合严格一致；无 DELETE
6. 缓存：role/permission=`20260730b`；operations 仍=`20260730a`

### 自动化终态（端口 18083）

| 命令 | 结果 |
|------|------|
| ui-polish-phase-2b | **81/0** |
| ui-polish-phase-2a | **173/0** |
| ui-polish-phase-1c | **134/0** |
| adversarial | **851/0** |
| mvn test | **473/0** |
| git diff --check | 0 |

### 停止

**不提交 Phase 2B、不推送、不合并 main、不进入 Phase 2C。等待 GPT 审核。**

### 验收返修（2026-07-30）

针对 GPT 审核缺口：

1. **弹窗焦点/键盘**：`createFocusTrap`、Tab 循环、Escape 守卫、删除聚焦取消、关闭恢复 trigger
2. **真 try/finally 清理**：`UI_AUDIT_2B_*` 必清；cleanup self-test 受控抛错后仍 leftover=0
3. **权限矩阵**：admin / jerry / anon / 非超管(sim) 对 **role + permission 两页分别** 断言
4. **#3/#4 契约**：`normalizePermissionIds` + 分组操作不可绕过
5. **竞态/双提交/状态**：loadSeq、writeLocks、ajaxPrefilter、error 保留数据
6. **git diff --check** 终态 0；报告无「权限页同左」空话

**终态回归（端口 18084）**：2b **107/0** · 2a 173/0 · 1c 134/0 · adversarial 851/0 · mvn 473/0 · git-diff 0

**停止**：不提交、不推送、不进入 Phase 2C。等待 GPT **再审核**。

### 第二次验收返修（2026-07-30）— P1 零请求 + 真实网络

GPT 在独立端口 18085 复现：权限保存 / 角色删除浏览器网络 **0 请求**、UI「网络异常」。

| 根因 | 修复 |
|------|------|
| `saveSent`/`delSent` + `ajaxPrefilter` 在首次 `$.ajax` 前即标记 sent，prefilter 取消**第一次**写 | **移除** prefilter 与 `*Sent`；仅 `writeLocks` + `saving`/`deleting` |
| 测试用 `$.ajax` mock / API delete fallback 假绿 | **禁止** mock 与 API 回退；`page.route` + 真实按钮双击；count===1；UI 删除失败即 fail |
| 文案 locator 在 loading 结束后重解析导致“假双发” | 稳定 class 元素句柄上两次 DOM click |

**终态回归（端口 18086）**：

| 命令 | 结果 |
|------|------|
| ui-polish-phase-2b | **138/0** |
| ui-polish-phase-2a | **173/0** |
| ui-polish-phase-1c | **134/0** |
| adversarial | **851/0** |
| mvn test | **473/0** |
| git diff --check | **0** |
| leftover `UI_AUDIT_2B_*` | **0** |
| 18086 结束后 | **stopped**；9999 未触碰 |

权威：`output/playwright/ui-polish-phase-2b/run-strict-final.log` · `PHASE-2B-REPORT.md` · `phase-2b-report.json`

**停止**：不提交、不推送、不进入 Phase 2C。等待 GPT **独立真实浏览器复审**。

### P2 焦点返修（2026-07-30）

GPT 在 18087 放行两个 P1 后，剩余 **P2**：保存/刷新后焦点落到 BODY，旧测试把 BODY 判通过。

| 根因 | 修复 |
|------|------|
| 查询框无 `type=search`，且保存后在列表刷新前恢复到行内「编辑」按钮，刷新后按钮脱离 DOM → BODY | `type="search"` + `resolveStableFocusTarget`；保存/删除成功在 `load` 完成回调后再恢复到稳定查询输入 |
| 弱断言 `body.contains(activeElement)` / 允许 BODY | `inspectFocus` 严格规则：`!isBody && !isHtml && (interactive \|\| explicitHeading)` |

**焦点审计（8 场景均 strictOk，无 BODY/HTML）**：

| 场景 | tag | exactTrigger | listRefreshed |
|------|-----|:------------:|:-------------:|
| role-readonly-close | BUTTON | yes | no |
| role-edit-escape | BUTTON | yes | no |
| role-create-success | INPUT | no | yes |
| role-delete-success | INPUT | no | yes |
| perm-cancel | BUTTON | yes | no |
| perm-success | INPUT | no | yes |
| perm-escape | BUTTON | yes | no |
| perm-readonly-close | BUTTON | yes | no |

**终态回归（端口 18088）**：2b **154/0** · 2a 173/0 · 1c 134/0 · adversarial 851/0 · mvn 473/0 · git-diff 0 · leftover 0 · 18088 stopped

**停止**：不提交、不推送、**未进入 Phase 2C**。等待 GPT **最终审核**。

### 移动端工具栏 P2（2026-07-30）

GPT 确认焦点已过；真实 390×844 复现搜索区空白：

| 修复前 | 修复后（390/360） |
|--------|-------------------|
| `.ui-search` **180px** | **46px** |
| `.admin-review-toolbar` **256px** | **118px** |

**根因**：`.ui-search { flex: 1 1 180px }` 在 `.ui-toolbar { flex-direction: column }` 下把 180px 当高度。

**修复范围**：仅 `admin-workspace.css` `@media (max-width: 640px)` 内 `.admin-review-toolbar .ui-search`（`flex: 0 0 auto; height: 46px`）+ 查询按钮 `min-height: 44px`。未改 `product-ui.css`。缓存 `v=20260730c`（ops 仍 `30a`）。

**断言**：真实 `getBoundingClientRect` 覆盖 1440 / 720 / 390 / 360 × role+permission；Phase 2B **234/0**（>154）。焦点/网络 P1 断言未放宽。

**终态回归（端口 18089）**：2b **234/0** · 2a 173/0 · 1c 134/0 · adversarial 851/0 · mvn 473/0 · git-diff 0 · leftover 0 · 18089 stopped

权威：`output/playwright/ui-polish-phase-2b/PHASE-2B-REPORT.md` · `phase-2b-report.json` · `run-strict-final.log`

**停止**：不提交、不推送、**未进入 Phase 2C**。等待 GPT **再次审核**。

### Phase 2C：领养审核与材料治理（2026-07-30）

**基线**: `1c0a0ff` · **分支**: `ui-polish/phase-2c-adoption-governance-20260730`

| 项 | 值 |
|----|-----|
| 完成 | **是**（2c **92/0** + 2b 234/0 + 2a 173/0 + 1c 134/0 + adversarial 851/0 + mvn 473/0） |
| 后端/API/状态机 | **未改** |
| 建议提交 2C | **是**（待 GPT） |
| 建议进入下一阶段 | **否** |

**修改**: adopt.html / proof.html / admin-workspace.css（`.adopt-governance-*` / `.proof-governance-*`，缓存 `v=20260730d`）/ tools/ui-polish-phase-2c.cjs / adversarial 适配。

**要点**: 本页状态摘要、搜索模式切换不自动请求、问卷分组、写锁与 loadSeq、流转 expectedVersion、自定义确认、材料非证书措辞、焦点恢复严格。

权威: `output/playwright/ui-polish-phase-2c/PHASE-2C-REPORT.md` · `phase-2c-report.json` · `run-strict-final.log`

**停止**: 不提交、不推送、不合并、不进入下一阶段。等待 GPT 审核。

### Phase 2C 验收返修（Esc/焦点 + 零 skip）

- document capture Esc；409 后 `focusDialogError`；关闭后精确回到触发按钮
- 删除全部 `pass(skipped)`；fixture 注入待审记录
- 端口 18092：2c **115/0/0** · 2b 234/0 · 2a 173/0 · 1c 134/0 · adversarial 851/0 · mvn 473/0
- 权威：`output/playwright/ui-polish-phase-2c/PHASE-2C-REPORT.md`
- **停止**：不提交、不推送，等待 GPT 再审核

### Phase 2D：救助工单与动物档案治理（2026-07-30）

**基线**: `813eaadec40995fb92135a1ad88480ea757546ff`
**分支**: `ui-polish/phase-2d-rescue-animal-governance-20260730`（自 813eaad 创建，未碰 main）
**端口（初轮）**: `18093`（未触碰 9999）

| 项 | 值 |
|----|-----|
| 初轮完成 | 2d 113/0/0 + 全量回归绿（后经 GPT 复现 P0 焦点缺陷） |
| 后端/API/状态机/权限规则 | **未改** |
| Phase 2C 页面 | adopt/proof **未改**（仍 `v=20260730d`） |
| 提交/推送 | **否** |

**修改文件**: help.html / animal.html / admin-workspace.css / tools/ui-polish-phase-2d.cjs / 报告产物。

权威: `output/playwright/ui-polish-phase-2d/PHASE-2D-REPORT.md`

### Phase 2D 验收返修（焦点陷阱 + 假绿 + 场景补齐 · 2026-07-30）

**端口**: `18095`（未触碰 9999）
**缓存**: `v=20260730f`

| 项 | 值 |
|----|-----|
| 完成 | **是**（2d **180/0/0** + 2c 115/0/0 + 2b 234/0 + 2a 173/0 + 1c 134/0 + adversarial 851/0 + mvn 473/0 + **git diff --check exit 0**） |
| P0 焦点 | **已修**：全部 2D 弹窗 `createFocusTrap`（Tab/Shift+Tab 循环、打开焦点进弹窗、Esc 精确恢复、提交中禁 Esc） |
| 删除 409 焦点 | **`#animalDeleteError`** + `focusDeleteError()`（不再复用 focusEditError） |
| 测试假绿 | **已删** `inDialog \|\| roleAlert \|\| focusOk`；改为 `dialogFocusOk` 强制 `inDialog===true` |
| Vue E2E | **已禁**；接收入站新建档案走 `#helpNewAnimalName/Type/Sex/Describe` 真实输入 |
| 补场景 | 聊天 500、编辑成功、导入 100% 成功、桌面+移动删除焦点、移动端 390/360/320 弹窗 |
| 权限 | admin 双页 OK；jerry 双拒；匿名登录；tom animal-only 真实；help-only me mock 页门禁 |
| 建议提交 | **待 GPT 再审** |
| 进入 2E | **否** |
| 提交/推送 | **否** |

**焦点审计**: dialogStrict **12/12** `inDialog=true`；删除 409 → `#animalDeleteError`；编辑 409 → `#animalEditError`；成功关闭后稳定焦点（搜索区），不恢复已卸载行按钮。

**git diff --check**: 已清除 report 第 721–722 行尾空格；最终 **exit 0**（仅有 CRLF 警告，无 trailing whitespace 错误）。

权威: `output/playwright/ui-polish-phase-2d/PHASE-2D-REPORT.md` · `phase-2d-report.json` · `run-strict-final.log` · `screenshots-index.json`

**停止**: 不提交、不推送、不合并 main、**不进入 Phase 2E**。等待 GPT 再审核。

### Phase 2D 验收返修：动物档案方式选中态（2026-07-30）

**端口**: `18096` · **缓存**: `v=20260730g` · **结果**: 2d **212/0/0**（>180）

| 项 | 说明 |
|----|------|
| 根因 | HTML 已有 `.admin-segmented` / `.is-active`，但 CSS 无完整规则 → 浏览器默认按钮、选中不可辨识 |
| 修复 | `admin-workspace.css` 补充分段控件（暖纸底 + 朱红选中 + focus-visible + disabled + min-height 44px + ≤360 纵向堆叠） |
| a11y | `role="group"`、`aria-labelledby`、双按钮动态 `aria-pressed` |
| 协议 | 仅切换 `animalMode` 展示；不改 payload / 不改状态机 |
| 新增断言 | **32** 条（含 getComputedStyle 色差、5 视口几何、保存中 disabled） |
| 截图 | +`04b` 创建选中、+`04c` 320px；共 **19** = index |
| 回归 | 2c 115/0 · 2b 234/0 · 2a 173/0 · 1c 134/0 · adv 851/0 · mvn 473/0 · git-diff exit 0 |
| 焦点 P0 | 删除 409 仍 `#animalDeleteError`；未回退 trap |
| 后端 | **未改** |
| 建议封存 | **是**（待 GPT 最终视觉确认） |
| 提交/推送/2E | **否** |

**停止**: 不提交、不推送、不合并 main、不进入 Phase 2E。等待 GPT 再审核。

### Phase 2D 测试可信度返修：受控 409 disabled 探针（2026-07-30）

**端口**: `18097` · **结果**: 2d **224/0/0**（≥212）

| 项 | 说明 |
|----|------|
| 范围 | **仅** `tools/ui-polish-phase-2d.cjs` + 报告；**产品 HTML/CSS/后端零新增改动** |
| 假绿根因 | `disabledProbe.catch(()=>null)` 后 CSS 兜底；`assert(..., true, 'css-fallback')`；`noBestEffortPass` 硬编码 true |
| 修复 | manage PUT 受控 `hold409` Promise：`requestStarted` → 挂起读 DOM → 断言 disabled → `release409` → 409 |
| 运行时探针 | baseline opacity=1 cursor=pointer → inflight disabled=true/true、pressed true/false、opacity=0.7、cursor=not-allowed、puts=1 |
| 审计字段 | `bestEffortPassCount=0`、`fallbackPassCount=0`、`strictRuntimeProbeCount=1`；`noBestEffortPass = (best===0 && fallback===0)` **计算得出** |
| 自检 | 禁止 css-fallback 字符串、禁止 `assert(..., true, ...)`、禁止 disabledProbe null catch |
| 回归 | 2c 115 · 2b 234 · 2a 173 · 1c 134 · adv 851 · mvn 473 · git-diff exit 0 |
| 建议封存 | **是**（测试与产品均过 GPT 视觉后可封） |
| 提交/推送/2E | **否** |

**停止**: 不提交、不推送、不合并 main、不进入 Phase 2E。等待 GPT 最终封存审核。
