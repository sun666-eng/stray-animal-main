package com.example.service;

import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.example.entity.PetCareAiConfig;
import com.example.exception.CustomException;
import com.example.mapper.PetCareAiConfigMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import jakarta.annotation.Resource;
import java.util.Date;
import java.util.Objects;

/**
 * 按登录账号持久化个人 AI 连接配置。
 */
@Service
public class PetCareAiConfigService
        extends ServiceImpl<PetCareAiConfigMapper, PetCareAiConfig> {

    public static final String STATUS_UNTESTED = "untested";
    public static final String STATUS_CONNECTED = "connected";
    public static final String STATUS_FAILED = "failed";

    @Resource
    private PetCareAiConfigMapper petCareAiConfigMapper;

    @Resource
    private PetCareConfigCrypto crypto;

    @Resource
    private PetCareService petCareService;

    public PetCareService.AiConnectionConfig find(Long userId) {
        requireUserId(userId);
        PetCareAiConfig row = petCareAiConfigMapper.selectById(userId);
        if (row == null) {
            return null;
        }
        try {
            return toConnection(row);
        } catch (CustomException ex) {
            // 主密钥轮换/损坏时不能让整个助手页 500；返回可清除的失败态供 UI 引导用户重配
            if (PetCareConfigCrypto.UNREADABLE_MESSAGE.equals(ex.getMsg())) {
                return new PetCareService.AiConnectionConfig(
                        false,
                        row.getBaseUrl() == null ? "" : row.getBaseUrl(),
                        "",
                        row.getModel() == null ? "" : row.getModel(),
                        true,
                        STATUS_FAILED,
                        safeMessage(ex.getMsg()),
                        row.getLastTestedAt(),
                        normalizeVersion(row.getVersion()));
            }
            throw ex;
        }
    }

    private PetCareService.AiConnectionConfig toConnection(PetCareAiConfig row) {
        Long userId = row.getUserId();
        String apiKey = crypto.decrypt(userId, row.getApiKeyCiphertext());
        return new PetCareService.AiConnectionConfig(
                Boolean.TRUE.equals(row.getEnabled()),
                row.getBaseUrl(),
                apiKey,
                row.getModel(),
                true,
                normalizeStatus(row.getConnectionStatus()),
                safeMessage(row.getLastTestMessage()),
                row.getLastTestedAt(), normalizeVersion(row.getVersion()));
    }

    @Transactional
    public PetCareService.AiConnectionConfig save(Long userId, boolean enabled,
                                                   String baseUrl, String model,
                                                   String apiKey) {
        requireUserId(userId);
        return saveAttempt(userId, enabled, baseUrl, model, apiKey, 0);
    }

    private PetCareService.AiConnectionConfig saveAttempt(Long userId, boolean enabled,
                                                           String baseUrl, String model,
                                                           String apiKey, int attempt) {
        PetCareAiConfig existingRow = attempt == 0
                ? petCareAiConfigMapper.selectById(userId)
                : petCareAiConfigMapper.selectOne(Wrappers.<PetCareAiConfig>lambdaQuery()
                        .eq(PetCareAiConfig::getUserId, userId).last("FOR UPDATE"));
        PetCareService.AiConnectionConfig existing =
                existingRow == null ? null : toConnection(existingRow);
        PetCareService.AiConnectionConfig next =
                petCareService.createAiConfig(enabled, baseUrl, model, apiKey, existing);
        boolean replacingKey = apiKey != null && !apiKey.trim().isEmpty();
        boolean settingsUnchanged = existingRow != null
                && !replacingKey
                && Boolean.valueOf(next.isEnabled()).equals(existingRow.getEnabled())
                && Objects.equals(next.getBaseUrl(), existingRow.getBaseUrl())
                && Objects.equals(next.getModel(), existingRow.getModel());

        Date now = new Date();
        PetCareAiConfig row = new PetCareAiConfig();
        row.setUserId(userId);
        row.setEnabled(next.isEnabled());
        row.setBaseUrl(next.getBaseUrl());
        row.setModel(next.getModel());
        // 未明确输入新 Key 时，原密文必须逐字节保留。除了避免无意义的重新加密，
        // 这也阻断了密码管理器自动填充值覆盖账号配置的风险。
        row.setApiKeyCiphertext(existingRow != null && !replacingKey
                ? existingRow.getApiKeyCiphertext()
                : crypto.encrypt(userId, next.getApiKey()));
        if (settingsUnchanged) {
            row.setConnectionStatus(normalizeStatus(existingRow.getConnectionStatus()));
            row.setLastTestMessage(safeMessage(existingRow.getLastTestMessage()));
            row.setLastTestedAt(existingRow.getLastTestedAt());
        } else {
            // 地址、模型、启停状态或密钥变化后，必须重新经过真实请求才能称为“已连接”。
            row.setConnectionStatus(STATUS_UNTESTED);
            row.setLastTestMessage("");
            row.setLastTestedAt(null);
        }
        row.setCreatedAt(existingRow == null || existingRow.getCreatedAt() == null
                ? now : existingRow.getCreatedAt());
        row.setUpdatedAt(now);
        long expectedVersion = existingRow == null ? 0L : normalizeVersion(existingRow.getVersion());
        row.setVersion(existingRow == null ? 1L : expectedVersion + 1L);

        int changed = existingRow == null
                ? petCareAiConfigMapper.insertIgnore(row)
                : petCareAiConfigMapper.updateConfig(row, expectedVersion);
        if (changed != 1) {
            if (attempt < 2) {
                return saveAttempt(userId, enabled, baseUrl, model, apiKey, attempt + 1);
            }
            throw new CustomException("409", "个人 API 配置已被并发修改，请刷新后重试");
        }
        return toConnection(row);
    }

    @Transactional
    public PetCareService.AiConnectionConfig markConnection(
            Long userId, String status, String message) {
        PetCareAiConfig row = petCareAiConfigMapper.selectById(userId);
        if (row == null) {
            throw new CustomException("404", "个人 API 配置不存在");
        }
        return markConnection(userId, normalizeVersion(row.getVersion()), status, message);
    }

    @Transactional
    public PetCareService.AiConnectionConfig markConnection(
            Long userId, long expectedVersion, String status, String message) {
        requireUserId(userId);
        String normalized = normalizeStatus(status);
        if (STATUS_UNTESTED.equals(normalized)) {
            throw new CustomException("400", "连接结果状态无效");
        }
        Date testedAt = new Date();
        if (petCareAiConfigMapper.markConnectionIfVersion(userId, expectedVersion, normalized,
                safeMessage(message), testedAt) != 1) {
            throw new CustomException("409", "配置已变化，旧连接测试结果已丢弃");
        }
        PetCareAiConfig row = petCareAiConfigMapper.selectById(userId);
        if (row == null) throw new CustomException("404", "个人 API 配置不存在");
        row.setConnectionStatus(normalized);
        row.setLastTestMessage(safeMessage(message));
        row.setLastTestedAt(testedAt);
        row.setUpdatedAt(testedAt);
        return toConnection(row);
    }

    @Transactional
    public boolean clear(Long userId) {
        requireUserId(userId);
        petCareAiConfigMapper.deleteById(userId);
        return true;
    }

    private void requireUserId(Long userId) {
        if (userId == null || userId <= 0) {
            throw new CustomException("401", "未登录或登录已过期");
        }
    }

    private String normalizeStatus(String status) {
        if (STATUS_CONNECTED.equals(status) || STATUS_FAILED.equals(status)) {
            return status;
        }
        return STATUS_UNTESTED;
    }

    private String safeMessage(String message) {
        String value = message == null ? "" : message.trim();
        return value.length() <= 500 ? value : value.substring(0, 500);
    }

    private long normalizeVersion(Long version) {
        return version == null || version < 1 ? 1L : version;
    }
}
