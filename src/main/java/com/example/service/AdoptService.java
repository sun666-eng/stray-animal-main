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
        } else if (adopt.getVstate() == null) {
            adopt.setVstate(ADOPT_PENDING);
        }

        boolean saved = save(adopt);
        if (!saved) {
            throw new CustomException("500", "领养申请保存失败");
        }
        syncAnimalState(adopt.getAid());
        return saved;
    }

    @Transactional
    public boolean auditAdopt(Long aid, Long uid, Integer state) {
        validateAdoptState(state);
        QueryWrapper<Adopt> queryWrapper = new QueryWrapper<>();
        queryWrapper.eq("aid", aid);
        queryWrapper.eq("uid", uid);
        Adopt adopt = new Adopt();
        adopt.setVstate(state);
        boolean updated = update(adopt, queryWrapper);
        if (updated) {
            // 一人通过后，同动物其他待审申请自动驳回，避免僵尸待审与状态不一致
            if (Integer.valueOf(ADOPT_APPROVED).equals(state)) {
                rejectCompetingPending(aid, uid);
            }
            syncAnimalState(aid);
        }
        return updated;
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
        }
    }

}
