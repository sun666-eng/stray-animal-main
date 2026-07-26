package com.example.service;

import com.example.entity.Proof;
import com.example.entity.Adopt;
import com.example.entity.User;
import com.example.exception.CustomException;
import com.example.mapper.ProofMapper;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;
import static org.mockito.Mockito.verify;

@ExtendWith(MockitoExtension.class)
public class ProofServiceTest {

    @Mock
    ProofMapper proofMapper;

    @Mock
    AdoptService adoptService;

    @Mock
    FileAssetService fileAssetService;

    @Mock
    AnimalService animalService;

    @InjectMocks
    ProofService proofService;

    @BeforeEach
    public void setUpBaseMapper() {
        ReflectionTestUtils.setField(proofService, "baseMapper", proofMapper);
    }

    @Test
    public void userSubmit_forcesPendingEvenIfClientSendsApproved() {
        Adopt approved = new Adopt();
        approved.setAid(10003L);
        approved.setUid(21L);
        approved.setUname("authoritative-user");
        approved.setAname("authoritative-animal");
        when(adoptService.getOne(any(), eq(false))).thenReturn(approved);
        when(animalService.lockState(10003L)).thenReturn(2);
        when(proofMapper.insert(any(Proof.class))).thenReturn(1);

        User user = new User();
        user.setId(21L);
        user.setUsername("hello");

        Proof proof = new Proof();
        proof.setPaid(10003L);
        proof.setPtitle("身份证-人像面");
        proof.setPpic("flag");
        proof.setPstatus(ProofService.STATUS_APPROVED);

        boolean ok = proofService.submitProof(proof, user, false);

        assertTrue(ok);
        assertEquals(Integer.valueOf(ProofService.STATUS_PENDING), proof.getPstatus());
        assertEquals(Long.valueOf(21L), proof.getPuid());
        assertEquals("authoritative-user", proof.getUname());
        assertEquals("authoritative-animal", proof.getAname());
    }

    @Test
    public void userSubmit_withoutApprovedAdopt_rejected() {
        User user = new User();
        user.setId(21L);
        user.setUsername("hello");
        Proof proof = new Proof();
        proof.setPaid(10003L);
        proof.setPtitle("材料");
        proof.setPpic("flag");
        when(animalService.lockState(10003L)).thenReturn(2);

        CustomException ex = assertThrows(CustomException.class,
                () -> proofService.submitProof(proof, user, false));
        assertEquals("403", ex.getCode());
    }

    @Test
    public void auditProof_updatesStatus() {
        Proof existing = new Proof();
        existing.setId(1L);
        existing.setPstatus(ProofService.STATUS_PENDING);
        when(proofMapper.selectOne(any(), eq(true))).thenReturn(existing);
        when(proofMapper.update(any(Proof.class), any())).thenReturn(1);

        boolean ok = proofService.auditProof(1L, ProofService.STATUS_APPROVED);

        assertTrue(ok);
        ArgumentCaptor<Proof> patch = ArgumentCaptor.forClass(Proof.class);
        verify(proofMapper).update(patch.capture(), any());
        assertEquals(Integer.valueOf(ProofService.STATUS_APPROVED), patch.getValue().getPstatus());
    }

    @Test
    public void assertMutableByOwner_blocksApproved() {
        Proof existing = new Proof();
        existing.setPstatus(ProofService.STATUS_APPROVED);
        CustomException ex = assertThrows(CustomException.class,
                () -> proofService.assertMutableByOwner(existing));
        assertEquals("403", ex.getCode());
    }

    @Test
    public void ownerUpdate_cannotMoveProofToAnotherAnimalOrIdentity() {
        User user = new User();
        user.setId(21L);

        Proof existing = new Proof();
        existing.setId(7L);
        existing.setPaid(10003L);
        existing.setPuid(21L);
        existing.setUname("authoritative-user");
        existing.setAname("原动物");
        existing.setPstatus(ProofService.STATUS_REJECTED);
        existing.setPpic("old-flag");
        when(proofMapper.selectOne(any(), eq(true))).thenReturn(existing);
        when(proofMapper.updateById(any(Proof.class))).thenReturn(1);

        Proof forged = new Proof();
        forged.setId(7L);
        forged.setPaid(99999L);
        forged.setPuid(88L);
        forged.setUname("forged-user");
        forged.setAname("伪造动物");
        forged.setPtitle("更新后的材料");
        forged.setPpic("new-flag");

        assertTrue(proofService.updateProof(forged, user, false));
        ArgumentCaptor<Proof> update = ArgumentCaptor.forClass(Proof.class);
        verify(proofMapper).updateById(update.capture());
        assertEquals(Long.valueOf(10003L), update.getValue().getPaid());
        assertEquals(Long.valueOf(21L), update.getValue().getPuid());
        assertEquals("authoritative-user", update.getValue().getUname());
        assertEquals("原动物", update.getValue().getAname());
        assertEquals(Integer.valueOf(ProofService.STATUS_PENDING), update.getValue().getPstatus());
    }

    @Test
    public void managerCanCorrectApprovedProofWithoutChangingRelationshipOrStatus() {
        User manager = new User();
        manager.setId(9L);
        Proof existing = new Proof();
        existing.setId(8L);
        existing.setPaid(10003L);
        existing.setPuid(21L);
        existing.setUname("authoritative-user");
        existing.setAname("原动物");
        existing.setPstatus(ProofService.STATUS_APPROVED);
        existing.setPpic("old-flag");
        when(proofMapper.selectOne(any(), eq(true))).thenReturn(existing);
        when(proofMapper.updateById(any(Proof.class))).thenReturn(1);
        Proof correction = new Proof();
        correction.setId(8L);
        correction.setPtitle("更正材料");
        correction.setPpic("new-flag");

        assertTrue(proofService.updateProof(correction, manager, true));

        ArgumentCaptor<Proof> update = ArgumentCaptor.forClass(Proof.class);
        verify(proofMapper).updateById(update.capture());
        assertEquals(existing.getPaid(), update.getValue().getPaid());
        assertEquals(existing.getPuid(), update.getValue().getPuid());
        assertEquals(Integer.valueOf(ProofService.STATUS_APPROVED), update.getValue().getPstatus());
        verify(fileAssetService).retireIfMatches("old-flag", "proof", 8L);
    }
}
