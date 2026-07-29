package com.example.controller;

import com.example.common.AuditLog;
import com.example.common.Result;
import com.example.entity.User;
import com.example.exception.CustomException;
import com.example.service.PetCareAiConfigService;
import com.example.service.PetCareConversationService;
import com.example.service.PetCareHistoryService;
import com.example.service.PetCareService;
import com.example.service.PetCareTaskService;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import jakarta.annotation.Resource;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpSession;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import jakarta.validation.constraints.Pattern;
import java.util.List;

/**
 * AI 动物照顾助手（DELIVERY-PLAN.md §三）：登录用户询问动物照顾注意事项与方式方法。
 * 与业务数据完全解耦；限流与话题边界在 PetCareService。
 */
@RestController
@RequestMapping("/api/petcare")
public class PetCareController {

    private static final String AI_AUTO_TESTED_SESSION =
            PetCareController.class.getName() + ".AI_AUTO_TESTED";

    @Resource
    private PetCareService petCareService;

    @Resource
    private PetCareAiConfigService petCareAiConfigService;

    @Resource
    private PetCareHistoryService petCareHistoryService;

    @Resource
    private PetCareConversationService petCareConversationService;

    @Resource
    private PetCareTaskService petCareTaskService;

    @org.springframework.beans.factory.annotation.Value("${app.ai.auto-test-recent-ms:3600000}")
    private long autoTestRecentMs = 3600000;

    @GetMapping("/topics")
    public Result<List<String>> topics() {
        return Result.success(petCareService.quickQuestions());
    }

    @AuditLog(module = "照顾助手", action = "提问")
    @PostMapping("/ask")
    public Result<PetCareTaskService.TaskView> ask(@Valid @RequestBody AskRequest body,
                                   HttpServletRequest request) {
        User user = requireUser(request);
        return Result.success(petCareTaskService.ask(user.getId(), body.getRequestId(),
                body.getConversationId(), body.getQuestion().trim()));
    }

    @GetMapping("/tasks/{requestId}")
    public Result<PetCareTaskService.TaskView> task(@PathVariable String requestId,
                                                    HttpServletRequest request) {
        User user = requireUser(request);
        validateRequestId(requestId);
        return Result.success(petCareTaskService.status(user.getId(), requestId));
    }

    @GetMapping("/history")
    public Result<PetCareHistoryService.HistorySnapshot> history(
            @RequestParam(required = false, defaultValue = "50") Integer limit,
            HttpServletRequest request) {
        User user = requireUser(request);
        return Result.success(petCareHistoryService.history(user.getId(), limit));
    }

    @AuditLog(module = "照顾助手", action = "清空个人聊天历史")
    @DeleteMapping("/history")
    public Result<Boolean> clearHistory(HttpServletRequest request) {
        User user = requireUser(request);
        return Result.success(petCareConversationService.clearAll(user.getId()));
    }

    @GetMapping("/conversations")
    public Result<List<PetCareConversationService.ConversationItem>> conversations(
            @RequestParam(required = false, defaultValue = "50") Integer limit,
            HttpServletRequest request) {
        User user = requireUser(request);
        return Result.success(petCareConversationService.list(user.getId(), limit));
    }

    @GetMapping("/conversations/{id}")
    public Result<PetCareConversationService.ConversationDetail> conversation(
            @PathVariable Long id, HttpServletRequest request) {
        User user = requireUser(request);
        return Result.success(petCareConversationService.detail(user.getId(), id));
    }

    @AuditLog(module = "照顾助手", action = "修改会话标题")
    @PutMapping("/conversations/{id}/title")
    public Result<PetCareConversationService.ConversationItem> renameConversation(
            @PathVariable Long id, @Valid @RequestBody ConversationTitleRequest body,
            HttpServletRequest request) {
        User user = requireUser(request);
        return Result.success(petCareConversationService.rename(user.getId(), id, body.getTitle()));
    }

    @AuditLog(module = "照顾助手", action = "删除单个会话")
    @DeleteMapping("/conversations/{id}")
    public Result<Boolean> deleteConversation(
            @PathVariable Long id, HttpServletRequest request) {
        User user = requireUser(request);
        return Result.success(petCareConversationService.delete(user.getId(), id));
    }

    @GetMapping("/config")
    public Result<PetCareService.AiConfigStatus> config(HttpServletRequest request) {
        User user = requireUser(request);
        return Result.success(petCareService.aiConfigStatus(
                petCareAiConfigService.find(user.getId())));
    }

    @AuditLog(module = "照顾助手", action = "更新个人AI配置")
    @PostMapping("/config")
    public Result<PetCareService.AiConfigStatus> updateConfig(@Valid @RequestBody AiConfigRequest body,
                                                               HttpServletRequest request) {
        User user = requireUser(request);
        PetCareService.AiConnectionConfig config = petCareAiConfigService.save(
                user.getId(), body.isEnabled(), body.getBaseUrl(),
                body.getModel(), body.getApiKey());
        markAutoTestAttempted(request);
        return Result.success(petCareService.aiConfigStatus(config));
    }

    @AuditLog(module = "照顾助手", action = "清除个人AI配置")
    @PostMapping("/config/clear")
    public Result<PetCareService.AiConfigStatus> clearConfig(HttpServletRequest request) {
        User user = requireUser(request);
        petCareAiConfigService.clear(user.getId());
        markAutoTestAttempted(request);
        return Result.success(petCareService.aiConfigStatus(null));
    }

    /**
     * 每个登录会话自动验证一次服务端已保存的个人配置。
     * 首次保存仍由用户手动测试；重登或服务重启产生新 Session 后会自动复检。
     */
    @PostMapping("/config/auto-test")
    public Result<PetCareService.AiConfigStatus> autoTestConfig(HttpServletRequest request) {
        User user = requireUser(request);
        HttpSession session = request.getSession(true);
        synchronized (session) {
            if (Boolean.TRUE.equals(session.getAttribute(AI_AUTO_TESTED_SESSION))) {
                return Result.success(petCareService.aiConfigStatus(
                        petCareAiConfigService.find(user.getId())));
            }
            // 在发起外部请求前置位，防止页面并发加载造成重复测试和重复计费。
            session.setAttribute(AI_AUTO_TESTED_SESSION, Boolean.TRUE);
            PetCareService.AiConnectionConfig config =
                    petCareAiConfigService.find(user.getId());
            PetCareService.AiConfigStatus status = petCareService.aiConfigStatus(config);
            if (!status.isPersonalConfigured() || !status.isEnabled() || !status.isReady()) {
                return Result.success(status);
            }
            if (status.isConnected() && config.getLastTestedAt() != null
                    && System.currentTimeMillis() - config.getLastTestedAt().getTime()
                    <= Math.max(0L, autoTestRecentMs)) {
                return Result.success(status);
            }
            try {
                petCareService.testAiConnection(user.getId(), config);
                PetCareService.AiConnectionConfig connected =
                        petCareAiConfigService.markConnection(
                                user.getId(), config.getVersion(),
                                PetCareAiConfigService.STATUS_CONNECTED,
                                "登录后自动连接测试成功");
                return Result.success(petCareService.aiConfigStatus(connected));
            } catch (CustomException ex) {
                markConnectionBestEffort(user.getId(), config.getVersion(),
                        PetCareAiConfigService.STATUS_FAILED, ex.getMessage());
                // 自动检测失败只更新可见状态，不打断页面加载；用户可在配置框查看详情并手动重试。
                return Result.success(petCareService.aiConfigStatus(
                        petCareAiConfigService.find(user.getId())));
            }
        }
    }

    @AuditLog(module = "照顾助手", action = "测试AI连接")
    @PostMapping("/config/test")
    public Result<PetCareService.AiConfigStatus> testConfig(HttpServletRequest request) {
        User user = requireUser(request);
        markAutoTestAttempted(request);
        PetCareService.AiConnectionConfig config = petCareAiConfigService.find(user.getId());
        try {
            petCareService.testAiConnection(user.getId(), config);
            PetCareService.AiConnectionConfig connected = petCareAiConfigService.markConnection(
                    user.getId(), config.getVersion(),
                    PetCareAiConfigService.STATUS_CONNECTED, "连接测试成功");
            return Result.success(petCareService.aiConfigStatus(connected));
        } catch (CustomException ex) {
            markConnectionBestEffort(user.getId(), config == null ? 0L : config.getVersion(),
                    PetCareAiConfigService.STATUS_FAILED, ex.getMessage());
            throw ex;
        }
    }

    private void markAutoTestAttempted(HttpServletRequest request) {
        request.getSession(true).setAttribute(AI_AUTO_TESTED_SESSION, Boolean.TRUE);
    }

    private void markConnectionBestEffort(Long userId, long version,
                                          String status, String message) {
        try {
            petCareAiConfigService.markConnection(userId, version, status, message);
        } catch (RuntimeException ignored) {
            // 配置变化时旧测试结果必须丢弃。
        }
    }

    private User requireUser(HttpServletRequest request) {
        User user = request.getSession(false) == null
                ? null
                : (User) request.getSession(false).getAttribute("user");
        if (user == null || user.getId() == null) {
            throw new CustomException("401", "未登录或登录已过期");
        }
        return user;
    }

    public static class AskRequest {
        @NotBlank(message = "requestId 不能为空")
        @Size(max = 64, message = "requestId 不能超过 64 个字符")
        @Pattern(regexp = "^[A-Za-z0-9_-]+$", message = "requestId 格式无效")
        private String requestId;

        @NotBlank(message = "请输入你的问题")
        @Size(max = 500, message = "问题不能超过 500 字")
        private String question;

        private Long conversationId;

        public String getRequestId() { return requestId; }
        public void setRequestId(String requestId) { this.requestId = requestId; }
        public String getQuestion() { return question; }
        public void setQuestion(String question) { this.question = question; }
        public Long getConversationId() { return conversationId; }
        public void setConversationId(Long conversationId) { this.conversationId = conversationId; }
    }

    public static class ConversationTitleRequest {
        @NotBlank(message = "请输入会话标题")
        @Size(max = 60, message = "会话标题不能超过 60 个字符")
        private String title;

        public String getTitle() { return title; }
        public void setTitle(String title) { this.title = title; }
    }

    public static class AiConfigRequest {
        private boolean enabled;

        @NotBlank(message = "请输入 API Base URL")
        @Size(max = 500, message = "Base URL 不能超过 500 个字符")
        private String baseUrl;

        @NotBlank(message = "请输入模型名称")
        @Size(max = 120, message = "模型名称不能超过 120 个字符")
        private String model;

        @Size(max = 1024, message = "API Key 不能超过 1024 个字符")
        private String apiKey;

        public boolean isEnabled() { return enabled; }
        public void setEnabled(boolean enabled) { this.enabled = enabled; }
        public String getBaseUrl() { return baseUrl; }
        public void setBaseUrl(String baseUrl) { this.baseUrl = baseUrl; }
        public String getModel() { return model; }
        public void setModel(String model) { this.model = model; }
        public String getApiKey() { return apiKey; }
        public void setApiKey(String apiKey) { this.apiKey = apiKey; }
    }

    private void validateRequestId(String requestId) {
        if (requestId == null || requestId.length() > 64
                || !requestId.matches("^[A-Za-z0-9_-]+$")) {
            throw new CustomException("400", "requestId 格式无效");
        }
    }
}
