package com.example.controller;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.example.common.ExcelExportUtil;
import com.example.common.AuditLog;
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

import jakarta.annotation.Resource;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
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
    public Result<?> delete(@PathVariable Long id, HttpServletRequest request) {
        try {
            User user = (User) request.getSession().getAttribute("user");
            return Result.success(volunteerService.deleteVolunteer(id, user));
        } catch (CustomException e) {
            return Result.error(e.getCode(), e.getMsg());
        }
    }

    @AuditLog(module = "义工管理", action = "审核义工申请")
    @PutMapping("/{id}/state/{state}")
    public Result<?> audit(@PathVariable Long id, @PathVariable Integer state,
                           HttpServletRequest request) {
        try {
            User user = (User) request.getSession().getAttribute("user");
            return Result.success(volunteerService.auditVolunteer(id, state, user));
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
        return Result.success(volunteerService.list(Wrappers.<Volunteer>lambdaQuery()
                .orderByDesc(Volunteer::getId)
                .last("LIMIT " + ExcelExportUtil.MAX_EXPORT_ROWS)));
    }

    @GetMapping("/approved")
    public Result<List<Volunteer>> findApproved() {
        return Result.success(volunteerService.list(Wrappers.<Volunteer>lambdaQuery()
                .eq(Volunteer::getVstate, 1)
                .orderByDesc(Volunteer::getId)
                .last("LIMIT " + ExcelExportUtil.MAX_EXPORT_ROWS)));
    }

    @GetMapping("/page")
    public Result<IPage<Volunteer>> findPage(@RequestParam(required = false, defaultValue = "") String name,
                                                  @RequestParam(required = false, defaultValue = "1") Integer pageNum,
                                                  @RequestParam(required = false, defaultValue = "10") Integer pageSize) {
        long safePageNum = pageNum == null ? 1 : Math.min(10_000, Math.max(1, pageNum));
        long safePageSize = pageSize == null ? 10 : Math.max(1, Math.min(50, pageSize));
        String keyword = name == null ? "" : name.trim();
        if (keyword.length() > 100) {
            throw new CustomException("400", "查询关键词不能超过100个字符");
        }
        // 空关键词不拼 LIKE，避免 LIKE '%%' 全表扫描
        return Result.success(volunteerService.page(new Page<>(safePageNum, safePageSize),
                Wrappers.<Volunteer>lambdaQuery()
                        .like(!keyword.isEmpty(), Volunteer::getLocation, keyword)
                        .orderByDesc(Volunteer::getId)));
    }

    @GetMapping("/mine")
    public Result<IPage<Volunteer>> findMine(@RequestParam(required = false, defaultValue = "") String username,
                                             @RequestParam(required = false, defaultValue = "") String phone,
                                             @RequestParam(required = false, defaultValue = "") String email,
                                             @RequestParam(required = false, defaultValue = "1") Integer pageNum,
                                             @RequestParam(required = false, defaultValue = "10") Integer pageSize,
                                             HttpServletRequest request) {
        User user = (User) request.getSession().getAttribute("user");
        long safePageNum = pageNum == null ? 1 : Math.max(1, pageNum);
        long safePageSize = pageSize == null ? 10 : Math.max(1, Math.min(50, pageSize));
        // 审计修复 M2：/mine 默认名副其实——所有用户（含 volunteer 审核员）按 uid 查自己的申请；
        // 仅当显式携带搜索参数时，volunteer 管理员才进入检索分支。
        // 旧行为：flag 持有者无参数时直接返回空页，自己的申请永久不可见，与提交侧 409 矛盾。
        boolean adminSearch = PermissionUtil.hasFlag(user, "volunteer")
                && !(username.trim().isEmpty() && phone.trim().isEmpty() && email.trim().isEmpty());
        if (!adminSearch) {
            if (user == null || user.getId() == null) {
                return Result.error("403", "只能查看自己的义工申请");
            }
            // 仅按 uid：禁止用可改手机/邮箱/姓名做所有权（水平越权）
            LambdaQueryWrapper<Volunteer> mine = Wrappers.<Volunteer>lambdaQuery()
                    .eq(Volunteer::getUid, user.getId())
                    .orderByDesc(Volunteer::getId);
            try {
                return Result.success(volunteerService.page(new Page<>(safePageNum, safePageSize), mine));
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
        return Result.success(volunteerService.page(new Page<>(safePageNum, safePageSize), wrapper));
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
        List<Volunteer> rows = volunteerService.list(Wrappers.<Volunteer>lambdaQuery()
                .orderByDesc(Volunteer::getId).last("LIMIT " + (ExcelExportUtil.MAX_EXPORT_ROWS + 1)));
        ExcelExportUtil.export(response, "义工申请", rows, volunteer -> {
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
