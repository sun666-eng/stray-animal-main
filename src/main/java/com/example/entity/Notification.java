package com.example.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.baomidou.mybatisplus.extension.activerecord.Model;
import com.fasterxml.jackson.annotation.JsonFormat;
import lombok.Data;

import java.util.Date;

@Data
@TableName("t_notification")
public class Notification extends Model<Notification> {
    @TableId(value = "id", type = IdType.AUTO)
    private Long id;
    private Long userId;
    private String type;
    private String title;
    private String summary;
    private String businessType;
    private String businessId;
    private String targetUrl;
    private Integer readFlag;
    private String eventKey;
    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss", timezone = "GMT+8")
    private Date createdAt;
    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss", timezone = "GMT+8")
    private Date readAt;
}
