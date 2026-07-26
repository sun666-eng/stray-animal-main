package com.example.dto;

import com.example.entity.Animal;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import java.time.LocalDate;
import java.time.ZoneId;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;

class AnimalSerializationTest {
    private final ObjectMapper mapper = new ObjectMapper();

    @Test
    void birthdayAcceptsOnlyStrictDateStringOrNull() throws Exception {
        Animal animal = mapper.readValue("{\"tbirthday\":\"2024-02-29\"}", Animal.class);
        assertEquals(LocalDate.of(2024, 2, 29), animal.getTbirthday().toInstant()
                .atZone(ZoneId.of("Asia/Shanghai")).toLocalDate());
        assertNull(mapper.readValue("{\"tbirthday\":null}", Animal.class).getTbirthday());

        assertThrows(JsonProcessingException.class,
                () -> mapper.readValue("{\"tbirthday\":\"2024-02-30\"}", Animal.class));
        assertThrows(JsonProcessingException.class,
                () -> mapper.readValue("{\"tbirthday\":\"2024-01-01junk\"}", Animal.class));
        assertThrows(JsonProcessingException.class,
                () -> mapper.readValue("{\"tbirthday\":1704067200000}", Animal.class));
    }
}
