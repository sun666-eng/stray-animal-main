package com.example.service;

import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.baomidou.mybatisplus.core.conditions.AbstractWrapper;
import com.baomidou.mybatisplus.core.conditions.Wrapper;
import com.baomidou.mybatisplus.core.metadata.TableInfoHelper;
import com.example.entity.PetCareChat;
import com.example.entity.PetCareConversation;
import com.example.exception.CustomException;
import com.example.mapper.PetCareChatMapper;
import com.example.mapper.PetCareConversationMapper;
import org.apache.ibatis.builder.MapperBuilderAssistant;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.Arrays;
import java.util.Collections;
import java.util.Date;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class PetCareConversationServiceTest {

    private PetCareConversationService service;
    private PetCareConversationMapper conversationMapper;
    private PetCareChatMapper chatMapper;
    private PetCareHistoryService historyService;

    @BeforeEach
    void setUp() {
        initTable(PetCareConversation.class, "petcare-conversation-test");
        initTable(PetCareChat.class, "petcare-conversation-chat-test");
        service = new PetCareConversationService();
        conversationMapper = mock(PetCareConversationMapper.class);
        chatMapper = mock(PetCareChatMapper.class);
        historyService = mock(PetCareHistoryService.class);
        ReflectionTestUtils.setField(service, "conversationMapper", conversationMapper);
        ReflectionTestUtils.setField(service, "chatMapper", chatMapper);
        ReflectionTestUtils.setField(service, "historyService", historyService);
    }

    @Test
    void firstTurnCreatesConversationAndLinksChat() {
        when(conversationMapper.insert(any(PetCareConversation.class))).thenAnswer(invocation -> {
            PetCareConversation row = invocation.getArgument(0);
            row.setId(31L);
            return 1;
        });
        PetCareChat savedChat = new PetCareChat();
        savedChat.setAnswerTime(new Date());
        when(historyService.saveTurn(any(), any(), any(), any(), any()))
                .thenReturn(savedChat);
        when(conversationMapper.updateById(any(PetCareConversation.class))).thenReturn(1);
        PetCareService.PetCareAnswer answer =
                new PetCareService.PetCareAnswer("回答", "local", "综合");

        PetCareConversationService.SavedTurn saved = service.recordTurn(
                7L, null, "猫咪应该怎样逐步换粮？", answer, new Date());

        assertEquals(31L, saved.getConversationId());
        assertEquals("猫咪应该怎样逐步换粮？", saved.getTitle());
        verify(historyService).saveTurn(
                org.mockito.ArgumentMatchers.eq(7L),
                org.mockito.ArgumentMatchers.eq(31L),
                org.mockito.ArgumentMatchers.eq("猫咪应该怎样逐步换粮？"),
                org.mockito.ArgumentMatchers.same(answer),
                any(Date.class));
        ArgumentCaptor<PetCareConversation> captor =
                ArgumentCaptor.forClass(PetCareConversation.class);
        verify(conversationMapper).updateById(captor.capture());
        assertEquals(1, captor.getValue().getTurnCount());
    }

    @Test
    void anotherUsersConversationIsNotReadableOrRenamable() {
        when(conversationMapper.selectOne(any(Wrapper.class))).thenReturn(null);

        CustomException readDenied = assertThrows(CustomException.class,
                () -> service.detail(9L, 44L));
        CustomException renameDenied = assertThrows(CustomException.class,
                () -> service.rename(9L, 44L, "越权标题"));

        assertEquals("404", readDenied.getCode());
        assertEquals("404", renameDenied.getCode());
        verify(historyService, never()).history(any(), any(), any());

        @SuppressWarnings("rawtypes")
        ArgumentCaptor<Wrapper> wrapper = ArgumentCaptor.forClass(Wrapper.class);
        verify(conversationMapper, org.mockito.Mockito.times(2)).selectOne(wrapper.capture());
        for (Wrapper<?> value : wrapper.getAllValues()) {
            AbstractWrapper<?, ?, ?> actual = (AbstractWrapper<?, ?, ?>) value;
            actual.getSqlSegment();
            assertTrue(actual.getParamNameValuePairs().containsValue(9L));
            assertTrue(actual.getParamNameValuePairs().containsValue(44L));
        }
    }

    @Test
    void legacyTurnsAreGroupedWithoutLosingContent() {
        PetCareChat first = chat(1L, "第一问");
        PetCareChat last = chat(2L, "第二问");
        when(chatMapper.selectList(any(Wrapper.class))).thenReturn(Arrays.asList(first, last));
        when(conversationMapper.insert(any(PetCareConversation.class))).thenAnswer(invocation -> {
            PetCareConversation row = invocation.getArgument(0);
            row.setId(80L);
            return 1;
        });
        when(chatMapper.update(any(), any(Wrapper.class))).thenReturn(2);

        service.migrateLegacy(7L);

        ArgumentCaptor<PetCareConversation> conversation =
                ArgumentCaptor.forClass(PetCareConversation.class);
        verify(conversationMapper).insert(conversation.capture());
        assertEquals("以前的聊天", conversation.getValue().getTitle());
        assertEquals(2, conversation.getValue().getTurnCount());
        verify(chatMapper).update(
                org.mockito.ArgumentMatchers.isNull(), any(Wrapper.class));
    }

    @Test
    void titleLengthIsValidatedBeforeUpdate() {
        PetCareConversation owned = new PetCareConversation();
        owned.setId(3L);
        owned.setUserId(7L);
        when(conversationMapper.selectOne(any(Wrapper.class))).thenReturn(owned);

        CustomException error = assertThrows(CustomException.class,
                () -> service.rename(7L, 3L, String.join("",
                        Collections.nCopies(61, "字"))));

        assertEquals("400", error.getCode());
        verify(conversationMapper, never()).updateById(any(PetCareConversation.class));
    }

    private static PetCareChat chat(Long id, String question) {
        PetCareChat row = new PetCareChat();
        row.setId(id);
        row.setUserId(7L);
        row.setQuestion(question);
        row.setQuestionTime(new Date(1_700_000_000_000L + id));
        row.setAnswerTime(new Date(1_700_000_010_000L + id));
        return row;
    }

    private static void initTable(Class<?> entity, String namespace) {
        if (TableInfoHelper.getTableInfo(entity) == null) {
            MapperBuilderAssistant assistant =
                    new MapperBuilderAssistant(new MybatisConfiguration(), namespace);
            TableInfoHelper.initTableInfo(assistant, entity);
        }
    }
}
