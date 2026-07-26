package com.example.controller;

import com.baomidou.mybatisplus.core.metadata.IPage;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.example.common.AuditLog;
import com.example.common.Result;
import com.example.entity.User;
import com.example.entity.Volunteer;
import com.example.service.VolunteerService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.test.util.ReflectionTestUtils;

import java.lang.reflect.Method;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class VolunteerControllerTest {

    private VolunteerController controller;
    private VolunteerService service;

    @BeforeEach
    void setUp() {
        controller = new VolunteerController();
        service = mock(VolunteerService.class);
        ReflectionTestUtils.setField(controller, "volunteerService", service);
        when(service.page(any(IPage.class), any())).thenAnswer(invocation -> invocation.getArgument(0));
    }

    @Test
    void adminPaginationCapsSizeAndNormalizesPageNumber() {
        controller.findPage("", -5, 500);

        ArgumentCaptor<IPage> page = ArgumentCaptor.forClass(IPage.class);
        verify(service).page(page.capture(), any());
        assertEquals(1L, page.getValue().getCurrent());
        assertEquals(50L, page.getValue().getSize());
    }

    @Test
    void minePaginationCapsSizeAndNormalizesPageNumber() {
        User user = new User();
        user.setId(7L);
        Result<IPage<Volunteer>> result = controller.findMine("", "", "", 0, 1000, requestWith(user));

        assertEquals("0", result.getCode());
        assertEquals(1L, result.getData().getCurrent());
        assertEquals(50L, result.getData().getSize());
    }

    @Test
    void auditEndpointPassesAuthenticatedActorAndIsAudited() throws Exception {
        User manager = new User();
        manager.setId(1L);
        when(service.auditVolunteer(9L, 2, manager)).thenReturn(true);

        Result<?> result = controller.audit(9L, 2, requestWith(manager));

        assertEquals("0", result.getCode());
        verify(service).auditVolunteer(9L, 2, manager);
        Method method = VolunteerController.class.getMethod(
                "audit", Long.class, Integer.class, javax.servlet.http.HttpServletRequest.class);
        assertNotNull(method.getAnnotation(AuditLog.class));
    }

    private static MockHttpServletRequest requestWith(User user) {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.getSession(true).setAttribute("user", user);
        return request;
    }
}
