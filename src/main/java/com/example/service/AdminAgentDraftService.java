package com.example.service;

import cn.hutool.json.JSONObject;
import com.example.common.PermissionUtil;
import com.example.common.RoleAssignmentPolicy;
import com.example.entity.User;
import com.example.exception.CustomException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Set;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

/** 第三阶段 3A 草稿 + 3B 管理员显式确认执行；AI 本身始终没有写工具。 */
@Service
public class AdminAgentDraftService {
    private static final Set<String> RECOMMENDATIONS = Set.of(
            "approve", "request_material", "manual_review", "reject");
    private static final Set<String> RISK_LEVELS = Set.of("low", "medium", "high");

    private final AdminAgentDraftRepository drafts;
    private final AdminAgentRepository auditRepository;
    private final AdminAgentTools tools;
    private final AdminAgentClient client;
    private final AdminAgentService agentService;
    private final AdoptService adoptService;
    private final ConcurrentHashMap<String, CompletableFuture<AdminAgentDraftRepository.DraftItem>> inFlight
            = new ConcurrentHashMap<>();

    public AdminAgentDraftService(AdminAgentDraftRepository drafts, AdminAgentRepository auditRepository,
                                  AdminAgentTools tools, AdminAgentClient client,
                                  AdminAgentService agentService, AdoptService adoptService) {
        this.drafts = drafts; this.auditRepository = auditRepository; this.tools = tools;
        this.client = client; this.agentService = agentService; this.adoptService = adoptService;
    }

    public AdminAgentDraftRepository.DraftItem generate(User actor, String requestId,
                                                         Long animalId, Long applicantId,
                                                         boolean replaceExisting) {
        requireDraftPermission(actor);
        validateRequest(requestId, animalId, applicantId);
        AdminAgentDraftRepository.DraftItem duplicate = drafts.findByRequestId(actor.getId(), requestId);
        if (duplicate != null) return duplicate;
        if (!replaceExisting) {
            AdminAgentDraftRepository.DraftItem existing = drafts.findByApplication(
                    actor.getId(), animalId, applicantId);
            if (existing != null) return existing;
        }
        // 同一管理员、同一申请即使来自不同标签页/不同 requestId，也只允许一个付费生成任务。
        String key = actor.getId() + ":" + animalId + ":" + applicantId;
        CompletableFuture<AdminAgentDraftRepository.DraftItem> owner = new CompletableFuture<>();
        CompletableFuture<AdminAgentDraftRepository.DraftItem> current = inFlight.putIfAbsent(key, owner);
        if (current != null) return await(current);
        try {
            AdminAgentDraftRepository.DraftItem result = generateOnce(
                    actor, requestId, animalId, applicantId, replaceExisting);
            owner.complete(result);
            return result;
        } catch (RuntimeException ex) {
            owner.completeExceptionally(ex);
            throw ex;
        } finally {
            inFlight.remove(key, owner);
        }
    }

    private AdminAgentDraftRepository.DraftItem generateOnce(
            User actor, String requestId, Long animalId, Long applicantId, boolean replaceExisting) {
        AdminAgentDraftRepository.DraftItem duplicate = drafts.findByRequestId(actor.getId(), requestId);
        if (duplicate != null) return duplicate;
        if (!replaceExisting) {
            AdminAgentDraftRepository.DraftItem existing = drafts.findByApplication(actor.getId(), animalId, applicantId);
            if (existing != null) return existing;
        }
        JSONObject context = tools.adoptionDraftContext(actor, animalId, applicantId);
        if (context.containsKey("error")) {
            String code = "permission_denied".equals(context.getStr("error")) ? "403"
                    : "not_found".equals(context.getStr("error")) ? "404" : "422";
            throw new CustomException(code, safe(context.getStr("message"), "无法读取领养申请上下文", 300));
        }
        JSONObject data = context.getJSONObject("untrusted_business_data");
        Integer state = data == null ? null : data.getInt("application_state");
        if (state == null || state != 0) {
            throw new CustomException("409", "仅待审核申请可以生成 AI 审核草稿");
        }
        PetCareService.AiConnectionConfig config = agentService.requireConnectedConfig(actor);
        try {
            AdminAgentClient.AdoptionDraftSuggestion suggestion = client.generateAdoptionDraft(actor, context, config);
            AdminAgentDraftRepository.DraftItem saved = drafts.saveGenerated(actor.getId(), requestId,
                    animalId, applicantId, config.getModel(), suggestion);
            auditRepository.audit(actor.getId(), "adopt_draft_generated", null, requestId,
                    "[\"get_adoption_review_context\"]", "success",
                    "draftId=" + saved.getId() + ", animalId=" + animalId + ", applicantId=" + applicantId);
            return saved;
        } catch (CustomException ex) {
            auditRepository.audit(actor.getId(), "adopt_draft_generated", null, requestId,
                    "[\"get_adoption_review_context\"]", "failed", safe(ex.getMessage(), "生成失败", 900));
            throw ex;
        }
    }

    public AdminAgentDraftRepository.DraftItem find(User actor, Long id) {
        requireDraftPermission(actor);
        return drafts.findOwned(actor.getId(), id);
    }

    public AdminAgentDraftRepository.DraftItem update(User actor, Long id, long expectedVersion,
                                                       String recommendation, String riskLevel,
                                                       String rationale, String missingInfo, String reviewNote) {
        requireDraftPermission(actor);
        AdminAgentDraftRepository.DraftItem current = drafts.findOwned(actor.getId(), id);
        ensurePending(current.getAnimalId(), current.getApplicantId());
        String cleanRecommendation = enumValue(recommendation, RECOMMENDATIONS, "建议结论");
        String cleanRisk = enumValue(riskLevel, RISK_LEVELS, "风险等级");
        AdminAgentDraftRepository.DraftItem saved = drafts.updateOwned(actor.getId(), id, expectedVersion,
                cleanRecommendation, cleanRisk, required(rationale, 1200, "判断依据"),
                required(missingInfo, 800, "缺失信息"), required(reviewNote, 1200, "审核备注"));
        auditRepository.audit(actor.getId(), "adopt_draft_updated", null, "", "[]", "success",
                "draftId=" + id + ", version=" + saved.getVersion());
        return saved;
    }

    public boolean discard(User actor, Long id, long expectedVersion) {
        requireDraftPermission(actor);
        boolean discarded = drafts.discardOwned(actor.getId(), id, expectedVersion);
        auditRepository.audit(actor.getId(), "adopt_draft_discarded", null, "", "[]", "success",
                "draftId=" + id);
        return discarded;
    }

    /**
     * 3B：AI 没有写工具；只有管理员提交独立最终决定并确认后，才复用既有审核状态机。
     * 草稿行先加锁，审核状态与 executed 凭据处在同一事务，避免半成功。
     */
    @Transactional
    public AdminAgentDraftRepository.DraftItem finalizeDraft(
            User actor, Long id, String requestId, long expectedVersion,
            String decision, String overrideReason,
            boolean reviewedApplication, boolean acknowledgeConsequences) {
        requireDraftPermission(actor);
        validateFinalizeRequest(requestId, id, decision, reviewedApplication, acknowledgeConsequences);
        AdminAgentDraftRepository.DraftItem duplicate = drafts.findByFinalRequestId(actor.getId(), requestId);
        if (duplicate != null) {
            if (id.equals(duplicate.getId()) && "executed".equals(duplicate.getStatus())) return duplicate;
            throw new CustomException("409", "执行请求号已被使用");
        }

        AdminAgentDraftRepository.DraftItem current = drafts.lockOwned(actor.getId(), id);
        if ("executed".equals(current.getStatus())) {
            throw new CustomException("409", "该草稿已经执行，申请状态不会再次改变");
        }
        if (!"draft".equals(current.getStatus())) {
            throw new CustomException("409", "该草稿已被丢弃，不能执行审核");
        }
        if (current.getVersion() != expectedVersion) {
            throw new CustomException("409", "草稿已在其他页面更新，请重新打开后再确认");
        }
        ensurePending(current.getAnimalId(), current.getApplicantId());

        String cleanDecision = enumValue(decision, Set.of("approve", "reject"), "最终决定");
        boolean overridesSuggestion = !cleanDecision.equals(current.getRecommendation());
        boolean highRiskApproval = "approve".equals(cleanDecision) && "high".equals(current.getRiskLevel());
        String cleanReason = optional(overrideReason, 500, "人工决定理由");
        if ((overridesSuggestion || highRiskApproval) && cleanReason.length() < 8) {
            throw new CustomException("400", "覆盖 AI 建议或高风险通过时，请填写至少 8 个字的人工决定理由");
        }

        adoptService.transition(current.getAnimalId(), current.getApplicantId(),
                "approve".equals(cleanDecision) ? "APPROVE" : "REJECT",
                cleanReason.isEmpty()
                        ? ("approve".equals(cleanDecision) ? "管理员复核 AI 草稿后通过，等待线下交接" : "管理员复核 AI 草稿后驳回")
                        : cleanReason,
                null, null, actor, true, "ADMIN_AI");
        AdminAgentDraftRepository.DraftItem finalized = drafts.markFinalized(
                actor.getId(), id, expectedVersion, requestId, cleanDecision, cleanReason);
        auditRepository.audit(actor.getId(), "adopt_draft_finalized", null, requestId,
                "[]", "success", "draftId=" + id + ", decision=" + cleanDecision
                        + ", override=" + overridesSuggestion + ", highRiskApproval=" + highRiskApproval);
        return finalized;
    }

    private void ensurePending(Long animalId, Long applicantId) {
        Integer state = drafts.adoptionState(animalId, applicantId);
        if (state == null) throw new CustomException("404", "领养申请不存在");
        if (state != 0) throw new CustomException("409", "申请状态已变化，草稿只能查看，不能继续保存");
    }

    private void requireDraftPermission(User actor) {
        if (actor == null || actor.getId() == null) throw new CustomException("401", "未登录或登录已过期");
        if (RoleAssignmentPolicy.hasRoleId(actor, RoleAssignmentPolicy.SUPER_ADMIN_ROLE_ID)) return;
        if (!PermissionUtil.hasFlag(actor, "admin_agent") || !PermissionUtil.hasFlag(actor, "adopt")) {
            throw new CustomException("403", "需要 AI 管理助手和领养审核权限");
        }
    }

    private void validateRequest(String requestId, Long animalId, Long applicantId) {
        if (requestId == null || !requestId.matches("^[A-Za-z0-9_-]{1,64}$")) {
            throw new CustomException("400", "requestId 格式无效");
        }
        if (animalId == null || applicantId == null || animalId <= 0 || applicantId <= 0) {
            throw new CustomException("400", "动物编号和申请人编号必须是正整数");
        }
    }

    private void validateFinalizeRequest(String requestId, Long id, String decision,
                                         boolean reviewedApplication, boolean acknowledgeConsequences) {
        if (requestId == null || !requestId.matches("^[A-Za-z0-9_-]{1,64}$")) {
            throw new CustomException("400", "requestId 格式无效");
        }
        if (id == null || id <= 0) throw new CustomException("400", "草稿编号必须是正整数");
        if (decision == null || !("approve".equalsIgnoreCase(decision.trim())
                || "reject".equalsIgnoreCase(decision.trim()))) {
            throw new CustomException("400", "最终决定仅允许通过或驳回");
        }
        if (!reviewedApplication) throw new CustomException("400", "请先确认已复核完整申请资料");
        if (!acknowledgeConsequences) throw new CustomException("400", "请先确认已理解本次审核的状态影响");
    }

    private String enumValue(String raw, Set<String> allowed, String label) {
        String value = raw == null ? "" : raw.trim().toLowerCase(java.util.Locale.ROOT);
        if (!allowed.contains(value)) throw new CustomException("400", label + "无效");
        return value;
    }

    private String required(String raw, int max, String label) {
        String value = raw == null ? "" : raw.trim();
        if (value.isEmpty()) throw new CustomException("400", label + "不能为空");
        if (value.length() > max) throw new CustomException("400", label + "不能超过" + max + "字");
        return value;
    }

    private String optional(String raw, int max, String label) {
        String value = raw == null ? "" : raw.trim();
        if (value.length() > max) throw new CustomException("400", label + "不能超过" + max + "字");
        return value;
    }

    private String safe(String value, String fallback, int max) {
        String result = value == null ? "" : value.trim().replaceAll("[\\r\\n\\t]+", " ");
        if (result.isEmpty()) result = fallback;
        return result.length() <= max ? result : result.substring(0, max);
    }

    private AdminAgentDraftRepository.DraftItem await(
            CompletableFuture<AdminAgentDraftRepository.DraftItem> future) {
        try {
            return future.get(30, TimeUnit.SECONDS);
        } catch (InterruptedException ex) {
            Thread.currentThread().interrupt();
            throw new CustomException("503", "草稿生成已中断，请稍后重试");
        } catch (TimeoutException ex) {
            throw new CustomException("503", "相同草稿请求仍在处理中，请稍后重试");
        } catch (ExecutionException ex) {
            Throwable cause = ex.getCause();
            if (cause instanceof CustomException) throw (CustomException) cause;
            throw new CustomException("502", "草稿生成失败，请稍后重试");
        }
    }
}
