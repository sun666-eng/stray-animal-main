package com.example.component;

import com.example.common.StartupMutationPolicy;
import com.example.entity.Permission;
import com.example.entity.Role;
import com.example.entity.RolePermission;
import com.example.mapper.PermissionMapper;
import com.example.mapper.RolePermissionMapper;
import com.example.service.RoleService;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 同步提取逻辑：必须兼容三代脏 JSON 形态（Permission 实体 / Map / 字符串 id），
 * 且丢弃不存在于 t_permission 的陈旧引用。
 */
@ExtendWith(MockitoExtension.class)
class RolePermissionSyncRunnerTest {

    private static final Set<Long> VALID = new HashSet<>(Arrays.asList(5L, 7L, 43L));

    @Mock
    private RoleService roleService;

    @Mock
    private RolePermissionMapper rolePermissionMapper;

    @Mock
    private PermissionMapper permissionMapper;

    @Mock
    private JdbcTemplate jdbcTemplate;

    @Test
    void extractsEntityMapAndStringIdForms() {
        Permission entity = new Permission();
        entity.setId(5L);

        Map<String, Object> numberMap = new HashMap<>();
        numberMap.put("id", 7);

        Map<String, Object> stringMap = new HashMap<>();
        stringMap.put("id", "43");

        List<Object> raw = new ArrayList<>();
        raw.add(entity);
        raw.add(numberMap);
        raw.add(stringMap);

        Set<Long> ids = RolePermissionSyncRunner.extractPermissionIds(raw, VALID);
        assertEquals(new HashSet<>(Arrays.asList(5L, 7L, 43L)), ids);
    }

    @Test
    void dropsStaleAndMalformedEntries() {
        Map<String, Object> stale = new HashMap<>();
        stale.put("id", 999); // 不在 t_permission

        Map<String, Object> malformed = new HashMap<>();
        malformed.put("id", "not-a-number");

        Map<String, Object> missingId = new HashMap<>();
        missingId.put("flag", "visit");

        List<Object> raw = new ArrayList<>();
        raw.add(stale);
        raw.add(malformed);
        raw.add(missingId);
        raw.add(null);
        raw.add("garbage-string");

        assertTrue(RolePermissionSyncRunner.extractPermissionIds(raw, VALID).isEmpty());
    }

    @Test
    void nullListYieldsEmptySet() {
        assertTrue(RolePermissionSyncRunner.extractPermissionIds(null, VALID).isEmpty());
    }

    @Test
    void duplicatesCollapse() {
        Map<String, Object> a = new HashMap<>();
        a.put("id", 7);
        Map<String, Object> b = new HashMap<>();
        b.put("id", "7");

        List<Object> raw = new ArrayList<>();
        raw.add(a);
        raw.add(b);

        assertEquals(1, RolePermissionSyncRunner.extractPermissionIds(raw, VALID).size());
    }

    @Test
    void pureCheckWithDifferencesFailsWithoutMapperWrites() {
        RolePermissionSyncRunner runner = pureCheckRunnerWithDifferences();
        ReflectionTestUtils.setField(runner, "failFast", true);

        IllegalStateException error = assertThrows(IllegalStateException.class, () -> runner.run(null));

        assertTrue(error.getMessage().contains("缺少 1 行，多余 1 行"));
        verifyNoWrites();
    }

    @Test
    void pureCheckWithFailFastDisabledWarnsWithoutMapperWrites() {
        RolePermissionSyncRunner runner = pureCheckRunnerWithDifferences();
        ReflectionTestUtils.setField(runner, "failFast", false);

        assertDoesNotThrow(() -> runner.run(null));

        verifyNoWrites();
    }

    private RolePermissionSyncRunner pureCheckRunnerWithDifferences() {
        Permission valid = new Permission();
        valid.setId(5L);
        Role role = new Role();
        role.setId(3L);
        role.setPermission(Arrays.asList(valid));
        RolePermission stale = new RolePermission();
        stale.setRoleId(3L);
        stale.setPermissionId(7L);

        when(jdbcTemplate.queryForObject(anyString(), eq(Integer.class))).thenReturn(1);
        when(permissionMapper.selectList(any())).thenReturn(Arrays.asList(valid));
        when(roleService.list()).thenReturn(Arrays.asList(role));
        when(rolePermissionMapper.selectList(any())).thenReturn(Arrays.asList(stale));

        return new RolePermissionSyncRunner(roleService,
                rolePermissionMapper, permissionMapper, jdbcTemplate, new StartupMutationPolicy(false));
    }

    private void verifyNoWrites() {
        verify(rolePermissionMapper, never()).insert(any(RolePermission.class));
        verify(rolePermissionMapper, never()).delete(any());
    }
}
