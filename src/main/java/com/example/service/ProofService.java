package com.example.service;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.example.entity.Adopt;
import com.example.entity.Proof;
import com.example.entity.User;
import com.example.exception.CustomException;
import com.example.mapper.ProofMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import javax.annotation.Resource;

@Service
public class ProofService extends ServiceImpl<ProofMapper, Proof> {

    public static final int STATUS_PENDING = 0;
    public static final int STATUS_APPROVED = 1;
    public static final int STATUS_REJECTED = 2;

    @Resource
    private ProofMapper proofMapper;

    @Resource
    private AdoptService adoptService;

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
        if (!canManageProof) {
            proof.setPuid(user.getId());
            proof.setUname(user.getUsername());
            if (proof.getPaid() == null) {
                throw new CustomException("400", "缺少领养动物ID");
            }
            QueryWrapper<Adopt> adoptQuery = new QueryWrapper<>();
            adoptQuery.eq("aid", proof.getPaid());
            adoptQuery.eq("uid", user.getId());
            adoptQuery.eq("vstate", 1);
            if (adoptService.count(adoptQuery) == 0) {
                throw new CustomException("403", "只能为自己已审核通过的领养申请上传凭证");
            }
            // 用户不可自设为已通过
            proof.setPstatus(STATUS_PENDING);
        } else if (proof.getPstatus() == null) {
            proof.setPstatus(STATUS_PENDING);
        } else {
            validateStatus(proof.getPstatus());
        }
        return save(proof);
    }

    @Transactional
    public boolean auditProof(Long id, Integer state) {
        validateStatus(state);
        Proof existing = getById(id);
        if (existing == null) {
            throw new CustomException("404", "凭证不存在");
        }
        existing.setPstatus(state);
        return updateById(existing);
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
}
