package com.example.service;

import com.baomidou.mybatisplus.core.conditions.Wrapper;
import com.baomidou.mybatisplus.core.conditions.AbstractWrapper;
import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.baomidou.mybatisplus.core.metadata.TableInfoHelper;
import com.example.entity.PetCareChat;
import com.example.exception.CustomException;
import com.example.mapper.PetCareChatMapper;
import org.apache.ibatis.builder.MapperBuilderAssistant;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.Arrays;
import java.util.Collections;
import java.util.Date;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class PetCareHistoryServiceTest {

    private PetCareHistoryService service;
    private PetCareChatMapper mapper;

    @BeforeEach
    void setUp() {
        if (TableInfoHelper.getTableInfo(PetCareChat.class) == null) {
            MapperBuilderAssistant assistant =
                    new MapperBuilderAssistant(new MybatisConfiguration(), "petcare-history-test");
            TableInfoHelper.initTableInfo(assistant, PetCareChat.class);
        }
        service = new PetCareHistoryService();
        mapper = mock(PetCareChatMapper.class);
        ReflectionTestUtils.setField(service, "petCareChatMapper", mapper);
    }

    @Test
    void saveTurnStoresTimesAndToolMetadataWithoutCredentials() {
        when(mapper.insert(any(PetCareChat.class))).thenAnswer(invocation -> {
            PetCareChat row = invocation.getArgument(0);
            row.setId(88L);
            return 1;
        });
        Date questionTime = new Date(1_700_000_000_000L);
        PetCareService.PetCareAnswer answer = new PetCareService.PetCareAnswer(
                "请逐步换粮。", "ai", "喂养",
                Arrays.asList("get_animal_profile", "get_animal_profile"));

        PetCareChat saved = service.saveTurn(7L, "怎么换粮？", answer, questionTime);

        assertEquals(88L, saved.getId());
        assertEquals(7L, saved.getUserId());
        assertEquals(questionTime, saved.getQuestionTime());
        assertTrue(saved.getAnswerTime().getTime() >= questionTime.getTime());
        assertEquals("[\"get_animal_profile\"]", saved.getToolsJson());
        assertFalse(saved.getToolsJson().contains("apiKey"));
    }

    @Test
    void historyIsChronologicalAndAlwaysScopedToCurrentUser() {
        PetCareChat newest = row(2L, 7L, "第二问");
        PetCareChat oldest = row(1L, 7L, "第一问");
        when(mapper.selectCount(any(Wrapper.class))).thenReturn(2L);
        when(mapper.selectList(any(Wrapper.class))).thenReturn(Arrays.asList(newest, oldest));

        PetCareHistoryService.HistorySnapshot snapshot = service.history(7L, 50);

        assertEquals(2L, snapshot.getTotal());
        assertEquals(Arrays.asList("第一问", "第二问"),
                Arrays.asList(snapshot.getItems().get(0).getQuestion(),
                        snapshot.getItems().get(1).getQuestion()));

        @SuppressWarnings("rawtypes")
        ArgumentCaptor<Wrapper> captor = ArgumentCaptor.forClass(Wrapper.class);
        verify(mapper).selectCount(captor.capture());
        verify(mapper).selectList(captor.capture());
        for (Wrapper<?> wrapper : captor.getAllValues()) {
            AbstractWrapper<?, ?, ?> actual = (AbstractWrapper<?, ?, ?>) wrapper;
            actual.getSqlSegment();
            assertTrue(actual.getParamNameValuePairs().containsValue(7L));
        }
    }

    @Test
    void clearAndInvalidIdentityAreSafe() {
        when(mapper.delete(any(Wrapper.class))).thenReturn(4);
        assertEquals(4, service.clearHistory(9L));

        @SuppressWarnings("rawtypes")
        ArgumentCaptor<Wrapper> captor = ArgumentCaptor.forClass(Wrapper.class);
        verify(mapper).delete(captor.capture());
        AbstractWrapper<?, ?, ?> actual = (AbstractWrapper<?, ?, ?>) captor.getValue();
        actual.getSqlSegment();
        assertTrue(actual.getParamNameValuePairs().containsValue(9L));

        CustomException denied = assertThrows(CustomException.class,
                () -> service.history(null, 50));
        assertEquals("401", denied.getCode());
    }

    @Test
    void malformedStoredToolJsonDoesNotBreakHistory() {
        PetCareChat row = row(1L, 3L, "问题");
        row.setToolsJson("{not-json");
        when(mapper.selectCount(any(Wrapper.class))).thenReturn(1L);
        when(mapper.selectList(any(Wrapper.class))).thenReturn(Collections.singletonList(row));

        List<String> tools = service.history(3L, 50).getItems().get(0).getToolsUsed();

        assertTrue(tools.isEmpty());
    }

    @Test
    void authoritativeHistoryUsesOnlyRequestedUserAndConversation() {
        PetCareChat newest = row(2L, 7L, "第二问");
        newest.setConversationId(15L);
        PetCareChat oldest = row(1L, 7L, "第一问");
        oldest.setConversationId(15L);
        when(mapper.selectList(any(Wrapper.class))).thenReturn(Arrays.asList(newest, oldest));

        List<PetCareService.ChatTurn> turns = service.authoritativeTurns(7L, 15L, 4);

        assertEquals(Arrays.asList("第一问", "回答", "第二问", "回答"),
                Arrays.asList(turns.get(0).getText(), turns.get(1).getText(),
                        turns.get(2).getText(), turns.get(3).getText()));
        @SuppressWarnings("rawtypes")
        ArgumentCaptor<Wrapper> captor = ArgumentCaptor.forClass(Wrapper.class);
        verify(mapper).selectList(captor.capture());
        AbstractWrapper<?, ?, ?> wrapper = (AbstractWrapper<?, ?, ?>) captor.getValue();
        wrapper.getSqlSegment();
        assertTrue(wrapper.getParamNameValuePairs().containsValue(7L));
        assertTrue(wrapper.getParamNameValuePairs().containsValue(15L));
    }

    private PetCareChat row(Long id, Long userId, String question) {
        PetCareChat row = new PetCareChat();
        row.setId(id);
        row.setUserId(userId);
        row.setQuestion(question);
        row.setAnswer("回答");
        row.setSource("local");
        row.setTopic("综合");
        row.setToolsJson("[]");
        row.setQuestionTime(new Date());
        row.setAnswerTime(new Date());
        return row;
    }
}
