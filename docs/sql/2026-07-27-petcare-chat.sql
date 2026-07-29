-- 照顾知识助手个人聊天历史。
-- 调用方必须先选择目标业务库；本脚本不会选择或创建数据库。
-- Schema contract: 2026.07.29-operations-p2-v12.

CREATE TABLE IF NOT EXISTS t_petcare_chat (
  id BIGINT NOT NULL AUTO_INCREMENT,
  user_id BIGINT NOT NULL COMMENT '登录用户ID',
  conversation_id BIGINT DEFAULT NULL COMMENT '所属会话ID',
  question VARCHAR(500) NOT NULL COMMENT '用户问题',
  answer MEDIUMTEXT NOT NULL COMMENT '助手最终回答',
  source VARCHAR(16) NOT NULL DEFAULT 'local' COMMENT 'ai或local',
  degrade_reason VARCHAR(500) NOT NULL DEFAULT '' COMMENT 'AI降级原因',
  topic VARCHAR(100) DEFAULT NULL COMMENT '知识主题',
  tools_json TEXT DEFAULT NULL COMMENT '本轮调用工具名JSON',
  question_time DATETIME(3) NOT NULL COMMENT '提问时间',
  answer_time DATETIME(3) NOT NULL COMMENT '回答完成时间',
  PRIMARY KEY (id),
  KEY idx_petcare_user_time (user_id, id),
  KEY idx_petcare_conversation (user_id, conversation_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='照顾知识助手个人聊天历史';

SET @table_exists := (SELECT COUNT(*) FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 't_petcare_chat');
SET @exists := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 't_petcare_chat' AND COLUMN_NAME = 'conversation_id');
SET @sql := IF(@table_exists = 1 AND @exists = 0,
  'ALTER TABLE t_petcare_chat ADD COLUMN conversation_id BIGINT NULL DEFAULT NULL AFTER user_id',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @exists := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 't_petcare_chat' AND COLUMN_NAME = 'degrade_reason');
SET @sql := IF(@table_exists = 1 AND @exists = 0,
  'ALTER TABLE t_petcare_chat ADD COLUMN degrade_reason VARCHAR(500) NOT NULL DEFAULT '''' AFTER source',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @exists := (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 't_petcare_chat' AND INDEX_NAME = 'idx_petcare_user_time');
SET @sql := IF(@table_exists = 1 AND @exists = 0,
  'ALTER TABLE t_petcare_chat ADD INDEX idx_petcare_user_time (user_id, id)', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @exists := (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 't_petcare_chat' AND INDEX_NAME = 'idx_petcare_conversation');
SET @sql := IF(@table_exists = 1 AND @exists = 0,
  'ALTER TABLE t_petcare_chat ADD INDEX idx_petcare_conversation (user_id, conversation_id, id)',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
