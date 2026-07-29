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

/** 3A/3B：管理员个人审核草稿及其人工确认执行凭据。 */
@Repository
public class AdminAgentDraftRepository {
    private final JdbcTemplate jdbcTemplate;

    public AdminAgentDraftRepository(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    public DraftItem findByRequestId(Long actorId, String requestId) {
        List<DraftItem> rows = jdbcTemplate.query(baseSelect()
                        + " WHERE actor_id=? AND request_id=? LIMIT 1",
                mapper(), actorId, requestId);
        return rows.isEmpty() ? null : rows.get(0);
    }

    public DraftItem findByApplication(Long actorId, Long animalId, Long applicantId) {
        List<DraftItem> rows = jdbcTemplate.query(baseSelect()
                        + " WHERE actor_id=? AND animal_id=? AND applicant_id=? AND status='draft' LIMIT 1",
                mapper(), actorId, animalId, applicantId);
        return rows.isEmpty() ? null : rows.get(0);
    }

    public DraftItem findByFinalRequestId(Long actorId, String requestId) {
        List<DraftItem> rows = jdbcTemplate.query(baseSelect()
                        + " WHERE actor_id=? AND final_request_id=? LIMIT 1",
                mapper(), actorId, requestId);
        return rows.isEmpty() ? null : rows.get(0);
    }

    public DraftItem findOwned(Long actorId, Long id) {
        List<DraftItem> rows = jdbcTemplate.query(baseSelect() + " WHERE actor_id=? AND id=? LIMIT 1",
                mapper(), actorId, id);
        if (rows.isEmpty()) throw new CustomException("404", "审核草稿不存在或无权访问");
        return rows.get(0);
    }

    public DraftItem lockOwned(Long actorId, Long id) {
        List<DraftItem> rows = jdbcTemplate.query(baseSelect()
                        + " WHERE actor_id=? AND id=? FOR UPDATE",
                mapper(), actorId, id);
        if (rows.isEmpty()) throw new CustomException("404", "审核草稿不存在或无权访问");
        return rows.get(0);
    }

    public Integer adoptionState(Long animalId, Long applicantId) {
        List<Integer> rows = jdbcTemplate.query(
                "SELECT COALESCE(vstate,0) FROM t_adopt WHERE aid=? AND uid=? LIMIT 1",
                (rs, rowNum) -> rs.getInt(1), animalId, applicantId);
        return rows.isEmpty() ? null : rows.get(0);
    }

    @Transactional
    public DraftItem saveGenerated(Long actorId, String requestId, Long animalId, Long applicantId,
                                   String model, AdminAgentClient.AdoptionDraftSuggestion suggestion) {
        List<DraftItem> locked = jdbcTemplate.query(baseSelect()
                        + " WHERE actor_id=? AND animal_id=? AND applicant_id=? FOR UPDATE",
                mapper(), actorId, animalId, applicantId);
        Timestamp now = new Timestamp(System.currentTimeMillis());
        try {
            if (!locked.isEmpty()) {
                DraftItem current = locked.get(0);
                if ("executed".equals(current.getStatus())) {
                    throw new CustomException("409", "该申请已有已执行草稿，不能覆盖审计凭据");
                }
                jdbcTemplate.update("UPDATE t_admin_agent_adopt_draft SET request_id=?, source_state=0,"
                                + "recommendation=?, risk_level=?, rationale=?, missing_info=?, review_note=?,"
                                + "model=?, status='draft', version=version+1, updated_at=? WHERE id=? AND actor_id=?",
                        requestId, suggestion.getRecommendation(), suggestion.getRiskLevel(),
                        suggestion.getRationale(), suggestion.getMissingInfo(), suggestion.getReviewNote(),
                        model, now, current.getId(), actorId);
                return findOwned(actorId, current.getId());
            }
            KeyHolder key = new GeneratedKeyHolder();
            jdbcTemplate.update(connection -> {
                PreparedStatement statement = connection.prepareStatement(
                        "INSERT INTO t_admin_agent_adopt_draft "
                                + "(actor_id,animal_id,applicant_id,request_id,source_state,recommendation,"
                                + "risk_level,rationale,missing_info,review_note,model,status,version,created_at,updated_at) "
                                + "VALUES (?,?,?,?,0,?,?,?,?,?,?,'draft',1,?,?)", Statement.RETURN_GENERATED_KEYS);
                statement.setLong(1, actorId); statement.setLong(2, animalId); statement.setLong(3, applicantId);
                statement.setString(4, requestId); statement.setString(5, suggestion.getRecommendation());
                statement.setString(6, suggestion.getRiskLevel()); statement.setString(7, suggestion.getRationale());
                statement.setString(8, suggestion.getMissingInfo()); statement.setString(9, suggestion.getReviewNote());
                statement.setString(10, model); statement.setTimestamp(11, now); statement.setTimestamp(12, now);
                return statement;
            }, key);
            if (key.getKey() == null) throw new CustomException("500", "审核草稿保存失败");
            return findOwned(actorId, key.getKey().longValue());
        } catch (DuplicateKeyException duplicate) {
            DraftItem existing = findByRequestId(actorId, requestId);
            if (existing != null) return existing;
            throw new CustomException("409", "审核草稿已被其他请求更新，请重新打开");
        }
    }

    public DraftItem updateOwned(Long actorId, Long id, long expectedVersion, String recommendation,
                                 String riskLevel, String rationale, String missingInfo, String reviewNote) {
        int changed = jdbcTemplate.update("UPDATE t_admin_agent_adopt_draft SET recommendation=?,risk_level=?,"
                        + "rationale=?,missing_info=?,review_note=?,version=version+1,updated_at=? "
                        + "WHERE id=? AND actor_id=? AND status='draft' AND version=?",
                recommendation, riskLevel, rationale, missingInfo, reviewNote,
                new Timestamp(System.currentTimeMillis()), id, actorId, expectedVersion);
        if (changed == 0) {
            DraftItem current = findOwned(actorId, id);
            if (!"draft".equals(current.getStatus())) throw new CustomException("409", "该草稿已执行或丢弃，不能继续编辑");
            throw new CustomException("409", "草稿已在其他页面更新，请重新打开后再保存");
        }
        return findOwned(actorId, id);
    }

    public boolean discardOwned(Long actorId, Long id, long expectedVersion) {
        int changed = jdbcTemplate.update("UPDATE t_admin_agent_adopt_draft SET status='discarded',"
                        + "version=version+1,updated_at=? WHERE id=? AND actor_id=? AND status='draft' AND version=?",
                new Timestamp(System.currentTimeMillis()), id, actorId, expectedVersion);
        if (changed == 0) {
            findOwned(actorId, id);
            throw new CustomException("409", "草稿已更新或丢弃，请刷新后重试");
        }
        return true;
    }

    public DraftItem markFinalized(Long actorId, Long id, long expectedVersion,
                                   String finalRequestId, String finalDecision,
                                   String overrideReason) {
        Timestamp now = new Timestamp(System.currentTimeMillis());
        try {
            int changed = jdbcTemplate.update("UPDATE t_admin_agent_adopt_draft SET status='executed',"
                            + "final_request_id=?,final_decision=?,override_reason=?,finalized_at=?,"
                            + "version=version+1,updated_at=? WHERE id=? AND actor_id=? AND status='draft' AND version=?",
                    finalRequestId, finalDecision, overrideReason, now, now,
                    id, actorId, expectedVersion);
            if (changed == 0) {
                DraftItem current = findOwned(actorId, id);
                if ("executed".equals(current.getStatus())) {
                    throw new CustomException("409", "该草稿已经执行，请刷新列表");
                }
                throw new CustomException("409", "草稿已在其他页面更新，请重新打开后再确认");
            }
            return findOwned(actorId, id);
        } catch (DuplicateKeyException duplicate) {
            throw new CustomException("409", "执行请求号冲突，请刷新后重试");
        }
    }

    private String baseSelect() {
        return "SELECT id,actor_id,animal_id,applicant_id,request_id,source_state,recommendation,"
                + "risk_level,rationale,missing_info,review_note,model,status,version,final_request_id,"
                + "final_decision,override_reason,finalized_at,created_at,updated_at "
                + "FROM t_admin_agent_adopt_draft";
    }

    private org.springframework.jdbc.core.RowMapper<DraftItem> mapper() {
        return (rs, i) -> new DraftItem(rs.getLong("id"), rs.getLong("actor_id"),
                rs.getLong("animal_id"), rs.getLong("applicant_id"), rs.getString("request_id"),
                rs.getInt("source_state"), rs.getString("recommendation"), rs.getString("risk_level"),
                rs.getString("rationale"), rs.getString("missing_info"), rs.getString("review_note"),
                rs.getString("model"), rs.getString("status"), rs.getLong("version"),
                rs.getString("final_request_id"), rs.getString("final_decision"),
                rs.getString("override_reason"), rs.getTimestamp("finalized_at"),
                rs.getTimestamp("created_at"), rs.getTimestamp("updated_at"));
    }

    public static final class DraftItem {
        @com.fasterxml.jackson.databind.annotation.JsonSerialize(using = com.fasterxml.jackson.databind.ser.std.ToStringSerializer.class)
        private final Long id;
        @com.fasterxml.jackson.databind.annotation.JsonSerialize(using = com.fasterxml.jackson.databind.ser.std.ToStringSerializer.class)
        private final Long actorId;
        @com.fasterxml.jackson.databind.annotation.JsonSerialize(using = com.fasterxml.jackson.databind.ser.std.ToStringSerializer.class)
        private final Long animalId;
        @com.fasterxml.jackson.databind.annotation.JsonSerialize(using = com.fasterxml.jackson.databind.ser.std.ToStringSerializer.class)
        private final Long applicantId;
        private final String requestId; private final int sourceState; private final String recommendation;
        private final String riskLevel; private final String rationale; private final String missingInfo;
        private final String reviewNote; private final String model; private final String status; private final long version;
        private final String finalRequestId; private final String finalDecision; private final String overrideReason;
        @com.fasterxml.jackson.annotation.JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss", timezone = "GMT+8")
        private final Date finalizedAt;
        @com.fasterxml.jackson.annotation.JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss", timezone = "GMT+8")
        private final Date createdAt;
        @com.fasterxml.jackson.annotation.JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss", timezone = "GMT+8")
        private final Date updatedAt;
        DraftItem(Long id, Long actorId, Long animalId, Long applicantId, String requestId, int sourceState,
                  String recommendation, String riskLevel, String rationale, String missingInfo, String reviewNote,
                  String model, String status, long version, String finalRequestId, String finalDecision,
                  String overrideReason, Date finalizedAt, Date createdAt, Date updatedAt) {
            this.id=id;this.actorId=actorId;this.animalId=animalId;this.applicantId=applicantId;
            this.requestId=requestId;this.sourceState=sourceState;this.recommendation=recommendation;
            this.riskLevel=riskLevel;this.rationale=rationale;this.missingInfo=missingInfo;
            this.reviewNote=reviewNote;this.model=model;this.status=status;this.version=version;
            this.finalRequestId=finalRequestId;this.finalDecision=finalDecision;this.overrideReason=overrideReason;
            this.finalizedAt=finalizedAt==null?null:new Date(finalizedAt.getTime());
            this.createdAt=createdAt==null?null:new Date(createdAt.getTime());
            this.updatedAt=updatedAt==null?null:new Date(updatedAt.getTime());
        }
        public Long getId(){return id;} @com.fasterxml.jackson.annotation.JsonIgnore public Long getActorId(){return actorId;} public Long getAnimalId(){return animalId;}
        public Long getApplicantId(){return applicantId;} @com.fasterxml.jackson.annotation.JsonIgnore public String getRequestId(){return requestId;}
        public int getSourceState(){return sourceState;} public String getRecommendation(){return recommendation;}
        public String getRiskLevel(){return riskLevel;} public String getRationale(){return rationale;}
        public String getMissingInfo(){return missingInfo;} public String getReviewNote(){return reviewNote;}
        public String getModel(){return model;} public String getStatus(){return status;} public long getVersion(){return version;}
        @com.fasterxml.jackson.annotation.JsonIgnore public String getFinalRequestId(){return finalRequestId;}
        public String getFinalDecision(){return finalDecision;} public String getOverrideReason(){return overrideReason;}
        public Date getFinalizedAt(){return finalizedAt==null?null:new Date(finalizedAt.getTime());}
        public Date getCreatedAt(){return createdAt==null?null:new Date(createdAt.getTime());}
        public Date getUpdatedAt(){return updatedAt==null?null:new Date(updatedAt.getTime());}
    }
}
