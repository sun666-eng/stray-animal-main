# 透明公示功能逻辑闭环审查报告

**审查时间**: 2026-07-28  
**审查人**: Kiro AI  
**审查范围**: 资金透明公示功能的完整数据流、权限控制、安全性

---

## 📊 执行摘要

| 维度 | 状态 | 评分 |
|------|------|------|
| 数据完整性 | ✅ 完整 | 9/10 |
| 权限控制 | ✅ 严格 | 10/10 |
| 安全防护 | ✅ 优秀 | 9/10 |
| 前后端一致性 | ✅ 一致 | 10/10 |
| 用户体验 | ⚠️ 良好（有优化空间） | 7/10 |
| **综合评分** | **✅ 逻辑闭环完整** | **45/50** |

**核心结论**: 透明公示功能已形成**完整的逻辑闭环**，数据流和权限控制设计优秀，可以放心使用。发现3个小优化点，无严重缺陷。

---

## ✅ 逻辑闭环检查清单

### 1. 数据流完整性 ✅

#### 1.1 数据入口（管理端）
```
[管理员登录] 
    ↓
[填写资金记录表单]
    款项名称: "小花的绝育手术"
    金额: -800.00
    用途: "2026年7月在XX宠物医院完成绝育"
    ↓
POST /api/account
    ↓
[AccountController.save]
    - 验证登录状态 ✅
    - 自动注入经手人（session.user.username）✅
    - 调用 AccountService.saveAccount ✅
    ↓
[AccountService.saveAccount]
    - 强制清空 ID（防止篡改）✅
    - 验证字段：
        * 款项名称：必填，≤100字符 ✅
        * 金额：非空、非零、≤10亿、≤2位小数 ✅
        * 用途：可选，≤355字符 ✅
        * 经手人：自动填充，≤100字符 ✅
    - 保存到 t_account 表 ✅
    ↓
[审计日志]
    模块: "资金管理"
    动作: "新增资金记录"
    操作人: 记录到审计表 ✅
```

**验证点**:
- ✅ 字段验证完整
- ✅ 金额精度控制（BigDecimal，2位小数）
- ✅ 防止金额为0（避免脏数据）
- ✅ 防止天文数字（MAX = 10亿）
- ✅ 经手人强制由服务端注入（防止前端伪造）

---

#### 1.2 数据出口（公众端）
```
[任何访客/用户]
    ↓
GET /api/account/public?pageNum=1&pageSize=10&name=小花
    ↓
[AccountController.publicInfo]
    - ❌ 无需登录（公开接口）
    - ❌ 无需权限验证
    - 分页查询 + 聚合统计（分两个SQL）
    ↓
[返回数据]
{
  "code": "0",
  "data": {
    "records": [
      {
        "alabel": "小花的绝育手术",
        "avalue": "-800.00",
        "adescribe": "2026年7月在XX宠物医院完成绝育"
        // ✅ 不含 id
        // ✅ 不含 auname（经手人）
      }
    ],
    "total": 125,
    "pages": 13,
    "current": 1,
    "size": 10,
    "incomeTotal": "58230.00",    // 累计收入
    "expenseTotal": "-52100.00",  // 累计支出
    "balance": "6130.00"          // 当前结余
  }
}
```

**验证点**:
- ✅ 数据脱敏（隐藏 ID、经手人）
- ✅ 聚合统计准确（SUM 查询）
- ✅ 分页限制（MAX_PUBLIC_PAGE_SIZE = 50）
- ✅ 查询关键词长度限制（≤100字符，防SQL注入）
- ✅ 支持搜索（款项名称 OR 用途说明）

---

#### 1.3 数据修改/删除（禁止）✅
```java
// AccountController.java:56-60
@PutMapping
public Result<?> update(@RequestBody Account account) {
    throw new CustomException("405", "资金公示记录仅允许追加，不允许覆盖历史记录");
}

// AccountController.java:62-66
@DeleteMapping("/{id}")
public Result<?> delete(@PathVariable Long id) {
    throw new CustomException("405", "资金公示记录仅允许追加，不允许物理删除");
}
```

**设计理念**: 
- ✅ **Append-Only 模式**（只能追加，不能改/删）
- ✅ 防止事后篡改财务记录
- ✅ 符合审计要求

**⚠️ 发现问题1**: 如果真的录错了怎么办？

**建议**: 
```java
// 方案A：允许"冲正"（会计学标准做法）
POST /api/account/reverse/{id}
→ 生成一条金额相反的记录，注明"冲正原记录#{id}"

// 方案B：软删除 + 审计
PUT /api/account/{id}/void
→ 设置 is_void=true，但记录仍可见，标注"已作废"
```

---

### 2. 权限控制 ✅

#### 2.1 角色-权限矩阵

| 操作 | 游客 | 普通用户 | 志愿者 | 管理员 | API路径 |
|------|------|---------|--------|--------|---------|
| 查看公开公示 | ✅ | ✅ | ✅ | ✅ | GET /api/account/public |
| 查看完整明细（含经手人） | ❌ | ❌ | ❌ | ✅ | GET /api/account/{id} |
| 查看统计图表 | ❌ | ❌ | ❌ | ✅ | GET /api/account/stats/by-label |
| 导出Excel | ❌ | ❌ | ❌ | ✅ | GET /api/account/export |
| 新增记录 | ❌ | ❌ | ❌ | ✅ | POST /api/account |
| 修改记录 | ❌ | ❌ | ❌ | ❌ | PUT /api/account（硬编码拒绝）|
| 删除记录 | ❌ | ❌ | ❌ | ❌ | DELETE /api/account/{id}（硬编码拒绝）|

**权限判断逻辑**:
```java
// AccountController.java:72
if (!PermissionUtil.hasFlag(user, "account")) {
    return Result.error("403", "无权按 ID 查看资金明细，请使用 /api/account/public");
}
```

**验证点**:
- ✅ 公开接口无需权限（/api/account/public）
- ✅ 管理接口检查 `account` 权限标志
- ✅ 权限不足时提示使用公开接口（用户友好）
- ✅ Session 验证（通过 sessionUser 方法）

---

#### 2.2 数据脱敏实现

**脱敏字段对比**:
```java
// 实体类 Account.java（数据库完整字段）
class Account {
    private Long id;           // 内部ID
    private String alabel;     // 款项名称
    private String auname;     // 经手人 ← 敏感
    private BigDecimal avalue; // 金额
    private String adescribe;  // 用途
}

// DTO AccountPublicVO.java（公开字段）
class AccountPublicVO {
    // ❌ 不含 id
    private String alabel;     // 款项名称 ✅
    // ❌ 不含 auname（经手人）
    private BigDecimal avalue; // 金额 ✅
    private String adescribe;  // 用途 ✅
    
    public static AccountPublicVO from(Account account) {
        return new AccountPublicVO(
            account.getAlabel(),
            account.getAvalue(),
            account.getAdescribe()
        );
    }
}
```

**验证点**:
- ✅ 公开接口使用 DTO 转换（AccountPublicVO.from）
- ✅ 隐藏了内部 ID（防止遍历攻击）
- ✅ 隐藏了经手人（保护个人隐私）

---

### 3. 安全防护 ✅

#### 3.1 SQL 注入防护
```java
// AccountController.java:256-264
private LambdaQueryWrapper<Account> buildPublicQuery(String name) {
    String keyword = name == null ? "" : name.trim();
    return Wrappers.<Account>lambdaQuery()
            .and(!keyword.isEmpty(), q -> q
                    .like(Account::getAlabel, keyword)  // ✅ MyBatis-Plus 参数化
                    .or()
                    .like(Account::getAdescribe, keyword))
            .orderByDesc(Account::getId);
}
```

**验证点**:
- ✅ 使用 MyBatis-Plus Lambda 查询（自动参数化）
- ✅ 输入长度限制（MAX_QUERY_LENGTH = 100）
- ✅ 聚合查询使用 JdbcTemplate + 固定SQL（无拼接）

---

#### 3.2 分页炸弹防护
```java
// AccountController.java:230-239
private int clampPageSize(Integer pageSize) {
    if (pageSize == null || pageSize < 1) return 10;
    return Math.min(pageSize, MAX_PUBLIC_PAGE_SIZE); // 最大50
}

private int clampPageNum(Integer pageNum) {
    if (pageNum == null || pageNum < 1) return 1;
    return Math.min(pageNum, MAX_PAGE_NUM); // 最大10000页
}
```

**验证点**:
- ✅ 限制单页最大条数（50条）
- ✅ 限制最大页码（10000页）
- ✅ 防止 `?pageSize=999999` 攻击

---

#### 3.3 导出限制
```java
// AccountController.java:190-198
long count = accountService.count();
if (count > MAX_EXPORT_ROWS) {  // 最大10000条
    throw exportLimitException(count);
}
List<Account> rows = accountService.list(...);
if (rows.size() > MAX_EXPORT_ROWS) {  // 双重检查
    throw exportLimitException(rows.size());
}
```

**验证点**:
- ✅ 限制导出最大行数（10000条）
- ✅ 双重检查（count + 实际查询）
- ✅ 仅管理员可导出

---

#### 3.4 缓存控制
```java
// AccountController.java:279-283
private void setNoStore(HttpServletResponse response) {
    response.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
    response.setHeader("Pragma", "no-cache");
    response.setDateHeader("Expires", 0);
}
```

**验证点**:
- ✅ 管理接口禁止缓存（防止敏感数据泄漏）
- ⚠️ 公开接口也禁止缓存（可能不必要）

**⚠️ 发现问题2**: 公开接口禁用缓存影响性能

**建议**:
```java
// 公开接口可以短期缓存（5分钟）
GET /api/account/public
Cache-Control: public, max-age=300

// 管理接口必须禁缓存
GET /api/account/{id}
Cache-Control: no-store
```

---

### 4. 前后端一致性 ✅

#### 4.1 数据格式一致性

**后端返回**:
```json
{
  "incomeTotal": "58230.00",
  "expenseTotal": "-52100.00",
  "balance": "6130.00"
}
```

**前端处理**:
```javascript
// account_public.html:37
formatMoney(value, signed, absolute) {
    return DecimalMoney.format(value, {
        signed: signed,      // 是否显示 +/-
        absolute: absolute   // 是否取绝对值
    });
}

// 显示
累计收入: {{ formatMoney(incomeTotal, false, false) }}  // "58,230.00"
累计支出: {{ formatMoney(expenseTotal, false, true) }}   // "52,100.00" (绝对值)
当前结余: {{ formatMoney(balance, true, false) }}        // "+6,130.00"
```

**验证点**:
- ✅ 后端统一使用 BigDecimal（精度保证）
- ✅ 后端统一返回字符串（避免 JS Number 精度丢失）
- ✅ 前端使用 DecimalMoney 库（专门处理金额）
- ✅ 三种显示模式（带符号、绝对值、原值）一致

---

#### 4.2 搜索逻辑一致性

**后端查询范围**:
```java
// AccountController.java:258-263
.like(Account::getAlabel, keyword)     // 款项名称
.or()
.like(Account::getAdescribe, keyword)  // 用途说明
// ❌ 不含 auname（经手人）
```

**前端提示**:
```html
<!-- account_public.html:17 -->
<input placeholder="搜索款项名称或用途" />
```

**验证点**:
- ✅ 前端提示与后端实现一致
- ✅ 不误导用户搜索经手人

---

#### 4.3 错误提示一致性

**后端错误码**:
```java
403: "无权按 ID 查看资金明细，请使用 /api/account/public"
405: "资金公示记录仅允许追加，不允许覆盖历史记录"
413: "导出记录数X超过上限10000，请缩小数据范围"
```

**前端处理**:
```javascript
// account_public.html:19
<div v-else-if="error" class="ui-state" role="alert">
    <h2>资金公示暂时无法加载</h2>
    <p>{{ error }}</p>  ← 直接显示后端错误消息
    <button @click="loadAccounts(pageNum)">重新加载</button>
</div>
```

**验证点**:
- ✅ 前端不硬编码错误消息
- ✅ 显示后端返回的 msg 字段
- ✅ 提供重试机制

---

### 5. 数据一致性 ⚠️

#### 5.1 聚合统计的一致性问题

**当前实现**:
```java
// AccountController.java:125-144
IPage<Account> page = accountService.page(...);  // 查询1：分页数据

BigDecimal income = jdbcTemplate.queryForObject(
    "SELECT COALESCE(SUM(avalue),0.00) FROM t_account WHERE avalue > 0", ...);  // 查询2：累计收入

BigDecimal expense = jdbcTemplate.queryForObject(
    "SELECT COALESCE(SUM(avalue),0.00) FROM t_account WHERE avalue < 0", ...);  // 查询3：累计支出
```

**⚠️ 发现问题3**: 三个查询不在同一事务中

**问题场景**:
```
时间线：
T1: 用户A访问公开公示页面
    → 查询分页数据（125条记录）
T2: 管理员插入一条新记录 "+5000元 捐赠"
T3: 用户A的请求继续执行
    → 查询累计收入（已包含新记录）
    → 查询累计支出

结果：
显示 "125条记录"，但累计收入已经包含了第126条
用户困惑："为什么总收入和列表对不上？"
```

**影响评估**: 
- 🟡 中等影响
- 出现概率：低（需要恰好在查询间插入数据）
- 后果：用户短暂困惑，刷新页面即可恢复

**建议**:
```java
// 方案A：使用 MySQL 8.0 窗口函数（推荐）
SELECT 
    alabel, avalue, adescribe,
    SUM(CASE WHEN avalue > 0 THEN avalue ELSE 0 END) OVER() AS income_total,
    SUM(CASE WHEN avalue < 0 THEN avalue ELSE 0 END) OVER() AS expense_total
FROM t_account
ORDER BY id DESC
LIMIT 10 OFFSET 0;
// 一次查询完成，天然一致

// 方案B：使用 @Transactional(readOnly=true)
@Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
public Result<AccountPublicPageDTO> publicInfo(...) {
    // 三个查询在同一事务快照中
}
```

---

## 📈 功能完整性检查

### 必备功能清单

| 功能 | 状态 | 备注 |
|------|------|------|
| 管理端：添加收入记录 | ✅ | POST /api/account |
| 管理端：添加支出记录 | ✅ | 同上，金额为负 |
| 管理端：查看完整明细 | ✅ | GET /api/account/page |
| 管理端：查看统计图表 | ✅ | GET /api/account/stats/by-label |
| 管理端：导出Excel | ✅ | GET /api/account/export |
| 公众端：查看公开公示 | ✅ | GET /api/account/public |
| 公众端：搜索款项 | ✅ | ?name=关键词 |
| 公众端：分页浏览 | ✅ | ?pageNum=1&pageSize=10 |
| 公众端：查看累计收支 | ✅ | incomeTotal/expenseTotal/balance |
| 防篡改：禁止修改历史 | ✅ | PUT 返回 405 |
| 防篡改：禁止删除历史 | ✅ | DELETE 返回 405 |
| 审计：操作日志 | ✅ | @AuditLog 注解 |

**完成度**: 12/12 = **100%**

---

### 扩展功能建议（未实现）

| 功能 | 优先级 | 工作量 | 价值 |
|------|--------|--------|------|
| 按时间筛选（2026年7月） | 🔴 HIGH | 1天 | 用户强需求 |
| 导出PDF报告 | 🟡 MEDIUM | 2天 | 正式感 |
| 凭证照片上传 | 🟡 MEDIUM | 3天 | 增强可信度 |
| 月度自动汇总 | 🟢 LOW | 2天 | 管理便利 |
| 数据可视化（图表） | 🟢 LOW | 3天 | 视觉吸引力 |

---

## 🐛 发现的问题汇总

### 问题1：录错数据无法修正 🟡 MEDIUM
**位置**: `AccountController.java:56-66`  
**现象**: 硬编码拒绝 PUT/DELETE，但没有提供冲正机制  
**影响**: 管理员录错后无法纠正，只能联系DBA直接改数据库  
**建议**: 实现"冲正记录"功能（见上文方案A）

---

### 问题2：公开接口禁用缓存影响性能 🟢 LOW
**位置**: `AccountController.java:121 (setNoStore调用)`  
**现象**: 公开数据禁用缓存，每次访问都查数据库  
**影响**: 高并发时数据库压力大  
**建议**: 公开接口允许5分钟缓存，或使用Redis缓存聚合统计

---

### 问题3：聚合统计与分页数据可能不一致 🟡 MEDIUM
**位置**: `AccountController.java:125-144`  
**现象**: 三个独立查询不在同一事务快照  
**影响**: 极低概率出现"总数和明细对不上"  
**建议**: 使用窗口函数或事务隔离（见上文方案A/B）

---

## ✅ 优秀设计亮点

### 1. Append-Only 模式 ⭐⭐⭐⭐⭐
```java
// 硬编码拒绝修改/删除，符合审计要求
throw new CustomException("405", "资金公示记录仅允许追加，不允许覆盖历史记录");
```
**评价**: 这是财务系统的黄金法则，防止事后篡改。

---

### 2. 数据脱敏实现 ⭐⭐⭐⭐⭐
```java
// 公开接口使用专门的 DTO，完全隔离敏感字段
AccountPublicVO.from(account)  // 不含 id、auname
```
**评价**: 避免了"查询时过滤"的遗漏风险，类型安全。

---

### 3. 经手人自动注入 ⭐⭐⭐⭐⭐
```java
// AccountService.java:21
account.setAuname(required(authenticatedUsername, 100, "经手人"));
```
**评价**: 防止前端伪造经手人，审计可靠。

---

### 4. 金额精度控制 ⭐⭐⭐⭐
```java
// 强制 BigDecimal + 2位小数
if (amount.scale() > 2) throw new CustomException("400", "金额最多保留2位小数");
account.setAvalue(amount.setScale(2));
```
**评价**: 避免浮点数精度问题，符合会计规范。

---

### 5. 友好的权限提示 ⭐⭐⭐⭐
```java
return Result.error("403", "无权按 ID 查看资金明细，请使用 /api/account/public");
                                                      ↑↑↑ 明确告知替代方案
```
**评价**: 不是简单说"无权限"，而是引导用户使用公开接口。

---

## 📋 测试建议

### 单元测试覆盖点

```java
// AccountServiceTest.java（建议新增）
@Test
void shouldRejectZeroAmount() {
    account.setAvalue(BigDecimal.ZERO);
    assertThrows(CustomException.class, () -> service.saveAccount(account, "admin"));
}

@Test
void shouldRejectExcessiveDecimals() {
    account.setAvalue(new BigDecimal("100.123"));  // 3位小数
    assertThrows(CustomException.class, () -> service.saveAccount(account, "admin"));
}

@Test
void shouldInjectHandlerName() {
    account.setAuname("hacker");  // 前端伪造
    service.saveAccount(account, "realAdmin");
    assertEquals("realAdmin", account.getAuname());  // 应被覆盖
}
```

---

### 集成测试场景

```java
// AccountControllerIntegrationTest.java（建议新增）
@Test
void publicEndpointShouldHideSensitiveFields() {
    // 管理员插入一条记录
    mockMvc.perform(post("/api/account")
            .session(adminSession)
            .content("{\"alabel\":\"测试\",\"avalue\":\"100.00\"}")
        ).andExpect(status().isOk());
    
    // 游客访问公开接口
    MvcResult result = mockMvc.perform(get("/api/account/public"))
        .andExpect(status().isOk())
        .andReturn();
    
    String json = result.getResponse().getContentAsString();
    assertFalse(json.contains("\"id\":"));      // 不应包含 id
    assertFalse(json.contains("\"auname\":"));  // 不应包含经手人
}
```

---

## 🎯 最终结论

### 逻辑闭环完整性：✅ **完整**

**数据流**:
```
管理端录入 → 服务端验证 → 数据库持久化 → 公开接口脱敏 → 前端展示
     ↑                                                          ↓
     └──────────────── 审计日志记录 ───────────────────────────┘
```
✅ 所有环节都有验证和保护

---

### 安全性：✅ **优秀**

- ✅ 权限控制严格（管理/公开分离）
- ✅ 数据脱敏完整（DTO隔离）
- ✅ 防SQL注入（参数化查询）
- ✅ 防篡改（Append-Only）
- ✅ 审计日志（操作可追溯）

---

### 存在的问题：⚠️ **3个小问题，无严重缺陷**

1. 🟡 录错数据无修正机制（优先级：中）
2. 🟢 公开接口禁用缓存（优先级：低）
3. 🟡 聚合统计可能不一致（优先级：中）

**风险评估**: 
- 以上问题均为**优化项**，不影响核心功能使用
- 建议在1-2个月内逐步优化

---

### 推荐行动

#### 本周（保持现状）
✅ 无需修改，可以正常使用

#### 下月（优化）
1. 实现"冲正记录"功能（解决问题1）
2. 为公开接口添加5分钟缓存（解决问题2）

#### 季度（增强）
3. 使用窗口函数优化聚合查询（解决问题3）
4. 添加时间筛选功能
5. 添加凭证照片上传

---

**报告生成人**: Kiro AI  
**审查完成时间**: 2026-07-28  
**状态**: ✅ 透明公示功能已完成逻辑闭环，可放心使用
