package com.example.service;

import com.example.entity.Permission;
import com.example.entity.Role;
import com.example.entity.User;
import com.example.exception.CustomException;
import com.example.mapper.UserMapper;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.ArgumentCaptor;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.Collections;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import org.mockito.InOrder;

@ExtendWith(MockitoExtension.class)
class UserServiceSecurityTest {

    @Mock
    UserMapper userMapper;
    @Mock
    RoleService roleService;
    @Mock
    PermissionService permissionService;
    @Mock
    FileAssetService fileAssetService;
    @Mock
    com.example.common.AuthUserCache authUserCache;

    @InjectMocks
    UserService userService;

    /** Mockito 5 不注入继承的泛型字段 M baseMapper（MP 3.5.7 起访问会断言非空），须显式注入。 */
    @org.junit.jupiter.api.BeforeEach
    void injectInheritedBaseMapper() {
        org.springframework.test.util.ReflectionTestUtils.setField(userService, "baseMapper", userMapper);
    }

    @Test
    void requireRealSuperAdmin_rejectsForgedSessionRole() {
        User claimed = user(8L, 1L);
        when(userMapper.selectById(8L)).thenReturn(user(8L, 3L));

        CustomException error = assertThrows(CustomException.class,
                () -> userService.requireRealSuperAdmin(claimed));

        assertEquals("403", error.getCode());
    }

    @Test
    void nonSuperUserManager_cannotModifySuperAdminTarget() {
        User manager = user(8L, 3L);
        Permission userPermission = new Permission();
        userPermission.setFlag("user");
        manager.setPermission(Collections.singletonList(userPermission));
        User target = user(1L, 1L);
        when(userMapper.selectById(8L)).thenReturn(manager);

        CustomException error = assertThrows(CustomException.class,
                () -> userService.assertCanModifyTarget(manager, target));

        assertEquals("403", error.getCode());
    }

    @Test
    void realSuperAdmin_canModifySuperAdminTarget() {
        User actor = user(1L, 1L);
        when(userMapper.selectById(1L)).thenReturn(actor);

        assertDoesNotThrow(() -> userService.assertCanModifyTarget(actor, user(2L, 1L)));
    }

    @Test
    void updateById_appliesUsernamePolicy() {
        User update = new User();
        update.setId(2L);
        update.setUsername("<script>alert(1)</script>");

        CustomException error = assertThrows(CustomException.class,
                () -> userService.updateById(update));

        assertEquals("400", error.getCode());
        verify(userMapper, never()).updateById(any(User.class));
    }

    @Test
    void updateById_rejectsAllDirectRoleWrites() {
        User update = user(2L, 4L);

        CustomException error = assertThrows(CustomException.class,
                () -> userService.updateById(update));

        assertEquals("400", error.getCode());
        verify(userMapper, never()).updateById(any(User.class));
    }

    @Test
    void inheritedPhysicalDeletionMethodsAreDisabled() {
        CustomException error = assertThrows(CustomException.class,
                () -> userService.removeById(9L));

        assertEquals("409", error.getCode());
        verify(userMapper, never()).deleteById(any());
    }

    @Test
    void createWithAvatar_bindsOwnedFlagThenWritesSlimAvatarPatch() {
        User actor = user(8L, 2L);
        User created = user(null, 2L);
        created.setUsername("new-user");
        created.setPassword("password");
        created.setAvatar("avatar-flag");
        when(userMapper.insert(any(User.class))).thenAnswer(invocation -> {
            ((User) invocation.getArgument(0)).setId(20L);
            return 1;
        });
        when(userMapper.updateById(any(User.class))).thenReturn(1);

        userService.createWithAvatar(created, actor);

        InOrder order = inOrder(userMapper, fileAssetService);
        order.verify(userMapper).insert(any(User.class));
        order.verify(fileAssetService).bindToBusiness(actor, "avatar-flag", "avatar", "user", 20L, true);
        ArgumentCaptor<User> patchCaptor = ArgumentCaptor.forClass(User.class);
        order.verify(userMapper).updateById(patchCaptor.capture());
        User patch = patchCaptor.getValue();
        assertEquals(20L, patch.getId());
        assertEquals("avatar-flag", patch.getAvatar());
        assertEquals(null, patch.getRole());
        assertEquals(null, patch.getUsername());
    }

    @Test
    void createWithAvatar_foreignFlagDenialDoesNotWriteAvatarPatch() {
        User actor = user(8L, 2L);
        User created = user(null, 2L);
        created.setUsername("new-user");
        created.setPassword("password");
        created.setAvatar("foreign-flag");
        when(userMapper.insert(any(User.class))).thenAnswer(invocation -> {
            ((User) invocation.getArgument(0)).setId(20L);
            return 1;
        });
        doThrow(new CustomException("403", "不能使用他人上传的文件"))
                .when(fileAssetService).bindToBusiness(actor, "foreign-flag", "avatar", "user", 20L, true);

        CustomException error = assertThrows(CustomException.class,
                () -> userService.createWithAvatar(created, actor));

        assertEquals("403", error.getCode());
        verify(userMapper, never()).updateById(any(User.class));
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
