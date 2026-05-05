package com.example.common;

import cn.hutool.json.JSONUtil;
import org.springframework.web.servlet.HandlerInterceptor;

import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.net.URLEncoder;

public class AuthInterceptor implements HandlerInterceptor {

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) throws IOException {
        String path = request.getRequestURI();

        if (path.startsWith("/api/")) {
            // API: JWT优先，Session兜底
            String authHeader = request.getHeader("Authorization");
            if (authHeader != null && authHeader.startsWith("Bearer ")) {
                String token = authHeader.substring(7);
                if (JwtUtil.validate(token)) {
                    request.setAttribute("userId", JwtUtil.getUserId(token));
                    request.setAttribute("username", JwtUtil.getUsername(token));
                    return true;
                }
            }
            // 回退到 Session
            Object user = request.getSession().getAttribute("user");
            if (user != null) {
                return true;
            }
            response.setContentType("application/json;charset=UTF-8");
            response.setStatus(401);
            response.getWriter().write(JSONUtil.toJsonStr(Result.error("401", "未登录或登录已过期")));
            return false;
        }

        // 页面请求：Session认证
        Object user = request.getSession().getAttribute("user");
        if (user != null) {
            return true;
        }
        response.sendRedirect(buildLoginRedirect(path, request.getQueryString()));
        return false;
    }

    private String buildLoginRedirect(String path, String queryString) throws IOException {
        String target = path + (queryString == null ? "" : "?" + queryString);
        return "/page/end/login.html?redirect=" + URLEncoder.encode(target, "UTF-8");
    }

}
