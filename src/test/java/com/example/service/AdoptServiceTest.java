package com.example.service;

import com.example.entity.Adopt;
import com.example.entity.Animal;
import com.example.entity.User;
import com.example.exception.CustomException;
import com.example.mapper.AdoptMapper;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
public class AdoptServiceTest {

    @Mock
    AdoptMapper adoptMapper;

    @Mock
    AnimalService animalService;

    @InjectMocks
    AdoptService adoptService;

    @Test
    public void submitAdopt_setsAnimalApplying() {
        Animal animal = new Animal();
        animal.setId(1L);
        animal.setTname("小白");
        animal.setTpic("pic");
        animal.setTstate(0);
        when(animalService.getById(1L)).thenReturn(animal);
        when(animalService.update(any())).thenReturn(true);
        when(adoptMapper.insert(any(Adopt.class))).thenReturn(1);
        // approvedCount=0 for submit check; then sync counts
        when(adoptMapper.selectCount(any())).thenReturn(0L, 0L, 1L);

        Adopt adopt = new Adopt();
        adopt.setAid(1L);
        User user = new User();
        user.setId(2L);
        user.setUsername("user");

        boolean saved = adoptService.submitAdopt(adopt, user, false);

        assertTrue(saved);
        assertEquals(Integer.valueOf(0), adopt.getVstate());
        assertEquals(Long.valueOf(2L), adopt.getUid());
        assertEquals(Integer.valueOf(1), animal.getTstate());
        verify(animalService).updateById(animal);
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
        when(animalService.getById(1L)).thenReturn(animal);

        boolean updated = adoptService.auditAdopt(1L, 2L, 1);

        assertTrue(updated);
        assertEquals(Integer.valueOf(2), animal.getTstate());
        verify(animalService).updateById(animal);
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
        when(animalService.getById(1L)).thenReturn(animal);

        boolean updated = adoptService.auditAdopt(1L, 2L, 2);

        assertTrue(updated);
        verify(adoptMapper, org.mockito.Mockito.times(1)).update(any(Adopt.class), any());
    }

    @Test
    public void auditApproved_whenAlreadyTerminal_throws() {
        Adopt existing = new Adopt();
        existing.setAid(1L);
        existing.setUid(2L);
        existing.setVstate(1);
        when(adoptMapper.selectOne(any(), any(boolean.class))).thenReturn(existing);

        assertThrows(CustomException.class, () -> adoptService.auditAdopt(1L, 2L, 2));
    }

    @Test
    public void auditApproved_whenOtherAlreadyApproved_throws() {
        Adopt existing = new Adopt();
        existing.setAid(1L);
        existing.setUid(2L);
        existing.setVstate(0);
        when(adoptMapper.selectOne(any(), any(boolean.class))).thenReturn(existing);
        when(adoptMapper.selectCount(any())).thenReturn(1L);

        CustomException ex = assertThrows(CustomException.class, () -> adoptService.auditAdopt(1L, 2L, 1));
        assertEquals("400", ex.getCode());
    }
}
