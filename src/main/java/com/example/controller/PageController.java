package com.example.controller;

import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;

@Controller
public class PageController {

    /** 站点根路径进入用户端首页（公开浏览），避免误进旧管理端 */
    @GetMapping({"/"})
    public String siteRoot() {
        return "redirect:/page/front/animal_browse.html";
    }

    @GetMapping({"/page/end", "/page/end/"})
    public String adminEntry() {
        return "redirect:/page/end/index.html";
    }

    @GetMapping({"/page/front", "/page/front/"})
    public String frontEntry() {
        return "redirect:/page/front/animal_browse.html";
    }
}
