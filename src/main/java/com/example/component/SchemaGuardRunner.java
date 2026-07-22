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
    public static final String SCHEMA_VERSION = "2026.07.21-file-v1";

    private final JdbcTemplate jdbcTemplate;

    @Value("${app.schema-guard.enabled:true}")
    private boolean enabled;

    @Value("${app.schema-guard.fail-fast:false}")
    private boolean failFast;

    @Value("${app.schema-guard.auto-migrate:true}")
    private boolean autoMigrate;

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

            ensureFileAssetTable(errors);

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
                if (failFast) {
                    throw new IllegalStateException("[SchemaGuard] " + msg);
                }
                return;
            }
            writeSchemaVersion();
            log.info("SchemaGuard 通过，契约版本已写入 app_schema_meta.version={}", SCHEMA_VERSION);
        } catch (IllegalStateException ex) {
            throw ex;
        } catch (RuntimeException ex) {
            log.error("SchemaGuard 异常: {}", ex.getMessage(), ex);
            if (failFast) {
                throw ex;
            }
        }
    }

    private void ensureMetaTable() {
        jdbcTemplate.execute(
                "CREATE TABLE IF NOT EXISTS app_schema_meta ("
                        + "meta_key VARCHAR(64) NOT NULL PRIMARY KEY,"
                        + "meta_value VARCHAR(255) NOT NULL,"
                        + "updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP"
                        + ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    }

    private void ensureFileAssetTable(List<String> errors) {
        if (tableExists("t_file_asset")) {
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
                            + "flag VARCHAR(64) NOT NULL,"
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
                            + "UNIQUE KEY uk_file_flag (flag)"
                            + ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
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

    private String dataType(String table, String column) {
        return jdbcTemplate.query(
                "SELECT DATA_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?",
                rs -> rs.next() ? rs.getString(1) : null,
                table, column);
    }
}
