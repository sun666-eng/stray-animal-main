package com.example.service;

import cn.hutool.json.JSONObject;
import com.example.common.RoleAssignmentPolicy;
import com.example.entity.User;
import com.example.exception.CustomException;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Locale;
import java.util.Set;

/** 第三阶段 3C：超级管理员手动触发的受控自动审核。永不自动驳回。 */
@Service
public class AdminAgentAutomationService {
    static final String GUARDED_CONFIRMATION = "启用受控自动通过";
    private static final Set<String> MODES = Set.of("shadow", "guarded");
    private final AdminAgentAutomationRepository repository;
    private final AdminAgentTools tools;
    private final AdminAgentClient client;
    private final AdminAgentService agentService;
    private final AdminAgentAutomationExecutor executor;
    private final AdminAgentRepository auditRepository;

    public AdminAgentAutomationService(AdminAgentAutomationRepository repository, AdminAgentTools tools,
                                       AdminAgentClient client, AdminAgentService agentService,
                                       AdminAgentAutomationExecutor executor, AdminAgentRepository auditRepository) {
        this.repository=repository;this.tools=tools;this.client=client;this.agentService=agentService;
        this.executor=executor;this.auditRepository=auditRepository;
    }

    public AutomationStatus status(User actor) {
        requireSuperAdmin(actor);
        return new AutomationStatus(repository.config(), repository.recentRuns(10), true,
                "3C 只在超级管理员手动运行时工作；系统不会在后台自行审核，也绝不自动驳回。");
    }

    public AutomationStatus saveConfig(User actor, long expectedVersion, boolean enabled, String mode,
                                       int maxBatch, boolean acknowledgeNoAutoReject,
                                       boolean acknowledgeHumanFallback, String confirmationText) {
        requireSuperAdmin(actor);
        String cleanMode = mode == null ? "" : mode.trim().toLowerCase(Locale.ROOT);
        if (!MODES.contains(cleanMode)) throw new CustomException("400", "运行模式无效");
        if (maxBatch < 1 || maxBatch > 3) throw new CustomException("400", "单次处理数量只能是 1 到 3");
        if (enabled && "guarded".equals(cleanMode)) {
            if (!acknowledgeNoAutoReject || !acknowledgeHumanFallback) {
                throw new CustomException("400", "启用受控模式前必须确认两项安全边界");
            }
            String cleanConfirmation = confirmationText == null ? "" : confirmationText.trim();
            if (cleanConfirmation.isEmpty()) {
                throw new CustomException("400", "确认短语尚未填写，请逐字输入：“" + GUARDED_CONFIRMATION + "”");
            }
            if (!GUARDED_CONFIRMATION.equals(cleanConfirmation)) {
                throw new CustomException("400", "确认短语不匹配：你输入了“" + safe(cleanConfirmation, 40)
                        + "”，要求为“" + GUARDED_CONFIRMATION + "”");
            }
        }
        repository.saveConfig(actor.getId(), expectedVersion, enabled, cleanMode, maxBatch);
        auditRepository.audit(actor.getId(), "automation_config_updated", null, "", "[]", "success",
                "enabled=" + enabled + ", mode=" + cleanMode + ", maxBatch=" + maxBatch);
        return status(actor);
    }

    public AdminAgentAutomationRepository.RunDetail runOnce(User actor, String requestId) {
        requireSuperAdmin(actor);
        validateRequestId(requestId);
        AdminAgentAutomationRepository.RunDetail duplicate = repository.findByRequestId(actor.getId(), requestId);
        if (duplicate != null) return duplicate;
        PetCareService.AiConnectionConfig modelConfig = agentService.requireConnectedConfig(actor);
        AdminAgentAutomationRepository.RunSummary run = repository.beginRun(actor.getId(), requestId);
        if (!"running".equals(run.getStatus())) return repository.detail(run.getId());
        int candidates=0, shadows=0, approved=0, manual=0, failed=0;
        try {
            AdminAgentAutomationRepository.AutomationConfig config = repository.config();
            List<AdminAgentTools.AutomationCandidate> list = tools.automationCandidates(actor, config.getMaxBatch());
            candidates = list.size();
            for (AdminAgentTools.AutomationCandidate candidate : list) {
                JSONObject context = tools.adoptionDraftContext(actor, candidate.getAnimalId(), candidate.getApplicantId());
                AdminAgentAutomationPolicy.Evaluation hard = AdminAgentAutomationPolicy.hardGates(context);
                if (!hard.isEligible()) {
                    repository.saveItem(run.getId(), candidate.getAnimalId(), candidate.getApplicantId(), null,
                            false, "manual_review", hard.getReason());
                    manual++;
                    continue;
                }
                AdminAgentClient.AdoptionDraftSuggestion suggestion = null;
                try {
                    suggestion = client.generateAdoptionDraft(actor, context, modelConfig);
                    AdminAgentAutomationPolicy.Evaluation evaluation = AdminAgentAutomationPolicy.evaluate(context, suggestion);
                    if ("shadow".equals(run.getMode())) {
                        repository.saveItem(run.getId(), candidate.getAnimalId(), candidate.getApplicantId(), suggestion,
                                evaluation.isEligible(), "shadow", evaluation.isEligible()
                                        ? "影子模式：若为受控模式将允许自动通过；本次未改变任何状态"
                                        : "影子模式：" + evaluation.getReason());
                        shadows++;
                    } else if (evaluation.isEligible()) {
                        executor.autoApprove(actor, run.getId(), candidate.getAnimalId(), candidate.getApplicantId(), suggestion);
                        approved++;
                    } else {
                        repository.saveItem(run.getId(), candidate.getAnimalId(), candidate.getApplicantId(), suggestion,
                                false, "manual_review", evaluation.getReason());
                        manual++;
                    }
                } catch (CustomException ex) {
                    boolean stateConflict = "409".equals(ex.getCode());
                    repository.saveItem(run.getId(), candidate.getAnimalId(), candidate.getApplicantId(), suggestion,
                            false, stateConflict ? "manual_review" : "failed", safe(ex.getMessage(), 500));
                    if (stateConflict) manual++; else failed++;
                }
            }
            repository.completeRun(run.getId(), "completed", candidates, shadows, approved, manual, failed,
                    "运行完成；自动驳回数固定为 0");
            auditRepository.audit(actor.getId(), "automation_run_completed", null, requestId, "[]", "success",
                    "runId=" + run.getId() + ", mode=" + run.getMode() + ", approved=" + approved
                            + ", manual=" + manual + ", failed=" + failed + ", autoRejected=0");
        } catch (RuntimeException ex) {
            repository.completeRun(run.getId(), "failed", candidates, shadows, approved, manual, failed,
                    safe(ex.getMessage(), 1000));
            auditRepository.audit(actor.getId(), "automation_run_failed", null, requestId, "[]", "failed",
                    "runId=" + run.getId() + ", detail=" + safe(ex.getMessage(), 800));
            throw ex;
        }
        return repository.detail(run.getId());
    }

    public List<AdminAgentAutomationRepository.RunSummary> runs(User actor, int limit) {
        requireSuperAdmin(actor); return repository.recentRuns(limit);
    }

    public AdminAgentAutomationRepository.RunDetail run(User actor, Long id) {
        requireSuperAdmin(actor);
        if (id == null || id <= 0) throw new CustomException("400", "批次编号无效");
        return repository.detail(id);
    }

    private void requireSuperAdmin(User actor) {
        if (actor == null || actor.getId() == null) throw new CustomException("401", "未登录或登录已过期");
        if (!RoleAssignmentPolicy.hasRoleId(actor, RoleAssignmentPolicy.SUPER_ADMIN_ROLE_ID)) {
            throw new CustomException("403", "3C 自动审核控制台仅超级管理员可用");
        }
    }

    private void validateRequestId(String requestId) {
        if (requestId == null || !requestId.matches("^[A-Za-z0-9_-]{1,64}$")) {
            throw new CustomException("400", "requestId 格式无效");
        }
    }

    private String safe(String value, int max) {
        String result=value==null?"":value.trim().replaceAll("[\\r\\n\\t]+"," ");
        return result.length()<=max?result:result.substring(0,max);
    }

    public static final class AutomationStatus {
        private final AdminAgentAutomationRepository.AutomationConfig config;
        private final List<AdminAgentAutomationRepository.RunSummary> recentRuns;
        private final boolean superAdminOnly;
        private final String safetyNotice;
        AutomationStatus(AdminAgentAutomationRepository.AutomationConfig config,
                         List<AdminAgentAutomationRepository.RunSummary> recentRuns,
                         boolean superAdminOnly,String safetyNotice){
            this.config=config;this.recentRuns=List.copyOf(recentRuns);this.superAdminOnly=superAdminOnly;this.safetyNotice=safetyNotice;
        }
        public AdminAgentAutomationRepository.AutomationConfig getConfig(){return config;}
        public List<AdminAgentAutomationRepository.RunSummary> getRecentRuns(){return recentRuns;}
        public boolean isSuperAdminOnly(){return superAdminOnly;} public String getSafetyNotice(){return safetyNotice;}
    }
}
