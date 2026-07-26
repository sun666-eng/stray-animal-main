package com.example.component;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.example.entity.Permission;
import com.example.entity.Role;
import com.example.mapper.PermissionMapper;
import com.example.service.RoleService;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.CommandLineRunner;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

import jakarta.annotation.Resource;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 启动时规范化权限定义与角色内嵌权限。
 * <p>
 * flag=rescue 是历史遗留的 help 等价管理 flag：全部运行时鉴权
 * （AuthInterceptor / HelpController / FileAssetService / RoleContracts.ADMIN_FLAGS）
 * 均视其为管理端权限，因此这里同样按管理 flag 处理——普通用户（角色3）不得保留，
 * 否则可越权查看救助管理列表。
 */
@Slf4j
@Component
@org.springframework.core.annotation.Order(60)
@ConditionalOnProperty(name = "app.data-fix.enabled", havingValue = "true")
public class DataFixRunner implements CommandLineRunner {

    // 与 RoleContracts.ADMIN_FLAGS 对齐：rescue 是 help 等价的管理 flag
    private static final Set<String> ADMIN_FLAGS = new HashSet<>(Arrays.asList(
            "user", "role", "permission", "animal", "adopt", "proof", "visit", "volunteer", "account", "notice", "help", "rescue"
    ));

    private static final Set<String> USER_FLAGS = new HashSet<>(Arrays.asList(
            "adopt_view", "my_adopt", "my_proof", "apply", "im"
    ));

    private static final Map<String, PermissionPatch> PERMISSION_PATCHES = buildPermissionPatches();

    @Resource
    private PermissionMapper permissionMapper;

    @Resource
    private RoleService roleService;

    @Override
    public void run(String... args) {
        normalizePermissionDefinitions();
        normalizeEmbeddedPermissionsInRoles();
    }

    private void normalizePermissionDefinitions() {
        List<Permission> permissions = permissionMapper.selectList(Wrappers.emptyWrapper());
        for (Permission p : permissions) {
            PermissionPatch patch = PERMISSION_PATCHES.get(p.getFlag());
            if (patch == null) {
                continue;
            }
            boolean changed = false;
            if (!patch.name.equals(p.getName())) {
                p.setName(patch.name);
                changed = true;
            }
            if (!patch.path.equals(p.getPath())) {
                p.setPath(patch.path);
                changed = true;
            }
            if (!patch.description.equals(p.getDescription())) {
                p.setDescription(patch.description);
                changed = true;
            }
            if (changed) {
                permissionMapper.updateById(p);
                log.info("已规范化权限定义 flag={} path={}", p.getFlag(), p.getPath());
            }
        }
    }

    private void normalizeEmbeddedPermissionsInRoles() {
        List<Role> roles = roleService.list();
        for (Role role : roles) {
            // 由于 JacksonTypeHandler 反序列化时擦除了泛型，元素实际可能是 Permission 也可能是 LinkedHashMap，需要兼容处理
            List<?> rawPerms = role.getPermission();
            if (rawPerms == null || rawPerms.isEmpty()) continue;
            List<Permission> normalized = new ArrayList<>();
            Set<String> seenFlags = new HashSet<>();
            for (Object item : rawPerms) {
                Permission p = toPermission(item);
                if (p == null) continue;
                p = normalizePermission(p);
                if (!shouldKeepForRole(role, p)) {
                    continue;
                }
                if (p.getFlag() == null || !seenFlags.add(p.getFlag())) {
                    continue;
                }
                normalized.add(p);
            }
            if (!samePermissionList(rawPerms, normalized)) {
                role.setPermission(normalized);
                roleService.updateById(role);
                log.info("已规范化角色 '{}' 的权限列表 (roleId={})", role.getName(), role.getId());
            }
        }
    }

    private Permission normalizePermission(Permission p) {
        PermissionPatch patch = PERMISSION_PATCHES.get(p.getFlag());
        if (patch != null) {
            p.setName(patch.name);
            p.setPath(patch.path);
            p.setDescription(patch.description);
        }
        return p;
    }

    private boolean shouldKeepForRole(Role role, Permission p) {
        if (p == null || p.getFlag() == null) {
            return false;
        }
        if (Long.valueOf(3L).equals(role.getId())) {
            return USER_FLAGS.contains(p.getFlag());
        }
        return ADMIN_FLAGS.contains(p.getFlag());
    }

    private boolean samePermissionList(List<?> rawPerms, List<Permission> normalized) {
        if (rawPerms.size() != normalized.size()) {
            return false;
        }
        for (int i = 0; i < rawPerms.size(); i++) {
            Permission left = normalizePermission(toPermission(rawPerms.get(i)));
            Permission right = normalized.get(i);
            if (left == null || right == null) {
                return false;
            }
            if (!safeEquals(left.getFlag(), right.getFlag())
                    || !safeEquals(left.getPath(), right.getPath())
                    || !safeEquals(left.getName(), right.getName())
                    || !safeEquals(left.getDescription(), right.getDescription())) {
                return false;
            }
        }
        return true;
    }

    private boolean safeEquals(String left, String right) {
        return left == null ? right == null : left.equals(right);
    }

    private Permission toPermission(Object item) {
        if (item instanceof Permission) {
            return (Permission) item;
        }
        if (item instanceof Map) {
            Map<?, ?> m = (Map<?, ?>) item;
            Permission p = new Permission();
            Object idObj = m.get("id");
            if (idObj instanceof Number) {
                p.setId(((Number) idObj).longValue());
            }
            p.setName((String) m.get("name"));
            p.setFlag((String) m.get("flag"));
            p.setPath((String) m.get("path"));
            p.setDescription((String) m.get("description"));
            return p;
        }
        return null;
    }

    private static Map<String, PermissionPatch> buildPermissionPatches() {
        Map<String, PermissionPatch> patches = new HashMap<>();
        patches.put("user", new PermissionPatch("用户管理", "/page/end/user.html", "管理系统用户和角色分配"));
        patches.put("role", new PermissionPatch("角色管理", "/page/end/role.html", "管理角色及角色权限"));
        patches.put("permission", new PermissionPatch("权限管理", "/page/end/permission.html", "管理后台权限菜单"));
        patches.put("animal", new PermissionPatch("动物管理", "/page/end/animal.html", "新增、编辑、删除动物档案"));
        patches.put("visit", new PermissionPatch("回访管理", "/page/end/visit.html", "管理动物领养后回访记录"));
        patches.put("adopt", new PermissionPatch("领养审核", "/page/end/adopt.html", "审核和管理领养申请"));
        patches.put("proof", new PermissionPatch("凭证管理", "/page/end/proof.html", "管理领养相关凭证"));
        patches.put("volunteer", new PermissionPatch("义工审核", "/page/end/volunteer.html", "审核和管理义工申请"));
        patches.put("account", new PermissionPatch("资金公示管理", "/page/end/account.html", "管理资金收入、支出和公示数据"));
        patches.put("notice", new PermissionPatch("公告管理", "/page/end/notice.html", "管理系统公告和活动通知"));
        patches.put("help", new PermissionPatch("救助管理", "/page/end/help.html", "管理救助请求并回复用户"));
        patches.put("adopt_view", new PermissionPatch("动物浏览", "/page/front/animal_browse.html", "用户端浏览可领养动物"));
        patches.put("my_adopt", new PermissionPatch("我的领养申请", "/page/front/my_adopt.html", "用户端查看自己的领养申请"));
        patches.put("my_proof", new PermissionPatch("领养凭证入口", "/page/front/adopt_proof.html", "用户端提交和管理自己的领养凭证"));
        patches.put("apply", new PermissionPatch("义工申请", "/page/front/volunteer_apply.html", "用户端提交义工申请"));
        patches.put("im", new PermissionPatch("救助咨询", "/page/front/rescue_apply.html", "用户端提交救助咨询和救助请求"));
        // rescue 为 help 等价的历史管理 flag，定义按管理端语义规范化
        patches.put("rescue", new PermissionPatch("救助管理", "/page/end/help.html", "管理救助请求并回复用户（历史 rescue flag，等价 help）"));
        return Collections.unmodifiableMap(patches);
    }

    private static class PermissionPatch {
        private final String name;
        private final String path;
        private final String description;

        private PermissionPatch(String name, String path, String description) {
            this.name = name;
            this.path = path;
            this.description = description;
        }
    }
}
