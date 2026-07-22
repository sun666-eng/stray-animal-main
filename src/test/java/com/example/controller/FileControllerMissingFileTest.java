package com.example.controller;

import com.example.common.FileStorage;
import com.example.entity.FileAsset;
import com.example.entity.User;
import com.example.service.FileAssetService;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

public class FileControllerMissingFileTest {
    @TempDir Path tempDir;

    @Test
    public void getFile_readableButMissingPhysical_returns404_forProof() throws Exception {
        FileAssetService assets = mock(FileAssetService.class);
        FileAsset asset = new FileAsset();
        asset.setFlag("abc");
        asset.setPurpose("proof");
        asset.setVisibility("private");
        asset.setStoredName("abc-missing.pdf");
        asset.setDeleted(0);
        when(assets.findByFlag("abc")).thenReturn(asset);
        when(assets.canRead(any(), eq(asset))).thenReturn(true);
        FileController controller = new FileController(FileStorage.forTest(tempDir), assets);
        MockHttpServletResponse response = new MockHttpServletResponse();
        MockHttpServletRequest request = new MockHttpServletRequest();
        User u = new User();
        u.setId(1L);
        request.getSession(true).setAttribute("user", u);
        controller.getFile("abc", response, request);
        assertEquals(404, response.getStatus());
    }
}
