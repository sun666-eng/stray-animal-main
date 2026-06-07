package com.example.common;

import cn.hutool.poi.excel.ExcelUtil;
import cn.hutool.poi.excel.ExcelWriter;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.web.multipart.MultipartFile;

import java.io.ByteArrayOutputStream;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

public class ExcelImportUtilTest {

    /** 用 Hutool 程序化生成带表头 + N 行数据的 .xlsx，返回 MultipartFile */
    private MultipartFile buildXlsx(List<String> headers, List<List<Object>> rows) throws Exception {
        ExcelWriter writer = ExcelUtil.getWriter(true);
        // 写表头
        Map<String, Object> headerRow = new LinkedHashMap<>();
        for (String h : headers) headerRow.put(h, h);
        writer.writeHeadRow(headers);
        // 写数据
        for (List<Object> row : rows) writer.writeRow(row);
        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        writer.flush(baos, true);
        writer.close();
        return new MockMultipartFile("file", "test.xlsx",
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                baos.toByteArray());
    }

    @Test
    public void read_normalFile_returnsRows() throws Exception {
        MultipartFile file = buildXlsx(
                Arrays.asList("名称", "品种"),
                Arrays.asList(
                        Arrays.asList("小白", "狗"),
                        Arrays.asList("小黑", "猫"),
                        Arrays.asList("橘子", "猫")
                ));

        List<Map<String, Object>> result = ExcelImportUtil.read(file, 500);

        assertEquals(3, result.size());
        assertEquals("小白", result.get(0).get("名称"));
        assertEquals("狗", result.get(0).get("品种"));
    }

    @Test
    public void read_emptyFile_returnsEmptyList() throws Exception {
        MultipartFile file = buildXlsx(
                Arrays.asList("名称", "品种"),
                java.util.Collections.emptyList());

        List<Map<String, Object>> result = ExcelImportUtil.read(file, 500);

        assertTrue(result.isEmpty());
    }

    @Test
    public void read_overLimit_throws() throws Exception {
        java.util.List<java.util.List<Object>> rows = new java.util.ArrayList<>();
        for (int i = 0; i < 501; i++) {
            rows.add(Arrays.asList("name" + i, "type"));
        }
        MultipartFile file = buildXlsx(Arrays.asList("名称", "品种"), rows);

        com.example.exception.CustomException ex = assertThrows(
                com.example.exception.CustomException.class,
                () -> ExcelImportUtil.read(file, 500));
        assertTrue(ex.getMsg().contains("500"));
    }

    @Test
    public void read_nonExcelFile_throws() {
        MultipartFile file = new MockMultipartFile(
                "file", "notes.txt", "text/plain", "hello world".getBytes());

        com.example.exception.CustomException ex = assertThrows(
                com.example.exception.CustomException.class,
                () -> ExcelImportUtil.read(file, 500));
        assertTrue(ex.getMsg().contains("格式"));
    }

    @Test
    public void read_emptyMultipart_throws() {
        MultipartFile file = new MockMultipartFile("file", "empty.xlsx",
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                new byte[0]);

        com.example.exception.CustomException ex = assertThrows(
                com.example.exception.CustomException.class,
                () -> ExcelImportUtil.read(file, 500));
        assertTrue(ex.getMsg().contains("选择"));
    }

    @Test
    public void asString_handlesNullAndTrim() {
        assertEquals("", ExcelImportUtil.asString(null));
        assertEquals("hi", ExcelImportUtil.asString("  hi  "));
        assertEquals("12", ExcelImportUtil.asString(12L));
    }

    @Test
    public void asInt_variants() {
        assertEquals(Integer.valueOf(12), ExcelImportUtil.asInt(12));
        assertEquals(Integer.valueOf(12), ExcelImportUtil.asInt("12"));
        assertNull(ExcelImportUtil.asInt("abc"));
        assertNull(ExcelImportUtil.asInt(null));
        assertNull(ExcelImportUtil.asInt(""));
    }

    @Test
    public void asDate_acceptsCommonFormats() {
        assertNotNull(ExcelImportUtil.asDate("2024-01-15"));
        assertNotNull(ExcelImportUtil.asDate("2024/01/15"));
        assertNull(ExcelImportUtil.asDate("明天"));
        assertNull(ExcelImportUtil.asDate(null));
        assertNull(ExcelImportUtil.asDate(""));

        java.util.Date now = new java.util.Date();
        assertSame(now, ExcelImportUtil.asDate(now));
    }
}
