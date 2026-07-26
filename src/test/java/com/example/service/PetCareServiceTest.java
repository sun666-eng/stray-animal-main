package com.example.service;

import com.example.exception.CustomException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * AI 照顾助手核心不变量：关键词匹配、兜底、限流、AI 关闭时零外呼、输入校验。
 */
class PetCareServiceTest {

    private PetCareService service;

    @BeforeEach
    void setUp() {
        service = new PetCareService();
        service.setAiEnabled(false);
    }

    @Test
    void vaccineQuestion_matchesVaccineTopic() {
        PetCareService.PetCareAnswer answer = service.ask(1L, "小狗的疫苗和驱虫应该怎么安排？");
        assertEquals("local", answer.getSource());
        assertEquals("疫苗驱虫", answer.getTopic());
        assertTrue(answer.getAnswer().contains("狂犬"));
    }

    @Test
    void feedingQuestion_matchesFeedingTopic() {
        PetCareService.PetCareAnswer answer = service.ask(1L, "猫能不能吃巧克力和牛奶？");
        assertEquals("喂养", answer.getTopic());
        assertTrue(answer.getAnswer().contains("巧克力"));
    }

    @Test
    void adaptationQuestion_matchesNewHomeTopic() {
        PetCareService.PetCareAnswer answer = service.ask(1L, "刚领养的猫一直躲着不吃东西怎么办");
        assertEquals("适应新家", answer.getTopic());
    }

    @Test
    void unrelatedQuestion_fallsBackWithTopicList() {
        PetCareService.PetCareAnswer answer = service.ask(1L, "今天天气怎么样");
        assertEquals("local", answer.getSource());
        assertEquals("综合", answer.getTopic());
        assertTrue(answer.getAnswer().contains("话题"));
        assertTrue(answer.getAnswer().contains("兽医"));
    }

    @Test
    void diseaseAnswer_alwaysCarriesVetDisclaimer() {
        PetCareService.PetCareAnswer answer = service.ask(1L, "狗狗一直呕吐没精神是生病了吗");
        assertEquals("疾病征兆", answer.getTopic());
        assertTrue(answer.getAnswer().contains("兽医"));
    }

    @Test
    void blankOrOversizeQuestion_isRejected() {
        assertThrows(CustomException.class, () -> service.ask(1L, "   "));
        StringBuilder longQ = new StringBuilder();
        for (int i = 0; i < 501; i++) longQ.append("问");
        assertThrows(CustomException.class, () -> service.ask(1L, longQ.toString()));
    }

    @Test
    void anonymous_isRejected() {
        assertThrows(CustomException.class, () -> service.ask(null, "养猫要准备什么"));
    }

    @Test
    void rateLimit_kicksInAfterTenAsksPerMinute() {
        for (int i = 0; i < 10; i++) {
            service.ask(7L, "养猫要准备什么");
        }
        CustomException ex = assertThrows(CustomException.class, () -> service.ask(7L, "养猫要准备什么"));
        assertEquals("429", ex.getCode());
        // 其他用户不受影响
        assertNotNull(service.ask(8L, "养猫要准备什么"));
    }

    @Test
    void aiEnabledButMisconfigured_fallsBackToLocalWithoutError() {
        // base-url 为空时不外呼，直接走知识库（AI 关闭态与半配置态都不能影响可用性）
        service.setAiEnabled(true);
        service.setAiBaseUrl("");
        service.setAiApiKey("");
        PetCareService.PetCareAnswer answer = service.ask(2L, "小狗疫苗怎么打");
        assertEquals("local", answer.getSource());
        assertFalse(answer.getAnswer().isEmpty());
    }

    @Test
    void quickQuestions_areProvided() {
        assertTrue(service.quickQuestions().size() >= 4);
    }
}
