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

    /**
     * 从角色加载权限写入 user.permission（仅内存，不落库）。
     * 加固点：
     * 1) 角色 id 支持 Number/String；
     * 2) 优先用 t_permission 全量行补齐 flag/path（避免角色 JSON 截断/缺字段）；
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
            if (p.getId() != null) {
                Permission db = permissionService.getById(p.getId());
                if (db != null) {
                    return db;
                }
            }
            return (p.getFlag() != null && !p.getFlag().trim().isEmpty()) ? p : null;
        }
        if (perm instanceof Map) {
            Map<?, ?> m = (Map<?, ?>) perm;
            Long id = toLong(m.get("id"));
            if (id != null) {
                Permission db = permissionService.getById(id);
                if (db != null) {
                    return db;
                }
            }
            Permission p = new Permission();
            p.setId(id);
            p.setName(m.get("name") == null ? null : String.valueOf(m.get("name")));
            p.setFlag(m.get("flag") == null ? null : String.valueOf(m.get("flag")));
            p.setPath(m.get("path") == null ? null : String.valueOf(m.get("path")));
            p.setDescription(m.get("description") == null ? null : String.valueOf(m.get("description")));
            if (p.getFlag() == null || p.getFlag().trim().isEmpty()) {
                return null;
            }
            return p;
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
