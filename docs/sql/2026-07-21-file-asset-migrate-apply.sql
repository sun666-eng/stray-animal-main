-- B3-F 迁移正式应用（须先 precheck 且 blocking_conflicts=0）
-- 原则：public→private 可自动；private→public 禁止；冲突 SIGNAL 45000
-- 修复：避免 MySQL 1093（UPDATE 目标表出现在同语句子查询中）
-- 前置：2026-07-21-file-asset.sql

DELIMITER $$

DROP PROCEDURE IF EXISTS sp_file_asset_migrate_apply$$
CREATE PROCEDURE sp_file_asset_migrate_apply(IN p_run_id VARCHAR(64))
BEGIN
  DECLARE v_block INT DEFAULT 0;
  DECLARE v_inserted INT DEFAULT 0;
  DECLARE v_tightened INT DEFAULT 0;
  DECLARE v_restored INT DEFAULT 0;

  IF p_run_id IS NULL OR p_run_id = '' THEN
    SET p_run_id = DATE_FORMAT(NOW(), '%Y%m%d%H%i%s');
  END IF;

  DROP TEMPORARY TABLE IF EXISTS tmp_file_asset_sources;
  CREATE TEMPORARY TABLE tmp_file_asset_sources (
    flag VARCHAR(64) NOT NULL,
    source_type VARCHAR(32) NOT NULL,
    business_id BIGINT NOT NULL,
    owner_id BIGINT NULL,
    desired_purpose VARCHAR(32) NOT NULL,
    desired_visibility VARCHAR(16) NOT NULL,
    KEY idx_src_flag (flag)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

  INSERT INTO tmp_file_asset_sources
  SELECT TRIM(a.tpic), 'animal', a.id, NULL, 'animal', 'public' FROM t_animal a
  WHERE a.tpic IS NOT NULL AND TRIM(a.tpic) <> '' AND a.tpic NOT LIKE '%/%' AND a.tpic NOT LIKE '%\\%'
    AND CHAR_LENGTH(TRIM(a.tpic)) BETWEEN 8 AND 64;
  INSERT INTO tmp_file_asset_sources
  SELECT TRIM(u.avatar), 'user', u.id, u.id, 'avatar', 'public' FROM t_user u
  WHERE u.avatar IS NOT NULL AND TRIM(u.avatar) <> '' AND u.avatar NOT LIKE '%/%' AND u.avatar NOT LIKE '%\\%'
    AND CHAR_LENGTH(TRIM(u.avatar)) BETWEEN 8 AND 64;
  INSERT INTO tmp_file_asset_sources
  SELECT TRIM(p.ppic), 'proof', p.id, p.puid, 'proof', 'private' FROM t_proof p
  WHERE p.ppic IS NOT NULL AND TRIM(p.ppic) <> '' AND p.ppic NOT LIKE '%/%' AND p.ppic NOT LIKE '%\\%'
    AND CHAR_LENGTH(TRIM(p.ppic)) BETWEEN 8 AND 64;
  INSERT INTO tmp_file_asset_sources
  SELECT TRIM(v.apic), 'volunteer', v.id, v.uid, 'volunteer', 'private' FROM t_volunteer v
  WHERE v.apic IS NOT NULL AND TRIM(v.apic) <> '' AND v.apic NOT LIKE '%/%' AND v.apic NOT LIKE '%\\%'
    AND CHAR_LENGTH(TRIM(v.apic)) BETWEEN 8 AND 64;
  INSERT INTO tmp_file_asset_sources
  SELECT TRIM(h.pic), 'help', h.id, h.uid, 'help', 'private' FROM t_help h
  WHERE h.pic IS NOT NULL AND TRIM(h.pic) <> '' AND h.pic NOT LIKE '%/%' AND h.pic NOT LIKE '%\\%'
    AND CHAR_LENGTH(TRIM(h.pic)) BETWEEN 8 AND 64
    AND (h.title IS NULL OR h.title <> '聊天室消息');
  INSERT INTO tmp_file_asset_sources
  SELECT TRIM(vi.pic), 'visit', vi.id, vi.uid, 'visit', 'private' FROM t_visit vi
  WHERE vi.pic IS NOT NULL AND TRIM(vi.pic) <> '' AND vi.pic NOT LIKE '%/%' AND vi.pic NOT LIKE '%\\%'
    AND CHAR_LENGTH(TRIM(vi.pic)) BETWEEN 8 AND 64;

  CREATE TABLE IF NOT EXISTS t_file_asset_migration_conflict (
    id BIGINT NOT NULL AUTO_INCREMENT,
    run_id VARCHAR(64) NOT NULL DEFAULT 'default',
    flag VARCHAR(64) NOT NULL,
    reason VARCHAR(255) NOT NULL,
    sources TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_mig_conflict_run (run_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

  DELETE FROM t_file_asset_migration_conflict WHERE run_id = p_run_id;

  INSERT INTO t_file_asset_migration_conflict (run_id, flag, reason, sources)
  SELECT p_run_id, s.flag, 'MULTI_BUSINESS',
         GROUP_CONCAT(DISTINCT CONCAT(s.source_type, ':', s.business_id) SEPARATOR ',')
  FROM tmp_file_asset_sources s
  GROUP BY s.flag
  HAVING COUNT(DISTINCT CONCAT(s.source_type, ':', s.business_id)) > 1;

  DROP TEMPORARY TABLE IF EXISTS tmp_file_asset_resolved;
  CREATE TEMPORARY TABLE tmp_file_asset_resolved (
    flag VARCHAR(64) NOT NULL PRIMARY KEY,
    source_type VARCHAR(32) NOT NULL,
    business_id BIGINT NOT NULL,
    owner_id BIGINT NULL,
    purpose VARCHAR(32) NOT NULL,
    visibility VARCHAR(16) NOT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

  INSERT INTO tmp_file_asset_resolved
  SELECT s.flag, MIN(s.source_type), MIN(s.business_id), MIN(s.owner_id),
         CASE WHEN SUM(s.desired_visibility='private')>0
              THEN MIN(CASE WHEN s.desired_visibility='private' THEN s.desired_purpose END)
              ELSE MIN(s.desired_purpose) END,
         CASE WHEN SUM(s.desired_visibility='private')>0 THEN 'private' ELSE 'public' END
  FROM tmp_file_asset_sources s
  WHERE s.flag NOT IN (
    SELECT flag FROM (
      SELECT c.flag FROM t_file_asset_migration_conflict c
      WHERE c.run_id = p_run_id AND c.reason = 'MULTI_BUSINESS'
    ) blocked
  )
  GROUP BY s.flag
  HAVING COUNT(DISTINCT CONCAT(s.source_type, ':', s.business_id)) = 1;

  INSERT INTO t_file_asset_migration_conflict (run_id, flag, reason, sources)
  SELECT p_run_id, f.flag, 'BUSINESS_BIND_MISMATCH',
         CONCAT(IFNULL(f.business_type,''), ':', IFNULL(f.business_id,0), ' vs ', r.source_type, ':', r.business_id)
  FROM t_file_asset f
  JOIN tmp_file_asset_resolved r ON r.flag = f.flag
  WHERE f.deleted = 0
    AND f.business_id IS NOT NULL
    AND (IFNULL(f.business_type,'') <> r.source_type OR f.business_id <> r.business_id);

  -- 软删除歧义：同 flag 多条 deleted=1 且无 active
  INSERT INTO t_file_asset_migration_conflict (run_id, flag, reason, sources)
  SELECT p_run_id, d.flag, 'SOFT_DELETED_AMBIGUOUS', CONCAT('count=', d.cnt)
  FROM (
    SELECT f.flag, COUNT(*) AS cnt
    FROM t_file_asset f
    JOIN tmp_file_asset_resolved r ON r.flag = f.flag
    WHERE f.deleted = 1
      AND f.flag NOT IN (
        SELECT flag FROM (
          SELECT flag FROM t_file_asset WHERE deleted = 0
        ) active_flags
      )
    GROUP BY f.flag
    HAVING COUNT(*) > 1
  ) d;

  SELECT COUNT(*) INTO v_block
  FROM t_file_asset_migration_conflict
  WHERE run_id = p_run_id
    AND reason IN ('MULTI_BUSINESS', 'BUSINESS_BIND_MISMATCH', 'SOFT_DELETED_AMBIGUOUS');

  IF v_block > 0 THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'file_asset migrate blocked: conflicts present (see t_file_asset_migration_conflict)';
  END IF;

  START TRANSACTION;

  -- 1) public → private 单调收紧
  UPDATE t_file_asset f
  JOIN tmp_file_asset_resolved r ON r.flag = f.flag
  SET f.visibility = 'private',
      f.purpose = r.purpose
  WHERE f.deleted = 0
    AND f.visibility = 'public'
    AND r.visibility = 'private';
  SET v_tightened = ROW_COUNT();

  -- 2) 同步绑定（不抬升 private→public）
  UPDATE t_file_asset f
  JOIN tmp_file_asset_resolved r ON r.flag = f.flag
  SET f.purpose = r.purpose,
      f.business_type = r.source_type,
      f.business_id = r.business_id,
      f.bound_at = IFNULL(f.bound_at, NOW()),
      f.owner_id = COALESCE(f.owner_id, r.owner_id),
      f.visibility = CASE
        WHEN f.visibility = 'private' THEN 'private'
        WHEN r.visibility = 'private' THEN 'private'
        ELSE f.visibility
      END
  WHERE f.deleted = 0
    AND (f.business_id IS NULL
         OR (IFNULL(f.business_type,'') = r.source_type AND f.business_id = r.business_id));

  -- 3) 恢复唯一软删除行：先收集 id，避免 1093
  DROP TEMPORARY TABLE IF EXISTS tmp_restore_ids;
  CREATE TEMPORARY TABLE tmp_restore_ids (id BIGINT PRIMARY KEY);

  INSERT INTO tmp_restore_ids (id)
  SELECT f.id
  FROM t_file_asset f
  JOIN tmp_file_asset_resolved r ON r.flag = f.flag
  WHERE f.deleted = 1
    AND f.flag IN (
      SELECT flag FROM (
        SELECT flag FROM t_file_asset WHERE deleted = 1 GROUP BY flag HAVING COUNT(*) = 1
      ) only_one_soft
    )
    AND f.flag NOT IN (
      SELECT flag FROM (
        SELECT flag FROM t_file_asset WHERE deleted = 0
      ) has_active
    );

  UPDATE t_file_asset f
  JOIN tmp_restore_ids t ON t.id = f.id
  JOIN tmp_file_asset_resolved r ON r.flag = f.flag
  SET f.deleted = 0,
      f.purpose = r.purpose,
      f.visibility = r.visibility,
      f.business_type = r.source_type,
      f.business_id = r.business_id,
      f.owner_id = COALESCE(f.owner_id, r.owner_id),
      f.bound_at = NOW(),
      f.stored_name = CASE
        WHEN f.stored_name IS NULL OR f.stored_name = '' OR f.stored_name LIKE '%-legacy'
        THEN CONCAT(r.flag, '-legacy')
        ELSE f.stored_name
      END;
  SET v_restored = ROW_COUNT();

  -- 4) 插入完全缺失的 flag（含软删也不存在）
  INSERT INTO t_file_asset (flag, stored_name, original_name, owner_id, purpose, visibility,
                            business_type, business_id, created_at, bound_at, deleted)
  SELECT r.flag,
         CONCAT(r.flag, '-legacy'),
         r.flag,
         r.owner_id,
         r.purpose,
         r.visibility,
         r.source_type,
         r.business_id,
         NOW(),
         NOW(),
         0
  FROM tmp_file_asset_resolved r
  WHERE r.flag NOT IN (
    SELECT flag FROM (
      SELECT flag FROM t_file_asset
    ) existing_any
  );
  SET v_inserted = ROW_COUNT();

  COMMIT;

  SELECT p_run_id AS run_id,
         v_inserted AS inserted,
         v_tightened AS tightened_public_to_private,
         v_restored AS restored_soft_deleted;
END$$

DELIMITER ;

-- CALL sp_file_asset_migrate_apply(DATE_FORMAT(NOW(), '%Y%m%d%H%i%s'));
