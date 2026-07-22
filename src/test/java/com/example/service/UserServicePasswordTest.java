package com.example.service;

import com.example.entity.User;
import com.example.entity.Role;
import com.example.mapper.UserMapper;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;

import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
public class UserServicePasswordTest {

    @Mock
    UserMapper userMapper;

    @Mock
    RoleService roleService;

    @Mock
    PermissionService permissionService;

    @InjectMocks
    UserService userService;

    @Test
    public void updateById_encodesPlainPassword() {
        when(userMapper.updateById(any(User.class))).thenReturn(1);
        User user = new User();
        user.setId(1L);
        user.setPassword("new-password");

        userService.updateById(user);

        ArgumentCaptor<User> captor = ArgumentCaptor.forClass(User.class);
        verify(userMapper).updateById(captor.capture());
        String encoded = captor.getValue().getPassword();
        assertTrue(encoded.startsWith("$2"));
        assertTrue(new BCryptPasswordEncoder().matches("new-password", encoded));
    }

    @Test
    public void register_ignoresInjectedIdentityAndRole() {
        Role administrator = new Role();
        administrator.setId(1L);
        Role normalUser = new Role();
        normalUser.setId(3L);

        when(userMapper.selectOne(any(), anyBoolean())).thenReturn(null).thenAnswer(invocation -> {
            User stored = new User();
            stored.setId(20L);
            stored.setUsername("new-user");
            stored.setPassword("encoded");
            stored.setRole(java.util.Collections.singletonList(normalUser));
            return stored;
        });
        when(roleService.getById(3L)).thenReturn(normalUser);
        when(userMapper.insert(any(User.class))).thenReturn(1);

        User request = new User();
        request.setId(1L);
        request.setUsername("new-user");
        request.setPassword("password123");
        request.setRole(java.util.Collections.singletonList(administrator));

        userService.register(request);

        ArgumentCaptor<User> captor = ArgumentCaptor.forClass(User.class);
        verify(userMapper).insert(captor.capture());
        User inserted = captor.getValue();
        assertNull(inserted.getId());
        assertEquals(Long.valueOf(3L), inserted.getRole().get(0).getId());
        assertTrue(new BCryptPasswordEncoder().matches("password123", inserted.getPassword()));
    }

    @Test
    public void register_failsWhenDefaultRoleIsMissing() {
        when(userMapper.selectOne(any(), anyBoolean())).thenReturn(null);
        when(roleService.getById(3L)).thenReturn(null);

        User request = new User();
        request.setUsername("new-user");
        request.setPassword("password123");

        assertThrows(com.example.exception.CustomException.class, () -> userService.register(request));
        verify(userMapper, times(0)).insert(any(User.class));
    }

    @Test
    public void register_rejectsXssUsername() {
        User request = new User();
        request.setUsername("<img src=x onerror=alert(1)>");
        request.setPassword("password123");

        assertThrows(com.example.exception.CustomException.class, () -> userService.register(request));
        verify(userMapper, times(0)).insert(any(User.class));
    }

    @Test
    public void save_rejectsEmptyPassword() {
        User user = new User();
        user.setUsername("admin2");
        user.setPassword(null);
        assertThrows(com.example.exception.CustomException.class, () -> userService.save(user));
    }

    @Test
    public void login_plaintextRejectedWhenSwitchOff() {
        userService.setAllowPlaintextLogin(false);
        User stored = new User();
        stored.setId(1L);
        stored.setUsername("legacy");
        stored.setPassword("plain-password");
        when(userMapper.selectOne(any(), anyBoolean())).thenReturn(stored);

        User req = new User();
        req.setUsername("legacy");
        req.setPassword("plain-password");
        assertThrows(com.example.exception.CustomException.class, () -> userService.login(req));
    }

    @Test
    public void login_plaintextUpgradedWhenSwitchOn() {
        userService.setAllowPlaintextLogin(true);
        User stored = new User();
        stored.setId(1L);
        stored.setUsername("legacy");
        stored.setPassword("plain-password");
        when(userMapper.selectOne(any(), anyBoolean())).thenReturn(stored);
        when(userMapper.updateById(any(User.class))).thenReturn(1);

        User req = new User();
        req.setUsername("legacy");
        req.setPassword("plain-password");
        User logged = userService.login(req);
        assertEquals("legacy", logged.getUsername());
        ArgumentCaptor<User> captor = ArgumentCaptor.forClass(User.class);
        verify(userMapper).updateById(captor.capture());
        assertTrue(captor.getValue().getPassword().startsWith("$2"));
    }
}
