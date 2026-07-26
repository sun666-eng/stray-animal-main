package com.example.component;

import org.springframework.beans.factory.InitializingBean;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/** Rejects unsupported clustering while chat throttling and socket ownership remain process-local. */
@Component
public class WebSocketDeploymentGuard implements InitializingBean {

    @Value("${app.websocket.single-instance-only:true}")
    private boolean singleInstanceOnly;

    @Override
    public void afterPropertiesSet() {
        if (!singleInstanceOnly) {
            throw new IllegalStateException("app.websocket.single-instance-only=false is unsupported: chat rate limiting and WebSocket session ownership are process-local");
        }
    }
}
