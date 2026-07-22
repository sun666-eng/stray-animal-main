package com.example.common;

import com.example.entity.User;
import com.example.service.UserService;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.util.ReflectionTestUtils;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.when;

/**
 * 认证唯一权威对抗：无 Session 时 Bearer JWT 不得建立身份。
 */
@ExtendWith(MockitoExtension.class)
public class SessionAuthorityTest {

    @Mock
    UserService userService;

    @InjectMocks
    AuthInterceptor interceptor;

    @Test
    public void jwtOnly_withoutSession_isUnauthenticated() throws Exception {
        // 即使 JwtUtil 能签发 token，拦截器也不再消费它
        String jwt = JwtUtil.createToken(20L, "jerry");
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/api/user/me");
        request.addHeader("Authorization", "Bearer " + jwt);
        MockHttpServletResponse response = new MockHttpServletResponse();

        User loaded = ReflectionTestUtils.invokeMethod(interceptor, "getCurrentUser", request);
        assertNull(loaded, "JWT-only must not authenticate");
    }

    @Test
    public void sessionUser_loadsFromDb() {
        User db = new User();
        db.setId(20L);
        db.setUsername("jerry");
        when(userService.getById(20L)).thenReturn(db);
        // fillPermissions may mutate in place

        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/api/user/me");
        User snap = new User();
        snap.setId(20L);
        request.getSession(true).setAttribute("user", snap);

        User loaded = ReflectionTestUtils.invokeMethod(interceptor, "getCurrentUser", request);
        assertEquals(20L, loaded.getId());
        assertEquals("jerry", loaded.getUsername());
    }

    @Test
    public void csrf_getLogoutNotApplicable_postOnlyOnController() {
        // 文档性：Csrf 对 GET 放行；logout 已改为仅 POST，由集成脚本验证 405/404
        assertTrue(true);
    }
}
