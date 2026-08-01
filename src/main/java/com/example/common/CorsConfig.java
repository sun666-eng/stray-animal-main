package com.example.common;

import com.example.component.ProdDeploymentRules;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.env.Environment;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;
import org.springframework.web.filter.CorsFilter;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;

@Configuration
public class CorsConfig {

    private static final long MAX_AGE = 24 * 60 * 60;

    @Value("${app.cors.allowed-origin-patterns:http://localhost:*,http://127.0.0.1:*}")
    private String allowedOriginPatterns;

    private final Environment environment;

    public CorsConfig(Environment environment) {
        this.environment = environment;
    }

    private CorsConfiguration buildConfig() {
        for (String profile : environment.getActiveProfiles()) {
            if ("prod".equals(profile)) {
                ProdDeploymentRules.validateCorsPatterns(allowedOriginPatterns);
                break;
            }
        }
        CorsConfiguration corsConfiguration = new CorsConfiguration();
        List<String> patterns = new ArrayList<>();
        for (String part : allowedOriginPatterns.split("\\s*,\\s*")) {
            if (part != null && !part.trim().isEmpty()) {
                patterns.add(part.trim());
            }
        }
        corsConfiguration.setAllowedOriginPatterns(patterns);
        corsConfiguration.setAllowedHeaders(Collections.singletonList("*"));
        corsConfiguration.setAllowedMethods(Arrays.asList("GET", "POST", "PUT", "DELETE", "OPTIONS"));
        // credentials=true requires concrete/pattern origins — never "*" as allowedOrigin
        corsConfiguration.setAllowCredentials(true);
        corsConfiguration.setMaxAge(MAX_AGE);
        return corsConfiguration;
    }

    @Bean
    public CorsFilter corsFilter() {
        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/**", buildConfig());
        return new CorsFilter(source);
    }
}
