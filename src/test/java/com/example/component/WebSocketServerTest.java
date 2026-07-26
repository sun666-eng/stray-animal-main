package com.example.component;

import com.example.entity.User;
import com.example.entity.Permission;
import com.example.service.UserService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import javax.websocket.RemoteEndpoint;
import javax.websocket.Session;
import javax.websocket.CloseReason;
import java.util.Map;
import java.util.Collections;
import java.util.concurrent.ConcurrentHashMap;
import java.util.Set;

import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class WebSocketServerTest {

    private WebSocketServer server;
    private UserService userService;

    @BeforeEach
    void setUp() {
        WebSocketServer.sessionMap.clear();
        server = new WebSocketServer();
        userService = mock(UserService.class);
        ReflectionTestUtils.setField(server, "userService", userService);
        ReflectionTestUtils.setField(server, "ticketService", mock(WebSocketTicketService.class));
        ReflectionTestUtils.setField(server, "redisEnabledFlag", false);
        server.init();
    }

    @AfterEach
    void tearDown() {
        WebSocketServer.sessionMap.clear();
    }

    @Test
    void directClientChatMessageIsNotBroadcast() throws Exception {
        User user = new User();
        user.setId(7L);
        user.setUsername("member");
        Permission permission = new Permission();
        permission.setFlag("im");
        user.setPermission(Collections.singletonList(permission));
        when(userService.getById(7L)).thenReturn(user);

        Session sender = session(7L, "member");
        Session recipient = session(8L, "other");
        RemoteEndpoint.Basic recipientRemote = recipient.getBasicRemote();
        WebSocketServer.sessionMap.computeIfAbsent("other", ignored -> ConcurrentHashMap.newKeySet())
                .add(recipient);

        server.onMessage("{\"type\":\"chat\",\"text\":\"must not broadcast\"}", sender, "ignored");

        verify(recipientRemote, never()).sendText(anyString());
    }

    @Test
    @SuppressWarnings("unchecked")
    void closeUserSessionsClosesEveryEstablishedSocketForUser() throws Exception {
        Session first = session(7L, "member");
        Session second = session(7L, "member");
        Map<Long, Set<Session>> userSessions = (Map<Long, Set<Session>>) ReflectionTestUtils.getField(
                WebSocketServer.class, "userSessionMap");
        Set<Session> sessions = ConcurrentHashMap.newKeySet();
        sessions.add(first);
        sessions.add(second);
        userSessions.put(7L, sessions);

        WebSocketServer.closeUserSessions(7L);

        verify(first).close(org.mockito.ArgumentMatchers.any(CloseReason.class));
        verify(second).close(org.mockito.ArgumentMatchers.any(CloseReason.class));
    }

    private static Session session(Long userId, String username) {
        Session session = mock(Session.class);
        RemoteEndpoint.Basic remote = mock(RemoteEndpoint.Basic.class);
        Map<String, Object> properties = new ConcurrentHashMap<>();
        properties.put("authenticatedUserId", userId);
        properties.put("authenticatedUsername", username);
        when(session.getUserProperties()).thenReturn(properties);
        when(session.getBasicRemote()).thenReturn(remote);
        when(session.isOpen()).thenReturn(true);
        return session;
    }
}
