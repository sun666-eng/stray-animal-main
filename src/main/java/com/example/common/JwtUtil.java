package com.example.common;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.SignatureAlgorithm;
import io.jsonwebtoken.security.Keys;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;

import javax.crypto.SecretKey;
import java.util.Arrays;
import java.util.Date;
import java.util.HashSet;
import java.util.Set;

@Component
public class JwtUtil {

    /** 过渡期仍签发 token；计划最终浏览器可不依赖。有效期缩短为 30 分钟。 */
    private static final long EXPIRE = 30 * 60 * 1000L;
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
     * A0.1：profile 优先级。
     * <ul>
     *   <li>只要 active 含 prod → 强制生产密钥规则（即使同时有 dev）</li>
     *   <li>仅 dev 或 test（且无 prod）且 app.jwt.allow-dev-secret=true 才可用开发密钥</li>
     *   <li>无 profile / 未知 profile → 安全默认，必须配置 JWT_SECRET</li>
     * </ul>
     */
    @Autowired
    public void configureForApplication(@Value("${app.jwt.secret:}") String configuredSecret,
                                        @Value("${app.jwt.allow-dev-secret:false}") boolean allowDevSecret,
                                        Environment environment) {
        Set<String> active = new HashSet<>();
        for (String p : environment.getActiveProfiles()) {
            if (p != null && !p.trim().isEmpty()) {
                active.add(p.trim().toLowerCase());
            }
        }
        // default profiles 仅在无 active 时参与判断（Spring 行为）；此处显式读取
        if (active.isEmpty()) {
            for (String p : environment.getDefaultProfiles()) {
                if (p != null && !p.trim().isEmpty()) {
                    active.add(p.trim().toLowerCase());
                }
            }
        }

        boolean hasProd = active.contains("prod");
        boolean onlyDevOrTest = !active.isEmpty()
                && active.stream().allMatch(p -> "dev".equals(p) || "test".equals(p));

        String secret = configuredSecret == null ? "" : configuredSecret.trim();

        // prod 无条件生产规则
        if (hasProd) {
            setConfiguredSecret(secret);
            return;
        }

        // 仅 dev/test 且允许开发密钥
        if (onlyDevOrTest && allowDevSecret) {
            if (secret.isEmpty() || DEV_SECRET.equals(secret)) {
                KEY = loadKey(DEV_SECRET);
                return;
            }
            // 显式配置了非开发密钥时使用配置值（仍须足够长）
            if (secret.length() >= 32 && !DEV_SECRET.equals(secret)) {
                KEY = loadKey(secret);
                return;
            }
            KEY = loadKey(DEV_SECRET);
            return;
        }

        // 无 profile 或未知 profile：安全默认
        setConfiguredSecret(secret);
    }

    /** 供测试探测当前是否仍为开发密钥（不暴露密钥字节）。 */
    public static boolean isUsingDevelopmentSecretForTests() {
        try {
            String probe = createToken(-1L, "probe");
            // 若能用 DEV_SECRET 解析则说明当前 KEY 来自开发密钥路径
            SecretKey dev = Keys.hmacShaKeyFor(DEV_SECRET.getBytes(java.nio.charset.StandardCharsets.UTF_8));
            Jwts.parserBuilder().setSigningKey(dev).build().parseClaimsJws(probe);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    public static String getDevSecretConstantForTests() {
        return DEV_SECRET;
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
            // 仅供不启动 Spring 容器的单元测试初始化
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
