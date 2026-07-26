package com.example.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public class ChatMessageRequest {

    @NotBlank(message = "消息内容不能为空")
    @Size(max = 500, message = "消息内容不能超过500个字符")
    private String text;

    public String getText() {
        return text;
    }

    public void setText(String text) {
        this.text = text;
    }
}
