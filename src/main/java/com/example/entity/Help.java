package com.example.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.baomidou.mybatisplus.extension.activerecord.Model;
import com.fasterxml.jackson.annotation.JsonFormat;
import lombok.Data;

import jakarta.validation.constraints.NotBlank;
import java.util.Date;

@Data
@TableName("t_help")
public class Help extends Model<Help> {

    @TableId(value = "id", type = IdType.AUTO)
    private Long id;

    private Long uid;

    private String uname;

    @NotBlank(message = "标题不能为空")
    private String title;

    @NotBlank(message = "描述不能为空")
    private String description;

    @NotBlank(message = "地点不能为空")
    private String location;

    private String phone;

    private String pic;

    private Integer status;

    /**
     * 审计修复 M4：管理端清空回复时 normalizeOptional 归一为 null，默认更新策略会
     * 静默跳过 null 字段导致"提示成功但回复没清掉"。ALWAYS 使 null 真正落库。
     * 注意：唯一的 updateById 调用点（HelpService.updateHelp）在 manage/owner
     * 两条路径都显式设置了 remark，不存在误清空面。
     */
    @com.baomidou.mybatisplus.annotation.TableField(updateStrategy = com.baomidou.mybatisplus.annotation.FieldStrategy.ALWAYS)
    private String remark;

    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss", timezone = "GMT+8")
    private Date createTime;

    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss", timezone = "GMT+8")
    private Date updateTime;
}
