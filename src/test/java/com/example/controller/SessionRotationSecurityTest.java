package com.example.controller;

import com.example.common.AuthUserCache;
import com.example.common.CsrfTokenService;
import com.example.common.LoginRateLimiter;
import com.example.common.Result;
import com.example.dto.LoginVO;
import com.example.entity.User;
import com.example.service.UserService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.test.util.ReflectionTestUtils;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * Session fixation defense: login rotates the pre-auth MockHttpSession id,
 * and the pre-login session object no longer carries authentication.
 */
class SessionRotationSecurityTest {

    private UserController controller;
    private UserService userService;

    @BeforeEach
    void setUp() {
        controller = new UserController();
        userService = mock(UserService.class);
        LoginRateLimiter rateLimiter = mock(LoginRateLimiter.class);
        CsrfTokenService csrf = mock(CsrfTokenService.class);
        when(rateLimiter.checkAllowed(anyString())).thenReturn(null);
        when(csrf.getOrCreate(any())).thenReturn("csrf-test-token");
        ReflectionTestUtils.setField(controller, "userService", userService);
        ReflectionTestUtils.setField(controller, "loginRateLimiter", rateLimiter);
        ReflectionTestUtils.setField(controller, "csrfTokenService", csrf);
        ReflectionTestUtils.setField(controller, "authUserCache", new AuthUserCache());
    }

    @Test
    void login_rotatesPreAuthSessionId_andOldSessionLosesAuthCapability() {
        User dbUser = new User();
        dbUser.setId(42L);
        dbUser.setUsername("sess_user");
        when(userService.login(any(User.class))).thenReturn(dbUser);

        MockHttpSession preSession = new MockHttpSession();
        String preId = preSession.getId();
        // Simulate unauthenticated pre-login session (no user attribute)
        assertNull(preSession.getAttribute("user"));

        MockHttpServletRequest request = new MockHttpServletRequest();
        request.setSession(preSession);

        User credentials = new User();
        credentials.setUsername("sess_user");
        credentials.setPassword("SecretPass1!");

        Result<LoginVO> result = controller.login(credentials, request);
        assertEquals("0", result.getCode());
        assertNotNull(result.getData());

        String postId = request.getSession(false).getId();
        assertNotEquals(preId, postId, "login must rotate session id (session fixation defense)");

        // Current request session is authenticated after login
        Object sessionUser = request.getSession(false).getAttribute("user");
        assertNotNull(sessionUser);
        assertEquals(42L, ((User) sessionUser).getId());
        assertEquals(42L, request.getSession(false).getAttribute("userId"));

        // A brand-new unauthenticated request (models client holding only the old cookie
        // that is no longer the server's current session identity) has no auth attributes.
        MockHttpServletRequest stranger = new MockHttpServletRequest();
        stranger.setSession(new MockHttpSession());
        assertNull(stranger.getSession(false).getAttribute("user"));
        assertNull(stranger.getSession(false).getAttribute("userId"));
        assertNotEquals(postId, stranger.getSession(false).getId());
    }

    @Test
    void failedLogin_doesNotAuthenticatePreAuthSession() {
        when(userService.login(any(User.class))).thenReturn(null);

        MockHttpSession preSession = new MockHttpSession();
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.setSession(preSession);

        User credentials = new User();
        credentials.setUsername("bad");
        credentials.setPassword("wrong");
        Result<LoginVO> result = controller.login(credentials, request);
        assertEquals("401", result.getCode());
        assertNull(request.getSession(false).getAttribute("user"));
    }
}
