package com.example.exception;

/**
 * 携带业务 code/msg 并映射到真实 HTTP 状态（A0.6）。
 */
public class HttpStatusException extends RuntimeException {
    private final int httpStatus;
    private final String code;
    private final String msg;

    public HttpStatusException(int httpStatus, String code, String msg) {
        super(msg);
        this.httpStatus = httpStatus;
        this.code = code;
        this.msg = msg;
    }

    public static HttpStatusException ofCode(String code, String msg) {
        int status = mapCodeToStatus(code);
        return new HttpStatusException(status, code == null ? String.valueOf(status) : code, msg);
    }

    public static int mapCodeToStatus(String code) {
        if (code == null) {
            return 500;
        }
        switch (code) {
            case "400":
                return 400;
            case "401":
                return 401;
            case "403":
                return 403;
            case "404":
                return 404;
            case "429":
                return 429;
            case "0":
                return 200;
            default:
                // 业务 "-1" 等视为 400 或 500：认证类用 401，其余默认 400
                if ("-1".equals(code)) {
                    return 400;
                }
                try {
                    int n = Integer.parseInt(code);
                    if (n >= 400 && n < 600) {
                        return n;
                    }
                } catch (NumberFormatException ignored) {
                    // fall through
                }
                return 500;
        }
    }

    public int getHttpStatus() {
        return httpStatus;
    }

    public String getCode() {
        return code;
    }

    public String getMsg() {
        return msg;
    }
}
