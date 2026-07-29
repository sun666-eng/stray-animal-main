package com.example.service;

import com.example.exception.CustomException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.test.util.ReflectionTestUtils;

import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class PetCareConfigCryptoTest {

    @TempDir
    Path tempDir;

    private PetCareConfigCrypto crypto;

    @BeforeEach
    void setUp() {
        crypto = new PetCareConfigCrypto();
        ReflectionTestUtils.setField(crypto, "configuredKey",
                "test-only-petcare-encryption-key-123456789");
        ReflectionTestUtils.setField(crypto, "jwtSecret", "");
        ReflectionTestUtils.setField(crypto, "userHome", "");
        ReflectionTestUtils.setField(crypto, "activeProfiles", "test");
    }

    @Test
    void encryptsWithRandomNonceAndDecryptsForOwner() {
        String first = crypto.encrypt(7L, "sk-real-secret");
        String second = crypto.encrypt(7L, "sk-real-secret");

        assertFalse(first.contains("sk-real-secret"));
        assertNotEquals(first, second);
        assertEquals("sk-real-secret", crypto.decrypt(7L, first));
        assertEquals("sk-real-secret", crypto.decrypt(7L, second));
    }

    @Test
    void ciphertextCannotBeMovedToAnotherAccountOrTampered() {
        String ciphertext = crypto.encrypt(7L, "sk-real-secret");

        assertThrows(CustomException.class, () -> crypto.decrypt(8L, ciphertext));
        assertThrows(CustomException.class,
                () -> crypto.decrypt(7L, ciphertext.substring(0, ciphertext.length() - 2) + "aa"));
    }

    @Test
    void administratorSecretUsesIndependentAuthenticatedDomain() {
        String administratorCiphertext = crypto.encryptAdminAgent("sk-admin-secret");
        String userCiphertext = crypto.encrypt(7L, "sk-user-secret");

        assertEquals("sk-admin-secret", crypto.decryptAdminAgent(administratorCiphertext));
        assertThrows(CustomException.class, () -> crypto.decrypt(7L, administratorCiphertext));
        assertThrows(CustomException.class, () -> crypto.decryptAdminAgent(userCiphertext));
    }

    @Test
    void developmentKeyFileSurvivesAProcessRestart() {
        PetCareConfigCrypto firstProcess = developmentCrypto();
        String ciphertext = firstProcess.encrypt(11L, "sk-persistent");

        PetCareConfigCrypto restartedProcess = developmentCrypto();

        assertEquals("sk-persistent", restartedProcess.decrypt(11L, ciphertext));
        assertTrue(Files.exists(tempDir.resolve(".stray-animal").resolve("ai-config.key")));
    }

    @Test
    void productionNeverFallsBackToJwtOrLocalFile() {
        ReflectionTestUtils.setField(crypto, "configuredKey", "");
        ReflectionTestUtils.setField(crypto, "jwtSecret", "jwt-secret-with-enough-length-32-characters");
        ReflectionTestUtils.setField(crypto, "userHome", tempDir.toString());
        ReflectionTestUtils.setField(crypto, "activeProfiles", "prod");

        assertThrows(CustomException.class, () -> crypto.encrypt(7L, "sk-secret"));
        assertFalse(Files.exists(tempDir.resolve(".stray-animal").resolve("ai-config.key")));
    }

    @Test
    void productionRejectsEncryptionKeySharedWithJwt() {
        String shared = "shared-production-secret-at-least-32-characters";
        ReflectionTestUtils.setField(crypto, "configuredKey", shared);
        ReflectionTestUtils.setField(crypto, "jwtSecret", shared);
        ReflectionTestUtils.setField(crypto, "activeProfiles", "prod");

        assertThrows(CustomException.class, () -> crypto.encrypt(7L, "sk-secret"));
    }

    @Test
    void developmentKeepsCharacterBasedExplicitKeyMinimum() {
        ReflectionTestUtils.setField(crypto, "configuredKey", "中文中文中文中文中文中文中文中文");
        ReflectionTestUtils.setField(crypto, "activeProfiles", "dev");

        assertThrows(CustomException.class, () -> crypto.encrypt(7L, "sk-secret"));
    }

    private PetCareConfigCrypto developmentCrypto() {
        PetCareConfigCrypto value = new PetCareConfigCrypto();
        ReflectionTestUtils.setField(value, "configuredKey", "");
        ReflectionTestUtils.setField(value, "jwtSecret", "");
        ReflectionTestUtils.setField(value, "userHome", tempDir.toString());
        ReflectionTestUtils.setField(value, "activeProfiles", "dev");
        return value;
    }
}
