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
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.doAnswer;
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
        assertEquals("2026.07.21-file-v1", SchemaGuardRunner.SCHEMA_VERSION);
    }

    @Test
    @SuppressWarnings("unchecked")
    public void run_whenMissingPstatusAndApic_executesAlterAndPasses() {
        ReflectionTestUtils.setField(guard, "enabled", true);
        ReflectionTestUtils.setField(guard, "autoMigrate", true);
        ReflectionTestUtils.setField(guard, "failFast", false);

        Set<String> repaired = new HashSet<>();

        when(jdbcTemplate.queryForObject(contains("information_schema.TABLES"), eq(Integer.class), anyString()))
                .thenReturn(1);

        when(jdbcTemplate.queryForObject(contains("information_schema.COLUMNS"), eq(Integer.class), anyString(), anyString()))
                .thenAnswer(inv -> {
                    String col = inv.getArgument(3);
                    if ("pstatus".equals(col) || "apic".equals(col)) {
                        return repaired.contains(col) ? 1 : 0;
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
                .thenReturn("text");
        when(jdbcTemplate.queryForObject(contains("FROM t_role WHERE id = 4"), eq(Integer.class)))
                .thenReturn(1);
        when(jdbcTemplate.query(contains("FROM t_role WHERE id = 3"), any(ResultSetExtractor.class)))
                .thenReturn("[{\"flag\":\"my_proof\"}]");
        when(jdbcTemplate.queryForObject(contains("flag = 'my_proof'"), eq(Integer.class)))
                .thenReturn(1);
        when(jdbcTemplate.update(contains("app_schema_meta"), anyString())).thenReturn(1);

        assertDoesNotThrow(() -> guard.run(null));
        verify(jdbcTemplate, atLeastOnce()).execute(contains("pstatus"));
        verify(jdbcTemplate, atLeastOnce()).execute(contains("apic"));
    }
}
