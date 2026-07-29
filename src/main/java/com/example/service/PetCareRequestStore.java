package com.example.service;

import cn.hutool.json.JSONArray;
import cn.hutool.json.JSONUtil;
import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.example.entity.PetCareRequest;
import com.example.exception.CustomException;
import com.example.mapper.PetCareRequestMapper;
import org.springframework.stereotype.Service;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Lazy;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import jakarta.annotation.Resource;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Date;
import java.util.List;
import java.util.Objects;

@Service
public class PetCareRequestStore {

    public static final String STATUS_RUNNING = "running";
    public static final String STATUS_ANSWERED = "answered";
    public static final String STATUS_COMPLETED = "completed";
    public static final String STATUS_FAILED = "failed";
    public static final String STATUS_CANCELLED = "cancelled";

    private static final String STALE_MESSAGE = "任务处理租约已过期；服务端无法严格确认外部调用是否已完成。"
            + "如需继续，请显式使用同一 requestId 再次 POST；重试可能再次调用外部服务并产生费用";

    @Value("${app.ai.task-stale-ms:60000}")
    private long taskStaleMs;

    @Resource
    private PetCareRequestMapper requestMapper;

    /**
     * 与 {@link PetCareConversationService} 双向依赖（删除会话要 cancel 任务，
     * finalize 任务要 recordTurn）。用 @Lazy 打断启动期环，避免 Spring Boot 3 默认禁止循环引用。
     */
    @Resource
    @Lazy
    private PetCareConversationService conversationService;

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public Claim claim(Long userId, String requestId, Long conversationId, String question) {
        lockUser(userId);
        Date now = new Date();
        PetCareRequest candidate = new PetCareRequest();
        candidate.setUserId(userId);
        candidate.setRequestId(requestId);
        candidate.setConversationId(conversationId);
        candidate.setRequestedConversationId(conversationId);
        candidate.setRequestedConversationKnown(true);
        candidate.setQuestion(question);
        candidate.setStatus(STATUS_RUNNING);
        candidate.setAttemptCount(1);
        candidate.setCreatedAt(now);
        candidate.setUpdatedAt(now);
        if (requestMapper.insertIgnore(candidate) == 1) {
            return new Claim(candidate, true, true);
        }

        PetCareRequest existing = findRow(userId, requestId);
        if (existing == null) {
            throw new CustomException("409", "请求状态正在建立，请稍后使用同一 requestId 重试");
        }
        assertSamePayload(existing, conversationId, question);
        if (STATUS_RUNNING.equals(existing.getStatus()) && isStale(existing, now)) {
            requestMapper.expireStale(existing.getId(), staleCutoff(now), now, STALE_MESSAGE);
            PetCareRequest expired = findRow(userId, requestId);
            return new Claim(expired == null ? existing : expired, false, false);
        }
        if (STATUS_FAILED.equals(existing.getStatus())
                && Boolean.TRUE.equals(existing.getRequestedConversationKnown())
                && requestMapper.retryFailed(existing.getId(), now) == 1) {
            existing.setStatus(STATUS_RUNNING);
            existing.setAttemptCount((existing.getAttemptCount() == null ? 0 : existing.getAttemptCount()) + 1);
            existing.setUpdatedAt(now);
            return new Claim(existing, true, false);
        }
        return new Claim(existing, false, false);
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public PetCareRequest saveAnswer(Long userId, String requestId, int expectedAttempt,
                                     PetCareService.PetCareAnswer answer) {
        PetCareRequest row = requireRow(userId, requestId, false);
        if (STATUS_ANSWERED.equals(row.getStatus()) || STATUS_COMPLETED.equals(row.getStatus())) {
            return row;
        }
        if (!STATUS_RUNNING.equals(row.getStatus())) {
            throw new CustomException("409", "问答任务当前状态不允许保存结果");
        }
        PetCareService.PetCareAnswer safeAnswer = new PetCareService.PetCareAnswer(
                required(answer.getAnswer(), 65535, "回答"), optional(answer.getSource(), 16),
                optional(answer.getTopic(), 100), answer.getToolsUsed(),
                optional(answer.getDegradeReason(), 500));
        Date now = new Date();
        String toolsJson = toToolsJson(answer.getToolsUsed());
        if (requestMapper.saveAnswerIfAttempt(row.getId(), expectedAttempt,
                safeAnswer, toolsJson, now) != 1) {
            PetCareRequest current = findRow(userId, requestId);
            if (current == null || STATUS_CANCELLED.equals(current.getStatus())) {
                throw new CustomException("410", "会话已删除，模型结果已丢弃且不可读取");
            }
            throw new CustomException("409", "问答任务租约已变化，模型结果已丢弃；无法严格确认外部调用边界");
        }
        return find(userId, requestId);
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public PetCareRequest finalizeAnswer(Long userId, String requestId) {
        lockUser(userId);
        PetCareRequest row = requireRow(userId, requestId, true);
        if (STATUS_COMPLETED.equals(row.getStatus())) {
            return row;
        }
        if (!STATUS_ANSWERED.equals(row.getStatus())) {
            throw new CustomException("409", "问答任务尚未生成可保存的结果");
        }
        PetCareService.PetCareAnswer answer = new PetCareService.PetCareAnswer(
                row.getAnswer(), row.getSource(), row.getTopic(), parseTools(row.getToolsJson()),
                row.getDegradeReason());
        PetCareConversationService.SavedTurn saved = conversationService.recordTurn(
                userId, row.getConversationId(), row.getQuestion(), answer, row.getCreatedAt());
        row.setConversationId(saved.getConversationId());
        row.setConversationTitle(saved.getTitle());
        row.setStatus(STATUS_COMPLETED);
        row.setCompletedAt(new Date());
        row.setUpdatedAt(row.getCompletedAt());
        if (requestMapper.updateById(row) != 1) {
            throw new CustomException("409", "问答任务完成状态保存冲突，请使用同一 requestId 查询");
        }
        return row;
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void markFailed(Long userId, String requestId, int expectedAttempt,
                           String code, String message) {
        PetCareRequest row = requireRow(userId, requestId, false);
        requestMapper.failIfAttempt(row.getId(), expectedAttempt, optional(code, 16),
                optional(message, 500), new Date());
    }

    public PetCareRequest find(Long userId, String requestId) {
        PetCareRequest row = findRow(userId, requestId);
        if (row == null) {
            throw new CustomException("404", "问答任务不存在");
        }
        if (STATUS_RUNNING.equals(row.getStatus()) && isStale(row, new Date())) {
            Date now = new Date();
            requestMapper.expireStale(row.getId(), staleCutoff(now), now, STALE_MESSAGE);
            PetCareRequest refreshed = findRow(userId, requestId);
            return refreshed == null ? row : refreshed;
        }
        return row;
    }

    public void cancelConversation(Long userId, Long conversationId) {
        requestMapper.cancelConversation(userId, conversationId, new Date());
    }

    public void cancelAll(Long userId) {
        requestMapper.cancelAll(userId, new Date());
    }

    public void lockUser(Long userId) {
        if (userId == null || requestMapper.lockUser(userId) == null) {
            throw new CustomException("401", "登录账号不存在或已失效");
        }
    }

    private PetCareRequest requireRow(Long userId, String requestId, boolean lock) {
        com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper<PetCareRequest> query =
                Wrappers.<PetCareRequest>lambdaQuery()
                        .eq(PetCareRequest::getUserId, userId)
                        .eq(PetCareRequest::getRequestId, requestId);
        if (lock) {
            query.last("FOR UPDATE");
        }
        PetCareRequest row = requestMapper.selectOne(query);
        if (row == null) {
            throw new CustomException("404", "问答任务不存在");
        }
        return row;
    }

    private PetCareRequest findRow(Long userId, String requestId) {
        return requestMapper.selectOne(Wrappers.<PetCareRequest>lambdaQuery()
                .eq(PetCareRequest::getUserId, userId)
                .eq(PetCareRequest::getRequestId, requestId));
    }

    private void assertSamePayload(PetCareRequest row, Long conversationId, String question) {
        boolean conversationMismatch = Boolean.TRUE.equals(row.getRequestedConversationKnown())
                && !Objects.equals(row.getRequestedConversationId(), conversationId);
        if (conversationMismatch || !Objects.equals(row.getQuestion(), question)) {
            throw new CustomException("409", "requestId 已用于另一条问题或会话");
        }
    }

    private boolean isStale(PetCareRequest row, Date now) {
        return row.getUpdatedAt() == null
                || row.getUpdatedAt().getTime() <= staleCutoff(now).getTime();
    }

    private Date staleCutoff(Date now) {
        return new Date(now.getTime() - Math.max(1000L, taskStaleMs));
    }

    private String required(String value, int max, String field) {
        String normalized = value == null ? "" : value.trim();
        if (normalized.isEmpty() || normalized.length() > max) {
            throw new CustomException("500", field + "持久化长度无效");
        }
        return normalized;
    }

    private String optional(String value, int max) {
        String normalized = value == null ? "" : value.trim();
        return normalized.length() <= max ? normalized : normalized.substring(0, max);
    }

    private String toToolsJson(List<String> tools) {
        return JSONUtil.toJsonStr(tools == null ? Collections.emptyList() : tools);
    }

    private List<String> parseTools(String json) {
        if (json == null || json.trim().isEmpty()) {
            return Collections.emptyList();
        }
        try {
            JSONArray values = JSONUtil.parseArray(json);
            List<String> result = new ArrayList<>();
            for (Object value : values) {
                result.add(String.valueOf(value));
            }
            return result;
        } catch (RuntimeException ignored) {
            return Collections.emptyList();
        }
    }

    public static final class Claim {
        private final PetCareRequest row;
        private final boolean acquired;
        private final boolean newTask;

        Claim(PetCareRequest row, boolean acquired, boolean newTask) {
            this.row = row;
            this.acquired = acquired;
            this.newTask = newTask;
        }

        public PetCareRequest getRow() { return row; }
        public boolean isAcquired() { return acquired; }
        public boolean isNewTask() { return newTask; }
    }
}
