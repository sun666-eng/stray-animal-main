-- Idempotent migration: t_account.avalue DOUBLE -> DECIMAL(19,2).
-- Rounding strategy: MySQL ROUND(avalue, 2), i.e. values halfway between cents round away from zero.
-- Safety: validate first, then let one ALTER TABLE perform conversion; no destructive pre-DDL UPDATE.

DELIMITER $$
DROP PROCEDURE IF EXISTS migrate_account_avalue_decimal$$
CREATE PROCEDURE migrate_account_avalue_decimal()
BEGIN
  DECLARE current_type VARCHAR(64);
  DECLARE current_precision INT;
  DECLARE current_scale INT;
  DECLARE invalid_rows BIGINT DEFAULT 0;

  SELECT DATA_TYPE, NUMERIC_PRECISION, NUMERIC_SCALE
    INTO current_type, current_precision, current_scale
    FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 't_account'
     AND COLUMN_NAME = 'avalue';

  IF current_type IS NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 't_account.avalue does not exist';
  END IF;

  IF NOT (current_type = 'decimal' AND current_precision = 19 AND current_scale = 2) THEN
    SELECT COUNT(*) INTO invalid_rows
      FROM t_account
     WHERE avalue IS NULL
        OR avalue <> avalue
        OR ABS(CAST(avalue AS DECIMAL(65,10)))
             > CAST('99999999999999999.99' AS DECIMAL(65,10));
    IF invalid_rows > 0 THEN
      SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 't_account.avalue contains null, nonfinite-like, or DECIMAL(19,2) out-of-range values';
    END IF;

    ALTER TABLE t_account
      MODIFY COLUMN avalue DECIMAL(19,2) NOT NULL COMMENT '款项金额';
  END IF;
END$$
CALL migrate_account_avalue_decimal()$$
DROP PROCEDURE migrate_account_avalue_decimal$$
DELIMITER ;
