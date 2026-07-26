package com.example.service;

import com.example.entity.FileAsset;
import com.example.entity.Help;
import com.example.entity.Permission;
import com.example.entity.Proof;
import com.example.entity.User;
import com.example.entity.Visit;
import com.example.entity.Volunteer;
import com.example.mapper.HelpMapper;
import com.example.mapper.ProofMapper;
import com.example.mapper.UserMapper;
import com.example.mapper.VisitMapper;
import com.example.mapper.VolunteerMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.Collections;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

public class FileAssetReadAuthorizationTest {

    private FileAssetService service;
    private ProofMapper proofMapper;
    private VisitMapper visitMapper;
    private VolunteerMapper volunteerMapper;
    private HelpMapper helpMapper;
    private UserMapper userMapper;

    @BeforeEach
    public void setUp() {
        service = new FileAssetService();
        proofMapper = mock(ProofMapper.class);
        visitMapper = mock(VisitMapper.class);
        volunteerMapper = mock(VolunteerMapper.class);
        helpMapper = mock(HelpMapper.class);
        userMapper = mock(UserMapper.class);
        ReflectionTestUtils.setField(service, "proofMapper", proofMapper);
        ReflectionTestUtils.setField(service, "visitMapper", visitMapper);
        ReflectionTestUtils.setField(service, "volunteerMapper", volunteerMapper);
        ReflectionTestUtils.setField(service, "helpMapper", helpMapper);
        ReflectionTestUtils.setField(service, "userMapper", userMapper);
    }

    @Test
    public void adopterCanReadStaffUploadedBoundVisitFile() {
        Visit visit = new Visit();
        visit.setId(41L);
        visit.setUid(7L);
        when(visitMapper.selectById(41L)).thenReturn(visit);

        assertTrue(service.canRead(user(7L), boundAsset("visit", "visit", 41L, 99L)));
    }

    @Test
    public void unrelatedUserCannotReadBoundVisitFile() {
        Visit visit = new Visit();
        visit.setId(41L);
        visit.setUid(7L);
        when(visitMapper.selectById(41L)).thenReturn(visit);

        assertFalse(service.canRead(user(8L), boundAsset("visit", "visit", 41L, 99L)));
    }

    @Test
    public void businessOwnersCanReadProofHelpAndVolunteerFiles() {
        Proof proof = new Proof();
        proof.setId(11L);
        proof.setPuid(7L);
        when(proofMapper.selectById(11L)).thenReturn(proof);

        Help help = new Help();
        help.setId(12L);
        help.setUid(7L);
        when(helpMapper.selectById(12L)).thenReturn(help);

        Volunteer volunteer = new Volunteer();
        volunteer.setId(13L);
        volunteer.setUid(7L);
        when(volunteerMapper.selectById(13L)).thenReturn(volunteer);

        User owner = user(7L);
        assertTrue(service.canRead(owner, boundAsset("proof", "proof", 11L, 99L)));
        assertTrue(service.canRead(owner, boundAsset("help", "help", 12L, 99L)));
        assertTrue(service.canRead(owner, boundAsset("volunteer", "volunteer", 13L, 99L)));
    }

    @Test
    public void unboundPrivateAssetIsUploaderOnlyEvenForDomainManager() {
        FileAsset asset = privateAsset(5L);

        assertTrue(service.canRead(user(5L), asset));
        assertFalse(service.canRead(user(6L), asset));
        assertFalse(service.canRead(manager(9L, "proof"), asset));
    }

    @Test
    public void matchingDomainManagerCanReadBoundFile() {
        Proof proof = new Proof();
        proof.setId(11L);
        proof.setPuid(7L);
        when(proofMapper.selectById(11L)).thenReturn(proof);

        assertTrue(service.canRead(manager(9L, "proof"),
                boundAsset("proof", "proof", 11L, 99L)));
    }

    @Test
    public void formerManagerUploaderCannotReadAfterPermissionIsRevoked() {
        Proof proof = new Proof();
        proof.setId(11L);
        proof.setPuid(7L);
        when(proofMapper.selectById(11L)).thenReturn(proof);

        assertFalse(service.canRead(user(99L),
                boundAsset("proof", "proof", 11L, 99L)));
    }

    @Test
    public void missingBusinessRowDeniesUploaderAndCurrentDomainManager() {
        when(proofMapper.selectById(404L)).thenReturn(null);
        FileAsset asset = boundAsset("proof", "proof", 404L, 99L);

        assertFalse(service.canRead(user(99L), asset));
        assertFalse(service.canRead(manager(9L, "proof"), asset));
    }

    @Test
    public void userCanReadFileBoundToOwnUserRecord() {
        User owner = user(7L);
        when(userMapper.selectById(7L)).thenReturn(owner);

        assertTrue(service.canRead(owner, boundAsset("avatar", "user", 7L, 99L)));
    }

    @Test
    public void unknownPartialAndMismatchedBindingsFailClosed() {
        User uploader = user(5L);
        FileAsset unknown = boundAsset("proof", "invoice", 11L, 5L);
        FileAsset mismatched = boundAsset("proof", "help", 11L, 5L);
        FileAsset partial = privateAsset(5L);
        partial.setBusinessType("proof");

        assertFalse(service.canRead(uploader, unknown));
        assertFalse(service.canRead(uploader, mismatched));
        assertFalse(service.canRead(uploader, partial));
    }

    private FileAsset boundAsset(String purpose, String businessType, Long businessId, Long uploaderId) {
        FileAsset asset = privateAsset(uploaderId);
        asset.setPurpose(purpose);
        asset.setBusinessType(businessType);
        asset.setBusinessId(businessId);
        return asset;
    }

    private FileAsset privateAsset(Long uploaderId) {
        FileAsset asset = new FileAsset();
        asset.setVisibility(FileAssetService.VIS_PRIVATE);
        asset.setOwnerId(uploaderId);
        asset.setDeleted(0);
        return asset;
    }

    private User user(Long id) {
        User user = new User();
        user.setId(id);
        return user;
    }

    private User manager(Long id, String flag) {
        User user = user(id);
        Permission permission = new Permission();
        permission.setFlag(flag);
        user.setPermission(Collections.singletonList(permission));
        return user;
    }
}
