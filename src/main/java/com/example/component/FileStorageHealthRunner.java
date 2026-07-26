package com.example.component;

import com.example.common.FileStorage;
import com.example.common.StartupMutationPolicy;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.annotation.Order;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/**
 * 启动时记录上传目录；仅在允许启动写库时写入 app_schema_meta。
 */
@Slf4j
@Component
@Order(5)
public class FileStorageHealthRunner implements ApplicationRunner {

    private final FileStorage fileStorage;
    private final JdbcTemplate jdbcTemplate;
    private final StartupMutationPolicy mutationPolicy;

    public FileStorageHealthRunner(FileStorage fileStorage,
                                   JdbcTemplate jdbcTemplate,
                                   StartupMutationPolicy mutationPolicy) {
        this.fileStorage = fileStorage;
        this.jdbcTemplate = jdbcTemplate;
        this.mutationPolicy = mutationPolicy;
    }

    @Override
    public void run(ApplicationArguments args) {
        String abs = fileStorage.getRootAbsolutePath();
        log.info("FileStorageHealth: uploadRoot={}", abs);
        if (!mutationPolicy.isMutationsAllowed()) {
            log.info("FileStorageHealth pure-check：仅记录路径，不写 app_schema_meta");
            return;
        }
        try {
            jdbcTemplate.execute(
                    "CREATE TABLE IF NOT EXISTS app_schema_meta ("
                            + "meta_key VARCHAR(64) NOT NULL PRIMARY KEY,"
                            + "meta_value VARCHAR(512) NOT NULL,"
                            + "updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP"
                            + ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
            String meta = abs.length() > 500 ? abs.substring(0, 500) : abs;
            jdbcTemplate.update(
                    "INSERT INTO app_schema_meta (meta_key, meta_value) VALUES ('upload_root', ?) "
                            + "ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value)",
                    meta);
        } catch (Exception e) {
            log.warn("写入 upload_root meta 失败: {}", e.getMessage());
        }
    }
}
