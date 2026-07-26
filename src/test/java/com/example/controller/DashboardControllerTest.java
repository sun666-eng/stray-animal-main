package com.example.controller;

import com.example.common.Result;
import com.example.dto.HomeStatsDTO;
import com.example.service.AdoptService;
import com.example.service.AnimalService;
import com.example.service.UserService;
import com.example.service.VolunteerService;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class DashboardControllerTest {

    @Mock VolunteerService volunteerService;
    @Mock AnimalService animalService;
    @Mock AdoptService adoptService;
    @Mock UserService userService;
    @InjectMocks DashboardController controller;

    @Test
    void homeStats_usesOnlyFrozenPublicMetrics() {
        when(animalService.count(any())).thenReturn(7L, 13L);
        when(volunteerService.getObj(any(), any())).thenReturn(5L);

        Result<HomeStatsDTO> result = controller.homeStats();

        assertEquals("0", result.getCode());
        assertEquals(7L, result.getData().getAvailableAnimals());
        assertEquals(13L, result.getData().getAdoptedAnimals());
        assertEquals(5L, result.getData().getApprovedVolunteers());
    }
}
