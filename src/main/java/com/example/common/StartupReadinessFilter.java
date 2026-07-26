package com.example.common;

import com.example.component.StartupReadiness;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import javax.servlet.FilterChain;
import javax.servlet.ServletException;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
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
        if (!readiness.isReady()) {
            response.setStatus(HttpServletResponse.SC_SERVICE_UNAVAILABLE);
            response.setContentType("application/json;charset=UTF-8");
            response.getWriter().write("{\"code\":\"503\",\"msg\":\"服务正在完成安全启动检查\"}");
            return;
        }
        filterChain.doFilter(request, response);
    }
}
