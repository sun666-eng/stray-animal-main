package com.example.service;

import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.example.common.RoleAssignmentPolicy;
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
        if (isBuiltInRole(role.getId())) {
            throw new CustomException("403", "内置角色不可修改");
        }
        Role existing = roleMapper.selectById(role.getId());
        if (existing == null) {
            throw new CustomException("404", "角色不存在");
        }
        if (role.getPermission() != null) {
            role.setPermission(resolvePermissions(role.getPermission()));
        }
        if (roleMapper.updateById(role) != 1) {
            throw new CustomException("409", "角色更新失败，请刷新后重试");
        }
        // 角色权限内容变更影响所有持有该角色的用户，无法反查，须全量失效鉴权缓存
        authUserCache.invalidateAll();
        return true;
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

    private boolean isBuiltInRole(Long id) {
        return id != null && id >= 1L && id <= 4L;
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
