package com.example.common;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import jakarta.annotation.PostConstruct;
import java.io.File;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * 上传目录单一事实来源：始终解析为绝对路径，启动时创建并可写检测。
 * 默认：{@code ${user.home}/.stray-animal/upload}，可用 FILE_UPLOAD_DIR 覆盖。
 */
@Slf4j
@Component
public class FileStorage {

    private final String configuredDir;
    private final String fallbackStaticDir;
    private Path root;

    @Autowired
    public FileStorage(
            @Value("${file.upload-dir:}") String configuredDir,
            @Value("${file.fallback-static-dir:}") String fallbackStaticDir) {
        this.configuredDir = configuredDir == null ? "" : configuredDir.trim();
        this.fallbackStaticDir = fallbackStaticDir == null ? "" : fallbackStaticDir.trim();
    }

    /** 单元测试工厂：不经 Spring */
    public static FileStorage forTest(Path absoluteRoot) {
        FileStorage storage = new FileStorage(absoluteRoot.toAbsolutePath().toString(), "");
        storage.init();
        return storage;
    }

    @PostConstruct
    public void init() {
        this.root = resolveRoot(configuredDir);
        try {
            Files.createDirectories(root);
        } catch (IOException e) {
            throw new IllegalStateException("无法创建上传目录: " + root + " — " + e.getMessage(), e);
        }
        File dir = root.toFile();
        if (!dir.isDirectory() || !dir.canWrite()) {
            throw new IllegalStateException("上传目录不可写: " + root.toAbsolutePath());
        }
        try {
            Path probe = root.resolve(".write-probe");
            Files.write(probe, new byte[]{1});
            Files.deleteIfExists(probe);
        } catch (IOException e) {
            throw new IllegalStateException("上传目录写入探针失败: " + root + " — " + e.getMessage(), e);
        }
        log.info("FileStorage 就绪: absoluteRoot={} (config='{}')", root.toAbsolutePath(), configuredDir);
    }

    static Path resolveRoot(String configured) {
        String raw = configured == null ? "" : configured.trim();
        if (raw.isEmpty()) {
            return Paths.get(System.getProperty("user.home"), ".stray-animal", "upload")
                    .toAbsolutePath().normalize();
        }
        Path p = Paths.get(raw);
        if (!p.isAbsolute()) {
            String safe = raw.replace("..", "_").replace("\\", "/");
            while (safe.startsWith("/")) {
                safe = safe.substring(1);
            }
            p = Paths.get(System.getProperty("user.home"), ".stray-animal", safe);
        }
        return p.toAbsolutePath().normalize();
    }

    public Path getRoot() {
        ensureInit();
        return root;
    }

    public File getRootFile() {
        return getRoot().toFile();
    }

    public String getRootAbsolutePath() {
        return getRoot().toAbsolutePath().toString();
    }

    public List<String> getReadSearchDirs() {
        ensureInit();
        List<String> dirs = new ArrayList<>();
        dirs.add(root.toAbsolutePath().toString());
        if (!fallbackStaticDir.isEmpty()) {
            dirs.add(Paths.get(fallbackStaticDir).toAbsolutePath().normalize().toString());
        }
        // 不再搜索 classpath static/file（会经 /file/** 匿名暴露且含历史敏感证照）。
        // 可选：项目根 legacy-uploads（仅 FileController 经鉴权后可读，不在 static 下）
        String legacy = System.getProperty("user.dir") + File.separator + "legacy-uploads";
        File legacyDir = new File(legacy);
        if (legacyDir.isDirectory()) {
            dirs.add(legacyDir.getAbsolutePath());
        }
        return Collections.unmodifiableList(dirs);
    }

    private void ensureInit() {
        if (root == null) {
            init();
        }
    }
}
