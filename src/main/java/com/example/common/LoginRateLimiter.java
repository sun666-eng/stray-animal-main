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

    /** 崩溃预防 P1.2：key=ip+username 可被凭据填充无限造新键，必须有节流清理 + 硬上限。 */
    private static final int MAX_WINDOWS = 20_000;
    private static final long CLEANUP_INTERVAL_MS = 60_000;
    private volatile long lastCleanupAt;

    private void cleanupIfNeeded() {
        long now = System.currentTimeMillis();
        boolean overCap = windows.size() >= MAX_WINDOWS;
        // 原实现 size>=5000 后每个登录请求都全量 O(n) 扫描；改为最多每 60s 清一次
        if (!overCap && (windows.size() < 5000 || now - lastCleanupAt < CLEANUP_INTERVAL_MS)) {
            return;
        }
        lastCleanupAt = now;
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
        // 硬上限兜底：清理后仍超上限（攻击性流量），清空重来——限流是防护性状态，
        // 重置的代价只是攻击者获得一个新窗口，远小于内存被撑爆
        if (windows.size() >= MAX_WINDOWS) {
            windows.clear();
        }
    }

    private static final class Window {
        long windowStart = System.currentTimeMillis();
        int failures;
        long lockedUntil;
    }
}
