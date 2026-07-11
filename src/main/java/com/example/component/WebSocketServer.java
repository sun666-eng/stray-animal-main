package com.example.component;

import cn.hutool.json.JSONArray;
import cn.hutool.json.JSONObject;
import cn.hutool.json.JSONUtil;
import com.example.config.RedisConfig;
import com.example.common.JwtUtil;
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
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.Set;
import java.util.concurrent.atomic.AtomicBoolean;

@ServerEndpoint(value = "/api/imserver/{username}")
@Component
public class WebSocketServer {

    private static final Logger log = LoggerFactory.getLogger(WebSocketServer.class);

    private static final AtomicInteger onlineCount = new AtomicInteger(0);
    public static final Map<String, Set<Session>> sessionMap = new ConcurrentHashMap<>();
    private static final String SESSION_USERNAME = "authenticatedUsername";

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

    private void publishToRedis(String message) {
        if (!redisEnabled || staticRedisTemplate == null) {
            // Redis未启用，直接本地广播
            for (Set<Session> sessions : sessionMap.values()) {
                for (Session s : sessions) sendMessage(message, s);
            }
            return;
        }
        try {
            // 使用StringRedisSerializer发送，避免双重序列化
            staticRedisTemplate.convertAndSend(RedisConfig.CHAT_CHANNEL, message);
        } catch (Exception e) {
            log.error("发布消息到Redis失败，回退到本地广播", e);
            for (Set<Session> sessions : sessionMap.values()) {
                for (Session s : sessions) sendMessage(message, s);
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
        AtomicBoolean firstConnection = new AtomicBoolean(false);
        sessionMap.compute(username, (key, sessions) -> {
            if (sessions == null) {
                sessions = ConcurrentHashMap.newKeySet();
                firstConnection.set(true);
            }
            sessions.add(session);
            return sessions;
        });
        if (firstConnection.get()) {
            onlineCount.incrementAndGet();
        }
        log.info("有新用户加入，username={}, 当前在线人数为：{}", username, onlineCount.get());

        // 向新用户发送在线列表
        JSONObject result = new JSONObject();
        JSONArray array = new JSONArray();
        result.set("users", array);
        for (Object key : sessionMap.keySet()) {
            JSONObject jsonObject = new JSONObject();
            jsonObject.set("username", key);
            array.add(jsonObject);
        }
        sendMessage(JSONUtil.toJsonStr(result), session);

        // 通过Redis广播加入事件
        JSONObject joinNotice = new JSONObject();
        joinNotice.set("type", "join");
        joinNotice.set("username", username);
        publishToRedis(JSONUtil.toJsonStr(joinNotice));
    }

    @OnClose
    public void onClose(Session session, @PathParam("username") String ignoredTicket) {
        String actualUsername = getUsernameBySession(session);
        if (actualUsername == null) {
            return;
        }
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

        // 通过Redis广播离开事件
        JSONObject leaveNotice = new JSONObject();
        leaveNotice.set("type", "leave");
        leaveNotice.set("username", actualUsername);
        if (wentOffline.get()) {
            publishToRedis(JSONUtil.toJsonStr(leaveNotice));
        }
    }

    @OnMessage
    public void onMessage(String message, Session session, @PathParam("username") String ignoredTicket) {
        String username = getUsernameBySession(session);
        if (username == null || message == null || message.length() > 2000) {
            closeUnauthorized(session);
            return;
        }
        log.info("服务端收到用户username={}的聊天消息", username);
        JSONObject obj;
        try {
            obj = JSONUtil.parseObj(message);
        } catch (Exception e) {
            log.warn("忽略用户{}发送的非法聊天消息", username);
            return;
        }
        String text = obj.getStr("text");
        if (text == null || text.trim().isEmpty() || text.length() > 1000) {
            return;
        }
        String time = new SimpleDateFormat("yyyy-MM-dd HH:mm:ss").format(new Date());

        // 通过Redis广播消息
        JSONObject jsonObject = new JSONObject();
        jsonObject.set("from", username);
        jsonObject.set("text", text);
        jsonObject.set("time", time);
        jsonObject.set("type", "chat");
        publishToRedis(JSONUtil.toJsonStr(jsonObject));
    }

    @OnError
    public void onError(Session session, Throwable error) {
        log.error("WebSocket发生错误", error);
    }

    private void sendMessage(String message, Session toSession) {
        try {
            if (toSession.isOpen()) {
                toSession.getBasicRemote().sendText(message);
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
        User user = staticUserService.getById(userId);
        if (user != null) {
            staticUserService.fillPermissions(user);
        }
        return user;
    }

    private void closeUnauthorized(Session session) {
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
}
