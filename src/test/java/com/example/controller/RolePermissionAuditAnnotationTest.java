package com.example.controller;

import com.example.common.AuditLog;
import org.junit.jupiter.api.Test;

import java.lang.reflect.Method;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;

class RolePermissionAuditAnnotationTest {

    @Test
    void roleMutationsAreAudited() throws Exception {
        assertAudited(RoleController.class.getMethod("save",
                com.example.entity.Role.class, jakarta.servlet.http.HttpServletRequest.class), "新增角色定义");
        assertAudited(RoleController.class.getMethod("update",
                com.example.entity.Role.class, jakarta.servlet.http.HttpServletRequest.class), "更新角色定义");
        assertAudited(RoleController.class.getMethod("delete",
                Long.class, jakarta.servlet.http.HttpServletRequest.class), "删除角色定义");
    }

    @Test
    void permissionMutationsAreAudited() throws Exception {
        assertAudited(PermissionController.class.getMethod("save",
                com.example.entity.Permission.class, jakarta.servlet.http.HttpServletRequest.class), "新增权限定义");
        assertAudited(PermissionController.class.getMethod("update",
                com.example.entity.Permission.class, jakarta.servlet.http.HttpServletRequest.class), "更新权限定义");
        assertAudited(PermissionController.class.getMethod("delete",
                Long.class, jakarta.servlet.http.HttpServletRequest.class), "删除权限定义");
    }

    private static void assertAudited(Method method, String action) {
        AuditLog log = method.getAnnotation(AuditLog.class);
        assertNotNull(log, method.getName() + " missing @AuditLog");
        assertEquals(action, log.action());
    }
}
