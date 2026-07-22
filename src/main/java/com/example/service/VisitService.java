package com.example.service;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.example.entity.Adopt;
import com.example.entity.Animal;
import com.example.entity.User;
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

    @Resource
    private FileAssetService fileAssetService;

    /**
     * 新增回访：仅允许「已审核通过」的领养关系 (petId=aid, uid)。
     */
    @Transactional
    public boolean createVisit(Visit visit, User user) {
        validateAndNormalize(visit, true);
        if (!save(visit)) {
            throw new CustomException("500", "回访保存失败");
        }
        if (visit.getPic() != null && !visit.getPic().trim().isEmpty()) {
            fileAssetService.bindToBusiness(user, visit.getPic(), "visit",
                    "visit", visit.getId(), true);
        }
        return true;
    }

    /**
     * 更新回访：仍要求目标动物+饲主存在已通过领养；附件三态。
     */
    @Transactional
    public boolean updateVisit(Visit visit, User user) {
        if (visit == null || visit.getId() == null) {
            throw new CustomException("400", "回访ID不能为空");
        }
        Visit existing = getOne(Wrappers.<Visit>lambdaQuery()
                .eq(Visit::getId, visit.getId()).last("FOR UPDATE"));
        if (existing == null) {
            throw new CustomException("404", "回访记录不存在");
        }
        if (visit.getPetId() == null) {
            visit.setPetId(existing.getPetId());
        }
        if (visit.getUid() == null) {
            visit.setUid(existing.getUid());
        }
        validateAndNormalize(visit, false);

        String oldPic = existing.getPic();
        String newPic = visit.getPic();
        if (newPic != null) {
            String next = newPic.trim();
            String prev = oldPic == null ? "" : oldPic.trim();
            if (!next.isEmpty() && !next.equals(prev)) {
                fileAssetService.bindToBusiness(user, next, "visit",
                        "visit", visit.getId(), true);
            }
        }
        if (!updateById(visit)) {
            throw new CustomException("409", "业务记录已变化，请刷新后重试");
        }
        if (newPic != null) {
            String next = newPic.trim();
            String prev = oldPic == null ? "" : oldPic.trim();
            if (next.isEmpty()) {
                if (!prev.isEmpty()) {
                    fileAssetService.unbindIfMatches(prev, "visit", visit.getId());
                }
            } else if (!next.equals(prev) && !prev.isEmpty()) {
                fileAssetService.unbindIfMatches(prev, "visit", visit.getId());
            }
        }
        return true;
    }

    @Transactional
    public boolean deleteVisit(Long id) {
        Visit existing = getOne(Wrappers.<Visit>lambdaQuery()
                .eq(Visit::getId, id).last("FOR UPDATE"));
        if (existing == null) {
            return true;
        }
        fileAssetService.unbindAllForBusiness("visit", id);
        if (!removeById(id)) {
            throw new CustomException("409", "删除失败，请刷新后重试");
        }
        return true;
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

        long approved = adoptService.count(new QueryWrapper<Adopt>()
                .eq("aid", visit.getPetId())
                .eq("uid", visit.getUid())
                .eq("vstate", ADOPT_APPROVED));
        if (approved <= 0) {
            throw new CustomException("400", "仅可为已审核通过的领养申请录入回访");
        }

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
