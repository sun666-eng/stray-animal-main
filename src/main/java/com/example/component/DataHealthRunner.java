package com.example.component;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.annotation.Order;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/**
 * 启动时输出数据一致性健康检查。
 * 建议在 {@link DataStateGuardRunner} 之后运行（Order 更大），用于确认修复结果并提示库存。
 */
@Slf4j
@Component
@Order(50)
public class DataHealthRunner implements ApplicationRunner {

    private final JdbcTemplate jdbcTemplate;

    @Value("${app.data-health.enabled:true}")
    private boolean enabled;

    public DataHealthRunner(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    @Override
    public void run(ApplicationArguments args) {
        if (!enabled) {
            return;
        }
        try {
            Integer available = queryCount("SELECT COUNT(*) FROM t_animal WHERE tstate = 0");
            Integer applyingOrphan = queryCount(
                    "SELECT COUNT(*) FROM t_animal a WHERE a.tstate = 1 AND NOT EXISTS ("
                            + "SELECT 1 FROM t_adopt d WHERE d.aid = a.id AND d.vstate IN (0,1,3))");
            Integer pendingWhenApproved = queryCount(
                    "SELECT COUNT(*) FROM t_adopt d WHERE d.vstate = 0 AND EXISTS ("
                            + "SELECT 1 FROM t_adopt x WHERE x.aid = d.aid AND x.vstate = 1)");
            Integer multiApproved = queryCount(
                    "SELECT COUNT(*) FROM ("
                            + "SELECT aid FROM t_adopt WHERE vstate = 1 GROUP BY aid HAVING COUNT(*) > 1"
                            + ") t");
            Integer mismatch = queryCount(
                    "SELECT COUNT(*) FROM t_animal a WHERE a.tstate <> ("
                            + "CASE "
                            + "WHEN EXISTS (SELECT 1 FROM t_adopt d WHERE d.aid = a.id AND d.vstate = 4) THEN 2 "
                            + "WHEN EXISTS (SELECT 1 FROM t_adopt d WHERE d.aid = a.id AND d.vstate IN (0,1,3)) THEN 1 "
                            + "ELSE 0 END)");

            log.info("DataHealth: 可领养={} | 孤儿申请中={} | 预留下候补申请={} | 一动物多预留={} | 动物状态不一致={}",
                    available, applyingOrphan, pendingWhenApproved, multiApproved, mismatch);

            if (available != null && available == 0) {
                log.warn("DataHealth: 当前无可领养动物(tstate=0)，用户端浏览列表将为空（非错误，需运营补货）");
            }
            // v2 中“已预留 + 其他待审”是合法候补关系，完成交接时才关闭竞争申请。
            if (multiApproved != null && multiApproved > 0) {
                log.warn("DataHealth: 仍有 {} 只动物存在多条已通过领养", multiApproved);
            }
            if (mismatch != null && mismatch > 0) {
                log.warn("DataHealth: 仍有 {} 只动物 tstate 与领养表不一致", mismatch);
            }
        } catch (Exception e) {
            log.warn("DataHealth 检查跳过: {}", e.getMessage());
        }
    }

    private Integer queryCount(String sql) {
        return jdbcTemplate.queryForObject(sql, Integer.class);
    }
}
