package com.example.controller;

import com.example.common.Result;
import com.example.entity.User;
import com.example.exception.CustomException;
import com.example.service.PetCareAiConfigService;
import com.example.service.PetCareConversationService;
import com.example.service.PetCareHistoryService;
import com.example.service.PetCareService;
import com.example.service.PetCareTaskService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.test.util.ReflectionTestUtils;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.mockito.ArgumentMatchers.any;

class PetCareControllerTest {

    private PetCareController controller;
    private PetCareService service;
    private PetCareHistoryService historyService;
    private PetCareAiConfigService aiConfigService;
    private PetCareConversationService conversationService;
    private PetCareTaskService taskService;

    @BeforeEach
    void setUp() {
        controller = new PetCareController();
        service = mock(PetCareService.class);
        historyService = mock(PetCareHistoryService.class);
        aiConfigService = mock(PetCareAiConfigService.class);
        conversationService = mock(PetCareConversationService.class);
        taskService = mock(PetCareTaskService.class);
        ReflectionTestUtils.setField(controller, "petCareService", service);
        ReflectionTestUtils.setField(controller, "petCareHistoryService", historyService);
        ReflectionTestUtils.setField(controller, "petCareAiConfigService", aiConfigService);
        ReflectionTestUtils.setField(controller, "petCareConversationService", conversationService);
        ReflectionTestUtils.setField(controller, "petCareTaskService", taskService);
    }

    @Test
    void askUsesAuthenticatedSessionIdentity() {
        PetCareController.AskRequest body = new PetCareController.AskRequest();
        body.setRequestId("req-001");
        body.setQuestion("我领养的猫应该注意什么？");
        PetCareTaskService.TaskView taskView = new PetCareTaskService.TaskView(
                "req-001", "completed", "回答", "ai", "", "领养过渡",
                "[]", 70L, "猫咪照顾", null, null);
        when(taskService.ask(42L, body.getRequestId(), null, body.getQuestion().trim()))
                .thenReturn(taskView);

        Result<PetCareTaskService.TaskView> result =
                controller.ask(body, requestWith(user(42L)));

        assertEquals("0", result.getCode());
        assertEquals(70L, result.getData().getConversationId());
        verify(taskService).ask(42L, body.getRequestId(), null, body.getQuestion().trim());
    }

    @Test
    void historyAndClearUseOnlyAuthenticatedSessionIdentity() {
        MockHttpServletRequest first = requestWith(user(8L));
        MockHttpServletRequest second = requestWith(user(9L));
        when(historyService.history(8L, 25))
                .thenReturn(new PetCareHistoryService.HistorySnapshot(0, java.util.Collections.emptyList()));
        when(historyService.history(9L, 25))
                .thenReturn(new PetCareHistoryService.HistorySnapshot(0, java.util.Collections.emptyList()));
        when(conversationService.clearAll(8L)).thenReturn(true);

        assertEquals("0", controller.history(25, first).getCode());
        assertEquals("0", controller.history(25, second).getCode());
        assertEquals(Boolean.TRUE, controller.clearHistory(first).getData());

        verify(historyService).history(8L, 25);
        verify(historyService).history(9L, 25);
        verify(conversationService).clearAll(8L);
    }

    @Test
    void ordinaryUserCanSaveConfigAndReloadItByAccount() {
        MockHttpServletRequest firstLogin = requestWith(user(8L));
        MockHttpServletRequest secondLogin = requestWith(user(8L));
        MockHttpServletRequest otherUser = requestWith(user(9L));
        PetCareController.AiConfigRequest body = new PetCareController.AiConfigRequest();
        body.setEnabled(true);
        body.setBaseUrl("https://api.example.com/v1");
        body.setModel("model");
        body.setApiKey("secret");
        PetCareService.AiConnectionConfig personal = mock(PetCareService.AiConnectionConfig.class);
        when(personal.isEnabled()).thenReturn(true);
        when(aiConfigService.save(8L, true, body.getBaseUrl(), body.getModel(), body.getApiKey()))
                .thenReturn(personal);
        when(aiConfigService.find(8L)).thenReturn(personal);
        when(aiConfigService.find(9L)).thenReturn(null);

        assertEquals("0", controller.updateConfig(body, firstLogin).getCode());
        assertSame(personal, aiConfigService.find(8L));

        controller.config(secondLogin);
        controller.config(otherUser);
        verify(service, times(2)).aiConfigStatus(personal);
        verify(service).aiConfigStatus(null);
    }

    @Test
    void askUsesOnlyConfigFromCurrentAccount() {
        MockHttpServletRequest firstUser = requestWith(user(8L));
        MockHttpServletRequest secondUser = requestWith(user(9L));
        PetCareController.AskRequest body = new PetCareController.AskRequest();
        body.setRequestId("req-001");
        body.setQuestion("疫苗怎么安排？");
        PetCareTaskService.TaskView taskView1 = new PetCareTaskService.TaskView(
                "req-001", "completed", "个人回答", "ai", "", "疫苗驱虫",
                "[]", 1L, "疫苗", null, null);
        PetCareTaskService.TaskView taskView2 = new PetCareTaskService.TaskView(
                "req-001", "completed", "平台回答", "local", "", "疫苗驱虫",
                "[]", 1L, "疫苗", null, null);
        when(taskService.ask(8L, body.getRequestId(), null, body.getQuestion().trim()))
                .thenReturn(taskView1);
        when(taskService.ask(9L, body.getRequestId(), null, body.getQuestion().trim()))
                .thenReturn(taskView2);

        controller.ask(body, firstUser);
        controller.ask(body, secondUser);

        verify(taskService).ask(8L, body.getRequestId(), null, body.getQuestion().trim());
        verify(taskService).ask(9L, body.getRequestId(), null, body.getQuestion().trim());
    }

    @Test
    void clearConfigRemovesOnlyCurrentAccountValue() {
        MockHttpServletRequest request = requestWith(user(8L));

        assertEquals("0", controller.clearConfig(request).getCode());
        verify(aiConfigService).clear(8L);
        verify(service).aiConfigStatus(null);
    }

    @Test
    void anonymousCannotTestConnection() {
        CustomException denied = assertThrows(CustomException.class,
                () -> controller.testConfig(new MockHttpServletRequest()));
        assertEquals("401", denied.getCode());
    }

    @Test
    void rejectedProviderKeyIsPersistedAsFailedInsteadOfConnected() {
        PetCareService.AiConnectionConfig config =
                mock(PetCareService.AiConnectionConfig.class);
        when(aiConfigService.find(8L)).thenReturn(config);
        doThrow(new CustomException("502", "服务商拒绝 API Key（HTTP 401）"))
                .when(service).testAiConnection(8L, config);

        CustomException rejected = assertThrows(CustomException.class,
                () -> controller.testConfig(requestWith(user(8L))));

        assertEquals("502", rejected.getCode());
        verify(aiConfigService).markConnection(
                8L, 0L, PetCareAiConfigService.STATUS_FAILED,
                "服务商拒绝 API Key（HTTP 401）");
        verify(service, never()).aiConfigStatus(any());
    }

    @Test
    void savedConfigIsAutoTestedOnlyOncePerLoginSession() {
        MockHttpServletRequest request = requestWith(user(8L));
        PetCareService.AiConnectionConfig saved =
                mock(PetCareService.AiConnectionConfig.class);
        PetCareService.AiConnectionConfig connected =
                mock(PetCareService.AiConnectionConfig.class);
        PetCareService.AiConfigStatus ready =
                mock(PetCareService.AiConfigStatus.class);
        PetCareService.AiConfigStatus success =
                mock(PetCareService.AiConfigStatus.class);
        when(ready.isPersonalConfigured()).thenReturn(true);
        when(ready.isEnabled()).thenReturn(true);
        when(ready.isReady()).thenReturn(true);
        when(aiConfigService.find(8L)).thenReturn(saved);
        when(service.aiConfigStatus(saved)).thenReturn(ready);
        when(aiConfigService.markConnection(
                8L, 0L, PetCareAiConfigService.STATUS_CONNECTED,
                "登录后自动连接测试成功")).thenReturn(connected);
        when(service.aiConfigStatus(connected)).thenReturn(success);

        assertSame(success, controller.autoTestConfig(request).getData());
        assertSame(ready, controller.autoTestConfig(request).getData());

        verify(service, times(1)).testAiConnection(8L, saved);
        verify(aiConfigService, times(1)).markConnection(
                8L, 0L, PetCareAiConfigService.STATUS_CONNECTED,
                "登录后自动连接测试成功");
    }

    @Test
    void automaticProviderFailureUpdatesStatusWithoutBreakingPageLoad() {
        MockHttpServletRequest request = requestWith(user(8L));
        PetCareService.AiConnectionConfig saved =
                mock(PetCareService.AiConnectionConfig.class);
        PetCareService.AiConnectionConfig failed =
                mock(PetCareService.AiConnectionConfig.class);
        PetCareService.AiConfigStatus ready =
                mock(PetCareService.AiConfigStatus.class);
        PetCareService.AiConfigStatus failedStatus =
                mock(PetCareService.AiConfigStatus.class);
        when(ready.isPersonalConfigured()).thenReturn(true);
        when(ready.isEnabled()).thenReturn(true);
        when(ready.isReady()).thenReturn(true);
        when(aiConfigService.find(8L)).thenReturn(saved, failed);
        when(service.aiConfigStatus(saved)).thenReturn(ready);
        when(service.aiConfigStatus(failed)).thenReturn(failedStatus);
        doThrow(new CustomException("502", "服务商拒绝 API Key（HTTP 401）"))
                .when(service).testAiConnection(8L, saved);

        assertSame(failedStatus, controller.autoTestConfig(request).getData());
        verify(aiConfigService).markConnection(
                8L, 0L, PetCareAiConfigService.STATUS_FAILED,
                "服务商拒绝 API Key（HTTP 401）");
    }

    private static User user(Long id) {
        User user = new User();
        user.setId(id);
        user.setUsername("user-" + id);
        return user;
    }

    private static MockHttpServletRequest requestWith(User user) {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.getSession(true).setAttribute("user", user);
        return request;
    }
}
