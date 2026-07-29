-- 照顾助手幂等问答任务 v5 增量更新。
-- Schema contract: 2026.07.29-workflow-closure-p0-v10.
-- 必须先选择目标业务库；DATABASE() 安全闸防止误操作系统库。

SET @current_db := DATABASE();
SET @db_ok := IF(@current_db IS NULL OR @current_db = '' OR @current_db IN ('mysql','information_schema','performance_schema','sys'), 0, 1);
SET @assert_db := IF(@db_ok = 1, 'SELECT 1', 'SIGNAL SQLSTATE ''45000'' SET MESSAGE_TEXT = ''petcare-request-v5.sql: DATABASE() is empty or a system schema; select the application database first''');
PREPARE stmt_assert_db FROM @assert_db; EXECUTE stmt_assert_db; DEALLOCATE PREPARE stmt_assert_db;

CREATE TABLE IF NOT EXISTS t_petcare_request (
  id BIGINT NOT NULL AUTO_INCREMENT,
  user_id BIGINT NOT NULL,
  request_id VARCHAR(64) NOT NULL,
  conversation_id BIGINT DEFAULT NULL,
  requested_conversation_id BIGINT DEFAULT NULL COMMENT '首次请求指定的会话ID，用于幂等载荷校验',
  requested_conversation_known TINYINT(1) DEFAULT NULL COMMENT 'v5标记：true=新请求，NULL=旧未知来源',
  question VARCHAR(500) NOT NULL,
  status VARCHAR(16) NOT NULL COMMENT 'running/answered/completed/failed/cancelled',
  answer MEDIUMTEXT DEFAULT NULL,
  source VARCHAR(16) DEFAULT NULL,
  degrade_reason VARCHAR(500) NOT NULL DEFAULT '',
  topic VARCHAR(100) DEFAULT NULL,
  tools_json TEXT DEFAULT NULL,
  conversation_title VARCHAR(60) DEFAULT NULL,
  error_code VARCHAR(16) DEFAULT NULL,
  error_message VARCHAR(500) DEFAULT NULL,
  attempt_count INT NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  completed_at DATETIME(3) DEFAULT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_petcare_request_user (user_id, request_id),
  KEY idx_petcare_request_status (status, updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='照顾助手幂等问答任务';

SET @table_exists := (SELECT COUNT(*) FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 't_petcare_request');
SET @exists := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 't_petcare_request'
    AND COLUMN_NAME = 'requested_conversation_id');
SET @sql := IF(@table_exists = 1 AND @exists = 0,
  'ALTER TABLE t_petcare_request ADD COLUMN requested_conversation_id BIGINT DEFAULT NULL AFTER conversation_id',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @exists := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 't_petcare_request'
    AND COLUMN_NAME = 'requested_conversation_known');
SET @sql := IF(@table_exists = 1 AND @exists = 0,
  'ALTER TABLE t_petcare_request ADD COLUMN requested_conversation_known TINYINT(1) DEFAULT NULL COMMENT ''v5标记：true=新请求，NULL=旧未知来源'' AFTER requested_conversation_id',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- v4 旧数据回填 requested_conversation_id，但不设置 known 标记（保持 NULL = 未知来源）
UPDATE t_petcare_request
SET requested_conversation_id = conversation_id
WHERE requested_conversation_id IS NULL AND conversation_id IS NOT NULL;
