package com.example.controller;

import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;

import jakarta.servlet.http.HttpServletRequest;

@Controller
public class PageController {

    /** 站点根路径：公众品牌首页。登录后的工作台仍使用 /page/end/index.html。 */
    @GetMapping({"/"})
    public String siteRoot() {
        return "redirect:/page/front/index.html";
    }

    /**
     * 兼容旧书签 /page/end/login.html：已删除独立管理端登录页，统一到 front 登录。
     * 需在 WebMvcConfig 中 exclude，避免被鉴权拦截器拦截。
     */
    @GetMapping({"/page/end/login.html", "/page/end/login"})
    public String legacyAdminLogin(HttpServletRequest request) {
        String q = request.getQueryString();
        if (q != null && !q.isEmpty()) {
            return "redirect:/page/front/login.html?" + q;
        }
        return "redirect:/page/front/login.html";
    }

    @GetMapping({"/page/end", "/page/end/"})
    public String adminEntry() {
        return "redirect:/page/end/index.html";
    }

    @GetMapping({"/page/front", "/page/front/"})
    public String frontEntry() {
        return "redirect:/page/front/index.html";
    }

    @GetMapping("/prototype.html")
    public String prototypeEntry() {
        return "redirect:/page/front/index.html";
    }
}
