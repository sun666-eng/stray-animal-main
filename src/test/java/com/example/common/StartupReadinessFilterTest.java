package com.example.common;

import com.example.component.StartupReadiness;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.util.ReflectionTestUtils;

import static org.junit.jupiter.api.Assertions.assertEquals;

class StartupReadinessFilterTest {

    @Test
    void deniesTrafficUntilAllApplicationRunnersComplete() throws Exception {
        StartupReadiness readiness = new StartupReadiness();
        StartupReadinessFilter filter = new StartupReadinessFilter(readiness);
        MockHttpServletResponse blocked = new MockHttpServletResponse();

        filter.doFilter(new MockHttpServletRequest("GET", "/api/user/me"), blocked, new MockFilterChain());
        assertEquals(503, blocked.getStatus());

        ReflectionTestUtils.invokeMethod(readiness, "markReadyForTest");
        MockHttpServletResponse allowed = new MockHttpServletResponse();
        filter.doFilter(new MockHttpServletRequest("GET", "/api/user/me"), allowed, new MockFilterChain());
        // After ready, filter must not force 503 (MockFilterChain leaves default status)
        assertEquals(200, allowed.getStatus() == 0 ? 200 : allowed.getStatus());
    }
}
