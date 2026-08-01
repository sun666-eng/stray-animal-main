package com.example.component;

import com.example.exception.CustomException;
import org.junit.jupiter.api.Test;
import org.springframework.mock.env.MockEnvironment;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ProdDeploymentRulesTest {

    @Test
    void rejectsForbiddenDatabaseNameWithExactMessage() {
        MockEnvironment env = productionEnvironment();
        env.setProperty("spring.datasource.url", "jdbc:mysql://db.internal:3306/test");
        CustomException ex = assertThrows(CustomException.class, () -> ProdDeploymentRules.validate(env));
        assertTrue(ex.getMessage().contains(ProdDeploymentRules.MSG_FORBIDDEN_DB));
    }

    @Test
    void rejectsRootWithExactMessage() {
        MockEnvironment env = productionEnvironment();
        env.setProperty("spring.datasource.username", "root");
        CustomException ex = assertThrows(CustomException.class, () -> ProdDeploymentRules.validate(env));
        assertTrue(ex.getMessage().contains(ProdDeploymentRules.MSG_ROOT_USER));
    }

    @Test
    void rejectsEmptyPasswordWithExactMessage() {
        MockEnvironment env = productionEnvironment();
        env.setProperty("spring.datasource.password", "");
        CustomException ex = assertThrows(CustomException.class, () -> ProdDeploymentRules.validate(env));
        assertTrue(ex.getMessage().contains(ProdDeploymentRules.MSG_PASSWORD_MISSING));
    }

    @Test
    void rejectsEmptyAndUnrestrictedCors() {
        assertThrows(CustomException.class, () -> ProdDeploymentRules.validateCorsPatterns(""));
        assertThrows(CustomException.class, () -> ProdDeploymentRules.validateCorsPatterns("*"));
        assertThrows(CustomException.class, () -> ProdDeploymentRules.validateCorsPatterns("http://*"));
        assertThrows(CustomException.class, () -> ProdDeploymentRules.validateCorsPatterns("https://*"));
        assertThrows(CustomException.class, () -> ProdDeploymentRules.validateCorsPatterns("*://*"));
        assertDoesNotThrow(() -> ProdDeploymentRules.validateCorsPatterns("https://app.example.com"));
        assertDoesNotThrow(() -> ProdDeploymentRules.validateCorsPatterns("https://*.example.com"));
    }

    @Test
    void unrestrictedPatternHelper() {
        assertTrue(ProdDeploymentRules.isUnrestrictedCorsPattern("*"));
        assertTrue(ProdDeploymentRules.isUnrestrictedCorsPattern("https://*"));
        assertTrue(ProdDeploymentRules.isUnrestrictedCorsPattern("http://*"));
        assertTrue(ProdDeploymentRules.isUnrestrictedCorsPattern("*://*"));
        assertFalse(ProdDeploymentRules.isUnrestrictedCorsPattern("https://*.example.com"));
        assertFalse(ProdDeploymentRules.isUnrestrictedCorsPattern("https://app.example.local"));
    }

    @Test
    void productionAcceptsSafeConfig() {
        assertDoesNotThrow(() -> ProdDeploymentRules.validate(productionEnvironment()));
    }

    private MockEnvironment productionEnvironment() {
        MockEnvironment environment = new MockEnvironment();
        environment.setActiveProfiles("prod");
        environment.setProperty("spring.datasource.url", "jdbc:mysql://db.internal:3306/animal");
        environment.setProperty("spring.datasource.username", "app_user");
        environment.setProperty("spring.datasource.password", "secret-password");
        environment.setProperty("file.upload-dir", "C:/data/uploads");
        environment.setProperty("app.jwt.secret", "prod-secret-with-enough-length-32chars");
        environment.setProperty("app.ai.config-encryption-key", "independent-ai-config-key-32-bytes-minimum");
        environment.setProperty("app.ai.allow-loopback-personal-config", "false");
        environment.setProperty("app.schema-guard.auto-migrate", "false");
        environment.setProperty("app.cors.allowed-origin-patterns", "https://app.example.local");
        return environment;
    }
}
