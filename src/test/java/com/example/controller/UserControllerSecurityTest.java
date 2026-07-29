package com.example.controller;

import com.example.common.Result;
import com.example.common.RoleAssignmentPolicy;
import com.example.dto.ProfileUpdateRequest;
import com.example.entity.Permission;
import com.example.entity.Role;
import com.example.entity.User;
import com.example.exception.CustomException;
import com.example.service.UserService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.http.ResponseEntity;
import org.springframework.test.util.ReflectionTestUtils;
import org.mockito.ArgumentCaptor;

import java.util.Collections;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.doNothing;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class UserControllerSecurityTest {

    private UserController controller;
    private UserService userService;
    private RoleAssignmentPolicy roleAssignmentPolicy;
    @BeforeEach
    void setUp() {
        controller = new UserController();
        userService = mock(UserService.class);
        roleAssignmentPolicy = mock(RoleAssignmentPolicy.class);
        ReflectionTestUtils.setField(controller, "userService", userService);
        ReflectionTestUtils.setField(controller, "roleAssignmentPolicy", roleAssignmentPolicy);
        ReflectionTestUtils.setField(controller, "authUserCache", new com.example.common.AuthUserCache());
    }

    @Test
    void update_nonSuperManagerCannotChangeAnySuperAdminField() {
        User manager = manager();
        User target = user(1L, 1L);
        User update = new User();
        update.setId(1L);
        update.setUsername("renamed-admin");
        update.setAvatar("new-avatar");
        when(userService.getById(1L)).thenReturn(target);
        doThrow(new CustomException("403", "仅超级管理员可执行该操作"))
                .when(userService).assertCanModifyTarget(manager, target);

        Result<?> result = controller.update(update, requestWith(manager));

        assertEquals("403", result.getCode());
        verify(userService, never()).updateWithAvatarBind(any(User.class), any(User.class),
                any(), anyLong(), anyBoolean());
    }

    @Test
    void update_rejectsNonBlankPasswordBeforeAnyUserWrite() {
        User update = new User();
        update.setId(8L);
        update.setPassword("new-password");

        Result<?> result = controller.update(update, requestWith(manager()));

        assertEquals("400", result.getCode());
        verify(userService, never()).getById(anyLong());
        verify(userService, never()).updateWithAvatarBind(any(User.class), any(User.class),
                any(), anyLong(), anyBoolean());
    }

    @Test
    void update_ordinaryUserCannotUseGenericPutEvenForSelf() {
        User self = user(20L, 4L);
        User update = new User();
        update.setId(20L);
        update.setUsername("hijacked");
        when(roleAssignmentPolicy.isSuperAdmin(self)).thenReturn(false);

        Result<?> result = controller.update(update, requestWith(self));

        assertEquals("403", result.getCode());
        verify(userService, never()).updateWithAvatarBind(any(User.class), any(User.class),
                any(), anyLong(), anyBoolean());
    }

    @Test
    void update_allowsBlankPasswordAsNoChange() {
        User manager = manager();
        User target = user(2L, 3L);
        User update = new User();
        update.setId(2L);
        update.setPassword("   ");
        when(userService.getById(2L)).thenReturn(target);
        when(userService.updateWithAvatarBind(update, manager, null, 2L, true)).thenReturn(true);

        Result<?> result = controller.update(update, requestWith(manager));

        assertEquals("0", result.getCode());
        assertEquals(null, update.getPassword());
    }

    @Test
    void update_rejectsAnyExplicitRoleWriteForSuperAdminTarget() {
        User actor = user(1L, 1L);
        User target = user(2L, 1L);
        User update = new User();
        update.setId(2L);
        update.setRole(Collections.singletonList(new Role()));
        when(roleAssignmentPolicy.isSuperAdmin(actor)).thenReturn(true);
        when(userService.getById(2L)).thenReturn(target);

        Result<?> result = controller.update(update, requestWith(actor));

        assertEquals("403", result.getCode());
        verify(userService, never()).updateWithAvatarBind(any(User.class), any(User.class),
                any(), anyLong(), anyBoolean());
    }

    @Test
    void delete_isDisabledUntilPersistedDeactivationModelExists() {
        User actor = user(1L, 1L);

        Result<?> result = controller.delete(2L, requestWith(actor));

        assertEquals("409", result.getCode());
        verify(userService, never()).deleteUser(anyLong());
        verify(roleAssignmentPolicy, never()).assertCanDeleteUser(any(User.class), anyLong());
    }

    @Test
    void update_userManagerCanSafelyModifyNormalTarget() {
        User manager = manager();
        User target = user(2L, 3L);
        target.setAvatar("old-avatar");
        User update = new User();
        update.setId(2L);
        update.setUsername("normal-user");
        when(userService.getById(2L)).thenReturn(target);
        doNothing().when(userService).assertCanModifyTarget(manager, target);
        when(userService.updateWithAvatarBind(update, manager, "old-avatar", 2L, true)).thenReturn(true);

        Result<?> result = controller.update(update, requestWith(manager));

        assertEquals("0", result.getCode());
        verify(userService).updateWithAvatarBind(update, manager, "old-avatar", 2L, true);
    }

    @Test
    void updateMyProfile_derivesIdentityAndAcceptsOnlyProfileFields() {
        User current = user(12L, 1L);
        ProfileUpdateRequest requestBody = new ProfileUpdateRequest();
        requestBody.setEmail("member@example.com");
        requestBody.setPhone("13800000000");
        requestBody.setAvatar("avatar-flag");
        when(userService.updateWithAvatarBind(any(User.class), any(User.class), any(), anyLong(), anyBoolean()))
                .thenReturn(true);

        Result<?> result = controller.updateMyProfile(requestBody, requestWith(current));

        assertEquals("0", result.getCode());
        ArgumentCaptor<User> patch = ArgumentCaptor.forClass(User.class);
        verify(userService).updateWithAvatarBind(patch.capture(), org.mockito.ArgumentMatchers.same(current),
                org.mockito.ArgumentMatchers.isNull(), org.mockito.ArgumentMatchers.eq(12L),
                org.mockito.ArgumentMatchers.eq(false));
        assertEquals(null, patch.getValue().getId());
        assertEquals(null, patch.getValue().getUsername());
        assertEquals(null, patch.getValue().getRole());
        assertEquals("member@example.com", patch.getValue().getEmail());
    }

    @Test
    void logoutInvalidatesSessionWithoutSocketLifecycleDependency() {
        User user = user(12L, 3L);
        user.setUsername("member");
        MockHttpServletRequest request = requestWith(user);

        Result<?> result = controller.logout(request, new MockHttpServletResponse());

        assertEquals("0", result.getCode());
        assertEquals(null, request.getSession(false));
    }

    @Test
    void webSocketTicketEndpointIsGoneAndNeverIssuesTicket() {
        ResponseEntity<Result<?>> response = controller.createWebSocketTicket();

        assertEquals(410, response.getStatusCodeValue());
        assertEquals("410", response.getBody().getCode());
    }

    private static User manager() {
        User manager = user(8L, 3L);
        Permission permission = new Permission();
        permission.setFlag("user");
        manager.setPermission(Collections.singletonList(permission));
        return manager;
    }

    private static User user(Long id, Long roleId) {
        User user = new User();
        user.setId(id);
        Role role = new Role();
        role.setId(roleId);
        user.setRole(Collections.singletonList(role));
        return user;
    }

    private static MockHttpServletRequest requestWith(User user) {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.getSession(true).setAttribute("user", user);
        return request;
    }
}
