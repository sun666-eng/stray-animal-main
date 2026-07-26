package com.example.controller;

import com.baomidou.mybatisplus.core.metadata.IPage;
import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.example.common.AuditLog;
import com.example.common.CsrfTokenService;
import com.example.common.ExcelExportUtil;
import com.example.common.LoginRateLimiter;
import com.example.common.PermissionUtil;
import com.example.common.Result;
import com.example.common.RoleAssignmentPolicy;
import com.example.common.RolePermissionWriteLock;
import com.example.dto.LoginVO;
import com.example.dto.ProfileUpdateRequest;
import com.example.dto.RegisterRequest;
import com.example.dto.UserDTO;
import com.example.entity.Role;
import com.example.entity.User;
import com.example.exception.CustomException;
import com.example.service.UserService;
import com.example.component.WebSocketTicketService;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import javax.annotation.Resource;
import javax.validation.Valid;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import org.springframework.web.bind.annotation.RequestMethod;
import java.io.IOException;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.stream.Collectors;

@RestController
@RequestMapping("/api/user")
public class UserController {
    private static final int MAX_PAGE_NUM = 10000;
    private static final int MAX_PAGE_SIZE = 50;
    private static final int MAX_QUERY_LENGTH = 100;
    private static final int MAX_ONLINE_SNAPSHOTS = 1000;
    public static final ConcurrentHashMap<String, User> MAP = new ConcurrentHashMap<>();

    @Resource
    private UserService userService;

    @Resource
    private WebSocketTicketService webSocketTicketService;

    @Resource
    private CsrfTokenService csrfTokenService;

    @Resource
    private RoleAssignmentPolicy roleAssignmentPolicy;

    @Resource
    private LoginRateLimiter loginRateLimiter;

    @AuditLog(module = "用户管理", action = "用户登录")
    @PostMapping("/login")
    public Result<LoginVO> login(@Valid @RequestBody User user, HttpServletRequest request) {
        String rateKey = rateKey(request, user == null ? null : user.getUsername());
        String limited = loginRateLimiter.checkAllowed(rateKey);
        if (limited != null) {
            return Result.error("429", limited);
        }
        try {
            User res = userService.login(user);
            if (res == null) {
                loginRateLimiter.recordFailure(rateKey);
                return Result.error("401", "用户名或密码错误");
            }
            loginRateLimiter.recordSuccess(rateKey);
            // A0.7：登录成功轮换 Session ID，缓解 Session 固定
            try {
                request.changeSessionId();
            } catch (IllegalStateException ignored) {
                // 无 Session 时忽略
            }
            // 浏览器唯一权威：Session；不再签发 JWT
            request.getSession(true).setAttribute("user", res);
            request.getSession(true).setAttribute("userId", res.getId());
            String csrf = csrfTokenService.getOrCreate(request);
            if (MAP.size() < MAX_ONLINE_SNAPSHOTS || MAP.containsKey(res.getUsername())) {
                MAP.put(res.getUsername(), res);
            }
            return Result.success(new LoginVO(csrf, UserDTO.from(res)));
        } catch (CustomException e) {
            if ("401".equals(e.getCode()) || "-1".equals(e.getCode())) {
                loginRateLimiter.recordFailure(rateKey);
            }
            return Result.error(e.getCode(), e.getMsg());
        }
    }

    @AuditLog(module = "用户管理", action = "用户注册")
    @PostMapping("/register")
    public Result<LoginVO> register(@Valid @RequestBody RegisterRequest registration, HttpServletRequest request) {
        String rateKey = registrationRateKey(request);
        String limited = loginRateLimiter.checkAllowed(rateKey);
        if (limited != null) {
            return Result.error("429", limited);
        }
        User user = new User();
        user.setUsername(registration.getUsername());
        user.setPassword(registration.getPassword());
        user.setEmail(registration.getEmail());
        user.setPhone(registration.getPhone());
        user.setAvatar(registration.getAvatar());
        User dbUser;
        try {
            dbUser = userService.register(user);
        } catch (CustomException e) {
            loginRateLimiter.recordFailure(rateKey);
            return Result.error(e.getCode(), e.getMsg());
        }
        try {
            request.changeSessionId();
        } catch (IllegalStateException ignored) {
            // no-op
        }
        request.getSession(true).setAttribute("user", dbUser);
        request.getSession(true).setAttribute("userId", dbUser.getId());
        String csrf = csrfTokenService.getOrCreate(request);
        return Result.success(new LoginVO(csrf, UserDTO.from(dbUser)));
    }

    /**
     * 供前端 ajax 获取当前 Session 的 CSRF token（须已登录）。
     */
    @GetMapping("/csrf")
    public Result<Map<String, String>> csrf(HttpServletRequest request) {
        Object sessionUser = request.getSession(false) == null
                ? null
                : request.getSession(false).getAttribute("user");
        if (!(sessionUser instanceof User)) {
            return Result.error("401", "未登录或登录已过期");
        }
        Map<String, String> data = new LinkedHashMap<>();
        data.put("csrfToken", csrfTokenService.getOrCreate(request));
        data.put("headerName", CsrfTokenService.HEADER_NAME);
        return Result.success(data);
    }

    /**
     * 显式拒绝 GET logout，返回 405（避免被误判为 500，且不可作状态变更）。
     */
    @GetMapping("/logout")
    public org.springframework.http.ResponseEntity<Result<?>> logoutGet() {
        return org.springframework.http.ResponseEntity
                .status(org.springframework.http.HttpStatus.METHOD_NOT_ALLOWED)
                .body(Result.error("405", "请使用 POST /api/user/logout（需 CSRF）"));
    }

    /**
     * 退出：仅 POST + CSRF；invalidate Session 并清除 Cookie（A0.7）。
     */
    @AuditLog(module = "用户管理", action = "用户登出")
    @PostMapping("/logout")
    public Result<?> logout(HttpServletRequest request, HttpServletResponse response) {
        String username = null;
        Long userId = null;
        try {
            Object sessionUser = request.getSession(false) == null
                    ? null
                    : request.getSession(false).getAttribute("user");
            if (sessionUser instanceof User) {
                username = ((User) sessionUser).getUsername();
                userId = ((User) sessionUser).getId();
            }
            webSocketTicketService.revokeUser(userId);
            // 登出即时断开该用户全部 WebSocket 连接（此前 closeUserSessions 无调用方）
            com.example.component.WebSocketServer.closeUserSessions(userId);
            if (request.getSession(false) != null) {
                request.getSession(false).invalidate();
            }
        } catch (IllegalStateException ignored) {
            // already invalidated
        }
        javax.servlet.http.Cookie clear = new javax.servlet.http.Cookie("JSESSIONID", "");
        clear.setPath("/");
        clear.setMaxAge(0);
        clear.setHttpOnly(true);
        response.addCookie(clear);
        if (username != null) {
            MAP.remove(username);
        }
        return Result.success();
    }

    /**
     * 当前登录用户（Session 经拦截器按 DB 重载后回填）。
     * 供前端探测「假登录」：本地有 user/token 但服务端已失效时返回 401。
     */
    @GetMapping("/me")
    public org.springframework.http.ResponseEntity<Result<UserDTO>> me(HttpServletRequest request) {
        Object sessionUser = request.getSession(false) == null
                ? null
                : request.getSession(false).getAttribute("user");
        if (!(sessionUser instanceof User) || ((User) sessionUser).getId() == null) {
            return org.springframework.http.ResponseEntity.status(401)
                    .body(Result.error("401", "未登录或登录已过期"));
        }
        Long id = ((User) sessionUser).getId();
        User fresh = userService.getById(id);
        if (fresh == null) {
            try {
                if (request.getSession(false) != null) {
                    request.getSession(false).invalidate();
                }
            } catch (IllegalStateException ignored) {
                // no-op
            }
            return org.springframework.http.ResponseEntity.status(401)
                    .body(Result.error("401", "未登录或登录已过期"));
        }
        userService.fillPermissions(fresh);
        request.getSession(true).setAttribute("user", fresh);
        request.getSession(true).setAttribute("userId", fresh.getId());
        return org.springframework.http.ResponseEntity.ok(Result.success(UserDTO.from(fresh)));
    }

    /**
     * 在线用户列表：仅具备 user 管理 flag 可枚举用户名（B4 / §决策 /online）。
     * MAP 非认证依据，仅作单机演示数据。
     */
    @GetMapping("/online")
    public Result<Collection<UserDTO>> online(HttpServletRequest request) {
        User current = (User) request.getSession().getAttribute("user");
        if (!PermissionUtil.hasFlag(current, "user") && !PermissionUtil.hasFlag(current, "role")) {
            // 普通用户不可枚举在线用户名
            return Result.error("403", "无权查看在线用户列表");
        }
        return Result.success(MAP.values().stream().map(UserDTO::from).collect(Collectors.toList()));
    }

    @PostMapping("/ws-ticket")
    public ResponseEntity<Result<?>> createWebSocketTicket() {
        return ResponseEntity.status(HttpStatus.GONE)
                .body(Result.error("410", "产品聊天已停用 WebSocket 连接，请使用定时 HTTP 更新"));
    }

    @AuditLog(module = "用户管理", action = "新增用户")
    @PostMapping
    public Result<?> save(@Valid @RequestBody User user, HttpServletRequest request) {
        if (user.getPassword() == null || user.getPassword().trim().isEmpty()) {
            return Result.error("400", "密码不能为空");
        }
        User current = (User) request.getSession().getAttribute("user");
        try {
            return RolePermissionWriteLock.execute(() -> {
                List<Role> roles = roleAssignmentPolicy.resolveRolesForWrite(current, user.getRole(), true);
                user.setRole(roles);
                user.setPermission(null);
                return Result.success(userService.createWithAvatar(user, current));
            });
        } catch (CustomException e) {
            return Result.error(e.getCode(), e.getMsg());
        }
    }

    @AuditLog(module = "用户管理", action = "更新用户")
    @PutMapping
    public Result<?> update(@RequestBody User user, HttpServletRequest request) {
        if (user != null && user.getPassword() != null && !user.getPassword().trim().isEmpty()) {
            return Result.error("400", "通用用户接口不支持修改密码");
        }
        User currentUser = (User) request.getSession().getAttribute("user");
        if (currentUser == null || currentUser.getId() == null) {
            return Result.error("401", "未登录或登录已过期");
        }
        try {
            boolean manageUser = PermissionUtil.hasFlag(currentUser, "user")
                    || roleAssignmentPolicy.isSuperAdmin(currentUser);
            if (!manageUser) {
                // 普通用户不得走通用更新口（可改 username 等身份字段）；仅允许 /api/user/me/profile
                return Result.error("403", "请使用 /api/user/me/profile 更新本人资料");
            }
            // 管理端更新
            if (user.getId() == null) {
                return Result.error("400", "用户 ID 不能为空");
            }
            User db = userService.getById(user.getId());
            if (db == null) {
                return Result.error("404", "用户不存在");
            }
            userService.assertCanModifyTarget(currentUser, db);
            if (RoleAssignmentPolicy.hasRoleId(db, RoleAssignmentPolicy.SUPER_ADMIN_ROLE_ID)
                    && user.getRole() != null) {
                return Result.error("403", "超级管理员角色不可通过通用用户接口修改");
            }
            return RolePermissionWriteLock.execute(() -> {
                if (user.getRole() != null) {
                    List<Role> roles = roleAssignmentPolicy.resolveRolesForWrite(currentUser, user.getRole(), false);
                    roleAssignmentPolicy.assertCanRemoveOrDemoteSuperAdmin(user.getId(), roles);
                    user.setRole(roles);
                } else {
                    user.setRole(null);
                }
                user.setPermission(null);
                if (user.getPassword() != null && user.getPassword().trim().isEmpty()) {
                    user.setPassword(null);
                }
                return Result.success(userService.updateWithAvatarBind(
                        user, currentUser, db.getAvatar(), user.getId(), true));
            });
        } catch (CustomException e) {
            return Result.error(e.getCode(), e.getMsg());
        }
    }

    @AuditLog(module = "用户管理", action = "删除用户")
    @DeleteMapping("/{id}")
    public Result<?> delete(@PathVariable Long id, HttpServletRequest request) {
        return Result.error("409", "用户业务历史需要保留，当前数据模型不支持安全删除；请使用后续停用状态流程");
    }

    @GetMapping("/{id}")
    public Result<UserDTO> findById(@PathVariable Long id, HttpServletRequest request) {
        User current = (User) request.getSession().getAttribute("user");
        if (!canViewUserDirectory(current) && (current == null || current.getId() == null || !current.getId().equals(id))) {
            return Result.error("403", "无权查看该用户");
        }
        return Result.success(UserDTO.from(userService.getById(id)));
    }

    @GetMapping("/detail/{username}")
    public Result<UserDTO> findByUsername(@PathVariable String username, HttpServletRequest request) {
        User current = (User) request.getSession().getAttribute("user");
        User target = userService.getbyUsername(username);
        if (target == null) {
            return Result.error("404", "用户不存在");
        }
        if (!canViewUserDirectory(current)
                && (current == null || current.getId() == null || !current.getId().equals(target.getId()))) {
            return Result.error("403", "无权查看该用户");
        }
        return Result.success(UserDTO.from(target));
    }

    @GetMapping
    public Result<List<UserDTO>> findAll(HttpServletRequest request) {
        User current = (User) request.getSession().getAttribute("user");
        if (!canViewUserDirectory(current)) {
            return Result.error("403", "无权查看用户列表");
        }
        return Result.success(userService.list(Wrappers.<User>lambdaQuery()
                .orderByDesc(User::getId).last("LIMIT " + ExcelExportUtil.MAX_EXPORT_ROWS))
                .stream().map(UserDTO::from).collect(Collectors.toList()));
    }

    @GetMapping("/page")
    public Result<IPage<UserDTO>> findPage(@RequestParam(required = false, defaultValue = "") String name,
                                        @RequestParam(required = false, defaultValue = "1") Integer pageNum,
                                        @RequestParam(required = false, defaultValue = "10") Integer pageSize,
                                        HttpServletRequest request) {
        User current = (User) request.getSession().getAttribute("user");
        if (!canViewUserDirectory(current)) {
            return Result.error("403", "无权查看用户列表");
        }
        String keyword = safeQuery(name);
        IPage<User> page = userService.page(new Page<>(safePageNum(pageNum), safePageSize(pageSize)),
                Wrappers.<User>lambdaQuery().like(!keyword.isEmpty(), User::getUsername, keyword).orderByDesc(User::getId));
        IPage<UserDTO> dtoPage = page.convert(UserDTO::from);
        return Result.success(dtoPage);
    }

    @GetMapping("/export")
    public void export(HttpServletRequest request, HttpServletResponse response) throws IOException {
        User current = (User) request.getSession().getAttribute("user");
        if (!canViewUserDirectory(current)) {
            response.setStatus(403);
            response.setContentType("application/json;charset=UTF-8");
            response.getWriter().write("{\"code\":\"403\",\"msg\":\"无权导出用户\"}");
            return;
        }
        List<User> rows = userService.list(Wrappers.<User>lambdaQuery()
                .orderByDesc(User::getId).last("LIMIT " + (ExcelExportUtil.MAX_EXPORT_ROWS + 1)));
        ExcelExportUtil.export(response, "用户信息", rows, user -> {
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("ID", user.getId());
            row.put("名称", user.getUsername());
            row.put("手机", user.getPhone());
            row.put("邮箱", user.getEmail());
            row.put("头像", user.getAvatar());
            return row;
        });
    }

    private boolean canViewUserDirectory(User current) {
        return PermissionUtil.hasFlag(current, "user") || roleAssignmentPolicy.isSuperAdmin(current);
    }

    @AuditLog(module = "用户资料", action = "更新本人资料")
    @PutMapping("/me/profile")
    public Result<?> updateMyProfile(@Valid @RequestBody ProfileUpdateRequest submitted,
                                     HttpServletRequest request) {
        User current = (User) request.getSession().getAttribute("user");
        if (current == null || current.getId() == null) {
            return Result.error("401", "未登录或登录已过期");
        }
        User patch = new User();
        patch.setEmail(submitted.getEmail());
        patch.setPhone(submitted.getPhone());
        patch.setAvatar(submitted.getAvatar());
        try {
            return Result.success(userService.updateWithAvatarBind(
                    patch, current, null, current.getId(), false));
        } catch (CustomException e) {
            return Result.error(e.getCode(), e.getMsg());
        }
    }

    private int safePageNum(Integer value) { return value == null || value < 1 ? 1 : Math.min(value, MAX_PAGE_NUM); }
    private int safePageSize(Integer value) { return value == null || value < 1 ? 10 : Math.min(value, MAX_PAGE_SIZE); }
    private String safeQuery(String value) {
        String normalized = value == null ? "" : value.trim();
        if (normalized.length() > MAX_QUERY_LENGTH) throw new CustomException("400", "查询关键词不能超过100个字符");
        return normalized;
    }

    private static String rateKey(HttpServletRequest request, String username) {
        String ip = request == null ? "unknown" : request.getRemoteAddr();
        if (ip == null) {
            ip = "unknown";
        }
        String u = username == null ? "" : username.trim().toLowerCase();
        return ip + ":" + u;
    }

    private static String registrationRateKey(HttpServletRequest request) {
        String ip = request == null ? "unknown" : request.getRemoteAddr();
        return "register:" + (ip == null ? "unknown" : ip);
    }

}
