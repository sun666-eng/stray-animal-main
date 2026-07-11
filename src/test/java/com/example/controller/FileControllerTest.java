package com.example.controller;

import com.example.common.Result;
import com.example.dto.FileVO;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.util.ReflectionTestUtils;

import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;

public class FileControllerTest {

    @TempDir
    Path tempDir;

    @Test
    public void upload_rejectsEmptyFile() {
        FileController controller = new FileController();
        ReflectionTestUtils.setField(controller, "uploadDir", tempDir.toString());

        Result<FileVO> result = controller.upload(new MockMultipartFile("file", "a.png", "image/png", new byte[0]), new MockHttpServletRequest());

        assertEquals("400", result.getCode());
    }

    @Test
    public void upload_acceptsAllowedExtension() {
        FileController controller = new FileController();
        ReflectionTestUtils.setField(controller, "uploadDir", tempDir.toString());

        Result<FileVO> result = controller.upload(new MockMultipartFile("file", "a.png", "image/png", new byte[]{1, 2, 3}), new MockHttpServletRequest());

        assertEquals("0", result.getCode());
        assertNotNull(result.getData().getFlag());
    }
}
