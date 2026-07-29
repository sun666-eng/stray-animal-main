package com.example.service;

import com.example.exception.CustomException;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;

import java.util.Collections;
import java.util.HashMap;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class OperationsServiceTest {

    @Test
    void cannotForgeAnotherAdministratorsAssignment() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        WorkflowEventService workflow = mock(WorkflowEventService.class);
        OperationsService service = new OperationsService(jdbc, mock(NotificationService.class), workflow,
                mock(WorkItemRefreshService.class), mock(FileAssetService.class));
        Map<String, Object> row = new HashMap<>();
        row.put("id", 7L);
        row.put("status", 0);
        row.put("version", 3);
        row.put("business_type", "proof");
        row.put("business_id", "9");
        when(jdbc.queryForList(anyString(), eq(7L))).thenReturn(Collections.singletonList(row));
        Map<String, Object> body = new HashMap<>();
        body.put("expectedVersion", 3);
        body.put("status", 1);
        body.put("priority", 2);
        body.put("assigneeId", 99L);

        CustomException error = assertThrows(CustomException.class,
                () -> service.updateWorkItem(5L, 7L, body));

        assertEquals("403", error.getCode());
        verify(jdbc, never()).update(anyString(),
                org.mockito.ArgumentMatchers.<Object[]>any());
    }
}
