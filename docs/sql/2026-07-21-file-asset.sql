-- B3-F：文件元数据表（可重复执行）
-- 版本：2026.07.21-file-v1

CREATE TABLE IF NOT EXISTS t_file_asset (
  id BIGINT NOT NULL AUTO_INCREMENT,
  flag VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '对外文件标识',
  stored_name VARCHAR(512) NOT NULL COMMENT '磁盘文件名',
  original_name VARCHAR(512) DEFAULT NULL,
  owner_id BIGINT DEFAULT NULL COMMENT '上传用户ID',
  purpose VARCHAR(32) NOT NULL DEFAULT 'private' COMMENT 'animal/avatar/notice/proof/visit/volunteer/help/private',
  visibility VARCHAR(16) NOT NULL DEFAULT 'private' COMMENT 'public/private',
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
