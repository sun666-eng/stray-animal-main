package com.example.dto;

import com.example.entity.Account;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;

import static org.junit.jupiter.api.Assertions.assertEquals;

class AccountSerializationTest {
    private final ObjectMapper mapper = new ObjectMapper();

    @Test
    void accountAmountsSerializeAsExactDecimalStringsBeyondJavascriptSafeInteger() throws Exception {
        Account account = new Account();
        account.setAvalue(new BigDecimal("9007199254740993.01"));

        assertEquals("9007199254740993.01", mapper.readTree(mapper.writeValueAsString(account))
                .get("avalue").textValue());
        assertEquals("9007199254740993.01", mapper.readTree(mapper.writeValueAsString(AccountPublicVO.from(account)))
                .get("avalue").textValue());
    }

    @Test
    void aggregateDtoValuesAreStrings() throws Exception {
        AccountStatsDTO dto = new AccountStatsDTO(java.util.Collections.emptyList(),
                java.util.Collections.emptyList(), "9007199254740993.01", "-0.01", "9007199254740993.00");
        assertEquals("9007199254740993.01", mapper.readTree(mapper.writeValueAsString(dto))
                .get("incomeTotal").textValue());
    }
}
