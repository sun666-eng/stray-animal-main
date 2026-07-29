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
import com.example.dto.AdoptTransitionRequest;
import com.example.exception.CustomException;
import com.example.service.AdoptService;
import org.springframework.web.bind.annotation.*;

import jakarta.annotation.Resource;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/adopt")
public class AdoptController {
    private static final int MAX_PAGE_NUM = 10000;
    private static final int MAX_PAGE_SIZE = 50;
    private static final int MAX_QUERY_LENGTH = 100;
    private static final int MAX_EXPORT_ROWS = 10000;
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
    public Result<?> update(@RequestBody Adopt adopt, @PathVariable Long aid, @PathVariable Long uid,
                            HttpServletRequest request) {
        // B6：禁止通过通用 PUT 直接改 vstate；审核必须走 /audit
        if (adopt != null && adopt.getVstate() != null) {
            return Result.error("400", "审核状态请使用专用审核接口 /api/adopt/audit/{aid}/{uid}/{state}");
        }
        User user = (User) request.getSession().getAttribute("user");
        if (!PermissionUtil.hasFlag(user, "adopt")
                && (user == null || user.getId() == null || !user.getId().equals(uid))) {
            return Result.error("403", "只能修改自己的领养申请");
        }
        return Result.success(adoptService.updateAdopt(
                aid, uid, adopt, user, PermissionUtil.hasFlag(user, "adopt")));
    }

    @AuditLog(module = "领养管理", action = "删除领养申请")
    @DeleteMapping("/{aid}/{uid}")
    public Result<?> delete(@PathVariable Long aid,@PathVariable Long uid) {
        return Result.success(adoptService.deleteAdopt(aid, uid));
    }

    @AuditLog(module = "领养管理", action = "审核领养申请")
    @PutMapping("/audit/{aid}/{uid}/{state}")
    public Result<?> audit(@PathVariable Long aid, @PathVariable Long uid, @PathVariable Integer state,
                           HttpServletRequest request) {
        User user = (User) request.getSession().getAttribute("user");
        if (!PermissionUtil.hasFlag(user, "adopt")) return Result.error("403", "无权审核领养申请");
        String action = Integer.valueOf(1).equals(state) ? "APPROVE" : "REJECT";
        return Result.success(adoptService.transition(aid, uid, action,
                Integer.valueOf(1).equals(state) ? "管理员审核通过" : "管理员审核驳回",
                null, null, user, true, "ADMIN"));
    }

    @AuditLog(module = "领养管理", action = "转换领养状态")
    @PostMapping("/{aid}/{uid}/transition")
    public Result<?> transition(@PathVariable Long aid, @PathVariable Long uid,
                                @RequestBody AdoptTransitionRequest body,
                                HttpServletRequest request) {
        User user = (User) request.getSession().getAttribute("user");
        boolean manager = PermissionUtil.hasFlag(user, "adopt");
        return Result.success(adoptService.transition(aid, uid,
                body == null ? null : body.getAction(), body == null ? null : body.getReason(),
                body == null ? null : body.getNote(), body == null ? null : body.getExpectedVersion(),
                user, manager, manager ? "ADMIN" : "USER"));
    }

    @GetMapping("/{aid}/{uid}/timeline")
    public Result<?> timeline(@PathVariable Long aid, @PathVariable Long uid, HttpServletRequest request) {
        User user = (User) request.getSession().getAttribute("user");
        return Result.success(adoptService.timeline(aid, uid, user, PermissionUtil.hasFlag(user, "adopt")));
    }
    @GetMapping("/{aid}/{uid}")
    public Result<?> findByBoth(@PathVariable Long aid, @PathVariable Long uid, HttpServletRequest request) {
        User user = (User) request.getSession().getAttribute("user");
        if (!PermissionUtil.hasFlag(user, "adopt")
                && (user == null || user.getId() == null || !user.getId().equals(uid))) {
            return Result.error("403", "只能查看自己的领养申请");
        }
        QueryWrapper<Adopt> queryWrapper = new QueryWrapper<>();
        queryWrapper.eq("aid", aid);
        queryWrapper.eq("uid", uid);
        return Result.success(adoptService.list(queryWrapper));
    }

    @GetMapping("/mine/{aid}")
    public Result<Adopt> findMine(@PathVariable Long aid, HttpServletRequest request) {
        User user = (User) request.getSession().getAttribute("user");
        if (user == null || user.getId() == null) {
            return Result.error("401", "未登录或登录已过期");
        }
        Adopt adopt = adoptService.getOne(Wrappers.<Adopt>lambdaQuery()
                .eq(Adopt::getAid, aid)
                .eq(Adopt::getUid, user.getId()), false);
        if (adopt == null) {
            return Result.error("404", "领养申请不存在");
        }
        return Result.success(adopt);
    }


    @GetMapping
    public Result<List<Adopt>> findAll(HttpServletRequest request) {
        User user = (User) request.getSession().getAttribute("user");
        if (!PermissionUtil.hasFlag(user, "adopt")) {
            return Result.error("403", "无权查看全部领养申请");
        }
        return Result.success(adoptService.list(Wrappers.<Adopt>lambdaQuery()
                .orderByDesc(Adopt::getAid).orderByDesc(Adopt::getUid).last("LIMIT " + MAX_EXPORT_ROWS)));
    }

    @GetMapping("/page")
    public Result<IPage<Adopt>> findPage(@RequestParam(required = false, defaultValue = "") String name,
                                           @RequestParam(required = false, defaultValue = "1") Integer pageNum,
                                           @RequestParam(required = false, defaultValue = "10") Integer pageSize,
                                           HttpServletRequest request) {
        User user = (User) request.getSession().getAttribute("user");
        if (!PermissionUtil.hasFlag(user, "adopt")) {
            return Result.error("403", "无权查看领养列表");
        }
        String keyword = safeQuery(name);
        return Result.success(adoptService.page(new Page<>(safePageNum(pageNum), safePageSize(pageSize)),
                Wrappers.<Adopt>lambdaQuery().like(!keyword.isEmpty(), Adopt::getAname, keyword)
                        .orderByDesc(Adopt::getAid).orderByDesc(Adopt::getUid)));
    }
    @GetMapping("/page1")
    public Result<IPage<Adopt>> findPage1(@RequestParam(required = false, defaultValue = "") String name,
                                         @RequestParam(required = false, defaultValue = "1") Integer pageNum,
                                         @RequestParam(required = false, defaultValue = "10") Integer pageSize,
                                         HttpServletRequest request) {
        User user = (User) request.getSession().getAttribute("user");
        if (!PermissionUtil.hasFlag(user, "adopt")) {
            return Result.error("403", "无权查看领养列表");
        }
        String keyword = safeQuery(name);
        return Result.success(adoptService.page(new Page<>(safePageNum(pageNum), safePageSize(pageSize)),
                Wrappers.<Adopt>lambdaQuery().like(!keyword.isEmpty(), Adopt::getUname, keyword)
                        .orderByDesc(Adopt::getAid).orderByDesc(Adopt::getUid)));
    }
    @GetMapping("/page2")
    public Result<IPage<Adopt>> findPage2(@RequestParam(required = false, defaultValue = "") String name,
                                          @RequestParam(required = false, defaultValue = "1") Integer pageNum,
                                          @RequestParam(required = false, defaultValue = "10") Integer pageSize,
                                           @RequestParam(required = false) Long uid,
                                          HttpServletRequest request) {
        User user = (User) request.getSession().getAttribute("user");
        if (user == null || user.getId() == null) return Result.error("401", "未登录或登录已过期");
        Long targetUid = PermissionUtil.hasFlag(user, "adopt") && uid != null ? uid : user.getId();
        String keyword = safeQuery(name);
        return Result.success(adoptService.page(new Page<>(safePageNum(pageNum), safePageSize(pageSize)),
                // 关键词按动物名匹配；aid 是数字主键，LIKE 语义错误且无法走索引
                Wrappers.<Adopt>lambdaQuery().like(!keyword.isEmpty(), Adopt::getAname, keyword)
                        .eq(Adopt::getUid, targetUid).orderByDesc(Adopt::getAid)));
    }

    @GetMapping("/export")
    public void export(HttpServletRequest request, HttpServletResponse response) throws IOException {
        User user = (User) request.getSession().getAttribute("user");
        if (!PermissionUtil.hasFlag(user, "adopt")) {
            response.setStatus(403);
            response.setContentType("application/json;charset=UTF-8");
            response.getWriter().write("{\"code\":\"403\",\"msg\":\"无权导出领养申请\"}");
            return;
        }
        List<Adopt> rows = adoptService.list(Wrappers.<Adopt>lambdaQuery()
                .orderByDesc(Adopt::getAid).orderByDesc(Adopt::getUid).last("LIMIT " + (MAX_EXPORT_ROWS + 1)));
        if (rows.size() > MAX_EXPORT_ROWS) throw new CustomException("413", "导出记录超过上限" + MAX_EXPORT_ROWS);
        ExcelExportUtil.export(response, "领养申请", rows, adopt -> {
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

    private int safePageNum(Integer value) { return value == null || value < 1 ? 1 : Math.min(value, MAX_PAGE_NUM); }
    private int safePageSize(Integer value) { return value == null || value < 1 ? 10 : Math.min(value, MAX_PAGE_SIZE); }
    private String safeQuery(String value) {
        String normalized = value == null ? "" : value.trim();
        if (normalized.length() > MAX_QUERY_LENGTH) throw new CustomException("400", "查询关键词不能超过100个字符");
        return normalized;
    }
}
