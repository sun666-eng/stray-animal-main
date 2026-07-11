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
import static org.mockito.Mockito.when;

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

    @Test
    public void superAdmin_withNullRolePermissionJson_getsAllDbPermissions() {
        Role role = new Role();
        role.setId(1L);
        role.setName("超级管理员");
        role.setPermission(null);
        when(roleService.getById(1L)).thenReturn(role);

        Permission visit = new Permission();
        visit.setId(7L);
        visit.setName("回访管理");
        visit.setFlag("visit");
        visit.setPath("/page/end/visit.html");
        Permission adopt = new Permission();
        adopt.setId(8L);
        adopt.setName("领养审核");
        adopt.setFlag("adopt");
        adopt.setPath("/page/end/adopt.html");
        when(permissionService.list()).thenReturn(listOf(visit, adopt));

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
    }

    @Test
    @SuppressWarnings({"rawtypes", "unchecked"})
    public void rolePermissionIds_resolvedFromPermissionTable() {
        Permission dbVisit = new Permission();
        dbVisit.setId(7L);
        dbVisit.setFlag("visit");
        dbVisit.setName("回访管理");
        dbVisit.setPath("/page/end/visit.html");

        Map<String, Object> embedded = new HashMap<String, Object>();
        embedded.put("id", 7);
        // 故意不给 flag，模拟截断/脏 JSON

        Role role = new Role();
        role.setId(2L);
        List rawPerms = new ArrayList();
        rawPerms.add(embedded);
        role.setPermission(rawPerms);

        when(roleService.getById(2L)).thenReturn(role);
        when(permissionService.getById(7L)).thenReturn(dbVisit);

        User user = new User();
        Map<String, Object> roleMap = new HashMap<String, Object>();
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
        Permission browse = new Permission();
        browse.setId(43L);
        browse.setFlag("adopt_view");
        browse.setName("动物浏览");
        browse.setPath("/page/front/animal_browse.html");

        Role role = new Role();
        role.setId(3L);
        role.setPermission(Collections.singletonList(browse));
        when(roleService.getById(3L)).thenReturn(role);
        when(permissionService.getById(43L)).thenReturn(browse);

        User user = new User();
        Role slim = new Role();
        slim.setId(3L);
        user.setRole(Collections.singletonList(slim));

        userService.fillPermissions(user);

        assertFalse(user.getPermission().stream().anyMatch(p -> "visit".equals(p.getFlag())));
        assertTrue(user.getPermission().stream().anyMatch(p -> "adopt_view".equals(p.getFlag())));
    }

    private static List<Permission> listOf(Permission... items) {
        List<Permission> list = new ArrayList<Permission>();
        Collections.addAll(list, items);
        return list;
    }
}
