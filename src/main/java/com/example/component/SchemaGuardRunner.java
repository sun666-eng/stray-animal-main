package com.example.component;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.annotation.Order;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/**
 * 启动时校验并自动补齐闭环必需的库结构，避免「只导 test.sql / 漏跑增量 SQL」导致运行期 Unknown column。
 * <p>
 * 默认开启；可通过 app.schema-guard.enabled=false 关闭。
 * app.schema-guard.fail-fast=true 时，无法修复的结构问题会阻止启动。
 */
@Slf4j
@Component
@Order(0)
public class SchemaGuardRunner implements ApplicationRunner {

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
        log.info("SchemaGuard 开始检查闭环必需结构…");
        try {
            ensureColumn("t_proof", "pstatus",
                    "ALTER TABLE t_proof ADD COLUMN pstatus INT NOT NULL DEFAULT 0 COMMENT '0待审核 1已通过 2已驳回' AFTER ptitle");
            ensureColumn("t_volunteer", "uid",
                    "ALTER TABLE t_volunteer ADD COLUMN uid BIGINT NULL DEFAULT NULL COMMENT '申请用户ID' AFTER vstate");
            ensureColumn("t_volunteer", "apic",
                    "ALTER TABLE t_volunteer ADD COLUMN apic VARCHAR(255) NULL DEFAULT NULL COMMENT '本人免冠照文件flag' AFTER uid");
            ensureTextColumn("t_role", "permission");
            ensureTextColumn("t_user", "role");
            ensureLightVolunteerRole();
            ensureRole3HasMyProof();
            log.info("SchemaGuard 检查完成");
        } catch (RuntimeException ex) {
            log.error("SchemaGuard 失败: {}", ex.getMessage(), ex);
            if (failFast) {
                throw ex;
            }
        }
    }

    private void ensureColumn(String table, String column, String alterSql) {
        if (columnExists(table, column)) {
            return;
        }
        if (!autoMigrate) {
            failOrWarn("缺少列 " + table + "." + column + "，且 auto-migrate=false");
            return;
        }
        log.warn("SchemaGuard 自动补齐 {}.{}", table, column);
        jdbcTemplate.execute(alterSql);
    }

    private void ensureTextColumn(String table, String column) {
        String type = jdbcTemplate.query(
                "SELECT DATA_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?",
                rs -> rs.next() ? rs.getString(1) : null,
                table, column);
        if (type == null) {
            failOrWarn("缺少列 " + table + "." + column);
            return;
        }
        if ("text".equalsIgnoreCase(type) || "longtext".equalsIgnoreCase(type) || "mediumtext".equalsIgnoreCase(type)) {
            return;
        }
        if (!autoMigrate) {
            failOrWarn(table + "." + column + " 建议为 TEXT 以容纳权限 JSON，当前类型=" + type);
            return;
        }
        log.warn("SchemaGuard 将 {}.{} 扩展为 TEXT（原类型 {}）", table, column, type);
        jdbcTemplate.execute("ALTER TABLE " + table + " MODIFY COLUMN " + column + " TEXT");
    }

    private void ensureLightVolunteerRole() {
        Integer cnt = jdbcTemplate.queryForObject("SELECT COUNT(*) FROM t_role WHERE id = 4", Integer.class);
        if (cnt != null && cnt > 0) {
            return;
        }
        if (!autoMigrate) {
            failOrWarn("缺少角色 id=4 认证义工（app.volunteer.auto-grant-role-id 默认 4）");
            return;
        }
        log.warn("SchemaGuard 创建角色 id=4 认证义工（无后台权限）");
        jdbcTemplate.update(
                "INSERT INTO t_role (id, name, description, permission) VALUES (4, '认证义工', '义工审核通过标记，无后台管理权限', '[]')");
    }

    /**
     * 角色 3 必须包含 my_proof，否则普通用户无法上传凭证。
     */
    private void ensureRole3HasMyProof() {
        String permission = jdbcTemplate.query(
                "SELECT permission FROM t_role WHERE id = 3",
                rs -> rs.next() ? rs.getString(1) : null);
        if (permission == null) {
            failOrWarn("缺少角色 id=3 普通用户");
            return;
        }
        if (permission.contains("my_proof")) {
            return;
        }
        if (!autoMigrate) {
            failOrWarn("角色 3 权限 JSON 缺少 my_proof");
            return;
        }
        // 追加标准 my_proof 片段（若 JSON 为空数组则重建最小用户权限集）
        String snippet = "{\"id\":12,\"name\":\"领养凭证入口\",\"path\":\"/page/front/adopt_proof.html\","
                + "\"description\":\"用户端提交和管理自己的领养凭证\",\"flag\":\"my_proof\"}";
        String updated;
        String trimmed = permission.trim();
        if ("[]".equals(trimmed) || trimmed.isEmpty()) {
            updated = "[" + snippet + "]";
        } else if (trimmed.endsWith("]")) {
            String body = trimmed.substring(0, trimmed.length() - 1).trim();
            if (body.endsWith("[" ) || body.isEmpty() || body.equals("[")) {
                updated = "[" + snippet + "]";
            } else {
                updated = body + "," + snippet + "]";
            }
        } else {
            failOrWarn("角色 3 permission JSON 无法安全修补");
            return;
        }
        log.warn("SchemaGuard 为角色 3 补齐 my_proof");
        jdbcTemplate.update("UPDATE t_role SET permission = ? WHERE id = 3", updated);
    }

    private boolean columnExists(String table, String column) {
        Integer cnt = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?",
                Integer.class, table, column);
        return cnt != null && cnt > 0;
    }

    private void failOrWarn(String message) {
        if (failFast) {
            throw new IllegalStateException("[SchemaGuard] " + message);
        }
        log.error("[SchemaGuard] {}", message);
    }
}
