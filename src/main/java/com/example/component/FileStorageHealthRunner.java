package com.example.component;

import com.example.common.FileStorage;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.annotation.Order;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/**
 * 启动时记录上传目录并写入 app_schema_meta，便于运维确认「文件落盘位置」不漂移。
 */
@Slf4j
@Component
@Order(5)
public class FileStorageHealthRunner implements ApplicationRunner {

    private final FileStorage fileStorage;
    private final JdbcTemplate jdbcTemplate;

    public FileStorageHealthRunner(FileStorage fileStorage, JdbcTemplate jdbcTemplate) {
        this.fileStorage = fileStorage;
        this.jdbcTemplate = jdbcTemplate;
    }

    @Override
    public void run(ApplicationArguments args) {
        String abs = fileStorage.getRootAbsolutePath();
        log.info("FileStorageHealth: uploadRoot={}", abs);
        try {
            jdbcTemplate.execute(
                    "CREATE TABLE IF NOT EXISTS app_schema_meta ("
                            + "meta_key VARCHAR(64) NOT NULL PRIMARY KEY,"
                            + "meta_value VARCHAR(512) NOT NULL,"
                            + "updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP"
                            + ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
            // 路径可能较长，截断写入 meta
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
