package com.example.service;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.example.entity.Adopt;
import com.example.entity.Animal;
import com.example.entity.Visit;
import com.example.exception.CustomException;
import com.example.mapper.VisitMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

import javax.annotation.Resource;

@Service
public class VisitService extends ServiceImpl<VisitMapper, Visit> {

    private static final int ADOPT_APPROVED = 1;

    @Resource
    private VisitMapper visitMapper;

    @Resource
    private AdoptService adoptService;

    @Resource
    private AnimalService animalService;

    /**
     * 新增回访：仅允许「已审核通过」的领养关系 (petId=aid, uid)。
     */
    @Transactional
    public boolean createVisit(Visit visit) {
        validateAndNormalize(visit, true);
        return save(visit);
    }

    /**
     * 更新回访：仍要求目标动物+饲主存在已通过领养。
     */
    @Transactional
    public boolean updateVisit(Visit visit) {
        if (visit == null || visit.getId() == null) {
            throw new CustomException("400", "回访ID不能为空");
        }
        Visit existing = getById(visit.getId());
        if (existing == null) {
            throw new CustomException("404", "回访记录不存在");
        }
        // 未传的关联字段沿用原记录，避免前端编辑时丢 petId/uid
        if (visit.getPetId() == null) {
            visit.setPetId(existing.getPetId());
        }
        if (visit.getUid() == null) {
            visit.setUid(existing.getUid());
        }
        validateAndNormalize(visit, false);
        return updateById(visit);
    }

    private void validateAndNormalize(Visit visit, boolean creating) {
        if (visit == null) {
            throw new CustomException("400", "回访信息不能为空");
        }
        if (visit.getPetId() == null) {
            throw new CustomException("400", "动物ID不能为空");
        }
        if (visit.getUid() == null) {
            throw new CustomException("400", "饲主用户ID不能为空");
        }
        if (visit.getVtime() == null) {
            throw new CustomException("400", "回访日期不能为空");
        }
        if (visit.getState() == null || visit.getState() < 1 || visit.getState() > 5) {
            throw new CustomException("400", "健康评分须为1-5");
        }
        if (!StringUtils.hasText(visit.getVname())) {
            throw new CustomException("400", "回访人姓名不能为空");
        }

        // 核心不变量：必须存在已通过的领养申请
        long approved = adoptService.count(new QueryWrapper<Adopt>()
                .eq("aid", visit.getPetId())
                .eq("uid", visit.getUid())
                .eq("vstate", ADOPT_APPROVED));
        if (approved <= 0) {
            throw new CustomException("400", "仅可为已审核通过的领养申请录入回访");
        }

        // 动物名称以档案为准，避免客户端脏数据
        Animal animal = animalService.getById(visit.getPetId());
        if (animal == null) {
            throw new CustomException("404", "动物信息不存在");
        }
        if (StringUtils.hasText(animal.getTname())) {
            visit.setAname(animal.getTname());
        } else if (!StringUtils.hasText(visit.getAname())) {
            throw new CustomException("400", "动物名称不能为空");
        }

        if (creating) {
            visit.setId(null);
        }
    }
}
