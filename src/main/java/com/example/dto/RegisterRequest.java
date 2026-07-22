package com.example.dto;

import lombok.Data;

import javax.validation.constraints.Email;
import javax.validation.constraints.NotBlank;
import javax.validation.constraints.Pattern;
import javax.validation.constraints.Size;

@Data
public class RegisterRequest {

    @NotBlank(message = "用户名不能为空")
    @Size(min = 2, max = 32, message = "用户名长度须为 2–32")
    @Pattern(regexp = "^[\\u4e00-\\u9fa5a-zA-Z0-9_\\-.]+$", message = "用户名仅允许中文、字母、数字、下划线、短横线和点")
    private String username;

    @NotBlank(message = "密码不能为空")
    private String password;

    @Email(message = "邮箱格式不正确")
    private String email;

    private String phone;

    private String avatar;
}
