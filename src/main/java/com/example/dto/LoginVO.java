package com.example.dto;

import com.fasterxml.jackson.annotation.JsonInclude;

/**
 * 登录响应：仅 Session + CSRF。浏览器不再接收 JWT（A0.5 最终态）。
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public class LoginVO {

    private String csrfToken;
    private UserDTO user;

    public LoginVO() {
    }

    public LoginVO(String csrfToken, UserDTO user) {
        this.csrfToken = csrfToken;
        this.user = user;
    }

    public String getCsrfToken() {
        return csrfToken;
    }

    public void setCsrfToken(String csrfToken) {
        this.csrfToken = csrfToken;
    }

    public UserDTO getUser() {
        return user;
    }

    public void setUser(UserDTO user) {
        this.user = user;
    }
}
