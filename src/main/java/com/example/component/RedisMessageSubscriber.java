package com.example.component;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.data.redis.connection.Message;
import org.springframework.data.redis.connection.MessageListener;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

import javax.annotation.Resource;
import javax.websocket.Session;
import java.util.Map;

@Component
@ConditionalOnProperty(name = "redis.enabled", havingValue = "true")
public class RedisMessageSubscriber implements MessageListener {

    private static final Logger log = LoggerFactory.getLogger(RedisMessageSubscriber.class);

    @Resource
    private StringRedisTemplate stringRedisTemplate;

    @Override
    public void onMessage(Message message, byte[] pattern) {
        try {
            String body = stringRedisTemplate.getStringSerializer().deserialize(message.getBody());
            log.info("Redis收到消息: {}", body);
            if (body != null && body.startsWith("{")) {
                broadcastToWebSocketClients(body);
            }
        } catch (Exception e) {
            log.error("处理Redis消息异常", e);
        }
    }

    private void broadcastToWebSocketClients(String message) {
        Map<String, Session> sessionMap = WebSocketServer.sessionMap;
        int successCount = 0;
        for (Map.Entry<String, Session> entry : sessionMap.entrySet()) {
            try {
                Session session = entry.getValue();
                if (session.isOpen()) {
                    session.getBasicRemote().sendText(message);
                    successCount++;
                }
            } catch (Exception e) {
                log.error("发送消息给用户{}失败", entry.getKey(), e);
            }
        }
        log.info("广播消息完成，成功发送给{}个用户", successCount);
    }
}
