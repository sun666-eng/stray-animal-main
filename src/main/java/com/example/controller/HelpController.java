package com.example.controller;

import com.baomidou.mybatisplus.core.metadata.IPage;
import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.example.common.AuditLog;
import com.example.common.ExcelExportUtil;
import com.example.common.PermissionUtil;
import com.example.common.Result;
import com.example.entity.Help;
import com.example.entity.User;
import com.example.exception.CustomException;
import com.example.service.HelpService;
import org.springframework.web.bind.annotation.*;

import javax.annotation.Resource;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import javax.validation.Valid;
import java.io.IOException;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/help")
public class HelpController {

    @Resource
    private HelpService helpService;

    @AuditLog(module = "救助咨询", action = "提交救助请求")
    @PostMapping
    public Result<?> save(@Valid @RequestBody Help help, HttpServletRequest request) {
        User user = (User) request.getSession().getAttribute("user");
        try {
            return Result.success(helpService.submitHelp(help, user));
        } catch (CustomException e) {
            return Result.error(e.getCode(), e.getMsg());
        }
    }

    @AuditLog(module = "救助咨询", action = "更新救助请求")
    @PutMapping
    public Result<?> update(@RequestBody Help help, HttpServletRequest request) {
        User user = (User) request.getSession().getAttribute("user");
        try {
            return Result.success(helpService.updateHelp(help, user));
        } catch (CustomException e) {
            return Result.error(e.getCode(), e.getMsg());
        }
    }

    @AuditLog(module = "救助咨询", action = "删除救助请求")
    @DeleteMapping("/{id}")
    public Result<?> delete(@PathVariable Long id) {
        try {
            return Result.success(helpService.deleteHelp(id));
        } catch (CustomException e) {
            return Result.error(e.getCode(), e.getMsg());
        }
    }

    @GetMapping("/{id}")
    public Result<Help> findById(@PathVariable Long id, HttpServletRequest request) {
        User user = (User) request.getSession().getAttribute("user");
        Help help = helpService.getById(id);
        if (help == null) {
            return Result.error("404", "记录不存在");
        }
        boolean manage = PermissionUtil.hasFlag(user, "help") || PermissionUtil.hasFlag(user, "rescue");
        if (!manage && (user == null || user.getId() == null || !user.getId().equals(help.getUid()))) {
            return Result.error("403", "只能查看自己的救助请求");
        }
        return Result.success(help);
    }

    @GetMapping
    public Result<List<Help>> findAll(HttpServletRequest request) {
        User user = (User) request.getSession().getAttribute("user");
        if (!PermissionUtil.hasFlag(user, "help") && !PermissionUtil.hasFlag(user, "rescue")) {
            return Result.error("403", "无权查看全部救助请求");
        }
        return Result.success(helpService.list(
            Wrappers.<Help>lambdaQuery()
                .ne(Help::getTitle, "聊天室消息")
                .orderByDesc(Help::getCreateTime)
        ));
    }

    @GetMapping("/page")
    public Result<IPage<Help>> findPage(@RequestParam(required = false, defaultValue = "") String name,
                                         @RequestParam(required = false, defaultValue = "1") Integer pageNum,
                                         @RequestParam(required = false, defaultValue = "10") Integer pageSize,
                                         HttpServletRequest request) {
        User user = (User) request.getSession().getAttribute("user");
        if (!PermissionUtil.hasFlag(user, "help") && !PermissionUtil.hasFlag(user, "rescue")) {
            return Result.error("403", "无权查看救助列表");
        }
        return Result.success(helpService.page(new Page<>(pageNum, pageSize),
                Wrappers.<Help>lambdaQuery()
                        .like(Help::getTitle, name)
                        .ne(Help::getTitle, "聊天室消息")
                        .orderByDesc(Help::getCreateTime)));
    }

    @GetMapping("/mine")
    public Result<List<Help>> findMine(@RequestParam Long uid, HttpServletRequest request) {
        User user = (User) request.getSession().getAttribute("user");
        if (!PermissionUtil.hasFlag(user, "help") && !PermissionUtil.hasFlag(user, "rescue") && (user == null || user.getId() == null || !user.getId().equals(uid))) {
            return Result.error("403", "只能查看自己的救助请求");
        }
        return Result.success(helpService.list(
            Wrappers.<Help>lambdaQuery()
                .eq(Help::getUid, uid)
                .ne(Help::getTitle, "聊天室消息")
                .orderByDesc(Help::getCreateTime)
        ));
    }

    @PostMapping("/chat")
    public Result<?> saveChatMessage(@RequestBody Help help, HttpServletRequest request) {
        User user = (User) request.getSession().getAttribute("user");
        if (user == null || user.getId() == null) {
            return Result.error("401", "未登录或登录已过期");
        }
        help.setUid(user.getId());
        help.setUname(user.getUsername());
        help.setTitle("聊天室消息");
        help.setLocation("在线聊天");
        help.setStatus(0);
        // 聊天不支持附件，禁止 pic 绕过 Help 绑定
        help.setPic(null);
        help.setCreateTime(new Date());
        help.setUpdateTime(new Date());
        helpService.save(help);
        return Result.success(help);
    }

    @GetMapping("/chat/history")
    public Result<List<Help>> getChatHistory() {
        return Result.success(helpService.list(
            Wrappers.<Help>lambdaQuery()
                .eq(Help::getTitle, "聊天室消息")
                .orderByAsc(Help::getCreateTime)
                .last("LIMIT 200")
        ));
    }

    @GetMapping("/export")
    public void export(HttpServletRequest request, HttpServletResponse response) throws IOException {
        User user = (User) request.getSession().getAttribute("user");
        if (!PermissionUtil.hasFlag(user, "help") && !PermissionUtil.hasFlag(user, "rescue")) {
            response.setStatus(403);
            response.setContentType("application/json;charset=UTF-8");
            response.getWriter().write("{\"code\":\"403\",\"msg\":\"无权导出救助请求\"}");
            return;
        }
        ExcelExportUtil.export(response, "救助请求", helpService.list(
                Wrappers.<Help>lambdaQuery().ne(Help::getTitle, "聊天室消息")
        ), help -> {
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("ID", help.getId());
            row.put("用户ID", help.getUid());
            row.put("用户", help.getUname());
            row.put("标题", help.getTitle());
            row.put("描述", help.getDescription());
            row.put("地点", help.getLocation());
            row.put("电话", help.getPhone());
            row.put("状态", help.getStatus());
            row.put("回复", help.getRemark());
            row.put("创建时间", help.getCreateTime());
            return row;
        });
    }
}
