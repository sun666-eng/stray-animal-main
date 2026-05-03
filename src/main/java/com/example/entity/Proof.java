package com.example.entity;

import lombok.Data;
import com.baomidou.mybatisplus.annotation.TableName;
import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.extension.activerecord.Model;
import com.baomidou.mybatisplus.annotation.TableId;

@Data
@TableName("t_proof")
public class Proof extends Model<Proof> {

    @TableId(value = "id", type = IdType.AUTO)
    private Long id;

    private Long paid;
    private Long puid;
    private String aname;
    private String uname;

    private String ppic;

    private String ptitle;
}
