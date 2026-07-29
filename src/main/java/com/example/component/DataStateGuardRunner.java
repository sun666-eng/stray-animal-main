package com.example.component;

import com.example.common.StartupMutationPolicy;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.annotation.Order;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/**
 * 脏数据状态一致性防护：启动时按领养业务不变量安全修复状态，不删业务行。
 * <p>
 * 不变量（与 {@link com.example.service.AdoptService} 对齐）：
 * <ul>
 *   <li>同一动物最多保留一条「审核通过待交接」；竞争待审允许保留候补</li>
 *   <li>动物 tstate：有完成交接=2，否则有活跃申请/预留=1，否则=0</li>
 * </ul>
 * 默认 auto-fix=true；生产可关自动修复仅告警，或 fail-fast。
 */
@Slf4j
@Component
@Order(30)
public class DataStateGuardRunner implements ApplicationRunner {

    public static final String STATE_VERSION = "2026.07.29-state-v2";

    private static final int ADOPT_PENDING = 0;
    private static final int ADOPT_APPROVED = 1;
    private static final int ADOPT_REJECTED = 2;
    private static final int ADOPT_MATERIAL_REQUIRED = 3;
    private static final int ADOPT_COMPLETED = 4;

    private static final int ANIMAL_AVAILABLE = 0;
    private static final int ANIMAL_APPLYING = 1;
    private static final int ANIMAL_ADOPTED = 2;

    private final JdbcTemplate jdbcTemplate;
    private final StartupMutationPolicy mutationPolicy;

    @Value("${app.data-state-guard.enabled:true}")
    private boolean enabled;

    @Value("${app.data-state-guard.auto-fix:true}")
    private boolean autoFix;

    @Value("${app.data-state-guard.fail-fast:false}")
    private boolean failFast;

    public DataStateGuardRunner(JdbcTemplate jdbcTemplate, StartupMutationPolicy mutationPolicy) {
        this.jdbcTemplate = jdbcTemplate;
        this.mutationPolicy = mutationPolicy;
    }

    @Override
    public void run(ApplicationArguments args) {
        if (!enabled) {
            log.info("DataStateGuard 已关闭");
            return;
        }
        // pure-check 与配置双重约束：禁止启动写库时不得自动修复
        boolean canMutate = autoFix && mutationPolicy.isMutationsAllowed();
        log.info("DataStateGuard 开始，契约版本={} mutationsAllowed={}", STATE_VERSION, mutationPolicy.isMutationsAllowed());
        try {
            DirtySnapshot before = snapshot();
            log.info("DataStateGuard 修复前: pendingOnApproved={} multiApprovedAnimals={} animalMismatch={} orphanApplying={}",
                    before.pendingWhenHasApproved, before.multiApprovedAnimals, before.animalStateMismatch, before.orphanApplying);

            if (before.isClean()) {
                writeVersion();
                log.info("DataStateGuard 数据已干净，无需修复");
                return;
            }

            if (!canMutate) {
                String msg = "存在脏数据且 pure-check/auto-fix=false: " + before;
                log.error("DataStateGuard {}", msg);
                if (failFast || !mutationPolicy.isMutationsAllowed()) {
                    throw new IllegalStateException("[DataStateGuard] " + msg);
                }
                return;
            }

            int rejectedPending = 0; // P0 v2：保留竞争申请作为候补，完成交接时再关闭。
            int rejectedExtra = rejectExtraApprovedKeepsMinUid();
            int animalsSynced = resyncAllAnimalStates();

            DirtySnapshot after = snapshot();
            log.info("DataStateGuard 已修复: 驳回待审={} 驳回多余通过={} 重算动物状态影响行≈{} | 修复后: {}",
                    rejectedPending, rejectedExtra, animalsSynced, after);

            if (!after.isClean()) {
                String msg = "修复后仍不干净: " + after;
                log.error("DataStateGuard {}", msg);
                if (failFast) {
                    throw new IllegalStateException("[DataStateGuard] " + msg);
                }
                return;
            }
            writeVersion();
            log.info("DataStateGuard 通过，version={}", STATE_VERSION);
        } catch (IllegalStateException ex) {
            throw ex;
        } catch (RuntimeException ex) {
            log.error("DataStateGuard 异常: {}", ex.getMessage(), ex);
            if (failFast) {
                throw ex;
            }
        }
    }

    /**
     * 同一动物多条已通过：保留 uid 最小的一条，其余驳回。
     */
    int rejectExtraApprovedKeepsMinUid() {
        String sql = "UPDATE t_adopt d "
                + "INNER JOIN ("
                + "  SELECT aid, MIN(uid) AS keep_uid FROM t_adopt WHERE vstate = " + ADOPT_APPROVED
                + "  GROUP BY aid HAVING COUNT(*) > 1"
                + ") m ON d.aid = m.aid AND d.vstate = " + ADOPT_APPROVED + " AND d.uid <> m.keep_uid "
                + "SET d.vstate = " + ADOPT_REJECTED;
        return jdbcTemplate.update(sql);
    }

    /**
     * 按领养表重算全部动物 tstate。
     */
    int resyncAllAnimalStates() {
        String sql = "UPDATE t_animal a SET a.tstate = CASE "
                + "WHEN EXISTS (SELECT 1 FROM t_adopt d WHERE d.aid = a.id AND d.vstate = " + ADOPT_COMPLETED + ") THEN " + ANIMAL_ADOPTED + " "
                + "WHEN EXISTS (SELECT 1 FROM t_adopt d WHERE d.aid = a.id AND d.vstate IN ("
                + ADOPT_PENDING + "," + ADOPT_APPROVED + "," + ADOPT_MATERIAL_REQUIRED + ")) THEN " + ANIMAL_APPLYING + " "
                + "ELSE " + ANIMAL_AVAILABLE + " END";
        return jdbcTemplate.update(sql);
    }

    DirtySnapshot snapshot() {
        DirtySnapshot s = new DirtySnapshot();
        s.pendingWhenHasApproved = 0; // v2 中这是合法候补关系，不再视为脏数据。
        s.multiApprovedAnimals = count(
                "SELECT COUNT(*) FROM (SELECT aid FROM t_adopt WHERE vstate = " + ADOPT_APPROVED
                        + " GROUP BY aid HAVING COUNT(*) > 1) t");
        s.animalStateMismatch = count(
                "SELECT COUNT(*) FROM t_animal a WHERE a.tstate <> ("
                        + "CASE "
                        + "WHEN EXISTS (SELECT 1 FROM t_adopt d WHERE d.aid = a.id AND d.vstate = " + ADOPT_COMPLETED + ") THEN " + ANIMAL_ADOPTED + " "
                        + "WHEN EXISTS (SELECT 1 FROM t_adopt d WHERE d.aid = a.id AND d.vstate IN ("
                        + ADOPT_PENDING + "," + ADOPT_APPROVED + "," + ADOPT_MATERIAL_REQUIRED + ")) THEN " + ANIMAL_APPLYING + " "
                        + "ELSE " + ANIMAL_AVAILABLE + " END)");
        s.orphanApplying = count(
                "SELECT COUNT(*) FROM t_animal a WHERE a.tstate = " + ANIMAL_APPLYING
                        + " AND NOT EXISTS (SELECT 1 FROM t_adopt d WHERE d.aid = a.id AND d.vstate IN ("
                        + ADOPT_PENDING + "," + ADOPT_APPROVED + "," + ADOPT_MATERIAL_REQUIRED + "))");
        return s;
    }

    private int count(String sql) {
        Integer n = jdbcTemplate.queryForObject(sql, Integer.class);
        return n == null ? 0 : n;
    }

    private void writeVersion() {
        if (!mutationPolicy.isMutationsAllowed()) {
            log.info("DataStateGuard pure-check：跳过写入 data_state_version");
            return;
        }
        try {
            jdbcTemplate.execute(
                    "CREATE TABLE IF NOT EXISTS app_schema_meta ("
                            + "meta_key VARCHAR(64) NOT NULL PRIMARY KEY,"
                            + "meta_value VARCHAR(255) NOT NULL,"
                            + "updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP"
                            + ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
            jdbcTemplate.update(
                    "INSERT INTO app_schema_meta (meta_key, meta_value) VALUES ('data_state_version', ?) "
                            + "ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value)",
                    STATE_VERSION);
        } catch (Exception e) {
            log.warn("写入 data_state_version 失败: {}", e.getMessage());
        }
    }

    static final class DirtySnapshot {
        int pendingWhenHasApproved;
        int multiApprovedAnimals;
        int animalStateMismatch;
        int orphanApplying;

        boolean isClean() {
            return pendingWhenHasApproved == 0
                    && multiApprovedAnimals == 0
                    && animalStateMismatch == 0
                    && orphanApplying == 0;
        }

        @Override
        public String toString() {
            return "pendingWhenHasApproved=" + pendingWhenHasApproved
                    + ", multiApprovedAnimals=" + multiApprovedAnimals
                    + ", animalStateMismatch=" + animalStateMismatch
                    + ", orphanApplying=" + orphanApplying;
        }
    }
}
