# 交付就绪评估与优化实施计划(2026-07-27)

> 本文件由本轮交付把关生成:第一节是现状评估,第二节是本轮实施的优化项,
> 第三节是新增「AI 动物照顾助手」的完整设计,第四节是验收清单,第五节是遗留事项。
> 标注 ✅ 的条目在本轮已实施并验证。

---

## 一、交付就绪评估

### 1.1 已达标的部分(前几轮工作,均经测试与实机验证)

| 领域 | 状态 |
|------|------|
| 技术栈 | Java 17 + Spring Boot 3.4.5(双 EOL 栈已迁移),341 个单元测试全绿 |
| 安全 | 明文种子清除、CVE 依赖升级、CSRF 恒时比较、密码策略、鉴权缓存(带竞态防护)、历史重写(敏感文件出库) |
| 业务闭环 | 5 条主闭环经对抗性审查,14 项断点/bug 全部修复(docs/closed-loop-audit-2026-07.md) |
| 数据模型 | 角色权限规范化 Phase 1(role_permission 关联表 + 双写 + 启动对账) |
| 前端 | 死资源清理(15MB→825KB)、缓存/gzip、品牌与状态词统一、a11y 达标、服务区三层信息架构 |
| 文档 | README、部署 checklist、崩溃预防计划、闭环审查报告齐备 |

### 1.2 交付前必须补齐的问题(本轮实施)

1. **稳定性 P0(docs/crash-hardening-plan.md 制定后尚未实施)**——最大交付风险:
   - druid 连接池全默认(maxActive=8 / maxWait=-1 无限阻塞,jar 字节码已验证),
     并发稍高即全站假死且无日志;
   - 聊天轮询打在仅有主键索引的 t_help 上(全表扫+filesort),消息永久堆积;
   - Tomcat/会话全隐式默认;
   - JDBC 无 connect/socket 超时。
2. **稳定性 P1 快项**:上传按用户锁无超时、LoginRateLimiter map 可被凭据填充撑大、
   匿名统计接口无缓存、图片解码像素上限过高(25MP≈100MB 堆/张)。
3. **交付物验证**:此前只跑过 `spring-boot:run`,`mvn package` 产物从未验证。
4. **功能增量(用户要求)**:AI 动物照顾助手。

### 1.3 结论

补齐 1.2 后,本项目达到「课程/演示级可交付」标准;生产部署另见
docs/crash-hardening-plan.md 附录 checklist(HTTPS 反代、进程守护、prod 闸门)。

---

## 二、本轮优化实施项

### 2.1 稳定性 P0 ✅

| 项 | 改动 | 验证 |
|----|------|------|
| druid 连接池 | 新增 `config/DataSourceConfig`(SB3 无 starter 时 `spring.datasource.druid.*` 静默失效——已验证,必须自定义 Bean + `@ConfigurationProperties(prefix="spring.datasource")` 宽松绑定);yml 增 initial-size 5 / min-idle 5 / max-active 20 / **max-wait 5000** / keep-alive true | 启动日志 + 池满快速失败语义 |
| JDBC 超时 | URL 追加 `connectTimeout=5000&socketTimeout=60000` | curl 冒烟 |
| t_help 聊天索引 | SchemaGuard 自动建 `idx_help_chat(title,create_time,id)` + `idx_help_uid(uid)`,SCHEMA_VERSION 递增;docs/sql 手工脚本同步 | 启动日志建索引 + EXPLAIN 语义 |
| 聊天历史微缓存 | HelpService.getChatHistory 5s 进程内缓存,发消息即失效;在线 N 人查询压力 N/10s → 1/5s | 单元测试 |
| Tomcat 基线 | `server.tomcat.threads.max=100`、`connection-timeout=20s`、session timeout 显式 30m | 启动验证 |

### 2.2 稳定性 P1 快项 ✅

- 上传 per-user 锁改 `ReentrantLock.tryLock(10s)`,超时返回 429「上传繁忙」;
- 图片解码像素上限 25MP → 5MP(单张解码堆峰 100MB → 20MB);
- LoginRateLimiter:加定时清理(每次写入时机会式清理过期窗口)+ 硬上限 20000 条逐出;
- `/api/dashboard/public-stats`、`/home-stats` 加 60s 进程内缓存。

### 2.3 交付物 ✅

- `mvn package` 产物验证(jar 可独立启动);
- 生产启动示例脚本 `tools/start-prod-example.ps1`(含 -Xmx、ExitOnOutOfMemoryError、
  固定工作目录;进程守护 winsw 步骤见 crash-hardening-plan,涉及外部下载由维护者执行)。

---

## 三、AI 动物照顾助手(新功能)

### 3.1 定位与边界

- **给谁用**:登录用户(领养人/潜在领养人/义工),询问动物照顾的注意事项与方式方法。
- **不做什么**:不替代兽医诊断(页面与回答均含免责声明);不回答与动物照顾无关的话题;
  不接触业务数据(与领养/审核流程完全解耦,故障不影响主业务)。

### 3.2 架构(两层,默认零外部依赖)

```
用户 → front/pet_care.html(聊天式界面)
     → POST /api/petcare/ask(登录 + CSRF + 限流 10 次/分钟/用户)
     → PetCareService
         ├─ 第一层:内置知识库(默认,离线可用)
         │   约 14 个高质量主题条目(关键词加权匹配):
         │   新手准备/喂养/疫苗驱虫/绝育/新环境适应/幼猫幼犬/老年动物/
         │   常见疾病征兆/应急处理/行为问题/洗护/外出安全/多宠共处/领养过渡期
         └─ 第二层:可选 LLM 增强(app.ai.enabled=true 时启用)
             OpenAI 兼容 /chat/completions(base-url/api-key/model 可配,
             兼容 DeepSeek/Moonshot/通义等国内可用服务),Java 17 内置
             HttpClient,8s 超时;任何失败自动降级回第一层,用户无感。
```

设计理由:课程/演示环境无外部 key 也能稳定演示(知识库回答质量可控);
配了 key 则自动升级为真 LLM 对话,系统提示词把话题限定在动物照顾并强制
「不能替代兽医」边界。

### 3.3 接口契约

```
POST /api/petcare/ask   body: {"question": "..."}   (1-500 字)
200: {"code":"0","data":{"answer":"...","source":"local|ai","topic":"喂养"}}
429: 触发限流;401: 未登录
GET  /api/petcare/topics → 快捷问题列表(前端引导按钮)
```

### 3.4 配置(application.yml)

```yaml
app:
  ai:
    enabled: ${AI_ENABLED:false}        # false=纯知识库
    base-url: ${AI_BASE_URL:}           # 如 https://api.deepseek.com
    api-key: ${AI_API_KEY:}
    model: ${AI_MODEL:deepseek-chat}
    timeout-ms: ${AI_TIMEOUT_MS:8000}
```

### 3.5 入口与页面

- 新页面 `page/front/pet_care.html`:product-ui 聊天式界面,顶部免责声明,
  快捷问题按钮(取自 /topics),复用既有 ui-chat 组件样式;
- 首页「了解平台」组新增入口「照顾知识助手」(user-workspace.js);
- AuthInterceptor:`/api/petcare` 登录即可;页面加入登录保护名单。

### 3.6 测试

- PetCareServiceTest:关键词匹配命中/多关键词加权/无匹配兜底/限流/LLM 关闭时不外呼;
- 全量回归 + 实机启动 + headless 截图验证页面渲染。

---

## 四、验收清单(完成后逐项打勾)

- [x] 351/351 全量单元测试通过(≥341,含新增)
- [x] `mvn package` 成功(68MB jar),jar 独立启动成功
- [x] dev 实机启动:SchemaGuard 建索引、druid 参数生效日志
- [x] curl 冒烟:公开页/API/新 petcare 接口行为正确(未登录 401)
- [x] pet_care 页面 headless 截图完整问答流验证（顺带修复 .ui-state[hidden] 存量 bug）
- [x] 全部改动提交并推送(PR #2)

---

## 五、遗留事项(不在本轮,已有文档)

1. 进程守护落地(winsw/计划任务,需下载外部程序,由维护者按 crash-hardening-plan §P0.4 执行);
2. Excel 导入流式改造(crash-hardening P1.4);
3. 前端 P3 结构性去重(front 头部共享注入/admin mixin/内联脚本外置,见 frontend-optimization-plan §P3);
4. 角色规范化 Phase 2(user_role,触发条件见 role_permission Phase 1 提交说明);
5. AI 助手后续可选:对话历史持久化、管理端知识库编辑界面、流式输出。
