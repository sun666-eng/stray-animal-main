-- B3-F 迁移预检（只读报告，不写 t_file_asset 业务数据）
-- 用法：在副本库执行；检查结果后再跑 apply
-- 输出依赖临时表与冲突表

CREATE TABLE IF NOT EXISTS t_file_asset_migration_conflict (
  id BIGINT NOT NULL AUTO_INCREMENT,
  run_id VARCHAR(64) NOT NULL DEFAULT 'default',
  flag VARCHAR(64) NOT NULL,
  reason VARCHAR(255) NOT NULL,
  sources TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_mig_conflict_run (run_id),
  KEY idx_mig_conflict_flag (flag)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

SET @run_id := DATE_FORMAT(NOW(), '%Y%m%d%H%i%s');

DELETE FROM t_file_asset_migration_conflict WHERE run_id = @run_id;

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
SELECT TRIM(a.tpic), 'animal', a.id, NULL, 'animal', 'public'
FROM t_animal a
WHERE a.tpic IS NOT NULL AND TRIM(a.tpic) <> ''
  AND a.tpic NOT LIKE '%/%' AND a.tpic NOT LIKE '%\\%'
  AND CHAR_LENGTH(TRIM(a.tpic)) BETWEEN 8 AND 64;

INSERT INTO tmp_file_asset_sources
SELECT TRIM(u.avatar), 'user', u.id, u.id, 'avatar', 'public'
FROM t_user u
WHERE u.avatar IS NOT NULL AND TRIM(u.avatar) <> ''
  AND u.avatar NOT LIKE '%/%' AND u.avatar NOT LIKE '%\\%'
  AND CHAR_LENGTH(TRIM(u.avatar)) BETWEEN 8 AND 64;

INSERT INTO tmp_file_asset_sources
SELECT TRIM(p.ppic), 'proof', p.id, p.puid, 'proof', 'private'
FROM t_proof p
WHERE p.ppic IS NOT NULL AND TRIM(p.ppic) <> ''
  AND p.ppic NOT LIKE '%/%' AND p.ppic NOT LIKE '%\\%'
  AND CHAR_LENGTH(TRIM(p.ppic)) BETWEEN 8 AND 64;

INSERT INTO tmp_file_asset_sources
SELECT TRIM(v.apic), 'volunteer', v.id, v.uid, 'volunteer', 'private'
FROM t_volunteer v
WHERE v.apic IS NOT NULL AND TRIM(v.apic) <> ''
  AND v.apic NOT LIKE '%/%' AND v.apic NOT LIKE '%\\%'
  AND CHAR_LENGTH(TRIM(v.apic)) BETWEEN 8 AND 64;

INSERT INTO tmp_file_asset_sources
SELECT TRIM(h.pic), 'help', h.id, h.uid, 'help', 'private'
FROM t_help h
WHERE h.pic IS NOT NULL AND TRIM(h.pic) <> ''
  AND h.pic NOT LIKE '%/%' AND h.pic NOT LIKE '%\\%'
  AND CHAR_LENGTH(TRIM(h.pic)) BETWEEN 8 AND 64
  AND (h.title IS NULL OR h.title <> '聊天室消息');

INSERT INTO tmp_file_asset_sources
SELECT TRIM(vi.pic), 'visit', vi.id, vi.uid, 'visit', 'private'
FROM t_visit vi
WHERE vi.pic IS NOT NULL AND TRIM(vi.pic) <> ''
  AND vi.pic NOT LIKE '%/%' AND vi.pic NOT LIKE '%\\%'
  AND CHAR_LENGTH(TRIM(vi.pic)) BETWEEN 8 AND 64;

-- 多业务同 flag
INSERT INTO t_file_asset_migration_conflict (run_id, flag, reason, sources)
SELECT @run_id, s.flag, 'MULTI_BUSINESS',
       GROUP_CONCAT(DISTINCT CONCAT(s.source_type, ':', s.business_id) ORDER BY s.source_type SEPARATOR ',')
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

INSERT INTO tmp_file_asset_resolved (flag, source_type, business_id, owner_id, purpose, visibility)
SELECT s.flag,
       MIN(s.source_type),
       MIN(s.business_id),
       MIN(s.owner_id),
       CASE WHEN SUM(s.desired_visibility = 'private') > 0
            THEN MIN(CASE WHEN s.desired_visibility = 'private' THEN s.desired_purpose END)
            ELSE MIN(s.desired_purpose) END,
       CASE WHEN SUM(s.desired_visibility = 'private') > 0 THEN 'private' ELSE 'public' END
FROM tmp_file_asset_sources s
WHERE s.flag NOT IN (
  SELECT c.flag FROM t_file_asset_migration_conflict c WHERE c.run_id = @run_id AND c.reason = 'MULTI_BUSINESS'
)
GROUP BY s.flag
HAVING COUNT(DISTINCT CONCAT(s.source_type, ':', s.business_id)) = 1;

-- 已有活动元数据与 resolved 不一致
INSERT INTO t_file_asset_migration_conflict (run_id, flag, reason, sources)
SELECT @run_id, f.flag,
       CASE
         WHEN f.visibility = 'private' AND r.visibility = 'public' THEN 'EXISTING_STRICTER_OR_DRIFT'
         WHEN f.visibility = 'public' AND r.visibility = 'private' THEN 'NEED_TIGHTEN_TO_PRIVATE'
         WHEN IFNULL(f.business_type,'') <> r.source_type
           OR IFNULL(f.business_id,0) <> r.business_id THEN 'BUSINESS_BIND_MISMATCH'
         WHEN f.purpose <> r.purpose THEN 'PURPOSE_MISMATCH'
         ELSE 'META_DRIFT'
       END,
       CONCAT('existing=', f.purpose, '/', f.visibility, '/', IFNULL(f.business_type,''), ':', IFNULL(f.business_id,0),
              ' resolved=', r.purpose, '/', r.visibility, '/', r.source_type, ':', r.business_id)
FROM t_file_asset f
JOIN tmp_file_asset_resolved r ON r.flag = f.flag
WHERE f.deleted = 0
  AND (
      f.purpose <> r.purpose
      OR f.visibility <> r.visibility
      OR IFNULL(f.business_type,'') <> r.source_type
      OR IFNULL(f.business_id,0) <> r.business_id
  );

-- 软删除同 flag
INSERT INTO t_file_asset_migration_conflict (run_id, flag, reason, sources)
SELECT @run_id, r.flag, 'SOFT_DELETED_EXISTS',
       CONCAT('file_asset_id=', f.id, ',deleted=1')
FROM tmp_file_asset_resolved r
JOIN t_file_asset f ON f.flag = r.flag AND f.deleted = 1
WHERE NOT EXISTS (
  SELECT 1 FROM t_file_asset a WHERE a.flag = r.flag AND a.deleted = 0
);

-- 报告
SELECT @run_id AS run_id;
SELECT reason, COUNT(*) AS cnt FROM t_file_asset_migration_conflict WHERE run_id = @run_id GROUP BY reason;
SELECT COUNT(*) AS source_rows FROM tmp_file_asset_sources;
SELECT COUNT(*) AS resolved_flags FROM tmp_file_asset_resolved;
SELECT COUNT(*) AS conflict_rows FROM t_file_asset_migration_conflict WHERE run_id = @run_id;

-- NEED_TIGHTEN_TO_PRIVATE 可在 apply 自动收紧；下列视为阻断 apply：
-- MULTI_BUSINESS, BUSINESS_BIND_MISMATCH, SOFT_DELETED_EXISTS(若策略不恢复)
SELECT COUNT(*) AS blocking_conflicts
FROM t_file_asset_migration_conflict
WHERE run_id = @run_id
  AND reason IN ('MULTI_BUSINESS', 'BUSINESS_BIND_MISMATCH', 'SOFT_DELETED_EXISTS', 'EXISTING_STRICTER_OR_DRIFT');
