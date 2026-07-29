package com.example.component;

import com.example.common.RoleContracts;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.annotation.Order;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 数据库漂移防护：启动时对照「闭环契约」检查/补齐结构，并写入 schema 版本。
 * <p>
 * 契约版本见 {@link #SCHEMA_VERSION}。新环境只需导库后启动；漏跑历史增量 SQL 也会被自动修复。
 * <ul>
 *   <li>app.schema-guard.enabled=true（默认）</li>
 *   <li>app.schema-guard.auto-migrate=true（默认）自动 DDL</li>
 *   <li>app.schema-guard.fail-fast=true 时结构无法满足则拒绝启动</li>
 * </ul>
 */
@Slf4j
@Component
@Order(0)
public class SchemaGuardRunner implements ApplicationRunner {

    /** 结构契约版本：变更闭环必需列/角色时递增，并写入 app_schema_meta */
    public static final String SCHEMA_VERSION = "2026.07.29-workflow-operations-v11";

    private static final String FILE_FLAG_COLLATION = "utf8mb4_unicode_ci";

    private final JdbcTemplate jdbcTemplate;

    @Value("${app.schema-guard.enabled:true}")
    private boolean enabled;

    @Value("${app.schema-guard.fail-fast:false}")
    private boolean failFast;

    @Value("${app.schema-guard.auto-migrate:true}")
    private boolean autoMigrate;

    @Value("${spring.profiles.active:}")
    private String activeProfiles;

    public SchemaGuardRunner(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    @Override
    public void run(ApplicationArguments args) {
        if (!enabled) {
            log.info("SchemaGuard 已关闭 (app.schema-guard.enabled=false)");
            return;
        }
        log.info("SchemaGuard 开始，契约版本={}", SCHEMA_VERSION);
        List<String> errors = new ArrayList<>();
        try {
            ensureMetaTable();
            if (!autoMigrate && !tableExists("app_schema_meta")) {
                errors.add("缺少 app_schema_meta（生产 pure-check 禁止自动建表，请先执行 bootstrap 迁移）");
            }
            ensureCoreTables(errors);
            // 闭环必需列
            ensureColumn("t_proof", "pstatus",
                    "ALTER TABLE t_proof ADD COLUMN pstatus INT NOT NULL DEFAULT 0 COMMENT '0待审核 1已通过 2已驳回' AFTER ptitle",
                    errors);
            ensureColumn("t_volunteer", "uid",
                    "ALTER TABLE t_volunteer ADD COLUMN uid BIGINT NULL DEFAULT NULL COMMENT '申请用户ID' AFTER vstate",
                    errors);
            ensureColumn("t_volunteer", "apic",
                    "ALTER TABLE t_volunteer ADD COLUMN apic VARCHAR(255) NULL DEFAULT NULL COMMENT '本人免冠照文件flag' AFTER uid",
                    errors);
            ensureWorkflowClosureSchema(errors);
            // 业务实体常用列（防止旧库缺列）
            ensureColumnsPresent("t_adopt", Arrays.asList("aid", "uid", "vstate", "uname", "aname"), errors);
            ensureColumnsPresent("t_animal", Arrays.asList("id", "tname", "tstate", "tpic"), errors);
            ensureColumnsPresent("t_visit", Arrays.asList("id", "pet_id", "uid", "vtime", "state", "vname"), errors);
            ensureColumnsPresent("t_help", Arrays.asList("id", "uid", "title", "status"), errors);
            ensureColumnsPresent("t_user", Arrays.asList("id", "username", "password", "role"), errors);
            ensureColumnsPresent("t_role", Arrays.asList("id", "name", "permission"), errors);
            ensureColumnsPresent("t_proof", Arrays.asList("id", "paid", "puid", "ptitle", "ppic", "pstatus"), errors);
            ensureColumnsPresent("t_volunteer", Arrays.asList("id", "name", "vstate", "uid", "apic"), errors);

            ensureAccountDecimal(errors);
            ensureAnimalBirthdayNullable(errors);
            ensureVarcharCapacity("t_user", "username", 32,
                    "ALTER TABLE t_user MODIFY COLUMN username VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '用户名'",
                    errors);
            ensureVarcharCapacity("t_adopt", "uname", 255,
                    "ALTER TABLE t_adopt MODIFY COLUMN uname VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '用户姓名快照'",
                    errors);
            ensureVarcharCapacity("t_proof", "uname", 255,
                    "ALTER TABLE t_proof MODIFY COLUMN uname VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '用户姓名快照'",
                    errors);

            ensureFileAssetTable(errors);
            ensureFileReferenceCollations(errors);
            ensureLegacyAvatarPlaceholderRemoved(errors);
            ensureFileAssetReferences(errors);

            ensureTextColumn("t_role", "permission", errors);
            ensureTextColumn("t_user", "role", errors);
            ensureRolePermissionTable(errors);
            ensureHelpChatIndexes(errors);
            ensurePetCareConversationTable(errors);
            ensurePetCareHistoryTable(errors);
            ensurePetCareAiConfigTable(errors);
            ensurePetCareRequestTable(errors);
            ensureAdminAgentTables(errors);
            ensureVarcharCapacity("t_permission", "flag", 32,
                    "ALTER TABLE t_permission MODIFY COLUMN flag VARCHAR(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '唯一标识'",
                    errors);
            ensureAdminAgentPermission(errors);
            ensureLightVolunteerRole(errors);
            ensureRole3HasMyProof(errors);
            ensurePermissionMyProof(errors);

            // 最终断言：迁移后仍缺则记入 errors
            assertReady(errors);
            if (!errors.isEmpty()) {
                String msg = String.join("; ", errors);
                log.error("SchemaGuard 未通过: {}", msg);
                boolean securityCritical = errors.stream().anyMatch(error ->
                        error.contains("t_file_asset") || error.contains("t_user.username")
                                || error.contains("文件引用列") || error.contains("历史头像占位值"));
                if (failFast || securityCritical) {
                    throw new IllegalStateException("[SchemaGuard] " + msg);
                }
                return;
            }
            if (autoMigrate) {
                writeSchemaVersion();
                log.info("SchemaGuard 通过，契约版本已写入 app_schema_meta.version={}", SCHEMA_VERSION);
            } else {
                log.info("SchemaGuard pure-check 通过，契约版本={}（auto-migrate=false，未写入元数据）", SCHEMA_VERSION);
            }
        } catch (IllegalStateException ex) {
            throw ex;
        } catch (RuntimeException ex) {
            log.error("SchemaGuard 异常: {}", ex.getMessage(), ex);
            throw new IllegalStateException("[SchemaGuard] 无法确认数据库结构，拒绝启动", ex);
        }
    }

    /** P0 业务闭环：状态证据、站内通知以及领养/救助可恢复字段。 */
    private void ensureWorkflowClosureSchema(List<String> errors) {
        ensureColumn("t_adopt", "reviewer_id", "ALTER TABLE t_adopt ADD COLUMN reviewer_id BIGINT NULL DEFAULT NULL AFTER vstate", errors);
        ensureColumn("t_adopt", "review_reason", "ALTER TABLE t_adopt ADD COLUMN review_reason VARCHAR(1000) NULL DEFAULT NULL AFTER reviewer_id", errors);
        ensureColumn("t_adopt", "reviewed_at", "ALTER TABLE t_adopt ADD COLUMN reviewed_at DATETIME(3) NULL DEFAULT NULL AFTER review_reason", errors);
        ensureColumn("t_adopt", "handover_at", "ALTER TABLE t_adopt ADD COLUMN handover_at DATETIME(3) NULL DEFAULT NULL AFTER reviewed_at", errors);
        ensureColumn("t_adopt", "handover_note", "ALTER TABLE t_adopt ADD COLUMN handover_note VARCHAR(1000) NULL DEFAULT NULL AFTER handover_at", errors);
        ensureColumn("t_adopt", "created_at", "ALTER TABLE t_adopt ADD COLUMN created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) AFTER handover_note", errors);
        ensureColumn("t_adopt", "updated_at", "ALTER TABLE t_adopt ADD COLUMN updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) AFTER created_at", errors);
        ensureColumn("t_adopt", "version", "ALTER TABLE t_adopt ADD COLUMN version INT NOT NULL DEFAULT 0 AFTER updated_at", errors);

        ensureColumn("t_proof", "proof_stage", "ALTER TABLE t_proof ADD COLUMN proof_stage VARCHAR(24) NOT NULL DEFAULT 'handover' AFTER pstatus", errors);
        ensureColumn("t_proof", "reviewer_id", "ALTER TABLE t_proof ADD COLUMN reviewer_id BIGINT NULL DEFAULT NULL AFTER proof_stage", errors);
        ensureColumn("t_proof", "review_reason", "ALTER TABLE t_proof ADD COLUMN review_reason VARCHAR(1000) NULL DEFAULT NULL AFTER reviewer_id", errors);
        ensureColumn("t_proof", "reviewed_at", "ALTER TABLE t_proof ADD COLUMN reviewed_at DATETIME(3) NULL DEFAULT NULL AFTER review_reason", errors);
        ensureColumn("t_proof", "created_at", "ALTER TABLE t_proof ADD COLUMN created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) AFTER reviewed_at", errors);
        ensureColumn("t_proof", "updated_at", "ALTER TABLE t_proof ADD COLUMN updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) AFTER created_at", errors);

        ensureColumn("t_help", "priority", "ALTER TABLE t_help ADD COLUMN priority INT NOT NULL DEFAULT 0 AFTER status", errors);
        ensureColumn("t_help", "assignee_id", "ALTER TABLE t_help ADD COLUMN assignee_id BIGINT NULL DEFAULT NULL AFTER priority", errors);
        ensureColumn("t_help", "outcome", "ALTER TABLE t_help ADD COLUMN outcome VARCHAR(32) NULL DEFAULT NULL AFTER assignee_id", errors);
        ensureColumn("t_help", "animal_id", "ALTER TABLE t_help ADD COLUMN animal_id BIGINT NULL DEFAULT NULL AFTER outcome", errors);
        ensureColumn("t_help", "resolution_note", "ALTER TABLE t_help ADD COLUMN resolution_note VARCHAR(2000) NULL DEFAULT NULL AFTER animal_id", errors);
        ensureColumn("t_help", "resolved_at", "ALTER TABLE t_help ADD COLUMN resolved_at DATETIME(3) NULL DEFAULT NULL AFTER resolution_note", errors);
        ensureColumn("t_help", "version", "ALTER TABLE t_help ADD COLUMN version INT NOT NULL DEFAULT 0 AFTER resolved_at", errors);
        ensureIndex("t_help", "uk_help_animal", "ALTER TABLE t_help ADD UNIQUE INDEX uk_help_animal (animal_id)", errors);

        ensureWorkflowTable("t_workflow_event",
                "CREATE TABLE IF NOT EXISTS t_workflow_event ("
                        + "id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,"
                        + "business_type VARCHAR(32) NOT NULL,business_id VARCHAR(96) NOT NULL,"
                        + "from_state INT NULL,to_state INT NULL,action VARCHAR(32) NOT NULL,"
                        + "actor_id BIGINT NULL,actor_type VARCHAR(16) NULL,reason VARCHAR(1000) NULL,"
                        + "request_id VARCHAR(64) NULL,metadata_json TEXT NULL,"
                        + "created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),"
                        + "INDEX idx_workflow_business (business_type,business_id,created_at,id),"
                        + "INDEX idx_workflow_actor (actor_id,created_at)"
                        + ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci", errors);
        ensureWorkflowTable("t_notification",
                "CREATE TABLE IF NOT EXISTS t_notification ("
                        + "id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,user_id BIGINT NOT NULL,"
                        + "type VARCHAR(32) NULL,title VARCHAR(120) NULL,summary VARCHAR(500) NULL,"
                        + "business_type VARCHAR(32) NULL,business_id VARCHAR(96) NULL,target_url VARCHAR(255) NULL,"
                        + "read_flag TINYINT NOT NULL DEFAULT 0,event_key VARCHAR(160) NOT NULL,"
                        + "created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),read_at DATETIME(3) NULL,"
                        + "UNIQUE KEY uk_notification_event (user_id,event_key),"
                        + "INDEX idx_notification_inbox (user_id,read_flag,created_at,id)"
                        + ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci", errors);
        ensureWorkflowTable("t_visit_plan",
                "CREATE TABLE IF NOT EXISTS t_visit_plan ("
                        + "id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,aid BIGINT NOT NULL,uid BIGINT NOT NULL,"
                        + "plan_type VARCHAR(24) NOT NULL,due_at DATE NOT NULL,status INT NOT NULL DEFAULT 0,"
                        + "assignee_id BIGINT NULL,completed_visit_id BIGINT NULL,"
                        + "created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),"
                        + "updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),"
                        + "UNIQUE KEY uk_visit_plan (aid,uid,plan_type),"
                        + "INDEX idx_visit_plan_queue (status,due_at,assignee_id)"
                        + ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci", errors);
    }

    private void ensureWorkflowTable(String table, String ddl, List<String> errors) {
        if (tableExists(table)) return;
        if (!autoMigrate) {
            errors.add("缺少 " + table + "（请执行 P0 workflow closure 迁移）");
            return;
        }
        try {
            jdbcTemplate.execute(ddl);
        } catch (Exception e) {
            errors.add("创建 " + table + " 失败: " + e.getMessage());
        }
    }

    private void ensureMetaTable() {
        // pure-check（autoMigrate=false）禁止任何 DDL，包括元数据表创建
        if (!autoMigrate) {
            return;
        }
        jdbcTemplate.execute(
                "CREATE TABLE IF NOT EXISTS app_schema_meta ("
                        + "meta_key VARCHAR(64) NOT NULL PRIMARY KEY,"
                        + "meta_value VARCHAR(255) NOT NULL,"
                        + "updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP"
                        + ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    }

    /**
     * 角色权限规范化 Phase 1：role_permission 关联表。
     * 数据回填由 RolePermissionSyncRunner（@Order(70)）在全部 JSON 写入者之后完成，
     * 此处仅保证表结构存在。不加外键：历史库 t_role/t_permission 字符集不一，
     * FK 创建失败会阻断启动；引用有效性由 SyncRunner 与运行期双写保证。
     */
    private void ensureRolePermissionTable(List<String> errors) {
        if (tableExists("role_permission")) {
            ensureColumn("role_permission", "role_id",
                    "ALTER TABLE role_permission ADD COLUMN role_id BIGINT NOT NULL", errors);
            ensureColumn("role_permission", "permission_id",
                    "ALTER TABLE role_permission ADD COLUMN permission_id BIGINT NOT NULL", errors);
            ensureIndex("role_permission", "PRIMARY",
                    "ALTER TABLE role_permission ADD PRIMARY KEY (role_id, permission_id)", errors);
            ensureIndex("role_permission", "idx_rp_permission",
                    "ALTER TABLE role_permission ADD INDEX idx_rp_permission (permission_id)", errors);
            return;
        }
        if (!autoMigrate) {
            errors.add("缺少表 role_permission 且 auto-migrate=false（见 docs/sql/2026-07-26-role-permission.sql）");
            return;
        }
        log.warn("SchemaGuard 自动创建 role_permission");
        try {
            jdbcTemplate.execute(
                    "CREATE TABLE IF NOT EXISTS role_permission ("
                            + "role_id BIGINT NOT NULL,"
                            + "permission_id BIGINT NOT NULL,"
                            + "PRIMARY KEY (role_id, permission_id),"
                            + "KEY idx_rp_permission (permission_id)"
                            + ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='角色-权限关联(规范化 Phase 1)'");
        } catch (RuntimeException ex) {
            errors.add("创建 role_permission 失败: " + ex.getMessage());
        }
    }

    private void ensureFileAssetTable(List<String> errors) {
        if (tableExists("t_file_asset")) {
            ensureFileAssetColumn("id", "ALTER TABLE t_file_asset ADD COLUMN id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY FIRST", errors);
            ensureFileAssetColumn("flag", "ALTER TABLE t_file_asset ADD COLUMN flag VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL AFTER id", errors);
            ensureFileAssetColumn("stored_name", "ALTER TABLE t_file_asset ADD COLUMN stored_name VARCHAR(512) NOT NULL AFTER flag", errors);
            ensureFileAssetColumn("original_name", "ALTER TABLE t_file_asset ADD COLUMN original_name VARCHAR(512) DEFAULT NULL AFTER stored_name", errors);
            ensureFileAssetColumn("owner_id", "ALTER TABLE t_file_asset ADD COLUMN owner_id BIGINT DEFAULT NULL AFTER original_name", errors);
            ensureFileAssetColumn("purpose", "ALTER TABLE t_file_asset ADD COLUMN purpose VARCHAR(32) NOT NULL DEFAULT 'private' AFTER owner_id", errors);
            ensureFileAssetColumn("visibility", "ALTER TABLE t_file_asset ADD COLUMN visibility VARCHAR(16) NOT NULL DEFAULT 'private' AFTER purpose", errors);
            ensureFileAssetColumn("business_type", "ALTER TABLE t_file_asset ADD COLUMN business_type VARCHAR(32) DEFAULT NULL AFTER visibility", errors);
            ensureFileAssetColumn("business_id", "ALTER TABLE t_file_asset ADD COLUMN business_id BIGINT DEFAULT NULL AFTER business_type", errors);
            ensureFileAssetColumn("content_type", "ALTER TABLE t_file_asset ADD COLUMN content_type VARCHAR(128) DEFAULT NULL AFTER business_id", errors);
            ensureFileAssetColumn("size_bytes", "ALTER TABLE t_file_asset ADD COLUMN size_bytes BIGINT DEFAULT NULL AFTER content_type", errors);
            ensureFileAssetColumn("created_at", "ALTER TABLE t_file_asset ADD COLUMN created_at DATETIME DEFAULT CURRENT_TIMESTAMP AFTER size_bytes", errors);
            ensureFileAssetColumn("bound_at", "ALTER TABLE t_file_asset ADD COLUMN bound_at DATETIME DEFAULT NULL AFTER created_at", errors);
            ensureFileAssetColumn("deleted", "ALTER TABLE t_file_asset ADD COLUMN deleted TINYINT NOT NULL DEFAULT 0 AFTER bound_at", errors);
            ensureFileAssetIndex("uk_file_flag", "ALTER TABLE t_file_asset ADD UNIQUE KEY uk_file_flag (flag)", errors);
            ensureFileAssetIndex("idx_file_owner", "ALTER TABLE t_file_asset ADD KEY idx_file_owner (owner_id)", errors);
            ensureFileAssetIndex("idx_file_purpose", "ALTER TABLE t_file_asset ADD KEY idx_file_purpose (purpose)", errors);
            ensureFileAssetIndex("idx_file_business", "ALTER TABLE t_file_asset ADD KEY idx_file_business (business_type, business_id, deleted)", errors);
            validateFileAssetStorageContract(errors);
            return;
        }
        if (!autoMigrate) {
            errors.add("缺少表 t_file_asset 且 auto-migrate=false（见 docs/sql/2026-07-21-file-asset.sql）");
            return;
        }
        log.warn("SchemaGuard 自动创建 t_file_asset");
        try {
            jdbcTemplate.execute(
                    "CREATE TABLE IF NOT EXISTS t_file_asset ("
                            + "id BIGINT NOT NULL AUTO_INCREMENT,"
                            + "flag VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,"
                            + "stored_name VARCHAR(512) NOT NULL,"
                            + "original_name VARCHAR(512) DEFAULT NULL,"
                            + "owner_id BIGINT DEFAULT NULL,"
                            + "purpose VARCHAR(32) NOT NULL DEFAULT 'private',"
                            + "visibility VARCHAR(16) NOT NULL DEFAULT 'private',"
                            + "business_type VARCHAR(32) DEFAULT NULL,"
                            + "business_id BIGINT DEFAULT NULL,"
                            + "content_type VARCHAR(128) DEFAULT NULL,"
                            + "size_bytes BIGINT DEFAULT NULL,"
                            + "created_at DATETIME DEFAULT CURRENT_TIMESTAMP,"
                            + "bound_at DATETIME DEFAULT NULL,"
                            + "deleted TINYINT NOT NULL DEFAULT 0,"
                            + "PRIMARY KEY (id),"
                            + "UNIQUE KEY uk_file_flag (flag),"
                            + "KEY idx_file_owner (owner_id),"
                            + "KEY idx_file_purpose (purpose),"
                            + "KEY idx_file_business (business_type, business_id, deleted)"
                            + ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
        } catch (Exception e) {
            errors.add("创建 t_file_asset 失败: " + e.getMessage());
        }
    }

    private void writeSchemaVersion() {
        jdbcTemplate.update(
                "INSERT INTO app_schema_meta (meta_key, meta_value) VALUES ('schema_version', ?) "
                        + "ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value)",
                SCHEMA_VERSION);
        jdbcTemplate.update(
                "INSERT INTO app_schema_meta (meta_key, meta_value) VALUES ('schema_guard', 'ok') "
                        + "ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value)");
    }

    private void ensureCoreTables(List<String> errors) {
        for (String table : Arrays.asList(
                "t_user", "t_role", "t_permission", "t_animal", "t_adopt", "t_proof",
                "t_visit", "t_volunteer", "t_help", "t_notice", "t_account")) {
            if (!tableExists(table)) {
                errors.add("缺少核心表 " + table + "（请先导入 test.sql）");
            }
        }
    }

    private void ensureColumn(String table, String column, String alterSql, List<String> errors) {
        if (!tableExists(table)) {
            return;
        }
        if (columnExists(table, column)) {
            return;
        }
        if (!autoMigrate) {
            errors.add("缺少列 " + table + "." + column + " 且 auto-migrate=false");
            return;
        }
        log.warn("SchemaGuard 自动补齐 {}.{}", table, column);
        try {
            jdbcTemplate.execute(alterSql);
        } catch (Exception e) {
            errors.add("补齐 " + table + "." + column + " 失败: " + e.getMessage());
        }
    }

    private void ensureColumnsPresent(String table, List<String> columns, List<String> errors) {
        if (!tableExists(table)) {
            return;
        }
        for (String column : columns) {
            // MyBatis 默认驼峰：实体 petId → 列 pet_id；部分库可能是 petId
            if (columnExists(table, column)) {
                continue;
            }
            if ("pet_id".equals(column) && columnExists(table, "petId")) {
                continue;
            }
            // 非自动创建的「基线列」只报告，避免错误 ALTER
            if (isAutoMigratable(table, column)) {
                continue; // 已由 ensureColumn 处理
            }
            errors.add("缺少列 " + table + "." + column);
        }
    }

    private boolean isAutoMigratable(String table, String column) {
        return ("t_proof".equals(table) && "pstatus".equals(column))
                || ("t_volunteer".equals(table) && ("uid".equals(column) || "apic".equals(column)));
    }

    private void ensureTextColumn(String table, String column, List<String> errors) {
        if (!tableExists(table) || !columnExists(table, column)) {
            return;
        }
        String type = dataType(table, column);
        if (type == null) {
            return;
        }
        if ("text".equalsIgnoreCase(type) || "longtext".equalsIgnoreCase(type) || "mediumtext".equalsIgnoreCase(type)) {
            return;
        }
        if (!autoMigrate) {
            errors.add(table + "." + column + " 应为 TEXT 以防权限 JSON 截断，当前=" + type);
            return;
        }
        log.warn("SchemaGuard 将 {}.{} 扩展为 TEXT（原类型 {}）", table, column, type);
        try {
            jdbcTemplate.execute("ALTER TABLE `" + table + "` MODIFY COLUMN `" + column + "` TEXT");
        } catch (Exception e) {
            errors.add("扩展 " + table + "." + column + " 为 TEXT 失败: " + e.getMessage());
        }
    }

    private void ensureFileAssetReferences(List<String> errors) {
        if (!tableExists("t_file_asset")) {
            return;
        }
        String[] checks = {
                "SELECT COUNT(*) FROM t_animal a WHERE a.tpic IS NOT NULL AND TRIM(a.tpic) <> '' "
                        + "AND NOT EXISTS (SELECT 1 FROM t_file_asset f WHERE f.flag = TRIM(a.tpic) AND f.deleted = 0 "
                        + "AND f.purpose = 'animal' AND f.visibility = 'public' AND f.business_type = 'animal' AND f.business_id = a.id)",
                "SELECT COUNT(*) FROM t_user u WHERE u.avatar IS NOT NULL AND TRIM(u.avatar) <> '' "
                        + "AND NOT EXISTS (SELECT 1 FROM t_file_asset f WHERE f.flag = TRIM(u.avatar) AND f.deleted = 0 "
                        + "AND f.purpose = 'avatar' AND f.visibility = 'public' AND f.business_type = 'user' AND f.business_id = u.id)",
                "SELECT COUNT(*) FROM t_proof p WHERE p.ppic IS NOT NULL AND TRIM(p.ppic) <> '' "
                        + "AND NOT EXISTS (SELECT 1 FROM t_file_asset f WHERE f.flag = TRIM(p.ppic) AND f.deleted = 0 "
                        + "AND f.purpose = 'proof' AND f.visibility = 'private' AND f.business_type = 'proof' AND f.business_id = p.id)",
                "SELECT COUNT(*) FROM t_volunteer v WHERE v.apic IS NOT NULL AND TRIM(v.apic) <> '' "
                        + "AND NOT EXISTS (SELECT 1 FROM t_file_asset f WHERE f.flag = TRIM(v.apic) AND f.deleted = 0 "
                        + "AND f.purpose = 'volunteer' AND f.visibility = 'private' AND f.business_type = 'volunteer' AND f.business_id = v.id)",
                "SELECT COUNT(*) FROM t_help h WHERE h.pic IS NOT NULL AND TRIM(h.pic) <> '' "
                        + "AND NOT EXISTS (SELECT 1 FROM t_file_asset f WHERE f.flag = TRIM(h.pic) AND f.deleted = 0 "
                        + "AND f.purpose = 'help' AND f.visibility = 'private' AND f.business_type = 'help' AND f.business_id = h.id)",
                "SELECT COUNT(*) FROM t_visit v WHERE v.pic IS NOT NULL AND TRIM(v.pic) <> '' "
                        + "AND NOT EXISTS (SELECT 1 FROM t_file_asset f WHERE f.flag = TRIM(v.pic) AND f.deleted = 0 "
                        + "AND f.purpose = 'visit' AND f.visibility = 'private' AND f.business_type = 'visit' AND f.business_id = v.id)"
        };
        long missing = 0;
        for (String sql : checks) {
            Long count = jdbcTemplate.queryForObject(sql, Long.class);
            if (count != null) {
                missing += count;
            }
        }
        if (missing > 0) {
            errors.add("发现 " + missing + " 条业务文件引用缺少有效且正确绑定的 t_file_asset 元数据，请执行 file-asset-migrate-RUNBOOK");
        }
    }

    private void ensureLegacyAvatarPlaceholderRemoved(List<String> errors) {
        if (!tableExists("t_user") || !columnExists("t_user", "avatar")) {
            return;
        }
        Long placeholders = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM t_user WHERE TRIM(avatar) = '1'", Long.class);
        if (placeholders == null || placeholders == 0) {
            return;
        }
        if (!autoMigrate) {
            errors.add("发现 " + placeholders + " 条历史头像占位值 avatar='1'，必须迁移为 NULL");
            return;
        }
        log.warn("SchemaGuard 清理 {} 条历史头像占位值 avatar='1' 为 NULL", placeholders);
        try {
            jdbcTemplate.update("UPDATE t_user SET avatar = NULL WHERE TRIM(avatar) = '1'");
        } catch (Exception e) {
            errors.add("清理历史头像占位值失败: " + e.getMessage());
        }
    }

    private void ensureFileReferenceCollations(List<String> errors) {
        String[][] columns = {
                {"t_file_asset", "flag", "ALTER TABLE t_file_asset MODIFY COLUMN flag VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL"},
                {"t_animal", "tpic", "ALTER TABLE t_animal MODIFY COLUMN tpic VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' COMMENT '动物图片文件flag'"},
                {"t_user", "avatar", "ALTER TABLE t_user MODIFY COLUMN avatar VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '头像文件flag'"},
                {"t_proof", "ppic", "ALTER TABLE t_proof MODIFY COLUMN ppic VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '凭证图片文件flag'"},
                {"t_volunteer", "apic", "ALTER TABLE t_volunteer MODIFY COLUMN apic VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '本人免冠照文件flag'"},
                {"t_help", "pic", "ALTER TABLE t_help MODIFY COLUMN pic VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '现场照片文件flag'"},
                {"t_visit", "pic", "ALTER TABLE t_visit MODIFY COLUMN pic VARCHAR(355) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '回访图片文件flag'"}
        };
        for (String[] definition : columns) {
            ensureFileReferenceCollation(definition[0], definition[1], definition[2], errors);
        }
    }

    private void ensureFileReferenceCollation(String table, String column, String alterSql,
                                              List<String> errors) {
        if (!tableExists(table) || !columnExists(table, column)) {
            return;
        }
        String[] metadata = jdbcTemplate.query(
                "SELECT CHARACTER_SET_NAME, COLLATION_NAME FROM information_schema.COLUMNS "
                        + "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?",
                rs -> rs.next() ? new String[]{rs.getString(1), rs.getString(2)} : null,
                table, column);
        if (metadata != null && "utf8mb4".equalsIgnoreCase(metadata[0])
                && FILE_FLAG_COLLATION.equalsIgnoreCase(metadata[1])) {
            return;
        }
        if (!autoMigrate) {
            errors.add("文件引用列 " + table + "." + column + " 必须使用 utf8mb4/" + FILE_FLAG_COLLATION);
            return;
        }
        log.warn("SchemaGuard 统一文件引用列 {}.{} 为 utf8mb4/{}", table, column, FILE_FLAG_COLLATION);
        try {
            jdbcTemplate.execute(alterSql);
        } catch (Exception e) {
            errors.add("迁移文件引用列 " + table + "." + column + " 排序规则失败: " + e.getMessage());
        }
    }

    private void ensureVarcharCapacity(String table, String column, long minimum,
                                       String alterSql, List<String> errors) {
        if (!tableExists(table) || !columnExists(table, column)) {
            return;
        }
        Long length = jdbcTemplate.query(
                "SELECT CHARACTER_MAXIMUM_LENGTH FROM information_schema.COLUMNS "
                        + "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?",
                rs -> rs.next() ? rs.getLong(1) : null,
                table, column);
        String charset = jdbcTemplate.query(
                "SELECT CHARACTER_SET_NAME FROM information_schema.COLUMNS "
                        + "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?",
                rs -> rs.next() ? rs.getString(1) : null,
                table, column);
        if (length != null && length >= minimum && "utf8mb4".equalsIgnoreCase(charset)) {
            return;
        }
        if (!autoMigrate) {
            errors.add(table + "." + column + " 必须为 utf8mb4 VARCHAR(" + minimum + ")");
            return;
        }
        log.warn("SchemaGuard 扩宽 {}.{} 为 utf8mb4 VARCHAR({})", table, column, minimum);
        try {
            jdbcTemplate.execute(alterSql);
        } catch (Exception e) {
            errors.add("扩宽 " + table + "." + column + " 失败: " + e.getMessage());
        }
    }

    private void ensureFileAssetColumn(String column, String alterSql, List<String> errors) {
        if (columnExists("t_file_asset", column)) {
            return;
        }
        if (!autoMigrate) {
            errors.add("t_file_asset 缺少列 " + column + " 且 auto-migrate=false");
            return;
        }
        try {
            jdbcTemplate.execute(alterSql);
        } catch (Exception e) {
            errors.add("补齐 t_file_asset." + column + " 失败: " + e.getMessage());
        }
    }

    /**
     * 崩溃预防 P0.2：聊天轮询每在线页面 10s 打一次
     * WHERE title='聊天室消息' ORDER BY create_time DESC,id DESC —— t_help 此前仅有主键，
     * 每次都是全表扫+filesort，消息堆积后与小连接池叠加是全站假死的头号路径。
     */
    private void ensureHelpChatIndexes(List<String> errors) {
        ensureIndex("t_help", "idx_help_chat",
                "ALTER TABLE t_help ADD INDEX idx_help_chat (title, create_time, id)", errors);
        ensureIndex("t_help", "idx_help_uid",
                "ALTER TABLE t_help ADD INDEX idx_help_uid (uid)", errors);
    }

    private void ensurePetCareHistoryTable(List<String> errors) {
        if (!tableExists("t_petcare_chat")) {
            if (!autoMigrate) {
                errors.add("缺少表 t_petcare_chat 且 auto-migrate=false"
                        + "（见 docs/sql/2026-07-27-petcare-chat.sql）");
                return;
            }
            log.warn("SchemaGuard 自动创建 t_petcare_chat");
            try {
                jdbcTemplate.execute(
                        "CREATE TABLE IF NOT EXISTS t_petcare_chat ("
                                + "id BIGINT NOT NULL AUTO_INCREMENT,"
                                + "user_id BIGINT NOT NULL,"
                                + "conversation_id BIGINT DEFAULT NULL,"
                                + "question VARCHAR(500) NOT NULL,"
                                + "answer MEDIUMTEXT NOT NULL,"
                                 + "source VARCHAR(16) NOT NULL DEFAULT 'local',"
                                + "degrade_reason VARCHAR(500) NOT NULL DEFAULT '',"
                                + "topic VARCHAR(100) DEFAULT NULL,"
                                + "tools_json TEXT DEFAULT NULL,"
                                + "question_time DATETIME(3) NOT NULL,"
                                + "answer_time DATETIME(3) NOT NULL,"
                                + "PRIMARY KEY (id),"
                                + "KEY idx_petcare_user_time (user_id, id),"
                                + "KEY idx_petcare_conversation (user_id, conversation_id, id)"
                                + ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci "
                                + "COMMENT='照顾知识助手个人聊天历史'");
            } catch (RuntimeException ex) {
                errors.add("创建 t_petcare_chat 失败: " + ex.getMessage());
            }
            return;
        }

        ensureColumn("t_petcare_chat", "conversation_id",
                "ALTER TABLE t_petcare_chat ADD COLUMN conversation_id BIGINT NULL DEFAULT NULL AFTER user_id",
                errors);
        ensureColumn("t_petcare_chat", "degrade_reason",
                "ALTER TABLE t_petcare_chat ADD COLUMN degrade_reason VARCHAR(500) "
                        + "NOT NULL DEFAULT '' AFTER source", errors);
        ensureColumnsPresent("t_petcare_chat", Arrays.asList(
                "id", "user_id", "conversation_id", "question", "answer", "source", "topic",
                "degrade_reason", "tools_json", "question_time", "answer_time"), errors);
        if (!indexExists("t_petcare_chat", "idx_petcare_user_time")) {
            if (!autoMigrate) {
                errors.add("t_petcare_chat 缺少索引 idx_petcare_user_time 且 auto-migrate=false"
                        + "（见 docs/sql/2026-07-27-petcare-chat.sql）");
                return;
            }
            try {
                jdbcTemplate.execute(
                        "ALTER TABLE t_petcare_chat ADD INDEX idx_petcare_user_time (user_id, id)");
            } catch (RuntimeException ex) {
                errors.add("创建索引 t_petcare_chat.idx_petcare_user_time 失败: " + ex.getMessage());
            }
        }
        ensureIndex("t_petcare_chat", "idx_petcare_conversation",
                "ALTER TABLE t_petcare_chat ADD INDEX idx_petcare_conversation "
                        + "(user_id, conversation_id, id)", errors);
    }

    private void ensurePetCareConversationTable(List<String> errors) {
        if (!tableExists("t_petcare_conversation")) {
            if (!autoMigrate) {
                errors.add("缺少表 t_petcare_conversation 且 auto-migrate=false"
                        + "（见 docs/sql/2026-07-27-petcare-conversations.sql）");
                return;
            }
            log.warn("SchemaGuard 自动创建 t_petcare_conversation");
            try {
                jdbcTemplate.execute(
                        "CREATE TABLE IF NOT EXISTS t_petcare_conversation ("
                                + "id BIGINT NOT NULL AUTO_INCREMENT,"
                                + "user_id BIGINT NOT NULL,"
                                + "title VARCHAR(60) NOT NULL,"
                                + "preview VARCHAR(100) NOT NULL DEFAULT '',"
                                + "turn_count INT NOT NULL DEFAULT 0,"
                                + "created_at DATETIME(3) NOT NULL,"
                                + "updated_at DATETIME(3) NOT NULL,"
                                + "PRIMARY KEY (id),"
                                + "KEY idx_petcare_conversation_user (user_id, updated_at, id)"
                                + ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci "
                                + "COMMENT='照顾知识助手会话目录'");
            } catch (RuntimeException ex) {
                errors.add("创建 t_petcare_conversation 失败: " + ex.getMessage());
            }
            return;
        }
        ensureColumnsPresent("t_petcare_conversation", Arrays.asList(
                "id", "user_id", "title", "preview", "turn_count",
                "created_at", "updated_at"), errors);
        ensureIndex("t_petcare_conversation", "idx_petcare_conversation_user",
                "ALTER TABLE t_petcare_conversation ADD INDEX "
                        + "idx_petcare_conversation_user (user_id, updated_at, id)", errors);
    }

    private void ensurePetCareAiConfigTable(List<String> errors) {
        if (!tableExists("t_petcare_ai_config")) {
            if (!autoMigrate) {
                errors.add("缺少表 t_petcare_ai_config 且 auto-migrate=false"
                        + "（见 docs/sql/2026-07-27-petcare-ai-config.sql）");
                return;
            }
            log.warn("SchemaGuard 自动创建 t_petcare_ai_config");
            try {
                jdbcTemplate.execute(
                        "CREATE TABLE IF NOT EXISTS t_petcare_ai_config ("
                                + "user_id BIGINT NOT NULL,"
                                + "enabled TINYINT(1) NOT NULL DEFAULT 1,"
                                + "base_url VARCHAR(500) NOT NULL,"
                                + "model VARCHAR(120) NOT NULL,"
                                + "api_key_ciphertext TEXT NOT NULL,"
                                + "connection_status VARCHAR(16) NOT NULL DEFAULT 'untested',"
                                + "last_test_message VARCHAR(500) NOT NULL DEFAULT '',"
                                + "last_tested_at DATETIME(3) DEFAULT NULL,"
                                + "version BIGINT NOT NULL DEFAULT 1,"
                                + "created_at DATETIME(3) NOT NULL,"
                                + "updated_at DATETIME(3) NOT NULL,"
                                + "PRIMARY KEY (user_id)"
                                + ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci "
                                + "COMMENT='照顾助手用户级加密API配置'");
            } catch (RuntimeException ex) {
                errors.add("创建 t_petcare_ai_config 失败: " + ex.getMessage());
            }
            return;
        }

        ensureColumn("t_petcare_ai_config", "connection_status",
                "ALTER TABLE t_petcare_ai_config ADD COLUMN connection_status "
                        + "VARCHAR(16) NOT NULL DEFAULT 'untested' AFTER api_key_ciphertext", errors);
        ensureColumn("t_petcare_ai_config", "last_test_message",
                "ALTER TABLE t_petcare_ai_config ADD COLUMN last_test_message "
                        + "VARCHAR(500) NOT NULL DEFAULT '' AFTER connection_status", errors);
        ensureColumn("t_petcare_ai_config", "last_tested_at",
                "ALTER TABLE t_petcare_ai_config ADD COLUMN last_tested_at "
                        + "DATETIME(3) NULL DEFAULT NULL AFTER last_test_message", errors);
        ensureColumn("t_petcare_ai_config", "version",
                "ALTER TABLE t_petcare_ai_config ADD COLUMN version BIGINT NOT NULL DEFAULT 1 "
                        + "AFTER last_tested_at", errors);
        ensureColumnsPresent("t_petcare_ai_config", Arrays.asList(
                "user_id", "enabled", "base_url", "model", "api_key_ciphertext",
                "connection_status", "last_test_message", "last_tested_at", "version",
                "created_at", "updated_at"), errors);
    }

    private void ensurePetCareRequestTable(List<String> errors) {
        if (!tableExists("t_petcare_request")) {
            if (!autoMigrate) {
                errors.add("缺少表 t_petcare_request 且 auto-migrate=false"
                        + "（见 docs/sql/2026-07-27-petcare-request.sql）");
                return;
            }
            try {
                jdbcTemplate.execute(
                        "CREATE TABLE IF NOT EXISTS t_petcare_request ("
                                + "id BIGINT NOT NULL AUTO_INCREMENT,"
                                + "user_id BIGINT NOT NULL,"
                                + "request_id VARCHAR(64) NOT NULL,"
                                + "conversation_id BIGINT DEFAULT NULL,"
                                + "requested_conversation_id BIGINT DEFAULT NULL,"
                                + "requested_conversation_known TINYINT(1) DEFAULT NULL COMMENT 'v5标记：true=新请求，NULL=旧未知来源',"
                                + "question VARCHAR(500) NOT NULL,"
                                + "status VARCHAR(16) NOT NULL,"
                                + "answer MEDIUMTEXT DEFAULT NULL,"
                                + "source VARCHAR(16) DEFAULT NULL,"
                                + "degrade_reason VARCHAR(500) NOT NULL DEFAULT '',"
                                + "topic VARCHAR(100) DEFAULT NULL,"
                                + "tools_json TEXT DEFAULT NULL,"
                                + "conversation_title VARCHAR(60) DEFAULT NULL,"
                                + "error_code VARCHAR(16) DEFAULT NULL,"
                                + "error_message VARCHAR(500) DEFAULT NULL,"
                                + "attempt_count INT NOT NULL DEFAULT 1,"
                                + "created_at DATETIME(3) NOT NULL,"
                                + "updated_at DATETIME(3) NOT NULL,"
                                + "completed_at DATETIME(3) DEFAULT NULL,"
                                + "PRIMARY KEY (id),"
                                + "UNIQUE KEY uk_petcare_request_user (user_id, request_id),"
                                + "KEY idx_petcare_request_status (status, updated_at)"
                                + ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci "
                                + "COMMENT='照顾助手幂等问答任务'");
            } catch (RuntimeException ex) {
                errors.add("创建 t_petcare_request 失败: " + ex.getMessage());
            }
            return;
        }
        boolean requestedConversationMissing = !columnExists(
                "t_petcare_request", "requested_conversation_id");
        ensureColumn("t_petcare_request", "requested_conversation_id",
                "ALTER TABLE t_petcare_request ADD COLUMN requested_conversation_id BIGINT "
                        + "DEFAULT NULL AFTER conversation_id", errors);
        ensureColumn("t_petcare_request", "requested_conversation_known",
                "ALTER TABLE t_petcare_request ADD COLUMN requested_conversation_known TINYINT(1) "
                        + "DEFAULT NULL COMMENT 'v5标记：true=新请求，NULL=旧未知来源' "
                        + "AFTER requested_conversation_id", errors);
        if (autoMigrate && requestedConversationMissing
                && columnExists("t_petcare_request", "requested_conversation_id")
                && columnExists("t_petcare_request", "requested_conversation_known")) {
            jdbcTemplate.update("UPDATE t_petcare_request SET requested_conversation_id = conversation_id "
                    + "WHERE requested_conversation_id IS NULL AND conversation_id IS NOT NULL");
        }
        ensureColumnsPresent("t_petcare_request", Arrays.asList(
                "id", "user_id", "request_id", "conversation_id", "requested_conversation_id",
                "requested_conversation_known", "question", "status",
                "answer", "source", "degrade_reason", "topic", "tools_json",
                "conversation_title", "error_code", "error_message", "attempt_count",
                "created_at", "updated_at", "completed_at"), errors);
        validatePetCareRequestIndex("uk_petcare_request_user", errors);
        ensureIndex("t_petcare_request", "idx_petcare_request_status",
                "ALTER TABLE t_petcare_request ADD INDEX idx_petcare_request_status "
                        + "(status, updated_at)", errors);
    }

    private void ensureAdminAgentTables(List<String> errors) {
        ensureAdminAgentTable("t_admin_agent_config",
                "CREATE TABLE IF NOT EXISTS t_admin_agent_config ("
                        + "id TINYINT NOT NULL, enabled TINYINT(1) NOT NULL DEFAULT 0,"
                        + "base_url VARCHAR(500) NOT NULL, model VARCHAR(120) NOT NULL,"
                        + "api_key_ciphertext TEXT NOT NULL,"
                        + "connection_status VARCHAR(16) NOT NULL DEFAULT 'untested',"
                        + "last_test_message VARCHAR(500) NOT NULL DEFAULT '',"
                        + "last_tested_at DATETIME(3) DEFAULT NULL, version BIGINT NOT NULL DEFAULT 1,"
                        + "created_at DATETIME(3) NOT NULL, updated_at DATETIME(3) NOT NULL,"
                        + "PRIMARY KEY (id)"
                        + ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci "
                        + "COMMENT='管理员Agent平台级加密模型配置'", errors);
        ensureAdminAgentTable("t_admin_agent_conversation",
                "CREATE TABLE IF NOT EXISTS t_admin_agent_conversation ("
                        + "id BIGINT NOT NULL AUTO_INCREMENT, user_id BIGINT NOT NULL,"
                        + "title VARCHAR(60) NOT NULL, preview VARCHAR(100) NOT NULL DEFAULT '',"
                        + "turn_count INT NOT NULL DEFAULT 0, created_at DATETIME(3) NOT NULL,"
                        + "updated_at DATETIME(3) NOT NULL, PRIMARY KEY (id),"
                        + "KEY idx_admin_agent_conversation_user (user_id, updated_at, id)"
                        + ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci "
                        + "COMMENT='管理员Agent个人会话目录'", errors);
        ensureAdminAgentTable("t_admin_agent_message",
                "CREATE TABLE IF NOT EXISTS t_admin_agent_message ("
                        + "id BIGINT NOT NULL AUTO_INCREMENT, user_id BIGINT NOT NULL,"
                        + "conversation_id BIGINT NOT NULL, request_id VARCHAR(64) NOT NULL,"
                        + "question VARCHAR(800) NOT NULL, answer MEDIUMTEXT NOT NULL,"
                        + "tools_json TEXT DEFAULT NULL, created_at DATETIME(3) NOT NULL,"
                        + "completed_at DATETIME(3) NOT NULL, PRIMARY KEY (id),"
                        + "UNIQUE KEY uk_admin_agent_request (user_id, request_id),"
                        + "KEY idx_admin_agent_message_conversation (user_id, conversation_id, id)"
                        + ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci "
                        + "COMMENT='管理员Agent问答记录'", errors);
        ensureAdminAgentTable("t_admin_agent_audit",
                "CREATE TABLE IF NOT EXISTS t_admin_agent_audit ("
                        + "id BIGINT NOT NULL AUTO_INCREMENT, actor_id BIGINT NOT NULL,"
                        + "event_type VARCHAR(40) NOT NULL, conversation_id BIGINT DEFAULT NULL,"
                        + "request_id VARCHAR(64) NOT NULL DEFAULT '', tools_json TEXT DEFAULT NULL,"
                        + "outcome VARCHAR(16) NOT NULL, detail VARCHAR(1000) NOT NULL DEFAULT '',"
                        + "created_at DATETIME(3) NOT NULL, PRIMARY KEY (id),"
                        + "KEY idx_admin_agent_audit_actor (actor_id, created_at, id),"
                        + "KEY idx_admin_agent_audit_request (request_id)"
                        + ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci "
                        + "COMMENT='管理员Agent操作审计'", errors);
        ensureAdminAgentTable("t_admin_agent_adopt_draft",
                "CREATE TABLE IF NOT EXISTS t_admin_agent_adopt_draft ("
                        + "id BIGINT NOT NULL AUTO_INCREMENT, actor_id BIGINT NOT NULL,"
                        + "animal_id BIGINT NOT NULL, applicant_id BIGINT NOT NULL,"
                        + "request_id VARCHAR(64) NOT NULL, source_state INT NOT NULL DEFAULT 0,"
                        + "recommendation VARCHAR(24) NOT NULL, risk_level VARCHAR(12) NOT NULL,"
                        + "rationale VARCHAR(1200) NOT NULL, missing_info VARCHAR(800) NOT NULL,"
                        + "review_note VARCHAR(1200) NOT NULL, model VARCHAR(120) NOT NULL,"
                        + "status VARCHAR(16) NOT NULL DEFAULT 'draft', version BIGINT NOT NULL DEFAULT 1,"
                        + "final_request_id VARCHAR(64) DEFAULT NULL, final_decision VARCHAR(12) DEFAULT NULL,"
                        + "override_reason VARCHAR(500) NOT NULL DEFAULT '', finalized_at DATETIME(3) DEFAULT NULL,"
                        + "created_at DATETIME(3) NOT NULL, updated_at DATETIME(3) NOT NULL, PRIMARY KEY (id),"
                        + "UNIQUE KEY uk_admin_agent_draft_application (actor_id, animal_id, applicant_id),"
                        + "UNIQUE KEY uk_admin_agent_draft_request (actor_id, request_id),"
                        + "UNIQUE KEY uk_admin_agent_draft_final_request (actor_id, final_request_id),"
                        + "KEY idx_admin_agent_draft_actor (actor_id, status, updated_at, id)"
                        + ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci "
                        + "COMMENT='3A草稿与3B人工确认执行凭据'", errors);
        ensureAdminAgentTable("t_admin_agent_automation_config",
                "CREATE TABLE IF NOT EXISTS t_admin_agent_automation_config ("
                        + "id TINYINT NOT NULL,enabled TINYINT(1) NOT NULL DEFAULT 0,"
                        + "mode VARCHAR(16) NOT NULL DEFAULT 'shadow',max_batch INT NOT NULL DEFAULT 3,"
                        + "version BIGINT NOT NULL DEFAULT 1,updated_by BIGINT DEFAULT NULL,"
                        + "created_at DATETIME(3) NOT NULL,updated_at DATETIME(3) NOT NULL,PRIMARY KEY(id)"
                        + ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci "
                        + "COMMENT='3C受控自动审核开关'", errors);
        ensureAdminAgentTable("t_admin_agent_automation_run",
                "CREATE TABLE IF NOT EXISTS t_admin_agent_automation_run ("
                        + "id BIGINT NOT NULL AUTO_INCREMENT,actor_id BIGINT NOT NULL,request_id VARCHAR(64) NOT NULL,"
                        + "mode VARCHAR(16) NOT NULL,status VARCHAR(16) NOT NULL,candidate_count INT NOT NULL DEFAULT 0,"
                        + "shadow_count INT NOT NULL DEFAULT 0,auto_approved_count INT NOT NULL DEFAULT 0,"
                        + "manual_count INT NOT NULL DEFAULT 0,failed_count INT NOT NULL DEFAULT 0,"
                        + "detail VARCHAR(1000) NOT NULL DEFAULT '',started_at DATETIME(3) NOT NULL,"
                        + "completed_at DATETIME(3) DEFAULT NULL,PRIMARY KEY(id),"
                        + "UNIQUE KEY uk_admin_agent_automation_request(actor_id,request_id),"
                        + "KEY idx_admin_agent_automation_status(status,started_at,id)"
                        + ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci "
                        + "COMMENT='3C自动审核运行批次'", errors);
        ensureAdminAgentTable("t_admin_agent_automation_item",
                "CREATE TABLE IF NOT EXISTS t_admin_agent_automation_item ("
                        + "id BIGINT NOT NULL AUTO_INCREMENT,run_id BIGINT NOT NULL,animal_id BIGINT NOT NULL,"
                        + "applicant_id BIGINT NOT NULL,recommendation VARCHAR(24) NOT NULL DEFAULT '',"
                        + "risk_level VARCHAR(12) NOT NULL DEFAULT '',hard_gate_pass TINYINT(1) NOT NULL DEFAULT 0,"
                        + "missing_info VARCHAR(800) NOT NULL DEFAULT '',rationale VARCHAR(1200) NOT NULL DEFAULT '',"
                        + "outcome VARCHAR(24) NOT NULL,reason VARCHAR(500) NOT NULL DEFAULT '',"
                        + "created_at DATETIME(3) NOT NULL,PRIMARY KEY(id),"
                        + "UNIQUE KEY uk_admin_agent_automation_item(run_id,animal_id,applicant_id),"
                        + "KEY idx_admin_agent_automation_item_run(run_id,id)"
                        + ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci "
                        + "COMMENT='3C逐条去隐私决策证据'", errors);

        if (tableExists("t_admin_agent_automation_config")) {
            if (autoMigrate) {
                jdbcTemplate.execute("INSERT IGNORE INTO t_admin_agent_automation_config "
                        + "(id,enabled,mode,max_batch,version,updated_by,created_at,updated_at) "
                        + "VALUES (1,0,'shadow',3,1,NULL,NOW(3),NOW(3))");
            } else if (jdbcTemplate.query("SELECT 1 FROM t_admin_agent_automation_config WHERE id=1 LIMIT 1",
                    (rs, i) -> 1).isEmpty()) {
                errors.add("t_admin_agent_automation_config 缺少 id=1 默认安全配置");
            }
        }

        ensureColumn("t_admin_agent_adopt_draft", "final_request_id",
                "ALTER TABLE t_admin_agent_adopt_draft ADD COLUMN final_request_id VARCHAR(64) DEFAULT NULL AFTER version", errors);
        ensureColumn("t_admin_agent_adopt_draft", "final_decision",
                "ALTER TABLE t_admin_agent_adopt_draft ADD COLUMN final_decision VARCHAR(12) DEFAULT NULL AFTER final_request_id", errors);
        ensureColumn("t_admin_agent_adopt_draft", "override_reason",
                "ALTER TABLE t_admin_agent_adopt_draft ADD COLUMN override_reason VARCHAR(500) NOT NULL DEFAULT '' AFTER final_decision", errors);
        ensureColumn("t_admin_agent_adopt_draft", "finalized_at",
                "ALTER TABLE t_admin_agent_adopt_draft ADD COLUMN finalized_at DATETIME(3) DEFAULT NULL AFTER override_reason", errors);

        ensureColumnsPresent("t_admin_agent_config", Arrays.asList(
                "id", "enabled", "base_url", "model", "api_key_ciphertext", "connection_status",
                "last_test_message", "last_tested_at", "version", "created_at", "updated_at"), errors);
        ensureColumnsPresent("t_admin_agent_conversation", Arrays.asList(
                "id", "user_id", "title", "preview", "turn_count", "created_at", "updated_at"), errors);
        ensureColumnsPresent("t_admin_agent_message", Arrays.asList(
                "id", "user_id", "conversation_id", "request_id", "question", "answer",
                "tools_json", "created_at", "completed_at"), errors);
        ensureColumnsPresent("t_admin_agent_audit", Arrays.asList(
                "id", "actor_id", "event_type", "conversation_id", "request_id", "tools_json",
                "outcome", "detail", "created_at"), errors);
        ensureColumnsPresent("t_admin_agent_adopt_draft", Arrays.asList(
                "id", "actor_id", "animal_id", "applicant_id", "request_id", "source_state",
                "recommendation", "risk_level", "rationale", "missing_info", "review_note",
                "model", "status", "version", "final_request_id", "final_decision", "override_reason",
                "finalized_at", "created_at", "updated_at"), errors);
        ensureColumnsPresent("t_admin_agent_automation_config", Arrays.asList(
                "id", "enabled", "mode", "max_batch", "version", "updated_by", "created_at", "updated_at"), errors);
        ensureColumnsPresent("t_admin_agent_automation_run", Arrays.asList(
                "id", "actor_id", "request_id", "mode", "status", "candidate_count", "shadow_count",
                "auto_approved_count", "manual_count", "failed_count", "detail", "started_at", "completed_at"), errors);
        ensureColumnsPresent("t_admin_agent_automation_item", Arrays.asList(
                "id", "run_id", "animal_id", "applicant_id", "recommendation", "risk_level", "hard_gate_pass",
                "missing_info", "rationale", "outcome", "reason", "created_at"), errors);
        ensureIndex("t_admin_agent_conversation", "idx_admin_agent_conversation_user",
                "ALTER TABLE t_admin_agent_conversation ADD INDEX "
                        + "idx_admin_agent_conversation_user (user_id, updated_at, id)", errors);
        ensureIndex("t_admin_agent_message", "uk_admin_agent_request",
                "ALTER TABLE t_admin_agent_message ADD UNIQUE INDEX uk_admin_agent_request (user_id, request_id)", errors);
        ensureIndex("t_admin_agent_message", "idx_admin_agent_message_conversation",
                "ALTER TABLE t_admin_agent_message ADD INDEX "
                        + "idx_admin_agent_message_conversation (user_id, conversation_id, id)", errors);
        ensureIndex("t_admin_agent_audit", "idx_admin_agent_audit_actor",
                "ALTER TABLE t_admin_agent_audit ADD INDEX idx_admin_agent_audit_actor (actor_id, created_at, id)", errors);
        ensureIndex("t_admin_agent_adopt_draft", "uk_admin_agent_draft_application",
                "ALTER TABLE t_admin_agent_adopt_draft ADD UNIQUE INDEX uk_admin_agent_draft_application "
                        + "(actor_id, animal_id, applicant_id)", errors);
        ensureIndex("t_admin_agent_adopt_draft", "uk_admin_agent_draft_request",
                "ALTER TABLE t_admin_agent_adopt_draft ADD UNIQUE INDEX uk_admin_agent_draft_request "
                        + "(actor_id, request_id)", errors);
        ensureIndex("t_admin_agent_adopt_draft", "uk_admin_agent_draft_final_request",
                "ALTER TABLE t_admin_agent_adopt_draft ADD UNIQUE INDEX uk_admin_agent_draft_final_request "
                        + "(actor_id, final_request_id)", errors);
        ensureIndex("t_admin_agent_adopt_draft", "idx_admin_agent_draft_actor",
                "ALTER TABLE t_admin_agent_adopt_draft ADD INDEX idx_admin_agent_draft_actor "
                        + "(actor_id, status, updated_at, id)", errors);
        ensureIndex("t_admin_agent_automation_run", "uk_admin_agent_automation_request",
                "ALTER TABLE t_admin_agent_automation_run ADD UNIQUE INDEX uk_admin_agent_automation_request "
                        + "(actor_id,request_id)", errors);
        ensureIndex("t_admin_agent_automation_run", "idx_admin_agent_automation_status",
                "ALTER TABLE t_admin_agent_automation_run ADD INDEX idx_admin_agent_automation_status "
                        + "(status,started_at,id)", errors);
        ensureIndex("t_admin_agent_automation_item", "uk_admin_agent_automation_item",
                "ALTER TABLE t_admin_agent_automation_item ADD UNIQUE INDEX uk_admin_agent_automation_item "
                        + "(run_id,animal_id,applicant_id)", errors);
        ensureIndex("t_admin_agent_automation_item", "idx_admin_agent_automation_item_run",
                "ALTER TABLE t_admin_agent_automation_item ADD INDEX idx_admin_agent_automation_item_run "
                        + "(run_id,id)", errors);
    }

    private void ensureAdminAgentTable(String table, String createSql, List<String> errors) {
        if (tableExists(table)) return;
        if (!autoMigrate) {
            errors.add("缺少表 " + table + " 且 auto-migrate=false（见 docs/sql/2026-07-28-admin-agent.sql）");
            return;
        }
        log.warn("SchemaGuard 自动创建 {}", table);
        try {
            jdbcTemplate.execute(createSql);
        } catch (RuntimeException ex) {
            errors.add("创建 " + table + " 失败: " + ex.getMessage());
        }
    }

    private void ensureAdminAgentPermission(List<String> errors) {
        Integer count = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM t_permission WHERE flag='admin_agent'", Integer.class);
        if (count != null && count > 0) return;
        if (!autoMigrate) {
            errors.add("t_permission 缺少 flag=admin_agent");
            return;
        }
        try {
            jdbcTemplate.update("INSERT INTO t_permission (name, description, path, flag) VALUES (?,?,?,?)",
                    "AI管理助手", "使用管理员只读AI助手", "/page/end/admin_agent.html", "admin_agent");
        } catch (RuntimeException ex) {
            errors.add("插入 admin_agent 权限失败: " + ex.getMessage());
        }
    }

    private void validatePetCareRequestIndex(String indexName, List<String> errors) {
        if (!indexExists("t_petcare_request", indexName)) {
            if (!autoMigrate) {
                errors.add("t_petcare_request 缺少索引 " + indexName + " 且 auto-migrate=false");
                return;
            }
            log.warn("SchemaGuard 自动创建索引 t_petcare_request.{}", indexName);
            try {
                jdbcTemplate.execute("ALTER TABLE t_petcare_request ADD UNIQUE INDEX "
                        + indexName + " (user_id, request_id)");
            } catch (Exception e) {
                errors.add("创建索引 t_petcare_request." + indexName + " 失败: " + e.getMessage());
            }
            return;
        }
        Integer uniqueCheck = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() "
                        + "AND TABLE_NAME = 't_petcare_request' AND INDEX_NAME = ? "
                        + "AND NON_UNIQUE = 0 AND SEQ_IN_INDEX = 1 AND COLUMN_NAME = 'user_id'",
                Integer.class, indexName);
        Integer secondColumn = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() "
                        + "AND TABLE_NAME = 't_petcare_request' AND INDEX_NAME = ? "
                        + "AND SEQ_IN_INDEX = 2 AND COLUMN_NAME = 'request_id'",
                Integer.class, indexName);
        Integer totalColumns = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() "
                        + "AND TABLE_NAME = 't_petcare_request' AND INDEX_NAME = ?",
                Integer.class, indexName);
        if (!Integer.valueOf(1).equals(uniqueCheck)
                || !Integer.valueOf(1).equals(secondColumn)
                || !Integer.valueOf(2).equals(totalColumns)) {
            errors.add("t_petcare_request." + indexName + " 必须是唯一索引 (user_id, request_id)，"
                    + "当前列定义不正确；请手工 DROP INDEX " + indexName + " 后重启自动修复");
        }
    }

    private void ensureIndex(String table, String index, String alterSql, List<String> errors) {
        if (!tableExists(table)) {
            return;
        }
        if (indexExists(table, index)) {
            return;
        }
        if (!autoMigrate) {
            errors.add(table + " 缺少索引 " + index + " 且 auto-migrate=false（见 docs/sql/2026-07-27-help-chat-index.sql）");
            return;
        }
        log.warn("SchemaGuard 自动创建索引 {}.{}", table, index);
        try {
            jdbcTemplate.execute(alterSql);
        } catch (Exception e) {
            errors.add("创建索引 " + table + "." + index + " 失败: " + e.getMessage());
        }
    }

    private void ensureFileAssetIndex(String index, String alterSql, List<String> errors) {
        if (indexExists("t_file_asset", index)) {
            return;
        }
        if (!autoMigrate) {
            errors.add("t_file_asset 缺少索引 " + index + " 且 auto-migrate=false");
            return;
        }
        try {
            jdbcTemplate.execute(alterSql);
        } catch (Exception e) {
            errors.add("补齐 t_file_asset 索引 " + index + " 失败: " + e.getMessage());
        }
    }

    private void validateFileAssetStorageContract(List<String> errors) {
        String engine = jdbcTemplate.query(
                "SELECT ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?",
                rs -> rs.next() ? rs.getString(1) : null, "t_file_asset");
        if (!"InnoDB".equalsIgnoreCase(engine)) {
            errors.add("t_file_asset 必须使用 InnoDB 以保证 FOR UPDATE 与事务语义");
        }
        Integer uniqueFlag = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() "
                        + "AND TABLE_NAME = 't_file_asset' AND INDEX_NAME = 'uk_file_flag' "
                        + "AND NON_UNIQUE = 0 AND SEQ_IN_INDEX = 1 AND COLUMN_NAME = 'flag'",
                Integer.class);
        if (!Integer.valueOf(1).equals(uniqueFlag)) {
            errors.add("t_file_asset.uk_file_flag 必须是 flag 上的唯一索引");
        }
        Integer uniqueFlagColumns = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() "
                        + "AND TABLE_NAME = 't_file_asset' AND INDEX_NAME = 'uk_file_flag'",
                Integer.class);
        if (!Integer.valueOf(1).equals(uniqueFlagColumns)) {
            errors.add("t_file_asset.uk_file_flag 必须且只能包含 flag");
        }
        Integer primaryId = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() "
                        + "AND TABLE_NAME = 't_file_asset' AND INDEX_NAME = 'PRIMARY' "
                        + "AND NON_UNIQUE = 0 AND SEQ_IN_INDEX = 1 AND COLUMN_NAME = 'id'",
                Integer.class);
        if (!Integer.valueOf(1).equals(primaryId)) {
            errors.add("t_file_asset 主键必须是 id");
        }
        Integer primaryColumns = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() "
                        + "AND TABLE_NAME = 't_file_asset' AND INDEX_NAME = 'PRIMARY'",
                Integer.class);
        if (!Integer.valueOf(1).equals(primaryColumns)) {
            errors.add("t_file_asset 主键必须且只能包含 id");
        }
    }

    private void ensureAccountDecimal(List<String> errors) {
        if (!tableExists("t_account") || !columnExists("t_account", "avalue")) {
            return;
        }
        String type = dataType("t_account", "avalue");
        Integer precision = numericMetadata("NUMERIC_PRECISION");
        Integer scale = numericMetadata("NUMERIC_SCALE");
        if ("decimal".equalsIgnoreCase(type) && Integer.valueOf(19).equals(precision)
                && Integer.valueOf(2).equals(scale)) {
            return;
        }
        String mismatch = "t_account.avalue 应为 DECIMAL(19,2)，当前=" + type
                + "(" + precision + "," + scale + ")";
        if (!autoMigrate || !isDevelopmentProfile()) {
            errors.add(mismatch + "；仅 dev/test 允许自动迁移，请执行 docs/sql/2026-07-23-account-decimal.sql");
            return;
        }
        Integer invalid = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM t_account WHERE avalue IS NULL OR avalue <> avalue "
                        + "OR ABS(CAST(avalue AS DECIMAL(65,10))) "
                        + "> CAST('99999999999999999.99' AS DECIMAL(65,10))", Integer.class);
        if (invalid != null && invalid > 0) {
            errors.add("t_account.avalue 存在 " + invalid + " 条空值、非有限或超出 DECIMAL(19,2) 范围的数据，拒绝自动迁移");
            return;
        }
        log.warn("SchemaGuard 将 t_account.avalue 迁移为 DECIMAL(19,2)：由单条 ALTER TABLE 完成转换");
        try {
            jdbcTemplate.execute("ALTER TABLE t_account MODIFY COLUMN avalue DECIMAL(19,2) NOT NULL COMMENT '款项金额'");
        } catch (Exception e) {
            errors.add("迁移 t_account.avalue 为 DECIMAL(19,2) 失败: " + e.getMessage());
        }
    }

    private void ensureAnimalBirthdayNullable(List<String> errors) {
        if (!tableExists("t_animal") || !columnExists("t_animal", "tbirthday")) {
            return;
        }
        String nullable = jdbcTemplate.query(
                "SELECT IS_NULLABLE FROM information_schema.COLUMNS "
                        + "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 't_animal' AND COLUMN_NAME = 'tbirthday'",
                rs -> rs.next() ? rs.getString(1) : null);
        if ("YES".equalsIgnoreCase(nullable)) {
            return;
        }
        if (!autoMigrate) {
            errors.add("t_animal.tbirthday 应允许 NULL 表示生日未知（见 docs/sql/2026-07-23-animal-birthday-nullable.sql）");
            return;
        }
        try {
            jdbcTemplate.execute("ALTER TABLE t_animal MODIFY COLUMN tbirthday DATE NULL DEFAULT NULL COMMENT '动物生日（未知时为空）'");
        } catch (Exception e) {
            errors.add("迁移 t_animal.tbirthday 为可空失败: " + e.getMessage());
        }
    }

    private Integer numericMetadata(String field) {
        return jdbcTemplate.query(
                "SELECT " + field + " FROM information_schema.COLUMNS "
                        + "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 't_account' AND COLUMN_NAME = 'avalue'",
                rs -> {
                    if (!rs.next()) return null;
                    Object value = rs.getObject(1);
                    return value instanceof Number ? ((Number) value).intValue() : null;
                });
    }

    private boolean isDevelopmentProfile() {
        if (activeProfiles == null) return false;
        return Arrays.stream(activeProfiles.split(","))
                .map(String::trim)
                .anyMatch(profile -> "dev".equalsIgnoreCase(profile) || "test".equalsIgnoreCase(profile));
    }

    private void ensureLightVolunteerRole(List<String> errors) {
        Integer cnt = jdbcTemplate.queryForObject("SELECT COUNT(*) FROM t_role WHERE id = 4", Integer.class);
        if (cnt != null && cnt > 0) {
            return;
        }
        if (!autoMigrate) {
            errors.add("缺少角色 id=4 认证义工");
            return;
        }
        log.warn("SchemaGuard 创建角色 id=4 认证义工");
        try {
            jdbcTemplate.update(
                    "INSERT INTO t_role (id, name, description, permission) VALUES (4, '认证义工', '义工审核通过标记，无后台管理权限', ?)",
                    RoleContracts.ROLE4_PERMISSION_JSON);
        } catch (Exception e) {
            errors.add("创建角色4失败: " + e.getMessage());
        }
    }

    private void ensureRole3HasMyProof(List<String> errors) {
        String permission = jdbcTemplate.query(
                "SELECT permission FROM t_role WHERE id = 3",
                rs -> rs.next() ? rs.getString(1) : null);
        if (permission == null) {
            errors.add("缺少角色 id=3 普通用户");
            return;
        }
        if (permission.contains("\"flag\":\"my_proof\"") || permission.contains("my_proof")) {
            return;
        }
        if (!autoMigrate) {
            errors.add("角色3 缺少 my_proof");
            return;
        }
        log.warn("SchemaGuard 重置角色3为标准用户权限（含 my_proof）");
        try {
            jdbcTemplate.update("UPDATE t_role SET permission = ? WHERE id = 3", RoleContracts.ROLE3_PERMISSION_JSON);
        } catch (Exception e) {
            errors.add("修补角色3失败: " + e.getMessage());
        }
    }

    private void ensurePermissionMyProof(List<String> errors) {
        Integer cnt = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM t_permission WHERE flag = 'my_proof'", Integer.class);
        if (cnt != null && cnt > 0) {
            return;
        }
        if (!autoMigrate) {
            errors.add("t_permission 缺少 flag=my_proof");
            return;
        }
        log.warn("SchemaGuard 插入 t_permission my_proof");
        try {
            jdbcTemplate.update(
                    "INSERT INTO t_permission (id, name, description, path, flag) VALUES "
                            + "(12, '领养凭证入口', '用户端提交和管理自己的领养凭证', '/page/front/adopt_proof.html', 'my_proof') "
                            + "ON DUPLICATE KEY UPDATE flag='my_proof', path='/page/front/adopt_proof.html'");
        } catch (Exception e) {
            // id 冲突时尝试仅按 flag 补
            try {
                jdbcTemplate.update(
                        "INSERT INTO t_permission (name, description, path, flag) VALUES "
                                + "('领养凭证入口', '用户端提交和管理自己的领养凭证', '/page/front/adopt_proof.html', 'my_proof')");
            } catch (Exception e2) {
                errors.add("插入 my_proof 权限失败: " + e2.getMessage());
            }
        }
    }

    private void assertReady(List<String> errors) {
        Map<String, String> required = new LinkedHashMap<>();
        required.put("t_proof.pstatus", "t_proof");
        required.put("t_volunteer.uid", "t_volunteer");
        required.put("t_volunteer.apic", "t_volunteer");
        required.put("t_adopt.version", "t_adopt");
        required.put("t_proof.proof_stage", "t_proof");
        required.put("t_help.outcome", "t_help");
        for (Map.Entry<String, String> e : required.entrySet()) {
            String[] parts = e.getKey().split("\\.");
            if (tableExists(parts[0]) && !columnExists(parts[0], parts[1])) {
                if (!errors.stream().anyMatch(x -> x.contains(e.getKey()))) {
                    errors.add("断言失败: 仍缺少 " + e.getKey());
                }
            }
        }
        Integer role4 = jdbcTemplate.queryForObject("SELECT COUNT(*) FROM t_role WHERE id = 4", Integer.class);
        if (role4 == null || role4 == 0) {
            if (errors.stream().noneMatch(x -> x.contains("角色 id=4"))) {
                errors.add("断言失败: 仍缺少角色 id=4");
            }
        }
        String p3 = jdbcTemplate.query("SELECT permission FROM t_role WHERE id = 3",
                rs -> rs.next() ? rs.getString(1) : null);
        if (p3 == null || !p3.contains("my_proof")) {
            if (errors.stream().noneMatch(x -> x.contains("my_proof") && x.contains("角色"))) {
                errors.add("断言失败: 角色3 仍无 my_proof");
            }
        }
    }

    private boolean tableExists(String table) {
        Integer cnt = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?",
                Integer.class, table);
        return cnt != null && cnt > 0;
    }

    private boolean columnExists(String table, String column) {
        Integer cnt = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?",
                Integer.class, table, column);
        return cnt != null && cnt > 0;
    }

    private boolean indexExists(String table, String index) {
        Integer cnt = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?",
                Integer.class, table, index);
        return cnt != null && cnt > 0;
    }

    private String dataType(String table, String column) {
        return jdbcTemplate.query(
                "SELECT DATA_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?",
                rs -> rs.next() ? rs.getString(1) : null,
                table, column);
    }
}
