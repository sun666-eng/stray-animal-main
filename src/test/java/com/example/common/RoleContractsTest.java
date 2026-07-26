package com.example.common;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

public class RoleContractsTest {

    @Test
    public void role3Json_hasAllUserLoopFlags_noAdmin() {
        assertTrue(RoleContracts.hasAllUserLoopFlags(RoleContracts.ROLE3_PERMISSION_JSON));
        assertFalse(RoleContracts.hasAnyAdminFlag(RoleContracts.ROLE3_PERMISSION_JSON));
    }

    @Test
    public void role4Empty_hasNoAdmin() {
        assertFalse(RoleContracts.hasAnyAdminFlag(RoleContracts.ROLE4_PERMISSION_JSON));
        assertFalse(RoleContracts.hasAllUserLoopFlags("[]"));
    }

    @Test
    public void volunteerAdminJson_detectedAsAdmin() {
        String vol = "[{\"flag\":\"visit\"},{\"flag\":\"adopt\"},{\"flag\":\"proof\"}]";
        assertTrue(RoleContracts.hasAnyAdminFlag(vol));
    }

    @Test
    public void missingMyProof_failsUserLoop() {
        String broken = "[{\"flag\":\"im\"},{\"flag\":\"adopt_view\"},{\"flag\":\"my_adopt\"},{\"flag\":\"apply\"}]";
        assertFalse(RoleContracts.hasAllUserLoopFlags(broken));
    }
}
