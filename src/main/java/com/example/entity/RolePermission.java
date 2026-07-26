package com.example.entity;

import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

/**
 * 角色-权限关联行（规范化 Phase 1）。
 * 复合主键 (role_id, permission_id)：MyBatis-Plus 不支持复合 @TableId，
 * 按键操作一律显式 .eq("role_id",..).eq("permission_id",..)。
 */
@Data
@TableName("role_permission")
public class RolePermission {

    @TableField("role_id")
    private Long roleId;

    @TableField("permission_id")
    private Long permissionId;
}
