package com.example.common;

import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.core.JsonToken;
import com.fasterxml.jackson.databind.DeserializationContext;
import com.fasterxml.jackson.databind.JsonDeserializer;
import com.fasterxml.jackson.databind.exc.InvalidFormatException;

import java.io.IOException;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.time.format.ResolverStyle;
import java.util.Date;

/** Strict date-only JSON contract for business fields stored as SQL DATE. */
public class StrictDateDeserializer extends JsonDeserializer<Date> {
    private static final ZoneId PRODUCT_ZONE = ZoneId.of("Asia/Shanghai");
    private static final DateTimeFormatter FORMATTER = DateTimeFormatter
            .ofPattern("uuuu-MM-dd")
            .withResolverStyle(ResolverStyle.STRICT);

    @Override
    public Date deserialize(JsonParser parser, DeserializationContext context) throws IOException {
        if (!parser.hasToken(JsonToken.VALUE_STRING)) {
            throw InvalidFormatException.from(parser, "日期必须是 yyyy-MM-dd 字符串",
                    parser.getValueAsString(), Date.class);
        }
        String value = parser.getText();
        try {
            LocalDate date = LocalDate.parse(value, FORMATTER);
            return Date.from(date.atStartOfDay(PRODUCT_ZONE).toInstant());
        } catch (DateTimeParseException ex) {
            throw InvalidFormatException.from(parser, "日期格式无效，请使用 yyyy-MM-dd",
                    value, Date.class);
        }
    }
}
