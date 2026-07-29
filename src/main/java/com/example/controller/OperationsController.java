package com.example.controller;

import com.example.common.AuditLog;
import com.example.common.PermissionUtil;
import com.example.common.Result;
import com.example.entity.User;
import com.example.exception.CustomException;
import com.example.service.OperationsService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.Collections;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/operations")
public class OperationsController {
    private final OperationsService service;

    public OperationsController(OperationsService service) {
        this.service = service;
    }

    @GetMapping("/volunteer-tasks")
    public Result<?> volunteerTasks(@RequestParam(defaultValue = "false") boolean mine,
                                    HttpServletRequest request) {
        User user = user(request);
        return Result.success(service.volunteerTasks(user.getId(), mine));
    }

    @PostMapping("/volunteer-tasks/{taskId}/signup")
    public Result<?> signup(@PathVariable Long taskId,
                            @RequestBody(required = false) Map<String, Object> body,
                            HttpServletRequest request) {
        return Result.success(service.signupVolunteerTask(user(request).getId(), taskId,
                body == null ? null : string(body.get("note"))));
    }

    @DeleteMapping("/volunteer-tasks/{taskId}/signup")
    public Result<?> withdrawSignup(@PathVariable Long taskId, HttpServletRequest request) {
        return Result.success(service.withdrawSignup(user(request).getId(), taskId));
    }

    @AuditLog(module = "义工任务", action = "创建义工任务")
    @PostMapping("/admin/volunteer-tasks")
    public Result<?> createTask(@RequestBody Map<String, Object> body, HttpServletRequest request) {
        User actor = require(request, "volunteer");
        return Result.success(service.createVolunteerTask(actor.getId(), body));
    }

    @GetMapping("/admin/volunteer-tasks")
    public Result<?> adminVolunteerTasks(HttpServletRequest request) {
        require(request, "volunteer");
        return Result.success(service.adminVolunteerTasks());
    }

    @AuditLog(module = "义工任务", action = "变更义工任务状态")
    @PutMapping("/admin/volunteer-tasks/{taskId}/status")
    public Result<?> taskStatus(@PathVariable Long taskId, @RequestBody Map<String, Object> body,
                                HttpServletRequest request) {
        User actor = require(request, "volunteer");
        return Result.success(service.setVolunteerTaskStatus(actor.getId(), taskId,
                integer(body.get("status"), "状态"), integer(body.get("expectedVersion"), "版本")));
    }

    @GetMapping("/admin/volunteer-tasks/{taskId}/signups")
    public Result<?> signups(@PathVariable Long taskId, HttpServletRequest request) {
        require(request, "volunteer");
        return Result.success(service.taskSignups(taskId));
    }

    @AuditLog(module = "义工任务", action = "确认义工报名")
    @PutMapping("/admin/volunteer-signups/{signupId}/assign")
    public Result<?> assign(@PathVariable Long signupId, @RequestBody Map<String, Object> body,
                            HttpServletRequest request) {
        User actor = require(request, "volunteer");
        return Result.success(service.assignSignup(actor.getId(), signupId,
                Boolean.TRUE.equals(body.get("accepted")), integer(body.get("expectedVersion"), "版本")));
    }

    @AuditLog(module = "义工任务", action = "登记义工服务")
    @PostMapping("/admin/volunteer-signups/{signupId}/complete")
    public Result<?> complete(@PathVariable Long signupId, @RequestBody Map<String, Object> body,
                              HttpServletRequest request) {
        User actor = require(request, "volunteer");
        return Result.success(service.completeSignup(actor.getId(), signupId,
                integer(body.get("expectedVersion"), "版本"), integer(body.get("serviceMinutes"), "服务分钟数"),
                string(body.get("summary"))));
    }

    @GetMapping("/animals/{animalId}/medical")
    public Result<?> medical(@PathVariable Long animalId, HttpServletRequest request) {
        User viewer = optionalUser(request);
        boolean manager = PermissionUtil.hasFlag(viewer, "animal");
        return Result.success(service.medicalRecords(animalId, viewer == null ? null : viewer.getId(), manager));
    }

    @AuditLog(module = "动物医疗档案", action = "新增医疗记录")
    @PostMapping("/admin/animals/{animalId}/medical")
    public Result<?> createMedical(@PathVariable Long animalId, @RequestBody Map<String, Object> body,
                                   HttpServletRequest request) {
        User actor = require(request, "animal");
        return Result.success(service.createMedicalRecord(actor.getId(), animalId, body));
    }

    @GetMapping("/admin/work-items")
    public Result<?> workItems(@RequestParam(defaultValue = "false") boolean includeClosed,
                               HttpServletRequest request) {
        requireOperationsManager(request);
        return Result.success(service.workItems(includeClosed));
    }

    @GetMapping("/admin/work-items/summary")
    public Result<?> workSummary(HttpServletRequest request) {
        requireOperationsManager(request);
        return Result.success(service.workSummary());
    }

    @AuditLog(module = "统一待办", action = "更新待办")
    @PutMapping("/admin/work-items/{id}")
    public Result<?> updateWorkItem(@PathVariable Long id, @RequestBody Map<String, Object> body,
                                    HttpServletRequest request) {
        User actor = requireOperationsManager(request);
        return Result.success(service.updateWorkItem(actor.getId(), id, body));
    }

    @GetMapping("/favorites")
    public Result<?> favorites(HttpServletRequest request) {
        return Result.success(service.favorites(user(request).getId()));
    }

    @GetMapping("/favorites/{animalId}")
    public Result<?> favoriteStatus(@PathVariable Long animalId, HttpServletRequest request) {
        return Result.success(service.isFavorite(user(request).getId(), animalId));
    }

    @PostMapping("/favorites/{animalId}")
    public Result<?> addFavorite(@PathVariable Long animalId, HttpServletRequest request) {
        return Result.success(service.addFavorite(user(request).getId(), animalId));
    }

    @DeleteMapping("/favorites/{animalId}")
    public Result<?> removeFavorite(@PathVariable Long animalId, HttpServletRequest request) {
        return Result.success(service.removeFavorite(user(request).getId(), animalId));
    }

    private User user(HttpServletRequest request) {
        Object value = request.getSession(false) == null ? null : request.getSession(false).getAttribute("user");
        if (!(value instanceof User) || ((User) value).getId() == null) {
            throw new CustomException("401", "登录状态无效");
        }
        return (User) value;
    }

    private User optionalUser(HttpServletRequest request) {
        Object value = request.getSession(false) == null ? null : request.getSession(false).getAttribute("user");
        return value instanceof User ? (User) value : null;
    }

    private User require(HttpServletRequest request, String flag) {
        User actor = user(request);
        if (!PermissionUtil.hasFlag(actor, flag)) throw new CustomException("403", "无权执行该操作");
        return actor;
    }

    private User requireOperationsManager(HttpServletRequest request) {
        User actor = user(request);
        String[] flags = {"adopt", "proof", "visit", "help", "rescue", "volunteer", "animal", "account"};
        for (String flag : flags) if (PermissionUtil.hasFlag(actor, flag)) return actor;
        throw new CustomException("403", "无权访问统一待办");
    }

    private int integer(Object value, String field) {
        try {
            return value instanceof Number ? ((Number) value).intValue() : Integer.parseInt(String.valueOf(value));
        } catch (RuntimeException e) {
            throw new CustomException("400", field + "无效");
        }
    }

    private String string(Object value) {
        return value == null ? null : String.valueOf(value);
    }
}
