-- 功能闭环补全：增量字段（可重复执行时请先检查列是否已存在）
-- 执行库：与 application.yml 中 DB_NAME 一致

-- 凭证审核状态：0待审核 1已通过 2已驳回
ALTER TABLE t_proof
  ADD COLUMN pstatus INT NOT NULL DEFAULT 0 COMMENT '0待审核 1已通过 2已驳回' AFTER ptitle;

-- 义工：申请用户ID + 免冠照（旧库可能两列都没有；已存在则跳过报错）
ALTER TABLE t_volunteer
  ADD COLUMN uid BIGINT NULL DEFAULT NULL COMMENT '申请用户ID' AFTER vstate;
ALTER TABLE t_volunteer
  ADD COLUMN apic VARCHAR(255) NULL DEFAULT NULL COMMENT '本人免冠照文件flag' AFTER uid;

-- 历史凭证统一为待审核（新列默认已是 0，此句兼容旧数据）
UPDATE t_proof SET pstatus = 0 WHERE pstatus IS NULL;

-- 角色权限 JSON 过长时 varchar(2000) 会被截断，导致管理员权限加载失败
ALTER TABLE t_role MODIFY COLUMN permission TEXT;
ALTER TABLE t_user MODIFY COLUMN role TEXT;
