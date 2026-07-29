package com.example.service;

import com.example.entity.PetCareAiConfig;
import com.example.exception.CustomException;
import com.example.mapper.PetCareAiConfigMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.Date;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.mockito.Mockito.times;

class PetCareAiConfigServiceTest {

    private PetCareAiConfigService service;
    private PetCareAiConfigMapper mapper;
    private PetCareConfigCrypto crypto;
    private PetCareService petCareService;

    @BeforeEach
    void setUp() {
        service = new PetCareAiConfigService();
        mapper = mock(PetCareAiConfigMapper.class);
        crypto = mock(PetCareConfigCrypto.class);
        petCareService = mock(PetCareService.class);
        ReflectionTestUtils.setField(service, "petCareAiConfigMapper", mapper);
        ReflectionTestUtils.setField(service, "crypto", crypto);
        ReflectionTestUtils.setField(service, "petCareService", petCareService);
    }

    @Test
    void persistedConfigCanBeReloadedAfterSessionOrProcessChanges() {
        PetCareAiConfig row = row(8L, "ciphertext");
        when(mapper.selectById(8L)).thenReturn(row);
        when(crypto.decrypt(8L, "ciphertext")).thenReturn("sk-secret");

        PetCareService.AiConnectionConfig loaded = service.find(8L);

        assertTrue(loaded.isEnabled());
        assertEquals("https://api.deepseek.com", loaded.getBaseUrl());
        assertEquals("deepseek-v4-flash", loaded.getModel());
        assertEquals("sk-secret", loaded.getApiKey());
        assertEquals(PetCareAiConfigService.STATUS_UNTESTED, loaded.getConnectionStatus());
        verify(crypto).decrypt(8L, "ciphertext");
    }

    @Test
    void unreadableCiphertextBecomesClearableFailureInsteadOfBreakingThePage() {
        PetCareAiConfig row = row(8L, "broken-ciphertext");
        when(mapper.selectById(8L)).thenReturn(row);
        when(crypto.decrypt(8L, "broken-ciphertext"))
                .thenThrow(new CustomException("500", PetCareConfigCrypto.UNREADABLE_MESSAGE));

        PetCareService.AiConnectionConfig loaded = service.find(8L);

        assertFalse(loaded.isEnabled());
        assertTrue(loaded.isUserProvided());
        assertEquals("", loaded.getApiKey());
        assertEquals(PetCareAiConfigService.STATUS_FAILED, loaded.getConnectionStatus());
        assertEquals(PetCareConfigCrypto.UNREADABLE_MESSAGE, loaded.getConnectionMessage());
    }

    @Test
    void serverKeyConfigurationErrorsAreNotMisreportedAsCorruptUserData() {
        PetCareAiConfig row = row(8L, "ciphertext");
        when(mapper.selectById(8L)).thenReturn(row);
        when(crypto.decrypt(8L, "ciphertext"))
                .thenThrow(new CustomException("500", "无法读取本地 API 配置加密密钥"));

        CustomException failure = assertThrows(CustomException.class, () -> service.find(8L));

        assertEquals("无法读取本地 API 配置加密密钥", failure.getMsg());
    }

    @Test
    void savesCiphertextOnlyAndPreservesExistingKeyWhenInputIsBlank() {
        PetCareAiConfig existingRow = row(8L, "old-ciphertext");
        Date lastTestedAt = new Date(123456L);
        existingRow.setConnectionStatus(PetCareAiConfigService.STATUS_CONNECTED);
        existingRow.setLastTestMessage("连接测试成功");
        existingRow.setLastTestedAt(lastTestedAt);
        when(mapper.selectById(8L)).thenReturn(existingRow);
        when(crypto.decrypt(8L, "old-ciphertext")).thenReturn("sk-existing");
        PetCareService.AiConnectionConfig normalized = new PetCareService.AiConnectionConfig(
                true, "https://api.deepseek.com", "sk-existing", "deepseek-v4-flash", true);
        when(petCareService.createAiConfig(eq(true), eq("https://api.deepseek.com"),
                eq("deepseek-v4-flash"), eq(""), any(PetCareService.AiConnectionConfig.class)))
                .thenReturn(normalized);
        when(mapper.updateConfig(any(PetCareAiConfig.class), eq(1L))).thenReturn(1);

        service.save(8L, true, "https://api.deepseek.com", "deepseek-v4-flash", "");

        ArgumentCaptor<PetCareAiConfig> captor = ArgumentCaptor.forClass(PetCareAiConfig.class);
        verify(mapper).updateConfig(captor.capture(), eq(1L));
        assertEquals("old-ciphertext", captor.getValue().getApiKeyCiphertext());
        assertFalse(captor.getValue().getApiKeyCiphertext().contains("sk-existing"));
        assertEquals(PetCareAiConfigService.STATUS_CONNECTED,
                captor.getValue().getConnectionStatus());
        assertEquals(lastTestedAt, captor.getValue().getLastTestedAt());
        verify(crypto, never()).encrypt(any(), any());
    }

    @Test
    void changingConnectionSettingsKeepsCiphertextButRequiresRetest() {
        PetCareAiConfig existingRow = row(8L, "old-ciphertext");
        existingRow.setConnectionStatus(PetCareAiConfigService.STATUS_CONNECTED);
        existingRow.setLastTestedAt(new Date());
        when(mapper.selectById(8L)).thenReturn(existingRow);
        when(crypto.decrypt(8L, "old-ciphertext")).thenReturn("sk-existing");
        PetCareService.AiConnectionConfig normalized = new PetCareService.AiConnectionConfig(
                true, "https://other.example.com", "sk-existing", "other-model", true);
        when(petCareService.createAiConfig(eq(true), eq("https://other.example.com"),
                eq("other-model"), eq(""), any(PetCareService.AiConnectionConfig.class)))
                .thenReturn(normalized);
        when(mapper.updateConfig(any(PetCareAiConfig.class), eq(1L))).thenReturn(1);

        service.save(8L, true, "https://other.example.com", "other-model", "");

        ArgumentCaptor<PetCareAiConfig> captor = ArgumentCaptor.forClass(PetCareAiConfig.class);
        verify(mapper).updateConfig(captor.capture(), eq(1L));
        assertEquals("old-ciphertext", captor.getValue().getApiKeyCiphertext());
        assertEquals(PetCareAiConfigService.STATUS_UNTESTED,
                captor.getValue().getConnectionStatus());
        assertNull(captor.getValue().getLastTestedAt());
        verify(crypto, never()).encrypt(any(), any());
    }

    @Test
    void realConnectionResultPersistsPerAccount() {
        PetCareAiConfig row = row(8L, "ciphertext");
        when(mapper.selectById(8L)).thenReturn(row);
        when(mapper.markConnectionIfVersion(eq(8L), eq(1L), any(), any(), any())).thenReturn(1);
        when(crypto.decrypt(8L, "ciphertext")).thenReturn("sk-secret");

        PetCareService.AiConnectionConfig result = service.markConnection(
                8L, PetCareAiConfigService.STATUS_FAILED, "HTTP 401");

        assertEquals(PetCareAiConfigService.STATUS_FAILED, result.getConnectionStatus());
        assertEquals("HTTP 401", result.getConnectionMessage());
        assertTrue(result.getLastTestedAt() != null);
        verify(mapper).markConnectionIfVersion(eq(8L), eq(1L),
                eq(PetCareAiConfigService.STATUS_FAILED), eq("HTTP 401"), any());
    }

    @Test
    void missingAndClearAreScopedToAccount() {
        when(mapper.selectById(9L)).thenReturn(null);
        assertNull(service.find(9L));

        assertTrue(service.clear(9L));
        verify(mapper).deleteById(9L);
    }

    @Test
    void staleConnectionTestCannotOverwriteNewerConfigVersion() {
        PetCareAiConfig row = row(8L, "ciphertext");
        row.setVersion(2L);
        when(mapper.markConnectionIfVersion(eq(8L), eq(1L), any(), any(), any()))
                .thenReturn(0);

        com.example.exception.CustomException stale = assertThrows(
                com.example.exception.CustomException.class,
                () -> service.markConnection(8L, 1L,
                        PetCareAiConfigService.STATUS_CONNECTED, "旧测试成功"));

        assertEquals("409", stale.getCode());
        verify(mapper, never()).updateById(any(PetCareAiConfig.class));
    }

    @Test
    void firstConcurrentSaveReusesUniqueRowInsteadOfCreatingDuplicate() {
        PetCareAiConfig existing = row(8L, "winner-ciphertext");
        when(mapper.selectById(8L)).thenReturn(null);
        when(mapper.selectOne(any(com.baomidou.mybatisplus.core.conditions.Wrapper.class)))
                .thenReturn(existing);
        when(crypto.encrypt(8L, "new-key")).thenReturn("new-ciphertext");
        when(crypto.decrypt(8L, "winner-ciphertext")).thenReturn("winner-key");
        PetCareService.AiConnectionConfig first = new PetCareService.AiConnectionConfig(
                true, "https://api.example.com", "new-key", "model", true);
        PetCareService.AiConnectionConfig retry = new PetCareService.AiConnectionConfig(
                true, "https://api.example.com", "new-key", "model", true);
        when(petCareService.createAiConfig(any(Boolean.class), any(), any(), any(), any()))
                .thenReturn(first, retry);
        when(mapper.insertIgnore(any())).thenReturn(0);
        when(mapper.updateConfig(any(), eq(1L))).thenReturn(1);

        PetCareService.AiConnectionConfig saved = service.save(
                8L, true, "https://api.example.com", "model", "new-key");

        assertEquals(2L, saved.getVersion());
        verify(mapper, times(1)).insertIgnore(any());
        verify(mapper, times(1)).updateConfig(any(), eq(1L));
    }

    private PetCareAiConfig row(Long userId, String ciphertext) {
        PetCareAiConfig row = new PetCareAiConfig();
        row.setUserId(userId);
        row.setEnabled(true);
        row.setBaseUrl("https://api.deepseek.com");
        row.setModel("deepseek-v4-flash");
        row.setApiKeyCiphertext(ciphertext);
        row.setVersion(1L);
        row.setCreatedAt(new Date());
        row.setUpdatedAt(new Date());
        return row;
    }
}
