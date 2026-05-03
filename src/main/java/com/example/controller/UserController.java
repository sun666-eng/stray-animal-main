package com.example.controller;

import cn.hutool.core.collection.CollUtil;
import cn.hutool.poi.excel.ExcelUtil;
import cn.hutool.poi.excel.ExcelWriter;
import com.baomidou.mybatisplus.core.metadata.IPage;
import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.example.common.AuditLog;
import com.example.common.JwtUtil;
import com.example.common.Result;
import com.example.dto.LoginVO;
import com.example.dto.UserDTO;
import com.example.entity.User;
import com.example.service.UserService;
import org.springframework.web.bind.annotation.*;

import javax.annotation.Resource;
import javax.servlet.ServletOutputStream;
import javax.validation.Valid;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.net.URLEncoder;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.stream.Collectors;

@RestController
@RequestMapping("/api/user")
public class UserController {
    public static final ConcurrentHashMap<String, User> MAP = new ConcurrentHashMap<>();

    @Resource
    private UserService userService;

    @AuditLog(module = "用户管理", action = "用户登录")
    @PostMapping("/login")
    public Result<LoginVO> login(@Valid @RequestBody User user, HttpServletRequest request) {
        User res = userService.login(user);
        if (res == null) {
            return Result.error("500", "用户名或密码错误");
        }
        String token = JwtUtil.createToken(res.getId(), res.getUsername());
        request.getSession().setAttribute("user", res);
        MAP.put(res.getUsername(), res);
        return Result.success(new LoginVO(token, UserDTO.from(res)));
    }

    @AuditLog(module = "用户管理", action = "用户注册")
    @PostMapping("/register")
    public Result<LoginVO> register(@Valid @RequestBody User user, HttpServletRequest request) {
        if (user.getPassword() == null) {
            user.setPassword("123456");
        }
        User dbUser = userService.register(user);
        String token = JwtUtil.createToken(dbUser.getId(), dbUser.getUsername());
        request.getSession().setAttribute("user", dbUser);
        MAP.put(dbUser.getUsername(), dbUser);
        return Result.success(new LoginVO(token, UserDTO.from(dbUser)));
    }

    @AuditLog(module = "用户管理", action = "用户登出")
    @GetMapping("/logout")
    public Result<?> logout(HttpServletRequest request) {
        User user = (User) request.getSession().getAttribute("user");
        if (user != null) {
            request.getSession().removeAttribute("user");
            MAP.remove(user.getUsername());
        }
        return Result.success();
    }

    @GetMapping("/online")
    public Result<Collection<UserDTO>> online() {
        return Result.success(MAP.values().stream().map(UserDTO::from).collect(Collectors.toList()));
    }

    @AuditLog(module = "用户管理", action = "新增用户")
    @PostMapping
    public Result<?> save(@Valid @RequestBody User user) {
        if (user.getPassword() == null) {
            user.setPassword("123456");
        }
        return Result.success(userService.save(user));
    }

    @AuditLog(module = "用户管理", action = "更新用户")
    @PutMapping
    public Result<?> update(@RequestBody User user) {
        return Result.success(userService.updateById(user));
    }

    @AuditLog(module = "用户管理", action = "删除用户")
    @DeleteMapping("/{id}")
    public Result<?> delete(@PathVariable Long id) {
        userService.removeById(id);
        return Result.success();
    }

    @GetMapping("/{id}")
    public Result<UserDTO> findById(@PathVariable Long id) {
        return Result.success(UserDTO.from(userService.getById(id)));
    }

    @GetMapping("/detail/{username}")
    public Result<UserDTO> findByUsername(@PathVariable String username) {
        return Result.success(UserDTO.from(userService.getbyUsername(username)));
    }

    @GetMapping
    public Result<List<UserDTO>> findAll() {
        return Result.success(userService.list().stream().map(UserDTO::from).collect(Collectors.toList()));
    }

    @GetMapping("/page")
    public Result<IPage<UserDTO>> findPage(@RequestParam(required = false, defaultValue = "") String name,
                                        @RequestParam(required = false, defaultValue = "1") Integer pageNum,
                                        @RequestParam(required = false, defaultValue = "10") Integer pageSize) {
        IPage<User> page = userService.page(new Page<>(pageNum, pageSize),
                Wrappers.<User>lambdaQuery().like(User::getUsername, name).orderByDesc(User::getId));
        IPage<UserDTO> dtoPage = page.convert(UserDTO::from);
        return Result.success(dtoPage);
    }

    @GetMapping("/export")
    public void export(HttpServletResponse response) throws IOException {

        List<Map<String, Object>> list = CollUtil.newArrayList();

        List<User> all = userService.list();
        for (User user : all) {
            Map<String, Object> row1 = new LinkedHashMap<>();
            row1.put("名称", user.getUsername());
            row1.put("手机", user.getPhone());
            row1.put("邮箱", user.getEmail());
            list.add(row1);
        }

        // 2. 写excel
        ExcelWriter writer = ExcelUtil.getWriter(true);
        writer.write(list, true);

        response.setContentType("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;charset=utf-8");
        String fileName = URLEncoder.encode("用户信息", "UTF-8");
        response.setHeader("Content-Disposition", "attachment;filename=" + fileName + ".xlsx");

        ServletOutputStream out = response.getOutputStream();
        writer.flush(out, true);
        writer.close();
    }

}
