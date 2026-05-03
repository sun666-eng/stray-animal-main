package com.example.entity;

import lombok.Data;
import com.baomidou.mybatisplus.annotation.TableName;
import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.extension.activerecord.Model;
import com.baomidou.mybatisplus.annotation.TableId;
import com.fasterxml.jackson.annotation.JsonFormat;

import java.util.Date;

@Data
@TableName("t_visit")
public class Visit extends Model<Visit> {

    @TableId(value = "id", type = IdType.AUTO)
    private Long id;

    private Long petId;
    private Long uid;

    @JsonFormat(pattern = "yyyy-MM-dd", timezone = "GMT+8")
    private Date vtime;

    private Integer state;

    private String pic;

    private String remark;

    private String vname;
    private String aname;
}
