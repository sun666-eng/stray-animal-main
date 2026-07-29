package com.example.service;

import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.example.common.RoleAssignmentPolicy;
import com.example.common.RoleContracts;
import com.example.common.RolePermissionWriteLock;
import com.example.entity.Permission;
import com.example.entity.Role;
import com.example.entity.User;
import com.example.exception.CustomException;
import com.example.mapper.PermissionMapper;
import com.example.mapper.RoleMapper;
import com.example.mapper.UserMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import jakarta.annotation.Resource;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

@Service
public class RoleService extends ServiceImpl<RoleMapper, Role> {
    private static final int MAX_REFERENCE_SCAN = 10000;

    @Resource
    private RoleMapper roleMapper;

    @Resource
    private PermissionMapper permissionMapper;

    @Resource
    private UserMapper userMapper;

    @Resource
    private com.example.common.AuthUserCache authUserCache;

    @Resource
    private com.example.mapper.RolePermissionMapper rolePermissionMapper;

    @Transactional
    public boolean createDefinition(Role role, User actor) {
        return RolePermissionWriteLock.execute(() -> createDefinitionLocked(role, actor));
    }

    private boolean createDefinitionLocked(Role role, User actor) {
        requireSuperAdmin(actor);
        if (role == null) {
            throw new CustomException("400", "角色信息不能为空");
        }
        role.setId(null);
        role.setPermission(resolvePermissions(role.getPermission()));
        if (roleMapper.insert(role) != 1) {
            throw new CustomException("500", "角色保存失败");
        }
        // 规范化 Phase 1 双写：JSON 列之外同步 role_permission 关联行（同事务）
        syncRolePermissions(role.getId(), role.getPermission());
        return true;
    }

    @Transactional
    public boolean updateDefinition(Role role, User actor) {
        return RolePermissionWriteLock.execute(() -> updateDefinitionLocked(role, actor));
    }

    private boolean updateDefinitionLocked(Role role, User actor) {
        requireSuperAdmin(actor);
        if (role == null || role.getId() == null) {
            throw new CustomException("400", "角色 ID 不能为空");
        }
        // 仅超级管理员角色(id=1)完全锁定；角色 2/3/4 允许超管在契约约束下调整权限。
        // 否则默认库只有 1–4 四个角色时，管理端「编辑」全部 disabled，功能形同失效。
        if (isSuperAdminRole(role.getId())) {
            throw new CustomException("403", "超级管理员角色不可修改");
        }
        Role existing = roleMapper.selectById(role.getId());
        if (existing == null) {
            throw new CustomException("404", "角色不存在");
        }
        if (role.getPermission() != null) {
            role.setPermission(resolvePermissions(role.getPermission()));
            validateBuiltInRolePermissions(role.getId(), role.getPermission());
        }
        if (roleMapper.updateById(role) != 1) {
            throw new CustomException("409", "角色更新失败，请刷新后重试");
        }
        // 双写：仅当本次提交携带 permission（即 JSON 列被更新）时同步关联行
        if (role.getPermission() != null) {
            syncRolePermissions(role.getId(), role.getPermission());
        }
        // 角色权限内容变更影响所有持有该角色的用户，无法反查，须全量失效鉴权缓存
        authUserCache.invalidateAll();
        return true;
    }

    /** 规范化 Phase 1：以 resolvePermissions 后的列表为准，整组重建该角色的关联行。 */
    private void syncRolePermissions(Long roleId, List<Permission> resolved) {
        rolePermissionMapper.delete(com.baomidou.mybatisplus.core.toolkit.Wrappers
                .<com.example.entity.RolePermission>query().eq("role_id", roleId));
        java.util.Set<Long> seen = new java.util.LinkedHashSet<>();
        if (resolved != null) {
            for (Permission p : resolved) {
                if (p != null && p.getId() != null) {
                    seen.add(p.getId());
                }
            }
        }
        for (Long permissionId : seen) {
            com.example.entity.RolePermission rp = new com.example.entity.RolePermission();
            rp.setRoleId(roleId);
            rp.setPermissionId(permissionId);
            rolePermissionMapper.insert(rp);
        }
    }

    @Transactional
    public void deleteDefinition(Long id, User actor) {
        RolePermissionWriteLock.execute(() -> {
            deleteDefinitionLocked(id, actor);
            return null;
        });
    }

    private void deleteDefinitionLocked(Long id, User actor) {
        requireSuperAdmin(actor);
        if (id == null) {
            throw new CustomException("400", "角色 ID 无效");
        }
        if (isBuiltInRole(id)) {
            throw new CustomException("403", "内置角色不可删除");
        }
        if (roleMapper.selectById(id) == null) {
            throw new CustomException("404", "角色不存在");
        }
        List<User> users = userMapper.selectList(new QueryWrapper<User>()
                .select("id", "role").last("LIMIT " + (MAX_REFERENCE_SCAN + 1)));
        if (users.size() > MAX_REFERENCE_SCAN) {
            throw new CustomException("409", "用户数量超过安全扫描上限，禁止删除角色");
        }
        for (User user : users) {
            if (RoleAssignmentPolicy.hasRoleId(user, id)) {
                throw new CustomException("409", "角色已被用户引用，不能删除");
            }
        }
        if (roleMapper.deleteById(id) != 1) {
            throw new CustomException("409", "角色删除失败，请刷新后重试");
        }
        // 双写：角色删除时清掉关联行
        rolePermissionMapper.delete(com.baomidou.mybatisplus.core.toolkit.Wrappers
                .<com.example.entity.RolePermission>query().eq("role_id", id));
        authUserCache.invalidateAll();
    }

    /**
     * 兜底：继承自 ServiceImpl 的通用更新（现存调用方为启动期 DataFixRunner；
     * saveOrUpdate 的更新分支同样走到这里）。任何角色内容变更都须全量失效鉴权缓存。
     */
    @Override
    public boolean updateById(Role role) {
        boolean updated = super.updateById(role);
        if (updated) {
            authUserCache.invalidateAll();
        }
        return updated;
    }

    /** 系统种子角色：不可删除（删除会破坏用户闭环与启动守护）。 */
    private boolean isBuiltInRole(Long id) {
        return id != null && id >= 1L && id <= 4L;
    }

    /** 超级管理员角色：不可改权限/名称，防止锁死后台。 */
    private boolean isSuperAdminRole(Long id) {
        return id != null && id.equals(RoleAssignmentPolicy.SUPER_ADMIN_ROLE_ID);
    }

    /**
     * 内置角色 3/4 受 RoleContracts 约束；角色 2（管理志愿者）可自由挂管理 flag。
     * 自定义角色（id>4）不做契约强校验。
     */
    private void validateBuiltInRolePermissions(Long roleId, List<Permission> permissions) {
        if (roleId == null || roleId > 4L) {
            return;
        }
        Set<String> flags = new LinkedHashSet<>();
        if (permissions != null) {
            for (Permission p : permissions) {
                if (p != null && p.getFlag() != null && !p.getFlag().trim().isEmpty()) {
                    flags.add(p.getFlag().trim());
                }
            }
        }
        if (roleId == 3L) {
            if (!flags.containsAll(RoleContracts.USER_LOOP_FLAGS)) {
                Set<String> missing = new LinkedHashSet<>(RoleContracts.USER_LOOP_FLAGS);
                missing.removeAll(flags);
                throw new CustomException("400",
                        "普通用户角色必须保留用户闭环权限: " + String.join(", ", missing));
            }
            for (String flag : flags) {
                if (RoleContracts.ADMIN_FLAGS.contains(flag)) {
                    throw new CustomException("400",
                            "普通用户角色不能包含后台管理权限: " + flag);
                }
            }
        }
        if (roleId == 4L) {
            for (String flag : flags) {
                if (RoleContracts.ADMIN_FLAGS.contains(flag)) {
                    throw new CustomException("400",
                            "认证义工角色不能包含后台管理权限: " + flag);
                }
            }
        }
    }

    private List<Permission> resolvePermissions(List<?> requested) {
        List<Permission> resolved = new ArrayList<>();
        if (requested == null) {
            return resolved;
        }
        Set<Long> seen = new HashSet<>();
        for (Object item : requested) {
            Long id = item instanceof Permission ? ((Permission) item).getId() : null;
            if (id == null) {
                throw new CustomException("400", "权限 ID 无效");
            }
            if (!seen.add(id)) {
                continue;
            }
            Permission permission = permissionMapper.selectById(id);
            if (permission == null) {
                throw new CustomException("400", "权限不存在: " + id);
            }
            resolved.add(permission);
        }
        return resolved;
    }

    private void requireSuperAdmin(User actor) {
        User fresh = actor == null || actor.getId() == null ? null : userMapper.selectById(actor.getId());
        if (!RoleAssignmentPolicy.hasRoleId(fresh, RoleAssignmentPolicy.SUPER_ADMIN_ROLE_ID)) {
            throw new CustomException("403", "仅超级管理员可修改角色定义");
        }
    }

}
