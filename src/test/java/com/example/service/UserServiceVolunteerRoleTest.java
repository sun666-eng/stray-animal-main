package com.example.service;

import com.example.entity.Role;
import com.example.entity.User;
import com.example.entity.Volunteer;
import com.example.exception.CustomException;
import com.example.mapper.UserMapper;
import com.example.mapper.VolunteerMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.Arrays;
import java.util.Collections;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class UserServiceVolunteerRoleTest {

    private UserService service;
    private UserMapper userMapper;
    private VolunteerMapper volunteerMapper;
    private RoleService roleService;

    @BeforeEach
    void setUp() {
        service = new UserService();
        userMapper = mock(UserMapper.class);
        volunteerMapper = mock(VolunteerMapper.class);
        roleService = mock(RoleService.class);
        ReflectionTestUtils.setField(service, "baseMapper", userMapper);
        ReflectionTestUtils.setField(service, "userMapper", userMapper);
        ReflectionTestUtils.setField(service, "volunteerMapper", volunteerMapper);
        ReflectionTestUtils.setField(service, "roleService", roleService);
        ReflectionTestUtils.setField(service, "fileAssetService", mock(FileAssetService.class));
        ReflectionTestUtils.setField(service, "volunteerRoleId", 4L);
    }

    @Test
    void ensureRoleRejectsEveryRoleExceptFour() {
        for (long unsafe = 1; unsafe <= 3; unsafe++) {
            final long unsafeRoleId = unsafe;
            CustomException error = assertThrows(CustomException.class,
                    () -> service.ensureHasRole(7L, unsafeRoleId));
            assertEquals("500", error.getCode());
        }
        verify(userMapper, never()).updateById(any(User.class));
    }

    @Test
    void grantAppendsOnlyRoleFourAndPreservesOtherRoles() {
        User user = userWithRoles(role(3L), role(5L));
        when(userMapper.selectOne(any(), any(boolean.class))).thenReturn(user);
        Role volunteerRole = role(4L);
        volunteerRole.setName("Certified Volunteer");
        when(roleService.getById(4L)).thenReturn(volunteerRole);
        when(userMapper.updateById(any(User.class))).thenReturn(1);

        service.ensureHasRole(7L, 4L);

        ArgumentCaptor<User> patch = ArgumentCaptor.forClass(User.class);
        verify(userMapper).updateById(patch.capture());
        assertEquals(Arrays.asList(3L, 5L, 4L), Arrays.asList(
                patch.getValue().getRole().get(0).getId(),
                patch.getValue().getRole().get(1).getId(),
                patch.getValue().getRole().get(2).getId()));
    }

    @Test
    void grantRoleFourRestoresOrdinaryRoleWhenOnlyBadgeRemains() {
        User user = userWithRoles(role(4L));
        when(userMapper.selectOne(any(), any(boolean.class))).thenReturn(user);
        when(roleService.getById(4L)).thenReturn(role(4L));
        Role ordinary = role(3L);
        ordinary.setName("普通用户");
        when(roleService.getById(3L)).thenReturn(ordinary);
        when(userMapper.updateById(any(User.class))).thenReturn(1);

        service.ensureHasRole(7L, 4L);

        ArgumentCaptor<User> patch = ArgumentCaptor.forClass(User.class);
        verify(userMapper).updateById(patch.capture());
        assertEquals(Arrays.asList(3L, 4L), Arrays.asList(
                patch.getValue().getRole().get(0).getId(),
                patch.getValue().getRole().get(1).getId()));
    }

    @Test
    void revokeRemovesOnlyRoleFourWhenNoApprovedApplicationRemains() {
        User user = userWithRoles(role(3L), role(4L), role(5L));
        when(userMapper.selectOne(any(), any(boolean.class))).thenReturn(user);
        when(volunteerMapper.selectList(any())).thenReturn(java.util.Collections.emptyList());
        when(userMapper.updateById(any(User.class))).thenReturn(1);

        service.removeRoleIfNoApprovedVolunteer(7L, 4L);

        ArgumentCaptor<User> patch = ArgumentCaptor.forClass(User.class);
        verify(userMapper).updateById(patch.capture());
        assertEquals(Long.valueOf(7L), patch.getValue().getId());
        assertEquals(Arrays.asList(3L, 5L), Arrays.asList(
                patch.getValue().getRole().get(0).getId(),
                patch.getValue().getRole().get(1).getId()));
    }

    @Test
    void revokeKeepsRoleFourWhenAnotherApprovedApplicationExists() {
        User user = userWithRoles(role(3L), role(4L));
        when(userMapper.selectOne(any(), any(boolean.class))).thenReturn(user);
        when(volunteerMapper.selectList(any())).thenReturn(
                java.util.Collections.singletonList(new com.example.entity.Volunteer()));

        service.removeRoleIfNoApprovedVolunteer(7L, 4L);

        verify(userMapper, never()).updateById(any(User.class));
    }

    @Test
    void lockedProfileUpdate_restoresDerivedRoleAfterStaleRoleRemoval() {
        User locked = userWithRoles(role(3L));
        when(userMapper.selectOne(any(), any(boolean.class))).thenReturn(locked);
        when(volunteerMapper.selectList(any())).thenReturn(
                Collections.singletonList(approvedVolunteer()));
        when(roleService.getById(4L)).thenReturn(role(4L));
        when(userMapper.updateById(any(User.class))).thenReturn(1);
        User staleProfile = new User();
        staleProfile.setId(7L);

        service.updateWithAvatarBind(staleProfile, locked, null, 7L, false);

        ArgumentCaptor<User> patch = ArgumentCaptor.forClass(User.class);
        verify(userMapper).updateById(patch.capture());
        assertEquals(Arrays.asList(3L, 4L), roleIds(patch.getValue()));
    }

    @Test
    void lockedProfileUpdate_removesStaleDerivedRoleWhenApprovalIsGone() {
        User locked = userWithRoles(role(3L), role(4L));
        when(userMapper.selectOne(any(), any(boolean.class))).thenReturn(locked);
        when(volunteerMapper.selectList(any())).thenReturn(Collections.emptyList());
        when(userMapper.updateById(any(User.class))).thenReturn(1);
        User staleProfile = new User();
        staleProfile.setId(7L);

        service.updateWithAvatarBind(staleProfile, locked, null, 7L, false);

        ArgumentCaptor<User> patch = ArgumentCaptor.forClass(User.class);
        verify(userMapper).updateById(patch.capture());
        assertEquals(Collections.singletonList(3L), roleIds(patch.getValue()));
    }

    @Test
    void explicitRoleEditCannotRemoveDerivedRoleBackedByApproval() {
        User locked = userWithRoles(role(3L), role(4L));
        when(userMapper.selectOne(any(), any(boolean.class))).thenReturn(locked);
        when(volunteerMapper.selectList(any())).thenReturn(
                Collections.singletonList(approvedVolunteer()));
        when(roleService.getById(4L)).thenReturn(role(4L));
        when(userMapper.updateById(any(User.class))).thenReturn(1);
        User requested = new User();
        requested.setId(7L);
        requested.setRole(Collections.singletonList(role(3L)));

        service.updateWithAvatarBind(requested, locked, null, 7L, true);

        ArgumentCaptor<User> patch = ArgumentCaptor.forClass(User.class);
        verify(userMapper).updateById(patch.capture());
        assertEquals(Arrays.asList(3L, 4L), roleIds(patch.getValue()));
    }

    @Test
    void explicitDerivedRoleInUserUpdateIsRejected() {
        User locked = userWithRoles(role(3L));
        when(userMapper.selectOne(any(), any(boolean.class))).thenReturn(locked);
        User requested = new User();
        requested.setId(7L);
        requested.setRole(Arrays.asList(role(3L), role(4L)));

        CustomException error = assertThrows(CustomException.class,
                () -> service.updateWithAvatarBind(requested, locked, null, 7L, true));

        assertEquals("400", error.getCode());
        verify(userMapper, never()).updateById(any(User.class));
    }

    @Test
    void disabledDerivationPreservesLockedRoleWithoutVolunteerQuery() {
        ReflectionTestUtils.setField(service, "volunteerRoleId", 0L);
        User locked = userWithRoles(role(3L), role(4L));
        when(userMapper.selectOne(any(), any(boolean.class))).thenReturn(locked);
        when(userMapper.updateById(any(User.class))).thenReturn(1);
        User profile = new User();
        profile.setId(7L);

        service.updateWithAvatarBind(profile, locked, null, 7L, false);

        verify(volunteerMapper, never()).selectList(any());
        verify(roleService, never()).getById(4L);
        ArgumentCaptor<User> patch = ArgumentCaptor.forClass(User.class);
        verify(userMapper).updateById(patch.capture());
        assertEquals(Arrays.asList(3L, 4L), roleIds(patch.getValue()));
    }

    private static Volunteer approvedVolunteer() {
        Volunteer volunteer = new Volunteer();
        volunteer.setUid(7L);
        volunteer.setVstate(VolunteerService.STATE_APPROVED);
        return volunteer;
    }

    private static java.util.List<Long> roleIds(User user) {
        java.util.List<Long> ids = new java.util.ArrayList<>();
        for (Role role : user.getRole()) {
            ids.add(role.getId());
        }
        return ids;
    }

    private static User userWithRoles(Role... roles) {
        User user = new User();
        user.setId(7L);
        user.setRole(Arrays.asList(roles));
        return user;
    }

    private static Role role(Long id) {
        Role role = new Role();
        role.setId(id);
        return role;
    }
}
