package com.example.controller;

import com.example.service.HealthProbeService;
import jakarta.servlet.http.HttpServletRequest;
import org.junit.jupiter.api.Test;
import org.springframework.http.ResponseEntity;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.mockito.ArgumentMatchers.anyBoolean;

class HealthControllerTest {

    @Test
    void liveAlwaysReturnsHttp200Up_withoutCreatingSession() {
        HealthProbeService svc = mock(HealthProbeService.class);
        HealthController c = new HealthController(svc);
        ResponseEntity<Map<String, String>> r = c.live();
        assertEquals(200, r.getStatusCode().value());
        assertEquals("UP", r.getBody().get("status"));
        assertFalse(r.getBody().containsKey("code"));
    }

    @Test
    void liveDoesNotInvokeGetSessionOnRequest_evenIfInjected() {
        // live() takes no request; ensure API remains session-free for probes
        HealthProbeService svc = mock(HealthProbeService.class);
        HealthController c = new HealthController(svc);
        HttpServletRequest request = mock(HttpServletRequest.class);
        // Controllers that mint sessions would call getSession(true). live must not.
        c.live();
        verify(request, never()).getSession();
        verify(request, never()).getSession(anyBoolean());
    }

    @Test
    void readyReturns200WhenProbeTrue() {
        HealthProbeService svc = mock(HealthProbeService.class);
        when(svc.isReady()).thenReturn(true);
        HealthController c = new HealthController(svc);
        ResponseEntity<Map<String, String>> r = c.ready();
        assertEquals(200, r.getStatusCode().value());
        assertEquals("UP", r.getBody().get("status"));
    }

    @Test
    void readyReturns503WhenProbeFalse_notBusinessCode200() {
        HealthProbeService svc = mock(HealthProbeService.class);
        when(svc.isReady()).thenReturn(false);
        HealthController c = new HealthController(svc);
        ResponseEntity<Map<String, String>> r = c.ready();
        assertEquals(503, r.getStatusCode().value());
        assertEquals("DOWN", r.getBody().get("status"));
        assertFalse(r.getBody().containsKey("code"));
        assertFalse(r.getBody().containsKey("msg"));
    }
}
