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

/** 3C 自动审核配置、运行批次与逐条证据。表中不保存联系方式或完整问卷。 */
@Repository
public class AdminAgentAutomationRepository {
    private final JdbcTemplate jdbcTemplate;

    public AdminAgentAutomationRepository(JdbcTemplate jdbcTemplate) { this.jdbcTemplate = jdbcTemplate; }

    public AutomationConfig config() {
        List<AutomationConfig> rows = jdbcTemplate.query(
                "SELECT enabled,mode,max_batch,version,updated_by,created_at,updated_at "
                        + "FROM t_admin_agent_automation_config WHERE id=1",
                (rs, i) -> new AutomationConfig(rs.getBoolean("enabled"), rs.getString("mode"),
                        rs.getInt("max_batch"), rs.getLong("version"), rs.getLong("updated_by"),
                        rs.getTimestamp("created_at"), rs.getTimestamp("updated_at")));
        if (rows.isEmpty()) throw new CustomException("503", "自动审核配置尚未初始化");
        return rows.get(0);
    }

    public AutomationConfig lockConfig() {
        List<AutomationConfig> rows = jdbcTemplate.query(
                "SELECT enabled,mode,max_batch,version,updated_by,created_at,updated_at "
                        + "FROM t_admin_agent_automation_config WHERE id=1 FOR UPDATE",
                (rs, i) -> new AutomationConfig(rs.getBoolean("enabled"), rs.getString("mode"),
                        rs.getInt("max_batch"), rs.getLong("version"), rs.getLong("updated_by"),
                        rs.getTimestamp("created_at"), rs.getTimestamp("updated_at")));
        if (rows.isEmpty()) throw new CustomException("503", "自动审核配置尚未初始化");
        return rows.get(0);
    }

    public AutomationConfig saveConfig(Long actorId, long expectedVersion, boolean enabled,
                                       String mode, int maxBatch) {
        Timestamp now = new Timestamp(System.currentTimeMillis());
        int changed = jdbcTemplate.update("UPDATE t_admin_agent_automation_config SET enabled=?,mode=?,"
                        + "max_batch=?,version=version+1,updated_by=?,updated_at=? WHERE id=1 AND version=?",
                enabled, mode, maxBatch, actorId, now, expectedVersion);
        if (changed != 1) throw new CustomException("409", "自动审核配置已被其他页面更新，请刷新后重试");
        return config();
    }

    public RunDetail findByRequestId(Long actorId, String requestId) {
        List<RunSummary> rows = jdbcTemplate.query(runSelect()
                        + " WHERE actor_id=? AND request_id=? LIMIT 1", runMapper(), actorId, requestId);
        return rows.isEmpty() ? null : detail(rows.get(0));
    }

    @Transactional
    public RunSummary beginRun(Long actorId, String requestId) {
        AutomationConfig locked = lockConfig();
        if (!locked.isEnabled()) throw new CustomException("409", "自动审核当前已停用");
        List<RunSummary> duplicate = jdbcTemplate.query(runSelect()
                        + " WHERE actor_id=? AND request_id=? LIMIT 1", runMapper(), actorId, requestId);
        if (!duplicate.isEmpty()) {
            if ("running".equals(duplicate.get(0).getStatus())) {
                throw new CustomException("409", "相同自动审核请求仍在处理中，请勿重复提交");
            }
            return duplicate.get(0);
        }
        Timestamp staleBefore = new Timestamp(System.currentTimeMillis() - 10 * 60 * 1000L);
        jdbcTemplate.update("UPDATE t_admin_agent_automation_run SET status='failed',detail='服务中断后由下一次运行回收',"
                + "completed_at=? WHERE status='running' AND started_at<?", new Timestamp(System.currentTimeMillis()), staleBefore);
        Integer running = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM t_admin_agent_automation_run WHERE status='running'", Integer.class);
        if (running != null && running > 0) throw new CustomException("409", "已有自动审核批次正在运行，请稍后再试");
        KeyHolder key = new GeneratedKeyHolder();
        Timestamp now = new Timestamp(System.currentTimeMillis());
        try {
            jdbcTemplate.update(connection -> {
                PreparedStatement statement = connection.prepareStatement(
                        "INSERT INTO t_admin_agent_automation_run "
                                + "(actor_id,request_id,mode,status,candidate_count,shadow_count,auto_approved_count,"
                                + "manual_count,failed_count,detail,started_at) VALUES (?,?,?,'running',0,0,0,0,0,'',?)",
                        Statement.RETURN_GENERATED_KEYS);
                statement.setLong(1, actorId); statement.setString(2, requestId);
                statement.setString(3, locked.getMode()); statement.setTimestamp(4, now);
                return statement;
            }, key);
        } catch (DuplicateKeyException duplicateKey) {
            RunDetail existing = findByRequestId(actorId, requestId);
            if (existing != null && "running".equals(existing.getRun().getStatus())) {
                throw new CustomException("409", "相同自动审核请求仍在处理中，请勿重复提交");
            }
            if (existing != null) return existing.getRun();
            throw new CustomException("409", "运行请求号冲突，请刷新后重试");
        }
        if (key.getKey() == null) throw new CustomException("500", "自动审核批次创建失败");
        return run(key.getKey().longValue());
    }

    public void saveItem(Long runId, Long animalId, Long applicantId,
                         AdminAgentClient.AdoptionDraftSuggestion suggestion,
                         boolean hardGatePass, String outcome, String reason) {
        jdbcTemplate.update("INSERT INTO t_admin_agent_automation_item "
                        + "(run_id,animal_id,applicant_id,recommendation,risk_level,hard_gate_pass,"
                        + "missing_info,rationale,outcome,reason,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                runId, animalId, applicantId,
                suggestion == null ? "" : safe(suggestion.getRecommendation(), 24),
                suggestion == null ? "" : safe(suggestion.getRiskLevel(), 12), hardGatePass,
                suggestion == null ? "" : safe(suggestion.getMissingInfo(), 800),
                suggestion == null ? "" : safe(suggestion.getRationale(), 1200),
                safe(outcome, 24), safe(reason, 500), new Timestamp(System.currentTimeMillis()));
    }

    public void completeRun(Long id, String status, int candidateCount, int shadowCount,
                            int autoApprovedCount, int manualCount, int failedCount, String detail) {
        int changed = jdbcTemplate.update("UPDATE t_admin_agent_automation_run SET status=?,candidate_count=?,"
                        + "shadow_count=?,auto_approved_count=?,manual_count=?,failed_count=?,detail=?,completed_at=? "
                        + "WHERE id=? AND status='running'", status, candidateCount, shadowCount,
                autoApprovedCount, manualCount, failedCount, safe(detail, 1000),
                new Timestamp(System.currentTimeMillis()), id);
        if (changed != 1) throw new CustomException("409", "自动审核批次状态已变化");
    }

    public RunSummary run(Long id) {
        List<RunSummary> rows = jdbcTemplate.query(runSelect() + " WHERE id=? LIMIT 1", runMapper(), id);
        if (rows.isEmpty()) throw new CustomException("404", "自动审核批次不存在");
        return rows.get(0);
    }

    public RunDetail detail(Long id) { return detail(run(id)); }

    private RunDetail detail(RunSummary run) {
        List<RunItem> items = jdbcTemplate.query(
                "SELECT id,run_id,animal_id,applicant_id,recommendation,risk_level,hard_gate_pass,"
                        + "missing_info,rationale,outcome,reason,created_at FROM t_admin_agent_automation_item "
                        + "WHERE run_id=? ORDER BY id", (rs, i) -> new RunItem(rs.getLong("id"),
                        rs.getLong("run_id"), rs.getLong("animal_id"), rs.getLong("applicant_id"),
                        rs.getString("recommendation"), rs.getString("risk_level"),
                        rs.getBoolean("hard_gate_pass"), rs.getString("missing_info"),
                        rs.getString("rationale"), rs.getString("outcome"), rs.getString("reason"),
                        rs.getTimestamp("created_at")), run.getId());
        return new RunDetail(run, items);
    }

    public List<RunSummary> recentRuns(int limit) {
        int safeLimit = Math.max(1, Math.min(limit, 20));
        return jdbcTemplate.query(runSelect() + " ORDER BY id DESC LIMIT " + safeLimit, runMapper());
    }

    private String runSelect() {
        return "SELECT id,actor_id,request_id,mode,status,candidate_count,shadow_count,auto_approved_count,"
                + "manual_count,failed_count,detail,started_at,completed_at FROM t_admin_agent_automation_run";
    }

    private org.springframework.jdbc.core.RowMapper<RunSummary> runMapper() {
        return (rs, i) -> new RunSummary(rs.getLong("id"), rs.getLong("actor_id"),
                rs.getString("request_id"), rs.getString("mode"), rs.getString("status"),
                rs.getInt("candidate_count"), rs.getInt("shadow_count"),
                rs.getInt("auto_approved_count"), rs.getInt("manual_count"), rs.getInt("failed_count"),
                rs.getString("detail"), rs.getTimestamp("started_at"), rs.getTimestamp("completed_at"));
    }

    private static String safe(String value, int max) {
        String result = value == null ? "" : value.trim().replaceAll("[\\r\\n\\t]+", " ");
        return result.length() <= max ? result : result.substring(0, max);
    }

    public static final class AutomationConfig {
        private final boolean enabled; private final String mode; private final int maxBatch; private final long version;
        private final Long updatedBy; private final Date createdAt; private final Date updatedAt;
        AutomationConfig(boolean enabled, String mode, int maxBatch, long version, Long updatedBy, Date createdAt, Date updatedAt) {
            this.enabled=enabled;this.mode=mode;this.maxBatch=maxBatch;this.version=version;this.updatedBy=updatedBy;
            this.createdAt=copy(createdAt);this.updatedAt=copy(updatedAt);
        }
        public boolean isEnabled(){return enabled;} public String getMode(){return mode;} public int getMaxBatch(){return maxBatch;}
        public long getVersion(){return version;} public Long getUpdatedBy(){return updatedBy;}
        public Date getCreatedAt(){return copy(createdAt);} public Date getUpdatedAt(){return copy(updatedAt);}
    }

    public static final class RunSummary {
        @com.fasterxml.jackson.databind.annotation.JsonSerialize(using=com.fasterxml.jackson.databind.ser.std.ToStringSerializer.class)
        private final Long id;
        @com.fasterxml.jackson.annotation.JsonIgnore private final Long actorId;
        @com.fasterxml.jackson.annotation.JsonIgnore private final String requestId;
        private final String mode; private final String status; private final int candidateCount; private final int shadowCount;
        private final int autoApprovedCount; private final int manualCount; private final int failedCount; private final String detail;
        @com.fasterxml.jackson.annotation.JsonFormat(pattern="yyyy-MM-dd HH:mm:ss",timezone="GMT+8") private final Date startedAt;
        @com.fasterxml.jackson.annotation.JsonFormat(pattern="yyyy-MM-dd HH:mm:ss",timezone="GMT+8") private final Date completedAt;
        RunSummary(Long id,Long actorId,String requestId,String mode,String status,int candidateCount,int shadowCount,
                   int autoApprovedCount,int manualCount,int failedCount,String detail,Date startedAt,Date completedAt){
            this.id=id;this.actorId=actorId;this.requestId=requestId;this.mode=mode;this.status=status;
            this.candidateCount=candidateCount;this.shadowCount=shadowCount;this.autoApprovedCount=autoApprovedCount;
            this.manualCount=manualCount;this.failedCount=failedCount;this.detail=detail;
            this.startedAt=copy(startedAt);this.completedAt=copy(completedAt);
        }
        public Long getId(){return id;} public Long getActorId(){return actorId;} public String getRequestId(){return requestId;}
        public String getMode(){return mode;} public String getStatus(){return status;} public int getCandidateCount(){return candidateCount;}
        public int getShadowCount(){return shadowCount;} public int getAutoApprovedCount(){return autoApprovedCount;}
        public int getManualCount(){return manualCount;} public int getFailedCount(){return failedCount;} public String getDetail(){return detail;}
        public Date getStartedAt(){return copy(startedAt);} public Date getCompletedAt(){return copy(completedAt);}
    }

    public static final class RunItem {
        @com.fasterxml.jackson.databind.annotation.JsonSerialize(using=com.fasterxml.jackson.databind.ser.std.ToStringSerializer.class)
        private final Long id;
        @com.fasterxml.jackson.annotation.JsonIgnore private final Long runId;
        @com.fasterxml.jackson.databind.annotation.JsonSerialize(using=com.fasterxml.jackson.databind.ser.std.ToStringSerializer.class)
        private final Long animalId;
        @com.fasterxml.jackson.databind.annotation.JsonSerialize(using=com.fasterxml.jackson.databind.ser.std.ToStringSerializer.class)
        private final Long applicantId;
        private final String recommendation;private final String riskLevel;private final boolean hardGatePass;
        private final String missingInfo;private final String rationale;private final String outcome;private final String reason;
        @com.fasterxml.jackson.annotation.JsonFormat(pattern="yyyy-MM-dd HH:mm:ss",timezone="GMT+8") private final Date createdAt;
        RunItem(Long id,Long runId,Long animalId,Long applicantId,String recommendation,String riskLevel,
                boolean hardGatePass,String missingInfo,String rationale,String outcome,String reason,Date createdAt){
            this.id=id;this.runId=runId;this.animalId=animalId;this.applicantId=applicantId;
            this.recommendation=recommendation;this.riskLevel=riskLevel;this.hardGatePass=hardGatePass;
            this.missingInfo=missingInfo;this.rationale=rationale;this.outcome=outcome;this.reason=reason;this.createdAt=copy(createdAt);
        }
        public Long getId(){return id;} public Long getRunId(){return runId;} public Long getAnimalId(){return animalId;}
        public Long getApplicantId(){return applicantId;} public String getRecommendation(){return recommendation;}
        public String getRiskLevel(){return riskLevel;} public boolean isHardGatePass(){return hardGatePass;}
        public String getMissingInfo(){return missingInfo;} public String getRationale(){return rationale;}
        public String getOutcome(){return outcome;} public String getReason(){return reason;} public Date getCreatedAt(){return copy(createdAt);}
    }

    public static final class RunDetail {
        private final RunSummary run; private final List<RunItem> items;
        RunDetail(RunSummary run,List<RunItem> items){this.run=run;this.items=List.copyOf(items);}
        public RunSummary getRun(){return run;} public List<RunItem> getItems(){return items;}
    }

    private static Date copy(Date value){return value==null?null:new Date(value.getTime());}
}
