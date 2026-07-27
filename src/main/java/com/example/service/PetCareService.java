package com.example.service;

import cn.hutool.json.JSONArray;
import cn.hutool.json.JSONObject;
import cn.hutool.json.JSONUtil;
import com.example.exception.CustomException;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.Deque;
import java.util.List;
import java.util.concurrent.ConcurrentHashMap;

/**
 * AI 动物照顾助手（设计与原理详见根目录 AI-AGENT-GUIDE.md）。
 *
 * <p>三种运行模式，按可用资源自动降级：
 * <ol>
 *   <li><b>agent 模式</b>（app.ai.enabled=true + 已配 base-url/api-key）：
 *       真正的 agent 循环——模型可自主决定调用 {@link PetCareTools} 里的只读工具
 *       查询当前用户的领养/回访/义工数据与动物档案，拿到结果后继续推理，
 *       直到给出最终回答。支持多轮对话历史。</li>
 *   <li><b>知识库模式</b>（未配 AI 或调用失败）：14 主题关键词加权匹配，
 *       零外部依赖、离线可演示、内容完全可控。</li>
 *   <li>两者之间自动衔接：agent 任一环节异常都静默降级到知识库，用户无感。</li>
 * </ol>
 *
 * <p>安全边界：工具全部只读且身份由服务端注入（模型无法指定查谁的数据，
 * 见 PetCareTools 类注释）；话题由系统提示词限定；回答不构成兽医诊断。
 */
@Slf4j
@Service
public class PetCareService {

    /** 单用户提问限流：每分钟条数（进程内滑动窗口）。 */
    private static final int RATE_LIMIT_PER_MINUTE = 10;
    private static final int RATE_MAP_MAX_USERS = 5000;

    @Value("${app.ai.enabled:false}")
    private boolean aiEnabled;

    @Value("${app.ai.base-url:}")
    private String aiBaseUrl;

    @Value("${app.ai.api-key:}")
    private String aiApiKey;

    @Value("${app.ai.model:deepseek-chat}")
    private String aiModel;

    @Value("${app.ai.timeout-ms:8000}")
    private long aiTimeoutMs;

    /** agent 循环的最大工具调用轮次——防止模型陷入"反复查同一个工具"的死循环。 */
    @Value("${app.ai.max-tool-rounds:3}")
    private int maxToolRounds;

    /** 携带的历史对话条数上限（user+assistant 合计），控制上下文体积与成本。 */
    @Value("${app.ai.max-history:8}")
    private int maxHistory;

    @jakarta.annotation.Resource
    private PetCareTools petCareTools;

    private final ConcurrentHashMap<Long, Deque<Long>> askTimestamps = new ConcurrentHashMap<>();

    /** 供前端快捷按钮使用的引导问题。 */
    public List<String> quickQuestions() {
        return Arrays.asList(
                "新手养猫需要准备什么？",
                "狗狗的疫苗和驱虫怎么安排？",
                "如何帮助刚领养的动物适应新家？",
                "动物生病有哪些征兆需要警惕？",
                "为什么建议给猫狗绝育？",
                "猫和狗能一起养吗？"
        );
    }

    public PetCareAnswer ask(Long userId, String rawQuestion) {
        return ask(userId, rawQuestion, java.util.Collections.emptyList());
    }

    /**
     * 回答一个问题。
     *
     * @param history 之前的对话（按时间正序，元素为 {role: user|assistant, text: ...}），
     *                用于让追问（"那它多大能打疫苗"）能解析指代。仅在 agent 模式生效。
     */
    public PetCareAnswer ask(Long userId, String rawQuestion, List<ChatTurn> history) {
        if (userId == null) {
            throw new CustomException("401", "未登录或登录已过期");
        }
        String question = rawQuestion == null ? "" : rawQuestion.trim();
        if (question.isEmpty()) {
            throw new CustomException("400", "请输入你的问题");
        }
        if (question.length() > 500) {
            throw new CustomException("400", "问题不能超过 500 字");
        }
        checkRateLimit(userId);

        KnowledgeEntry local = bestMatch(question);
        if (agentAvailable()) {
            AgentResult agent = runAgentLoop(userId, question, history);
            if (agent != null && agent.answer != null && !agent.answer.trim().isEmpty()) {
                return new PetCareAnswer(agent.answer.trim(), "ai",
                        local == null ? "综合" : local.topic, agent.toolsUsed);
            }
            // agent 任一环节失败 → 静默降级到知识库
        }
        if (local != null) {
            return new PetCareAnswer(local.answer, "local", local.topic);
        }
        return new PetCareAnswer(fallbackAnswer(), "local", "综合");
    }

    private boolean agentAvailable() {
        return aiEnabled && aiBaseUrl != null && !aiBaseUrl.trim().isEmpty()
                && aiApiKey != null && !aiApiKey.trim().isEmpty();
    }

    // ==================== 内置知识库 ====================

    static final class KnowledgeEntry {
        final String topic;
        final String[] keywords;
        final String answer;

        KnowledgeEntry(String topic, String[] keywords, String answer) {
            this.topic = topic;
            this.keywords = keywords;
            this.answer = answer;
        }
    }

    private static final List<KnowledgeEntry> KNOWLEDGE = Collections.unmodifiableList(Arrays.asList(
            new KnowledgeEntry("新手准备", new String[]{"新手", "准备", "第一次", "需要买", "用品", "清单", "养猫要", "养狗要"},
                    "迎接新成员前建议准备：①主食（幼年/成年专用粮，先沿用原来的粮再逐步换）；②水碗食碗分开、每天换水；"
                            + "③猫需封闭猫砂盆+猫砂，狗需牵引绳+胸背带；④航空箱或安全笼用于就医出行；⑤窗户封网（尤其养猫，防坠楼）；"
                            + "⑥指甲剪、梳子等基础护理用品。到家后先约兽医做基础体检、确认疫苗驱虫计划。"),
            new KnowledgeEntry("喂养", new String[]{"喂", "吃什么", "食物", "粮", "喂食", "几顿", "能不能吃", "巧克力", "牛奶", "零食"},
                    "喂养要点：①以合适阶段的全价粮为主食，占比不低于日粮的一半；②幼年动物少食多餐（3-4 顿），成年 1-2 顿定时定量；"
                            + "③猫狗禁食清单：巧克力、洋葱大蒜、葡萄/葡萄干、酒精、木糖醇（狗剧毒）、大量肝脏；"
                            + "④多数猫狗乳糖不耐，不要喂牛奶，可选宠物专用奶；⑤换粮用 7 天过渡法逐步混合，避免应激性腹泻；⑥常备清洁饮水。"),
            new KnowledgeEntry("疫苗驱虫", new String[]{"疫苗", "驱虫", "免疫", "狂犬", "打针", "预防针", "体内", "体外"},
                    "免疫与驱虫：①幼犬幼猫 6-8 周龄起接种核心疫苗，间隔 3-4 周共 2-3 针，之后每年加强；"
                            + "②狂犬疫苗一般 3 月龄以上接种，之后按当地要求每年一次（我国养犬普遍强制）；"
                            + "③体内驱虫：幼年每月一次，成年每 3 个月左右一次；体外驱虫（跳蚤蜱虫）按药物说明每月进行，即使不出门也建议做；"
                            + "④接种后观察 1-2 天精神食欲，异常及时联系兽医。具体方案以兽医评估为准。"),
            new KnowledgeEntry("绝育", new String[]{"绝育", "结扎", "发情", "要不要绝育", "绝育后"},
                    "绝育的意义：①显著降低生殖系统疾病风险（子宫蓄脓、乳腺肿瘤、睾丸疾病等）；②减少发情期走失、打斗、标记行为；"
                            + "③从源头减少流浪动物。一般建议 6 月龄左右、身体健康时进行，术前禁食禁水遵医嘱。"
                            + "术后护理：戴好伊丽莎白圈防舔舐、保持伤口干燥、限制剧烈运动 7-10 天，绝育后代谢下降注意控制体重。"),
            new KnowledgeEntry("适应新家", new String[]{"适应", "新家", "刚领养", "刚到家", "躲", "应激", "不吃", "害怕", "过渡"},
                    "帮助新动物适应：①先安排一个安静的小空间（备好水、粮、猫砂盆/尿垫），不要急于全屋放养；"
                            + "②头几天减少打扰，让它主动探索和靠近，躲藏、食欲下降是正常应激，一般 3-7 天缓解；"
                            + "③沿用救助方的原有食物，稳定后再换；④猫至少封窗后再接回家；狗初期外出必须牵引；"
                            + "⑤若超过 48 小时完全不吃不喝、或伴随呕吐腹泻，及时就医。多点耐心，信任需要时间。"),
            new KnowledgeEntry("幼年照顾", new String[]{"幼猫", "幼犬", "小猫", "小狗", "奶猫", "奶狗", "多大", "断奶"},
                    "幼年动物照顾：①未断奶（约 4 周内）需宠物专用奶粉，2-4 小时喂一次并协助排便，注意保暖；"
                            + "②4-8 周逐步过渡到泡软的幼粮；③2 月龄起安排首针疫苗与驱虫；"
                            + "④幼猫幼犬好奇心强，收好电线、细绳、药品和有毒植物（百合对猫剧毒）；"
                            + "⑤社会化黄金期在 3-14 周，多温和接触人和环境，成年后性格更稳定。"),
            new KnowledgeEntry("老年照顾", new String[]{"老年", "老猫", "老狗", "高龄", "岁数大"},
                    "老年动物（猫狗约 7-8 岁起）照顾：①每半年到一年做一次体检（血检+尿检），慢性病早发现；"
                            + "②换成老年配方粮，控制体重减轻关节负担；③提供低处的窝和猫砂盆，减少跳跃；"
                            + "④关注饮水量和排尿变化（肾病高发）、口腔异味（牙病）；⑤运动量下降是正常的，但突然嗜睡、拒食要就医。"),
            new KnowledgeEntry("疾病征兆", new String[]{"生病", "征兆", "症状", "呕吐", "腹泻", "拉稀", "咳嗽", "打喷嚏", "没精神", "不吃饭", "异常"},
                    "需要警惕的信号：①持续 24 小时以上拒食拒水；②反复呕吐或腹泻（尤其带血）；③呼吸急促、持续咳嗽或张口呼吸（猫张口呼吸属急症）；"
                            + "④排尿困难或频繁进出猫砂盆无尿（公猫尿闭是急症，数小时可致命）；⑤精神萎靡、躲藏、对互动无反应；"
                            + "⑥牙龈发白或发黄。出现以上情况请尽快就医，本助手不能替代兽医诊断。"),
            new KnowledgeEntry("应急处理", new String[]{"误食", "中毒", "受伤", "流血", "骨折", "急救", "车祸", "烫伤"},
                    "应急原则：①误食可疑物（药品、巧克力、老鼠药等）：记下名称和大致量，立即联系兽医，不要自行催吐；"
                            + "②外伤流血：干净纱布按压止血后就医，勿涂人用药膏；③疑似骨折：尽量限制活动，用硬板或航空箱平稳转运；"
                            + "④中暑：移到阴凉处，用常温水打湿身体（不要冰水），尽快就医。平时存好最近的 24 小时宠物医院电话。"),
            new KnowledgeEntry("行为问题", new String[]{"乱尿", "拆家", "叫", "咬人", "抓沙发", "行为", "训练", "磨爪", "吠"},
                    "常见行为问题：①猫乱尿先排除泌尿疾病，再检查猫砂盆数量（N+1 原则）、清洁度和摆放位置；绝育可减少标记行为；"
                            + "②狗拆家多因精力过剩或分离焦虑，保证每天足量运动和陪伴，外出前给予耐咬玩具；"
                            + "③磨爪是猫的天性，提供猫抓板并放在它常抓的位置附近；④纠正行为用正向奖励（零食表扬），打骂只会破坏信任。"),
            new KnowledgeEntry("洗护清洁", new String[]{"洗澡", "洗护", "梳毛", "掉毛", "指甲", "耳朵", "刷牙", "清洁"},
                    "日常护理：①猫通常无需频繁洗澡（应激大），狗 2-4 周一次并用宠物专用香波；疫苗未打齐的幼年动物先不洗；"
                            + "②长毛每天梳、短毛每周 2-3 次，换毛季加频；③指甲 2-4 周修一次，只剪透明尖端避开血线；"
                            + "④耳朵定期检查，有黑褐色分泌物或异味用洗耳液清理，严重时就医；⑤每周刷牙 2-3 次或使用洁牙零食，预防牙结石。"),
            new KnowledgeEntry("外出安全", new String[]{"遛狗", "外出", "牵引", "走失", "芯片", "项圈", "出门"},
                    "外出与防走失：①狗外出必须牵引，牵引绳是生命绳；胸背带比项圈更不易挣脱；"
                            + "②猫不建议散养，外出请使用航空箱或专用背包；③项圈挂联系方式吊牌，有条件植入芯片；"
                            + "④夏天避开高温时段遛狗（地面烫伤肉垫），冬天短毛犬注意保暖；⑤节假日烟花爆竹声易致应激走失，提前关好门窗。"),
            new KnowledgeEntry("多宠共处", new String[]{"一起养", "第二只", "打架", "多只", "合笼", "相处", "猫和狗"},
                    "多宠引入：①新老动物先隔离，通过气味交换（互换毛巾/垫子）建立熟悉感，一般需要 1-2 周；"
                            + "②初次见面隔着门或围栏短时接触，无敌意再逐步延长；③资源分开：食碗、水碗、猫砂盆、窝都要各自独立；"
                            + "④猫和狗可以和平共处，但要确保猫有狗够不到的高处退路；⑤打架时不要徒手分开，用声音或障碍物打断。"),
            new KnowledgeEntry("领养过渡", new String[]{"领养", "回访", "凭证", "领养后", "退养"},
                    "领养后的过渡期：①按平台要求保持回访联系，遇到困难先与工作人员沟通，不要擅自转送或遗弃；"
                            + "②给彼此至少 2-4 周磨合期，大部分「不亲人」都会随信任建立而改善；"
                            + "③按时完成疫苗驱虫并保留凭证，平台审核需要；④若确实无法继续饲养，请联系平台协商妥善安置，这才是对它负责的方式。")
    ));

    /** 关键词加权匹配：命中越多、关键词越长得分越高；全不命中返回 null。 */
    KnowledgeEntry bestMatch(String question) {
        String q = question.toLowerCase();
        KnowledgeEntry best = null;
        int bestScore = 0;
        for (KnowledgeEntry entry : KNOWLEDGE) {
            int score = 0;
            for (String keyword : entry.keywords) {
                if (q.contains(keyword)) {
                    score += keyword.length() >= 2 ? keyword.length() : 1;
                }
            }
            if (score > bestScore) {
                bestScore = score;
                best = entry;
            }
        }
        return best;
    }

    private String fallbackAnswer() {
        StringBuilder sb = new StringBuilder("这个问题我还没有现成的答案。你可以换个方式问，或从这些话题里选择：");
        for (int i = 0; i < KNOWLEDGE.size(); i++) {
            if (i > 0) sb.append("、");
            sb.append(KNOWLEDGE.get(i).topic);
        }
        sb.append("。如涉及动物健康异常，请直接咨询兽医。");
        return sb.toString();
    }

    // ==================== 可选 LLM 增强 ====================

    private static final String SYSTEM_PROMPT =
            "你是流浪动物救助平台「归途计划」的动物照顾助手。只回答与猫、狗等伴侣动物的日常照顾、喂养、健康护理、"
                    + "行为习惯、领养适应相关的问题；与此无关的问题请礼貌说明只能解答动物照顾话题。"
                    + "你可以调用工具查询当前登录用户自己的领养申请、回访记录、义工状态和动物档案——"
                    + "当用户的问题涉及「我的动物」「我领养的」等具体情况时，应先查询再给出针对该动物"
                    + "（品种、年龄、状态）的具体建议，而不是泛泛而谈。若工具返回 count 为 0，"
                    + "说明用户还没有相关记录，据实说明并给出通用建议。"
                    + "回答用中文，简洁分点，控制在 300 字以内。涉及疾病症状时必须提醒「不能替代兽医诊断，异常请及时就医」。";

    /**
     * ===== agent 循环（本类的核心）=====
     *
     * 一次 ask 可能触发多次 LLM 调用，这正是 agent 与"单轮补全"的分界：
     *
     * <pre>
     *   messages = [system, ...history, user]
     *   循环（至多 maxToolRounds 轮）：
     *     (1) POST /chat/completions（带 tools 声明）
     *     (2) 模型返回两种可能：
     *         a. tool_calls 非空 → 它想查数据
     *            → 服务端执行工具（身份注入、只读、鉴权）
     *            → 把 assistant(tool_calls) 与每个 tool 结果 append 进 messages
     *            → 回到 (1)，让模型带着数据继续推理
     *         b. 返回 content → 这是最终回答，退出循环
     *   超过轮次上限仍未收敛 → 返回 null，由调用方降级到知识库
     * </pre>
     *
     * 关键点：<b>messages 是唯一的状态载体</b>。模型本身无记忆，
     * 它每轮看到的是我们累积起来的完整对话（含它自己上一轮的工具调用和结果），
     * "连续推理"的错觉就来自这个不断增长的数组。
     */
    private AgentResult runAgentLoop(Long userId, String question, List<ChatTurn> history) {
        try {
            JSONArray messages = new JSONArray();
            messages.add(msg("system", SYSTEM_PROMPT));
            appendHistory(messages, history);
            messages.add(msg("user", question));

            JSONArray toolSpecs = petCareTools.toolSpecs();
            List<String> toolsUsed = new ArrayList<>();

            for (int round = 0; round <= maxToolRounds; round++) {
                // 最后一轮不再给工具，强制模型用已有信息作答（避免"想查但没机会"而空转）
                boolean allowTools = round < maxToolRounds;
                JSONObject choice = callLlm(messages, allowTools ? toolSpecs : null);
                if (choice == null) {
                    return null;
                }
                JSONObject message = choice.getJSONObject("message");
                if (message == null) {
                    return null;
                }
                JSONArray toolCalls = message.getJSONArray("tool_calls");

                if (toolCalls == null || toolCalls.isEmpty()) {
                    // 分支 b：模型给出最终回答
                    String content = message.getStr("content");
                    return content == null ? null : new AgentResult(content, toolsUsed);
                }

                // 分支 a：模型要调工具。先把它的决策原样放回 messages（协议要求）
                messages.add(message);
                for (int i = 0; i < toolCalls.size(); i++) {
                    JSONObject call = toolCalls.getJSONObject(i);
                    JSONObject fn = call.getJSONObject("function");
                    String name = fn == null ? "" : fn.getStr("name");
                    JSONObject args = parseArgs(fn == null ? null : fn.getStr("arguments"));

                    // 身份从服务端注入：模型只说"查哪个工具"，查谁由我们决定
                    String result = petCareTools.execute(userId, name, args);
                    toolsUsed.add(name);
                    log.debug("照顾助手 agent 调用工具 {}，返回 {} 字节", name, result.length());

                    JSONObject toolMsg = new JSONObject();
                    toolMsg.set("role", "tool");
                    toolMsg.set("tool_call_id", call.getStr("id"));
                    toolMsg.set("name", name);
                    toolMsg.set("content", result);
                    messages.add(toolMsg);
                }
                // 继续下一轮：模型这次能看到工具返回的真实数据
            }
            return null;
        } catch (Exception e) {
            log.warn("照顾助手 agent 循环失败，降级到知识库: {}", e.getMessage());
            return null;
        }
    }

    /** 单次 LLM 调用，返回 choices[0]；任何非 200/异常都返回 null 交由上层降级。 */
    private JSONObject callLlm(JSONArray messages, JSONArray toolSpecs) {
        try {
            JSONObject payload = new JSONObject();
            payload.set("model", aiModel);
            payload.set("messages", messages);
            payload.set("max_tokens", 700);
            if (toolSpecs != null && !toolSpecs.isEmpty()) {
                payload.set("tools", toolSpecs);
                payload.set("tool_choice", "auto");
            }
            String endpoint = aiBaseUrl.trim().replaceAll("/+$", "") + "/chat/completions";
            HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create(endpoint))
                    .timeout(Duration.ofMillis(aiTimeoutMs))
                    .header("Content-Type", "application/json")
                    .header("Authorization", "Bearer " + aiApiKey.trim())
                    .POST(HttpRequest.BodyPublishers.ofString(JSONUtil.toJsonStr(payload), StandardCharsets.UTF_8))
                    .build();
            HttpClient client = HttpClient.newBuilder()
                    .connectTimeout(Duration.ofMillis(Math.min(aiTimeoutMs, 5000)))
                    .build();
            HttpResponse<String> response = client.send(request,
                    HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
            if (response.statusCode() != 200) {
                log.warn("AI 服务返回非 200：{}", response.statusCode());
                return null;
            }
            JSONArray choices = JSONUtil.parseObj(response.body()).getJSONArray("choices");
            return choices == null || choices.isEmpty() ? null : choices.getJSONObject(0);
        } catch (Exception e) {
            log.warn("AI 服务调用失败: {}", e.getMessage());
            return null;
        }
    }

    private JSONObject msg(String role, String content) {
        return new JSONObject().set("role", role).set("content", content);
    }

    /** 只取最近 maxHistory 条历史，且逐条限长——历史无限增长会推高成本并挤掉工具结果。 */
    private void appendHistory(JSONArray messages, List<ChatTurn> history) {
        if (history == null || history.isEmpty()) {
            return;
        }
        int from = Math.max(0, history.size() - maxHistory);
        for (int i = from; i < history.size(); i++) {
            ChatTurn turn = history.get(i);
            if (turn == null || turn.getText() == null || turn.getText().trim().isEmpty()) {
                continue;
            }
            String role = "assistant".equals(turn.getRole()) ? "assistant" : "user";
            String text = turn.getText().length() > 800 ? turn.getText().substring(0, 800) : turn.getText();
            messages.add(msg(role, text));
        }
    }

    private JSONObject parseArgs(String raw) {
        if (raw == null || raw.trim().isEmpty()) {
            return new JSONObject();
        }
        try {
            return JSONUtil.parseObj(raw);
        } catch (Exception e) {
            // 模型偶尔生成不合法 JSON；返回空参数让工具层给出 bad_argument，模型可自行重试
            return new JSONObject();
        }
    }

    /** agent 循环的内部结果：最终回答 + 本次实际调用过的工具名（前端展示与可观测性）。 */
    private static final class AgentResult {
        final String answer;
        final List<String> toolsUsed;

        AgentResult(String answer, List<String> toolsUsed) {
            this.answer = answer;
            this.toolsUsed = toolsUsed;
        }
    }

    /** 前端传来的一轮历史对话。 */
    public static final class ChatTurn {
        private String role;
        private String text;

        public String getRole() { return role; }
        public void setRole(String role) { this.role = role; }
        public String getText() { return text; }
        public void setText(String text) { this.text = text; }
    }

    // ==================== 限流 ====================

    private void checkRateLimit(Long userId) {
        if (askTimestamps.size() >= RATE_MAP_MAX_USERS) {
            askTimestamps.clear();
        }
        Deque<Long> window = askTimestamps.computeIfAbsent(userId, k -> new ArrayDeque<>());
        long now = System.currentTimeMillis();
        synchronized (window) {
            while (!window.isEmpty() && now - window.peekFirst() > 60_000) {
                window.pollFirst();
            }
            if (window.size() >= RATE_LIMIT_PER_MINUTE) {
                throw new CustomException("429", "提问太频繁了，请稍等一分钟再试");
            }
            window.addLast(now);
        }
    }

    // 测试用注入口
    void setAiEnabled(boolean aiEnabled) { this.aiEnabled = aiEnabled; }
    void setAiBaseUrl(String aiBaseUrl) { this.aiBaseUrl = aiBaseUrl; }
    void setAiApiKey(String aiApiKey) { this.aiApiKey = aiApiKey; }

    /** 问答结果。 */
    public static final class PetCareAnswer {
        private final String answer;
        private final String source;
        private final String topic;
        private final List<String> toolsUsed;

        public PetCareAnswer(String answer, String source, String topic) {
            this(answer, source, topic, java.util.Collections.emptyList());
        }

        public PetCareAnswer(String answer, String source, String topic, List<String> toolsUsed) {
            this.answer = answer;
            this.source = source;
            this.topic = topic;
            this.toolsUsed = toolsUsed == null ? java.util.Collections.emptyList() : toolsUsed;
        }

        public String getAnswer() { return answer; }
        public String getSource() { return source; }
        public String getTopic() { return topic; }
        /** 本次回答实际查询过的工具名，前端可展示「已查询你的领养记录」增强可信度。 */
        public List<String> getToolsUsed() { return toolsUsed; }
    }
}
