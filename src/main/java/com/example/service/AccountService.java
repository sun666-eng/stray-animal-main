package com.example.service;

import com.example.entity.Account;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.example.mapper.AccountMapper;
import com.example.exception.CustomException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;

@Service
public class AccountService extends ServiceImpl<AccountMapper, Account> {

    private static final BigDecimal MAX_ABSOLUTE_AMOUNT = new BigDecimal("1000000000.00");

    @Transactional
    public boolean saveAccount(Account account, String authenticatedUsername) {
        validate(account);
        account.setId(null);
        account.setAuname(required(authenticatedUsername, 100, "经手人"));
        if (!save(account)) throw new CustomException("500", "资金记录保存失败");
        return true;
    }

    private void validate(Account account) {
        if (account == null) {
            throw new CustomException("400", "资金记录不能为空");
        }
        account.setAlabel(required(account.getAlabel(), 100, "款项名称"));
        account.setAdescribe(optional(account.getAdescribe(), 355, "用途详情"));
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

}
