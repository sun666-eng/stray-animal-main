package com.example.service;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.example.common.PermissionUtil;
import com.example.entity.User;
import com.example.entity.Volunteer;
import com.example.exception.CustomException;
import com.example.mapper.VolunteerMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import javax.annotation.Resource;

@Service
public class VolunteerService extends ServiceImpl<VolunteerMapper, Volunteer> {

    public static final int STATE_PENDING = 0;
    public static final int STATE_APPROVED = 1;
    public static final int STATE_REJECTED = 2;

    @Resource
    private VolunteerMapper volunteerMapper;

    @Resource
    private UserService userService;

    @Resource
    private FileAssetService fileAssetService;

    @Value("${app.volunteer.auto-grant-role-id:2}")
    private Long autoGrantRoleId;

    @Transactional
    public boolean submitVolunteer(Volunteer volunteer, User user) {
        if (user == null || user.getId() == null) {
            throw new CustomException("401", "未登录或登录已过期");
        }
        volunteer.setUid(user.getId());
        if (!PermissionUtil.hasFlag(user, "volunteer")) {
            volunteer.setVstate(STATE_PENDING);
        } else if (volunteer.getVstate() == null) {
            volunteer.setVstate(STATE_PENDING);
        }
        if (!save(volunteer)) {
            throw new CustomException("500", "义工申请保存失败");
        }
        if (volunteer.getApic() != null && !volunteer.getApic().trim().isEmpty()) {
            fileAssetService.bindToBusiness(user, volunteer.getApic(), "volunteer",
                    "volunteer", volunteer.getId(), PermissionUtil.hasFlag(user, "volunteer"));
        }
        return true;
    }

    @Transactional
    public boolean updateVolunteer(Volunteer volunteer, User user) {
        if (user == null || user.getId() == null) {
            throw new CustomException("401", "未登录或登录已过期");
        }
        if (volunteer == null || volunteer.getId() == null) {
            throw new CustomException("400", "记录 ID 无效");
        }
        Volunteer existing = getOne(Wrappers.<Volunteer>lambdaQuery()
                .eq(Volunteer::getId, volunteer.getId()).last("FOR UPDATE"));
        if (existing == null) {
            throw new CustomException("404", "义工申请不存在");
        }
        boolean manage = PermissionUtil.hasFlag(user, "volunteer");
        if (!manage && !user.getId().equals(existing.getUid())) {
            throw new CustomException("403", "只能修改自己的义工申请");
        }
        if (!manage) {
            volunteer.setUid(existing.getUid());
            if (existing.getVstate() != null && existing.getVstate() != STATE_PENDING) {
                throw new CustomException("403", "已审核申请不可修改");
            }
            volunteer.setVstate(STATE_PENDING);
        }

        String oldPic = existing.getApic();
        String newPic = volunteer.getApic();
        if (newPic != null) {
            String next = newPic.trim();
            String prev = oldPic == null ? "" : oldPic.trim();
            if (!next.isEmpty() && !next.equals(prev)) {
                fileAssetService.bindToBusiness(user, next, "volunteer",
                        "volunteer", volunteer.getId(), manage);
            }
        }

        if (!updateWithRoleSync(volunteer)) {
            throw new CustomException("409", "业务记录已变化，请刷新后重试");
        }

        if (newPic != null) {
            String next = newPic.trim();
            String prev = oldPic == null ? "" : oldPic.trim();
            if (next.isEmpty()) {
                if (!prev.isEmpty()) {
                    fileAssetService.unbindIfMatches(prev, "volunteer", volunteer.getId());
                }
            } else if (!next.equals(prev) && !prev.isEmpty()) {
                fileAssetService.unbindIfMatches(prev, "volunteer", volunteer.getId());
            }
        }
        return true;
    }

    /**
     * 更新义工申请；审核通过时为申请人追加轻量「认证义工」角色。
     */
    @Transactional
    public boolean updateWithRoleSync(Volunteer volunteer) {
        boolean ok = updateById(volunteer);
        if (ok
                && volunteer != null
                && Integer.valueOf(STATE_APPROVED).equals(volunteer.getVstate())
                && volunteer.getUid() != null
                && autoGrantRoleId != null
                && autoGrantRoleId > 0) {
            userService.ensureHasRole(volunteer.getUid(), autoGrantRoleId);
        }
        return ok;
    }

    @Transactional
    public boolean deleteVolunteer(Long id) {
        Volunteer existing = getOne(Wrappers.<Volunteer>lambdaQuery()
                .eq(Volunteer::getId, id).last("FOR UPDATE"));
        if (existing == null) {
            return true;
        }
        fileAssetService.unbindAllForBusiness("volunteer", id);
        if (!removeById(id)) {
            throw new CustomException("409", "删除失败，请刷新后重试");
        }
        return true;
    }
}
