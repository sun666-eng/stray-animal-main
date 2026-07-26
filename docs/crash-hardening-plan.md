# 崩溃预防修复计划(2026-07-26)

三路技术核实(druid 字节码 / WS 调用链 / 全库阻塞与内存点扫描)后制定。
所有默认值与行为均经 jar 反编译或源码验证,标注 [已验证]。

## 风险总览(按一周内出事概率 × 影响排序)

| # | 风险 | 触发条件 | 后果 |
|---|------|----------|------|
| 1 | druid `maxActive=8` + `maxWait=-1` [已验证] | 并发稍高/慢查询占连接 | 200 个 Tomcat 线程无限期挂在 8 连接的池上,**全站假死且无异常日志** |
| 2 | 聊天轮询 × t_help 仅主键索引 [已验证] | 每在线页面 10s 一次全表扫+filesort,聊天消息永久堆积 | 一周膨胀后单查询变慢 → 与 #1 叠加吃干连接池 |
| 3 | 进程守护缺失 [已验证] | 终端裸 `mvn spring-boot:run`,关终端/注销/崩溃即停机 | 停机无人拉起;无 -Xmx,OOM 后僵尸态 |
| 4 | 上传路径复合假死 [已验证] | per-user synchronized 无超时,锁内 2 次 DB + 全图解码(25MP≈100MB堆/张)+ 10MB 拷贝 | 锁内等连接=永久持锁;并发大图=OOM |
| 5 | LoginRateLimiter 无界 map [已验证] | 公网凭据填充攻击(ip+username 无限造键) | 内存增长 + ≥5000 条后每次登录 O(n) 扫描 |
| 6 | 匿名 dashboard 统计无缓存 [已验证] | /api/dashboard/*-stats 每次 3-4 个 COUNT(*),无限流 | 对 8 连接池的廉价打法 |

**重要更正**:WebSocket 同步广播阻塞——经核实**当前是死路径**(`/api/user/ws-ticket` 返回
410、前端全部 HTTP 轮询、运行时 sessionMap 恒空),只是理论风险,降级为 P2 决策项。

**已被默认值兜住、无需修**:MySQL 空闲连接过期(druid 按 driver 自动启用
MySqlValidConnectionChecker,ping 校验,`testWhileIdle=true` 默认生效,借出超 60s 必检
[字节码已验证]);maxEvictableIdleTimeMillis 7h < wait_timeout 8h。

---

## P0:立即修(约半天,全部低风险)

### P0.1 druid 连接池参数(最高优先)

**⚠️ 配置陷阱 [已验证]**:本项目无 druid starter,SB 3.4.5 下:
- `spring.datasource.druid.*` 写了**静默失效**(autoconfigure 元数据无此前缀);
- 本地 m2 里的 druid-spring-boot-starter 1.2.19 只有 spring.factories 注册,**SB3 不认**;
- Generic DataSourceBuilder 只绑 url/driver/username/password 四个键,池参数一律到不了。

**方案(零新依赖)**:新建 `com/example/config/DataSourceConfig.java`:

```java
@Configuration
public class DataSourceConfig {
    /** SB3 无 starter 时 spring.datasource.druid.* 不绑定;用宽松绑定直连 DruidDataSource。 */
    @Bean(initMethod = "init", destroyMethod = "close")
    @ConfigurationProperties(prefix = "spring.datasource")
    public DataSource dataSource() {
        return new DruidDataSource();
    }
}
```

application.yml 的 `spring.datasource` 段追加(现有 url/username/password/driver 不动):

```yaml
    initial-size: 5     # 默认0:冷启动首波请求全走物理建连
    min-idle: 5         # 默认0:配合 keep-alive 维持温池
    max-active: 20      # 默认8:轮询突发+导出+文件接口叠加即打满
    max-wait: 5000      # 【关键】默认-1=池满无限挂起;5s 快速失败并出异常日志
    keep-alive: true    # 默认false:空闲连接主动 ping 保活
```

JDBC URL 追加 `&connectTimeout=5000&socketTimeout=60000`(druid 默认不注入任何
网络超时 [已验证];socketTimeout 需大于最慢合法查询,导出 1 万行留 60s)。

无需配置(默认已对):test-while-idle、validation-query(自动 ping,比 SELECT 1 轻)、
eviction 三件套。

**验证**:启动日志出现 DruidDataSource init;压测(如 ab -c 50)池满时 5s 内返回
GetConnectionTimeoutException 而非挂死;`show processlist` 连接数 ≤20。
**回滚**:删 Bean + yml 参数即回默认。

### P0.2 t_help 聊天查询索引 + 历史接口微缓存

1. 索引(走 SchemaGuardRunner 惯例 + docs/sql 手工脚本双轨):
```sql
ALTER TABLE t_help ADD INDEX idx_help_chat (title, create_time, id);
ALTER TABLE t_help ADD INDEX idx_help_uid (uid);
```
2. `GET /api/help/chat/history` 加 3–5s 进程内缓存(volatile 快照 + 时间戳即可,
   HelpService 单例字段;写入(saveChatMessage)后主动失效):在线 N 人的查询压力从
   N/10s 降为固定 1/5s。
3. 中期(P2):聊天消息迁出 t_help 独立表 + 保留期清理(如 30 天)。

**验证**:EXPLAIN 从 ALL/filesort 变 ref;轮询接口 P95 < 10ms。

### P0.3 Tomcat 显式基线

```yaml
server:
  tomcat:
    threads:
      max: 100            # 默认200 与 20 连接池比例失衡;100 仍远超单实例需求
    connection-timeout: 20s
  servlet:
    session:
      timeout: 30m        # 显式化,不再依赖隐式默认
```

### P0.4 进程守护与 JVM 基线

1. 生产改为 jar 运行:`mvn package` → `java -Xms512m -Xmx1024m
   -XX:+ExitOnOutOfMemoryError -jar animal-home.jar`(OOM 即退,交给守护拉起;
   杜绝 OOM 后僵尸态)。
2. Windows 守护二选一:**winsw**(推荐,单 exe + xml 配 jar 命令、工作目录、
   自动重启)或 计划任务(触发器:开机 + 每 5 分钟检测端口不在则启动)。
3. 固定工作目录(logback `./logs` 依赖 cwd [已验证]),stdout 重定向文件须配轮转
   (winsw 自带)。

---

## P1:本周内(各 0.5–2 小时)

### P1.1 上传路径去复合假死
- per-user 锁改 `ReentrantLock.tryLock(10, SECONDS)`,超时返回 429「上传繁忙请重试」;
- 图片像素上限从 2500 万降到 500 万(单张解码堆峰 100MB → 20MB);
- (P0.1 的 max-wait 已消除"锁内无限等连接"的最坏情况。)

### P1.2 LoginRateLimiter 加界
- 定时清理(每 60s 剔除过期窗口)替代"≥5000 才 O(n) 扫";
- 硬上限(如 2 万条)+ 超限逐出最旧,防凭据填充撑内存。

### P1.3 匿名统计接口缓存
- `/api/dashboard/public-stats`、`/home-stats` 加 60s 进程内缓存(同 P0.2 模式)。

### P1.4 Excel 导入前置防线
- `readAll()` 之前先检查 zip entry 解压后尺寸(POI ZipSecureFile 阈值)或换
  流式 read(sheet, rowHandler);限管理员但单次即可打爆默认堆 [已验证]。

---

## P2:决策与记录项

1. **WebSocket 栈去留**(当前死代码):
   - 若聊天长期保持 HTTP 轮询 → 建议删除 WS 服务端栈(WebSocketServer/
     TicketService/RedisSubscriber 及配套),约 -600 行;
   - 若计划恢复 WS → 按核实结论实施「单线程广播 executor + 有界队列(256,
     DiscardOldest)」方案;**不要**机械改 getAsyncRemote(同 session 并发 send
     直接抛 IllegalStateException [Tomcat 10.1.40 字节码已验证]),并在 onOpen 给
     session 设 `org.apache.tomcat.websocket.BLOCKING_SEND_TIMEOUT=5000`。
2. RolePermissionWriteLock 无超时(仅管理操作,频率低,记录在案);
3. 审计日志同步写盘(慢盘放大持锁时长,可换 AsyncAppender,低优先)。

---

## 附:prod 部署 checklist(fail-fast 全清单 [已验证])

首次生产启动前逐项确认,任一不满足会**拒绝启动**(by design):

- [ ] 显式且仅激活一个 profile:`SPRING_PROFILES_ACTIVE=prod`
- [ ] `JWT_SECRET` ≥32 字符且非开发密钥
- [ ] `DB_HOST` **不得是 localhost**(同机部署用内网 IP/机器名);用户非 root;密码非空
- [ ] `FILE_UPLOAD_DIR` 绝对路径、可创建、可写(有写探针)
- [ ] pure-check 模式(`SCHEMA_GUARD_AUTO_MIGRATE=false`)须先手工执行
      `docs/sql/bootstrap-all.sql` + `docs/sql/2026-07-26-role-permission.sql`
      (注意:RolePermissionSyncRunner 对账仍需该表可写)
- [ ] 脏数据先修(DataStateGuard fail-fast)
- [ ] 空库须设 `INITIAL_ADMIN_USERNAME/PASSWORD`(≥10 位非弱口令)
- [ ] **必须有 HTTPS 反代**:prod 强制 secure cookie,无 HTTPS 时浏览器不回传
      JSESSIONID,表现为"登录成功但永远弹回登录页"
- [ ] `REDIS_ENABLED=true` 时 Redis 必须可连;单实例保持
      `WEBSOCKET_SINGLE_INSTANCE_ONLY=true`
