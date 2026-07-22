package com.example.dto;

import java.util.ArrayList;
import java.util.List;

/**
 * 批量上传结构化结果：部分成功不静默丢弃失败项。
 */
public class BatchUploadResult {
    private int total;
    private int successCount;
    private int failCount;
    private List<FileVO> successes = new ArrayList<>();
    private List<ItemFailure> failures = new ArrayList<>();

    public static class ItemFailure {
        private String fileName;
        private String reason;

        public ItemFailure() {
        }

        public ItemFailure(String fileName, String reason) {
            this.fileName = fileName;
            this.reason = reason;
        }

        public String getFileName() {
            return fileName;
        }

        public void setFileName(String fileName) {
            this.fileName = fileName;
        }

        public String getReason() {
            return reason;
        }

        public void setReason(String reason) {
            this.reason = reason;
        }
    }

    public void addSuccess(FileVO vo) {
        if (vo != null) {
            successes.add(vo);
            successCount++;
        }
    }

    public void addFailure(String fileName, String reason) {
        failures.add(new ItemFailure(fileName, reason));
        failCount++;
    }

    public int getTotal() {
        return total;
    }

    public void setTotal(int total) {
        this.total = total;
    }

    public int getSuccessCount() {
        return successCount;
    }

    public void setSuccessCount(int successCount) {
        this.successCount = successCount;
    }

    public int getFailCount() {
        return failCount;
    }

    public void setFailCount(int failCount) {
        this.failCount = failCount;
    }

    public List<FileVO> getSuccesses() {
        return successes;
    }

    public void setSuccesses(List<FileVO> successes) {
        this.successes = successes;
    }

    public List<ItemFailure> getFailures() {
        return failures;
    }

    public void setFailures(List<ItemFailure> failures) {
        this.failures = failures;
    }
}
