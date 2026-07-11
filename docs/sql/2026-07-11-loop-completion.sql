-- 功能闭环补全：增量字段（可重复执行时请先检查列是否已存在）
-- 执行库：与 application.yml 中 DB_NAME 一致

-- 凭证审核状态：0待审核 1已通过 2已驳回
ALTER TABLE t_proof
  ADD COLUMN pstatus INT NOT NULL DEFAULT 0 COMMENT '0待审核 1已通过 2已驳回' AFTER ptitle;

-- 义工免冠照文件 flag
ALTER TABLE t_volunteer
  ADD COLUMN apic VARCHAR(255) NULL COMMENT '本人免冠照文件flag' AFTER uid;

-- 历史凭证统一为待审核（新列默认已是 0，此句兼容旧数据）
UPDATE t_proof SET pstatus = 0 WHERE pstatus IS NULL;
