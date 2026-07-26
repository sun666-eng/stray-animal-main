package com.example.controller;

import com.example.common.AuditLog;
import com.example.common.ExcelExportUtil;
import com.example.common.PermissionUtil;
import com.example.common.Result;
import com.example.dto.ImportResult;
import com.example.entity.Animal;
import com.example.entity.User;
import com.example.exception.CustomException;
import com.example.service.AnimalService;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.metadata.IPage;
import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import cn.hutool.poi.excel.ExcelUtil;
import cn.hutool.poi.excel.ExcelWriter;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import jakarta.annotation.Resource;
import jakarta.servlet.ServletOutputStream;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.net.URLEncoder;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/animal")
public class AnimalController {
    private static final int DEFAULT_PUBLIC_PAGE_SIZE = 10;
    private static final int MAX_PUBLIC_PAGE_SIZE = 50;
    private static final int MAX_PAGE_NUM = 10000;
    private static final int MAX_QUERY_LENGTH = 100;
    private static final int MAX_EXPORT_ROWS = 10000;
    private static final int EXPORT_PROBE_ROWS = MAX_EXPORT_ROWS + 1;

    @Resource
     private AnimalService animalService;

    @AuditLog(module = "动物管理", action = "新增动物")
    @PostMapping
    public Result<?> save(@RequestBody Animal animal, HttpServletRequest request) {
        User user = sessionUser(request);
        try {
            return Result.success(animalService.saveAnimal(animal, user));
        } catch (CustomException e) {
            return Result.error(e.getCode(), e.getMsg());
        }
    }

    @AuditLog(module = "动物管理", action = "更新动物")
    @PutMapping
    public Result<?> update(@RequestBody Animal animal, HttpServletRequest request) {
        User user = sessionUser(request);
        try {
            return Result.success(animalService.updateAnimal(animal, user));
        } catch (CustomException e) {
            return Result.error(e.getCode(), e.getMsg());
        }
    }

    private User sessionUser(HttpServletRequest request) {
        Object u = request.getSession(false) == null ? null : request.getSession(false).getAttribute("user");
        return u instanceof User ? (User) u : null;
    }

    @AuditLog(module = "动物管理", action = "删除动物")
    @DeleteMapping("/{id}")
    public Result<?> delete(@PathVariable Long id) {
        try {
            return Result.success(animalService.deleteAnimal(id));
        } catch (CustomException e) {
            return Result.error(e.getCode(), e.getMsg());
        }
    }

    @GetMapping("/{id}")
    public Result<?> findById(@PathVariable Long id, HttpServletRequest request) {
        Animal animal = animalService.getById(id);
        if (animal == null) {
            return Result.error("404", "动物信息不存在");
        }
        if (!Integer.valueOf(0).equals(animal.getTstate())
                && !Integer.valueOf(1).equals(animal.getTstate())
                && !PermissionUtil.hasFlag(sessionUser(request), "animal")) {
            return Result.error("404", "动物信息不存在");
        }
        return Result.success(animal);
    }

    @GetMapping
    public Result<List<Animal>> findAll() {
        return Result.success(animalService.list(Wrappers.<Animal>lambdaQuery()
                .orderByDesc(Animal::getId).last("LIMIT " + MAX_EXPORT_ROWS)));
    }

    @GetMapping("/page")
    public Result<IPage<Animal>> findPage(@RequestParam(required = false, defaultValue = "") String name,
                                           @RequestParam(required = false, defaultValue = "1") Integer pageNum,
                                           @RequestParam(required = false, defaultValue = "10") Integer pageSize) {
        String keyword = safeQuery(name, "查询关键词");
        return Result.success(animalService.page(new Page<>(safePageNum(pageNum), safePageSize(pageSize)),
                Wrappers.<Animal>lambdaQuery().like(!keyword.isEmpty(), Animal::getTname, keyword)
                        .orderByDesc(Animal::getId)));
    }

    @GetMapping("/page1")
    public Result<IPage<Animal>> findPage1(@RequestParam(required = false, defaultValue = "") String name,
                                           @RequestParam(required = false, defaultValue = "") String type,
                                           @RequestParam(required = false, defaultValue = "1") Integer pageNum,
                                           @RequestParam(required = false, defaultValue = "10") Integer pageSize) {
        String keyword = safeQuery(name, "查询关键词");
        String normalizedType = safeQuery(type, "动物类型");
        LambdaQueryWrapper<Animal> wrapper = Wrappers.<Animal>lambdaQuery()
                .in(Animal::getTstate, Arrays.asList(0, 1))
                .orderByDesc(Animal::getId);
        if (!keyword.isEmpty()) {
            wrapper.and(q -> q.like(Animal::getTname, keyword)
                    .or().like(Animal::getTtype, keyword)
                    .or().like(Animal::getTdescribe, keyword));
        }
        if (!normalizedType.isEmpty()) {
            if ("犬类".equals(normalizedType)) {
                wrapper.in(Animal::getTtype, Arrays.asList("犬", "狗"));
            } else {
                wrapper.eq(Animal::getTtype, normalizedType);
            }
        }
        return Result.success(animalService.page(new Page<>(safePageNum(pageNum), safePageSize(pageSize)), wrapper));
    }

    @AuditLog(module = "动物管理", action = "导出动物信息")
    @GetMapping("/export")
    public void export(HttpServletRequest request, HttpServletResponse response) throws IOException {
        com.example.entity.User user = (com.example.entity.User) request.getSession().getAttribute("user");
        if (!com.example.common.PermissionUtil.hasFlag(user, "animal")) {
            response.setStatus(403);
            response.setContentType("application/json;charset=UTF-8");
            response.getWriter().write("{\"code\":\"403\",\"msg\":\"无权导出动物信息\"}");
            return;
        }
        long count = animalService.count();
        if (count > MAX_EXPORT_ROWS) {
            throw exportLimitException(count);
        }
        List<Animal> rows = animalService.list(Wrappers.<Animal>lambdaQuery()
                .orderByDesc(Animal::getId).last("LIMIT " + EXPORT_PROBE_ROWS));
        if (rows.size() > MAX_EXPORT_ROWS) {
            throw exportLimitException(rows.size());
        }
        ExcelExportUtil.export(response, "动物信息", rows, animal -> {
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("ID", animal.getId());
            row.put("名称", animal.getTname());
            row.put("类型", animal.getTtype());
            row.put("性别", animal.getTsex());
            row.put("生日", animal.getTbirthday());
            row.put("状态", animal.getTstate());
            row.put("描述", animal.getTdescribe());
            row.put("图片", animal.getTpic());
            return row;
        });
    }

    @AuditLog(module = "动物管理", action = "下载导入模板")
    @GetMapping("/template")
    public void template(HttpServletResponse response) throws IOException {
        ExcelWriter writer = ExcelUtil.getWriter(true);
        writer.writeHeadRow(Arrays.asList("名称*", "品种", "性别", "生日", "描述"));
        writer.writeRow(Arrays.asList("小白", "狗", "公", "2024-01-15", "健康活泼，已驱虫"));

        response.setContentType("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;charset=utf-8");
        response.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
        response.setHeader("Pragma", "no-cache");
        String fname = URLEncoder.encode("动物导入模板", "UTF-8");
        response.setHeader("Content-Disposition", "attachment;filename=" + fname + ".xlsx");

        ServletOutputStream out = response.getOutputStream();
        writer.flush(out, true);
        writer.close();
    }

    @AuditLog(module = "动物管理", action = "批量导入动物")
    @PostMapping("/import")
    public Result<ImportResult> importExcel(@RequestParam("file") MultipartFile file) throws IOException {
        ImportResult result = animalService.importFromExcel(file);
        return Result.success(result);
    }

    private CustomException exportLimitException(long count) {
        return new CustomException("413", "导出记录数" + count
                + "超过上限" + MAX_EXPORT_ROWS + "，请缩小数据范围");
    }

    private int safePageNum(Integer pageNum) {
        if (pageNum == null || pageNum < 1) return 1;
        return Math.min(pageNum, MAX_PAGE_NUM);
    }

    private int safePageSize(Integer pageSize) {
        if (pageSize == null || pageSize < 1) return DEFAULT_PUBLIC_PAGE_SIZE;
        return Math.min(pageSize, MAX_PUBLIC_PAGE_SIZE);
    }

    private String safeQuery(String value, String field) {
        String normalized = value == null ? "" : value.trim();
        if (normalized.length() > MAX_QUERY_LENGTH) {
            throw new CustomException("400", field + "不能超过" + MAX_QUERY_LENGTH + "个字符");
        }
        return normalized;
    }

}
