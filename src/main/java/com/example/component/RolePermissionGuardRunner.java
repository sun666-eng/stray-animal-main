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

    /**
     * 用户同时挂 role3 + role2（志愿者后台）时，降为 role3 + role4，收回越权。
     * 直接写入规范 JSON，避免半残字符串导致登录后 permission 为空。
     */
    private void demoteOverPrivilegedUsers(List<String> errors) {
        final String safeDualRoleJson =
                "[{\"id\":3,\"name\":\"普通用户\",\"description\":\"部分非工作权限\",\"permission\":null},"
                        + "{\"id\":4,\"name\":\"认证义工\",\"description\":\"义工审核通过标记，无后台管理权限\",\"permission\":null}]";
        try {
            List<Long> ids = jdbcTemplate.query(
                    "SELECT id FROM t_user WHERE "
                            + "(role LIKE '%\"id\":2%' OR role LIKE '%\"id\": 2%') "
                            + "AND (role LIKE '%\"id\":3%' OR role LIKE '%\"id\": 3%')",
                    (rs, i) -> rs.getLong(1));
            if (ids == null || ids.isEmpty()) {
                return;
            }
            if (!autoFix) {
                errors.add("发现 " + ids.size() + " 个用户同时拥有角色2+3（可能越权），auto-fix=false 未处理");
                return;
            }
            for (Long id : ids) {
                jdbcTemplate.update("UPDATE t_user SET role = ? WHERE id = ?", safeDualRoleJson, id);
                log.warn("RolePermissionGuard 用户 id={} 重置为 角色3+4（收回 role2 后台权）", id);
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
        final String safeDualRoleJson =
                "[{\"id\":3,\"name\":\"普通用户\",\"description\":\"部分非工作权限\",\"permission\":null},"
                        + "{\"id\":4,\"name\":\"认证义工\",\"description\":\"义工审核通过标记，无后台管理权限\",\"permission\":null}]";
        try {
            // 含 id:4，且不含 id:3 / id:1 / id:2（兼容 "id":4 与 "id": 4）
            List<Long> ids = jdbcTemplate.query(
                    "SELECT id FROM t_user WHERE "
                            + "(role LIKE '%\"id\":4%' OR role LIKE '%\"id\": 4%') "
                            + "AND role NOT LIKE '%\"id\":3%' AND role NOT LIKE '%\"id\": 3%' "
                            + "AND role NOT LIKE '%\"id\":1%' AND role NOT LIKE '%\"id\": 1%' "
                            + "AND role NOT LIKE '%\"id\":2%' AND role NOT LIKE '%\"id\": 2%'",
                    (rs, i) -> rs.getLong(1));
            if (ids == null || ids.isEmpty()) {
                return;
            }
            if (!autoFix) {
                errors.add("发现 " + ids.size() + " 个用户仅有认证义工徽章而无普通用户角色（permission 将为空）");
                return;
            }
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
