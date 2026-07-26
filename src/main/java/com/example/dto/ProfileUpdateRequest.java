package com.example.dto;

import lombok.Data;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.Size;

@Data
public class ProfileUpdateRequest {

    @Email(message = "邮箱格式不正确")
    @Size(max = 255, message = "邮箱不能超过255个字符")
    private String email;

    @Size(max = 30, message = "联系电话不能超过30个字符")
    private String phone;

    @Size(max = 64, message = "头像标识不能超过64个字符")
    private String avatar;
}
