package com.example.component;

import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertThrows;

class WebSocketDeploymentGuardTest {

    @Test
    void singleInstanceModeIsAccepted() {
        WebSocketDeploymentGuard guard = new WebSocketDeploymentGuard();
        ReflectionTestUtils.setField(guard, "singleInstanceOnly", true);
        assertDoesNotThrow(guard::afterPropertiesSet);
    }

    @Test
    void unsupportedMultiInstanceModeFailsFast() {
        WebSocketDeploymentGuard guard = new WebSocketDeploymentGuard();
        ReflectionTestUtils.setField(guard, "singleInstanceOnly", false);
        assertThrows(IllegalStateException.class, guard::afterPropertiesSet);
    }
}
