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
 *   <li>roleId=4 是义工审核结果的派生角色，通用用户接口不得直接分配或移除</li>
 *   <li>超级管理员角色成员不可通过通用用户 CRUD 删除或降级</li>
 * </ul>
 */
@Component
public class RoleAssignmentPolicy {

    public static final long SUPER_ADMIN_ROLE_ID = 1L;
    public static final long LEGACY_VOLUNTEER_ROLE_ID = 2L;
    public static final long DEFAULT_USER_ROLE_ID = 3L;
    public static final long DERIVED_VOLUNTEER_ROLE_ID = 4L;

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
        if (requested == null) {
            if (forceDefaultIfEmpty) {
                Role def = roleService.getById(DEFAULT_USER_ROLE_ID);
                if (def == null) {
                    throw new CustomException("500", "普通用户角色未配置");
                }
                return slimList(def);
            }
            return null;
        }
        if (requested.isEmpty()) {
            if (forceDefaultIfEmpty) {
                Role def = roleService.getById(DEFAULT_USER_ROLE_ID);
                if (def == null) {
                    throw new CustomException("500", "普通用户角色未配置");
                }
                return slimList(def);
            }
            throw new CustomException("400", "角色列表不能为空");
        }
        if (!canAssignRoles(actor)) {
            throw new CustomException("403", "无权分配或修改角色（需要 role 管理权限或超级管理员）");
        }
        Set<Long> ids = extractRoleIds(requested);
        if (ids.isEmpty()) {
            throw new CustomException("400", "角色 ID 无效");
        }
        if (ids.contains(DERIVED_VOLUNTEER_ROLE_ID)) {
            throw new CustomException("400", "认证义工角色由审核结果派生，不能通过用户接口分配或移除");
        }
        // 与启动期 RolePermissionGuard 契约对齐：角色2(志愿者后台)+角色3(普通用户)组合视为越权，
        // 运行期若放行，重启后会被 Guard 降权（dev 静默改写 / prod 拒绝启动）。
        if (ids.contains(LEGACY_VOLUNTEER_ROLE_ID) && ids.contains(DEFAULT_USER_ROLE_ID)) {
            throw new CustomException("400", "志愿者(2)与普通用户(3)角色互斥；义工资质请通过义工审核流程获得");
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
        throw new CustomException("403", "超级管理员角色不可通过通用用户接口修改");
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
            throw new CustomException("403", "超级管理员用户不可通过通用用户接口删除");
        }
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
