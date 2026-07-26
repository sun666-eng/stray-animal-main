package com.example.controller;

import com.example.common.Result;
import com.example.entity.Role;
import com.example.entity.User;
import com.example.exception.CustomException;
import com.example.service.RoleService;
import com.example.service.UserService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.test.util.ReflectionTestUtils;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class RoleControllerSecurityTest {

    private RoleController controller;
    private RoleService roleService;
    private UserService userService;

    @BeforeEach
    void setUp() {
        controller = new RoleController();
        roleService = mock(RoleService.class);
        userService = mock(UserService.class);
        ReflectionTestUtils.setField(controller, "roleService", roleService);
        ReflectionTestUtils.setField(controller, "userService", userService);
    }

    @Test
    void save_doesNotTrustClientPermissionFlags() {
        User claimed = new User();
        claimed.setId(8L);
        MockHttpServletRequest request = requestWith(claimed);
        when(userService.requireRealSuperAdmin(claimed))
                .thenThrow(new CustomException("403", "仅超级管理员可执行该操作"));

        assertThrows(CustomException.class, () -> controller.save(new Role(), request));
        verify(roleService, never()).createDefinition(any(Role.class), any(User.class));
    }

    @Test
    void save_allowsDatabaseVerifiedSuperAdmin() {
        User claimed = new User();
        claimed.setId(1L);
        User verified = new User();
        verified.setId(1L);
        MockHttpServletRequest request = requestWith(claimed);
        when(userService.requireRealSuperAdmin(claimed)).thenReturn(verified);
        when(roleService.createDefinition(any(Role.class), any(User.class))).thenReturn(true);

        Result<?> result = controller.save(new Role(), request);

        assertEquals("0", result.getCode());
        verify(roleService).createDefinition(any(Role.class), org.mockito.ArgumentMatchers.same(verified));
    }

    private static MockHttpServletRequest requestWith(User user) {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.getSession(true).setAttribute("user", user);
        return request;
    }
}
