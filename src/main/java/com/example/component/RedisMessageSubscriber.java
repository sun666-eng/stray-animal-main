package com.example.component;

import cn.hutool.json.JSONObject;
import cn.hutool.json.JSONUtil;
import com.example.config.RedisConfig;
import com.example.dto.ChatMessageDTO;
import com.example.service.HelpService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.data.redis.connection.Message;
import org.springframework.data.redis.connection.MessageListener;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

import jakarta.annotation.Resource;

@Component
@ConditionalOnProperty(name = "app.redis.enabled", havingValue = "true")
public class RedisMessageSubscriber implements MessageListener {

    private static final Logger log = LoggerFactory.getLogger(RedisMessageSubscriber.class);

    @Resource
    private StringRedisTemplate stringRedisTemplate;

    @Resource
    private HelpService helpService;

    @Override
    public void onMessage(Message message, byte[] pattern) {
        try {
            String body = stringRedisTemplate.getStringSerializer().deserialize(message.getBody());
            handleBody(body);
        } catch (Exception e) {
            log.warn("忽略无效Redis聊天事件", e);
        }
    }

    void handleBody(String body) {
        if (body == null || body.length() > 256) {
            return;
        }
        try {
            JSONObject event = JSONUtil.parseObj(body);
            if (!RedisConfig.CHAT_EVENT_TYPE.equals(event.getStr("type"))) {
                return;
            }
            Long messageId = event.getLong("messageId");
            if (messageId == null || messageId <= 0) {
                return;
            }
            ChatMessageDTO message = helpService.getPersistedChatMessage(messageId);
            if (message == null) {
                return;
            }
            WebSocketServer.broadcastToAuthenticatedClients(WebSocketServer.chatClientEvent(message));
        } catch (Exception e) {
            log.warn("忽略无法验证的Redis聊天事件");
        }
    }
}
