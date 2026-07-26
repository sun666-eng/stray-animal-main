package com.example.common;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class AuditLogAspectTest {
    @Test
    void resultErrorIsFailureAndSuccessCodeIsSuccess() {
        assertFalse(AuditLogAspect.isSuccessfulResult(Result.error("400", "validation failed")));
        assertTrue(AuditLogAspect.isSuccessfulResult(Result.success()));
    }

    @Test
    void nonResultExportsRemainSuccessful() {
        assertTrue(AuditLogAspect.isSuccessfulResult(null));
        assertTrue(AuditLogAspect.isSuccessfulResult(new byte[0]));
    }

    @Test
    void payloadTooLargeHttpStatusIsFailure() {
        assertFalse(AuditLogAspect.isSuccessfulHttpStatus(413));
        assertTrue(AuditLogAspect.isSuccessfulHttpStatus(399));
    }

    @Test
    void onlyPrivateOrLoopbackHopsAreTrustedForForwardedHeaders() {
        assertTrue(AuditLogAspect.isTrustedProxyHop("127.0.0.1"));
        assertTrue(AuditLogAspect.isTrustedProxyHop("10.0.0.8"));
        assertTrue(AuditLogAspect.isTrustedProxyHop("192.168.1.1"));
        assertTrue(AuditLogAspect.isTrustedProxyHop("172.16.0.2"));
        assertFalse(AuditLogAspect.isTrustedProxyHop("8.8.8.8"));
        assertFalse(AuditLogAspect.isTrustedProxyHop("1.2.3.4"));
    }
}
