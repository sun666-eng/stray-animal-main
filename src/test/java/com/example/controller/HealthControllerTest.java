package com.example.controller;

import com.example.service.HealthProbeService;
import org.junit.jupiter.api.Test;
import org.springframework.http.ResponseEntity;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class HealthControllerTest {

    @Test
    void liveAlwaysReturnsHttp200Up() {
        HealthProbeService svc = mock(HealthProbeService.class);
        HealthController c = new HealthController(svc);
        ResponseEntity<Map<String, String>> r = c.live();
        assertEquals(200, r.getStatusCode().value());
        assertEquals("UP", r.getBody().get("status"));
        assertFalse(r.getBody().containsKey("code"));
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
        // Must not look like HTTP 200 + business code 503
        assertFalse(r.getBody().containsKey("code"));
        assertFalse(r.getBody().containsKey("msg"));
    }
}
