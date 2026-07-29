package com.example.component;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.example.common.StartupMutationPolicy;
import com.example.entity.Permission;
import com.example.entity.Role;
import com.example.entity.RolePermission;
import com.example.mapper.PermissionMapper;
import com.example.mapper.RolePermissionMapper;
import com.example.service.RoleService;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.annotation.Order;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 角色权限规范化 Phase 1：启动时将 t_role.permission JSON（历史权威）单向对账
 * 同步到 role_permission 关联表。
 *
 * <p>过渡期架构（勿在未完成 Phase 2 前破坏）：
 * <ul>
 *   <li>JSON 列继续由既有 Guard/DataFix 维护，仍是启动期事实源；本 Runner 在
 *       所有 JSON 写入者之后运行（SchemaGuard@0、RolePermissionGuard@10、
 *       DataFixRunner@60），把最终形态落到关联表。</li>
 *   <li>运行期 RoleService 定义写入双写（JSON + 关联表，同事务）。</li>
 *   <li>读路径（UserService.fillPermissions / PermissionService.getByRoles /
 *       assertNotReferenced）只读关联表。</li>
 * </ul>
 * 对账幂等：只做集合差（补缺行、删多余行），无变化零写入。
 */
@Slf4j
@Component
@Order(70)
public class RolePermissionSyncRunner implements ApplicationRunner {

    private final RoleService roleService;
    private final RolePermissionMapper rolePermissionMapper;
    private final PermissionMapper permissionMapper;
    private final JdbcTemplate jdbcTemplate;
    private final StartupMutationPolicy mutationPolicy;

    @Value("${app.role-guard.fail-fast:false}")
    private boolean failFast;

    public RolePermissionSyncRunner(RoleService roleService,
                                    RolePermissionMapper rolePermissionMapper,
                                    PermissionMapper permissionMapper,
                                    JdbcTemplate jdbcTemplate,
                                    StartupMutationPolicy mutationPolicy) {
        this.roleService = roleService;
        this.rolePermissionMapper = rolePermissionMapper;
        this.permissionMapper = permissionMapper;
        this.jdbcTemplate = jdbcTemplate;
        this.mutationPolicy = mutationPolicy;
    }

    @Override
    public void run(ApplicationArguments args) {
        Integer tableCount = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM information_schema.tables "
                        + "WHERE table_schema = DATABASE() AND table_name = 'role_permission'",
                Integer.class);
        if (tableCount == null || tableCount == 0) {
            // SchemaGuard auto-migrate 会建表；生产 pure-check 须先执行 docs/sql/2026-07-26-role-permission.sql
            throw new IllegalStateException(
                    "[RolePermissionSync] 缺少 role_permission 表，请先执行 docs/sql/2026-07-26-role-permission.sql");
        }

        // 仅接受仍存在于 t_permission 的权限 ID，陈旧引用一律丢弃（与 fillPermissions 旧语义一致）
        Set<Long> validPermissionIds = new HashSet<>();
        for (Permission p : permissionMapper.selectList(Wrappers.emptyWrapper())) {
            if (p != null && p.getId() != null) {
                validPermissionIds.add(p.getId());
            }
        }

        List<RolePermission> missing = new java.util.ArrayList<>();
        List<RolePermission> stale = new java.util.ArrayList<>();
        for (Role role : roleService.list()) {
            if (role == null || role.getId() == null) {
                continue;
            }
            Set<Long> desired = extractPermissionIds(role.getPermission(), validPermissionIds);
            Set<Long> current = new HashSet<>();
            for (RolePermission rp : rolePermissionMapper.selectList(
                    Wrappers.<RolePermission>query().eq("role_id", role.getId()))) {
                current.add(rp.getPermissionId());
            }
            for (Long pid : desired) {
                if (!current.contains(pid)) {
                    RolePermission rp = new RolePermission();
                    rp.setRoleId(role.getId());
                    rp.setPermissionId(pid);
                    missing.add(rp);
                }
            }
            for (Long pid : current) {
                if (!desired.contains(pid)) {
                    RolePermission rp = new RolePermission();
                    rp.setRoleId(role.getId());
                    rp.setPermissionId(pid);
                    stale.add(rp);
                }
            }
        }
        if (missing.isEmpty() && stale.isEmpty()) {
            log.info("RolePermissionSync 完成：关联表与角色 JSON 一致，无变更");
            return;
        }

        String difference = "role_permission 与角色 JSON 不一致：缺少 " + missing.size()
                + " 行，多余 " + stale.size() + " 行";
        if (!mutationPolicy.isMutationsAllowed()) {
            if (failFast) {
                log.error("RolePermissionSync pure-check 未通过：{}", difference);
                throw new IllegalStateException("[RolePermissionSync] " + difference
                        + "；pure-check 模式禁止自动修复，请先执行权限关联数据迁移");
            }
            log.warn("RolePermissionSync pure-check 发现差异但 fail-fast=false：{}；未写库", difference);
            return;
        }

        for (RolePermission rp : missing) {
            rolePermissionMapper.insert(rp);
        }
        for (RolePermission rp : stale) {
            rolePermissionMapper.delete(Wrappers.<RolePermission>query()
                    .eq("role_id", rp.getRoleId()).eq("permission_id", rp.getPermissionId()));
        }
        log.info("RolePermissionSync 完成：补 {} 行，删 {} 行", missing.size(), stale.size());
    }

    /**
     * 从角色内嵌 permission JSON 提取权限 ID 集合。
     * 兼容三代脏数据形态：Permission 实体 / LinkedHashMap（Jackson 擦型）/ 字符串数字 id。
     */
    static Set<Long> extractPermissionIds(List<?> rawPermissions, Set<Long> validPermissionIds) {
        Set<Long> ids = new LinkedHashSet<>();
        if (rawPermissions == null) {
            return ids;
        }
        for (Object item : rawPermissions) {
            Long id = null;
            if (item instanceof Permission) {
                id = ((Permission) item).getId();
            } else if (item instanceof Map) {
                id = toLong(((Map<?, ?>) item).get("id"));
            }
            if (id != null && validPermissionIds.contains(id)) {
                ids.add(id);
            }
        }
        return ids;
    }

    private static Long toLong(Object value) {
        if (value instanceof Number) {
            return ((Number) value).longValue();
        }
        if (value instanceof String) {
            try {
                return Long.parseLong(((String) value).trim());
            } catch (NumberFormatException ignored) {
                return null;
            }
        }
        return null;
    }
}
