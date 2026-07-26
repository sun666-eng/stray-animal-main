# FileAsset 迁移 Runbook（precheck / apply）

> 状态：**草案待副本库验证**，不是已 VERIFIED 的生产迁移。

## 1. 前置

1. 备份数据库  
2. 执行 `2026-07-21-file-asset.sql`  
3. 确认 `file.upload-dir` 与磁盘目录  

## 2. 预检（不写业务表）

```sql
SOURCE docs/sql/2026-07-21-file-asset-migrate-precheck.sql;
```

关注：

| reason | 处理 |
|--------|------|
| `MULTI_BUSINESS` | 人工拆 flag 或改业务引用，**阻断 apply** |
| `BUSINESS_BIND_MISMATCH` | 人工决定，**阻断** |
| `SOFT_DELETED_EXISTS` / `SOFT_DELETED_AMBIGUOUS` | 单条可恢复；多条阻断 |
| `NEED_TIGHTEN_TO_PRIVATE` | apply 可自动 public→private |
| `EXISTING_STRICTER_OR_DRIFT` | private 不会被抬成 public；检查绑定 |

要求：`blocking_conflicts = 0` 再 apply。

## 3. 推荐：一键编排（本地）

```powershell
# 含：precheck、可选清共享头像、apply（幂等二次）、磁盘 stored_name 回填
powershell -ExecutionPolicy Bypass -File tools/migrate-file-asset-run.ps1 -FixSharedAvatars
powershell -ExecutionPolicy Bypass -File tools/verify-file-asset-db.ps1
```

## 4. 手动正式应用

```sql
SOURCE docs/sql/2026-07-21-file-asset-migrate-apply.sql;
CALL sp_file_asset_migrate_apply(DATE_FORMAT(NOW(), '%Y%m%d%H%i%s'));
```

冲突时过程 `SIGNAL SQLSTATE '45000'`，客户端应非 0。

**已知修复**：apply 软删恢复使用临时 id 表，避免 MySQL 1093（同表 UPDATE 子查询）。

## 5. 二次执行（幂等）

再 `CALL` 一次：inserted 应为 0。

## 6. stored_name 与磁盘

- apply 新建行可能为 `flag-legacy` 占位  
- `migrate-file-asset-run.ps1` 会扫描 `~/.stray-animal/upload`、`legacy-uploads/`、`upload/` 回填真实文件名  
- 运行时优先 `stored_name` 精确读；占位名才尝试 `flag-*` 前缀  

## 7. 禁止

- 不在 precheck 未通过时对生产 apply  
- 不把「INSERT 0 行」当成成功迁移证据  
- 不把仅目录扫描报告当作迁移正确性证据  
