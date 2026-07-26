package com.example.controller;

import com.baomidou.mybatisplus.core.conditions.Wrapper;
import com.baomidou.mybatisplus.core.metadata.IPage;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.example.entity.Account;
import com.example.entity.Permission;
import com.example.entity.User;
import com.example.exception.CustomException;
import com.example.service.AccountService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.Collections;
import java.util.Map;
import java.math.BigDecimal;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class AccountControllerTest {
    private AccountController controller;
    private AccountService service;
    private JdbcTemplate jdbc;

    @BeforeEach
    void setUp() {
        controller = new AccountController();
        service = mock(AccountService.class);
        jdbc = mock(JdbcTemplate.class);
        ReflectionTestUtils.setField(controller, "accountService", service);
        ReflectionTestUtils.setField(controller, "jdbcTemplate", jdbc);
        when(service.page(any(Page.class), any(Wrapper.class))).thenAnswer(invocation -> invocation.getArgument(0));
    }

    @Test
    void adminPageBoundsPaginationAndSearch() {
        controller.findPage("医疗", Integer.MAX_VALUE, 500, requestWithAccountPermission(),
                new MockHttpServletResponse());

        ArgumentCaptor<IPage> page = ArgumentCaptor.forClass(IPage.class);
        verify(service).page(page.capture(), any(Wrapper.class));
        assertEquals(10000L, page.getValue().getCurrent());
        assertEquals(50L, page.getValue().getSize());
        assertEquals("400", assertThrows(CustomException.class,
                () -> controller.findPage(repeat('x', 101), 1, 10, requestWithAccountPermission(),
                        new MockHttpServletResponse())).getCode());
    }

    @Test
    void publicResponseUsesDtosAndWholeDatasetTotals() {
        Page<Account> page = new Page<>(1, 10);
        Account account = new Account();
        account.setId(9L);
        account.setAlabel("收入-领养费");
        account.setAuname("内部经手人");
        account.setAvalue(new BigDecimal("25.00"));
        page.setRecords(Collections.singletonList(account));
        page.setTotal(1);
        when(service.page(any(Page.class), any(Wrapper.class))).thenReturn(page);
        when(jdbc.queryForObject(anyString(), eq(BigDecimal.class)))
                .thenReturn(new BigDecimal("100.00"), new BigDecimal("-40.00"));

        com.example.dto.AccountPublicPageDTO data = controller.publicInfo("", 1, 10, new MockHttpServletResponse()).getData();

        assertEquals("100.00", data.getIncomeTotal());
        assertEquals("-40.00", data.getExpenseTotal());
        assertEquals("60.00", data.getBalance());
        Object publicRecord = data.getRecords().get(0);
        assertFalse(publicRecord instanceof Account);
    }

    @Test
    void exportRejectsOverflowBeforeReadingRows() throws Exception {
        when(service.count()).thenReturn(10001L);
        MockHttpServletResponse response = new MockHttpServletResponse();

        CustomException exception = assertThrows(CustomException.class,
                () -> controller.export(requestWithAccountPermission(), response));
        assertEquals("413", exception.getCode());
        assertEquals(0, response.getContentAsByteArray().length);
    }

    @Test
    void exportRejectsInsertRaceAfterBoundedProbe() {
        when(service.count()).thenReturn(10000L);
        when(service.list(any(Wrapper.class))).thenReturn(Collections.nCopies(10001, new Account()));

        CustomException exception = assertThrows(CustomException.class,
                () -> controller.export(requestWithAccountPermission(), new MockHttpServletResponse()));

        assertEquals("413", exception.getCode());
        verify(service).list(any(Wrapper.class));
    }

    @Test
    void createDerivesHandlerFromAuthenticatedSession() {
        Account submitted = new Account();
        submitted.setAuname("forged-handler");
        MockHttpServletRequest request = requestWithAccountPermission();
        ((User) request.getSession().getAttribute("user")).setUsername("real-admin");

        controller.save(submitted, request);

        verify(service).saveAccount(submitted, "real-admin");
    }

    @Test
    void updateAndDeleteAreAppendOnly() {
        assertEquals("405", assertThrows(CustomException.class,
                () -> controller.update(new Account())).getCode());
        assertEquals("405", assertThrows(CustomException.class,
                () -> controller.delete(1L)).getCode());
    }

    private MockHttpServletRequest requestWithAccountPermission() {
        User user = new User();
        user.setId(1L);
        Permission permission = new Permission();
        permission.setFlag("account");
        user.setPermission(Collections.singletonList(permission));
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.getSession(true).setAttribute("user", user);
        return request;
    }

    private String repeat(char c, int count) {
        StringBuilder value = new StringBuilder();
        for (int i = 0; i < count; i++) value.append(c);
        return value.toString();
    }
}
