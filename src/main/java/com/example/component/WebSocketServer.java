package com.example.component;

import cn.hutool.json.JSONArray;
import cn.hutool.json.JSONObject;
import cn.hutool.json.JSONUtil;
import com.example.common.PermissionUtil;
import com.example.config.RedisConfig;
import com.example.dto.ChatMessageDTO;
import com.example.entity.User;
import com.example.service.UserService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

import javax.annotation.PostConstruct;
import javax.websocket.*;
import javax.websocket.server.PathParam;
import javax.websocket.server.ServerEndpoint;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.Set;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * 路径参数为一次性 ws-ticket（历史命名 username）。
 * 容器按连接实例化本类，依赖通过 {@link #init()} 写入静态字段供各实例共享。
 */
@ServerEndpoint("/api/imserver/{username}")
@Component
public class WebSocketServer {

    private static final Logger log = LoggerFactory.getLogger(WebSocketServer.class);

    private static final AtomicInteger onlineCount = new AtomicInteger(0);
    public static final Map<String, Set<Session>> sessionMap = new ConcurrentHashMap<>();
    private static final Map<Long, Set<Session>> userSessionMap = new ConcurrentHashMap<>();
    private static final String SESSION_USERNAME = "authenticatedUsername";
    private static final String SESSION_USER_ID = "authenticatedUserId";

    private static StringRedisTemplate staticRedisTemplate;
    private static UserService staticUserService;
    private static WebSocketTicketService staticTicketService;
    private static boolean redisEnabled = false;

    @Autowired(required = false)
    private StringRedisTemplate redisTemplate;

    @Autowired
    private UserService userService;

    @Autowired
    private WebSocketTicketService ticketService;

    @org.springframework.beans.factory.annotation.Value("${app.redis.enabled:false}")
    private boolean redisEnabledFlag;

    @PostConstruct
    public void init() {
        staticRedisTemplate = this.redisTemplate;
        staticUserService = this.userService;
        staticTicketService = this.ticketService;
        redisEnabled = redisEnabledFlag && this.redisTemplate != null;
        log.info("Redis pub/sub模式: {}", redisEnabled ? "启用" : "禁用(使用本地广播)");
    }

    public static void publishServerEvent(String message) {
        broadcastToAuthenticatedClients(message);
    }

    public static void publishChatMessage(ChatMessageDTO message) {
        String clientEvent = chatClientEvent(message);
        if (!redisEnabled || staticRedisTemplate == null) {
            broadcastToAuthenticatedClients(clientEvent);
            return;
        }
        try {
            JSONObject canonicalEvent = new JSONObject();
            canonicalEvent.set("type", RedisConfig.CHAT_EVENT_TYPE);
            canonicalEvent.set("messageId", message.getId());
            staticRedisTemplate.convertAndSend(RedisConfig.CHAT_CHANNEL, JSONUtil.toJsonStr(canonicalEvent));
        } catch (Exception e) {
            log.error("发布消息到Redis失败，回退到本地广播", e);
            broadcastToAuthenticatedClients(clientEvent);
        }
    }

    public static String chatClientEvent(ChatMessageDTO message) {
        JSONObject event = new JSONObject();
        event.set("type", "chat");
        event.set("id", message.getId());
        event.set("username", message.getUsername());
        event.set("text", message.getText());
        event.set("createdTime", message.getCreatedTime());
        return JSONUtil.toJsonStr(event);
    }

    public static void broadcastToAuthenticatedClients(String message) {
        for (Set<Session> sessions : sessionMap.values()) {
            for (Session session : sessions) {
                Long userId = getUserIdBySession(session);
                if (loadAuthorizedUser(userId) == null) {
                    closeUnauthorized(session);
                    continue;
                }
                sendMessage(message, session);
            }
        }
    }

    @OnOpen
    public void onOpen(Session session, @PathParam("username") String ticket) {
        User user = authenticate(ticket);
        if (user == null) {
            closeUnauthorized(session);
            return;
        }
        String username = user.getUsername();
        session.getUserProperties().put(SESSION_USERNAME, username);
        session.getUserProperties().put(SESSION_USER_ID, user.getId());
        AtomicBoolean firstConnection = new AtomicBoolean(false);
        sessionMap.compute(username, (key, sessions) -> {
            if (sessions == null) {
                sessions = ConcurrentHashMap.newKeySet();
                firstConnection.set(true);
            }
            sessions.add(session);
            return sessions;
        });
        userSessionMap.computeIfAbsent(user.getId(), ignored -> ConcurrentHashMap.newKeySet()).add(session);
        if (firstConnection.get()) {
            onlineCount.incrementAndGet();
        }
        log.info("有新用户加入，username={}, 当前在线人数为：{}", username, onlineCount.get());

        // B4：不向客户端下发完整在线用户名列表（防枚举）；仅下发人数
        JSONObject result = new JSONObject();
        result.set("type", "online");
        result.set("onlineCount", onlineCount.get());
        result.set("users", new JSONArray());
        sendMessage(JSONUtil.toJsonStr(result), session);

        // 广播上下线仅通知人数变化，不暴露 username
        JSONObject joinNotice = new JSONObject();
        joinNotice.set("type", "join");
        joinNotice.set("onlineCount", onlineCount.get());
        publishServerEvent(JSONUtil.toJsonStr(joinNotice));
    }

    @OnClose
    public void onClose(Session session, @PathParam("username") String ignoredTicket) {
        String actualUsername = getUsernameBySession(session);
        if (actualUsername == null) {
            return;
        }
        removeUserSession(session);
        AtomicBoolean wentOffline = new AtomicBoolean(false);
        sessionMap.computeIfPresent(actualUsername, (key, sessions) -> {
            sessions.remove(session);
            if (sessions.isEmpty()) {
                wentOffline.set(true);
                return null;
            }
            return sessions;
        });
        if (wentOffline.get()) {
            onlineCount.decrementAndGet();
        }
        log.info("有一连接关闭，移除username={}的用户session, 当前在线人数为：{}", actualUsername, onlineCount.get());

        // 广播离开：仅人数，不暴露 username
        if (wentOffline.get()) {
            JSONObject leaveNotice = new JSONObject();
            leaveNotice.set("type", "leave");
            leaveNotice.set("onlineCount", onlineCount.get());
            publishServerEvent(JSONUtil.toJsonStr(leaveNotice));
        }
    }

    @OnMessage
    public void onMessage(String message, Session session, @PathParam("username") String ignoredTicket) {
        String username = getUsernameBySession(session);
        if (username == null || message == null || message.length() > 2000) {
            closeUnauthorized(session);
            return;
        }
        Long userId = getUserIdBySession(session);
        if (loadAuthorizedUser(userId) == null) {
            closeUnauthorized(session);
            return;
        }
        JSONObject obj;
        try {
            obj = JSONUtil.parseObj(message);
        } catch (Exception e) {
            log.warn("忽略用户{}发送的非法WebSocket消息", username);
            return;
        }
        if ("ping".equalsIgnoreCase(obj.getStr("type"))) {
            JSONObject pong = new JSONObject();
            pong.set("type", "pong");
            sendMessage(JSONUtil.toJsonStr(pong), session);
        }
        // Client messages are never persisted or broadcast. POST /api/help/chat is authoritative.
    }

    @OnError
    public void onError(Session session, Throwable error) {
        log.error("WebSocket发生错误", error);
    }

    private static void sendMessage(String message, Session toSession) {
        try {
            // getBasicRemote 非线程安全，并发广播同一 Session 会抛 TEXT_FULL_WRITING 丢消息
            synchronized (toSession) {
                if (toSession.isOpen()) {
                    toSession.getBasicRemote().sendText(message);
                }
            }
        } catch (Exception e) {
            log.error("服务端发送消息给客户端失败", e);
        }
    }

    private User authenticate(String ticket) {
        if (staticTicketService == null || staticUserService == null) {
            return null;
        }
        Long userId = staticTicketService.consume(ticket);
        if (userId == null) return null;
        return loadAuthorizedUser(userId);
    }

    private static void closeUnauthorized(Session session) {
        try {
            session.close(new CloseReason(CloseReason.CloseCodes.VIOLATED_POLICY, "unauthorized"));
        } catch (Exception e) {
            log.warn("关闭未认证WebSocket连接失败", e);
        }
    }

    private String getUsernameBySession(Session session) {
        Object value = session == null ? null : session.getUserProperties().get(SESSION_USERNAME);
        return value instanceof String ? (String) value : null;
    }

    public static void closeUserSessions(Long userId) {
        if (userId == null) {
            return;
        }
        Set<Session> sessions = userSessionMap.remove(userId);
        if (sessions == null) {
            return;
        }
        for (Session session : sessions) {
            try {
                session.close(new CloseReason(CloseReason.CloseCodes.NORMAL_CLOSURE, "logout"));
            } catch (Exception e) {
                log.warn("关闭已登出用户WebSocket连接失败, userId={}", userId, e);
            }
        }
    }

    private static void removeUserSession(Session session) {
        Long userId = getUserIdBySession(session);
        if (userId == null) {
            return;
        }
        userSessionMap.computeIfPresent(userId, (key, sessions) -> {
            sessions.remove(session);
            return sessions.isEmpty() ? null : sessions;
        });
    }

    private static Long getUserIdBySession(Session session) {
        Object value = session == null ? null : session.getUserProperties().get(SESSION_USER_ID);
        return value instanceof Number ? ((Number) value).longValue() : null;
    }

    private static User loadAuthorizedUser(Long userId) {
        if (userId == null || staticUserService == null) {
            return null;
        }
        User user = staticUserService.getById(userId);
        if (user == null) {
            return null;
        }
        staticUserService.fillPermissions(user);
        return PermissionUtil.hasAnyFlag(user, "im", "help", "rescue") ? user : null;
    }
}
