package com.example.common;

import cn.hutool.core.collection.CollUtil;
import cn.hutool.poi.excel.ExcelUtil;
import cn.hutool.poi.excel.ExcelWriter;

import javax.servlet.ServletOutputStream;
import javax.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.net.URLEncoder;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Function;

public class ExcelExportUtil {

    private ExcelExportUtil() {
    }

    public static <T> void export(HttpServletResponse response, String fileName, List<T> rows,
                                  Function<T, Map<String, Object>> mapper) throws IOException {
        List<Map<String, Object>> list = CollUtil.newArrayList();
        for (T row : rows) {
            list.add(new LinkedHashMap<>(mapper.apply(row)));
        }

        ExcelWriter writer = ExcelUtil.getWriter(true);
        writer.write(list, true);

        response.setContentType("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;charset=utf-8");
        String encodedFileName = URLEncoder.encode(fileName, "UTF-8");
        response.setHeader("Content-Disposition", "attachment;filename=" + encodedFileName + ".xlsx");

        ServletOutputStream out = response.getOutputStream();
        writer.flush(out, true);
        writer.close();
    }
}
