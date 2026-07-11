package com.example.controller;

import com.example.common.AuditLog;
import com.example.common.ExcelExportUtil;
import com.example.common.Result;
import com.example.entity.Notice;
import com.example.service.NoticeService;
import com.baomidou.mybatisplus.core.metadata.IPage;
import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import org.springframework.web.bind.annotation.*;

import javax.annotation.Resource;
import javax.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/notice")
public class NoticeController {
    @Resource
    private NoticeService noticeService;

    @AuditLog(module = "公告管理", action = "新增公告")
    @PostMapping
    public Result<?> save(@RequestBody Notice notice) {
        return Result.success(noticeService.save(notice));
    }

    @AuditLog(module = "公告管理", action = "更新公告")
    @PutMapping
    public Result<?> update(@RequestBody Notice notice) {
        return Result.success(noticeService.updateById(notice));
    }

    @AuditLog(module = "公告管理", action = "删除公告")
    @DeleteMapping("/{id}")
    public Result<?> delete(@PathVariable Long id) {
        noticeService.removeById(id);
        return Result.success();
    }

    @GetMapping("/{id}")
    public Result<Notice> findById(@PathVariable Long id) {
        return Result.success(noticeService.getById(id));
    }

    @GetMapping
    public Result<List<Notice>> findAll() {
        return Result.success(noticeService.list());
    }

    @GetMapping("/page")
    public Result<IPage<Notice>> findPage(@RequestParam(required = false, defaultValue = "") String name,
                                                @RequestParam(required = false, defaultValue = "1") Integer pageNum,
                                                @RequestParam(required = false, defaultValue = "10") Integer pageSize) {
        return Result.success(noticeService.page(new Page<>(pageNum, pageSize), Wrappers.<Notice>lambdaQuery().like(Notice::getTitle, name)));
    }

    @GetMapping("/export")
    public void export(HttpServletResponse response) throws IOException {
        ExcelExportUtil.export(response, "通知公告", noticeService.list(), notice -> {
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("ID", notice.getId());
            row.put("标题", notice.getTitle());
            row.put("内容", notice.getContent());
            return row;
        });
    }

}
