package com.example.exception;

import com.example.common.Result;
import org.junit.jupiter.api.Test;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

public class GlobalExceptionHandlerTest {

    @Test
    public void unreadableJson_isReportedAsBadRequest() {
        GlobalExceptionHandler handler = new GlobalExceptionHandler();
        ResponseEntity<Result<?>> response = handler.unreadableJson(
                new MockHttpServletRequest(), new HttpMessageNotReadableException("invalid date"));

        assertEquals(400, response.getStatusCodeValue());
        assertNotNull(response.getBody());
        assertEquals("400", response.getBody().getCode());
    }

    @Test
    public void pathVariableTypeMismatch_isReportedAsBadRequest() {
        GlobalExceptionHandler handler = new GlobalExceptionHandler();
        MethodArgumentTypeMismatchException ex = new MethodArgumentTypeMismatchException(
                "my", Long.class, "id", null, new NumberFormatException("For input string: \"my\""));
        ResponseEntity<Result<?>> response = handler.typeMismatch(new MockHttpServletRequest(), ex);

        assertEquals(400, response.getStatusCodeValue());
        assertNotNull(response.getBody());
        assertEquals("400", response.getBody().getCode());
        assertTrue(response.getBody().getMsg().contains("id"));
    }
}
