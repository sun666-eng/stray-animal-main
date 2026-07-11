package com.example.common;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

public class JwtUtilTest {

    @Test
    public void testCreateAndParse() {
        String token = JwtUtil.createToken(1L, "admin");
        assertNotNull(token);
        assertTrue(JwtUtil.validate(token));
        assertEquals(Long.valueOf(1L), JwtUtil.getUserId(token));
        assertEquals("admin", JwtUtil.getUsername(token));
    }

    @Test
    public void testInvalidToken() {
        assertFalse(JwtUtil.validate("invalid.token.here"));
        assertFalse(JwtUtil.validate(""));
        assertFalse(JwtUtil.validate(null));
    }

    @Test
    public void testDifferentUsers() {
        String token1 = JwtUtil.createToken(1L, "admin");
        String token2 = JwtUtil.createToken(2L, "user");
        assertEquals("admin", JwtUtil.getUsername(token1));
        assertEquals("user", JwtUtil.getUsername(token2));
        assertEquals(Long.valueOf(1L), JwtUtil.getUserId(token1));
        assertEquals(Long.valueOf(2L), JwtUtil.getUserId(token2));
    }

    @Test
    public void configuredSecretRejectsMissingWeakAndKnownSecrets() {
        JwtUtil jwtUtil = new JwtUtil();
        assertThrows(IllegalStateException.class, () -> jwtUtil.setConfiguredSecret(null));
        assertThrows(IllegalStateException.class, () -> jwtUtil.setConfiguredSecret("short-secret"));
        assertThrows(IllegalStateException.class,
                () -> jwtUtil.setConfiguredSecret("animal-home-development-secret-please-change"));
    }

    @Test
    public void configuredSecretAcceptsStrongSecret() {
        JwtUtil jwtUtil = new JwtUtil();
        jwtUtil.setConfiguredSecret("test-only-secret-with-at-least-32-characters");
        String token = JwtUtil.createToken(7L, "secure-user");
        assertTrue(JwtUtil.validate(token));
        assertEquals(Long.valueOf(7L), JwtUtil.getUserId(token));
    }
}
