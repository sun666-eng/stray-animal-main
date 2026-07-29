package com.example.service;

import com.example.entity.Account;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.example.mapper.AccountMapper;
import com.example.exception.CustomException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.jdbc.core.JdbcTemplate;

import java.math.BigDecimal;
import java.util.Arrays;
import java.util.Date;
import java.util.HashSet;
import java.util.Set;
import com.example.entity.User;
import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import jakarta.annotation.Resource;

@Service
public class AccountService extends ServiceImpl<AccountMapper, Account> {

    private static final BigDecimal MAX_ABSOLUTE_AMOUNT = new BigDecimal("1000000000.00");
    private static final Set<String> CATEGORIES = new HashSet<>(Arrays.asList(
            "donation", "medical", "food", "rescue", "adoption", "operations", "other"));
    private static final Set<String> BUSINESS_TYPES = new HashSet<>(Arrays.asList(
            "animal", "rescue", "adopt", "proof", "volunteer_task", "other"));

    @Resource
    private FileAssetService fileAssetService;

    @Resource
    private JdbcTemplate jdbcTemplate;

    @Transactional
    public boolean saveAccount(Account account, User actor) {
        validate(account);
        account.setId(null);
        if (actor == null || actor.getId() == null) throw new CustomException("401", "登录状态无效");
        account.setAuname(required(actor.getUsername(), 100, "经手人"));
        account.setCreatedBy(actor.getId());
        account.setReversalOf(null);
        if (account.getOccurredAt() == null) account.setOccurredAt(new Date());
        if (!save(account)) throw new CustomException("500", "资金记录保存失败");
        if (account.getReceiptFlag() != null && !account.getReceiptFlag().trim().isEmpty()) {
            fileAssetService.bindToBusiness(actor, account.getReceiptFlag(), "account",
                    "account", account.getId(), false);
        }
        return true;
    }

    /** 兼容既有调用契约；Controller 会先覆盖 createdBy，禁止请求体伪造经手人。 */
    @Transactional
    public boolean saveAccount(Account account, String authenticatedUsername) {
        User actor = new User();
        actor.setId(account != null && account.getCreatedBy() != null ? account.getCreatedBy() : 0L);
        actor.setUsername(authenticatedUsername);
        return saveAccount(account, actor);
    }

    @Transactional
    public Long reverse(Long originalId, String reason, User actor) {
        if (originalId == null || originalId < 1) throw new CustomException("400", "原资金记录编号无效");
        Account original = getOne(Wrappers.<Account>lambdaQuery()
                .eq(Account::getId, originalId).last("FOR UPDATE"), false);
        if (original == null) throw new CustomException("404", "原资金记录不存在");
        if (original.getReversalOf() != null) throw new CustomException("409", "冲正记录不能再次冲正");
        Account existing = getOne(Wrappers.<Account>lambdaQuery().eq(Account::getReversalOf, originalId), false);
        if (existing != null) return existing.getId();
        Account reversal = new Account();
        reversal.setAlabel("冲正：" + original.getAlabel());
        reversal.setAvalue(original.getAvalue().negate());
        reversal.setAdescribe(required(reason, 355, "冲正原因"));
        reversal.setAuname(required(actor == null ? null : actor.getUsername(), 100, "经手人"));
        reversal.setOccurredAt(new Date());
        reversal.setCategory(original.getCategory());
        reversal.setBusinessType(original.getBusinessType());
        reversal.setBusinessId(original.getBusinessId());
        reversal.setReversalOf(originalId);
        reversal.setCreatedBy(actor.getId());
        if (!save(reversal)) throw new CustomException("500", "冲正记录保存失败");
        return reversal.getId();
    }

    private void validate(Account account) {
        if (account == null) {
            throw new CustomException("400", "资金记录不能为空");
        }
        account.setAlabel(required(account.getAlabel(), 100, "款项名称"));
        account.setAdescribe(optional(account.getAdescribe(), 355, "用途详情"));
        String category = optional(account.getCategory(), 32, "资金分类");
        category = category == null ? "other" : category.toLowerCase();
        if (!CATEGORIES.contains(category)) throw new CustomException("400", "资金分类无效");
        account.setCategory(category);
        String businessType = optional(account.getBusinessType(), 32, "关联业务类型");
        String businessId = optional(account.getBusinessId(), 96, "关联业务编号");
        if ((businessType == null) != (businessId == null)) {
            throw new CustomException("400", "关联业务类型和编号必须同时填写");
        }
        if (businessType != null) {
            businessType = businessType.toLowerCase();
            if (!BUSINESS_TYPES.contains(businessType)) throw new CustomException("400", "关联业务类型无效");
            account.setBusinessType(businessType);
            account.setBusinessId(businessId);
            validateBusinessReference(businessType, businessId);
        }
        account.setReceiptFlag(optional(account.getReceiptFlag(), 64, "票据文件"));
        BigDecimal amount = account.getAvalue();
        if (amount == null) throw new CustomException("400", "金额不能为空");
        if (amount.compareTo(BigDecimal.ZERO) == 0) throw new CustomException("400", "金额不能为零");
        if (amount.abs().compareTo(MAX_ABSOLUTE_AMOUNT) > 0) {
            throw new CustomException("400", "金额绝对值不能超过1000000000");
        }
        if (amount.scale() > 2) throw new CustomException("400", "金额最多保留2位小数");
        account.setAvalue(amount.setScale(2));
    }

    private String required(String value, int max, String field) {
        String normalized = value == null ? "" : value.trim();
        if (normalized.isEmpty()) throw new CustomException("400", field + "不能为空");
        if (normalized.length() > max) throw new CustomException("400", field + "不能超过" + max + "个字符");
        return normalized;
    }

    private String optional(String value, int max, String field) {
        if (value == null) return null;
        String normalized = value.trim();
        if (normalized.length() > max) throw new CustomException("400", field + "不能超过" + max + "个字符");
        return normalized;
    }

    private void validateBusinessReference(String type, String id) {
        if ("other".equals(type)) return;
        long count;
        if ("adopt".equals(type)) {
            String[] parts = id.split(":", -1);
            if (parts.length != 2) throw new CustomException("400", "领养申请业务编号格式应为 动物ID:用户ID");
            long animalId = positiveId(parts[0], "动物编号");
            long userId = positiveId(parts[1], "用户编号");
            count = jdbcTemplate.queryForObject(
                    "SELECT COUNT(*) FROM t_adopt WHERE aid=? AND uid=?", Long.class, animalId, userId);
        } else {
            long numericId = positiveId(id, "业务编号");
            String table;
            switch (type) {
                case "animal": table = "t_animal"; break;
                case "rescue": table = "t_help"; break;
                case "proof": table = "t_proof"; break;
                case "volunteer_task": table = "t_volunteer_task"; break;
                default: throw new CustomException("400", "关联业务类型无效");
            }
            count = jdbcTemplate.queryForObject("SELECT COUNT(*) FROM " + table + " WHERE id=?", Long.class, numericId);
        }
        if (count != 1) throw new CustomException("404", "关联业务记录不存在");
    }

    private long positiveId(String value, String field) {
        try {
            long parsed = Long.parseLong(value);
            if (parsed < 1) throw new NumberFormatException();
            return parsed;
        } catch (NumberFormatException e) {
            throw new CustomException("400", field + "无效");
        }
    }

}
