package com.example.component;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.annotation.Order;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/**
 * 启动时输出数据一致性健康检查（只告警不改数据，避免误伤生产）。
 * 便于发现：无可领养库存、领养与动物状态不一致等脏数据。
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
                            + "SELECT 1 FROM t_adopt d WHERE d.aid = a.id AND d.vstate IN (0,1))");
            Integer pendingAfterAdopted = queryCount(
                    "SELECT COUNT(*) FROM t_adopt d INNER JOIN t_animal a ON a.id = d.aid "
                            + "WHERE a.tstate = 2 AND d.vstate = 0");
            Integer multiApproved = queryCount(
                    "SELECT COUNT(*) FROM ("
                            + "SELECT aid FROM t_adopt WHERE vstate = 1 GROUP BY aid HAVING COUNT(*) > 1"
                            + ") t");

            log.info("DataHealth: 可领养动物={} | 申请中但无有效申请的动物={} | 已领养仍待审申请={} | 一动物多通过={}",
                    available, applyingOrphan, pendingAfterAdopted, multiApproved);

            if (available != null && available == 0) {
                log.warn("DataHealth: 当前无可领养动物(tstate=0)，用户端浏览列表将为空");
            }
            if (pendingAfterAdopted != null && pendingAfterAdopted > 0) {
                log.warn("DataHealth: 发现 {} 条「动物已领养但仍待审」的申请（历史脏数据，可通过再审通过触发自动驳回或手工清理）",
                        pendingAfterAdopted);
            }
            if (multiApproved != null && multiApproved > 0) {
                log.warn("DataHealth: 发现 {} 只动物存在多条「已通过」领养（数据异常）", multiApproved);
            }
        } catch (Exception e) {
            log.warn("DataHealth 检查跳过: {}", e.getMessage());
        }
    }

    private Integer queryCount(String sql) {
        return jdbcTemplate.queryForObject(sql, Integer.class);
    }
}
