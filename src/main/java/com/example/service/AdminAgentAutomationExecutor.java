package com.example.service;

import cn.hutool.json.JSONObject;
import com.example.entity.User;
import com.example.exception.CustomException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** 3C 唯一允许写业务状态的窄执行器；每条申请在独立事务中重新校验配置、上下文和状态。 */
@Service
public class AdminAgentAutomationExecutor {
    private final AdminAgentAutomationRepository repository;
    private final AdminAgentTools tools;
    private final AdoptService adoptService;

    public AdminAgentAutomationExecutor(AdminAgentAutomationRepository repository,
                                        AdminAgentTools tools, AdoptService adoptService) {
        this.repository=repository;this.tools=tools;this.adoptService=adoptService;
    }

    @Transactional
    public void autoApprove(User actor, Long runId, Long animalId, Long applicantId,
                            AdminAgentClient.AdoptionDraftSuggestion suggestion) {
        AdminAgentAutomationRepository.AutomationConfig config = repository.lockConfig();
        if (!config.isEnabled() || !"guarded".equals(config.getMode())) {
            throw new CustomException("409", "执行前检测到自动审核已停用或切回影子模式");
        }
        JSONObject fresh = tools.adoptionDraftContext(actor, animalId, applicantId);
        AdminAgentAutomationPolicy.Evaluation evaluation = AdminAgentAutomationPolicy.evaluate(fresh, suggestion);
        if (!evaluation.isEligible()) throw new CustomException("409", "执行前复核未通过：" + evaluation.getReason());
        adoptService.auditSolePendingAdopt(animalId, applicantId, actor);
        repository.saveItem(runId, animalId, applicantId, suggestion, true,
                "auto_approved", "受控模式自动通过；执行前已重新校验配置、硬规则和申请状态");
    }
}
