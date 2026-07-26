package com.example.service;

import com.baomidou.mybatisplus.core.conditions.Wrapper;
import com.example.entity.Animal;
import com.example.entity.Adopt;
import com.example.entity.User;
import com.example.entity.Visit;
import com.example.exception.CustomException;
import com.example.mapper.VisitMapper;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.Date;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
public class VisitServiceTest {

    @Mock
    VisitMapper visitMapper;

    @Mock
    AdoptService adoptService;

    @Mock
    AnimalService animalService;

    @Mock
    FileAssetService fileAssetService;

    @InjectMocks
    VisitService visitService;

    /** Mockito 5 不注入继承的泛型字段 M baseMapper（MP 3.5.7 起访问会断言非空），须显式注入。 */
    @org.junit.jupiter.api.BeforeEach
    void injectInheritedBaseMapper() {
        org.springframework.test.util.ReflectionTestUtils.setField(visitService, "baseMapper", visitMapper);
    }

    private User actor() {
        User u = new User();
        u.setId(1L);
        return u;
    }

    private Visit validDraft() {
        Visit v = new Visit();
        v.setPetId(10003L);
        v.setUid(21L);
        v.setVtime(new Date());
        v.setState(4);
        v.setVname("义工甲");
        v.setRemark("状况良好");
        v.setAname("客户端脏名");
        return v;
    }

    @Test
    public void create_whenAdoptApproved_succeedsAndUsesAnimalName() {
        when(animalService.lockState(10003L)).thenReturn(2);
        when(adoptService.getOne(any(), anyBoolean())).thenReturn(new Adopt());
        Animal animal = new Animal();
        animal.setId(10003L);
        animal.setTname("默默");
        when(animalService.getById(10003L)).thenReturn(animal);
        when(visitMapper.insert(any(Visit.class))).thenReturn(1);

        Visit v = validDraft();
        assertTrue(visitService.createVisit(v, actor(), true));
        assertEquals("默默", v.getAname());
        verify(visitMapper).insert(any(Visit.class));
    }

    @Test
    public void create_whenAdoptNotApproved_rejected() {
        when(animalService.lockState(10003L)).thenReturn(2);

        CustomException ex = assertThrows(CustomException.class,
                () -> visitService.createVisit(validDraft(), actor(), true));
        assertEquals("400", ex.getCode());
        assertTrue(ex.getMsg().contains("已审核通过"));
        verify(visitMapper, never()).insert(any(com.example.entity.Visit.class));
    }

    @Test
    public void create_missingRequiredFields_rejected() {
        Visit v = new Visit();
        v.setPetId(1L);
        CustomException ex = assertThrows(CustomException.class,
                () -> visitService.createVisit(v, actor(), true));
        assertEquals("400", ex.getCode());
    }

    @Test
    public void create_invalidHealthScore_rejected() {
        Visit v = validDraft();
        v.setState(0);
        CustomException ex = assertThrows(CustomException.class,
                () -> visitService.createVisit(v, actor(), true));
        assertEquals("400", ex.getCode());
        assertTrue(ex.getMsg().contains("健康评分"));
        verify(visitMapper, never()).insert(any(com.example.entity.Visit.class));
    }

    @Test
    public void update_whenRecordMissing_404() {
        when(visitMapper.selectById(9L)).thenReturn(null);
        Visit v = validDraft();
        v.setId(9L);
        CustomException ex = assertThrows(CustomException.class,
                () -> visitService.updateVisit(v, actor(), true));
        assertEquals("404", ex.getCode());
    }

    @Test
    public void update_revalidatesApprovedAdopt() {
        Visit existing = validDraft();
        existing.setId(6L);
        when(visitMapper.selectById(6L)).thenReturn(existing);
        when(animalService.lockState(existing.getPetId())).thenReturn(2);

        Visit patch = new Visit();
        patch.setId(6L);
        patch.setState(5);
        patch.setVname("乙");
        patch.setVtime(new Date());

        CustomException ex = assertThrows(CustomException.class,
                () -> visitService.updateVisit(patch, actor(), true));
        assertEquals("409", ex.getCode());
    }

    @Test
    public void create_requiresVisitManagerPermission() {
        CustomException ex = assertThrows(CustomException.class,
                () -> visitService.createVisit(validDraft(), actor(), false));
        assertEquals("403", ex.getCode());
        verify(visitMapper, never()).insert(any(com.example.entity.Visit.class));
    }

    @Test
    public void updateCannotTransferAdoptionRelationship() {
        Visit existing = validDraft();
        existing.setId(6L);
        when(visitMapper.selectById(6L)).thenReturn(existing);
        when(visitMapper.selectOne(any(Wrapper.class), anyBoolean())).thenReturn(existing);
        when(animalService.lockState(existing.getPetId())).thenReturn(2);
        when(adoptService.getOne(any(), anyBoolean())).thenReturn(new Adopt());
        Animal animal = new Animal();
        animal.setId(existing.getPetId());
        animal.setTname("数据库动物");
        when(animalService.getById(existing.getPetId())).thenReturn(animal);
        when(visitMapper.updateById(any(Visit.class))).thenReturn(1);
        Visit forged = validDraft();
        forged.setId(6L);
        forged.setPetId(999L);
        forged.setUid(888L);

        assertTrue(visitService.updateVisit(forged, actor(), true));

        ArgumentCaptor<Visit> update = ArgumentCaptor.forClass(Visit.class);
        verify(visitMapper).updateById(update.capture());
        assertEquals(existing.getPetId(), update.getValue().getPetId());
        assertEquals(existing.getUid(), update.getValue().getUid());
        assertEquals("数据库动物", update.getValue().getAname());
    }
}
