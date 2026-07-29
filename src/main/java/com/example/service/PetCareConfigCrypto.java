package com.example.service;

import com.example.exception.CustomException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import javax.crypto.Cipher;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardOpenOption;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.EnumSet;

import static java.nio.file.attribute.PosixFilePermission.OWNER_READ;
import static java.nio.file.attribute.PosixFilePermission.OWNER_WRITE;

/**
 * 个人 API Key 的静态加密。
 *
 * <p>优先使用 AI_CONFIG_ENCRYPTION_KEY；dev/test 未配置时使用 JWT_SECRET 做域隔离派生，
 * 两者均为空时在 ~/.stray-animal/ai-config.key 生成一次并持续复用。prod 禁止任何回退。
 */
@Component
public class PetCareConfigCrypto {

    static final String UNREADABLE_MESSAGE = "个人 API 配置无法解密，请清除后重新配置";
    private static final String VERSION = "v1";
    private static final int NONCE_BYTES = 12;
    private static final int GCM_TAG_BITS = 128;
    private static final SecureRandom RANDOM = new SecureRandom();

    @Value("${app.ai.config-encryption-key:}")
    private String configuredKey;

    @Value("${app.jwt.secret:}")
    private String jwtSecret;

    @Value("${user.home:}")
    private String userHome;

    @Value("${spring.profiles.active:}")
    private String activeProfiles;

    private volatile SecretKey cachedKey;

    public String encrypt(Long userId, String plaintext) {
        requireUserId(userId);
        return encryptWithAad(aad(userId), plaintext);
    }

    public String encryptAdminAgent(String plaintext) {
        return encryptWithAad(adminAgentAad(), plaintext);
    }

    private String encryptWithAad(byte[] associatedData, String plaintext) {
        if (plaintext == null || plaintext.trim().isEmpty()) {
            throw new CustomException("400", "API Key 不能为空");
        }
        try {
            byte[] nonce = new byte[NONCE_BYTES];
            RANDOM.nextBytes(nonce);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, masterKey(), new GCMParameterSpec(GCM_TAG_BITS, nonce));
            cipher.updateAAD(associatedData);
            byte[] encrypted = cipher.doFinal(plaintext.getBytes(StandardCharsets.UTF_8));
            Base64.Encoder encoder = Base64.getUrlEncoder().withoutPadding();
            return VERSION + "." + encoder.encodeToString(nonce) + "." + encoder.encodeToString(encrypted);
        } catch (CustomException e) {
            throw e;
        } catch (Exception e) {
            throw new CustomException("500", "API Key 加密失败，请检查服务端密钥配置");
        }
    }

    public String decrypt(Long userId, String ciphertext) {
        requireUserId(userId);
        return decryptWithAad(aad(userId), ciphertext);
    }

    public String decryptAdminAgent(String ciphertext) {
        return decryptWithAad(adminAgentAad(), ciphertext);
    }

    private String decryptWithAad(byte[] associatedData, String ciphertext) {
        if (ciphertext == null || ciphertext.trim().isEmpty()) {
            throw unreadable();
        }
        try {
            String[] parts = ciphertext.split("\\.", -1);
            if (parts.length != 3 || !VERSION.equals(parts[0])) {
                throw unreadable();
            }
            Base64.Decoder decoder = Base64.getUrlDecoder();
            byte[] nonce = decoder.decode(parts[1]);
            if (nonce.length != NONCE_BYTES) {
                throw unreadable();
            }
            byte[] encrypted = decoder.decode(parts[2]);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, masterKey(), new GCMParameterSpec(GCM_TAG_BITS, nonce));
            cipher.updateAAD(associatedData);
            return new String(cipher.doFinal(encrypted), StandardCharsets.UTF_8);
        } catch (CustomException e) {
            throw e;
        } catch (Exception e) {
            throw unreadable();
        }
    }

    private SecretKey masterKey() {
        SecretKey local = cachedKey;
        if (local != null) {
            return local;
        }
        synchronized (this) {
            if (cachedKey == null) {
                cachedKey = new SecretKeySpec(sha256(loadKeyMaterial()), "AES");
            }
            return cachedKey;
        }
    }

    private byte[] loadKeyMaterial() {
        String explicit = trim(configuredKey);
        if (!explicit.isEmpty()) {
            boolean production = isProductionProfile();
            if (production ? explicit.getBytes(StandardCharsets.UTF_8).length < 32 : explicit.length() < 32) {
                throw new CustomException("500", production
                        ? "AI_CONFIG_ENCRYPTION_KEY 长度必须至少 32 字节"
                        : "AI_CONFIG_ENCRYPTION_KEY 长度必须至少 32 个字符");
            }
            if (production && explicit.equals(trim(jwtSecret))) {
                throw new CustomException("500", "生产 AI_CONFIG_ENCRYPTION_KEY 必须与 JWT_SECRET 独立");
            }
            return ("petcare-config:v1:" + explicit).getBytes(StandardCharsets.UTF_8);
        }
        if (isProductionProfile()) {
            throw new CustomException("500", "生产必须独立配置至少 32 字节的 AI_CONFIG_ENCRYPTION_KEY");
        }
        String jwt = trim(jwtSecret);
        if (!jwt.isEmpty()) {
            if (jwt.length() < 32) {
                throw new CustomException("500", "JWT_SECRET 长度必须至少 32 个字符");
            }
            return ("petcare-config:v1:" + jwt).getBytes(StandardCharsets.UTF_8);
        }
        return loadOrCreateDevelopmentKey();
    }

    private boolean isProductionProfile() {
        for (String profile : trim(activeProfiles).split(",")) {
            if ("prod".equalsIgnoreCase(profile.trim())) {
                return true;
            }
        }
        return false;
    }

    private byte[] loadOrCreateDevelopmentKey() {
        try {
            Path home = trim(userHome).isEmpty()
                    ? Paths.get(System.getProperty("user.home"))
                    : Paths.get(userHome);
            Path directory = home.toAbsolutePath().normalize().resolve(".stray-animal");
            Path keyFile = directory.resolve("ai-config.key");
            Files.createDirectories(directory);
            if (!Files.exists(keyFile)) {
                byte[] generated = new byte[32];
                RANDOM.nextBytes(generated);
                String encoded = Base64.getEncoder().encodeToString(generated);
                try {
                    Files.write(keyFile, encoded.getBytes(StandardCharsets.US_ASCII),
                            StandardOpenOption.CREATE_NEW, StandardOpenOption.WRITE);
                } catch (java.nio.file.FileAlreadyExistsException ignored) {
                    // 另一启动线程/实例已完成创建，直接读取其结果。
                }
                try {
                    Files.setPosixFilePermissions(keyFile, EnumSet.of(OWNER_READ, OWNER_WRITE));
                } catch (UnsupportedOperationException ignored) {
                    // Windows 等不支持 POSIX 权限的平台由用户目录 ACL 保护。
                }
            }
            String encoded = new String(Files.readAllBytes(keyFile), StandardCharsets.US_ASCII).trim();
            byte[] decoded = Base64.getDecoder().decode(encoded);
            if (decoded.length != 32) {
                throw new IllegalStateException("invalid local key length");
            }
            return decoded;
        } catch (Exception e) {
            throw new CustomException("500", "无法读取本地 API 配置加密密钥");
        }
    }

    private byte[] aad(Long userId) {
        return ("t_petcare_ai_config:user:" + userId).getBytes(StandardCharsets.UTF_8);
    }

    private byte[] adminAgentAad() {
        return "t_admin_agent_config:singleton:1".getBytes(StandardCharsets.UTF_8);
    }

    private byte[] sha256(byte[] value) {
        try {
            return MessageDigest.getInstance("SHA-256").digest(value);
        } catch (Exception e) {
            throw new CustomException("500", "API 配置加密算法不可用");
        }
    }

    private void requireUserId(Long userId) {
        if (userId == null || userId <= 0) {
            throw new CustomException("401", "未登录或登录已过期");
        }
    }

    private CustomException unreadable() {
        return new CustomException("500", UNREADABLE_MESSAGE);
    }

    private String trim(String value) {
        return value == null ? "" : value.trim();
    }
}
