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
    public static final String SCHEMA_VERSION = "2026.07.24-file-collation-v3";

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
