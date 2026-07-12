package com.example.service;

import com.example.entity.Volunteer;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
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

    @Value("${app.volunteer.auto-grant-role-id:2}")
    private Long autoGrantRoleId;

    /**
     * 更新义工申请；审核通过时为申请人追加轻量「认证义工」角色（可配置 role id，默认 4，无后台管理权）。
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
}
