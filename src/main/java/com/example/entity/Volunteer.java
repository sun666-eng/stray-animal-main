package com.example.entity;

import lombok.Data;
import com.baomidou.mybatisplus.annotation.TableName;
import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.extension.activerecord.Model;
import com.baomidou.mybatisplus.annotation.TableId;

@Data
@TableName("t_volunteer")
public class Volunteer extends Model<Volunteer> {

    @TableId(value = "id", type = IdType.AUTO)
    private Long id;

    private String company;

    private String email;

    private Integer age;

    private Integer isvisit;

    private String location;

    private String moreability;

    private String name;

    private Integer sparetime;

    private String tel;

    private Integer vstate;

    private String wechat;
}
