package com.example.controller;
import com.example.common.PermissionUtil;
import com.example.common.Result;
import com.example.entity.User;
import com.example.service.VisitPlanService;
import jakarta.annotation.Resource;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/visit-plans")
public class VisitPlanController {
    @Resource private VisitPlanService service;
    @GetMapping("/mine") public Result<?> mine(@RequestParam(required=false) Long aid, HttpServletRequest request) {
        User user=(User)request.getSession().getAttribute("user");
        if(user==null||user.getId()==null)return Result.error("401","未登录或登录已过期");
        return Result.success(service.mine(user.getId(),aid));
    }
    @GetMapping public Result<?> all(HttpServletRequest request) {
        User user=(User)request.getSession().getAttribute("user");
        if(!PermissionUtil.hasFlag(user,"visit"))return Result.error("403","无权查看回访计划");
        return Result.success(service.list(com.baomidou.mybatisplus.core.toolkit.Wrappers.<com.example.entity.VisitPlan>lambdaQuery().orderByAsc(com.example.entity.VisitPlan::getStatus).orderByAsc(com.example.entity.VisitPlan::getDueAt).last("LIMIT 500")));
    }
}
