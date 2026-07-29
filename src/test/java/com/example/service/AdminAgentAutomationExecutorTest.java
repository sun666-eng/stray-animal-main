package com.example.service;

import com.example.entity.User;
import com.example.exception.CustomException;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.Date;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class AdminAgentAutomationExecutorTest {
    @Mock AdminAgentAutomationRepository repository;
    @Mock AdminAgentTools tools;
    @Mock AdoptService adoptService;
    @InjectMocks AdminAgentAutomationExecutor executor;

    @Test void emergencyDisableIsRecheckedInsideTheWriteTransaction() {
        User actor = new User(); actor.setId(9L);
        when(repository.lockConfig()).thenReturn(new AdminAgentAutomationRepository.AutomationConfig(
                false, "guarded", 3, 2, 9L, new Date(), new Date()));

        CustomException error = assertThrows(CustomException.class, () -> executor.autoApprove(actor,
                71L, 10011L, 43L, AdminAgentAutomationPolicyTest.suggestion("approve", "low", "无")));

        assertEquals("409", error.getCode());
        verify(tools, never()).adoptionDraftContext(actor, 10011L, 43L);
        verify(adoptService, never()).auditSolePendingAdopt(10011L, 43L, actor);
    }

    @Test void liveContextIsRecheckedImmediatelyBeforeExistingStateMachine() {
        User actor = new User(); actor.setId(9L);
        AdminAgentClient.AdoptionDraftSuggestion suggestion =
                AdminAgentAutomationPolicyTest.suggestion("approve", "low", "无");
        when(repository.lockConfig()).thenReturn(new AdminAgentAutomationRepository.AutomationConfig(
                true, "guarded", 3, 2, 9L, new Date(), new Date()));
        when(tools.adoptionDraftContext(actor, 10011L, 43L))
                .thenReturn(AdminAgentAutomationPolicyTest.eligibleContext());

        executor.autoApprove(actor, 71L, 10011L, 43L, suggestion);

        verify(adoptService).auditSolePendingAdopt(10011L, 43L, actor);
        verify(repository).saveItem(71L, 10011L, 43L, suggestion, true, "auto_approved",
                "受控模式自动通过；执行前已重新校验配置、硬规则和申请状态");
    }
}
