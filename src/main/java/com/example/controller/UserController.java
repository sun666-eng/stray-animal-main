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
import com.example.dto.LoginVO;
import com.example.dto.RegisterRequest;
import com.example.dto.UserDTO;
import com.example.entity.Role;
import com.example.entity.User;
import com.example.exception.CustomException;
import com.example.service.UserService;
import com.example.component.WebSocketTicketService;
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
            MAP.put(res.getUsername(), res);
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
        String rateKey = rateKey(request, registration == null ? null : registration.getUsername());
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
            loginRateLimiter.recordSuccess(rateKey);
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
        MAP.put(dbUser.getUsername(), dbUser);
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
        try {
            Object sessionUser = request.getSession(false) == null
                    ? null
                    : request.getSession(false).getAttribute("user");
            if (sessionUser instanceof User) {
                username = ((User) sessionUser).getUsername();
            }
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
    public Result<Map<String, String>> createWebSocketTicket(HttpServletRequest request) {
        User user = (User) request.getSession().getAttribute("user");
        if (user == null || user.getId() == null) {
            return Result.error("401", "未登录或登录已过期");
        }
        Map<String, String> data = new LinkedHashMap<>();
        data.put("ticket", webSocketTicketService.issue(user.getId()));
        return Result.success(data);
    }

    @AuditLog(module = "用户管理", action = "新增用户")
    @PostMapping
    public Result<?> save(@Valid @RequestBody User user, HttpServletRequest request) {
        if (user.getPassword() == null || user.getPassword().trim().isEmpty()) {
            return Result.error("400", "密码不能为空");
        }
        User current = (User) request.getSession().getAttribute("user");
        try {
            List<Role> roles = roleAssignmentPolicy.resolveRolesForWrite(current, user.getRole(), true);
            user.setRole(roles);
            user.setPermission(null);
            return Result.success(userService.createWithAvatar(user, current));
        } catch (CustomException e) {
            return Result.error(e.getCode(), e.getMsg());
        }
    }

    @AuditLog(module = "用户管理", action = "更新用户")
    @PutMapping
    public Result<?> update(@RequestBody User user, HttpServletRequest request) {
        User currentUser = (User) request.getSession().getAttribute("user");
        if (currentUser == null || currentUser.getId() == null) {
            return Result.error("401", "未登录或登录已过期");
        }
        try {
            boolean manageUser = PermissionUtil.hasFlag(currentUser, "user")
                    || roleAssignmentPolicy.isSuperAdmin(currentUser);
            if (!manageUser) {
                if (user.getId() == null || !currentUser.getId().equals(user.getId())) {
                    return Result.error("403", "只能修改自己的用户信息");
                }
                // 本人资料：禁止改角色；空密码不覆盖
                User db = userService.getById(currentUser.getId());
                user.setId(currentUser.getId());
                user.setRole(db == null ? null : db.getRole());
                user.setPermission(null);
                if (user.getPassword() != null && user.getPassword().trim().isEmpty()) {
                    user.setPassword(null);
                }
                return Result.success(userService.updateWithAvatarBind(
                        user, currentUser, db == null ? null : db.getAvatar(),
                        currentUser.getId(), false));
            }
            // 管理端更新
            if (user.getId() == null) {
                return Result.error("400", "用户 ID 不能为空");
            }
            User db = userService.getById(user.getId());
            if (db == null) {
                return Result.error("404", "用户不存在");
            }
            if (user.getRole() != null) {
                List<Role> roles = roleAssignmentPolicy.resolveRolesForWrite(currentUser, user.getRole(), false);
                roleAssignmentPolicy.assertCanRemoveOrDemoteSuperAdmin(user.getId(), roles);
                user.setRole(roles);
            } else {
                user.setRole(db.getRole());
            }
            user.setPermission(null);
            if (user.getPassword() != null && user.getPassword().trim().isEmpty()) {
                user.setPassword(null);
            }
            return Result.success(userService.updateWithAvatarBind(
                    user, currentUser, db.getAvatar(), user.getId(), true));
        } catch (CustomException e) {
            return Result.error(e.getCode(), e.getMsg());
        }
    }

    @AuditLog(module = "用户管理", action = "删除用户")
    @DeleteMapping("/{id}")
    public Result<?> delete(@PathVariable Long id, HttpServletRequest request) {
        User current = (User) request.getSession().getAttribute("user");
        try {
            roleAssignmentPolicy.assertCanDeleteUser(current, id);
            userService.deleteUser(id);
            return Result.success();
        } catch (CustomException e) {
            return Result.error(e.getCode(), e.getMsg());
        }
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
        return Result.success(userService.list().stream().map(UserDTO::from).collect(Collectors.toList()));
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
        IPage<User> page = userService.page(new Page<>(pageNum, pageSize),
                Wrappers.<User>lambdaQuery().like(User::getUsername, name).orderByDesc(User::getId));
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
        ExcelExportUtil.export(response, "用户信息", userService.list(), user -> {
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

    private static String rateKey(HttpServletRequest request, String username) {
        String ip = request == null ? "unknown" : request.getRemoteAddr();
        if (ip == null) {
            ip = "unknown";
        }
        String u = username == null ? "" : username.trim().toLowerCase();
        return ip + ":" + u;
    }

}
