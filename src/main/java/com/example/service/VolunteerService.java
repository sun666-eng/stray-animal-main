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

import jakarta.annotation.Resource;
import java.util.List;
import java.util.Objects;
import java.util.regex.Pattern;

@Service
public class VolunteerService extends ServiceImpl<VolunteerMapper, Volunteer> {

    public static final int STATE_PENDING = 0;
    public static final int STATE_APPROVED = 1;
    public static final int STATE_REJECTED = 2;
    private static final long VOLUNTEER_ROLE_ID = 4L;
    private static final Pattern PHONE_PATTERN = Pattern.compile("^1[3-9]\\d{9}$");
    private static final Pattern EMAIL_PATTERN = Pattern.compile(
            "^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$");

    @Resource
    private VolunteerMapper volunteerMapper;

    @Resource
    private UserService userService;

    @Resource
    private FileAssetService fileAssetService;

    @Value("${app.volunteer.auto-grant-role-id:4}")
    private Long autoGrantRoleId;

    @Transactional
    public boolean submitVolunteer(Volunteer volunteer, User user) {
        User actor = requireCurrentUser(user, true);
        if (volunteer == null) {
            throw new CustomException("400", "义工申请不能为空");
        }
        if (volunteer.getVstate() != null) {
            validateState(volunteer.getVstate());
        }
        // New ownership and workflow state are always server-generated.
        volunteer.setId(null);
        volunteer.setUid(actor.getId());
        volunteer.setVstate(STATE_PENDING);
        volunteer.setName(actor.getUsername());
        volunteer.setTel(actor.getPhone());
        volunteer.setEmail(actor.getEmail());
        validateApplication(volunteer);

        List<Volunteer> active = list(Wrappers.<Volunteer>lambdaQuery()
                .eq(Volunteer::getUid, actor.getId())
                .in(Volunteer::getVstate, STATE_PENDING, STATE_APPROVED)
                .last("FOR UPDATE"));
        if (!active.isEmpty()) {
            throw new CustomException("409", "已有待审核或已通过的义工申请");
        }
        if (!save(volunteer)) {
            throw new CustomException("500", "义工申请保存失败");
        }
        if (volunteer.getApic() != null && !volunteer.getApic().trim().isEmpty()) {
            fileAssetService.bindToBusiness(actor, volunteer.getApic(), "volunteer",
                    "volunteer", volunteer.getId(), false);
        }
        return true;
    }

    @Transactional
    public boolean updateVolunteer(Volunteer volunteer, User user) {
        User actor = requireCurrentUser(user, false);
        if (volunteer == null || volunteer.getId() == null) {
            throw new CustomException("400", "记录 ID 无效");
        }
        Volunteer existing = getOne(Wrappers.<Volunteer>lambdaQuery()
                .eq(Volunteer::getId, volunteer.getId()).last("FOR UPDATE"));
        if (existing == null) {
            throw new CustomException("404", "义工申请不存在");
        }
        boolean manage = PermissionUtil.hasFlag(actor, "volunteer");
        if (!manage && !actor.getId().equals(existing.getUid())) {
            throw new CustomException("403", "只能修改自己的义工申请");
        }
        if (!manage && !Integer.valueOf(STATE_PENDING).equals(existing.getVstate())) {
            throw new CustomException("403", "已审核申请不可修改");
        }
        if (volunteer.getVstate() != null) {
            validateState(volunteer.getVstate());
            throw new CustomException("400", "审核状态请使用专用审核接口");
        }
        // Applicant identity and audited status are immutable through generic edits.
        volunteer.setUid(existing.getUid());
        volunteer.setVstate(existing.getVstate());
        volunteer.setName(existing.getName());
        volunteer.setTel(existing.getTel());
        volunteer.setEmail(existing.getEmail());
        if (manage) {
            // Managers audit status separately and cannot replace applicant-owned photos.
            volunteer.setApic(existing.getApic());
        }
        validateApplication(volunteer);

        String oldPic = existing.getApic();
        String newPic = volunteer.getApic();
        if (newPic != null) {
            String next = newPic.trim();
            String prev = oldPic == null ? "" : oldPic.trim();
            if (!next.isEmpty() && !next.equals(prev)) {
                fileAssetService.bindToBusiness(actor, next, "volunteer",
                        "volunteer", volunteer.getId(), false);
            }
        }

        if (!updateById(volunteer)) {
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

    @Transactional
    public boolean auditVolunteer(Long id, Integer state, User user) {
        User actor = requireCurrentUser(user, false);
        if (!PermissionUtil.hasFlag(actor, "volunteer")) {
            throw new CustomException("403", "无权审核义工申请");
        }
        if (id == null) {
            throw new CustomException("400", "记录 ID 无效");
        }
        validateState(state);
        Volunteer snapshot = getById(id);
        if (snapshot == null) {
            throw new CustomException("404", "义工申请不存在");
        }
        if (snapshot.getUid() != null) {
            userService.lockVolunteerRoleUser(snapshot.getUid());
        }
        Volunteer existing = getOne(Wrappers.<Volunteer>lambdaQuery()
                .eq(Volunteer::getId, id).last("FOR UPDATE"));
        if (existing == null || !Objects.equals(snapshot.getUid(), existing.getUid())) {
            throw new CustomException("409", "义工申请已变化，请刷新后重试");
        }
        validateState(existing.getVstate());
        boolean syncRole = existing.getUid() != null && volunteerRoleSyncEnabled();

        if (existing.getUid() != null && Integer.valueOf(STATE_APPROVED).equals(state)) {
            List<Volunteer> otherApproved = list(Wrappers.<Volunteer>lambdaQuery()
                    .eq(Volunteer::getUid, existing.getUid())
                    .eq(Volunteer::getVstate, STATE_APPROVED)
                    .ne(Volunteer::getId, existing.getId())
                    .last("FOR UPDATE"));
            if (!otherApproved.isEmpty()) {
                throw new CustomException("409", "该用户已有已通过的义工申请");
            }
        }

        if (!state.equals(existing.getVstate())) {
            Volunteer patch = new Volunteer();
            patch.setId(existing.getId());
            patch.setVstate(state);
            if (!updateById(patch)) {
                throw new CustomException("409", "审核冲突，请刷新后重试");
            }
        }
        if (syncRole && Integer.valueOf(STATE_APPROVED).equals(state)) {
            userService.ensureHasRole(existing.getUid(), VOLUNTEER_ROLE_ID);
        } else if (syncRole) {
            userService.removeRoleIfNoApprovedVolunteer(existing.getUid(), VOLUNTEER_ROLE_ID);
        }
        return true;
    }

    @Transactional
    public boolean deleteVolunteer(Long id, User user) {
        User actor = requireCurrentUser(user, false);
        if (id == null) {
            throw new CustomException("400", "记录 ID 无效");
        }
        Volunteer snapshot = getById(id);
        if (snapshot == null) {
            return true;
        }
        if (snapshot.getUid() != null) {
            userService.lockVolunteerRoleUser(snapshot.getUid());
        }
        Volunteer existing = getOne(Wrappers.<Volunteer>lambdaQuery()
                .eq(Volunteer::getId, id).last("FOR UPDATE"));
        if (existing == null || !Objects.equals(snapshot.getUid(), existing.getUid())) {
            throw new CustomException("409", "义工申请已变化，请刷新后重试");
        }
        boolean manage = PermissionUtil.hasFlag(actor, "volunteer");
        if (!manage && !actor.getId().equals(existing.getUid())) {
            throw new CustomException("403", "只能删除自己的义工申请");
        }
        if (!manage && Integer.valueOf(STATE_APPROVED).equals(existing.getVstate())) {
            throw new CustomException("403", "已通过申请不可自行删除");
        }
        boolean syncRole = existing.getUid() != null
                && Integer.valueOf(STATE_APPROVED).equals(existing.getVstate())
                && volunteerRoleSyncEnabled();
        fileAssetService.retireAllForBusiness("volunteer", id);
        int deleted = volunteerMapper.delete(Wrappers.<Volunteer>lambdaQuery()
                .eq(Volunteer::getId, id));
        if (deleted != 1) {
            throw new CustomException("409", "删除失败，请刷新后重试");
        }
        if (syncRole) {
            userService.removeRoleIfNoApprovedVolunteer(existing.getUid(), VOLUNTEER_ROLE_ID);
        }
        return true;
    }

    private User requireCurrentUser(User sessionUser, boolean lock) {
        if (sessionUser == null || sessionUser.getId() == null) {
            throw new CustomException("401", "未登录或登录已过期");
        }
        User actor = lock
                ? userService.getOne(Wrappers.<User>lambdaQuery()
                        .eq(User::getId, sessionUser.getId()).last("FOR UPDATE"))
                : userService.getById(sessionUser.getId());
        if (actor == null) {
            throw new CustomException("401", "未登录或登录已过期");
        }
        userService.fillPermissions(actor);
        return actor;
    }

    private void validateApplication(Volunteer volunteer) {
        volunteer.setName(requiredText(volunteer.getName(), "姓名", 50));
        if (volunteer.getAge() == null || volunteer.getAge() < 16 || volunteer.getAge() > 100) {
            throw new CustomException("400", "年龄需在16至100岁之间");
        }
        volunteer.setTel(requiredText(volunteer.getTel(), "联系电话", 20));
        if (!PHONE_PATTERN.matcher(volunteer.getTel()).matches()) {
            throw new CustomException("400", "账号联系电话必须为11位中国大陆手机号，请先更新个人资料");
        }
        volunteer.setEmail(requiredText(volunteer.getEmail(), "电子邮件", 254));
        if (!EMAIL_PATTERN.matcher(volunteer.getEmail()).matches()) {
            throw new CustomException("400", "账号电子邮件格式无效，请先更新个人资料");
        }
        volunteer.setWechat(requiredText(volunteer.getWechat(), "微信号", 50));
        volunteer.setLocation(requiredText(volunteer.getLocation(), "现住址", 255));
        volunteer.setCompany(requiredText(volunteer.getCompany(), "工作单位", 255));
        volunteer.setMoreability(requiredText(volunteer.getMoreability(), "能力自述", 255));
        if (volunteer.getSparetime() == null
                || volunteer.getSparetime() < 1 || volunteer.getSparetime() > 4) {
            throw new CustomException("400", "空闲时间选项无效");
        }
        if (volunteer.getIsvisit() == null
                || (volunteer.getIsvisit() != 0 && volunteer.getIsvisit() != 1)) {
            throw new CustomException("400", "基地到访选项无效");
        }
        if (volunteer.getApic() != null) {
            String apic = volunteer.getApic().trim();
            if (apic.length() > 255) {
                throw new CustomException("400", "本人免冠照标识过长");
            }
            volunteer.setApic(apic);
        }
    }

    private String requiredText(String value, String field, int maxLength) {
        if (value == null || value.trim().isEmpty() || value.trim().length() > maxLength) {
            throw new CustomException("400", field + "不能为空且不能超过" + maxLength + "个字符");
        }
        return value.trim();
    }

    private void validateState(Integer state) {
        if (state == null || (state != STATE_PENDING && state != STATE_APPROVED && state != STATE_REJECTED)) {
            throw new CustomException("400", "审核状态无效");
        }
    }

    private boolean volunteerRoleSyncEnabled() {
        if (Long.valueOf(0L).equals(autoGrantRoleId)) {
            return false;
        }
        if (!Long.valueOf(VOLUNTEER_ROLE_ID).equals(autoGrantRoleId)) {
            throw new CustomException("500", "义工角色配置不安全，只允许 0 或角色ID 4");
        }
        return true;
    }
}
