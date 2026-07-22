package com.example.controller;

import com.example.common.AuditLog;
import com.example.common.ExcelExportUtil;
import com.example.common.PermissionUtil;
import com.example.common.Result;
import com.example.entity.User;
import com.example.entity.Visit;
import com.example.exception.CustomException;
import com.example.service.VisitService;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
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
    public Result<?> save(@RequestBody Visit visit, HttpServletRequest request) {
        try {
            return Result.success(visitService.createVisit(visit, sessionUser(request)));
        } catch (CustomException e) {
            return Result.error(e.getCode(), e.getMsg());
        }
    }

    @AuditLog(module = "回访管理", action = "更新回访记录")
    @PutMapping
    public Result<?> update(@RequestBody Visit visit, HttpServletRequest request) {
        try {
            return Result.success(visitService.updateVisit(visit, sessionUser(request)));
        } catch (CustomException e) {
            return Result.error(e.getCode(), e.getMsg());
        }
    }

    @AuditLog(module = "回访管理", action = "删除回访记录")
    @DeleteMapping("/{id}")
    public Result<?> delete(@PathVariable Long id) {
        try {
            return Result.success(visitService.deleteVisit(id));
        } catch (CustomException e) {
            return Result.error(e.getCode(), e.getMsg());
        }
    }

    private User sessionUser(HttpServletRequest request) {
        Object u = request.getSession(false) == null ? null : request.getSession(false).getAttribute("user");
        return u instanceof User ? (User) u : null;
    }

    @GetMapping("/{id}")
    public Result<Visit> findById(@PathVariable Long id, HttpServletRequest request) {
        User user = (User) request.getSession().getAttribute("user");
        Visit visit = visitService.getById(id);
        if (visit == null) {
            return Result.error("404", "回访记录不存在");
        }
        if (!PermissionUtil.hasFlag(user, "visit")
                && (user == null || user.getId() == null || !user.getId().equals(visit.getUid()))) {
            return Result.error("403", "只能查看自己的回访记录");
        }
        return Result.success(visit);
    }

    @GetMapping
    public Result<List<Visit>> findAll(HttpServletRequest request) {
        User user = (User) request.getSession().getAttribute("user");
        if (!PermissionUtil.hasFlag(user, "visit")) {
            return Result.error("403", "无权查看全部回访");
        }
        return Result.success(visitService.list());
    }

    @GetMapping("/page")
    public Result<IPage<Visit>> findPage(@RequestParam(required = false, defaultValue = "") String name,
                                           @RequestParam(required = false, defaultValue = "1") Integer pageNum,
                                           @RequestParam(required = false, defaultValue = "10") Integer pageSize,
                                           HttpServletRequest request) {
        User user = (User) request.getSession().getAttribute("user");
        if (!PermissionUtil.hasFlag(user, "visit")) {
            return Result.error("403", "无权查看回访列表");
        }
        return Result.success(visitService.page(new Page<>(pageNum, pageSize),
                Wrappers.<Visit>lambdaQuery().like(Visit::getAname, name).orderByDesc(Visit::getId)));
    }

    @GetMapping("/mine")
    public Result<IPage<Visit>> mine(@RequestParam Long uid,
                                     @RequestParam(required = false) Long petId,
                                     @RequestParam(required = false, defaultValue = "1") Integer pageNum,
                                     @RequestParam(required = false, defaultValue = "10") Integer pageSize,
                                     HttpServletRequest request) {
        User user = (User) request.getSession().getAttribute("user");
        if (!PermissionUtil.hasFlag(user, "visit")
                && (user == null || user.getId() == null || !user.getId().equals(uid))) {
            return Result.error("403", "只能查看自己的回访记录");
        }
        LambdaQueryWrapper<Visit> wrapper = Wrappers.<Visit>lambdaQuery()
                .eq(Visit::getUid, uid)
                .eq(petId != null, Visit::getPetId, petId)
                .orderByDesc(Visit::getId);
        return Result.success(visitService.page(new Page<>(pageNum, pageSize), wrapper));
    }

    @GetMapping("/export")
    public void export(HttpServletRequest request, HttpServletResponse response) throws IOException {
        User user = (User) request.getSession().getAttribute("user");
        if (!PermissionUtil.hasFlag(user, "visit")) {
            response.setStatus(403);
            response.setContentType("application/json;charset=UTF-8");
            response.getWriter().write("{\"code\":\"403\",\"msg\":\"无权导出回访\"}");
            return;
        }
        ExcelExportUtil.export(response, "回访记录", visitService.list(), visit -> {
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("ID", visit.getId());
            row.put("动物ID", visit.getPetId());
            row.put("用户ID", visit.getUid());
            row.put("回访人", visit.getVname());
            row.put("动物名称", visit.getAname());
            row.put("回访日期", visit.getVtime());
            row.put("健康评分", visit.getState());
            row.put("备注", visit.getRemark());
            row.put("图片", visit.getPic());
            return row;
        });
    }
}
