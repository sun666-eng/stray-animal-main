package com.example.exception;

import cn.hutool.log.Log;
import cn.hutool.log.LogFactory;
import com.example.common.Result;
import org.springframework.http.ResponseEntity;
import org.springframework.validation.FieldError;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ControllerAdvice;
import org.springframework.web.bind.annotation.ExceptionHandler;

import javax.servlet.http.HttpServletRequest;
import java.util.stream.Collectors;

/**
 * A0.6：业务错误码与真实 HTTP 状态对齐，供前端 auth-session 识别 401 等。
 */
@ControllerAdvice(basePackages = "com.example.controller")
public class GlobalExceptionHandler {

    private static final Log log = LogFactory.get();

    @ExceptionHandler(Exception.class)
    public ResponseEntity<Result<?>> error(HttpServletRequest request, Exception e) {
        log.error("异常信息：", e);
        return ResponseEntity.status(500).body(Result.error("500", "系统异常"));
    }

    @ExceptionHandler(CustomException.class)
    public ResponseEntity<Result<?>> customError(HttpServletRequest request, CustomException e) {
        int status = HttpStatusException.mapCodeToStatus(e.getCode());
        String code = e.getCode() == null ? String.valueOf(status) : e.getCode();
        return ResponseEntity.status(status).body(Result.error(code, e.getMsg()));
    }

    @ExceptionHandler(HttpStatusException.class)
    public ResponseEntity<Result<?>> httpStatusError(HttpServletRequest request, HttpStatusException e) {
        return ResponseEntity.status(e.getHttpStatus()).body(Result.error(e.getCode(), e.getMsg()));
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<Result<?>> validationError(HttpServletRequest request, MethodArgumentNotValidException e) {
        String msg = e.getBindingResult().getFieldErrors().stream()
                .map(FieldError::getDefaultMessage)
                .collect(Collectors.joining("; "));
        return ResponseEntity.status(400).body(Result.error("400", msg));
    }
}
