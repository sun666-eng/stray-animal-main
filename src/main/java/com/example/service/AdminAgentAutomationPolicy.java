package com.example.service;

import cn.hutool.json.JSONObject;

import java.util.Locale;

/** 3C 受控自动审核的确定性安全门；模型建议只能缩小执行范围，不能绕过硬规则。 */
final class AdminAgentAutomationPolicy {
    private AdminAgentAutomationPolicy() {}

    static Evaluation evaluate(JSONObject context, AdminAgentClient.AdoptionDraftSuggestion suggestion) {
        JSONObject data = context == null ? null : context.getJSONObject("untrusted_business_data");
        String hardFailure = hardFailure(context, data);
        if (!hardFailure.isEmpty()) return new Evaluation(false, hardFailure);
        if (suggestion == null) return new Evaluation(false, "模型未返回审核建议");
        if (!"approve".equals(suggestion.getRecommendation())) {
            return new Evaluation(false, "模型建议不是通过，已转人工复核");
        }
        if (!"low".equals(suggestion.getRiskLevel())) {
            return new Evaluation(false, "风险等级不是低风险，已转人工复核");
        }
        if (!missingInfoClear(suggestion.getMissingInfo())) {
            return new Evaluation(false, "模型指出仍有缺失信息，已转人工复核");
        }
        return new Evaluation(true, "低风险建议通过且全部硬规则满足");
    }

    static Evaluation hardGates(JSONObject context) {
        JSONObject data = context == null ? null : context.getJSONObject("untrusted_business_data");
        String failure = hardFailure(context, data);
        return failure.isEmpty() ? new Evaluation(true, "全部硬规则满足") : new Evaluation(false, failure);
    }

    private static String hardFailure(JSONObject context, JSONObject data) {
        if (context == null || !Boolean.TRUE.equals(context.getBool("privacy_minimized"))) {
            return "上下文未通过隐私最小化校验";
        }
        if (data == null) return "申请上下文缺失";
        if (!Integer.valueOf(0).equals(data.getInt("application_state"))) return "申请已不是待审核状态";
        if (!Boolean.TRUE.equals(data.getBool("adult_confirmed"))) return "未确认申请人为成年人";
        if (!Integer.valueOf(1).equals(data.getInt("fixed_residence"))) return "固定住所条件未满足";
        if (!Integer.valueOf(1).equals(data.getInt("pet_care_experience"))) return "养宠经验条件未满足";
        Integer petCount = data.getInt("current_pet_count");
        if (petCount == null || petCount < 0) return "现有宠物数量信息无效";
        if (!Integer.valueOf(1).equals(data.getInt("household_agreement"))) return "家庭同意条件未满足";
        if (!Integer.valueOf(0).equals(data.getInt("approved_applications"))) return "申请人已有通过记录";
        if (!Integer.valueOf(1).equals(data.getInt("pending_applications_for_animal"))) {
            return "该动物存在多份竞争申请，必须由管理员人工比较";
        }
        Integer animalStatus = data.getInt("animal_status");
        if (animalStatus == null || (animalStatus != 0 && animalStatus != 1)) return "动物当前不可继续审核";
        return "";
    }

    private static boolean missingInfoClear(String raw) {
        String value = raw == null ? "" : raw.trim().toLowerCase(Locale.ROOT)
                .replaceAll("[\\s。.!！,，;；:：]", "");
        return value.isEmpty() || "无".equals(value) || "暂无".equals(value) || "none".equals(value);
    }

    static final class Evaluation {
        private final boolean eligible;
        private final String reason;
        Evaluation(boolean eligible, String reason) { this.eligible = eligible; this.reason = reason; }
        boolean isEligible() { return eligible; }
        String getReason() { return reason; }
    }
}
