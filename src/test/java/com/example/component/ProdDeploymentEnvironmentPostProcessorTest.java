package com.example.component;

import com.example.exception.CustomException;
import org.junit.jupiter.api.Test;
import org.springframework.boot.SpringApplication;
import org.springframework.mock.env.MockEnvironment;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ProdDeploymentEnvironmentPostProcessorTest {

    private final ProdDeploymentEnvironmentPostProcessor epp = new ProdDeploymentEnvironmentPostProcessor();
    private final SpringApplication app = new SpringApplication();

    @Test
    void noProfileFailsInEnvironmentPostProcessor() {
        MockEnvironment env = new MockEnvironment();
        CustomException ex = assertThrows(CustomException.class, () -> epp.postProcessEnvironment(env, app));
        assertTrue(ex.getMessage().contains(ProdDeploymentRules.MSG_PROFILE));
    }

    @Test
    void multiProfileProdDevFailsBeforeContext() {
        MockEnvironment env = new MockEnvironment();
        env.setActiveProfiles("prod", "dev");
        CustomException ex = assertThrows(CustomException.class, () -> epp.postProcessEnvironment(env, app));
        assertTrue(ex.getMessage().contains(ProdDeploymentRules.MSG_PROFILE));
    }

    @Test
    void unknownProfileFails() {
        MockEnvironment env = new MockEnvironment();
        env.setActiveProfiles("staging");
        CustomException ex = assertThrows(CustomException.class, () -> epp.postProcessEnvironment(env, app));
        assertTrue(ex.getMessage().contains(ProdDeploymentRules.MSG_PROFILE));
    }

    @Test
    void devProfilePassesWithoutProdRules() {
        MockEnvironment env = new MockEnvironment();
        env.setActiveProfiles("dev");
        assertDoesNotThrow(() -> epp.postProcessEnvironment(env, app));
    }

    @Test
    void testProfilePassesWithoutProdRules() {
        MockEnvironment env = new MockEnvironment();
        env.setActiveProfiles("test");
        assertDoesNotThrow(() -> epp.postProcessEnvironment(env, app));
    }

    @Test
    void prodSafeConfigPasses() {
        assertDoesNotThrow(() -> epp.postProcessEnvironment(productionEnvironment(), app));
    }

    @Test
    void prodRejectsTestDatabaseWithExactMessage() {
        MockEnvironment env = productionEnvironment();
        env.setProperty("spring.datasource.url", "jdbc:mysql://db.internal:3306/test");
        CustomException ex = assertThrows(CustomException.class, () -> epp.postProcessEnvironment(env, app));
        assertTrue(ex.getMessage().contains(ProdDeploymentRules.MSG_FORBIDDEN_DB));
    }

    @Test
    void springFactoriesRegistersThisProcessor() throws Exception {
        Path factories = Path.of("src/main/resources/META-INF/spring.factories");
        assertTrue(Files.exists(factories), "META-INF/spring.factories must exist");
        String text = Files.readString(factories, StandardCharsets.UTF_8);
        assertTrue(text.contains("org.springframework.boot.env.EnvironmentPostProcessor"),
                "must register EnvironmentPostProcessor key");
        assertTrue(text.contains("com.example.component.ProdDeploymentEnvironmentPostProcessor"),
                "must list ProdDeploymentEnvironmentPostProcessor");
        Path badImports = Path.of("src/main/resources/META-INF/spring/org.springframework.boot.env.EnvironmentPostProcessor.imports");
        assertTrue(!Files.exists(badImports), "misleading .imports file must be removed");
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
