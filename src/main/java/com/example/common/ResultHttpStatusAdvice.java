package com.example.common;

import com.example.exception.HttpStatusException;
import org.springframework.core.MethodParameter;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageConverter;
import org.springframework.http.server.ServerHttpRequest;
import org.springframework.http.server.ServerHttpResponse;
import org.springframework.http.server.ServletServerHttpResponse;
import org.springframework.web.bind.annotation.ControllerAdvice;
import org.springframework.web.servlet.mvc.method.annotation.ResponseBodyAdvice;

import javax.servlet.http.HttpServletResponse;

/**
 * A0.6：当 Controller 直接返回 {@link Result}（非 ResponseEntity）时，
 * 按 body.code 写入真实 HTTP 状态，避免 200 + code=401 导致前端不清理登录态。
 */
@ControllerAdvice(basePackages = "com.example.controller")
public class ResultHttpStatusAdvice implements ResponseBodyAdvice<Object> {

    @Override
    public boolean supports(MethodParameter returnType, Class<? extends HttpMessageConverter<?>> converterType) {
        return true;
    }

    @Override
    public Object beforeBodyWrite(Object body, MethodParameter returnType, MediaType selectedContentType,
                                  Class<? extends HttpMessageConverter<?>> selectedConverterType,
                                  ServerHttpRequest request, ServerHttpResponse response) {
        if (body instanceof Result) {
            Result<?> result = (Result<?>) body;
            String code = result.getCode();
            if (code != null && !"0".equals(code)) {
                int status = HttpStatusException.mapCodeToStatus(code);
                if (response instanceof ServletServerHttpResponse) {
                    HttpServletResponse raw = ((ServletServerHttpResponse) response).getServletResponse();
                    // 不覆盖已由 ResponseEntity 设置的非 200 状态
                    if (raw.getStatus() == HttpServletResponse.SC_OK || raw.getStatus() == 0) {
                        response.setStatusCode(org.springframework.http.HttpStatus.valueOf(status));
                    }
                } else {
                    response.setStatusCode(org.springframework.http.HttpStatus.valueOf(status));
                }
            }
        }
        return body;
    }
}
