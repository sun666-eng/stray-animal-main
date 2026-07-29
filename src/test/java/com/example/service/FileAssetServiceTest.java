package com.example.service;

import com.example.entity.FileAsset;
import com.example.entity.Permission;
import com.example.entity.User;
import com.example.exception.CustomException;
import org.junit.jupiter.api.Test;

import java.io.ByteArrayInputStream;
import java.util.Base64;
import java.util.Collections;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

public class FileAssetServiceTest {

    private final FileAssetService service = new FileAssetService();

    @Test
    public void animalUploadIsPrivateUntilBound() {
        assertEquals(FileAssetService.VIS_PRIVATE, service.visibilityForPurpose("animal"));
        assertEquals(FileAssetService.VIS_PRIVATE, service.visibilityForPurpose("proof"));
    }

    @Test
    public void avatarUploadVisibilityIsPrivateUntilBound() {
        // 上传时 private；绑定后由 bindToBusiness 改 public
        assertEquals(FileAssetService.VIS_PRIVATE, service.visibilityForPurpose("avatar"));
    }

    @Test
    public void ownerCanReadPrivate() {
        FileAsset asset = new FileAsset();
        asset.setVisibility(FileAssetService.VIS_PRIVATE);
        asset.setOwnerId(5L);
        asset.setDeleted(0);
        User owner = new User();
        owner.setId(5L);
        assertTrue(service.canRead(owner, asset));
        User other = new User();
        other.setId(6L);
        assertFalse(service.canRead(other, asset));
    }

    @Test
    public void proofAdminCannotReadUnboundPrivateProof() {
        FileAsset asset = new FileAsset();
        asset.setVisibility(FileAssetService.VIS_PRIVATE);
        asset.setOwnerId(5L);
        asset.setPurpose("proof");
        asset.setDeleted(0);
        User admin = new User();
        admin.setId(9L);
        Permission p = new Permission();
        p.setFlag("proof");
        admin.setPermission(Collections.singletonList(p));
        assertFalse(service.canRead(admin, asset));
    }

    @Test
    public void nullAsset_failClosed() {
        assertFalse(service.canRead(null, null));
        User u = new User();
        u.setId(1L);
        assertFalse(service.canRead(u, null));
    }

    @Test
    public void deletedAsset_failClosed() {
        FileAsset asset = new FileAsset();
        asset.setVisibility(FileAssetService.VIS_PUBLIC);
        asset.setDeleted(1);
        User u = new User();
        u.setId(1L);
        assertFalse(service.canRead(u, asset));
    }

    @Test
    public void normalUser_cannotDeclareAnimalPurpose() {
        User user = new User();
        user.setId(2L);
        assertThrows(CustomException.class, () -> service.resolvePurposeForUpload(user, "animal"));
    }

    @Test
    public void loggedInUser_canUploadProofPrivate() {
        User user = new User();
        user.setId(2L);
        assertEquals("proof", service.resolvePurposeForUpload(user, "proof"));
    }

    @Test
    public void animalAdmin_canUploadAnimal() {
        User admin = new User();
        admin.setId(1L);
        Permission p = new Permission();
        p.setFlag("animal");
        admin.setPermission(Collections.singletonList(p));
        assertEquals("animal", service.resolvePurposeForUpload(admin, "animal"));
    }

    @Test
    public void operationalAttachmentsRequireMatchingAdminPermission() {
        User normal = new User();
        normal.setId(2L);
        assertEquals("403", assertThrows(CustomException.class,
                () -> service.resolvePurposeForUpload(normal, "medical")).getCode());
        assertEquals("403", assertThrows(CustomException.class,
                () -> service.resolvePurposeForUpload(normal, "account")).getCode());

        User animalAdmin = new User();
        animalAdmin.setId(3L);
        Permission animal = new Permission();
        animal.setFlag("animal");
        animalAdmin.setPermission(Collections.singletonList(animal));
        assertEquals("medical", service.resolvePurposeForUpload(animalAdmin, "medical"));
    }

    @Test
    public void avatar_imageOnly_rejectsPdf() {
        CustomException ex = assertThrows(CustomException.class,
                () -> service.assertImageExtension("report.pdf", "avatar"));
        assertEquals("400", ex.getCode());
    }

    @Test
    public void avatar_imageOnly_acceptsPng() {
        service.assertImageExtension("face.png", "avatar");
        service.assertImageExtension("face.JPG", "avatar");
    }

    @Test
    public void volunteer_imageOnly_rejectsPdfAndAcceptsImage() {
        CustomException ex = assertThrows(CustomException.class,
                () -> service.assertImageExtension("application.pdf", "volunteer"));
        assertEquals("400", ex.getCode());
        service.assertImageExtension("application.webp", "volunteer");
    }

    @Test
    public void avatar_renamedArbitraryBytes_areRejected() {
        CustomException ex = assertThrows(CustomException.class,
                () -> service.validateImageContent("face.png", "avatar",
                        new ByteArrayInputStream(new byte[]{1, 2, 3, 4})));
        assertEquals("400", ex.getCode());
    }

    @Test
    public void volunteer_validTinyPng_isDecoded() {
        byte[] png = Base64.getDecoder().decode(
                "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=");
        service.validateImageContent("portrait.png", "volunteer", new ByteArrayInputStream(png));
    }

    @Test
    public void avatar_webpWithoutJavaReader_isRejectedClearly() {
        CustomException ex = assertThrows(CustomException.class,
                () -> service.validateImageContent("face.webp", "avatar",
                        new ByteArrayInputStream(new byte[]{'R', 'I', 'F', 'F'})));
        assertEquals("400", ex.getCode());
        assertTrue(ex.getMsg().contains("webp"));
    }

    @Test
    public void proofAndVisitRequireDecodedImages() {
        assertThrows(CustomException.class,
                () -> service.assertImageExtension("scan.pdf", "proof"));
        assertThrows(CustomException.class,
                () -> service.assertImageExtension("report.xlsx", "visit"));
        assertThrows(CustomException.class,
                () -> service.validateImageContent("scan.png", "proof",
                        new ByteArrayInputStream("not an image".getBytes())));
    }

    @Test
    public void helpUpload_rejectsAdvertisedImageWithInvalidContent() {
        CustomException ex = assertThrows(CustomException.class,
                () -> service.validateImageContent("rescue.png", "help",
                        new ByteArrayInputStream("not an image".getBytes())));
        assertEquals("400", ex.getCode());
    }

    @Test
    public void normalizePurpose_unknownBecomesPrivate() {
        assertEquals("private", service.normalizePurpose("evil"));
        assertEquals("private", service.normalizePurpose(null));
        assertEquals("proof", service.normalizePurpose("PROOF"));
    }

    @Test
    public void anonymous_cannotUploadAvatar() {
        assertThrows(CustomException.class, () -> service.resolvePurposeForUpload(null, "avatar"));
    }

    @Test
    public void anonymous_cannotUploadPrivate() {
        assertThrows(CustomException.class, () -> service.resolvePurposeForUpload(null, "proof"));
    }

    @Test
    public void noticePurposeIsRetired_fallsBackToPrivate() {
        // 审计修复 L6：notice 用途已移除（无绑定点的死分支），归一化回退到 private
        User user = new User();
        user.setId(3L);
        assertEquals("private", service.resolvePurposeForUpload(user, "notice"));
    }

    @Test
    public void isImageName_detectsCommonFormats() {
        assertTrue(service.isImageName("a.PNG"));
        assertFalse(service.isImageName("a.pdf"));
        assertFalse(service.isImageName("noext"));
    }
}
