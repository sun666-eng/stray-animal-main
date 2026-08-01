package com.example.service;

import com.example.common.FileStorage;
import com.example.component.StartupReadiness;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import javax.sql.DataSource;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.concurrent.Executor;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.AtomicReference;

/**
 * Production readiness probes. Never expose paths, SQL, exceptions, or secrets.
 *
 * <p>Any temporary {@code networkTimeout} change on a pooled connection must be restored
 * before return-to-pool. If restore fails, the physical connection is aborted/discarded
 * so Druid cannot reuse a polluted connection.
 */
@Service
public class HealthProbeService {

    private static final Executor INLINE_EXECUTOR = Runnable::run;

    private final StartupReadiness startupReadiness;
    private final DataSource dataSource;
    private final FileStorage fileStorage;
    private final long dbTimeoutMs;
    private final long cacheTtlMs;

    private final AtomicReference<Boolean> cachedReady = new AtomicReference<>(null);
    private final AtomicLong cacheAtMs = new AtomicLong(0);

    public HealthProbeService(
            StartupReadiness startupReadiness,
            DataSource dataSource,
            FileStorage fileStorage,
            @Value("${app.health.db-timeout-ms:2000}") long dbTimeoutMs,
            @Value("${app.health.ready-cache-ms:3000}") long cacheTtlMs) {
        this.startupReadiness = startupReadiness;
        this.dataSource = dataSource;
        this.fileStorage = fileStorage;
        this.dbTimeoutMs = Math.max(200L, dbTimeoutMs);
        this.cacheTtlMs = Math.max(0L, cacheTtlMs);
    }

    public boolean isApplicationReadyEventDone() {
        return startupReadiness.isReady();
    }

    /**
     * @return true only when ApplicationReadyEvent fired, DB reachable, upload dir usable
     */
    public boolean isReady() {
        long now = System.currentTimeMillis();
        Boolean cached = cachedReady.get();
        if (cacheTtlMs > 0 && cached != null && (now - cacheAtMs.get()) < cacheTtlMs) {
            return cached;
        }
        boolean ok = computeReady();
        cachedReady.set(ok);
        cacheAtMs.set(now);
        return ok;
    }

    /** Invalidate cache (tests / after simulated dependency recovery). */
    public void invalidateCache() {
        cachedReady.set(null);
        cacheAtMs.set(0);
    }

    private boolean computeReady() {
        if (!startupReadiness.isReady()) {
            return false;
        }
        if (!probeDatabase()) {
            return false;
        }
        return probeUploadDir();
    }

    /**
     * Bounded DB probe. Restores any temporary networkTimeout before the connection
     * is closed / returned to Druid. If restore fails, aborts the connection so it is
     * not reused with a polluted timeout.
     */
    private boolean probeDatabase() {
        Connection conn = null;
        Integer previousNetworkTimeout = null;
        boolean networkTimeoutChanged = false;
        boolean selectOk = false;
        boolean restoreFailed = false;
        try {
            conn = dataSource.getConnection();
            if (conn == null || conn.isClosed()) {
                return false;
            }
            try {
                previousNetworkTimeout = conn.getNetworkTimeout();
                int timeout = (int) Math.min(Integer.MAX_VALUE, dbTimeoutMs);
                conn.setNetworkTimeout(INLINE_EXECUTOR, timeout);
                networkTimeoutChanged = true;
            } catch (Throwable ignored) {
                // driver may not support network timeout; URL socketTimeout still applies
                networkTimeoutChanged = false;
            }
            try (Statement st = conn.createStatement()) {
                st.setQueryTimeout((int) Math.max(1, (dbTimeoutMs + 999) / 1000));
                st.execute("SELECT 1");
            }
            selectOk = true;
        } catch (Exception ex) {
            selectOk = false;
        } finally {
            if (conn != null) {
                if (networkTimeoutChanged) {
                    try {
                        int restore = previousNetworkTimeout != null ? previousNetworkTimeout : 0;
                        conn.setNetworkTimeout(INLINE_EXECUTOR, restore);
                    } catch (Throwable restoreEx) {
                        restoreFailed = true;
                        // Must NOT return this connection to the pool with a polluted timeout.
                        discardConnection(conn);
                        conn = null;
                    }
                }
                if (conn != null) {
                    try {
                        conn.close();
                    } catch (Exception ignored) {
                        // ignore close errors on a clean path
                    }
                }
            }
        }
        // Restore failure means we cannot trust the probe / pool state for readiness.
        return selectOk && !restoreFailed;
    }

    /**
     * Discard a physical connection that must not be reused by the pool.
     * Prefer JDBC {@link Connection#abort(Executor)}; fall back to hard close.
     * Never treat a polluted connection as a normal pool return.
     */
    void discardConnection(Connection conn) {
        if (conn == null) {
            return;
        }
        boolean aborted = false;
        try {
            conn.abort(INLINE_EXECUTOR);
            aborted = true;
        } catch (Throwable abortEx) {
            // abort unsupported or failed — fall through to force-close
        }
        if (!aborted) {
            try {
                if (!conn.isClosed()) {
                    conn.close();
                }
            } catch (Throwable ignored) {
                // last resort
            }
        } else {
            // After abort, still attempt close to release wrapper handles.
            try {
                conn.close();
            } catch (Throwable ignored) {
                // expected after abort on some drivers
            }
        }
    }

    private boolean probeUploadDir() {
        Path probe = null;
        try {
            Path root = fileStorage.getRoot();
            if (root == null || !Files.isDirectory(root) || !Files.isWritable(root)) {
                return false;
            }
            probe = root.resolve(".health-probe-" + Thread.currentThread().getId() + "-" + System.nanoTime());
            Files.write(probe, new byte[]{1});
            return true;
        } catch (Exception ex) {
            return false;
        } finally {
            if (probe != null) {
                try {
                    Files.deleteIfExists(probe);
                } catch (Exception ignored) {
                    // leftover checked by tests
                }
            }
        }
    }
}
