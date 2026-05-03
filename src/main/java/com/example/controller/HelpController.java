package com.example.controller;

import com.baomidou.mybatisplus.core.metadata.IPage;
import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.example.common.AuditLog;
import com.example.common.Result;
import com.example.entity.Help;
import com.example.service.HelpService;
import org.springframework.web.bind.annotation.*;

import javax.annotation.Resource;
import javax.validation.Valid;
import java.util.Date;
import java.util.List;

@RestController
@RequestMapping("/api/help")
public class HelpController {

    @Resource
    private HelpService helpService;

    @AuditLog(module = "救助咨询", action = "提交救助请求")
    @PostMapping
    public Result<?> save(@Valid @RequestBody Help help) {
        if (help.getStatus() == null) {
            help.setStatus(0);
        }
        help.setCreateTime(new Date());
        help.setUpdateTime(new Date());
        return Result.success(helpService.save(help));
    }

    @AuditLog(module = "救助咨询", action = "更新救助请求")
    @PutMapping
    public Result<?> update(@RequestBody Help help) {
        help.setUpdateTime(new Date());
        return Result.success(helpService.updateById(help));
    }

    @AuditLog(module = "救助咨询", action = "删除救助请求")
    @DeleteMapping("/{id}")
    public Result<?> delete(@PathVariable Long id) {
        helpService.removeById(id);
        return Result.success();
    }

    @GetMapping("/{id}")
    public Result<Help> findById(@PathVariable Long id) {
        return Result.success(helpService.getById(id));
    }

    @GetMapping
    public Result<List<Help>> findAll() {
        return Result.success(helpService.list(
            Wrappers.<Help>lambdaQuery()
                .ne(Help::getTitle, "聊天室消息")
                .orderByDesc(Help::getCreateTime)
        ));
    }

    @GetMapping("/page")
    public Result<IPage<Help>> findPage(@RequestParam(required = false, defaultValue = "") String name,
                                         @RequestParam(required = false, defaultValue = "1") Integer pageNum,
                                         @RequestParam(required = false, defaultValue = "10") Integer pageSize) {
        return Result.success(helpService.page(new Page<>(pageNum, pageSize),
                Wrappers.<Help>lambdaQuery().like(Help::getTitle, name).orderByDesc(Help::getCreateTime)));
    }

    @GetMapping("/mine")
    public Result<List<Help>> findMine(@RequestParam Long uid) {
        return Result.success(helpService.list(
            Wrappers.<Help>lambdaQuery()
                .eq(Help::getUid, uid)
                .ne(Help::getTitle, "聊天室消息")
                .orderByDesc(Help::getCreateTime)
        ));
    }

    @PostMapping("/chat")
    public Result<?> saveChatMessage(@RequestBody Help help) {
        help.setTitle("聊天室消息");
        help.setLocation("在线聊天");
        help.setStatus(0);
        help.setCreateTime(new Date());
        help.setUpdateTime(new Date());
        return Result.success(helpService.save(help));
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
}
