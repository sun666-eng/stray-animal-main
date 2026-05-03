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

import javax.annotation.Resource;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

@Service
public class UserService extends ServiceImpl<UserMapper, User> {

    private static final BCryptPasswordEncoder ENCODER = new BCryptPasswordEncoder();

    @Resource
    private UserMapper userMapper;

    @Resource
    private RoleService roleService;

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
        if (!one.getPassword().startsWith("$2a$")) {
            one.setPassword(ENCODER.encode(one.getPassword()));
            updateById(one);
        }
        setPermission(one);
        return one;
    }

    public User register(User user) {
        User one = getOne((Wrappers.<User>lambdaQuery().eq(User::getUsername, user.getUsername())));
        if (one != null) {
            throw new CustomException("-1", "用户已注册");
        }
        if (user.getPassword() == null) {
            user.setPassword("123456");
        }
        user.setPassword(ENCODER.encode(user.getPassword()));
        // 分配默认"普通用户"角色
        if (user.getRole() == null || user.getRole().isEmpty()) {
            Role defaultRole = roleService.getById(3L);
            if (defaultRole != null) {
                List<Role> roles = new ArrayList<>();
                roles.add(defaultRole);
                user.setRole(roles);
            }
        }
        save(user);
        User newUser = getOne((Wrappers.<User>lambdaQuery().eq(User::getUsername, user.getUsername())));
        setPermission(newUser);
        return newUser;
    }

    private User setPermission(User user) {
        List<?> roles = user.getRole();
        if (roles == null || roles.isEmpty()) {
            return user;
        }
        List<Permission> permissions = new ArrayList<>();
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
                permissions.addAll(fullRole.getPermission());
            }
        }
        user.setPermission(permissions);
        return user;
    }

    public User getbyUsername(String username) {
        User one = getOne((Wrappers.<User>lambdaQuery().eq(User::getUsername, username)));
        setPermission(one);
        return one;
    }

    @Override
    public boolean save(User user) {
        if (user.getPassword() != null && !user.getPassword().startsWith("$2a$")) {
            user.setPassword(ENCODER.encode(user.getPassword()));
        }
        return super.save(user);
    }
}
