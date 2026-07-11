-- Add authenticated ownership to volunteer applications.
-- Run once against an existing database before deploying the matching backend.
ALTER TABLE `t_volunteer`
  ADD COLUMN `uid` bigint(20) NULL COMMENT '申请用户ID';

CREATE INDEX `idx_volunteer_uid` ON `t_volunteer` (`uid`);

ALTER TABLE `t_volunteer`
  ADD CONSTRAINT `fk_volunteer_user`
  FOREIGN KEY (`uid`) REFERENCES `t_user` (`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Historical rows are intentionally left NULL when identity cannot be
-- established with certainty. They must be reviewed by an administrator.
