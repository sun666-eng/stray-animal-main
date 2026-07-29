package com.example.entity;

import lombok.Data;
import com.baomidou.mybatisplus.annotation.TableName;
import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.extension.activerecord.Model;
import com.baomidou.mybatisplus.annotation.TableId;
import com.fasterxml.jackson.annotation.JsonFormat;

import java.util.Date;

@Data
@TableName("t_proof")
public class Proof extends Model<Proof> {

    @TableId(value = "id", type = IdType.AUTO)
    private Long id;

    private Long paid;
    private Long puid;
    private String aname;
    private String uname;

    private String ppic;

    private String ptitle;

    /** 0待审核 1已通过 2已驳回 */
    private Integer pstatus;

    /** pre_audit 审核前材料 / handover 交接材料 / post_adoption 领养后材料 */
    private String proofStage;
    private Long reviewerId;
    private String reviewReason;
    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss", timezone = "GMT+8")
    private Date reviewedAt;
    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss", timezone = "GMT+8")
    private Date createdAt;
    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss", timezone = "GMT+8")
    private Date updatedAt;
}
