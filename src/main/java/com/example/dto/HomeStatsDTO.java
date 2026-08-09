package com.example.dto;

public class HomeStatsDTO {
    private final long availableAnimals;
    private final long adoptedAnimals;
    private final long monthlyRescues;
    private final long approvedVolunteers;

    public HomeStatsDTO(long availableAnimals, long adoptedAnimals, long monthlyRescues, long approvedVolunteers) {
        this.availableAnimals = availableAnimals;
        this.adoptedAnimals = adoptedAnimals;
        this.monthlyRescues = monthlyRescues;
        this.approvedVolunteers = approvedVolunteers;
    }

    public long getAvailableAnimals() {
        return availableAnimals;
    }

    public long getAdoptedAnimals() {
        return adoptedAnimals;
    }

    public long getMonthlyRescues() {
        return monthlyRescues;
    }

    public long getApprovedVolunteers() {
        return approvedVolunteers;
    }
}
