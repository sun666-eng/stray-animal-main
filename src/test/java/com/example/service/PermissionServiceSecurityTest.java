package com.example.service;

import com.example.entity.Permission;
import com.example.entity.Role;
import com.example.entity.User;
import com.example.exception.CustomException;
import com.example.mapper.PermissionMapper;
import com.example.mapper.UserMapper;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.Collections;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class PermissionServiceSecurityTest {

    @Mock
    PermissionMapper permissionMapper;
    @Mock
    RoleService roleService;
    @Mock
    UserMapper userMapper;
    @Mock
    com.example.common.AuthUserCache authUserCache;

    @InjectMocks
    PermissionService permissionService;

    @Test
    void createDefinition_rejectsNonSuperAdminEvenWithClaimedPermission() {
        User actor = user(8L, 1L);
        when(userMapper.selectById(8L)).thenReturn(user(8L, 3L));

        CustomException error = assertThrows(CustomException.class,
                () -> permissionService.createDefinition(permission("permission", "/page/end/permission.html"), actor));

        assertEquals("403", error.getCode());
        verify(permissionMapper, never()).insert(any(Permission.class));
    }

    @Test
    void createDefinition_acceptsKnownFlagAndAllowlistedInternalPath() {
        User actor = user(1L, 1L);
        when(userMapper.selectById(1L)).thenReturn(actor);
        when(permissionMapper.insert(any(Permission.class))).thenReturn(1);

        permissionService.createDefinition(permission("help", "/page/end/help.html"), actor);

        ArgumentCaptor<Permission> captor = ArgumentCaptor.forClass(Permission.class);
        verify(permissionMapper).insert(captor.capture());
        assertEquals("help", captor.getValue().getFlag());
        assertEquals("/page/end/help.html", captor.getValue().getPath());
        // 写路径→失效配对：新权限即刻属于全部超管，必须全量失效鉴权缓存
        verify(authUserCache).invalidateAll();
    }

    @Test
    void createDefinition_rejectsExternalOrUnknownPath() {
        User actor = user(1L, 1L);
        when(userMapper.selectById(1L)).thenReturn(actor);

        CustomException error = assertThrows(CustomException.class,
                () -> permissionService.createDefinition(permission("help", "/page/end/help.html?next=https://evil.test"), actor));

        assertEquals("400", error.getCode());
        verify(permissionMapper, never()).insert(any(Permission.class));
    }

    @Test
    void createDefinition_rejectsUnknownBackendFlag() {
        User actor = user(1L, 1L);
        when(userMapper.selectById(1L)).thenReturn(actor);

        CustomException error = assertThrows(CustomException.class,
                () -> permissionService.createDefinition(permission("made_up_admin", ""), actor));

        assertEquals("400", error.getCode());
    }

    @Test
    void createDefinition_rejectsDuplicateFlag() {
        User actor = user(1L, 1L);
        when(userMapper.selectById(1L)).thenReturn(actor);
        when(permissionMapper.selectCount(any())).thenReturn(1L);

        CustomException error = assertThrows(CustomException.class,
                () -> permissionService.createDefinition(permission("help", ""), actor));

        assertEquals("409", error.getCode());
        verify(permissionMapper, never()).insert(any(Permission.class));
    }

    @Test
    void updateDefinition_rejectsPermissionReferencedByRole() {
        User actor = user(1L, 1L);
        when(userMapper.selectById(1L)).thenReturn(actor);
        Permission stored = permission("visit", "/page/end/visit.html");
        stored.setId(7L);
        when(permissionMapper.selectById(7L)).thenReturn(stored);
        Role role = new Role();
        role.setPermission(Collections.singletonList(stored));
        when(roleService.list(org.mockito.ArgumentMatchers.<com.baomidou.mybatisplus.core.conditions.Wrapper<Role>>any()))
                .thenReturn(Collections.singletonList(role));
        Permission update = permission("visit", "/page/end/visit.html");
        update.setId(7L);
        update.setDescription("changed");

        CustomException error = assertThrows(CustomException.class,
                () -> permissionService.updateDefinition(update, actor));

        assertEquals("409", error.getCode());
        verify(permissionMapper, never()).updateById(any(Permission.class));
    }

    @Test
    void deleteDefinition_isProhibitedEvenWhenPermissionAppearsUnreferenced() {
        CustomException error = assertThrows(CustomException.class,
                () -> permissionService.deleteDefinition(7L, user(1L, 1L)));

        assertEquals("409", error.getCode());
        verify(permissionMapper, never()).deleteById(any(Long.class));
        verify(permissionMapper, never()).selectById(any(Long.class));
    }

    @Test
    void inheritedGenericRemoval_isAlsoProhibited() {
        CustomException error = assertThrows(CustomException.class,
                () -> permissionService.removeById(7L));

        assertEquals("409", error.getCode());
        verify(permissionMapper, never()).deleteById(any(Long.class));
    }

    private static Permission permission(String flag, String path) {
        Permission permission = new Permission();
        permission.setName(flag);
        permission.setFlag(flag);
        permission.setPath(path);
        return permission;
    }

    private static User user(Long id, Long roleId) {
        User user = new User();
        user.setId(id);
        Role role = new Role();
        role.setId(roleId);
        user.setRole(Collections.singletonList(role));
        return user;
    }
}
