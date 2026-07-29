package com.example.component;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentMatchers;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.ResultSetExtractor;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.HashSet;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 契约：SchemaGuard 在缺 pstatus / apic 时必须执行 DDL 修复。
 */
@ExtendWith(MockitoExtension.class)
public class SchemaGuardRunnerTest {

    @Mock
    JdbcTemplate jdbcTemplate;

    @InjectMocks
    SchemaGuardRunner guard;

    @Test
    public void schemaVersionConstant_isStable() {
        assertEquals("2026.07.29-workflow-closure-p0-v10", SchemaGuardRunner.SCHEMA_VERSION);
    }

    @Test
    public void missingPetCareHistoryTable_isCreatedInAutoMigrateMode() {
        ReflectionTestUtils.setField(guard, "autoMigrate", true);
        when(jdbcTemplate.queryForObject(
                contains("information_schema.TABLES"), eq(Integer.class), eq("t_petcare_chat")))
                .thenReturn(0);

        java.util.List<String> errors = new java.util.ArrayList<>();
        ReflectionTestUtils.invokeMethod(guard, "ensurePetCareHistoryTable", errors);

        verify(jdbcTemplate).execute(contains("CREATE TABLE IF NOT EXISTS t_petcare_chat"));
        verify(jdbcTemplate).execute(contains("conversation_id BIGINT"));
        assertTrue(errors.isEmpty());
    }

    @Test
    public void missingPetCareAiConfigTable_isCreatedInAutoMigrateMode() {
        ReflectionTestUtils.setField(guard, "autoMigrate", true);
        when(jdbcTemplate.queryForObject(
                contains("information_schema.TABLES"), eq(Integer.class), eq("t_petcare_ai_config")))
                .thenReturn(0);

        java.util.List<String> errors = new java.util.ArrayList<>();
        ReflectionTestUtils.invokeMethod(guard, "ensurePetCareAiConfigTable", errors);

        verify(jdbcTemplate).execute(contains("CREATE TABLE IF NOT EXISTS t_petcare_ai_config"));
        verify(jdbcTemplate).execute(contains("connection_status VARCHAR"));
        assertTrue(errors.isEmpty());
    }

    @Test
    public void missingPetCareConversationTable_isCreatedInAutoMigrateMode() {
        ReflectionTestUtils.setField(guard, "autoMigrate", true);
        when(jdbcTemplate.queryForObject(
                contains("information_schema.TABLES"), eq(Integer.class),
                eq("t_petcare_conversation"))).thenReturn(0);

        java.util.List<String> errors = new java.util.ArrayList<>();
        ReflectionTestUtils.invokeMethod(guard, "ensurePetCareConversationTable", errors);

        verify(jdbcTemplate).execute(
                contains("CREATE TABLE IF NOT EXISTS t_petcare_conversation"));
        assertTrue(errors.isEmpty());
    }

    @Test
    public void missingPetCareRequestTable_isCreatedWithIdempotencyKey() {
        ReflectionTestUtils.setField(guard, "autoMigrate", true);
        when(jdbcTemplate.queryForObject(
                contains("information_schema.TABLES"), eq(Integer.class),
                eq("t_petcare_request"))).thenReturn(0);
        java.util.List<String> errors = new java.util.ArrayList<>();

        ReflectionTestUtils.invokeMethod(guard, "ensurePetCareRequestTable", errors);

        verify(jdbcTemplate).execute(contains("UNIQUE KEY uk_petcare_request_user"));
        verify(jdbcTemplate).execute(contains("requested_conversation_id BIGINT"));
        assertTrue(errors.isEmpty());
    }

    @Test
    public void missingAdminAgentTables_areCreatedWithAuditAndIdempotency() {
        ReflectionTestUtils.setField(guard, "autoMigrate", true);
        when(jdbcTemplate.queryForObject(contains("information_schema.TABLES"), eq(Integer.class),
                anyString())).thenReturn(0);
        java.util.List<String> errors = new java.util.ArrayList<>();

        ReflectionTestUtils.invokeMethod(guard, "ensureAdminAgentTables", errors);

        verify(jdbcTemplate).execute(contains("CREATE TABLE IF NOT EXISTS t_admin_agent_config"));
        verify(jdbcTemplate).execute(contains("UNIQUE KEY uk_admin_agent_request"));
        verify(jdbcTemplate).execute(contains("CREATE TABLE IF NOT EXISTS t_admin_agent_audit"));
        verify(jdbcTemplate).execute(contains("CREATE TABLE IF NOT EXISTS t_admin_agent_adopt_draft"));
        verify(jdbcTemplate).execute(contains("CREATE TABLE IF NOT EXISTS t_admin_agent_automation_config"));
        verify(jdbcTemplate).execute(contains("CREATE TABLE IF NOT EXISTS t_admin_agent_automation_run"));
        verify(jdbcTemplate).execute(contains("CREATE TABLE IF NOT EXISTS t_admin_agent_automation_item"));
        assertTrue(errors.isEmpty());
    }

    @Test
    public void petCareRequestPureCheck_neverBackfillsRequestedConversationId() {
        ReflectionTestUtils.setField(guard, "autoMigrate", false);
        when(jdbcTemplate.queryForObject(
                contains("information_schema.TABLES"), eq(Integer.class),
                eq("t_petcare_request"))).thenReturn(1);
        when(jdbcTemplate.queryForObject(
                contains("information_schema.COLUMNS"), eq(Integer.class),
                eq("t_petcare_request"), anyString())).thenAnswer(inv -> {
            return 1;
        });
        when(jdbcTemplate.queryForObject(
                contains("information_schema.STATISTICS"), eq(Integer.class),
                eq("t_petcare_request"), eq("uk_petcare_request_user"))).thenReturn(1);
        // 先定义总列数，再定义更精确的列位置；Mockito 后定义的精确规则优先。
        when(jdbcTemplate.queryForObject(
                contains("TABLE_NAME = 't_petcare_request' AND INDEX_NAME = ?"),
                eq(Integer.class), eq("uk_petcare_request_user"))).thenReturn(2);
        when(jdbcTemplate.queryForObject(
                contains("NON_UNIQUE = 0 AND SEQ_IN_INDEX = 1 AND COLUMN_NAME = 'user_id'"),
                eq(Integer.class), eq("uk_petcare_request_user"))).thenReturn(1);
        when(jdbcTemplate.queryForObject(
                contains("SEQ_IN_INDEX = 2 AND COLUMN_NAME = 'request_id'"),
                eq(Integer.class), eq("uk_petcare_request_user"))).thenReturn(1);
        when(jdbcTemplate.queryForObject(
                contains("information_schema.STATISTICS"), eq(Integer.class),
                eq("t_petcare_request"), eq("idx_petcare_request_status"))).thenReturn(1);

        java.util.List<String> errors = new java.util.ArrayList<>();
        ReflectionTestUtils.invokeMethod(guard, "ensurePetCareRequestTable", errors);

        verify(jdbcTemplate, never()).update(contains("UPDATE t_petcare_request"));
        assertTrue(errors.isEmpty());
    }

    @Test
    @SuppressWarnings("unchecked")
    public void run_whenMissingPstatusAndApic_executesAlterAndPasses() {
        ReflectionTestUtils.setField(guard, "enabled", true);
        ReflectionTestUtils.setField(guard, "autoMigrate", true);
        ReflectionTestUtils.setField(guard, "failFast", false);
        ReflectionTestUtils.setField(guard, "activeProfiles", "dev");

        Set<String> repaired = new HashSet<>();

        when(jdbcTemplate.queryForObject(contains("information_schema.TABLES"), eq(Integer.class), anyString()))
                .thenReturn(1);

        when(jdbcTemplate.queryForObject(contains("information_schema.COLUMNS"), eq(Integer.class), anyString(), anyString()))
                .thenAnswer(inv -> {
                    String col = inv.getArgument(3);
                    if ("pstatus".equals(col) || "apic".equals(col)) {
                        return repaired.contains(col) ? 1 : 0;
                    }
                    if ("requested_conversation_known".equals(col)) {
                        return 1;
                    }
                    return 1;
                });

        // 精确匹配 String 重载，避免 char[] 等其它 execute 签名
        doAnswer(inv -> {
            String sql = inv.getArgument(0, String.class);
            if (sql != null && sql.contains("pstatus")) {
                repaired.add("pstatus");
            }
            if (sql != null && sql.contains("apic")) {
                repaired.add("apic");
            }
            return null;
        }).when(jdbcTemplate).execute(ArgumentMatchers.any(String.class));

        when(jdbcTemplate.query(contains("DATA_TYPE"), any(ResultSetExtractor.class), any(), any()))
                .thenAnswer(inv -> {
                    Object table = inv.getArgument(2);
                    return "t_account".equals(table) ? "decimal" : "text";
                });
        when(jdbcTemplate.queryForObject(contains("information_schema.STATISTICS"), eq(Integer.class), anyString(), anyString()))
                .thenReturn(1);
        when(jdbcTemplate.queryForObject(contains("INDEX_NAME = 'uk_file_flag'"), eq(Integer.class)))
                .thenReturn(1);
        when(jdbcTemplate.queryForObject(contains("INDEX_NAME = 'PRIMARY'"), eq(Integer.class)))
                .thenReturn(1);
        when(jdbcTemplate.query(contains("SELECT ENGINE"), any(ResultSetExtractor.class), eq("t_file_asset")))
                .thenReturn("InnoDB");
        when(jdbcTemplate.queryForObject(contains("FROM t_"), eq(Long.class)))
                .thenReturn(0L);
        when(jdbcTemplate.queryForObject(contains("TRIM(avatar) = '1'"), eq(Long.class)))
                .thenReturn(0L);
        when(jdbcTemplate.query(contains("NUMERIC_PRECISION"), any(ResultSetExtractor.class)))
                .thenReturn(19);
        when(jdbcTemplate.query(contains("NUMERIC_SCALE"), any(ResultSetExtractor.class)))
                .thenReturn(2);
        when(jdbcTemplate.query(contains("IS_NULLABLE"), any(ResultSetExtractor.class)))
                .thenReturn("YES");
        when(jdbcTemplate.query(contains("CHARACTER_MAXIMUM_LENGTH"), any(ResultSetExtractor.class), any(), any()))
                .thenReturn(255L);
        when(jdbcTemplate.query(contains("CHARACTER_SET_NAME"), any(ResultSetExtractor.class), any(), any()))
                .thenReturn("utf8mb4");
        when(jdbcTemplate.query(contains("COLLATION_NAME"), any(ResultSetExtractor.class), any(), any()))
                .thenReturn(new String[]{"utf8mb4", "utf8mb4_unicode_ci"});
        when(jdbcTemplate.queryForObject(contains("TABLE_NAME = 't_petcare_request' AND INDEX_NAME = ?"),
                eq(Integer.class), anyString())).thenReturn(2);
        when(jdbcTemplate.queryForObject(contains("NON_UNIQUE = 0 AND SEQ_IN_INDEX = 1 AND COLUMN_NAME = 'user_id'"),
                eq(Integer.class), anyString())).thenReturn(1);
        when(jdbcTemplate.queryForObject(contains("SEQ_IN_INDEX = 2 AND COLUMN_NAME = 'request_id'"),
                eq(Integer.class), anyString())).thenReturn(1);
        when(jdbcTemplate.queryForObject(contains("FROM t_role WHERE id = 4"), eq(Integer.class)))
                .thenReturn(1);
        when(jdbcTemplate.queryForObject(contains("flag='admin_agent'"), eq(Integer.class)))
                .thenReturn(1);
        when(jdbcTemplate.query(contains("FROM t_role WHERE id = 3"), any(ResultSetExtractor.class)))
                .thenReturn("[{\"flag\":\"my_proof\"}]");
        when(jdbcTemplate.queryForObject(contains("flag = 'my_proof'"), eq(Integer.class)))
                .thenReturn(1);
        when(jdbcTemplate.update(contains("app_schema_meta"), anyString())).thenReturn(1);

        assertDoesNotThrow(() -> guard.run(null));
        verify(jdbcTemplate, atLeastOnce()).execute(contains("pstatus"));
        verify(jdbcTemplate, atLeastOnce()).execute(contains("apic"));
        verify(jdbcTemplate, atLeastOnce()).update(contains("app_schema_meta"), anyString());
    }

    @Test
    @SuppressWarnings("unchecked")
    public void run_mixedFileReferenceCollations_migratesBeforeReferenceChecks() {
        ReflectionTestUtils.setField(guard, "enabled", true);
        ReflectionTestUtils.setField(guard, "autoMigrate", true);
        ReflectionTestUtils.setField(guard, "failFast", false);
        ReflectionTestUtils.setField(guard, "activeProfiles", "dev");

        when(jdbcTemplate.queryForObject(contains("information_schema.TABLES"), eq(Integer.class), anyString()))
                .thenReturn(1);
        when(jdbcTemplate.queryForObject(contains("information_schema.COLUMNS"), eq(Integer.class), anyString(), anyString()))
                .thenAnswer(inv -> {
                    String col = inv.getArgument(3);
                    return ("requested_conversation_known".equals(col)) ? 1 : 1;
                });
        when(jdbcTemplate.query(contains("DATA_TYPE"), any(ResultSetExtractor.class), any(), any()))
                .thenAnswer(inv -> "t_account".equals(inv.getArgument(2)) ? "decimal" : "text");
        when(jdbcTemplate.query(contains("NUMERIC_PRECISION"), any(ResultSetExtractor.class))).thenReturn(19);
        when(jdbcTemplate.query(contains("NUMERIC_SCALE"), any(ResultSetExtractor.class))).thenReturn(2);
        when(jdbcTemplate.query(contains("IS_NULLABLE"), any(ResultSetExtractor.class))).thenReturn("YES");
        when(jdbcTemplate.query(contains("CHARACTER_MAXIMUM_LENGTH"), any(ResultSetExtractor.class), any(), any()))
                .thenReturn(255L);
        when(jdbcTemplate.query(contains("CHARACTER_SET_NAME"), any(ResultSetExtractor.class), any(), any()))
                .thenReturn("utf8mb4");
        when(jdbcTemplate.query(contains("COLLATION_NAME"), any(ResultSetExtractor.class), any(), any()))
                .thenReturn(new String[]{"utf8mb4", "utf8mb4_0900_ai_ci"});
        when(jdbcTemplate.queryForObject(contains("TABLE_NAME = 't_petcare_request' AND INDEX_NAME = ?"),
                eq(Integer.class), anyString())).thenReturn(2);
        when(jdbcTemplate.queryForObject(contains("NON_UNIQUE = 0 AND SEQ_IN_INDEX = 1 AND COLUMN_NAME = 'user_id'"),
                eq(Integer.class), anyString())).thenReturn(1);
        when(jdbcTemplate.queryForObject(contains("SEQ_IN_INDEX = 2 AND COLUMN_NAME = 'request_id'"),
                eq(Integer.class), anyString())).thenReturn(1);
        when(jdbcTemplate.queryForObject(contains("information_schema.STATISTICS"), eq(Integer.class), anyString(), anyString()))
                .thenReturn(1);
        when(jdbcTemplate.queryForObject(contains("INDEX_NAME = 'uk_file_flag'"), eq(Integer.class))).thenReturn(1);
        when(jdbcTemplate.queryForObject(contains("INDEX_NAME = 'PRIMARY'"), eq(Integer.class))).thenReturn(1);
        when(jdbcTemplate.query(contains("SELECT ENGINE"), any(ResultSetExtractor.class), eq("t_file_asset")))
                .thenReturn("InnoDB");
        when(jdbcTemplate.queryForObject(contains("FROM t_"), eq(Long.class))).thenReturn(0L);
        when(jdbcTemplate.queryForObject(contains("TRIM(avatar) = '1'"), eq(Long.class))).thenReturn(9L);
        when(jdbcTemplate.queryForObject(contains("FROM t_role WHERE id = 4"), eq(Integer.class))).thenReturn(1);
        when(jdbcTemplate.queryForObject(contains("flag='admin_agent'"), eq(Integer.class))).thenReturn(1);
        when(jdbcTemplate.query(contains("FROM t_role WHERE id = 3"), any(ResultSetExtractor.class)))
                .thenReturn("[{\"flag\":\"my_proof\"}]");
        when(jdbcTemplate.queryForObject(contains("flag = 'my_proof'"), eq(Integer.class))).thenReturn(1);
        when(jdbcTemplate.update(contains("app_schema_meta"), anyString())).thenReturn(1);
        when(jdbcTemplate.update("UPDATE t_user SET avatar = NULL WHERE TRIM(avatar) = '1'"))
                .thenReturn(9);

        assertDoesNotThrow(() -> guard.run(null));

        org.mockito.InOrder order = inOrder(jdbcTemplate);
        order.verify(jdbcTemplate, atLeastOnce()).execute(contains("MODIFY COLUMN flag VARCHAR(64)"));
        order.verify(jdbcTemplate, atLeastOnce()).queryForObject(contains("FROM t_animal a"), eq(Long.class));
        verify(jdbcTemplate).execute(contains("MODIFY COLUMN avatar VARCHAR(255)"));
        verify(jdbcTemplate).execute(contains("MODIFY COLUMN tpic VARCHAR(255)"));
        verify(jdbcTemplate).execute(contains("MODIFY COLUMN ppic VARCHAR(255)"));
        verify(jdbcTemplate).execute(contains("MODIFY COLUMN apic VARCHAR(255)"));
        verify(jdbcTemplate).update("UPDATE t_user SET avatar = NULL WHERE TRIM(avatar) = '1'");
    }

    @Test
    public void pureCheck_doesNotCreateMetaTableWhenAutoMigrateFalse() {
        ReflectionTestUtils.setField(guard, "enabled", true);
        ReflectionTestUtils.setField(guard, "autoMigrate", false);
        ReflectionTestUtils.setField(guard, "failFast", true);
        ReflectionTestUtils.setField(guard, "activeProfiles", "prod");

        when(jdbcTemplate.queryForObject(contains("information_schema.TABLES"), eq(Integer.class), anyString()))
                .thenReturn(0);

        try {
            guard.run(null);
        } catch (IllegalStateException expected) {
            // missing tables should fail closed
        }
        verify(jdbcTemplate, never()).execute(contains("app_schema_meta"));
        verify(jdbcTemplate, never()).update(contains("app_schema_meta"), anyString());
    }

    @Test
    public void missingTable_neverAttemptsToCreateIndexesWithAlter() {
        ReflectionTestUtils.setField(guard, "autoMigrate", true);
        when(jdbcTemplate.queryForObject(
                contains("information_schema.TABLES"), eq(Integer.class), eq("t_help")))
                .thenReturn(0);

        java.util.List<String> errors = new java.util.ArrayList<>();
        ReflectionTestUtils.invokeMethod(guard, "ensureHelpChatIndexes", errors);

        verify(jdbcTemplate, never()).execute(contains("ALTER TABLE t_help"));
        assertTrue(errors.isEmpty());
    }

    @Test
    public void legacyRolePermissionTable_getsRequiredColumnsAndIndexes() {
        ReflectionTestUtils.setField(guard, "autoMigrate", true);
        when(jdbcTemplate.queryForObject(
                contains("information_schema.TABLES"), eq(Integer.class), eq("role_permission")))
                .thenReturn(1);
        when(jdbcTemplate.queryForObject(
                contains("information_schema.COLUMNS"), eq(Integer.class), eq("role_permission"), anyString()))
                .thenReturn(0);
        when(jdbcTemplate.queryForObject(
                contains("information_schema.STATISTICS"), eq(Integer.class), eq("role_permission"), anyString()))
                .thenReturn(0);

        java.util.List<String> errors = new java.util.ArrayList<>();
        ReflectionTestUtils.invokeMethod(guard, "ensureRolePermissionTable", errors);

        verify(jdbcTemplate).execute(contains("ADD COLUMN role_id"));
        verify(jdbcTemplate).execute(contains("ADD COLUMN permission_id"));
        verify(jdbcTemplate).execute(contains("ADD PRIMARY KEY (role_id, permission_id)"));
        verify(jdbcTemplate).execute(contains("ADD INDEX idx_rp_permission"));
        assertTrue(errors.isEmpty());
    }
}
