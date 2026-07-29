package com.example.service;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.example.entity.VisitPlan;
import com.example.mapper.VisitPlanMapper;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.Date;
import java.util.List;

@Service
public class VisitPlanService extends ServiceImpl<VisitPlanMapper, VisitPlan> {
    private static final ZoneId ZONE = ZoneId.of("Asia/Shanghai");

    @Transactional
    public void createDefaultPlans(Long aid, Long uid, Date handoverAt) {
        if (aid == null || uid == null) return;
        LocalDate base = (handoverAt == null ? new Date() : handoverAt).toInstant().atZone(ZONE).toLocalDate();
        createOnce(aid, uid, "7_day", base.plusDays(7));
        createOnce(aid, uid, "30_day", base.plusDays(30));
        createOnce(aid, uid, "90_day", base.plusDays(90));
    }

    private void createOnce(Long aid, Long uid, String type, LocalDate due) {
        long exists = count(Wrappers.<VisitPlan>lambdaQuery().eq(VisitPlan::getAid, aid)
                .eq(VisitPlan::getUid, uid).eq(VisitPlan::getPlanType, type));
        if (exists > 0) return;
        VisitPlan plan = new VisitPlan();
        plan.setAid(aid); plan.setUid(uid); plan.setPlanType(type);
        plan.setDueAt(Date.from(due.atStartOfDay(ZONE).toInstant())); plan.setStatus(0);
        plan.setCreatedAt(new Date()); plan.setUpdatedAt(new Date()); save(plan);
    }

    public List<VisitPlan> mine(Long uid, Long aid) {
        return list(Wrappers.<VisitPlan>lambdaQuery().eq(VisitPlan::getUid, uid)
                .eq(aid != null, VisitPlan::getAid, aid).orderByAsc(VisitPlan::getDueAt));
    }

    @Transactional
    public void completeNearest(Long aid, Long uid, Long visitId, Integer healthScore) {
        VisitPlan plan = getOne(Wrappers.<VisitPlan>lambdaQuery().eq(VisitPlan::getAid, aid)
                .eq(VisitPlan::getUid, uid).in(VisitPlan::getStatus, 0, 2)
                .orderByAsc(VisitPlan::getDueAt).last("LIMIT 1 FOR UPDATE"), false);
        if (plan == null) return;
        plan.setStatus(healthScore != null && healthScore <= 2 ? 4 : 1);
        plan.setCompletedVisitId(visitId); plan.setUpdatedAt(new Date()); updateById(plan);
    }

    @Scheduled(cron="${app.visit.overdue-cron:0 15 2 * * *}", zone="Asia/Shanghai")
    public void markOverdue() {
        VisitPlan patch = new VisitPlan(); patch.setStatus(2); patch.setUpdatedAt(new Date());
        update(patch, Wrappers.<VisitPlan>lambdaUpdate().eq(VisitPlan::getStatus, 0).lt(VisitPlan::getDueAt, new Date()));
    }
}
