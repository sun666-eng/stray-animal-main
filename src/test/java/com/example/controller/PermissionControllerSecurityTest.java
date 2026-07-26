package com.example.controller;

import com.example.common.Result;
import com.example.entity.Permission;
import com.example.entity.User;
import com.example.exception.CustomException;
import com.example.service.PermissionService;
import com.example.service.UserService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.test.util.ReflectionTestUtils;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.same;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class PermissionControllerSecurityTest {

    private PermissionController controller;
    private PermissionService permissionService;
    private UserService userService;

    @BeforeEach
    void setUp() {
        controller = new PermissionController();
        permissionService = mock(PermissionService.class);
        userService = mock(UserService.class);
        ReflectionTestUtils.setField(controller, "permissionService", permissionService);
        ReflectionTestUtils.setField(controller, "userService", userService);
    }

    @Test
    void save_rejectsActorWhoseSuperAdminRoleIsNotInDatabase() {
        User claimed = new User();
        claimed.setId(8L);
        MockHttpServletRequest request = requestWith(claimed);
        when(userService.requireRealSuperAdmin(claimed))
                .thenThrow(new CustomException("403", "仅超级管理员可执行该操作"));

        assertThrows(CustomException.class,
                () -> controller.save(new Permission(), request));
        verify(permissionService, never())
                .createDefinition(any(Permission.class), any(User.class));
    }

    @Test
    void save_allowsDatabaseVerifiedSuperAdmin() {
        User claimed = new User();
        claimed.setId(1L);
        User verified = new User();
        verified.setId(1L);
        MockHttpServletRequest request = requestWith(claimed);
        Permission permission = new Permission();
        permission.setFlag("help");
        permission.setPath("/page/end/help.html");
        when(userService.requireRealSuperAdmin(claimed)).thenReturn(verified);
        when(permissionService.createDefinition(permission, verified)).thenReturn(true);

        Result<?> result = controller.save(permission, request);

        assertEquals("0", result.getCode());
        verify(permissionService).createDefinition(same(permission), same(verified));
    }

    @Test
    void delete_isProhibitedAtPublicControllerWithoutCallingService() {
        CustomException error = assertThrows(CustomException.class,
                () -> controller.delete(7L, requestWith(new User())));

        assertEquals("409", error.getCode());
        verify(permissionService, never()).deleteDefinition(any(Long.class), any(User.class));
        verify(userService, never()).requireRealSuperAdmin(any(User.class));
    }

    private static MockHttpServletRequest requestWith(User user) {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.getSession(true).setAttribute("user", user);
        return request;
    }
}
