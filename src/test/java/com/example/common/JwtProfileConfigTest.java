package com.example.common;

import org.junit.jupiter.api.Test;
import org.springframework.core.env.StandardEnvironment;
import org.springframework.mock.env.MockEnvironment;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * A0.1：prod 优先；prod,dev 不得使用开发密钥；仅 dev 且 allow-dev-secret 才可用开发密钥。
 */
public class JwtProfileConfigTest {

    @Test
    public void prodRejectsEmptySecret() {
        JwtUtil jwt = new JwtUtil();
        MockEnvironment env = new MockEnvironment();
        env.setActiveProfiles("prod");
        assertThrows(IllegalStateException.class,
                () -> jwt.configureForApplication("", false, env));
    }

    @Test
    public void prodDevComboRejectsDevSecret() {
        JwtUtil jwt = new JwtUtil();
        MockEnvironment env = new MockEnvironment();
        env.setActiveProfiles("prod", "dev");
        assertThrows(IllegalStateException.class,
                () -> jwt.configureForApplication(
                        JwtUtil.getDevSecretConstantForTests(), false, env));
    }

    @Test
    public void prodAcceptsStrongSecret() {
        JwtUtil jwt = new JwtUtil();
        MockEnvironment env = new MockEnvironment();
        env.setActiveProfiles("prod");
        assertDoesNotThrow(() -> jwt.configureForApplication(
                "production-secret-with-at-least-32-chars!!", false, env));
        String token = JwtUtil.createToken(1L, "admin");
        assertTrue(JwtUtil.validate(token));
    }

    @Test
    public void devWithAllowUsesDevSecret() {
        JwtUtil jwt = new JwtUtil();
        MockEnvironment env = new MockEnvironment();
        env.setActiveProfiles("dev");
        assertDoesNotThrow(() -> jwt.configureForApplication("", true, env));
        assertTrue(JwtUtil.validate(JwtUtil.createToken(2L, "dev-user")));
    }

    @Test
    public void noProfileRejectsEmptySecret() {
        JwtUtil jwt = new JwtUtil();
        StandardEnvironment env = new StandardEnvironment();
        // 清空 default 影响：Mock 无 active 且 default 也空
        MockEnvironment mock = new MockEnvironment();
        assertThrows(IllegalStateException.class,
                () -> jwt.configureForApplication("", false, mock));
    }
}
