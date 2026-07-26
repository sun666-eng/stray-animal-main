package com.example.component;

import com.example.exception.CustomException;
import org.junit.jupiter.api.Test;
import org.springframework.boot.DefaultApplicationArguments;
import org.springframework.mock.env.MockEnvironment;

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
        environment.setProperty("app.schema-guard.auto-migrate", "false");

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
        environment.setProperty("app.schema-guard.auto-migrate", "true");

        CustomException error = assertThrows(CustomException.class,
                () -> new DeploymentProfileGuard(environment)
                        .run(new DefaultApplicationArguments(new String[0])));
        assertEquals("500", error.getCode());
    }
}
