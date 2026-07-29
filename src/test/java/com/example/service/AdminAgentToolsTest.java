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
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class AdminAgentToolsTest {

    @Mock JdbcTemplate jdbcTemplate;

    @Test
    void modulePermissionIsEnforcedBeforeAnyQuery() {
        AdminAgentTools tools = new AdminAgentTools(jdbcTemplate);
        User user = userWithPermission("animal");

        JSONObject result = JSONUtil.parseObj(tools.execute(user, "list_pending_adoptions", new JSONObject()));

        assertEquals("permission_denied", result.getStr("error"));
        verify(jdbcTemplate, never()).queryForList(anyString());
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
