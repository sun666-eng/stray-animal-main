# AI Agent 实现原理与本项目实践(2026-07-27)

> 这份文档既是本项目照顾助手的设计说明,也是一份「怎么做一个 AI agent」的教程。
> 代码位置:`service/PetCareService.java`(agent 循环)、`service/PetCareTools.java`(工具层)、
> `controller/PetCareController.java`(入口)、`static/page/front/pet_care.html`(界面)。

---

## 一、先分清三种东西

很多项目把这三者都叫「AI」,但它们差别很大:

| 形态 | 机制 | 能力上限 | 本项目对应 |
|------|------|----------|-----------|
| **规则问答** | 关键词匹配查表 | 只能答预先写好的内容 | 知识库模式(兜底) |
| **单轮 LLM** | 一次 `/chat/completions` | 能生成,但不知道你的数据 | 本次改造前的版本 |
| **Agent** | LLM + 工具 + 循环 | 能查数据、多步推理后再回答 | 本次实现 |

**Agent 的判定标准**:能不能自主决定「我需要先去查点东西」,然后拿着查到的结果继续推理。
少了工具调用或少了循环,就不是 agent。

---

## 二、Agent 的核心:一个有界循环

这是整个 agent 最本质的东西,只有十几行逻辑:

```
messages = [系统提示, ...历史对话, 用户问题]

循环(最多 N 轮):
    响应 = 调用LLM(messages, 工具清单)

    如果 响应.tool_calls 非空:              # 模型说"我要查数据"
        messages.append(响应)               # 把它的决策存进上下文(协议要求)
        对每个 tool_call:
            结果 = 本地执行(tool_call)       # ← 真正干活的是我们的代码
            messages.append({role:"tool", content:结果})
        continue                            # 带着数据回到循环开头
    否则:                                   # 模型给出了最终回答
        return 响应.content

超出轮次 → 放弃(降级)
```

### 三个必须理解的点

**1. 模型自己不执行任何东西。** 它只会「说」:我想调用 `get_my_adoptions`,参数是 `{}`。
真正的数据库查询是你的 Java 代码做的。所以**安全边界完全在你手上**——这点后面细讲。

**2. `messages` 数组是唯一的状态载体。** LLM 是无状态的:每次 HTTP 调用它都"失忆"。
所谓"agent 记得刚才查到了什么",实际是我们把工具结果 append 进 messages,
下一轮又把整个数组重新发过去。你在代码里看到的 `messages.add(toolMsg)` 就是"记忆"的全部实现。

**3. 必须有轮次上限。** 模型可能陷入「反复查同一个工具」的死循环,
每轮都是真实的 API 调用(花钱 + 耗时)。本项目 `app.ai.max-tool-rounds` 默认 3,
且**最后一轮不再传 tools 参数**,强制它用已有信息作答。

### 本项目的实际运行记录(端到端实测)

用户问「我领养的那只动物现在该注意什么?」:

| 轮次 | 模型看到的上下文 | 模型的决策 |
|------|-----------------|-----------|
| 1 | system + user 问题 | 调 `get_my_adoptions`(它意识到需要知道用户养了什么) |
| 2 | + 上一步结果:`{animal_id:10006, animal_name:"波波", review_status:"已通过"}` | 调 `get_animal_profile(animal_id=10006)`(要品种/年龄才能给针对性建议) |
| 3 | + 动物档案:`{name:"波波", species:"狗", status:"已找到新家"}` | 输出最终回答,引用了真实数据 |

最终响应:
```json
{"answer":"我查到你领养的是 波波（狗，已找到新家）。针对它的建议：...",
 "source":"ai", "toolsUsed":["get_my_adoptions","get_animal_profile"]}
```

数据库核对:`SELECT tname,ttype,tstate FROM t_animal WHERE id=10006` → `波波 / 狗 / 2`。
**完全一致,说明数据是真读的而不是模型编的**——这正是 agent 相对单轮 LLM 的价值。

---

## 三、工具怎么定义

工具 = 「给模型看的说明书(JSON Schema)」+「你自己实现的函数」两部分。

### 说明书部分(`PetCareTools.toolSpecs()`)

```java
{
  "type": "function",
  "function": {
    "name": "get_animal_profile",
    "description": "按动物编号查询动物档案：名称、品种、性别、出生日期...
                    需要根据具体动物的品种或年龄给出针对性照顾建议时调用。
                    animal_id 通常来自 get_my_adoptions 的返回结果。",
    "parameters": {
      "type": "object",
      "properties": { "animal_id": {"type":"integer","description":"动物编号"} },
      "required": ["animal_id"]
    }
  }
}
```

**`description` 是 agent 调优的主要着力点。** 模型完全依赖它决定「要不要调、什么时候调」。
上面这段刻意写了两句话:一句说明用途,一句提示参数来源(`来自 get_my_adoptions 的返回`)——
后者显著提升了模型把两个工具串起来用的成功率。

写 description 的经验:
- 说清**什么场景该调**,而不只是它返回什么;
- 如果工具之间有依赖顺序,在 description 里点明;
- 举出用户可能的原话(「当用户问『我的回访』时调用」)。

### 实现部分(`PetCareTools.execute()`)

一个 switch 分发到各查询方法。要点是**错误不抛异常,返回结构化错误**:

```java
return err("not_found", "没有这个编号的动物");   // → {"error":"not_found",...}
```

因为这个字符串会被回灌给模型。模型看到 `not_found` 能自己改口(「我没查到这只动物」),
而抛异常会中断整个循环导致降级——**能让模型自愈的错误就不要升级成故障**。

同理,空结果要返回 `count: 0` 而不是错误,这样模型能区分「你还没有记录」和「查询失败了」。

---

## 四、安全:这是 agent 最容易出事的地方

Agent 的危险在于:**用户的自然语言输入会影响模型的工具调用决策**。
如果设计不当,「帮我查一下 admin 的资料」这种提示注入就可能奏效。

本项目的四条防线,按重要性排序:

### 防线 1:身份不作为工具参数(最关键)

```java
// 工具签名里没有 userId
"get_my_adoptions": { "parameters": { "properties": {} } }

// userId 由服务端从 Session 注入
User user = (User) request.getSession().getAttribute("user");   // Controller
petCareService.ask(user.getId(), question, history);            // 透传
petCareTools.execute(userId, name, args);                      // 执行时注入
```

模型能表达的只有「查当前用户的领养」,**没有任何语法能表达「查用户 42 的」**。
越权在接口形状上就不可能——不依赖模型"守规矩",这才是可靠的。

有单元测试守这条不变量:
```java
assertFalse(toolSpecs().toString().contains("user_id"));  // 工具签名不得包含 user_id
```

### 防线 2:全部只读

不提供任何写工具。所以 agent 不可能绕过业务状态机(审核 CAS、配额校验、文件绑定)
造成数据损坏。想做「帮我提交申请」这类写操作,必须加人工确认环节,风险高得多,
本项目刻意不做。

### 防线 3:模型可指定的参数要二次鉴权

`get_animal_profile(animal_id)` 的 `animal_id` 是模型给的,这就有枚举私有档案的风险。
所以工具内部复用了与 `AnimalController.findById` 完全相同的可见性规则:

```java
boolean publicState = tstate == 0 || tstate == 1;
boolean applicant   = adoptService.count(eq("aid",animalId).eq("uid",userId)) > 0;
if (!publicState && !applicant) return err("not_found", ...);   // 与"不存在"同样的响应
```

注意返回的是 `not_found` 而非 `forbidden`——**不泄漏"这个 ID 存在"这个事实**。

### 防线 4:结果裁剪

只返回照顾建议真正需要的字段。手机号、住址、微信一律不进 LLM 上下文,
即使那是用户自己的数据也一样——数据进了第三方模型的上下文就等于外传了。

```java
assertFalse(json.contains("13800000000"));   // 有测试守着
```

### 另外还有

- **限流**:10 次/分钟/用户。agent 一次问答可能触发 3 次 LLM 调用,不限流成本会失控。
- **CSRF + 登录**:走既有拦截器链,与其他业务接口一致。

---

## 五、可靠性:三级降级

演示/交付场景最怕「AI 挂了整个功能就废了」。本项目的处理:

```
agent 模式(已配 key)
   ↓ LLM 超时 / 非 200 / 返回畸形 / 超轮次
知识库模式(14 主题关键词匹配)
   ↓ 无关键词命中
兜底回答(列出可问的话题)
```

任何一环失败都**静默降级**,用户只会觉得"回答得比较通用",不会看到报错。
实测:把 LLM 服务直接杀掉,同一个问题依然正常回答(`source` 从 `ai` 变成 `local`)。

这个设计让「无 API key 的环境」也能完整演示——这是选择两层架构而非纯 LLM 的主要原因。

---

## 六、怎么调试 agent

Agent 最难的是"模型为什么没调工具/调错了工具",而这在生产日志里很难看出来。
本项目留了三个观测点:

1. **`toolsUsed` 返回给前端**,界面上显示「已查询你的领养申请 · 已读取动物档案」。
   用户获得可信度,你获得可观测性。
2. **`log.debug("agent 调用工具 {} → {} 字节")`** 记录每次工具执行。
3. **假 LLM 服务**(`scratchpad/fake_llm.py`,不入库):一个 80 行的 Python HTTP 服务,
   模拟 OpenAI 协议并按脚本返回 tool_calls。用它可以在**不花钱、不依赖网络**的情况下
   端到端验证整条链路,还能打印每轮收到的 messages 确认工具结果确实被回灌。
   这是本次能确认"agent 真的在转"的关键手段,建议保留这个测试方法。

---

## 七、配置与使用

### 用户个人配置

任意登录用户打开“照顾知识助手”，点击标题旁的“配置 API”：

1. 填写服务商的公网 HTTPS API Base URL（不要包含 `/chat/completions`；个人配置禁止内网地址以防 SSRF）。
2. 填写模型名称和 API Key，保持“启用真实 Agent”开启。
3. 保存后点击“测试连接”；成功后页面状态显示“个人 Agent 已连接”。

密钥按用户账号使用 AES-GCM 加密后保存在服务端数据库 `t_petcare_ai_config`，浏览器不保存、
接口不回显原值。密文还绑定用户 ID，不能复制给另一账号解密。个人配置只影响当前用户，不能覆盖
其他用户或平台配置；退出登录、再次登录、会话过期或服务重启后仍会恢复，只有用户主动点击
“清除个人配置”才会删除。未配置个人连接时，助手使用下面的环境变量配置；平台也未配置时自动
使用内置知识库。

密文主密钥优先读取 `AI_CONFIG_ENCRYPTION_KEY`（至少 32 字符），未配置时使用
`JWT_SECRET` 做域隔离派生；本地开发两者都未配置时生成并复用
`~/.stray-animal/ai-config.key`。生产环境建议独立配置并长期稳定保存
`AI_CONFIG_ENCRYPTION_KEY`，更换或丢失主密钥后旧配置将无法解密。

### 聊天历史保存

每次成功问答都会在服务端数据库表 `t_petcare_chat` 中保存一行，包含当前登录用户 ID、问题、
回答、回答来源、主题、工具调用摘要以及提问/回答时间；会话标题、最近问题概括、轮数和更新时间
保存在 `t_petcare_conversation`。页面进入时只加载左侧会话目录，不会自动展示旧消息；点击某个
会话后才恢复对应记录。用户可以修改会话标题、删除单次会话或清空自己的全部记录。

历史接口不接受客户端传入的用户 ID，而是始终从登录 Session 取身份，因此不同账号之间不能互相
读取或删除记录。API Key 不会写入聊天表。开发环境由 `SchemaGuardRunner` 自动建表；生产环境
请先执行 `docs/sql/2026-07-27-petcare-chat.sql` 和
`docs/sql/2026-07-27-petcare-conversations.sql`。这里保存的是可跨设备恢复的聊天记录；每次发给
模型的上下文仍会按 `max-history` 裁剪，避免请求无限增长。

### 平台环境变量配置

```yaml
app:
  ai:
    enabled: ${AI_ENABLED:false}          # false = 纯知识库(默认)
    base-url: ${AI_BASE_URL:}             # 如 https://api.deepseek.com
    api-key: ${AI_API_KEY:}
    model: ${AI_MODEL:deepseek-v4-flash}
    config-encryption-key: ${AI_CONFIG_ENCRYPTION_KEY:}
    timeout-ms: ${AI_TIMEOUT_MS:8000}
    max-tool-rounds: ${AI_MAX_TOOL_ROUNDS:3}   # agent 循环上限
    max-history: ${AI_MAX_HISTORY:8}           # 携带的历史对话条数
```

启用 agent 模式(以 DeepSeek 为例):
```powershell
$env:AI_ENABLED="true"
$env:AI_BASE_URL="https://api.deepseek.com"
$env:AI_API_KEY="sk-你的key"
$env:AI_MODEL="deepseek-v4-flash"
```
任何 OpenAI 兼容的服务都可以(DeepSeek/Moonshot/通义/本地 Ollama 等),
因为用的是标准 `/chat/completions` + `tools` 协议。

---

## 八、如果要继续扩展

按风险从低到高:

1. **加只读工具**(低风险):比如「查我的救助记录」「查平台公告」。
   照现有模式加一个 case + 一条 toolSpec 即可,记得同步加测试。
2. **历史保留期与导出**(中):当前已按用户分组并支持标题，可继续增加归档、自动过期和导出。
3. **流式输出**(中):`stream: true` + SSE,体验更好但要处理工具调用的流式解析,复杂度上升明显。
4. **写工具**(高风险,建议先别做):如「帮我提交领养申请」。必须有人工确认步骤,
   且不能绕过既有状态机与权限校验。对本项目收益低于风险。

---

## 九、管理员 Agent 第三阶段 3A：领养审核草稿

3A 仍然没有给模型任何写工具。管理员在领养管理页点击“AI 草稿”后，服务端用固定的
`get_adoption_review_context` 读取待审核申请，移除电话、微信、精确住址、性别、婚姻、职业和收入，
再要求模型返回固定 JSON 字段。模型输出只能保存到当前管理员个人草稿表
`t_admin_agent_adopt_draft`，不会调用 `/api/adopt/audit/**`。

草稿允许管理员编辑建议结论、风险、依据、缺失信息和审核备注；保存使用版本号 CAS 防止多标签页覆盖，
申请一旦不再是待审核状态，草稿就不能继续修改。生成、修改和丢弃均写入管理员 Agent 审计表。
进入下一阶段前仍不得把“保存草稿”与“执行审核”合并成一个按钮。

## 十、管理员 Agent 第三阶段 3B：人工确认执行闭环

3B 没有给模型增加写工具。管理员必须先保存 3A 草稿，再进入独立的“人工复核与最终确认”区域：
查看完整申请资料、重新选择通过或驳回，并确认已经复核资料且理解状态影响。覆盖 AI 建议或在高风险下
选择通过时，还必须填写至少 8 个字的人工决定理由。

前端只调用 `/api/admin-agent/adoption-drafts/{id}/finalize`。服务端重新校验 `admin_agent + adopt`
权限、草稿所有权、版本号和领养申请实时状态，然后在同一事务中调用既有
`AdoptService.auditAdopt()` 状态机并把草稿标记为 `executed`。执行请求号在当前管理员范围内唯一，
用于响应丢失后的幂等重试；执行决定、覆盖理由和时间保存在草稿表，成功事件同时写入管理员 Agent 审计表。

“保存个人草稿”仍然不会改变任何申请状态；`manual_review` 和 `request_material` 也不会自动映射为审核结果。
3B 只是建立有明确人工确认的执行闭环，不是无人值守自动审核。

## 十一、管理员 Agent 第三阶段 3C：受控自动审核

- 入口仅对真实超级管理员（角色 ID 1）显示，普通管理员不能读取配置、运行批次或判断证据。
- 默认关闭并使用影子模式；没有后台定时任务，每次都需要超级管理员手动运行。
- 单次最多处理 3 份待审申请。硬规则不满足时不调用模型，直接转人工复核。
- 受控模式只允许“建议通过 + 低风险 + 无缺失信息 + 全部硬规则满足 + 该动物仅一份待审”的记录自动通过；有竞争申请时必须人工比较。
- 自动驳回永久禁用。模型建议驳回、中高风险、资料缺失、状态冲突和服务异常全部转人工或记录失败。
- 模型没有写工具。真正写入前，服务端在独立事务内再次检查紧急停用开关、最新去隐私上下文和既有审核状态机。
- 配置、运行批次和逐条证据保存在 `t_admin_agent_automation_config`、`t_admin_agent_automation_run`、`t_admin_agent_automation_item`。

---

## 附:关键代码索引

| 关注点 | 位置 |
|--------|------|
| agent 循环 | `PetCareService.runAgentLoop()` |
| 单次 LLM 调用 | `PetCareService.callLlm()` |
| 历史裁剪 | `PetCareService.appendHistory()` |
| 历史持久化与用户隔离 | `PetCareConversationService` / `PetCareHistoryService` |
| 历史接口 | `PetCareController.conversations()` / `conversation()` |
| 历史建表迁移 | `docs/sql/2026-07-27-petcare-conversations.sql` |
| 个人 API 配置持久化 | `PetCareAiConfigService` / `t_petcare_ai_config` |
| API Key 加解密 | `PetCareConfigCrypto` |
| API 配置建表迁移 | `docs/sql/2026-07-27-petcare-ai-config.sql` |
| 工具说明书 | `PetCareTools.toolSpecs()` |
| 工具执行与鉴权 | `PetCareTools.execute()` / `animalProfile()` |
| 身份注入 | `PetCareController.ask()` → `ask(user.getId(), ...)` |
| 安全不变量测试 | `PetCareToolsTest`(11 项) |
| 知识库与降级 | `PetCareService.bestMatch()` / `KNOWLEDGE` |
| 3A 审核草稿服务 | `AdminAgentDraftService` / `AdminAgentDraftRepository` |
| 3A 草稿表与迁移 | `t_admin_agent_adopt_draft` / `docs/sql/2026-07-28-admin-agent.sql` |
| 3B 人工确认执行 | `AdminAgentDraftService.finalizeDraft()` / `AdoptService.auditAdopt()` |
| 3C 受控自动审核 | `AdminAgentAutomationService` / `AdminAgentAutomationExecutor` |
| 3C 硬规则与唯一待审保护 | `AdminAgentAutomationPolicy` / `AdoptService.auditSolePendingAdopt()` |
