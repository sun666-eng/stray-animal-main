package com.example.entity;

import lombok.Data;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableName;
import com.baomidou.mybatisplus.extension.activerecord.Model;

/**
 * 复合主键 (aid, uid)：MyBatis-Plus 不支持复合 @TableId，
 * 所有按键操作一律显式 .eq("aid",..).eq("uid",..)（历史上引入的
 * mybatisplus-plus @MppMultiId 从未被调用，已随 Boot3 迁移移除）。
 */
@Data
@TableName("t_adopt")
public class Adopt extends Model<Adopt> {

    @TableField(value = "aid")
    private Long aid;

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
