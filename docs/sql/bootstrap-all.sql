-- =============================================================================
-- 闭环结构唯一手工入口（与 SchemaGuard 契约 SCHEMA_VERSION=2026.07.29-operations-p2-v12 对齐）
-- 新库：可先导 test.sql（已含闭环列），再可选执行本脚本（幂等）
-- 旧库：本脚本只补齐结构；历史业务图片元数据必须按 file-asset-migrate-RUNBOOK 执行迁移
-- 调用方必须先选择目标库（mysql client: USE your_db; 或 -D your_db），禁止脚本内硬编码库名。
-- =============================================================================

-- 安全闸：必须已选中非空业务库
SET @current_db := DATABASE();
SET @db_ok := IF(@current_db IS NULL OR @current_db = '' OR @current_db IN ('mysql','information_schema','performance_schema','sys'), 0, 1);
SET @assert_db := IF(@db_ok = 1, 'SELECT 1', 'SIGNAL SQLSTATE ''45000'' SET MESSAGE_TEXT = ''bootstrap-all.sql: DATABASE() is empty or a system schema; select the application database first''');
PREPARE stmt_assert_db FROM @assert_db; EXECUTE stmt_assert_db; DEALLOCATE PREPARE stmt_assert_db;

CREATE TABLE IF NOT EXISTS app_schema_meta (
  meta_key VARCHAR(64) NOT NULL PRIMARY KEY,
  meta_value VARCHAR(255) NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS t_workflow_event (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  business_type VARCHAR(32) NOT NULL,
  business_id VARCHAR(96) NOT NULL,
  from_state INT NULL,
  to_state INT NULL,
  action VARCHAR(32) NOT NULL,
  actor_id BIGINT NULL,
  actor_type VARCHAR(16) NULL,
  reason VARCHAR(1000) NULL,
  request_id VARCHAR(64) NULL,
  metadata_json TEXT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_workflow_business (business_type, business_id, created_at, id),
  KEY idx_workflow_actor (actor_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS t_notification (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT NOT NULL,
  type VARCHAR(32) NULL,
  title VARCHAR(120) NULL,
  summary VARCHAR(500) NULL,
  business_type VARCHAR(32) NULL,
  business_id VARCHAR(96) NULL,
  target_url VARCHAR(255) NULL,
  read_flag TINYINT NOT NULL DEFAULT 0,
  event_key VARCHAR(160) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  read_at DATETIME(3) NULL,
  UNIQUE KEY uk_notification_event (user_id, event_key),
  KEY idx_notification_inbox (user_id, read_flag, created_at, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS t_visit_plan (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  aid BIGINT NOT NULL,
  uid BIGINT NOT NULL,
  plan_type VARCHAR(24) NOT NULL,
  due_at DATE NOT NULL,
  status INT NOT NULL DEFAULT 0,
  assignee_id BIGINT NULL,
  completed_visit_id BIGINT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uk_visit_plan (aid,uid,plan_type),
  KEY idx_visit_plan_queue (status,due_at,assignee_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS t_file_asset (
  id BIGINT NOT NULL AUTO_INCREMENT,
  flag VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  stored_name VARCHAR(512) NOT NULL,
  original_name VARCHAR(512) DEFAULT NULL,
  owner_id BIGINT DEFAULT NULL,
  purpose VARCHAR(32) NOT NULL DEFAULT 'private',
  visibility VARCHAR(16) NOT NULL DEFAULT 'private',
  business_type VARCHAR(32) DEFAULT NULL,
  business_id BIGINT DEFAULT NULL,
  content_type VARCHAR(128) DEFAULT NULL,
  size_bytes BIGINT DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  bound_at DATETIME DEFAULT NULL,
  deleted TINYINT NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uk_file_flag (flag),
  KEY idx_file_owner (owner_id),
  KEY idx_file_purpose (purpose),
  KEY idx_file_business (business_type, business_id, deleted)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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

CREATE TABLE IF NOT EXISTS t_petcare_ai_config (
  user_id BIGINT NOT NULL COMMENT '登录用户ID，一名用户一条配置',
  enabled TINYINT(1) NOT NULL DEFAULT 1 COMMENT '是否启用个人Agent',
  base_url VARCHAR(500) NOT NULL COMMENT 'OpenAI兼容API Base URL',
  model VARCHAR(120) NOT NULL COMMENT '模型名称',
  api_key_ciphertext TEXT NOT NULL COMMENT 'AES-GCM密文，禁止保存明文',
  connection_status VARCHAR(16) NOT NULL DEFAULT 'untested' COMMENT 'untested/connected/failed',
  last_test_message VARCHAR(500) NOT NULL DEFAULT '' COMMENT '最近连接摘要',
  last_tested_at DATETIME(3) DEFAULT NULL COMMENT '最近真实连接时间',
  version BIGINT NOT NULL DEFAULT 1 COMMENT '配置乐观版本',
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  PRIMARY KEY (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='照顾助手用户级加密API配置';

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

CREATE TABLE IF NOT EXISTS t_admin_agent_automation_config (
  id TINYINT NOT NULL, enabled TINYINT(1) NOT NULL DEFAULT 0,
  mode VARCHAR(16) NOT NULL DEFAULT 'shadow', max_batch INT NOT NULL DEFAULT 3,
  version BIGINT NOT NULL DEFAULT 1, updated_by BIGINT DEFAULT NULL,
  created_at DATETIME(3) NOT NULL, updated_at DATETIME(3) NOT NULL, PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='3C受控自动审核开关';

INSERT INTO t_admin_agent_automation_config
  (id, enabled, mode, max_batch, version, updated_by, created_at, updated_at)
VALUES (1, 0, 'shadow', 3, 1, NULL, NOW(3), NOW(3))
ON DUPLICATE KEY UPDATE id = VALUES(id);

CREATE TABLE IF NOT EXISTS t_admin_agent_automation_run (
  id BIGINT NOT NULL AUTO_INCREMENT, actor_id BIGINT NOT NULL, request_id VARCHAR(64) NOT NULL,
  mode VARCHAR(16) NOT NULL, status VARCHAR(16) NOT NULL, candidate_count INT NOT NULL DEFAULT 0,
  shadow_count INT NOT NULL DEFAULT 0, auto_approved_count INT NOT NULL DEFAULT 0,
  manual_count INT NOT NULL DEFAULT 0, failed_count INT NOT NULL DEFAULT 0,
  detail VARCHAR(1000) NOT NULL DEFAULT '', started_at DATETIME(3) NOT NULL,
  completed_at DATETIME(3) DEFAULT NULL, PRIMARY KEY (id),
  UNIQUE KEY uk_admin_agent_automation_request (actor_id, request_id),
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

SET @exists := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='t_admin_agent_adopt_draft' AND COLUMN_NAME='final_request_id');
SET @sql := IF(@exists=0, 'ALTER TABLE t_admin_agent_adopt_draft ADD COLUMN final_request_id VARCHAR(64) DEFAULT NULL AFTER version', 'SELECT 1');
PREPARE s3b FROM @sql; EXECUTE s3b; DEALLOCATE PREPARE s3b;
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

CREATE TABLE IF NOT EXISTS role_permission (
  role_id BIGINT NOT NULL,
  permission_id BIGINT NOT NULL,
  PRIMARY KEY (role_id, permission_id),
  KEY idx_rp_permission (permission_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='角色-权限关联(规范化 Phase 1)';

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

-- Existing PetCare tables may predate conversations and connection diagnostics.
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
  'ALTER TABLE t_petcare_chat ADD INDEX idx_petcare_user_time (user_id, id)',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @exists := (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 't_petcare_chat' AND INDEX_NAME = 'idx_petcare_conversation');
SET @sql := IF(@table_exists = 1 AND @exists = 0,
  'ALTER TABLE t_petcare_chat ADD INDEX idx_petcare_conversation (user_id, conversation_id, id)',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @table_exists := (SELECT COUNT(*) FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 't_petcare_conversation');
SET @exists := (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 't_petcare_conversation' AND INDEX_NAME = 'idx_petcare_conversation_user');
SET @sql := IF(@table_exists = 1 AND @exists = 0,
  'ALTER TABLE t_petcare_conversation ADD INDEX idx_petcare_conversation_user (user_id, updated_at, id)',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

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

-- Repair legacy role_permission definitions, then cover the current guard indexes.
SET @table_exists := (SELECT COUNT(*) FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'role_permission');
SET @exists := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'role_permission' AND COLUMN_NAME = 'role_id');
SET @sql := IF(@table_exists = 1 AND @exists = 0,
  'ALTER TABLE role_permission ADD COLUMN role_id BIGINT NOT NULL', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
SET @exists := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'role_permission' AND COLUMN_NAME = 'permission_id');
SET @sql := IF(@table_exists = 1 AND @exists = 0,
  'ALTER TABLE role_permission ADD COLUMN permission_id BIGINT NOT NULL', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
SET @exists := (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'role_permission' AND INDEX_NAME = 'PRIMARY');
SET @sql := IF(@table_exists = 1 AND @exists = 0,
  'ALTER TABLE role_permission ADD PRIMARY KEY (role_id, permission_id)', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
SET @exists := (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'role_permission' AND INDEX_NAME = 'idx_rp_permission');
SET @sql := IF(@table_exists = 1 AND @exists = 0,
  'ALTER TABLE role_permission ADD INDEX idx_rp_permission (permission_id)', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @table_exists := (SELECT COUNT(*) FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 't_help');
SET @help_columns := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 't_help' AND COLUMN_NAME IN ('title', 'create_time', 'id'));
SET @exists := (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 't_help' AND INDEX_NAME = 'idx_help_chat');
SET @sql := IF(@table_exists = 1 AND @help_columns = 3 AND @exists = 0,
  'ALTER TABLE t_help ADD INDEX idx_help_chat (title, create_time, id)', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
SET @help_columns := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 't_help' AND COLUMN_NAME = 'uid');
SET @exists := (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 't_help' AND INDEX_NAME = 'idx_help_uid');
SET @sql := IF(@table_exists = 1 AND @help_columns = 1 AND @exists = 0,
  'ALTER TABLE t_help ADD INDEX idx_help_uid (uid)', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @exists := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 't_file_asset' AND COLUMN_NAME = 'original_name');
SET @sql := IF(@exists = 0,
  'ALTER TABLE t_file_asset ADD COLUMN original_name VARCHAR(512) DEFAULT NULL AFTER stored_name',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
SET @exists := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 't_file_asset' AND COLUMN_NAME = 'owner_id');
SET @sql := IF(@exists = 0,
  'ALTER TABLE t_file_asset ADD COLUMN owner_id BIGINT DEFAULT NULL AFTER original_name',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
SET @exists := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 't_file_asset' AND COLUMN_NAME = 'purpose');
SET @sql := IF(@exists = 0,
  'ALTER TABLE t_file_asset ADD COLUMN purpose VARCHAR(32) NOT NULL DEFAULT ''private'' AFTER owner_id',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
SET @exists := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 't_file_asset' AND COLUMN_NAME = 'visibility');
SET @sql := IF(@exists = 0,
  'ALTER TABLE t_file_asset ADD COLUMN visibility VARCHAR(16) NOT NULL DEFAULT ''private'' AFTER purpose',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
SET @exists := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 't_file_asset' AND COLUMN_NAME = 'business_type');
SET @sql := IF(@exists = 0,
  'ALTER TABLE t_file_asset ADD COLUMN business_type VARCHAR(32) DEFAULT NULL AFTER visibility',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
SET @exists := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 't_file_asset' AND COLUMN_NAME = 'business_id');
SET @sql := IF(@exists = 0,
  'ALTER TABLE t_file_asset ADD COLUMN business_id BIGINT DEFAULT NULL AFTER business_type',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
SET @exists := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 't_file_asset' AND COLUMN_NAME = 'content_type');
SET @sql := IF(@exists = 0,
  'ALTER TABLE t_file_asset ADD COLUMN content_type VARCHAR(128) DEFAULT NULL AFTER business_id',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
SET @exists := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 't_file_asset' AND COLUMN_NAME = 'size_bytes');
SET @sql := IF(@exists = 0,
  'ALTER TABLE t_file_asset ADD COLUMN size_bytes BIGINT DEFAULT NULL AFTER content_type',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
SET @exists := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 't_file_asset' AND COLUMN_NAME = 'created_at');
SET @sql := IF(@exists = 0,
  'ALTER TABLE t_file_asset ADD COLUMN created_at DATETIME DEFAULT CURRENT_TIMESTAMP AFTER size_bytes',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
SET @exists := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 't_file_asset' AND COLUMN_NAME = 'bound_at');
SET @sql := IF(@exists = 0,
  'ALTER TABLE t_file_asset ADD COLUMN bound_at DATETIME DEFAULT NULL AFTER created_at',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
SET @exists := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 't_file_asset' AND COLUMN_NAME = 'deleted');
SET @sql := IF(@exists = 0,
  'ALTER TABLE t_file_asset ADD COLUMN deleted TINYINT NOT NULL DEFAULT 0 AFTER bound_at',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @exists := (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 't_file_asset' AND INDEX_NAME = 'idx_file_business');
SET @sql := IF(@exists = 0,
  'ALTER TABLE t_file_asset ADD KEY idx_file_business (business_type, business_id, deleted)',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- pstatus
SET @exists := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 't_proof' AND COLUMN_NAME = 'pstatus');
SET @sql := IF(@exists = 0,
  'ALTER TABLE t_proof ADD COLUMN pstatus INT NOT NULL DEFAULT 0 COMMENT ''0待审核 1已通过 2已驳回'' AFTER ptitle',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- volunteer uid / apic
SET @exists := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 't_volunteer' AND COLUMN_NAME = 'uid');
SET @sql := IF(@exists = 0,
  'ALTER TABLE t_volunteer ADD COLUMN uid BIGINT NULL DEFAULT NULL COMMENT ''申请用户ID'' AFTER vstate',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @exists := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 't_volunteer' AND COLUMN_NAME = 'apic');
SET @sql := IF(@exists = 0,
  'ALTER TABLE t_volunteer ADD COLUMN apic VARCHAR(255) NULL DEFAULT NULL COMMENT ''免冠照'' AFTER uid',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

ALTER TABLE t_role MODIFY COLUMN permission TEXT;
ALTER TABLE t_user MODIFY COLUMN role TEXT;

-- Account amounts are exact decimals. Abort before any UPDATE when legacy data cannot be converted safely.
DELIMITER $$
DROP PROCEDURE IF EXISTS bootstrap_account_avalue_decimal$$
CREATE PROCEDURE bootstrap_account_avalue_decimal()
BEGIN
  DECLARE current_type VARCHAR(64);
  DECLARE current_precision INT;
  DECLARE current_scale INT;
  DECLARE invalid_rows BIGINT DEFAULT 0;

  SELECT DATA_TYPE, NUMERIC_PRECISION, NUMERIC_SCALE
    INTO current_type, current_precision, current_scale
    FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 't_account'
     AND COLUMN_NAME = 'avalue';

  IF current_type IS NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 't_account.avalue does not exist';
  END IF;

  IF NOT (current_type = 'decimal' AND current_precision = 19 AND current_scale = 2) THEN
    SELECT COUNT(*) INTO invalid_rows
      FROM t_account
     WHERE avalue IS NULL
        OR avalue <> avalue
        OR ABS(CAST(avalue AS DECIMAL(65,10)))
             > CAST('99999999999999999.99' AS DECIMAL(65,10));
    IF invalid_rows > 0 THEN
      SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 't_account.avalue contains null, nonfinite-like, or DECIMAL(19,2) out-of-range values';
    END IF;

    ALTER TABLE t_account
      MODIFY COLUMN avalue DECIMAL(19,2) NOT NULL COMMENT '款项金额';
  END IF;
END$$
CALL bootstrap_account_avalue_decimal()$$
DROP PROCEDURE bootstrap_account_avalue_decimal$$
DELIMITER ;

ALTER TABLE t_animal
  MODIFY COLUMN tbirthday DATE NULL DEFAULT NULL COMMENT '动物生日（未知时为空）';

ALTER TABLE t_adopt
  MODIFY COLUMN uname VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '用户姓名快照';
ALTER TABLE t_proof
  MODIFY COLUMN uname VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '用户姓名快照';
ALTER TABLE t_user
  MODIFY COLUMN username VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '用户名';
ALTER TABLE t_permission
  MODIFY COLUMN flag VARCHAR(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '唯一标识';

-- File flags must use one explicit collation across old MySQL and MySQL 8 databases.
ALTER TABLE t_file_asset
  MODIFY COLUMN flag VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL;
ALTER TABLE t_animal
  MODIFY COLUMN tpic VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' COMMENT '动物图片文件flag';
ALTER TABLE t_user
  MODIFY COLUMN avatar VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '头像文件flag';
UPDATE t_user SET avatar = NULL WHERE TRIM(avatar) = '1';
ALTER TABLE t_proof
  MODIFY COLUMN ppic VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '凭证图片文件flag';
ALTER TABLE t_volunteer
  MODIFY COLUMN apic VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '本人免冠照文件flag';
ALTER TABLE t_help
  MODIFY COLUMN pic VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '现场照片文件flag';
ALTER TABLE t_visit
  MODIFY COLUMN pic VARCHAR(355) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '回访图片文件flag';

INSERT INTO t_role (id, name, description, permission)
VALUES (4, '认证义工', '义工审核通过标记，无后台管理权限', '[]')
ON DUPLICATE KEY UPDATE name = VALUES(name), description = VALUES(description), permission = VALUES(permission);

UPDATE t_role SET permission = '[{"id":5,"name":"救助咨询","path":"/page/front/rescue_apply.html","description":"用户端提交救助咨询和救助请求","flag":"im"},{"id":43,"name":"动物浏览","path":"/page/front/animal_browse.html","description":"用户端浏览可领养动物","flag":"adopt_view"},{"id":11,"name":"我的领养申请","path":"/page/front/my_adopt.html","description":"用户端查看自己的领养申请","flag":"my_adopt"},{"id":12,"name":"领养凭证入口","path":"/page/front/adopt_proof.html","description":"用户端提交和管理自己的领养凭证","flag":"my_proof"},{"id":15,"name":"义工申请","path":"/page/front/volunteer_apply.html","description":"用户端提交义工申请","flag":"apply"}]'
WHERE id = 3;

INSERT INTO t_permission (name, description, path, flag)
SELECT 'AI管理助手', '使用管理员只读AI助手', '/page/end/admin_agent.html', 'admin_agent'
WHERE NOT EXISTS (SELECT 1 FROM t_permission WHERE flag = 'admin_agent');

-- P1/P2 运营闭环：bootstrap-all 必须是独立可执行入口，不能只写版本号再依赖应用补表。
CREATE TABLE IF NOT EXISTS t_volunteer_task (id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,title VARCHAR(120) NOT NULL,description VARCHAR(2000),location VARCHAR(255),start_at DATETIME(3) NOT NULL,end_at DATETIME(3) NOT NULL,capacity INT NOT NULL DEFAULT 1,status INT NOT NULL DEFAULT 0,creator_id BIGINT NOT NULL,created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),version INT NOT NULL DEFAULT 0,INDEX idx_volunteer_task_queue(status,start_at,id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS t_volunteer_signup (id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,task_id BIGINT NOT NULL,user_id BIGINT NOT NULL,status INT NOT NULL DEFAULT 0,note VARCHAR(500),assigned_by BIGINT,assigned_at DATETIME(3),created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),version INT NOT NULL DEFAULT 0,UNIQUE KEY uk_volunteer_signup(task_id,user_id),INDEX idx_volunteer_signup_user(user_id,status,created_at),INDEX idx_volunteer_signup_task(task_id,status,id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS t_volunteer_service_record (id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,signup_id BIGINT NOT NULL,task_id BIGINT NOT NULL,user_id BIGINT NOT NULL,service_minutes INT NOT NULL,summary VARCHAR(1000),confirmed_by BIGINT NOT NULL,completed_at DATETIME(3) NOT NULL,created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),UNIQUE KEY uk_service_signup(signup_id),INDEX idx_service_user(user_id,completed_at,id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS t_animal_medical_record (id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,animal_id BIGINT NOT NULL,record_type VARCHAR(32) NOT NULL,title VARCHAR(120) NOT NULL,content VARCHAR(2000),occurred_at DATETIME(3) NOT NULL,visibility VARCHAR(16) NOT NULL DEFAULT 'public',asset_flag VARCHAR(64),created_by BIGINT NOT NULL,created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),INDEX idx_medical_animal(animal_id,occurred_at,id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS t_work_item (id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,business_type VARCHAR(32) NOT NULL,business_id VARCHAR(96) NOT NULL,title VARCHAR(160) NOT NULL,priority INT NOT NULL DEFAULT 0,assignee_id BIGINT,due_at DATETIME(3),status INT NOT NULL DEFAULT 0,source_event_key VARCHAR(160) NOT NULL,created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),completed_at DATETIME(3),version INT NOT NULL DEFAULT 0,UNIQUE KEY uk_work_item_source(source_event_key),INDEX idx_work_item_queue(status,priority,due_at,id),INDEX idx_work_item_assignee(assignee_id,status,due_at)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS t_animal_favorite (id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,user_id BIGINT NOT NULL,animal_id BIGINT NOT NULL,created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),UNIQUE KEY uk_animal_favorite(user_id,animal_id),INDEX idx_favorite_user(user_id,created_at,id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS t_notification_outbox (id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,notification_id BIGINT NOT NULL,user_id BIGINT NOT NULL,channel VARCHAR(16) NOT NULL,recipient VARCHAR(255),payload_json TEXT NOT NULL,status INT NOT NULL DEFAULT 0,attempts INT NOT NULL DEFAULT 0,next_attempt_at DATETIME(3),last_error VARCHAR(500),created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),sent_at DATETIME(3),UNIQUE KEY uk_notification_channel(notification_id,channel),INDEX idx_outbox_dispatch(status,next_attempt_at,id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DELIMITER $$
DROP PROCEDURE IF EXISTS bootstrap_p12_add_column$$
CREATE PROCEDURE bootstrap_p12_add_column(IN p_table VARCHAR(64),IN p_column VARCHAR(64),IN p_ddl TEXT)
BEGIN
  IF NOT EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=p_table AND COLUMN_NAME=p_column) THEN
    SET @ddl=p_ddl; PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
  END IF;
END$$
DELIMITER ;
CALL bootstrap_p12_add_column('t_account','occurred_at','ALTER TABLE t_account ADD COLUMN occurred_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) AFTER adescribe');
CALL bootstrap_p12_add_column('t_account','category','ALTER TABLE t_account ADD COLUMN category VARCHAR(32) NOT NULL DEFAULT ''other'' AFTER occurred_at');
CALL bootstrap_p12_add_column('t_account','business_type','ALTER TABLE t_account ADD COLUMN business_type VARCHAR(32) NULL AFTER category');
CALL bootstrap_p12_add_column('t_account','business_id','ALTER TABLE t_account ADD COLUMN business_id VARCHAR(96) NULL AFTER business_type');
CALL bootstrap_p12_add_column('t_account','receipt_flag','ALTER TABLE t_account ADD COLUMN receipt_flag VARCHAR(64) NULL AFTER business_id');
CALL bootstrap_p12_add_column('t_account','reversal_of','ALTER TABLE t_account ADD COLUMN reversal_of BIGINT NULL AFTER receipt_flag');
CALL bootstrap_p12_add_column('t_account','created_by','ALTER TABLE t_account ADD COLUMN created_by BIGINT NULL AFTER reversal_of');
DROP PROCEDURE bootstrap_p12_add_column;

SET @idx_exists=(SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='t_account' AND INDEX_NAME='idx_account_business');
SET @ddl=IF(@idx_exists=0,'ALTER TABLE t_account ADD INDEX idx_account_business(business_type,business_id,occurred_at)','SELECT 1'); PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @idx_exists=(SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='t_account' AND INDEX_NAME='uk_account_reversal');
SET @ddl=IF(@idx_exists=0,'ALTER TABLE t_account ADD UNIQUE INDEX uk_account_reversal(reversal_of)','SELECT 1'); PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

INSERT INTO app_schema_meta (meta_key, meta_value) VALUES ('schema_version', '2026.07.29-operations-p2-v12')
  ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
