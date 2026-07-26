package com.example.service;

import com.example.entity.Permission;
import com.example.entity.Role;
import com.example.entity.User;
import com.example.mapper.UserMapper;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 规范化 Phase 1 后的 fillPermissions：权限来源为 role_permission 关联表
 * （经 PermissionService.findByRoleIds），超管仍拉全表。
 */
@ExtendWith(MockitoExtension.class)
public class UserServiceFillPermissionsTest {

    @Mock
    UserMapper userMapper;

    @Mock
    RoleService roleService;

    @Mock
    PermissionService permissionService;

    @InjectMocks
    UserService userService;

    private static Permission permission(long id, String flag, String name, String path) {
        Permission p = new Permission();
        p.setId(id);
        p.setFlag(flag);
        p.setName(name);
        p.setPath(path);
        return p;
    }

    @Test
    public void superAdmin_getsAllDbPermissions_withoutRelationQuery() {
        when(permissionService.list()).thenReturn(java.util.Arrays.asList(
                permission(7L, "visit", "回访管理", "/page/end/visit.html"),
                permission(8L, "adopt", "领养审核", "/page/end/adopt.html")));

        User user = new User();
        user.setId(1L);
        user.setUsername("admin");
        Role slim = new Role();
        slim.setId(1L);
        slim.setName("超级管理员");
        user.setRole(Collections.singletonList(slim));

        userService.fillPermissions(user);

        assertTrue(user.getPermission().stream().anyMatch(p -> "visit".equals(p.getFlag())));
        assertTrue(user.getPermission().stream().anyMatch(p -> "adopt".equals(p.getFlag())));
        // 超管无需再查关联表
        verify(permissionService, never()).findByRoleIds(anyCollection());
    }

    @Test
    @SuppressWarnings({"rawtypes", "unchecked"})
    public void roleIdFromDirtyJsonMap_resolvedViaRelationTable() {
        // user.role 仍是 JSON（Phase 2 前不变）：兼容 Map 形态 + 数字 id
        when(permissionService.findByRoleIds(java.util.Arrays.asList(2L)))
                .thenReturn(Collections.singletonList(
                        permission(7L, "visit", "回访管理", "/page/end/visit.html")));

        User user = new User();
        Map<String, Object> roleMap = new HashMap<>();
        roleMap.put("id", 2);
        roleMap.put("name", "志愿者");
        List roles = new ArrayList();
        roles.add(roleMap);
        user.setRole(roles);

        userService.fillPermissions(user);

        assertTrue(user.getPermission().stream().anyMatch(p -> "visit".equals(p.getFlag())));
    }

    @Test
    public void normalUser_withoutAdminFlags_hasNoVisit() {
        when(permissionService.findByRoleIds(java.util.Arrays.asList(3L)))
                .thenReturn(Collections.singletonList(
                        permission(43L, "adopt_view", "动物浏览", "/page/front/animal_browse.html")));

        User user = new User();
        Role slim = new Role();
        slim.setId(3L);
        user.setRole(Collections.singletonList(slim));

        userService.fillPermissions(user);

        assertFalse(user.getPermission().stream().anyMatch(p -> "visit".equals(p.getFlag())));
        assertTrue(user.getPermission().stream().anyMatch(p -> "adopt_view".equals(p.getFlag())));
    }

    @Test
    public void emptyRelationResult_yieldsNoPermissions() {
        // 关联表只含仍存在于 t_permission 的 ID：陈旧引用不会出现在结果中
        when(permissionService.findByRoleIds(java.util.Arrays.asList(2L)))
                .thenReturn(Collections.emptyList());

        User user = new User();
        Role slim = new Role();
        slim.setId(2L);
        user.setRole(Collections.singletonList(slim));

        userService.fillPermissions(user);

        assertTrue(user.getPermission().isEmpty());
    }

    @Test
    public void blankFlagPermissions_areFilteredOut() {
        when(permissionService.findByRoleIds(java.util.Arrays.asList(3L)))
                .thenReturn(java.util.Arrays.asList(
                        permission(43L, "adopt_view", "动物浏览", "/page/front/animal_browse.html"),
                        permission(44L, "  ", "空flag", "/page/end/broken.html")));

        User user = new User();
        Role slim = new Role();
        slim.setId(3L);
        user.setRole(Collections.singletonList(slim));

        userService.fillPermissions(user);

        assertTrue(user.getPermission().stream().anyMatch(p -> "adopt_view".equals(p.getFlag())));
        assertFalse(user.getPermission().stream().anyMatch(p -> "/page/end/broken.html".equals(p.getPath())));
    }
}
