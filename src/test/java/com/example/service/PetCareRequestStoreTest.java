package com.example.service;

import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.baomidou.mybatisplus.core.conditions.Wrapper;
import com.baomidou.mybatisplus.core.metadata.TableInfoHelper;
import com.example.entity.PetCareRequest;
import com.example.exception.CustomException;
import com.example.mapper.PetCareRequestMapper;
import org.apache.ibatis.builder.MapperBuilderAssistant;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.Date;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

class PetCareRequestStoreTest {

    private PetCareRequestStore store;
    private PetCareRequestMapper requestMapper;
    private PetCareConversationService conversationService;

    @BeforeEach
    void setUp() {
        initTable(PetCareRequest.class, "petcare-request-store-test");
        store = new PetCareRequestStore();
        requestMapper = mock(PetCareRequestMapper.class);
        conversationService = mock(PetCareConversationService.class);
        ReflectionTestUtils.setField(store, "requestMapper", requestMapper);
        ReflectionTestUtils.setField(store, "conversationService", conversationService);
        ReflectionTestUtils.setField(store, "taskStaleMs", 60000L);
    }

    @Test
    void newTaskSetsKnownFlagAndReturnsAcquired() {
        when(requestMapper.lockUser(8L)).thenReturn(8L);
        when(requestMapper.insertIgnore(any(PetCareRequest.class))).thenReturn(1);

        PetCareRequestStore.Claim claim = store.claim(8L, "req-1", 11L, "问题");

        assertTrue(claim.isAcquired());
        assertTrue(claim.isNewTask());
        ArgumentCaptor<PetCareRequest> captor = ArgumentCaptor.forClass(PetCareRequest.class);
        verify(requestMapper).insertIgnore(captor.capture());
        assertEquals(Boolean.TRUE, captor.getValue().getRequestedConversationKnown());
        assertEquals("running", captor.getValue().getStatus());
    }

    @Test
    void staleRunningTaskIsExpiredAndNotAcquired() {
        PetCareRequest stale = new PetCareRequest();
        stale.setId(1L);
        stale.setUserId(8L);
        stale.setRequestId("req-1");
        stale.setConversationId(11L);
        stale.setRequestedConversationId(11L);
        stale.setRequestedConversationKnown(true);
        stale.setQuestion("问题");
        stale.setStatus("running");
        stale.setAttemptCount(1);
        stale.setUpdatedAt(new Date(System.currentTimeMillis() - 120000));

        PetCareRequest expired = new PetCareRequest();
        expired.setId(1L);
        expired.setStatus("failed");
        expired.setErrorCode("503");

        when(requestMapper.lockUser(8L)).thenReturn(8L);
        when(requestMapper.insertIgnore(any(PetCareRequest.class))).thenReturn(0);
        when(requestMapper.selectOne(any(Wrapper.class))).thenReturn(stale, expired);
        when(requestMapper.expireStale(eq(1L), any(Date.class), any(Date.class), anyString()))
                .thenReturn(1);

        PetCareRequestStore.Claim claim = store.claim(8L, "req-1", 11L, "问题");

        assertFalse(claim.isAcquired());
        assertEquals("failed", claim.getRow().getStatus());
        verify(requestMapper).expireStale(eq(1L), any(Date.class), any(Date.class), anyString());
    }

    @Test
    void failedKnownTaskCanRetryAndAcquired() {
        PetCareRequest failed = new PetCareRequest();
        failed.setId(2L);
        failed.setUserId(8L);
        failed.setRequestId("req-2");
        failed.setConversationId(11L);
        failed.setRequestedConversationId(11L);
        failed.setRequestedConversationKnown(true);
        failed.setQuestion("问题");
        failed.setStatus("failed");
        failed.setAttemptCount(1);
        failed.setUpdatedAt(new Date());

        when(requestMapper.lockUser(8L)).thenReturn(8L);
        when(requestMapper.insertIgnore(any(PetCareRequest.class))).thenReturn(0);
        when(requestMapper.selectOne(any(Wrapper.class))).thenReturn(failed);
        when(requestMapper.retryFailed(eq(2L), any(Date.class))).thenReturn(1);

        PetCareRequestStore.Claim claim = store.claim(8L, "req-2", 11L, "问题");

        assertTrue(claim.isAcquired());
        assertFalse(claim.isNewTask());
        verify(requestMapper).retryFailed(eq(2L), any(Date.class));
    }

    @Test
    void legacyUnknownTaskCannotRetryAutomatically() {
        PetCareRequest legacy = new PetCareRequest();
        legacy.setId(3L);
        legacy.setUserId(8L);
        legacy.setRequestId("req-3");
        legacy.setConversationId(11L);
        legacy.setRequestedConversationId(11L);
        legacy.setRequestedConversationKnown(null);
        legacy.setQuestion("问题");
        legacy.setStatus("failed");
        legacy.setAttemptCount(1);
        legacy.setUpdatedAt(new Date());

        when(requestMapper.lockUser(8L)).thenReturn(8L);
        when(requestMapper.insertIgnore(any(PetCareRequest.class))).thenReturn(0);
        when(requestMapper.selectOne(any(Wrapper.class))).thenReturn(legacy);

        PetCareRequestStore.Claim claim = store.claim(8L, "req-3", 11L, "问题");

        assertFalse(claim.isAcquired());
        verify(requestMapper, never()).retryFailed(any(), any());
    }

    @Test
    void saveAnswerRequiresMatchingAttemptCount() {
        PetCareRequest running = new PetCareRequest();
        running.setId(4L);
        running.setUserId(8L);
        running.setRequestId("req-4");
        running.setStatus("running");
        running.setAttemptCount(2);

        when(requestMapper.selectOne(any(Wrapper.class))).thenReturn(running);
        when(requestMapper.saveAnswerIfAttempt(eq(4L), eq(2), any(), anyString(), any(Date.class)))
                .thenReturn(1);

        PetCareService.PetCareAnswer answer = new PetCareService.PetCareAnswer(
                "回答", "ai", "主题");
        store.saveAnswer(8L, "req-4", 2, answer);

        verify(requestMapper).saveAnswerIfAttempt(eq(4L), eq(2), any(), anyString(), any(Date.class));
    }

    @Test
    void saveAnswerWithMismatchedAttemptThrows409() {
        PetCareRequest running = new PetCareRequest();
        running.setId(5L);
        running.setUserId(8L);
        running.setRequestId("req-5");
        running.setStatus("running");
        running.setAttemptCount(3);

        when(requestMapper.selectOne(any(Wrapper.class))).thenReturn(running);
        when(requestMapper.saveAnswerIfAttempt(eq(5L), eq(2), any(), anyString(), any(Date.class)))
                .thenReturn(0);

        PetCareService.PetCareAnswer answer = new PetCareService.PetCareAnswer(
                "回答", "ai", "主题");

        CustomException ex = assertThrows(CustomException.class,
                () -> store.saveAnswer(8L, "req-5", 2, answer));
        assertEquals("409", ex.getCode());
        assertTrue(ex.getMessage().contains("租约已变化"));
    }

    @Test
    void conversationDeletionCancelsRelatedTasks() {
        when(requestMapper.cancelConversation(eq(8L), eq(11L), any(Date.class))).thenReturn(2);

        store.cancelConversation(8L, 11L);

        verify(requestMapper).cancelConversation(eq(8L), eq(11L), any(Date.class));
    }

    @Test
    void clearAllCancelsAllUserTasks() {
        when(requestMapper.cancelAll(eq(8L), any(Date.class))).thenReturn(5);

        store.cancelAll(8L);

        verify(requestMapper).cancelAll(eq(8L), any(Date.class));
    }

    @Test
    void conversationMismatchThrows409ForKnownTask() {
        PetCareRequest existing = new PetCareRequest();
        existing.setUserId(8L);
        existing.setRequestId("req-x");
        existing.setRequestedConversationId(11L);
        existing.setRequestedConversationKnown(true);
        existing.setQuestion("问题");
        existing.setStatus("completed");

        when(requestMapper.lockUser(8L)).thenReturn(8L);
        when(requestMapper.insertIgnore(any(PetCareRequest.class))).thenReturn(0);
        when(requestMapper.selectOne(any(Wrapper.class))).thenReturn(existing);

        CustomException ex = assertThrows(CustomException.class,
                () -> store.claim(8L, "req-x", 22L, "问题"));
        assertEquals("409", ex.getCode());
        assertTrue(ex.getMessage().contains("另一条问题或会话"));
    }

    @Test
    void legacyUnknownConversationIgnoresMismatch() {
        PetCareRequest legacy = new PetCareRequest();
        legacy.setUserId(8L);
        legacy.setRequestId("req-legacy");
        legacy.setRequestedConversationId(11L);
        legacy.setRequestedConversationKnown(null);
        legacy.setQuestion("问题");
        legacy.setStatus("completed");

        when(requestMapper.lockUser(8L)).thenReturn(8L);
        when(requestMapper.insertIgnore(any(PetCareRequest.class))).thenReturn(0);
        when(requestMapper.selectOne(any(Wrapper.class))).thenReturn(legacy);

        PetCareRequestStore.Claim claim = store.claim(8L, "req-legacy", 22L, "问题");

        assertFalse(claim.isAcquired());
        assertEquals("completed", claim.getRow().getStatus());
    }

    private static void initTable(Class<?> entity, String namespace) {
        if (TableInfoHelper.getTableInfo(entity) == null) {
            MapperBuilderAssistant assistant =
                    new MapperBuilderAssistant(new MybatisConfiguration(), namespace);
            TableInfoHelper.initTableInfo(assistant, entity);
        }
    }
}
