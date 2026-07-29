package com.example.service;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.example.entity.PetCareChat;
import com.example.entity.PetCareConversation;
import com.example.exception.CustomException;
import com.example.mapper.PetCareChatMapper;
import com.example.mapper.PetCareConversationMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import jakarta.annotation.Resource;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Date;
import java.util.List;

/**
 * 用户级会话目录。所有查改删都同时校验服务端认证得到的 userId。
 */
@Service
public class PetCareConversationService
        extends ServiceImpl<PetCareConversationMapper, PetCareConversation> {

    private static final int DEFAULT_LIST_LIMIT = 50;
    private static final int MAX_LIST_LIMIT = 100;

    @Resource
    private PetCareConversationMapper conversationMapper;

    @Resource
    private PetCareChatMapper chatMapper;

    @Resource
    private PetCareHistoryService historyService;

    @Resource
    private PetCareRequestStore petCareRequestStore;

    @Transactional
    public SavedTurn recordTurn(Long userId, Long requestedConversationId,
                                String question, PetCareService.PetCareAnswer answer,
                                Date questionTime) {
        requireUserId(userId);
        PetCareConversation conversation;
        if (requestedConversationId == null) {
            Date now = questionTime == null ? new Date() : questionTime;
            conversation = new PetCareConversation();
            conversation.setUserId(userId);
            conversation.setTitle(defaultTitle(question));
            conversation.setPreview(preview(question));
            conversation.setTurnCount(0);
            conversation.setCreatedAt(now);
            conversation.setUpdatedAt(now);
            if (conversationMapper.insert(conversation) != 1 || conversation.getId() == null) {
                throw new CustomException("500", "新对话创建失败");
            }
        } else {
            conversation = requireOwned(userId, requestedConversationId, true);
        }

        PetCareChat row = historyService.saveTurn(
                userId, conversation.getId(), question, answer, questionTime);
        conversation.setPreview(preview(question));
        conversation.setTurnCount(Math.max(0,
                conversation.getTurnCount() == null ? 0 : conversation.getTurnCount()) + 1);
        conversation.setUpdatedAt(row.getAnswerTime() == null ? new Date() : row.getAnswerTime());
        if (conversationMapper.updateById(conversation) != 1) {
            throw new CustomException("409", "对话已变化，请刷新后重试");
        }
        return new SavedTurn(conversation.getId(), conversation.getTitle(), row);
    }

    public void assertOwned(Long userId, Long conversationId) {
        if (conversationId != null) {
            requireOwned(userId, conversationId, false);
        }
    }

    @Transactional
    public List<ConversationItem> list(Long userId, Integer requestedLimit) {
        requireUserId(userId);
        migrateLegacy(userId);
        int limit = requestedLimit == null ? DEFAULT_LIST_LIMIT
                : Math.max(1, Math.min(requestedLimit, MAX_LIST_LIMIT));
        List<PetCareConversation> rows = conversationMapper.selectList(
                Wrappers.<PetCareConversation>lambdaQuery()
                        .eq(PetCareConversation::getUserId, userId)
                        .orderByDesc(PetCareConversation::getUpdatedAt)
                        .orderByDesc(PetCareConversation::getId)
                        .last("LIMIT " + limit));
        if (rows == null || rows.isEmpty()) {
            return Collections.emptyList();
        }
        List<ConversationItem> result = new ArrayList<>(rows.size());
        for (PetCareConversation row : rows) {
            result.add(toItem(row));
        }
        return result;
    }

    public ConversationDetail detail(Long userId, Long conversationId) {
        PetCareConversation conversation = requireOwned(userId, conversationId, false);
        return new ConversationDetail(
                toItem(conversation),
                historyService.history(userId, conversationId, 100));
    }

    @Transactional
    public ConversationItem rename(Long userId, Long conversationId, String rawTitle) {
        PetCareConversation conversation = requireOwned(userId, conversationId, true);
        String title = normalize(rawTitle);
        if (title.isEmpty() || title.length() > 60) {
            throw new CustomException("400", "会话标题不能为空且不能超过 60 个字符");
        }
        conversation.setTitle(title);
        conversation.setUpdatedAt(new Date());
        if (conversationMapper.updateById(conversation) != 1) {
            throw new CustomException("409", "会话标题保存失败，请刷新后重试");
        }
        return toItem(conversation);
    }

    @Transactional
    public boolean delete(Long userId, Long conversationId) {
        requireOwned(userId, conversationId, true);
        petCareRequestStore.cancelConversation(userId, conversationId);
        chatMapper.delete(Wrappers.<PetCareChat>lambdaQuery()
                .eq(PetCareChat::getUserId, userId)
                .eq(PetCareChat::getConversationId, conversationId));
        if (conversationMapper.delete(Wrappers.<PetCareConversation>lambdaQuery()
                .eq(PetCareConversation::getId, conversationId)
                .eq(PetCareConversation::getUserId, userId)) != 1) {
            throw new CustomException("409", "会话删除失败，请刷新后重试");
        }
        return true;
    }

    @Transactional
    public boolean clearAll(Long userId) {
        requireUserId(userId);
        petCareRequestStore.cancelAll(userId);
        int deletedTurns = historyService.clearHistory(userId);
        conversationMapper.delete(Wrappers.<PetCareConversation>lambdaQuery()
                .eq(PetCareConversation::getUserId, userId));
        return deletedTurns > 0;
    }

    /**
     * 将升级前 conversation_id 为空的记录一次性归档，避免旧聊天消失。
     */
    @Transactional
    public synchronized void migrateLegacy(Long userId) {
        List<PetCareChat> legacy = chatMapper.selectList(
                Wrappers.<PetCareChat>lambdaQuery()
                        .eq(PetCareChat::getUserId, userId)
                        .isNull(PetCareChat::getConversationId)
                        .orderByAsc(PetCareChat::getId));
        if (legacy == null || legacy.isEmpty()) {
            return;
        }
        PetCareChat first = legacy.get(0);
        PetCareChat last = legacy.get(legacy.size() - 1);
        PetCareConversation conversation = new PetCareConversation();
        conversation.setUserId(userId);
        conversation.setTitle("以前的聊天");
        conversation.setPreview(preview(last.getQuestion()));
        conversation.setTurnCount(legacy.size());
        conversation.setCreatedAt(first.getQuestionTime() == null ? new Date() : first.getQuestionTime());
        conversation.setUpdatedAt(last.getAnswerTime() == null ? new Date() : last.getAnswerTime());
        if (conversationMapper.insert(conversation) != 1 || conversation.getId() == null) {
            throw new CustomException("500", "旧聊天归档失败");
        }
        chatMapper.update(null, Wrappers.<PetCareChat>lambdaUpdate()
                .set(PetCareChat::getConversationId, conversation.getId())
                .eq(PetCareChat::getUserId, userId)
                .isNull(PetCareChat::getConversationId));
    }

    private PetCareConversation requireOwned(Long userId, Long conversationId, boolean lock) {
        requireUserId(userId);
        if (conversationId == null || conversationId <= 0) {
            throw new CustomException("400", "会话 ID 无效");
        }
        com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper<PetCareConversation> query =
                Wrappers.<PetCareConversation>lambdaQuery()
                        .eq(PetCareConversation::getId, conversationId)
                        .eq(PetCareConversation::getUserId, userId);
        if (lock) {
            query.last("FOR UPDATE");
        }
        PetCareConversation conversation = conversationMapper.selectOne(query);
        if (conversation == null) {
            throw new CustomException("404", "会话不存在或无权访问");
        }
        return conversation;
    }

    private ConversationItem toItem(PetCareConversation row) {
        return new ConversationItem(row.getId(), row.getTitle(), row.getPreview(),
                row.getTurnCount() == null ? 0 : row.getTurnCount(),
                row.getCreatedAt(), row.getUpdatedAt());
    }

    private String defaultTitle(String question) {
        String value = normalize(question);
        return value.length() <= 24 ? value : value.substring(0, 24) + "…";
    }

    private String preview(String question) {
        String value = normalize(question);
        return value.length() <= 90 ? value : value.substring(0, 90) + "…";
    }

    private String normalize(String value) {
        return value == null ? "" : value.trim().replaceAll("\\s+", " ");
    }

    private void requireUserId(Long userId) {
        if (userId == null || userId <= 0) {
            throw new CustomException("401", "未登录或登录已过期");
        }
    }

    public static final class SavedTurn {
        private final Long conversationId;
        private final String title;
        private final PetCareChat row;

        SavedTurn(Long conversationId, String title, PetCareChat row) {
            this.conversationId = conversationId;
            this.title = title;
            this.row = row;
        }

        public Long getConversationId() { return conversationId; }
        public String getTitle() { return title; }
        public PetCareChat getRow() { return row; }
    }

    public static final class ConversationItem {
        @com.fasterxml.jackson.databind.annotation.JsonSerialize(
                using = com.fasterxml.jackson.databind.ser.std.ToStringSerializer.class)
        private final Long id;
        private final String title;
        private final String preview;
        private final int turnCount;
        @com.fasterxml.jackson.annotation.JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss", timezone = "GMT+8")
        private final Date createdAt;
        @com.fasterxml.jackson.annotation.JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss", timezone = "GMT+8")
        private final Date updatedAt;

        ConversationItem(Long id, String title, String preview, int turnCount,
                         Date createdAt, Date updatedAt) {
            this.id = id;
            this.title = title;
            this.preview = preview;
            this.turnCount = turnCount;
            this.createdAt = createdAt;
            this.updatedAt = updatedAt;
        }

        public Long getId() { return id; }
        public String getTitle() { return title; }
        public String getPreview() { return preview; }
        public int getTurnCount() { return turnCount; }
        public Date getCreatedAt() { return createdAt; }
        public Date getUpdatedAt() { return updatedAt; }
    }

    public static final class ConversationDetail {
        private final ConversationItem conversation;
        private final PetCareHistoryService.HistorySnapshot history;

        ConversationDetail(ConversationItem conversation,
                           PetCareHistoryService.HistorySnapshot history) {
            this.conversation = conversation;
            this.history = history;
        }

        public ConversationItem getConversation() { return conversation; }
        public PetCareHistoryService.HistorySnapshot getHistory() { return history; }
    }
}
