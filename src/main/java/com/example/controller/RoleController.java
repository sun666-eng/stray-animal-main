package com.example.controller;

import com.baomidou.mybatisplus.core.metadata.IPage;
import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.example.common.ExcelExportUtil;
import com.example.common.Result;
import com.example.entity.Role;
import com.example.service.RoleService;
import org.springframework.web.bind.annotation.*;

import javax.annotation.Resource;
import javax.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/role")
public class RoleController {
    @Resource
     private RoleService roleService;

    @PostMapping
    public Result<?> save(@RequestBody Role role) {
        return Result.success(roleService.save(role));
    }

    @PutMapping
    public Result<?> update(@RequestBody Role role) {
        return Result.success(roleService.updateById(role));
    }

    @DeleteMapping("/{id}")
    public Result<?> delete(@PathVariable Long id) {
        roleService.removeById(id);
        return Result.success();
    }

    @GetMapping("/{id}")
    public Result<Role> findById(@PathVariable Long id) {
        return Result.success(roleService.getById(id));
    }

    @GetMapping
    public Result<List<Role>> findAll() {
        return Result.success(roleService.list());
    }

    @GetMapping("/page")
    public Result<IPage<Role>> findPage(@RequestParam(required = false, defaultValue = "") String name,
                                           @RequestParam(required = false, defaultValue = "1") Integer pageNum,
                                           @RequestParam(required = false, defaultValue = "10") Integer pageSize) {
        return Result.success(roleService.page(new Page<>(pageNum, pageSize), Wrappers.<Role>lambdaQuery().like(Role::getName, name)));
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
        ExcelExportUtil.export(response, "角色信息", roleService.list(), role -> {
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("ID", role.getId());
            row.put("名称", role.getName());
            row.put("描述", role.getDescription());
            row.put("权限数量", role.getPermission() == null ? 0 : role.getPermission().size());
            return row;
        });
    }

}
