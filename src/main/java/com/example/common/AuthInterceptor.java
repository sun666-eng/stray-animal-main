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
        API_FLAG_RULES.put("/api/help", Arrays.asList("help"));
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
            response.sendRedirect(LEGACY_PAGE_REDIRECTS.get(path));
            return false;
        }

        if (path.startsWith("/api/")) {
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
            if (requiredFlag != null && hasPermissionFlag(user, requiredFlag)) {
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
                response.sendRedirect("/page/front/animal_browse.html?error=need_admin");
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
        if (path.startsWith("/api/files/") && "GET".equalsIgnoreCase(method)) {
            return true;
        }
        if (path.startsWith("/api/animal") && "GET".equalsIgnoreCase(method)) {
            return true;
        }
        if (path.startsWith("/api/notice") && "GET".equalsIgnoreCase(method)) {
            return true;
        }
        if (isPublicAccountRead(path, method)) {
            return true;
        }
        if ("/api/dashboard/public-stats".equals(path) && "GET".equalsIgnoreCase(method)) {
            return true;
        }
        return false;
    }

    private boolean isPublicAccountRead(String path, String method) {
        if (!"GET".equalsIgnoreCase(method)) {
            return false;
        }
        if ("/api/account".equals(path) || "/api/account/page".equals(path) || "/api/account/public".equals(path)) {
            return true;
        }
        return path.matches("^/api/account/\\d+$");
    }

    private User getCurrentUser(HttpServletRequest request) {
        User user = null;
        String authHeader = request.getHeader("Authorization");
        if (authHeader != null && authHeader.startsWith("Bearer ")) {
            String token = authHeader.substring(7);
            if (JwtUtil.validate(token)) {
                Long userId = JwtUtil.getUserId(token);
                user = userService.getById(userId);
                if (user != null) {
                    userService.fillPermissions(user);
                    request.setAttribute("userId", user.getId());
                    request.setAttribute("username", user.getUsername());
                    request.getSession().setAttribute("user", user);
                }
            }
        }
        if (user == null) {
            Object sessionUser = request.getSession().getAttribute("user");
            if (sessionUser instanceof User) {
                user = (User) sessionUser;
                userService.fillPermissions(user);
                request.setAttribute("userId", user.getId());
                request.setAttribute("username", user.getUsername());
            }
        }
        return user;
    }

    private boolean hasApiPermission(User user, String path, String method) {
        if (path.startsWith("/api/user/logout") || path.startsWith("/api/user/online")
                || path.startsWith("/api/user/ws-ticket")) {
            return true;
        }
        if (path.startsWith("/api/user/detail/")) {
            return true;
        }
        if (path.equals("/api/user") && "PUT".equalsIgnoreCase(method)) {
            return true;
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
        if ("/api/help".equals(path) && "POST".equalsIgnoreCase(method)) {
            return hasAnyPermissionFlag(user, Arrays.asList("help", "rescue"));
        }
        if (path.startsWith("/api/adopt/page2")) {
            return hasAnyPermissionFlag(user, Arrays.asList("my_adopt", "adopt", "adopt_view"));
        }
        if (path.startsWith("/api/proof/page1")) {
            return hasAnyPermissionFlag(user, Arrays.asList("my_proof", "proof"));
        }
        if (path.startsWith("/api/visit/mine")) {
            // 归属校验在 VisitController；登录用户即可查自己的回访
            return true;
        }
        if (path.startsWith("/api/adopt") && "POST".equalsIgnoreCase(method)) {
            return hasAnyPermissionFlag(user, Arrays.asList("adopt_view", "my_adopt", "adopt"));
        }
        if (path.startsWith("/api/proof") && "POST".equalsIgnoreCase(method)) {
            return hasAnyPermissionFlag(user, Arrays.asList("my_proof", "proof"));
        }
        if (path.matches("^/api/proof/\\d+$")
                && ("PUT".equalsIgnoreCase(method) || "DELETE".equalsIgnoreCase(method))) {
            return hasAnyPermissionFlag(user, Arrays.asList("my_proof", "proof"));
        }
        if (path.startsWith("/api/volunteer") && "POST".equalsIgnoreCase(method)) {
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
