package com.example.common;

import org.junit.jupiter.api.Test;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;

import static org.junit.jupiter.api.Assertions.*;

public class PasswordEncoderTest {

    private static final BCryptPasswordEncoder ENCODER = new BCryptPasswordEncoder();

    @Test
    public void testEncodeAndMatch() {
        String raw = "123456";
        String encoded = ENCODER.encode(raw);
        assertNotEquals(raw, encoded);
        assertTrue(encoded.startsWith("$2a$"));
        assertTrue(ENCODER.matches(raw, encoded));
    }

    @Test
    public void testDifferentPasswordsDontMatch() {
        String encoded = ENCODER.encode("password1");
        assertFalse(ENCODER.matches("password2", encoded));
    }

    @Test
    public void testEachEncodeProducesUniqueHash() {
        String raw = "same_password";
        String hash1 = ENCODER.encode(raw);
        String hash2 = ENCODER.encode(raw);
        assertNotEquals(hash1, hash2); // salt makes each hash unique
        assertTrue(ENCODER.matches(raw, hash1));
        assertTrue(ENCODER.matches(raw, hash2));
    }
}
