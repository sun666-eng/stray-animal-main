package com.example.common;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * A0.8：无 CSRF 的状态变更应被拒绝。
 */
public class CsrfInterceptorTest {

    private CsrfTokenService csrfTokenService;
    private CsrfInterceptor interceptor;

    @BeforeEach
    public void setUp() {
        csrfTokenService = new CsrfTokenService();
        interceptor = new CsrfInterceptor(csrfTokenService);
    }

    @Test
    public void getIsAllowedWithoutToken() throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/api/user/me");
        MockHttpServletResponse response = new MockHttpServletResponse();
        assertTrue(interceptor.preHandle(request, response, new Object()));
        assertEquals(200, response.getStatus());
    }

    @Test
    public void postWithoutTokenIsRejected() throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest("POST", "/api/adopt");
        MockHttpServletResponse response = new MockHttpServletResponse();
        assertFalse(interceptor.preHandle(request, response, new Object()));
        assertEquals(403, response.getStatus());
        assertTrue(response.getContentAsString().contains("CSRF"));
    }

    @Test
    public void postWithValidTokenIsAllowed() throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest("POST", "/api/adopt");
        String token = csrfTokenService.getOrCreate(request);
        request.addHeader(CsrfTokenService.HEADER_NAME, token);
        MockHttpServletResponse response = new MockHttpServletResponse();
        assertTrue(interceptor.preHandle(request, response, new Object()));
    }

    @Test
    public void loginIsExempt() throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest("POST", "/api/user/login");
        MockHttpServletResponse response = new MockHttpServletResponse();
        assertTrue(interceptor.preHandle(request, response, new Object()));
    }
}
