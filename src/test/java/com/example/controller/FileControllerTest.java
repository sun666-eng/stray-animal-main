package com.example.controller;

import com.example.common.FileStorage;
import com.example.common.Result;
import com.example.dto.FileVO;
import com.example.entity.FileAsset;
import com.example.entity.User;
import com.example.exception.CustomException;
import com.example.service.FileAssetService;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.mock.web.MockMultipartFile;

import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

public class FileControllerTest {

    @TempDir
    Path tempDir;

    private FileController controller(FileAssetService assets) {
        return new FileController(FileStorage.forTest(tempDir), assets);
    }

    @Test
    public void upload_rejectsEmptyFile() {
        FileAssetService assets = mock(FileAssetService.class);
        FileController controller = controller(assets);
        Result<FileVO> result = controller.upload(
                new MockMultipartFile("file", "a.png", "image/png", new byte[0]),
                "animal",
                new MockHttpServletRequest());
        assertEquals("400", result.getCode());
    }

    @Test
    public void upload_acceptsAllowedExtension_andWritesUnderAbsoluteRoot() throws Exception {
        FileAssetService assets = mock(FileAssetService.class);
        when(assets.resolvePurposeForUpload(any(), eq("animal"))).thenReturn("animal");
        when(assets.recordUpload(anyString(), anyString(), anyString(), any(), anyString(), anyString(), anyLong()))
                .thenReturn(new FileAsset());
        FileController controller = controller(assets);
        MockHttpServletRequest request = new MockHttpServletRequest();
        User u = new User();
        u.setId(9L);
        request.getSession(true).setAttribute("user", u);
        request.setAttribute("userId", 9L);
        Result<FileVO> result = controller.upload(
                new MockMultipartFile("file", "a.png", "image/png", new byte[]{1, 2, 3}),
                "animal",
                request);

        assertEquals("0", result.getCode());
        assertNotNull(result.getData().getFlag());
        String flag = result.getData().getFlag();
        boolean found = Files.list(tempDir)
                .anyMatch(p -> p.getFileName().toString().equals(flag + ".png"));
        assertTrue(found, "uploaded file should exist under absolute root");
    }

    @Test
    public void upload_purposeDenied_returns403() {
        FileAssetService assets = mock(FileAssetService.class);
        when(assets.resolvePurposeForUpload(any(), eq("animal")))
                .thenThrow(new CustomException("403", "无权上传该公开用途文件"));
        FileController controller = controller(assets);
        MockHttpServletRequest request = new MockHttpServletRequest();
        User u = new User();
        u.setId(2L);
        request.getSession(true).setAttribute("user", u);
        Result<FileVO> result = controller.upload(
                new MockMultipartFile("file", "a.png", "image/png", new byte[]{1, 2, 3}),
                "animal",
                request);
        assertEquals("403", result.getCode());
    }

    @Test
    public void upload_invalidAvatarContent_isRejectedBeforeDiskAndMetadata() throws Exception {
        FileAssetService assets = mock(FileAssetService.class);
        when(assets.resolvePurposeForUpload(any(), eq("avatar"))).thenReturn("avatar");
        doThrow(new CustomException("400", "文件不是可解码的有效图片"))
                .when(assets).validateImageContent(eq("face.png"), eq("avatar"), any());
        MockHttpServletRequest request = new MockHttpServletRequest();
        User user = new User();
        user.setId(9L);
        request.getSession(true).setAttribute("user", user);

        Result<FileVO> result = controller(assets).upload(
                new MockMultipartFile("file", "face.png", "image/png", new byte[]{1, 2, 3}),
                "avatar", request);

        assertEquals("400", result.getCode());
        assertEquals(0L, Files.list(tempDir).count());
        verify(assets, never()).recordUpload(anyString(), anyString(), anyString(), any(),
                anyString(), anyString(), anyLong());
    }

    @Test
    public void getFile_deniesWhenNoMeta_failClosed() throws Exception {
        FileAssetService assets = mock(FileAssetService.class);
        when(assets.findByFlag("abc")).thenReturn(null);
        when(assets.canRead(any(), eq(null))).thenReturn(false);

        FileController controller = controller(assets);
        MockHttpServletResponse response = new MockHttpServletResponse();
        controller.getFile("abc", response, new MockHttpServletRequest());
        assertEquals(403, response.getStatus());
    }

    @Test
    public void getFile_metaQueryFails_returns503() throws Exception {
        FileAssetService assets = mock(FileAssetService.class);
        when(assets.findByFlag("abc")).thenThrow(new RuntimeException("db down"));

        FileController controller = controller(assets);
        MockHttpServletResponse response = new MockHttpServletResponse();
        controller.getFile("abc", response, new MockHttpServletRequest());
        assertEquals(503, response.getStatus());
        assertEquals("nosniff", response.getHeader("X-Content-Type-Options"));
    }

    @Test
    public void getFile_privateAsset_usesNoStoreHeadersAndOriginalDownloadName() throws Exception {
        FileAssetService assets = mock(FileAssetService.class);
        FileAsset asset = new FileAsset();
        asset.setFlag("abc");
        asset.setPurpose("visit");
        asset.setVisibility(FileAssetService.VIS_PRIVATE);
        asset.setStoredName("abc-internal.pdf");
        asset.setOriginalName("visit-report.pdf");
        asset.setDeleted(0);
        Files.write(tempDir.resolve("abc-internal.pdf"), new byte[]{1, 2, 3});
        when(assets.findByFlag("abc")).thenReturn(asset);
        when(assets.canRead(any(), eq(asset))).thenReturn(true);

        MockHttpServletRequest request = new MockHttpServletRequest();
        request.getSession(true).setAttribute("user", new User());
        MockHttpServletResponse response = new MockHttpServletResponse();
        controller(assets).getFile("abc", response, request);

        assertEquals(200, response.getStatus());
        assertEquals("no-store, no-cache, must-revalidate, max-age=0", response.getHeader("Cache-Control"));
        assertEquals("no-cache", response.getHeader("Pragma"));
        assertEquals("nosniff", response.getHeader("X-Content-Type-Options"));
        assertTrue(response.getHeader("Content-Disposition").contains("visit-report.pdf"));
        assertFalse(response.getHeader("Content-Disposition").contains("abc-internal.pdf"));
    }

    @Test
    public void getFile_publicAsset_alsoUsesNoStoreHeaders() throws Exception {
        FileAssetService assets = mock(FileAssetService.class);
        FileAsset asset = new FileAsset();
        asset.setFlag("abc");
        asset.setPurpose("animal");
        asset.setVisibility(FileAssetService.VIS_PUBLIC);
        asset.setStoredName("abc-animal.png");
        asset.setOriginalName("animal.png");
        asset.setDeleted(0);
        Files.write(tempDir.resolve("abc-animal.png"), new byte[]{1, 2, 3});
        when(assets.findByFlag("abc")).thenReturn(asset);
        when(assets.canRead(any(), eq(asset))).thenReturn(true);

        MockHttpServletResponse response = new MockHttpServletResponse();
        controller(assets).getFile("abc", response, new MockHttpServletRequest());

        assertEquals(200, response.getStatus());
        assertEquals("no-store, no-cache, must-revalidate, max-age=0", response.getHeader("Cache-Control"));
        assertEquals("no-cache", response.getHeader("Pragma"));
        assertEquals("nosniff", response.getHeader("X-Content-Type-Options"));
    }

    @Test
    public void getRoot_defaultAvatarUsesNoStoreAndNosniff() {
        MockHttpServletResponse response = new MockHttpServletResponse();

        controller(mock(FileAssetService.class)).getRoot(response);

        assertEquals("no-store, no-cache, must-revalidate, max-age=0", response.getHeader("Cache-Control"));
        assertEquals("nosniff", response.getHeader("X-Content-Type-Options"));
    }
}
