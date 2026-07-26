package com.example.service;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.example.entity.Adopt;
import com.example.entity.Animal;
import com.example.entity.User;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.baomidou.mybatisplus.core.conditions.update.UpdateWrapper;
import com.example.exception.CustomException;
import com.example.mapper.AdoptMapper;
import com.example.mapper.ProofMapper;
import com.example.mapper.VisitMapper;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.stereotype.Service;

import jakarta.annotation.Resource;

@Service
public class AdoptService extends ServiceImpl<AdoptMapper, Adopt> {

    private static final int ANIMAL_AVAILABLE = 0;
    private static final int ANIMAL_APPLYING = 1;
    private static final int ANIMAL_ADOPTED = 2;

    private static final int ADOPT_PENDING = 0;
    private static final int ADOPT_APPROVED = 1;
    private static final int ADOPT_REJECTED = 2;
    private static final int ADOPT_OTHER = 3;

    @Resource
    private AdoptMapper adoptMapper;

    @Resource
    private AnimalService animalService;

    @Resource
    private ProofMapper proofMapper;

    @Resource
    private VisitMapper visitMapper;

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
                && (Integer.valueOf(ADOPT_PENDING).equals(previous.getVstate())
                    || Integer.valueOf(ADOPT_APPROVED).equals(previous.getVstate()))) {
            throw new CustomException("409", "你已提交过该动物的领养申请");
        }

        // Every submission belongs to the authenticated actor. Management permission never
        // authorizes forging another user's identity or server-derived animal snapshots.
        long approved = count(new QueryWrapper<Adopt>().eq("aid", adopt.getAid()).eq("vstate", ADOPT_APPROVED));
        if (approved > 0) {
            throw new CustomException("400", "该动物已被领养");
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
            UpdateWrapper<Adopt> revive = new UpdateWrapper<>();
            revive.eq("aid", adopt.getAid()).eq("uid", user.getId())
                    .eq("vstate", previous.getVstate());
            saved = update(revived, revive);
        }
        if (!saved) {
            throw new CustomException("500", "领养申请保存失败");
        }
        syncAnimalState(adopt.getAid());
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
        if (!Integer.valueOf(ADOPT_PENDING).equals(existing.getVstate())) {
            throw new CustomException("409", "仅待审核申请可以修改");
        }

        Adopt mutable = mutableApplication(aid, uid, submitted);
        validateApplication(mutable);
        UpdateWrapper<Adopt> update = new UpdateWrapper<>();
        update.eq("aid", aid).eq("uid", uid).eq("vstate", ADOPT_PENDING);
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

    /**
     * B6：审核状态机。
     * <ul>
     *   <li>仅允许从待审迁移到通过/驳回/其他</li>
     *   <li>通过使用 CAS：仅 vstate=PENDING 可更新为 APPROVED，避免并发双通过</li>
     *   <li>通过后驳回同动物其他待审</li>
     *   <li>若已有他人通过，禁止再次通过</li>
     * </ul>
     */
    @Transactional
    public boolean auditAdopt(Long aid, Long uid, Integer state) {
        validateAdoptState(state);
        if (aid == null || uid == null) {
            throw new CustomException("400", "参数无效");
        }

        Integer lockedAnimalState = animalService.lockState(aid);
        if (lockedAnimalState == null) {
            throw new CustomException("404", "动物信息不存在");
        }
        QueryWrapper<Adopt> existingQ = new QueryWrapper<>();
        existingQ.eq("aid", aid).eq("uid", uid).last("FOR UPDATE");
        Adopt existing = getOne(existingQ, false);
        if (existing == null) {
            throw new CustomException("404", "领养申请不存在");
        }

        Integer current = existing.getVstate();
        if (current == null) {
            current = ADOPT_PENDING;
        }

        // 已是目标状态：幂等成功
        if (current.equals(state)) {
            syncAnimalState(aid);
            return true;
        }

        // 非法迁移：已通过/已驳回不可再改成其他审核结果（管理可走删除重建）
        if (current == ADOPT_APPROVED || current == ADOPT_REJECTED) {
            throw new CustomException("400", "该申请已终态，不可再次审核");
        }
        if (current != ADOPT_PENDING) {
            throw new CustomException("400", "当前状态不允许审核");
        }

        if (Integer.valueOf(ADOPT_APPROVED).equals(state)) {
            long otherApproved = count(new QueryWrapper<Adopt>()
                    .eq("aid", aid)
                    .eq("vstate", ADOPT_APPROVED)
                    .ne("uid", uid));
            if (otherApproved > 0) {
                throw new CustomException("400", "该动物已有通过的领养申请");
            }
            // CAS：仅待审可改为通过
            UpdateWrapper<Adopt> cas = new UpdateWrapper<>();
            cas.eq("aid", aid).eq("uid", uid).eq("vstate", ADOPT_PENDING);
            Adopt patch = new Adopt();
            patch.setVstate(ADOPT_APPROVED);
            boolean updated = update(patch, cas);
            if (!updated) {
                throw new CustomException("409", "审核冲突，请刷新后重试");
            }
            rejectCompetingPending(aid, uid);
            // 若竞争后仍出现多通过（极端并发），再清多余
            enforceSingleApproved(aid, uid);
            syncAnimalState(aid);
            return true;
        }

        // 驳回或其他：CAS 从 PENDING
        UpdateWrapper<Adopt> cas = new UpdateWrapper<>();
        cas.eq("aid", aid).eq("uid", uid).eq("vstate", ADOPT_PENDING);
        Adopt patch = new Adopt();
        patch.setVstate(state);
        boolean updated = update(patch, cas);
        if (!updated) {
            throw new CustomException("409", "审核冲突，请刷新后重试");
        }
        syncAnimalState(aid);
        return true;
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

    private void syncAnimalState(Long aid) {
        if (aid == null) {
            return;
        }
        Integer currentState = animalService.lockState(aid);
        if (currentState == null) {
            return;
        }
        long approvedCount = count(new QueryWrapper<Adopt>().eq("aid", aid).eq("vstate", ADOPT_APPROVED));
        long pendingCount = count(new QueryWrapper<Adopt>().eq("aid", aid).eq("vstate", ADOPT_PENDING));
        if (approvedCount > 0) {
            updateAnimalState(aid, currentState, ANIMAL_ADOPTED);
        } else if (pendingCount > 0) {
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
