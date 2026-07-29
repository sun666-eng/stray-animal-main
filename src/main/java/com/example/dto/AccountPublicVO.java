package com.example.dto;

import com.example.entity.Account;

import java.math.BigDecimal;
import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.fasterxml.jackson.databind.ser.std.ToStringSerializer;
import com.fasterxml.jackson.annotation.JsonFormat;
import java.util.Date;

/**
 * B7：资金公示公开字段 — 不含内部 ID、不含经手人。
 */
public class AccountPublicVO {
    private String alabel;
    @JsonSerialize(using = ToStringSerializer.class)
    private BigDecimal avalue;
    private String adescribe;
    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss", timezone = "GMT+8")
    private Date occurredAt;
    private String category;
    private String businessType;
    private String businessId;

    public static AccountPublicVO from(Account a) {
        if (a == null) {
            return null;
        }
        AccountPublicVO vo = new AccountPublicVO();
        vo.alabel = a.getAlabel();
        vo.avalue = a.getAvalue();
        vo.adescribe = a.getAdescribe();
        vo.occurredAt = a.getOccurredAt();
        vo.category = a.getCategory();
        vo.businessType = a.getBusinessType();
        vo.businessId = a.getBusinessId();
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

    public Date getOccurredAt() { return occurredAt == null ? null : new Date(occurredAt.getTime()); }
    public String getCategory() { return category; }
    public String getBusinessType() { return businessType; }
    public String getBusinessId() { return businessId; }
}
