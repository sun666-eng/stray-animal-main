package com.example.dto;

import com.example.entity.Permission;
import com.example.entity.Role;
import com.example.entity.User;

import java.util.List;

public class UserDTO {

    private Long id;
    private String username;
    private String email;
    private String phone;
    private String avatar;
    private List<Role> role;
    private List<Permission> permission;

    public static UserDTO from(User user) {
        if (user == null) return null;
        UserDTO dto = new UserDTO();
        dto.setId(user.getId());
        dto.setUsername(user.getUsername());
        dto.setEmail(user.getEmail());
        dto.setPhone(user.getPhone());
        dto.setAvatar(user.getAvatar());
        dto.setRole(user.getRole());
        dto.setPermission(user.getPermission());
        return dto;
    }

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public String getUsername() { return username; }
    public void setUsername(String username) { this.username = username; }
    public String getEmail() { return email; }
    public void setEmail(String email) { this.email = email; }
    public String getPhone() { return phone; }
    public void setPhone(String phone) { this.phone = phone; }
    public String getAvatar() { return avatar; }
    public void setAvatar(String avatar) { this.avatar = avatar; }
    public List<Role> getRole() { return role; }
    public void setRole(List<Role> role) { this.role = role; }
    public List<Permission> getPermission() { return permission; }
    public void setPermission(List<Permission> permission) { this.permission = permission; }
}
