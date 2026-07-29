package com.example.service;

import cn.hutool.json.JSONArray;
import cn.hutool.json.JSONUtil;
import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.example.entity.PetCareChat;
import com.example.exception.CustomException;
import com.example.mapper.PetCareChatMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import jakarta.annotation.Resource;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Date;
import java.util.List;

/**
 * 照顾知识助手历史记录。所有读写条件都包含服务端认证得到的 userId。
 */
@Service
public class PetCareHistoryService extends ServiceImpl<PetCareChatMapper, PetCareChat> {

    private static final int DEFAULT_LIMIT = 50;
    private static final int MAX_LIMIT = 100;

    @Resource
    private PetCareChatMapper petCareChatMapper;

    @Transactional
    public PetCareChat saveTurn(Long userId, String question,
                                PetCareService.PetCareAnswer answer,
                                Date questionTime) {
        return saveTurn(userId, null, question, answer, questionTime);
    }

    @Transactional
    public PetCareChat saveTurn(Long userId, Long conversationId, String question,
                                PetCareService.PetCareAnswer answer,
                                Date questionTime) {
        requireUserId(userId);
        if (answer == null || answer.getAnswer() == null || answer.getAnswer().trim().isEmpty()) {
            throw new CustomException("500", "回答为空，无法保存聊天记录");
        }

        PetCareChat row = new PetCareChat();
        row.setUserId(userId);
        row.setConversationId(conversationId);
        row.setQuestion(required(question, 500, "问题"));
        row.setAnswer(required(answer.getAnswer(), 65535, "回答"));
        row.setSource(optional(answer.getSource(), 16));
        row.setDegradeReason(optional(answer.getDegradeReason(), 500));
        row.setTopic(optional(answer.getTopic(), 100));
        row.setToolsJson(toToolsJson(answer.getToolsUsed()));
        row.setQuestionTime(questionTime == null ? new Date() : new Date(questionTime.getTime()));
        row.setAnswerTime(new Date());
        if (petCareChatMapper.insert(row) != 1) {
            throw new CustomException("500", "聊天记录保存失败");
        }
        return row;
    }

    public HistorySnapshot history(Long userId, Integer requestedLimit) {
        return history(userId, null, requestedLimit);
    }

    public HistorySnapshot history(Long userId, Long conversationId, Integer requestedLimit) {
        requireUserId(userId);
        int limit = requestedLimit == null ? DEFAULT_LIMIT
                : Math.max(1, Math.min(requestedLimit, MAX_LIMIT));
        com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper<PetCareChat> countQuery =
                Wrappers.<PetCareChat>lambdaQuery().eq(PetCareChat::getUserId, userId);
        com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper<PetCareChat> listQuery =
                Wrappers.<PetCareChat>lambdaQuery().eq(PetCareChat::getUserId, userId);
        if (conversationId != null) {
            countQuery.eq(PetCareChat::getConversationId, conversationId);
            listQuery.eq(PetCareChat::getConversationId, conversationId);
        }
        Long totalValue = petCareChatMapper.selectCount(countQuery);
        List<PetCareChat> rows = petCareChatMapper.selectList(listQuery
                .orderByDesc(PetCareChat::getId)
                .last("LIMIT " + limit));
        if (rows == null) {
            rows = new ArrayList<>();
        } else {
            rows = new ArrayList<>(rows);
        }
        Collections.reverse(rows);

        List<HistoryItem> items = new ArrayList<>(rows.size());
        for (PetCareChat row : rows) {
            items.add(new HistoryItem(row.getId(), row.getQuestion(), row.getAnswer(),
                    row.getSource(), row.getDegradeReason(), row.getTopic(), parseTools(row.getToolsJson()),
                    row.getQuestionTime(), row.getAnswerTime()));
        }
        return new HistorySnapshot(totalValue == null ? 0L : totalValue, items);
    }

    @Transactional
    public int clearHistory(Long userId) {
        requireUserId(userId);
        return petCareChatMapper.delete(Wrappers.<PetCareChat>lambdaQuery()
                .eq(PetCareChat::getUserId, userId));
    }

    /** 模型上下文只来自当前账号、当前会话已经持久化的权威问答。 */
    public List<PetCareService.ChatTurn> authoritativeTurns(Long userId, Long conversationId,
                                                            int requestedMessages) {
        requireUserId(userId);
        if (conversationId == null || requestedMessages <= 0) {
            return Collections.emptyList();
        }
        int turnLimit = Math.max(1, Math.min(50, (requestedMessages + 1) / 2));
        List<PetCareChat> rows = petCareChatMapper.selectList(
                Wrappers.<PetCareChat>lambdaQuery()
                        .eq(PetCareChat::getUserId, userId)
                        .eq(PetCareChat::getConversationId, conversationId)
                        .orderByDesc(PetCareChat::getId)
                        .last("LIMIT " + turnLimit));
        if (rows == null || rows.isEmpty()) {
            return Collections.emptyList();
        }
        rows = new ArrayList<>(rows);
        Collections.reverse(rows);
        List<PetCareService.ChatTurn> result = new ArrayList<>(rows.size() * 2);
        for (PetCareChat row : rows) {
            result.add(new PetCareService.ChatTurn("user", row.getQuestion()));
            result.add(new PetCareService.ChatTurn("assistant", row.getAnswer()));
        }
        int from = Math.max(0, result.size() - requestedMessages);
        return new ArrayList<>(result.subList(from, result.size()));
    }

    private void requireUserId(Long userId) {
        if (userId == null || userId <= 0) {
            throw new CustomException("401", "未登录或登录已过期");
        }
    }

    private String required(String value, int max, String field) {
        String normalized = value == null ? "" : value.trim();
        if (normalized.isEmpty()) {
            throw new CustomException("400", field + "不能为空");
        }
        if (normalized.length() > max) {
            throw new CustomException("400", field + "不能超过 " + max + " 个字符");
        }
        return normalized;
    }

    private String optional(String value, int max) {
        String normalized = value == null ? "" : value.trim();
        return normalized.length() <= max ? normalized : normalized.substring(0, max);
    }

    private String toToolsJson(List<String> tools) {
        if (tools == null || tools.isEmpty()) {
            return "[]";
        }
        List<String> safe = new ArrayList<>();
        for (String tool : tools) {
            String value = optional(tool, 64);
            if (!value.isEmpty() && !safe.contains(value)) {
                safe.add(value);
            }
            if (safe.size() >= 20) {
                break;
            }
        }
        return JSONUtil.toJsonStr(safe);
    }

    private List<String> parseTools(String value) {
        if (value == null || value.trim().isEmpty()) {
            return Collections.emptyList();
        }
        try {
            JSONArray array = JSONUtil.parseArray(value);
            List<String> tools = new ArrayList<>();
            for (Object item : array) {
                String tool = optional(String.valueOf(item), 64);
                if (!tool.isEmpty() && !tools.contains(tool)) {
                    tools.add(tool);
                }
            }
            return tools;
        } catch (Exception ignored) {
            return Collections.emptyList();
        }
    }

    public static final class HistorySnapshot {
        private final long total;
        private final List<HistoryItem> items;

        public HistorySnapshot(long total, List<HistoryItem> items) {
            this.total = total;
            this.items = items == null ? Collections.emptyList() : items;
        }

        public long getTotal() { return total; }
        public List<HistoryItem> getItems() { return items; }
    }

    public static final class HistoryItem {
        private final Long id;
        private final String question;
        private final String answer;
        private final String source;
        private final String degradeReason;
        private final String topic;
        private final List<String> toolsUsed;
        @com.fasterxml.jackson.annotation.JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss", timezone = "GMT+8")
        private final Date questionTime;
        @com.fasterxml.jackson.annotation.JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss", timezone = "GMT+8")
        private final Date answerTime;

        public HistoryItem(Long id, String question, String answer, String source,
                           String degradeReason, String topic,
                           List<String> toolsUsed, Date questionTime, Date answerTime) {
            this.id = id;
            this.question = question;
            this.answer = answer;
            this.source = source;
            this.degradeReason = degradeReason == null ? "" : degradeReason;
            this.topic = topic;
            this.toolsUsed = toolsUsed == null ? Collections.emptyList() : toolsUsed;
            this.questionTime = questionTime;
            this.answerTime = answerTime;
        }

        public Long getId() { return id; }
        public String getQuestion() { return question; }
        public String getAnswer() { return answer; }
        public String getSource() { return source; }
        public String getDegradeReason() { return degradeReason; }
        public String getTopic() { return topic; }
        public List<String> getToolsUsed() { return toolsUsed; }
        public Date getQuestionTime() { return questionTime; }
        public Date getAnswerTime() { return answerTime; }
    }
}
