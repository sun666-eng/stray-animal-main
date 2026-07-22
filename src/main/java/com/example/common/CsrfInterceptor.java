package com.example.common;

import cn.hutool.json.JSONUtil;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.HandlerInterceptor;

import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;

/**
 * A0.8：对 API 状态变更方法校验 CSRF；GET 不校验（GET 不得做状态变更）。
 */
@Component
public class CsrfInterceptor implements HandlerInterceptor {

    private static final Set<String> SAFE_METHODS = new HashSet<>(Arrays.asList(
            "GET", "HEAD", "OPTIONS", "TRACE"
    ));

    private static final Set<String> EXEMPT_PATHS = new HashSet<>(Arrays.asList(
            "/api/user/login",
            "/api/user/register"
    ));

    private final CsrfTokenService csrfTokenService;

    public CsrfInterceptor(CsrfTokenService csrfTokenService) {
        this.csrfTokenService = csrfTokenService;
    }

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) throws IOException {
        String method = request.getMethod() == null ? "GET" : request.getMethod().toUpperCase(Locale.ROOT);
        if (SAFE_METHODS.contains(method)) {
            return true;
        }
        String path = request.getRequestURI();
        if (EXEMPT_PATHS.contains(path)) {
            return true;
        }
        // 仅保护 /api/**
        if (!path.startsWith("/api/")) {
            return true;
        }
        if (csrfTokenService.matches(request)) {
            return true;
        }
        response.setContentType("application/json;charset=UTF-8");
        response.setStatus(HttpServletResponse.SC_FORBIDDEN);
        response.getWriter().write(JSONUtil.toJsonStr(Result.error("403", "缺少或无效的 CSRF token")));
        return false;
    }
}
