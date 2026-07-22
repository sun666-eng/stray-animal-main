package com.example.common;

import org.springframework.stereotype.Component;

import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpSession;
import java.util.UUID;

/**
 * A0.8：Session 绑定 CSRF token（轻量，不依赖完整 Spring Security）。
 */
@Component
public class CsrfTokenService {

    public static final String SESSION_ATTR = "CSRF_TOKEN";
    public static final String HEADER_NAME = "X-CSRF-Token";
    public static final String PARAM_NAME = "_csrf";

    public String getOrCreate(HttpServletRequest request) {
        HttpSession session = request.getSession(true);
        Object existing = session.getAttribute(SESSION_ATTR);
        if (existing instanceof String && !((String) existing).isEmpty()) {
            return (String) existing;
        }
        String token = UUID.randomUUID().toString().replace("-", "");
        session.setAttribute(SESSION_ATTR, token);
        return token;
    }

    public String peek(HttpServletRequest request) {
        HttpSession session = request.getSession(false);
        if (session == null) {
            return null;
        }
        Object existing = session.getAttribute(SESSION_ATTR);
        return existing instanceof String ? (String) existing : null;
    }

    public boolean matches(HttpServletRequest request) {
        String expected = peek(request);
        if (expected == null || expected.isEmpty()) {
            return false;
        }
        String provided = request.getHeader(HEADER_NAME);
        if (provided == null || provided.isEmpty()) {
            provided = request.getParameter(PARAM_NAME);
        }
        return expected.equals(provided);
    }

    public void rotate(HttpServletRequest request) {
        HttpSession session = request.getSession(true);
        session.setAttribute(SESSION_ATTR, UUID.randomUUID().toString().replace("-", ""));
    }
}
