package com.example.common;

import com.example.exception.CustomException;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * A0.4 纵深：XSS 用户名载荷在注册/创建时必须被拒绝。
 */
public class UsernamePolicyTest {

    @Test
    public void validUsernames() {
        assertTrue(UsernamePolicy.isValid("admin"));
        assertTrue(UsernamePolicy.isValid("user_01"));
        assertTrue(UsernamePolicy.isValid("张三"));
        assertTrue(UsernamePolicy.isValid("a.b-c"));
    }

    @Test
    public void xssProbes_allRejected() {
        for (String probe : UsernamePolicy.xssProbeUsernames()) {
            assertFalse(UsernamePolicy.isValid(probe), "should reject: " + probe);
            assertThrows(CustomException.class, () -> UsernamePolicy.requireValid(probe));
        }
    }

    @Test
    public void rejectsEmptyAndTooLong() {
        assertFalse(UsernamePolicy.isValid(""));
        assertFalse(UsernamePolicy.isValid("a"));
        assertFalse(UsernamePolicy.isValid(null));
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < 33; i++) {
            sb.append('a');
        }
        assertFalse(UsernamePolicy.isValid(sb.toString()));
    }

    @Test
    public void rejectsSpacesAndAngleBrackets() {
        assertFalse(UsernamePolicy.isValid("bad name"));
        assertFalse(UsernamePolicy.isValid("a<script>"));
        assertFalse(UsernamePolicy.isValid("a>b"));
    }
}
