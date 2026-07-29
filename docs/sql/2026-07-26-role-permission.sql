-- 角色权限规范化 Phase 1：role_permission 关联表
-- Schema contract: 2026.07.29-workflow-operations-v11.
-- 适用：生产 pure-check 模式（app.schema-guard.auto-migrate=false）须先手工执行本脚本；
--       dev/auto-migrate 环境由 SchemaGuardRunner 自动建表，无需手工执行。
-- 数据回填：应用启动时 RolePermissionSyncRunner（@Order(70)）自动从 t_role.permission JSON
--          对账同步，幂等；本脚本不做数据回填。
-- 过渡期架构：JSON 列仍由 Guard/DataFix 维护并双写，读路径
--          （fillPermissions / getByRoles / assertNotReferenced）已切关联表。
-- 回滚：DROP TABLE role_permission; 并回退应用版本即可（JSON 列始终完整）。

CREATE TABLE IF NOT EXISTS role_permission (
  role_id BIGINT NOT NULL,
  permission_id BIGINT NOT NULL,
  PRIMARY KEY (role_id, permission_id),
  KEY idx_rp_permission (permission_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='角色-权限关联(规范化 Phase 1)';

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
