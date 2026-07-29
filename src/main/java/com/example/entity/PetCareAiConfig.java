package com.example.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

import java.util.Date;

/**
 * 用户级照顾助手连接配置。
 *
 * <p>API Key 只允许以 AES-GCM 密文写入 api_key_ciphertext，禁止在本实体增加明文字段。
 */
@Data
@TableName("t_petcare_ai_config")
public class PetCareAiConfig {

    @TableId(value = "user_id", type = IdType.INPUT)
    private Long userId;

    private Boolean enabled;

    private String baseUrl;

    private String model;

    private String apiKeyCiphertext;

    /**
     * untested / connected / failed。配置完整不代表服务商已接受该配置。
     */
    private String connectionStatus;

    private String lastTestMessage;

    private Date lastTestedAt;

    private Long version;

    private Date createdAt;

    private Date updatedAt;
}
