package com.example.controller;

import cn.hutool.core.io.FileUtil;
import cn.hutool.core.util.StrUtil;
import cn.hutool.log.Log;
import cn.hutool.log.LogFactory;
import com.example.common.FileStorage;
import com.example.common.Result;
import com.example.dto.BatchUploadResult;
import com.example.dto.FileVO;
import com.example.entity.FileAsset;
import com.example.entity.User;
import com.example.exception.CustomException;
import com.example.service.FileAssetService;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.multipart.MultipartHttpServletRequest;

import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import java.io.File;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.URLEncoder;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import java.util.regex.Pattern;

@RestController
@RequestMapping("/api/files")
public class FileController {

    private static final Log log = LogFactory.get();
    private static final Pattern SAFE_FLAG_PATTERN = Pattern.compile("^[a-zA-Z0-9\\-]{1,64}$");
    private static final Pattern SAFE_STORED_NAME = Pattern.compile("^[a-zA-Z0-9.\\-_\\u4e00-\\u9fa5]{1,512}$");
    private static final List<String> ALLOWED_EXTENSIONS = Arrays.asList(
            "jpg", "jpeg", "png", "gif", "webp", "pdf", "xls", "xlsx"
    );

    private final FileStorage fileStorage;
    private final FileAssetService fileAssetService;

    public FileController(FileStorage fileStorage, FileAssetService fileAssetService) {
        this.fileStorage = fileStorage;
        this.fileAssetService = fileAssetService;
    }

    @PostMapping("/upload")
    public Result<FileVO> upload(@RequestParam("file") MultipartFile file,
                                 @RequestParam(value = "purpose", required = false) String purpose,
                                 HttpServletRequest request) {
        if (!isValidUpload(file)) {
            return Result.error("400", "文件不能为空或类型不允许");
        }
        User user = currentUser(request);
        String resolvedPurpose;
        try {
            resolvedPurpose = fileAssetService.resolvePurposeForUpload(user, purpose);
        } catch (CustomException e) {
            return Result.error(e.getCode(), e.getMsg());
        }
        Long ownerId = user != null ? user.getId() : null;
        log.info("文件上传请求 - 用户ID: {}, purpose: {}->{}, 文件名: {}, 大小: {}bytes",
                ownerId, purpose, resolvedPurpose, file.getOriginalFilename(), file.getSize());
        try {
            FileVO fileVO = doUpload(file, ownerId, resolvedPurpose, file.getContentType());
            return Result.success(fileVO);
        } catch (CustomException e) {
            return Result.error(e.getCode(), e.getMsg());
        } catch (Exception e) {
            log.error("文件上传失败", e);
            return Result.error("500", "文件上传失败");
        }
    }

    @DeleteMapping("/staged/{flag}")
    public Result<Boolean> retireStaged(@PathVariable String flag, HttpServletRequest request) {
        if (!isValidFlag(flag)) {
            return Result.error("400", "文件标识无效");
        }
        return Result.success(fileAssetService.retireOwnUnbound(currentUser(request), flag));
    }

    @PostMapping("/upload/multiple")
    public Result<BatchUploadResult> multipleUpload(
            @RequestParam(value = "purpose", required = false) String purpose,
            HttpServletRequest request) {
        List<MultipartFile> files = ((MultipartHttpServletRequest) request).getFiles("files");
        User user = currentUser(request);
        String resolvedPurpose;
        try {
            resolvedPurpose = fileAssetService.resolvePurposeForUpload(user, purpose);
        } catch (CustomException e) {
            return Result.error(e.getCode(), e.getMsg());
        }
        Long ownerId = user != null ? user.getId() : null;
        BatchUploadResult batch = new BatchUploadResult();
        batch.setTotal(files == null ? 0 : files.size());
        if (files == null || files.isEmpty()) {
            return Result.success(batch);
        }
        for (MultipartFile file : files) {
            String name = file == null ? "" : file.getOriginalFilename();
            if (!isValidUpload(file)) {
                batch.addFailure(name, "文件为空或扩展名不允许");
                continue;
            }
            try {
                FileVO fileVO = doUpload(file, ownerId, resolvedPurpose, file.getContentType());
                batch.addSuccess(fileVO);
            } catch (CustomException e) {
                log.warn("批量上传单文件业务失败: {} - {}", name, e.getMsg());
                batch.addFailure(name, e.getMsg());
            } catch (Exception e) {
                log.warn("批量上传单文件失败: {} - {}", name, e.getMessage());
                batch.addFailure(name, "上传失败");
            }
        }
        return Result.success(batch);
    }

    @GetMapping({"", "/"})
    public void getRoot(HttpServletResponse response) {
        applyFileResponseHeaders(response);
        writeDefaultAvatar(response);
    }

    @GetMapping("/{flag}")
    public void getFile(@PathVariable String flag, HttpServletResponse response, HttpServletRequest request) {
        applyFileResponseHeaders(response);
        if (!isValidFlag(flag) || "null".equalsIgnoreCase(flag) || "undefined".equalsIgnoreCase(flag)) {
            // 仅用于页面坏图占位；非业务附件
            writeDefaultAvatar(response);
            return;
        }

        FileAsset asset;
        try {
            asset = fileAssetService.findByFlag(flag);
        } catch (Exception e) {
            log.error("查询文件元数据失败 - fail-closed: {}", e.getMessage());
            response.setStatus(HttpServletResponse.SC_SERVICE_UNAVAILABLE);
            writeJson(response, "503", "文件服务暂不可用");
            return;
        }

        User user = currentUser(request);
        if (!fileAssetService.canRead(user, asset)) {
            response.setStatus(HttpServletResponse.SC_FORBIDDEN);
            writeJson(response, "403", "无权访问该文件或文件未登记");
            return;
        }

        Path filePath = resolvePhysicalFile(asset, flag);
        if (filePath == null) {
            // 附件缺失：404；仅头像用途回退占位图避免 UI 裂图
            if (asset != null && "avatar".equalsIgnoreCase(asset.getPurpose())) {
                writeDefaultAvatar(response);
                return;
            }
            response.setStatus(HttpServletResponse.SC_NOT_FOUND);
            writeJson(response, "404", "文件不存在");
            return;
        }

        try (InputStream input = Files.newInputStream(filePath);
             OutputStream os = response.getOutputStream()) {
            String name = StrUtil.isBlank(asset.getOriginalName())
                    ? "download"
                    : sanitizeFileName(asset.getOriginalName());
            String contentType = resolveContentType(asset, filePath, name);
            response.setContentType(contentType);
            boolean inlineImage = contentType != null && contentType.startsWith("image/");
            String disposition = (inlineImage ? "inline" : "attachment")
                    + ";filename=" + URLEncoder.encode(name, "UTF-8");
            response.setHeader("Content-Disposition", disposition);
            long size = Files.size(filePath);
            if (size >= 0 && size <= Integer.MAX_VALUE) {
                response.setContentLengthLong(size);
            }
            byte[] buffer = new byte[8192];
            int length;
            while ((length = input.read(buffer)) >= 0) {
                os.write(buffer, 0, length);
            }
            os.flush();
        } catch (Exception e) {
            log.error("文件读取异常 - flag: {}", flag, e);
            response.setStatus(HttpServletResponse.SC_INTERNAL_SERVER_ERROR);
            writeJson(response, "500", "文件读取失败");
        }
    }

    private String resolveContentType(FileAsset asset, Path filePath, String fileName) {
        if (asset != null && StrUtil.isNotBlank(asset.getContentType())
                && asset.getContentType().toLowerCase(Locale.ROOT).startsWith("image/")) {
            return asset.getContentType();
        }
        String lower = fileName == null ? "" : fileName.toLowerCase(Locale.ROOT);
        if (lower.endsWith(".png")) {
            return "image/png";
        }
        if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) {
            return "image/jpeg";
        }
        if (lower.endsWith(".gif")) {
            return "image/gif";
        }
        if (lower.endsWith(".webp")) {
            return "image/webp";
        }
        try {
            String probed = Files.probeContentType(filePath);
            if (probed != null && !probed.isEmpty()) {
                return probed;
            }
        } catch (Exception ignored) {
            // fall through
        }
        return "application/octet-stream";
    }

    /**
     * 优先 stored_name 精确路径；仅迁移占位名 *-legacy 或缺名时做一次 flag- 前缀恢复。
     */
    private Path resolvePhysicalFile(FileAsset asset, String flag) {
        List<String> searchDirs = fileStorage.getReadSearchDirs();
        String stored = asset == null ? null : asset.getStoredName();

        if (StrUtil.isNotBlank(stored) && isSafeStoredName(stored) && !stored.endsWith("-legacy")) {
            Path exact = findExact(searchDirs, stored);
            if (exact != null) {
                return exact;
            }
        }

        // 仅迁移占位名 / 缺名允许 flag 前缀恢复；真实 stored_name 精确失败必须 404
        if (StrUtil.isBlank(stored) || stored.endsWith("-legacy")) {
            Path recovered = findByFlagPrefix(searchDirs, flag);
            if (recovered != null) {
                log.warn("legacy 前缀恢复 flag={}", flag);
                return recovered;
            }
        }
        return null;
    }

    private Path findExact(List<String> searchDirs, String storedName) {
        for (String dirPath : searchDirs) {
            try {
                Path dir = Paths.get(dirPath).normalize();
                Path resolved = dir.resolve(storedName).normalize();
                if (!resolved.startsWith(dir)) {
                    continue;
                }
                if (Files.isRegularFile(resolved)) {
                    return resolved;
                }
            } catch (Exception e) {
                log.warn("精确读文件失败 dir={} name={}", dirPath, storedName);
            }
        }
        return null;
    }

    private Path findByFlagPrefix(List<String> searchDirs, String flag) {
        for (String dirPath : searchDirs) {
            try {
                File dir = new File(dirPath);
                if (!dir.isDirectory() || !dir.exists()) {
                    continue;
                }
                String[] fileNames = dir.list();
                if (fileNames == null) {
                    continue;
                }
                String matched = Arrays.stream(fileNames)
                        .filter(name -> name.startsWith(flag + "-"))
                        .findFirst().orElse("");
                if (StrUtil.isEmpty(matched)) {
                    continue;
                }
                Path dirNorm = Paths.get(dirPath).normalize();
                Path resolved = dirNorm.resolve(matched).normalize();
                if (!resolved.startsWith(dirNorm)) {
                    continue;
                }
                if (Files.isRegularFile(resolved)) {
                    return resolved;
                }
            } catch (Exception e) {
                log.warn("前缀扫描失败 dir={} flag={}", dirPath, flag);
            }
        }
        return null;
    }

    private boolean isSafeStoredName(String name) {
        if (StrUtil.isBlank(name)) {
            return false;
        }
        if (name.contains("..") || name.contains("/") || name.contains("\\")) {
            return false;
        }
        return SAFE_STORED_NAME.matcher(name).matches();
    }

    private User currentUser(HttpServletRequest request) {
        Object sessionUser = request.getSession(false) == null
                ? null
                : request.getSession(false).getAttribute("user");
        if (sessionUser instanceof User) {
            return (User) sessionUser;
        }
        return null;
    }

    private void writeJson(HttpServletResponse response, String code, String msg) {
        try {
            response.setContentType("application/json;charset=UTF-8");
            response.getWriter().write("{\"code\":\"" + code + "\",\"msg\":\"" + msg + "\"}");
        } catch (Exception ignored) {
            // no-op
        }
    }

    private void writeDefaultAvatar(HttpServletResponse response) {
        String svg = "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 80 80' width='80' height='80'>"
                + "<circle cx='40' cy='40' r='40' fill='#E5E7EB'/>"
                + "<circle cx='40' cy='30' r='14' fill='#9CA3AF'/>"
                + "<path d='M16 70 Q40 50 64 70 L64 80 L16 80 Z' fill='#9CA3AF'/>"
                + "</svg>";
        try {
            response.setContentType("image/svg+xml;charset=UTF-8");
            response.setStatus(HttpServletResponse.SC_OK);
            response.getWriter().write(svg);
        } catch (Exception e) {
            log.error("写默认头像失败", e);
        }
    }

    private void applyFileResponseHeaders(HttpServletResponse response) {
        response.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
        response.setHeader("Pragma", "no-cache");
        response.setHeader("X-Content-Type-Options", "nosniff");
    }

    private boolean isValidFlag(String flag) {
        if (StrUtil.isBlank(flag)) {
            return false;
        }
        if (flag.contains("..") || flag.contains("/") || flag.contains("\\")) {
            return false;
        }
        return SAFE_FLAG_PATTERN.matcher(flag).matches();
    }

    private synchronized FileVO doUpload(MultipartFile file, Long ownerId, String purpose, String contentType) throws Exception {
        fileAssetService.assertStagedQuota(ownerId, 1, file.getSize());
        String originalName = file.getOriginalFilename();
        try (InputStream input = file.getInputStream()) {
            fileAssetService.validateImageContent(originalName, purpose, input);
        }
        String flag = UUID.randomUUID().toString().replace("-", "");
        String extension = FileUtil.extName(originalName).toLowerCase();
        String storedName = flag + "." + extension;
        File dir = fileStorage.getRootFile();
        if (!dir.isDirectory()) {
            //noinspection ResultOfMethodCallIgnored
            dir.mkdirs();
        }
        File target = new File(dir, storedName);
        FileUtil.writeBytes(file.getBytes(), target);
        try {
            fileAssetService.recordUpload(flag, storedName, originalName, ownerId, purpose,
                    contentType, file.getSize());
        } catch (Exception e) {
            try {
                Files.deleteIfExists(target.toPath());
            } catch (Exception ignored) {
                // no-op
            }
            log.error("元数据写入失败，已回滚磁盘文件: {}", e.getMessage());
            if (e instanceof CustomException) {
                throw e;
            }
            throw new CustomException("500", "文件元数据写入失败");
        }
        FileVO vo = new FileVO();
        vo.setFlag(flag);
        vo.setFileName(originalName);
        return vo;
    }

    private boolean isValidUpload(MultipartFile file) {
        if (file == null || file.isEmpty()) {
            return false;
        }
        String originalName = file.getOriginalFilename();
        if (StrUtil.isBlank(originalName)) {
            return false;
        }
        String ext = FileUtil.extName(originalName);
        return ext != null && ALLOWED_EXTENSIONS.contains(ext.toLowerCase());
    }

    private String sanitizeFileName(String fileName) {
        if (StrUtil.isBlank(fileName)) {
            return "unknown";
        }
        return fileName.replaceAll("[^a-zA-Z0-9.\\-_\\u4e00-\\u9fa5]", "_");
    }
}
