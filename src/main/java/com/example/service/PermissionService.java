package com.example.service;

import cn.hutool.core.bean.BeanUtil;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.example.entity.Permission;
import com.example.entity.Role;
import com.example.mapper.PermissionMapper;
import org.springframework.stereotype.Service;

import javax.annotation.Resource;
import java.util.ArrayList;
import java.util.List;

@Service
public class PermissionService extends ServiceImpl<PermissionMapper, Permission> {

    @Resource
    private PermissionMapper permissionMapper;

    @Resource
    private RoleService roleService;

    public List<Permission> getByRoles(List<Role> roles) {
        List<Permission> permissions = new ArrayList<>();
        for (Role role : roles) {
            Role r = roleService.getById(role.getId());
            permissions.addAll(r.getPermission());
        }
        return permissions;
    }

    public void delete(Long id) {
        Permission delPermission = getById(id);
        removeById(id);
        // 删除角色分配的菜单
        List<Role> list = roleService.list();
        for (Role role : list) {
            List<?> permission = role.getPermission();
            if (permission == null || permission.isEmpty()) {
                continue;
            }
            // 重新分配权限：移除已删除的权限，类型安全地处理 Permission 和 Map 两种反序列化结果
            List<Permission> newP = new ArrayList<>();
            for (Object p : permission) {
                String flag = extractFlag(p);
                if (flag != null && !flag.equals(delPermission.getFlag())) {
                    newP.add(toPermission(p));
                }
            }
            role.setPermission(newP);
            roleService.updateById(role);
        }
    }

    /**
     * 从 Permission 对象或 Map（JacksonTypeHandler 反序列化产物）中安全提取 flag
     */
    private String extractFlag(Object p) {
        if (p instanceof Permission) {
            return ((Permission) p).getFlag();
        }
        if (p instanceof java.util.Map) {
            Object f = ((java.util.Map<?, ?>) p).get("flag");
            return f instanceof String ? (String) f : null;
        }
        return null;
    }

    /**
     * 将 Permission 对象或 Map 统一转换为 Permission 实体
     */
    private Permission toPermission(Object p) {
        if (p instanceof Permission) {
            return (Permission) p;
        }
        if (p instanceof java.util.Map) {
            Permission p1 = new Permission();
            BeanUtil.copyProperties(p, p1);
            return p1;
        }
        return new Permission();
    }
}
