package com.example.common;

import com.example.entity.Permission;
import com.example.entity.Role;
import com.example.entity.User;

import java.util.Arrays;
import java.util.Map;

public class PermissionUtil {

    private PermissionUtil() {
    }

    public static boolean hasAnyFlag(User user, String... flags) {
        if (user == null || flags == null || flags.length == 0) {
            return false;
        }
        return Arrays.stream(flags).anyMatch(flag -> hasFlag(user, flag));
    }

    public static boolean hasFlag(User user, String flag) {
        if (user == null || flag == null) {
            return false;
        }
        if (user.getPermission() != null) {
            for (Object item : user.getPermission()) {
                if (item instanceof Permission) {
                    if (flag.equals(((Permission) item).getFlag())) {
                        return true;
                    }
                } else if (item instanceof Map) {
                    Object f = ((Map<?, ?>) item).get("flag");
                    if (flag.equals(f)) {
                        return true;
                    }
                }
            }
        }
        if (user.getRole() != null) {
            for (Object roleItem : user.getRole()) {
                if (roleItem instanceof Role) {
                    Role role = (Role) roleItem;
                    if (role.getPermission() == null) continue;
                    for (Object perm : role.getPermission()) {
                        if (perm instanceof Permission) {
                            if (flag.equals(((Permission) perm).getFlag())) {
                                return true;
                            }
                        } else if (perm instanceof Map) {
                            Object f = ((Map<?, ?>) perm).get("flag");
                            if (flag.equals(f)) {
                                return true;
                            }
                        }
                    }
                } else if (roleItem instanceof Map) {
                    Object perms = ((Map<?, ?>) roleItem).get("permission");
                    if (perms instanceof Iterable) {
                        for (Object perm : (Iterable<?>) perms) {
                            if (perm instanceof Permission) {
                                if (flag.equals(((Permission) perm).getFlag())) {
                                    return true;
                                }
                            } else if (perm instanceof Map) {
                                Object f = ((Map<?, ?>) perm).get("flag");
                                if (flag.equals(f)) {
                                    return true;
                                }
                            }
                        }
                    }
                }
            }
        }
        return false;
    }
}
