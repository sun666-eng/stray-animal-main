package com.example.service;

import com.example.entity.Permission;
import com.example.entity.User;
import com.example.exception.CustomException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.Collections;
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
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class AdminAgentServiceTest {

    @Mock AdminAgentRepository repository;
    @Mock AdminAgentTools tools;
    @Mock AdminAgentClient client;
    @Mock PetCareConfigCrypto crypto;
    @Mock PetCareService petCareService;
    @Mock UserService userService;
    AdminAgentService service;

    @BeforeEach
    void setUp() {
        service = new AdminAgentService(repository, tools, client, crypto, petCareService, userService);
    }

    @Test
    void rejectsUserWithoutDedicatedPermission() {
        User user = userWithPermission("animal");
        CustomException error = assertThrows(CustomException.class, () -> service.status(user));
        assertEquals("403", error.getCode());
        verify(repository, never()).findConfig();
    }

    @Test
    void repeatedRequestIdReturnsStoredTurnWithoutAnotherPaidCall() {
        User user = userWithPermission("admin_agent");
        AdminAgentRepository.TurnItem turn = new AdminAgentRepository.TurnItem(
                5L, "stable-request", "待办？", "已有回答", "[]", new Date(), new Date());
        AdminAgentRepository.TurnResult stored = new AdminAgentRepository.TurnResult(3L, "待办", turn);
        when(repository.findByRequestId(9L, "stable-request")).thenReturn(stored);

        AdminAgentRepository.TurnResult result = service.ask(user, "stable-request", null, "待办？");

        assertSame(stored, result);
        verify(client, never()).ask(any(), any(), any(), any());
        verify(repository, never()).recordTurn(any(), any(), any(), any(), any(), any());
    }

    @Test
    void repeatedRequestIdCannotBeReusedForDifferentQuestion() {
        User user = userWithPermission("admin_agent");
        AdminAgentRepository.TurnItem turn = new AdminAgentRepository.TurnItem(
                5L, "stable-request", "原问题", "已有回答", "[]", new Date(), new Date());
        when(repository.findByRequestId(9L, "stable-request"))
                .thenReturn(new AdminAgentRepository.TurnResult(3L, "原问题", turn));

        CustomException error = assertThrows(CustomException.class,
                () -> service.ask(user, "stable-request", null, "另一问题"));

        assertEquals("409", error.getCode());
        verify(client, never()).ask(any(), any(), any(), any());
    }

    @Test
    void concurrentSameRequestUsesOnePaidModelCall() throws Exception {
        User user = userWithPermission("admin_agent");
        CountDownLatch secondLookup = new CountDownLatch(1);
        AtomicInteger lookups = new AtomicInteger();
        when(repository.findByRequestId(9L, "same-request")).thenAnswer(invocation -> {
            if (lookups.incrementAndGet() >= 3) secondLookup.countDown();
            return null;
        });
        when(repository.findConfig()).thenReturn(new AdminAgentRepository.ConfigRow(
                true, "https://api.example.com", "model", "cipher", "connected", "ok", new Date(),
                1L, new Date(), new Date()));
        when(crypto.decryptAdminAgent("cipher")).thenReturn("sk-secret");
        CountDownLatch entered = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        when(client.ask(any(), any(), any(), any())).thenAnswer(invocation -> {
            entered.countDown();
            release.await(3, TimeUnit.SECONDS);
            return new AdminAgentClient.AgentAnswer("回答", Collections.singletonList("get_management_overview"));
        });
        AdminAgentRepository.TurnItem turn = new AdminAgentRepository.TurnItem(
                6L, "same-request", "汇总待办", "回答", "[]", new Date(), new Date());
        AdminAgentRepository.TurnResult stored = new AdminAgentRepository.TurnResult(4L, "汇总待办", turn);
        when(repository.recordTurn(any(), any(), any(), any(), any(), any())).thenReturn(stored);
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            Future<AdminAgentRepository.TurnResult> first = pool.submit(
                    () -> service.ask(user, "same-request", null, "汇总待办"));
            entered.await(2, TimeUnit.SECONDS);
            Future<AdminAgentRepository.TurnResult> second = pool.submit(
                    () -> service.ask(user, "same-request", null, "汇总待办"));
            secondLookup.await(2, TimeUnit.SECONDS);
            release.countDown();

            assertSame(stored, first.get(3, TimeUnit.SECONDS));
            assertSame(stored, second.get(3, TimeUnit.SECONDS));
            verify(client, times(1)).ask(any(), any(), any(), any());
        } finally {
            pool.shutdownNow();
        }
    }

    @Test
    void refusesPaidCallUntilPersistedConfigurationPassedRealTest() {
        User user = userWithPermission("admin_agent");
        when(repository.findConfig()).thenReturn(new AdminAgentRepository.ConfigRow(
                true, "https://api.example.com", "model", "cipher", "untested", "", null,
                1L, new Date(), new Date()));
        when(crypto.decryptAdminAgent("cipher")).thenReturn("sk-secret");

        CustomException error = assertThrows(CustomException.class,
                () -> service.ask(user, "request-1", null, "汇总当前待办"));

        assertEquals("503", error.getCode());
        verify(client, never()).ask(any(), any(), any(), any());
    }

    @Test
    void realProviderFailureRevokesConnectedBadge() {
        User user = userWithPermission("admin_agent");
        when(repository.findConfig()).thenReturn(new AdminAgentRepository.ConfigRow(
                true, "https://api.example.com", "model", "cipher", "connected", "ok", new Date(),
                7L, new Date(), new Date()));
        when(crypto.decryptAdminAgent("cipher")).thenReturn("sk-secret");
        doThrow(new CustomException("502", "模型服务拒绝 API Key"))
                .when(client).ask(any(), any(), any(), any());

        CustomException error = assertThrows(CustomException.class,
                () -> service.ask(user, "provider-failed", null, "汇总待办"));

        assertEquals("502", error.getCode());
        verify(repository).markConnection(7L, "failed", "模型服务拒绝 API Key");
    }

    @Test
    void modelToolProtocolFailureDoesNotRevokeVerifiedConnection() {
        User user = userWithPermission("admin_agent");
        when(repository.findConfig()).thenReturn(new AdminAgentRepository.ConfigRow(
                true, "https://api.example.com", "model", "cipher", "connected", "ok", new Date(),
                7L, new Date(), new Date()));
        when(crypto.decryptAdminAgent("cipher")).thenReturn("sk-secret");
        doThrow(new CustomException("422", "AI 单轮请求的工具过多，请缩小问题范围后重试"))
                .when(client).ask(any(), any(), any(), any());

        CustomException error = assertThrows(CustomException.class,
                () -> service.ask(user, "protocol-failed", null, "汇总所有模块"));

        assertEquals("422", error.getCode());
        verify(repository, never()).markConnection(anyLong(), any(), any());
    }

    private static User userWithPermission(String flag) {
        User user = new User(); user.setId(9L);
        Permission permission = new Permission(); permission.setFlag(flag);
        user.setPermission(Collections.singletonList(permission));
        return user;
    }
}
