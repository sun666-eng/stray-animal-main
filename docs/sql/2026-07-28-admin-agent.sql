-- Administrator AI Agent migration
-- Schema contract: 2026.07.29-workflow-operations-v11
-- Select the application database before running this script.

ALTER TABLE t_permission
  MODIFY COLUMN flag VARCHAR(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '唯一标识';

CREATE TABLE IF NOT EXISTS t_admin_agent_config (
  id TINYINT NOT NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 0,
  base_url VARCHAR(500) NOT NULL,
  model VARCHAR(120) NOT NULL,
  api_key_ciphertext TEXT NOT NULL,
  connection_status VARCHAR(16) NOT NULL DEFAULT 'untested',
  last_test_message VARCHAR(500) NOT NULL DEFAULT '',
  last_tested_at DATETIME(3) DEFAULT NULL,
  version BIGINT NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='管理员Agent平台级加密配置';

CREATE TABLE IF NOT EXISTS t_admin_agent_conversation (
  id BIGINT NOT NULL AUTO_INCREMENT,
  user_id BIGINT NOT NULL,
  title VARCHAR(60) NOT NULL,
  preview VARCHAR(100) NOT NULL DEFAULT '',
  turn_count INT NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  KEY idx_admin_agent_conversation_user (user_id, updated_at, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='管理员Agent个人会话目录';

CREATE TABLE IF NOT EXISTS t_admin_agent_message (
  id BIGINT NOT NULL AUTO_INCREMENT,
  user_id BIGINT NOT NULL,
  conversation_id BIGINT NOT NULL,
  request_id VARCHAR(64) NOT NULL,
  question VARCHAR(800) NOT NULL,
  answer MEDIUMTEXT NOT NULL,
  tools_json TEXT DEFAULT NULL,
  created_at DATETIME(3) NOT NULL,
  completed_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_admin_agent_request (user_id, request_id),
  KEY idx_admin_agent_message_conversation (user_id, conversation_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='管理员Agent问答历史';

CREATE TABLE IF NOT EXISTS t_admin_agent_audit (
  id BIGINT NOT NULL AUTO_INCREMENT,
  actor_id BIGINT NOT NULL,
  event_type VARCHAR(40) NOT NULL,
  conversation_id BIGINT DEFAULT NULL,
  request_id VARCHAR(64) NOT NULL DEFAULT '',
  tools_json TEXT DEFAULT NULL,
  outcome VARCHAR(16) NOT NULL,
  detail VARCHAR(1000) NOT NULL DEFAULT '',
  created_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  KEY idx_admin_agent_audit_actor (actor_id, created_at, id),
  KEY idx_admin_agent_audit_request (request_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='管理员Agent安全审计';

CREATE TABLE IF NOT EXISTS t_admin_agent_adopt_draft (
  id BIGINT NOT NULL AUTO_INCREMENT,
  actor_id BIGINT NOT NULL,
  animal_id BIGINT NOT NULL,
  applicant_id BIGINT NOT NULL,
  request_id VARCHAR(64) NOT NULL,
  source_state INT NOT NULL DEFAULT 0,
  recommendation VARCHAR(24) NOT NULL,
  risk_level VARCHAR(12) NOT NULL,
  rationale VARCHAR(1200) NOT NULL,
  missing_info VARCHAR(800) NOT NULL,
  review_note VARCHAR(1200) NOT NULL,
  model VARCHAR(120) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'draft',
  version BIGINT NOT NULL DEFAULT 1,
  final_request_id VARCHAR(64) DEFAULT NULL,
  final_decision VARCHAR(12) DEFAULT NULL,
  override_reason VARCHAR(500) NOT NULL DEFAULT '',
  finalized_at DATETIME(3) DEFAULT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_admin_agent_draft_application (actor_id, animal_id, applicant_id),
  UNIQUE KEY uk_admin_agent_draft_request (actor_id, request_id),
  UNIQUE KEY uk_admin_agent_draft_final_request (actor_id, final_request_id),
  KEY idx_admin_agent_draft_actor (actor_id, status, updated_at, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='3A草稿与3B人工确认执行凭据';

SET @exists := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='t_admin_agent_adopt_draft' AND COLUMN_NAME='final_request_id');
SET @sql := IF(@exists=0, 'ALTER TABLE t_admin_agent_adopt_draft ADD COLUMN final_request_id VARCHAR(64) DEFAULT NULL AFTER version', 'SELECT 1');
PREPARE s3b FROM @sql; EXECUTE s3b; DEALLOCATE PREPARE s3b;

CREATE TABLE IF NOT EXISTS t_admin_agent_automation_config (
  id TINYINT NOT NULL, enabled TINYINT(1) NOT NULL DEFAULT 0,
  mode VARCHAR(16) NOT NULL DEFAULT 'shadow', max_batch INT NOT NULL DEFAULT 3,
  version BIGINT NOT NULL DEFAULT 1, updated_by BIGINT DEFAULT NULL,
  created_at DATETIME(3) NOT NULL, updated_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='3C受控自动审核开关';

INSERT INTO t_admin_agent_automation_config
  (id, enabled, mode, max_batch, version, updated_by, created_at, updated_at)
VALUES (1, 0, 'shadow', 3, 1, NULL, NOW(3), NOW(3))
ON DUPLICATE KEY UPDATE id = VALUES(id);

CREATE TABLE IF NOT EXISTS t_admin_agent_automation_run (
  id BIGINT NOT NULL AUTO_INCREMENT, actor_id BIGINT NOT NULL, request_id VARCHAR(64) NOT NULL,
  mode VARCHAR(16) NOT NULL, status VARCHAR(16) NOT NULL,
  candidate_count INT NOT NULL DEFAULT 0, shadow_count INT NOT NULL DEFAULT 0,
  auto_approved_count INT NOT NULL DEFAULT 0, manual_count INT NOT NULL DEFAULT 0,
  failed_count INT NOT NULL DEFAULT 0, detail VARCHAR(1000) NOT NULL DEFAULT '',
  started_at DATETIME(3) NOT NULL, completed_at DATETIME(3) DEFAULT NULL,
  PRIMARY KEY (id), UNIQUE KEY uk_admin_agent_automation_request (actor_id, request_id),
  KEY idx_admin_agent_automation_status (status, started_at, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='3C自动审核运行批次';

CREATE TABLE IF NOT EXISTS t_admin_agent_automation_item (
  id BIGINT NOT NULL AUTO_INCREMENT, run_id BIGINT NOT NULL, animal_id BIGINT NOT NULL,
  applicant_id BIGINT NOT NULL, recommendation VARCHAR(24) NOT NULL DEFAULT '',
  risk_level VARCHAR(12) NOT NULL DEFAULT '', hard_gate_pass TINYINT(1) NOT NULL DEFAULT 0,
  missing_info VARCHAR(800) NOT NULL DEFAULT '', rationale VARCHAR(1200) NOT NULL DEFAULT '',
  outcome VARCHAR(24) NOT NULL, reason VARCHAR(500) NOT NULL DEFAULT '', created_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id), UNIQUE KEY uk_admin_agent_automation_item (run_id, animal_id, applicant_id),
  KEY idx_admin_agent_automation_item_run (run_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='3C逐条去隐私决策证据';
SET @exists := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='t_admin_agent_adopt_draft' AND COLUMN_NAME='final_decision');
SET @sql := IF(@exists=0, 'ALTER TABLE t_admin_agent_adopt_draft ADD COLUMN final_decision VARCHAR(12) DEFAULT NULL AFTER final_request_id', 'SELECT 1');
PREPARE s3b FROM @sql; EXECUTE s3b; DEALLOCATE PREPARE s3b;
SET @exists := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='t_admin_agent_adopt_draft' AND COLUMN_NAME='override_reason');
SET @sql := IF(@exists=0, 'ALTER TABLE t_admin_agent_adopt_draft ADD COLUMN override_reason VARCHAR(500) NOT NULL DEFAULT '''' AFTER final_decision', 'SELECT 1');
PREPARE s3b FROM @sql; EXECUTE s3b; DEALLOCATE PREPARE s3b;
SET @exists := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='t_admin_agent_adopt_draft' AND COLUMN_NAME='finalized_at');
SET @sql := IF(@exists=0, 'ALTER TABLE t_admin_agent_adopt_draft ADD COLUMN finalized_at DATETIME(3) DEFAULT NULL AFTER override_reason', 'SELECT 1');
PREPARE s3b FROM @sql; EXECUTE s3b; DEALLOCATE PREPARE s3b;
SET @exists := (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='t_admin_agent_adopt_draft' AND INDEX_NAME='uk_admin_agent_draft_final_request');
SET @sql := IF(@exists=0, 'ALTER TABLE t_admin_agent_adopt_draft ADD UNIQUE INDEX uk_admin_agent_draft_final_request (actor_id, final_request_id)', 'SELECT 1');
PREPARE s3b FROM @sql; EXECUTE s3b; DEALLOCATE PREPARE s3b;

INSERT INTO t_permission (name, description, path, flag)
SELECT 'AI管理助手', '使用管理员只读AI助手', '/page/end/admin_agent.html', 'admin_agent'
WHERE NOT EXISTS (SELECT 1 FROM t_permission WHERE flag = 'admin_agent');

INSERT INTO app_schema_meta (meta_key, meta_value)
VALUES ('schema_version', '2026.07.29-workflow-operations-v11')
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
