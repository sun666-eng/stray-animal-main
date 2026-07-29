package com.example.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.baomidou.mybatisplus.extension.activerecord.Model;
import com.fasterxml.jackson.annotation.JsonFormat;
import lombok.Data;
import java.util.Date;

@Data
@TableName("t_visit_plan")
public class VisitPlan extends Model<VisitPlan> {
    @TableId(value="id", type=IdType.AUTO) private Long id;
    private Long aid;
    private Long uid;
    private String planType;
    @JsonFormat(pattern="yyyy-MM-dd", timezone="GMT+8") private Date dueAt;
    /** 0待执行 1已完成 2已逾期 3已取消 4异常待处理 */
    private Integer status;
    private Long assigneeId;
    private Long completedVisitId;
    @JsonFormat(pattern="yyyy-MM-dd HH:mm:ss", timezone="GMT+8") private Date createdAt;
    @JsonFormat(pattern="yyyy-MM-dd HH:mm:ss", timezone="GMT+8") private Date updatedAt;
}
