package com.example.entity;

import lombok.Data;
import com.baomidou.mybatisplus.annotation.TableName;
import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.extension.activerecord.Model;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.FieldStrategy;
import com.baomidou.mybatisplus.annotation.TableField;
import com.example.common.StrictDateDeserializer;
import com.fasterxml.jackson.annotation.JsonFormat;
import com.fasterxml.jackson.databind.annotation.JsonDeserialize;

import java.util.Date;

@Data
@TableName("t_animal")
public class Animal extends Model<Animal> {

    @TableId(value = "id", type = IdType.AUTO)
    private Long id;

    private String tname;

    private String ttype;

    private String tsex;

    @JsonFormat(pattern = "yyyy-MM-dd", timezone = "GMT+8")
    @JsonDeserialize(using = StrictDateDeserializer.class)
    @TableField(updateStrategy = FieldStrategy.ALWAYS)
    private Date tbirthday;

    private String tpic;

    private Integer tstate;

    private String tdescribe;
}
