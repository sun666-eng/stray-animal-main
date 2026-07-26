-- Preserve unknown animal birthdays honestly instead of applying a fabricated default.
ALTER TABLE t_animal
  MODIFY COLUMN tbirthday DATE NULL DEFAULT NULL COMMENT '动物生日（未知时为空）';
