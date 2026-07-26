package com.example.common;

import org.springframework.stereotype.Component;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpSession;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
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
        // 仅接受 Header，避免 token 进入 URL/Referer/访问日志
        String provided = request.getHeader(HEADER_NAME);
        if (provided == null || provided.isEmpty()) {
            // 兼容标准表单 POST body 参数（非 query string）
            String contentType = request.getContentType();
            if (contentType != null
                    && contentType.toLowerCase().contains("application/x-www-form-urlencoded")
                    && "POST".equalsIgnoreCase(request.getMethod())) {
                provided = request.getParameter(PARAM_NAME);
            }
        }
        // 恒时比较，避免逐字符 equals 的计时侧信道
        return provided != null && MessageDigest.isEqual(
                expected.getBytes(StandardCharsets.UTF_8),
                provided.getBytes(StandardCharsets.UTF_8));
    }

    public void rotate(HttpServletRequest request) {
        HttpSession session = request.getSession(true);
        session.setAttribute(SESSION_ATTR, UUID.randomUUID().toString().replace("-", ""));
    }
}
