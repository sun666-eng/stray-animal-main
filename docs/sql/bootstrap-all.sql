-- =============================================================================
-- 流浪动物系统 · 闭环必需结构（可重复执行 / 与 SchemaGuard 目标一致）
-- 用法：mysql -uroot -p < docs/sql/bootstrap-all.sql
-- =============================================================================

USE `test`;

-- 1) 凭证审核状态
SET @exists := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 't_proof' AND COLUMN_NAME = 'pstatus');
SET @sql := IF(@exists = 0,
  'ALTER TABLE t_proof ADD COLUMN pstatus INT NOT NULL DEFAULT 0 COMMENT ''0待审核 1已通过 2已驳回'' AFTER ptitle',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- 2) 义工 uid / apic
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

-- 3) 权限 JSON 防截断
ALTER TABLE t_role MODIFY COLUMN permission TEXT;
ALTER TABLE t_user MODIFY COLUMN role TEXT;

-- 4) 轻量认证义工角色
INSERT INTO t_role (id, name, description, permission)
VALUES (4, '认证义工', '义工审核通过标记，无后台管理权限', '[]')
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  description = VALUES(description),
  permission = VALUES(permission);

-- 5) 角色 3 应含 my_proof（完整标准用户权限，覆盖旧脏 JSON）
UPDATE t_role SET permission = '[{"id":5,"name":"救助咨询","path":"/page/front/rescue_apply.html","description":"用户端提交救助咨询和救助请求","flag":"im"},{"id":43,"name":"动物浏览","path":"/page/front/animal_browse.html","description":"用户端浏览可领养动物","flag":"adopt_view"},{"id":11,"name":"我的领养申请","path":"/page/front/my_adopt.html","description":"用户端查看自己的领养申请","flag":"my_adopt"},{"id":12,"name":"领养凭证入口","path":"/page/front/adopt_proof.html","description":"用户端提交和管理自己的领养凭证","flag":"my_proof"},{"id":15,"name":"义工申请","path":"/page/front/volunteer_apply.html","description":"用户端提交义工申请","flag":"apply"}]'
WHERE id = 3;
