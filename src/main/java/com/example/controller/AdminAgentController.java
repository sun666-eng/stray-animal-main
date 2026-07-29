package com.example.controller;

import cn.hutool.json.JSONObject;
import com.example.common.AuditLog;
import com.example.common.Result;
import com.example.entity.User;
import com.example.exception.CustomException;
import com.example.service.AdminAgentRepository;
import com.example.service.AdminAgentAutomationRepository;
import com.example.service.AdminAgentAutomationService;
import com.example.service.AdminAgentDraftRepository;
import com.example.service.AdminAgentDraftService;
import com.example.service.AdminAgentService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/** 管理员专用真实 LLM Agent；模型只拥有只读工具，3C 写入由独立受控执行器完成。 */
@RestController
@RequestMapping("/api/admin-agent")
public class AdminAgentController {

    private final AdminAgentService service;
    private final AdminAgentDraftService draftService;
    private final AdminAgentAutomationService automationService;

    public AdminAgentController(AdminAgentService service, AdminAgentDraftService draftService,
                                AdminAgentAutomationService automationService) {
        this.service = service;
        this.draftService = draftService;
        this.automationService = automationService;
    }

    @GetMapping("/status")
    public Result<AdminAgentService.AgentStatus> status(HttpServletRequest request) {
        return Result.success(service.status(requireUser(request)));
    }

    @GetMapping("/overview")
    public Result<JSONObject> overview(HttpServletRequest request) {
        return Result.success(service.overview(requireUser(request)));
    }

    @AuditLog(module = "管理员AI助手", action = "更新平台模型配置")
    @PostMapping("/config")
    public Result<AdminAgentService.AgentStatus> saveConfig(
            @Valid @RequestBody ConfigRequest body, HttpServletRequest request) {
        return Result.success(service.saveConfig(requireUser(request), body.isEnabled(),
                body.getBaseUrl(), body.getModel(), body.getApiKey()));
    }

    @AuditLog(module = "管理员AI助手", action = "测试平台模型连接")
    @PostMapping("/config/test")
    public Result<AdminAgentService.AgentStatus> testConfig(HttpServletRequest request) {
        return Result.success(service.testConfig(requireUser(request)));
    }

    @AuditLog(module = "管理员AI助手", action = "清除平台模型配置")
    @PostMapping("/config/clear")
    public Result<AdminAgentService.AgentStatus> clearConfig(HttpServletRequest request) {
        return Result.success(service.clearConfig(requireUser(request)));
    }

    @GetMapping("/conversations")
    public Result<List<AdminAgentRepository.ConversationItem>> conversations(
            @RequestParam(required = false, defaultValue = "50") Integer limit,
            HttpServletRequest request) {
        return Result.success(service.conversations(requireUser(request), limit));
    }

    @GetMapping("/conversations/{id}")
    public Result<AdminAgentRepository.ConversationDetail> conversation(
            @PathVariable Long id, HttpServletRequest request) {
        return Result.success(service.conversation(requireUser(request), id));
    }

    @AuditLog(module = "管理员AI助手", action = "修改管理会话标题")
    @PutMapping("/conversations/{id}/title")
    public Result<AdminAgentRepository.ConversationItem> rename(
            @PathVariable Long id, @Valid @RequestBody TitleRequest body,
            HttpServletRequest request) {
        return Result.success(service.rename(requireUser(request), id, body.getTitle()));
    }

    @AuditLog(module = "管理员AI助手", action = "删除管理会话")
    @DeleteMapping("/conversations/{id}")
    public Result<Boolean> deleteConversation(@PathVariable Long id, HttpServletRequest request) {
        return Result.success(service.deleteConversation(requireUser(request), id));
    }

    @AuditLog(module = "管理员AI助手", action = "管理员提问")
    @PostMapping("/ask")
    public Result<AdminAgentRepository.TurnResult> ask(
            @Valid @RequestBody AskRequest body, HttpServletRequest request) {
        return Result.success(service.ask(requireUser(request), body.getRequestId(),
                body.getConversationId(), body.getQuestion()));
    }

    @AuditLog(module = "管理员AI助手", action = "生成领养审核草稿")
    @PostMapping("/adoption-drafts/generate")
    public Result<AdminAgentDraftRepository.DraftItem> generateAdoptionDraft(
            @Valid @RequestBody DraftGenerateRequest body, HttpServletRequest request) {
        return Result.success(draftService.generate(requireUser(request), body.getRequestId(),
                body.getAnimalId(), body.getApplicantId(), body.isReplaceExisting()));
    }

    @GetMapping("/adoption-drafts/{id}")
    public Result<AdminAgentDraftRepository.DraftItem> adoptionDraft(
            @PathVariable Long id, HttpServletRequest request) {
        return Result.success(draftService.find(requireUser(request), id));
    }

    @AuditLog(module = "管理员AI助手", action = "保存领养审核草稿")
    @PutMapping("/adoption-drafts/{id}")
    public Result<AdminAgentDraftRepository.DraftItem> updateAdoptionDraft(
            @PathVariable Long id, @Valid @RequestBody DraftUpdateRequest body,
            HttpServletRequest request) {
        return Result.success(draftService.update(requireUser(request), id, body.getExpectedVersion(),
                body.getRecommendation(), body.getRiskLevel(), body.getRationale(),
                body.getMissingInfo(), body.getReviewNote()));
    }

    @AuditLog(module = "管理员AI助手", action = "丢弃领养审核草稿")
    @DeleteMapping("/adoption-drafts/{id}")
    public Result<Boolean> discardAdoptionDraft(@PathVariable Long id,
                                                 @RequestParam long expectedVersion,
                                                 HttpServletRequest request) {
        return Result.success(draftService.discard(requireUser(request), id, expectedVersion));
    }

    @AuditLog(module = "管理员AI助手", action = "人工确认执行领养审核")
    @PostMapping("/adoption-drafts/{id}/finalize")
    public Result<AdminAgentDraftRepository.DraftItem> finalizeAdoptionDraft(
            @PathVariable Long id, @Valid @RequestBody DraftFinalizeRequest body,
            HttpServletRequest request) {
        return Result.success(draftService.finalizeDraft(requireUser(request), id,
                body.getRequestId(), body.getExpectedVersion(), body.getDecision(),
                body.getOverrideReason(), body.isReviewedApplication(),
                body.isAcknowledgeConsequences()));
    }

    @GetMapping("/automation/status")
    public Result<AdminAgentAutomationService.AutomationStatus> automationStatus(HttpServletRequest request) {
        return Result.success(automationService.status(requireUser(request)));
    }

    @AuditLog(module = "管理员AI助手", action = "更新3C自动审核配置")
    @PostMapping("/automation/config")
    public Result<AdminAgentAutomationService.AutomationStatus> saveAutomationConfig(
            @Valid @RequestBody AutomationConfigRequest body, HttpServletRequest request) {
        return Result.success(automationService.saveConfig(requireUser(request), body.getExpectedVersion(),
                body.isEnabled(), body.getMode(), body.getMaxBatch(), body.isAcknowledgeNoAutoReject(),
                body.isAcknowledgeHumanFallback(), body.getConfirmationText()));
    }

    @AuditLog(module = "管理员AI助手", action = "手动运行3C自动审核")
    @PostMapping("/automation/run")
    public Result<AdminAgentAutomationRepository.RunDetail> runAutomation(
            @Valid @RequestBody AutomationRunRequest body, HttpServletRequest request) {
        return Result.success(automationService.runOnce(requireUser(request), body.getRequestId()));
    }

    @GetMapping("/automation/runs")
    public Result<List<AdminAgentAutomationRepository.RunSummary>> automationRuns(
            @RequestParam(required = false, defaultValue = "10") Integer limit, HttpServletRequest request) {
        return Result.success(automationService.runs(requireUser(request), limit == null ? 10 : limit));
    }

    @GetMapping("/automation/runs/{id}")
    public Result<AdminAgentAutomationRepository.RunDetail> automationRun(
            @PathVariable Long id, HttpServletRequest request) {
        return Result.success(automationService.run(requireUser(request), id));
    }

    private User requireUser(HttpServletRequest request) {
        Object raw = request.getSession(false) == null ? null
                : request.getSession(false).getAttribute("user");
        if (!(raw instanceof User) || ((User) raw).getId() == null) {
            throw new CustomException("401", "未登录或登录已过期");
        }
        return (User) raw;
    }

    public static final class AskRequest {
        @NotBlank(message = "requestId 不能为空")
        @Pattern(regexp = "^[A-Za-z0-9_-]{1,64}$", message = "requestId 格式无效")
        private String requestId;
        @NotBlank(message = "请输入管理问题")
        @Size(max = 800, message = "问题不能超过 800 字")
        private String question;
        private Long conversationId;
        public String getRequestId() { return requestId; }
        public void setRequestId(String requestId) { this.requestId = requestId; }
        public String getQuestion() { return question; }
        public void setQuestion(String question) { this.question = question; }
        public Long getConversationId() { return conversationId; }
        public void setConversationId(Long conversationId) { this.conversationId = conversationId; }
    }

    public static final class ConfigRequest {
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

    public static final class TitleRequest {
        @NotBlank(message = "请输入会话标题")
        @Size(max = 60, message = "会话标题不能超过 60 个字符")
        private String title;
        public String getTitle() { return title; }
        public void setTitle(String title) { this.title = title; }
    }

    public static final class DraftGenerateRequest {
        @NotBlank @Pattern(regexp = "^[A-Za-z0-9_-]{1,64}$") private String requestId;
        private Long animalId; private Long applicantId; private boolean replaceExisting;
        public String getRequestId(){return requestId;} public void setRequestId(String v){requestId=v;}
        public Long getAnimalId(){return animalId;} public void setAnimalId(Long v){animalId=v;}
        public Long getApplicantId(){return applicantId;} public void setApplicantId(Long v){applicantId=v;}
        public boolean isReplaceExisting(){return replaceExisting;} public void setReplaceExisting(boolean v){replaceExisting=v;}
    }

    public static final class DraftUpdateRequest {
        private long expectedVersion;
        @NotBlank private String recommendation;
        @NotBlank private String riskLevel;
        @NotBlank @Size(max=1200) private String rationale;
        @NotBlank @Size(max=800) private String missingInfo;
        @NotBlank @Size(max=1200) private String reviewNote;
        public long getExpectedVersion(){return expectedVersion;} public void setExpectedVersion(long v){expectedVersion=v;}
        public String getRecommendation(){return recommendation;} public void setRecommendation(String v){recommendation=v;}
        public String getRiskLevel(){return riskLevel;} public void setRiskLevel(String v){riskLevel=v;}
        public String getRationale(){return rationale;} public void setRationale(String v){rationale=v;}
        public String getMissingInfo(){return missingInfo;} public void setMissingInfo(String v){missingInfo=v;}
        public String getReviewNote(){return reviewNote;} public void setReviewNote(String v){reviewNote=v;}
    }

    public static final class DraftFinalizeRequest {
        @NotBlank @Pattern(regexp = "^[A-Za-z0-9_-]{1,64}$") private String requestId;
        private long expectedVersion;
        @NotBlank @Pattern(regexp = "^(approve|reject)$") private String decision;
        @Size(max=500) private String overrideReason;
        private boolean reviewedApplication;
        private boolean acknowledgeConsequences;
        public String getRequestId(){return requestId;} public void setRequestId(String v){requestId=v;}
        public long getExpectedVersion(){return expectedVersion;} public void setExpectedVersion(long v){expectedVersion=v;}
        public String getDecision(){return decision;} public void setDecision(String v){decision=v;}
        public String getOverrideReason(){return overrideReason;} public void setOverrideReason(String v){overrideReason=v;}
        public boolean isReviewedApplication(){return reviewedApplication;} public void setReviewedApplication(boolean v){reviewedApplication=v;}
        public boolean isAcknowledgeConsequences(){return acknowledgeConsequences;} public void setAcknowledgeConsequences(boolean v){acknowledgeConsequences=v;}
    }

    public static final class AutomationConfigRequest {
        private long expectedVersion;
        private boolean enabled;
        @NotBlank @Pattern(regexp="^(shadow|guarded)$") private String mode;
        private int maxBatch;
        private boolean acknowledgeNoAutoReject;
        private boolean acknowledgeHumanFallback;
        @Size(max=40) private String confirmationText;
        public long getExpectedVersion(){return expectedVersion;} public void setExpectedVersion(long v){expectedVersion=v;}
        public boolean isEnabled(){return enabled;} public void setEnabled(boolean v){enabled=v;}
        public String getMode(){return mode;} public void setMode(String v){mode=v;}
        public int getMaxBatch(){return maxBatch;} public void setMaxBatch(int v){maxBatch=v;}
        public boolean isAcknowledgeNoAutoReject(){return acknowledgeNoAutoReject;} public void setAcknowledgeNoAutoReject(boolean v){acknowledgeNoAutoReject=v;}
        public boolean isAcknowledgeHumanFallback(){return acknowledgeHumanFallback;} public void setAcknowledgeHumanFallback(boolean v){acknowledgeHumanFallback=v;}
        public String getConfirmationText(){return confirmationText;} public void setConfirmationText(String v){confirmationText=v;}
    }

    public static final class AutomationRunRequest {
        @NotBlank @Pattern(regexp="^[A-Za-z0-9_-]{1,64}$") private String requestId;
        public String getRequestId(){return requestId;} public void setRequestId(String v){requestId=v;}
    }
}
