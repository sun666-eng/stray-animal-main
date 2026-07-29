-- P1 运营闭环 + P2 首批能力（MySQL 8）
-- 正式环境先备份；开发环境由 SchemaGuardRunner v12 自动执行同等迁移。
CREATE TABLE IF NOT EXISTS t_volunteer_task (id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,title VARCHAR(120) NOT NULL,description VARCHAR(2000),location VARCHAR(255),start_at DATETIME(3) NOT NULL,end_at DATETIME(3) NOT NULL,capacity INT NOT NULL DEFAULT 1,status INT NOT NULL DEFAULT 0,creator_id BIGINT NOT NULL,created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),version INT NOT NULL DEFAULT 0,INDEX idx_volunteer_task_queue(status,start_at,id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS t_volunteer_signup (id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,task_id BIGINT NOT NULL,user_id BIGINT NOT NULL,status INT NOT NULL DEFAULT 0,note VARCHAR(500),assigned_by BIGINT,assigned_at DATETIME(3),created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),version INT NOT NULL DEFAULT 0,UNIQUE KEY uk_volunteer_signup(task_id,user_id),INDEX idx_volunteer_signup_user(user_id,status,created_at),INDEX idx_volunteer_signup_task(task_id,status,id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS t_volunteer_service_record (id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,signup_id BIGINT NOT NULL,task_id BIGINT NOT NULL,user_id BIGINT NOT NULL,service_minutes INT NOT NULL,summary VARCHAR(1000),confirmed_by BIGINT NOT NULL,completed_at DATETIME(3) NOT NULL,created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),UNIQUE KEY uk_service_signup(signup_id),INDEX idx_service_user(user_id,completed_at,id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS t_animal_medical_record (id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,animal_id BIGINT NOT NULL,record_type VARCHAR(32) NOT NULL,title VARCHAR(120) NOT NULL,content VARCHAR(2000),occurred_at DATETIME(3) NOT NULL,visibility VARCHAR(16) NOT NULL DEFAULT 'public',asset_flag VARCHAR(64),created_by BIGINT NOT NULL,created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),INDEX idx_medical_animal(animal_id,occurred_at,id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS t_work_item (id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,business_type VARCHAR(32) NOT NULL,business_id VARCHAR(96) NOT NULL,title VARCHAR(160) NOT NULL,priority INT NOT NULL DEFAULT 0,assignee_id BIGINT,due_at DATETIME(3),status INT NOT NULL DEFAULT 0,source_event_key VARCHAR(160) NOT NULL,created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),completed_at DATETIME(3),version INT NOT NULL DEFAULT 0,UNIQUE KEY uk_work_item_source(source_event_key),INDEX idx_work_item_queue(status,priority,due_at,id),INDEX idx_work_item_assignee(assignee_id,status,due_at)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS t_animal_favorite (id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,user_id BIGINT NOT NULL,animal_id BIGINT NOT NULL,created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),UNIQUE KEY uk_animal_favorite(user_id,animal_id),INDEX idx_favorite_user(user_id,created_at,id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS t_notification_outbox (id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,notification_id BIGINT NOT NULL,user_id BIGINT NOT NULL,channel VARCHAR(16) NOT NULL,recipient VARCHAR(255),payload_json TEXT NOT NULL,status INT NOT NULL DEFAULT 0,attempts INT NOT NULL DEFAULT 0,next_attempt_at DATETIME(3),last_error VARCHAR(500),created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),sent_at DATETIME(3),UNIQUE KEY uk_notification_channel(notification_id,channel),INDEX idx_outbox_dispatch(status,next_attempt_at,id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DELIMITER $$
DROP PROCEDURE IF EXISTS p12_add_column$$
CREATE PROCEDURE p12_add_column(IN p_table VARCHAR(64),IN p_column VARCHAR(64),IN p_ddl TEXT)
BEGIN
  IF NOT EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=p_table AND COLUMN_NAME=p_column) THEN
    SET @ddl=p_ddl; PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
  END IF;
END$$
DELIMITER ;
CALL p12_add_column('t_account','occurred_at','ALTER TABLE t_account ADD COLUMN occurred_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) AFTER adescribe');
CALL p12_add_column('t_account','category','ALTER TABLE t_account ADD COLUMN category VARCHAR(32) NOT NULL DEFAULT ''other'' AFTER occurred_at');
CALL p12_add_column('t_account','business_type','ALTER TABLE t_account ADD COLUMN business_type VARCHAR(32) NULL AFTER category');
CALL p12_add_column('t_account','business_id','ALTER TABLE t_account ADD COLUMN business_id VARCHAR(96) NULL AFTER business_type');
CALL p12_add_column('t_account','receipt_flag','ALTER TABLE t_account ADD COLUMN receipt_flag VARCHAR(64) NULL AFTER business_id');
CALL p12_add_column('t_account','reversal_of','ALTER TABLE t_account ADD COLUMN reversal_of BIGINT NULL AFTER receipt_flag');
CALL p12_add_column('t_account','created_by','ALTER TABLE t_account ADD COLUMN created_by BIGINT NULL AFTER reversal_of');
DROP PROCEDURE p12_add_column;

SET @idx_exists=(SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='t_account' AND INDEX_NAME='idx_account_business');
SET @ddl=IF(@idx_exists=0,'ALTER TABLE t_account ADD INDEX idx_account_business(business_type,business_id,occurred_at)','SELECT 1'); PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @idx_exists=(SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='t_account' AND INDEX_NAME='uk_account_reversal');
SET @ddl=IF(@idx_exists=0,'ALTER TABLE t_account ADD UNIQUE INDEX uk_account_reversal(reversal_of)','SELECT 1'); PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

INSERT INTO app_schema_meta(meta_key,meta_value) VALUES('schema_version','2026.07.29-operations-p2-v12') ON DUPLICATE KEY UPDATE meta_value=VALUES(meta_value);
