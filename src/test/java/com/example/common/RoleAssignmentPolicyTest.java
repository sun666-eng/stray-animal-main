package com.example.common;

import com.example.entity.Permission;
import com.example.entity.Role;
import com.example.entity.User;
import com.example.exception.CustomException;
import com.example.service.RoleService;
import com.example.service.UserService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.Collections;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.when;

/**
 * B1.1：仅有 user、无 role 的账号不能给自己分配超级管理员。
 */
@ExtendWith(MockitoExtension.class)
public class RoleAssignmentPolicyTest {

    @Mock
    RoleService roleService;
    @Mock
    UserService userService;

    RoleAssignmentPolicy policy;

    @BeforeEach
    public void setUp() {
        policy = new RoleAssignmentPolicy(roleService, userService);
    }

    @Test
    public void userFlagOnly_cannotAssignSuperAdmin() {
        User actor = userWithFlags("user");
        Role requested = new Role();
        requested.setId(1L);
        assertThrows(CustomException.class,
                () -> policy.resolveRolesForWrite(actor, Collections.singletonList(requested), false));
    }

    @Test
    public void userFlagOnly_cannotAssignAnyRole() {
        User actor = userWithFlags("user");
        Role requested = new Role();
        requested.setId(3L);
        CustomException ex = assertThrows(CustomException.class,
                () -> policy.resolveRolesForWrite(actor, Collections.singletonList(requested), false));
        assertEquals("403", ex.getCode());
    }

    @Test
    public void role2PlusRole3Combination_isRejected() {
        // 审计修复 H3：与启动期 RolePermissionGuard 契约对齐——运行期若放行 2+3 组合，
        // 重启后 dev 会被静默降权、prod 直接拒绝启动
        User actor = superAdmin();
        Role r2 = new Role();
        r2.setId(2L);
        Role r3 = new Role();
        r3.setId(3L);
        CustomException ex = assertThrows(CustomException.class,
                () -> policy.resolveRolesForWrite(actor, java.util.Arrays.asList(r2, r3), false));
        assertEquals("400", ex.getCode());
    }

    @Test
    public void superAdmin_canAssignSuperAdmin() {
        User actor = superAdmin();
        Role superRole = new Role();
        superRole.setId(1L);
        superRole.setName("超级管理员");
        when(roleService.getById(1L)).thenReturn(superRole);

        Role requested = new Role();
        requested.setId(1L);
        List<Role> resolved = policy.resolveRolesForWrite(actor, Collections.singletonList(requested), false);
        assertEquals(1, resolved.size());
        assertEquals(Long.valueOf(1L), resolved.get(0).getId());
    }

    @Test
    public void roleFlag_canAssignNormalButNotSuper() {
        User actor = userWithFlags("user", "role");
        Role r3 = new Role();
        r3.setId(3L);
        r3.setName("普通用户");
        when(roleService.getById(3L)).thenReturn(r3);

        Role requested = new Role();
        requested.setId(3L);
        List<Role> resolved = policy.resolveRolesForWrite(actor, Collections.singletonList(requested), false);
        assertEquals(Long.valueOf(3L), resolved.get(0).getId());

        Role reqSuper = new Role();
        reqSuper.setId(1L);
        // 无 roleService stub：在 getById 前即因非超管拦截
        assertThrows(CustomException.class,
                () -> policy.resolveRolesForWrite(actor, Collections.singletonList(reqSuper), false));
    }

    @Test
    public void explicitEmptyRoleList_isRejectedForUpdate() {
        CustomException ex = assertThrows(CustomException.class,
                () -> policy.resolveRolesForWrite(superAdmin(), Collections.emptyList(), false));

        assertEquals("400", ex.getCode());
    }

    @Test
    public void derivedVolunteerRole_cannotBeManuallyGranted() {
        Role requested = new Role();
        requested.setId(RoleAssignmentPolicy.DERIVED_VOLUNTEER_ROLE_ID);

        CustomException ex = assertThrows(CustomException.class,
                () -> policy.resolveRolesForWrite(superAdmin(),
                        Collections.singletonList(requested), false));

        assertEquals("400", ex.getCode());
    }

    @Test
    public void superAdminUser_cannotBeDemotedOrDeletedRegardlessOfCount() {
        User target = superAdmin();
        target.setId(20L);
        when(userService.getById(20L)).thenReturn(target);

        CustomException demote = assertThrows(CustomException.class,
                () -> policy.assertCanRemoveOrDemoteSuperAdmin(20L, Collections.emptyList()));
        CustomException delete = assertThrows(CustomException.class,
                () -> policy.assertCanDeleteUser(superAdmin(), 20L));

        assertEquals("403", demote.getCode());
        assertEquals("403", delete.getCode());
    }

    private static User userWithFlags(String... flags) {
        User u = new User();
        u.setId(10L);
        u.setUsername("manager");
        java.util.List<Permission> perms = new java.util.ArrayList<>();
        for (String f : flags) {
            Permission p = new Permission();
            p.setId((long) f.hashCode());
            p.setFlag(f);
            perms.add(p);
        }
        u.setPermission(perms);
        return u;
    }

    private static User superAdmin() {
        User u = userWithFlags("user", "role");
        Role r = new Role();
        r.setId(1L);
        u.setRole(Collections.singletonList(r));
        return u;
    }
}
