package com.example.service;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.baomidou.mybatisplus.core.conditions.update.UpdateWrapper;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.example.entity.Adopt;
import com.example.entity.Proof;
import com.example.entity.User;
import com.example.exception.CustomException;
import com.example.mapper.ProofMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import jakarta.annotation.Resource;
import java.util.Date;

@Service
public class ProofService extends ServiceImpl<ProofMapper, Proof> {

    public static final int STATUS_PENDING = 0;
    public static final int STATUS_APPROVED = 1;
    public static final int STATUS_REJECTED = 2;

    @Resource
    private ProofMapper proofMapper;

    @Resource
    private AdoptService adoptService;

    @Resource
    private FileAssetService fileAssetService;

    @Resource
    private AnimalService animalService;

    @Resource
    private WorkflowEventService workflowEventService;

    @Resource
    private NotificationService notificationService;

    /**
     * 用户或管理员提交凭证。非管理员强制 pstatus=待审核，并校验本人已通过的领养。
     */
    @Transactional
    public boolean submitProof(Proof proof, User user, boolean canManageProof) {
        if (user == null || user.getId() == null) {
            throw new CustomException("401", "未登录或登录已过期");
        }
        if (proof == null) {
            throw new CustomException("400", "凭证不能为空");
        }
        if (proof.getPaid() == null) {
            throw new CustomException("400", "缺少领养动物ID");
        }
        validateMutableFields(proof);

        if (animalService.lockState(proof.getPaid()) == null) {
            throw new CustomException("404", "动物信息不存在");
        }
        QueryWrapper<Adopt> adoptQuery = new QueryWrapper<>();
        adoptQuery.eq("aid", proof.getPaid());
        adoptQuery.eq("uid", user.getId());
        adoptQuery.in("vstate", 1, 3).last("FOR UPDATE");
        Adopt approvedAdopt = adoptService.getOne(adoptQuery, false);
        if (approvedAdopt == null) {
            throw new CustomException("403", "当前申请不处于补充材料或待交接阶段");
        }
        proof.setId(null);
        proof.setPuid(user.getId());
        proof.setUname(approvedAdopt.getUname());
        proof.setAname(approvedAdopt.getAname());
        proof.setPstatus(STATUS_PENDING);
        proof.setProofStage(proof.getProofStage() == null || proof.getProofStage().trim().isEmpty()
                ? (Integer.valueOf(3).equals(approvedAdopt.getVstate()) ? "pre_audit" : "handover")
                : validateStage(proof.getProofStage()));
        proof.setReviewerId(null);
        proof.setReviewReason(null);
        proof.setReviewedAt(null);
        proof.setCreatedAt(new Date());
        proof.setUpdatedAt(new Date());
        if (!save(proof)) {
            throw new CustomException("500", "凭证保存失败");
        }
        if (proof.getPpic() != null && !proof.getPpic().trim().isEmpty()) {
            fileAssetService.bindToBusiness(user, proof.getPpic(), "proof",
                    "proof", proof.getId(), canManageProof);
        }
        return true;
    }

    @Transactional
    public boolean updateProof(Proof proof, User user, boolean canManageProof) {
        if (user == null || user.getId() == null) {
            throw new CustomException("401", "未登录或登录已过期");
        }
        if (proof == null || proof.getId() == null) {
            throw new CustomException("400", "凭证 ID 无效");
        }
        Proof existing = getOne(Wrappers.<Proof>lambdaQuery()
                .eq(Proof::getId, proof.getId()).last("FOR UPDATE"));
        if (existing == null) {
            throw new CustomException("404", "凭证不存在");
        }
        if (!canManageProof && !user.getId().equals(existing.getPuid())) {
            throw new CustomException("403", "只能修改自己的凭证");
        }
        if (!canManageProof) {
            assertMutableByOwner(existing);
        }
        Proof update = new Proof();
        update.setId(existing.getId());
        update.setPaid(existing.getPaid());
        update.setPuid(existing.getPuid());
        update.setUname(existing.getUname());
        update.setAname(existing.getAname());
        update.setPtitle(proof.getPtitle());
        update.setPpic(proof.getPpic());
        update.setPstatus(canManageProof ? existing.getPstatus() : STATUS_PENDING);
        update.setProofStage(existing.getProofStage());
        update.setReviewerId(existing.getReviewerId());
        update.setReviewReason(existing.getReviewReason());
        update.setReviewedAt(existing.getReviewedAt());
        update.setCreatedAt(existing.getCreatedAt());
        update.setUpdatedAt(new Date());
        validateMutableFields(update);
        String oldPic = existing.getPpic();
        String newPic = update.getPpic();
        if (newPic != null) {
            String next = newPic.trim();
            String prev = oldPic == null ? "" : oldPic.trim();
            if (!next.isEmpty() && !next.equals(prev)) {
                fileAssetService.bindToBusiness(user, next, "proof",
                        "proof", proof.getId(), canManageProof);
            }
        }
        if (!updateById(update)) {
            throw new CustomException("409", "业务记录已变化，请刷新后重试");
        }
        if (newPic != null) {
            String next = newPic.trim();
            String prev = oldPic == null ? "" : oldPic.trim();
            if (next.isEmpty()) {
                if (!prev.isEmpty()) {
                    fileAssetService.retireIfMatches(prev, "proof", proof.getId());
                }
            } else if (!next.equals(prev) && !prev.isEmpty()) {
                fileAssetService.retireIfMatches(prev, "proof", proof.getId());
            }
        }
        return true;
    }

    @Transactional
    public boolean auditProof(Long id, Integer state) {
        return auditProof(id, state, null, null);
    }

    @Transactional
    public boolean auditProof(Long id, Integer state, String reason, User actor) {
        validateStatus(state);
        if (id == null) {
            throw new CustomException("400", "凭证 ID 无效");
        }
        Proof existing = getOne(Wrappers.<Proof>lambdaQuery()
                .eq(Proof::getId, id).last("FOR UPDATE"));
        if (existing == null) {
            throw new CustomException("404", "凭证不存在");
        }
        Integer current = existing.getPstatus() == null ? STATUS_PENDING : existing.getPstatus();
        if (current.equals(state)) {
            return true;
        }
        if (current != STATUS_PENDING || state == STATUS_PENDING) {
            throw new CustomException("409", "该凭证当前状态不允许审核");
        }
        UpdateWrapper<Proof> cas = new UpdateWrapper<>();
        cas.eq("id", id).eq("pstatus", STATUS_PENDING);
        Proof patch = new Proof();
        patch.setPstatus(state);
        patch.setReviewerId(actor == null ? null : actor.getId());
        patch.setReviewReason(normalizeReason(state, reason));
        patch.setReviewedAt(new Date());
        patch.setUpdatedAt(new Date());
        if (!update(patch, cas)) {
            throw new CustomException("409", "审核冲突，请刷新后重试");
        }
        if (workflowEventService != null) {
            workflowEventService.record("proof", String.valueOf(id), current, state, "AUDIT",
                    actor == null ? null : actor.getId(), actor == null ? "SYSTEM" : "ADMIN",
                    patch.getReviewReason(), null, "{\"animalId\":" + existing.getPaid() + "}");
        }
        if (notificationService != null) {
            notificationService.notifyOnce(existing.getPuid(), "proof", "领养材料审核结果",
                    "动物 #" + existing.getPaid() + " 的材料" + (state == STATUS_APPROVED ? "已通过" : "未通过")
                            + (patch.getReviewReason() == null ? "" : "：" + patch.getReviewReason()),
                    "proof", String.valueOf(id), "/page/front/adopt_proof.html?aid=" + existing.getPaid(),
                    "proof:" + id + ":state:" + state);
        }
        return true;
    }

    @Transactional
    public boolean deleteProof(Long id, User user, boolean canManageProof) {
        if (user == null || user.getId() == null) {
            throw new CustomException("401", "未登录或登录已过期");
        }
        Proof existing = getOne(Wrappers.<Proof>lambdaQuery()
                .eq(Proof::getId, id).last("FOR UPDATE"));
        if (existing == null) {
            throw new CustomException("404", "凭证不存在");
        }
        if (!canManageProof) {
            if (!user.getId().equals(existing.getPuid())) {
                throw new CustomException("403", "只能删除自己的凭证");
            }
            assertMutableByOwner(existing);
        }
        fileAssetService.retireAllForBusiness("proof", id);
        if (!removeById(id)) {
            throw new CustomException("409", "删除失败，请刷新后重试");
        }
        return true;
    }

    public void assertMutableByOwner(Proof existing) {
        if (existing != null && Integer.valueOf(STATUS_APPROVED).equals(existing.getPstatus())) {
            throw new CustomException("403", "已通过的凭证不可修改或删除");
        }
    }

    private void validateStatus(Integer state) {
        if (state == null || state < STATUS_PENDING || state > STATUS_REJECTED) {
            throw new CustomException("400", "非法审核状态");
        }
    }

    private void validateMutableFields(Proof proof) {
        String title = proof.getPtitle() == null ? "" : proof.getPtitle().trim();
        if (title.isEmpty() || title.length() > 255) {
            throw new CustomException("400", "凭证标题不能为空且不能超过255个字符");
        }
        String picture = proof.getPpic() == null ? "" : proof.getPpic().trim();
        if (picture.isEmpty() || picture.length() > 100) {
            throw new CustomException("400", "凭证图片不能为空或标识无效");
        }
        proof.setPtitle(title);
        proof.setPpic(picture);
    }

    private String validateStage(String value) {
        String clean = value.trim().toLowerCase(java.util.Locale.ROOT);
        if (!java.util.Set.of("pre_audit", "handover", "post_adoption").contains(clean)) {
            throw new CustomException("400", "材料阶段无效");
        }
        return clean;
    }

    private String normalizeReason(Integer state, String reason) {
        String clean = reason == null ? "" : reason.trim();
        if (clean.length() > 1000) throw new CustomException("400", "审核原因不能超过1000个字符");
        if (Integer.valueOf(STATUS_REJECTED).equals(state) && clean.length() < 2) {
            throw new CustomException("400", "驳回材料时必须填写原因");
        }
        return clean.isEmpty() ? (Integer.valueOf(STATUS_APPROVED).equals(state) ? "材料审核通过" : null) : clean;
    }
}
