package com.example.service;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.baomidou.mybatisplus.core.conditions.Wrapper;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.example.common.UsernamePolicy;
import com.example.common.RoleAssignmentPolicy;
import com.example.entity.Permission;
import com.example.entity.Role;
import com.example.entity.User;
import com.example.exception.CustomException;
import com.example.mapper.UserMapper;
import com.example.mapper.VolunteerMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import jakarta.annotation.Resource;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.nio.charset.StandardCharsets;
import java.io.Serializable;
import java.util.Collection;

@Service
public class UserService extends ServiceImpl<UserMapper, User> {

    private static final BCryptPasswordEncoder ENCODER = new BCryptPasswordEncoder();

    @Resource
    private UserMapper userMapper;

    @Resource
    private RoleService roleService;

    @Resource
    private PermissionService permissionService;

    @Resource
    private FileAssetService fileAssetService;

    @Resource
    private VolunteerMapper volunteerMapper;

    @Resource
    private com.example.common.AuthUserCache authUserCache;

    @Value("${app.volunteer.auto-grant-role-id:4}")
    private Long volunteerRoleId = RoleAssignmentPolicy.DERIVED_VOLUNTEER_ROLE_ID;

    /**
     * A2：是否允许明文密码登录并在成功后升级为 BCrypt。
     * 生产默认 false；dev 可 true 过渡旧库。
     */
    @Value("${app.password.allow-plaintext-login:false}")
    private boolean allowPlaintextLogin;

    public void setAllowPlaintextLogin(boolean allowPlaintextLogin) {
        this.allowPlaintextLogin = allowPlaintextLogin;
    }

    public User login(User user) {
        User one = getOne(Wrappers.<User>lambdaQuery().eq(User::getUsername, user.getUsername()));
        if (one == null) {
            throw new CustomException("401", "账号或密码错误");
        }
        String stored = one.getPassword();
        String raw = user.getPassword();
        requireBcryptLength(raw);
        boolean match = false;
        if (isBcrypt(stored)) {
            match = raw != null && ENCODER.matches(raw, stored);
        } else if (allowPlaintextLogin) {
            // A2：仅开关打开时允许明文 equals，且仅在登录成功后升级
            match = raw != null && raw.equals(stored);
            if (match) {
                User passwordPatch = new User();
                passwordPatch.setId(one.getId());
                passwordPatch.setPassword(ENCODER.encode(raw));
                // 密码迁移不回写用户的角色 JSON，避免触碰派生角色。
                super.updateById(passwordPatch);
                authUserCache.invalidate(one.getId());
            }
        } else {
            // 存储为明文但已关闭兼容：拒绝并提示需重置
            if (stored != null && !isBcrypt(stored)) {
                throw new CustomException("401", "账号或密码错误");
            }
        }
        if (!match) {
            throw new CustomException("401", "账号或密码错误");
        }
        fillPermissions(one);
        return one;
    }

    @Transactional
    public User register(User user) {
        if (user == null) {
            throw new CustomException("400", "注册信息不能为空");
        }
        UsernamePolicy.requireValid(user.getUsername());
        User one = getOne((Wrappers.<User>lambdaQuery().eq(User::getUsername, user.getUsername())));
        if (one != null) {
            throw new CustomException("-1", "用户已注册");
        }
        if (user.getPassword() == null || user.getPassword().trim().isEmpty()) {
            throw new CustomException("400", "密码不能为空");
        }
        requirePasswordPolicy(user.getPassword());
        user.setPassword(ENCODER.encode(user.getPassword()));
        // 注册角色只能由服务端决定，绝不信任公共注册请求中的 id/role/permission。
        user.setId(null);
        user.setPermission(null);
        // 注册时尚无用户 ID，不能安全绑定 FileAsset：忽略客户端 avatar，注册后自行上传
        user.setAvatar(null);
        Role defaultRole = roleService.getById(3L);
        if (defaultRole == null) {
            throw new CustomException("500", "普通用户角色未配置");
        }
        List<Role> roles = new ArrayList<>();
        roles.add(defaultRole);
        user.setRole(roles);
        save(user);
        User newUser = getOne((Wrappers.<User>lambdaQuery().eq(User::getUsername, user.getUsername())));
        fillPermissions(newUser);
        return newUser;
    }

    /**
     * 管理员新增用户：保存后同事务绑定头像（若有 flag）。
     */
    @Transactional
    public boolean createWithAvatar(User user, User actor) {
        if (user == null) {
            throw new CustomException("400", "用户信息不能为空");
        }
        String avatarFlag = user.getAvatar();
        // 先落库拿 ID；无 actor 或无 flag 时清空未绑定头像，避免悬挂 flag
        if (avatarFlag == null || avatarFlag.trim().isEmpty() || actor == null || actor.getId() == null) {
            user.setAvatar(null);
            if (!save(user)) {
                throw new CustomException("500", "用户保存失败");
            }
            return true;
        }
        user.setAvatar(null);
        if (!save(user)) {
            throw new CustomException("500", "用户保存失败");
        }
        fileAssetService.bindToBusiness(actor, avatarFlag.trim(), "avatar",
                "user", user.getId(), true);
        User avatarPatch = new User();
        avatarPatch.setId(user.getId());
        avatarPatch.setAvatar(avatarFlag.trim());
        if (!super.updateById(avatarPatch)) {
            throw new CustomException("500", "用户头像写入失败");
        }
        user.setAvatar(avatarFlag.trim());
        return true;
    }

    @Transactional
    public boolean deleteUser(Long id) {
        throw new CustomException("409", "用户业务历史需要保留，当前数据模型不支持安全删除");
    }

    @Override
    public boolean removeById(Serializable id) { throw userDeletionProhibited(); }

    @Override
    public boolean removeById(Serializable id, boolean useFill) { throw userDeletionProhibited(); }

    @Override
    public boolean removeById(User entity) { throw userDeletionProhibited(); }

    @Override
    public boolean removeByMap(Map<String, Object> columnMap) { throw userDeletionProhibited(); }

    @Override
    public boolean remove(Wrapper<User> queryWrapper) { throw userDeletionProhibited(); }

    @Override
    public boolean removeByIds(Collection<?> list) { throw userDeletionProhibited(); }

    @Override
    public boolean removeByIds(Collection<?> list, boolean useFill) { throw userDeletionProhibited(); }

    @Override
    public boolean removeBatchByIds(Collection<?> list) { throw userDeletionProhibited(); }

    @Override
    public boolean removeBatchByIds(Collection<?> list, boolean useFill) { throw userDeletionProhibited(); }

    @Override
    public boolean removeBatchByIds(Collection<?> list, int batchSize) { throw userDeletionProhibited(); }

    @Override
    public boolean removeBatchByIds(Collection<?> list, int batchSize, boolean useFill) {
        throw userDeletionProhibited();
    }

    private CustomException userDeletionProhibited() {
        return new CustomException("409", "用户业务历史需要保留，当前数据模型不支持安全删除");
    }

    /**
     * 从角色加载权限写入 user.permission（仅内存，不落库）。
     * 加固点：
     * 1) 角色 id 支持 Number/String；
     * 2) 仅接受仍存在于 t_permission 的权限 ID，陈旧 JSON 一律失效；
     * 3) 超级管理员(roleId=1) 始终授予权限表全部条目。
     */
    public User fillPermissions(User user) {
        if (user == null) {
            return null;
        }
        Map<Long, Permission> uniquePermissions = new LinkedHashMap<>();
        boolean superAdmin = false;
        List<?> roles = user.getRole();
        if (roles != null && !roles.isEmpty()) {
            for (Object item : roles) {
                Long roleId = extractRoleId(item);
                if (roleId == null) {
                    continue;
                }
                if (Long.valueOf(1L).equals(roleId)) {
                    superAdmin = true;
                }
                Role fullRole = roleService.getById(roleId);
                if (fullRole == null || fullRole.getPermission() == null) {
                    continue;
                }
                for (Object perm : fullRole.getPermission()) {
                    Permission resolved = resolvePermission(perm);
                    if (resolved != null && resolved.getId() != null) {
                        uniquePermissions.putIfAbsent(resolved.getId(), resolved);
                    }
                }
            }
        }
        // 超级管理员：始终拉全表权限，不依赖可能被 varchar 截断的角色 JSON
        if (superAdmin) {
            for (Permission p : permissionService.list()) {
                if (p != null && p.getId() != null) {
                    uniquePermissions.putIfAbsent(p.getId(), p);
                }
            }
        }
        // 若仍为空且角色 JSON 里只有 id=1 的摘要，再兜底一次
        if (uniquePermissions.isEmpty() && roles != null) {
            for (Object item : roles) {
                if (Long.valueOf(1L).equals(extractRoleId(item))) {
                    for (Permission p : permissionService.list()) {
                        if (p != null && p.getId() != null) {
                            uniquePermissions.putIfAbsent(p.getId(), p);
                        }
                    }
                    break;
                }
            }
        }
        // 按 name+path 去重，避免侧边栏重复菜单
        Map<String, Permission> dedupByNamePath = new LinkedHashMap<>();
        for (Permission p : uniquePermissions.values()) {
            if (p.getFlag() == null || p.getFlag().trim().isEmpty()) {
                continue;
            }
            String key = (p.getName() == null ? "" : p.getName()) + "|" + (p.getPath() == null ? "" : p.getPath());
            dedupByNamePath.putIfAbsent(key, p);
        }
        user.setPermission(new ArrayList<>(dedupByNamePath.values()));
        return user;
    }

    private Long extractRoleId(Object item) {
        if (item instanceof Role) {
            return ((Role) item).getId();
        }
        if (item instanceof Map) {
            return toLong(((Map<?, ?>) item).get("id"));
        }
        return null;
    }

    private Long toLong(Object idObj) {
        if (idObj instanceof Number) {
            return ((Number) idObj).longValue();
        }
        if (idObj instanceof String) {
            try {
                return Long.parseLong(((String) idObj).trim());
            } catch (NumberFormatException ignored) {
                return null;
            }
        }
        return null;
    }

    /**
     * 将角色内嵌权限解析为完整 Permission：优先按 id 查表，保证 flag 正确。
     */
    private Permission resolvePermission(Object perm) {
        if (perm instanceof Permission) {
            Permission p = (Permission) perm;
            return p.getId() == null ? null : permissionService.getById(p.getId());
        }
        if (perm instanceof Map) {
            Map<?, ?> m = (Map<?, ?>) perm;
            Long id = toLong(m.get("id"));
            return id == null ? null : permissionService.getById(id);
        }
        return null;
    }

    public User getbyUsername(String username) {
        User one = getOne((Wrappers.<User>lambdaQuery().eq(User::getUsername, username)));
        fillPermissions(one);
        return one;
    }

    @Override
    public boolean save(User user) {
        if (user == null) {
            throw new CustomException("400", "用户信息不能为空");
        }
        UsernamePolicy.requireValid(user.getUsername());
        if (user.getPassword() == null || user.getPassword().trim().isEmpty()) {
            throw new CustomException("400", "密码不能为空");
        }
        rejectDerivedRoleCreate(user.getRole());
        if (!isBcrypt(user.getPassword())) {
            requirePasswordPolicy(user.getPassword());
            user.setPassword(ENCODER.encode(user.getPassword()));
        }
        return super.save(user);
    }

    @Override
    public boolean updateById(User user) {
        if (user == null) {
            throw new CustomException("400", "用户信息不能为空");
        }
        if (user.getUsername() != null) {
            UsernamePolicy.requireValid(user.getUsername());
        }
        if (user.getRole() != null) {
            throw new CustomException("400", "通用用户更新不能直接写角色，请使用受保护的角色分配流程");
        }
        if (user.getPassword() != null) {
            if (user.getPassword().trim().isEmpty()) {
                user.setPassword(null);
            } else if (!isBcrypt(user.getPassword())) {
                requirePasswordPolicy(user.getPassword());
                user.setPassword(ENCODER.encode(user.getPassword()));
            }
        }
        boolean updated = super.updateById(user);
        if (updated) {
            authUserCache.invalidate(user.getId());
        }
        return updated;
    }

    /**
     * 更新用户资料并在同一事务内处理头像三态：
     * avatar==null 不改图；"" 清图解绑；非空且变更则绑新解旧。
     */
    @Transactional
    public boolean updateWithAvatarBind(User user, User actor, String previousAvatar,
                                        Long targetId, boolean allowAdmin) {
        if (user == null || targetId == null) {
            throw new CustomException("400", "用户信息或用户 ID 无效");
        }
        User locked = getOne(Wrappers.<User>lambdaQuery()
                .eq(User::getId, targetId).last("FOR UPDATE"));
        if (locked == null) {
            throw new CustomException("404", "用户不存在");
        }
        assertCanModifyTarget(actor, locked);
        if (user.getPassword() != null && !user.getPassword().trim().isEmpty()) {
            throw new CustomException("400", "通用用户接口不支持修改密码");
        }
        if (com.example.common.RoleAssignmentPolicy.hasRoleId(locked,
                com.example.common.RoleAssignmentPolicy.SUPER_ADMIN_ROLE_ID)
                && user.getRole() != null
                && !com.example.common.RoleAssignmentPolicy.extractRoleIds(user.getRole())
                .equals(com.example.common.RoleAssignmentPolicy.extractRoleIds(locked.getRole()))) {
            throw new CustomException("403", "超级管理员角色不可通过通用用户接口修改");
        }
        if (!allowAdmin) {
            // 非管理写路径：禁止改登录名与角色，身份以锁内行为准
            user.setUsername(null);
            user.setRole(null);
            user.setPermission(null);
            user.setPassword(null);
        } else if (user.getUsername() != null) {
            UsernamePolicy.requireValid(user.getUsername());
            if (!user.getUsername().equals(locked.getUsername())) {
                User clash = getOne(Wrappers.<User>lambdaQuery()
                        .eq(User::getUsername, user.getUsername())
                        .ne(User::getId, targetId)
                        .last("LIMIT 1"));
                if (clash != null) {
                    throw new CustomException("400", "用户名已被占用");
                }
            }
        }
        user.setId(targetId);
        user.setRole(resolveRolesForLockedUser(user.getRole(), locked));
        // 始终以锁内最新头像为准，禁止锁外 previousAvatar 覆盖并发结果。
        String previous = locked.getAvatar();
        String newAvatar = user.getAvatar();
        if (newAvatar != null) {
            String next = newAvatar.trim();
            String prev = previous == null ? "" : previous.trim();
            if (!next.isEmpty() && !next.equals(prev)) {
                fileAssetService.bindToBusiness(actor, next, "avatar", "user", targetId, allowAdmin);
            }
        }
        if (!super.updateById(user)) {
            throw new CustomException("409", "用户资料更新失败，请刷新后重试");
        }
        // 资料/角色变更后失效鉴权缓存（事务提交后生效）
        authUserCache.invalidate(targetId);
        if (newAvatar != null) {
            String next = newAvatar.trim();
            String prev = previous == null ? "" : previous.trim();
            if (next.isEmpty()) {
                if (!prev.isEmpty()) {
                    fileAssetService.unbindIfMatches(prev, "user", targetId);
                }
            } else if (!next.equals(prev) && !prev.isEmpty()) {
                fileAssetService.unbindIfMatches(prev, "user", targetId);
            }
        }
        return true;
    }

    public User requireRealSuperAdmin(User actor) {
        if (actor == null || actor.getId() == null) {
            throw new CustomException("401", "未登录或登录已过期");
        }
        User fresh = getById(actor.getId());
        if (fresh == null) {
            throw new CustomException("401", "未登录或登录已过期");
        }
        if (!com.example.common.RoleAssignmentPolicy.hasRoleId(fresh,
                com.example.common.RoleAssignmentPolicy.SUPER_ADMIN_ROLE_ID)) {
            throw new CustomException("403", "仅超级管理员可执行该操作");
        }
        return fresh;
    }

    public void assertCanModifyTarget(User actor, User target) {
        if (target != null && com.example.common.RoleAssignmentPolicy.hasRoleId(target,
                com.example.common.RoleAssignmentPolicy.SUPER_ADMIN_ROLE_ID)) {
            requireRealSuperAdmin(actor);
        }
    }

    /**
     * 确保用户角色列表包含指定角色（按 id 去重追加）。
     * <p>
     * 角色 4「认证义工」是轻量徽章、权限为空。授予时必须保留/补回角色 3「普通用户」，
     * 否则用户仅剩 role=4 时 permission 为空，登录后所有自助 API 被拦截（无可用功能）。
     * 已有角色 1/2 的后台人员不强制补 role3。
     */
    @Transactional
    public void ensureHasRole(Long userId, Long roleId) {
        requireVolunteerRoleId(roleId);
        User user = lockVolunteerRoleUser(userId);
        Role target = roleService.getById(roleId);
        if (target == null) {
            throw new CustomException("500", "认证义工角色未配置");
        }
        List<Role> roles = user.getRole();
        if (roles == null) {
            roles = new ArrayList<>();
        } else {
            roles = new ArrayList<>(roles);
        }
        boolean hasRole4 = false;
        boolean hasRole3 = false;
        boolean hasStaffRole = false;
        for (Object item : roles) {
            Long existingId = extractRoleId(item);
            if (roleId.equals(existingId)) {
                hasRole4 = true;
            }
            if (Long.valueOf(3L).equals(existingId)) {
                hasRole3 = true;
            }
            if (Long.valueOf(1L).equals(existingId) || Long.valueOf(2L).equals(existingId)) {
                hasStaffRole = true;
            }
        }
        boolean changed = false;
        if (!hasRole4) {
            Role slim = new Role();
            slim.setId(target.getId());
            slim.setName(target.getName());
            slim.setDescription(target.getDescription());
            roles.add(slim);
            changed = true;
        }
        // 徽章不能替代普通用户闭环：无后台角色时始终持有 role3
        if (!hasRole3 && !hasStaffRole) {
            Role ordinary = roleService.getById(3L);
            if (ordinary == null) {
                throw new CustomException("500", "普通用户角色未配置");
            }
            Role slim3 = new Role();
            slim3.setId(ordinary.getId());
            slim3.setName(ordinary.getName());
            slim3.setDescription(ordinary.getDescription());
            // 角色 3 放在前面，便于展示与契约阅读
            roles.add(0, slim3);
            changed = true;
        }
        if (changed) {
            updateRolePatch(userId, roles);
        }
    }

    /**
     * Remove role 4 only after locking the latest user row and confirming no
     * approved volunteer application remains for that user.
     */
    @Transactional
    public void removeRoleIfNoApprovedVolunteer(Long userId, Long roleId) {
        requireVolunteerRoleId(roleId);
        if (userId == null) {
            return;
        }
        User user = getOne(Wrappers.<User>lambdaQuery()
                .eq(User::getId, userId).last("FOR UPDATE"));
        if (user == null) {
            return;
        }
        List<com.example.entity.Volunteer> approved = volunteerMapper.selectList(
                Wrappers.<com.example.entity.Volunteer>lambdaQuery()
                .eq(com.example.entity.Volunteer::getUid, userId)
                .eq(com.example.entity.Volunteer::getVstate, VolunteerService.STATE_APPROVED)
                .last("FOR UPDATE"));
        if (approved != null && !approved.isEmpty()) {
            return;
        }
        List<Role> roles = user.getRole();
        if (roles == null || roles.isEmpty()) {
            return;
        }
        List<Role> retained = new ArrayList<>();
        boolean removed = false;
        for (Object item : roles) {
            if (roleId.equals(extractRoleId(item))) {
                removed = true;
            } else if (item instanceof Role) {
                retained.add((Role) item);
            }
        }
        if (removed) {
            updateRolePatch(userId, retained);
        }
    }

    private void requireVolunteerRoleId(Long roleId) {
        if (!Long.valueOf(RoleAssignmentPolicy.DERIVED_VOLUNTEER_ROLE_ID).equals(roleId)) {
            throw new CustomException("500", "义工角色配置不安全，必须为角色ID 4");
        }
    }

    /**
     * Rebuild role 4 while the target user row is locked. Client role lists can
     * control only non-derived roles; configuration 0 disables all derivation.
     */
    private List<Role> resolveRolesForLockedUser(List<Role> requested, User locked) {
        validateVolunteerRoleConfig();
        if (requested != null && com.example.common.RoleAssignmentPolicy.hasRoleId(
                userWithRoles(requested), RoleAssignmentPolicy.DERIVED_VOLUNTEER_ROLE_ID)) {
            throw new CustomException("400", "认证义工角色由审核结果派生，不能通过用户接口分配或移除");
        }

        List<Role> source = requested == null ? locked.getRole() : requested;
        List<Role> resolved = withoutVolunteerRole(source);
        if (Long.valueOf(0L).equals(volunteerRoleId)) {
            Role existingDerivedRole = findVolunteerRole(locked.getRole());
            if (existingDerivedRole != null) {
                resolved.add(existingDerivedRole);
            }
            return resolved;
        }

        List<com.example.entity.Volunteer> approved = volunteerMapper.selectList(
                Wrappers.<com.example.entity.Volunteer>lambdaQuery()
                        .eq(com.example.entity.Volunteer::getUid, locked.getId())
                        .eq(com.example.entity.Volunteer::getVstate, VolunteerService.STATE_APPROVED)
                        .last("FOR UPDATE"));
        if (approved != null && !approved.isEmpty()) {
            resolved.add(slimVolunteerRole());
        }
        return resolved;
    }

    private void validateVolunteerRoleConfig() {
        if (!Long.valueOf(0L).equals(volunteerRoleId)
                && !Long.valueOf(RoleAssignmentPolicy.DERIVED_VOLUNTEER_ROLE_ID).equals(volunteerRoleId)) {
            throw new CustomException("500", "义工角色配置不安全，只允许 0 或角色ID 4");
        }
    }

    private List<Role> withoutVolunteerRole(List<?> roles) {
        List<Role> retained = new ArrayList<>();
        if (roles == null) {
            return retained;
        }
        for (Object item : roles) {
            if (!Long.valueOf(RoleAssignmentPolicy.DERIVED_VOLUNTEER_ROLE_ID).equals(extractRoleId(item))
                    && item instanceof Role) {
                retained.add((Role) item);
            }
        }
        return retained;
    }

    private Role slimVolunteerRole() {
        Role role = roleService.getById(RoleAssignmentPolicy.DERIVED_VOLUNTEER_ROLE_ID);
        if (role == null) {
            throw new CustomException("500", "认证义工角色未配置");
        }
        Role slim = new Role();
        slim.setId(role.getId());
        slim.setName(role.getName());
        slim.setDescription(role.getDescription());
        return slim;
    }

    private Role findVolunteerRole(List<?> roles) {
        if (roles == null) {
            return null;
        }
        for (Object item : roles) {
            if (item instanceof Role && Long.valueOf(RoleAssignmentPolicy.DERIVED_VOLUNTEER_ROLE_ID)
                    .equals(((Role) item).getId())) {
                return (Role) item;
            }
        }
        return null;
    }

    private User userWithRoles(List<Role> roles) {
        User user = new User();
        user.setRole(roles);
        return user;
    }

    private void rejectDerivedRoleCreate(List<?> roles) {
        if (roles != null && RoleAssignmentPolicy.extractRoleIds(roles)
                .contains(RoleAssignmentPolicy.DERIVED_VOLUNTEER_ROLE_ID)) {
            throw new CustomException("400", "认证义工角色由审核结果派生，不能通过通用用户创建接口分配");
        }
    }

    @Transactional
    public User lockVolunteerRoleUser(Long userId) {
        if (userId == null) {
            throw new CustomException("400", "义工申请用户无效");
        }
        User user = getOne(Wrappers.<User>lambdaQuery()
                .eq(User::getId, userId).last("FOR UPDATE"));
        if (user == null) {
            throw new CustomException("404", "义工申请用户不存在");
        }
        return user;
    }

    private void updateRolePatch(Long userId, List<Role> roles) {
        User patch = new User();
        patch.setId(userId);
        patch.setRole(roles);
        if (!super.updateById(patch)) {
            throw new CustomException("409", "用户角色已变化，请刷新后重试");
        }
        // 角色变更直接改变有效权限，须失效鉴权缓存（事务提交后生效）
        authUserCache.invalidate(userId);
    }

    private boolean isBcrypt(String password) {
        return password != null
                && (password.startsWith("$2a$")
                || password.startsWith("$2b$")
                || password.startsWith("$2y$"));
    }

    private void requireBcryptLength(String password) {
        if (password != null && password.getBytes(StandardCharsets.UTF_8).length > 72) {
            throw new CustomException("400", "密码 UTF-8 长度不能超过72字节");
        }
    }

    /** 设置/修改密码时的强度下限；登录路径不调用，避免锁死历史短密码账号。 */
    private void requirePasswordPolicy(String rawPassword) {
        requireBcryptLength(rawPassword);
        if (rawPassword != null && rawPassword.length() < 8) {
            throw new CustomException("400", "密码长度不能少于8位");
        }
    }
}
