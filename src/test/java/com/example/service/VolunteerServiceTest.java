package com.example.service;

import com.example.entity.Permission;
import com.example.entity.User;
import com.example.entity.Volunteer;
import com.example.exception.CustomException;
import com.example.mapper.VolunteerMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.Collections;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class VolunteerServiceTest {

    private VolunteerService service;
    private VolunteerMapper mapper;
    private UserService userService;
    private FileAssetService fileAssetService;

    @BeforeEach
    void setUp() {
        service = new VolunteerService();
        mapper = mock(VolunteerMapper.class);
        userService = mock(UserService.class);
        fileAssetService = mock(FileAssetService.class);
        ReflectionTestUtils.setField(service, "baseMapper", mapper);
        ReflectionTestUtils.setField(service, "volunteerMapper", mapper);
        ReflectionTestUtils.setField(service, "userService", userService);
        ReflectionTestUtils.setField(service, "fileAssetService", fileAssetService);
        ReflectionTestUtils.setField(service, "autoGrantRoleId", 4L);
    }

    @Test
    void submitIgnoresForgedIdUidIdentityAndState() {
        User actor = ordinaryUser(7L);
        authenticate(actor);
        when(mapper.selectList(any())).thenReturn(Collections.emptyList());
        when(mapper.insert(any(Volunteer.class))).thenAnswer(invocation -> {
            Volunteer saved = invocation.getArgument(0);
            assertNull(saved.getId());
            saved.setId(11L);
            return 1;
        });

        Volunteer request = validApplication();
        request.setId(999L);
        request.setUid(888L);
        request.setName("forged-name");
        request.setTel("13900000000");
        request.setEmail("forged@example.com");
        request.setVstate(VolunteerService.STATE_APPROVED);

        assertTrue(service.submitVolunteer(request, actor));

        assertEquals(Long.valueOf(7L), request.getUid());
        assertEquals("db-user", request.getName());
        assertEquals("13800138000", request.getTel());
        assertEquals("db@example.com", request.getEmail());
        assertEquals(Integer.valueOf(VolunteerService.STATE_PENDING), request.getVstate());
    }

    @Test
    void submitBindsPhotoAsVolunteerBusinessOwnedByAuthenticatedUser() {
        User actor = ordinaryUser(7L);
        authenticate(actor);
        when(mapper.selectList(any())).thenReturn(Collections.emptyList());
        when(mapper.insert(any(Volunteer.class))).thenAnswer(invocation -> {
            ((Volunteer) invocation.getArgument(0)).setId(11L);
            return 1;
        });
        Volunteer request = validApplication();
        request.setApic(" volunteer-photo-flag ");

        assertTrue(service.submitVolunteer(request, actor));

        verify(fileAssetService).bindToBusiness(eq(actor), eq("volunteer-photo-flag"),
                eq("volunteer"), eq("volunteer"), eq(11L), eq(false));
    }

    @Test
    void submitRejectsInvalidStateAndApplicationData() {
        User actor = ordinaryUser(7L);
        authenticate(actor);
        Volunteer invalidState = validApplication();
        invalidState.setVstate(9);
        assertCode("400", () -> service.submitVolunteer(invalidState, actor));

        Volunteer invalidAge = validApplication();
        invalidAge.setAge(15);
        assertCode("400", () -> service.submitVolunteer(invalidAge, actor));

        actor.setPhone("123");
        assertCode("400", () -> service.submitVolunteer(validApplication(), actor));
        actor.setPhone("13800138000");
        actor.setEmail("invalid-email");
        assertCode("400", () -> service.submitVolunteer(validApplication(), actor));
        actor.setEmail("db@example.com");

        Volunteer invalidAvailability = validApplication();
        invalidAvailability.setSparetime(5);
        assertCode("400", () -> service.submitVolunteer(invalidAvailability, actor));
        Volunteer invalidVisit = validApplication();
        invalidVisit.setIsvisit(2);
        assertCode("400", () -> service.submitVolunteer(invalidVisit, actor));
        Volunteer missingExperience = validApplication();
        missingExperience.setMoreability(" ");
        assertCode("400", () -> service.submitVolunteer(missingExperience, actor));
        verify(mapper, never()).insert(any(Volunteer.class));
    }

    @Test
    void submitRejectsPendingOrApprovedDuplicateButAllowsAfterRejectedOnly() {
        User actor = ordinaryUser(7L);
        authenticate(actor);
        Volunteer pending = new Volunteer();
        pending.setVstate(VolunteerService.STATE_PENDING);
        when(mapper.selectList(any())).thenReturn(Collections.singletonList(pending));
        assertCode("409", () -> service.submitVolunteer(validApplication(), actor));
        verify(mapper, never()).insert(any(Volunteer.class));

        when(mapper.selectList(any())).thenReturn(Collections.emptyList());
        when(mapper.insert(any(Volunteer.class))).thenReturn(1);
        assertTrue(service.submitVolunteer(validApplication(), actor));
    }

    @Test
    void updateRejectsCrossOwnerAndAnyGenericStateWrite() {
        User actor = ordinaryUser(7L);
        authenticate(actor);
        Volunteer existing = validApplication();
        existing.setId(2L);
        existing.setUid(8L);
        existing.setVstate(VolunteerService.STATE_PENDING);
        when(mapper.selectOne(any(), any(boolean.class))).thenReturn(existing);

        Volunteer request = validApplication();
        request.setId(2L);
        assertCode("403", () -> service.updateVolunteer(request, actor));

        existing.setUid(7L);
        request.setVstate(VolunteerService.STATE_PENDING);
        assertCode("400", () -> service.updateVolunteer(request, actor));
        verify(mapper, never()).updateById(any(Volunteer.class));
    }

    @Test
    void managerGenericUpdatePreservesOwnershipIdentityStateAndPhoto() {
        User manager = manager(1L);
        authenticate(manager);
        Volunteer existing = validApplication();
        existing.setId(2L);
        existing.setUid(7L);
        existing.setVstate(VolunteerService.STATE_APPROVED);
        existing.setName("Original Applicant");
        existing.setTel("13800138002");
        existing.setEmail("original@example.com");
        existing.setApic("original-photo");
        when(mapper.selectOne(any(), any(boolean.class))).thenReturn(existing);
        when(mapper.updateById(any(Volunteer.class))).thenReturn(1);
        Volunteer request = validApplication();
        request.setId(2L);
        request.setUid(999L);
        request.setName("Forged Applicant");
        request.setTel("13900139000");
        request.setEmail("forged@example.com");
        request.setVstate(null);
        request.setApic("other-users-upload");

        assertTrue(service.updateVolunteer(request, manager));

        ArgumentCaptor<Volunteer> saved = ArgumentCaptor.forClass(Volunteer.class);
        verify(mapper).updateById(saved.capture());
        assertEquals(Long.valueOf(7L), saved.getValue().getUid());
        assertEquals(Integer.valueOf(VolunteerService.STATE_APPROVED), saved.getValue().getVstate());
        assertEquals("Original Applicant", saved.getValue().getName());
        assertEquals("13800138002", saved.getValue().getTel());
        assertEquals("original@example.com", saved.getValue().getEmail());
        assertEquals("original-photo", saved.getValue().getApic());
        verify(fileAssetService, never()).bindToBusiness(any(), any(), any(), any(), anyLong(), any(boolean.class));
    }

    @Test
    void applicantCanReplaceOnlyOwnPendingRecordPhoto() {
        User actor = ordinaryUser(7L);
        authenticate(actor);
        Volunteer existing = validApplication();
        existing.setId(2L);
        existing.setUid(7L);
        existing.setVstate(VolunteerService.STATE_PENDING);
        existing.setApic("old-photo");
        when(mapper.selectOne(any(), any(boolean.class))).thenReturn(existing);
        when(mapper.updateById(any(Volunteer.class))).thenReturn(1);
        Volunteer request = validApplication();
        request.setId(2L);
        request.setApic("new-photo");

        assertTrue(service.updateVolunteer(request, actor));

        verify(fileAssetService).bindToBusiness(actor, "new-photo", "volunteer",
                "volunteer", 2L, false);
        verify(fileAssetService).retireIfMatches("old-photo", "volunteer", 2L);
    }

    @Test
    void auditGrantRevokeAndDeleteSynchronizeRoleFour() {
        User manager = manager(1L);
        authenticate(manager);
        Volunteer existing = validApplication();
        existing.setId(2L);
        existing.setUid(7L);
        existing.setVstate(VolunteerService.STATE_PENDING);
        when(mapper.selectById(2L)).thenReturn(existing);
        when(userService.lockVolunteerRoleUser(7L)).thenReturn(ordinaryUser(7L));
        when(mapper.selectOne(any(), any(boolean.class))).thenReturn(existing);
        when(mapper.selectList(any())).thenReturn(Collections.emptyList());
        when(mapper.updateById(any(Volunteer.class))).thenReturn(1);

        assertTrue(service.auditVolunteer(2L, VolunteerService.STATE_APPROVED, manager));
        verify(userService).ensureHasRole(7L, 4L);

        existing.setVstate(VolunteerService.STATE_APPROVED);
        assertTrue(service.auditVolunteer(2L, VolunteerService.STATE_REJECTED, manager));
        verify(userService).removeRoleIfNoApprovedVolunteer(7L, 4L);

        when(mapper.delete(any())).thenReturn(1);
        assertTrue(service.deleteVolunteer(2L, manager));
        verify(userService, org.mockito.Mockito.times(2))
                .removeRoleIfNoApprovedVolunteer(7L, 4L);
        verify(fileAssetService).retireAllForBusiness("volunteer", 2L);
    }

    @Test
    void auditRejectsUnsafeRoleConfigurationAndDuplicateApproval() {
        User manager = manager(1L);
        authenticate(manager);
        Volunteer existing = validApplication();
        existing.setId(2L);
        existing.setUid(7L);
        existing.setVstate(VolunteerService.STATE_PENDING);
        when(mapper.selectById(2L)).thenReturn(existing);
        when(userService.lockVolunteerRoleUser(7L)).thenReturn(ordinaryUser(7L));
        when(mapper.selectOne(any(), any(boolean.class))).thenReturn(existing);

        ReflectionTestUtils.setField(service, "autoGrantRoleId", 2L);
        assertCode("500", () -> service.auditVolunteer(2L, VolunteerService.STATE_APPROVED, manager));
        verify(userService, never()).ensureHasRole(anyLong(), anyLong());

        ReflectionTestUtils.setField(service, "autoGrantRoleId", 4L);
        when(mapper.selectList(any())).thenReturn(Collections.singletonList(existing));
        assertCode("409", () -> service.auditVolunteer(2L, VolunteerService.STATE_APPROVED, manager));
        verify(mapper, never()).updateById(any(Volunteer.class));
    }

    @Test
    void disabledRoleSyncAuditsStatusWithoutAnyRoleWrite() {
        User manager = manager(1L);
        authenticate(manager);
        Volunteer existing = validApplication();
        existing.setId(2L);
        existing.setUid(7L);
        existing.setVstate(VolunteerService.STATE_PENDING);
        when(mapper.selectById(2L)).thenReturn(existing);
        when(userService.lockVolunteerRoleUser(7L)).thenReturn(ordinaryUser(7L));
        when(mapper.selectOne(any(), any(boolean.class))).thenReturn(existing);
        when(mapper.selectList(any())).thenReturn(Collections.emptyList());
        when(mapper.updateById(any(Volunteer.class))).thenReturn(1);
        ReflectionTestUtils.setField(service, "autoGrantRoleId", 0L);

        assertTrue(service.auditVolunteer(2L, VolunteerService.STATE_APPROVED, manager));

        verify(userService, never()).ensureHasRole(anyLong(), anyLong());
        verify(userService, never()).removeRoleIfNoApprovedVolunteer(anyLong(), anyLong());
        ArgumentCaptor<Volunteer> patch = ArgumentCaptor.forClass(Volunteer.class);
        verify(mapper).updateById(patch.capture());
        assertEquals(Integer.valueOf(VolunteerService.STATE_APPROVED), patch.getValue().getVstate());
    }

    @Test
    void managerCanAuditAndDeleteLegacyOwnerlessRowWithoutRoleSync() {
        User manager = manager(1L);
        authenticate(manager);
        Volunteer legacy = validApplication();
        legacy.setId(2L);
        legacy.setUid(null);
        legacy.setVstate(VolunteerService.STATE_PENDING);
        when(mapper.selectById(2L)).thenReturn(legacy);
        when(mapper.selectOne(any(), any(boolean.class))).thenReturn(legacy);
        when(mapper.updateById(any(Volunteer.class))).thenReturn(1);
        ReflectionTestUtils.setField(service, "autoGrantRoleId", 9L);

        assertTrue(service.auditVolunteer(2L, VolunteerService.STATE_APPROVED, manager));
        verify(userService, never()).lockVolunteerRoleUser(anyLong());
        verify(userService, never()).ensureHasRole(anyLong(), anyLong());
        verify(userService, never()).removeRoleIfNoApprovedVolunteer(anyLong(), anyLong());

        legacy.setVstate(VolunteerService.STATE_APPROVED);
        when(mapper.delete(any())).thenReturn(1);
        assertTrue(service.deleteVolunteer(2L, manager));
        verify(fileAssetService).retireAllForBusiness("volunteer", 2L);
    }

    @Test
    void ordinaryUserCannotOwnUpdateOrDeleteLegacyOwnerlessRow() {
        User actor = ordinaryUser(7L);
        authenticate(actor);
        Volunteer legacy = validApplication();
        legacy.setId(2L);
        legacy.setUid(null);
        legacy.setVstate(VolunteerService.STATE_PENDING);
        when(mapper.selectById(2L)).thenReturn(legacy);
        when(mapper.selectOne(any(), any(boolean.class))).thenReturn(legacy);
        Volunteer request = validApplication();
        request.setId(2L);

        assertCode("403", () -> service.updateVolunteer(request, actor));
        assertCode("403", () -> service.deleteVolunteer(2L, actor));

        verify(mapper, never()).delete(any());
        verify(userService, never()).lockVolunteerRoleUser(anyLong());
    }

    @Test
    void auditRejectsInvalidStateAndNonManager() {
        User actor = ordinaryUser(7L);
        authenticate(actor);
        assertCode("403", () -> service.auditVolunteer(2L, VolunteerService.STATE_APPROVED, actor));

        User manager = manager(1L);
        authenticate(manager);
        assertCode("400", () -> service.auditVolunteer(2L, 3, manager));
        verify(mapper, never()).selectById(anyLong());
    }

    @Test
    void ordinaryUserCannotDeleteAnotherUsersApplication() {
        User actor = ordinaryUser(7L);
        authenticate(actor);
        Volunteer existing = new Volunteer();
        existing.setId(2L);
        existing.setUid(8L);
        existing.setVstate(VolunteerService.STATE_PENDING);
        when(mapper.selectById(2L)).thenReturn(existing);
        when(userService.lockVolunteerRoleUser(8L)).thenReturn(ordinaryUser(8L));
        when(mapper.selectOne(any(), any(boolean.class))).thenReturn(existing);

        assertCode("403", () -> service.deleteVolunteer(2L, actor));
        verify(mapper, never()).delete(any());
    }

    private void authenticate(User actor) {
        when(userService.getOne(any())).thenReturn(actor);
        when(userService.getById(actor.getId())).thenReturn(actor);
        when(userService.fillPermissions(actor)).thenReturn(actor);
    }

    private static User ordinaryUser(Long id) {
        User user = new User();
        user.setId(id);
        user.setUsername("db-user");
        user.setPhone("13800138000");
        user.setEmail("db@example.com");
        return user;
    }

    private static User manager(Long id) {
        User user = ordinaryUser(id);
        Permission permission = new Permission();
        permission.setFlag("volunteer");
        user.setPermission(Collections.singletonList(permission));
        return user;
    }

    private static Volunteer validApplication() {
        Volunteer volunteer = new Volunteer();
        volunteer.setName("Applicant");
        volunteer.setAge(25);
        volunteer.setTel("13800138001");
        volunteer.setEmail("applicant@example.com");
        volunteer.setWechat("wechat-id");
        volunteer.setLocation("Shanghai Yangpu");
        volunteer.setCompany("Animal Care Center");
        volunteer.setIsvisit(1);
        volunteer.setMoreability("Animal care and event support experience");
        volunteer.setSparetime(4);
        return volunteer;
    }

    private static void assertCode(String code, Runnable invocation) {
        CustomException error = assertThrows(CustomException.class, invocation::run);
        assertEquals(code, error.getCode());
    }
}
