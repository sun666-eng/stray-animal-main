package com.example.common;

import com.example.exception.CustomException;

import java.util.regex.Pattern;

/**
 * 用户名策略：纵深防御，不能替代输出转义。
 * 允许中文、字母、数字、下划线、短横线、点；长度 2–32。
 */
public final class UsernamePolicy {

    private static final Pattern SAFE = Pattern.compile("^[\\u4e00-\\u9fa5a-zA-Z0-9_\\-.]{2,32}$");

    private UsernamePolicy() {
    }

    public static boolean isValid(String username) {
        return username != null && SAFE.matcher(username).matches();
    }

    public static void requireValid(String username) {
        if (!isValid(username)) {
            throw new CustomException("400", "用户名仅允许中文、字母、数字、下划线、短横线和点，长度 2–32");
        }
    }

    /**
     * 典型存储型 XSS 用户名载荷（修复后应全部拒绝）。
     */
    public static String[] xssProbeUsernames() {
        return new String[]{
                "<img src=x onerror=alert(1)>",
                "<svg onload=alert(1)>",
                "a\"><script>alert(1)</script>",
                "admin<script>",
                "x onmouseover=alert(1)"
        };
    }
}
