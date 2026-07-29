package com.example.service;

import cn.hutool.json.JSONObject;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class AdminAgentAutomationPolicyTest {
    @Test
    void onlyLowRiskApproveWithNoMissingInformationIsEligible() {
        JSONObject context = eligibleContext();
        assertTrue(AdminAgentAutomationPolicy.evaluate(context,
                suggestion("approve", "low", "无")).isEligible());
        assertFalse(AdminAgentAutomationPolicy.evaluate(context,
                suggestion("reject", "low", "无")).isEligible());
        assertFalse(AdminAgentAutomationPolicy.evaluate(context,
                suggestion("approve", "medium", "无")).isEligible());
        assertFalse(AdminAgentAutomationPolicy.evaluate(context,
                suggestion("approve", "low", "需要补充住房证明")).isEligible());
    }

    @Test
    void protectedOrIncompleteContextsCannotReachTheModelDecisionGate() {
        JSONObject noHome = eligibleContext();
        noHome.getJSONObject("untrusted_business_data").set("fixed_residence", 0);
        assertFalse(AdminAgentAutomationPolicy.hardGates(noHome).isEligible());

        JSONObject notMinimized = eligibleContext().set("privacy_minimized", false);
        assertFalse(AdminAgentAutomationPolicy.hardGates(notMinimized).isEligible());

        JSONObject alreadyApproved = eligibleContext();
        alreadyApproved.getJSONObject("untrusted_business_data").set("approved_applications", 1);
        assertFalse(AdminAgentAutomationPolicy.hardGates(alreadyApproved).isEligible());
    }

    static JSONObject eligibleContext() {
        return new JSONObject().set("privacy_minimized", true).set("read_only", true)
                .set("untrusted_business_data", new JSONObject()
                        .set("application_state", 0).set("adult_confirmed", true)
                        .set("fixed_residence", 1).set("pet_care_experience", 1)
                        .set("current_pet_count", 0).set("household_agreement", 1)
                        .set("approved_applications", 0).set("pending_applications_for_animal", 1)
                        .set("animal_status", 1));
    }

    static AdminAgentClient.AdoptionDraftSuggestion suggestion(String recommendation, String risk, String missing) {
        return new AdminAgentClient.AdoptionDraftSuggestion(recommendation, risk, "依据", missing,
                "最终决定需管理员确认");
    }
}
