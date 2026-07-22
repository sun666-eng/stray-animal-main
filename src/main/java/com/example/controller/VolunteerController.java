package com.example.controller;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.example.common.ExcelExportUtil;
import com.example.common.PermissionUtil;
import com.example.common.Result;
import com.example.entity.User;
import com.example.entity.Volunteer;
import com.example.exception.CustomException;
import com.example.service.VolunteerService;
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
@RequestMapping("/api/volunteer")
public class VolunteerController {
    @Resource
    private VolunteerService volunteerService;

    @PostMapping
    public Result<?> save(@RequestBody Volunteer volunteer, HttpServletRequest request) {
        User user = (User) request.getSession().getAttribute("user");
        try {
            return Result.success(volunteerService.submitVolunteer(volunteer, user));
        } catch (CustomException e) {
            return Result.error(e.getCode(), e.getMsg());
        }
    }

    @PutMapping
    public Result<?> update(@RequestBody Volunteer volunteer, HttpServletRequest request) {
        User user = (User) request.getSession().getAttribute("user");
        try {
            return Result.success(volunteerService.updateVolunteer(volunteer, user));
        } catch (CustomException e) {
            return Result.error(e.getCode(), e.getMsg());
        }
    }

    @DeleteMapping("/{id}")
    public Result<?> delete(@PathVariable Long id) {
        try {
            return Result.success(volunteerService.deleteVolunteer(id));
        } catch (CustomException e) {
            return Result.error(e.getCode(), e.getMsg());
        }
    }

    @GetMapping("/{id}")
    public Result<Volunteer> findById(@PathVariable Long id) {
        return Result.success(volunteerService.getById(id));
    }

    @GetMapping
    public Result<List<Volunteer>> findAll() {
        return Result.success(volunteerService.list());
    }

    @GetMapping("/approved")
    public Result<List<Volunteer>> findApproved() {
        return Result.success(volunteerService.list(Wrappers.<Volunteer>lambdaQuery()
                .eq(Volunteer::getVstate, 1)
                .orderByDesc(Volunteer::getId)));
    }

    @GetMapping("/page")
    public Result<IPage<Volunteer>> findPage(@RequestParam(required = false, defaultValue = "") String name,
                                                 @RequestParam(required = false, defaultValue = "1") Integer pageNum,
                                                 @RequestParam(required = false, defaultValue = "10") Integer pageSize) {
        return Result.success(volunteerService.page(new Page<>(pageNum, pageSize), Wrappers.<Volunteer>lambdaQuery().like(Volunteer::getLocation, name)));
    }

    @GetMapping("/mine")
    public Result<IPage<Volunteer>> findMine(@RequestParam(required = false, defaultValue = "") String username,
                                             @RequestParam(required = false, defaultValue = "") String phone,
                                             @RequestParam(required = false, defaultValue = "") String email,
                                             @RequestParam(required = false, defaultValue = "1") Integer pageNum,
                                             @RequestParam(required = false, defaultValue = "10") Integer pageSize,
                                             HttpServletRequest request) {
        User user = (User) request.getSession().getAttribute("user");
        if (!PermissionUtil.hasFlag(user, "volunteer")) {
            if (user == null || user.getId() == null) {
                return Result.error("403", "只能查看自己的义工申请");
            }
            // 仅按 uid：禁止用可改手机/邮箱/姓名做所有权（水平越权）
            LambdaQueryWrapper<Volunteer> mine = Wrappers.<Volunteer>lambdaQuery()
                    .eq(Volunteer::getUid, user.getId())
                    .orderByDesc(Volunteer::getId);
            try {
                return Result.success(volunteerService.page(new Page<>(pageNum, pageSize), mine));
            } catch (Exception e) {
                // 常见：旧库缺少 uid/apic 列 → Unknown column
                String msg = e.getMessage() == null ? "" : e.getMessage();
                Throwable cause = e.getCause();
                String causeMsg = cause != null && cause.getMessage() != null ? cause.getMessage() : "";
                if (msg.contains("Unknown column") || causeMsg.contains("Unknown column")
                        || msg.contains("uid") || causeMsg.contains("uid")
                        || msg.contains("apic") || causeMsg.contains("apic")) {
                    return Result.error("500",
                            "数据库义工表缺少 uid/apic 字段，请在 MySQL 执行 docs/sql/fix-volunteer-columns.sql 后重试");
                }
                throw e;
            }
        }
        String queryUsername = username;
        String queryPhone = phone;
        String queryEmail = email;
        if (queryUsername.trim().isEmpty() && queryPhone.trim().isEmpty() && queryEmail.trim().isEmpty()) {
            return Result.success(new Page<>(pageNum, pageSize));
        }
        LambdaQueryWrapper<Volunteer> wrapper = Wrappers.<Volunteer>lambdaQuery();
        wrapper.and(q -> {
            boolean appended = false;
            if (!queryUsername.trim().isEmpty()) {
                q.eq(Volunteer::getName, queryUsername.trim());
                appended = true;
            }
            if (!queryPhone.trim().isEmpty()) {
                if (appended) {
                    q.or();
                }
                q.eq(Volunteer::getTel, queryPhone.trim());
                appended = true;
            }
            if (!queryEmail.trim().isEmpty()) {
                if (appended) {
                    q.or();
                }
                q.eq(Volunteer::getEmail, queryEmail.trim());
            }
        }).orderByDesc(Volunteer::getId);
        return Result.success(volunteerService.page(new Page<>(pageNum, pageSize), wrapper));
    }

    private String safeValue(String value) {
        return value == null ? "" : value;
    }
    @GetMapping("/export")
    public void export(HttpServletRequest request, HttpServletResponse response) throws IOException {
        User user = (User) request.getSession().getAttribute("user");
        if (!PermissionUtil.hasFlag(user, "volunteer")) {
            response.setStatus(403);
            response.setContentType("application/json;charset=UTF-8");
            response.getWriter().write("{\"code\":\"403\",\"msg\":\"无权导出义工申请\"}");
            return;
        }
        ExcelExportUtil.export(response, "义工申请", volunteerService.list(), volunteer -> {
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("ID", volunteer.getId());
            row.put("名称", volunteer.getName());
            row.put("年龄", volunteer.getAge());
            row.put("工作单位", volunteer.getCompany());
            row.put("邮箱", volunteer.getEmail());
            row.put("微信号", volunteer.getWechat());
            row.put("联系电话", volunteer.getTel());
            row.put("现居地", volunteer.getLocation());
            row.put("是否到过基地", volunteer.getIsvisit());
            row.put("每周空闲时间", volunteer.getSparetime());
            row.put("审核状态", volunteer.getVstate());
            row.put("能力自述", volunteer.getMoreability());
            return row;
        });
    }


}
