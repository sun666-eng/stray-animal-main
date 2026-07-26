package com.example.service;

import com.example.entity.Animal;
import com.example.entity.User;
import com.example.exception.CustomException;
import com.example.mapper.AdoptMapper;
import com.example.mapper.AnimalMapper;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.Calendar;
import java.util.Date;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.mockito.Mockito.doAnswer;

@ExtendWith(MockitoExtension.class)
class AnimalServiceHardeningTest {
    @Mock AnimalMapper animalMapper;
    @Mock AdoptMapper adoptMapper;
    @Mock FileAssetService fileAssetService;
    @InjectMocks AnimalService service;

    @Test
    void createIgnoresClientIdAndForcesWorkflowInitialState() {
        Animal animal = validAnimal();
        animal.setId(99L);
        when(animalMapper.insert(any(Animal.class))).thenReturn(1);

        service.saveAnimal(animal, new User());

        assertNull(animal.getId());
        verify(animalMapper).insert(animal);

        Animal adversarial = validAnimal();
        adversarial.setTstate(2);
        when(animalMapper.insert(adversarial)).thenReturn(1);
        service.saveAnimal(adversarial, new User());
        assertEquals(0, adversarial.getTstate());
    }

    @Test
    void deleteRejectsMissingAndAdoptionReferences() {
        when(animalMapper.selectOne(any())).thenReturn(null);
        assertEquals("404", assertThrows(CustomException.class,
                () -> service.deleteAnimal(1L)).getCode());

        Animal existing = validAnimal();
        existing.setId(2L);
        when(animalMapper.selectOne(any())).thenReturn(existing);
        when(adoptMapper.selectCount(any())).thenReturn(1L);
        assertEquals("409", assertThrows(CustomException.class,
                () -> service.deleteAnimal(2L)).getCode());
        verify(fileAssetService, never()).retireAllForBusiness(any(), any());
    }

    @Test
    void generalUpdatePreservesLockedWorkflowState() {
        Animal existing = validAnimal();
        existing.setId(5L);
        existing.setTstate(2);
        Animal patch = validAnimal();
        patch.setId(5L);
        patch.setTname("新名字");
        patch.setTstate(0);
        when(animalMapper.selectOne(any())).thenReturn(existing);
        doAnswer(invocation -> {
            Animal updated = invocation.getArgument(0);
            assertEquals(2, updated.getTstate());
            assertEquals("新名字", updated.getTname());
            return 1;
        }).when(animalMapper).updateById(any(Animal.class));

        service.updateAnimal(patch, new User());

        verify(animalMapper).selectOne(any());
    }

    @Test
    void completeUpdateCanClearUnknownBirthday() {
        Animal existing = validAnimal();
        existing.setId(5L);
        existing.setTbirthday(new Date(0));
        Animal patch = validAnimal();
        patch.setId(5L);
        patch.setTbirthday(null);
        when(animalMapper.selectOne(any())).thenReturn(existing);
        doAnswer(invocation -> {
            Animal updated = invocation.getArgument(0);
            assertNull(updated.getTbirthday());
            return 1;
        }).when(animalMapper).updateById(any(Animal.class));

        service.updateAnimal(patch, new User());
    }

    @Test
    void createRejectsFutureBirthday() {
        Animal animal = validAnimal();
        Calendar future = Calendar.getInstance();
        future.add(Calendar.DAY_OF_MONTH, 1);
        animal.setTbirthday(future.getTime());

        assertEquals("400", assertThrows(CustomException.class,
                () -> service.saveAnimal(animal, new User())).getCode());
        verify(animalMapper, never()).insert(any(Animal.class));
    }

    private Animal validAnimal() {
        Animal animal = new Animal();
        animal.setTname("小白");
        animal.setTtype("狗");
        animal.setTsex("公");
        animal.setTstate(0);
        return animal;
    }
}
