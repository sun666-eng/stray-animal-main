package com.example.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.baomidou.mybatisplus.extension.activerecord.Model;
import com.fasterxml.jackson.annotation.JsonFormat;
import lombok.Data;

import java.util.Date;

/**
 * 照顾知识助手的一轮持久化问答。
 *
 * <p>API Key 与模型请求原文不会写入此表；只保存最终问题、回答及必要的来源信息。
 */
@Data
@TableName("t_petcare_chat")
public class PetCareChat extends Model<PetCareChat> {

    @TableId(value = "id", type = IdType.AUTO)
    private Long id;

    private Long userId;

    private Long conversationId;

    private String question;

    private String answer;

    private String source;

    private String degradeReason;

    private String topic;

    private String toolsJson;

    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss", timezone = "GMT+8")
    private Date questionTime;

    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss", timezone = "GMT+8")
    private Date answerTime;
}
