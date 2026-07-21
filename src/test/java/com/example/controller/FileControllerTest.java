package com.example.controller;

import com.example.common.FileStorage;
import com.example.common.Result;
import com.example.dto.FileVO;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockMultipartFile;

import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

public class FileControllerTest {

    @TempDir
    Path tempDir;

    private FileController controller() {
        return new FileController(FileStorage.forTest(tempDir));
    }

    @Test
    public void upload_rejectsEmptyFile() {
        FileController controller = controller();
        Result<FileVO> result = controller.upload(
                new MockMultipartFile("file", "a.png", "image/png", new byte[0]),
                new MockHttpServletRequest());
        assertEquals("400", result.getCode());
    }

    @Test
    public void upload_acceptsAllowedExtension_andWritesUnderAbsoluteRoot() throws Exception {
        FileController controller = controller();
        Result<FileVO> result = controller.upload(
                new MockMultipartFile("file", "a.png", "image/png", new byte[]{1, 2, 3}),
                new MockHttpServletRequest());

        assertEquals("0", result.getCode());
        assertNotNull(result.getData().getFlag());
        String flag = result.getData().getFlag();
        boolean found = Files.list(tempDir)
                .anyMatch(p -> p.getFileName().toString().startsWith(flag + "-"));
        assertTrue(found, "uploaded file should exist under absolute root");
        assertTrue(tempDir.isAbsolute());
    }
}
