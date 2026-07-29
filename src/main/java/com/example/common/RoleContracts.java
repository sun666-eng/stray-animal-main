package com.example.common;

import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 角色/权限闭环契约：用户自助 flags 与后台管理 flags 的单一事实来源。
 * SchemaGuard / RolePermissionGuard / 拦截器语义应对齐本类。
 */
public final class RoleContracts {

    private RoleContracts() {
    }

    /** 契约版本：变更用户/义工/后台角色必备 flag 时递增 */
    public static final String CONTRACT_VERSION = "2026.07.12-rbac-v1";

    /** 普通用户（角色3）必须具备，否则主闭环断 */
    public static final Set<String> USER_LOOP_FLAGS = Collections.unmodifiableSet(new LinkedHashSet<>(Arrays.asList(
            "im", "adopt_view", "my_adopt", "my_proof", "apply"
    )));

    /** 后台管理 flags：普通用户与认证义工（角色4）不得拥有 */
    public static final Set<String> ADMIN_FLAGS = Collections.unmodifiableSet(new HashSet<>(Arrays.asList(
            "user", "role", "permission", "animal", "adopt", "proof", "visit",
            "volunteer", "account", "notice", "help", "rescue", "admin_agent"
    )));

    /** 角色3 标准权限 JSON（路径统一为 front） */
    public static final String ROLE3_PERMISSION_JSON =
            "[{\"id\":5,\"name\":\"救助咨询\",\"path\":\"/page/front/rescue_apply.html\",\"description\":\"用户端提交救助咨询和救助请求\",\"flag\":\"im\"},"
                    + "{\"id\":43,\"name\":\"动物浏览\",\"path\":\"/page/front/animal_browse.html\",\"description\":\"用户端浏览可领养动物\",\"flag\":\"adopt_view\"},"
                    + "{\"id\":11,\"name\":\"我的领养申请\",\"path\":\"/page/front/my_adopt.html\",\"description\":\"用户端查看自己的领养申请\",\"flag\":\"my_adopt\"},"
                    + "{\"id\":12,\"name\":\"领养凭证入口\",\"path\":\"/page/front/adopt_proof.html\",\"description\":\"用户端提交和管理自己的领养凭证\",\"flag\":\"my_proof\"},"
                    + "{\"id\":15,\"name\":\"义工申请\",\"path\":\"/page/front/volunteer_apply.html\",\"description\":\"用户端提交义工申请\",\"flag\":\"apply\"}]";

    public static final String ROLE4_PERMISSION_JSON = "[]";

    private static final Pattern FLAG_PATTERN = Pattern.compile("\"flag\"\\s*:\\s*\"([^\"]+)\"");

    public static Set<String> extractFlags(String permissionJson) {
        Set<String> flags = new LinkedHashSet<>();
        if (permissionJson == null || permissionJson.trim().isEmpty()) {
            return flags;
        }
        Matcher m = FLAG_PATTERN.matcher(permissionJson);
        while (m.find()) {
            flags.add(m.group(1));
        }
        return flags;
    }

    public static boolean hasAllUserLoopFlags(String permissionJson) {
        return extractFlags(permissionJson).containsAll(USER_LOOP_FLAGS);
    }

    public static boolean hasAnyAdminFlag(String permissionJson) {
        Set<String> flags = extractFlags(permissionJson);
        for (String f : flags) {
            if (ADMIN_FLAGS.contains(f)) {
                return true;
            }
        }
        return false;
    }
}
