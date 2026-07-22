package com.example.controller;

import com.example.common.ExcelExportUtil;
import com.example.common.PermissionUtil;
import com.example.common.Result;
import com.example.dto.AccountPublicVO;
import com.example.entity.Account;
import com.example.entity.User;
import com.example.service.AccountService;
import com.baomidou.mybatisplus.core.metadata.IPage;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.*;

import javax.annotation.Resource;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

@RestController
@RequestMapping("/api/account")
public class AccountController {
    private static final int MAX_PUBLIC_PAGE_SIZE = 50;

    @Resource
    private AccountService accountService;

    @Resource
    private JdbcTemplate jdbcTemplate;

    @PostMapping
    public Result<?> save(@RequestBody Account account) {
        if (account == null || account.getAlabel() == null || account.getAlabel().trim().isEmpty()) {
            return Result.error("400", "款项名称不能为空");
        }
        if (account.getAvalue() == null) {
            return Result.error("400", "金额不能为空");
        }
        if (!accountService.save(account)) {
            return Result.error("500", "资金记录保存失败");
        }
        return Result.success(true);
    }

    @PutMapping
    public Result<?> update(@RequestBody Account account) {
        if (account == null || account.getId() == null) {
            return Result.error("400", "记录 ID 无效");
        }
        if (accountService.getById(account.getId()) == null) {
            return Result.error("404", "记录不存在");
        }
        if (!accountService.updateById(account)) {
            return Result.error("409", "更新失败，请刷新后重试");
        }
        return Result.success(true);
    }

    @DeleteMapping("/{id}")
    public Result<?> delete(@PathVariable Long id) {
        if (id == null) {
            return Result.error("400", "记录 ID 无效");
        }
        if (accountService.getById(id) == null) {
            return Result.error("404", "记录不存在");
        }
        if (!accountService.removeById(id)) {
            return Result.error("409", "删除失败，请刷新后重试");
        }
        return Result.success();
    }

    @GetMapping("/{id}")
    public Result<?> findById(@PathVariable Long id, HttpServletRequest request, HttpServletResponse response) {
        setNoStore(response);
        User user = sessionUser(request);
        if (!PermissionUtil.hasFlag(user, "account")) {
            return Result.error("403", "无权按 ID 查看资金明细，请使用 /api/account/public");
        }
        Account account = accountService.getById(id);
        if (account == null) {
            return Result.error("404", "记录不存在");
        }
        return Result.success(account);
    }

    @GetMapping
    public Result<?> findAll(HttpServletRequest request, HttpServletResponse response) {
        setNoStore(response);
        User user = sessionUser(request);
        if (!PermissionUtil.hasFlag(user, "account")) {
            return Result.error("403", "无权查看资金全表，请使用 /api/account/public");
        }
        List<Account> list = accountService.list(Wrappers.<Account>lambdaQuery().orderByDesc(Account::getId));
        return Result.success(list);
    }

    @GetMapping("/page")
    public Result<?> findPage(@RequestParam(required = false, defaultValue = "") String name,
                              @RequestParam(required = false, defaultValue = "1") Integer pageNum,
                              @RequestParam(required = false, defaultValue = "10") Integer pageSize,
                              HttpServletRequest request,
                              HttpServletResponse response) {
        setNoStore(response);
        User user = sessionUser(request);
        if (!PermissionUtil.hasFlag(user, "account")) {
            return Result.error("403", "无权查看资金分页，请使用 /api/account/public");
        }
        pageSize = clampPageSize(pageSize);
        // 管理端可搜经手人；公开接口 buildPublicQuery 不含 auname
        IPage<Account> page = accountService.page(new Page<>(pageNum, pageSize), buildAdminQuery(name));
        return Result.success(page);
    }

    /**
     * B7：公开公示 — 分页 DTO + SQL 聚合，无 allRecords、无经手人、无内部全表。
     */
    @GetMapping("/public")
    public Result<Map<String, Object>> publicInfo(@RequestParam(required = false, defaultValue = "") String name,
                                                  @RequestParam(required = false, defaultValue = "1") Integer pageNum,
                                                  @RequestParam(required = false, defaultValue = "10") Integer pageSize,
                                                  HttpServletResponse response) {
        setNoStore(response);
        pageSize = clampPageSize(pageSize);
        IPage<Account> page = accountService.page(new Page<>(pageNum, pageSize), buildPublicQuery(name));

        Double income = jdbcTemplate.queryForObject(
                "SELECT COALESCE(SUM(avalue),0) FROM t_account WHERE avalue > 0", Double.class);
        Double expense = jdbcTemplate.queryForObject(
                "SELECT COALESCE(SUM(avalue),0) FROM t_account WHERE avalue < 0", Double.class);
        if (income == null) {
            income = 0d;
        }
        if (expense == null) {
            expense = 0d;
        }

        Map<String, Object> data = new LinkedHashMap<>();
        data.put("records", page.getRecords().stream().map(AccountPublicVO::from).collect(Collectors.toList()));
        data.put("total", page.getTotal());
        data.put("pages", page.getPages());
        data.put("current", page.getCurrent());
        data.put("size", page.getSize());
        data.put("incomeTotal", income);
        data.put("expenseTotal", expense);
        data.put("balance", income + expense);
        return Result.success(data);
    }

    /**
     * 管理端按标签聚合（图表用），需 account 权限；不全表下发明细。
     */
    @GetMapping("/stats/by-label")
    public Result<?> statsByLabel(HttpServletRequest request, HttpServletResponse response) {
        setNoStore(response);
        User user = sessionUser(request);
        if (!PermissionUtil.hasFlag(user, "account")) {
            return Result.error("403", "无权查看资金统计");
        }
        List<Map<String, Object>> incomeByLabel = jdbcTemplate.queryForList(
                "SELECT alabel AS name, COALESCE(SUM(avalue),0) AS value "
                        + "FROM t_account WHERE avalue > 0 GROUP BY alabel ORDER BY value DESC");
        List<Map<String, Object>> expenseByLabel = jdbcTemplate.queryForList(
                "SELECT alabel AS name, COALESCE(ABS(SUM(avalue)),0) AS value "
                        + "FROM t_account WHERE avalue < 0 GROUP BY alabel ORDER BY value DESC");
        Double income = jdbcTemplate.queryForObject(
                "SELECT COALESCE(SUM(avalue),0) FROM t_account WHERE avalue > 0", Double.class);
        Double expense = jdbcTemplate.queryForObject(
                "SELECT COALESCE(SUM(avalue),0) FROM t_account WHERE avalue < 0", Double.class);
        if (income == null) {
            income = 0d;
        }
        if (expense == null) {
            expense = 0d;
        }
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("incomeByLabel", incomeByLabel);
        data.put("expenseByLabel", expenseByLabel);
        data.put("incomeTotal", income);
        data.put("expenseTotal", expense);
        data.put("balance", income + expense);
        return Result.success(data);
    }

    @GetMapping("/export")
    public void export(HttpServletRequest request, HttpServletResponse response) throws IOException {
        User user = sessionUser(request);
        if (!PermissionUtil.hasFlag(user, "account")) {
            response.setStatus(403);
            response.setContentType("application/json;charset=UTF-8");
            response.getWriter().write("{\"code\":\"403\",\"msg\":\"无权导出资金公示\"}");
            return;
        }
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

    private int clampPageSize(Integer pageSize) {
        if (pageSize == null || pageSize < 1) {
            return 10;
        }
        return Math.min(pageSize, MAX_PUBLIC_PAGE_SIZE);
    }

    private User sessionUser(HttpServletRequest request) {
        Object u = request.getSession(false) == null ? null : request.getSession(false).getAttribute("user");
        return u instanceof User ? (User) u : null;
    }

    /** 公开查询：不可通过责任人侧漏 */
    private LambdaQueryWrapper<Account> buildPublicQuery(String name) {
        String keyword = name == null ? "" : name.trim();
        return Wrappers.<Account>lambdaQuery()
                .and(!keyword.isEmpty(), q -> q
                        .like(Account::getAlabel, keyword)
                        .or()
                        .like(Account::getAdescribe, keyword))
                .orderByDesc(Account::getId);
    }

    /** 管理端查询：含经手人 */
    private LambdaQueryWrapper<Account> buildAdminQuery(String name) {
        String keyword = name == null ? "" : name.trim();
        return Wrappers.<Account>lambdaQuery()
                .and(!keyword.isEmpty(), q -> q
                        .like(Account::getAlabel, keyword)
                        .or()
                        .like(Account::getAdescribe, keyword)
                        .or()
                        .like(Account::getAuname, keyword))
                .orderByDesc(Account::getId);
    }

    private void setNoStore(HttpServletResponse response) {
        response.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
        response.setHeader("Pragma", "no-cache");
        response.setDateHeader("Expires", 0);
    }
}
