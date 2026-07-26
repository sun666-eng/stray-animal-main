package com.example.service;

import com.example.entity.Permission;
import com.example.entity.Role;
import com.example.entity.User;
import com.example.exception.CustomException;
import com.example.mapper.PermissionMapper;
import com.example.mapper.RoleMapper;
import com.example.mapper.UserMapper;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.Collections;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class RoleServiceSecurityTest {

    @Mock
    RoleMapper roleMapper;
    @Mock
    PermissionMapper permissionMapper;
    @Mock
    UserMapper userMapper;
    @Mock
    com.example.common.AuthUserCache authUserCache;

    @InjectMocks
    RoleService roleService;

    @Test
    void createDefinition_rejectsPermissionFlagHolderWithoutRealSuperAdminRole() {
        User actor = user(8L, 1L);
        User fresh = user(8L, 3L);
        Permission claimed = new Permission();
        claimed.setFlag("role");
        fresh.setPermission(Collections.singletonList(claimed));
        when(userMapper.selectById(8L)).thenReturn(fresh);

        CustomException error = assertThrows(CustomException.class,
                () -> roleService.createDefinition(new Role(), actor));

        assertEquals("403", error.getCode());
        verify(roleMapper, never()).insert(any(Role.class));
    }

    @Test
    void createDefinition_resolvesSubmittedPermissionIdFromDatabase() {
        User actor = user(1L, 1L);
        when(userMapper.selectById(1L)).thenReturn(actor);
        Permission submitted = permission(7L, "forged", "https://evil.test/x");
        Permission stored = permission(7L, "visit", "/page/end/visit.html");
        when(permissionMapper.selectById(7L)).thenReturn(stored);
        when(roleMapper.insert(any(Role.class))).thenReturn(1);
        Role role = new Role();
        role.setName("Reviewer");
        role.setPermission(Collections.singletonList(submitted));

        roleService.createDefinition(role, actor);

        ArgumentCaptor<Role> captor = ArgumentCaptor.forClass(Role.class);
        verify(roleMapper).insert(captor.capture());
        assertSame(stored, captor.getValue().getPermission().get(0));
    }

    @Test
    void updateDefinition_success_invalidatesAuthCacheForAllUsers() {
        User actor = user(1L, 1L);
        when(userMapper.selectById(1L)).thenReturn(actor);
        Role existing = new Role();
        existing.setId(9L);
        when(roleMapper.selectById(9L)).thenReturn(existing);
        when(roleMapper.updateById(any(Role.class))).thenReturn(1);
        Role update = new Role();
        update.setId(9L);
        update.setName("Reviewer-v2");

        roleService.updateDefinition(update, actor);

        // 写路径→失效配对：角色内容变更影响所有持有者，必须全量失效鉴权缓存
        verify(authUserCache).invalidateAll();
    }

    @Test
    void createDefinition_rejectsUnknownPermissionId() {
        User actor = user(1L, 1L);
        when(userMapper.selectById(1L)).thenReturn(actor);
        Role role = new Role();
        role.setPermission(Collections.singletonList(permission(999L, "role", "/page/end/role.html")));

        CustomException error = assertThrows(CustomException.class,
                () -> roleService.createDefinition(role, actor));

        assertEquals("400", error.getCode());
        verify(roleMapper, never()).insert(any(Role.class));
    }

    @Test
    void deleteDefinition_rejectsBuiltInRole() {
        User actor = user(1L, 1L);
        when(userMapper.selectById(1L)).thenReturn(actor);

        for (long id = 1L; id <= 4L; id++) {
            final long builtInId = id;
            CustomException error = assertThrows(CustomException.class,
                    () -> roleService.deleteDefinition(builtInId, actor));
            assertEquals("403", error.getCode());
        }
        verify(roleMapper, never()).deleteById(any(Long.class));
    }

    @Test
    void deleteDefinition_rejectsRoleReferencedByUser() {
        User actor = user(1L, 1L);
        when(userMapper.selectById(1L)).thenReturn(actor);
        Role role = new Role();
        role.setId(5L);
        when(roleMapper.selectById(5L)).thenReturn(role);
        when(userMapper.selectList(any())).thenReturn(Collections.singletonList(user(9L, 5L)));

        CustomException error = assertThrows(CustomException.class,
                () -> roleService.deleteDefinition(5L, actor));

        assertEquals("409", error.getCode());
        verify(roleMapper, never()).deleteById(any(Long.class));
    }

    @Test
    void updateDefinition_rejectsAllImmutableBuiltInRoles() {
        User actor = user(1L, 1L);
        when(userMapper.selectById(1L)).thenReturn(actor);

        for (long id = 1L; id <= 4L; id++) {
            Role role = new Role();
            role.setId(id);
            CustomException error = assertThrows(CustomException.class,
                    () -> roleService.updateDefinition(role, actor));
            assertEquals("403", error.getCode());
        }
        verify(roleMapper, never()).updateById(any(Role.class));
    }

    private static User user(Long id, Long roleId) {
        User user = new User();
        user.setId(id);
        Role role = new Role();
        role.setId(roleId);
        user.setRole(Collections.singletonList(role));
        return user;
    }

    private static Permission permission(Long id, String flag, String path) {
        Permission permission = new Permission();
        permission.setId(id);
        permission.setFlag(flag);
        permission.setPath(path);
        return permission;
    }
}
