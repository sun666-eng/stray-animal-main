package com.example.controller;

import com.baomidou.mybatisplus.core.metadata.IPage;
import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.example.common.AuditLog;
import com.example.common.ExcelExportUtil;
import com.example.common.Result;
import com.example.entity.Permission;
import com.example.entity.Role;
import com.example.service.PermissionService;
import com.example.service.UserService;
import com.example.exception.CustomException;
import org.springframework.web.bind.annotation.*;

import javax.annotation.Resource;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/permission")
public class PermissionController {
    private static final int MAX_PAGE_NUM = 10000;
    private static final int MAX_PAGE_SIZE = 50;
    private static final int MAX_QUERY_LENGTH = 100;
    @Resource
    private PermissionService permissionService;

    @Resource
    private UserService userService;

    @AuditLog(module = "权限管理", action = "新增权限定义")
    @PostMapping
    public Result<?> save(@RequestBody Permission permission, HttpServletRequest request) {
        return Result.success(permissionService.createDefinition(permission, currentSuperAdmin(request)));
    }

    @AuditLog(module = "权限管理", action = "更新权限定义")
    @PutMapping
    public Result<?> update(@RequestBody Permission permission, HttpServletRequest request) {
        return Result.success(permissionService.updateDefinition(permission, currentSuperAdmin(request)));
    }

    @AuditLog(module = "权限管理", action = "删除权限定义")
    @DeleteMapping("/{id}")
    public Result<?> delete(@PathVariable Long id, HttpServletRequest request) {
        throw new com.example.exception.CustomException("409",
                "权限定义通过 JSON 被角色引用，禁止删除");
    }

    @GetMapping("/{id}")
    public Result<Permission> findById(@PathVariable Long id) {
        return Result.success(permissionService.getById(id));
    }

    @GetMapping
    public Result<List<Permission>> findAll() {
        return Result.success(permissionService.list(Wrappers.<Permission>lambdaQuery()
                .orderByAsc(Permission::getId).last("LIMIT " + ExcelExportUtil.MAX_EXPORT_ROWS)));
    }

    @GetMapping("/page")
    public Result<IPage<Permission>> findPage(@RequestParam(required = false, defaultValue = "") String name,
                                              @RequestParam(required = false, defaultValue = "1") Integer pageNum,
                                              @RequestParam(required = false, defaultValue = "10") Integer pageSize) {
        String keyword = safeQuery(name);
        return Result.success(permissionService.page(new Page<>(safePageNum(pageNum), safePageSize(pageSize)),
                Wrappers.<Permission>lambdaQuery().like(!keyword.isEmpty(), Permission::getName, keyword)
                        .orderByDesc(Permission::getId)));
    }

    @PostMapping("/getByRoles")
    public Result<List<Permission>> getByRoles(@RequestBody List<Role> roles) {
        return Result.success(permissionService.getByRoles(roles));
    }

    @GetMapping("/export")
    public void export(javax.servlet.http.HttpServletRequest request, HttpServletResponse response) throws IOException {
        com.example.entity.User user = (com.example.entity.User) request.getSession().getAttribute("user");
        if (!com.example.common.PermissionUtil.hasFlag(user, "permission")) {
            response.setStatus(403);
            response.setContentType("application/json;charset=UTF-8");
            response.getWriter().write("{\"code\":\"403\",\"msg\":\"无权导出权限\"}");
            return;
        }
        List<Permission> rows = permissionService.list(Wrappers.<Permission>lambdaQuery()
                .orderByDesc(Permission::getId).last("LIMIT " + (ExcelExportUtil.MAX_EXPORT_ROWS + 1)));
        ExcelExportUtil.export(response, "权限信息", rows, permission -> {
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("ID", permission.getId());
            row.put("名称", permission.getName());
            row.put("描述", permission.getDescription());
            row.put("菜单路径", permission.getPath());
            row.put("唯一标识", permission.getFlag());
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
