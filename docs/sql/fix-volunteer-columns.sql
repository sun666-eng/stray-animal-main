-- 修复「我的义工申请」系统异常：Unknown column 'uid' in 'where clause'
-- 在业务库（application.yml 的 DB_NAME，默认 test）中执行。
-- 若提示 Duplicate column name，说明该列已存在，可忽略对应语句。

-- 1) 申请用户 ID（/api/volunteer/mine 按 uid 查询）
ALTER TABLE t_volunteer
  ADD COLUMN uid BIGINT NULL DEFAULT NULL COMMENT '申请用户ID' AFTER vstate;

-- 2) 免照（实体 Volunteer.apic）
ALTER TABLE t_volunteer
  ADD COLUMN apic VARCHAR(255) NULL DEFAULT NULL COMMENT '本人免冠照文件flag' AFTER uid;
