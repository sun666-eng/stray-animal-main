package com.example.service;

import cn.hutool.json.JSONObject;
import com.example.entity.Permission;
import com.example.entity.User;
import com.example.exception.CustomException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.Arrays;
import java.util.Date;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class AdminAgentDraftServiceTest {
    @Mock AdminAgentDraftRepository drafts;
    @Mock AdminAgentRepository auditRepository;
    @Mock AdminAgentTools tools;
    @Mock AdminAgentClient client;
    @Mock AdminAgentService agentService;
    @Mock AdoptService adoptService;
    AdminAgentDraftService service;

    @BeforeEach
    void setUp() {
        service = new AdminAgentDraftService(drafts, auditRepository, tools, client, agentService, adoptService);
    }

    @Test
    void requiresBothAgentAndAdoptionPermissionsBeforeReadingAnything() {
        User actor = user("adopt");

        CustomException error = assertThrows(CustomException.class,
                () -> service.generate(actor, "draft-1", 10011L, 43L, false));

        assertEquals("403", error.getCode());
        verify(drafts, never()).findByRequestId(any(), any());
        verify(client, never()).generateAdoptionDraft(any(), any(), any());
    }

    @Test
    void openingExistingPersonalDraftDoesNotMakeAnotherPaidCall() {
        User actor = user("admin_agent", "adopt");
        AdminAgentDraftRepository.DraftItem existing = draft(7L, 1L);
        when(drafts.findByRequestId(9L, "draft-existing")).thenReturn(null);
        when(drafts.findByApplication(9L, 10011L, 43L)).thenReturn(existing);

        AdminAgentDraftRepository.DraftItem result = service.generate(
                actor, "draft-existing", 10011L, 43L, false);

        assertSame(existing, result);
        verify(tools, never()).adoptionDraftContext(any(), any(), any());
        verify(client, never()).generateAdoptionDraft(any(), any(), any());
    }

    @Test
    void pendingApplicationGeneratesAndPersistsReadOnlyDraft() {
        User actor = user("admin_agent", "adopt");
        JSONObject context = new JSONObject().set("read_only", true)
                .set("privacy_minimized", true)
                .set("untrusted_business_data", new JSONObject().set("application_state", 0));
        PetCareService.AiConnectionConfig config = new PetCareService.AiConnectionConfig(
                true, "https://api.example.com/v1", "secret", "model", true,
                "connected", "ok", new Date(), 1L);
        AdminAgentClient.AdoptionDraftSuggestion suggestion = new AdminAgentClient.AdoptionDraftSuggestion(
                "manual_review", "medium", "依据", "缺失", "最终决定需管理员确认");
        AdminAgentDraftRepository.DraftItem saved = draft(8L, 1L);
        when(tools.adoptionDraftContext(actor, 10011L, 43L)).thenReturn(context);
        when(agentService.requireConnectedConfig(actor)).thenReturn(config);
        when(client.generateAdoptionDraft(actor, context, config)).thenReturn(suggestion);
        when(drafts.saveGenerated(9L, "draft-new", 10011L, 43L, "model", suggestion)).thenReturn(saved);

        AdminAgentDraftRepository.DraftItem result = service.generate(
                actor, "draft-new", 10011L, 43L, false);

        assertSame(saved, result);
        verify(auditRepository).audit(9L, "adopt_draft_generated", null, "draft-new",
                "[\"get_adoption_review_context\"]", "success",
                "draftId=8, animalId=10011, applicantId=43");
    }

    @Test
    void terminalApplicationIsRejectedBeforeModelCall() {
        User actor = user("admin_agent", "adopt");
        JSONObject context = new JSONObject().set("read_only", true)
                .set("untrusted_business_data", new JSONObject().set("application_state", 1));
        when(tools.adoptionDraftContext(actor, 10011L, 43L)).thenReturn(context);

        CustomException error = assertThrows(CustomException.class,
                () -> service.generate(actor, "draft-terminal", 10011L, 43L, false));

        assertEquals("409", error.getCode());
        verify(agentService, never()).requireConnectedConfig(any());
        verify(client, never()).generateAdoptionDraft(any(), any(), any());
    }

    @Test
    void saveRechecksApplicationStateBeforeUpdatingDraft() {
        User actor = user("admin_agent", "adopt");
        AdminAgentDraftRepository.DraftItem current = draft(7L, 3L);
        when(drafts.findOwned(9L, 7L)).thenReturn(current);
        when(drafts.adoptionState(10011L, 43L)).thenReturn(2);

        CustomException error = assertThrows(CustomException.class, () -> service.update(actor, 7L, 3L,
                "reject", "high", "依据", "缺失", "备注"));

        assertEquals("409", error.getCode());
        verify(drafts, never()).updateOwned(any(), any(), anyLong(), any(), any(), any(), any(), any());
    }

    @Test
    void concurrentTabsForSameApplicationShareOnePaidGeneration() throws Exception {
        User actor = user("admin_agent", "adopt");
        JSONObject context = new JSONObject().set("read_only", true)
                .set("untrusted_business_data", new JSONObject().set("application_state", 0));
        PetCareService.AiConnectionConfig config = new PetCareService.AiConnectionConfig(
                true, "https://api.example.com/v1", "secret", "model", true,
                "connected", "ok", new Date(), 1L);
        AdminAgentClient.AdoptionDraftSuggestion suggestion = new AdminAgentClient.AdoptionDraftSuggestion(
                "manual_review", "medium", "依据", "缺失", "最终决定需管理员确认");
        AdminAgentDraftRepository.DraftItem saved = draft(9L, 1L);
        CountDownLatch entered = new CountDownLatch(1);
        CountDownLatch secondLookup = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        AtomicInteger lookups = new AtomicInteger();
        when(drafts.findByRequestId(any(), any())).thenAnswer(invocation -> {
            if (lookups.incrementAndGet() >= 3) secondLookup.countDown();
            return null;
        });
        when(tools.adoptionDraftContext(actor, 10011L, 43L)).thenReturn(context);
        when(agentService.requireConnectedConfig(actor)).thenReturn(config);
        when(client.generateAdoptionDraft(actor, context, config)).thenAnswer(invocation -> {
            entered.countDown(); release.await(3, TimeUnit.SECONDS); return suggestion;
        });
        when(drafts.saveGenerated(any(), any(), any(), any(), any(), any())).thenReturn(saved);
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            Future<AdminAgentDraftRepository.DraftItem> first = pool.submit(
                    () -> service.generate(actor, "tab-one", 10011L, 43L, true));
            entered.await(2, TimeUnit.SECONDS);
            Future<AdminAgentDraftRepository.DraftItem> second = pool.submit(
                    () -> service.generate(actor, "tab-two", 10011L, 43L, true));
            secondLookup.await(2, TimeUnit.SECONDS);
            release.countDown();

            assertSame(saved, first.get(3, TimeUnit.SECONDS));
            assertSame(saved, second.get(3, TimeUnit.SECONDS));
            verify(client, times(1)).generateAdoptionDraft(actor, context, config);
        } finally {
            pool.shutdownNow();
        }
    }

    @Test
    void finalizeRequiresExplicitHumanAcknowledgementsBeforeReadingDraft() {
        User actor = user("admin_agent", "adopt");

        CustomException error = assertThrows(CustomException.class, () -> service.finalizeDraft(
                actor, 7L, "final-1", 3L, "approve", "", false, true));

        assertEquals("400", error.getCode());
        verify(drafts, never()).lockOwned(any(), any());
        verify(adoptService, never()).transition(any(), any(), any(), any(), any(), any(), any(), anyBoolean(), any());
    }

    @Test
    void finalizeSameRecommendationUsesExistingStateMachineAndMarksDraftExecuted() {
        User actor = user("admin_agent", "adopt");
        AdminAgentDraftRepository.DraftItem current = draft(7L, 3L, "approve", "low", "draft");
        AdminAgentDraftRepository.DraftItem executed = draft(7L, 4L, "approve", "low", "executed");
        when(drafts.findByFinalRequestId(9L, "final-approve")).thenReturn(null);
        when(drafts.lockOwned(9L, 7L)).thenReturn(current);
        when(drafts.adoptionState(10011L, 43L)).thenReturn(0);
        when(adoptService.transition(any(), any(), any(), any(), any(), any(), any(), anyBoolean(), any())).thenReturn(true);
        when(drafts.markFinalized(9L, 7L, 3L, "final-approve", "approve", "")).thenReturn(executed);

        AdminAgentDraftRepository.DraftItem result = service.finalizeDraft(
                actor, 7L, "final-approve", 3L, "approve", "", true, true);

        assertSame(executed, result);
        verify(adoptService).transition(eq(10011L), eq(43L), eq("APPROVE"),
                contains("等待线下交接"), isNull(), isNull(), eq(actor), eq(true), eq("ADMIN_AI"));
        verify(client, never()).generateAdoptionDraft(any(), any(), any());
        verify(auditRepository).audit(9L, "adopt_draft_finalized", null, "final-approve",
                "[]", "success", "draftId=7, decision=approve, override=false, highRiskApproval=false");
    }

    @Test
    void finalizeOverrideRequiresMeaningfulHumanReason() {
        User actor = user("admin_agent", "adopt");
        AdminAgentDraftRepository.DraftItem current = draft(7L, 3L, "manual_review", "medium", "draft");
        when(drafts.findByFinalRequestId(9L, "final-override")).thenReturn(null);
        when(drafts.lockOwned(9L, 7L)).thenReturn(current);
        when(drafts.adoptionState(10011L, 43L)).thenReturn(0);

        CustomException error = assertThrows(CustomException.class, () -> service.finalizeDraft(
                actor, 7L, "final-override", 3L, "reject", "太短", true, true));

        assertEquals("400", error.getCode());
        verify(adoptService, never()).transition(any(), any(), any(), any(), any(), any(), any(), anyBoolean(), any());
        verify(drafts, never()).markFinalized(any(), any(), anyLong(), any(), any(), any());
    }

    @Test
    void finalizeRejectsStaleDraftBeforeChangingApplication() {
        User actor = user("admin_agent", "adopt");
        AdminAgentDraftRepository.DraftItem current = draft(7L, 4L, "reject", "medium", "draft");
        when(drafts.findByFinalRequestId(9L, "final-stale")).thenReturn(null);
        when(drafts.lockOwned(9L, 7L)).thenReturn(current);

        CustomException error = assertThrows(CustomException.class, () -> service.finalizeDraft(
                actor, 7L, "final-stale", 3L, "reject", "", true, true));

        assertEquals("409", error.getCode());
        verify(adoptService, never()).transition(any(), any(), any(), any(), any(), any(), any(), anyBoolean(), any());
    }

    @Test
    void finalizeRetryWithCommittedRequestIsIdempotent() {
        User actor = user("admin_agent", "adopt");
        AdminAgentDraftRepository.DraftItem executed = draft(7L, 4L, "approve", "low", "executed");
        when(drafts.findByFinalRequestId(9L, "final-retry")).thenReturn(executed);

        AdminAgentDraftRepository.DraftItem result = service.finalizeDraft(
                actor, 7L, "final-retry", 3L, "approve", "", true, true);

        assertSame(executed, result);
        verify(drafts, never()).lockOwned(any(), any());
        verify(adoptService, never()).transition(any(), any(), any(), any(), any(), any(), any(), anyBoolean(), any());
    }

    @Test
    void finalizeCannotReuseAnotherDraftsCommittedRequestId() {
        User actor = user("admin_agent", "adopt");
        AdminAgentDraftRepository.DraftItem other = draft(8L, 4L, "approve", "low", "executed");
        when(drafts.findByFinalRequestId(9L, "final-other")).thenReturn(other);

        CustomException error = assertThrows(CustomException.class, () -> service.finalizeDraft(
                actor, 7L, "final-other", 3L, "approve", "", true, true));

        assertEquals("409", error.getCode());
        verify(drafts, never()).lockOwned(any(), any());
        verify(adoptService, never()).transition(any(), any(), any(), any(), any(), any(), any(), anyBoolean(), any());
    }

    private static User user(String... flags) {
        User user = new User(); user.setId(9L);
        user.setPermission(Arrays.stream(flags).map(flag -> {
            Permission p = new Permission(); p.setFlag(flag); return p;
        }).toList());
        return user;
    }

    private static AdminAgentDraftRepository.DraftItem draft(Long id, long version) {
        return draft(id, version, "manual_review", "medium", "draft");
    }

    private static AdminAgentDraftRepository.DraftItem draft(Long id, long version,
                                                              String recommendation,
                                                              String risk, String status) {
        return new AdminAgentDraftRepository.DraftItem(id, 9L, 10011L, 43L, "request", 0,
                recommendation, risk, "依据", "缺失", "备注", "model", status,
                version, null, null, "", null, new Date(), new Date());
    }
}
