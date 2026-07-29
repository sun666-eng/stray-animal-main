package com.example.service;

import cn.hutool.json.JSONArray;
import cn.hutool.json.JSONObject;
import cn.hutool.json.JSONUtil;
import com.example.common.PermissionUtil;
import com.example.common.RoleAssignmentPolicy;
import com.example.entity.User;
import lombok.extern.slf4j.Slf4j;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 管理员 Agent 的只读工具箱。模型不能传 actorId，权限由服务端会话注入。
 */
@Slf4j
@Component
public class AdminAgentTools {

    private static final int MAX_ROWS = 8;
    private final JdbcTemplate jdbcTemplate;

    public AdminAgentTools(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    public JSONArray toolSpecs() {
        JSONArray tools = new JSONArray();
        tools.add(tool("get_management_overview",
                "读取当前管理员有权查看模块的待办数量和运营概览。回答今天有哪些待办、工作台概况时先调用。",
                objectSchema()));
        tools.add(tool("list_pending_adoptions",
                "列出最近待审核的领养申请，返回申请人编号、动物编号和去除联系方式后的问卷摘要。需要 adopt 权限。",
                objectSchema()));
        tools.add(tool("get_adoption_review_context",
                "按动物编号和申请人编号取得一份领养申请的审核上下文，用于生成审核建议。需要 adopt 权限。",
                new JSONObject().set("type", "object")
                        .set("properties", new JSONObject()
                                .set("animal_id", integer("动物编号"))
                                .set("applicant_id", integer("申请人编号")))
                        .set("required", new JSONArray().set("animal_id").set("applicant_id"))));
        tools.add(tool("list_pending_volunteers",
                "列出待审核义工申请的去隐私摘要。需要 volunteer 权限。",
                objectSchema()));
        tools.add(tool("list_open_rescues",
                "列出尚未完成的救助请求，返回标题、描述摘要和状态，不向外部模型发送电话或精确地点。需要 help 或 rescue 权限。",
                objectSchema()));
        tools.add(tool("list_pending_proofs",
                "列出待审核领养凭证，只返回记录、动物和提交人编号以及材料标题，不读取私有图片。需要 proof 权限。",
                objectSchema()));
        tools.add(tool("get_data_quality_summary",
                "统计动物档案中缺失图片、描述、生日和异常状态的数据质量问题。需要 animal 权限。",
                objectSchema()));
        tools.add(tool("get_operations_work_summary",
                "读取统一待办按业务类型和优先级汇总的只读数据。适合回答当前运营压力和优先处理事项。",
                objectSchema()));
        tools.add(tool("get_volunteer_task_summary",
                "读取义工任务、报名、已完成服务和累计服务分钟的汇总。需要 volunteer 权限。",
                objectSchema()));
        tools.add(tool("get_medical_record_summary",
                "读取动物医疗档案按记录类型的汇总，不返回私密病历正文。需要 animal 权限。",
                objectSchema()));
        return tools;
    }

    public JSONObject overview(User actor) {
        JSONObject result = new JSONObject();
        result.set("read_only", true);
        putCount(result, actor, "animal", "available_animals",
                "SELECT COUNT(*) FROM t_animal WHERE tstate=0");
        putCount(result, actor, "adopt", "pending_adoptions",
                "SELECT COUNT(*) FROM t_adopt WHERE vstate=0");
        putCount(result, actor, "proof", "pending_proofs",
                "SELECT COUNT(*) FROM t_proof WHERE pstatus=0");
        putCount(result, actor, "volunteer", "pending_volunteers",
                "SELECT COUNT(*) FROM t_volunteer WHERE vstate=0");
        if (hasAny(actor, "help", "rescue")) {
            result.set("open_rescues", count("SELECT COUNT(*) FROM t_help WHERE title<>'聊天室消息' AND COALESCE(status,0) IN (0,1)"));
        } else {
            result.set("open_rescues", null);
        }
        if (hasAny(actor, "adopt", "proof", "visit", "help", "rescue", "volunteer", "animal", "account")) {
            result.set("open_work_items", count("SELECT COUNT(*) FROM t_work_item WHERE status<>2"));
        } else {
            result.set("open_work_items", null);
        }
        return result;
    }

    public String execute(User actor, String name, JSONObject arguments) {
        try {
            switch (name == null ? "" : name) {
                case "get_management_overview": return overview(actor).toString();
                case "list_pending_adoptions": return pendingAdoptions(actor).toString();
                case "get_adoption_review_context": return adoptionContext(actor, arguments).toString();
                case "list_pending_volunteers": return pendingVolunteers(actor).toString();
                case "list_open_rescues": return openRescues(actor).toString();
                case "list_pending_proofs": return pendingProofs(actor).toString();
                case "get_data_quality_summary": return dataQuality(actor).toString();
                case "get_operations_work_summary": return workSummary(actor).toString();
                case "get_volunteer_task_summary": return volunteerTaskSummary(actor).toString();
                case "get_medical_record_summary": return medicalSummary(actor).toString();
                default: return error("unknown_tool", "未知的管理员工具").toString();
            }
        } catch (Exception ex) {
            log.warn("管理员 Agent 工具失败 name={} type={}", name, ex.getClass().getSimpleName());
            return error("tool_failed", "数据暂时无法读取，请提示管理员稍后重试").toString();
        }
    }

    /**
     * 3A 审核草稿专用最小化上下文。主动排除联系方式、住址、性别、婚姻、职业和收入，
     * 避免模型基于与动物福利无直接关系的个人属性给出建议。
     */
    public JSONObject adoptionDraftContext(User actor, Long animalId, Long applicantId) {
        JSONObject raw = adoptionContext(actor, new JSONObject()
                .set("animal_id", animalId).set("applicant_id", applicantId));
        if (raw.containsKey("error")) return raw;
        JSONObject source = raw.getJSONObject("untrusted_business_data");
        if (source == null) return error("tool_failed", "申请上下文格式无效");
        Integer age = source.getInt("age");
        JSONObject minimized = new JSONObject()
                .set("animal_id", source.get("animal_id"))
                .set("applicant_id", source.get("applicant_id"))
                .set("application_state", source.get("vstate"))
                .set("adult_confirmed", age != null && age >= 18)
                .set("fixed_residence", source.get("fixresident"))
                .set("pet_care_experience", source.get("experience"))
                .set("current_pet_count", source.get("petnum"))
                .set("household_agreement", source.get("familyagree"))
                .set("previous_applications", source.get("applicant_previous_applications"))
                .set("approved_applications", source.get("applicant_approved_applications"))
                .set("pending_applications_for_animal", count(
                        "SELECT COUNT(*) FROM t_adopt WHERE aid=" + animalId + " AND vstate=0"))
                .set("animal_name", source.get("aname"))
                .set("animal_type", source.get("animal_type"))
                .set("animal_sex", source.get("animal_sex"))
                .set("animal_birthday", source.get("animal_birthday"))
                .set("animal_status", source.get("animal_status"))
                .set("animal_description", source.get("animal_description"));
        return new JSONObject().set("read_only", true)
                .set("privacy_minimized", true)
                .set("untrusted_business_data", minimized);
    }

    /** 3C 候选只返回复合主键；完整去隐私上下文必须逐条重新读取。 */
    public List<AutomationCandidate> automationCandidates(User actor, int limit) {
        if (actor == null || !RoleAssignmentPolicy.hasRoleId(actor, RoleAssignmentPolicy.SUPER_ADMIN_ROLE_ID)) {
            throw new com.example.exception.CustomException("403", "3C 自动审核候选仅超级管理员可读取");
        }
        int safeLimit = Math.max(1, Math.min(limit, 3));
        return jdbcTemplate.query("SELECT aid,uid FROM t_adopt WHERE vstate=0 ORDER BY aid,uid LIMIT " + safeLimit,
                (rs, i) -> new AutomationCandidate(rs.getLong("aid"), rs.getLong("uid")));
    }

    public static final class AutomationCandidate {
        private final Long animalId;
        private final Long applicantId;
        AutomationCandidate(Long animalId, Long applicantId) {
            this.animalId = animalId; this.applicantId = applicantId;
        }
        public Long getAnimalId() { return animalId; }
        public Long getApplicantId() { return applicantId; }
    }

    private JSONObject pendingAdoptions(User actor) {
        if (!has(actor, "adopt")) return denied("adopt");
        List<Map<String, Object>> rows = jdbcTemplate.queryForList(
                "SELECT aid, uid, age, gender, maritalstatus, occupation, fixresident, income, "
                        + "experience, petnum, familyagree, aname FROM t_adopt "
                        + "WHERE vstate=0 ORDER BY aid DESC, uid DESC LIMIT " + MAX_ROWS);
        JSONArray items = new JSONArray();
        for (Map<String, Object> row : rows) {
            JSONObject item = fromRow(row);
            Object income = item.get("income");
            item.set("income_band", incomeBand(income));
            item.remove("income");
            items.add(item);
        }
        return collection("pending_adoptions", items);
    }

    private JSONObject adoptionContext(User actor, JSONObject args) {
        if (!has(actor, "adopt")) return denied("adopt");
        Long animalId = args == null ? null : args.getLong("animal_id");
        Long applicantId = args == null ? null : args.getLong("applicant_id");
        if (animalId == null || applicantId == null || animalId <= 0 || applicantId <= 0) {
            return error("bad_argument", "animal_id 和 applicant_id 必须是正整数");
        }
        List<Map<String, Object>> rows = jdbcTemplate.queryForList(
                "SELECT a.aid AS animal_id, a.uid AS applicant_id, a.age, a.gender, "
                        + "a.maritalstatus, a.occupation, a.fixresident, a.income, a.experience, "
                        + "a.petnum, a.familyagree, a.vstate, a.aname, t.ttype AS animal_type, "
                        + "t.tsex AS animal_sex, t.tbirthday AS animal_birthday, t.tstate AS animal_status, "
                        + "t.tdescribe AS animal_description FROM t_adopt a "
                        + "LEFT JOIN t_animal t ON t.id=a.aid WHERE a.aid=? AND a.uid=? LIMIT 1",
                animalId, applicantId);
        if (rows.isEmpty()) return error("not_found", "没有找到该领养申请");
        JSONObject item = fromRow(rows.get(0));
        Object income = item.get("income");
        item.set("income_band", incomeBand(income));
        item.remove("income");
        item.set("applicant_previous_applications", count(
                "SELECT COUNT(*) FROM t_adopt WHERE uid=" + applicantId));
        item.set("applicant_approved_applications", count(
                "SELECT COUNT(*) FROM t_adopt WHERE uid=" + applicantId + " AND vstate=1"));
        return new JSONObject().set("read_only", true).set("untrusted_business_data", item);
    }

    private JSONObject pendingVolunteers(User actor) {
        if (!has(actor, "volunteer")) return denied("volunteer");
        List<Map<String, Object>> rows = jdbcTemplate.queryForList(
                "SELECT id AS application_id, uid AS applicant_id, age, company, isvisit, "
                        + "sparetime, moreability FROM t_volunteer WHERE vstate=0 ORDER BY id DESC LIMIT " + MAX_ROWS);
        return collection("pending_volunteers", toArray(rows));
    }

    private JSONObject openRescues(User actor) {
        if (!hasAny(actor, "help", "rescue")) return denied("help_or_rescue");
        List<Map<String, Object>> rows = jdbcTemplate.queryForList(
                "SELECT id AS rescue_id, uid AS reporter_id, title, "
                        + "LEFT(description,300) AS description, "
                        + "status, create_time FROM t_help WHERE title<>'聊天室消息' "
                        + "AND COALESCE(status,0) IN (0,1) ORDER BY create_time DESC, id DESC LIMIT " + MAX_ROWS);
        return collection("open_rescues", toArray(rows));
    }

    private JSONObject pendingProofs(User actor) {
        if (!has(actor, "proof")) return denied("proof");
        List<Map<String, Object>> rows = jdbcTemplate.queryForList(
                "SELECT id AS proof_id, paid AS animal_id, puid AS applicant_id, aname AS animal_name, "
                        + "ptitle AS material_title FROM t_proof WHERE pstatus=0 ORDER BY id DESC LIMIT " + MAX_ROWS);
        return collection("pending_proofs", toArray(rows));
    }

    private JSONObject dataQuality(User actor) {
        if (!has(actor, "animal")) return denied("animal");
        JSONObject result = new JSONObject();
        result.set("read_only", true);
        result.set("missing_image", count("SELECT COUNT(*) FROM t_animal WHERE tpic IS NULL OR TRIM(tpic)=''"));
        result.set("missing_description", count("SELECT COUNT(*) FROM t_animal WHERE tdescribe IS NULL OR TRIM(tdescribe)=''"));
        result.set("missing_birthday", count("SELECT COUNT(*) FROM t_animal WHERE tbirthday IS NULL"));
        result.set("invalid_status", count("SELECT COUNT(*) FROM t_animal WHERE tstate IS NULL OR tstate NOT IN (0,1,2)"));
        return result;
    }

    private JSONObject workSummary(User actor) {
        if (!hasAny(actor, "adopt", "proof", "visit", "help", "rescue", "volunteer", "animal", "account")) {
            return denied("operations");
        }
        List<Map<String, Object>> rows = jdbcTemplate.queryForList(
                "SELECT business_type,COUNT(*) open_count,SUM(CASE WHEN priority>=2 THEN 1 ELSE 0 END) urgent_count "
                        + "FROM t_work_item WHERE status<>2 GROUP BY business_type ORDER BY urgent_count DESC,open_count DESC");
        return collection("operations_work_summary", toArray(rows));
    }

    private JSONObject volunteerTaskSummary(User actor) {
        if (!has(actor, "volunteer")) return denied("volunteer");
        JSONObject result = new JSONObject().set("read_only", true);
        result.set("recruiting_tasks", count("SELECT COUNT(*) FROM t_volunteer_task WHERE status=1"));
        result.set("pending_signups", count("SELECT COUNT(*) FROM t_volunteer_signup WHERE status=0"));
        result.set("assigned_signups", count("SELECT COUNT(*) FROM t_volunteer_signup WHERE status=1"));
        result.set("completed_services", count("SELECT COUNT(*) FROM t_volunteer_service_record"));
        result.set("service_minutes", count("SELECT COALESCE(SUM(service_minutes),0) FROM t_volunteer_service_record"));
        return result;
    }

    private JSONObject medicalSummary(User actor) {
        if (!has(actor, "animal")) return denied("animal");
        List<Map<String, Object>> rows = jdbcTemplate.queryForList(
                "SELECT record_type,COUNT(*) record_count,COUNT(DISTINCT animal_id) animal_count "
                        + "FROM t_animal_medical_record GROUP BY record_type ORDER BY record_count DESC");
        return collection("medical_record_summary", toArray(rows));
    }

    private void putCount(JSONObject target, User actor, String flag, String key, String sql) {
        target.set(key, has(actor, flag) ? count(sql) : null);
    }

    private long count(String sql) {
        Long value = jdbcTemplate.queryForObject(sql, Long.class);
        return value == null ? 0L : value;
    }

    private boolean has(User actor, String flag) {
        return RoleAssignmentPolicy.hasRoleId(actor, RoleAssignmentPolicy.SUPER_ADMIN_ROLE_ID)
                || PermissionUtil.hasFlag(actor, flag);
    }

    private boolean hasAny(User actor, String... flags) {
        for (String flag : flags) if (has(actor, flag)) return true;
        return false;
    }

    private JSONObject tool(String name, String description, JSONObject parameters) {
        return new JSONObject().set("type", "function").set("function", new JSONObject()
                .set("name", name).set("description", description).set("parameters", parameters));
    }

    private JSONObject objectSchema() {
        return new JSONObject().set("type", "object").set("properties", new JSONObject());
    }

    private JSONObject integer(String description) {
        return new JSONObject().set("type", "integer").set("description", description).set("minimum", 1);
    }

    private JSONObject collection(String name, JSONArray items) {
        return new JSONObject().set("read_only", true).set("collection", name)
                .set("count", items.size()).set("untrusted_business_data", items);
    }

    private JSONObject denied(String required) {
        return error("permission_denied", "当前管理员缺少 " + required + " 模块权限");
    }

    private JSONObject error(String code, String message) {
        return new JSONObject().set("error", code).set("message", message);
    }

    private JSONArray toArray(List<Map<String, Object>> rows) {
        JSONArray result = new JSONArray();
        for (Map<String, Object> row : rows) result.add(fromRow(row));
        return result;
    }

    private JSONObject fromRow(Map<String, Object> row) {
        Map<String, Object> ordered = new LinkedHashMap<>();
        for (Map.Entry<String, Object> entry : row.entrySet()) {
            Object value = entry.getValue();
            ordered.put(entry.getKey().toLowerCase(), value instanceof String
                    ? redactSensitiveText((String) value) : value);
        }
        return JSONUtil.parseObj(ordered);
    }

    /**
     * 自由文本中也可能夹带联系方式；即使专用电话/地址列没有查询，也必须在发往外部模型前脱敏。
     */
    private String redactSensitiveText(String value) {
        if (value == null || value.isEmpty()) return value;
        return value
                .replaceAll("(?<!\\d)1[3-9]\\d{9}(?!\\d)", "[手机号已隐藏]")
                .replaceAll("(?i)[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}", "[邮箱已隐藏]")
                .replaceAll("(?i)\\bsk-[A-Za-z0-9_-]{8,}\\b", "[密钥已隐藏]")
                .replaceAll("(?i)(微信|wechat|wx)\\s*[:：]?\\s*[A-Za-z0-9_-]{4,}", "$1：[已隐藏]");
    }

    private String incomeBand(Object value) {
        if (!(value instanceof Number)) return "未填写";
        long income = ((Number) value).longValue();
        if (income < 3000) return "3000以下";
        if (income < 6000) return "3000-5999";
        if (income < 10000) return "6000-9999";
        return "10000以上";
    }
}
