package com.example.service;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.example.entity.WorkflowEvent;
import com.example.exception.CustomException;
import com.example.mapper.WorkflowEventMapper;
import org.springframework.stereotype.Service;

import java.util.Date;
import java.util.List;

@Service
public class WorkflowEventService extends ServiceImpl<WorkflowEventMapper, WorkflowEvent> {
    public WorkflowEvent record(String businessType, String businessId,
                                Integer fromState, Integer toState, String action,
                                Long actorId, String actorType, String reason,
                                String requestId, String metadataJson) {
        WorkflowEvent event = new WorkflowEvent();
        event.setBusinessType(require(businessType, 32, "业务类型"));
        event.setBusinessId(require(businessId, 96, "业务编号"));
        event.setFromState(fromState);
        event.setToState(toState);
        event.setAction(require(action, 32, "业务动作"));
        event.setActorId(actorId);
        event.setActorType(normalize(actorType, 16));
        event.setReason(normalize(reason, 1000));
        event.setRequestId(normalize(requestId, 64));
        event.setMetadataJson(normalize(metadataJson, 4000));
        event.setCreatedAt(new Date());
        if (!save(event)) throw new CustomException("500", "业务状态历史保存失败");
        return event;
    }

    public List<WorkflowEvent> timeline(String businessType, String businessId) {
        return list(Wrappers.<WorkflowEvent>lambdaQuery()
                .eq(WorkflowEvent::getBusinessType, businessType)
                .eq(WorkflowEvent::getBusinessId, businessId)
                .orderByAsc(WorkflowEvent::getCreatedAt).orderByAsc(WorkflowEvent::getId)
                .last("LIMIT 200"));
    }

    private String require(String value, int max, String field) {
        String clean = normalize(value, max);
        if (clean == null) throw new CustomException("400", field + "不能为空");
        return clean;
    }

    private String normalize(String value, int max) {
        if (value == null || value.trim().isEmpty()) return null;
        String clean = value.trim();
        if (clean.length() > max) throw new CustomException("400", "字段内容过长");
        return clean;
    }
}
