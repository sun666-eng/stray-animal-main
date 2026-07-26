package com.example.dto;

public class HomeStatsDTO {
    private final long availableAnimals;
    private final long adoptedAnimals;
    private final long approvedVolunteers;

    public HomeStatsDTO(long availableAnimals, long adoptedAnimals, long approvedVolunteers) {
        this.availableAnimals = availableAnimals;
        this.adoptedAnimals = adoptedAnimals;
        this.approvedVolunteers = approvedVolunteers;
    }

    public long getAvailableAnimals() {
        return availableAnimals;
    }

    public long getAdoptedAnimals() {
        return adoptedAnimals;
    }

    public long getApprovedVolunteers() {
        return approvedVolunteers;
    }
}
