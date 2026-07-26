package com.example.service;

import com.example.entity.Notice;
import com.example.exception.CustomException;
import com.example.mapper.NoticeMapper;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;
import static org.mockito.Mockito.verify;

@ExtendWith(MockitoExtension.class)
class NoticeServiceTest {
    @Mock NoticeMapper mapper;
    @InjectMocks NoticeService service;

    @Test
    void validatesPlainTextFieldsAndFalseInsert() {
        Notice blank = new Notice();
        blank.setTitle(" ");
        blank.setContent("content");
        assertEquals("400", assertThrows(CustomException.class,
                () -> service.saveNotice(blank)).getCode());

        Notice notice = notice();
        when(mapper.insert(any(Notice.class))).thenReturn(0);
        assertEquals("500", assertThrows(CustomException.class,
                () -> service.saveNotice(notice)).getCode());
    }

    @Test
    void updateMissingIs404() {
        Notice notice = notice();
        notice.setId(8L);
        when(mapper.selectOne(any())).thenReturn(null);
        assertEquals("404", assertThrows(CustomException.class,
                () -> service.updateNotice(notice)).getCode());
    }

    @Test
    void updateLocksRowBeforeLastWriteWinsUpdate() {
        Notice notice = notice();
        notice.setId(8L);
        when(mapper.selectOne(any())).thenReturn(notice);
        when(mapper.updateById(notice)).thenReturn(1);

        service.updateNotice(notice);

        verify(mapper).selectOne(any());
        verify(mapper).updateById(notice);
    }

    private Notice notice() {
        Notice notice = new Notice();
        notice.setTitle("标题");
        notice.setContent("纯文本内容");
        return notice;
    }
}
