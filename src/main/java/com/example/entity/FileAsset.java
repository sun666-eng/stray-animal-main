package com.example.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

import java.util.Date;

@Data
@TableName("t_file_asset")
public class FileAsset {
    @TableId(type = IdType.AUTO)
    private Long id;
    private String flag;
    private String storedName;
    private String originalName;
    private Long ownerId;
    /** animal / avatar / notice / proof / visit / volunteer / help / private */
    private String purpose;
    /** public / private */
    private String visibility;
    private String businessType;
    private Long businessId;
    private String contentType;
    private Long sizeBytes;
    private Date createdAt;
    private Date boundAt;
    private Integer deleted;
}
