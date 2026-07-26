package com.example.controller;

import com.baomidou.mybatisplus.core.conditions.Wrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.example.common.Result;
import com.example.entity.Notice;
import com.example.exception.CustomException;
import com.example.service.NoticeService;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import java.util.Collections;
import com.example.entity.Permission;
import com.example.entity.User;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

class NoticeControllerTest {
    @Test
    void publicPageBoundsPaginationAndSearch() {
        NoticeService service = mock(NoticeService.class);
        NoticeController controller = new NoticeController();
        ReflectionTestUtils.setField(controller, "noticeService", service);
        when(service.page(any(Page.class), any(Wrapper.class))).thenReturn(new Page<Notice>());

        controller.findPage("公告", Integer.MAX_VALUE, 999);
        ArgumentCaptor<Page> page = ArgumentCaptor.forClass(Page.class);
        verify(service).page(page.capture(), any(Wrapper.class));
        assertEquals(10000L, page.getValue().getCurrent());
        assertEquals(50L, page.getValue().getSize());
        assertEquals("400", assertThrows(CustomException.class,
                () -> controller.findPage(repeat('x', 101), 1, 10)).getCode());
    }

    @Test
    void missingDetailIs404() {
        NoticeService service = mock(NoticeService.class);
        NoticeController controller = new NoticeController();
        ReflectionTestUtils.setField(controller, "noticeService", service);
        Result<Notice> result = controller.findById(5L);
        assertEquals("404", result.getCode());
    }

    @Test
    void exportRejectsRowsInsertedAfterCountWithBoundedProbe() {
        NoticeService service = mock(NoticeService.class);
        NoticeController controller = new NoticeController();
        ReflectionTestUtils.setField(controller, "noticeService", service);
        when(service.count()).thenReturn(10000L);
        when(service.list(any(Wrapper.class))).thenReturn(Collections.nCopies(10001, new Notice()));

        CustomException exception = assertThrows(CustomException.class,
                () -> controller.export(requestWithNoticePermission(), new MockHttpServletResponse()));

        assertEquals("413", exception.getCode());
        verify(service).list(any(Wrapper.class));
    }

    private MockHttpServletRequest requestWithNoticePermission() {
        User user = new User();
        Permission permission = new Permission();
        permission.setFlag("notice");
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
