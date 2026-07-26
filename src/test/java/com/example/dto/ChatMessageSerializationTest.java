package com.example.dto;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;

class ChatMessageSerializationTest {
    private final ObjectMapper mapper = new ObjectMapper();

    @Test
    void idSerializesAsDecimalStringBeyondJavascriptSafeInteger() throws Exception {
        ChatMessageDTO dto = new ChatMessageDTO();
        dto.setId(9007199254740993L);

        assertEquals("9007199254740993", mapper.readTree(mapper.writeValueAsString(dto))
                .get("id").textValue());
    }
}
