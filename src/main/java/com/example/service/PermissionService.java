package com.example.service;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.baomidou.mybatisplus.core.conditions.Wrapper;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.example.common.RoleAssignmentPolicy;
import com.example.common.RolePermissionWriteLock;
import com.example.entity.Permission;
import com.example.entity.Role;
import com.example.entity.User;
import com.example.exception.CustomException;
import com.example.mapper.PermissionMapper;
import com.example.mapper.UserMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import jakarta.annotation.Resource;
import java.io.Serializable;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

@Service
public class PermissionService extends ServiceImpl<PermissionMapper, Permission> {
    private static final int MAX_REFERENCE_SCAN = 10000;

    private static final Set<String> KNOWN_FLAGS = Collections.unmodifiableSet(new HashSet<>(Arrays.asList(
            "user", "role", "permission", "animal", "adopt", "proof", "visit",
            "volunteer", "account", "notice", "help", "rescue", "im", "adopt_view",
            "my_adopt", "my_proof", "apply"
    )));

    private static final Set<String> ALLOWED_PATHS = Collections.unmodifiableSet(new HashSet<>(Arrays.asList(
            "/page/end/user.html", "/page/end/role.html", "/page/end/permission.html",
            "/page/end/animal.html", "/page/end/adopt.html", "/page/end/proof.html",
            "/page/end/visit.html", "/page/end/volunteer.html", "/page/end/account.html",
            "/page/end/notice.html", "/page/end/help.html", "/page/end/rescue.html"
    )));

    @Resource
    private PermissionMapper permissionMapper;

    @Resource
    private RoleService roleService;

    @Resource
    private UserMapper userMapper;

    @Resource
    private com.example.common.AuthUserCache authUserCache;

    public List<Permission> getByRoles(List<Role> roles) {
        List<Permission> permissions = new ArrayList<>();
        if (roles == null) {
            return permissions;
        }
        for (Role role : roles) {
            if (role == null || role.getId() == null) {
                continue;
            }
            Role r = roleService.getById(role.getId());
            if (r != null && r.getPermission() != null) {
                permissions.addAll(r.getPermission());
            }
        }
        return permissions;
    }

    @Transactional
    public boolean createDefinition(Permission permission, User actor) {
        return RolePermissionWriteLock.execute(() -> createDefinitionLocked(permission, actor));
    }

    private boolean createDefinitionLocked(Permission permission, User actor) {
        requireSuperAdmin(actor);
        if (permission == null) {
            throw new CustomException("400", "权限信息不能为空");
        }
        permission.setId(null);
        normalizeAndValidate(permission, null);
        if (permissionMapper.insert(permission) != 1) {
            throw new CustomException("500", "权限保存失败");
        }
        // 超管的 fillPermissions 始终拉全表：新权限立即属于全部超管，须全量失效鉴权缓存
        authUserCache.invalidateAll();
        return true;
    }

    @Transactional
    public boolean updateDefinition(Permission submitted, User actor) {
        return RolePermissionWriteLock.execute(() -> updateDefinitionLocked(submitted, actor));
    }

    private boolean updateDefinitionLocked(Permission submitted, User actor) {
        requireSuperAdmin(actor);
        if (submitted == null || submitted.getId() == null) {
            throw new CustomException("400", "权限 ID 不能为空");
        }
        Permission existing = permissionMapper.selectById(submitted.getId());
        if (existing == null) {
            throw new CustomException("404", "权限不存在");
        }
        assertNotReferenced(submitted.getId());
        Permission effective = new Permission();
        effective.setId(existing.getId());
        effective.setName(submitted.getName() == null ? existing.getName() : submitted.getName());
        effective.setDescription(submitted.getDescription() == null ? existing.getDescription() : submitted.getDescription());
        effective.setFlag(submitted.getFlag() == null ? existing.getFlag() : submitted.getFlag());
        effective.setPath(submitted.getPath() == null ? existing.getPath() : submitted.getPath());
        normalizeAndValidate(effective, effective.getId());
        if (permissionMapper.updateById(effective) != 1) {
            throw new CustomException("409", "权限更新失败，请刷新后重试");
        }
        // 权限定义（flag/name/path）变更影响所有内嵌引用者与全部超管，须全量失效鉴权缓存
        authUserCache.invalidateAll();
        return true;
    }

    /**
     * 兜底：继承自 ServiceImpl 的通用更新（当前无调用方，防未来旁路绕过失效；
     * saveOrUpdate 的更新分支同样走到这里）。
     */
    @Override
    public boolean updateById(Permission permission) {
        boolean updated = super.updateById(permission);
        if (updated) {
            authUserCache.invalidateAll();
        }
        return updated;
    }

    @Transactional
    public void deleteDefinition(Long id, User actor) {
        throw new CustomException("409", "权限定义通过 JSON 被角色引用，禁止删除");
    }

    @Override
    public boolean removeById(Serializable id) {
        throw deletionProhibited();
    }

    @Override
    public boolean removeById(Serializable id, boolean useFill) {
        throw deletionProhibited();
    }

    @Override
    public boolean removeById(Permission entity) {
        throw deletionProhibited();
    }

    @Override
    public boolean removeByMap(Map<String, Object> columnMap) {
        throw deletionProhibited();
    }

    @Override
    public boolean remove(Wrapper<Permission> queryWrapper) {
        throw deletionProhibited();
    }

    @Override
    public boolean removeByIds(java.util.Collection<?> list) {
        throw deletionProhibited();
    }

    @Override
    public boolean removeByIds(java.util.Collection<?> list, boolean useFill) {
        throw deletionProhibited();
    }

    @Override
    public boolean removeBatchByIds(java.util.Collection<?> list) {
        throw deletionProhibited();
    }

    @Override
    public boolean removeBatchByIds(java.util.Collection<?> list, boolean useFill) {
        throw deletionProhibited();
    }

    @Override
    public boolean removeBatchByIds(java.util.Collection<?> list, int batchSize) {
        throw deletionProhibited();
    }

    @Override
    public boolean removeBatchByIds(java.util.Collection<?> list, int batchSize, boolean useFill) {
        throw deletionProhibited();
    }

    private CustomException deletionProhibited() {
        return new CustomException("409", "权限定义通过 JSON 被角色引用，禁止删除");
    }

    private void normalizeAndValidate(Permission permission, Long excludeId) {
        String flag = permission.getFlag() == null ? "" : permission.getFlag().trim();
        String path = permission.getPath() == null ? "" : permission.getPath().trim();
        if (!KNOWN_FLAGS.contains(flag)) {
            throw new CustomException("400", "未知的权限标识");
        }
        if (!path.isEmpty() && !ALLOWED_PATHS.contains(path)) {
            throw new CustomException("400", "权限路径必须是允许的内部后台页面路径或留空");
        }
        permission.setFlag(flag);
        permission.setPath(path);
        long sameFlagCount = permissionMapper.selectCount(Wrappers.<Permission>lambdaQuery()
                .eq(Permission::getFlag, flag)
                .ne(excludeId != null, Permission::getId, excludeId));
        if (sameFlagCount > 0) {
            throw new CustomException("409", "权限标识已存在");
        }
        if (!path.isEmpty()) {
            long samePathCount = permissionMapper.selectCount(Wrappers.<Permission>lambdaQuery()
                    .eq(Permission::getPath, path)
                    .ne(excludeId != null, Permission::getId, excludeId));
            if (samePathCount > 0) {
                throw new CustomException("409", "权限路径已存在");
            }
        }
    }

    private void assertNotReferenced(Long permissionId) {
        List<Role> roles = roleService.list(new QueryWrapper<Role>()
                .select("id", "permission").last("LIMIT " + (MAX_REFERENCE_SCAN + 1)));
        if (roles.size() > MAX_REFERENCE_SCAN) {
            throw new CustomException("409", "角色数量超过安全扫描上限，禁止修改权限定义");
        }
        for (Role role : roles) {
            if (role == null || role.getPermission() == null) {
                continue;
            }
            for (Object item : role.getPermission()) {
                if (permissionId.equals(extractPermissionId(item))) {
                    throw new CustomException("409", "权限已被角色引用，不能修改或删除");
                }
            }
        }
    }

    private void requireSuperAdmin(User actor) {
        User fresh = actor == null || actor.getId() == null ? null : userMapper.selectById(actor.getId());
        if (!RoleAssignmentPolicy.hasRoleId(fresh, RoleAssignmentPolicy.SUPER_ADMIN_ROLE_ID)) {
            throw new CustomException("403", "仅超级管理员可修改权限定义");
        }
    }

    private Long extractPermissionId(Object item) {
        if (item instanceof Permission) {
            return ((Permission) item).getId();
        }
        if (item instanceof Map) {
            Object id = ((Map<?, ?>) item).get("id");
            if (id instanceof Number) {
                return ((Number) id).longValue();
            }
            if (id instanceof String) {
                try {
                    return Long.valueOf(((String) id).trim());
                } catch (NumberFormatException ignored) {
                    return null;
                }
            }
        }
        return null;
    }
}
