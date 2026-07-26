package com.example.dto;

import com.example.entity.Account;

import java.math.BigDecimal;
import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.fasterxml.jackson.databind.ser.std.ToStringSerializer;

/**
 * B7：资金公示公开字段 — 不含内部 ID、不含经手人。
 */
public class AccountPublicVO {
    private String alabel;
    @JsonSerialize(using = ToStringSerializer.class)
    private BigDecimal avalue;
    private String adescribe;

    public static AccountPublicVO from(Account a) {
        if (a == null) {
            return null;
        }
        AccountPublicVO vo = new AccountPublicVO();
        vo.alabel = a.getAlabel();
        vo.avalue = a.getAvalue();
        vo.adescribe = a.getAdescribe();
        return vo;
    }

    public String getAlabel() {
        return alabel;
    }

    public BigDecimal getAvalue() {
        return avalue;
    }

    public String getAdescribe() {
        return adescribe;
    }
}
