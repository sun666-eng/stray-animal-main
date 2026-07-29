package com.example.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.baomidou.mybatisplus.extension.activerecord.Model;
import com.fasterxml.jackson.annotation.JsonFormat;
import lombok.Data;

import java.util.Date;

@Data
@TableName("t_workflow_event")
public class WorkflowEvent extends Model<WorkflowEvent> {
    @TableId(value = "id", type = IdType.AUTO)
    private Long id;
    private String businessType;
    private String businessId;
    private Integer fromState;
    private Integer toState;
    private String action;
    private Long actorId;
    private String actorType;
    private String reason;
    private String requestId;
    private String metadataJson;
    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss", timezone = "GMT+8")
    private Date createdAt;
}
