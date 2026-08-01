package com.example.common;

import com.example.component.StartupReadiness;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;

class StartupReadinessFilterHealthTest {

    @Test
    void liveIsAllowedBeforeApplicationReady() throws Exception {
        StartupReadiness readiness = new StartupReadiness();
        StartupReadinessFilter filter = new StartupReadinessFilter(readiness);
        MockHttpServletResponse live = new MockHttpServletResponse();
        MockFilterChain chain = new MockFilterChain();
        filter.doFilter(new MockHttpServletRequest("GET", "/api/health/live"), live, chain);
        // Filter chain proceeded (status left at default 200 from mock chain completion)
        assertNotEquals(503, live.getStatus());
    }

    @Test
    void readyIsPassedToControllerBeforeApplicationReady() throws Exception {
        // Filter must not short-circuit /ready; HealthController enforces DOWN until ready.
        StartupReadiness readiness = new StartupReadiness();
        StartupReadinessFilter filter = new StartupReadinessFilter(readiness);
        MockHttpServletResponse ready = new MockHttpServletResponse();
        MockFilterChain chain = new MockFilterChain();
        filter.doFilter(new MockHttpServletRequest("GET", "/api/health/ready"), ready, chain);
        assertNotEquals(503, ready.getStatus());
        assertEquals("/api/health/ready",
                ((MockHttpServletRequest) chain.getRequest()).getRequestURI());
    }

    @Test
    void otherApiStillBlockedUntilApplicationReady() throws Exception {
        StartupReadiness readiness = new StartupReadiness();
        StartupReadinessFilter filter = new StartupReadinessFilter(readiness);
        MockHttpServletResponse blocked = new MockHttpServletResponse();
        filter.doFilter(new MockHttpServletRequest("GET", "/api/animal/page"), blocked, new MockFilterChain());
        assertEquals(503, blocked.getStatus());
    }
}
