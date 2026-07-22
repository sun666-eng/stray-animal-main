package com.example.controller;

import com.example.common.Result;
import com.example.common.PermissionUtil;
import com.example.entity.Proof;
import com.example.entity.User;
import com.example.exception.CustomException;
import com.example.service.ProofService;
import com.baomidou.mybatisplus.core.metadata.IPage;
import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.example.common.ExcelExportUtil;
import org.springframework.web.bind.annotation.*;

import javax.annotation.Resource;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/proof")
public class ProofController {
    @Resource
    private ProofService proofService;

    @PostMapping
    public Result<?> save(@RequestBody Proof proof, HttpServletRequest request) {
        User user = (User) request.getSession().getAttribute("user");
        try {
            return Result.success(proofService.submitProof(proof, user, PermissionUtil.hasFlag(user, "proof")));
        } catch (CustomException e) {
            return Result.error(e.getCode(), e.getMsg());
        }
    }

    @PutMapping
    public Result<?> update(@RequestBody Proof proof, HttpServletRequest request) {
        User user = (User) request.getSession().getAttribute("user");
        try {
            return Result.success(proofService.updateProof(proof, user, PermissionUtil.hasFlag(user, "proof")));
        } catch (CustomException e) {
            return Result.error(e.getCode(), e.getMsg());
        }
    }

    @PutMapping("/audit/{id}/{state}")
    public Result<?> audit(@PathVariable Long id, @PathVariable Integer state, HttpServletRequest request) {
        User user = (User) request.getSession().getAttribute("user");
        if (!PermissionUtil.hasFlag(user, "proof")) {
            return Result.error("403", "无权审核凭证");
        }
        try {
            return Result.success(proofService.auditProof(id, state));
        } catch (CustomException e) {
            return Result.error(e.getCode(), e.getMsg());
        }
    }

    @DeleteMapping("/{id}")
    public Result<?> delete(@PathVariable Long id, HttpServletRequest request) {
        User user = (User) request.getSession().getAttribute("user");
        try {
            // 授权与状态校验在同一 Service 事务内（防 TOCTOU）
            return Result.success(proofService.deleteProof(id, user, PermissionUtil.hasFlag(user, "proof")));
        } catch (CustomException e) {
            return Result.error(e.getCode(), e.getMsg());
        }
    }

    @GetMapping("/{id}")
    public Result<Proof> findById(@PathVariable Long id, HttpServletRequest request) {
        User user = (User) request.getSession().getAttribute("user");
        Proof proof = proofService.getById(id);
        if (proof == null) {
            return Result.error("404", "凭证不存在");
        }
        if (!PermissionUtil.hasFlag(user, "proof")
                && (user == null || user.getId() == null || !user.getId().equals(proof.getPuid()))) {
            return Result.error("403", "只能查看自己的凭证");
        }
        return Result.success(proof);
    }

    /**
     * 校验归属；已通过的凭证禁止普通用户改删。
     */
    private Result<?> verifyOwnerMutable(Long proofId, HttpServletRequest request) {
        User user = (User) request.getSession().getAttribute("user");
        if (user == null || user.getId() == null) {
            return Result.error("401", "未登录或登录已过期");
        }
        if (PermissionUtil.hasFlag(user, "proof")) {
            return null;
        }
        Proof existing = proofId == null ? null : proofService.getById(proofId);
        if (existing == null) {
            return Result.error("404", "凭证不存在");
        }
        if (!user.getId().equals(existing.getPuid())) {
            return Result.error("403", "只能修改或删除自己的凭证");
        }
        try {
            proofService.assertMutableByOwner(existing);
        } catch (CustomException e) {
            return Result.error(e.getCode(), e.getMsg());
        }
        return null;
    }

    @GetMapping
    public Result<List<Proof>> findAll(HttpServletRequest request) {
        User user = (User) request.getSession().getAttribute("user");
        if (!PermissionUtil.hasFlag(user, "proof")) {
            return Result.error("403", "无权查看全部凭证");
        }
        return Result.success(proofService.list());
    }

    @GetMapping("/page")
    public Result<IPage<Proof>> findPage(@RequestParam(required = false, defaultValue = "") String name,
                                           @RequestParam(required = false, defaultValue = "1") Integer pageNum,
                                           @RequestParam(required = false, defaultValue = "10") Integer pageSize,
                                           HttpServletRequest request) {
        User user = (User) request.getSession().getAttribute("user");
        if (!PermissionUtil.hasFlag(user, "proof")) {
            return Result.error("403", "无权查看凭证列表");
        }
        return Result.success(proofService.page(new Page<>(pageNum, pageSize), Wrappers.<Proof>lambdaQuery().like(Proof::getUname, name)));
    }

    @GetMapping("/page1")
    public Result<IPage<Proof>> findPage1(@RequestParam(required = false, defaultValue = "") String name,
                                         @RequestParam(required = false, defaultValue = "1") Integer pageNum,
                                         @RequestParam(required = false, defaultValue = "10") Integer pageSize,
                                          @RequestParam Long uid,
                                          HttpServletRequest request) {
        User user = (User) request.getSession().getAttribute("user");
        if (!PermissionUtil.hasFlag(user, "proof") && (user == null || user.getId() == null || !user.getId().equals(uid))) {
            return Result.error("403", "只能查看自己的凭证");
        }
        return Result.success(proofService.page(new Page<>(pageNum, pageSize), Wrappers.<Proof>lambdaQuery().eq(Proof::getPuid, uid)));
    }

    @GetMapping("/export")
    public void export(HttpServletRequest request, HttpServletResponse response) throws IOException {
        User user = (User) request.getSession().getAttribute("user");
        if (!PermissionUtil.hasFlag(user, "proof")) {
            response.setStatus(403);
            response.setContentType("application/json;charset=UTF-8");
            response.getWriter().write("{\"code\":\"403\",\"msg\":\"无权导出凭证\"}");
            return;
        }
        ExcelExportUtil.export(response, "领养凭证", proofService.list(), proof -> {
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("ID", proof.getId());
            row.put("领养动物ID", proof.getPaid());
            row.put("用户ID", proof.getPuid());
            row.put("动物名称", proof.getAname());
            row.put("用户名称", proof.getUname());
            row.put("凭证标题", proof.getPtitle());
            row.put("凭证图片", proof.getPpic());
            row.put("审核状态", proof.getPstatus());
            return row;
        });
    }
}
