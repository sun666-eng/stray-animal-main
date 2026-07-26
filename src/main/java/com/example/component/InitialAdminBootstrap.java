package com.example.component;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.example.entity.Role;
import com.example.entity.User;
import com.example.service.RoleService;
import com.example.service.UserService;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.annotation.Order;
import org.springframework.core.env.Environment;
import org.springframework.core.env.Profiles;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * A0.2：生产/受控环境通过环境变量创建首个超级管理员；不向日志打印明文密码。
 * <p>
 * INITIAL_ADMIN_USERNAME / INITIAL_ADMIN_PASSWORD
 * 仅当库中尚任何用户且启用 bootstrap 时创建。
 * 生产若无用户且未配置 env → fail-fast。
 */
@Slf4j
@Component
@Order(50)
public class InitialAdminBootstrap implements ApplicationRunner {

    private static final Set<String> KNOWN_WEAK = new HashSet<>(Arrays.asList(
            "admin", "123456", "password", "admin123", "root"
    ));

    private final UserService userService;
    private final RoleService roleService;
    private final Environment environment;

    @Value("${app.bootstrap.initial-admin-enabled:false}")
    private boolean enabled;

    @Value("${app.bootstrap.initial-admin-username:}")
    private String username;

    @Value("${app.bootstrap.initial-admin-password:}")
    private String password;

    public InitialAdminBootstrap(UserService userService, RoleService roleService, Environment environment) {
        this.userService = userService;
        this.roleService = roleService;
        this.environment = environment;
    }

    @Override
    public void run(ApplicationArguments args) {
        long userCount = userService.count();
        boolean prod = environment.acceptsProfiles(Profiles.of("prod"));

        if (userCount == 0) {
            if (!enabled) {
                if (prod) {
                    throw new IllegalStateException(
                            "生产库无用户且未启用首个管理员引导。请设置 INITIAL_ADMIN_ENABLED=true 与 "
                                    + "INITIAL_ADMIN_USERNAME / INITIAL_ADMIN_PASSWORD 后重启。");
                }
                log.warn("库中无用户；非生产环境跳过 InitialAdminBootstrap（可配置 INITIAL_ADMIN_*）");
                return;
            }
            if (username == null || username.trim().isEmpty()
                    || password == null || password.trim().isEmpty()) {
                throw new IllegalStateException(
                        "已启用首个管理员引导，但 INITIAL_ADMIN_USERNAME 或 INITIAL_ADMIN_PASSWORD 为空");
            }
            if (KNOWN_WEAK.contains(password.trim().toLowerCase()) || password.trim().length() < 10) {
                throw new IllegalStateException("初始管理员密码过弱（长度至少 10，且不能为常见弱口令）");
            }
            Role superAdmin = roleService.getById(1L);
            if (superAdmin == null) {
                throw new IllegalStateException("角色 id=1 超级管理员不存在，无法引导创建管理员");
            }
            User admin = new User();
            admin.setUsername(username.trim());
            admin.setPassword(password);
            List<Role> roles = new ArrayList<>();
            Role slim = new Role();
            slim.setId(1L);
            slim.setName(superAdmin.getName());
            roles.add(slim);
            admin.setRole(roles);
            userService.save(admin);
            log.info("已创建首个管理员用户 username={}（密码不记入日志，请轮换 INITIAL_ADMIN_PASSWORD）",
                    username.trim());
            return;
        }

        if (prod) {
            // 弱用户名探测（不验证明文密码）
            User adminNamed = userService.getOne(
                    Wrappers.<User>lambdaQuery().eq(User::getUsername, "admin"), false);
            if (adminNamed != null) {
                String hash = adminNamed.getPassword();
                // 无法可靠从 BCrypt 反推弱密；提示运维检查
                log.warn("生产环境存在 username=admin 的账号，请确认已非默认弱口令（A0.2）");
                if (hash != null && !hash.startsWith("$2")) {
                    throw new IllegalStateException(
                            "生产环境 admin 账号密码非 BCrypt，禁止启动。请立即改密或重建管理员。");
                }
            }
        }
    }
}
