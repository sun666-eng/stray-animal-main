package com.example.common;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class StartupMutationPolicyTest {

    @Test
    void autoMigrateFalseDisallowsMutations() {
        StartupMutationPolicy policy = new StartupMutationPolicy(false);
        assertFalse(policy.isMutationsAllowed());
        assertThrows(IllegalStateException.class, () -> policy.requireMutations("X"));
    }

    @Test
    void autoMigrateTrueAllowsMutations() {
        StartupMutationPolicy policy = new StartupMutationPolicy(true);
        assertTrue(policy.isMutationsAllowed());
    }
}
