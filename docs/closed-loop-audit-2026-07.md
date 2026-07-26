# 业务闭环对抗性审查报告(2026-07-27)

方法:5 条业务闭环并行端到端追踪(前端页面 → API → Service → DB 状态 → 反哺其他功能),
共 22 个 agent;每条发现经独立对抗证伪,默认怀疑立场,结论均要求文件:行号级证据。
产出:**14 项确认**,5 项证伪剔除,2 项双验证翻转经仲裁降级。

## 一、闭环健康度总评

| 闭环 | 结论 |
|------|------|
| 领养主链路 | **结构扎实**:行锁+CAS 状态机、自动驳回竞争者、动物状态双向同步、删除回滚均正确;断点集中在"动物可见性 × 领养关系"的跨功能边界(见 H1) |
| 义工派生角色 | **闭环完好**:改已审核申请 403、多申请角色判定正确、角色不悬空;断点在拦截器与 Service 白名单不同步(M3) |
| 救助+聊天+公示 | **结构健全**:表单/聊天双路径分明,聊天消息过滤全覆盖(findAll/page/mine/export/byId 处处设防) |
| 文件资产 | **绑定点齐备**:六类业务绑定均同事务、先绑后写、失败回滚;断点在"换图"路径的配额归属(M5) |
| RBAC(Phase 1 双写) | **主链路完好**:注册授权、读路径切关系表、自定义角色双写+失效即时生效;断点在权限编辑出口(H2)与启动 Guard/运行期契约矛盾(H3) |

**跨功能强关联总评**:核心状态同步(动物↔领养、义工↔角色)做了认真的双向维护,
这在同类项目中少见;但 14 项问题里 10 项恰好落在**两个子系统的交界处**——
拦截器白名单 vs Service 权限语义、启动 Guard vs 运行期策略、前端文案 vs 后端行为。
交界处缺少"契约测试"是共性根因。

## 二、确认问题清单

### High(3)

**H1. 领养通过后,用户端所有「查看动物」入口 404**
tstate=2 的动物仅 animal flag 可见,无"申请人本人"豁免(AnimalController.findById:88-92)。
领养人从 my_adopt 点「查看动物」404;my_visit 的「查看动物」**100% 死链**
(回访必然对应已通过领养);同一动物在列表页有名有图、详情页称"不存在"。
修法:findById 增加豁免——当前用户在 t_adopt 有该动物的申请记录时放行。

**H2. 权限编辑闭环死端:种子权限永不可改**
updateDefinitionLocked 对任何字段变更先 assertNotReferenced,而内置角色引用了
16 个种子权限中的 15 个;内置角色又不可编辑(isBuiltInRole 403)→ 改个描述都是
409,产品内无任何出口。修法:仅 flag/path 变更才做引用检查,name/description
放行(+invalidateAll)。

**H3. role2+role3 组合:运行期允许、启动 Guard 视为违约**
resolveRolesForWrite 不拦 2+3 组合,管理员可正常保存;重启后
RolePermissionGuardRunner 判为越权——**prod 配置直接拒绝启动**;dev 静默改写为
[role3, role4],管理员刚授的权限消失,且凭空授予未经审核的"认证义工"徽章
(与 role4 派生契约矛盾)。修法:运行期与启动契约对齐——resolveRolesForWrite
拒绝 2+3 组合,或降权目标改 [role3] 不发 role4。

### Medium(5)

**M1. 被驳回用户对该动物永久死端**:动物重新上架显示"可申请",用户填完 4 分钟
问卷提交才 409(submitAdopt 重复校验不分 vstate);无自删路径(DELETE 需 adopt
管理 flag)。修法:重复校验只算 PENDING/APPROVED,旧驳回行"复活"为新申请;
adopt_apply 加载时预检 /api/adopt/mine/{aid}。

**M2. 持有 volunteer flag 的账号在 my_volunteer 永远空列表**:findMine 对 flag
持有者走管理员搜索分支,而该分支无搜索参数时返回空 Page——自己的申请不可见,
与提交侧 409"已有申请"直接矛盾。修法:默认按 uid 归属查询,仅显式传搜索参数才
走管理分支。

**M3. 义工申请自删路径生产不可达**:Service 实现并测试了 deleteVolunteer 的本人
撤回,但 AuthInterceptor 对 DELETE /api/volunteer/{id} 落入 volunteer 管理 flag
兜底 → 普通用户 403。修法:拦截器放行 apply|volunteer 的 DELETE(归属校验已在
Service),前端补「撤回申请」按钮。

**M4. 救助工单无法清空管理员回复**:空 remark 被 MyBatis-Plus 默认策略静默丢弃,
提示成功但数据未变。修法:Help.remark 加 @TableField(updateStrategy=ALWAYS)
(Animal.java 已有同款先例)。

**M5. 换图占用暂存配额且无自助清理**:动物/头像换图走 unbindIfMatches(旧图回
暂存池计配额),一天多次换图后该用户所有上传 429 锁死。修法:改 retireIfMatches
(与 Proof/Visit 一致),前端重选/取消时调 DELETE /api/files/staged/{flag}。

### Low(6)

- **L1** my_adopt 搜索框标称"按编号"实为按名称 LIKE,必然空结果且空态文案误导
- **L2** 资金公示"经手人"输入框被静默忽略(落库为登录管理员名)——改只读预填
- **L3** 管理端多处 maxlength 超出后端上限,允许输入注定 400 的内容
- **L4** 暂存配额 SQL 缺 deleted=0 过滤,残行永久占配额
- **L5** RolePermissionGuard 用 LIKE '%"id":2%' 匹配角色,**自定义角色 id 到
  20-39 时误判越权**(dev 静默丢角色+发 role4;prod 拒启)——随自定义角色增多会
  升级为 high;附带发现 register 落库完整 role3 JSON 而非 slim 摘要,加剧误匹配面。
  修法:Java 端 extractRoleIds 精确判定替代 LIKE
- **L6** purpose=notice 是无消费方的死分支(前端零可达,仲裁降级)——删除该
  purpose 分支或补齐公告图链路

## 三、翻转仲裁记录

- **vstate=3 陷阱态**(一轮确认/一轮证伪)→ 采信证伪:前端从不发送 state=3、
  删除按钮对该状态可用、注释明确"删除重建"为设计出口。降为建议:auditAdopt
  直接禁止 state=3 入口,消灭这个仅 API 可达的休眠状态。
- **purpose=notice**(一轮证伪/一轮确认)→ 事实无分歧(零绑定点、零前端调用),
  分歧仅在定性;按"前端不可达=理论影响"降为 L6 代码卫生。

## 四、建议修复顺序

1. **H3 + L5**(同根:启动 Guard 与运行期契约):一次修完,消除 prod 拒启风险
2. **H1**(核心主流程死链,一个豁免分支)
3. **H2**(管理员日常操作被挡)
4. M1-M5(各 0.5-1.5 小时,互相独立)
5. L 级捎带修

证伪剔除的 5 项与各闭环"核对通过"细节见 workflow journal
(wf_fab3e467-ee1),不再赘述。
