package com.example.component;

import com.example.dto.ChatMessageDTO;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/** Publishes server-created events to the authenticated rescue public room. */
@Component
public class ChatMessagePublisher {

    private static final Logger log = LoggerFactory.getLogger(ChatMessagePublisher.class);

    /** 消息已持久化，推送失败只降级为客户端拉历史，不影响提交结果。 */
    public void publish(ChatMessageDTO message) {
        if (message == null) {
            return;
        }
        try {
            WebSocketServer.publishChatMessage(message);
        } catch (Exception e) {
            log.warn("聊天消息广播失败 id={}", message.getId(), e);
        }
    }
}
