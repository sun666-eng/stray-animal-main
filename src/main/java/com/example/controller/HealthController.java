package com.example.controller;

import com.example.service.HealthProbeService;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.bind.annotation.RestController;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Minimal public health endpoints. No secrets, paths, DB names, or stack traces.
 */
@RestController
@RequestMapping("/api/health")
public class HealthController {

    private final HealthProbeService healthProbeService;

    public HealthController(HealthProbeService healthProbeService) {
        this.healthProbeService = healthProbeService;
    }

    /** Process is alive and can answer HTTP. Does not check DB or disk. */
    @RequestMapping(value = "/live", method = {RequestMethod.GET, RequestMethod.HEAD})
    public ResponseEntity<Map<String, String>> live() {
        return ResponseEntity.ok()
                .contentType(MediaType.APPLICATION_JSON)
                .body(body("UP"));
    }

    /**
     * Dependencies ready: ApplicationReadyEvent + DB + upload dir.
     * HTTP 200 only when all true; otherwise HTTP 503 with generic body.
     */
    @RequestMapping(value = "/ready", method = {RequestMethod.GET, RequestMethod.HEAD})
    public ResponseEntity<Map<String, String>> ready() {
        boolean ok = healthProbeService.isReady();
        if (ok) {
            return ResponseEntity.ok()
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(body("UP"));
        }
        return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
                .contentType(MediaType.APPLICATION_JSON)
                .body(body("DOWN"));
    }

    private static Map<String, String> body(String status) {
        Map<String, String> m = new LinkedHashMap<>();
        m.put("status", status);
        return Collections.unmodifiableMap(m);
    }
}
