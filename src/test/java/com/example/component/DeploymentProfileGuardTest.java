package com.example.component;

import com.example.exception.CustomException;
import org.junit.jupiter.api.Test;
import org.springframework.boot.DefaultApplicationArguments;
import org.springframework.mock.env.MockEnvironment;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Paths;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class DeploymentProfileGuardTest {

    @Test
    void noProfileFailsBeforeApplicationRunnersCanMutateData() {
        DeploymentProfileGuard guard = new DeploymentProfileGuard(new MockEnvironment());

        CustomException error = assertThrows(CustomException.class,
                () -> guard.run(new DefaultApplicationArguments(new String[0])));

        assertEquals("500", error.getCode());
    }

    @Test
    void explicitDevelopmentProfileIsAccepted() {
        MockEnvironment environment = new MockEnvironment();
        environment.setActiveProfiles("dev");

        assertDoesNotThrow(() -> new DeploymentProfileGuard(environment)
                .run(new DefaultApplicationArguments(new String[0])));
    }

    @Test
    void productionUsesEnvironmentBindingsNotOnlyGetenv() {
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

        assertDoesNotThrow(() -> new DeploymentProfileGuard(environment)
                .run(new DefaultApplicationArguments(new String[0])));
    }

    @Test
    void productionRejectsAutoMigrateTrue() {
        MockEnvironment environment = new MockEnvironment();
        environment.setActiveProfiles("prod");
        environment.setProperty("spring.datasource.url", "jdbc:mysql://db.internal:3306/animal");
        environment.setProperty("spring.datasource.username", "app_user");
        environment.setProperty("spring.datasource.password", "secret-password");
        environment.setProperty("file.upload-dir", "C:/data/uploads");
        environment.setProperty("app.jwt.secret", "prod-secret-with-enough-length-32chars");
        environment.setProperty("app.ai.config-encryption-key", "independent-ai-config-key-32-bytes-minimum");
        environment.setProperty("app.schema-guard.auto-migrate", "true");

        CustomException error = assertThrows(CustomException.class,
                () -> new DeploymentProfileGuard(environment)
                        .run(new DefaultApplicationArguments(new String[0])));
        assertEquals("500", error.getCode());
    }

    @Test
    void productionRejectsLoopbackPersonalConfigFromFinalEnvironment() {
        MockEnvironment environment = productionEnvironment();
        environment.setProperty("app.ai.allow-loopback-personal-config", "true");

        CustomException error = assertThrows(CustomException.class,
                () -> new DeploymentProfileGuard(environment)
                        .run(new DefaultApplicationArguments(new String[0])));

        assertEquals("500", error.getCode());
    }

    @Test
    void productionRequiresIndependentAiEncryptionKey() {
        MockEnvironment missing = productionEnvironment();
        missing.setProperty("app.ai.config-encryption-key", "");
        assertThrows(CustomException.class, () -> new DeploymentProfileGuard(missing).run(null));

        MockEnvironment sharedWithJwt = productionEnvironment();
        sharedWithJwt.setProperty("app.ai.config-encryption-key",
                sharedWithJwt.getProperty("app.jwt.secret"));
        assertThrows(CustomException.class, () -> new DeploymentProfileGuard(sharedWithJwt).run(null));
    }

    @Test
    void productionRejectsMissingOrUnsafeDatabaseName() {
        MockEnvironment missing = productionEnvironment();
        missing.setProperty("spring.datasource.url", "jdbc:mysql://db.internal:3306/?connectTimeout=5000");
        assertThrows(CustomException.class, () -> new DeploymentProfileGuard(missing).run(null));

        for (String database : new String[]{"test", "mysql", "information_schema", "performance_schema", "sys"}) {
            MockEnvironment unsafe = productionEnvironment();
            unsafe.setProperty("spring.datasource.url", "jdbc:mysql://db.internal:3306/" + database);
            assertThrows(CustomException.class, () -> new DeploymentProfileGuard(unsafe).run(null));
        }
    }

    @Test
    void productionRejectsMissingRelativeOrDevelopmentUploadDirectory() {
        MockEnvironment missing = productionEnvironment();
        missing.setProperty("file.upload-dir", "");
        assertThrows(CustomException.class, () -> new DeploymentProfileGuard(missing).run(null));

        MockEnvironment relative = productionEnvironment();
        relative.setProperty("file.upload-dir", "uploads");
        assertThrows(CustomException.class, () -> new DeploymentProfileGuard(relative).run(null));

        MockEnvironment developmentDefault = productionEnvironment();
        developmentDefault.setProperty("user.home", "C:/Users/developer");
        developmentDefault.setProperty("file.upload-dir", "C:/Users/developer/.stray-animal/upload");
        assertThrows(CustomException.class, () -> new DeploymentProfileGuard(developmentDefault).run(null));
    }

    @Test
    void productionMeasuresAiEncryptionKeyInUtf8Bytes() {
        MockEnvironment environment = productionEnvironment();
        environment.setProperty("app.ai.config-encryption-key", "独立加密密钥十二三四五六七八九十");

        assertDoesNotThrow(() -> new DeploymentProfileGuard(environment).run(null));
    }

    @Test
    void productionYamlPinsAiSafetyAndJdbcTimeouts() throws Exception {
        String yaml = new String(Files.readAllBytes(
                Paths.get("src/main/resources/application-prod.yml")), StandardCharsets.UTF_8);
        String devYaml = new String(Files.readAllBytes(
                Paths.get("src/main/resources/application-dev.yml")), StandardCharsets.UTF_8);

        assertEquals(1, count(yaml, "allow-loopback-personal-config: false"));
        assertEquals(1, count(yaml, "allow-proxy-synthetic-dns: false"));
        assertEquals(1, count(devYaml,
                "allow-proxy-synthetic-dns: ${AI_ALLOW_PROXY_SYNTHETIC_DNS:true}"));
        assertEquals(1, count(yaml, "config-encryption-key: ${AI_CONFIG_ENCRYPTION_KEY:}"));
        assertEquals(1, count(yaml, "connectTimeout=5000&socketTimeout=60000"));
        assertEquals(1, count(yaml, "${DB_NAME:}"));
        assertEquals(1, count(yaml, "upload-dir: ${FILE_UPLOAD_DIR:}"));
        assertEquals(0, count(yaml, "${DB_NAME:test}"));
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

    private int count(String value, String token) {
        return (value.length() - value.replace(token, "").length()) / token.length();
    }
}
