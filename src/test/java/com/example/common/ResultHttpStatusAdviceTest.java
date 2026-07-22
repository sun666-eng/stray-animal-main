package com.example.common;

import org.junit.jupiter.api.Test;
import org.springframework.core.MethodParameter;
import org.springframework.http.MediaType;
import org.springframework.http.server.ServletServerHttpRequest;
import org.springframework.http.server.ServletServerHttpResponse;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

import static org.junit.jupiter.api.Assertions.assertEquals;

/**
 * A0.6：Result 响应体应驱动真实 HTTP 状态。
 */
public class ResultHttpStatusAdviceTest {

    @Test
    public void setsHttp401_whenBodyCodeIs401() throws Exception {
        ResultHttpStatusAdvice advice = new ResultHttpStatusAdvice();
        MockHttpServletRequest req = new MockHttpServletRequest();
        MockHttpServletResponse res = new MockHttpServletResponse();
        MethodParameter param = new MethodParameter(
                ResultHttpStatusAdviceTest.class.getDeclaredMethod("sampleResult"), -1);

        advice.beforeBodyWrite(
                Result.error("401", "未登录或登录已过期"),
                param,
                MediaType.APPLICATION_JSON,
                null,
                new ServletServerHttpRequest(req),
                new ServletServerHttpResponse(res));

        assertEquals(401, res.getStatus());
    }

    @Test
    public void keeps200_whenSuccess() throws Exception {
        ResultHttpStatusAdvice advice = new ResultHttpStatusAdvice();
        MockHttpServletRequest req = new MockHttpServletRequest();
        MockHttpServletResponse res = new MockHttpServletResponse();
        MethodParameter param = new MethodParameter(
                ResultHttpStatusAdviceTest.class.getDeclaredMethod("sampleResult"), -1);

        advice.beforeBodyWrite(
                Result.success(),
                param,
                MediaType.APPLICATION_JSON,
                null,
                new ServletServerHttpRequest(req),
                new ServletServerHttpResponse(res));

        assertEquals(200, res.getStatus());
    }

    @SuppressWarnings("unused")
    private Result<?> sampleResult() {
        return Result.success();
    }
}
