package com.example.common;

import cn.hutool.json.JSONUtil;
import com.example.entity.User;
import com.example.service.UserService;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.HandlerInterceptor;

import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.net.URLEncoder;
import java.util.Arrays;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

@Component
public class AuthInterceptor implements HandlerInterceptor {

    private static final Set<String> PUBLIC_API_PATHS = new HashSet<>(Arrays.asList(
            "/api/user/login",
            "/api/user/register"
    ));

    private static final Map<String, List<String>> API_FLAG_RULES = new HashMap<>();
    private static final Map<String, String> PAGE_FLAG_RULES = new HashMap<>();
    private static final Map<String, String> LEGACY_PAGE_REDIRECTS = new HashMap<>();
    private static final Set<String> LOGIN_REQUIRED_PAGE_PATHS = new HashSet<>(Arrays.asList(
            "/page/end/index.html",
            "/page/end/person.html",
            "/page/front/adopt_apply.html",
            "/page/front/my_adopt.html",
            "/page/front/adopt_proof.html",
            "/page/front/volunteer_apply.html",
            "/page/front/my_volunteer.html",
            "/page/front/rescue_apply.html",
            "/page/front/my_rescue.html",
            "/page/front/my_visit.html"
    ));

    static {
        API_FLAG_RULES.put("/api/user", Arrays.asList("user"));
        API_FLAG_RULES.put("/api/role", Arrays.asList("role"));
        API_FLAG_RULES.put("/api/permission", Arrays.asList("permission"));
        API_FLAG_RULES.put("/api/animal", Arrays.asList("animal"));
        API_FLAG_RULES.put("/api/adopt", Arrays.asList("adopt"));
        API_FLAG_RULES.put("/api/proof", Arrays.asList("proof"));
        API_FLAG_RULES.put("/api/visit", Arrays.asList("visit"));
        API_FLAG_RULES.put("/api/volunteer", Arrays.asList("volunteer"));
        API_FLAG_RULES.put("/api/account", Arrays.asList("account"));
        API_FLAG_RULES.put("/api/notice", Arrays.asList("notice"));
        API_FLAG_RULES.put("/api/help", Arrays.asList("help", "rescue"));
        API_FLAG_RULES.put("/api/files", Arrays.asList("animal", "adopt", "proof", "visit", "volunteer", "help", "rescue", "user", "my_proof", "apply", "im", "adopt_view"));

        PAGE_FLAG_RULES.put("/page/end/user.html", "user");
        PAGE_FLAG_RULES.put("/page/end/role.html", "role");
        PAGE_FLAG_RULES.put("/page/end/permission.html", "permission");
        PAGE_FLAG_RULES.put("/page/end/animal.html", "animal");
        PAGE_FLAG_RULES.put("/page/end/adopt.html", "adopt");
        PAGE_FLAG_RULES.put("/page/end/proof.html", "proof");
        PAGE_FLAG_RULES.put("/page/end/visit.html", "visit");
        PAGE_FLAG_RULES.put("/page/end/volunteer.html", "volunteer");
        PAGE_FLAG_RULES.put("/page/end/account.html", "account");
        PAGE_FLAG_RULES.put("/page/end/notice.html", "notice");
        PAGE_FLAG_RULES.put("/page/end/help.html", "help");
        PAGE_FLAG_RULES.put("/page/end/rescue.html", "help");

        LEGACY_PAGE_REDIRECTS.put("/page/end/im.html", "/page/front/rescue_apply.html");
        LEGACY_PAGE_REDIRECTS.put("/page/end/register.html", "/page/front/register.html");
        LEGACY_PAGE_REDIRECTS.put("/page/end/plugins.html", "/page/end/index.html");
        LEGACY_PAGE_REDIRECTS.put("/page/end/rescue.html", "/page/end/help.html");
        LEGACY_PAGE_REDIRECTS.put("/prototype.html", "/page/front/index.html");
        LEGACY_PAGE_REDIRECTS.put("/page/end/adopt_view.html", "/page/front/animal_browse.html");
        LEGACY_PAGE_REDIRECTS.put("/page/end/adopt_apply.html", "/page/front/adopt_apply.html");
        LEGACY_PAGE_REDIRECTS.put("/page/end/my_adopt.html", "/page/front/my_adopt.html");
        LEGACY_PAGE_REDIRECTS.put("/page/end/adopt_wait.html", "/page/front/my_adopt.html");
        LEGACY_PAGE_REDIRECTS.put("/page/end/volunteer_apply.html", "/page/front/volunteer_apply.html");
        LEGACY_PAGE_REDIRECTS.put("/page/end/adopt_proof.html", "/page/front/adopt_proof.html");
    }

    private final UserService userService;

    public AuthInterceptor(UserService userService) {
        this.userService = userService;
    }

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) throws IOException {
        String path = request.getRequestURI();

        if (LEGACY_PAGE_REDIRECTS.containsKey(path)) {
            String target = LEGACY_PAGE_REDIRECTS.get(path);
            if ("/page/end/adopt_apply.html".equals(path)) {
                target = appendPositiveLongParameter(target, "animalId", request.getParameter("animalId"));
            } else if ("/page/end/adopt_proof.html".equals(path)) {
                target = appendPositiveLongParameter(target, "aid", request.getParameter("aid"));
            }
            response.sendRedirect(target);
            return false;
        }

        if (path.startsWith("/api/")) {
            // 文件 GET：可选登录，但必须走 getCurrentUser 重载权限（A0.5），再允许匿名访问公开图
            if (path.startsWith("/api/files/") && "GET".equalsIgnoreCase(request.getMethod())) {
                getCurrentUser(request);
                return true;
            }
            // Animal detail is anonymous-readable for state 0, but managers may see other states.
            // Refresh any existing session before the controller makes that state-sensitive decision.
            if ("GET".equalsIgnoreCase(request.getMethod()) && path.matches("^/api/animal/\\d+$")) {
                getCurrentUser(request);
                return true;
            }
            if (isPublicApi(path, request.getMethod())) {
                return true;
            }

            User user = getCurrentUser(request);
            if (user != null) {
                if (hasApiPermission(user, path, request.getMethod())) {
                    return true;
                }
                writeJson(response, 403, Result.error("403", "无权访问该功能"));
                return false;
            }
            writeJson(response, 401, Result.error("401", "未登录或登录已过期"));
            return false;
        }

        // 页面请求：Session认证
        User user = getCurrentUser(request);
        if (user != null) {
            String requiredFlag = PAGE_FLAG_RULES.get(path);
            if (requiredFlag != null && hasPagePermission(user, requiredFlag)) {
                return true;
            }
            if (requiredFlag == null && isAllowedLoggedInPage(path)) {
                return true;
            }
            // 无任何后台管理 flag 的用户误入 /page/end/* 管理页时，送回用户端，避免反复弹「无权限」
            if (path.startsWith("/page/end/")
                    && !path.endsWith("/login.html")
                    && !path.endsWith("/register.html")
                    && !hasAnyAdminPageAccess(user)) {
                // 无管理权限：回系统首页（普通用户在 end/index 只看用户入口）
                response.sendRedirect("/page/end/index.html?error=need_admin");
                return false;
            }
            response.sendRedirect("/page/end/index.html?error=forbidden");
            return false;
        }
        if (LOGIN_REQUIRED_PAGE_PATHS.contains(path)) {
            response.sendRedirect(buildLoginRedirect(path, request.getQueryString()));
            return false;
        }
        response.sendRedirect(buildLoginRedirect(path, request.getQueryString()));
        return false;
    }

    private boolean isAllowedLoggedInPage(String path) {
        return LOGIN_REQUIRED_PAGE_PATHS.contains(path);
    }

    private boolean hasAnyAdminPageAccess(User user) {
        return hasAnyPermissionFlag(user, Arrays.asList(
                "user", "role", "permission", "animal", "adopt", "proof", "visit",
                "volunteer", "account", "notice", "help", "rescue"
        ));
    }

    private boolean isPublicApi(String path, String method) {
        if (PUBLIC_API_PATHS.contains(path)) {
            return true;
        }
        // B2.1：精确路径 + 方法，禁止 startsWith 过宽公开
        if ("GET".equalsIgnoreCase(method) && isExactPublicAnimalGet(path)) {
            return true;
        }
        if ("GET".equalsIgnoreCase(method) && isExactPublicNoticeGet(path)) {
            return true;
        }
        if (isPublicAccountRead(path, method)) {
            return true;
        }
        if (("/api/dashboard/public-stats".equals(path) || "/api/dashboard/home-stats".equals(path))
                && "GET".equalsIgnoreCase(method)) {
            return true;
        }
        return false;
    }

    private boolean isExactPublicAnimalGet(String path) {
        if ("/api/animal/page1".equals(path)) {
            return true;
        }
        // /api/animal/{id} 数字 ID
        return path.matches("^/api/animal/\\d+$");
    }

    private boolean isExactPublicNoticeGet(String path) {
        if ("/api/notice/page".equals(path)) {
            return true;
        }
        return path.matches("^/api/notice/\\d+$");
    }

    private boolean isPublicAccountRead(String path, String method) {
        if (!"GET".equalsIgnoreCase(method)) {
            return false;
        }
        // 匿名仅 /api/account/public；按 id 查询需登录+account 权限（防枚举/脱敏绕过）
        return "/api/account/public".equals(path);
    }

    /**
     * A0.5：浏览器唯一认证权威 = Session。
     * <ul>
     *   <li>仅从 Session 取 userId / User，再按 DB 重载权限</li>
     *   <li><b>不再</b>从 Authorization JWT 回落并创建 Session（防登出后 token 重放）</li>
     *   <li>用户不存在则 invalidate Session</li>
     * </ul>
     */
    private User getCurrentUser(HttpServletRequest request) {
        Long userId = null;

        Object sessionUser = request.getSession(false) == null
                ? null
                : request.getSession(false).getAttribute("user");
        if (sessionUser instanceof User) {
            userId = ((User) sessionUser).getId();
        } else if (sessionUser instanceof Number) {
            userId = ((Number) sessionUser).longValue();
        } else {
            Object sid = request.getSession(false) == null
                    ? null
                    : request.getSession(false).getAttribute("userId");
            if (sid instanceof Number) {
                userId = ((Number) sid).longValue();
            }
        }

        if (userId == null) {
            return null;
        }

        User user = userService.getById(userId);
        if (user == null) {
            try {
                if (request.getSession(false) != null) {
                    request.getSession(false).invalidate();
                }
            } catch (IllegalStateException ignored) {
                // already invalidated
            }
            return null;
        }

        userService.fillPermissions(user);
        request.setAttribute("userId", user.getId());
        request.setAttribute("username", user.getUsername());
        request.getSession(true).setAttribute("user", user);
        request.getSession(true).setAttribute("userId", user.getId());
        return user;
    }

    private boolean hasApiPermission(User user, String path, String method) {
        if (path.startsWith("/api/user/logout")
                || path.startsWith("/api/user/ws-ticket")
                || path.startsWith("/api/user/csrf")
                || path.equals("/api/user/me") || path.startsWith("/api/user/me?")) {
            return true;
        }
        if (path.equals("/api/user/me/profile") && "PUT".equalsIgnoreCase(method)) {
            return true;
        }
        // /online：须登录；是否可枚举用户名由 Controller 再判管理 flag
        if (path.startsWith("/api/user/online")) {
            return true;
        }
        // detail：须登录，细粒度归属在 UserController（本人或 user 管理）
        if (path.startsWith("/api/user/detail/")) {
            return true;
        }
        // 通用 PUT /api/user 仅用户管理/超管；普通用户资料必须走 /api/user/me/profile
        if (path.equals("/api/user") && "PUT".equalsIgnoreCase(method)) {
            return hasAnyPermissionFlag(user, Arrays.asList("user"))
                    || RoleAssignmentPolicy.hasRoleId(user, RoleAssignmentPolicy.SUPER_ADMIN_ROLE_ID);
        }
        if (path.startsWith("/api/files/upload") && "POST".equalsIgnoreCase(method)) {
            return true;
        }
        if (path.startsWith("/api/volunteer/mine")) {
            return hasAnyPermissionFlag(user, Arrays.asList("apply", "volunteer"));
        }
        if (path.startsWith("/api/help/mine") || path.startsWith("/api/help/chat")) {
            return hasAnyPermissionFlag(user, Arrays.asList("im", "help", "rescue"));
        }
        // Owner authorization is enforced by HelpController; management accepts the help/rescue aliases.
        if (path.matches("^/api/help/\\d+$") && "GET".equalsIgnoreCase(method)) {
            return true;
        }
        // 普通用户角色种子为 im；help/rescue 为管理端 flag。提交/更新救助表单：im|help|rescue
        // Service 层再做本人归属与状态校验。
        if ("/api/help".equals(path)
                && ("POST".equalsIgnoreCase(method) || "PUT".equalsIgnoreCase(method))) {
            return hasAnyPermissionFlag(user, Arrays.asList("im", "help", "rescue"));
        }
        if (path.startsWith("/api/adopt/page2")) {
            return hasAnyPermissionFlag(user, Arrays.asList("my_adopt", "adopt", "adopt_view"));
        }
        if (path.matches("^/api/adopt/mine/\\d+$") && "GET".equalsIgnoreCase(method)) {
            return hasAnyPermissionFlag(user, Arrays.asList("my_adopt", "adopt_view", "adopt"));
        }
        if (path.matches("^/api/adopt/\\d+/\\d+$")
                && ("GET".equalsIgnoreCase(method) || "PUT".equalsIgnoreCase(method))) {
            // Controller and service enforce the composite-key owner check.
            return hasAnyPermissionFlag(user, Arrays.asList("my_adopt", "adopt_view", "adopt"));
        }
        if (path.startsWith("/api/proof/page1")) {
            return hasAnyPermissionFlag(user, Arrays.asList("my_proof", "my_adopt", "adopt_view", "proof"));
        }
        if (path.matches("^/api/proof/\\d+$") && "GET".equalsIgnoreCase(method)) {
            return hasAnyPermissionFlag(user, Arrays.asList("my_proof", "my_adopt", "adopt_view", "proof"));
        }
        if (path.startsWith("/api/visit/mine")) {
            // 归属校验在 VisitController；登录用户即可查自己的回访
            return true;
        }
        if (path.matches("^/api/files/staged/[a-zA-Z0-9-]{1,64}$")
                && "DELETE".equalsIgnoreCase(method)) {
            return true;
        }
        if (path.matches("^/api/visit/\\d+$") && "GET".equalsIgnoreCase(method)) {
            // Controller enforces owner-or-visit-manager read access.
            return true;
        }
        if (path.startsWith("/api/adopt") && "POST".equalsIgnoreCase(method)) {
            return hasAnyPermissionFlag(user, Arrays.asList("adopt_view", "my_adopt", "adopt"));
        }
        // Proof：Controller 为 PUT /api/proof（无 path id）；删除为 DELETE /api/proof/{id}
        if ("/api/proof".equals(path)
                && ("POST".equalsIgnoreCase(method) || "PUT".equalsIgnoreCase(method))) {
            return hasAnyPermissionFlag(user, Arrays.asList("my_proof", "my_adopt", "adopt_view", "proof"));
        }
        if (path.matches("^/api/proof/\\d+$") && "DELETE".equalsIgnoreCase(method)) {
            return hasAnyPermissionFlag(user, Arrays.asList("my_proof", "my_adopt", "adopt_view", "proof"));
        }
        if ("/api/volunteer".equals(path)
                && ("POST".equalsIgnoreCase(method) || "PUT".equalsIgnoreCase(method))) {
            return hasAnyPermissionFlag(user, Arrays.asList("apply", "volunteer"));
        }
        for (Map.Entry<String, List<String>> entry : API_FLAG_RULES.entrySet()) {
            if (path.startsWith(entry.getKey())) {
                return hasAnyPermissionFlag(user, entry.getValue());
            }
        }
        // 未登记的接口默认拒绝，避免新增管理接口时因遗漏权限规则而被普通用户访问。
        return false;
    }

    private boolean hasAnyPermissionFlag(User user, List<String> flags) {
        for (String flag : flags) {
            if (hasPermissionFlag(user, flag)) {
                return true;
            }
        }
        return false;
    }

    private boolean hasPermissionFlag(User user, String flag) {
        if (user == null || flag == null) {
            return false;
        }
        return PermissionUtil.hasFlag(user, flag);
    }

    private String appendPositiveLongParameter(String target, String name, String rawValue) {
        if (rawValue == null || !rawValue.matches("^[1-9][0-9]{0,18}$")) {
            return target;
        }
        try {
            Long.parseLong(rawValue);
            return target + "?" + name + "=" + rawValue;
        } catch (NumberFormatException ignored) {
            return target;
        }
    }

    private boolean hasPagePermission(User user, String requiredFlag) {
        if ("help".equals(requiredFlag)) {
            return hasAnyPermissionFlag(user, Arrays.asList("help", "rescue"));
        }
        return hasPermissionFlag(user, requiredFlag);
    }

    private void writeJson(HttpServletResponse response, int status, Result<?> result) throws IOException {
        response.setContentType("application/json;charset=UTF-8");
        response.setStatus(status);
        response.getWriter().write(JSONUtil.toJsonStr(result));
    }

    private String buildLoginRedirect(String path, String queryString) throws IOException {
        String target = path + (queryString == null ? "" : "?" + queryString);
        // 用户端与管理端共用统一登录页，登录成功后再按权限分流
        return "/page/front/login.html?redirect=" + URLEncoder.encode(target, "UTF-8");
    }

}
