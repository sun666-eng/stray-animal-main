-- 修复「我的义工申请」系统异常：Unknown column 'uid' in 'where clause'
-- 若提示 Duplicate column name，说明该列已存在，可忽略对应语句。
--
-- 错误 1046 No database selected = 没有选库，必须先 USE。

-- ========== 1. 先选中业务库（名称与 application.yml 的 DB_NAME 一致，默认 test）==========
USE `test`;

-- 若你的库名不是 test，改成实际库名，例如：
-- USE `stray_animal`;

-- ========== 2. 加列 ==========
-- 1) 申请用户 ID（/api/volunteer/mine 按 uid 查询）
ALTER TABLE t_volunteer
  ADD COLUMN uid BIGINT NULL DEFAULT NULL COMMENT '申请用户ID' AFTER vstate;

-- 2) 免照（实体 Volunteer.apic）
ALTER TABLE t_volunteer
  ADD COLUMN apic VARCHAR(255) NULL DEFAULT NULL COMMENT '本人免冠照文件flag' AFTER uid;
