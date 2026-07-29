package com.example.service;

import com.example.dto.ChatMessageDTO;
import com.example.entity.Help;
import com.example.entity.Permission;
import com.example.entity.User;
import com.example.exception.CustomException;
import com.example.mapper.HelpMapper;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import org.springframework.transaction.support.TransactionSynchronizationManager;

import java.util.Arrays;
import java.util.Collections;
import java.util.Date;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
public class HelpServiceTest {

    @Mock
    HelpMapper helpMapper;

    @Mock
    FileAssetService fileAssetService;

    @InjectMocks
    HelpService helpService;

    /** Mockito 5 不注入继承的泛型字段 M baseMapper（MP 3.5.7 起访问会断言非空），须显式注入。 */
    @org.junit.jupiter.api.BeforeEach
    void injectInheritedBaseMapper() {
        org.springframework.test.util.ReflectionTestUtils.setField(helpService, "baseMapper", helpMapper);
    }

    @Test
    public void userSubmit_clearsReservedAndServerOwnedFields() {
        User user = new User();
        user.setId(12L);
        user.setUsername("owner");
        Help help = new Help();
        help.setId(99L);
        help.setTitle("现场救助");
        help.setDescription("description");
        help.setLocation("location");
        help.setPhone("13800138000");
        help.setStatus(3);
        help.setRemark("forged admin reply");
        when(helpMapper.insert(any(Help.class))).thenReturn(1);

        assertTrue(helpService.submitHelp(help, user));
        assertNull(help.getId());
        assertEquals(Long.valueOf(12L), help.getUid());
        assertEquals("owner", help.getUname());
        assertEquals(Integer.valueOf(0), help.getStatus());
        assertNull(help.getRemark());
    }

    @Test
    public void userSubmit_rejectsReservedChatTitle() {
        User user = new User();
        user.setId(12L);
        Help help = new Help();
        help.setTitle(" 聊天室消息 ");
        CustomException ex = assertThrows(CustomException.class,
                () -> helpService.submitHelp(help, user));
        assertEquals("400", ex.getCode());
    }

    @Test
    public void ownerUpdate_cannotForgeAdminReplyOrIdentity() {
        User user = new User();
        user.setId(12L);
        user.setUsername("owner");
        Date created = new Date(1000L);
        Help existing = new Help();
        existing.setId(8L);
        existing.setUid(12L);
        existing.setUname("owner");
        existing.setStatus(0);
        existing.setRemark(null);
        existing.setCreateTime(created);
        existing.setTitle("正常救助");
        existing.setDescription("description");
        existing.setLocation("location");
        when(helpMapper.selectOne(any(), eq(true))).thenReturn(existing);
        when(helpMapper.updateById(any(Help.class))).thenReturn(1);

        Help forged = new Help();
        forged.setId(8L);
        forged.setUid(77L);
        forged.setUname("admin");
        forged.setTitle("正常救助");
        forged.setDescription("updated description");
        forged.setLocation("updated location");
        forged.setStatus(2);
        forged.setRemark("forged reply");
        forged.setCreateTime(new Date(9999L));

        assertTrue(helpService.updateHelp(forged, user));
        assertEquals(Long.valueOf(12L), forged.getUid());
        assertEquals("owner", forged.getUname());
        assertEquals(Integer.valueOf(0), forged.getStatus());
        assertNull(forged.getRemark());
        assertEquals(created, forged.getCreateTime());
    }

    @Test
    public void chatSave_persistsCanonicalDtoWithoutBroadcastSynchronization() {
        User user = user(12L, "owner");
        when(helpMapper.insert(any(Help.class))).thenAnswer(invocation -> {
            Help saved = invocation.getArgument(0);
            saved.setId(55L);
            return 1;
        });
        TransactionSynchronizationManager.initSynchronization();
        try {
            ChatMessageDTO result = helpService.submitChatMessage("  hello public room  ", user);

            assertEquals(Long.valueOf(55L), result.getId());
            assertEquals("owner", result.getUsername());
            assertEquals("hello public room", result.getText());
            ArgumentCaptor<Help> persisted = ArgumentCaptor.forClass(Help.class);
            verify(helpMapper).insert(persisted.capture());
            assertEquals(Long.valueOf(12L), persisted.getValue().getUid());
            assertEquals("owner", persisted.getValue().getUname());
            assertEquals(HelpService.CHAT_TITLE, persisted.getValue().getTitle());
            assertEquals(HelpService.CHAT_LOCATION, persisted.getValue().getLocation());
            assertEquals("hello public room", persisted.getValue().getDescription());
            assertNull(persisted.getValue().getPhone());
            assertNull(persisted.getValue().getPic());
            assertNull(persisted.getValue().getRemark());
            assertEquals(Integer.valueOf(0), persisted.getValue().getStatus());
            assertTrue(TransactionSynchronizationManager.getSynchronizations().isEmpty());
        } finally {
            TransactionSynchronizationManager.clearSynchronization();
        }
    }

    @Test
    public void chatRateLimit_rejectsEleventhMessagePerUser() {
        User user = user(3L, "member");
        AtomicId ids = new AtomicId();
        when(helpMapper.insert(any(Help.class))).thenAnswer(invocation -> {
            ((Help) invocation.getArgument(0)).setId(ids.next());
            return 1;
        });

        for (int i = 0; i < 10; i++) {
            helpService.submitChatMessage("message " + i, user);
        }
        CustomException ex = assertThrows(CustomException.class,
                () -> helpService.submitChatMessage("message 11", user));

        assertEquals("429", ex.getCode());
        verify(helpMapper, times(10)).insert(any(Help.class));
    }

    @Test
    public void chatHistory_returnsOnlyMinimalSafeFieldsInChronologicalOrder() {
        Help newer = chat(2L, "newer", "second", 2000L);
        newer.setPhone("secret");
        newer.setRemark("internal");
        Help older = chat(1L, "older", "first", 1000L);
        when(helpMapper.selectList(any())).thenReturn(Arrays.asList(newer, older));

        List<ChatMessageDTO> history = helpService.getChatHistory();

        assertEquals(2, history.size());
        assertEquals(Long.valueOf(1L), history.get(0).getId());
        assertEquals("first", history.get(0).getText());
        assertEquals(Long.valueOf(2L), history.get(1).getId());
    }

    @Test
    public void managerUpdate_rejectsReservedChatRecord() {
        User manager = user(1L, "manager");
        Permission permission = new Permission();
        permission.setFlag("rescue");
        manager.setPermission(Collections.singletonList(permission));
        Help existing = chat(9L, "member", "message", 1000L);
        when(helpMapper.selectOne(any(), eq(true))).thenReturn(existing);

        Help patch = new Help();
        patch.setId(9L);
        patch.setStatus(2);
        CustomException ex = assertThrows(CustomException.class,
                () -> helpService.updateHelp(patch, manager));

        assertEquals("400", ex.getCode());
        verify(helpMapper, never()).updateById(any(com.example.entity.Help.class));
    }

    @Test
    public void managerUpdate_preservesOwnerAndClassificationAndValidatesStatus() {
        User manager = user(1L, "manager");
        Permission permission = new Permission();
        permission.setFlag("help");
        manager.setPermission(Collections.singletonList(permission));
        Help existing = new Help();
        existing.setId(8L);
        existing.setUid(12L);
        existing.setUname("owner");
        existing.setTitle("救助请求");
        existing.setDescription("description");
        existing.setLocation("location");
        existing.setStatus(0);
        existing.setCreateTime(new Date(1000L));
        when(helpMapper.selectOne(any(), eq(true))).thenReturn(existing);

        Help patch = new Help();
        patch.setId(8L);
        patch.setUid(99L);
        patch.setUname("forged");
        patch.setTitle(HelpService.CHAT_TITLE);
        patch.setStatus(99);
        CustomException ex = assertThrows(CustomException.class,
                () -> helpService.updateHelp(patch, manager));

        assertEquals("400", ex.getCode());
        assertEquals(Long.valueOf(12L), patch.getUid());
        assertEquals("owner", patch.getUname());
        assertEquals("救助请求", patch.getTitle());
    }

    @Test
    public void rescueValidation_rejectsBadPhoneAndMissingLocation() {
        Help invalid = new Help();
        invalid.setTitle("救助请求");
        invalid.setDescription("description");
        invalid.setPhone("javascript:alert(1)");

        CustomException ex = assertThrows(CustomException.class,
                () -> helpService.submitHelp(invalid, user(3L, "member")));
        assertEquals("400", ex.getCode());
    }

    private static User user(Long id, String username) {
        User user = new User();
        user.setId(id);
        user.setUsername(username);
        return user;
    }

    private static Help chat(Long id, String username, String text, long time) {
        Help help = new Help();
        help.setId(id);
        help.setUid(3L);
        help.setUname(username);
        help.setTitle(HelpService.CHAT_TITLE);
        help.setDescription(text);
        help.setCreateTime(new Date(time));
        return help;
    }

    private static final class AtomicId {
        private long value;

        private Long next() {
            return ++value;
        }
    }
}
