package com.example.service;

import cn.hutool.json.JSONObject;
import cn.hutool.json.JSONUtil;
import com.example.entity.Permission;
import com.example.entity.Role;
import com.example.entity.User;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.jdbc.core.JdbcTemplate;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class AdminAgentToolsTest {

    @Mock JdbcTemplate jdbcTemplate;

    @Test
    void toolSpecs_returnsControlledAllowlistedToolSet() {
        AdminAgentTools tools = new AdminAgentTools(jdbcTemplate);
        cn.hutool.json.JSONArray specs = tools.toolSpecs();
        // Exact allowlist — any unregistered, missing, duplicate, or blank name fails.
        java.util.Set<String> expected = java.util.Set.of(
                "get_management_overview",
                "list_pending_adoptions",
                "get_adoption_review_context",
                "list_pending_volunteers",
                "list_open_rescues",
                "list_pending_proofs",
                "get_data_quality_summary",
                "get_operations_work_summary",
                "get_volunteer_task_summary",
                "get_medical_record_summary"
        );
        java.util.Set<String> names = new java.util.LinkedHashSet<>();
        for (int i = 0; i < specs.size(); i++) {
            JSONObject t = specs.getJSONObject(i);
            assertNotNull(t, "tool entry must not be null");
            JSONObject fn = t.getJSONObject("function");
            assertNotNull(fn, "tool.function must not be null");
            String name = fn.getStr("name");
            assertNotNull(name, "tool name must not be null");
            assertFalse(name.isBlank(), "tool name must not be blank");
            assertTrue(names.add(name), "duplicate tool name: " + name);
        }
        assertEquals(expected.size(), names.size(), "tool count must equal exact allowlist size");
        assertEquals(expected, names, "tool name set must equal designed allowlist exactly");
        assertFalse(names.contains("delete_user"));
        assertFalse(names.contains("execute_sql"));
        verify(jdbcTemplate, never()).queryForList(anyString());
        verify(jdbcTemplate, never()).update(anyString());
    }

    @Test
    void execute_unknownTool_returnsUnknownTool_andDoesNotTouchJdbc() {
        AdminAgentTools tools = new AdminAgentTools(jdbcTemplate);
        JSONObject result = JSONUtil.parseObj(
                tools.execute(superAdmin(), "unknown_tool_xyz", new JSONObject()));
        assertEquals("unknown_tool", result.getStr("error"));
        verify(jdbcTemplate, never()).queryForList(anyString());
        verify(jdbcTemplate, never()).update(anyString());
        verify(jdbcTemplate, never()).queryForObject(anyString(), any(Class.class));
    }

    @Test
    void execute_allowlistedReadTool_runsForSuperAdmin() {
        AdminAgentTools tools = new AdminAgentTools(jdbcTemplate);
        when(jdbcTemplate.queryForObject(anyString(), any(Class.class))).thenReturn(0L);
        JSONObject result = JSONUtil.parseObj(
                tools.execute(superAdmin(), "get_management_overview", new JSONObject()));
        assertTrue(result.getBool("read_only"));
        verify(jdbcTemplate, atLeastOnce()).queryForObject(anyString(), any(Class.class));
    }

    @Test
    void modulePermissionIsEnforcedBeforeAnyQuery() {
        AdminAgentTools tools = new AdminAgentTools(jdbcTemplate);
        User user = userWithPermission("animal");

        JSONObject result = JSONUtil.parseObj(tools.execute(user, "list_pending_adoptions", new JSONObject()));

        assertEquals("permission_denied", result.getStr("error"));
        verify(jdbcTemplate, never()).queryForList(anyString());
        verify(jdbcTemplate, never()).update(anyString());
    }

    @Test
    void rescueToolExcludesContactAndExactLocationAndClosedRecords() {
        AdminAgentTools tools = new AdminAgentTools(jdbcTemplate);
        when(jdbcTemplate.queryForList(anyString())).thenReturn(Collections.emptyList());

        JSONObject result = JSONUtil.parseObj(tools.execute(superAdmin(), "list_open_rescues", new JSONObject()));

        ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
        verify(jdbcTemplate).queryForList(sql.capture());
        String query = sql.getValue().toLowerCase();
        assertFalse(query.contains("phone"));
        assertFalse(query.contains("location"));
        assertTrue(query.contains("in (0,1)"));
        assertTrue(result.getBool("read_only"));
    }

    @Test
    void freeTextContactAndSecretAreRedactedBeforeLeavingToolBoundary() {
        AdminAgentTools tools = new AdminAgentTools(jdbcTemplate);
        Map<String, Object> row = new LinkedHashMap<>();
        row.put("description", "联系 13812345678，微信 rescue_2026，邮箱 hi@example.com，sk-secret123456");
        when(jdbcTemplate.queryForList(anyString())).thenReturn(Collections.singletonList(row));

        String output = tools.execute(superAdmin(), "list_open_rescues", new JSONObject());

        assertFalse(output.contains("13812345678"));
        assertFalse(output.contains("rescue_2026"));
        assertFalse(output.contains("hi@example.com"));
        assertFalse(output.contains("sk-secret123456"));
        assertTrue(output.contains("已隐藏"));
    }

    private static User userWithPermission(String flag) {
        User user = new User(); user.setId(9L);
        Permission permission = new Permission(); permission.setFlag(flag);
        user.setPermission(Collections.singletonList(permission));
        return user;
    }

    private static User superAdmin() {
        User user = new User(); user.setId(1L);
        Role role = new Role(); role.setId(1L);
        user.setRole(Collections.singletonList(role));
        return user;
    }
}
