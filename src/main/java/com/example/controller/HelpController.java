package com.example.controller;

import com.baomidou.mybatisplus.core.metadata.IPage;
import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.example.common.AuditLog;
import com.example.common.ExcelExportUtil;
import com.example.common.PermissionUtil;
import com.example.common.Result;
import com.example.dto.ChatMessageDTO;
import com.example.dto.ChatMessageRequest;
import com.example.dto.HelpManageRequest;
import com.example.entity.Help;
import com.example.entity.User;
import com.example.exception.CustomException;
import com.example.service.HelpService;
import org.springframework.web.bind.annotation.*;

import jakarta.annotation.Resource;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import java.io.IOException;
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

    @AuditLog(module = "救助咨询", action = "更新救助处理结果")
    @PutMapping("/{id}/manage")
    public Result<?> manage(@PathVariable Long id, @Valid @RequestBody HelpManageRequest body,
                            HttpServletRequest request) {
        User user = (User) request.getSession().getAttribute("user");
        if (!PermissionUtil.hasFlag(user, "help") && !PermissionUtil.hasFlag(user, "rescue")) {
            throw new CustomException("403", "无权处理救助请求");
        }
        return Result.success(helpService.manageHelp(id, body, user));
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
        if (HelpService.CHAT_TITLE.equals(help.getTitle())) {
            return Result.error("404", "记录不存在");
        }
        boolean manage = PermissionUtil.hasFlag(user, "help") || PermissionUtil.hasFlag(user, "rescue");
        if (!manage && (user == null || user.getId() == null || !user.getId().equals(help.getUid()))) {
            return Result.error("403", "只能查看自己的救助请求");
        }
        return Result.success(help);
    }

    @GetMapping
    public Result<IPage<Help>> findAll(@RequestParam(required = false, defaultValue = "1") Integer pageNum,
                                       @RequestParam(required = false, defaultValue = "10") Integer pageSize,
                                       HttpServletRequest request) {
        User user = (User) request.getSession().getAttribute("user");
        if (!PermissionUtil.hasFlag(user, "help") && !PermissionUtil.hasFlag(user, "rescue")) {
            return Result.error("403", "无权查看全部救助请求");
        }
        long safePageNum = pageNum == null ? 1 : Math.min(10_000, Math.max(1, pageNum));
        long safePageSize = pageSize == null ? 10 : Math.max(1, Math.min(50, pageSize));
        return Result.success(helpService.page(new Page<>(safePageNum, safePageSize),
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
        long safePageNum = pageNum == null ? 1 : Math.min(10_000, Math.max(1, pageNum));
        long safePageSize = pageSize == null ? 10 : Math.max(1, Math.min(50, pageSize));
        String keyword = name == null ? "" : name.trim();
        if (keyword.length() > 100) {
            return Result.error("400", "查询关键词不能超过100个字符");
        }
        // 空关键词不拼 LIKE，避免 LIKE '%%' 全表扫描
        return Result.success(helpService.page(new Page<>(safePageNum, safePageSize),
                Wrappers.<Help>lambdaQuery()
                        .like(!keyword.isEmpty(), Help::getTitle, keyword)
                        .ne(Help::getTitle, "聊天室消息")
                        .orderByDesc(Help::getCreateTime)));
    }

    @GetMapping("/mine")
    public Result<IPage<Help>> findMine(@RequestParam(required = false) Long uid,
                                        @RequestParam(required = false, defaultValue = "1") Integer pageNum,
                                        @RequestParam(required = false, defaultValue = "10") Integer pageSize,
                                        HttpServletRequest request) {
        User user = (User) request.getSession().getAttribute("user");
        if (uid == null && user != null) {
            uid = user.getId();
        }
        if (!PermissionUtil.hasFlag(user, "help") && !PermissionUtil.hasFlag(user, "rescue") && (user == null || user.getId() == null || !user.getId().equals(uid))) {
            return Result.error("403", "只能查看自己的救助请求");
        }
        long safePageNum = pageNum == null ? 1 : Math.min(10_000, Math.max(1, pageNum));
        long safePageSize = pageSize == null ? 10 : Math.max(1, Math.min(50, pageSize));
        return Result.success(helpService.page(new Page<>(safePageNum, safePageSize),
            Wrappers.<Help>lambdaQuery()
                .eq(Help::getUid, uid)
                .ne(Help::getTitle, "聊天室消息")
                .orderByDesc(Help::getCreateTime)
        ));
    }

    @PostMapping("/chat")
    public Result<ChatMessageDTO> saveChatMessage(@Valid @RequestBody ChatMessageRequest message,
                                                   HttpServletRequest request) {
        User user = (User) request.getSession().getAttribute("user");
        return Result.success(helpService.submitChatMessage(message.getText(), user));
    }

    @GetMapping("/chat/history")
    public Result<List<ChatMessageDTO>> getChatHistory() {
        return Result.success(helpService.getChatHistory());
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
        List<Help> rows = helpService.list(Wrappers.<Help>lambdaQuery()
                .ne(Help::getTitle, "聊天室消息")
                .orderByDesc(Help::getCreateTime)
                .last("LIMIT " + (ExcelExportUtil.MAX_EXPORT_ROWS + 1)));
        ExcelExportUtil.export(response, "救助请求", rows, help -> {
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
