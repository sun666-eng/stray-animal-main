package com.example.controller;

import com.example.common.AuditLog;
import com.example.common.ExcelExportUtil;
import com.example.common.Result;
import com.example.dto.ImportResult;
import com.example.entity.Animal;
import com.example.service.AnimalService;
import com.baomidou.mybatisplus.core.metadata.IPage;
import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import cn.hutool.poi.excel.ExcelUtil;
import cn.hutool.poi.excel.ExcelWriter;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import javax.annotation.Resource;
import javax.servlet.ServletOutputStream;
import javax.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.net.URLEncoder;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/animal")
public class AnimalController {
    @Resource
     private AnimalService animalService;

    @AuditLog(module = "动物管理", action = "新增动物")
    @PostMapping
    public Result<?> save(@RequestBody Animal animal) {
        if (animal.getTstate() == null) {
            animal.setTstate(0);
        }
        return Result.success(animalService.save(animal));
    }

    @AuditLog(module = "动物管理", action = "更新动物")
    @PutMapping
    public Result<?> update(@RequestBody Animal animal) {
        return Result.success(animalService.updateById(animal));
    }

    @AuditLog(module = "动物管理", action = "删除动物")
    @DeleteMapping("/{id}")
    public Result<?> delete(@PathVariable Long id) {
        animalService.removeById(id);
        return Result.success();
    }

    @GetMapping("/{id}")
    public Result<Animal> findById(@PathVariable Long id) {
        return Result.success(animalService.getById(id));
    }

    @GetMapping
    public Result<List<Animal>> findAll() {
        return Result.success(animalService.list());
    }

    @GetMapping("/page")
    public Result<IPage<Animal>> findPage(@RequestParam(required = false, defaultValue = "") String name,
                                           @RequestParam(required = false, defaultValue = "1") Integer pageNum,
                                           @RequestParam(required = false, defaultValue = "10") Integer pageSize) {
        return Result.success(animalService.page(new Page<>(pageNum, pageSize),
                Wrappers.<Animal>lambdaQuery().like(Animal::getTname, name).orderByDesc(Animal::getId)));
    }

    @GetMapping("/page1")
    public Result<IPage<Animal>> findPage1(@RequestParam(required = false, defaultValue = "") String name,
                                          @RequestParam(required = false, defaultValue = "1") Integer pageNum,
                                          @RequestParam(required = false, defaultValue = "10") Integer pageSize) {
        return Result.success(animalService.page(new Page<>(pageNum, pageSize),
                Wrappers.<Animal>lambdaQuery().like(Animal::getTdescribe, name).eq(Animal::getTstate, 0)));
    }

    @GetMapping("/export")
    public void export(HttpServletResponse response) throws IOException {
        ExcelExportUtil.export(response, "动物信息", animalService.list(), animal -> {
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
        writer.writeHeadRow(Arrays.asList("名称*", "品种", "性别", "生日", "状态", "描述"));
        writer.writeRow(Arrays.asList("小白", "狗", "公", "2024-01-15", "待领养", "健康活泼，已驱虫"));

        response.setContentType("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;charset=utf-8");
        String fname = URLEncoder.encode("动物导入模板", "UTF-8");
        response.setHeader("Content-Disposition", "attachment;filename=" + fname + ".xlsx");

        ServletOutputStream out = response.getOutputStream();
        writer.flush(out, true);
        writer.close();
    }

    @AuditLog(module = "动物管理", action = "批量导入动物")
    @PostMapping("/import")
    public Result<ImportResult> importExcel(@RequestParam("file") MultipartFile file) throws IOException {
        return Result.success(animalService.importFromExcel(file));
    }

}
