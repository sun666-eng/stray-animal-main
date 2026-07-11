package com.example.common;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.SignatureAlgorithm;
import io.jsonwebtoken.security.Keys;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.core.env.Environment;
import org.springframework.core.env.Profiles;
import org.springframework.stereotype.Component;

import javax.crypto.SecretKey;
import java.util.Date;

@Component
public class JwtUtil {

    private static final long EXPIRE = 7 * 24 * 60 * 60 * 1000; // 7天
    private static final String DEV_SECRET = "animal-home-development-secret-please-change";
    private static volatile SecretKey KEY = loadKey(null);

    /**
     * Strict programmatic configuration used by tests and production callers.
     */
    public void setConfiguredSecret(String configuredSecret) {
        if (configuredSecret == null || configuredSecret.trim().length() < 32
                || DEV_SECRET.equals(configuredSecret.trim())) {
            throw new IllegalStateException("JWT_SECRET must be configured with at least 32 characters and must not use the development secret");
        }
        KEY = loadKey(configuredSecret);
    }

    /**
     * Spring startup configuration: only dev/test profiles may use the local
     * development key. All other profiles fail fast when JWT_SECRET is absent.
     */
    @Autowired
    public void configureForApplication(@Value("${app.jwt.secret:}") String configuredSecret,
                                        Environment environment) {
        boolean developmentProfile = environment.acceptsProfiles(Profiles.of("dev", "test"));
        String secret = configuredSecret == null ? "" : configuredSecret.trim();
        if (developmentProfile && secret.isEmpty()) {
            KEY = loadKey(DEV_SECRET);
            return;
        }
        if (developmentProfile && DEV_SECRET.equals(secret)) {
            KEY = loadKey(secret);
            return;
        }
        setConfiguredSecret(secret);
    }

    private static SecretKey loadKey(String configuredSecret) {
        String secret = System.getenv("JWT_SECRET");
        if ((secret == null || secret.trim().isEmpty()) && configuredSecret != null && !configuredSecret.trim().isEmpty()) {
            secret = configuredSecret;
        }
        if (secret == null || secret.trim().isEmpty()) {
            secret = System.getProperty("app.jwt.secret");
        }
        if (secret == null || secret.trim().length() < 32) {
            // 仅供不启动 Spring 容器的单元测试初始化；应用启动时 setConfiguredSecret 会强制校验配置。
            secret = DEV_SECRET;
        }
        return Keys.hmacShaKeyFor(secret.getBytes(java.nio.charset.StandardCharsets.UTF_8));
    }

    public static String createToken(Long userId, String username) {
        Date now = new Date();
        return Jwts.builder()
                .setSubject(String.valueOf(userId))
                .claim("username", username)
                .setIssuedAt(now)
                .setExpiration(new Date(now.getTime() + EXPIRE))
                .signWith(KEY, SignatureAlgorithm.HS256)
                .compact();
    }

    public static Claims parseToken(String token) {
        return Jwts.parserBuilder()
                .setSigningKey(KEY)
                .build()
                .parseClaimsJws(token)
                .getBody();
    }

    public static boolean validate(String token) {
        try {
            parseToken(token);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    public static Long getUserId(String token) {
        return Long.valueOf(parseToken(token).getSubject());
    }

    public static String getUsername(String token) {
        return parseToken(token).get("username", String.class);
    }
}
