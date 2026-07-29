package com.example.common;

import cn.hutool.json.JSONUtil;
import com.example.entity.User;
import org.aspectj.lang.ProceedingJoinPoint;
import org.aspectj.lang.annotation.Around;
import org.aspectj.lang.annotation.Aspect;
import org.aspectj.lang.annotation.Pointcut;
import org.aspectj.lang.reflect.MethodSignature;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.lang.reflect.Method;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.regex.Pattern;

@Aspect
@Component
public class AuditLogAspect {

    private static final Logger auditLogger = LoggerFactory.getLogger("AUDIT");
    private static final DateTimeFormatter FORMATTER = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");
    private static final Pattern SENSITIVE_JSON_FIELD = Pattern.compile(
            "(?i)(\\\"(?:password|token|authorization|api[_-]?key|secret|phone|tel|email|wechat|location|address)\\\"\\s*:\\s*\\\")(.*?)(\\\")");

    @Pointcut("@annotation(com.example.common.AuditLog)")
    public void auditPointcut() {
    }

    @Around("auditPointcut()")
    public Object around(ProceedingJoinPoint joinPoint) throws Throwable {
        LocalDateTime startTime = LocalDateTime.now();
        String startTimeStr = startTime.format(FORMATTER);

        MethodSignature signature = (MethodSignature) joinPoint.getSignature();
        Method method = signature.getMethod();
        AuditLog auditLog = method.getAnnotation(AuditLog.class);

        String module = auditLog.module();
        String action = auditLog.action();
        String methodName = signature.getDeclaringTypeName() + "." + signature.getName();
        String params = sanitizeParams(JSONUtil.toJsonStr(joinPoint.getArgs()));

        HttpServletRequest request = getRequest();
        String ip = getClientIp(request);
        String username = getUsername(request);

        Object result = null;
        boolean success = true;
        String errorMsg = null;

        try {
            result = joinPoint.proceed();
            if (!isSuccessfulResult(result)) {
                Result<?> apiResult = (Result<?>) result;
                success = false;
                errorMsg = apiResult.getMsg() == null ? "Result code=" + apiResult.getCode() : apiResult.getMsg();
            } else {
                HttpServletResponse response = findResponse(joinPoint.getArgs());
                if (response != null && !isSuccessfulHttpStatus(response.getStatus())) {
                    success = false;
                    errorMsg = "HTTP status=" + response.getStatus();
                }
            }
            return result;
        } catch (Throwable e) {
            success = false;
            errorMsg = e.getMessage();
            throw e;
        } finally {
            LocalDateTime endTime = LocalDateTime.now();
            long duration = java.time.Duration.between(startTime, endTime).toMillis();

            String logMessage = String.format(
                    "[审计日志] 时间: %s | 用户: %s | IP: %s | 模块: %s | 操作: %s | 方法: %s | 参数: %s | 结果: %s | 耗时: %dms | 错误: %s",
                    startTimeStr, username, ip, module, action, methodName,
                    truncate(params, 500), success ? "成功" : "失败", duration,
                    success ? "无" : truncate(errorMsg, 200)
            );

            if (success) {
                auditLogger.info(logMessage);
            } else {
                auditLogger.error(logMessage);
            }
        }
    }

    private HttpServletRequest getRequest() {
        ServletRequestAttributes attributes = (ServletRequestAttributes) RequestContextHolder.getRequestAttributes();
        return attributes != null ? attributes.getRequest() : null;
    }

    private String getClientIp(HttpServletRequest request) {
        if (request == null) {
            return "unknown";
        }
        String remote = request.getRemoteAddr();
        // 仅当直连地址为本地/环回（典型反向代理同机或本机）时信任转发头，避免客户端伪造
        if (!isTrustedProxyHop(remote)) {
            return remote == null || remote.isEmpty() ? "unknown" : remote;
        }
        String ip = request.getHeader("X-Forwarded-For");
        if (ip == null || ip.isEmpty() || "unknown".equalsIgnoreCase(ip)) {
            ip = request.getHeader("X-Real-IP");
        }
        if (ip == null || ip.isEmpty() || "unknown".equalsIgnoreCase(ip)) {
            ip = remote;
        }
        if (ip != null && ip.contains(",")) {
            ip = ip.split(",")[0].trim();
        }
        return ip == null || ip.isEmpty() ? "unknown" : ip;
    }

    static boolean isTrustedProxyHop(String remoteAddr) {
        if (remoteAddr == null || remoteAddr.isEmpty()) {
            return false;
        }
        String a = remoteAddr.trim().toLowerCase();
        return "127.0.0.1".equals(a)
                || "::1".equals(a)
                || "0:0:0:0:0:0:0:1".equals(a)
                || a.startsWith("10.")
                || a.startsWith("192.168.")
                || a.matches("172\\.(1[6-9]|2[0-9]|3[0-1])\\..*");
    }

    private String getUsername(HttpServletRequest request) {
        if (request == null) return "unknown";

        Object user = request.getSession().getAttribute("user");
        if (user instanceof User) {
            return ((User) user).getUsername();
        }
        return request.getAttribute("username") != null ? request.getAttribute("username").toString() : "anonymous";
    }

    private String truncate(String str, int maxLength) {
        if (str == null) return "null";
        return str.length() > maxLength ? str.substring(0, maxLength) + "..." : str;
    }

    static String sanitizeParams(String params) {
        if (params == null) {
            return null;
        }
        return SENSITIVE_JSON_FIELD.matcher(params).replaceAll("$1****$3");
    }

    static boolean isSuccessfulResult(Object result) {
        return !(result instanceof Result) || "0".equals(((Result<?>) result).getCode());
    }

    static boolean isSuccessfulHttpStatus(int status) {
        return status < 400;
    }

    private HttpServletResponse findResponse(Object[] args) {
        if (args == null) return null;
        for (Object arg : args) {
            if (arg instanceof HttpServletResponse) return (HttpServletResponse) arg;
        }
        return null;
    }
}
