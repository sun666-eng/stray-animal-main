package com.example.controller;

import com.example.common.ExcelExportUtil;
import com.example.common.Result;
import com.example.entity.Account;
import com.example.service.AccountService;
import com.baomidou.mybatisplus.core.metadata.IPage;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import org.springframework.web.bind.annotation.*;

import javax.annotation.Resource;
import javax.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/account")
public class AccountController {
    @Resource
    private AccountService accountService;

    @PostMapping
    public Result<?> save(@RequestBody Account account) {
        return Result.success(accountService.save(account));
    }

    @PutMapping
    public Result<?> update(@RequestBody Account account) {
        return Result.success(accountService.updateById(account));
    }

    @DeleteMapping("/{id}")
    public Result<?> delete(@PathVariable Long id) {
        accountService.removeById(id);
        return Result.success();
    }

    @GetMapping("/{id}")
    public Result<Account> findById(@PathVariable Long id, HttpServletResponse response) {
        setNoStore(response);
        return Result.success(accountService.getById(id));
    }

    @GetMapping
    public Result<List<Account>> findAll(HttpServletResponse response) {
        setNoStore(response);
        return Result.success(accountService.list(Wrappers.<Account>lambdaQuery().orderByDesc(Account::getId)));
    }

    @GetMapping("/page")
    public Result<IPage<Account>> findPage(@RequestParam(required = false, defaultValue = "") String name,
                                                @RequestParam(required = false, defaultValue = "1") Integer pageNum,
                                                @RequestParam(required = false, defaultValue = "10") Integer pageSize,
                                                HttpServletResponse response) {
        setNoStore(response);
        return Result.success(accountService.page(new Page<>(pageNum, pageSize), buildQuery(name)));
    }

    @GetMapping("/public")
    public Result<Map<String, Object>> publicInfo(@RequestParam(required = false, defaultValue = "") String name,
                                                  @RequestParam(required = false, defaultValue = "1") Integer pageNum,
                                                  @RequestParam(required = false, defaultValue = "10") Integer pageSize,
                                                  HttpServletResponse response) {
        setNoStore(response);
        IPage<Account> page = accountService.page(new Page<>(pageNum, pageSize), buildQuery(name));
        List<Account> allRecords = accountService.list(Wrappers.<Account>lambdaQuery().orderByDesc(Account::getId));
        double incomeTotal = allRecords.stream()
                .map(Account::getAvalue)
                .filter(value -> value != null && value > 0)
                .mapToDouble(Double::doubleValue)
                .sum();
        double expenseTotal = allRecords.stream()
                .map(Account::getAvalue)
                .filter(value -> value != null && value < 0)
                .mapToDouble(Double::doubleValue)
                .sum();

        Map<String, Object> data = new LinkedHashMap<>();
        data.put("records", page.getRecords());
        data.put("total", page.getTotal());
        data.put("pages", page.getPages());
        data.put("current", page.getCurrent());
        data.put("size", page.getSize());
        data.put("allRecords", allRecords);
        data.put("incomeTotal", incomeTotal);
        data.put("expenseTotal", expenseTotal);
        data.put("balance", incomeTotal + expenseTotal);
        return Result.success(data);
    }

    @GetMapping("/export")
    public void export(HttpServletResponse response) throws IOException {
        ExcelExportUtil.export(response, "资金公示", accountService.list(), account -> {
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("ID", account.getId());
            row.put("款项名称", account.getAlabel());
            row.put("经手人", account.getAuname());
            row.put("金额", account.getAvalue());
            row.put("用途详情", account.getAdescribe());
            return row;
        });
    }

    private LambdaQueryWrapper<Account> buildQuery(String name) {
        String keyword = name == null ? "" : name.trim();
        return Wrappers.<Account>lambdaQuery()
                .and(!keyword.isEmpty(), q -> q
                        .like(Account::getAuname, keyword)
                        .or()
                        .like(Account::getAlabel, keyword)
                        .or()
                        .like(Account::getAdescribe, keyword))
                .orderByDesc(Account::getId);
    }

    private void setNoStore(HttpServletResponse response) {
        response.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
        response.setHeader("Pragma", "no-cache");
        response.setDateHeader("Expires", 0);
    }

}
