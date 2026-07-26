package com.example.component;

import com.example.common.RoleContracts;
import com.example.common.StartupMutationPolicy;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.annotation.Order;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.List;
import java.util.Set;

/**
 * 权限/角色配置漂移防护：启动时校验并修复「普通用户闭环 flags」与「认证义工不得带后台权」。
 * <p>
 * 在 {@link SchemaGuardRunner} 之后执行。对应风险：后台误改角色 JSON、义工被授 role=2 等。
 */
@Slf4j
@Component
@Order(10)
public class RolePermissionGuardRunner implements ApplicationRunner {

    private final JdbcTemplate jdbcTemplate;
    private final StartupMutationPolicy mutationPolicy;

    @Value("${app.role-guard.enabled:true}")
    private boolean enabled;

    @Value("${app.role-guard.auto-fix:true}")
    private boolean autoFix;

    @Value("${app.role-guard.fail-fast:false}")
    private boolean failFast;

    /** 是否把「普通用户+志愿者(2)」纠正为「普通用户+认证义工(4)」 */
    @Value("${app.role-guard.demote-user-volunteer:true}")
    private boolean demoteUserVolunteer;

    public RolePermissionGuardRunner(JdbcTemplate jdbcTemplate, StartupMutationPolicy mutationPolicy) {
        this.jdbcTemplate = jdbcTemplate;
        this.mutationPolicy = mutationPolicy;
    }

    @Override
    public void run(ApplicationArguments args) {
        if (!enabled) {
            log.info("RolePermissionGuard 已关闭");
            return;
        }
        // pure-check 禁止任何写修复；与 auto-fix 求交
        boolean canMutate = autoFix && mutationPolicy.isMutationsAllowed();
        log.info("RolePermissionGuard 开始，契约版本={} mutationsAllowed={}",
                RoleContracts.CONTRACT_VERSION, mutationPolicy.isMutationsAllowed());
        List<String> errors = new ArrayList<>();
        try {
            // 临时覆盖 autoFix 语义：方法内部仍读 this.autoFix，改为字段在本 run 内有效
            boolean previousAutoFix = this.autoFix;
            this.autoFix = canMutate;
            try {
                ensurePermissionFlags(errors);
                ensureRole3UserLoop(errors);
                ensureRole4Light(errors);
                ensureRole1Exists(errors);
                if (demoteUserVolunteer) {
                    demoteOverPrivilegedUsers(errors);
                }
                // 仅有 role4（空徽章）的用户 permission=[]，自助闭环全断
                ensureBadgeUsersKeepOrdinaryRole(errors);
            } finally {
                this.autoFix = previousAutoFix;
            }
            if (!errors.isEmpty()) {
                String msg = String.join("; ", errors);
                log.error("RolePermissionGuard 未通过: {}", msg);
                if (failFast || !mutationPolicy.isMutationsAllowed()) {
                    throw new IllegalStateException("[RolePermissionGuard] " + msg);
                }
                return;
            }
            writeContractVersion();
            log.info("RolePermissionGuard 通过，version={}", RoleContracts.CONTRACT_VERSION);
        } catch (IllegalStateException ex) {
            throw ex;
        } catch (RuntimeException ex) {
            log.error("RolePermissionGuard 异常: {}", ex.getMessage(), ex);
            if (failFast) {
                throw ex;
            }
        }
    }

    private void ensurePermissionFlags(List<String> errors) {
        for (String flag : RoleContracts.USER_LOOP_FLAGS) {
            Integer cnt = jdbcTemplate.queryForObject(
                    "SELECT COUNT(*) FROM t_permission WHERE flag = ?", Integer.class, flag);
            if (cnt != null && cnt > 0) {
                continue;
            }
            if (!autoFix) {
                errors.add("t_permission 缺少 flag=" + flag);
                continue;
            }
            log.warn("RolePermissionGuard 补齐 t_permission flag={}", flag);
            try {
                insertUserPermission(flag);
            } catch (Exception e) {
                errors.add("补齐 permission " + flag + " 失败: " + e.getMessage());
            }
        }
    }

    private void insertUserPermission(String flag) {
        switch (flag) {
            case "im":
                upsertPerm(5L, "救助咨询", "/page/front/rescue_apply.html", "im");
                break;
            case "adopt_view":
                upsertPerm(43L, "动物浏览", "/page/front/animal_browse.html", "adopt_view");
                break;
            case "my_adopt":
                upsertPerm(11L, "我的领养申请", "/page/front/my_adopt.html", "my_adopt");
                break;
            case "my_proof":
                upsertPerm(12L, "领养凭证入口", "/page/front/adopt_proof.html", "my_proof");
                break;
            case "apply":
                upsertPerm(15L, "义工申请", "/page/front/volunteer_apply.html", "apply");
                break;
            default:
                throw new IllegalArgumentException("unknown user flag " + flag);
        }
    }

    private void upsertPerm(long id, String name, String path, String flag) {
        Integer byFlag = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM t_permission WHERE flag = ?", Integer.class, flag);
        if (byFlag != null && byFlag > 0) {
            jdbcTemplate.update("UPDATE t_permission SET path = ?, name = ? WHERE flag = ?", path, name, flag);
            return;
        }
        Integer byId = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM t_permission WHERE id = ?", Integer.class, id);
        if (byId != null && byId > 0) {
            jdbcTemplate.update("UPDATE t_permission SET flag = ?, path = ?, name = ? WHERE id = ?",
                    flag, path, name, id);
        } else {
            jdbcTemplate.update(
                    "INSERT INTO t_permission (id, name, description, path, flag) VALUES (?,?,?,?,?)",
                    id, name, name, path, flag);
        }
    }

    private void ensureRole3UserLoop(List<String> errors) {
        String perm = queryRolePermission(3L);
        if (perm == null) {
            errors.add("缺少角色 id=3");
            return;
        }
        if (RoleContracts.hasAllUserLoopFlags(perm) && !RoleContracts.hasAnyAdminFlag(perm)) {
            return;
        }
        if (!autoFix) {
            errors.add("角色3 不满足用户闭环 flags 或误含后台 flag");
            return;
        }
        log.warn("RolePermissionGuard 重置角色3为标准用户权限 JSON");
        jdbcTemplate.update("UPDATE t_role SET name=?, description=?, permission=? WHERE id=3",
                "普通用户", "部分非工作权限", RoleContracts.ROLE3_PERMISSION_JSON);
        // 断言
        String after = queryRolePermission(3L);
        if (!RoleContracts.hasAllUserLoopFlags(after)) {
            errors.add("角色3 修复后仍缺用户闭环 flags");
        }
        if (RoleContracts.hasAnyAdminFlag(after)) {
            errors.add("角色3 修复后仍含后台 flag");
        }
    }

    private void ensureRole4Light(List<String> errors) {
        Integer cnt = jdbcTemplate.queryForObject("SELECT COUNT(*) FROM t_role WHERE id = 4", Integer.class);
        if (cnt == null || cnt == 0) {
            if (!autoFix) {
                errors.add("缺少角色 id=4 认证义工");
                return;
            }
            log.warn("RolePermissionGuard 创建角色4");
            jdbcTemplate.update(
                    "INSERT INTO t_role (id, name, description, permission) VALUES (4, '认证义工', '义工审核通过标记，无后台管理权限', ?)",
                    RoleContracts.ROLE4_PERMISSION_JSON);
            return;
        }
        String perm = queryRolePermission(4L);
        if (perm != null && RoleContracts.hasAnyAdminFlag(perm)) {
            if (!autoFix) {
                errors.add("角色4 含后台管理 flag，违反轻量义工契约");
                return;
            }
            log.warn("RolePermissionGuard 清空角色4后台权限");
            jdbcTemplate.update("UPDATE t_role SET name=?, description=?, permission=? WHERE id=4",
                    "认证义工", "义工审核通过标记，无后台管理权限", RoleContracts.ROLE4_PERMISSION_JSON);
        }
    }

    private void ensureRole1Exists(List<String> errors) {
        Integer cnt = jdbcTemplate.queryForObject("SELECT COUNT(*) FROM t_role WHERE id = 1", Integer.class);
        if (cnt == null || cnt == 0) {
            errors.add("缺少角色 id=1 超级管理员（请导入 test.sql）");
        }
    }

    private static final String ROLE3_SLIM_JSON =
            "{\"id\":3,\"name\":\"普通用户\",\"description\":\"部分非工作权限\",\"permission\":null}";
    private static final String ROLE4_SLIM_JSON =
            "{\"id\":4,\"name\":\"认证义工\",\"description\":\"义工审核通过标记，无后台管理权限\",\"permission\":null}";
    private static final int MAX_USER_SCAN = 10000;

    /**
     * 全量拉取 (id, role JSON) 并在 Java 端用 RoleAssignmentPolicy.extractRoleId 精确解析角色 ID 集合。
     * 修复审计问题 L5：旧实现用 LIKE '%"id":2%' 子串匹配，两位数自定义角色（20-29 等）
     * 会被误判为角色2；register 落库的完整 role3 JSON 内嵌权限 id 也会被误匹配。
     */
    private java.util.Map<Long, java.util.Set<Long>> scanUserRoleIds(List<String> errors) {
        java.util.Map<Long, java.util.Set<Long>> result = new java.util.LinkedHashMap<>();
        List<Object[]> rows = jdbcTemplate.query(
                "SELECT id, role FROM t_user LIMIT " + (MAX_USER_SCAN + 1),
                (rs, i) -> new Object[]{rs.getLong(1), rs.getString(2)});
        if (rows.size() > MAX_USER_SCAN) {
            errors.add("用户数量超过角色守护扫描上限 " + MAX_USER_SCAN + "，请人工核查角色数据");
            return result;
        }
        for (Object[] row : rows) {
            java.util.Set<Long> ids = new java.util.LinkedHashSet<>();
            String json = (String) row[1];
            if (json != null && !json.trim().isEmpty()) {
                try {
                    for (Object item : cn.hutool.json.JSONUtil.parseArray(json)) {
                        Long roleId = com.example.common.RoleAssignmentPolicy.extractRoleId(item);
                        if (roleId != null) {
                            ids.add(roleId);
                        }
                    }
                } catch (Exception ignored) {
                    // 非法 JSON 由其他守护处理，此处不误判
                }
            }
            result.put((Long) row[0], ids);
        }
        return result;
    }

    /** 该用户是否有已通过的义工申请（role4 的唯一合法来源）。 */
    private boolean hasApprovedVolunteer(Long userId) {
        try {
            Integer cnt = jdbcTemplate.queryForObject(
                    "SELECT COUNT(*) FROM t_volunteer WHERE uid = ? AND vstate = 1", Integer.class, userId);
            return cnt != null && cnt > 0;
        } catch (Exception e) {
            return false;
        }
    }

    /**
     * 用户同时挂 role3 + role2（志愿者后台）时收回越权。
     * 修复审计问题 H3：降权目标不再无条件授予 role4——仅当该用户确有已通过的
     * 义工申请才保留徽章（role4 是审核结果的派生角色，不能凭空发放）。
     */
    private void demoteOverPrivilegedUsers(List<String> errors) {
        try {
            java.util.Map<Long, java.util.Set<Long>> userRoles = scanUserRoleIds(errors);
            List<Long> ids = new java.util.ArrayList<>();
            for (java.util.Map.Entry<Long, java.util.Set<Long>> e : userRoles.entrySet()) {
                if (e.getValue().contains(2L) && e.getValue().contains(3L)) {
                    ids.add(e.getKey());
                }
            }
            if (ids.isEmpty()) {
                return;
            }
            if (!autoFix) {
                errors.add("发现 " + ids.size() + " 个用户同时拥有角色2+3（可能越权），auto-fix=false 未处理");
                return;
            }
            for (Long id : ids) {
                boolean badge = hasApprovedVolunteer(id);
                String json = badge ? "[" + ROLE3_SLIM_JSON + "," + ROLE4_SLIM_JSON + "]"
                                    : "[" + ROLE3_SLIM_JSON + "]";
                jdbcTemplate.update("UPDATE t_user SET role = ? WHERE id = ?", json, id);
                log.warn("RolePermissionGuard 用户 id={} 重置为 角色3{}（收回 role2 后台权）",
                        id, badge ? "+4(有已通过义工申请)" : "");
            }
        } catch (Exception e) {
            log.warn("demoteOverPrivilegedUsers 跳过: {}", e.getMessage());
        }
    }

    /**
     * 角色 4 权限为空。若用户只有 role4（无 role1/2/3），登录后 flags 为空，前端“有入口、API 全 403”。
     * 修复为 role3+role4 标准双角色。
     */
    private void ensureBadgeUsersKeepOrdinaryRole(List<String> errors) {
        try {
            java.util.Map<Long, java.util.Set<Long>> userRoles = scanUserRoleIds(errors);
            List<Long> ids = new java.util.ArrayList<>();
            for (java.util.Map.Entry<Long, java.util.Set<Long>> e : userRoles.entrySet()) {
                java.util.Set<Long> roles = e.getValue();
                if (roles.contains(4L) && !roles.contains(1L) && !roles.contains(2L) && !roles.contains(3L)) {
                    ids.add(e.getKey());
                }
            }
            if (ids.isEmpty()) {
                return;
            }
            if (!autoFix) {
                errors.add("发现 " + ids.size() + " 个用户仅有认证义工徽章而无普通用户角色（permission 将为空）");
                return;
            }
            String safeDualRoleJson = "[" + ROLE3_SLIM_JSON + "," + ROLE4_SLIM_JSON + "]";
            for (Long id : ids) {
                jdbcTemplate.update("UPDATE t_user SET role = ? WHERE id = ?", safeDualRoleJson, id);
                log.warn("RolePermissionGuard 用户 id={} 补回角色3（原仅有空徽章 role4）", id);
            }
        } catch (Exception e) {
            log.warn("ensureBadgeUsersKeepOrdinaryRole 跳过: {}", e.getMessage());
        }
    }

    private String queryRolePermission(long roleId) {
        return jdbcTemplate.query(
                "SELECT permission FROM t_role WHERE id = ?",
                rs -> rs.next() ? rs.getString(1) : null,
                roleId);
    }

    private void writeContractVersion() {
        if (!mutationPolicy.isMutationsAllowed()) {
            log.info("RolePermissionGuard pure-check：跳过写入 role_contract_version");
            return;
        }
        try {
            jdbcTemplate.execute(
                    "CREATE TABLE IF NOT EXISTS app_schema_meta ("
                            + "meta_key VARCHAR(64) NOT NULL PRIMARY KEY,"
                            + "meta_value VARCHAR(255) NOT NULL,"
                            + "updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP"
                            + ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
            jdbcTemplate.update(
                    "INSERT INTO app_schema_meta (meta_key, meta_value) VALUES ('role_contract_version', ?) "
                            + "ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value)",
                    RoleContracts.CONTRACT_VERSION);
        } catch (Exception e) {
            log.warn("写入 role_contract_version 失败: {}", e.getMessage());
        }
    }
}
