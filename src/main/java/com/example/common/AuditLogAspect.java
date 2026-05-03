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

import javax.servlet.http.HttpServletRequest;
import java.lang.reflect.Method;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;

@Aspect
@Component
public class AuditLogAspect {

    private static final Logger auditLogger = LoggerFactory.getLogger("AUDIT");
    private static final DateTimeFormatter FORMATTER = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");

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
        String params = JSONUtil.toJsonStr(joinPoint.getArgs());

        HttpServletRequest request = getRequest();
        String ip = getClientIp(request);
        String username = getUsername(request);

        Object result = null;
        boolean success = true;
        String errorMsg = null;

        try {
            result = joinPoint.proceed();
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
        if (request == null) return "unknown";

        String ip = request.getHeader("X-Forwarded-For");
        if (ip == null || ip.isEmpty() || "unknown".equalsIgnoreCase(ip)) {
            ip = request.getHeader("Proxy-Client-IP");
        }
        if (ip == null || ip.isEmpty() || "unknown".equalsIgnoreCase(ip)) {
            ip = request.getHeader("WL-Proxy-Client-IP");
        }
        if (ip == null || ip.isEmpty() || "unknown".equalsIgnoreCase(ip)) {
            ip = request.getHeader("X-Real-IP");
        }
        if (ip == null || ip.isEmpty() || "unknown".equalsIgnoreCase(ip)) {
            ip = request.getRemoteAddr();
        }
        if (ip != null && ip.contains(",")) {
            ip = ip.split(",")[0].trim();
        }
        return ip;
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
}
