package com.example.component;

import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Paths;

import static org.junit.jupiter.api.Assertions.assertTrue;

class BootstrapSqlSafetyTest {
    @Test
    void accountPrechecksPrecedeSingleNonDestructiveAlter() throws Exception {
        String sql = new String(Files.readAllBytes(Paths.get("docs/sql/bootstrap-all.sql")), StandardCharsets.UTF_8);
        int nullCheck = sql.indexOf("avalue IS NULL");
        int nonfiniteCheck = sql.indexOf("avalue <> avalue");
        int rangeCheck = sql.indexOf("ABS(CAST(avalue AS DECIMAL(65,10)))");
        int signal = sql.indexOf("SIGNAL SQLSTATE '45000'", nullCheck);
        int alter = sql.indexOf("ALTER TABLE t_account");
        assertTrue(nullCheck >= 0 && nonfiniteCheck > nullCheck && rangeCheck > nonfiniteCheck);
        assertTrue(signal > rangeCheck && alter > signal);
        assertTrue(!sql.contains("UPDATE t_account SET avalue = ROUND(avalue, 2)"));
        assertTrue(sql.contains("CAST('99999999999999999.99' AS DECIMAL(65,10))"));
        assertTrue(sql.contains("IF NOT (current_type = 'decimal' AND current_precision = 19 AND current_scale = 2)"));
        assertTrue(sql.contains("MODIFY COLUMN tbirthday DATE NULL DEFAULT NULL"));
    }
}
