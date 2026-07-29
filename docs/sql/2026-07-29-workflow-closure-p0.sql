-- Schema contract: 2026.07.29-workflow-operations-v11.
-- P0 业务闭环迁移：执行前必须选择业务库并完成备份。脚本不删除业务行。

SET @current_db := DATABASE();
SET @db_ok := IF(@current_db IS NULL OR @current_db = '' OR @current_db IN ('mysql','information_schema','performance_schema','sys'), 0, 1);
SET @assert_db := IF(@db_ok = 1, 'SELECT 1', 'SIGNAL SQLSTATE ''45000'' SET MESSAGE_TEXT = ''select the application database first''');
PREPARE stmt_assert_db FROM @assert_db; EXECUTE stmt_assert_db; DEALLOCATE PREPARE stmt_assert_db;

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
  KEY idx_workflow_business (business_type,business_id,created_at,id),
  KEY idx_workflow_actor (actor_id,created_at)
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
  UNIQUE KEY uk_notification_event (user_id,event_key),
  KEY idx_notification_inbox (user_id,read_flag,created_at,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS t_visit_plan (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  aid BIGINT NOT NULL, uid BIGINT NOT NULL,
  plan_type VARCHAR(24) NOT NULL, due_at DATE NOT NULL,
  status INT NOT NULL DEFAULT 0,
  assignee_id BIGINT NULL, completed_visit_id BIGINT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uk_visit_plan (aid,uid,plan_type),
  KEY idx_visit_plan_queue (status,due_at,assignee_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DELIMITER $$
DROP PROCEDURE IF EXISTS p0_add_column$$
CREATE PROCEDURE p0_add_column(IN p_table VARCHAR(64), IN p_column VARCHAR(64), IN p_ddl TEXT)
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=p_table AND COLUMN_NAME=p_column) THEN
    SET @p0_ddl = p_ddl;
    PREPARE p0_stmt FROM @p0_ddl; EXECUTE p0_stmt; DEALLOCATE PREPARE p0_stmt;
  END IF;
END$$
DELIMITER ;

CALL p0_add_column('t_adopt','reviewer_id','ALTER TABLE t_adopt ADD COLUMN reviewer_id BIGINT NULL DEFAULT NULL AFTER vstate');
CALL p0_add_column('t_adopt','review_reason','ALTER TABLE t_adopt ADD COLUMN review_reason VARCHAR(1000) NULL DEFAULT NULL AFTER reviewer_id');
CALL p0_add_column('t_adopt','reviewed_at','ALTER TABLE t_adopt ADD COLUMN reviewed_at DATETIME(3) NULL DEFAULT NULL AFTER review_reason');
CALL p0_add_column('t_adopt','handover_at','ALTER TABLE t_adopt ADD COLUMN handover_at DATETIME(3) NULL DEFAULT NULL AFTER reviewed_at');
CALL p0_add_column('t_adopt','handover_note','ALTER TABLE t_adopt ADD COLUMN handover_note VARCHAR(1000) NULL DEFAULT NULL AFTER handover_at');
CALL p0_add_column('t_adopt','created_at','ALTER TABLE t_adopt ADD COLUMN created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) AFTER handover_note');
CALL p0_add_column('t_adopt','updated_at','ALTER TABLE t_adopt ADD COLUMN updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) AFTER created_at');
CALL p0_add_column('t_adopt','version','ALTER TABLE t_adopt ADD COLUMN version INT NOT NULL DEFAULT 0 AFTER updated_at');

CALL p0_add_column('t_proof','proof_stage','ALTER TABLE t_proof ADD COLUMN proof_stage VARCHAR(24) NOT NULL DEFAULT ''handover'' AFTER pstatus');
CALL p0_add_column('t_proof','reviewer_id','ALTER TABLE t_proof ADD COLUMN reviewer_id BIGINT NULL DEFAULT NULL AFTER proof_stage');
CALL p0_add_column('t_proof','review_reason','ALTER TABLE t_proof ADD COLUMN review_reason VARCHAR(1000) NULL DEFAULT NULL AFTER reviewer_id');
CALL p0_add_column('t_proof','reviewed_at','ALTER TABLE t_proof ADD COLUMN reviewed_at DATETIME(3) NULL DEFAULT NULL AFTER review_reason');
CALL p0_add_column('t_proof','created_at','ALTER TABLE t_proof ADD COLUMN created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) AFTER reviewed_at');
CALL p0_add_column('t_proof','updated_at','ALTER TABLE t_proof ADD COLUMN updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) AFTER created_at');

CALL p0_add_column('t_help','priority','ALTER TABLE t_help ADD COLUMN priority INT NOT NULL DEFAULT 0 AFTER status');
CALL p0_add_column('t_help','assignee_id','ALTER TABLE t_help ADD COLUMN assignee_id BIGINT NULL DEFAULT NULL AFTER priority');
CALL p0_add_column('t_help','outcome','ALTER TABLE t_help ADD COLUMN outcome VARCHAR(32) NULL DEFAULT NULL AFTER assignee_id');
CALL p0_add_column('t_help','animal_id','ALTER TABLE t_help ADD COLUMN animal_id BIGINT NULL DEFAULT NULL AFTER outcome');
CALL p0_add_column('t_help','resolution_note','ALTER TABLE t_help ADD COLUMN resolution_note VARCHAR(2000) NULL DEFAULT NULL AFTER animal_id');
CALL p0_add_column('t_help','resolved_at','ALTER TABLE t_help ADD COLUMN resolved_at DATETIME(3) NULL DEFAULT NULL AFTER resolution_note');
CALL p0_add_column('t_help','version','ALTER TABLE t_help ADD COLUMN version INT NOT NULL DEFAULT 0 AFTER resolved_at');
DROP PROCEDURE p0_add_column;

SET @idx_exists := (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='t_help' AND INDEX_NAME='uk_help_animal');
SET @idx_sql := IF(@idx_exists=0,'ALTER TABLE t_help ADD UNIQUE INDEX uk_help_animal (animal_id)','SELECT 1');
PREPARE p0_idx FROM @idx_sql; EXECUTE p0_idx; DEALLOCATE PREPARE p0_idx;

-- 有回访记录可作为历史交接证据；其余旧“已通过”保留为待交接，进入管理员人工核对。
UPDATE t_adopt a
SET a.vstate=4,
    a.handover_at=COALESCE(a.handover_at, CURRENT_TIMESTAMP(3)),
    a.handover_note=COALESCE(a.handover_note, '历史数据：存在回访记录，迁移为已完成交接'),
    a.updated_at=CURRENT_TIMESTAMP(3),
    a.version=COALESCE(a.version,0)+1
WHERE a.vstate=1
  AND EXISTS (SELECT 1 FROM t_visit v WHERE v.pet_id=a.aid AND v.uid=a.uid);

UPDATE t_animal a SET a.tstate=CASE
  WHEN EXISTS (SELECT 1 FROM t_adopt d WHERE d.aid=a.id AND d.vstate=4) THEN 2
  WHEN EXISTS (SELECT 1 FROM t_adopt d WHERE d.aid=a.id AND d.vstate IN (0,1,3)) THEN 1
  ELSE 0 END;

INSERT INTO app_schema_meta(meta_key,meta_value)
VALUES('schema_version','2026.07.29-workflow-operations-v11')
ON DUPLICATE KEY UPDATE meta_value=VALUES(meta_value);
