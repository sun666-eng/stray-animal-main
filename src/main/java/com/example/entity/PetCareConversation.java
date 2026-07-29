package com.example.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

import java.util.Date;

/**
 * 照顾知识助手的一次可恢复会话。
 */
@Data
@TableName("t_petcare_conversation")
public class PetCareConversation {

    @TableId(value = "id", type = IdType.AUTO)
    private Long id;

    private Long userId;

    private String title;

    private String preview;

    private Integer turnCount;

    private Date createdAt;

    private Date updatedAt;
}
