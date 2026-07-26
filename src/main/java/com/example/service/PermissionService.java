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

    @Resource
    private com.example.mapper.RolePermissionMapper rolePermissionMapper;

    public List<Permission> getByRoles(List<Role> roles) {
        List<Long> roleIds = new ArrayList<>();
        if (roles != null) {
            for (Role role : roles) {
                if (role != null && role.getId() != null && !roleIds.contains(role.getId())) {
                    roleIds.add(role.getId());
                }
            }
        }
        return findByRoleIds(roleIds);
    }

    /**
     * 规范化 Phase 1：按角色 ID 集合从 role_permission 关联表加载权限定义
     * （替代逐角色读内嵌 JSON + 逐权限 getById 的 N+1）。
     * 结果按 roleIds 顺序展开、按权限 ID 去重，权限内容一律以 t_permission 现行定义为准。
     */
    public List<Permission> findByRoleIds(java.util.Collection<Long> roleIds) {
        List<Permission> result = new ArrayList<>();
        if (roleIds == null || roleIds.isEmpty()) {
            return result;
        }
        List<Long> permissionIds = new ArrayList<>();
        for (Long roleId : roleIds) {
            if (roleId == null) {
                continue;
            }
            for (com.example.entity.RolePermission rp : rolePermissionMapper.selectList(
                    Wrappers.<com.example.entity.RolePermission>query()
                            .eq("role_id", roleId).orderByAsc("permission_id"))) {
                if (rp.getPermissionId() != null && !permissionIds.contains(rp.getPermissionId())) {
                    permissionIds.add(rp.getPermissionId());
                }
            }
        }
        if (permissionIds.isEmpty()) {
            return result;
        }
        Map<Long, Permission> byId = new java.util.HashMap<>();
        for (Permission p : listByIds(permissionIds)) {
            if (p != null && p.getId() != null) {
                byId.put(p.getId(), p);
            }
        }
        for (Long pid : permissionIds) {
            Permission p = byId.get(pid);
            if (p != null) {
                result.add(p);
            }
        }
        return result;
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
        Permission effective = new Permission();
        effective.setId(existing.getId());
        effective.setName(submitted.getName() == null ? existing.getName() : submitted.getName());
        effective.setDescription(submitted.getDescription() == null ? existing.getDescription() : submitted.getDescription());
        effective.setFlag(submitted.getFlag() == null ? existing.getFlag() : submitted.getFlag());
        effective.setPath(submitted.getPath() == null ? existing.getPath() : submitted.getPath());
        normalizeAndValidate(effective, effective.getId());
        // 审计修复 H2：仅鉴权语义字段（flag/path）变更才要求未被引用；
        // 名称/描述的修改放行——否则内置角色引用的 15 个种子权限连描述都永远改不了（闭环无出口）。
        boolean semanticChange = !safeEquals(effective.getFlag(), existing.getFlag())
                || !safeEquals(effective.getPath(), existing.getPath());
        if (semanticChange) {
            assertNotReferenced(submitted.getId());
        }
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

    private static boolean safeEquals(String left, String right) {
        return left == null ? right == null : left.equals(right);
    }

    /** 规范化 Phase 1：引用检查由全表 JSON 扫描改为关联表 COUNT，一致且 O(1)。 */
    private void assertNotReferenced(Long permissionId) {
        Long refs = rolePermissionMapper.selectCount(
                Wrappers.<com.example.entity.RolePermission>query().eq("permission_id", permissionId));
        if (refs != null && refs > 0) {
            throw new CustomException("409", "权限已被角色引用，不能修改或删除");
        }
    }

    private void requireSuperAdmin(User actor) {
        User fresh = actor == null || actor.getId() == null ? null : userMapper.selectById(actor.getId());
        if (!RoleAssignmentPolicy.hasRoleId(fresh, RoleAssignmentPolicy.SUPER_ADMIN_ROLE_ID)) {
            throw new CustomException("403", "仅超级管理员可修改权限定义");
        }
    }

}
