package com.example.dto;

/** 领养状态转换请求；不允许客户端直接写数字状态。 */
public class AdoptTransitionRequest {
    private String action;
    private String reason;
    private String note;
    private Integer expectedVersion;

    public String getAction() { return action; }
    public void setAction(String action) { this.action = action; }
    public String getReason() { return reason; }
    public void setReason(String reason) { this.reason = reason; }
    public String getNote() { return note; }
    public void setNote(String note) { this.note = note; }
    public Integer getExpectedVersion() { return expectedVersion; }
    public void setExpectedVersion(Integer expectedVersion) { this.expectedVersion = expectedVersion; }
}
