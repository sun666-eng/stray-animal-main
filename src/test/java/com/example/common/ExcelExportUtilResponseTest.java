package com.example.common;

import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletResponse;

import java.util.Collections;
import java.util.LinkedHashMap;

import static org.junit.jupiter.api.Assertions.assertEquals;

class ExcelExportUtilResponseTest {

    @Test
    void generatedFileUsesNoStoreHeaders() throws Exception {
        MockHttpServletResponse response = new MockHttpServletResponse();

        ExcelExportUtil.export(response, "test", Collections.singletonList("row"), row -> {
            LinkedHashMap<String, Object> values = new LinkedHashMap<>();
            values.put("value", row);
            return values;
        });

        assertEquals("no-store, no-cache, must-revalidate, max-age=0",
                response.getHeader("Cache-Control"));
        assertEquals("no-cache", response.getHeader("Pragma"));
    }
}
