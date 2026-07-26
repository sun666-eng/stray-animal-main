package com.example.service;

import com.baomidou.mybatisplus.core.conditions.Wrapper;
import com.example.entity.FileAsset;
import com.example.entity.Permission;
import com.example.entity.User;
import com.example.exception.CustomException;
import com.example.mapper.FileAssetMapper;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.test.util.ReflectionTestUtils;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.Collections;

/**
 * 绑定/解绑规则对抗：跨用途、private→avatar、解绑走 update wrapper。
 */
@ExtendWith(MockitoExtension.class)
public class FileAssetBindRulesTest {

    @Mock
    FileAssetMapper baseMapper;

    @InjectMocks
    FileAssetService service;

    private User owner() {
        User u = new User();
        u.setId(5L);
        return u;
    }

    private FileAsset asset(String purpose, String vis, Long bizId) {
        FileAsset a = new FileAsset();
        a.setId(1L);
        a.setFlag("flag-abc");
        a.setOwnerId(5L);
        a.setPurpose(purpose);
        a.setVisibility(vis);
        a.setBusinessId(bizId);
        a.setBusinessType(bizId == null ? null : "help");
        a.setOriginalName("a.png");
        a.setDeleted(0);
        return a;
    }

    @Test
    public void bind_privateToAvatar_forbidden() {
        FileAsset a = asset("private", "private", null);
        when(baseMapper.selectLiveByFlagForUpdate("flag-abc")).thenReturn(a);

        CustomException ex = assertThrows(CustomException.class,
                () -> service.bindToBusiness(owner(), "flag-abc", "avatar", "user", 9L, false));
        assertEquals("400", ex.getCode());
        assertTrue(ex.getMsg().contains("avatar"));
        verify(baseMapper, never()).update(any(), any());
    }

    @Test
    public void bind_crossPurposeProofToHelp_forbidden() {
        FileAsset a = asset("proof", "private", null);
        when(baseMapper.selectLiveByFlagForUpdate("flag-abc")).thenReturn(a);

        CustomException ex = assertThrows(CustomException.class,
                () -> service.bindToBusiness(owner(), "flag-abc", "help", "help", 3L, false));
        assertEquals("400", ex.getCode());
    }

    @Test
    public void bind_privateImageToVolunteer_forbiddenBecauseUploadWasNotDecoded() {
        FileAsset a = asset("private", "private", null);
        a.setOriginalName("portrait.png");
        when(baseMapper.selectLiveByFlagForUpdate("flag-abc")).thenReturn(a);

        CustomException ex = assertThrows(CustomException.class,
                () -> service.bindToBusiness(owner(), "flag-abc", "volunteer", "volunteer", 3L, false));

        assertEquals("400", ex.getCode());
        verify(baseMapper, never()).update(any(), any());
    }

    @Test
    public void bind_privateToProofOrVisit_forbiddenBecauseUploadWasNotDecoded() {
        FileAsset a = asset("private", "private", null);
        when(baseMapper.selectLiveByFlagForUpdate("flag-abc")).thenReturn(a);

        assertEquals("400", assertThrows(CustomException.class,
                () -> service.bindToBusiness(owner(), "flag-abc", "proof", "proof", 3L, false)).getCode());
        assertEquals("400", assertThrows(CustomException.class,
                () -> service.bindToBusiness(owner(), "flag-abc", "visit", "visit", 3L, false)).getCode());
        verify(baseMapper, never()).update(any(), any());
    }

    @Test
    public void bind_managerCannotClaimForeignUnboundUploadEvenWithOverride() {
        FileAsset a = asset("volunteer", "private", null);
        when(baseMapper.selectLiveByFlagForUpdate("flag-abc")).thenReturn(a);
        User manager = new User();
        manager.setId(9L);
        Permission permission = new Permission();
        permission.setFlag("volunteer");
        manager.setPermission(Collections.singletonList(permission));

        CustomException ex = assertThrows(CustomException.class,
                () -> service.bindToBusiness(manager, "flag-abc", "volunteer", "volunteer", 3L, true));

        assertEquals("403", ex.getCode());
        verify(baseMapper, never()).update(any(), any());
    }

    @Test
    public void bind_existingVolunteerPurpose_remainsBindableWithoutRetroDecode() {
        FileAsset a = asset("volunteer", "private", null);
        when(baseMapper.selectLiveByFlagForUpdate("flag-abc")).thenReturn(a);
        when(baseMapper.update(any(), any(Wrapper.class))).thenReturn(1);

        service.bindToBusiness(owner(), "flag-abc", "volunteer", "volunteer", 3L, false);

        verify(baseMapper).update(any(), any(Wrapper.class));
    }

    @Test
    public void bind_animalPromotesPrivateUploadToPublic() {
        FileAsset a = asset("animal", "private", null);
        when(baseMapper.selectLiveByFlagForUpdate("flag-abc")).thenReturn(a);
        when(baseMapper.update(any(), any(Wrapper.class))).thenReturn(1);

        service.bindToBusiness(owner(), "flag-abc", "animal", "animal", 3L, false);

        assertEquals(FileAssetService.VIS_PUBLIC, a.getVisibility());
        assertEquals("animal", a.getBusinessType());
        assertEquals(3L, a.getBusinessId());
    }

    @Test
    public void bind_sameBusiness_isIdempotentForDifferentActor() {
        FileAsset a = asset("help", "private", 3L);
        when(baseMapper.selectLiveByFlagForUpdate("flag-abc")).thenReturn(a);
        User other = new User();
        other.setId(9L);

        service.bindToBusiness(other, "flag-abc", "help", "help", 3L, true);

        verify(baseMapper, never()).update(any(), any());
    }

    @Test
    public void bind_alreadyBoundOtherBusiness_409() {
        FileAsset a = asset("help", "private", 99L);
        a.setBusinessType("help");
        when(baseMapper.selectLiveByFlagForUpdate("flag-abc")).thenReturn(a);

        CustomException ex = assertThrows(CustomException.class,
                () -> service.bindToBusiness(owner(), "flag-abc", "help", "help", 3L, false));
        assertEquals("409", ex.getCode());
    }

    @Test
    public void unbind_callsMapperUpdate() {
        FileAsset a = asset("avatar", "public", 7L);
        a.setBusinessType("user");
        when(baseMapper.selectOne(any(Wrapper.class), anyBoolean())).thenReturn(a);
        when(baseMapper.update(any(), any(Wrapper.class))).thenReturn(1);

        service.unbindIfMatches("flag-abc", "user", 7L);

        verify(baseMapper).update(any(), any(Wrapper.class));
    }

    @Test
    public void unbind_updateZeroRows_throws409() {
        FileAsset a = asset("help", "private", 3L);
        a.setBusinessType("help");
        when(baseMapper.selectOne(any(Wrapper.class), anyBoolean())).thenReturn(a);
        when(baseMapper.update(any(), any(Wrapper.class))).thenReturn(0);

        CustomException ex = assertThrows(CustomException.class,
                () -> service.unbindIfMatches("flag-abc", "help", 3L));
        assertEquals("409", ex.getCode());
    }

    @Test
    public void retire_marksBoundBusinessAssetDeleted() {
        FileAsset a = asset("proof", "private", 7L);
        a.setBusinessType("proof");
        when(baseMapper.selectOne(any(Wrapper.class), anyBoolean())).thenReturn(a);
        when(baseMapper.update(any(), any(Wrapper.class))).thenReturn(1);

        service.retireIfMatches("flag-abc", "proof", 7L);

        verify(baseMapper).update(any(), any(Wrapper.class));
    }

    @Test
    public void retireOwnUnbound_rejectsForeignOrBoundAssets() {
        FileAsset foreign = asset("proof", "private", null);
        foreign.setOwnerId(9L);
        when(baseMapper.selectOne(any(Wrapper.class), anyBoolean())).thenReturn(foreign);
        assertEquals("403", assertThrows(CustomException.class,
                () -> service.retireOwnUnbound(owner(), "flag-abc")).getCode());

        FileAsset bound = asset("proof", "private", 7L);
        bound.setBusinessType("proof");
        when(baseMapper.selectOne(any(Wrapper.class), anyBoolean())).thenReturn(bound);
        assertEquals("409", assertThrows(CustomException.class,
                () -> service.retireOwnUnbound(owner(), "flag-abc")).getCode());
        verify(baseMapper, never()).update(any(), any());
    }

    @Test
    public void retireOwnUnbound_marksOwnedStageDeleted() {
        FileAsset staged = asset("proof", "private", null);
        when(baseMapper.selectOne(any(Wrapper.class), anyBoolean())).thenReturn(staged);
        when(baseMapper.update(any(), any(Wrapper.class))).thenReturn(1);

        assertTrue(service.retireOwnUnbound(owner(), "flag-abc"));

        verify(baseMapper).update(any(), any(Wrapper.class));
    }

    @Test
    public void stagedCleanup_marksExpiredUnboundPrivateBatch() {
        ReflectionTestUtils.setField(service, "stagedCleanupEnabled", true);
        ReflectionTestUtils.setField(service, "stagedRetentionHours", 24L);
        FileAsset expired = asset("proof", "private", null);
        expired.setId(77L);
        when(baseMapper.selectList(any(Wrapper.class))).thenReturn(java.util.Collections.singletonList(expired));
        when(baseMapper.update(any(), any(Wrapper.class))).thenReturn(1);

        service.retireExpiredStagedUploads();

        verify(baseMapper).update(any(), any(Wrapper.class));
    }

    @Test
    public void stagedQuota_rejectsCountAndByteOverflow() {
        ReflectionTestUtils.setField(service, "maxStagedFilesPerUser", 20L);
        ReflectionTestUtils.setField(service, "maxStagedBytesPerUser", 100L);
        when(baseMapper.countLiveStagedByOwner(5L)).thenReturn(20L);
        when(baseMapper.sumLiveStagedBytesByOwner(5L)).thenReturn(50L);

        assertEquals("429", assertThrows(CustomException.class,
                () -> service.assertStagedQuota(5L, 1L, 1L)).getCode());

        when(baseMapper.countLiveStagedByOwner(5L)).thenReturn(1L);
        when(baseMapper.sumLiveStagedBytesByOwner(5L)).thenReturn(90L);
        assertEquals("429", assertThrows(CustomException.class,
                () -> service.assertStagedQuota(5L, 1L, 11L)).getCode());
    }
}
