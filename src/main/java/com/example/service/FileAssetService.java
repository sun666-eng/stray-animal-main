package com.example.service;

import com.baomidou.mybatisplus.core.conditions.update.UpdateWrapper;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.example.common.PermissionUtil;
import com.example.entity.FileAsset;
import com.example.entity.Help;
import com.example.entity.Proof;
import com.example.entity.User;
import com.example.entity.Visit;
import com.example.entity.Volunteer;
import com.example.exception.CustomException;
import com.example.common.FileStorage;
import com.example.mapper.FileAssetMapper;
import com.example.mapper.HelpMapper;
import com.example.mapper.ProofMapper;
import com.example.mapper.UserMapper;
import com.example.mapper.VisitMapper;
import com.example.mapper.VolunteerMapper;
import com.example.mapper.AccountMapper;
import com.example.entity.Account;
import org.springframework.stereotype.Service;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import javax.imageio.ImageIO;
import javax.imageio.ImageReader;
import javax.imageio.stream.ImageInputStream;
import jakarta.annotation.Resource;
import java.awt.image.BufferedImage;
import java.io.IOException;
import java.io.InputStream;
import java.util.Arrays;
import java.util.Date;
import java.util.HashSet;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.Set;

@Service
public class FileAssetService extends ServiceImpl<FileAssetMapper, FileAsset> {

    @Value("${app.file.staged-retention-hours:24}")
    private long stagedRetentionHours;

    @Value("${app.file.staged-cleanup-enabled:true}")
    private boolean stagedCleanupEnabled;

    @Value("${app.file.max-staged-files-per-user:20}")
    private long maxStagedFilesPerUser;

    @Value("${app.file.max-staged-bytes-per-user:104857600}")
    private long maxStagedBytesPerUser;

    @Resource
    private FileStorage fileStorage;

    @Resource
    private ProofMapper proofMapper;

    @Resource
    private VisitMapper visitMapper;

    @Resource
    private VolunteerMapper volunteerMapper;

    @Resource
    private HelpMapper helpMapper;

    @Resource
    private UserMapper userMapper;

    @Resource
    private AccountMapper accountMapper;

    @Resource
    private JdbcTemplate jdbcTemplate;

    public static final String VIS_PUBLIC = "public";
    public static final String VIS_PRIVATE = "private";

    private static final Set<String> PUBLIC_PURPOSES = new HashSet<>(Arrays.asList(
            "animal", "avatar"
    ));

    /** private 上传后仅允许升为这些明确私有用途；图片用途必须在上传时完成内容解码。 */
    private static final Set<String> SPECIFIC_PRIVATE = new HashSet<>(Arrays.asList(
            "help", "account", "medical"
    ));

    // 崩溃预防 P1.1：25MP 单张解码峰值约 100MB 堆（ARGB），并发上传即 OOM 源；
    // 5MP（约 2600×1900）足够展示需求
    private static final long MAX_IMAGE_PIXELS = 5_000_000L;

    // 审计修复 L6：移除 purpose=notice——公告无图片字段、全系统零绑定点零前端调用，
    // 该用途上传的文件只会在 24h 后被静默清理，属无出口的死分支。
    private static final Set<String> KNOWN_PURPOSES = new HashSet<>(Arrays.asList(
            "animal", "avatar", "proof", "visit", "volunteer", "help", "account", "medical", "private"
    ));

    private static final Set<String> IMAGE_EXT = new HashSet<>(Arrays.asList(
            "jpg", "jpeg", "png", "gif", "webp"
    ));

    public String normalizePurpose(String purpose) {
        if (purpose == null || purpose.trim().isEmpty()) {
            return "private";
        }
        String p = purpose.trim().toLowerCase(Locale.ROOT);
        return KNOWN_PURPOSES.contains(p) ? p : "private";
    }

    public String visibilityForPurpose(String purpose) {
        // Public image purposes remain private until a business record owns them.
        if ("avatar".equals(normalizePurpose(purpose)) || "animal".equals(normalizePurpose(purpose))) {
            return VIS_PRIVATE;
        }
        String p = normalizePurpose(purpose);
        return PUBLIC_PURPOSES.contains(p) ? VIS_PUBLIC : VIS_PRIVATE;
    }

    public void assertImageExtension(String originalName, String purpose) {
        String normalized = normalizePurpose(purpose);
        if (!"animal".equals(normalized) && !"avatar".equals(normalized)
                && !"volunteer".equals(normalized) && !"help".equals(normalized)
                && !"proof".equals(normalized) && !"visit".equals(normalized)) {
            return;
        }
        if (!isImageName(originalName)) {
            throw new CustomException("400", "该用途仅允许图片格式：jpg/png/gif/webp");
        }
    }

    public boolean isImageName(String originalName) {
        String name = originalName == null ? "" : originalName;
        int dot = name.lastIndexOf('.');
        String ext = dot >= 0 ? name.substring(dot + 1).toLowerCase(Locale.ROOT) : "";
        return IMAGE_EXT.contains(ext);
    }

    /**
     * Avatar and volunteer uploads must be decoded before either the physical file or metadata is persisted.
     * Existing assets already recorded with those purposes are intentionally not retro-decoded during binding.
     */
    public void validateImageContent(String originalName, String purpose, InputStream input) {
        String normalized = normalizePurpose(purpose);
        if (!"animal".equals(normalized) && !"avatar".equals(normalized)
                && !"volunteer".equals(normalized) && !"help".equals(normalized)
                && !"proof".equals(normalized) && !"visit".equals(normalized)) {
            return;
        }
        assertImageExtension(originalName, normalized);
        String extension = extensionOf(originalName);
        ImageReader reader = null;
        try (ImageInputStream imageInput = ImageIO.createImageInputStream(input)) {
            if (imageInput == null) {
                throw invalidImage();
            }
            Iterator<ImageReader> readers = ImageIO.getImageReaders(imageInput);
            if (!readers.hasNext()) {
                if ("webp".equals(extension)) {
                    throw new CustomException("400", "当前服务不支持解码 webp，请上传 jpg、png 或 gif 图片");
                }
                throw invalidImage();
            }
            reader = readers.next();
            reader.setInput(imageInput, true, true);
            if (!matchesImageFormat(extension, reader.getFormatName())) {
                throw new CustomException("400", "图片内容与文件扩展名不匹配");
            }
            int width = reader.getWidth(0);
            int height = reader.getHeight(0);
            if (width <= 0 || height <= 0) {
                throw invalidImage();
            }
            if ((long) width * height > MAX_IMAGE_PIXELS) {
                throw new CustomException("400", "图片像素过大，最大允许 500 万像素（约 2600×1900）");
            }
            BufferedImage decoded = reader.read(0);
            if (decoded == null || decoded.getWidth() <= 0 || decoded.getHeight() <= 0) {
                throw invalidImage();
            }
        } catch (CustomException e) {
            throw e;
        } catch (IOException | RuntimeException e) {
            throw invalidImage();
        } finally {
            if (reader != null) {
                reader.dispose();
            }
        }
    }

    private String extensionOf(String originalName) {
        String name = originalName == null ? "" : originalName;
        int dot = name.lastIndexOf('.');
        return dot >= 0 ? name.substring(dot + 1).toLowerCase(Locale.ROOT) : "";
    }

    private boolean matchesImageFormat(String extension, String formatName) {
        String format = formatName == null ? "" : formatName.toLowerCase(Locale.ROOT);
        if ("jpg".equals(extension) || "jpeg".equals(extension)) {
            return "jpg".equals(format) || "jpeg".equals(format);
        }
        return extension.equals(format);
    }

    private CustomException invalidImage() {
        return new CustomException("400", "文件不是可解码的有效图片");
    }

    /**
     * 服务端裁定 purpose：客户端不可自由声明 public 用途。
     */
    public String resolvePurposeForUpload(User user, String requested) {
        String req = normalizePurpose(requested);
        if ("animal".equals(req)) {
            if (!PermissionUtil.hasFlag(user, "animal")) {
                throw new CustomException("403", "无权上传动物公开图片");
            }
            return "animal";
        }
        if ("medical".equals(req)) {
            if (!PermissionUtil.hasFlag(user, "animal")) {
                throw new CustomException("403", "无权上传动物医疗附件");
            }
            return "medical";
        }
        if ("account".equals(req)) {
            if (!PermissionUtil.hasFlag(user, "account")) {
                throw new CustomException("403", "无权上传资金票据");
            }
            return "account";
        }
        if ("avatar".equals(req)) {
            if (user == null || user.getId() == null) {
                throw new CustomException("401", "未登录不能上传头像");
            }
            return "avatar";
        }
        if (user == null || user.getId() == null) {
            throw new CustomException("401", "未登录不能上传");
        }
        return req;
    }

    public FileAsset recordUpload(String flag, String storedName, String originalName,
                                  Long ownerId, String purpose, String contentType, long size) {
        assertImageExtension(originalName, purpose);
        FileAsset asset = new FileAsset();
        asset.setFlag(flag);
        asset.setStoredName(storedName);
        asset.setOriginalName(originalName);
        asset.setOwnerId(ownerId);
        String p = normalizePurpose(purpose);
        asset.setPurpose(p);
        asset.setVisibility(visibilityForPurpose(p));
        asset.setContentType(contentType);
        asset.setSizeBytes(size);
        asset.setCreatedAt(new Date());
        asset.setDeleted(0);
        if (!save(asset)) {
            throw new CustomException("500", "文件元数据写入失败");
        }
        return asset;
    }

    public FileAsset findByFlag(String flag) {
        if (flag == null) {
            return null;
        }
        return getOne(Wrappers.<FileAsset>lambdaQuery()
                .eq(FileAsset::getFlag, flag)
                .eq(FileAsset::getDeleted, 0), false);
    }

    public void assertStagedQuota(Long ownerId, long incomingFiles, long incomingBytes) {
        if (ownerId == null || incomingFiles < 1 || incomingBytes < 0) {
            throw new CustomException("400", "上传配额参数无效");
        }
        long count = baseMapper.countLiveStagedByOwner(ownerId);
        long bytes = baseMapper.sumLiveStagedBytesByOwner(ownerId);
        if (count > maxStagedFilesPerUser - incomingFiles
                || bytes > maxStagedBytesPerUser - incomingBytes) {
            throw new CustomException("429", "暂存上传已达上限，请先完成业务提交或清理未使用文件");
        }
    }

    public boolean canRead(User user, FileAsset asset) {
        if (asset == null) {
            return false;
        }
        if (Integer.valueOf(1).equals(asset.getDeleted())) {
            return false;
        }
        if (VIS_PUBLIC.equalsIgnoreCase(asset.getVisibility())) {
            return true;
        }
        if (user == null || user.getId() == null) {
            return false;
        }
        String businessType = asset.getBusinessType();
        Long businessId = asset.getBusinessId();
        if (businessType == null && businessId == null) {
            // Unbound private uploads are visible only to their uploader.
            return user.getId().equals(asset.getOwnerId());
        }
        if (businessType == null || businessId == null) {
            return false;
        }

        if (!isMatchingBusinessPurpose(asset)) {
            return false;
        }
        if ("animal_medical".equals(asset.getBusinessType())) {
            return canReadMedicalRecord(user, asset.getBusinessId());
        }
        Long businessOwnerId = resolveBusinessOwnerId(asset);
        if (businessOwnerId == null) {
            return false;
        }
        return user.getId().equals(businessOwnerId)
                || canManagePurpose(user, asset.getPurpose());
    }

    /** Retire an unbound staged upload. Bound business files must use business-specific retirement. */
    @Transactional
    public boolean retireOwnUnbound(User user, String flag) {
        if (user == null || user.getId() == null) {
            throw new CustomException("401", "未登录或登录已过期");
        }
        FileAsset asset = findByFlag(flag == null ? null : flag.trim());
        if (asset == null) {
            throw new CustomException("404", "临时文件不存在");
        }
        if (!user.getId().equals(asset.getOwnerId())) {
            throw new CustomException("403", "只能清理本人上传的临时文件");
        }
        if (asset.getBusinessType() != null || asset.getBusinessId() != null) {
            throw new CustomException("409", "已绑定文件必须随业务记录管理");
        }
        UpdateWrapper<FileAsset> update = new UpdateWrapper<>();
        update.eq("id", asset.getId())
                .eq("owner_id", user.getId())
                .isNull("business_type")
                .isNull("business_id")
                .eq("deleted", 0)
                .set("deleted", 1);
        if (!update(update)) {
            throw new CustomException("409", "临时文件状态已变化，请刷新后重试");
        }
        deleteStoredFileAfterCommit(asset);
        return true;
    }

    @Scheduled(fixedDelayString = "${app.file.staged-cleanup-interval-ms:3600000}")
    public void retireExpiredStagedUploads() {
        if (!stagedCleanupEnabled || stagedRetentionHours < 1) {
            return;
        }
        Date cutoff = new Date(System.currentTimeMillis() - stagedRetentionHours * 60L * 60L * 1000L);
        List<FileAsset> expired = list(Wrappers.<FileAsset>lambdaQuery()
                .eq(FileAsset::getDeleted, 0)
                .eq(FileAsset::getVisibility, VIS_PRIVATE)
                .isNull(FileAsset::getBusinessType)
                .isNull(FileAsset::getBusinessId)
                .lt(FileAsset::getCreatedAt, cutoff)
                .last("LIMIT 500"));
        for (FileAsset asset : expired) {
            UpdateWrapper<FileAsset> update = new UpdateWrapper<>();
            update.eq("id", asset.getId())
                .eq("deleted", 0)
                .eq("visibility", VIS_PRIVATE)
                .isNull("business_type")
                .isNull("business_id")
                .set("deleted", 1)
                .last("LIMIT 1");
            if (update(update)) {
                deleteStoredFileAfterCommit(asset);
            }
        }
    }

    private boolean deleteStoredFile(FileAsset asset) {
        if (asset == null || fileStorage == null || asset.getStoredName() == null) {
            return false;
        }
        try {
            String storedName = asset.getStoredName().trim();
            if (storedName.endsWith("-legacy")) {
                return deleteLegacyStoredFiles(asset.getFlag());
            }
            Path relative = Paths.get(storedName);
            if (relative.isAbsolute() || relative.getNameCount() != 1
                    || ".".equals(storedName) || "..".equals(storedName)) {
                log.warn("拒绝清理不安全的附件存储名: " + asset.getStoredName());
                return false;
            }
            for (String configuredDir : fileStorage.getReadSearchDirs()) {
                Path root = Paths.get(configuredDir).toAbsolutePath().normalize();
                Path file = root.resolve(storedName).normalize();
                if (!file.getParent().equals(root) || Files.isSymbolicLink(file)) {
                    log.warn("拒绝清理越界或符号链接附件: " + asset.getStoredName());
                    return false;
                }
                Files.deleteIfExists(file);
            }
            return true;
        } catch (Exception e) {
            log.warn("附件元数据已退役，但磁盘文件清理失败: " + asset.getStoredName() + " - " + e.getMessage());
            return false;
        }
    }

    private boolean deleteLegacyStoredFiles(String flag) {
        if (flag == null || !flag.matches("[A-Za-z0-9-]{1,64}")) {
            return false;
        }
        try {
            boolean found = false;
            for (String configuredDir : fileStorage.getReadSearchDirs()) {
                Path root = Paths.get(configuredDir).toAbsolutePath().normalize();
                if (!Files.isDirectory(root) || Files.isSymbolicLink(root)) {
                    continue;
                }
                try (java.nio.file.DirectoryStream<Path> stream = Files.newDirectoryStream(root, flag + "-*")) {
                    for (Path candidate : stream) {
                        Path normalized = candidate.toAbsolutePath().normalize();
                        if (!normalized.getParent().equals(root) || Files.isSymbolicLink(normalized)
                                || !Files.isRegularFile(normalized)) {
                            continue;
                        }
                        found = true;
                        Files.delete(normalized);
                    }
                }
            }
            return found;
        } catch (Exception e) {
            log.warn("legacy 附件物理清理失败: " + flag + " - " + e.getMessage());
            return false;
        }
    }

    private void deleteStoredFileAfterCommit(FileAsset asset) {
        if (TransactionSynchronizationManager.isActualTransactionActive()
                && TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    purgeRetiredAsset(asset);
                }
            });
            return;
        }
        purgeRetiredAsset(asset);
    }

    private void purgeRetiredAsset(FileAsset asset) {
        if (!deleteStoredFile(asset)) {
            return;
        }
        baseMapper.delete(new QueryWrapper<FileAsset>()
                .eq("id", asset.getId()).eq("deleted", 1));
    }

    @Scheduled(fixedDelayString = "${app.file.staged-cleanup-interval-ms:3600000}")
    public void retryRetiredPhysicalDeletes() {
        List<FileAsset> retired = list(Wrappers.<FileAsset>lambdaQuery()
                .eq(FileAsset::getDeleted, 1)
                .orderByAsc(FileAsset::getId)
                .last("LIMIT 500"));
        for (FileAsset asset : retired) {
            purgeRetiredAsset(asset);
        }
    }

    private boolean isMatchingBusinessPurpose(FileAsset asset) {
        String businessType = asset.getBusinessType();
        String purpose = asset.getPurpose();
        switch (businessType) {
            case "proof":
            case "visit":
            case "volunteer":
            case "help":
            case "account":
                return businessType.equals(purpose);
            case "animal_medical":
                return "medical".equals(purpose);
            case "user":
                return "avatar".equals(purpose);
            default:
                return false;
        }
    }

    private Long resolveBusinessOwnerId(FileAsset asset) {
        String businessType = asset.getBusinessType();
        Long businessId = asset.getBusinessId();
        try {
            switch (businessType) {
                case "proof":
                    Proof proof = proofMapper.selectById(businessId);
                    return proof == null ? null : proof.getPuid();
                case "visit":
                    Visit visit = visitMapper.selectById(businessId);
                    return visit == null ? null : visit.getUid();
                case "volunteer":
                    Volunteer volunteer = volunteerMapper.selectById(businessId);
                    return volunteer == null ? null : volunteer.getUid();
                case "help":
                    Help help = helpMapper.selectById(businessId);
                    return help == null ? null : help.getUid();
                case "user":
                    User owner = userMapper.selectById(businessId);
                    return owner == null ? null : owner.getId();
                case "account":
                    Account account = accountMapper.selectById(businessId);
                    return account == null ? null : account.getCreatedBy();
                case "animal_medical":
                    return jdbcTemplate.queryForObject(
                            "SELECT created_by FROM t_animal_medical_record WHERE id=?",
                            Long.class, businessId);
                default:
                    return null;
            }
        } catch (RuntimeException ignored) {
            // Ownership lookup failures must never broaden private-file access.
            return null;
        }
    }

    /**
     * 业务绑定：未绑定才能首次绑定；同业务幂等；跨业务 409；
     * private → 仅明确非图片私有用途；avatar/volunteer 必须按对应 purpose 上传。
     */
    @Transactional
    public void bindToBusiness(User user, String flag, String expectedPurpose,
                               String businessType, Long businessId, boolean allowAdmin) {
        if (flag == null || flag.trim().isEmpty()) {
            return;
        }
        if (businessType == null || businessId == null) {
            throw new CustomException("400", "业务绑定参数不完整");
        }
        FileAsset asset = baseMapper.selectLiveByFlagForUpdate(flag.trim());
        if (asset == null) {
            throw new CustomException("400", "文件不存在或未登记元数据，请重新上传");
        }
        if (user == null || user.getId() == null) {
            throw new CustomException("401", "未登录");
        }
        // 已绑定同一业务：幂等成功
        if (businessType.equals(asset.getBusinessType())
                && businessId.equals(asset.getBusinessId())) {
            return;
        }
        // 已绑定其他业务
        if (asset.getBusinessType() != null || asset.getBusinessId() != null) {
            throw new CustomException("409", "该文件已绑定其他业务记录");
        }
        // 首次绑定没有任何管理权限兜底：只有实际上传者可以消费未绑定 flag。
        if (!user.getId().equals(asset.getOwnerId())) {
            throw new CustomException("403", "不能使用他人上传的文件");
        }

        String exp = normalizePurpose(expectedPurpose);
        String originalPurpose = asset.getPurpose();
        String cur = normalizePurpose(originalPurpose);
        if (!exp.equals(cur)) {
            // 图片用途必须在上传落盘前完成真实内容解码，禁止从未解码的 private 资产提升。
            if ("avatar".equals(exp)) {
                throw new CustomException("400", "头像必须使用 purpose=avatar 上传，禁止从 private 改绑");
            }
            if ("volunteer".equals(exp) || "help".equals(exp)) {
                throw new CustomException("400", "图片必须使用对应 purpose 上传，禁止从 private 改绑");
            }
            if ("private".equals(cur) && SPECIFIC_PRIVATE.contains(exp)) {
                asset.setPurpose(exp);
            } else {
                throw new CustomException("400", "文件用途与业务不匹配，且不允许跨用途改写");
            }
        }

        if ("avatar".equals(exp) || "volunteer".equals(exp) || "help".equals(exp)) {
            assertImageExtension(asset.getOriginalName(), exp);
        }
        if (PUBLIC_PURPOSES.contains(exp)) {
            asset.setVisibility(VIS_PUBLIC);
        } else {
            asset.setVisibility(visibilityForPurpose(exp));
        }
        asset.setBusinessType(businessType);
        asset.setBusinessId(businessId);
        asset.setBoundAt(new Date());

        // 原子：仅未绑定可更新
        UpdateWrapper<FileAsset> uw = new UpdateWrapper<>();
        uw.eq("id", asset.getId())
                .eq("deleted", 0)
                .eq("owner_id", user.getId())
                .eq("purpose", originalPurpose)
                .isNull("business_type")
                .isNull("business_id");
        boolean ok = update(asset, uw);
        if (!ok) {
            throw new CustomException("409", "文件绑定冲突，请重新上传");
        }
    }

    @Transactional
    public void bindMedicalRecord(User user, String flag, Long recordId, String recordVisibility) {
        bindToBusiness(user, flag, "medical", "animal_medical", recordId, false);
        String visibility = "public".equalsIgnoreCase(recordVisibility) ? VIS_PUBLIC : VIS_PRIVATE;
        UpdateWrapper<FileAsset> update = new UpdateWrapper<>();
        update.eq("flag", flag).eq("business_type", "animal_medical").eq("business_id", recordId)
                .eq("deleted", 0).set("visibility", visibility);
        if (!update(update)) {
            throw new CustomException("409", "医疗附件可见范围更新失败");
        }
    }

    /**
     * 附件字段三态同步（须在业务行更新成功后调用解绑侧；本方法一次完成绑+解绑时需外层事务）。
     * <ul>
     *   <li>newPic == null → 未修改图片字段，不操作</li>
     *   <li>newPic 空白 → 清图：解绑旧文件</li>
     *   <li>newPic 非空且与旧不同 → 先绑新再解旧</li>
     * </ul>
     * 调用方应在业务 update 成功后调用；推荐顺序：bind 新 → update 业务 → unbind 旧。
     * 本方法按「先绑后解」执行，调用方需保证业务 update 已成功或同事务内随后 update 失败会整体回滚。
     */
    @Transactional
    public void syncAttachment(User user, String oldPic, String newPic,
                               String purpose, String businessType, Long businessId,
                               boolean allowAdmin) {
        if (newPic == null) {
            return;
        }
        String next = newPic.trim();
        String prev = oldPic == null ? "" : oldPic.trim();
        if (next.isEmpty()) {
            if (!prev.isEmpty()) {
                unbindIfMatches(prev, businessType, businessId);
            }
            return;
        }
        if (next.equals(prev)) {
            return;
        }
        bindToBusiness(user, next, purpose, businessType, businessId, allowAdmin);
        if (!prev.isEmpty()) {
            unbindIfMatches(prev, businessType, businessId);
        }
    }

    /**
     * 解绑旧附件。使用 UpdateWrapper 显式 SET NULL，避免 MyBatis-Plus 默认忽略 null 字段。
     * <ul>
     *   <li>无记录 / 已解绑 / 已绑其他业务：幂等成功</li>
     *   <li>仍绑定目标业务但 UPDATE 0 行：409</li>
     * </ul>
     */
    @Transactional
    public void unbindIfMatches(String flag, String businessType, Long businessId) {
        if (flag == null || flag.trim().isEmpty() || businessId == null || businessType == null) {
            return;
        }
        FileAsset asset = findByFlag(flag.trim());
        if (asset == null) {
            return;
        }
        if (!businessType.equals(asset.getBusinessType())
                || !businessId.equals(asset.getBusinessId())) {
            // 已非本业务绑定：幂等
            return;
        }
        UpdateWrapper<FileAsset> uw = new UpdateWrapper<>();
        uw.eq("id", asset.getId())
                .eq("business_type", businessType)
                .eq("business_id", businessId)
                .set("business_type", null)
                .set("business_id", null)
                .set("bound_at", null);
        if (PUBLIC_PURPOSES.contains(normalizePurpose(asset.getPurpose()))) {
            uw.set("visibility", VIS_PRIVATE);
        }
        boolean ok = update(uw);
        if (!ok) {
            throw new CustomException("409", "文件解绑冲突，请刷新后重试");
        }
    }

    /**
     * 业务记录删除时：解绑所有仍指向该业务的附件（含 avatar 回 private）。
     */
    @Transactional
    public void unbindAllForBusiness(String businessType, Long businessId) {
        if (businessType == null || businessId == null) {
            return;
        }
        List<FileAsset> assets = list(Wrappers.<FileAsset>lambdaQuery()
                .eq(FileAsset::getBusinessType, businessType)
                .eq(FileAsset::getBusinessId, businessId)
                .eq(FileAsset::getDeleted, 0));
        if (assets == null || assets.isEmpty()) {
            return;
        }
        int expected = assets.size();
        int unbound = 0;
        for (FileAsset asset : assets) {
            UpdateWrapper<FileAsset> uw = new UpdateWrapper<>();
            uw.eq("id", asset.getId())
                    .eq("business_type", businessType)
                    .eq("business_id", businessId)
                    .set("business_type", null)
                    .set("business_id", null)
                    .set("bound_at", null);
            if (PUBLIC_PURPOSES.contains(normalizePurpose(asset.getPurpose()))) {
                uw.set("visibility", VIS_PRIVATE);
            }
            if (update(uw)) {
                unbound++;
            }
        }
        if (unbound < expected) {
            throw new CustomException("409", "部分附件解绑失败，请刷新后重试");
        }
    }

    /** Retire a replaced or deleted business attachment so its old flag cannot be read again. */
    @Transactional
    public void retireIfMatches(String flag, String businessType, Long businessId) {
        if (flag == null || flag.trim().isEmpty() || businessType == null || businessId == null) {
            return;
        }
        FileAsset asset = findByFlag(flag.trim());
        if (asset == null) {
            return;
        }
        if (!businessType.equals(asset.getBusinessType()) || !businessId.equals(asset.getBusinessId())) {
            return;
        }
        UpdateWrapper<FileAsset> update = new UpdateWrapper<>();
        update.eq("id", asset.getId())
                .eq("business_type", businessType)
                .eq("business_id", businessId)
                .eq("deleted", 0)
                .set("deleted", 1);
        if (!update(update)) {
            throw new CustomException("409", "附件退役冲突，请刷新后重试");
        }
        deleteStoredFileAfterCommit(asset);
    }

    /** Retire every live attachment owned by a business record before deleting that record. */
    @Transactional
    public void retireAllForBusiness(String businessType, Long businessId) {
        if (businessType == null || businessId == null) {
            return;
        }
        List<FileAsset> assets = list(Wrappers.<FileAsset>lambdaQuery()
                .eq(FileAsset::getBusinessType, businessType)
                .eq(FileAsset::getBusinessId, businessId)
                .eq(FileAsset::getDeleted, 0));
        if (assets == null || assets.isEmpty()) {
            return;
        }
        for (FileAsset asset : assets) {
            retireIfMatches(asset.getFlag(), businessType, businessId);
        }
    }

    private boolean canManagePurpose(User user, String purpose) {
        String p = normalizePurpose(purpose);
        switch (p) {
            case "proof":
                return PermissionUtil.hasFlag(user, "proof");
            case "visit":
                return PermissionUtil.hasFlag(user, "visit");
            case "volunteer":
                return PermissionUtil.hasFlag(user, "volunteer");
            case "help":
                return PermissionUtil.hasFlag(user, "help") || PermissionUtil.hasFlag(user, "rescue");
            case "animal":
                return PermissionUtil.hasFlag(user, "animal");
            case "account":
                return PermissionUtil.hasFlag(user, "account");
            case "medical":
                return PermissionUtil.hasFlag(user, "animal");
            case "avatar":
                return PermissionUtil.hasFlag(user, "user");
            default:
                return false;
        }
    }

    private boolean canReadMedicalRecord(User user, Long recordId) {
        if (user == null || user.getId() == null || recordId == null) return false;
        if (PermissionUtil.hasFlag(user, "animal")) return true;
        Integer count = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM t_animal_medical_record m "
                        + "WHERE m.id=? AND (m.created_by=? OR (m.visibility IN ('public','owner') "
                        + "AND EXISTS(SELECT 1 FROM t_adopt a WHERE a.aid=m.animal_id AND a.uid=? AND a.vstate=4)))",
                Integer.class, recordId, user.getId(), user.getId());
        return count != null && count > 0;
    }
}
