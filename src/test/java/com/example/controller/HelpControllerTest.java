package com.example.controller;

import com.baomidou.mybatisplus.core.metadata.IPage;
import com.example.common.Result;
import com.example.dto.ChatMessageDTO;
import com.example.dto.ChatMessageRequest;
import com.example.entity.Help;
import com.example.entity.User;
import com.example.service.HelpService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.Collections;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class HelpControllerTest {

    private HelpController controller;
    private HelpService service;

    @BeforeEach
    void setUp() {
        controller = new HelpController();
        service = mock(HelpService.class);
        ReflectionTestUtils.setField(controller, "helpService", service);
        when(service.page(any(IPage.class), any())).thenAnswer(invocation -> invocation.getArgument(0));
    }

    @Test
    void chatUsesAuthenticatedIdentityAndTextOnlyRequest() {
        User user = user(7L, "actual-user");
        ChatMessageRequest requestBody = new ChatMessageRequest();
        requestBody.setText("hello");
        ChatMessageDTO canonical = new ChatMessageDTO();
        canonical.setId(8L);
        when(service.submitChatMessage("hello", user)).thenReturn(canonical);

        Result<ChatMessageDTO> result = controller.saveChatMessage(requestBody, requestWith(user));

        assertEquals(Long.valueOf(8L), result.getData().getId());
        verify(service).submitChatMessage("hello", user);
    }

    @Test
    void adminAndMinePaginationAreCappedAtFifty() {
        User manager = user(1L, "manager");
        com.example.entity.Permission permission = new com.example.entity.Permission();
        permission.setFlag("rescue");
        manager.setPermission(Collections.singletonList(permission));

        controller.findPage("", 0, 500, requestWith(manager));
        ArgumentCaptor<IPage> page = ArgumentCaptor.forClass(IPage.class);
        verify(service).page(page.capture(), any());
        assertEquals(1L, page.getValue().getCurrent());
        assertEquals(50L, page.getValue().getSize());

        controller.findMine(1L, 1, 1000, requestWith(manager));
        verify(service, org.mockito.Mockito.times(2)).page(page.capture(), any());
        assertEquals(50L, page.getAllValues().get(2).getSize());

        controller.findPage("", Integer.MAX_VALUE, 10, requestWith(manager));
        verify(service, org.mockito.Mockito.times(3)).page(page.capture(), any());
        assertEquals(10_000L, page.getAllValues().get(page.getAllValues().size() - 1).getCurrent());
    }

    @Test
    void ownerCanReadOwnDetailButChatRecordIsHidden() {
        User owner = user(7L, "owner");
        Help help = new Help();
        help.setId(9L);
        help.setUid(7L);
        help.setTitle("救助请求");
        when(service.getById(9L)).thenReturn(help);
        assertEquals("0", controller.findById(9L, requestWith(owner)).getCode());

        help.setTitle(HelpService.CHAT_TITLE);
        assertEquals("404", controller.findById(9L, requestWith(owner)).getCode());
    }

    private static User user(Long id, String name) {
        User user = new User();
        user.setId(id);
        user.setUsername(name);
        return user;
    }

    private static MockHttpServletRequest requestWith(User user) {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.getSession(true).setAttribute("user", user);
        return request;
    }
}
