package com.example.controller;

import cn.hutool.core.io.FileUtil;
import cn.hutool.core.util.StrUtil;
import cn.hutool.log.Log;
import cn.hutool.log.LogFactory;
import com.example.common.Result;
import com.example.dto.FileVO;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.multipart.MultipartHttpServletRequest;

import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import java.io.File;
import java.io.OutputStream;
import java.net.URLEncoder;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.UUID;
import java.util.regex.Pattern;

@RestController
@RequestMapping("/api/files")
public class FileController {

    private static final Log log = LogFactory.get();
    private static final Pattern SAFE_FLAG_PATTERN = Pattern.compile("^[a-zA-Z0-9\\-]{1,64}$");

    @Value("${file.upload-dir:upload}")
    private String uploadDir;

    @PostMapping("/upload")
    public Result<FileVO> upload(MultipartFile file, HttpServletRequest request) {
        log.info("文件上传请求 - 用户: {}, 文件名: {}, 大小: {}bytes",
                request.getSession().getAttribute("user"),
                file.getOriginalFilename(),
                file.getSize());
        FileVO fileVO = doUpload(file);
        if (fileVO == null) {
            log.warn("文件上传失败 - 文件名: {}", file.getOriginalFilename());
            return Result.error("500", "文件上传失败");
        }
        log.info("文件上传成功 - flag: {}, 文件名: {}", fileVO.getFlag(), fileVO.getFileName());
        return Result.success(fileVO);
    }

    @PostMapping("/upload/multiple")
    public Result<List<FileVO>> multipleUpload(HttpServletRequest request) {
        List<MultipartFile> files = ((MultipartHttpServletRequest) request).getFiles("files");
        log.info("批量文件上传请求 - 文件数量: {}", files.size());
        List<FileVO> fileVOS = new ArrayList<>();
        for (MultipartFile file : files) {
            if (file.isEmpty()) {
                continue;
            }
            FileVO fileVO = doUpload(file);
            if (fileVO != null) {
                fileVOS.add(fileVO);
            }
        }
        log.info("批量文件上传完成 - 成功数量: {}", fileVOS.size());
        return Result.success(fileVOS);
    }

    @GetMapping("/{flag}")
    public void getFile(@PathVariable String flag, HttpServletResponse response, HttpServletRequest request) {
        if (!isValidFlag(flag)) {
            log.warn("非法文件访问参数 - flag: {}, IP: {}", flag, request.getRemoteAddr());
            response.setStatus(HttpServletResponse.SC_BAD_REQUEST);
            return;
        }

        List<String> searchDirs = Arrays.asList(
                uploadDir,
                System.getProperty("user.dir") + "/src/main/resources/static/file"
        );

        for (String dirPath : searchDirs) {
            try {
                File dir = new File(dirPath);
                if (!dir.isDirectory() || !dir.exists()) {
                    continue;
                }

                String[] fileNames = dir.list();
                if (fileNames == null || fileNames.length == 0) {
                    continue;
                }

                String matched = Arrays.stream(fileNames)
                        .filter(name -> name.contains(flag))
                        .findAny().orElse("");
                if (StrUtil.isEmpty(matched)) {
                    continue;
                }

                Path resolvedPath = Paths.get(dirPath, matched).normalize();
                Path dirPathNormalized = Paths.get(dirPath).normalize();
                if (!resolvedPath.startsWith(dirPathNormalized)) {
                    log.warn("路径遍历攻击尝试 - flag: {}, 解析路径: {}, IP: {}",
                            flag, resolvedPath, request.getRemoteAddr());
                    response.setStatus(HttpServletResponse.SC_FORBIDDEN);
                    return;
                }

                File targetFile = resolvedPath.toFile();
                if (!targetFile.exists() || !targetFile.isFile()) {
                    continue;
                }

                log.info("文件下载 - flag: {}, 文件: {}, IP: {}", flag, matched, request.getRemoteAddr());
                try (OutputStream os = response.getOutputStream()) {
                    response.setContentType("application/octet-stream");
                    response.addHeader("Content-Disposition", "attachment;filename=" + URLEncoder.encode(matched, "UTF-8"));
                    os.write(FileUtil.readBytes(targetFile));
                    os.flush();
                }
                return;
            } catch (Exception e) {
                log.error("文件读取异常 - flag: {}, dirPath: {}", flag, dirPath, e);
            }
        }

        log.warn("文件未找到 - flag: {}, IP: {}", flag, request.getRemoteAddr());
        response.setStatus(HttpServletResponse.SC_NOT_FOUND);
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

    private FileVO doUpload(MultipartFile file) {
        String originalName = file.getOriginalFilename();
        String flag = UUID.randomUUID().toString().replace("-", "");
        String safeName = sanitizeFileName(originalName);
        String storedName = flag + "-" + safeName;
        try {
            File dir = new File(uploadDir);
            if (!dir.isDirectory()) {
                dir.mkdirs();
            }
            FileUtil.writeBytes(file.getBytes(), new File(dir, storedName));
            FileVO vo = new FileVO();
            vo.setFlag(flag);
            vo.setFileName(originalName);
            return vo;
        } catch (Exception e) {
            log.error("文件保存异常 - 原始文件名: {}", originalName, e);
            return null;
        }
    }

    private String sanitizeFileName(String fileName) {
        if (StrUtil.isBlank(fileName)) {
            return "unknown";
        }
        return fileName.replaceAll("[^a-zA-Z0-9.\\-_\\u4e00-\\u9fa5]", "_");
    }

}
