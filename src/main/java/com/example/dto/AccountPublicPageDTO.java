package com.example.dto;

import java.util.List;

public class AccountPublicPageDTO {
    private final List<AccountPublicVO> records;
    private final long total;
    private final long pages;
    private final long current;
    private final long size;
    private final String incomeTotal;
    private final String expenseTotal;
    private final String balance;

    public AccountPublicPageDTO(List<AccountPublicVO> records, long total, long pages, long current, long size,
                                String incomeTotal, String expenseTotal, String balance) {
        this.records = records;
        this.total = total;
        this.pages = pages;
        this.current = current;
        this.size = size;
        this.incomeTotal = incomeTotal;
        this.expenseTotal = expenseTotal;
        this.balance = balance;
    }

    public List<AccountPublicVO> getRecords() { return records; }
    public long getTotal() { return total; }
    public long getPages() { return pages; }
    public long getCurrent() { return current; }
    public long getSize() { return size; }
    public String getIncomeTotal() { return incomeTotal; }
    public String getExpenseTotal() { return expenseTotal; }
    public String getBalance() { return balance; }
}
