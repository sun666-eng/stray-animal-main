package com.example.component;

import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.util.Arrays;

import static org.junit.jupiter.api.Assertions.assertTrue;

class BootstrapSqlSafetyTest {
    @Test
    void accountPrechecksPrecedeSingleNonDestructiveAlter() throws Exception {
        String sql = new String(Files.readAllBytes(Paths.get("docs/sql/bootstrap-all.sql")), StandardCharsets.UTF_8);
        int nullCheck = sql.indexOf("avalue IS NULL");
        int nonfiniteCheck = sql.indexOf("avalue <> avalue");
        int rangeCheck = sql.indexOf("ABS(CAST(avalue AS DECIMAL(65,10)))");
        int signal = sql.indexOf("SIGNAL SQLSTATE '45000'", nullCheck);
        int alter = sql.indexOf("ALTER TABLE t_account");
        assertTrue(nullCheck >= 0 && nonfiniteCheck > nullCheck && rangeCheck > nonfiniteCheck);
        assertTrue(signal > rangeCheck && alter > signal);
        assertTrue(!sql.contains("UPDATE t_account SET avalue = ROUND(avalue, 2)"));
        assertTrue(sql.contains("CAST('99999999999999999.99' AS DECIMAL(65,10))"));
        assertTrue(sql.contains("IF NOT (current_type = 'decimal' AND current_precision = 19 AND current_scale = 2)"));
        assertTrue(sql.contains("MODIFY COLUMN tbirthday DATE NULL DEFAULT NULL"));
    }

    @Test
    void petCareSqlMatchesSchemaGuardAndGuardsAlterStatements() throws Exception {
        String version = SchemaGuardRunner.SCHEMA_VERSION;
        for (String file : Arrays.asList(
                "docs/sql/bootstrap-all.sql",
                "docs/sql/2026-07-27-petcare-chat.sql",
                "docs/sql/2026-07-27-petcare-conversations.sql",
                "docs/sql/2026-07-27-petcare-ai-config.sql",
                "docs/sql/2026-07-27-petcare-request.sql",
                "docs/sql/2026-07-28-admin-agent.sql",
                "docs/sql/2026-07-26-role-permission.sql",
                "docs/sql/2026-07-27-help-chat-index.sql")) {
            String sql = readSql(file);
            assertTrue(sql.contains(version), file + " must identify the active schema contract");
        }

        String conversations = readSql("docs/sql/2026-07-27-petcare-conversations.sql");
        assertTrue(conversations.contains("@table_exists = 1 AND @exists = 0"));
        assertTrue(conversations.contains("TABLE_NAME = 't_petcare_chat'"));
        assertTrue(conversations.contains("TABLE_NAME = 't_petcare_ai_config'"));

        String bootstrap = readSql("docs/sql/bootstrap-all.sql");
        assertTrue(bootstrap.contains("CREATE TABLE IF NOT EXISTS role_permission"));
        assertTrue(bootstrap.contains("idx_help_chat (title, create_time, id)"));
        assertTrue(bootstrap.contains("idx_help_uid (uid)"));
        assertTrue(bootstrap.contains("idx_petcare_conversation (user_id, conversation_id, id)"));
        assertTrue(bootstrap.contains("UNIQUE KEY uk_petcare_request_user (user_id, request_id)"));
        assertTrue(bootstrap.contains("requested_conversation_known TINYINT(1) DEFAULT NULL"));
        assertTrue(bootstrap.contains("v5标记：true=新请求，NULL=旧未知来源"));
        assertTrue(bootstrap.contains("requested_conversation_id BIGINT DEFAULT NULL"));
        assertTrue(bootstrap.contains("SET requested_conversation_id = conversation_id"));
        assertTrue(bootstrap.contains("version BIGINT NOT NULL DEFAULT 1"));
        assertTrue(bootstrap.contains("CREATE TABLE IF NOT EXISTS t_admin_agent_config"));
        assertTrue(bootstrap.contains("UNIQUE KEY uk_admin_agent_request (user_id, request_id)"));
        assertTrue(bootstrap.contains("CREATE TABLE IF NOT EXISTS t_admin_agent_adopt_draft"));
        assertTrue(bootstrap.contains("UNIQUE KEY uk_admin_agent_draft_application (actor_id, animal_id, applicant_id)"));
        assertTrue(bootstrap.contains("final_request_id VARCHAR(64) DEFAULT NULL"));
        assertTrue(bootstrap.contains("final_decision VARCHAR(12) DEFAULT NULL"));
        assertTrue(bootstrap.contains("override_reason VARCHAR(500) NOT NULL DEFAULT ''"));
        assertTrue(bootstrap.contains("UNIQUE KEY uk_admin_agent_draft_final_request (actor_id, final_request_id)"));
        assertTrue(bootstrap.contains("CREATE TABLE IF NOT EXISTS t_admin_agent_automation_config"));
        assertTrue(bootstrap.contains("mode VARCHAR(16) NOT NULL DEFAULT 'shadow'"));
        assertTrue(bootstrap.contains("UNIQUE KEY uk_admin_agent_automation_request (actor_id, request_id)"));
        assertTrue(bootstrap.contains("UNIQUE KEY uk_admin_agent_automation_item (run_id, animal_id, applicant_id)"));
        assertTrue(bootstrap.contains("flag = 'admin_agent'"));
    }

    @Test
    void incrementalRoleAndHelpSqlRepairsOldTablesIdempotently() throws Exception {
        String role = readSql("docs/sql/2026-07-26-role-permission.sql");
        assertTrue(role.contains("ADD COLUMN role_id BIGINT NOT NULL"));
        assertTrue(role.contains("ADD COLUMN permission_id BIGINT NOT NULL"));
        assertTrue(role.contains("ADD PRIMARY KEY (role_id, permission_id)"));
        assertTrue(role.contains("ADD INDEX idx_rp_permission (permission_id)"));
        assertTrue(role.contains("@table_exists = 1 AND @exists = 0"));

        String help = readSql("docs/sql/2026-07-27-help-chat-index.sql");
        assertTrue(help.contains("@table_exists = 1 AND @required_columns = 3 AND @exists = 0"));
        assertTrue(help.contains("@table_exists = 1 AND @required_columns = 1 AND @exists = 0"));
        assertTrue(help.contains("information_schema.STATISTICS"));
    }

    private String readSql(String path) throws Exception {
        return new String(Files.readAllBytes(Paths.get(path)), StandardCharsets.UTF_8);
    }
}
