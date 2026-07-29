package com.example.service;

import cn.hutool.json.JSONObject;
import cn.hutool.json.JSONUtil;
import com.example.common.PermissionUtil;
import com.example.common.RoleAssignmentPolicy;
import com.example.entity.User;
import com.example.exception.CustomException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.Collections;
import java.util.Date;
import java.util.List;
import java.util.Objects;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

/** 管理员 Agent 的应用服务：平台配置、真实工具循环、会话与审计。 */
@Service
public class AdminAgentService {

    public static final String STATUS_UNTESTED = "untested";
    public static final String STATUS_CONNECTED = "connected";
    public static final String STATUS_FAILED = "failed";

    private final AdminAgentRepository repository;
    private final AdminAgentTools tools;
    private final AdminAgentClient client;
    private final PetCareConfigCrypto crypto;
    private final PetCareService petCareService;
    private final UserService userService;
    private final ConcurrentHashMap<String, CompletableFuture<AdminAgentRepository.TurnResult>> inFlight
            = new ConcurrentHashMap<>();

    public AdminAgentService(AdminAgentRepository repository, AdminAgentTools tools,
                             AdminAgentClient client, PetCareConfigCrypto crypto,
                             PetCareService petCareService, UserService userService) {
        this.repository = repository;
        this.tools = tools;
        this.client = client;
        this.crypto = crypto;
        this.petCareService = petCareService;
        this.userService = userService;
    }

    public AgentStatus status(User actor) {
        requireUse(actor);
        ConfigState state = loadConfig();
        return toStatus(actor, state);
    }

    public JSONObject overview(User actor) {
        requireUse(actor);
        return tools.overview(actor);
    }

    @Transactional
    public AgentStatus saveConfig(User actor, boolean enabled, String baseUrl,
                                  String model, String apiKey) {
        User superAdmin = userService.requireRealSuperAdmin(actor);
        ConfigState existing = loadConfig();
        PetCareService.AiConnectionConfig normalized = petCareService.createAiConfig(
                enabled, baseUrl, model, apiKey, existing == null ? null : existing.connection);
        if (existing == null && normalized.getApiKey().trim().isEmpty()) {
            throw new CustomException("400", "首次保存平台配置时必须填写 API Key");
        }
        boolean replacingKey = apiKey != null && !apiKey.trim().isEmpty();
        String ciphertext = existing != null && !replacingKey
                ? existing.row.getCiphertext() : crypto.encryptAdminAgent(normalized.getApiKey());
        boolean unchanged = existing != null && !replacingKey
                && existing.connection.isEnabled() == normalized.isEnabled()
                && Objects.equals(existing.connection.getBaseUrl(), normalized.getBaseUrl())
                && Objects.equals(existing.connection.getModel(), normalized.getModel());
        String nextStatus = unchanged ? normalizeStatus(existing.row.getConnectionStatus()) : STATUS_UNTESTED;
        String nextMessage = unchanged ? safe(existing.row.getLastTestMessage()) : "";
        Date nextTested = unchanged ? existing.row.getLastTestedAt() : null;
        AdminAgentRepository.ConfigRow saved = repository.saveConfig(
                normalized.isEnabled(), normalized.getBaseUrl(), normalized.getModel(), ciphertext,
                nextStatus, nextMessage, nextTested);
        repository.audit(superAdmin.getId(), "config_saved", null, "", "[]", "success",
                "enabled=" + normalized.isEnabled() + ", model=" + normalized.getModel());
        return toStatus(superAdmin, fromRow(saved));
    }

    public AgentStatus testConfig(User actor) {
        User superAdmin = userService.requireRealSuperAdmin(actor);
        ConfigState state = requireConfig();
        try {
            petCareService.testAiConnection(superAdmin.getId(), state.connection);
            AdminAgentRepository.ConfigRow marked = repository.markConnection(
                    state.row.getVersion(), STATUS_CONNECTED, "连接测试成功");
            repository.audit(superAdmin.getId(), "config_test", null, "", "[]", "success", "连接测试成功");
            return toStatus(superAdmin, fromRow(marked));
        } catch (CustomException ex) {
            try {
                repository.markConnection(state.row.getVersion(), STATUS_FAILED, ex.getMessage());
            } catch (RuntimeException ignored) { }
            repository.audit(superAdmin.getId(), "config_test", null, "", "[]", "failed", ex.getMessage());
            throw ex;
        }
    }

    public AgentStatus clearConfig(User actor) {
        User superAdmin = userService.requireRealSuperAdmin(actor);
        repository.clearConfig();
        repository.audit(superAdmin.getId(), "config_cleared", null, "", "[]", "success", "");
        return toStatus(superAdmin, null);
    }

    public List<AdminAgentRepository.ConversationItem> conversations(User actor, Integer limit) {
        requireUse(actor);
        return repository.listConversations(actor.getId(), limit == null ? 50 : limit);
    }

    public AdminAgentRepository.ConversationDetail conversation(User actor, Long id) {
        requireUse(actor);
        return repository.detail(actor.getId(), id);
    }

    public AdminAgentRepository.ConversationItem rename(User actor, Long id, String title) {
        requireUse(actor);
        AdminAgentRepository.ConversationItem renamed = repository.rename(actor.getId(), id, title);
        repository.audit(actor.getId(), "conversation_renamed", id, "", "[]", "success", "");
        return renamed;
    }

    public boolean deleteConversation(User actor, Long id) {
        requireUse(actor);
        boolean deleted = repository.deleteConversation(actor.getId(), id);
        repository.audit(actor.getId(), "conversation_deleted", id, "", "[]", "success", "");
        return deleted;
    }

    public AdminAgentRepository.TurnResult ask(User actor, String requestId,
                                               Long conversationId, String rawQuestion) {
        requireUse(actor);
        String question = rawQuestion == null ? "" : rawQuestion.trim();
        if (requestId == null || !requestId.matches("^[A-Za-z0-9_-]{1,64}$")) {
            throw new CustomException("400", "requestId 格式无效");
        }
        if (question.isEmpty() || question.length() > 800) {
            throw new CustomException("400", "问题不能为空且不能超过 800 字");
        }
        AdminAgentRepository.TurnResult duplicate = repository.findByRequestId(actor.getId(), requestId);
        if (duplicate != null) return validateDuplicate(duplicate, conversationId, question);
        String flightKey = actor.getId() + ":" + requestId;
        CompletableFuture<AdminAgentRepository.TurnResult> owner = new CompletableFuture<>();
        CompletableFuture<AdminAgentRepository.TurnResult> existingFlight = inFlight.putIfAbsent(flightKey, owner);
        if (existingFlight != null) {
            return awaitExisting(existingFlight);
        }
        try {
            AdminAgentRepository.TurnResult result = askOnce(actor, requestId, conversationId, question);
            owner.complete(result);
            return result;
        } catch (RuntimeException ex) {
            owner.completeExceptionally(ex);
            throw ex;
        } finally {
            inFlight.remove(flightKey, owner);
        }
    }

    private AdminAgentRepository.TurnResult askOnce(User actor, String requestId,
                                                    Long conversationId, String question) {
        AdminAgentRepository.TurnResult duplicate = repository.findByRequestId(actor.getId(), requestId);
        if (duplicate != null) return validateDuplicate(duplicate, conversationId, question);
        List<PetCareService.ChatTurn> history = new ArrayList<>();
        if (conversationId != null) {
            for (AdminAgentRepository.TurnItem turn : repository.detail(actor.getId(), conversationId).getTurns()) {
                history.add(new PetCareService.ChatTurn("user", turn.getQuestion()));
                history.add(new PetCareService.ChatTurn("assistant", turn.getAnswer()));
            }
        }
        ConfigState state = requireConfig();
        if (!state.connection.isEnabled() || !STATUS_CONNECTED.equals(state.connection.getConnectionStatus())) {
            throw new CustomException("503", "管理员 Agent 尚未通过连接测试，请联系超级管理员配置");
        }
        try {
            AdminAgentClient.AgentAnswer answer = client.ask(actor, question, history, state.connection);
            String toolsJson = JSONUtil.toJsonStr(answer.getToolsUsed());
            AdminAgentRepository.TurnResult saved = repository.recordTurn(
                    actor.getId(), conversationId, requestId, question, answer.getAnswer(), toolsJson);
            repository.audit(actor.getId(), "ask", saved.getConversationId(), requestId,
                    toolsJson, "success", "");
            return saved;
        } catch (CustomException ex) {
            if ("502".equals(ex.getCode()) || "504".equals(ex.getCode())) {
                try {
                    repository.markConnection(state.row.getVersion(), STATUS_FAILED, ex.getMessage());
                } catch (RuntimeException ignored) { }
            }
            repository.audit(actor.getId(), "ask", conversationId, requestId,
                    "[]", "failed", ex.getMessage());
            throw ex;
        }
    }

    private AdminAgentRepository.TurnResult validateDuplicate(
            AdminAgentRepository.TurnResult duplicate, Long requestedConversationId, String question) {
        if (!Objects.equals(question, duplicate.getTurn().getQuestion())
                || (requestedConversationId != null
                && !Objects.equals(requestedConversationId, duplicate.getConversationId()))) {
            throw new CustomException("409", "requestId 已用于另一份提问，请生成新的 requestId");
        }
        return duplicate;
    }

    private AdminAgentRepository.TurnResult awaitExisting(
            CompletableFuture<AdminAgentRepository.TurnResult> existing) {
        try {
            return existing.get(30, TimeUnit.SECONDS);
        } catch (InterruptedException ex) {
            Thread.currentThread().interrupt();
            throw new CustomException("503", "管理员 Agent 请求已中断，请稍后重试");
        } catch (TimeoutException ex) {
            throw new CustomException("503", "相同请求仍在处理中，请稍后使用同一 requestId 重试");
        } catch (ExecutionException ex) {
            Throwable cause = ex.getCause();
            if (cause instanceof CustomException) throw (CustomException) cause;
            if (cause instanceof RuntimeException) throw (RuntimeException) cause;
            throw new CustomException("502", "管理员 Agent 请求失败，请稍后重试");
        }
    }

    private ConfigState loadConfig() {
        AdminAgentRepository.ConfigRow row = repository.findConfig();
        if (row == null) return null;
        try {
            return fromRow(row);
        } catch (CustomException ex) {
            if (PetCareConfigCrypto.UNREADABLE_MESSAGE.equals(ex.getMsg())) {
                PetCareService.AiConnectionConfig unavailable = new PetCareService.AiConnectionConfig(
                        false, safe(row.getBaseUrl()), "", safe(row.getModel()), true,
                        STATUS_FAILED, PetCareConfigCrypto.UNREADABLE_MESSAGE,
                        row.getLastTestedAt(), row.getVersion());
                return new ConfigState(row, unavailable);
            }
            throw ex;
        }
    }

    private ConfigState fromRow(AdminAgentRepository.ConfigRow row) {
        String apiKey = crypto.decryptAdminAgent(row.getCiphertext());
        return new ConfigState(row, new PetCareService.AiConnectionConfig(
                row.isEnabled(), safe(row.getBaseUrl()), apiKey, safe(row.getModel()), true,
                normalizeStatus(row.getConnectionStatus()), safe(row.getLastTestMessage()),
                row.getLastTestedAt(), row.getVersion()));
    }

    private ConfigState requireConfig() {
        ConfigState state = loadConfig();
        if (state == null || state.connection.getApiKey().trim().isEmpty()) {
            throw new CustomException("503", "管理员 Agent 尚未完成模型配置");
        }
        return state;
    }

    /** 同包 3A 草稿服务复用已验证的平台连接；API Key 不暴露到控制器。 */
    PetCareService.AiConnectionConfig requireConnectedConfig(User actor) {
        requireUse(actor);
        ConfigState state = requireConfig();
        if (!state.connection.isEnabled() || !STATUS_CONNECTED.equals(state.connection.getConnectionStatus())) {
            throw new CustomException("503", "管理员 Agent 尚未通过连接测试，请联系超级管理员配置");
        }
        return state.connection;
    }

    private AgentStatus toStatus(User actor, ConfigState state) {
        boolean canConfigure = RoleAssignmentPolicy.hasRoleId(actor, RoleAssignmentPolicy.SUPER_ADMIN_ROLE_ID);
        if (state == null) {
            return new AgentStatus(false, false, false, canConfigure, "", "", "", "",
                    STATUS_UNTESTED, "", null);
        }
        String key = state.connection.getApiKey();
        boolean keyConfigured = key != null && !key.trim().isEmpty();
        return new AgentStatus(true, state.connection.isEnabled(), keyConfigured, canConfigure,
                canConfigure ? state.connection.getBaseUrl() : "",
                state.connection.getModel(), keyConfigured ? mask(key) : "", "platform",
                state.connection.getConnectionStatus(), state.connection.getConnectionMessage(),
                state.connection.getLastTestedAt());
    }

    private void requireUse(User actor) {
        if (actor == null || actor.getId() == null) throw new CustomException("401", "未登录或登录已过期");
        if (!RoleAssignmentPolicy.hasRoleId(actor, RoleAssignmentPolicy.SUPER_ADMIN_ROLE_ID)
                && !PermissionUtil.hasFlag(actor, "admin_agent")) {
            throw new CustomException("403", "无权使用管理员 Agent");
        }
    }

    private String normalizeStatus(String value) {
        return STATUS_CONNECTED.equals(value) || STATUS_FAILED.equals(value) ? value : STATUS_UNTESTED;
    }

    private static String safe(String value) { return value == null ? "" : value.trim(); }
    private static String mask(String key) {
        int visible = Math.min(4, key.length());
        return "•••• " + key.substring(key.length() - visible);
    }

    private static final class ConfigState {
        private final AdminAgentRepository.ConfigRow row;
        private final PetCareService.AiConnectionConfig connection;
        private ConfigState(AdminAgentRepository.ConfigRow row, PetCareService.AiConnectionConfig connection) {
            this.row = row; this.connection = connection;
        }
    }

    public static final class AgentStatus {
        private final boolean configured;
        private final boolean enabled;
        private final boolean apiKeyConfigured;
        private final boolean canConfigure;
        private final String baseUrl;
        private final String model;
        private final String apiKeyHint;
        private final String source;
        private final String connectionStatus;
        private final String connectionMessage;
        @com.fasterxml.jackson.annotation.JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss", timezone = "GMT+8")
        private final Date lastTestedAt;
        AgentStatus(boolean configured, boolean enabled, boolean apiKeyConfigured,
                    boolean canConfigure, String baseUrl, String model, String apiKeyHint,
                    String source, String connectionStatus, String connectionMessage, Date lastTestedAt) {
            this.configured=configured; this.enabled=enabled; this.apiKeyConfigured=apiKeyConfigured;
            this.canConfigure=canConfigure; this.baseUrl=baseUrl; this.model=model;
            this.apiKeyHint=apiKeyHint; this.source=source; this.connectionStatus=connectionStatus;
            this.connectionMessage=connectionMessage;
            this.lastTestedAt=lastTestedAt == null ? null : new Date(lastTestedAt.getTime());
        }
        public boolean isConfigured() { return configured; }
        public boolean isEnabled() { return enabled; }
        public boolean isApiKeyConfigured() { return apiKeyConfigured; }
        public boolean isCanConfigure() { return canConfigure; }
        public String getBaseUrl() { return baseUrl; }
        public String getModel() { return model; }
        public String getApiKeyHint() { return apiKeyHint; }
        public String getSource() { return source; }
        public String getConnectionStatus() { return connectionStatus; }
        public String getConnectionMessage() { return connectionMessage; }
        public Date getLastTestedAt() { return lastTestedAt == null ? null : new Date(lastTestedAt.getTime()); }
        public boolean isConnected() { return enabled && apiKeyConfigured && STATUS_CONNECTED.equals(connectionStatus); }
    }
}
