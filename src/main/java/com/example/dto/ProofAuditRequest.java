package com.example.dto;

public class ProofAuditRequest {
    private Integer state;
    private String reason;
    public Integer getState() { return state; }
    public void setState(Integer state) { this.state = state; }
    public String getReason() { return reason; }
    public void setReason(String reason) { this.reason = reason; }
}
