package com.example.service;

import com.baomidou.mybatisplus.core.conditions.update.UpdateWrapper;
import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.example.common.PermissionUtil;
import com.example.entity.FileAsset;
import com.example.entity.User;
import com.example.exception.CustomException;
import com.example.mapper.FileAssetMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Arrays;
import java.util.Date;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

@Service
public class FileAssetService extends ServiceImpl<FileAssetMapper, FileAsset> {

    public static final String VIS_PUBLIC = "public";
    public static final String VIS_PRIVATE = "private";

    private static final Set<String> PUBLIC_PURPOSES = new HashSet<>(Arrays.asList(
            "animal", "avatar", "notice"
    ));

    /** private 上传后仅允许升为这些明确私有用途（禁止升为 avatar，防非图片绕过） */
    private static final Set<String> SPECIFIC_PRIVATE = new HashSet<>(Arrays.asList(
            "proof", "visit", "volunteer", "help"
    ));

    private static final Set<String> KNOWN_PURPOSES = new HashSet<>(Arrays.asList(
            "animal", "avatar", "notice", "proof", "visit", "volunteer", "help", "private"
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
        // avatar 上传时保持 private，绑定到用户后才 public
        if ("avatar".equals(normalizePurpose(purpose))) {
            return VIS_PRIVATE;
        }
        String p = normalizePurpose(purpose);
        return PUBLIC_PURPOSES.contains(p) ? VIS_PUBLIC : VIS_PRIVATE;
    }

    public void assertImageExtension(String originalName, String purpose) {
        if (!"avatar".equals(normalizePurpose(purpose))) {
            return;
        }
        if (!isImageName(originalName)) {
            throw new CustomException("400", "头像仅允许图片格式：jpg/png/gif/webp");
        }
    }

    public boolean isImageName(String originalName) {
        String name = originalName == null ? "" : originalName;
        int dot = name.lastIndexOf('.');
        String ext = dot >= 0 ? name.substring(dot + 1).toLowerCase(Locale.ROOT) : "";
        return IMAGE_EXT.contains(ext);
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
        if ("notice".equals(req)) {
            if (!PermissionUtil.hasFlag(user, "notice")) {
                throw new CustomException("403", "无权上传公告图片");
            }
            return "notice";
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
        if (user.getId().equals(asset.getOwnerId())) {
            return true;
        }
        String purpose = asset.getPurpose() == null ? "" : asset.getPurpose();
        switch (purpose) {
            case "proof":
                return PermissionUtil.hasFlag(user, "proof");
            case "visit":
                return PermissionUtil.hasFlag(user, "visit");
            case "volunteer":
                return PermissionUtil.hasFlag(user, "volunteer");
            case "help":
                return PermissionUtil.hasFlag(user, "help") || PermissionUtil.hasFlag(user, "rescue");
            case "animal":
            case "notice":
                return PermissionUtil.hasFlag(user, "animal")
                        || PermissionUtil.hasFlag(user, "notice")
                        || PermissionUtil.hasFlag(user, "user");
            case "avatar":
                return user.getId().equals(asset.getOwnerId())
                        || PermissionUtil.hasFlag(user, "user");
            case "private":
                // 仅 owner；user 管理 flag 不等于全局私有文件审计
                return user.getId().equals(asset.getOwnerId());
            default:
                // 未知 purpose：默认拒绝（最小权限）
                return false;
        }
    }

    /**
     * 业务绑定：未绑定才能首次绑定；同业务幂等；跨业务 409；
     * private → 仅明确私有用途；禁止 private→avatar（必须 purpose=avatar 上传）。
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
        FileAsset asset = findByFlag(flag.trim());
        if (asset == null) {
            throw new CustomException("400", "文件不存在或未登记元数据，请重新上传");
        }
        if (user == null || user.getId() == null) {
            throw new CustomException("401", "未登录");
        }
        boolean admin = allowAdmin && canManagePurpose(user, expectedPurpose);
        if (!admin && !user.getId().equals(asset.getOwnerId())) {
            throw new CustomException("403", "不能使用他人上传的文件");
        }

        // 已绑定同一业务：幂等成功
        if (businessType.equals(asset.getBusinessType())
                && businessId.equals(asset.getBusinessId())) {
            return;
        }
        // 已绑定其他业务
        if (asset.getBusinessId() != null) {
            throw new CustomException("409", "该文件已绑定其他业务记录");
        }

        String exp = normalizePurpose(expectedPurpose);
        String cur = normalizePurpose(asset.getPurpose());
        if (!exp.equals(cur)) {
            // 禁止 private→avatar；头像必须从 purpose=avatar 上传路径产生
            if ("avatar".equals(exp)) {
                throw new CustomException("400", "头像必须使用 purpose=avatar 上传的文件，禁止 private 改绑");
            }
            if ("private".equals(cur) && SPECIFIC_PRIVATE.contains(exp)) {
                asset.setPurpose(exp);
            } else {
                throw new CustomException("400", "文件用途与业务不匹配，且不允许跨用途改写");
            }
        }

        if ("avatar".equals(exp)) {
            assertImageExtension(asset.getOriginalName(), "avatar");
            asset.setVisibility(VIS_PUBLIC);
        } else {
            asset.setVisibility(visibilityForPurpose(exp));
        }
        asset.setBusinessType(businessType);
        asset.setBusinessId(businessId);
        asset.setBoundAt(new Date());

        // 原子：仅未绑定可更新
        UpdateWrapper<FileAsset> uw = new UpdateWrapper<>();
        uw.eq("id", asset.getId()).isNull("business_id");
        boolean ok = update(asset, uw);
        if (!ok) {
            throw new CustomException("409", "文件绑定冲突，请重新上传");
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
        if ("avatar".equals(normalizePurpose(asset.getPurpose()))) {
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
            if ("avatar".equals(normalizePurpose(asset.getPurpose()))) {
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
            case "avatar":
                return PermissionUtil.hasFlag(user, "user");
            default:
                return false;
        }
    }
}
