# 动物档案批量导入 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让管理员上传 Excel（≤500 行）一次性导入待领养动物档案，坏行跳过、好行入库，返回结构化报告。

**Architecture:** 三层职责拆分：`ExcelImportUtil`（纯工具，只懂 Excel）→ `AnimalService.importFromExcel`（业务编排）→ `AnimalController`（HTTP 适配）；前端 `animal.html` 加两个按钮 + 两态对话框。每行独立 INSERT，不包外层事务。

**Tech Stack:** Spring Boot 2.7.18 / MyBatis-Plus 3.5.5 / Hutool POI 5.5.4 / JUnit 5 / Mockito (随 spring-boot-starter-test) / Vue 2 / Element UI 2.6.2

**关联设计文档：** `docs/superpowers/specs/2026-06-02-animal-batch-import-design.md`

**提交策略提示：** 用户先前说"暂时不提交"。每个 Task 末尾的 commit 步骤先 `git add` 暂存，不执行 `git commit`，等所有 Task 完成后用户决定打包提交方式（一次性 / 按 Task 拆 / 别的）。

---

## 文件结构

| 文件 | 角色 | 新建/改动 |
|---|---|---|
| `src/main/java/com/example/dto/ImportResult.java` | 导入结果 DTO + 内嵌 FailedRow | 新建 |
| `src/main/java/com/example/common/ExcelImportUtil.java` | Excel 解析工具，返回 `List<Map<列名,值>>` + 宽松类型转换 | 新建 |
| `src/main/java/com/example/service/AnimalService.java` | 加 `importFromExcel(MultipartFile)` 方法 + 私有 `parseRow` + `sanitize` | 改动 |
| `src/main/java/com/example/controller/AnimalController.java` | 加 `/import`（POST）+ `/template`（GET）两个端点 | 改动 |
| `src/main/resources/static/page/end/animal.html` | 顶部按钮区 + 导入对话框 + 报告渲染 + JS 方法 | 改动 |
| `src/test/java/com/example/common/ExcelImportUtilTest.java` | 工具类单元测试 | 新建 |
| `src/test/java/com/example/service/AnimalServiceImportTest.java` | Service 单元测试（Mockito） | 新建 |
| `src/test/resources/excel/` (目录) | 测试用 Excel 夹具，**由测试代码用 Hutool 程序化生成**，不入库二进制 | 新建（仅 .gitignore 占位） |

---

## Task 1: ImportResult DTO

**Files:**
- Create: `src/main/java/com/example/dto/ImportResult.java`

- [ ] **Step 1: 创建 DTO 类**

```java
package com.example.dto;

import lombok.AllArgsConstructor;
import lombok.Data;

import java.util.ArrayList;
import java.util.List;

@Data
public class ImportResult {

    private int total;
    private int successCount;
    private List<FailedRow> failed = new ArrayList<>();

    @Data
    @AllArgsConstructor
    public static class FailedRow {
        private int row;
        private String reason;
    }
}
```

- [ ] **Step 2: 编译通过即可（无单元测试，纯数据类）**

Run: `mvn compile -q`
Expected: BUILD SUCCESS

- [ ] **Step 3: 暂存（不提交）**

```bash
git add src/main/java/com/example/dto/ImportResult.java
```

---

## Task 2: ExcelImportUtil 骨架 + 第一个失败测试

**Files:**
- Create: `src/main/java/com/example/common/ExcelImportUtil.java`
- Create: `src/test/java/com/example/common/ExcelImportUtilTest.java`

- [ ] **Step 1: 写失败的测试**（normal file → 返回 N 行）

```java
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
}
```

- [ ] **Step 2: 运行测试，确认失败**（`ExcelImportUtil` 不存在）

Run: `mvn test -Dtest=ExcelImportUtilTest -q`
Expected: COMPILATION ERROR — `cannot find symbol class ExcelImportUtil`

- [ ] **Step 3: 写最小实现**

```java
package com.example.common;

import cn.hutool.poi.excel.ExcelReader;
import cn.hutool.poi.excel.ExcelUtil;
import com.example.exception.CustomException;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.io.InputStream;
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
}
```

- [ ] **Step 4: 跑测试确认绿**

Run: `mvn test -Dtest=ExcelImportUtilTest -q`
Expected: Tests run: 1, Failures: 0

- [ ] **Step 5: 暂存**

```bash
git add src/main/java/com/example/common/ExcelImportUtil.java src/test/java/com/example/common/ExcelImportUtilTest.java
```

---

## Task 3: ExcelImportUtil — 边界与异常路径

**Files:**
- Modify: `src/test/java/com/example/common/ExcelImportUtilTest.java`
- Modify: `src/main/java/com/example/common/ExcelImportUtil.java`（可能微调）

- [ ] **Step 1: 加 3 个失败用例**（追加到 ExcelImportUtilTest 末尾）

```java
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
```

- [ ] **Step 2: 跑测试**

Run: `mvn test -Dtest=ExcelImportUtilTest -q`
Expected: Tests run: 5, Failures: 0（Step 1 的 4 个新用例 + Task 2 的 1 个原有用例）

如果有失败，检查 Task 2 的实现是否已正确处理这些路径。当前实现已涵盖三类（empty / overLimit / nonExcel），应当直接通过。

- [ ] **Step 3: 暂存**

```bash
git add src/test/java/com/example/common/ExcelImportUtilTest.java
```

---

## Task 4: ExcelImportUtil — asString / asInt / asDate 宽松类型转换

**Files:**
- Modify: `src/main/java/com/example/common/ExcelImportUtil.java`
- Modify: `src/test/java/com/example/common/ExcelImportUtilTest.java`

- [ ] **Step 1: 加失败的 helper 测试**

```java
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
```

- [ ] **Step 2: 跑测试，确认失败**

Run: `mvn test -Dtest=ExcelImportUtilTest -q`
Expected: 编译失败 — `cannot find symbol method asString/asInt/asDate`

- [ ] **Step 3: 实现 3 个 helper**（追加到 `ExcelImportUtil`）

```java
import java.util.Date;
import java.text.SimpleDateFormat;

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
```

- [ ] **Step 4: 跑测试**

Run: `mvn test -Dtest=ExcelImportUtilTest -q`
Expected: Tests run: 8, Failures: 0

- [ ] **Step 5: 暂存**

```bash
git add src/main/java/com/example/common/ExcelImportUtil.java src/test/java/com/example/common/ExcelImportUtilTest.java
```

---

## Task 5: AnimalService.importFromExcel — happy path

**Files:**
- Modify: `src/main/java/com/example/service/AnimalService.java`
- Create: `src/test/java/com/example/service/AnimalServiceImportTest.java`

- [ ] **Step 1: 写失败的 happy-path 测试**

```java
package com.example.service;

import cn.hutool.poi.excel.ExcelUtil;
import cn.hutool.poi.excel.ExcelWriter;
import com.example.dto.ImportResult;
import com.example.entity.Animal;
import com.example.mapper.AnimalMapper;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.web.multipart.MultipartFile;

import java.io.ByteArrayOutputStream;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
public class AnimalServiceImportTest {

    @Mock
    AnimalMapper animalMapper;

    @InjectMocks
    AnimalService animalService;

    private MultipartFile xlsx(List<String> headers, List<List<Object>> rows) throws Exception {
        ExcelWriter w = ExcelUtil.getWriter(true);
        w.writeHeadRow(headers);
        for (List<Object> r : rows) w.writeRow(r);
        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        w.flush(baos, true);
        w.close();
        return new MockMultipartFile("file", "t.xlsx",
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                baos.toByteArray());
    }

    @Test
    public void import_allValid_returnsAllSuccess() throws Exception {
        when(animalMapper.insert(any(Animal.class))).thenReturn(1);

        MultipartFile file = xlsx(
                Arrays.asList("名称", "品种", "性别", "生日", "状态", "描述"),
                Arrays.asList(
                        Arrays.asList("小白", "狗", "公", "2024-01-15", "待领养", "活泼"),
                        Arrays.asList("小黑", "猫", "母", "2023-06-10", "申请中", "温顺"),
                        Arrays.asList("橘子", "猫", "公", "", "", "")
                ));

        ImportResult r = animalService.importFromExcel(file);

        assertEquals(3, r.getTotal());
        assertEquals(3, r.getSuccessCount());
        assertTrue(r.getFailed().isEmpty());

        ArgumentCaptor<Animal> cap = ArgumentCaptor.forClass(Animal.class);
        verify(animalMapper, times(3)).insert(cap.capture());
        assertEquals("小白", cap.getAllValues().get(0).getTname());
        assertEquals(Integer.valueOf(0), cap.getAllValues().get(0).getTstate()); // "待领养" → 0
        assertEquals(Integer.valueOf(1), cap.getAllValues().get(1).getTstate()); // "申请中" → 1
        assertEquals(Integer.valueOf(0), cap.getAllValues().get(2).getTstate()); // 空 → 默认 0
    }
}
```

- [ ] **Step 2: 跑测试，确认失败**（`importFromExcel` 不存在）

Run: `mvn test -Dtest=AnimalServiceImportTest -q`
Expected: COMPILATION ERROR

- [ ] **Step 3: 在 AnimalService 加方法（最小实现，过 happy path）**

把 `AnimalService.java` 全文替换为：

```java
package com.example.service;

import cn.hutool.core.util.StrUtil;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.example.common.ExcelImportUtil;
import com.example.dto.ImportResult;
import com.example.entity.Animal;
import com.example.exception.CustomException;
import com.example.mapper.AnimalMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import javax.annotation.Resource;
import java.io.IOException;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@Service
public class AnimalService extends ServiceImpl<AnimalMapper, Animal> {

    private static final Logger log = LoggerFactory.getLogger(AnimalService.class);
    private static final int MAX_ROWS = 500;
    private static final long MAX_BYTES = 10L * 1024 * 1024;

    @Resource
    private AnimalMapper animalMapper;

    public ImportResult importFromExcel(MultipartFile file) throws IOException {
        if (file != null && file.getSize() > MAX_BYTES) {
            throw new CustomException("400", "文件不能超过 10MB");
        }
        List<Map<String, Object>> rows = ExcelImportUtil.read(file, MAX_ROWS);

        // 表头预检
        if (!rows.isEmpty() && !rows.get(0).containsKey("名称")) {
            throw new CustomException("400", "Excel 表头必须包含\"名称\"列");
        }

        ImportResult result = new ImportResult();
        result.setTotal(rows.size());

        int rowNum = 2;
        for (Map<String, Object> raw : rows) {
            try {
                Animal a = parseRow(raw);
                save(a);
                result.setSuccessCount(result.getSuccessCount() + 1);
            } catch (Exception e) {
                String reason = sanitize(e);
                result.getFailed().add(new ImportResult.FailedRow(rowNum, reason));
                log.warn("import row {} failed", rowNum, e);
            }
            rowNum++;
        }
        return result;
    }

    private Animal parseRow(Map<String, Object> r) {
        Animal a = new Animal();
        String name = ExcelImportUtil.asString(r.get("名称"));
        if (StrUtil.isBlank(name)) {
            throw new CustomException("400", "名字不能为空");
        }
        a.setTname(name);
        a.setTtype(ExcelImportUtil.asString(r.get("品种")));
        a.setTsex(ExcelImportUtil.asString(r.get("性别")));
        a.setTdescribe(ExcelImportUtil.asString(r.get("描述")));
        a.setTbirthday(ExcelImportUtil.asDate(r.get("生日")));
        a.setTstate(parseTstate(r.get("状态")));
        return a;
    }

    private Integer parseTstate(Object v) {
        if (v == null || ExcelImportUtil.asString(v).isEmpty()) return 0;
        Integer asNum = ExcelImportUtil.asInt(v);
        if (asNum != null) {
            if (asNum == 0 || asNum == 1 || asNum == 2) return asNum;
            throw new CustomException("400", "无效的状态值：" + v);
        }
        Map<String, Integer> textMap = new HashMap<>();
        textMap.put("待领养", 0);
        textMap.put("申请中", 1);
        textMap.put("已领养", 2);
        Integer mapped = textMap.get(ExcelImportUtil.asString(v));
        if (mapped == null) {
            throw new CustomException("400", "无效的状态值：" + v);
        }
        return mapped;
    }

    private String sanitize(Exception e) {
        if (e instanceof CustomException) return ((CustomException) e).getMsg();
        String msg = e.getMessage() == null ? "未知错误" : e.getMessage();
        if (msg.length() > 100) msg = msg.substring(0, 100) + "...";
        String low = msg.toLowerCase();
        if (low.contains("sql") || low.contains("insert") || low.contains("constraint")) {
            return "数据保存失败，请检查该行数据";
        }
        return msg;
    }
}
```

- [ ] **Step 4: 跑测试**

Run: `mvn test -Dtest=AnimalServiceImportTest -q`
Expected: Tests run: 1, Failures: 0

- [ ] **Step 5: 暂存**

```bash
git add src/main/java/com/example/service/AnimalService.java src/test/java/com/example/service/AnimalServiceImportTest.java
```

---

## Task 6: AnimalService — 坏行收集 & 状态值映射 & DB 异常脱敏

**Files:**
- Modify: `src/test/java/com/example/service/AnimalServiceImportTest.java`

- [ ] **Step 1: 加 5 个新用例**

```java
    @Test
    public void import_tnameEmpty_skipped() throws Exception {
        when(animalMapper.insert(any(Animal.class))).thenReturn(1);
        MultipartFile file = xlsx(
                Arrays.asList("名称", "品种"),
                Arrays.asList(
                        Arrays.asList("小白", "狗"),
                        Arrays.asList("", "猫"),           // 第 3 行：空名字
                        Arrays.asList("橘子", "猫")
                ));

        ImportResult r = animalService.importFromExcel(file);

        assertEquals(3, r.getTotal());
        assertEquals(2, r.getSuccessCount());
        assertEquals(1, r.getFailed().size());
        assertEquals(3, r.getFailed().get(0).getRow());
        assertTrue(r.getFailed().get(0).getReason().contains("名字"));
    }

    @Test
    public void import_invalidTstateText_skipped() throws Exception {
        when(animalMapper.insert(any(Animal.class))).thenReturn(1);
        MultipartFile file = xlsx(
                Arrays.asList("名称", "状态"),
                Arrays.asList(
                        Arrays.asList("小白", "出售中")     // 第 2 行：非法状态
                ));

        ImportResult r = animalService.importFromExcel(file);

        assertEquals(0, r.getSuccessCount());
        assertEquals(1, r.getFailed().size());
        assertTrue(r.getFailed().get(0).getReason().contains("状态"));
    }

    @Test
    public void import_tstateNumber_kept() throws Exception {
        when(animalMapper.insert(any(Animal.class))).thenReturn(1);
        MultipartFile file = xlsx(
                Arrays.asList("名称", "状态"),
                Arrays.asList(Arrays.asList("小白", 2)));

        animalService.importFromExcel(file);

        ArgumentCaptor<Animal> cap = ArgumentCaptor.forClass(Animal.class);
        verify(animalMapper).insert(cap.capture());
        assertEquals(Integer.valueOf(2), cap.getValue().getTstate());
    }

    @Test
    public void import_tbirthdayGarbage_succeedsWithNull() throws Exception {
        when(animalMapper.insert(any(Animal.class))).thenReturn(1);
        MultipartFile file = xlsx(
                Arrays.asList("名称", "生日"),
                Arrays.asList(Arrays.asList("小白", "明天")));

        ImportResult r = animalService.importFromExcel(file);

        assertEquals(1, r.getSuccessCount());
        assertTrue(r.getFailed().isEmpty());

        ArgumentCaptor<Animal> cap = ArgumentCaptor.forClass(Animal.class);
        verify(animalMapper).insert(cap.capture());
        assertNull(cap.getValue().getTbirthday());
    }

    @Test
    public void import_dbException_sanitized() throws Exception {
        // 第一次成功，第二次抛 SQL 异常
        when(animalMapper.insert(any(Animal.class)))
                .thenReturn(1)
                .thenThrow(new RuntimeException("Duplicate entry SQL INSERT INTO t_animal..."));

        MultipartFile file = xlsx(
                Arrays.asList("名称"),
                Arrays.asList(
                        Arrays.asList("小白"),
                        Arrays.asList("小黑")));

        ImportResult r = animalService.importFromExcel(file);

        assertEquals(1, r.getSuccessCount());
        assertEquals(1, r.getFailed().size());
        assertEquals("数据保存失败，请检查该行数据", r.getFailed().get(0).getReason());
        assertFalse(r.getFailed().get(0).getReason().toLowerCase().contains("sql"));
    }
```

- [ ] **Step 2: 跑测试**

Run: `mvn test -Dtest=AnimalServiceImportTest -q`
Expected: Tests run: 6, Failures: 0

如果 `import_dbException_sanitized` 失败，对照 `sanitize()` 中的关键词列表（sql / insert / constraint）确认大小写匹配。

- [ ] **Step 3: 暂存**

```bash
git add src/test/java/com/example/service/AnimalServiceImportTest.java
```

---

## Task 7: AnimalService — 缺表头时整批拒绝

**Files:**
- Modify: `src/test/java/com/example/service/AnimalServiceImportTest.java`

- [ ] **Step 1: 加测试**

```java
    @Test
    public void import_missingNameHeader_throws() throws Exception {
        MultipartFile file = xlsx(
                Arrays.asList("品种", "性别"),                  // 没有"名称"
                Arrays.asList(Arrays.asList("狗", "公")));

        com.example.exception.CustomException ex = assertThrows(
                com.example.exception.CustomException.class,
                () -> animalService.importFromExcel(file));

        assertTrue(ex.getMsg().contains("名称"));
        verify(animalMapper, never()).insert(any(Animal.class));
    }
```

- [ ] **Step 2: 跑测试**

Run: `mvn test -Dtest=AnimalServiceImportTest -q`
Expected: Tests run: 7, Failures: 0（Task 5 的实现已含表头校验，应直接通过）

- [ ] **Step 3: 全套单测过一遍确认无回归**

Run: `mvn test -Dtest=ExcelImportUtilTest,AnimalServiceImportTest -q`
Expected: Tests run: 15, Failures: 0

- [ ] **Step 4: 暂存**

```bash
git add src/test/java/com/example/service/AnimalServiceImportTest.java
```

---

## Task 8: AnimalController — /import 与 /template 端点

**Files:**
- Modify: `src/main/java/com/example/controller/AnimalController.java`

- [ ] **Step 1: 在 AnimalController 加两个端点 + 必要 import**

在文件顶部 imports 后追加：

```java
import com.example.dto.ImportResult;
import org.springframework.web.multipart.MultipartFile;
import cn.hutool.poi.excel.ExcelUtil;
import cn.hutool.poi.excel.ExcelWriter;
import java.net.URLEncoder;
import java.util.Arrays;
import javax.servlet.ServletOutputStream;
```

在类内（紧跟 `export` 方法后）追加：

```java
    @AuditLog(module = "动物管理", action = "下载导入模板")
    @GetMapping("/template")
    public void template(HttpServletResponse response) throws IOException {
        ExcelWriter writer = ExcelUtil.getWriter(true);
        writer.writeHeadRow(Arrays.asList("名称*", "品种", "性别", "生日", "状态", "描述"));
        writer.writeRow(Arrays.asList("小白", "狗", "公", "2024-01-15", "待领养", "健康活泼，已驱虫"));

        response.setContentType("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;charset=utf-8");
        String fname = URLEncoder.encode("动物导入模板", "UTF-8");
        response.setHeader("Content-Disposition", "attachment;filename=" + fname + ".xlsx");

        ServletOutputStream out = response.getOutputStream();
        writer.flush(out, true);
        writer.close();
    }

    @AuditLog(module = "动物管理", action = "批量导入动物")
    @PostMapping("/import")
    public Result<ImportResult> importExcel(@RequestParam("file") MultipartFile file) throws IOException {
        return Result.success(animalService.importFromExcel(file));
    }
```

- [ ] **Step 2: 编译**

Run: `mvn compile -q`
Expected: BUILD SUCCESS

- [ ] **Step 3: 启动 Spring Boot 做冒烟**

Run: `mvn spring-boot:run`（在另一个终端）
等控制台出现 `Started Application` 后：

```bash
# 模板下载（替换 <TOKEN> 为真实 admin JWT；可从浏览器 DevTools → Application → Session Storage 取）
curl -o /tmp/template.xlsx \
  -H "Authorization: Bearer <TOKEN>" \
  http://localhost:9999/api/animal/template

ls -lh /tmp/template.xlsx     # 应有几 KB
```

Expected: 文件存在且不为空，Excel 打开看到 6 列表头 + 1 行示例。

- [ ] **Step 4: 暂存**

```bash
git add src/main/java/com/example/controller/AnimalController.java
```

---

## Task 9: 前端 animal.html — 顶部按钮 + 导入对话框 + JS 方法

**Files:**
- Modify: `src/main/resources/static/page/end/animal.html`

- [ ] **Step 1: 顶部按钮区插入两个新按钮**

定位 animal.html 中现有的：

```html
<el-button @click="add" type="primary" size="mini" style="margin: 10px 0">新增</el-button>
                <el-button @click="exp" type="primary" size="mini" style="margin: 10px 0">导出</el-button>
```

替换为：

```html
<el-button @click="add" type="primary" size="mini" style="margin: 10px 0">新增</el-button>
                <el-button @click="downloadTemplate" size="mini" style="margin: 10px 0">下载模板</el-button>
                <el-button @click="openImport" size="mini" style="margin: 10px 0">批量导入</el-button>
                <el-button @click="exp" type="primary" size="mini" style="margin: 10px 0">导出</el-button>
```

- [ ] **Step 2: 在「动物信息管理」对话框之后追加导入对话框**

定位现有的 `</el-dialog>`（动物信息管理对话框的关闭标签），在它后面（同一行级）追加：

```html
                <el-dialog title="批量导入动物" :visible.sync="dialogImportVisible" width="600px"
                           close-on-click-modal="false" close-on-press-escape="false" show-close="false">
                    <div v-if="!importResult">
                        <p style="color:#606266;font-size:13px;">
                            ① 没下载过模板？
                            <el-button type="text" size="mini" @click="downloadTemplate">点击下载</el-button>
                        </p>
                        <p style="color:#606266;font-size:13px;">② 选择 Excel 文件（上限 500 行 / 10MB）：</p>
                        <el-upload
                                drag
                                action=""
                                :auto-upload="false"
                                :limit="1"
                                :file-list="importFileList"
                                :on-change="onImportFileChange"
                                :on-remove="() => importFileList = []"
                                accept=".xlsx,.xls">
                            <i class="el-icon-upload"></i>
                            <div class="el-upload__text">把文件拖到这里 或 <em>点击上传</em></div>
                        </el-upload>
                        <div slot="footer" class="dialog-footer">
                            <el-button @click="dialogImportVisible = false">取 消</el-button>
                            <el-button type="primary" @click="submitImport" :loading="importLoading"
                                       :disabled="!importFileList.length">开始导入</el-button>
                        </div>
                    </div>
                    <div v-else>
                        <p style="font-size:16px;">
                            总计 {{importResult.total}} 条，
                            <span style="color:#67C23A;">成功 {{importResult.successCount}}</span>，
                            <span style="color:#F56C6C;">失败 {{importResult.total - importResult.successCount}}</span>
                        </p>
                        <el-table v-if="importResult.failed && importResult.failed.length"
                                  :data="importResult.failed" border max-height="280" size="mini">
                            <el-table-column prop="row" label="行号" width="80"></el-table-column>
                            <el-table-column prop="reason" label="失败原因"></el-table-column>
                        </el-table>
                        <p v-else style="color:#67C23A;">✓ 全部成功，无失败行</p>
                        <div slot="footer" class="dialog-footer">
                            <el-button type="primary" @click="closeImport">关 闭</el-button>
                        </div>
                    </div>
                </el-dialog>
```

- [ ] **Step 3: 在 Vue data 中加 4 个字段**

定位 animal.html 中现有 `data: { ... },` 中末尾 `props: [...]` 这一行**之前**，加：

```js
            dialogImportVisible: false,
            importFileList: [],
            importResult: null,
            importLoading: false,
```

- [ ] **Step 4: 在 methods 中加 5 个新方法**

在 `methods: { ... }` 末尾（最后一个方法的逗号后、`}` 之前）追加：

```js
            downloadTemplate() {
                window.open('/api/animal/template');
            },
            openImport() {
                this.importFileList = [];
                this.importResult = null;
                this.dialogImportVisible = true;
            },
            onImportFileChange(file) {
                if (file.size > 10 * 1024 * 1024) {
                    this.$message.error('文件不能超过 10MB');
                    this.importFileList = [];
                    return;
                }
                this.importFileList = [file];
            },
            submitImport() {
                if (!this.importFileList.length) {
                    this.$message.warning('请先选择文件');
                    return;
                }
                const fd = new FormData();
                fd.append('file', this.importFileList[0].raw);
                this.importLoading = true;
                $.ajax({
                    url: '/api/animal/import',
                    type: 'POST',
                    data: fd,
                    processData: false,
                    contentType: false
                }).then(res => {
                    if (res.code === '0') {
                        this.importResult = res.data;
                        this.loadTable();
                    } else {
                        this.$message.error(res.msg || '导入失败');
                    }
                }).always(() => {
                    this.importLoading = false;
                });
            },
            closeImport() {
                this.dialogImportVisible = false;
                this.loadTable();
            },
```

- [ ] **Step 5: 浏览器冒烟**

确保后端在跑（Task 8 已起或重起）。浏览器进 `http://localhost:9999/page/end/animal.html`（先登录管理员）：

1. 顶部应看到「新增 / 下载模板 / 批量导入 / 导出」四个按钮
2. 点「下载模板」→ 浏览器下载 `动物导入模板.xlsx`
3. 点「批量导入」→ 弹出导入对话框
4. 拖一个手填的小 Excel（3 行好数据 + 1 行空名字）进上传区
5. 点「开始导入」→ 对话框切换到态 2，汇总「总 4，成功 3，失败 1」，明细表显示第 X 行"名字不能为空"
6. 点「关闭」→ 对话框关 + 动物表格刷新出新动物

- [ ] **Step 6: 暂存**

```bash
git add src/main/resources/static/page/end/animal.html
```

---

## Task 10: 完整回归

- [ ] **Step 1: 全量单元测试**

Run: `mvn test -q`
Expected: Tests run >= 18（项目原有 3 个 + 本次新增 15+），Failures: 0

- [ ] **Step 2: 完整手工验收清单**（对照设计文档 §8.3 一项一项过）

| # | 操作 | 期望 |
|---|---|---|
| 1 | 下载模板 | 浏览器下载 `动物导入模板.xlsx`，6 列表头 + 1 行示例 |
| 2 | 5 行好 + 2 行坏（1 空名字 + 1 状态"出售中"）上传 | 报告"总 7 成功 5 失败 2"，明细 2 行 |
| 3 | 关闭 dialog | 表格刷新见新动物 |
| 4 | 准备 501 行 Excel 上传 | 报错"导入行数不能超过 500" |
| 5 | 上传 .txt | 报错"文件格式错误" |
| 6 | 用无 animal 权限账号（如 jerry/123456）访问 `/api/animal/import` | 403 |

- [ ] **Step 3: 把所有暂存内容列给用户**

Run: `git status -s`
Expected: 看到 5 个被改的代码文件 + 4 个新增文件，所有都是 `M`/`A` 状态（暂存）

把列表贴给用户，让用户决定怎么提交（一次性 / 拆 Task / 推迟）。**Plan 本身不替用户决定 commit 时机。**

---

## Self-Review Notes

按 writing-plans skill 要求做的自审：

**1. Spec 覆盖检查**

| Spec 章节 | 实现 Task |
|---|---|
| §2 决策表 - 失败策略（跳过坏行） | Task 6 - tname/status 路径 |
| §2 决策表 - 重复处理（不去重） | 不需要专门 task，每行独立 INSERT 即是 |
| §2 决策表 - 图片不导入 | Task 5 - parseRow 不读 tpic 列 |
| §2 决策表 - 仅 tname 必填 | Task 5 - parseRow 校验 |
| §2 决策表 - 行数 500 上限 | Task 3 - read_overLimit_throws |
| §2 决策表 - 文件 10MB 上限 | Task 5 - importFromExcel 入口检查 |
| §2 决策表 - 状态文字/数字双解析 | Task 5 - parseTstate + Task 6 用例 |
| §2 决策表 - 生日宽松解析 | Task 4 - asDate + Task 6 garbage 用例 |
| §3 架构 - ExcelImportUtil 不懂业务 | Task 2-4 (工具类隔离) |
| §3 架构 - Service 不懂 HTTP | Task 5（只接 MultipartFile） |
| §3 架构 - Controller 只做 HTTP | Task 8 (薄壳) |
| §4.1 接口签名 | Task 1, 2, 5, 8 |
| §4.2 模板格式 | Task 8 - `/template` 端点 |
| §4.2 列名精确匹配 | Task 5 - parseRow 用精确 key 取 |
| §5 数据流 | 各 Task 端到端 |
| §6.1 L1 文件级错误 | Task 3, 7 |
| §6.1 L2 行级错误 | Task 6 |
| §6.2 SQL 关键词脱敏 | Task 5 sanitize + Task 6 用例 |
| §6.3 不加 @Transactional | Task 5 - 每行独立 save() |
| §6.4 审计 | Task 8 - @AuditLog 注解 |
| §7 前端 | Task 9 |
| §8.1 ExcelImportUtilTest | Task 2-4 |
| §8.1 AnimalServiceImportTest | Task 5-7 |
| §8.3 手工验收 | Task 10 |

无遗漏。

**2. Placeholder 扫描**：✅ 无 TBD / TODO / "...similar to..."

**3. 类型一致性**：
- `ImportResult` 字段命名（successCount / failed）在 Task 1 定义 → Task 5/6/7 使用一致 ✓
- `FailedRow(int row, String reason)` 构造器在 Task 1 → Task 5 调用一致 ✓
- `ExcelImportUtil.read(MultipartFile, int)` 在 Task 2 定义 → Task 5 调用一致 ✓
- `asString / asInt / asDate` 在 Task 4 定义 → Task 5 调用一致 ✓
- `parseTstate` / `sanitize` 在 Task 5 定义 → Task 6 测试针对它 ✓

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-06-02-animal-batch-import.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — 我每个 Task 派一个新 subagent 实现，每 Task 之间停下来过一次 review，迭代快，主对话不被实现细节淹没

**2. Inline Execution** — 在本会话里按 executing-plans 节奏跑，分批做带检查点的 review

**Which approach?**
