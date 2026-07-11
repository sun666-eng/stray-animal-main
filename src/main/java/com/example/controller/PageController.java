package com.example.controller;

import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;

@Controller
public class PageController {

    @GetMapping({"/", "/page/end", "/page/end/"})
    public String adminEntry() {
        return "redirect:/page/end/index.html";
    }

    @GetMapping({"/page/front", "/page/front/"})
    public String frontEntry() {
        return "redirect:/page/front/animal_browse.html";
    }
}
