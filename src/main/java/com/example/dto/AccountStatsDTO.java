package com.example.dto;

import java.util.List;

public class AccountStatsDTO {
    public static class LabelAmount {
        private final String name;
        private final String value;

        public LabelAmount(String name, String value) {
            this.name = name;
            this.value = value;
        }

        public String getName() { return name; }
        public String getValue() { return value; }
    }

    private final List<LabelAmount> incomeByLabel;
    private final List<LabelAmount> expenseByLabel;
    private final String incomeTotal;
    private final String expenseTotal;
    private final String balance;

    public AccountStatsDTO(List<LabelAmount> incomeByLabel, List<LabelAmount> expenseByLabel,
                           String incomeTotal, String expenseTotal, String balance) {
        this.incomeByLabel = incomeByLabel;
        this.expenseByLabel = expenseByLabel;
        this.incomeTotal = incomeTotal;
        this.expenseTotal = expenseTotal;
        this.balance = balance;
    }

    public List<LabelAmount> getIncomeByLabel() { return incomeByLabel; }
    public List<LabelAmount> getExpenseByLabel() { return expenseByLabel; }
    public String getIncomeTotal() { return incomeTotal; }
    public String getExpenseTotal() { return expenseTotal; }
    public String getBalance() { return balance; }
}
