package com.example.component;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.env.EnvironmentPostProcessor;
import org.springframework.core.Ordered;
import org.springframework.core.env.ConfigurableEnvironment;

/**
 * Fail-fast deployment profile rules after ConfigData is loaded and before
 * ApplicationContext / DataSource / Tomcat beans initialize.
 *
 * <p>Registered only via {@code META-INF/spring.factories} (Spring Boot 3.4).
 * Single rule source: {@link ProdDeploymentRules}.
 */
public class ProdDeploymentEnvironmentPostProcessor implements EnvironmentPostProcessor, Ordered {

    public static final String MARKER_LOG_PREFIX = "[ProdDeploymentEnvironmentPostProcessor]";

    @Override
    public void postProcessEnvironment(ConfigurableEnvironment environment, SpringApplication application) {
        // Always validate profile set. Production rules apply only when prod is the sole profile.
        // Throws CustomException / IllegalStateException before any business beans are created.
        System.err.println(MARKER_LOG_PREFIX + " validating active profiles before context refresh");
        ProdDeploymentRules.validate(environment);
    }

    @Override
    public int getOrder() {
        // After config data / system env are available; still before bean factory creation.
        return Ordered.HIGHEST_PRECEDENCE + 20;
    }
}
