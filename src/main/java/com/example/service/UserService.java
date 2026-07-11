package com.example.service;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.example.entity.Permission;
import com.example.entity.Role;
import com.example.entity.User;
import com.example.exception.CustomException;
import com.example.mapper.UserMapper;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import javax.annotation.Resource;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Service
public class UserService extends ServiceImpl<UserMapper, User> {

    private static final BCryptPasswordEncoder ENCODER = new BCryptPasswordEncoder();

    @Resource
    private UserMapper userMapper;

    @Resource
    private RoleService roleService;

    @Resource
    private PermissionService permissionService;

    public User login(User user) {
        User one = getOne(Wrappers.<User>lambdaQuery().eq(User::getUsername, user.getUsername()));
        if (one == null) {
            throw new CustomException("-1", "账号或密码错误");
        }
        // BCrypt + 明文兼容：先尝试验证 BCrypt，再回退明文
        boolean match = ENCODER.matches(user.getPassword(), one.getPassword());
        if (!match && !user.getPassword().equals(one.getPassword())) {
            throw new CustomException("-1", "账号或密码错误");
        }
        // 明文密码自动升级为 BCrypt
        if (!isBcrypt(one.getPassword())) {
            one.setPassword(ENCODER.encode(one.getPassword()));
            updateById(one);
        }
        fillPermissions(one);
        return one;
    }

    @Transactional
    public User register(User user) {
        User one = getOne((Wrappers.<User>lambdaQuery().eq(User::getUsername, user.getUsername())));
        if (one != null) {
            throw new CustomException("-1", "用户已注册");
        }
        if (user.getPassword() == null) {
            user.setPassword("123456");
        }
        user.setPassword(ENCODER.encode(user.getPassword()));
        // 注册角色只能由服务端决定，绝不信任公共注册请求中的 id/role/permission。
        user.setId(null);
        user.setPermission(null);
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

    public User fillPermissions(User user) {
        if (user == null) {
            return null;
        }
        // 按权限 ID 去重，避免多角色合并时同一权限重复出现（例如"救助管理"在超级管理员与志愿者角色中都存在）
        Map<Long, Permission> uniquePermissions = new LinkedHashMap<>();
        List<?> roles = user.getRole();
        if (roles != null && !roles.isEmpty()) {
            for (Object item : roles) {
                Long roleId;
                if (item instanceof Role) {
                    roleId = ((Role) item).getId();
                } else if (item instanceof Map) {
                    roleId = ((Number) ((Map<?, ?>) item).get("id")).longValue();
                } else {
                    continue;
                }
                if (roleId == null) continue;
                Role fullRole = roleService.getById(roleId);
                if (fullRole != null && fullRole.getPermission() != null) {
                    for (Object perm : fullRole.getPermission()) {
                        Permission p = null;
                        if (perm instanceof Permission) {
                            p = (Permission) perm;
                        } else if (perm instanceof Map) {
                            Map<?, ?> m = (Map<?, ?>) perm;
                            p = new Permission();
                            Object idObj = m.get("id");
                            if (idObj instanceof Number) {
                                p.setId(((Number) idObj).longValue());
                            }
                            p.setName((String) m.get("name"));
                            p.setFlag((String) m.get("flag"));
                            p.setPath((String) m.get("path"));
                            p.setDescription((String) m.get("description"));
                        }
                        if (p != null && p.getId() != null) {
                            uniquePermissions.putIfAbsent(p.getId(), p);
                        }
                    }
                }
                if (uniquePermissions.isEmpty() && Long.valueOf(1L).equals(roleId)) {
                    for (Permission p : permissionService.list()) {
                        if (p.getId() != null) {
                            uniquePermissions.putIfAbsent(p.getId(), p);
                        }
                    }
                }
            }
        }
        // 兜底：再按 (name + path) 维度去重，防止历史脏数据（例如 flag=help 与遗留 flag=rescue 同名"救助管理"指向同一页面）在侧边栏渲染出多个相同按钮
        Map<String, Permission> dedupByNamePath = new LinkedHashMap<>();
        for (Permission p : uniquePermissions.values()) {
            String key = (p.getName() == null ? "" : p.getName()) + "|" + (p.getPath() == null ? "" : p.getPath());
            dedupByNamePath.putIfAbsent(key, p);
        }
        user.setPermission(new ArrayList<>(dedupByNamePath.values()));
        return user;
    }

    public User getbyUsername(String username) {
        User one = getOne((Wrappers.<User>lambdaQuery().eq(User::getUsername, username)));
        fillPermissions(one);
        return one;
    }

    @Override
    public boolean save(User user) {
        if (user.getPassword() != null && !isBcrypt(user.getPassword())) {
            user.setPassword(ENCODER.encode(user.getPassword()));
        }
        return super.save(user);
    }

    @Override
    public boolean updateById(User user) {
        if (user.getPassword() != null) {
            if (user.getPassword().trim().isEmpty()) {
                user.setPassword(null);
            } else if (!isBcrypt(user.getPassword())) {
                user.setPassword(ENCODER.encode(user.getPassword()));
            }
        }
        return super.updateById(user);
    }

    /**
     * 确保用户角色列表包含指定角色（按 id 去重追加）。
     */
    @Transactional
    public void ensureHasRole(Long userId, Long roleId) {
        if (userId == null || roleId == null) {
            return;
        }
        User user = getById(userId);
        if (user == null) {
            return;
        }
        Role target = roleService.getById(roleId);
        if (target == null) {
            return;
        }
        List<Role> roles = user.getRole();
        if (roles == null) {
            roles = new ArrayList<>();
        } else {
            roles = new ArrayList<>(roles);
        }
        for (Object item : roles) {
            Long existingId = null;
            if (item instanceof Role) {
                existingId = ((Role) item).getId();
            } else if (item instanceof Map) {
                Object idObj = ((Map<?, ?>) item).get("id");
                if (idObj instanceof Number) {
                    existingId = ((Number) idObj).longValue();
                }
            }
            if (roleId.equals(existingId)) {
                return;
            }
        }
        Role slim = new Role();
        slim.setId(target.getId());
        slim.setName(target.getName());
        slim.setDescription(target.getDescription());
        roles.add(slim);
        user.setRole(roles);
        super.updateById(user);
    }

    private boolean isBcrypt(String password) {
        return password != null
                && (password.startsWith("$2a$")
                || password.startsWith("$2b$")
                || password.startsWith("$2y$"));
    }
}
