-- 照顾知识助手：可命名、可恢复的用户级会话。
-- 旧 t_petcare_chat 数据的 conversation_id 保持 NULL，用户首次读取会话列表时自动归档。
-- Schema contract: 2026.07.29-operations-p2-v12.

CREATE TABLE IF NOT EXISTS t_petcare_conversation (
  id BIGINT NOT NULL AUTO_INCREMENT,
  user_id BIGINT NOT NULL COMMENT '登录用户ID',
  title VARCHAR(60) NOT NULL COMMENT '用户可修改的会话标题',
  preview VARCHAR(100) NOT NULL DEFAULT '' COMMENT '最近问题概括',
  turn_count INT NOT NULL DEFAULT 0 COMMENT '问答轮数',
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  KEY idx_petcare_conversation_user (user_id, updated_at, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='照顾知识助手会话目录';

SET @table_exists := (SELECT COUNT(*) FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 't_petcare_chat');
SET @exists := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 't_petcare_chat'
    AND COLUMN_NAME = 'conversation_id');
SET @sql := IF(@table_exists = 1 AND @exists = 0,
  'ALTER TABLE t_petcare_chat ADD COLUMN conversation_id BIGINT NULL DEFAULT NULL AFTER user_id',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @exists := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 't_petcare_chat'
    AND COLUMN_NAME = 'degrade_reason');
SET @sql := IF(@table_exists = 1 AND @exists = 0,
  'ALTER TABLE t_petcare_chat ADD COLUMN degrade_reason VARCHAR(500) NOT NULL DEFAULT '''' AFTER source',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @exists := (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 't_petcare_chat'
    AND INDEX_NAME = 'idx_petcare_conversation');
SET @sql := IF(@table_exists = 1 AND @exists = 0,
  'ALTER TABLE t_petcare_chat ADD INDEX idx_petcare_conversation (user_id, conversation_id, id)',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @table_exists := (SELECT COUNT(*) FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 't_petcare_ai_config');
SET @exists := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 't_petcare_ai_config'
    AND COLUMN_NAME = 'connection_status');
SET @sql := IF(@table_exists = 1 AND @exists = 0,
  'ALTER TABLE t_petcare_ai_config ADD COLUMN connection_status VARCHAR(16) NOT NULL DEFAULT ''untested'' AFTER api_key_ciphertext',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @exists := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 't_petcare_ai_config'
    AND COLUMN_NAME = 'last_test_message');
SET @sql := IF(@table_exists = 1 AND @exists = 0,
  'ALTER TABLE t_petcare_ai_config ADD COLUMN last_test_message VARCHAR(500) NOT NULL DEFAULT '''' AFTER connection_status',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @exists := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 't_petcare_ai_config'
    AND COLUMN_NAME = 'last_tested_at');
SET @sql := IF(@table_exists = 1 AND @exists = 0,
  'ALTER TABLE t_petcare_ai_config ADD COLUMN last_tested_at DATETIME(3) NULL DEFAULT NULL AFTER last_test_message',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @exists := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 't_petcare_ai_config'
    AND COLUMN_NAME = 'version');
SET @sql := IF(@table_exists = 1 AND @exists = 0,
  'ALTER TABLE t_petcare_ai_config ADD COLUMN version BIGINT NOT NULL DEFAULT 1 AFTER last_tested_at',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
