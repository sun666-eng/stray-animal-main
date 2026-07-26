package com.example.common;

import com.example.entity.Permission;
import com.example.entity.Role;
import com.example.entity.User;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNotSame;
import static org.junit.jupiter.api.Assertions.assertNull;

/**
 * AuthUserCache 的安全不变量：copy-on-put / copy-on-get、TTL 锚定读取时刻、
 * 失效戳堵回填竞态、停用开关。
 */
class AuthUserCacheTest {

    private AuthUserCache cache;

    @BeforeEach
    void setUp() {
        cache = new AuthUserCache();
    }

    private static User filledUser() {
        User user = new User();
        user.setId(9L);
        user.setUsername("alice");
        Role role = new Role();
        role.setId(3L);
        List<Role> roles = new ArrayList<>();
        roles.add(role);
        user.setRole(roles);
        Permission perm = new Permission();
        perm.setId(5L);
        perm.setFlag("im");
        List<Permission> perms = new ArrayList<>();
        perms.add(perm);
        user.setPermission(perms);
        return user;
    }

    /** 常规写入：取戳→读库→put 的标准调用序。 */
    private void putNow(Long userId, User user) {
        cache.put(userId, user, cache.stamp(userId), System.currentTimeMillis());
    }

    @Test
    void missReturnsNull() {
        assertNull(cache.get(9L));
        assertNull(cache.get(null));
    }

    @Test
    void hitReturnsEquivalentSnapshot() {
        putNow(9L, filledUser());
        User got = cache.get(9L);
        assertNotNull(got);
        assertEquals(Long.valueOf(9L), got.getId());
        assertEquals("alice", got.getUsername());
        assertEquals(1, got.getPermission().size());
        assertEquals("im", got.getPermission().get(0).getFlag());
    }

    @Test
    void mutatingCallerObjectAfterPut_doesNotPoisonCache() {
        User original = filledUser();
        putNow(9L, original);
        // put 之后调用方继续改写自己的对象（模拟 fillPermissions 再次执行 / session 内改写）
        original.setUsername("evil");
        original.getPermission().clear();

        User got = cache.get(9L);
        assertEquals("alice", got.getUsername());
        assertEquals(1, got.getPermission().size());
    }

    @Test
    void mutatingReturnedObject_doesNotPoisonCache() {
        putNow(9L, filledUser());
        User first = cache.get(9L);
        first.setUsername("evil");
        first.getPermission().clear();

        User second = cache.get(9L);
        assertEquals("alice", second.getUsername());
        assertEquals(1, second.getPermission().size());
        assertNotSame(first, second);
    }

    @Test
    void invalidateRemovesEntry_immediatelyOutsideTransaction() {
        putNow(9L, filledUser());
        cache.invalidate(9L);
        assertNull(cache.get(9L));
    }

    @Test
    void invalidateAllRemovesEverything() {
        putNow(9L, filledUser());
        User other = filledUser();
        other.setId(10L);
        putNow(10L, other);
        cache.invalidateAll();
        assertNull(cache.get(9L));
        assertNull(cache.get(10L));
    }

    /**
     * 回填竞态回归：慢线程在 invalidate 之前取戳读库、之后才 put——
     * 旧世代快照必须被丢弃，不得复活已撤销的权限。
     */
    @Test
    void staleStampPut_afterInvalidate_isDiscarded() {
        AuthUserCache.Stamp preRevocation = cache.stamp(9L);
        long loadStart = System.currentTimeMillis();
        User preRevocationSnapshot = filledUser(); // 模拟撤销前读到的旧权限

        cache.invalidate(9L); // 管理员撤销提交（无事务上下文 → 立即生效）

        cache.put(9L, preRevocationSnapshot, preRevocation, loadStart);
        assertNull(cache.get(9L), "旧世代回填必须被失效戳拦截");
    }

    @Test
    void staleStampPut_afterInvalidateAll_isDiscarded() {
        AuthUserCache.Stamp preFlush = cache.stamp(9L);
        long loadStart = System.currentTimeMillis();

        cache.invalidateAll(); // 角色/权限定义变更

        cache.put(9L, filledUser(), preFlush, loadStart);
        assertNull(cache.get(9L), "全量失效后旧世代回填必须被拦截");
    }

    /** 旧世代回填不得覆盖失效后写入的新快照。 */
    @Test
    void staleStampPut_doesNotOverwriteNewerSnapshot() {
        AuthUserCache.Stamp stale = cache.stamp(9L);
        long staleLoadStart = System.currentTimeMillis();
        User staleSnapshot = filledUser();
        staleSnapshot.setUsername("pre-revocation");

        cache.invalidate(9L);

        User fresh = filledUser(); // 失效后按新数据回填
        putNow(9L, fresh);
        cache.put(9L, staleSnapshot, stale, staleLoadStart); // 慢线程旧数据最后到达

        User got = cache.get(9L);
        assertNotNull(got);
        assertEquals("alice", got.getUsername(), "last-write-wins 不得让旧快照覆盖新快照");
    }

    /** expireAt 锚定读库时刻：put 得再晚，快照最大陈旧度也恒为 TTL。 */
    @Test
    void expiryAnchoredToLoadStart_notPutTime() {
        cache.setTtlMs(5000);
        long loadStartLongAgo = System.currentTimeMillis() - 6000; // 读库发生在 6 秒前
        cache.put(9L, filledUser(), cache.stamp(9L), loadStartLongAgo);
        assertNull(cache.get(9L), "读库时刻起已超 TTL 的快照不得入缓存");
    }

    @Test
    void ttlZeroDisablesCacheEntirely() {
        cache.setTtlMs(0);
        cache.put(9L, filledUser(), cache.stamp(9L), System.currentTimeMillis());
        assertNull(cache.get(9L));
    }

    @Test
    void expiredEntryIsNotServed() throws InterruptedException {
        cache.setTtlMs(30);
        putNow(9L, filledUser());
        Thread.sleep(60);
        assertNull(cache.get(9L));
    }

    @Test
    void nullRoleAndPermissionListsAreCopiedSafely() {
        User bare = new User();
        bare.setId(11L);
        bare.setUsername("bob");
        putNow(11L, bare);
        User got = cache.get(11L);
        assertNotNull(got);
        assertNull(got.getRole());
        assertNull(got.getPermission());
    }
}
