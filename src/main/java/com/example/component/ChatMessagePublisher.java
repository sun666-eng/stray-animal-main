package com.example.component;

import com.example.dto.ChatMessageDTO;
import org.springframework.stereotype.Component;

/** Publishes server-created events to the authenticated rescue public room. */
@Component
public class ChatMessagePublisher {

    public void publish(ChatMessageDTO message) {
        WebSocketServer.publishChatMessage(message);
    }
}
