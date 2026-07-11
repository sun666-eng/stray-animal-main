package com.example.controller;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.example.common.Result;
import com.example.entity.Volunteer;
import com.example.service.AdoptService;
import com.example.service.AnimalService;
import com.example.service.UserService;
import com.example.service.VolunteerService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import javax.annotation.Resource;
import java.util.LinkedHashMap;
import java.util.Map;

@RestController
@RequestMapping("/api/dashboard")
public class DashboardController {

    @Resource
    private VolunteerService volunteerService;
    @Resource
    private AnimalService animalService;
    @Resource
    private AdoptService adoptService;
    @Resource
    private UserService userService;

    @GetMapping("/public-stats")
    public Result<Map<String, Long>> publicStats() {
        Map<String, Long> stats = new LinkedHashMap<>();
        stats.put("volunteers", volunteerService.count(Wrappers.<Volunteer>lambdaQuery().eq(Volunteer::getVstate, 1)));
        stats.put("animals", animalService.count());
        stats.put("adopts", adoptService.count());
        stats.put("users", userService.count());
        return Result.success(stats);
    }
}
