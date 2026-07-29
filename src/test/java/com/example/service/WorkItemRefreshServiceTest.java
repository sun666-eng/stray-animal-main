package com.example.service;

import org.junit.jupiter.api.Test;
import org.mockito.InOrder;
import org.springframework.jdbc.core.JdbcTemplate;

import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class WorkItemRefreshServiceTest {

    @Test
    void locksSchemaRowBeforeMaterializingWorkItems() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        when(jdbc.queryForObject(anyString(), org.mockito.ArgumentMatchers.eq(String.class)))
                .thenReturn("2026.07.29-operations-p2-v12");
        WorkItemRefreshService service = new WorkItemRefreshService(jdbc);

        service.refresh();

        InOrder order = inOrder(jdbc);
        order.verify(jdbc).queryForObject(
                "SELECT meta_value FROM app_schema_meta WHERE meta_key='schema_version' FOR UPDATE",
                String.class);
        order.verify(jdbc, times(5)).update(anyString());
        verify(jdbc, times(5)).update(anyString());
    }
}
