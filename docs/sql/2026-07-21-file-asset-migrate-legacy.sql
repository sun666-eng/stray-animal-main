-- B3-F：历史文件元数据安全迁移（可重复执行）
-- 前置：已执行 2026-07-21-file-asset.sql（存在 t_file_asset）
-- 原则：
--   1) 先汇来源，再冲突检测，冲突 >0 则 fail-fast，禁止部分插入
--   2) 同 flag 同时出现 public 与 private 来源 → 强制 private
--   3) 同 flag 绑定多个不同业务 → 进入冲突表，不自动迁移
--   4) 单事务；flag 去重；幂等（NOT EXISTS 正式表）
-- 执行：在副本库演练；确认冲突表为空后再正式跑 INSERT

-- ---------------------------------------------------------------------------
-- 0) 冲突报告表（可重复）
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS t_file_asset_migration_conflict (
  id BIGINT NOT NULL AUTO_INCREMENT,
  flag VARCHAR(64) NOT NULL,
  reason VARCHAR(255) NOT NULL,
  sources TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_mig_conflict_flag (flag)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------------
-- 1) 来源临时表
-- ---------------------------------------------------------------------------
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

-- 仅接受「像 flag」的短标识（排除 URL/路径）
-- animal public
INSERT INTO tmp_file_asset_sources (flag, source_type, business_id, owner_id, desired_purpose, desired_visibility)
SELECT TRIM(a.tpic), 'animal', a.id, NULL, 'animal', 'public'
FROM t_animal a
WHERE a.tpic IS NOT NULL AND TRIM(a.tpic) <> ''
  AND a.tpic NOT LIKE '%/%' AND a.tpic NOT LIKE '%\\%'
  AND CHAR_LENGTH(TRIM(a.tpic)) BETWEEN 8 AND 64;

-- avatar public（绑定后）
INSERT INTO tmp_file_asset_sources (flag, source_type, business_id, owner_id, desired_purpose, desired_visibility)
SELECT TRIM(u.avatar), 'user', u.id, u.id, 'avatar', 'public'
FROM t_user u
WHERE u.avatar IS NOT NULL AND TRIM(u.avatar) <> ''
  AND u.avatar NOT LIKE '%/%' AND u.avatar NOT LIKE '%\\%'
  AND CHAR_LENGTH(TRIM(u.avatar)) BETWEEN 8 AND 64;

-- proof private
INSERT INTO tmp_file_asset_sources (flag, source_type, business_id, owner_id, desired_purpose, desired_visibility)
SELECT TRIM(p.ppic), 'proof', p.id, p.puid, 'proof', 'private'
FROM t_proof p
WHERE p.ppic IS NOT NULL AND TRIM(p.ppic) <> ''
  AND p.ppic NOT LIKE '%/%' AND p.ppic NOT LIKE '%\\%'
  AND CHAR_LENGTH(TRIM(p.ppic)) BETWEEN 8 AND 64;

-- volunteer private
INSERT INTO tmp_file_asset_sources (flag, source_type, business_id, owner_id, desired_purpose, desired_visibility)
SELECT TRIM(v.apic), 'volunteer', v.id, v.uid, 'volunteer', 'private'
FROM t_volunteer v
WHERE v.apic IS NOT NULL AND TRIM(v.apic) <> ''
  AND v.apic NOT LIKE '%/%' AND v.apic NOT LIKE '%\\%'
  AND CHAR_LENGTH(TRIM(v.apic)) BETWEEN 8 AND 64;

-- help private
INSERT INTO tmp_file_asset_sources (flag, source_type, business_id, owner_id, desired_purpose, desired_visibility)
SELECT TRIM(h.pic), 'help', h.id, h.uid, 'help', 'private'
FROM t_help h
WHERE h.pic IS NOT NULL AND TRIM(h.pic) <> ''
  AND h.pic NOT LIKE '%/%' AND h.pic NOT LIKE '%\\%'
  AND CHAR_LENGTH(TRIM(h.pic)) BETWEEN 8 AND 64
  AND (h.title IS NULL OR h.title <> '聊天室消息');

-- visit private
INSERT INTO tmp_file_asset_sources (flag, source_type, business_id, owner_id, desired_purpose, desired_visibility)
SELECT TRIM(vi.pic), 'visit', vi.id, vi.uid, 'visit', 'private'
FROM t_visit vi
WHERE vi.pic IS NOT NULL AND TRIM(vi.pic) <> ''
  AND vi.pic NOT LIKE '%/%' AND vi.pic NOT LIKE '%\\%'
  AND CHAR_LENGTH(TRIM(vi.pic)) BETWEEN 8 AND 64;

-- ---------------------------------------------------------------------------
-- 2) 冲突检测：多业务引用同一 flag → 写入冲突表
-- ---------------------------------------------------------------------------
TRUNCATE TABLE t_file_asset_migration_conflict;

INSERT INTO t_file_asset_migration_conflict (flag, reason, sources)
SELECT s.flag,
       'MULTI_BUSINESS',
       GROUP_CONCAT(DISTINCT CONCAT(s.source_type, ':', s.business_id) ORDER BY s.source_type SEPARATOR ',')
FROM tmp_file_asset_sources s
GROUP BY s.flag
HAVING COUNT(DISTINCT CONCAT(s.source_type, ':', s.business_id)) > 1;

-- 手工检查：
-- SELECT * FROM t_file_asset_migration_conflict;
-- 若有行，请先处理业务脏数据，再继续。下列语句在冲突非空时通过信号失败：
-- （MySQL 存储过程可选；此处用简单断言：冲突存在则不要执行第 4 步）

-- 检查冲突数量（应用侧/运维）：
-- SELECT COUNT(*) AS conflict_count FROM t_file_asset_migration_conflict;
-- 要求 conflict_count = 0

-- ---------------------------------------------------------------------------
-- 3) 安全解析表：每个 flag 最多一行；visibility 取最严（有 private 则 private）
--    仅单业务 flag 进入；冲突 flag 排除
-- ---------------------------------------------------------------------------
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
       MIN(s.source_type) AS source_type,
       MIN(s.business_id) AS business_id,
       MIN(s.owner_id) AS owner_id,
       -- 有 private 来源则 purpose 取 private 类中的一种（按字典序取 MIN，后续以 visibility 为准）
       CASE
         WHEN SUM(s.desired_visibility = 'private') > 0 THEN
           MIN(CASE WHEN s.desired_visibility = 'private' THEN s.desired_purpose END)
         ELSE MIN(s.desired_purpose)
       END AS purpose,
       CASE
         WHEN SUM(s.desired_visibility = 'private') > 0 THEN 'private'
         ELSE 'public'
       END AS visibility
FROM tmp_file_asset_sources s
WHERE s.flag NOT IN (SELECT c.flag FROM t_file_asset_migration_conflict c)
GROUP BY s.flag
HAVING COUNT(DISTINCT CONCAT(s.source_type, ':', s.business_id)) = 1;

-- 额外：同一 flag 多用户头像共享（多 source 但都是 user）已在 MULTI_BUSINESS 捕获。
-- 若仅多行相同 source_type+business 重复插入，HAVING=1 仍安全。

-- ---------------------------------------------------------------------------
-- 4) 正式迁移（冲突必须为 0）。建议外层：
--    START TRANSACTION;
--    ... 本段 INSERT ...
--    COMMIT;
-- ---------------------------------------------------------------------------
-- 门禁：冲突非空时不要执行下面 INSERT（0 行插入也安全，但应先清冲突）
-- SELECT COUNT(*) AS must_be_zero FROM t_file_asset_migration_conflict;

START TRANSACTION;

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
WHERE NOT EXISTS (
        SELECT 1 FROM t_file_asset f
        WHERE f.flag = r.flag AND f.deleted = 0
      )
  AND (SELECT COUNT(*) FROM t_file_asset_migration_conflict) = 0;

-- 冲突>0 时本 INSERT 影响 0 行 → 无 partial public 元数据
COMMIT;

-- ---------------------------------------------------------------------------
-- 5) 核对
-- ---------------------------------------------------------------------------
-- SELECT purpose, visibility, COUNT(*) FROM t_file_asset WHERE deleted=0 GROUP BY purpose, visibility;
-- SELECT * FROM t_file_asset_migration_conflict;
-- SELECT COUNT(*) AS multi_biz_skipped FROM t_file_asset_migration_conflict WHERE reason='MULTI_BUSINESS';
