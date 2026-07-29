-- 照顾助手幂等问答任务 v4（已废弃，请使用 2026-07-27-petcare-request-v5.sql）。
-- Schema contract: 2026.07.29-workflow-closure-p0-v10.

CREATE TABLE IF NOT EXISTS t_petcare_request (
  id BIGINT NOT NULL AUTO_INCREMENT,
  user_id BIGINT NOT NULL,
  request_id VARCHAR(64) NOT NULL,
  conversation_id BIGINT DEFAULT NULL,
  requested_conversation_id BIGINT DEFAULT NULL COMMENT '首次请求指定的会话ID，用于幂等载荷校验',
  question VARCHAR(500) NOT NULL,
  status VARCHAR(16) NOT NULL COMMENT 'running/answered/completed/failed',
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

UPDATE t_petcare_request
SET requested_conversation_id = conversation_id
WHERE requested_conversation_id IS NULL AND conversation_id IS NOT NULL;
