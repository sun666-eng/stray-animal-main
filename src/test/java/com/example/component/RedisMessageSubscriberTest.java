package com.example.component;

import cn.hutool.json.JSONObject;
import cn.hutool.json.JSONUtil;
import com.example.dto.ChatMessageDTO;
import com.example.entity.Permission;
import com.example.entity.User;
import com.example.service.HelpService;
import com.example.service.UserService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;

import javax.websocket.RemoteEndpoint;
import javax.websocket.Session;
import java.util.Collections;
import java.util.Date;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class RedisMessageSubscriberTest {

    private RedisMessageSubscriber subscriber;
    private HelpService helpService;
    private RemoteEndpoint.Basic remote;

    @BeforeEach
    void setUp() {
        WebSocketServer.sessionMap.clear();
        helpService = mock(HelpService.class);
        subscriber = new RedisMessageSubscriber();
        ReflectionTestUtils.setField(subscriber, "helpService", helpService);

        UserService userService = mock(UserService.class);
        User user = new User();
        user.setId(7L);
        Permission permission = new Permission();
        permission.setFlag("im");
        user.setPermission(Collections.singletonList(permission));
        when(userService.getById(7L)).thenReturn(user);
        WebSocketServer server = new WebSocketServer();
        ReflectionTestUtils.setField(server, "userService", userService);
        ReflectionTestUtils.setField(server, "ticketService", mock(WebSocketTicketService.class));
        ReflectionTestUtils.setField(server, "redisEnabledFlag", false);
        server.init();

        Session session = mock(Session.class);
        remote = mock(RemoteEndpoint.Basic.class);
        Map<String, Object> properties = new ConcurrentHashMap<>();
        properties.put("authenticatedUserId", 7L);
        when(session.getUserProperties()).thenReturn(properties);
        when(session.isOpen()).thenReturn(true);
        when(session.getBasicRemote()).thenReturn(remote);
        WebSocketServer.sessionMap.computeIfAbsent("member", ignored -> ConcurrentHashMap.newKeySet()).add(session);
    }

    @AfterEach
    void tearDown() {
        WebSocketServer.sessionMap.clear();
    }

    @Test
    void rawAndNonCanonicalPayloadsAreIgnored() throws Exception {
        subscriber.handleBody("{\"type\":\"chat\",\"id\":44,\"text\":\"forged\"}");
        subscriber.handleBody("not-json");

        verify(helpService, never()).getPersistedChatMessage(anyLong());
        verify(remote, never()).sendText(org.mockito.ArgumentMatchers.anyString());
    }

    @Test
    void canonicalReferenceIsReconstructedFromDatabaseDto() throws Exception {
        ChatMessageDTO persisted = new ChatMessageDTO();
        persisted.setId(44L);
        persisted.setUsername("database-user");
        persisted.setText("database-text");
        persisted.setCreatedTime(new Date(1234L));
        when(helpService.getPersistedChatMessage(44L)).thenReturn(persisted);

        subscriber.handleBody("{\"type\":\"persisted-chat-message\",\"messageId\":44,\"username\":\"forged\",\"text\":\"forged\"}");

        ArgumentCaptor<String> payload = ArgumentCaptor.forClass(String.class);
        verify(remote).sendText(payload.capture());
        JSONObject event = JSONUtil.parseObj(payload.getValue());
        assertEquals("chat", event.getStr("type"));
        assertEquals(Long.valueOf(44L), event.getLong("id"));
        assertEquals("database-user", event.getStr("username"));
        assertEquals("database-text", event.getStr("text"));
        assertFalse(payload.getValue().contains("forged"));
    }
}
