package com.example.exception;

import cn.hutool.log.Log;
import cn.hutool.log.LogFactory;
import com.example.common.Result;
import org.springframework.validation.FieldError;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ControllerAdvice;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.ResponseBody;

import javax.servlet.http.HttpServletRequest;
import java.util.stream.Collectors;

@ControllerAdvice(basePackages="com.example.controller")
public class GlobalExceptionHandler {

    private static final Log log = LogFactory.get();

    @ExceptionHandler(Exception.class)
    @ResponseBody
    public Result<?> error(HttpServletRequest request, Exception e){
        log.error("异常信息：",e);
        return Result.error("-1", "系统异常");
    }

    @ExceptionHandler(CustomException.class)
    @ResponseBody
    public Result<?> customError(HttpServletRequest request, CustomException e){
        return Result.error(e.getCode(), e.getMsg());
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    @ResponseBody
    public Result<?> validationError(HttpServletRequest request, MethodArgumentNotValidException e) {
        String msg = e.getBindingResult().getFieldErrors().stream()
                .map(FieldError::getDefaultMessage)
                .collect(Collectors.joining("; "));
        return Result.error("400", msg);
    }
}
