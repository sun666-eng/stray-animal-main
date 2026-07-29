package com.example.service;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.example.entity.Adopt;
import com.example.entity.Animal;
import com.example.entity.User;
import com.example.entity.WorkflowEvent;
import com.example.common.AdoptWorkflow;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.baomidou.mybatisplus.core.conditions.update.UpdateWrapper;
import com.example.exception.CustomException;
import com.example.mapper.AdoptMapper;
import com.example.mapper.ProofMapper;
import com.example.mapper.VisitMapper;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.stereotype.Service;

import jakarta.annotation.Resource;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.Set;

@Service
public class AdoptService extends ServiceImpl<AdoptMapper, Adopt> {

    private static final int ANIMAL_AVAILABLE = AdoptWorkflow.ANIMAL_AVAILABLE;
    private static final int ANIMAL_APPLYING = AdoptWorkflow.ANIMAL_RESERVED;
    private static final int ANIMAL_ADOPTED = AdoptWorkflow.ANIMAL_ADOPTED;

    private static final int ADOPT_PENDING = AdoptWorkflow.PENDING_REVIEW;
    private static final int ADOPT_APPROVED = AdoptWorkflow.APPROVED_PENDING_HANDOVER;
    private static final int ADOPT_REJECTED = AdoptWorkflow.REJECTED;
    private static final int ADOPT_MATERIAL_REQUIRED = AdoptWorkflow.MATERIAL_REQUIRED;
    private static final int ADOPT_COMPLETED = AdoptWorkflow.COMPLETED;
    private static final int ADOPT_WITHDRAWN = AdoptWorkflow.WITHDRAWN;
    private static final int ADOPT_CANCELLED = AdoptWorkflow.CANCELLED;

    @Resource
    private AdoptMapper adoptMapper;

    @Resource
    private AnimalService animalService;

    @Resource
    private ProofMapper proofMapper;

    @Resource
    private VisitMapper visitMapper;

    @Resource
    private WorkflowEventService workflowEventService;

    @Resource
    private NotificationService notificationService;

    @Resource
    private VisitPlanService visitPlanService;

    @Transactional
    public boolean submitAdopt(Adopt adopt, User user, boolean canManageAdopt) {
        if (user == null || user.getId() == null) {
            throw new CustomException("401", "未登录或登录已过期");
        }
        if (adopt == null || adopt.getAid() == null) {
            throw new CustomException("400", "动物信息不能为空");
        }
        validateApplication(adopt);

        Integer animalState = animalService.lockState(adopt.getAid());
        if (animalState == null) {
            throw new CustomException("404", "动物信息不存在");
        }
        Animal animal = animalService.getById(adopt.getAid());
        if (animal == null) {
            throw new CustomException("404", "动物信息不存在");
        }
        // 审计修复 M1：重复校验只拦「活跃」申请（待审/已通过）。
        // 驳回/其他状态的旧行不再永久 409——动物重新上架后允许原申请人再次申请（复活旧行）。
        Adopt previous = getOne(new QueryWrapper<Adopt>()
                .eq("aid", adopt.getAid()).eq("uid", user.getId()).last("FOR UPDATE"), false);
        if (previous != null
                && AdoptWorkflow.ACTIVE.contains(previous.getVstate())) {
            throw new CustomException("409", "你已提交过该动物的领养申请");
        }

        // Every submission belongs to the authenticated actor. Management permission never
        // authorizes forging another user's identity or server-derived animal snapshots.
        long reservedOrCompleted = count(new QueryWrapper<Adopt>().eq("aid", adopt.getAid())
                .in("vstate", ADOPT_APPROVED, ADOPT_COMPLETED));
        if (reservedOrCompleted > 0) {
            throw new CustomException("409", "该动物已被预留或完成领养");
        }
        if (animalState != ANIMAL_AVAILABLE && animalState != ANIMAL_APPLYING) {
            throw new CustomException("400", "该动物当前不可领养");
        }
        if (animalState == ANIMAL_AVAILABLE && !animalService.compareAndSetState(
                adopt.getAid(), ANIMAL_AVAILABLE, ANIMAL_APPLYING)) {
            throw new CustomException("409", "动物状态已变化，请刷新后重试");
        }
        adopt.setUid(user.getId());
        adopt.setUname(user.getUsername());
        adopt.setAname(animal.getTname());
        adopt.setApic(animal.getTpic());
        adopt.setVstate(ADOPT_PENDING);
        Date now = new Date();
        adopt.setCreatedAt(now);
        adopt.setUpdatedAt(now);
        adopt.setVersion(0);

        boolean saved;
        if (previous == null) {
            saved = save(adopt);
        } else {
            // 复合主键 (aid,uid) 不允许第二行：把驳回/其他状态的旧行按新表单「复活」为待审申请。
            // CAS 旧 vstate 防并发复活。
            Adopt revived = mutableApplication(adopt.getAid(), user.getId(), adopt);
            revived.setUname(user.getUsername());
            revived.setAname(animal.getTname());
            revived.setApic(animal.getTpic());
            revived.setVstate(ADOPT_PENDING);
            revived.setReviewerId(null);
            revived.setReviewReason(null);
            revived.setReviewedAt(null);
            revived.setHandoverAt(null);
            revived.setHandoverNote(null);
            revived.setCreatedAt(previous.getCreatedAt() == null ? now : previous.getCreatedAt());
            revived.setUpdatedAt(now);
            revived.setVersion(nextVersion(previous));
            UpdateWrapper<Adopt> revive = new UpdateWrapper<>();
            revive.eq("aid", adopt.getAid()).eq("uid", user.getId())
                    .eq("vstate", previous.getVstate())
                    .set("reviewer_id", null).set("review_reason", null)
                    .set("reviewed_at", null).set("handover_at", null).set("handover_note", null);
            saved = update(revived, revive);
        }
        if (!saved) {
            throw new CustomException("500", "领养申请保存失败");
        }
        syncAnimalState(adopt.getAid());
        recordEvent(adopt.getAid(), user.getId(), previous == null ? null : previous.getVstate(), ADOPT_PENDING,
                "SUBMIT", user, "提交领养申请", null);
        return saved;
    }

    @Transactional
    public boolean updateAdopt(Long aid, Long uid, Adopt submitted, User actor, boolean canManageAdopt) {
        if (aid == null || uid == null || submitted == null) {
            throw new CustomException("400", "领养申请参数无效");
        }
        if (!canManageAdopt && (actor == null || actor.getId() == null || !actor.getId().equals(uid))) {
            throw new CustomException("403", "只能修改自己的领养申请");
        }
        QueryWrapper<Adopt> query = new QueryWrapper<Adopt>()
                .eq("aid", aid).eq("uid", uid).last("FOR UPDATE");
        Adopt existing = getOne(query, false);
        if (existing == null) {
            throw new CustomException("404", "领养申请不存在");
        }
        if (!AdoptWorkflow.EDITABLE.contains(existing.getVstate())) {
            throw new CustomException("409", "仅待审核或待补充材料的申请可以修改");
        }

        Adopt mutable = mutableApplication(aid, uid, submitted);
        validateApplication(mutable);
        UpdateWrapper<Adopt> update = new UpdateWrapper<>();
        update.eq("aid", aid).eq("uid", uid).eq("vstate", existing.getVstate());
        mutable.setUpdatedAt(new Date());
        mutable.setVersion(nextVersion(existing));
        if (!update(mutable, update)) {
            throw new CustomException("409", "申请已变化，请刷新后重试");
        }
        return true;
    }

    private Adopt mutableApplication(Long aid, Long uid, Adopt source) {
        Adopt mutable = new Adopt();
        mutable.setAid(aid);
        mutable.setUid(uid);
        mutable.setGender(source.getGender());
        mutable.setAge(source.getAge());
        mutable.setMaritalstatus(source.getMaritalstatus());
        mutable.setOccupation(source.getOccupation());
        mutable.setTel(source.getTel());
        mutable.setLocation(source.getLocation());
        mutable.setFixresident(source.getFixresident());
        mutable.setIncome(source.getIncome());
        mutable.setExperience(source.getExperience());
        mutable.setPetnum(source.getPetnum());
        mutable.setFamilyagree(source.getFamilyagree());
        mutable.setWechat(source.getWechat());
        return mutable;
    }

    private void validateApplication(Adopt adopt) {
        if (adopt.getAge() == null || adopt.getAge() < 18 || adopt.getAge() > 100) {
            throw new CustomException("400", "申请人年龄需在18至100岁之间");
        }
        if (isBlank(adopt.getGender()) || adopt.getGender().trim().length() > 2) {
            throw new CustomException("400", "性别信息无效");
        }
        if (adopt.getMaritalstatus() == null
                || (adopt.getMaritalstatus() != 1 && adopt.getMaritalstatus() != 2)) {
            throw new CustomException("400", "婚姻状态无效");
        }
        if (isBlank(adopt.getOccupation()) || adopt.getOccupation().trim().length() > 12) {
            throw new CustomException("400", "职业信息不能为空且不能超过12个字符");
        }
        if (adopt.getTel() == null || adopt.getTel() < 10000000000L || adopt.getTel() > 19999999999L) {
            throw new CustomException("400", "联系电话格式无效");
        }
        if (isBlank(adopt.getLocation()) || adopt.getLocation().trim().length() > 255) {
            throw new CustomException("400", "家庭住址不能为空且不能超过255个字符");
        }
        validateBinary(adopt.getFixresident(), "固定住所");
        if (adopt.getIncome() == null || adopt.getIncome() < 0) {
            throw new CustomException("400", "收入信息无效");
        }
        validateBinary(adopt.getExperience(), "养宠经验");
        if (adopt.getPetnum() == null || adopt.getPetnum() < 0 || adopt.getPetnum() > 30) {
            throw new CustomException("400", "现有宠物数量无效");
        }
        validateBinary(adopt.getFamilyagree(), "家人意见");
        if (isBlank(adopt.getWechat()) || adopt.getWechat().trim().length() > 20) {
            throw new CustomException("400", "微信号不能为空且不能超过20个字符");
        }
    }

    private void validateBinary(Integer value, String field) {
        if (value == null || (value != 0 && value != 1)) {
            throw new CustomException("400", field + "信息无效");
        }
    }

    private boolean isBlank(String value) {
        return value == null || value.trim().isEmpty();
    }

    /** 兼容旧管理接口：通过现在仅表示“审核通过、待交接”，不再直接完成领养。 */
    @Transactional
    public boolean auditAdopt(Long aid, Long uid, Integer state) {
        validateAdoptState(state);
        String action = Integer.valueOf(ADOPT_APPROVED).equals(state) ? "APPROVE" : "REJECT";
        String reason = Integer.valueOf(ADOPT_APPROVED).equals(state) ? "管理员审核通过" : "管理员审核驳回";
        return transition(aid, uid, action, reason, null, null, null, true, "ADMIN");
    }

    /**
     * P0 统一状态机。所有转换在动物行和申请行加锁后执行，expectedVersion 防止陈旧页面覆盖新决定。
     */
    @Transactional
    public boolean transition(Long aid, Long uid, String rawAction, String reason, String note,
                              Integer expectedVersion, User actor, boolean manager, String actorType) {
        if (aid == null || uid == null) throw new CustomException("400", "参数无效");
        String action = normalizeAction(rawAction);
        if (animalService.lockState(aid) == null) throw new CustomException("404", "动物信息不存在");
        Adopt existing = getOne(new QueryWrapper<Adopt>()
                .eq("aid", aid).eq("uid", uid).last("FOR UPDATE"), false);
        if (existing == null) throw new CustomException("404", "领养申请不存在");
        int current = existing.getVstate() == null ? ADOPT_PENDING : existing.getVstate();
        int version = existing.getVersion() == null ? 0 : existing.getVersion();
        if (expectedVersion != null && expectedVersion != version) {
            throw new CustomException("409", "申请已在其他页面更新，请刷新后重试");
        }

        boolean owner = actor != null && actor.getId() != null && actor.getId().equals(uid);
        if ("WITHDRAW".equals(action)) {
            if (!owner) throw new CustomException("403", "只能撤回自己的领养申请");
        } else {
            requireManager(manager);
        }
        int desired = desiredTarget(action);
        if (current == desired) {
            syncAnimalState(aid);
            return true;
        }
        int target;
        switch (action) {
            case "REQUEST_MATERIAL" -> {
                requireManager(manager);
                requireState(current, Set.of(ADOPT_PENDING), "仅待审核申请可以要求补充材料");
                target = ADOPT_MATERIAL_REQUIRED;
            }
            case "APPROVE" -> {
                requireManager(manager);
                requireState(current, Set.of(ADOPT_PENDING, ADOPT_MATERIAL_REQUIRED), "当前状态不能审核通过");
                if (current == ADOPT_MATERIAL_REQUIRED) assertMaterialsReady(aid, uid, false);
                long otherReserved = count(new QueryWrapper<Adopt>().eq("aid", aid)
                        .in("vstate", ADOPT_APPROVED, ADOPT_COMPLETED).ne("uid", uid));
                if (otherReserved > 0) throw new CustomException("409", "该动物已有其他有效预留或已完成领养");
                target = ADOPT_APPROVED;
            }
            case "REJECT" -> {
                requireManager(manager);
                requireState(current, Set.of(ADOPT_PENDING, ADOPT_MATERIAL_REQUIRED), "当前状态不能驳回");
                target = ADOPT_REJECTED;
            }
            case "COMPLETE_HANDOVER" -> {
                requireManager(manager);
                requireState(current, Set.of(ADOPT_APPROVED), "仅待交接申请可以完成领养");
                assertMaterialsReady(aid, uid, true);
                target = ADOPT_COMPLETED;
            }
            case "WITHDRAW" -> {
                if (!owner) throw new CustomException("403", "只能撤回自己的领养申请");
                requireState(current, AdoptWorkflow.USER_WITHDRAWABLE, "当前状态不能撤回");
                target = ADOPT_WITHDRAWN;
            }
            case "CANCEL" -> {
                requireManager(manager);
                requireState(current, AdoptWorkflow.ACTIVE, "当前状态不能取消");
                target = ADOPT_CANCELLED;
            }
            case "REOPEN" -> {
                requireManager(manager);
                requireState(current, Set.of(ADOPT_REJECTED, ADOPT_WITHDRAWN, ADOPT_CANCELLED), "当前状态不能重新打开");
                long blocking = count(new QueryWrapper<Adopt>().eq("aid", aid)
                        .in("vstate", ADOPT_APPROVED, ADOPT_COMPLETED).ne("uid", uid));
                if (blocking > 0) throw new CustomException("409", "动物已有有效预留或已完成领养，不能重新打开");
                target = ADOPT_PENDING;
            }
            default -> throw new CustomException("400", "不支持的状态操作");
        }

        String cleanReason = requireReason(action, reason);
        if (current == target) return true;
        Date now = new Date();
        UpdateWrapper<Adopt> cas = new UpdateWrapper<>();
        cas.eq("aid", aid).eq("uid", uid).eq("vstate", current)
                .eq(existing.getVersion() != null, "version", version)
                .set("vstate", target).set("updated_at", now).set("version", version + 1);
        if (manager && Set.of("REQUEST_MATERIAL", "APPROVE", "REJECT", "CANCEL", "REOPEN").contains(action)) {
            cas.set("reviewer_id", actor == null ? null : actor.getId())
                    .set("review_reason", cleanReason).set("reviewed_at", now);
        }
        if (target == ADOPT_COMPLETED) {
            cas.set("handover_at", now).set("handover_note", normalizeText(note, 1000, "交接备注"));
        }
        if (target == ADOPT_PENDING) {
            cas.set("reviewer_id", null).set("review_reason", null).set("reviewed_at", null)
                    .set("handover_at", null).set("handover_note", null);
        }
        if (!update(new Adopt(), cas)) throw new CustomException("409", "状态已变化，请刷新后重试");

        if (target == ADOPT_COMPLETED) closeCompetingApplications(aid, uid, actor, now);
        if (target == ADOPT_COMPLETED && visitPlanService != null) visitPlanService.createDefaultPlans(aid, uid, now);
        syncAnimalState(aid);
        recordEvent(aid, uid, current, target, action, actor, cleanReason, null, actorType);
        notifyApplicant(aid, uid, target, cleanReason, version + 1);
        return true;
    }

    /**
     * 3C 专用窄入口：锁住动物后确认只有一份待审申请，避免“通过一人”间接自动驳回其他竞争者。
     * 普通人工审核仍使用 auditAdopt，可由管理员比较多份申请后作出决定。
     */
    @Transactional
    public boolean auditSolePendingAdopt(Long aid, Long uid) {
        return auditSolePendingAdopt(aid, uid, null);
    }

    @Transactional
    public boolean auditSolePendingAdopt(Long aid, Long uid, User actor) {
        if (aid == null || uid == null) throw new CustomException("400", "参数无效");
        if (animalService.lockState(aid) == null) throw new CustomException("404", "动物信息不存在");
        long pending = count(new QueryWrapper<Adopt>().eq("aid", aid).eq("vstate", ADOPT_PENDING));
        if (pending != 1L) {
            throw new CustomException("409", "该动物存在多份竞争申请，受控自动审核已转人工复核");
        }
        return transition(aid, uid, "APPROVE", "受控 AI 自动审核通过，等待线下交接",
                null, null, actor, true, "AI");
    }

    public List<WorkflowEvent> timeline(Long aid, Long uid, User actor, boolean manager) {
        if (!manager && (actor == null || actor.getId() == null || !actor.getId().equals(uid))) {
            throw new CustomException("403", "只能查看自己的申请进度");
        }
        Adopt existing = getOne(new QueryWrapper<Adopt>().eq("aid", aid).eq("uid", uid), false);
        if (existing == null) throw new CustomException("404", "领养申请不存在");
        if (workflowEventService == null) return List.of();
        return workflowEventService.timeline("adopt", businessId(aid, uid));
    }

    /**
     * 将同一动物上除指定通过用户外的待审申请全部驳回。
     */
    private void rejectCompetingPending(Long aid, Long approvedUid) {
        if (aid == null || approvedUid == null) {
            return;
        }
        UpdateWrapper<Adopt> reject = new UpdateWrapper<>();
        reject.eq("aid", aid)
                .eq("vstate", ADOPT_PENDING)
                .ne("uid", approvedUid);
        Adopt patch = new Adopt();
        patch.setVstate(ADOPT_REJECTED);
        update(patch, reject);
    }

    /**
     * 保证一动物至多一条 APPROVED：保留 approvedUid，其余通过改为驳回。
     */
    private void enforceSingleApproved(Long aid, Long approvedUid) {
        UpdateWrapper<Adopt> reject = new UpdateWrapper<>();
        reject.eq("aid", aid)
                .eq("vstate", ADOPT_APPROVED)
                .ne("uid", approvedUid);
        Adopt patch = new Adopt();
        patch.setVstate(ADOPT_REJECTED);
        update(patch, reject);
    }

    @Transactional
    public boolean deleteAdopt(Long aid, Long uid) {
        if (aid == null || uid == null) {
            throw new CustomException("400", "领养申请参数无效");
        }
        Integer lockedAnimalState = animalService.lockState(aid);
        if (lockedAnimalState == null) {
            throw new CustomException("404", "动物信息不存在");
        }
        QueryWrapper<Adopt> locked = new QueryWrapper<Adopt>()
                .eq("aid", aid).eq("uid", uid).last("FOR UPDATE");
        if (getOne(locked, false) == null) {
            throw new CustomException("404", "领养申请不存在");
        }
        Long proofCount = proofMapper.selectCount(new QueryWrapper<com.example.entity.Proof>()
                .eq("paid", aid).eq("puid", uid));
        Long visitCount = visitMapper.selectCount(new QueryWrapper<com.example.entity.Visit>()
                .eq("pet_id", aid).eq("uid", uid));
        if ((proofCount != null && proofCount > 0) || (visitCount != null && visitCount > 0)) {
            throw new CustomException("409", "该领养申请已有凭证或回访记录，不能删除");
        }
        QueryWrapper<Adopt> queryWrapper = new QueryWrapper<>();
        queryWrapper.eq("aid", aid).eq("uid", uid);
        boolean removed = remove(queryWrapper);
        if (!removed) {
            throw new CustomException("409", "删除冲突，请刷新后重试");
        }
        syncAnimalStateAfterDelete(aid);
        return true;
    }

    private void validateAdoptState(Integer state) {
        // 审计建议：封死 vstate=3(其他状态) 的写入口——前端只发 1/2，状态3仅裸 API 可达，
        // 进入后不可再审、动物却回到可申请，属休眠陷阱态。存量 3 的行仍可展示与删除。
        if (state == null || (state != ADOPT_APPROVED && state != ADOPT_REJECTED)) {
            throw new CustomException("400", "审核结果仅允许通过或驳回");
        }
    }

    private void assertMaterialsReady(Long aid, Long uid, boolean handover) {
        long approved = proofMapper.selectCount(new QueryWrapper<com.example.entity.Proof>()
                .eq("paid", aid).eq("puid", uid).eq("pstatus", ProofService.STATUS_APPROVED));
        long unresolved = proofMapper.selectCount(new QueryWrapper<com.example.entity.Proof>()
                .eq("paid", aid).eq("puid", uid)
                .in("pstatus", ProofService.STATUS_PENDING, ProofService.STATUS_REJECTED));
        if (approved < 1 || unresolved > 0) {
            throw new CustomException("409", handover
                    ? "至少需要一份已通过材料，且不能存在待审核或被驳回材料，才能完成交接"
                    : "补充材料尚未全部审核通过");
        }
    }

    private void closeCompetingApplications(Long aid, Long approvedUid, User actor, Date now) {
        List<Adopt> competitors = list(new QueryWrapper<Adopt>().eq("aid", aid)
                .ne("uid", approvedUid).in("vstate", ADOPT_PENDING, ADOPT_MATERIAL_REQUIRED));
        if (competitors.isEmpty()) return;
        UpdateWrapper<Adopt> close = new UpdateWrapper<>();
        close.eq("aid", aid).ne("uid", approvedUid)
                .in("vstate", ADOPT_PENDING, ADOPT_MATERIAL_REQUIRED)
                .set("vstate", ADOPT_CANCELLED)
                .set("reviewer_id", actor == null ? null : actor.getId())
                .set("review_reason", "其他申请已完成线下交接")
                .set("reviewed_at", now).set("updated_at", now)
                .setSql("version = COALESCE(version, 0) + 1");
        update(new Adopt(), close);
        for (Adopt item : competitors) {
            recordEvent(aid, item.getUid(), item.getVstate(), ADOPT_CANCELLED,
                    "CANCEL_COMPETING", actor, "其他申请已完成线下交接", null);
            notifyApplicant(aid, item.getUid(), ADOPT_CANCELLED,
                    "其他申请已完成线下交接", nextVersion(item));
        }
    }

    private void requireManager(boolean manager) {
        if (!manager) throw new CustomException("403", "无权执行该领养状态操作");
    }

    private void requireState(int current, Set<Integer> allowed, String message) {
        if (!allowed.contains(current)) throw new CustomException("409", message);
    }

    private String normalizeAction(String action) {
        if (action == null || action.trim().isEmpty()) throw new CustomException("400", "缺少状态操作");
        String clean = action.trim().toUpperCase(Locale.ROOT);
        if (!Set.of("REQUEST_MATERIAL", "APPROVE", "REJECT", "COMPLETE_HANDOVER",
                "WITHDRAW", "CANCEL", "REOPEN").contains(clean)) {
            throw new CustomException("400", "不支持的状态操作");
        }
        return clean;
    }

    private int desiredTarget(String action) {
        return switch (action) {
            case "REQUEST_MATERIAL" -> ADOPT_MATERIAL_REQUIRED;
            case "APPROVE" -> ADOPT_APPROVED;
            case "REJECT" -> ADOPT_REJECTED;
            case "COMPLETE_HANDOVER" -> ADOPT_COMPLETED;
            case "WITHDRAW" -> ADOPT_WITHDRAWN;
            case "CANCEL" -> ADOPT_CANCELLED;
            case "REOPEN" -> ADOPT_PENDING;
            default -> throw new CustomException("400", "不支持的状态操作");
        };
    }

    private String requireReason(String action, String reason) {
        String clean = normalizeText(reason, 1000, "操作原因");
        if (Set.of("REQUEST_MATERIAL", "REJECT", "CANCEL", "REOPEN").contains(action)
                && (clean == null || clean.length() < 2)) {
            throw new CustomException("400", "请填写明确的操作原因");
        }
        if (clean != null) return clean;
        return switch (action) {
            case "APPROVE" -> "审核通过，等待线下交接";
            case "COMPLETE_HANDOVER" -> "已确认完成线下交接";
            case "WITHDRAW" -> "申请人主动撤回";
            default -> "状态已更新";
        };
    }

    private String normalizeText(String value, int max, String field) {
        if (value == null || value.trim().isEmpty()) return null;
        String clean = value.trim();
        if (clean.length() > max) throw new CustomException("400", field + "不能超过" + max + "个字符");
        return clean;
    }

    private int nextVersion(Adopt adopt) {
        return (adopt == null || adopt.getVersion() == null ? 0 : adopt.getVersion()) + 1;
    }

    private void recordEvent(Long aid, Long uid, Integer from, Integer to, String action,
                             User actor, String reason, String requestId) {
        recordEvent(aid, uid, from, to, action, actor, reason, requestId,
                actor == null ? "SYSTEM" : "USER");
    }

    private void recordEvent(Long aid, Long uid, Integer from, Integer to, String action,
                             User actor, String reason, String requestId, String actorType) {
        if (workflowEventService == null) return; // 单元测试中的轻量构造兼容
        workflowEventService.record("adopt", businessId(aid, uid), from, to, action,
                actor == null ? null : actor.getId(), actorType == null ? (actor == null ? "SYSTEM" : "USER") : actorType,
                reason, requestId, null);
    }

    private void notifyApplicant(Long aid, Long uid, int state, String reason, int version) {
        if (notificationService == null || uid == null) return;
        String title = "领养申请状态更新";
        String summary = "动物 #" + aid + "：" + AdoptWorkflow.label(state)
                + (reason == null ? "" : "。" + reason);
        notificationService.notifyOnce(uid, "adopt", title, summary, "adopt", businessId(aid, uid),
                "/page/front/my_adopt.html", "adopt:" + aid + ":" + uid + ":v" + version);
    }

    private String businessId(Long aid, Long uid) {
        return aid + ":" + uid;
    }

    private void syncAnimalState(Long aid) {
        if (aid == null) {
            return;
        }
        Integer currentState = animalService.lockState(aid);
        if (currentState == null) {
            return;
        }
        long completedCount = count(new QueryWrapper<Adopt>().eq("aid", aid).eq("vstate", ADOPT_COMPLETED));
        long activeCount = count(new QueryWrapper<Adopt>().eq("aid", aid)
                .in("vstate", ADOPT_PENDING, ADOPT_MATERIAL_REQUIRED, ADOPT_APPROVED));
        if (completedCount > 0) {
            updateAnimalState(aid, currentState, ANIMAL_ADOPTED);
        } else if (activeCount > 0) {
            updateAnimalState(aid, currentState, ANIMAL_APPLYING);
        } else {
            updateAnimalState(aid, currentState, ANIMAL_AVAILABLE);
        }
    }

    private void syncAnimalStateAfterDelete(Long aid) {
        if (aid == null) {
            return;
        }
        syncAnimalState(aid);
    }

    private void updateAnimalState(Long aid, Integer currentState, Integer nextState) {
        if (!animalService.compareAndSetState(aid, currentState, nextState)) {
            throw new CustomException("409", "动物状态已变化，请刷新后重试");
        }
    }

}
