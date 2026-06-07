package com.example.common;

import cn.hutool.poi.excel.ExcelReader;
import cn.hutool.poi.excel.ExcelUtil;
import com.example.exception.CustomException;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.io.InputStream;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.List;
import java.util.Map;

public final class ExcelImportUtil {

    private ExcelImportUtil() {}

    public static List<Map<String, Object>> read(MultipartFile file, int maxRows) throws IOException {
        if (file == null || file.isEmpty()) {
            throw new CustomException("400", "请选择要导入的文件");
        }
        try (InputStream in = file.getInputStream()) {
            ExcelReader reader = ExcelUtil.getReader(in);
            List<Map<String, Object>> rows = reader.readAll();
            if (rows.size() > maxRows) {
                throw new CustomException("400", "导入行数不能超过 " + maxRows);
            }
            return rows;
        } catch (CustomException e) {
            throw e;
        } catch (Exception e) {
            throw new CustomException("400", "文件格式错误，请使用 Excel 模板");
        }
    }

    public static String asString(Object v) {
        if (v == null) return "";
        return String.valueOf(v).trim();
    }

    public static Integer asInt(Object v) {
        if (v == null) return null;
        if (v instanceof Number) return ((Number) v).intValue();
        String s = String.valueOf(v).trim();
        if (s.isEmpty()) return null;
        try {
            return Integer.parseInt(s);
        } catch (NumberFormatException e) {
            return null;
        }
    }

    private static final String[] DATE_PATTERNS = { "yyyy-MM-dd", "yyyy/MM/dd" };

    public static Date asDate(Object v) {
        if (v == null) return null;
        if (v instanceof Date) return (Date) v;
        String s = String.valueOf(v).trim();
        if (s.isEmpty()) return null;
        for (String p : DATE_PATTERNS) {
            try {
                return new SimpleDateFormat(p).parse(s);
            } catch (Exception ignored) {}
        }
        return null;
    }
}
