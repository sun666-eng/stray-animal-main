package com.example.entity;

import lombok.Data;
import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.baomidou.mybatisplus.extension.activerecord.Model;

@Data
@TableName("t_permission")
public class Permission extends Model<Permission> {

    @TableId(value = "id", type = IdType.AUTO)
    private Long id;

    private String name;

    private String path;

    private String description;

    private String flag;
}
