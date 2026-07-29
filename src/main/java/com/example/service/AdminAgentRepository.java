package com.example.service;

import com.example.exception.CustomException;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.jdbc.support.KeyHolder;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

import java.sql.PreparedStatement;
import java.sql.Statement;
import java.sql.Timestamp;
import java.util.Date;
import java.util.List;

/**
 * 管理员 Agent 的持久化边界。会话始终绑定发起管理员，平台密钥只有一份。
 */
@Repository
public class AdminAgentRepository {

    private final JdbcTemplate jdbcTemplate;

    public AdminAgentRepository(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    public ConfigRow findConfig() {
        List<ConfigRow> rows = jdbcTemplate.query(
                "SELECT enabled, base_url, model, api_key_ciphertext, connection_status, "
                        + "last_test_message, last_tested_at, version, created_at, updated_at "
                        + "FROM t_admin_agent_config WHERE id = 1",
                (rs, i) -> new ConfigRow(
                        rs.getBoolean("enabled"), rs.getString("base_url"), rs.getString("model"),
                        rs.getString("api_key_ciphertext"), rs.getString("connection_status"),
                        rs.getString("last_test_message"), rs.getTimestamp("last_tested_at"),
                        rs.getLong("version"), rs.getTimestamp("created_at"), rs.getTimestamp("updated_at")));
        return rows.isEmpty() ? null : rows.get(0);
    }

    @Transactional
    public ConfigRow saveConfig(boolean enabled, String baseUrl, String model, String ciphertext,
                                String status, String message, Date testedAt) {
        ConfigRow existing = findConfigForUpdate();
        Timestamp now = new Timestamp(System.currentTimeMillis());
        if (existing == null) {
            jdbcTemplate.update(
                    "INSERT INTO t_admin_agent_config "
                            + "(id, enabled, base_url, model, api_key_ciphertext, connection_status, "
                            + "last_test_message, last_tested_at, version, created_at, updated_at) "
                            + "VALUES (1,?,?,?,?,?,?,?,?,?,?)",
                    enabled, baseUrl, model, ciphertext, status, safe(message), timestamp(testedAt),
                    1L, now, now);
        } else {
            int changed = jdbcTemplate.update(
                    "UPDATE t_admin_agent_config SET enabled=?, base_url=?, model=?, "
                            + "api_key_ciphertext=?, connection_status=?, last_test_message=?, "
                            + "last_tested_at=?, version=version+1, updated_at=? "
                            + "WHERE id=1 AND version=?",
                    enabled, baseUrl, model, ciphertext, status, safe(message), timestamp(testedAt),
                    now, existing.getVersion());
            if (changed != 1) {
                throw new CustomException("409", "管理员 Agent 配置已变化，请刷新后重试");
            }
        }
        return findConfig();
    }

    @Transactional
    public ConfigRow markConnection(long expectedVersion, String status, String message) {
        Timestamp now = new Timestamp(System.currentTimeMillis());
        int changed = jdbcTemplate.update(
                "UPDATE t_admin_agent_config SET connection_status=?, last_test_message=?, "
                        + "last_tested_at=?, updated_at=? WHERE id=1 AND version=?",
                status, safe(message), now, now, expectedVersion);
        if (changed != 1) {
            throw new CustomException("409", "配置已变化，旧连接测试结果已丢弃");
        }
        return findConfig();
    }

    @Transactional
    public void clearConfig() {
        jdbcTemplate.update("DELETE FROM t_admin_agent_config WHERE id=1");
    }

    public List<ConversationItem> listConversations(Long userId, int limit) {
        requireUser(userId);
        return jdbcTemplate.query(
                "SELECT id, title, preview, turn_count, created_at, updated_at "
                        + "FROM t_admin_agent_conversation WHERE user_id=? "
                        + "ORDER BY updated_at DESC, id DESC LIMIT ?",
                (rs, i) -> new ConversationItem(rs.getLong("id"), rs.getString("title"),
                        rs.getString("preview"), rs.getInt("turn_count"),
                        rs.getTimestamp("created_at"), rs.getTimestamp("updated_at")),
                userId, Math.max(1, Math.min(limit, 100)));
    }

    public ConversationDetail detail(Long userId, Long conversationId) {
        ConversationItem conversation = requireOwned(userId, conversationId, false);
        List<TurnItem> turns = jdbcTemplate.query(
                "SELECT id, request_id, question, answer, tools_json, created_at, completed_at "
                        + "FROM t_admin_agent_message WHERE user_id=? AND conversation_id=? "
                        + "ORDER BY id ASC LIMIT 100",
                (rs, i) -> new TurnItem(rs.getLong("id"), rs.getString("request_id"),
                        rs.getString("question"), rs.getString("answer"), rs.getString("tools_json"),
                        rs.getTimestamp("created_at"), rs.getTimestamp("completed_at")),
                userId, conversationId);
        return new ConversationDetail(conversation, turns);
    }

    public TurnResult findByRequestId(Long userId, String requestId) {
        List<TurnResult> rows = jdbcTemplate.query(
                "SELECT m.conversation_id, c.title, m.id, m.request_id, m.question, m.answer, "
                        + "m.tools_json, m.created_at, m.completed_at "
                        + "FROM t_admin_agent_message m JOIN t_admin_agent_conversation c "
                        + "ON c.id=m.conversation_id AND c.user_id=m.user_id "
                        + "WHERE m.user_id=? AND m.request_id=?",
                (rs, i) -> new TurnResult(rs.getLong("conversation_id"), rs.getString("title"),
                        new TurnItem(rs.getLong("id"), rs.getString("request_id"),
                                rs.getString("question"), rs.getString("answer"),
                                rs.getString("tools_json"), rs.getTimestamp("created_at"),
                                rs.getTimestamp("completed_at"))), userId, requestId);
        return rows.isEmpty() ? null : rows.get(0);
    }

    @Transactional
    public TurnResult recordTurn(Long userId, Long requestedConversationId, String requestId,
                                 String question, String answer, String toolsJson) {
        requireUser(userId);
        TurnResult duplicate = findByRequestId(userId, requestId);
        if (duplicate != null) {
            return duplicate;
        }
        Timestamp now = new Timestamp(System.currentTimeMillis());
        ConversationItem conversation = requestedConversationId == null
                ? createConversation(userId, question, now)
                : requireOwned(userId, requestedConversationId, true);
        try {
            KeyHolder key = new GeneratedKeyHolder();
            jdbcTemplate.update(connection -> {
                PreparedStatement statement = connection.prepareStatement(
                        "INSERT INTO t_admin_agent_message "
                                + "(user_id, conversation_id, request_id, question, answer, tools_json, created_at, completed_at) "
                                + "VALUES (?,?,?,?,?,?,?,?)", Statement.RETURN_GENERATED_KEYS);
                statement.setLong(1, userId);
                statement.setLong(2, conversation.getId());
                statement.setString(3, requestId);
                statement.setString(4, question);
                statement.setString(5, answer);
                statement.setString(6, toolsJson);
                statement.setTimestamp(7, now);
                statement.setTimestamp(8, now);
                return statement;
            }, key);
            long messageId = key.getKey() == null ? 0L : key.getKey().longValue();
            jdbcTemplate.update(
                    "UPDATE t_admin_agent_conversation SET preview=?, turn_count=turn_count+1, updated_at=? "
                            + "WHERE id=? AND user_id=?",
                    preview(question), now, conversation.getId(), userId);
            return new TurnResult(conversation.getId(), conversation.getTitle(),
                    new TurnItem(messageId, requestId, question, answer, toolsJson, now, now));
        } catch (DuplicateKeyException duplicateKey) {
            TurnResult existing = findByRequestId(userId, requestId);
            if (existing != null) return existing;
            throw duplicateKey;
        }
    }

    @Transactional
    public ConversationItem rename(Long userId, Long conversationId, String rawTitle) {
        requireOwned(userId, conversationId, true);
        String title = normalize(rawTitle);
        if (title.isEmpty() || title.length() > 60) {
            throw new CustomException("400", "会话标题不能为空且不能超过 60 个字符");
        }
        jdbcTemplate.update(
                "UPDATE t_admin_agent_conversation SET title=?, updated_at=? WHERE id=? AND user_id=?",
                title, new Timestamp(System.currentTimeMillis()), conversationId, userId);
        return requireOwned(userId, conversationId, false);
    }

    @Transactional
    public boolean deleteConversation(Long userId, Long conversationId) {
        requireOwned(userId, conversationId, true);
        jdbcTemplate.update("DELETE FROM t_admin_agent_message WHERE user_id=? AND conversation_id=?",
                userId, conversationId);
        int deleted = jdbcTemplate.update(
                "DELETE FROM t_admin_agent_conversation WHERE id=? AND user_id=?",
                conversationId, userId);
        if (deleted != 1) throw new CustomException("409", "会话删除失败，请刷新后重试");
        return true;
    }

    public void audit(Long actorId, String eventType, Long conversationId, String requestId,
                      String toolsJson, String outcome, String detail) {
        jdbcTemplate.update(
                "INSERT INTO t_admin_agent_audit "
                        + "(actor_id, event_type, conversation_id, request_id, tools_json, outcome, detail, created_at) "
                        + "VALUES (?,?,?,?,?,?,?,?)",
                actorId, safe(eventType), conversationId, safe(requestId), toolsJson,
                safe(outcome), truncate(detail, 1000), new Timestamp(System.currentTimeMillis()));
    }

    private ConfigRow findConfigForUpdate() {
        List<ConfigRow> rows = jdbcTemplate.query(
                "SELECT enabled, base_url, model, api_key_ciphertext, connection_status, "
                        + "last_test_message, last_tested_at, version, created_at, updated_at "
                        + "FROM t_admin_agent_config WHERE id=1 FOR UPDATE",
                (rs, i) -> new ConfigRow(rs.getBoolean("enabled"), rs.getString("base_url"),
                        rs.getString("model"), rs.getString("api_key_ciphertext"),
                        rs.getString("connection_status"), rs.getString("last_test_message"),
                        rs.getTimestamp("last_tested_at"), rs.getLong("version"),
                        rs.getTimestamp("created_at"), rs.getTimestamp("updated_at")));
        return rows.isEmpty() ? null : rows.get(0);
    }

    private ConversationItem createConversation(Long userId, String question, Timestamp now) {
        KeyHolder key = new GeneratedKeyHolder();
        String title = title(question);
        jdbcTemplate.update(connection -> {
            PreparedStatement statement = connection.prepareStatement(
                    "INSERT INTO t_admin_agent_conversation "
                            + "(user_id, title, preview, turn_count, created_at, updated_at) "
                            + "VALUES (?,?,?,?,?,?)", Statement.RETURN_GENERATED_KEYS);
            statement.setLong(1, userId);
            statement.setString(2, title);
            statement.setString(3, preview(question));
            statement.setInt(4, 0);
            statement.setTimestamp(5, now);
            statement.setTimestamp(6, now);
            return statement;
        }, key);
        if (key.getKey() == null) throw new CustomException("500", "管理员 Agent 新会话创建失败");
        return new ConversationItem(key.getKey().longValue(), title, preview(question), 0, now, now);
    }

    private ConversationItem requireOwned(Long userId, Long conversationId, boolean lock) {
        requireUser(userId);
        if (conversationId == null || conversationId <= 0) {
            throw new CustomException("400", "会话 ID 无效");
        }
        String sql = "SELECT id, title, preview, turn_count, created_at, updated_at "
                + "FROM t_admin_agent_conversation WHERE id=? AND user_id=?" + (lock ? " FOR UPDATE" : "");
        List<ConversationItem> rows = jdbcTemplate.query(sql,
                (rs, i) -> new ConversationItem(rs.getLong("id"), rs.getString("title"),
                        rs.getString("preview"), rs.getInt("turn_count"),
                        rs.getTimestamp("created_at"), rs.getTimestamp("updated_at")),
                conversationId, userId);
        if (rows.isEmpty()) throw new CustomException("404", "会话不存在或无权访问");
        return rows.get(0);
    }

    private static Timestamp timestamp(Date date) {
        return date == null ? null : new Timestamp(date.getTime());
    }

    private static String title(String value) {
        String clean = normalize(value);
        return clean.length() <= 24 ? clean : clean.substring(0, 24) + "…";
    }

    private static String preview(String value) {
        String clean = normalize(value);
        return clean.length() <= 90 ? clean : clean.substring(0, 90) + "…";
    }

    private static String normalize(String value) {
        return value == null ? "" : value.trim().replaceAll("\\s+", " ");
    }

    private static String safe(String value) {
        return value == null ? "" : value.trim();
    }

    private static String truncate(String value, int max) {
        String safe = safe(value);
        return safe.length() <= max ? safe : safe.substring(0, max);
    }

    private static void requireUser(Long userId) {
        if (userId == null || userId <= 0) throw new CustomException("401", "未登录或登录已过期");
    }

    public static final class ConfigRow {
        private final boolean enabled;
        private final String baseUrl;
        private final String model;
        private final String ciphertext;
        private final String connectionStatus;
        private final String lastTestMessage;
        private final Date lastTestedAt;
        private final long version;
        private final Date createdAt;
        private final Date updatedAt;

        ConfigRow(boolean enabled, String baseUrl, String model, String ciphertext,
                  String connectionStatus, String lastTestMessage, Date lastTestedAt,
                  long version, Date createdAt, Date updatedAt) {
            this.enabled = enabled;
            this.baseUrl = baseUrl;
            this.model = model;
            this.ciphertext = ciphertext;
            this.connectionStatus = connectionStatus;
            this.lastTestMessage = lastTestMessage;
            this.lastTestedAt = lastTestedAt == null ? null : new Date(lastTestedAt.getTime());
            this.version = version;
            this.createdAt = createdAt == null ? null : new Date(createdAt.getTime());
            this.updatedAt = updatedAt == null ? null : new Date(updatedAt.getTime());
        }

        public boolean isEnabled() { return enabled; }
        public String getBaseUrl() { return baseUrl; }
        public String getModel() { return model; }
        public String getCiphertext() { return ciphertext; }
        public String getConnectionStatus() { return connectionStatus; }
        public String getLastTestMessage() { return lastTestMessage; }
        public Date getLastTestedAt() { return lastTestedAt == null ? null : new Date(lastTestedAt.getTime()); }
        public long getVersion() { return version; }
        public Date getCreatedAt() { return createdAt == null ? null : new Date(createdAt.getTime()); }
        public Date getUpdatedAt() { return updatedAt == null ? null : new Date(updatedAt.getTime()); }
    }

    public static final class ConversationItem {
        @com.fasterxml.jackson.databind.annotation.JsonSerialize(using = com.fasterxml.jackson.databind.ser.std.ToStringSerializer.class)
        private final Long id;
        private final String title;
        private final String preview;
        private final int turnCount;
        @com.fasterxml.jackson.annotation.JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss", timezone = "GMT+8")
        private final Date createdAt;
        @com.fasterxml.jackson.annotation.JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss", timezone = "GMT+8")
        private final Date updatedAt;

        ConversationItem(Long id, String title, String preview, int turnCount, Date createdAt, Date updatedAt) {
            this.id = id; this.title = title; this.preview = preview; this.turnCount = turnCount;
            this.createdAt = createdAt == null ? null : new Date(createdAt.getTime());
            this.updatedAt = updatedAt == null ? null : new Date(updatedAt.getTime());
        }
        public Long getId() { return id; }
        public String getTitle() { return title; }
        public String getPreview() { return preview; }
        public int getTurnCount() { return turnCount; }
        public Date getCreatedAt() { return createdAt == null ? null : new Date(createdAt.getTime()); }
        public Date getUpdatedAt() { return updatedAt == null ? null : new Date(updatedAt.getTime()); }
    }

    public static final class TurnItem {
        @com.fasterxml.jackson.databind.annotation.JsonSerialize(using = com.fasterxml.jackson.databind.ser.std.ToStringSerializer.class)
        private final Long id;
        private final String requestId;
        private final String question;
        private final String answer;
        private final String toolsJson;
        @com.fasterxml.jackson.annotation.JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss", timezone = "GMT+8")
        private final Date createdAt;
        @com.fasterxml.jackson.annotation.JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss", timezone = "GMT+8")
        private final Date completedAt;
        TurnItem(Long id, String requestId, String question, String answer, String toolsJson,
                 Date createdAt, Date completedAt) {
            this.id=id; this.requestId=requestId; this.question=question; this.answer=answer;
            this.toolsJson=toolsJson; this.createdAt=createdAt == null ? null : new Date(createdAt.getTime());
            this.completedAt=completedAt == null ? null : new Date(completedAt.getTime());
        }
        public Long getId() { return id; }
        public String getRequestId() { return requestId; }
        public String getQuestion() { return question; }
        public String getAnswer() { return answer; }
        public String getToolsJson() { return toolsJson; }
        public Date getCreatedAt() { return createdAt == null ? null : new Date(createdAt.getTime()); }
        public Date getCompletedAt() { return completedAt == null ? null : new Date(completedAt.getTime()); }
    }

    public static final class ConversationDetail {
        private final ConversationItem conversation;
        private final List<TurnItem> turns;
        ConversationDetail(ConversationItem conversation, List<TurnItem> turns) {
            this.conversation=conversation; this.turns=turns;
        }
        public ConversationItem getConversation() { return conversation; }
        public List<TurnItem> getTurns() { return turns; }
    }

    public static final class TurnResult {
        @com.fasterxml.jackson.databind.annotation.JsonSerialize(using = com.fasterxml.jackson.databind.ser.std.ToStringSerializer.class)
        private final Long conversationId;
        private final String conversationTitle;
        private final TurnItem turn;
        TurnResult(Long conversationId, String conversationTitle, TurnItem turn) {
            this.conversationId=conversationId; this.conversationTitle=conversationTitle; this.turn=turn;
        }
        public Long getConversationId() { return conversationId; }
        public String getConversationTitle() { return conversationTitle; }
        public TurnItem getTurn() { return turn; }
    }
}
