package com.example.service;

import com.example.entity.PetCareRequest;
import com.example.exception.CustomException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import jakarta.annotation.Resource;
import java.util.Collections;
import java.util.List;

@Service
public class PetCareTaskService {

    @Value("${app.ai.max-history:8}")
    private int maxHistory;

    @Resource
    private PetCareRequestStore requestStore;

    @Resource
    private PetCareConversationService conversationService;

    @Resource
    private PetCareHistoryService historyService;

    @Resource
    private PetCareAiConfigService aiConfigService;

    @Resource
    private PetCareService petCareService;

    public TaskView ask(Long userId, String requestId, Long conversationId, String question) {
        PetCareRequestStore.Claim claim = requestStore.claim(
                userId, requestId, conversationId, question);
        PetCareRequest row = claim.getRow();
        if (!claim.isAcquired()) {
            if (PetCareRequestStore.STATUS_COMPLETED.equals(row.getStatus())) {
                return toView(row);
            }
            if (PetCareRequestStore.STATUS_ANSWERED.equals(row.getStatus())) {
                return toView(requestStore.finalizeAnswer(userId, requestId));
            }
            if (PetCareRequestStore.STATUS_FAILED.equals(row.getStatus())) {
                return toView(row);
            }
            if (PetCareRequestStore.STATUS_CANCELLED.equals(row.getStatus())) {
                throw new CustomException("410", "任务已取消，请求的会话或聊天历史已被删除");
            }
            throw new CustomException("409", "问答任务正在处理，请通过任务状态接口查询");
        }

        if (!claim.isNewTask()) {
            conversationService.assertOwned(userId, conversationId);
        }

        boolean externalCompleted = false;
        int expectedAttempt = row.getAttemptCount() == null ? 1 : row.getAttemptCount();
        try {
            if (claim.isNewTask()) {
                conversationService.assertOwned(userId, conversationId);
            }
            List<PetCareService.ChatTurn> history = conversationId == null
                    ? Collections.emptyList()
                    : historyService.authoritativeTurns(userId, conversationId, maxHistory);
            PetCareService.AiConnectionConfig config = aiConfigService.find(userId);
            long configVersion = config == null ? 0L : config.getVersion();
            PetCareService.PetCareAnswer answer = petCareService.ask(
                    userId, question, history, config);
            externalCompleted = true;
            saveAnswerWithRetry(userId, requestId, expectedAttempt, answer);
            PetCareRequest completed = requestStore.finalizeAnswer(userId, requestId);
            markConnectionBestEffort(userId, configVersion, answer);
            return toView(completed);
        } catch (RuntimeException ex) {
            if (!externalCompleted) {
                try {
                    String code = ex instanceof CustomException
                            ? ((CustomException) ex).getCode() : "500";
                    requestStore.markFailed(userId, requestId, expectedAttempt, code, ex.getMessage());
                } catch (RuntimeException ignored) {
                    // 保留原始错误。
                }
            }
            throw ex;
        }
    }

    private void saveAnswerWithRetry(Long userId, String requestId, int expectedAttempt,
                                     PetCareService.PetCareAnswer answer) {
        RuntimeException last = null;
        for (int attempt = 0; attempt < 3; attempt++) {
            try {
                requestStore.saveAnswer(userId, requestId, expectedAttempt, answer);
                return;
            } catch (RuntimeException ex) {
                last = ex;
            }
        }
        throw new CustomException("503", "模型已返回但结果暂未持久化；任务保持处理中且不会重复调用模型"
                + (last == null || last.getMessage() == null ? "" : "：" + last.getMessage()));
    }

    public TaskView status(Long userId, String requestId) {
        return toView(requestStore.find(userId, requestId));
    }

    private void markConnectionBestEffort(Long userId, long configVersion,
                                          PetCareService.PetCareAnswer answer) {
        if (configVersion == 0L) {
            return;
        }
        try {
            if ("ai".equals(answer.getSource())) {
                aiConfigService.markConnection(userId, configVersion,
                        PetCareAiConfigService.STATUS_CONNECTED, "最近一次真实问答连接成功");
            } else if ("degraded".equals(answer.getSource())) {
                aiConfigService.markConnection(userId, configVersion,
                        PetCareAiConfigService.STATUS_FAILED,
                        answer.getDegradeReason().isEmpty()
                                ? "最近一次真实模型调用失败，已回退到内置知识库"
                                : answer.getDegradeReason());
            }
        } catch (RuntimeException ignored) {
            // 连接诊断不影响已经持久化的问答结果。
        }
    }

    private TaskView toView(PetCareRequest row) {
        return new TaskView(row.getRequestId(), row.getStatus(), row.getAnswer(), row.getSource(),
                row.getDegradeReason(), row.getTopic(), row.getToolsJson(), row.getConversationId(),
                row.getConversationTitle(), row.getErrorCode(), row.getErrorMessage());
    }

    public static final class TaskView {
        private final String requestId;
        private final String status;
        private final String answer;
        private final String source;
        private final String degradeReason;
        private final String topic;
        private final String toolsJson;
        @com.fasterxml.jackson.databind.annotation.JsonSerialize(
                using = com.fasterxml.jackson.databind.ser.std.ToStringSerializer.class)
        private final Long conversationId;
        private final String conversationTitle;
        private final String errorCode;
        private final String errorMessage;

        public TaskView(String requestId, String status, String answer, String source,
                 String degradeReason, String topic, String toolsJson, Long conversationId,
                 String conversationTitle, String errorCode, String errorMessage) {
            this.requestId = requestId;
            this.status = status;
            this.answer = answer;
            this.source = source;
            this.degradeReason = degradeReason == null ? "" : degradeReason;
            this.topic = topic;
            this.toolsJson = toolsJson;
            this.conversationId = conversationId;
            this.conversationTitle = conversationTitle;
            this.errorCode = errorCode;
            this.errorMessage = errorMessage;
        }

        public String getRequestId() { return requestId; }
        public String getStatus() { return status; }
        public String getAnswer() { return answer; }
        public String getSource() { return source; }
        public String getDegradeReason() { return degradeReason; }
        public String getTopic() { return topic; }
        public List<String> getToolsUsed() {
            if (toolsJson == null || toolsJson.trim().isEmpty()) return Collections.emptyList();
            try {
                return cn.hutool.json.JSONUtil.toList(toolsJson, String.class);
            } catch (RuntimeException ignored) {
                return Collections.emptyList();
            }
        }
        public Long getConversationId() { return conversationId; }
        public String getConversationTitle() { return conversationTitle; }
        public String getErrorCode() { return errorCode; }
        public String getErrorMessage() { return errorMessage; }
    }
}
