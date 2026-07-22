package com.example.common;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.util.Iterator;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * A3：登录/注册内存滑动窗口限流（单机）。
 * key 建议：ip + ":" + username（小写）。
 */
@Component
public class LoginRateLimiter {

    private final ConcurrentHashMap<String, Window> windows = new ConcurrentHashMap<>();

    @Value("${app.login.rate-limit.enabled:true}")
    private boolean enabled;

    @Value("${app.login.rate-limit.max-attempts:8}")
    private int maxAttempts;

    @Value("${app.login.rate-limit.window-seconds:300}")
    private int windowSeconds;

    @Value("${app.login.rate-limit.lock-seconds:600}")
    private int lockSeconds;

    public boolean isEnabled() {
        return enabled;
    }

    public void setEnabled(boolean enabled) {
        this.enabled = enabled;
    }

    public void setMaxAttempts(int maxAttempts) {
        this.maxAttempts = maxAttempts;
    }

    public void setWindowSeconds(int windowSeconds) {
        this.windowSeconds = windowSeconds;
    }

    public void setLockSeconds(int lockSeconds) {
        this.lockSeconds = lockSeconds;
    }

    /**
     * @return null 表示允许；否则为拒绝原因
     */
    public String checkAllowed(String key) {
        if (!enabled || key == null || key.isEmpty()) {
            return null;
        }
        cleanupIfNeeded();
        long now = System.currentTimeMillis();
        Window w = windows.computeIfAbsent(key, k -> new Window());
        synchronized (w) {
            if (w.lockedUntil > now) {
                long sec = Math.max(1, (w.lockedUntil - now) / 1000);
                return "尝试过于频繁，请 " + sec + " 秒后再试";
            }
            // 窗口过期则重置
            if (now - w.windowStart > windowSeconds * 1000L) {
                w.windowStart = now;
                w.failures = 0;
            }
            return null;
        }
    }

    public void recordFailure(String key) {
        if (!enabled || key == null || key.isEmpty()) {
            return;
        }
        long now = System.currentTimeMillis();
        Window w = windows.computeIfAbsent(key, k -> new Window());
        synchronized (w) {
            if (now - w.windowStart > windowSeconds * 1000L) {
                w.windowStart = now;
                w.failures = 0;
            }
            w.failures++;
            if (w.failures >= maxAttempts) {
                w.lockedUntil = now + lockSeconds * 1000L;
                w.failures = 0;
                w.windowStart = now;
            }
        }
    }

    public void recordSuccess(String key) {
        if (key == null) {
            return;
        }
        windows.remove(key);
    }

    private void cleanupIfNeeded() {
        if (windows.size() < 5000) {
            return;
        }
        long now = System.currentTimeMillis();
        long stale = Math.max(windowSeconds, lockSeconds) * 1000L * 2;
        Iterator<Map.Entry<String, Window>> it = windows.entrySet().iterator();
        while (it.hasNext()) {
            Map.Entry<String, Window> e = it.next();
            Window w = e.getValue();
            synchronized (w) {
                if (w.lockedUntil < now && now - w.windowStart > stale) {
                    it.remove();
                }
            }
        }
    }

    private static final class Window {
        long windowStart = System.currentTimeMillis();
        int failures;
        long lockedUntil;
    }
}
