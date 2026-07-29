package com.example.controller;

import com.example.common.ExcelExportUtil;
import com.example.common.AuditLog;
import com.example.common.PermissionUtil;
import com.example.common.Result;
import com.example.dto.AccountPublicVO;
import com.example.dto.AccountPublicPageDTO;
import com.example.dto.AccountStatsDTO;
import com.example.entity.Account;
import com.example.entity.User;
import com.example.service.AccountService;
import com.example.exception.CustomException;
import com.baomidou.mybatisplus.core.metadata.IPage;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.*;

import jakarta.annotation.Resource;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.math.BigDecimal;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

@RestController
@RequestMapping("/api/account")
public class AccountController {
    private static final int MAX_PUBLIC_PAGE_SIZE = 50;
    private static final int MAX_PAGE_NUM = 10000;
    private static final int MAX_QUERY_LENGTH = 100;
    private static final int MAX_EXPORT_ROWS = 10000;
    private static final int EXPORT_PROBE_ROWS = MAX_EXPORT_ROWS + 1;

    @Resource
    private AccountService accountService;

    @Resource
    private JdbcTemplate jdbcTemplate;

    @AuditLog(module = "资金管理", action = "新增资金记录")
    @PostMapping
    public Result<?> save(@RequestBody Account account, HttpServletRequest request) {
        User user = sessionUser(request);
        if (user == null || user.getUsername() == null) {
            throw new CustomException("401", "登录状态无效");
        }
        account.setCreatedBy(user.getId());
        return Result.success(accountService.saveAccount(account, user.getUsername()));
    }

    @AuditLog(module = "资金管理", action = "冲正资金记录")
    @PostMapping("/{id}/reverse")
    public Result<?> reverse(@PathVariable Long id, @RequestBody Map<String, Object> body,
                             HttpServletRequest request) {
        User user = sessionUser(request);
        if (!PermissionUtil.hasFlag(user, "account")) throw new CustomException("403", "无权冲正资金记录");
        return Result.success(accountService.reverse(id,
                body == null || body.get("reason") == null ? null : String.valueOf(body.get("reason")), user));
    }

    @AuditLog(module = "资金管理", action = "更新资金记录")
    @PutMapping
    public Result<?> update(@RequestBody Account account) {
        throw new CustomException("405", "资金公示记录仅允许追加，不允许覆盖历史记录");
    }

    @AuditLog(module = "资金管理", action = "删除资金记录")
    @DeleteMapping("/{id}")
    public Result<?> delete(@PathVariable Long id) {
        throw new CustomException("405", "资金公示记录仅允许追加，不允许物理删除");
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
        List<Account> list = accountService.list(Wrappers.<Account>lambdaQuery()
                .orderByDesc(Account::getId).last("LIMIT " + MAX_EXPORT_ROWS));
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
        pageNum = clampPageNum(pageNum);
        name = safeQuery(name);
        // 管理端可搜经手人；公开接口 buildPublicQuery 不含 auname
        IPage<Account> page = accountService.page(new Page<>(pageNum, pageSize), buildAdminQuery(name));
        return Result.success(page);
    }

    /**
     * B7：公开公示 — 分页 DTO + SQL 聚合，无 allRecords、无经手人、无内部全表。
     */
    @GetMapping("/public")
    public Result<AccountPublicPageDTO> publicInfo(@RequestParam(required = false, defaultValue = "") String name,
                                                  @RequestParam(required = false, defaultValue = "1") Integer pageNum,
                                                  @RequestParam(required = false, defaultValue = "10") Integer pageSize,
                                                  HttpServletResponse response) {
        setNoStore(response);
        pageSize = clampPageSize(pageSize);
        pageNum = clampPageNum(pageNum);
        name = safeQuery(name);
        IPage<Account> page = accountService.page(new Page<>(pageNum, pageSize), buildPublicQuery(name));

        // Residual: the page and aggregate queries are separate read-committed statements, not one snapshot.
        BigDecimal income = jdbcTemplate.queryForObject(
                "SELECT COALESCE(SUM(avalue),0.00) FROM t_account WHERE avalue > 0", BigDecimal.class);
        BigDecimal expense = jdbcTemplate.queryForObject(
                "SELECT COALESCE(SUM(avalue),0.00) FROM t_account WHERE avalue < 0", BigDecimal.class);
        if (income == null) {
            income = BigDecimal.ZERO;
        }
        if (expense == null) {
            expense = BigDecimal.ZERO;
        }
        income = income.setScale(2);
        expense = expense.setScale(2);

        return Result.success(new AccountPublicPageDTO(
                page.getRecords().stream().map(AccountPublicVO::from).collect(Collectors.toList()),
                page.getTotal(), page.getPages(), page.getCurrent(), page.getSize(),
                decimal(income), decimal(expense), decimal(income.add(expense))));
    }

    /**
     * 管理端按标签聚合（图表用），需 account 权限；不全表下发明细。
     */
    @GetMapping("/stats/by-label")
    public Result<AccountStatsDTO> statsByLabel(HttpServletRequest request, HttpServletResponse response) {
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
        BigDecimal income = jdbcTemplate.queryForObject(
                "SELECT COALESCE(SUM(avalue),0.00) FROM t_account WHERE avalue > 0", BigDecimal.class);
        BigDecimal expense = jdbcTemplate.queryForObject(
                "SELECT COALESCE(SUM(avalue),0.00) FROM t_account WHERE avalue < 0", BigDecimal.class);
        if (income == null) {
            income = BigDecimal.ZERO;
        }
        if (expense == null) {
            expense = BigDecimal.ZERO;
        }
        income = income.setScale(2);
        expense = expense.setScale(2);
        return Result.success(new AccountStatsDTO(
                labelAmounts(incomeByLabel), labelAmounts(expenseByLabel),
                decimal(income), decimal(expense), decimal(income.add(expense))));
    }

    @AuditLog(module = "资金管理", action = "导出资金记录")
    @GetMapping("/export")
    public void export(HttpServletRequest request, HttpServletResponse response) throws IOException {
        User user = sessionUser(request);
        if (!PermissionUtil.hasFlag(user, "account")) {
            response.setStatus(403);
            response.setContentType("application/json;charset=UTF-8");
            response.getWriter().write("{\"code\":\"403\",\"msg\":\"无权导出资金公示\"}");
            return;
        }
        long count = accountService.count();
        if (count > MAX_EXPORT_ROWS) {
            throw exportLimitException(count);
        }
        List<Account> rows = accountService.list(Wrappers.<Account>lambdaQuery()
                .orderByDesc(Account::getId).last("LIMIT " + EXPORT_PROBE_ROWS));
        if (rows.size() > MAX_EXPORT_ROWS) {
            throw exportLimitException(rows.size());
        }
        ExcelExportUtil.export(response, "资金公示", rows, account -> {
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("ID", account.getId());
            row.put("款项名称", account.getAlabel());
            row.put("经手人", account.getAuname());
            row.put("金额", account.getAvalue());
            row.put("用途详情", account.getAdescribe());
            row.put("发生时间", account.getOccurredAt());
            row.put("资金分类", account.getCategory());
            row.put("关联业务", account.getBusinessType() == null ? "" : account.getBusinessType() + ":" + account.getBusinessId());
            row.put("冲正原记录", account.getReversalOf());
            return row;
        });
    }

    private CustomException exportLimitException(long count) {
        return new CustomException("413", "导出记录数" + count
                + "超过上限" + MAX_EXPORT_ROWS + "，请缩小数据范围");
    }

    private String decimal(BigDecimal value) {
        return (value == null ? BigDecimal.ZERO : value).setScale(2).toPlainString();
    }

    private List<AccountStatsDTO.LabelAmount> labelAmounts(List<Map<String, Object>> rows) {
        return rows.stream().map(row -> new AccountStatsDTO.LabelAmount(
                String.valueOf(row.get("name")), decimal(asBigDecimal(row.get("value")))))
                .collect(Collectors.toList());
    }

    private BigDecimal asBigDecimal(Object value) {
        if (value == null) return BigDecimal.ZERO;
        return value instanceof BigDecimal ? (BigDecimal) value : new BigDecimal(value.toString());
    }

    private int clampPageSize(Integer pageSize) {
        if (pageSize == null || pageSize < 1) {
            return 10;
        }
        return Math.min(pageSize, MAX_PUBLIC_PAGE_SIZE);
    }

    private int clampPageNum(Integer pageNum) {
        if (pageNum == null || pageNum < 1) return 1;
        return Math.min(pageNum, MAX_PAGE_NUM);
    }

    private String safeQuery(String value) {
        String normalized = value == null ? "" : value.trim();
        if (normalized.length() > MAX_QUERY_LENGTH) {
            throw new CustomException("400", "查询关键词不能超过" + MAX_QUERY_LENGTH + "个字符");
        }
        return normalized;
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
