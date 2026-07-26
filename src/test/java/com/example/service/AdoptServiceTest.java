package com.example.service;

import com.example.entity.Adopt;
import com.example.entity.Animal;
import com.example.entity.User;
import com.example.exception.CustomException;
import com.example.mapper.AdoptMapper;
import com.example.mapper.ProofMapper;
import com.example.mapper.VisitMapper;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.test.util.ReflectionTestUtils;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.mockito.Mockito.never;

@ExtendWith(MockitoExtension.class)
public class AdoptServiceTest {

    @Mock
    AdoptMapper adoptMapper;

    @Mock
    AnimalService animalService;

    @Mock
    ProofMapper proofMapper;

    @Mock
    VisitMapper visitMapper;

    @InjectMocks
    AdoptService adoptService;

    @BeforeEach
    public void setUpBaseMapper() {
        ReflectionTestUtils.setField(adoptService, "baseMapper", adoptMapper);
    }

    @Test
    public void submitAdopt_setsAnimalApplying() {
        Animal animal = new Animal();
        animal.setId(1L);
        animal.setTname("小白");
        animal.setTpic("pic");
        animal.setTstate(0);
        when(animalService.getById(1L)).thenReturn(animal);
        when(animalService.compareAndSetState(1L, 0, 1)).thenReturn(true);
        when(animalService.lockState(1L)).thenReturn(0, 1);
        when(animalService.compareAndSetState(1L, 1, 1)).thenReturn(true);
        when(adoptMapper.insert(any(Adopt.class))).thenReturn(1);
        // approvedCount=0 for submit check; then sync counts
        when(adoptMapper.selectCount(any())).thenReturn(0L, 0L, 0L, 1L);

        Adopt adopt = new Adopt();
        adopt.setAid(1L);
        fillValidApplication(adopt);
        User user = new User();
        user.setId(2L);
        user.setUsername("user");

        boolean saved = adoptService.submitAdopt(adopt, user, false);

        assertTrue(saved);
        assertEquals(Integer.valueOf(0), adopt.getVstate());
        assertEquals(Long.valueOf(2L), adopt.getUid());
        assertEquals(Integer.valueOf(0), animal.getTstate());
        verify(animalService).compareAndSetState(1L, 0, 1);
    }

    @Test
    public void submitAdopt_allowsAnotherPendingApplicationWhileAnimalApplying() {
        Animal animal = new Animal();
        animal.setId(1L);
        animal.setTname("小白");
        animal.setTpic("pic");
        when(animalService.lockState(1L)).thenReturn(1);
        when(animalService.getById(1L)).thenReturn(animal);
        when(animalService.compareAndSetState(1L, 1, 1)).thenReturn(true);
        when(adoptMapper.insert(any(Adopt.class))).thenReturn(1);
        when(adoptMapper.selectCount(any())).thenReturn(0L, 0L, 0L, 2L);
        Adopt adopt = new Adopt();
        adopt.setAid(1L);
        fillValidApplication(adopt);
        User user = new User();
        user.setId(3L);
        user.setUsername("second-user");

        assertTrue(adoptService.submitAdopt(adopt, user, false));

        verify(animalService, org.mockito.Mockito.never()).compareAndSetState(1L, 0, 1);
        assertEquals(Integer.valueOf(0), adopt.getVstate());
    }

    @Test
    public void submitAdopt_rejectsDuplicateBeforeInsert() {
        Animal animal = new Animal();
        animal.setId(1L);
        when(animalService.lockState(1L)).thenReturn(1);
        when(animalService.getById(1L)).thenReturn(animal);
        when(adoptMapper.selectCount(any())).thenReturn(1L);
        Adopt adopt = new Adopt();
        adopt.setAid(1L);
        fillValidApplication(adopt);
        User user = new User();
        user.setId(3L);

        CustomException ex = assertThrows(CustomException.class,
                () -> adoptService.submitAdopt(adopt, user, false));

        assertEquals("409", ex.getCode());
        verify(adoptMapper, org.mockito.Mockito.never()).insert(any(com.example.entity.Adopt.class));
    }

    @Test
    public void auditApproved_setsAnimalAdopted() {
        Animal animal = new Animal();
        animal.setId(1L);
        animal.setTstate(1);

        Adopt existing = new Adopt();
        existing.setAid(1L);
        existing.setUid(2L);
        existing.setVstate(0);
        when(adoptMapper.selectOne(any(), any(boolean.class))).thenReturn(existing);
        when(adoptMapper.selectCount(any())).thenReturn(0L, 1L, 0L);
        when(adoptMapper.update(any(Adopt.class), any())).thenReturn(1);
        when(animalService.lockState(1L)).thenReturn(1);
        when(animalService.compareAndSetState(1L, 1, 2)).thenReturn(true);

        boolean updated = adoptService.auditAdopt(1L, 2L, 1);

        assertTrue(updated);
        assertEquals(Integer.valueOf(1), animal.getTstate());
        verify(animalService).compareAndSetState(1L, 1, 2);
        // CAS 通过 + 驳回竞争 + enforceSingleApproved
        verify(adoptMapper, org.mockito.Mockito.atLeast(2)).update(any(Adopt.class), any());
    }

    @Test
    public void auditRejected_fromPending() {
        Animal animal = new Animal();
        animal.setId(1L);
        animal.setTstate(1);
        Adopt existing = new Adopt();
        existing.setAid(1L);
        existing.setUid(2L);
        existing.setVstate(0);
        when(adoptMapper.selectOne(any(), any(boolean.class))).thenReturn(existing);
        when(adoptMapper.update(any(Adopt.class), any())).thenReturn(1);
        when(adoptMapper.selectCount(any())).thenReturn(0L, 0L);
        when(animalService.lockState(1L)).thenReturn(1);
        when(animalService.compareAndSetState(1L, 1, 0)).thenReturn(true);

        boolean updated = adoptService.auditAdopt(1L, 2L, 2);

        assertTrue(updated);
        verify(adoptMapper, org.mockito.Mockito.times(1)).update(any(Adopt.class), any());
        verify(animalService).compareAndSetState(1L, 1, 0);
    }

    @Test
    public void auditApproved_whenAlreadyTerminal_throws() {
        Adopt existing = new Adopt();
        existing.setAid(1L);
        existing.setUid(2L);
        existing.setVstate(1);
        when(animalService.lockState(1L)).thenReturn(2);
        when(adoptMapper.selectOne(any(), any(boolean.class))).thenReturn(existing);

        assertThrows(CustomException.class, () -> adoptService.auditAdopt(1L, 2L, 2));
    }

    @Test
    public void auditApproved_whenOtherAlreadyApproved_throws() {
        Adopt existing = new Adopt();
        existing.setAid(1L);
        existing.setUid(2L);
        existing.setVstate(0);
        when(animalService.lockState(1L)).thenReturn(1);
        when(adoptMapper.selectOne(any(), any(boolean.class))).thenReturn(existing);
        when(adoptMapper.selectCount(any())).thenReturn(1L);

        CustomException ex = assertThrows(CustomException.class, () -> adoptService.auditAdopt(1L, 2L, 1));
        assertEquals("400", ex.getCode());
    }

    @Test
    public void submitAdopt_invalidApplicationRejectedBeforeAnimalClaim() {
        Adopt adopt = new Adopt();
        adopt.setAid(1L);
        fillValidApplication(adopt);
        adopt.setAge(17);
        User user = new User();
        user.setId(2L);

        CustomException ex = assertThrows(CustomException.class,
                () -> adoptService.submitAdopt(adopt, user, false));
        assertEquals("400", ex.getCode());
        org.mockito.Mockito.verifyNoInteractions(animalService);
    }

    @Test
    public void managerSubmissionCannotForgeIdentityOrAnimalSnapshot() {
        Animal animal = new Animal();
        animal.setId(1L);
        animal.setTname("数据库动物");
        animal.setTpic("db-pic");
        when(animalService.getById(1L)).thenReturn(animal);
        when(animalService.compareAndSetState(1L, 1, 1)).thenReturn(true);
        when(animalService.lockState(1L)).thenReturn(1);
        when(adoptMapper.insert(any(Adopt.class))).thenReturn(1);
        when(adoptMapper.selectCount(any())).thenReturn(0L, 0L, 0L, 1L);
        Adopt submitted = new Adopt();
        submitted.setAid(1L);
        submitted.setUid(999L);
        submitted.setUname("伪造用户");
        submitted.setAname("伪造动物");
        submitted.setApic("forged-pic");
        submitted.setVstate(1);
        fillValidApplication(submitted);
        User actor = new User();
        actor.setId(7L);
        actor.setUsername("真实管理员");

        adoptService.submitAdopt(submitted, actor, true);

        assertEquals(7L, submitted.getUid());
        assertEquals("真实管理员", submitted.getUname());
        assertEquals("数据库动物", submitted.getAname());
        assertEquals("db-pic", submitted.getApic());
        assertEquals(0, submitted.getVstate());
    }

    @Test
    public void ownerUpdatePreservesIdentitySnapshotAndStatus() {
        Adopt existing = new Adopt();
        existing.setAid(1L);
        existing.setUid(2L);
        existing.setVstate(0);
        existing.setUname("数据库用户");
        existing.setAname("数据库动物");
        when(adoptMapper.selectOne(any(), any(boolean.class))).thenReturn(existing);
        when(adoptMapper.update(any(Adopt.class), any())).thenAnswer(invocation -> {
            Adopt patch = invocation.getArgument(0);
            assertEquals(null, patch.getVstate());
            assertEquals(null, patch.getUname());
            assertEquals(null, patch.getAname());
            return 1;
        });
        Adopt submitted = new Adopt();
        fillValidApplication(submitted);
        submitted.setVstate(1);
        submitted.setUname("伪造用户");
        submitted.setAname("伪造动物");
        User owner = new User();
        owner.setId(2L);

        assertTrue(adoptService.updateAdopt(1L, 2L, submitted, owner, false));
    }

    @Test
    public void deleteRejectsDependentProofOrVisit() {
        when(animalService.lockState(1L)).thenReturn(2);
        Adopt existing = new Adopt();
        existing.setAid(1L);
        existing.setUid(2L);
        when(adoptMapper.selectOne(any(), any(boolean.class))).thenReturn(existing);
        when(proofMapper.selectCount(any())).thenReturn(1L);
        when(visitMapper.selectCount(any())).thenReturn(0L);

        CustomException error = assertThrows(CustomException.class,
                () -> adoptService.deleteAdopt(1L, 2L));

        assertEquals("409", error.getCode());
        verify(adoptMapper, never()).delete(any());
    }

    private void fillValidApplication(Adopt adopt) {
        adopt.setGender("女");
        adopt.setAge(25);
        adopt.setMaritalstatus(2);
        adopt.setOccupation("设计师");
        adopt.setTel(13800138000L);
        adopt.setLocation("测试地址");
        adopt.setFixresident(1);
        adopt.setIncome(5000);
        adopt.setExperience(1);
        adopt.setPetnum(0);
        adopt.setFamilyagree(1);
        adopt.setWechat("wechat-test");
    }
}
