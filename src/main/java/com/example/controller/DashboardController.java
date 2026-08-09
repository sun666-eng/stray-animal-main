package com.example.controller;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.example.common.Result;
import com.example.dto.HomeStatsDTO;
import com.example.entity.Animal;
import com.example.entity.Help;
import com.example.entity.Volunteer;
import com.example.service.AdoptService;
import com.example.service.AnimalService;
import com.example.service.HelpService;
import com.example.service.UserService;
import com.example.service.VolunteerService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import jakarta.annotation.Resource;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.Date;
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
    @Resource
    private HelpService helpService;

    /**
     * 崩溃预防 P1.3：两个匿名统计接口每次 3-4 个 COUNT(*)，无缓存无限流，
     * 对小连接池是廉价打法。60s 进程内缓存（统计数据无实时性要求）。
     */
    private static final long STATS_CACHE_MS = 60_000;
    private volatile Map<String, Long> publicStatsCache;
    private volatile long publicStatsCachedAt;
    private volatile HomeStatsDTO homeStatsCache;
    private volatile long homeStatsCachedAt;

    @GetMapping("/public-stats")
    public Result<Map<String, Long>> publicStats() {
        Map<String, Long> cached = publicStatsCache;
        if (cached != null && System.currentTimeMillis() - publicStatsCachedAt < STATS_CACHE_MS) {
            return Result.success(cached);
        }
        Map<String, Long> stats = new LinkedHashMap<>();
        stats.put("volunteers", volunteerService.count(Wrappers.<Volunteer>lambdaQuery().eq(Volunteer::getVstate, 1)));
        stats.put("animals", animalService.count());
        stats.put("adopts", adoptService.count());
        stats.put("users", userService.count());
        publicStatsCache = java.util.Collections.unmodifiableMap(stats);
        publicStatsCachedAt = System.currentTimeMillis();
        return Result.success(stats);
    }

    @GetMapping("/home-stats")
    public Result<HomeStatsDTO> homeStats() {
        HomeStatsDTO cached = homeStatsCache;
        if (cached != null && System.currentTimeMillis() - homeStatsCachedAt < STATS_CACHE_MS) {
            return Result.success(cached);
        }
        long availableAnimals = animalService.count(
                Wrappers.<Animal>lambdaQuery().eq(Animal::getTstate, 0));
        long adoptedAnimals = animalService.count(
                Wrappers.<Animal>lambdaQuery().eq(Animal::getTstate, 2));
        Date monthStart = Date.from(LocalDate.now()
                .withDayOfMonth(1)
                .atStartOfDay(ZoneId.systemDefault())
                .toInstant());
        long monthlyRescues = helpService.count(
                Wrappers.<Help>lambdaQuery()
                        .ne(Help::getTitle, "聊天室消息")
                        .ge(Help::getCreateTime, monthStart));
        Long approvedVolunteers = volunteerService.getObj(
                Wrappers.<Volunteer>query()
                        .select("COUNT(DISTINCT uid)")
                        .eq("vstate", 1),
                value -> value == null ? 0L : ((Number) value).longValue());
        HomeStatsDTO dto = new HomeStatsDTO(
                availableAnimals,
                adoptedAnimals,
                monthlyRescues,
                approvedVolunteers == null ? 0L : approvedVolunteers);
        homeStatsCache = dto;
        homeStatsCachedAt = System.currentTimeMillis();
        return Result.success(dto);
    }
}
