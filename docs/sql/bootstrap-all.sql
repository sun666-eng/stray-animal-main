-- =============================================================================
-- 闭环结构唯一手工入口（与 SchemaGuard 契约 SCHEMA_VERSION=2026.07.24-file-collation-v3 对齐）
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

INSERT INTO app_schema_meta (meta_key, meta_value) VALUES ('schema_version', '2026.07.24-file-collation-v3')
ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value);
