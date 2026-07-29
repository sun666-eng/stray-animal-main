package com.example.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

import java.util.Date;

@Data
@TableName("t_petcare_request")
public class PetCareRequest {

    @TableId(value = "id", type = IdType.AUTO)
    private Long id;
    private Long userId;
    private String requestId;
    private Long conversationId;
    private Long requestedConversationId;
    private Boolean requestedConversationKnown;
    private String question;
    private String status;
    private String answer;
    private String source;
    private String degradeReason;
    private String topic;
    private String toolsJson;
    private String conversationTitle;
    private String errorCode;
    private String errorMessage;
    private Integer attemptCount;
    private Date createdAt;
    private Date updatedAt;
    private Date completedAt;
}
