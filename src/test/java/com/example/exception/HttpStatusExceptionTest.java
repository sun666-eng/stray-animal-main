package com.example.exception;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;

/**
 * A0.6：业务 code → HTTP status 映射契约。
 */
public class HttpStatusExceptionTest {

    @Test
    public void mapsStandardCodes() {
        assertEquals(400, HttpStatusException.mapCodeToStatus("400"));
        assertEquals(401, HttpStatusException.mapCodeToStatus("401"));
        assertEquals(403, HttpStatusException.mapCodeToStatus("403"));
        assertEquals(404, HttpStatusException.mapCodeToStatus("404"));
        assertEquals(429, HttpStatusException.mapCodeToStatus("429"));
        assertEquals(500, HttpStatusException.mapCodeToStatus("500"));
    }

    @Test
    public void mapsBusinessMinusOneToBadRequest() {
        assertEquals(400, HttpStatusException.mapCodeToStatus("-1"));
    }
}
