package com.example.common;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Path;
import java.nio.file.Paths;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

public class FileStorageTest {

    @TempDir
    Path tempDir;

    @Test
    public void resolveRoot_empty_usesUserHome() {
        Path p = FileStorage.resolveRoot("");
        assertTrue(p.isAbsolute());
        String s = p.toString().replace('\\', '/');
        assertTrue(s.contains(".stray-animal") && s.contains("upload"));
    }

    @Test
    public void resolveRoot_relative_anchorsUnderHome() {
        Path p = FileStorage.resolveRoot("rel-upload");
        assertTrue(p.isAbsolute());
        assertFalse(p.equals(Paths.get("rel-upload")));
        assertTrue(p.toString().contains("rel-upload") || p.toString().contains("stray-animal"));
    }

    @Test
    public void resolveRoot_absolute_kept() {
        Path abs = tempDir.toAbsolutePath();
        Path p = FileStorage.resolveRoot(abs.toString());
        assertTrue(p.isAbsolute());
        assertTrue(p.normalize().equals(abs.normalize()));
    }
}
