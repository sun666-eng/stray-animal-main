-- 崩溃预防 P0.2：t_help 聊天/归属查询索引
-- 适用：生产 pure-check 模式（auto-migrate=false）须先手工执行；
--       dev/auto-migrate 由 SchemaGuardRunner 自动创建。
-- 背景：聊天轮询（每在线页面 10s 一次）执行
--   WHERE title='聊天室消息' ORDER BY create_time DESC, id DESC LIMIT 100
-- t_help 此前仅有主键 → 全表扫 + filesort，消息堆积后拖垮连接池。

ALTER TABLE t_help ADD INDEX idx_help_chat (title, create_time, id);
ALTER TABLE t_help ADD INDEX idx_help_uid (uid);
