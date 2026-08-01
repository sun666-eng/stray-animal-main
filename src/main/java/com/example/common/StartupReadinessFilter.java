package com.example.common;

import com.example.component.StartupReadiness;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;

@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
public class StartupReadinessFilter extends OncePerRequestFilter {

    private final StartupReadiness readiness;

    public StartupReadinessFilter(StartupReadiness readiness) {
        this.readiness = readiness;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
                                    FilterChain filterChain) throws ServletException, IOException {
        String path = request.getRequestURI() == null ? "" : request.getRequestURI();
        // Health probes are owned by HealthController:
        // - /live answers while runners are still finishing
        // - /ready is allowed through so the controller can return HTTP 503 {"status":"DOWN"}
        //   until ApplicationReadyEvent + dependencies are OK (no false green)
        if ("/api/health/live".equals(path) || "/api/health/ready".equals(path)) {
            filterChain.doFilter(request, response);
            return;
        }
        if (!readiness.isReady()) {
            response.setStatus(HttpServletResponse.SC_SERVICE_UNAVAILABLE);
            response.setContentType("application/json;charset=UTF-8");
            // Generic body only — no paths, exceptions, or dependency detail.
            response.getWriter().write("{\"code\":\"503\",\"msg\":\"服务正在完成安全启动检查\"}");
            return;
        }
        filterChain.doFilter(request, response);
    }
}
