package com.example.controller;

import com.example.common.AuditLog;
import com.example.common.ExcelExportUtil;
import com.example.common.PermissionUtil;
import com.example.common.Result;
import com.example.entity.User;
import com.example.entity.Visit;
import com.example.service.VisitService;
import com.baomidou.mybatisplus.core.metadata.IPage;
import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import org.springframework.web.bind.annotation.*;

import javax.annotation.Resource;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/visit")
public class VisitController {
    @Resource
     private VisitService visitService;

    @AuditLog(module = "回访管理", action = "新增回访记录")
    @PostMapping
    public Result<?> save(@RequestBody Visit visit) {
        return Result.success(visitService.save(visit));
    }

    @AuditLog(module = "回访管理", action = "更新回访记录")
    @PutMapping
    public Result<?> update(@RequestBody Visit visit) {
        return Result.success(visitService.updateById(visit));
    }

    @AuditLog(module = "回访管理", action = "删除回访记录")
    @DeleteMapping("/{id}")
    public Result<?> delete(@PathVariable Long id) {
        visitService.removeById(id);
        return Result.success();
    }

    @GetMapping("/{id}")
    public Result<Visit> findById(@PathVariable Long id) {
        return Result.success(visitService.getById(id));
    }

    @GetMapping
    public Result<List<Visit>> findAll() {
        return Result.success(visitService.list());
    }

    @GetMapping("/page")
    public Result<IPage<Visit>> findPage(@RequestParam(required = false, defaultValue = "") String name,
                                           @RequestParam(required = false, defaultValue = "1") Integer pageNum,
                                           @RequestParam(required = false, defaultValue = "10") Integer pageSize) {
        return Result.success(visitService.page(new Page<>(pageNum, pageSize), Wrappers.<Visit>lambdaQuery().like(Visit::getAname, name)));
    }

    @GetMapping("/mine")
    public Result<IPage<Visit>> mine(@RequestParam Long uid,
                                     @RequestParam(required = false, defaultValue = "1") Integer pageNum,
                                     @RequestParam(required = false, defaultValue = "10") Integer pageSize,
                                     HttpServletRequest request) {
        User user = (User) request.getSession().getAttribute("user");
        if (!PermissionUtil.hasFlag(user, "visit")
                && (user == null || user.getId() == null || !user.getId().equals(uid))) {
            return Result.error("403", "只能查看自己的回访记录");
        }
        return Result.success(visitService.page(new Page<>(pageNum, pageSize),
                Wrappers.<Visit>lambdaQuery().eq(Visit::getUid, uid).orderByDesc(Visit::getId)));
    }

    @GetMapping("/export")
    public void export(HttpServletResponse response) throws IOException {
        ExcelExportUtil.export(response, "回访记录", visitService.list(), visit -> {
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("ID", visit.getId());
            row.put("动物ID", visit.getPetId());
            row.put("用户ID", visit.getUid());
            row.put("回访人", visit.getVname());
            row.put("动物名称", visit.getAname());
            row.put("回访日期", visit.getVtime());
            row.put("状态", visit.getState());
            row.put("备注", visit.getRemark());
            row.put("图片", visit.getPic());
            return row;
        });
    }

}
