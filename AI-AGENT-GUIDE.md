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

```yaml
app:
  ai:
    enabled: ${AI_ENABLED:false}          # false = 纯知识库(默认)
    base-url: ${AI_BASE_URL:}             # 如 https://api.deepseek.com
    api-key: ${AI_API_KEY:}
    model: ${AI_MODEL:deepseek-chat}
    timeout-ms: ${AI_TIMEOUT_MS:8000}
    max-tool-rounds: ${AI_MAX_TOOL_ROUNDS:3}   # agent 循环上限
    max-history: ${AI_MAX_HISTORY:8}           # 携带的历史对话条数
```

启用 agent 模式(以 DeepSeek 为例):
```powershell
$env:AI_ENABLED="true"
$env:AI_BASE_URL="https://api.deepseek.com"
$env:AI_API_KEY="sk-你的key"
$env:AI_MODEL="deepseek-chat"
```
任何 OpenAI 兼容的服务都可以(DeepSeek/Moonshot/通义/本地 Ollama 等),
因为用的是标准 `/chat/completions` + `tools` 协议。

---

## 八、如果要继续扩展

按风险从低到高:

1. **加只读工具**(低风险):比如「查我的救助记录」「查平台公告」。
   照现有模式加一个 case + 一条 toolSpec 即可,记得同步加测试。
2. **对话历史持久化**(中):目前历史由前端携带、服务端无状态。
   若要跨设备连续,需要建表存储,注意 PII 与保留期。
3. **流式输出**(中):`stream: true` + SSE,体验更好但要处理工具调用的流式解析,复杂度上升明显。
4. **写工具**(高风险,建议先别做):如「帮我提交领养申请」。必须有人工确认步骤,
   且不能绕过既有状态机与权限校验。对本项目收益低于风险。

---

## 附:关键代码索引

| 关注点 | 位置 |
|--------|------|
| agent 循环 | `PetCareService.runAgentLoop()` |
| 单次 LLM 调用 | `PetCareService.callLlm()` |
| 历史裁剪 | `PetCareService.appendHistory()` |
| 工具说明书 | `PetCareTools.toolSpecs()` |
| 工具执行与鉴权 | `PetCareTools.execute()` / `animalProfile()` |
| 身份注入 | `PetCareController.ask()` → `ask(user.getId(), ...)` |
| 安全不变量测试 | `PetCareToolsTest`(11 项) |
| 知识库与降级 | `PetCareService.bestMatch()` / `KNOWLEDGE` |
