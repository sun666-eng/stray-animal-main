package com.example.controller;

import com.example.common.AuditLog;
import com.example.common.Result;
import com.example.entity.User;
import com.example.exception.CustomException;
import com.example.service.PetCareService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import jakarta.annotation.Resource;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.util.List;

/**
 * AI 动物照顾助手（DELIVERY-PLAN.md §三）：登录用户询问动物照顾注意事项与方式方法。
 * 与业务数据完全解耦；限流与话题边界在 PetCareService。
 */
@RestController
@RequestMapping("/api/petcare")
public class PetCareController {

    @Resource
    private PetCareService petCareService;

    @GetMapping("/topics")
    public Result<List<String>> topics() {
        return Result.success(petCareService.quickQuestions());
    }

    @AuditLog(module = "照顾助手", action = "提问")
    @PostMapping("/ask")
    public Result<PetCareService.PetCareAnswer> ask(@Valid @RequestBody AskRequest body,
                                                    HttpServletRequest request) {
        User user = (User) request.getSession().getAttribute("user");
        if (user == null || user.getId() == null) {
            throw new CustomException("401", "未登录或登录已过期");
        }
        return Result.success(petCareService.ask(user.getId(), body.getQuestion()));
    }

    public static class AskRequest {
        @NotBlank(message = "请输入你的问题")
        @Size(max = 500, message = "问题不能超过 500 字")
        private String question;

        public String getQuestion() { return question; }
        public void setQuestion(String question) { this.question = question; }
    }
}
