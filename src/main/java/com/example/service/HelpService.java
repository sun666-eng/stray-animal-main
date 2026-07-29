package com.example.service;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.baomidou.mybatisplus.core.conditions.update.UpdateWrapper;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.example.common.PermissionUtil;
import com.example.dto.ChatMessageDTO;
import com.example.dto.HelpManageRequest;
import com.example.entity.Animal;
import com.example.entity.Help;
import com.example.entity.User;
import com.example.exception.CustomException;
import com.example.mapper.HelpMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import jakarta.annotation.Resource;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Date;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.regex.Pattern;
import java.util.Set;
import java.util.Locale;

@Service
public class HelpService extends ServiceImpl<HelpMapper, Help> {

    public static final String CHAT_TITLE = "聊天室消息";
    public static final String CHAT_LOCATION = "救助公共聊天室";
    private static final int CHAT_LIMIT = 10;
    private static final long CHAT_WINDOW_MILLIS = 60_000L;
    private static final int MAX_RATE_LIMIT_USERS = 10_000;
    private static final Pattern PHONE_PATTERN = Pattern.compile("^[0-9+()\\-\\s]{6,20}$");

    @Resource
    private FileAssetService fileAssetService;

    @Resource
    private AnimalService animalService;

    @Resource
    private WorkflowEventService workflowEventService;

    @Resource
    private NotificationService notificationService;

    private final ConcurrentHashMap<Long, RateWindow> chatRateLimits = new ConcurrentHashMap<>();
    private final AtomicInteger rateLimitChecks = new AtomicInteger();

    public List<Help> listByUid(Long uid) {
        return list(Wrappers.<Help>lambdaQuery()
                .eq(Help::getUid, uid)
                .orderByDesc(Help::getCreateTime));
    }

    @Transactional
    public boolean submitHelp(Help help, User user) {
        if (user == null || user.getId() == null) {
            throw new CustomException("401", "未登录或登录已过期");
        }
        if (help == null) {
            throw new CustomException("400", "救助请求不能为空");
        }
        if (CHAT_TITLE.equals(help.getTitle() == null ? null : help.getTitle().trim())) {
            throw new CustomException("400", "该标题为系统保留内容");
        }
        validateRescue(help);
        help.setId(null);
        help.setUid(user.getId());
        help.setUname(user.getUsername());
        help.setStatus(0);
        help.setPriority(0);
        help.setVersion(0);
        help.setRemark(null);
        help.setCreateTime(new Date());
        help.setUpdateTime(new Date());
        if (!save(help)) {
            throw new CustomException("500", "救助请求保存失败");
        }
        if (help.getPic() != null && !help.getPic().trim().isEmpty()) {
            fileAssetService.bindToBusiness(user, help.getPic(), "help",
                    "help", help.getId(), false);
        }
        return true;
    }

    /** 管理端救助状态机；“接收入站”必须原子地创建或关联动物档案。 */
    @Transactional
    public boolean manageHelp(Long id, HelpManageRequest body, User actor) {
        if (actor == null || actor.getId() == null) throw new CustomException("401", "未登录或登录已过期");
        if (id == null || body == null || body.getStatus() == null) throw new CustomException("400", "处理参数无效");
        validateStatus(body.getStatus());
        Help existing = getOne(Wrappers.<Help>lambdaQuery().eq(Help::getId, id).last("FOR UPDATE"), false);
        if (existing == null || CHAT_TITLE.equals(existing.getTitle())) throw new CustomException("404", "救助记录不存在");
        int version = existing.getVersion() == null ? 0 : existing.getVersion();
        if (body.getExpectedVersion() != null && body.getExpectedVersion() != version) {
            throw new CustomException("409", "救助记录已被其他管理员更新，请刷新后重试");
        }
        int priority = body.getPriority() == null ? (existing.getPriority() == null ? 0 : existing.getPriority()) : body.getPriority();
        if (priority < 0 || priority > 2) throw new CustomException("400", "优先级仅允许普通、较急或紧急");
        String remark = normalizeOptional(body.getRemark(), 2000, "回复");
        String outcome = normalizeOutcome(body.getOutcome());
        String resolutionNote = normalizeOptional(body.getResolutionNote(), 2000, "处理结论");
        Long animalId = existing.getAnimalId();
        Date now = new Date();

        if (body.getStatus() == 2) {
            if (outcome == null) throw new CustomException("400", "完成救助时必须选择处理结果");
            if (resolutionNote == null) throw new CustomException("400", "完成救助时必须填写处理结论");
            if ("intake".equals(outcome)) {
                animalId = resolveIntakeAnimal(existing, body, actor);
            } else if (body.getExistingAnimalId() != null || body.getAnimal() != null) {
                throw new CustomException("400", "只有接收入站结果可以关联动物档案");
            }
        } else if (body.getStatus() == 3) {
            if (resolutionNote == null && remark == null) throw new CustomException("400", "关闭救助时必须填写原因");
            if (outcome == null) outcome = "invalid";
        } else {
            outcome = null;
            resolutionNote = null;
            animalId = null;
        }

        if (Integer.valueOf(2).equals(existing.getStatus())
                && body.getStatus() == 2
                && java.util.Objects.equals(existing.getOutcome(), outcome)
                && java.util.Objects.equals(existing.getAnimalId(), animalId)) return true;

        UpdateWrapper<Help> update = new UpdateWrapper<>();
        update.eq("id", id).eq("version", version)
                .set("status", body.getStatus()).set("priority", priority)
                .set("assignee_id", body.getAssigneeId() == null ? actor.getId() : body.getAssigneeId())
                .set("remark", remark).set("outcome", outcome).set("animal_id", animalId)
                .set("resolution_note", resolutionNote)
                .set("resolved_at", body.getStatus() >= 2 ? now : null)
                .set("update_time", now).set("version", version + 1);
        if (!update(new Help(), update)) throw new CustomException("409", "救助记录已变化，请刷新后重试");
        if (workflowEventService != null) {
            workflowEventService.record("help", String.valueOf(id), existing.getStatus(), body.getStatus(),
                    body.getStatus() == 2 ? "RESOLVE" : body.getStatus() == 3 ? "CLOSE" : "MANAGE",
                    actor.getId(), "ADMIN", resolutionNote == null ? remark : resolutionNote,
                    null, animalId == null ? null : "{\"animalId\":" + animalId + "}");
        }
        if (notificationService != null) {
            notificationService.notifyOnce(existing.getUid(), "help", "救助进度更新",
                    existing.getTitle() + "：" + helpStatusLabel(body.getStatus())
                            + (resolutionNote == null ? "" : "。" + resolutionNote),
                    "help", String.valueOf(id), "/page/front/my_rescue.html",
                    "help:" + id + ":v" + (version + 1));
        }
        return true;
    }

    private Long resolveIntakeAnimal(Help existing, HelpManageRequest body, User actor) {
        if (existing.getAnimalId() != null) return existing.getAnimalId();
        if (body.getExistingAnimalId() != null) {
            Animal animal = animalService.getById(body.getExistingAnimalId());
            if (animal == null) throw new CustomException("404", "要关联的动物档案不存在");
            long used = count(Wrappers.<Help>lambdaQuery().eq(Help::getAnimalId, animal.getId()).ne(Help::getId, existing.getId()));
            if (used > 0) throw new CustomException("409", "该动物档案已关联其他救助事件");
            return animal.getId();
        }
        Animal draft = body.getAnimal();
        if (draft == null) throw new CustomException("400", "接收入站时必须创建或选择动物档案");
        animalService.saveAnimal(draft, actor);
        if (draft.getId() == null) throw new CustomException("500", "动物档案创建失败");
        return draft.getId();
    }

    private String normalizeOutcome(String value) {
        if (value == null || value.trim().isEmpty()) return null;
        String clean = value.trim().toLowerCase(Locale.ROOT);
        if (!Set.of("intake", "transfer", "owner_found", "not_found", "duplicate", "invalid").contains(clean)) {
            throw new CustomException("400", "救助处理结果无效");
        }
        return clean;
    }

    private String helpStatusLabel(Integer state) {
        if (state == null) return "状态更新";
        return switch (state) { case 0 -> "待处理"; case 1 -> "处理中"; case 2 -> "已完成"; case 3 -> "已关闭"; default -> "状态更新"; };
    }

    @Transactional
    public boolean updateHelp(Help help, User user) {
        if (user == null || user.getId() == null) {
            throw new CustomException("401", "未登录或登录已过期");
        }
        if (help == null || help.getId() == null) {
            throw new CustomException("400", "记录 ID 无效");
        }
        // 悲观锁业务行，避免并发换图/删除穿插
        Help existing = getOne(Wrappers.<Help>lambdaQuery()
                .eq(Help::getId, help.getId()).last("FOR UPDATE"));
        if (existing == null) {
            throw new CustomException("404", "记录不存在");
        }
        if (CHAT_TITLE.equals(existing.getTitle())) {
            throw new CustomException("400", "聊天室系统记录不可通过救助接口修改");
        }
        boolean manage = PermissionUtil.hasFlag(user, "help") || PermissionUtil.hasFlag(user, "rescue");
        if (!manage && !user.getId().equals(existing.getUid())) {
            throw new CustomException("403", "只能修改自己的救助请求");
        }
        help.setUid(existing.getUid());
        help.setUname(existing.getUname());
        help.setCreateTime(existing.getCreateTime());
        if (manage) {
            help.setTitle(existing.getTitle());
            help.setDescription(existing.getDescription());
            help.setLocation(existing.getLocation());
            help.setPhone(existing.getPhone());
            help.setPic(existing.getPic());
            if (help.getStatus() == null) {
                help.setStatus(existing.getStatus());
            }
            validateStatus(help.getStatus());
            if (help.getRemark() == null) {
                help.setRemark(existing.getRemark());
            } else {
                help.setRemark(normalizeOptional(help.getRemark(), 2000, "回复"));
            }
        } else {
            if (existing.getStatus() != null && existing.getStatus() != 0) {
                throw new CustomException("403", "当前状态不可修改");
            }
            if (CHAT_TITLE.equals(help.getTitle() == null ? null : help.getTitle().trim())) {
                throw new CustomException("400", "该标题为系统保留内容");
            }
            help.setStatus(0);
            help.setRemark(existing.getRemark());
            validateRescue(help);
        }
        help.setUpdateTime(new Date());

        String oldPic = existing.getPic();
        String newPic = help.getPic();
        if (newPic != null) {
            String next = newPic.trim();
            String prev = oldPic == null ? "" : oldPic.trim();
            if (!next.isEmpty() && !next.equals(prev)) {
                fileAssetService.bindToBusiness(user, next, "help", "help", help.getId(), manage);
            }
        }

        if (!updateById(help)) {
            throw new CustomException("409", "业务记录已变化，请刷新后重试");
        }

        if (newPic != null) {
            String next = newPic.trim();
            String prev = oldPic == null ? "" : oldPic.trim();
            if (next.isEmpty()) {
                if (!prev.isEmpty()) {
                    fileAssetService.retireIfMatches(prev, "help", help.getId());
                }
            } else if (!next.equals(prev) && !prev.isEmpty()) {
                fileAssetService.retireIfMatches(prev, "help", help.getId());
            }
        }
        return true;
    }

    @Transactional
    public boolean deleteHelp(Long id) {
        Help existing = getOne(Wrappers.<Help>lambdaQuery()
                .eq(Help::getId, id).last("FOR UPDATE"));
        if (existing == null) {
            return true;
        }
        if (CHAT_TITLE.equals(existing.getTitle())) {
            throw new CustomException("400", "聊天室系统记录不可通过救助接口删除");
        }
        fileAssetService.retireAllForBusiness("help", id);
        if (!removeById(id)) {
            throw new CustomException("409", "删除失败，请刷新后重试");
        }
        return true;
    }

    /**
     * The application has no conversation model. This is one authenticated global rescue public room,
     * persisted as reserved rows in t_help rather than a private consultation channel.
     */
    @Transactional
    public ChatMessageDTO submitChatMessage(String rawText, User user) {
        if (user == null || user.getId() == null) {
            throw new CustomException("401", "未登录或登录已过期");
        }
        String text = requireText(rawText, 500, "消息内容");
        checkChatRateLimit(user.getId());

        Date now = new Date();
        Help message = new Help();
        message.setId(null);
        message.setUid(user.getId());
        message.setUname(safeUsername(user.getUsername()));
        message.setTitle(CHAT_TITLE);
        message.setDescription(text);
        message.setLocation(CHAT_LOCATION);
        message.setPhone(null);
        message.setPic(null);
        message.setStatus(0);
        message.setRemark(null);
        message.setCreateTime(now);
        message.setUpdateTime(now);
        if (!save(message) || message.getId() == null) {
            throw new CustomException("500", "聊天消息保存失败");
        }
        invalidateChatHistoryCache();

        return toChatDTO(message);
    }

    /** 崩溃预防 P0.2：历史查询 5s 微缓存——在线 N 人每 10s 各查一次 → 固定每 5s 一次。 */
    private static final long CHAT_HISTORY_CACHE_MS = 5000;
    private volatile List<ChatMessageDTO> chatHistoryCache;
    private volatile long chatHistoryCachedAt;

    public List<ChatMessageDTO> getChatHistory() {
        List<ChatMessageDTO> cached = chatHistoryCache;
        if (cached != null && System.currentTimeMillis() - chatHistoryCachedAt < CHAT_HISTORY_CACHE_MS) {
            return cached;
        }
        List<Help> latest = list(Wrappers.<Help>lambdaQuery()
                .eq(Help::getTitle, CHAT_TITLE)
                .orderByDesc(Help::getCreateTime)
                .orderByDesc(Help::getId)
                .last("LIMIT 100"));
        Collections.reverse(latest);
        List<ChatMessageDTO> result = new ArrayList<>(latest.size());
        for (Help message : latest) {
            result.add(toChatDTO(message));
        }
        List<ChatMessageDTO> snapshot = Collections.unmodifiableList(result);
        chatHistoryCache = snapshot;
        chatHistoryCachedAt = System.currentTimeMillis();
        return snapshot;
    }

    /** 新消息落库后失效历史缓存，发送者及他人下次轮询即可见。 */
    private void invalidateChatHistoryCache() {
        chatHistoryCache = null;
    }

    private ChatMessageDTO toChatDTO(Help message) {
        ChatMessageDTO dto = new ChatMessageDTO();
        dto.setId(message.getId());
        dto.setUsername(safeUsername(message.getUname()));
        dto.setText(message.getDescription());
        dto.setCreatedTime(message.getCreateTime());
        return dto;
    }

    private void validateRescue(Help help) {
        help.setTitle(requireText(help.getTitle(), 255, "标题"));
        help.setDescription(requireText(help.getDescription(), 5000, "描述"));
        help.setLocation(requireText(help.getLocation(), 255, "地点"));
        help.setPhone(normalizeOptional(help.getPhone(), 20, "联系电话"));
        if (help.getPhone() != null && !PHONE_PATTERN.matcher(help.getPhone()).matches()) {
            throw new CustomException("400", "联系电话格式不正确");
        }
        help.setPic(normalizeOptional(help.getPic(), 255, "图片标识"));
    }

    private void validateStatus(Integer status) {
        if (status == null || status < 0 || status > 3) {
            throw new CustomException("400", "状态仅允许0待处理、1处理中、2已完成或3已关闭");
        }
    }

    private String requireText(String value, int max, String field) {
        if (value == null || value.trim().isEmpty()) {
            throw new CustomException("400", field + "不能为空");
        }
        String normalized = value.trim();
        if (normalized.length() > max) {
            throw new CustomException("400", field + "不能超过" + max + "个字符");
        }
        return normalized;
    }

    private String normalizeOptional(String value, int max, String field) {
        if (value == null || value.trim().isEmpty()) {
            return null;
        }
        String normalized = value.trim();
        if (normalized.length() > max) {
            throw new CustomException("400", field + "不能超过" + max + "个字符");
        }
        return normalized;
    }

    private String safeUsername(String username) {
        if (username == null || username.trim().isEmpty()) {
            return "用户";
        }
        String normalized = username.trim();
        return normalized.length() <= 50 ? normalized : normalized.substring(0, 50);
    }

    private void checkChatRateLimit(Long userId) {
        long now = System.currentTimeMillis();
        RateWindow window = chatRateLimits.computeIfAbsent(userId, ignored -> new RateWindow(now));
        synchronized (window) {
            if (now - window.startedAt >= CHAT_WINDOW_MILLIS) {
                window.startedAt = now;
                window.count = 0;
            }
            if (window.count >= CHAT_LIMIT) {
                throw new CustomException("429", "发送过于频繁，请稍后再试");
            }
            window.count++;
        }
        if ((rateLimitChecks.incrementAndGet() & 127) == 0 || chatRateLimits.size() > MAX_RATE_LIMIT_USERS) {
            cleanupRateLimits(now);
        }
    }

    private void cleanupRateLimits(long now) {
        chatRateLimits.entrySet().removeIf(entry -> now - entry.getValue().startedAt >= CHAT_WINDOW_MILLIS);
        if (chatRateLimits.size() <= MAX_RATE_LIMIT_USERS) {
            return;
        }
        int excess = chatRateLimits.size() - MAX_RATE_LIMIT_USERS;
        for (Map.Entry<Long, RateWindow> entry : chatRateLimits.entrySet()) {
            if (excess-- <= 0) {
                break;
            }
            chatRateLimits.remove(entry.getKey(), entry.getValue());
        }
    }

    private static final class RateWindow {
        private long startedAt;
        private int count;

        private RateWindow(long startedAt) {
            this.startedAt = startedAt;
        }
    }
}
