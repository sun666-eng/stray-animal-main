package com.example.common;

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

    @BeforeEach
    public void setUp() {
        interceptor = new AuthInterceptor(userService);
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

    private User invokeGetCurrentUser(MockHttpServletRequest request) throws Exception {
        Method m = AuthInterceptor.class.getDeclaredMethod("getCurrentUser", javax.servlet.http.HttpServletRequest.class);
        m.setAccessible(true);
        return (User) m.invoke(interceptor, request);
    }
}
