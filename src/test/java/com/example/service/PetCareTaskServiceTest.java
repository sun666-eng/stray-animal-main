package com.example.service;

import com.example.entity.PetCareRequest;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.Collections;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class PetCareTaskServiceTest {

    private PetCareTaskService taskService;
    private PetCareRequestStore requestStore;
    private PetCareConversationService conversationService;
    private PetCareHistoryService historyService;
    private PetCareAiConfigService configService;
    private PetCareService petCareService;

    @BeforeEach
    void setUp() {
        taskService = new PetCareTaskService();
        requestStore = mock(PetCareRequestStore.class);
        conversationService = mock(PetCareConversationService.class);
        historyService = mock(PetCareHistoryService.class);
        configService = mock(PetCareAiConfigService.class);
        petCareService = mock(PetCareService.class);
        ReflectionTestUtils.setField(taskService, "requestStore", requestStore);
        ReflectionTestUtils.setField(taskService, "conversationService", conversationService);
        ReflectionTestUtils.setField(taskService, "historyService", historyService);
        ReflectionTestUtils.setField(taskService, "aiConfigService", configService);
        ReflectionTestUtils.setField(taskService, "petCareService", petCareService);
        ReflectionTestUtils.setField(taskService, "maxHistory", 8);
    }

    @Test
    void completedDuplicateReturnsPersistedResultAndCallsModelOnlyOnce() {
        PetCareRequest running = row("running");
        running.setAttemptCount(1);
        PetCareRequest completed = row("completed");
        completed.setAnswer("权威回答");
        completed.setSource("ai");
        completed.setToolsJson("[]");
        when(requestStore.claim(8L, "req-1", 11L, "追问"))
                .thenReturn(new PetCareRequestStore.Claim(running, true, true),
                        new PetCareRequestStore.Claim(completed, false, false));
        PetCareService.ChatTurn historical = new PetCareService.ChatTurn("assistant", "数据库历史");
        when(historyService.authoritativeTurns(8L, 11L, 8))
                .thenReturn(Collections.singletonList(historical));
        PetCareService.PetCareAnswer generated =
                new PetCareService.PetCareAnswer("权威回答", "ai", "综合");
        when(petCareService.ask(eq(8L), eq("追问"), any(), any())).thenReturn(generated);
        when(requestStore.saveAnswer(8L, "req-1", 1, generated)).thenReturn(completed);
        when(requestStore.finalizeAnswer(8L, "req-1")).thenReturn(completed);

        assertEquals("权威回答", taskService.ask(8L, "req-1", 11L, "追问").getAnswer());
        assertEquals("权威回答", taskService.ask(8L, "req-1", 11L, "追问").getAnswer());

        verify(petCareService, times(1)).ask(8L, "追问",
                Collections.singletonList(historical), null);
        verify(historyService, times(1)).authoritativeTurns(8L, 11L, 8);
        verify(requestStore, times(1)).saveAnswer(8L, "req-1", 1, generated);
    }

    private PetCareRequest row(String status) {
        PetCareRequest row = new PetCareRequest();
        row.setId(1L);
        row.setUserId(8L);
        row.setRequestId("req-1");
        row.setConversationId(11L);
        row.setConversationTitle("会话");
        row.setQuestion("追问");
        row.setStatus(status);
        return row;
    }
}
