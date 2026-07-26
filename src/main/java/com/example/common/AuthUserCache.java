package com.example.common;

import com.example.entity.User;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import java.util.ArrayList;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;

/**
 * A0.5 补充：按 userId 缓存「已 fillPermissions 的 User」快照，消除 AuthInterceptor
 * 每请求 getById + fillPermissions 的 N+1 查询（普通用户约 7 次/请求，管理员约 14 次）。
 *
 * <p>安全设计（勿破坏以下不变量）：
 * <ul>
 *   <li>copy-on-put / copy-on-get：缓存内部快照永不外泄，存取都做
 *       User 浅拷贝 + role/permission 列表防御拷贝（Role/Permission 元素全程只读）。
 *       下游对返回对象或 session 里对象的改写不会污染缓存。</li>
 *   <li>写路径主动失效：用户行变更 {@link #invalidate}；角色/权限定义变更
 *       {@link #invalidateAll}（角色内容影响全部持有者，无法反查 userId 列表）。</li>
 *   <li>事务感知：失效动作在 afterCommit 执行——提交前失效会被并发读用
 *       未提交的旧数据立即回填，等于没失效。</li>
 *   <li>回填竞态防护：读线程可能在写事务提交前读到旧数据、却在 afterCommit
 *       失效之后才 put（MVCC 一致读 + 线程停顿即可触发）。因此 put 必须携带
 *       读库前取的失效戳 {@link #stamp}，失效会先递增戳再删条目——旧世代的
 *       回填在 put 时必然发现戳失配而被丢弃，不会复活已撤销的权限。</li>
 *   <li>过期锚定读取时刻：expireAt 从「开始读库」起算而非 put 时刻，
 *       快照的最大陈旧度恒为 TTL，不因 put 延迟而顺延。</li>
 *   <li>TTL 兜底：绕过 ORM 的写（启动 Runner 裸 SQL 等）最迟 TTL 后自愈；
 *       {@code app.auth.cache-ttl-ms} ≤ 0 时缓存整体停用，回退每请求查库。</li>
 *   <li>仅缓存正结果：用户不存在不缓存，删除/封禁语义交给实时路径。</li>
 * </ul>
 */
@Component
public class AuthUserCache {

    /** 超过该条目数直接清空重来：防异常流量撑爆内存的简单兜底。 */
    private static final int MAX_ENTRIES = 10_000;

    private final Map<Long, Entry> cache = new ConcurrentHashMap<>();

    /** 失效世代戳：invalidateAll 递增全局戳；invalidate 递增对应用户戳。 */
    private final AtomicLong globalEpoch = new AtomicLong();
    private final Map<Long, Long> userEpoch = new ConcurrentHashMap<>();

    @Value("${app.auth.cache-ttl-ms:5000}")
    private long ttlMs = 5000;

    /** 命中返回防御性副本；未命中/已过期/缓存停用返回 null。 */
    public User get(Long userId) {
        if (ttlMs <= 0 || userId == null) {
            return null;
        }
        Entry entry = cache.get(userId);
        if (entry == null) {
            return null;
        }
        if (System.currentTimeMillis() >= entry.expireAt) {
            cache.remove(userId, entry);
            return null;
        }
        return copyOf(entry.snapshot);
    }

    /**
     * 读库前必须先取失效戳，连同「开始读库的时间戳」一起传给 {@link #put}。
     * 若读库期间发生了失效（世代戳变化），该次 put 会被丢弃。
     */
    public Stamp stamp(Long userId) {
        return new Stamp(globalEpoch.get(), epochOf(userId));
    }

    /**
     * 存入已填充权限的 User（内部另存副本，调用方后续改写不影响缓存）。
     *
     * @param stamp           读库前经 {@link #stamp} 取得的失效戳
     * @param loadStartMillis 开始读库的时间戳；expireAt 锚定于此，保证快照最大陈旧度恒为 TTL
     */
    public void put(Long userId, User filledUser, Stamp stamp, long loadStartMillis) {
        if (ttlMs <= 0 || userId == null || filledUser == null || stamp == null) {
            return;
        }
        long expireAt = loadStartMillis + ttlMs;
        if (System.currentTimeMillis() >= expireAt) {
            return;
        }
        if (cache.size() >= MAX_ENTRIES) {
            cache.clear();
        }
        User snapshot = copyOf(filledUser);
        cache.compute(userId, (key, existing) -> {
            // 失效先递增世代戳再删条目（见 invalidate/invalidateAll），
            // 因此戳失配 ⇒ 读库开始后发生过失效 ⇒ 本次数据可能已过期，放弃回填
            if (globalEpoch.get() != stamp.global || epochOf(userId) != stamp.user) {
                return existing;
            }
            return new Entry(snapshot, expireAt);
        });
    }

    /** 单用户失效：t_user 行变更（资料/密码/角色赋予）后调用。 */
    public void invalidate(Long userId) {
        if (userId == null) {
            return;
        }
        afterCommit(() -> {
            // 顺序敏感：先 bump 世代戳、后删条目，堵死「旧世代回填复活」的两种交错
            userEpoch.merge(userId, 1L, Long::sum);
            cache.remove(userId);
        });
    }

    /** 全量失效：t_role / t_permission 定义变更后调用（影响面无法定位到单用户）。 */
    public void invalidateAll() {
        afterCommit(() -> {
            globalEpoch.incrementAndGet();
            cache.clear();
            // 全局戳已递增，旧的 per-user 戳组合必然失配，可安全回收
            userEpoch.clear();
        });
    }

    private long epochOf(Long userId) {
        Long epoch = userEpoch.get(userId);
        return epoch == null ? 0L : epoch;
    }

    /**
     * 有活跃事务时延迟到 afterCommit 再失效（回滚则不失效，数据本来没变）；
     * 无事务上下文立即执行。
     */
    private void afterCommit(Runnable action) {
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    action.run();
                }
            });
        } else {
            action.run();
        }
    }

    /** 测试用：覆盖 TTL（Spring 环境下由 app.auth.cache-ttl-ms 注入）。 */
    void setTtlMs(long ttlMs) {
        this.ttlMs = ttlMs;
    }

    private static User copyOf(User source) {
        User copy = new User();
        copy.setId(source.getId());
        copy.setUsername(source.getUsername());
        copy.setPassword(source.getPassword());
        copy.setEmail(source.getEmail());
        copy.setPhone(source.getPhone());
        copy.setAvatar(source.getAvatar());
        copy.setRole(source.getRole() == null ? null : new ArrayList<>(source.getRole()));
        copy.setPermission(source.getPermission() == null ? null : new ArrayList<>(source.getPermission()));
        return copy;
    }

    private static final class Entry {
        private final User snapshot;
        private final long expireAt;

        private Entry(User snapshot, long expireAt) {
            this.snapshot = snapshot;
            this.expireAt = expireAt;
        }
    }

    /** 不透明失效戳：由 {@link #stamp} 签发、{@link #put} 校验。 */
    public static final class Stamp {
        private final long global;
        private final long user;

        private Stamp(long global, long user) {
            this.global = global;
            this.user = user;
        }
    }
}
