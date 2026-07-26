package com.example.controller;

import com.example.common.AuditLog;
import com.example.common.ExcelExportUtil;
import com.example.common.Result;
import com.example.entity.Notice;
import com.example.service.NoticeService;
import com.example.exception.CustomException;
import com.baomidou.mybatisplus.core.metadata.IPage;
import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import org.springframework.web.bind.annotation.*;

import jakarta.annotation.Resource;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/notice")
public class NoticeController {
    private static final int MAX_PAGE_NUM = 10000;
    private static final int MAX_PAGE_SIZE = 50;
    private static final int MAX_QUERY_LENGTH = 100;
    private static final int MAX_EXPORT_ROWS = 10000;
    private static final int EXPORT_PROBE_ROWS = MAX_EXPORT_ROWS + 1;
    @Resource
    private NoticeService noticeService;

    @AuditLog(module = "公告管理", action = "新增公告")
    @PostMapping
    public Result<?> save(@RequestBody Notice notice) {
        return Result.success(noticeService.saveNotice(notice));
    }

    @AuditLog(module = "公告管理", action = "更新公告")
    @PutMapping
    public Result<?> update(@RequestBody Notice notice) {
        return Result.success(noticeService.updateNotice(notice));
    }

    @AuditLog(module = "公告管理", action = "删除公告")
    @DeleteMapping("/{id}")
    public Result<?> delete(@PathVariable Long id) {
        return Result.success(noticeService.deleteNotice(id));
    }

    @GetMapping("/{id}")
    public Result<Notice> findById(@PathVariable Long id) {
        Notice notice = noticeService.getById(id);
        if (notice == null) return Result.error("404", "公告不存在");
        return Result.success(notice);
    }

    @GetMapping
    public Result<List<Notice>> findAll() {
        return Result.success(noticeService.list(Wrappers.<Notice>lambdaQuery()
                .orderByDesc(Notice::getId).last("LIMIT " + MAX_EXPORT_ROWS)));
    }

    @GetMapping("/page")
    public Result<IPage<Notice>> findPage(@RequestParam(required = false, defaultValue = "") String name,
                                                @RequestParam(required = false, defaultValue = "1") Integer pageNum,
                                                @RequestParam(required = false, defaultValue = "10") Integer pageSize) {
        String keyword = safeQuery(name);
        return Result.success(noticeService.page(new Page<>(safePageNum(pageNum), safePageSize(pageSize)),
                Wrappers.<Notice>lambdaQuery().like(!keyword.isEmpty(), Notice::getTitle, keyword)
                        .orderByDesc(Notice::getId)));
    }

    @AuditLog(module = "公告管理", action = "导出公告")
    @GetMapping("/export")
    public void export(jakarta.servlet.http.HttpServletRequest request, HttpServletResponse response) throws IOException {
        com.example.entity.User user = (com.example.entity.User) request.getSession().getAttribute("user");
        if (!com.example.common.PermissionUtil.hasFlag(user, "notice")) {
            response.setStatus(403);
            response.setContentType("application/json;charset=UTF-8");
            response.getWriter().write("{\"code\":\"403\",\"msg\":\"无权导出公告\"}");
            return;
        }
        long count = noticeService.count();
        if (count > MAX_EXPORT_ROWS) {
            throw exportLimitException(count);
        }
        List<Notice> rows = noticeService.list(Wrappers.<Notice>lambdaQuery()
                .orderByDesc(Notice::getId).last("LIMIT " + EXPORT_PROBE_ROWS));
        if (rows.size() > MAX_EXPORT_ROWS) {
            throw exportLimitException(rows.size());
        }
        ExcelExportUtil.export(response, "通知公告", rows, notice -> {
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("ID", notice.getId());
            row.put("标题", notice.getTitle());
            row.put("内容", notice.getContent());
            return row;
        });
    }

    private CustomException exportLimitException(long count) {
        return new CustomException("413", "导出记录数" + count
                + "超过上限" + MAX_EXPORT_ROWS + "，请缩小数据范围");
    }

    private int safePageNum(Integer value) {
        if (value == null || value < 1) return 1;
        return Math.min(value, MAX_PAGE_NUM);
    }

    private int safePageSize(Integer value) {
        if (value == null || value < 1) return 10;
        return Math.min(value, MAX_PAGE_SIZE);
    }

    private String safeQuery(String value) {
        String normalized = value == null ? "" : value.trim();
        if (normalized.length() > MAX_QUERY_LENGTH) {
            throw new CustomException("400", "查询关键词不能超过" + MAX_QUERY_LENGTH + "个字符");
        }
        return normalized;
    }

}
