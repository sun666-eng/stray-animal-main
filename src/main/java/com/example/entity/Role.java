package com.example.entity;

import lombok.Data;
import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.baomidou.mybatisplus.extension.activerecord.Model;
import com.baomidou.mybatisplus.extension.handlers.JacksonTypeHandler;

import java.util.List;

@Data
@TableName(value = "t_role", autoResultMap = true)
public class Role extends Model<Role> {

    @TableId(value = "id", type = IdType.AUTO)
    private Long id;

    private String name;

    private String description;

    @TableField(typeHandler = JacksonTypeHandler.class)
    private List<Permission> permission;
}
