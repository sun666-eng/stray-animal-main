# 管理员端动物档案批量导入 — 设计文档

| 项 | 值 |
|---|---|
| 日期 | 2026-06-02 |
| 状态 | 待审 |
| 关联代码 | `AnimalController` / `AnimalService` / `animal.html` |
| 关联权限 | `animal` flag |

## 1. 目标与范围

让管理员把多只待领养动物的资料一次性灌进系统，避免逐条手填。

**范围内**：
- Excel 模板下载
- Excel 上传 + 解析 + 入库
- 失败行收集 + 报告
- 前端按钮 + 对话框 + 报告渲染

**范围外**：
- 图片导入（管理员后续在动物管理页单条编辑时补）
- 异步任务 / 进度推送（500 行同步够用）
- 字段以外的关联表（如领养记录、回访记录）

## 2. 设计决策（澄清结论）

| 决策点 | 选择 |
|---|---|
| 失败策略 | 跳过坏行，入库好行，返回报告 |
| 重复处理 | 不去重，每行作为新条插入 |
| 图片字段 | 不导入，`tpic` 留 null |
| 必填字段 | 仅 `tname` |
| 模板下载 | 提供 |
| 行数上限 | 500 |
| 文件大小上限 | 10MB |
| 状态列识别 | 接受数字（0/1/2）或中文（"待领养/申请中/已领养"） |
| 生日列识别 | Excel 原生日期 / `yyyy-MM-dd` / `yyyy/MM/dd`；失败留 null，不当坏行 |
| 实现路径 | 同步阻塞 + Hutool `ExcelUtil.readAll` + 逐行 `save()` |
| UI 入口 | `animal.html` 顶部按钮区追加「下载模板」「批量导入」两个按钮 |
| 权限 | 与现有动物管理一致，依赖 `AuthInterceptor` 校验 `animal` flag |

## 3. 架构

```
浏览器 (animal.html dialog)
       │
       │ multipart/form-data: file
       ▼
AnimalController.importExcel(MultipartFile)        ← HTTP 适配 + @AuditLog
       │
       ▼
AnimalService.importFromExcel(MultipartFile)       ← 业务编排
       │     ┌──────────────────────────────┐
       │     │                              │
       ▼     ▼                              ▼
ExcelImportUtil.read(file, 500)        for each row:
   ── 只懂 Excel → List<Map>             parseRow + save() + 收集错误
                                          │
                                          ▼
                                       AnimalService.save (MP 单条 INSERT)
       │
       ▼
ImportResult { total, successCount, failed[] }
       │
       ▼
Result<ImportResult>  → 前端 dialog 渲染汇总 + 失败明细
```

**模块边界 / 单一职责**：

| 模块 | 职责 | 不负责 |
|---|---|---|
| `ExcelImportUtil` | 读 Excel → `List<Map<列名, 值>>` + 宽松类型转换 | 任何业务实体（Animal、User 等） |
| `AnimalService.importFromExcel` | 一组原始 Map → 逐行尝试创建 Animal → 返回 `ImportResult` | HTTP、文件上传细节 |
| `AnimalController` | HTTP 适配（接 MultipartFile、包 Result） | 业务逻辑、Excel 解析 |
| `animal.html` dialog | 上传 + 报告渲染 | 业务校验 |

## 4. 接口设计

### 4.1 后端

**新增端点**

```java
@AuditLog(module = "动物管理", action = "下载导入模板")
@GetMapping("/template")
public void template(HttpServletResponse response) throws IOException;

@AuditLog(module = "动物管理", action = "批量导入动物")
@PostMapping("/import")
public Result<ImportResult> importExcel(@RequestParam("file") MultipartFile file) throws IOException;
```

**新增 DTO**

```java
@Data
public class ImportResult {
    private int total;
    private int successCount;
    private List<FailedRow> failed = new ArrayList<>();

    @Data
    @AllArgsConstructor
    public static class FailedRow {
        private int row;       // Excel 行号（2 起，1 是表头）
        private String reason; // 中文友好原因
    }
}
```

**新增工具类**

```java
public final class ExcelImportUtil {
    public static List<Map<String, Object>> read(MultipartFile file, int maxRows) throws IOException;
    public static String  asString(Object v);
    public static Date    asDate(Object v);
    public static Integer asInt(Object v);
}
```

**新增 Service 方法**

```java
public ImportResult importFromExcel(MultipartFile file) throws IOException;
```

### 4.2 Excel 模板格式

第一行表头（带 `*` 提示必填）：

| 名称* | 品种 | 性别 | 生日 | 状态 | 描述 |
|---|---|---|---|---|---|

第二行示例数据：

| 小白 | 狗 | 公 | 2024-01-15 | 待领养 | 健康活泼，已驱虫 |

**列名识别（初版精确匹配）**：去前后空白后必须**精确等于**上表中的中文表头（`名称` / `品种` / `性别` / `生日` / `状态` / `描述`），否则视为无关列丢弃；缺 `名称` 列即触发 L1 文件级错误。带 `*` 仅是模板视觉提示，不进入识别逻辑。

**列值规则**：

| 列 | 类型 | 处理 |
|---|---|---|
| 名称 | 必填 | 空白 → 坏行（"名字不能为空"） |
| 品种 | 可空 | 直接 toString，trim |
| 性别 | 可空 | 接受 ""/"未知"/"公"/"母"；其他值直接存原文（不校验） |
| 生日 | 可空 | 见上节"生日列识别"，解析失败 → null（不算坏行） |
| 状态 | 可空 | 见上节"状态列识别"；解析失败 → 坏行；空白 → 默认 0 |
| 描述 | 可空 | 直接 toString，trim |

## 5. 数据流（端到端）

### 5.1 模板下载

```
GET /api/animal/template
  → Hutool ExcelWriter 写表头 + 1 行示例
  → response.setContentType("...spreadsheet...")
  → response.setHeader("Content-Disposition", "attachment;filename=动物导入模板.xlsx")
  → writer.flush(out, true)
```

### 5.2 批量导入

1. 前端选文件 → 点 "开始导入" → 构造 `FormData`，POST `/api/animal/import`
2. `AuthInterceptor` 校验：token 有效 + 用户含 `animal` flag → 放行
3. Controller 收 `MultipartFile`，调 `animalService.importFromExcel(file)`
4. Service 调 `ExcelImportUtil.read(file, 500)`：
   - 解析 Excel 第 1 个 sheet
   - 第 1 行 → 表头列名数组
   - 第 2 行起 → `List<Map<列名, 原始值>>`
   - 行数超 500 / 文件非 Excel → 抛 `CustomException`
5. Service 检查表头含 "名称"，否则抛 `CustomException`
6. Service 遍历每行（行号 i 从 2 起）：
   - try：`parseRow(map)` → `Animal` 实例 → `save(animal)` → `successCount++`
   - catch：`failed.add(new FailedRow(i, sanitize(e.getMessage())))`
7. 返回 `ImportResult`，Controller 包 `Result.success(...)` 返回
8. 前端渲染态 2 报告 + 后台调 `loadTable()` 刷新

## 6. 错误处理

### 6.1 三层划分

| 层 | 触发 | 处理 |
|---|---|---|
| L1 文件级 | 文件空 / 非 Excel / >10MB / 行数 >500 / 缺"名称"列 | `CustomException` → `Result.error`，**不入库任何行**（10MB 限制在 `ExcelImportUtil.read` 入口检查 `file.getSize()`；Spring 全局 multipart max 仍为 100MB，是外层兜底） |
| L2 行级 | tname 空 / 状态值无法识别 / save() DB 异常 | 进 `failed[]`，继续下一行 |
| L3 兜底 | 任何未捕获的 `RuntimeException` | 由 `GlobalExceptionHandler` 包成 `Result.error("500", ...)`，不暴露堆栈 |

### 6.2 DB 异常 message 兜底（防 SQL 泄露）

```java
String msg = e.getMessage() == null ? "未知错误" : e.getMessage();
if (msg.length() > 100) msg = msg.substring(0, 100) + "...";
if (msg.toLowerCase().contains("sql") || msg.toLowerCase().contains("insert")) {
    msg = "数据保存失败，请检查该行数据";
}
result.getFailed().add(new FailedRow(rowNum, msg));
logger.warn("import row {} failed", rowNum, e);  // 完整堆栈进日志
```

### 6.3 事务边界

**不加 `@Transactional`** — "跳过坏行入好行" 的语义要求每行独立入库；任何已 save 的好行必须保留，即使第 N+1 行抛异常也不回滚。MyBatis-Plus `save()` 即单条自动提交事务，符合需要。

### 6.4 审计

`@AuditLog(module="动物管理", action="批量导入动物")` 已挂在 `/import`，记下：用户、时间、文件名、最终 successCount + failedCount。

行级失败明细**不进审计表**（避免膨胀），仅进 `logger.warn` 日志。

## 7. 前端改动

### 7.1 顶部按钮区（animal.html）

```html
<el-button @click="add" type="primary" size="mini">新增</el-button>
<el-button @click="downloadTemplate" size="mini">下载模板</el-button>
<el-button @click="openImport" size="mini">批量导入</el-button>
<el-button @click="exp" type="primary" size="mini">导出</el-button>
```

### 7.2 导入对话框（两态）

**态 1（上传中）**：el-upload `:auto-upload="false"` 拖拽区 + 模板下载提示 + 行数 / 大小提示 + "取消" / "开始导入" 按钮。

**态 2（报告）**：汇总文字（"总 N，成功 K，失败 N-K"）+ 失败明细表（行号 / 原因）+ "关闭" 按钮 → 关 dialog + `loadTable()`。

### 7.3 JS 方法新增

```js
data 增量：dialogImportVisible, importFileList, importResult, importLoading

methods 增量：
- downloadTemplate()       → window.open('/api/animal/template')
- openImport()             → 重置 state, 打开 dialog
- onImportFileChange(file) → 客户端校验 file.size <= 10MB
- submitImport()           → FormData POST /api/animal/import → 写 importResult
- closeImport()            → 关 dialog + loadTable()
```

注意：`$.ajax` 走已有 `admin-auth.js` 的 `$.ajaxSetup`，自动带 JWT；401 兜底也自动跳登录页，无需在此页单独处理。

## 8. 测试

### 8.1 单元测试

**`ExcelImportUtilTest`**

| 用例 | 输入 | 期望 |
|---|---|---|
| read_normalFile_returnsRows | 3 行数据 | 返回 3 个 Map |
| read_emptyFile_returnsEmpty | 仅表头 | `[]` |
| read_overLimit_throws | 501 行 | `CustomException`，msg 含 "500" |
| read_nonExcel_throws | .txt | `CustomException`，msg 含 "格式" |
| asDate_excelNative | Excel 日期单元格 | 正确 Date |
| asDate_isoString | "2024-01-15" | 正确 Date |
| asDate_slashString | "2024/01/15" | 正确 Date |
| asDate_garbage | "明天" | null |
| asInt_variants | 12 / "12" / "abc" | 12 / 12 / null |

夹具：`src/test/resources/excel/animal-normal.xlsx`、`animal-501rows.xlsx`、`animal-empty.xlsx`、`text.txt`。

**`AnimalServiceImportTest`** — Mockito mock `AnimalMapper`，`@ExtendWith(MockitoExtension.class)`：

| 用例 | 期望 |
|---|---|
| import_allValid_returnsAllSuccess | total=3, successCount=3, failed=[] |
| import_tnameEmpty_skipped | failed 含 (行号, "名字不能为空") |
| import_invalidTstateText_skipped | failed 含中文原因 |
| import_tstateText_converted | save 时 animal.tstate==1 |
| import_tstateNumber_kept | save 时 animal.tstate==2 |
| import_tbirthdayGarbage_succeedsWithNull | 成功入库，tbirthday==null |
| import_dbException_sanitized | reason == "数据保存失败，请检查该行数据" |
| import_missingHeader_throws | `CustomException` |

### 8.2 不写 Controller 集成测试

理由：项目当前 `src/test/java` 下 0 个 `@SpringBootTest`，引入会启完整 Spring 上下文（MySQL/Redis），首次跑配置复杂、易失败。与项目现有测试风格保持一致。

### 8.3 手工验收清单

| # | 操作 | 期望 |
|---|---|---|
| 1 | 进动物管理页，点"下载模板" | 浏览器下载 `动物导入模板.xlsx`，开打后表头 + 示例正常 |
| 2 | 模板加 5 行好数据 + 2 行坏（1 空名字 + 1 状态填"出售中"），点"批量导入"上传 | 报告显示 "总 7，成功 5，失败 2"，明细列出 2 个错误行号 + 中文原因 |
| 3 | 点关闭 | dialog 关闭，动物表格刷新，多 5 条新动物 |
| 4 | 准备 501 行 Excel，上传 | 报错 "导入行数不能超过 500" |
| 5 | 上传 .txt 文件 | 报错 "文件格式错误" |
| 6 | 用普通用户账号（无 `animal` flag）访问 `/api/animal/import` | 403 |

## 9. 复用的现有实现

| 已有 | 用于 |
|---|---|
| `cn.hutool.poi.excel.ExcelUtil`（pom.xml 已引） | 解析 Excel（`readAll`）+ 模板生成（`getWriter`） |
| `ExcelExportUtil` 设计模式 | `ExcelImportUtil` 对称参考 |
| `CustomException` + `GlobalExceptionHandler` | L1 文件级错误兜底 |
| `Result<T>` | 统一响应包装 |
| `@AuditLog` | 操作审计 |
| `admin-auth.js` 的 `$.ajaxSetup` + `ajaxError` | 前端 token / 401 兜底 |
| `AuthInterceptor` 的 `animal` flag 校验 | 权限拦截 |

## 10. 未来扩展点（不在本次范围）

- 异步导入（上限提到 5000+ 时考虑）
- Excel 嵌入图片直接入库
- 类似格式给"批量导入义工"、"批量导入凭证"复用 `ExcelImportUtil`
- 模板和列名映射可配置化（多语言 / 自定义字段）
