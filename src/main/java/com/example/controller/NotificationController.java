package com.example.controller;

import com.example.common.Result;
import com.example.entity.User;
import com.example.service.NotificationService;
import jakarta.annotation.Resource;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/notifications")
public class NotificationController {
    @Resource private NotificationService notificationService;

    @GetMapping
    public Result<?> list(@RequestParam(defaultValue = "1") Integer pageNum,
                          @RequestParam(defaultValue = "20") Integer pageSize,
                          @RequestParam(required = false) Boolean unreadOnly,
                          HttpServletRequest request) {
        User user = current(request);
        return Result.success(notificationService.pageMine(user.getId(), pageNum, pageSize, unreadOnly));
    }

    @GetMapping("/unread-count")
    public Result<?> unreadCount(HttpServletRequest request) {
        User user = current(request);
        return Result.success(notificationService.unreadCount(user.getId()));
    }

    @PutMapping("/{id}/read")
    public Result<?> markRead(@PathVariable Long id, HttpServletRequest request) {
        User user = current(request);
        return Result.success(notificationService.markRead(user.getId(), id));
    }

    @PutMapping("/read-all")
    public Result<?> markAllRead(HttpServletRequest request) {
        User user = current(request);
        return Result.success(notificationService.markAllRead(user.getId()));
    }

    private User current(HttpServletRequest request) {
        User user = (User) request.getSession().getAttribute("user");
        if (user == null || user.getId() == null) {
            throw new com.example.exception.CustomException("401", "未登录或登录已过期");
        }
        return user;
    }
}
