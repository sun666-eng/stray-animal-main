# 功能闭环补全 — 验收清单

**仓库：** `D:\Documents\日期归档\2026\2026.4.7\Myproject\stray-animal-main`

## 部署前

1. 执行 `docs/sql/2026-07-11-loop-completion.sql`（为 `t_proof.pstatus`、`t_volunteer.apic` 加列；若列已存在可忽略报错）
2. 配置 `JWT_SECRET`（≥32 且非开发默认串）、`DB_*`
3. `mvn test` 应通过

## 场景验收

| # | 场景 | 预期 | 结果 |
|---|------|------|------|
| 1 | 用户端注册 `/page/front/register.html` | 进入 animal_browse，角色为普通用户 | ☐ |
| 2 | 浏览→申请→后台审核 0/1/2/3 | my_adopt 文案：待审核/已通过/已驳回/已取消；动物 tstate 正确 | ☐ |
| 3 | 通过后上传凭证→后台审核 pstatus | 用户见待审核/已通过/已驳回；通过后不可删 | ☐ |
| 4 | 后台回访录入 uid | 用户 my_visit 可见 | ☐ |
| 5 | 义工申请带照片→审核通过 | apic 有图；用户角色含志愿者(id=2) | ☐ |
| 6 | 救助提交→后台回复 | my_rescue 点击行见详情与 remark | ☐ |
| 7 | 公共聊天 | 双方能聊；文案标明公共室 | ☐ |
| 8 | 公告/资金公示 | 回归可用 | ☐ |
| 9 | 用户管理「查看在线」 | 弹出内存在线列表 | ☐ |
| 10 | 救助管理「导出」 | 下载 Excel | ☐ |

## 已实现任务对照

- Task1 领养状态文案
- Task2–3 凭证 pstatus + audit + UI
- Task4 回访 mine + my_visit
- Task5 义工 apic
- Task6 审核通过赋角色
- Task7 用户端注册 + 注册防提权（服务端已强制）
- Task8 救助详情/导出/IM 文案
- Task9 在线用户 UI
- Task10 SQL 迁移脚本
- Task11 本验收文档
