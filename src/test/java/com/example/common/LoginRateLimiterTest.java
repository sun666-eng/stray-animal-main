package com.example.common;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;

public class LoginRateLimiterTest {

    @Test
    public void locksAfterMaxFailures() {
        LoginRateLimiter limiter = new LoginRateLimiter();
        limiter.setEnabled(true);
        limiter.setMaxAttempts(3);
        limiter.setWindowSeconds(300);
        limiter.setLockSeconds(600);

        String key = "127.0.0.1:admin";
        assertNull(limiter.checkAllowed(key));
        limiter.recordFailure(key);
        assertNull(limiter.checkAllowed(key));
        limiter.recordFailure(key);
        assertNull(limiter.checkAllowed(key));
        limiter.recordFailure(key);
        assertNotNull(limiter.checkAllowed(key));
    }

    @Test
    public void successClearsWindow() {
        LoginRateLimiter limiter = new LoginRateLimiter();
        limiter.setEnabled(true);
        limiter.setMaxAttempts(2);
        limiter.setWindowSeconds(300);
        limiter.setLockSeconds(600);

        String key = "127.0.0.1:user";
        limiter.recordFailure(key);
        limiter.recordSuccess(key);
        assertNull(limiter.checkAllowed(key));
        limiter.recordFailure(key);
        // 仅 1 次失败，未达上限
        assertNull(limiter.checkAllowed(key));
    }
}
