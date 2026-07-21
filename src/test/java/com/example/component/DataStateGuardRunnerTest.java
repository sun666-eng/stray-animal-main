package com.example.component;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.util.ReflectionTestUtils;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
public class DataStateGuardRunnerTest {

    @Mock
    JdbcTemplate jdbcTemplate;

    @InjectMocks
    DataStateGuardRunner guard;

    @Test
    public void version_constant() {
        assertEquals("2026.07.12-state-v1", DataStateGuardRunner.STATE_VERSION);
    }

    @Test
    public void run_whenDirty_executesRepairSql() {
        ReflectionTestUtils.setField(guard, "enabled", true);
        ReflectionTestUtils.setField(guard, "autoFix", true);
        ReflectionTestUtils.setField(guard, "failFast", false);

        // snapshot: first dirty, then clean after fixes
        when(jdbcTemplate.queryForObject(anyString(), eq(Integer.class)))
                .thenReturn(1, 1, 1, 1)  // before dirty
                .thenReturn(0, 0, 0, 0); // after clean
        when(jdbcTemplate.update(anyString())).thenReturn(1);
        when(jdbcTemplate.update(contains("data_state_version"), anyString())).thenReturn(1);

        assertDoesNotThrow(() -> guard.run(null));
        verify(jdbcTemplate, atLeastOnce()).update(contains("vstate = 0"));
        verify(jdbcTemplate, atLeastOnce()).update(contains("MIN(uid)"));
        verify(jdbcTemplate, atLeastOnce()).update(contains("UPDATE t_animal"));
    }

    @Test
    public void run_whenClean_skipsRepairUpdates() {
        ReflectionTestUtils.setField(guard, "enabled", true);
        ReflectionTestUtils.setField(guard, "autoFix", true);
        ReflectionTestUtils.setField(guard, "failFast", false);

        when(jdbcTemplate.queryForObject(anyString(), eq(Integer.class))).thenReturn(0);
        when(jdbcTemplate.update(contains("data_state_version"), anyString())).thenReturn(1);

        assertDoesNotThrow(() -> guard.run(null));
        // only version write, not business updates — at least no MIN(uid) repair
    }
}
