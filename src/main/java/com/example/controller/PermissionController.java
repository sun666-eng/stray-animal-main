package com.example.controller;

import com.baomidou.mybatisplus.core.metadata.IPage;
import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.example.common.ExcelExportUtil;
import com.example.common.Result;
import com.example.entity.Permission;
import com.example.entity.Role;
import com.example.service.PermissionService;
import org.springframework.web.bind.annotation.*;

import javax.annotation.Resource;
import javax.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/permission")
public class PermissionController {
    @Resource
    private PermissionService permissionService;

    @PostMapping
    public Result<?> save(@RequestBody Permission permission) {
        return Result.success(permissionService.save(permission));
    }

    @PutMapping
    public Result<?> update(@RequestBody Permission permission) {
        return Result.success(permissionService.updateById(permission));
    }

    @DeleteMapping("/{id}")
    public Result<?> delete(@PathVariable Long id) {
        permissionService.delete(id);
        return Result.success();
    }

    @GetMapping("/{id}")
    public Result<Permission> findById(@PathVariable Long id) {
        return Result.success(permissionService.getById(id));
    }

    @GetMapping
    public Result<List<Permission>> findAll() {
        return Result.success(permissionService.list());
    }

    @GetMapping("/page")
    public Result<IPage<Permission>> findPage(@RequestParam(required = false, defaultValue = "") String name,
                                              @RequestParam(required = false, defaultValue = "1") Integer pageNum,
                                              @RequestParam(required = false, defaultValue = "10") Integer pageSize) {
        return Result.success(permissionService.page(new Page<>(pageNum, pageSize), Wrappers.<Permission>lambdaQuery().like(Permission::getName, name)));
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
        ExcelExportUtil.export(response, "权限信息", permissionService.list(), permission -> {
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("ID", permission.getId());
            row.put("名称", permission.getName());
            row.put("描述", permission.getDescription());
            row.put("菜单路径", permission.getPath());
            row.put("唯一标识", permission.getFlag());
            return row;
        });
    }

}
