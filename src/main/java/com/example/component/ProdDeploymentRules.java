package com.example.component;

import com.example.exception.CustomException;
import org.springframework.core.env.Environment;

import java.nio.charset.StandardCharsets;
import java.nio.file.InvalidPathException;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;

/**
 * Single source of truth for production deployment hard gates.
 * Invoked before DataSource/MyBatis/FileStorage init (EnvironmentPostProcessor)
 * and again by {@link DeploymentProfileGuard} for defense in depth.
 */
public final class ProdDeploymentRules {

    public static final Set<String> ALLOWED_PROFILES = new HashSet<>(Arrays.asList("dev", "prod", "test"));
    public static final Set<String> FORBIDDEN_DATABASES = new HashSet<>(Arrays.asList(
            "test", "mysql", "information_schema", "performance_schema", "sys"));

    /** Exact phrases required by production fail-fast contract / Phase 4B ledger. */
    public static final String MSG_PROFILE =
            "必须显式且仅激活 dev、prod 或 test 中的一个运行 profile";
    public static final String MSG_FORBIDDEN_DB =
            "禁止使用测试库或系统库";
    public static final String MSG_ROOT_USER =
            "生产数据库禁止 root";
    public static final String MSG_PASSWORD_MISSING =
            "生产数据库密码缺失";
    public static final String MSG_CORS_UNSAFE =
            "生产 CORS 禁止空来源或无约束通配符";

    private ProdDeploymentRules() {
    }

    /**
     * Validate active profile set; when prod, enforce full production contract.
     * Safe to call when profiles are empty (fails closed).
     */
    public static void validate(Environment environment) {
        if (environment == null) {
            throw new CustomException("500", MSG_PROFILE);
        }
        String[] profiles = environment.getActiveProfiles();
        if (profiles.length != 1 || !ALLOWED_PROFILES.contains(profiles[0])) {
            throw new CustomException("500", MSG_PROFILE);
        }
        if (!"prod".equals(profiles[0])) {
            return;
        }
        validateProduction(environment);
    }

    public static void validateProduction(Environment environment) {
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
        String database = extractDatabaseName(jdbcUrl);
        if (database == null) {
            throw new CustomException("500", "生产 JDBC URL 必须包含非空数据库名");
        }
        if (FORBIDDEN_DATABASES.contains(database.toLowerCase(Locale.ROOT))) {
            throw new CustomException("500", MSG_FORBIDDEN_DB);
        }

        String username = firstNonBlank(
                environment.getProperty("spring.datasource.username"),
                environment.getProperty("DB_USERNAME"));
        if (username == null || username.trim().isEmpty()) {
            throw new CustomException("500", "生产数据库用户名缺失");
        }
        if ("root".equalsIgnoreCase(username.trim())) {
            throw new CustomException("500", MSG_ROOT_USER);
        }

        String password = firstNonBlank(
                environment.getProperty("spring.datasource.password"),
                environment.getProperty("DB_PASSWORD"));
        if (password == null || password.isEmpty()) {
            // empty password is never acceptable in prod (whitespace-only also rejected)
            throw new CustomException("500", MSG_PASSWORD_MISSING);
        }
        if (password.trim().isEmpty()) {
            throw new CustomException("500", MSG_PASSWORD_MISSING);
        }

        String uploadDir = firstNonBlank(
                environment.getProperty("file.upload-dir"),
                environment.getProperty("file.upload.dir"),
                environment.getProperty("FILE_UPLOAD_DIR"));
        if (uploadDir == null || uploadDir.trim().isEmpty()) {
            throw new CustomException("500", "生产 FILE_UPLOAD_DIR / file.upload-dir 缺失");
        }
        Path uploadPath;
        try {
            uploadPath = Paths.get(uploadDir.trim());
        } catch (InvalidPathException ex) {
            throw new CustomException("500", "生产上传目录不是有效路径");
        }
        if (!uploadPath.isAbsolute()) {
            throw new CustomException("500", "生产上传目录必须是绝对路径");
        }
        uploadPath = uploadPath.normalize();
        String userHome = firstNonBlank(environment.getProperty("user.home"));
        if (userHome != null) {
            try {
                Path developmentRoot = Paths.get(userHome).toAbsolutePath().normalize().resolve(".stray-animal");
                if (uploadPath.startsWith(developmentRoot)) {
                    throw new CustomException("500", "生产上传目录不得位于 user.home 下的 .stray-animal 开发目录");
                }
            } catch (InvalidPathException ex) {
                throw new CustomException("500", "生产环境 user.home 不是有效路径");
            }
        }

        String jwtSecret = firstNonBlank(
                environment.getProperty("app.jwt.secret"),
                environment.getProperty("JWT_SECRET"));
        if (jwtSecret == null || jwtSecret.trim().length() < 32) {
            throw new CustomException("500", "生产 JWT_SECRET / app.jwt.secret 必须配置且长度≥32");
        }

        Boolean allowLoopbackPersonalConfig = environment.getProperty(
                "app.ai.allow-loopback-personal-config", Boolean.class, Boolean.FALSE);
        if (Boolean.TRUE.equals(allowLoopbackPersonalConfig)) {
            throw new CustomException("500", "生产必须 app.ai.allow-loopback-personal-config=false");
        }
        Boolean allowProxySyntheticDns = environment.getProperty(
                "app.ai.allow-proxy-synthetic-dns", Boolean.class, Boolean.FALSE);
        if (Boolean.TRUE.equals(allowProxySyntheticDns)) {
            throw new CustomException("500", "生产必须 app.ai.allow-proxy-synthetic-dns=false");
        }

        String aiConfigEncryptionKey = firstNonBlank(
                environment.getProperty("app.ai.config-encryption-key"),
                environment.getProperty("AI_CONFIG_ENCRYPTION_KEY"));
        if (aiConfigEncryptionKey == null
                || aiConfigEncryptionKey.getBytes(StandardCharsets.UTF_8).length < 32) {
            throw new CustomException("500", "生产 AI_CONFIG_ENCRYPTION_KEY / app.ai.config-encryption-key 必须独立配置且至少 32 字节");
        }
        if (aiConfigEncryptionKey.equals(jwtSecret.trim())) {
            throw new CustomException("500", "生产 AI_CONFIG_ENCRYPTION_KEY 必须与 JWT_SECRET 独立");
        }

        Boolean autoMigrate = environment.getProperty("app.schema-guard.auto-migrate", Boolean.class);
        if (autoMigrate == null) {
            autoMigrate = Boolean.TRUE;
        }
        if (Boolean.TRUE.equals(autoMigrate)) {
            throw new CustomException("500", "生产必须 app.schema-guard.auto-migrate=false（pure-check）");
        }

        String cors = firstNonBlank(
                environment.getProperty("app.cors.allowed-origin-patterns"),
                environment.getProperty("CORS_ALLOWED_ORIGIN_PATTERNS"));
        validateCorsPatterns(cors);
    }

    /**
     * Reject empty / unrestricted wildcards. Allow domain-constrained patterns such as
     * {@code https://*.example.com} and exact HTTPS origins.
     */
    public static void validateCorsPatterns(String allowedOriginPatterns) {
        if (allowedOriginPatterns == null || allowedOriginPatterns.trim().isEmpty()) {
            throw new CustomException("500", MSG_CORS_UNSAFE);
        }
        String[] parts = allowedOriginPatterns.split("\\s*,\\s*");
        boolean any = false;
        for (String raw : parts) {
            if (raw == null || raw.trim().isEmpty()) {
                continue;
            }
            any = true;
            if (isUnrestrictedCorsPattern(raw.trim())) {
                throw new CustomException("500", MSG_CORS_UNSAFE);
            }
        }
        if (!any) {
            throw new CustomException("500", MSG_CORS_UNSAFE);
        }
    }

    /**
     * Unrestricted / dangerous patterns that effectively allow any origin.
     * Domain-scoped patterns like {@code https://*.example.com} are allowed.
     */
    public static boolean isUnrestrictedCorsPattern(String pattern) {
        if (pattern == null) {
            return true;
        }
        String p = pattern.trim();
        if (p.isEmpty() || "*".equals(p)) {
            return true;
        }
        String lower = p.toLowerCase(Locale.ROOT);
        if ("http://*".equals(lower) || "https://*".equals(lower) || "*://*".equals(lower)
                || "http://*/*".equals(lower) || "https://*/*".equals(lower)
                || "*://*/*".equals(lower)) {
            return true;
        }
        // scheme://* with nothing after (no domain constraint)
        if (lower.matches("https?://\\*") || lower.matches("\\*://\\*")) {
            return true;
        }
        // bare wildcard host without a domain label after *
        // e.g. https://* or http://*.  but NOT https://*.example.com
        if (lower.matches("https?://\\*\\.?") || lower.matches("https?://\\*/\\*?")) {
            return true;
        }
        return false;
    }

    public static String firstNonBlank(String... values) {
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

    public static String extractDatabaseName(String jdbcUrl) {
        if (jdbcUrl == null) {
            return null;
        }
        int scheme = jdbcUrl.indexOf("://");
        if (scheme < 0) {
            return null;
        }
        int pathStart = jdbcUrl.indexOf('/', scheme + 3);
        if (pathStart < 0 || pathStart == jdbcUrl.length() - 1) {
            return null;
        }
        int pathEnd = jdbcUrl.length();
        for (char separator : new char[]{'?', ';', '#'}) {
            int index = jdbcUrl.indexOf(separator, pathStart + 1);
            if (index >= 0 && index < pathEnd) {
                pathEnd = index;
            }
        }
        String database = jdbcUrl.substring(pathStart + 1, pathEnd).trim();
        return database.isEmpty() || database.contains("/") ? null : database;
    }
}
