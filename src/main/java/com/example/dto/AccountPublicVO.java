package com.example.dto;

import com.example.entity.Account;

/**
 * B7：资金公示公开字段 — 不含内部 ID、不含经手人。
 */
public class AccountPublicVO {
    private String alabel;
    private Double avalue;
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

    public Double getAvalue() {
        return avalue;
    }

    public String getAdescribe() {
        return adescribe;
    }
}
