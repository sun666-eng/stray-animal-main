package com.example.controller;

import com.example.common.AuditLog;
import com.example.common.Result;
import com.example.entity.Animal;
import com.example.service.AnimalService;
import com.baomidou.mybatisplus.core.metadata.IPage;
import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import org.springframework.web.bind.annotation.*;

import javax.annotation.Resource;
import java.util.List;

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


}
