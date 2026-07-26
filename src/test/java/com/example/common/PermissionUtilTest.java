package com.example.common;

import com.example.entity.Permission;
import com.example.entity.Role;
import com.example.entity.User;
import org.junit.jupiter.api.Test;

import java.util.Collections;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class PermissionUtilTest {

    @Test
    void embeddedRolePermissionNeverActsAsAuthorizationAuthority() {
        Permission stale = new Permission();
        stale.setFlag("user");
        Role role = new Role();
        role.setId(3L);
        role.setPermission(Collections.singletonList(stale));
        User user = new User();
        user.setRole(Collections.singletonList(role));

        assertFalse(PermissionUtil.hasFlag(user, "user"));

        user.setPermission(Collections.singletonList(stale));
        assertTrue(PermissionUtil.hasFlag(user, "user"));
    }
}
