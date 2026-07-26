package com.example.common;

import com.example.entity.Permission;
import com.example.entity.User;
import com.example.service.UserService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

import java.lang.reflect.Method;
import java.util.Collections;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * A0.5：Session 中冷冻的旧 User 不得作为权限真相；须按 id 查库。
 */
@ExtendWith(MockitoExtension.class)
public class AuthInterceptorSessionTest {

    @Mock
    UserService userService;

    AuthInterceptor interceptor;
    AuthUserCache authUserCache;

    @BeforeEach
    public void setUp() {
        // 每个测试独立缓存实例；测试内单次调用均为冷缓存 → 仍然验证"必须按 DB 重载"契约
        authUserCache = new AuthUserCache();
        interceptor = new AuthInterceptor(userService, authUserCache);
    }

    @Test
    public void reloadsUserFromDatabase_whenSessionHasStaleSnapshot() throws Exception {
        User stale = new User();
        stale.setId(9L);
        stale.setUsername("stale-name");
        // 旧快照伪装成超管（不应被信任）
        stale.setPermission(Collections.emptyList());

        User fresh = new User();
        fresh.setId(9L);
        fresh.setUsername("fresh-name");

        when(userService.getById(9L)).thenReturn(fresh);
        when(userService.fillPermissions(any(User.class))).thenAnswer(inv -> inv.getArgument(0));

        MockHttpServletRequest request = new MockHttpServletRequest();
        request.getSession(true).setAttribute("user", stale);

        User resolved = invokeGetCurrentUser(request);
        assertNotNull(resolved);
        assertEquals("fresh-name", resolved.getUsername());
        verify(userService).getById(9L);
        verify(userService).fillPermissions(fresh);
        assertEquals(fresh, request.getSession().getAttribute("user"));
    }

    @Test
    public void invalidatesSession_whenUserDeleted() throws Exception {
        User stale = new User();
        stale.setId(99L);
        stale.setUsername("gone");

        when(userService.getById(99L)).thenReturn(null);

        MockHttpServletRequest request = new MockHttpServletRequest();
        request.getSession(true).setAttribute("user", stale);
        String sessionId = request.getSession().getId();

        User resolved = invokeGetCurrentUser(request);
        assertNull(resolved);
        // session invalidated — getSession(false) is null
        assertNull(request.getSession(false));
        verify(userService, never()).fillPermissions(any());
    }

    @Test
    public void preHandle_returns401Json_whenNoSession() throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/api/proof/1");
        MockHttpServletResponse response = new MockHttpServletResponse();

        boolean ok = interceptor.preHandle(request, response, new Object());
        assertFalse(ok);
        assertEquals(401, response.getStatus());
        assertTrue(response.getContentAsString().contains("401"));
    }

    @Test
    public void noticeRootRequiresManagerButPageAndDetailRemainPublic() throws Exception {
        MockHttpServletResponse rootResponse = new MockHttpServletResponse();
        assertFalse(interceptor.preHandle(
                new MockHttpServletRequest("GET", "/api/notice"), rootResponse, new Object()));
        assertEquals(401, rootResponse.getStatus());

        assertTrue(interceptor.preHandle(
                new MockHttpServletRequest("GET", "/api/notice/page"), new MockHttpServletResponse(), new Object()));
        assertTrue(interceptor.preHandle(
                new MockHttpServletRequest("GET", "/api/notice/7"), new MockHttpServletResponse(), new Object()));
    }

    @Test
    public void animalDetailRefreshesOptionalAuthenticatedUser() throws Exception {
        User stale = userWithFlag("animal");
        User fresh = userWithFlag("im");
        when(userService.getById(9L)).thenReturn(fresh);
        when(userService.fillPermissions(any(User.class))).thenAnswer(inv -> inv.getArgument(0));
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/api/animal/7");
        request.getSession(true).setAttribute("user", stale);

        assertTrue(interceptor.preHandle(request, new MockHttpServletResponse(), new Object()));
        assertEquals(fresh, request.getSession().getAttribute("user"));
        verify(userService).getById(9L);
    }

    @Test
    public void ownerDetailPath_isReachableForOrdinaryAuthenticatedUser() throws Exception {
        User fresh = userWithFlag("im");
        when(userService.getById(9L)).thenReturn(fresh);
        when(userService.fillPermissions(any(User.class))).thenAnswer(inv -> inv.getArgument(0));
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/api/help/12");
        request.getSession(true).setAttribute("user", fresh);

        assertTrue(interceptor.preHandle(request, new MockHttpServletResponse(), new Object()));
    }

    @Test
    public void rescueAlias_grantsManagementButImDoesNot() throws Exception {
        User manager = userWithFlag("rescue");
        when(userService.getById(9L)).thenReturn(manager);
        when(userService.fillPermissions(any(User.class))).thenAnswer(inv -> inv.getArgument(0));
        MockHttpServletRequest management = new MockHttpServletRequest("GET", "/api/help/page");
        management.getSession(true).setAttribute("user", manager);
        assertTrue(interceptor.preHandle(management, new MockHttpServletResponse(), new Object()));

        User ordinary = userWithFlag("im");
        when(userService.getById(9L)).thenReturn(ordinary);
        // 生产语义：权限变更（角色/用户写路径）必然触发缓存失效；此处模拟该失效
        authUserCache.invalidate(9L);
        MockHttpServletRequest denied = new MockHttpServletRequest("GET", "/api/help/page");
        denied.getSession(true).setAttribute("user", ordinary);
        MockHttpServletResponse response = new MockHttpServletResponse();
        assertFalse(interceptor.preHandle(denied, response, new Object()));
        assertEquals(403, response.getStatus());
    }

    @Test
    public void legacyWorkflowRedirect_preservesOnlyPositiveLongIdentifier() throws Exception {
        MockHttpServletRequest valid = new MockHttpServletRequest("GET", "/page/end/adopt_proof.html");
        valid.setParameter("aid", "10003");
        MockHttpServletResponse validResponse = new MockHttpServletResponse();
        assertFalse(interceptor.preHandle(valid, validResponse, new Object()));
        assertEquals("/page/front/adopt_proof.html?aid=10003", validResponse.getRedirectedUrl());

        MockHttpServletRequest malicious = new MockHttpServletRequest("GET", "/page/end/adopt_apply.html");
        malicious.setParameter("animalId", "1&redirect=https://example.com");
        MockHttpServletResponse maliciousResponse = new MockHttpServletResponse();
        assertFalse(interceptor.preHandle(malicious, maliciousResponse, new Object()));
        assertEquals("/page/front/adopt_apply.html", maliciousResponse.getRedirectedUrl());
    }

    @Test
    public void legacyUtilityPages_redirectToCanonicalDestinationsBeforeAuth() throws Exception {
        MockHttpServletResponse registerResponse = new MockHttpServletResponse();
        assertFalse(interceptor.preHandle(new MockHttpServletRequest("GET", "/page/end/register.html"),
                registerResponse, new Object()));
        assertEquals("/page/front/register.html", registerResponse.getRedirectedUrl());

        MockHttpServletResponse pluginsResponse = new MockHttpServletResponse();
        assertFalse(interceptor.preHandle(new MockHttpServletRequest("GET", "/page/end/plugins.html"),
                pluginsResponse, new Object()));
        assertEquals("/page/end/index.html", pluginsResponse.getRedirectedUrl());
    }

    @Test
    public void ordinaryAdoptionPermission_canReachOwnerProofWorkflowOnly() throws Exception {
        User ordinary = userWithFlag("my_adopt");
        when(userService.getById(9L)).thenReturn(ordinary);
        when(userService.fillPermissions(any(User.class))).thenAnswer(inv -> inv.getArgument(0));
        MockHttpServletRequest ownerProof = new MockHttpServletRequest("POST", "/api/proof");
        ownerProof.getSession(true).setAttribute("user", ordinary);
        assertTrue(interceptor.preHandle(ownerProof, new MockHttpServletResponse(), new Object()));

        MockHttpServletRequest management = new MockHttpServletRequest("GET", "/api/proof/page");
        management.getSession(true).setAttribute("user", ordinary);
        MockHttpServletResponse denied = new MockHttpServletResponse();
        assertFalse(interceptor.preHandle(management, denied, new Object()));
        assertEquals(403, denied.getStatus());
    }

    @Test
    public void secondRequestWithinTtl_isServedFromCacheWithoutDbReload() throws Exception {
        User fresh = userWithFlag("im");
        when(userService.getById(9L)).thenReturn(fresh);
        when(userService.fillPermissions(any(User.class))).thenAnswer(inv -> inv.getArgument(0));

        MockHttpServletRequest first = new MockHttpServletRequest();
        first.getSession(true).setAttribute("userId", 9L);
        assertNotNull(invokeGetCurrentUser(first));

        MockHttpServletRequest second = new MockHttpServletRequest();
        second.getSession(true).setAttribute("userId", 9L);
        User resolved = invokeGetCurrentUser(second);
        assertNotNull(resolved);
        assertEquals("user", resolved.getUsername());
        // 命中缓存：DB 只应查过一次
        org.mockito.Mockito.verify(userService, org.mockito.Mockito.times(1)).getById(9L);
        org.mockito.Mockito.verify(userService, org.mockito.Mockito.times(1)).fillPermissions(any(User.class));
    }

    @Test
    public void cachedCopyMutation_doesNotAffectSubsequentRequests() throws Exception {
        User fresh = userWithFlag("im");
        when(userService.getById(9L)).thenReturn(fresh);
        when(userService.fillPermissions(any(User.class))).thenAnswer(inv -> inv.getArgument(0));

        MockHttpServletRequest first = new MockHttpServletRequest();
        first.getSession(true).setAttribute("userId", 9L);
        invokeGetCurrentUser(first);

        MockHttpServletRequest second = new MockHttpServletRequest();
        second.getSession(true).setAttribute("userId", 9L);
        User fromCache = invokeGetCurrentUser(second);
        // 模拟下游代码改写 session 里的对象（历史上测试代码出现过该写法）
        fromCache.setUsername("evil");
        fromCache.setPermission(Collections.emptyList());

        MockHttpServletRequest third = new MockHttpServletRequest();
        third.getSession(true).setAttribute("userId", 9L);
        User next = invokeGetCurrentUser(third);
        assertEquals("user", next.getUsername());
        assertEquals(1, next.getPermission().size());
    }

    private static User userWithFlag(String flag) {
        User user = new User();
        user.setId(9L);
        user.setUsername("user");
        Permission permission = new Permission();
        permission.setFlag(flag);
        user.setPermission(Collections.singletonList(permission));
        return user;
    }

    private User invokeGetCurrentUser(MockHttpServletRequest request) throws Exception {
        Method m = AuthInterceptor.class.getDeclaredMethod("getCurrentUser", jakarta.servlet.http.HttpServletRequest.class);
        m.setAccessible(true);
        return (User) m.invoke(interceptor, request);
    }
}
