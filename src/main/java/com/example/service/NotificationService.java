package com.example.service;

import com.baomidou.mybatisplus.core.metadata.IPage;
import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.example.entity.Notification;
import com.example.exception.CustomException;
import com.example.mapper.NotificationMapper;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Date;

@Service
public class NotificationService extends ServiceImpl<NotificationMapper, Notification> {
    public void notifyOnce(Long userId, String type, String title, String summary,
                           String businessType, String businessId, String targetUrl,
                           String eventKey) {
        if (userId == null) return;
        Notification item = new Notification();
        item.setUserId(userId);
        item.setType(trim(type, 32));
        item.setTitle(trim(title, 120));
        item.setSummary(trim(summary, 500));
        item.setBusinessType(trim(businessType, 32));
        item.setBusinessId(trim(businessId, 96));
        item.setTargetUrl(safeTarget(targetUrl));
        item.setReadFlag(0);
        item.setEventKey(trim(eventKey, 160));
        item.setCreatedAt(new Date());
        try {
            save(item);
        } catch (DuplicateKeyException ignored) {
            // 同一业务事件重试时保持幂等。
        }
    }

    public IPage<Notification> pageMine(Long userId, int pageNum, int pageSize, Boolean unreadOnly) {
        return page(new Page<>(Math.max(1, pageNum), Math.max(1, Math.min(50, pageSize))),
                Wrappers.<Notification>lambdaQuery()
                        .eq(Notification::getUserId, userId)
                        .eq(Boolean.TRUE.equals(unreadOnly), Notification::getReadFlag, 0)
                        .orderByDesc(Notification::getCreatedAt).orderByDesc(Notification::getId));
    }

    public long unreadCount(Long userId) {
        return count(Wrappers.<Notification>lambdaQuery()
                .eq(Notification::getUserId, userId).eq(Notification::getReadFlag, 0));
    }

    @Transactional
    public boolean markRead(Long userId, Long id) {
        Notification existing = getOne(Wrappers.<Notification>lambdaQuery()
                .eq(Notification::getId, id).eq(Notification::getUserId, userId).last("FOR UPDATE"), false);
        if (existing == null) throw new CustomException("404", "通知不存在");
        if (Integer.valueOf(1).equals(existing.getReadFlag())) return true;
        existing.setReadFlag(1);
        existing.setReadAt(new Date());
        return updateById(existing);
    }

    public boolean markAllRead(Long userId) {
        Notification patch = new Notification();
        patch.setReadFlag(1);
        patch.setReadAt(new Date());
        return update(patch, Wrappers.<Notification>lambdaUpdate()
                .eq(Notification::getUserId, userId).eq(Notification::getReadFlag, 0));
    }

    private String safeTarget(String value) {
        String clean = trim(value, 255);
        if (clean == null) return null;
        if (!clean.startsWith("/page/") || clean.contains(":") || clean.startsWith("//")) {
            throw new CustomException("400", "通知跳转地址无效");
        }
        return clean;
    }

    private String trim(String value, int max) {
        if (value == null || value.trim().isEmpty()) return null;
        String clean = value.trim();
        if (clean.length() > max) return clean.substring(0, max);
        return clean;
    }
}
