package com.example.service;

import cn.hutool.json.JSONObject;
import com.example.entity.Role;
import com.example.entity.User;
import com.example.exception.CustomException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.Date;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.mockito.Mockito.doThrow;

@ExtendWith(MockitoExtension.class)
class AdminAgentAutomationServiceTest {
    @Mock AdminAgentAutomationRepository repository;
    @Mock AdminAgentTools tools;
    @Mock AdminAgentClient client;
    @Mock AdminAgentService agentService;
    @Mock AdminAgentAutomationExecutor executor;
    @Mock AdminAgentRepository auditRepository;
    AdminAgentAutomationService service;

    @BeforeEach void setUp() {
        service = new AdminAgentAutomationService(repository, tools, client, agentService, executor, auditRepository);
    }

    @Test void ordinaryAdministratorCannotReadOrChangeAutomation() {
        CustomException error = assertThrows(CustomException.class, () -> service.status(user(false)));
        assertEquals("403", error.getCode());
        verify(repository, never()).config();
    }

    @Test void guardedModeRequiresAllExplicitAcknowledgementsAndPhrase() {
        User actor = user(true);
        CustomException error = assertThrows(CustomException.class, () -> service.saveConfig(actor, 1, true,
                "guarded", 3, true, true, "我确认"));
        assertEquals("400", error.getCode());
        assertTrue(error.getMsg().contains("确认短语不匹配"));
        assertTrue(error.getMsg().contains("我确认"));
        verify(repository, never()).saveConfig(any(), anyLong(), any(Boolean.class), anyString(), any(Integer.class));
    }

    @Test void guardedModeDistinguishesMissingPhraseFromTypo() {
        User actor = user(true);
        CustomException missing = assertThrows(CustomException.class, () -> service.saveConfig(actor, 1, true,
                "guarded", 3, true, true, "  "));
        assertTrue(missing.getMsg().contains("尚未填写"));

        CustomException typo = assertThrows(CustomException.class, () -> service.saveConfig(actor, 1, true,
                "guarded", 3, true, true, "启动受控自动通过"));
        assertTrue(typo.getMsg().contains("你输入了“启动受控自动通过”"));
        assertTrue(typo.getMsg().contains("要求为“启用受控自动通过”"));
    }

    @Test void repeatedRunRequestReturnsStoredEvidenceWithoutAnotherPaidCall() {
        User actor = user(true);
        AdminAgentAutomationRepository.RunDetail stored = detail("completed", "shadow");
        when(repository.findByRequestId(9L, "repeat-run")).thenReturn(stored);

        assertSame(stored, service.runOnce(actor, "repeat-run"));

        verify(agentService, never()).requireConnectedConfig(any());
        verify(client, never()).generateAdoptionDraft(any(), any(), any());
    }

    @Test void shadowModeEvaluatesButNeverExecutes() {
        Fixture f = fixture("shadow", AdminAgentAutomationPolicyTest.suggestion("approve", "low", "无"));

        service.runOnce(f.actor, "shadow-run");

        verify(executor, never()).autoApprove(any(), any(), any(), any(), any());
        verify(repository).saveItem(71L, 10011L, 43L, f.suggestion, true, "shadow",
                "影子模式：若为受控模式将允许自动通过；本次未改变任何状态");
        verify(repository).completeRun(71L, "completed", 1, 1, 0, 0, 0,
                "运行完成；自动驳回数固定为 0");
    }

    @Test void guardedModeNeverExecutesRejectRecommendation() {
        Fixture f = fixture("guarded", AdminAgentAutomationPolicyTest.suggestion("reject", "low", "无"));

        service.runOnce(f.actor, "reject-run");

        verify(executor, never()).autoApprove(any(), any(), any(), any(), any());
        verify(repository).saveItem(eq(71L), eq(10011L), eq(43L), eq(f.suggestion), eq(false),
                eq("manual_review"), anyString());
        verify(repository).completeRun(71L, "completed", 1, 0, 0, 1, 0,
                "运行完成；自动驳回数固定为 0");
    }

    @Test void guardedModeDelegatesOnlyEligibleApprovalToTransactionalExecutor() {
        Fixture f = fixture("guarded", AdminAgentAutomationPolicyTest.suggestion("approve", "low", "无"));

        service.runOnce(f.actor, "approve-run");

        verify(executor).autoApprove(f.actor, 71L, 10011L, 43L, f.suggestion);
        verify(repository).completeRun(71L, "completed", 1, 0, 1, 0, 0,
                "运行完成；自动驳回数固定为 0");
    }

    @Test void hardGateFailureSkipsPaidModelAndMovesToHumanReview() {
        Fixture f = fixture("guarded", AdminAgentAutomationPolicyTest.suggestion("approve", "low", "无"));
        JSONObject ineligible = AdminAgentAutomationPolicyTest.eligibleContext();
        ineligible.getJSONObject("untrusted_business_data").set("household_agreement", 0);
        when(tools.adoptionDraftContext(f.actor, 10011L, 43L)).thenReturn(ineligible);

        service.runOnce(f.actor, "gate-run");

        verify(client, never()).generateAdoptionDraft(any(), any(), any());
        verify(executor, never()).autoApprove(any(), any(), any(), any(), any());
        verify(repository).completeRun(71L, "completed", 1, 0, 0, 1, 0,
                "运行完成；自动驳回数固定为 0");
    }

    @Test void lastMomentCompetitionOrEmergencyStopFallsBackToHumanWithoutRejecting() {
        Fixture f = fixture("guarded", AdminAgentAutomationPolicyTest.suggestion("approve", "low", "无"));
        doThrow(new CustomException("409", "该动物出现竞争申请，已转人工复核"))
                .when(executor).autoApprove(f.actor, 71L, 10011L, 43L, f.suggestion);

        service.runOnce(f.actor, "race-run");

        verify(repository).saveItem(71L, 10011L, 43L, f.suggestion, false,
                "manual_review", "该动物出现竞争申请，已转人工复核");
        verify(repository).completeRun(71L, "completed", 1, 0, 0, 1, 0,
                "运行完成；自动驳回数固定为 0");
    }

    private Fixture fixture(String mode, AdminAgentClient.AdoptionDraftSuggestion suggestion) {
        User actor = user(true);
        AdminAgentAutomationRepository.RunSummary running = run("running", mode);
        AdminAgentAutomationRepository.RunDetail completed = detail("completed", mode);
        AdminAgentAutomationRepository.AutomationConfig automation = config(true, mode);
        PetCareService.AiConnectionConfig model = new PetCareService.AiConnectionConfig(true,
                "https://api.example.com", "secret", "model", true, "connected", "ok", new Date(), 1L);
        when(repository.findByRequestId(eq(9L), anyString())).thenReturn(null);
        when(agentService.requireConnectedConfig(actor)).thenReturn(model);
        when(repository.beginRun(eq(9L), anyString())).thenReturn(running);
        when(repository.config()).thenReturn(automation);
        when(tools.automationCandidates(actor, 3)).thenReturn(List.of(new AdminAgentTools.AutomationCandidate(10011L, 43L)));
        JSONObject context = AdminAgentAutomationPolicyTest.eligibleContext();
        when(tools.adoptionDraftContext(actor, 10011L, 43L)).thenReturn(context);
        lenient().when(client.generateAdoptionDraft(actor, context, model)).thenReturn(suggestion);
        when(repository.detail(71L)).thenReturn(completed);
        return new Fixture(actor, suggestion);
    }

    private static User user(boolean superAdmin) {
        User user = new User(); user.setId(9L);
        if (superAdmin) { Role role = new Role(); role.setId(1L); user.setRole(List.of(role)); }
        return user;
    }

    private static AdminAgentAutomationRepository.AutomationConfig config(boolean enabled, String mode) {
        return new AdminAgentAutomationRepository.AutomationConfig(enabled, mode, 3, 1, 9L, new Date(), new Date());
    }

    private static AdminAgentAutomationRepository.RunSummary run(String status, String mode) {
        return new AdminAgentAutomationRepository.RunSummary(71L, 9L, "request", mode, status,
                0, 0, 0, 0, 0, "", new Date(), null);
    }

    private static AdminAgentAutomationRepository.RunDetail detail(String status, String mode) {
        return new AdminAgentAutomationRepository.RunDetail(run(status, mode), List.of());
    }

    private record Fixture(User actor, AdminAgentClient.AdoptionDraftSuggestion suggestion) {}
}
