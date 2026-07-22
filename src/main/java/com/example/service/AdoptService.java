package com.example.service;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.example.entity.Adopt;
import com.example.entity.Animal;
import com.example.entity.User;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.baomidou.mybatisplus.core.conditions.update.UpdateWrapper;
import com.example.exception.CustomException;
import com.example.mapper.AdoptMapper;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.stereotype.Service;

import javax.annotation.Resource;

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

    @Transactional
    public boolean submitAdopt(Adopt adopt, User user, boolean canManageAdopt) {
        if (user == null || user.getId() == null) {
            throw new CustomException("401", "未登录或登录已过期");
        }
        if (adopt == null || adopt.getAid() == null) {
            throw new CustomException("400", "动物信息不能为空");
        }

        Animal animal = animalService.getById(adopt.getAid());
        if (animal == null) {
            throw new CustomException("404", "动物信息不存在");
        }

        if (!canManageAdopt) {
            // 已有通过记录则禁止再申请
            long approved = count(new QueryWrapper<Adopt>().eq("aid", adopt.getAid()).eq("vstate", ADOPT_APPROVED));
            if (approved > 0) {
                throw new CustomException("400", "该动物已被领养");
            }
            UpdateWrapper<Animal> claim = new UpdateWrapper<>();
            claim.eq("id", adopt.getAid())
                    .eq("tstate", ANIMAL_AVAILABLE)
                    .set("tstate", ANIMAL_APPLYING);
            boolean claimed = animalService.update(claim);
            if (!claimed) {
                throw new CustomException("400", "该动物当前不可领养");
            }
            adopt.setUid(user.getId());
            adopt.setUname(user.getUsername());
            adopt.setAname(animal.getTname());
            adopt.setApic(animal.getTpic());
            adopt.setVstate(ADOPT_PENDING);
        } else {
            // 管理员录入也不得客户端指定通过状态，统一走审核接口
            adopt.setVstate(ADOPT_PENDING);
        }

        boolean saved = save(adopt);
        if (!saved) {
            throw new CustomException("500", "领养申请保存失败");
        }
        syncAnimalState(adopt.getAid());
        return saved;
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

        QueryWrapper<Adopt> existingQ = new QueryWrapper<>();
        existingQ.eq("aid", aid).eq("uid", uid);
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
        QueryWrapper<Adopt> queryWrapper = new QueryWrapper<>();
        queryWrapper.eq("aid", aid);
        queryWrapper.eq("uid", uid);
        boolean removed = remove(queryWrapper);
        if (removed) {
            syncAnimalStateAfterDelete(aid);
        }
        return removed;
    }

    private void validateAdoptState(Integer state) {
        if (state == null || state < ADOPT_PENDING || state > ADOPT_OTHER) {
            throw new CustomException("400", "非法的领养状态");
        }
    }

    private void syncAnimalState(Long aid) {
        if (aid == null) {
            return;
        }
        Animal animal = animalService.getById(aid);
        if (animal == null) {
            return;
        }
        long approvedCount = count(new QueryWrapper<Adopt>().eq("aid", aid).eq("vstate", ADOPT_APPROVED));
        long pendingCount = count(new QueryWrapper<Adopt>().eq("aid", aid).eq("vstate", ADOPT_PENDING));
        if (approvedCount > 0) {
            animal.setTstate(ANIMAL_ADOPTED);
        } else if (pendingCount > 0) {
            animal.setTstate(ANIMAL_APPLYING);
        } else {
            animal.setTstate(ANIMAL_AVAILABLE);
        }
        animalService.updateById(animal);
    }

    private void syncAnimalStateAfterDelete(Long aid) {
        if (aid == null) {
            return;
        }
        long activeCount = count(new QueryWrapper<Adopt>()
                .eq("aid", aid)
                .in("vstate", ADOPT_PENDING, ADOPT_APPROVED));
        if (activeCount == 0) {
            Animal animal = animalService.getById(aid);
            if (animal != null) {
                animal.setTstate(ANIMAL_AVAILABLE);
                animalService.updateById(animal);
            }
        } else {
            syncAnimalState(aid);
        }
    }

}
