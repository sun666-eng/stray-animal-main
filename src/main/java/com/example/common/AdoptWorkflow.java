package com.example.common;

import java.util.Set;

/**
 * 领养闭环的唯一状态契约。旧值 0/1/2 保持兼容；新增状态从 3 开始。
 */
public final class AdoptWorkflow {
    private AdoptWorkflow() {}

    public static final int PENDING_REVIEW = 0;
    public static final int APPROVED_PENDING_HANDOVER = 1;
    public static final int REJECTED = 2;
    public static final int MATERIAL_REQUIRED = 3;
    public static final int COMPLETED = 4;
    public static final int WITHDRAWN = 5;
    public static final int CANCELLED = 6;

    public static final int ANIMAL_AVAILABLE = 0;
    public static final int ANIMAL_RESERVED = 1;
    public static final int ANIMAL_ADOPTED = 2;
    public static final int ANIMAL_HOLD = 3;

    public static final Set<Integer> USER_WITHDRAWABLE = Set.of(
            PENDING_REVIEW, MATERIAL_REQUIRED, APPROVED_PENDING_HANDOVER);
    public static final Set<Integer> EDITABLE = Set.of(PENDING_REVIEW, MATERIAL_REQUIRED);
    public static final Set<Integer> ACTIVE = Set.of(
            PENDING_REVIEW, MATERIAL_REQUIRED, APPROVED_PENDING_HANDOVER);
    public static final Set<Integer> TERMINAL = Set.of(
            REJECTED, COMPLETED, WITHDRAWN, CANCELLED);

    public static String label(Integer state) {
        if (state == null || state == PENDING_REVIEW) return "待审核";
        return switch (state) {
            case APPROVED_PENDING_HANDOVER -> "审核通过·待交接";
            case REJECTED -> "已驳回";
            case MATERIAL_REQUIRED -> "待补充材料";
            case COMPLETED -> "已完成领养";
            case WITHDRAWN -> "已撤回";
            case CANCELLED -> "已取消";
            default -> "未知状态";
        };
    }
}
