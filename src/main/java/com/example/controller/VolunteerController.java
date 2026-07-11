package com.example.controller;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.example.common.ExcelExportUtil;
import com.example.common.PermissionUtil;
import com.example.common.Result;
import com.example.entity.User;
import com.example.entity.Volunteer;
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
        if (user == null || user.getId() == null) {
            return Result.error("401", "未登录或登录已过期");
        }
        volunteer.setUid(user.getId());
        if (!PermissionUtil.hasFlag(user, "volunteer")) {
            volunteer.setVstate(0);
        } else if (volunteer.getVstate() == null) {
            volunteer.setVstate(0);
        }
        return Result.success(volunteerService.save(volunteer));
    }

    @PutMapping
    public Result<?> update(@RequestBody Volunteer volunteer) {
        return Result.success(volunteerService.updateWithRoleSync(volunteer));
    }

    @DeleteMapping("/{id}")
    public Result<?> delete(@PathVariable Long id) {
        volunteerService.removeById(id);
        return Result.success();
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
        final String queryUsername;
        final String queryPhone;
        final String queryEmail;
        if (!PermissionUtil.hasFlag(user, "volunteer")) {
            if (user == null) {
                return Result.error("403", "只能查看自己的义工申请");
            }
            return Result.success(volunteerService.page(new Page<>(pageNum, pageSize),
                    Wrappers.<Volunteer>lambdaQuery().eq(Volunteer::getUid, user.getId())
                            .orderByDesc(Volunteer::getId)));
        } else {
            queryUsername = username;
            queryPhone = phone;
            queryEmail = email;
        }
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
    public void export(HttpServletResponse response) throws IOException {
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
