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
}
