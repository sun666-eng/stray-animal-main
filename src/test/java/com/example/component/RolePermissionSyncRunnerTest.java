package com.example.component;

import com.example.entity.Permission;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 同步提取逻辑：必须兼容三代脏 JSON 形态（Permission 实体 / Map / 字符串 id），
 * 且丢弃不存在于 t_permission 的陈旧引用。
 */
class RolePermissionSyncRunnerTest {

    private static final Set<Long> VALID = new HashSet<>(Arrays.asList(5L, 7L, 43L));

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
}
