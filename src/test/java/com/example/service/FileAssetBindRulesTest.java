package com.example.service;

import com.baomidou.mybatisplus.core.conditions.Wrapper;
import com.example.entity.FileAsset;
import com.example.entity.User;
import com.example.exception.CustomException;
import com.example.mapper.FileAssetMapper;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

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
        when(baseMapper.selectOne(any(Wrapper.class), anyBoolean())).thenReturn(a);

        CustomException ex = assertThrows(CustomException.class,
                () -> service.bindToBusiness(owner(), "flag-abc", "avatar", "user", 9L, false));
        assertEquals("400", ex.getCode());
        assertTrue(ex.getMsg().contains("avatar"));
        verify(baseMapper, never()).update(any(), any());
    }

    @Test
    public void bind_crossPurposeProofToHelp_forbidden() {
        FileAsset a = asset("proof", "private", null);
        when(baseMapper.selectOne(any(Wrapper.class), anyBoolean())).thenReturn(a);

        CustomException ex = assertThrows(CustomException.class,
                () -> service.bindToBusiness(owner(), "flag-abc", "help", "help", 3L, false));
        assertEquals("400", ex.getCode());
    }

    @Test
    public void bind_alreadyBoundOtherBusiness_409() {
        FileAsset a = asset("help", "private", 99L);
        a.setBusinessType("help");
        when(baseMapper.selectOne(any(Wrapper.class), anyBoolean())).thenReturn(a);

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
}
