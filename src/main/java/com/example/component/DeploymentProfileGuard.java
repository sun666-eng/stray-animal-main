package com.example.component;

import com.example.exception.CustomException;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;

import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;

/**
 * 生产 profile 硬闸：使用 Spring {@link Environment} 最终绑定值，而非仅 System.getenv。
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
public class DeploymentProfileGuard implements ApplicationRunner {

    private static final Set<String> ALLOWED_PROFILES = new HashSet<>(Arrays.asList("dev", "prod", "test"));
    private final Environment environment;

    public DeploymentProfileGuard(Environment environment) {
        this.environment = environment;
    }

    @Override
    public void run(ApplicationArguments args) {
        String[] profiles = environment.getActiveProfiles();
        if (profiles.length != 1 || !ALLOWED_PROFILES.contains(profiles[0])) {
            throw new CustomException("500", "必须显式且仅激活 dev、prod 或 test 中的一个运行 profile");
        }
        if (!"prod".equals(profiles[0])) {
            return;
        }

        String jdbcUrl = firstNonBlank(
                environment.getProperty("spring.datasource.url"),
                environment.getProperty("SPRING_DATASOURCE_URL"));
        if (jdbcUrl == null || jdbcUrl.trim().isEmpty()) {
            throw new CustomException("500", "生产 spring.datasource.url 缺失");
        }
        String lowerUrl = jdbcUrl.toLowerCase(Locale.ROOT);
        if (lowerUrl.contains("localhost") || lowerUrl.contains("127.0.0.1")) {
            throw new CustomException("500", "生产 JDBC URL 不得指向 localhost");
        }

        String username = firstNonBlank(
                environment.getProperty("spring.datasource.username"),
                environment.getProperty("DB_USERNAME"));
        if (username == null || username.trim().isEmpty()) {
            throw new CustomException("500", "生产数据库用户名缺失");
        }
        if ("root".equalsIgnoreCase(username.trim())) {
            throw new CustomException("500", "生产数据库禁止使用 root 账号");
        }

        String password = firstNonBlank(
                environment.getProperty("spring.datasource.password"),
                environment.getProperty("DB_PASSWORD"));
        if (password == null || password.trim().isEmpty()) {
            throw new CustomException("500", "生产数据库密码缺失");
        }

        String uploadDir = firstNonBlank(
                environment.getProperty("file.upload-dir"),
                environment.getProperty("file.upload.dir"),
                environment.getProperty("FILE_UPLOAD_DIR"));
        if (uploadDir == null || uploadDir.trim().isEmpty()) {
            throw new CustomException("500", "生产 FILE_UPLOAD_DIR / file.upload-dir 缺失");
        }
        Path uploadPath = Paths.get(uploadDir.trim());
        if (!uploadPath.isAbsolute()) {
            throw new CustomException("500", "生产上传目录必须是绝对路径");
        }

        String jwtSecret = firstNonBlank(
                environment.getProperty("app.jwt.secret"),
                environment.getProperty("JWT_SECRET"));
        if (jwtSecret == null || jwtSecret.trim().length() < 32) {
            throw new CustomException("500", "生产 JWT_SECRET / app.jwt.secret 必须配置且长度≥32");
        }

        Boolean autoMigrate = environment.getProperty("app.schema-guard.auto-migrate", Boolean.class);
        if (autoMigrate == null) {
            autoMigrate = Boolean.TRUE;
        }
        if (Boolean.TRUE.equals(autoMigrate)) {
            throw new CustomException("500", "生产必须 app.schema-guard.auto-migrate=false（pure-check）");
        }
    }

    private static String firstNonBlank(String... values) {
        if (values == null) {
            return null;
        }
        for (String value : values) {
            if (value != null && !value.trim().isEmpty()) {
                return value.trim();
            }
        }
        return null;
    }
}
