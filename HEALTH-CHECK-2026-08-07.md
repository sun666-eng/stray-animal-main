# 系统健康检查报告 — 流浪动物救助管理系统

**检查日期:** 2026-08-07
**分支:** `release/phase-4d-go-live-rehearsal-20260802` (HEAD=fe003d9, Phase 4C 封存基线)
**检查方式:** 应用冒烟测试 + Maven 全量测试 + 六维独立代理核验 + codex peer-review 盲审 + 完整性批判

---

## TL;DR

系统**当前状态健康、可运行**,但**离 go-live 还差关键几步**,且存在 **1 个已公开到 GitHub 的隐私泄漏**(最高优先级)和 **3 个发布工具缺陷**(重跑前必修)。

- ✅ 应用可启动、513 个测试全绿、4D 正式运行 E0F36B 证据完备
- 🔴 **GitHub 上所有分支/PR 的历史含 6 张私人照片**——filter-repo 重写只在本地,从未 force push
- 🟠 4D 封存差一次"从当前树重建 JAR 后的正式重跑"(当前哈希未绑定证据)
- 🟠 4D 发布工具存在假绿灯/无护栏/不重哈希等缺陷,须修复后再重跑

---

## 一、验证结果汇总

| 验证项 | 结果 |
|--------|------|
| `mvn clean compile` | ✅ exit=0 |
| `mvn test` | ✅ 513/513 通过, 0 失败 / 0 错误 / 0 skipped |
| 应用 dev 启动冒烟 | ✅ Tomcat 9999, SchemaGuard/RolePermissionGuard/DataStateGuard 全过, `/api/health/live`=200, `/api/health/ready`=UP, 页面 302(登录拦截正常) |
| MySQL80 服务 | ✅ RUNNING, root 可连, `test` 库存在 |
| 4D 正式运行 E0F36B 证据 | ✅ go/no-go 16/16、assertions 51/51、self-attack 31/31、ledger gate 296/0、4C 安全回归 136/136、load 180091ms/12316req/5xx=0 |
| GPT 独立评审 | ✅ GO — 但明确"仅适用于该冻结快照" |
| 当前工作区哈希 vs E0F36B 冻结哈希 | ❌ 不一致 → E0F36B 不能作为当前树的最终发布证据 |
| 私人照片泄漏检查 | 🔴 **发现 GitHub 全部 refs 含 6 张私人照片** |

---

## 二、🔴 最高优先级: 私人照片泄漏到 GitHub

**现状:** filter-repo 历史重写(2026-07-26)**只在本地完成,从未 force push 到 GitHub**。LIVE GitHub 上全部 **27 个 refs**(main、所有 release/ui-polish 分支、PR #1/#2)的历史中都包含 6 张私人照片/微信图片:

```
target/classes/static/file/1616271628207-微信图片_20200806093953.jpg
target/classes/static/file/1619974780054-IMG_20210131_094431.jpg
target/classes/static/file/1620006191125-IMG_20201222_112911.jpg
target/classes/static/file/1620199097977-IMG_20201222_112807.jpg
target/classes/static/file/1620199166487-IMG_20210131_094422.jpg
target/classes/static/file/1620662396281-IMG_20210114_185849.jpg
```

这些来自旧提交 `4020b5a` / `7469734`(filter-repo 前的初始历史)。

**佐证:**
- 当前本地 HEAD 链(78 提交)已不含照片 → filter-repo 本身成功了
- 本地残留含照片的旧分支:`animal`、`shocking-birthday`、`wandering-jasper` 等
- `.git` 对象库 174MB(记忆声称重写后应 69MB),含大量 unreachable 旧对象
- `figures/` 的 10 张实验报告图仍被 HEAD 跟踪并已推送到 4D 分支(filter-repo 清理课程文档时遗漏,medium)

**修复方向(需用户决策):** 对全部 refs 重跑 filter-repo 清除这些文件 → 删除/归档残留旧分支 → **force push 覆盖远端**(改写 GitHub 全部历史,需协调仓库 owner)。注意:git 对象库可 `git gc --prune=now` 压缩,但已推送的历史只能靠 force push 覆盖;且远端 GitHub 的旧 commit 可能已被其他协作者 clone。

---

## 三、🟠 4D 封存状态: 差一次正确的重跑

**已确认事实:**
- 4D 最新正式运行 `E2E4D_20260802T075148Z_E0F36B` 证据完备且真实(GO),但其 `gitStatusSha256` 与当前工作区不一致
- 当前工作区含 11 项未提交改动(4D 工具 + UI delta),是 8/2 正式运行**之后**的收尾
- `PHASE-4D-FINAL-DELTA-REVIEW.md`(8/3)已明确: **E0F36B 不得作为当前树的最终发布证据**,记了发布阻塞 P1,须"MySQL 可用后重跑 4D orchestrator 重新绑定哈希"

**但直接重跑会封存错误的东西**——发布工具存在以下缺陷(peer review + 六维核验双重确认,均亲验):

| # | 缺陷 | 严重度 | 影响 |
|---|------|--------|------|
| 1 | orchestrator 复用 `prebuilt-jars.json` 缓存 JAR,内含**旧 UI**(help v=20260730g、adopt 3 处 is-group-label),从不从当前 dirty 树 rebuild | 🔴 critical | 重跑会封存"从未被 prod 进程测过的代码" |
| 2 | JAR SHA 从不复算,账本绑定的是 `prebuilt-jars.json` 的元数据字符串 | 🔴 critical | JAR 被替换/陈旧时证据与真实二进制不符 |
| 3 | `secret-scan` 是假绿灯: 无条件写 `ok=true/hits=[]`,从不真实扫描,gate 只校验存在性 | 🔴 critical | 日志里放 JWT/DB 密码照样通过封存 |
| 4 | `load-baseline` 无非生产护栏: BASE_URL 可指向任意地址,给合法 cookies 就无条件写库 | 🔴 critical | 误配生产即改真实数据 |
| 5 | 清理阶段 DB/用户 DROP 失败被 `catch{}` 吞掉,残留 e2e4d_* 库不被发现 | 🟠 high | 残留数据库持续累积 |
| 6 | Stop-Tracked 不回收历史崩溃遗留进程,阻塞后续所有运行 | 🟠 high | 重复运行 cleanup 门禁永久失败 |
| 7 | go-no-go 自写自报,gate 不校验证据文件存在性/内容 | 🟡 medium | 编排器逻辑错误产生 false-green 不被捕获 |
| 8 | 重跑覆写根级文档(SECURITY-AUDIT.md 等),失败重跑会覆盖 GOOD 证据 | 🟡 medium | 证据文档被失败摘要污染 |
| 9 | self-attack 就地破坏账本非崩溃安全(备份只在内存、漏 ledger-gate-result.json) | 🟡 medium | 中断即损坏证据包(有最终 gate 兜底) |

**✅ 已立即修复:** 删除了 `final-delta/mysql-admin.cnf`(残留 root:123456 凭据,ACL 放开给所有已认证用户)。

---

## 四、其他确认结论

**✅ 正常项**
- 构建/依赖: 四大 CVE 面(jackson 2.18.3、spring 6.2.6、log4j-api 无 core、snakeyaml 2.3)均为已修复版本,无硬编码生产密钥,prod 门禁(JWT_SECRET≥32/非root/非测试库/CORS 收紧)完备
- UI delta(adopt 去 group-label、help 新布局): 无跨页回归,缓存版本 bump 正确;2C/2D 报告失败项均为非目标页(proof/animal)在 mock 环境下的 fixture 问题,**非产品回归**
- 测试套件干净: 0 skipped、无 @Disabled、无 @SpringBootTest(纯单测属设计选择)
- SchemaGuard 契约版本(2026.07.29-operations-p2-v12)与库一致、无漂移
- 备份 bundle(2026-07-26, 120MB)完好;但**无自动化备份任务/恢复演练**(仅文档一句话建议)
- AI 密钥经环境变量注入,无硬编码;但**真实 LLM 从未做端到端验证**(E0F36B 全部走本地 mock)

**🟡 需关注(非阻塞)**
- Spring Boot 3.4.5 / Tomcat 10.1.40 落后多个补丁(含 CVE-2025-46701/55752/55754,均为非默认配置可利用)——建议升级
- 顶层 `output/playwright/release-phase-4d/PHASE-4D-REPORT.md` 仍指向旧 run F6550B(checks=185),与最新 E0F36B(checks=296)不同步
- README.md:84 声称"未指定 profile 默认 dev",实际已改 fail-closed,文档未同步
- SchemaGuard 契约版本未纳入 4D 证据账本;部署 runbook 缺"首次部署先导 bootstrap-all.sql"步骤
- 当前排练分支未推送到 origin、无 upstream
- Windows PATH 中 `java` 指向损坏的 Oracle javapath(报 could not find java.dll)——必须用 `JAVA_HOME=D:\Java\jdk-21`;4D 工具已内置防御,无实际影响

---

## 五、go-live 建议路径

1. **🔴 处理 GitHub 隐私泄漏**: 重跑 filter-repo 清 6 张照片(及 `figures/` 实验图若也须清)→ 删残留旧分支 → force push 覆盖全部 refs → `git gc --prune=now`。**此步涉及改写远端,需先决策。**
2. **🟠 修复 4D 发布工具**: ① 从当前 dirty 树 rebuild 候选 JAR 并刷新 prebuilt-jars.json/jar-cache;② 真实 secret-scan;③ load-baseline 加 loopback 白名单;④ DROP 失败真实记录;⑤ 回收遗留进程;⑥ gate 校验证据文件存在性/内容。
3. **🟠 重跑 4D orchestrator**(MySQL 已可用)生成哈希绑定的新 E2E4D_* run + 新 GPT-INDEPENDENT-REVIEW。
4. **🟢 常规收尾**: 同步顶层报告、修 README、升级 Spring Boot 3.4.x 补丁线、把 SchemaGuard 纳入 ledger、runbook 补 bootstrap 步骤。
5. **推送决策**: 重写后主线历史(78 提交)未推送到 origin/main;4C/4D 封存提交仅在 4c/4d 分支,未合并回 main——需按项目流程合并。

---

## 附: 证据路径

- 4D 正式运行证据: `output/playwright/release-phase-4d/runs/E2E4D_20260802T075148Z_E0F36B/`
- GPT 独立评审: `.../E2E4D_20260802T075148Z_E0F36B/GPT-INDEPENDENT-REVIEW.md`
- Delta 审核: `output/playwright/release-phase-4d/PHASE-4D-FINAL-DELTA-REVIEW.md`
- 发布工具: `tools/release-phase-4d-{orchestrator.ps1,ledger-gate.cjs,load-baseline.cjs,self-attack.cjs}`
- 冒烟测试日志: `/tmp/smoke-app.log`
