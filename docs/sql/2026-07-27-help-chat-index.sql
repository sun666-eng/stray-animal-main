-- 崩溃预防 P0.2：t_help 聊天/归属查询索引
-- Schema contract: 2026.07.29-workflow-closure-p0-v10.
-- 适用：生产 pure-check 模式（auto-migrate=false）须先手工执行；
--       dev/auto-migrate 由 SchemaGuardRunner 自动创建。
-- 背景：聊天轮询（每在线页面 10s 一次）执行
--   WHERE title='聊天室消息' ORDER BY create_time DESC, id DESC LIMIT 100
-- t_help 此前仅有主键 → 全表扫 + filesort，消息堆积后拖垮连接池。

SET @table_exists := (SELECT COUNT(*) FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 't_help');
SET @required_columns := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 't_help'
    AND COLUMN_NAME IN ('title', 'create_time', 'id'));
SET @exists := (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 't_help' AND INDEX_NAME = 'idx_help_chat');
SET @sql := IF(@table_exists = 1 AND @required_columns = 3 AND @exists = 0,
  'ALTER TABLE t_help ADD INDEX idx_help_chat (title, create_time, id)', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @required_columns := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 't_help' AND COLUMN_NAME = 'uid');
SET @exists := (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 't_help' AND INDEX_NAME = 'idx_help_uid');
SET @sql := IF(@table_exists = 1 AND @required_columns = 1 AND @exists = 0,
  'ALTER TABLE t_help ADD INDEX idx_help_uid (uid)', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
