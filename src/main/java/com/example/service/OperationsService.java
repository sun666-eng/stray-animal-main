package com.example.service;

import com.example.exception.CustomException;
import com.example.entity.User;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.jdbc.support.KeyHolder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.sql.PreparedStatement;
import java.sql.Statement;
import java.sql.Timestamp;
import java.time.LocalDateTime;
import java.time.format.DateTimeParseException;
import java.util.Collections;
import java.util.Date;
import java.util.List;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;

/**
 * P1/P2 运营闭环。写操作全部在服务层完成权限之外的所有权、状态、容量和幂等校验。
 */
@Service
public class OperationsService {
    private final JdbcTemplate jdbc;
    private final NotificationService notifications;
    private final WorkflowEventService workflow;
    private final WorkItemRefreshService workItemRefresh;
    private final FileAssetService fileAssets;

    public OperationsService(JdbcTemplate jdbc, NotificationService notifications,
                             WorkflowEventService workflow, WorkItemRefreshService workItemRefresh,
                             FileAssetService fileAssets) {
        this.jdbc = jdbc;
        this.notifications = notifications;
        this.workflow = workflow;
        this.workItemRefresh = workItemRefresh;
        this.fileAssets = fileAssets;
    }

    public List<Map<String, Object>> volunteerTasks(Long userId, boolean mine) {
        String where = mine ? "s.user_id=?" : "t.status=1";
        String sql = "SELECT t.id,t.title,t.description,t.location,t.start_at,t.end_at,t.capacity,t.status,"
                + "t.creator_id,t.created_at,t.version,"
                + "(SELECT COUNT(*) FROM t_volunteer_signup x WHERE x.task_id=t.id AND x.status IN (0,1,2)) signup_count,"
                + "s.id signup_id,s.status signup_status,s.note signup_note "
                + "FROM t_volunteer_task t LEFT JOIN t_volunteer_signup s ON s.task_id=t.id AND s.user_id=? "
                + "WHERE " + where + " ORDER BY t.start_at ASC,t.id DESC LIMIT 200";
        if (mine) return jdbc.queryForList(sql, userId, userId);
        return jdbc.queryForList(sql, userId);
    }

    public List<Map<String, Object>> adminVolunteerTasks() {
        return jdbc.queryForList("SELECT t.id,t.title,t.description,t.location,t.start_at,t.end_at,t.capacity,t.status,"
                + "t.creator_id,t.created_at,t.version,"
                + "(SELECT COUNT(*) FROM t_volunteer_signup x WHERE x.task_id=t.id AND x.status IN (0,1,2)) signup_count "
                + "FROM t_volunteer_task t ORDER BY t.created_at DESC,t.id DESC LIMIT 500");
    }

    public List<Map<String, Object>> taskSignups(Long taskId) {
        requirePositive(taskId, "任务编号");
        return jdbc.queryForList("SELECT s.id,s.task_id,s.user_id,u.username,u.phone,u.email,s.status,s.note,"
                + "s.assigned_by,s.assigned_at,s.created_at,s.version,r.service_minutes,r.summary,r.completed_at "
                + "FROM t_volunteer_signup s JOIN t_user u ON u.id=s.user_id "
                + "LEFT JOIN t_volunteer_service_record r ON r.signup_id=s.id WHERE s.task_id=? "
                + "ORDER BY s.status,s.created_at,s.id LIMIT 500", taskId);
    }

    @Transactional
    public Long createVolunteerTask(Long actorId, Map<String, Object> body) {
        String title = required(body.get("title"), 120, "任务标题");
        String description = optional(body.get("description"), 2000);
        String location = optional(body.get("location"), 255);
        Timestamp start = timestamp(body.get("startAt"), "开始时间");
        Timestamp end = timestamp(body.get("endAt"), "结束时间");
        if (!end.after(start)) throw new CustomException("400", "结束时间必须晚于开始时间");
        int capacity = integer(body.get("capacity"), 1, 500, "招募人数");
        int status = integer(body.get("status"), 0, 1, "任务状态");
        Long id = insert("INSERT INTO t_volunteer_task(title,description,location,start_at,end_at,capacity,status,creator_id) "
                        + "VALUES(?,?,?,?,?,?,?,?)",
                title, description, location, start, end, capacity, status, actorId);
        workflow.record("volunteer_task", String.valueOf(id), null, status, "CREATE",
                actorId, "admin", description, null, null);
        return id;
    }

    @Transactional
    public boolean setVolunteerTaskStatus(Long actorId, Long taskId, int target, int expectedVersion) {
        if (target < 0 || target > 3) throw new CustomException("400", "任务状态无效");
        Map<String, Object> task = lockOne("SELECT id,status,version,start_at FROM t_volunteer_task WHERE id=? FOR UPDATE", taskId);
        int current = number(task.get("status"));
        int version = number(task.get("version"));
        if (current == target) return true;
        if (version != expectedVersion) throw new CustomException("409", "任务已被其他管理员更新，请刷新后重试");
        if (current == 3) throw new CustomException("409", "已取消任务不可恢复");
        if (current == 2 && target != 3) throw new CustomException("409", "已关闭任务只能取消归档");
        int updated = jdbc.update("UPDATE t_volunteer_task SET status=?,version=version+1 WHERE id=? AND version=?",
                target, taskId, expectedVersion);
        if (updated != 1) throw new CustomException("409", "任务状态更新冲突");
        workflow.record("volunteer_task", String.valueOf(taskId), current, target, "STATUS",
                actorId, "admin", null, null, null);
        return true;
    }

    @Transactional
    public Long signupVolunteerTask(Long userId, Long taskId, String note) {
        requireApprovedVolunteer(userId);
        Map<String, Object> task = lockOne("SELECT id,title,status,start_at,capacity FROM t_volunteer_task WHERE id=? FOR UPDATE", taskId);
        if (number(task.get("status")) != 1) throw new CustomException("409", "该任务当前不可报名");
        if (isPast(task.get("start_at"))) {
            throw new CustomException("409", "任务已经开始，不能再报名");
        }
        List<Map<String, Object>> existing = jdbc.queryForList(
                "SELECT id,status FROM t_volunteer_signup WHERE task_id=? AND user_id=? FOR UPDATE", taskId, userId);
        if (!existing.isEmpty()) {
            int status = number(existing.get(0).get("status"));
            if (status == 3 || status == 4) {
                jdbc.update("UPDATE t_volunteer_signup SET status=0,note=?,version=version+1 WHERE id=?",
                        optional(note, 500), existing.get(0).get("id"));
            }
            return ((Number) existing.get(0).get("id")).longValue();
        }
        long active = jdbc.queryForObject(
                "SELECT COUNT(*) FROM t_volunteer_signup WHERE task_id=? AND status IN (0,1,2)", Long.class, taskId);
        if (active >= number(task.get("capacity"))) throw new CustomException("409", "报名名额已满");
        Long id;
        try {
            id = insert("INSERT INTO t_volunteer_signup(task_id,user_id,status,note) VALUES(?,?,0,?)",
                    taskId, userId, optional(note, 500));
        } catch (DuplicateKeyException e) {
            id = jdbc.queryForObject("SELECT id FROM t_volunteer_signup WHERE task_id=? AND user_id=?", Long.class, taskId, userId);
        }
        workflow.record("volunteer_signup", String.valueOf(id), null, 0, "SIGNUP",
                userId, "user", note, null, "{\"taskId\":" + taskId + "}");
        return id;
    }

    @Transactional
    public boolean withdrawSignup(Long userId, Long taskId) {
        Map<String, Object> row = lockOne(
                "SELECT s.id,s.status,t.start_at FROM t_volunteer_signup s JOIN t_volunteer_task t ON t.id=s.task_id "
                        + "WHERE s.task_id=? AND s.user_id=? FOR UPDATE", taskId, userId);
        int current = number(row.get("status"));
        if (current == 3) return true;
        if (current == 2) throw new CustomException("409", "服务已完成，不能撤回");
        if (isPast(row.get("start_at"))) {
            throw new CustomException("409", "任务已开始，请联系管理员处理");
        }
        jdbc.update("UPDATE t_volunteer_signup SET status=3,version=version+1 WHERE id=?", row.get("id"));
        workflow.record("volunteer_signup", String.valueOf(row.get("id")), current, 3, "WITHDRAW",
                userId, "user", null, null, null);
        return true;
    }

    @Transactional
    public boolean assignSignup(Long actorId, Long signupId, boolean accepted, int expectedVersion) {
        Map<String, Object> row = lockOne("SELECT s.id,s.task_id,s.user_id,s.status,s.version,t.capacity,t.title,t.status task_status "
                + "FROM t_volunteer_signup s JOIN t_volunteer_task t ON t.id=s.task_id WHERE s.id=? FOR UPDATE", signupId);
        int current = number(row.get("status"));
        int target = accepted ? 1 : 4;
        if (current == target) return true;
        if (number(row.get("version")) != expectedVersion) throw new CustomException("409", "报名记录已变化，请刷新后重试");
        if (current != 0) throw new CustomException("409", "只有待确认报名可以审核");
        if (accepted) {
            if (number(row.get("task_status")) != 1) throw new CustomException("409", "任务已停止招募");
            long acceptedCount = jdbc.queryForObject(
                    "SELECT COUNT(*) FROM t_volunteer_signup WHERE task_id=? AND status IN (1,2)", Long.class, row.get("task_id"));
            if (acceptedCount >= number(row.get("capacity"))) throw new CustomException("409", "任务指派人数已满");
        }
        int updated = jdbc.update("UPDATE t_volunteer_signup SET status=?,assigned_by=?,assigned_at=CURRENT_TIMESTAMP(3),version=version+1 "
                + "WHERE id=? AND version=?", target, actorId, signupId, expectedVersion);
        if (updated != 1) throw new CustomException("409", "报名审核冲突");
        Long userId = ((Number) row.get("user_id")).longValue();
        notifications.notifyOnce(userId, "volunteer_task", accepted ? "义工任务已确认" : "义工任务报名未通过",
                String.valueOf(row.get("title")), "volunteer_task", String.valueOf(row.get("task_id")),
                "/page/front/volunteer_tasks.html", "volunteer-signup-" + signupId + "-" + target);
        workflow.record("volunteer_signup", String.valueOf(signupId), current, target,
                accepted ? "ASSIGN" : "REJECT", actorId, "admin", null, null, null);
        return true;
    }

    @Transactional
    public boolean completeSignup(Long actorId, Long signupId, int expectedVersion,
                                  int serviceMinutes, String summary) {
        if (serviceMinutes < 1 || serviceMinutes > 24 * 60 * 30) throw new CustomException("400", "服务时长无效");
        Map<String, Object> row = lockOne("SELECT s.id,s.task_id,s.user_id,s.status,s.version,t.title FROM t_volunteer_signup s "
                + "JOIN t_volunteer_task t ON t.id=s.task_id WHERE s.id=? FOR UPDATE", signupId);
        int current = number(row.get("status"));
        if (current == 2) return true;
        if (current != 1) throw new CustomException("409", "只有已指派任务可以登记完成");
        if (number(row.get("version")) != expectedVersion) throw new CustomException("409", "报名记录已变化，请刷新后重试");
        int updated = jdbc.update("UPDATE t_volunteer_signup SET status=2,version=version+1 WHERE id=? AND version=?",
                signupId, expectedVersion);
        if (updated != 1) throw new CustomException("409", "服务登记冲突");
        try {
            jdbc.update("INSERT INTO t_volunteer_service_record(signup_id,task_id,user_id,service_minutes,summary,confirmed_by,completed_at) "
                    + "VALUES(?,?,?,?,?,?,CURRENT_TIMESTAMP(3))", signupId, row.get("task_id"), row.get("user_id"),
                    serviceMinutes, optional(summary, 1000), actorId);
        } catch (DuplicateKeyException ignored) {
            // 完成请求重试保持同一服务记录。
        }
        Long userId = ((Number) row.get("user_id")).longValue();
        notifications.notifyOnce(userId, "volunteer_task", "义工服务记录已确认",
                String.valueOf(row.get("title")) + " · " + serviceMinutes + " 分钟", "volunteer_task",
                String.valueOf(row.get("task_id")), "/page/front/volunteer_tasks.html",
                "volunteer-service-" + signupId);
        workflow.record("volunteer_signup", String.valueOf(signupId), current, 2, "COMPLETE",
                actorId, "admin", summary, null, "{\"minutes\":" + serviceMinutes + "}");
        return true;
    }

    public List<Map<String, Object>> medicalRecords(Long animalId, Long viewerId, boolean manager) {
        requirePositive(animalId, "动物编号");
        boolean owner = viewerId != null && Boolean.TRUE.equals(jdbc.queryForObject(
                "SELECT EXISTS(SELECT 1 FROM t_adopt WHERE aid=? AND uid=? AND vstate=4)", Boolean.class, animalId, viewerId));
        String visibility = manager ? "" : owner ? " AND visibility IN ('public','owner')" : " AND visibility='public'";
        return jdbc.queryForList("SELECT id,animal_id,record_type,title,content,occurred_at,visibility,asset_flag,created_at "
                + "FROM t_animal_medical_record WHERE animal_id=?" + visibility + " ORDER BY occurred_at DESC,id DESC LIMIT 200", animalId);
    }

    @Transactional
    public Long createMedicalRecord(User actor, Long animalId, Map<String, Object> body) {
        requirePositive(animalId, "动物编号");
        if (actor == null || actor.getId() == null) throw new CustomException("401", "登录状态无效");
        long exists = jdbc.queryForObject("SELECT COUNT(*) FROM t_animal WHERE id=?", Long.class, animalId);
        if (exists != 1) throw new CustomException("404", "动物档案不存在");
        String type = enumValue(body.get("recordType"), new String[]{"exam", "vaccine", "deworm", "treatment", "surgery", "other"}, "记录类型");
        String title = required(body.get("title"), 120, "记录标题");
        String content = optional(body.get("content"), 2000);
        String visibility = enumValue(body.get("visibility"), new String[]{"public", "owner", "admin"}, "可见范围");
        String assetFlag = optional(body.get("assetFlag"), 64);
        Timestamp occurredAt = timestamp(body.get("occurredAt"), "发生时间");
        Long id = insert("INSERT INTO t_animal_medical_record(animal_id,record_type,title,content,occurred_at,visibility,asset_flag,created_by) "
                        + "VALUES(?,?,?,?,?,?,?,?)", animalId, type, title, content, occurredAt, visibility,
                assetFlag, actor.getId());
        if (assetFlag != null) {
            fileAssets.bindMedicalRecord(actor, assetFlag, id, visibility);
        }
        workflow.record("animal_medical", String.valueOf(id), null, 1, "CREATE",
                actor.getId(), "admin", title, null, "{\"animalId\":" + animalId + "}");
        return id;
    }

    public List<Map<String, Object>> workItems(boolean includeClosed) {
        workItemRefresh.refresh();
        return queryWorkItems(includeClosed);
    }

    public Map<String, Object> workDashboard(boolean includeClosed) {
        workItemRefresh.refresh();
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("items", queryWorkItems(includeClosed));
        result.put("summary", queryWorkSummary());
        return result;
    }

    private List<Map<String, Object>> queryWorkItems(boolean includeClosed) {
        return jdbc.queryForList("SELECT w.id,w.business_type,w.business_id,w.title,w.priority,w.assignee_id,u.username assignee_name,"
                + "w.due_at,w.status,w.created_at,w.updated_at,w.completed_at,w.version FROM t_work_item w "
                + "LEFT JOIN t_user u ON u.id=w.assignee_id WHERE (?=1 OR w.status<>2) "
                + "ORDER BY w.status, w.priority DESC, COALESCE(w.due_at,'2999-12-31'),w.id DESC LIMIT 500", includeClosed ? 1 : 0);
    }

    @Transactional
    public boolean updateWorkItem(Long actorId, Long id, Map<String, Object> body) {
        Map<String, Object> row = lockOne("SELECT id,status,version,business_type,business_id FROM t_work_item WHERE id=? FOR UPDATE", id);
        int expected = integer(body.get("expectedVersion"), 0, Integer.MAX_VALUE, "版本");
        if (number(row.get("version")) != expected) throw new CustomException("409", "待办已被其他管理员更新，请刷新后重试");
        int status = integer(body.get("status"), 0, 2, "待办状态");
        int priority = integer(body.get("priority"), 0, 3, "优先级");
        Long assignee = nullableLong(body.get("assigneeId"));
        if (assignee != null && !assignee.equals(actorId)) {
            throw new CustomException("403", "当前阶段仅支持管理员领取给自己，不能代替他人领取");
        }
        int updated = jdbc.update("UPDATE t_work_item SET status=?,priority=?,assignee_id=?,completed_at=IF(?=2,CURRENT_TIMESTAMP(3),NULL),"
                + "version=version+1 WHERE id=? AND version=?", status, priority, assignee, status, id, expected);
        if (updated != 1) throw new CustomException("409", "待办更新冲突");
        workflow.record("work_item", String.valueOf(id), number(row.get("status")), status, "UPDATE",
                actorId, "admin", null, null, null);
        return true;
    }

    public Map<String, Object> workSummary() {
        workItemRefresh.refresh();
        return queryWorkSummary();
    }

    private Map<String, Object> queryWorkSummary() {
        List<Map<String, Object>> rows = jdbc.queryForList("SELECT business_type,COUNT(*) total,"
                + "SUM(CASE WHEN priority>=2 THEN 1 ELSE 0 END) urgent FROM t_work_item WHERE status<>2 GROUP BY business_type");
        long open = jdbc.queryForObject("SELECT COUNT(*) FROM t_work_item WHERE status<>2", Long.class);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("open", open);
        result.put("groups", rows);
        return result;
    }

    public List<Map<String, Object>> favorites(Long userId) {
        return jdbc.queryForList("SELECT f.id favorite_id,f.created_at,a.id,a.tname,a.ttype,a.tsex,a.tbirthday,a.tpic,a.tstate,a.tdescribe "
                + "FROM t_animal_favorite f JOIN t_animal a ON a.id=f.animal_id WHERE f.user_id=? "
                + "ORDER BY f.created_at DESC,f.id DESC LIMIT 200", userId);
    }

    public boolean isFavorite(Long userId, Long animalId) {
        return jdbc.queryForObject("SELECT EXISTS(SELECT 1 FROM t_animal_favorite WHERE user_id=? AND animal_id=?)",
                Boolean.class, userId, animalId);
    }

    @Transactional
    public boolean addFavorite(Long userId, Long animalId) {
        requirePositive(animalId, "动物编号");
        long available = jdbc.queryForObject("SELECT COUNT(*) FROM t_animal WHERE id=? AND tstate IN (0,1)", Long.class, animalId);
        if (available != 1) throw new CustomException("404", "动物档案不存在或暂不可收藏");
        try {
            jdbc.update("INSERT INTO t_animal_favorite(user_id,animal_id) VALUES(?,?)", userId, animalId);
        } catch (DuplicateKeyException ignored) {
            // 重复收藏幂等。
        }
        return true;
    }

    public boolean removeFavorite(Long userId, Long animalId) {
        jdbc.update("DELETE FROM t_animal_favorite WHERE user_id=? AND animal_id=?", userId, animalId);
        return true;
    }

    private void requireApprovedVolunteer(Long userId) {
        long count = jdbc.queryForObject("SELECT COUNT(*) FROM t_volunteer WHERE uid=? AND vstate=1", Long.class, userId);
        if (count < 1) throw new CustomException("403", "仅审核通过的义工可以报名任务");
    }

    private Map<String, Object> lockOne(String sql, Object... args) {
        List<Map<String, Object>> rows = jdbc.queryForList(sql, args);
        if (rows.isEmpty()) throw new CustomException("404", "业务记录不存在");
        return rows.get(0);
    }

    private Long insert(String sql, Object... args) {
        KeyHolder holder = new GeneratedKeyHolder();
        jdbc.update(connection -> {
            PreparedStatement statement = connection.prepareStatement(sql, Statement.RETURN_GENERATED_KEYS);
            for (int i = 0; i < args.length; i++) statement.setObject(i + 1, args[i]);
            return statement;
        }, holder);
        Number key = holder.getKey();
        if (key == null) throw new CustomException("500", "业务记录创建失败");
        return key.longValue();
    }

    private String required(Object value, int max, String field) {
        String text = optional(value, max);
        if (text == null) throw new CustomException("400", field + "不能为空");
        return text;
    }

    private String optional(Object value, int max) {
        if (value == null) return null;
        String text = String.valueOf(value).trim();
        if (text.isEmpty()) return null;
        if (text.length() > max) throw new CustomException("400", "字段内容不能超过" + max + "个字符");
        return text;
    }

    private Timestamp timestamp(Object value, String field) {
        String text = required(value, 40, field).replace(' ', 'T');
        try {
            return Timestamp.valueOf(LocalDateTime.parse(text));
        } catch (DateTimeParseException e) {
            throw new CustomException("400", field + "格式应为 yyyy-MM-ddTHH:mm:ss");
        }
    }

    private int integer(Object value, int min, int max, String field) {
        try {
            int number = value instanceof Number ? ((Number) value).intValue() : Integer.parseInt(String.valueOf(value));
            if (number < min || number > max) throw new NumberFormatException();
            return number;
        } catch (RuntimeException e) {
            throw new CustomException("400", field + "无效");
        }
    }

    private Long nullableLong(Object value) {
        if (value == null || String.valueOf(value).trim().isEmpty()) return null;
        try {
            long parsed = Long.parseLong(String.valueOf(value));
            return parsed > 0 ? parsed : null;
        } catch (NumberFormatException e) {
            throw new CustomException("400", "负责人编号无效");
        }
    }

    private String enumValue(Object value, String[] allowed, String field) {
        String text = required(value, 32, field).toLowerCase(Locale.ROOT);
        for (String item : allowed) if (item.equals(text)) return text;
        throw new CustomException("400", field + "无效");
    }

    private void requirePositive(Long value, String field) {
        if (value == null || value < 1) throw new CustomException("400", field + "无效");
    }

    private int number(Object value) {
        return value instanceof Number ? ((Number) value).intValue() : Integer.parseInt(String.valueOf(value));
    }

    private boolean isPast(Object value) {
        if (value == null) return false;
        if (value instanceof LocalDateTime) return ((LocalDateTime) value).isBefore(LocalDateTime.now());
        if (value instanceof Date) return ((Date) value).before(new Date());
        try {
            return LocalDateTime.parse(String.valueOf(value).replace(' ', 'T')).isBefore(LocalDateTime.now());
        } catch (RuntimeException ignored) {
            throw new CustomException("500", "任务时间数据格式异常");
        }
    }
}
