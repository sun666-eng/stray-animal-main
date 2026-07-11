package com.example.service;

import com.example.entity.Proof;
import com.example.entity.User;
import com.example.exception.CustomException;
import com.example.mapper.ProofMapper;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
public class ProofServiceTest {

    @Mock
    ProofMapper proofMapper;

    @Mock
    AdoptService adoptService;

    @InjectMocks
    ProofService proofService;

    @Test
    public void userSubmit_forcesPendingEvenIfClientSendsApproved() {
        when(adoptService.count(any())).thenReturn(1L);
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
        assertEquals("hello", proof.getUname());
    }

    @Test
    public void userSubmit_withoutApprovedAdopt_rejected() {
        when(adoptService.count(any())).thenReturn(0L);

        User user = new User();
        user.setId(21L);
        user.setUsername("hello");
        Proof proof = new Proof();
        proof.setPaid(10003L);

        CustomException ex = assertThrows(CustomException.class,
                () -> proofService.submitProof(proof, user, false));
        assertEquals("403", ex.getCode());
    }

    @Test
    public void auditProof_updatesStatus() {
        Proof existing = new Proof();
        existing.setId(1L);
        existing.setPstatus(ProofService.STATUS_PENDING);
        when(proofMapper.selectById(1L)).thenReturn(existing);
        when(proofMapper.updateById(any(Proof.class))).thenReturn(1);

        boolean ok = proofService.auditProof(1L, ProofService.STATUS_APPROVED);

        assertTrue(ok);
        assertEquals(Integer.valueOf(ProofService.STATUS_APPROVED), existing.getPstatus());
    }

    @Test
    public void assertMutableByOwner_blocksApproved() {
        Proof existing = new Proof();
        existing.setPstatus(ProofService.STATUS_APPROVED);
        CustomException ex = assertThrows(CustomException.class,
                () -> proofService.assertMutableByOwner(existing));
        assertEquals("403", ex.getCode());
    }
}
