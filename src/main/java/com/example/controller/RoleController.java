package com.example.controller;

import com.baomidou.mybatisplus.core.metadata.IPage;
import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.example.common.AuditLog;
import com.example.common.ExcelExportUtil;
import com.example.common.Result;
import com.example.entity.Role;
import com.example.exception.CustomException;
import com.example.service.RoleService;
import com.example.service.UserService;
import org.springframework.web.bind.annotation.*;

import javax.annotation.Resource;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/role")
public class RoleController {
    private static final int MAX_PAGE_NUM = 10000;
    private static final int MAX_PAGE_SIZE = 50;
    private static final int MAX_QUERY_LENGTH = 100;
    @Resource
    private RoleService roleService;

    @Resource
    private UserService userService;

    @AuditLog(module = "角色管理", action = "新增角色定义")
    @PostMapping
    public Result<?> save(@RequestBody Role role, HttpServletRequest request) {
        return Result.success(roleService.createDefinition(role, currentSuperAdmin(request)));
    }

    @AuditLog(module = "角色管理", action = "更新角色定义")
    @PutMapping
    public Result<?> update(@RequestBody Role role, HttpServletRequest request) {
        return Result.success(roleService.updateDefinition(role, currentSuperAdmin(request)));
    }

    @AuditLog(module = "角色管理", action = "删除角色定义")
    @DeleteMapping("/{id}")
    public Result<?> delete(@PathVariable Long id, HttpServletRequest request) {
        roleService.deleteDefinition(id, currentSuperAdmin(request));
        return Result.success();
    }

    @GetMapping("/{id}")
    public Result<Role> findById(@PathVariable Long id) {
        return Result.success(roleService.getById(id));
    }

    @GetMapping
    public Result<List<Role>> findAll() {
        return Result.success(roleService.list(Wrappers.<Role>lambdaQuery()
                .orderByAsc(Role::getId).last("LIMIT " + ExcelExportUtil.MAX_EXPORT_ROWS)));
    }

    @GetMapping("/page")
    public Result<IPage<Role>> findPage(@RequestParam(required = false, defaultValue = "") String name,
                                           @RequestParam(required = false, defaultValue = "1") Integer pageNum,
                                           @RequestParam(required = false, defaultValue = "10") Integer pageSize) {
        String keyword = safeQuery(name);
        return Result.success(roleService.page(new Page<>(safePageNum(pageNum), safePageSize(pageSize)),
                Wrappers.<Role>lambdaQuery().like(!keyword.isEmpty(), Role::getName, keyword)
                        .orderByDesc(Role::getId)));
    }

    @GetMapping("/export")
    public void export(javax.servlet.http.HttpServletRequest request, HttpServletResponse response) throws IOException {
        com.example.entity.User user = (com.example.entity.User) request.getSession().getAttribute("user");
        if (!com.example.common.PermissionUtil.hasFlag(user, "role")) {
            response.setStatus(403);
            response.setContentType("application/json;charset=UTF-8");
            response.getWriter().write("{\"code\":\"403\",\"msg\":\"无权导出角色\"}");
            return;
        }
        List<Role> rows = roleService.list(Wrappers.<Role>lambdaQuery()
                .orderByDesc(Role::getId).last("LIMIT " + (ExcelExportUtil.MAX_EXPORT_ROWS + 1)));
        ExcelExportUtil.export(response, "角色信息", rows, role -> {
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("ID", role.getId());
            row.put("名称", role.getName());
            row.put("描述", role.getDescription());
            row.put("权限数量", role.getPermission() == null ? 0 : role.getPermission().size());
            return row;
        });
    }

    private com.example.entity.User currentSuperAdmin(HttpServletRequest request) {
        Object actor = request.getSession(false) == null
                ? null : request.getSession(false).getAttribute("user");
        return userService.requireRealSuperAdmin(actor instanceof com.example.entity.User
                ? (com.example.entity.User) actor : null);
    }

    private int safePageNum(Integer value) { return value == null || value < 1 ? 1 : Math.min(value, MAX_PAGE_NUM); }
    private int safePageSize(Integer value) { return value == null || value < 1 ? 10 : Math.min(value, MAX_PAGE_SIZE); }
    private String safeQuery(String value) {
        String normalized = value == null ? "" : value.trim();
        if (normalized.length() > MAX_QUERY_LENGTH) throw new CustomException("400", "查询关键词不能超过100个字符");
        return normalized;
    }

}
