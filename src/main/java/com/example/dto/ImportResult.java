package com.example.dto;

import lombok.AllArgsConstructor;
import lombok.Data;

import java.util.ArrayList;
import java.util.List;

@Data
public class ImportResult {

    private int total;
    private int successCount;
    private String workflowNote;
    private List<FailedRow> failed = new ArrayList<>();

    @Data
    @AllArgsConstructor
    public static class FailedRow {
        private int row;
        private String reason;
    }
}
