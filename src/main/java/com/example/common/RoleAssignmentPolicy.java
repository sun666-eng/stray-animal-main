package com.example.common;

import com.example.entity.Role;
import com.example.entity.User;
import com.example.exception.CustomException;
import com.example.service.RoleService;
import com.example.service.UserService;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * B1.1：角色分配精确授权。
 * <ul>
 *   <li>仅超级管理员（持有 roleId=1）可分配 roleId=1</li>
 *   <li>分配/变更角色需要 role 管理 flag 或超管；仅有 user flag 不能改角色</li>
 *   <li>只接受角色 ID，服务端查询完整 Role，拒绝客户端嵌套 permission</li>
 *   <li>不得删除/降级最后一个超级管理员</li>
 * </ul>
 */
@Component
public class RoleAssignmentPolicy {

    public static final long SUPER_ADMIN_ROLE_ID = 1L;
    public static final long DEFAULT_USER_ROLE_ID = 3L;

    private final RoleService roleService;
    private final UserService userService;

    public RoleAssignmentPolicy(RoleService roleService, UserService userService) {
        this.roleService = roleService;
        this.userService = userService;
    }

    public boolean isSuperAdmin(User user) {
        return hasRoleId(user, SUPER_ADMIN_ROLE_ID);
    }

    public boolean canManageUsers(User user) {
        return PermissionUtil.hasFlag(user, "user") || isSuperAdmin(user);
    }

    public boolean canAssignRoles(User user) {
        return PermissionUtil.hasFlag(user, "role") || isSuperAdmin(user);
    }

    public static boolean hasRoleId(User user, long roleId) {
        if (user == null || user.getRole() == null) {
            return false;
        }
        for (Object item : user.getRole()) {
            Long id = extractRoleId(item);
            if (id != null && id == roleId) {
                return true;
            }
        }
        return false;
    }

    public static Long extractRoleId(Object item) {
        if (item instanceof Role) {
            return ((Role) item).getId();
        }
        if (item instanceof Map) {
            Object idObj = ((Map<?, ?>) item).get("id");
            if (idObj instanceof Number) {
                return ((Number) idObj).longValue();
            }
            if (idObj instanceof String) {
                try {
                    return Long.parseLong((String) idObj);
                } catch (NumberFormatException ignored) {
                    return null;
                }
            }
        }
        return null;
    }

    public static Set<Long> extractRoleIds(List<?> roles) {
        Set<Long> ids = new LinkedHashSet<>();
        if (roles == null) {
            return ids;
        }
        for (Object item : roles) {
            Long id = extractRoleId(item);
            if (id != null) {
                ids.add(id);
            }
        }
        return ids;
    }

    /**
     * 解析并校验目标角色列表（仅 ID → 服务端 Role）。
     * @param requested 客户端提交的 role 列表，可为 null 表示不改角色
     * @param forceDefaultIfEmpty 新建用户且未提交角色时，是否落到普通用户角色 3
     */
    public List<Role> resolveRolesForWrite(User actor, List<?> requested, boolean forceDefaultIfEmpty) {
        if (requested == null || requested.isEmpty()) {
            if (forceDefaultIfEmpty) {
                Role def = roleService.getById(DEFAULT_USER_ROLE_ID);
                if (def == null) {
                    throw new CustomException("500", "普通用户角色未配置");
                }
                return slimList(def);
            }
            return null;
        }
        if (!canAssignRoles(actor)) {
            throw new CustomException("403", "无权分配或修改角色（需要 role 管理权限或超级管理员）");
        }
        Set<Long> ids = extractRoleIds(requested);
        if (ids.isEmpty()) {
            throw new CustomException("400", "角色 ID 无效");
        }
        if (ids.contains(SUPER_ADMIN_ROLE_ID) && !isSuperAdmin(actor)) {
            throw new CustomException("403", "仅超级管理员可分配超级管理员角色");
        }
        List<Role> resolved = new ArrayList<>();
        for (Long id : ids) {
            Role full = roleService.getById(id);
            if (full == null) {
                throw new CustomException("400", "角色不存在: " + id);
            }
            resolved.add(slim(full));
        }
        return resolved;
    }

    public void assertCanRemoveOrDemoteSuperAdmin(Long targetUserId, List<Role> newRoles) {
        if (targetUserId == null) {
            return;
        }
        User existing = userService.getById(targetUserId);
        if (existing == null || !hasRoleId(existing, SUPER_ADMIN_ROLE_ID)) {
            return;
        }
        boolean stillSuper = false;
        if (newRoles != null) {
            for (Role r : newRoles) {
                if (r != null && Long.valueOf(SUPER_ADMIN_ROLE_ID).equals(r.getId())) {
                    stillSuper = true;
                    break;
                }
            }
        }
        if (stillSuper) {
            return;
        }
        // 正在去掉超管角色：检查是否为最后一个
        if (countSuperAdmins() <= 1) {
            throw new CustomException("403", "不能降级或移除最后一个超级管理员");
        }
    }

    public void assertCanDeleteUser(User actor, Long targetUserId) {
        if (targetUserId == null) {
            throw new CustomException("400", "用户 ID 无效");
        }
        if (!canManageUsers(actor) && !isSuperAdmin(actor)) {
            throw new CustomException("403", "无权删除用户");
        }
        User target = userService.getById(targetUserId);
        if (target == null) {
            throw new CustomException("404", "用户不存在");
        }
        if (hasRoleId(target, SUPER_ADMIN_ROLE_ID)) {
            if (!isSuperAdmin(actor)) {
                throw new CustomException("403", "仅超级管理员可删除超级管理员");
            }
            if (countSuperAdmins() <= 1) {
                throw new CustomException("403", "不能删除最后一个超级管理员");
            }
        }
    }

    public long countSuperAdmins() {
        long count = 0;
        for (User u : userService.list()) {
            if (hasRoleId(u, SUPER_ADMIN_ROLE_ID)) {
                count++;
            }
        }
        return count;
    }

    private static Role slim(Role full) {
        Role slim = new Role();
        slim.setId(full.getId());
        slim.setName(full.getName());
        slim.setDescription(full.getDescription());
        // 不持久化客户端/库内可能膨胀的 permission JSON 到用户行以外的职责：用户只存 role 摘要
        return slim;
    }

    private static List<Role> slimList(Role full) {
        List<Role> list = new ArrayList<>();
        list.add(slim(full));
        return list;
    }
}
