package com.example.controller;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.core.metadata.IPage;
import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.example.common.AuditLog;
import com.example.common.ExcelExportUtil;
import com.example.common.PermissionUtil;
import com.example.common.Result;
import com.example.entity.Adopt;
import com.example.entity.User;
import com.example.service.AdoptService;
import org.springframework.web.bind.annotation.*;

import javax.annotation.Resource;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/adopt")
public class AdoptController {
    @Resource
      private AdoptService adoptService;

    @AuditLog(module = "领养管理", action = "提交领养申请")
    @PostMapping
    public Result<?> save(@RequestBody Adopt adopt, HttpServletRequest request) {
        User user = (User) request.getSession().getAttribute("user");
        return Result.success(adoptService.submitAdopt(adopt, user, PermissionUtil.hasFlag(user, "adopt")));
    }

    @AuditLog(module = "领养管理", action = "更新领养申请")
    @PutMapping("/{aid}/{uid}")
    public Result<?> update(@RequestBody Adopt adopt,@PathVariable Long aid,@PathVariable Long uid) {
        QueryWrapper<Adopt> queryWrapper = new QueryWrapper<>();
        queryWrapper.eq("aid", aid);
        queryWrapper.eq("uid", uid);
        return Result.success(adoptService.update(adopt,queryWrapper));
    }

    @AuditLog(module = "领养管理", action = "删除领养申请")
    @DeleteMapping("/{aid}/{uid}")
    public Result<?> delete(@PathVariable Long aid,@PathVariable Long uid) {
        return Result.success(adoptService.deleteAdopt(aid, uid));
    }

    @AuditLog(module = "领养管理", action = "审核领养申请")
    @PutMapping("/audit/{aid}/{uid}/{state}")
    public Result<?> audit(@PathVariable Long aid, @PathVariable Long uid, @PathVariable Integer state) {
        return Result.success(adoptService.auditAdopt(aid, uid, state));
    }
    @GetMapping("/{aid}/{uid}")
    public Result<?> findByBoth(@PathVariable Long aid,@PathVariable Long uid) {

        QueryWrapper<Adopt> queryWrapper = new QueryWrapper<>();
        queryWrapper.eq("aid", aid);
        queryWrapper.eq("uid", uid);
        return Result.success(adoptService.list(queryWrapper));
    }


    @GetMapping
    public Result<List<Adopt>> findAll() {
        return Result.success(adoptService.list());
    }

    @GetMapping("/page")
    public Result<IPage<Adopt>> findPage(@RequestParam(required = false, defaultValue = "") String name,
                                           @RequestParam(required = false, defaultValue = "1") Integer pageNum,
                                           @RequestParam(required = false, defaultValue = "10") Integer pageSize) {
        return Result.success(adoptService.page(new Page<>(pageNum, pageSize), Wrappers.<Adopt>lambdaQuery().like(Adopt::getAname, name)));
    }
    @GetMapping("/page1")
    public Result<IPage<Adopt>> findPage1(@RequestParam(required = false, defaultValue = "") String name,
                                         @RequestParam(required = false, defaultValue = "1") Integer pageNum,
                                         @RequestParam(required = false, defaultValue = "10") Integer pageSize) {

        return Result.success(adoptService.page(new Page<>(pageNum, pageSize), Wrappers.<Adopt>lambdaQuery().like(Adopt::getUname, name)));
    }
    @GetMapping("/page2")
    public Result<IPage<Adopt>> findPage2(@RequestParam(required = false, defaultValue = "") String name,
                                          @RequestParam(required = false, defaultValue = "1") Integer pageNum,
                                          @RequestParam(required = false, defaultValue = "10") Integer pageSize,
                                          @RequestParam Long uid,
                                          HttpServletRequest request) {
        User user = (User) request.getSession().getAttribute("user");
        if (!PermissionUtil.hasFlag(user, "adopt") && (user == null || user.getId() == null || !user.getId().equals(uid))) {
            return Result.error("403", "只能查看自己的领养申请");
        }

        return Result.success(adoptService.page(new Page<>(pageNum, pageSize), Wrappers.<Adopt>lambdaQuery().like(Adopt::getAid, name).eq(Adopt::getUid,uid)));
    }

    @GetMapping("/export")
    public void export(HttpServletResponse response) throws IOException {
        ExcelExportUtil.export(response, "领养申请", adoptService.list(), adopt -> {
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("动物ID", adopt.getAid());
            row.put("用户ID", adopt.getUid());
            row.put("动物名称", adopt.getAname());
            row.put("申请人", adopt.getUname());
            row.put("性别", adopt.getGender());
            row.put("年龄", adopt.getAge());
            row.put("电话", adopt.getTel());
            row.put("微信", adopt.getWechat());
            row.put("职业", adopt.getOccupation());
            row.put("住址", adopt.getLocation());
            row.put("审核状态", adopt.getVstate());
            return row;
        });
    }
}
