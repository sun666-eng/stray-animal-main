package com.example.component;

import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;

/**
 * Production profile hard gate (ApplicationRunner defense-in-depth).
 * Primary early gate: {@link ProdDeploymentEnvironmentPostProcessor} + DataSourceConfig.
 * Rules: {@link ProdDeploymentRules} only — no second rule set.
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
public class DeploymentProfileGuard implements ApplicationRunner {

    private final Environment environment;

    public DeploymentProfileGuard(Environment environment) {
        this.environment = environment;
    }

    @Override
    public void run(ApplicationArguments args) {
        ProdDeploymentRules.validate(environment);
    }
}
