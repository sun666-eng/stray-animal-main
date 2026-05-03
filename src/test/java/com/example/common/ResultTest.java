package com.example.common;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

public class ResultTest {

    @Test
    public void testSuccess() {
        Result<?> r = Result.success();
        assertEquals("0", r.getCode());
        assertEquals("成功", r.getMsg());
        assertNull(r.getData());
    }

    @Test
    public void testSuccessWithData() {
        Result<String> r = Result.success("hello");
        assertEquals("0", r.getCode());
        assertEquals("成功", r.getMsg());
        assertEquals("hello", r.getData());
    }

    @Test
    public void testError() {
        Result<?> r = Result.error("500", "服务器错误");
        assertEquals("500", r.getCode());
        assertEquals("服务器错误", r.getMsg());
        assertNull(r.getData());
    }
}
