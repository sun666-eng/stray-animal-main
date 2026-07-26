package com.example.service;

import com.example.mapper.AnimalMapper;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoMoreInteractions;
import static org.mockito.Mockito.when;

class AnimalServiceStateTest {
    @Test
    void compareAndSetStateUsesNarrowMapperUpdateOnly() {
        AnimalMapper mapper = mock(AnimalMapper.class);
        AnimalService service = new AnimalService();
        ReflectionTestUtils.setField(service, "animalMapper", mapper);
        when(mapper.compareAndSetState(7L, 1, 2)).thenReturn(1);

        assertTrue(service.compareAndSetState(7L, 1, 2));
        verify(mapper).compareAndSetState(7L, 1, 2);
        verifyNoMoreInteractions(mapper);
    }

    @Test
    void compareAndSetStateReportsConcurrentChange() {
        AnimalMapper mapper = mock(AnimalMapper.class);
        AnimalService service = new AnimalService();
        ReflectionTestUtils.setField(service, "animalMapper", mapper);
        when(mapper.compareAndSetState(7L, 0, 1)).thenReturn(0);
        assertFalse(service.compareAndSetState(7L, 0, 1));
    }
}
