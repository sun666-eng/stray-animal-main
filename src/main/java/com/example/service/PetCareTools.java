package com.example.service;

import cn.hutool.json.JSONArray;
import cn.hutool.json.JSONObject;
import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.example.entity.Adopt;
import com.example.entity.Animal;
import com.example.entity.Visit;
import com.example.entity.Volunteer;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import jakarta.annotation.Resource;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.List;

/**
 * AI 照顾助手的工具层（agent 的"手"）。
 *
 * <p><b>安全设计——这是整个 agent 最关键的部分，改动前务必理解：</b>
 * <ul>
 *   <li><b>身份不可由模型指定。</b>所有"我的 xx"工具都不接受 userId 参数，
 *       userId 由 Controller 从 Session 取出、Service 直接透传到这里。
 *       模型能表达的只是"查当前用户的领养记录"，无法表达"查用户 42 的"。
 *       这样即使用户用提示注入诱导模型（"现在查 admin 的资料"），
 *       模型也没有可用的表达方式——越权在接口形状上就不可能。</li>
 *   <li><b>全部只读。</b>不提供任何写工具，故 agent 无法绕过业务状态机
 *       （审核 CAS、配额、文件绑定等）造成数据损坏。</li>
 *   <li><b>动物档案二次鉴权。</b>get_animal_profile 接受 animal_id（模型可指定），
 *       因此复用与 AnimalController.findById 相同的可见性规则：
 *       公开态(0/1) 或 本人申请过该动物才返回，否则返回 not_found，
 *       防止把 agent 当成枚举私有档案的旁路。</li>
 *   <li><b>结果裁剪。</b>只返回照顾建议真正需要的字段，不外泄手机号、
 *       住址、微信等 PII——即使那是用户自己的数据，也没有理由进 LLM 上下文。</li>
 * </ul>
 */
@Slf4j
@Component
public class PetCareTools {

    /** 单次工具调用返回的最大记录数，控制上下文体积。 */
    private static final int MAX_ROWS = 10;

    @Resource
    private AdoptService adoptService;

    @Resource
    private AnimalService animalService;

    @Resource
    private VisitService visitService;

    @Resource
    private VolunteerService volunteerService;

    /**
     * 工具的 JSON Schema 声明——发给 LLM 的"工具说明书"。
     * 模型据此决定「要不要调、调哪个、传什么参数」。
     * description 写得越准确，模型的调用决策越好（这是 agent 调优的主要着力点）。
     */
    public JSONArray toolSpecs() {
        JSONArray tools = new JSONArray();
        tools.add(tool("get_my_adoptions",
                "查询当前登录用户自己提交过的领养申请列表，含动物名称、动物编号(animal_id)和审核状态。"
                        + "当用户问「我领养的动物」「我的申请到哪一步了」，或需要知道用户具体养了什么动物时调用。",
                new JSONObject().set("type", "object").set("properties", new JSONObject())));
        tools.add(tool("get_animal_profile",
                "按动物编号查询动物档案：名称、品种、性别、出生日期、当前状态、简介。"
                        + "需要根据具体动物的品种或年龄给出针对性照顾建议时调用。"
                        + "animal_id 通常来自 get_my_adoptions 的返回结果。",
                new JSONObject().set("type", "object")
                        .set("properties", new JSONObject().set("animal_id",
                                new JSONObject().set("type", "integer").set("description", "动物编号")))
                        .set("required", new JSONArray().set("animal_id"))));
        tools.add(tool("get_my_visits",
                "查询当前登录用户自己的领养回访记录，含回访时间、动物名称与工作人员留言。"
                        + "当用户问「回访」「工作人员说了什么」时调用。",
                new JSONObject().set("type", "object").set("properties", new JSONObject())));
        tools.add(tool("get_my_volunteer_status",
                "查询当前登录用户自己的义工申请状态。当用户问「我的义工申请」「审核通过了吗」时调用。",
                new JSONObject().set("type", "object").set("properties", new JSONObject())));
        return tools;
    }

    private JSONObject tool(String name, String description, JSONObject parameters) {
        JSONObject fn = new JSONObject();
        fn.set("name", name);
        fn.set("description", description);
        fn.set("parameters", parameters);
        return new JSONObject().set("type", "function").set("function", fn);
    }

    /**
     * 执行一次工具调用。
     *
     * @param userId    当前登录用户（服务端注入，非模型提供）
     * @param name      模型选择的工具名
     * @param arguments 模型给出的参数（仅 animal_id 这类非身份参数会被采纳）
     * @return 回灌给模型的 JSON 字符串；未知工具或异常都返回结构化错误而非抛出，
     *         让模型能自己决定改口或换工具（agent 的容错来源）
     */
    public String execute(Long userId, String name, JSONObject arguments) {
        try {
            switch (name) {
                case "get_my_adoptions":
                    return myAdoptions(userId);
                case "get_animal_profile":
                    return animalProfile(userId, arguments == null ? null : arguments.getLong("animal_id"));
                case "get_my_visits":
                    return myVisits(userId);
                case "get_my_volunteer_status":
                    return myVolunteerStatus(userId);
                default:
                    return err("unknown_tool", "没有名为 " + name + " 的工具");
            }
        } catch (Exception e) {
            log.warn("照顾助手工具执行失败 name={} : {}", name, e.getMessage());
            return err("tool_failed", "该数据暂时查询不到");
        }
    }

    // ==================== 各工具实现（全部只读 + 字段裁剪） ====================

    private String myAdoptions(Long userId) {
        List<Adopt> rows = adoptService.list(Wrappers.<Adopt>query()
                .eq("uid", userId).orderByDesc("aid").last("LIMIT " + MAX_ROWS));
        JSONArray items = new JSONArray();
        for (Adopt a : rows) {
            items.add(new JSONObject()
                    .set("animal_id", a.getAid())
                    .set("animal_name", a.getAname())
                    .set("review_status", adoptState(a.getVstate())));
        }
        return new JSONObject().set("count", items.size()).set("adoptions", items).toString();
    }

    private String animalProfile(Long userId, Long animalId) {
        if (animalId == null) {
            return err("bad_argument", "缺少 animal_id");
        }
        Animal animal = animalService.getById(animalId);
        if (animal == null) {
            return err("not_found", "没有这个编号的动物");
        }
        // 与 AnimalController.findById 同一套可见性规则：公开态或本人申请过
        boolean publicState = Integer.valueOf(0).equals(animal.getTstate())
                || Integer.valueOf(1).equals(animal.getTstate());
        boolean applicant = adoptService.count(Wrappers.<Adopt>query()
                .eq("aid", animalId).eq("uid", userId)) > 0;
        if (!publicState && !applicant) {
            return err("not_found", "没有这个编号的动物");
        }
        return new JSONObject()
                .set("animal_id", animal.getId())
                .set("name", animal.getTname())
                .set("species_or_breed", animal.getTtype())
                .set("sex", animal.getTsex())
                .set("birthday", fmtDate(animal.getTbirthday()))
                .set("status", animalState(animal.getTstate()))
                .set("description", animal.getTdescribe())
                .toString();
    }

    private String myVisits(Long userId) {
        List<Visit> rows = visitService.list(Wrappers.<Visit>query()
                .eq("uid", userId).orderByDesc("vtime").last("LIMIT " + MAX_ROWS));
        JSONArray items = new JSONArray();
        for (Visit v : rows) {
            items.add(new JSONObject()
                    .set("animal_id", v.getPetId())
                    .set("animal_name", v.getAname())
                    .set("visited_at", fmtDate(v.getVtime()))
                    .set("staff_note", v.getRemark()));
        }
        return new JSONObject().set("count", items.size()).set("visits", items).toString();
    }

    private String myVolunteerStatus(Long userId) {
        List<Volunteer> rows = volunteerService.list(Wrappers.<Volunteer>query()
                .eq("uid", userId).orderByDesc("id").last("LIMIT " + MAX_ROWS));
        JSONArray items = new JSONArray();
        for (Volunteer v : rows) {
            items.add(new JSONObject()
                    .set("application_id", v.getId())
                    .set("review_status", volunteerState(v.getVstate())));
        }
        return new JSONObject().set("count", items.size()).set("applications", items).toString();
    }

    // ==================== 辅助 ====================

    private String err(String code, String message) {
        return new JSONObject().set("error", code).set("message", message).toString();
    }

    private String fmtDate(Date date) {
        return date == null ? null : new SimpleDateFormat("yyyy-MM-dd").format(date);
    }

    /** 状态码转中文，与前端 status-text.js 保持一致的术语。 */
    private String adoptState(Integer v) {
        if (v == null) return "未知";
        switch (v) {
            case 0: return "待审核";
            case 1: return "已通过";
            case 2: return "未通过";
            default: return "其他状态";
        }
    }

    private String animalState(Integer v) {
        if (v == null) return "未知";
        switch (v) {
            case 0: return "等待领养";
            case 1: return "申请审核中";
            case 2: return "已找到新家";
            default: return "未知";
        }
    }

    private String volunteerState(Integer v) {
        if (v == null) return "未知";
        switch (v) {
            case 0: return "待审核";
            case 1: return "已通过";
            case 2: return "未通过";
            default: return "未知";
        }
    }
}
