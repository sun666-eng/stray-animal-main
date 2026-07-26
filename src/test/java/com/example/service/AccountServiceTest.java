package com.example.service;

import com.example.entity.Account;
import com.example.exception.CustomException;
import com.example.mapper.AccountMapper;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.math.BigDecimal;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class AccountServiceTest {
    @Mock AccountMapper mapper;
    @InjectMocks AccountService service;

    @Test
    void rejectsZeroExcessScaleAndRange() {
        Account account = valid();
        account.setAvalue(BigDecimal.ZERO);
        assert400(account);
        account.setAvalue(new BigDecimal("12.345"));
        assert400(account);
        account.setAvalue(new BigDecimal("1000000000.01"));
        assert400(account);
    }

    @Test
    void derivesHandlerAndReportsFalseInsert() {
        Account account = valid();
        account.setAlabel(" ");
        assert400(account);

        Account missingAuthenticatedHandler = valid();
        assertEquals("400", assertThrows(CustomException.class,
                () -> service.saveAccount(missingAuthenticatedHandler, " ")).getCode());

        Account validAccount = valid();
        when(mapper.insert(any(Account.class))).thenReturn(0);
        assertEquals("500", assertThrows(CustomException.class,
                () -> service.saveAccount(validAccount, "authenticated-admin")).getCode());
    }

    private void assert400(Account account) {
        assertEquals("400", assertThrows(CustomException.class,
                () -> service.saveAccount(account, "authenticated-admin")).getCode());
    }

    private Account valid() {
        Account account = new Account();
        account.setAlabel("医疗-费用");
        account.setAuname("伪造经手人");
        account.setAvalue(new BigDecimal("-12.34"));
        account.setAdescribe("治疗用途");
        return account;
    }
}
