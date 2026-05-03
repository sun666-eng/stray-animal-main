package com.example.entity;

import lombok.Data;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableName;
import com.baomidou.mybatisplus.extension.activerecord.Model;
import com.github.jeffreyning.mybatisplus.anno.MppMultiId;

@Data
@TableName("t_adopt")
public class Adopt extends Model<Adopt> {

    @MppMultiId
    @TableField(value = "aid")
    private Long aid;

    @MppMultiId
    @TableField(value = "uid")
    private Long uid;

    private String gender;

    private Integer age;

    private Integer maritalstatus;

    private String occupation;

    private Long tel;

    private String location;

    private Integer fixresident;

    private Integer income;

    private Integer experience;

    private Integer petnum;

    private Integer familyagree;

    private String wechat;

    private Integer vstate;

    private String uname;
    private String apic;
    private String aname;
}
