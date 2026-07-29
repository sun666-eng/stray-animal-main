-- 用户级照顾助手 API 配置。
-- API Key 只保存 AES-GCM 密文；调用方必须先选择目标业务库。
-- Schema contract: 2026.07.29-workflow-operations-v11.

CREATE TABLE IF NOT EXISTS t_petcare_ai_config (
  user_id BIGINT NOT NULL COMMENT '登录用户ID，一名用户一条配置',
  enabled TINYINT(1) NOT NULL DEFAULT 1 COMMENT '是否启用个人Agent',
  base_url VARCHAR(500) NOT NULL COMMENT 'OpenAI兼容API Base URL',
  model VARCHAR(120) NOT NULL COMMENT '模型名称',
  api_key_ciphertext TEXT NOT NULL COMMENT 'AES-GCM密文，禁止保存明文',
  connection_status VARCHAR(16) NOT NULL DEFAULT 'untested' COMMENT 'untested/connected/failed',
  last_test_message VARCHAR(500) NOT NULL DEFAULT '' COMMENT '不含密钥的最近连接摘要',
  last_tested_at DATETIME(3) DEFAULT NULL COMMENT '最近真实连接时间',
  version BIGINT NOT NULL DEFAULT 1 COMMENT '配置乐观版本',
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  PRIMARY KEY (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='照顾助手用户级加密API配置';

SET @table_exists := (SELECT COUNT(*) FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 't_petcare_ai_config');
SET @exists := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 't_petcare_ai_config' AND COLUMN_NAME = 'connection_status');
SET @sql := IF(@table_exists = 1 AND @exists = 0,
  'ALTER TABLE t_petcare_ai_config ADD COLUMN connection_status VARCHAR(16) NOT NULL DEFAULT ''untested'' AFTER api_key_ciphertext',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @exists := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 't_petcare_ai_config' AND COLUMN_NAME = 'last_test_message');
SET @sql := IF(@table_exists = 1 AND @exists = 0,
  'ALTER TABLE t_petcare_ai_config ADD COLUMN last_test_message VARCHAR(500) NOT NULL DEFAULT '''' AFTER connection_status',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @exists := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 't_petcare_ai_config' AND COLUMN_NAME = 'last_tested_at');
SET @sql := IF(@table_exists = 1 AND @exists = 0,
  'ALTER TABLE t_petcare_ai_config ADD COLUMN last_tested_at DATETIME(3) NULL DEFAULT NULL AFTER last_test_message',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @exists := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 't_petcare_ai_config' AND COLUMN_NAME = 'version');
SET @sql := IF(@table_exists = 1 AND @exists = 0,
  'ALTER TABLE t_petcare_ai_config ADD COLUMN version BIGINT NOT NULL DEFAULT 1 AFTER last_tested_at',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
