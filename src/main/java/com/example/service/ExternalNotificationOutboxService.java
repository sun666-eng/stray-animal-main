package com.example.service;

import cn.hutool.json.JSONUtil;
import com.example.entity.Notification;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * P2 外部通知适配边界。默认关闭；配置渠道后只负责可靠入队，绝不把“已入队”冒充“已送达”。
 * 真正供应商发送器可消费 t_notification_outbox 并按 status/attempts/next_attempt_at 重试。
 */
@Service
public class ExternalNotificationOutboxService {
    private final JdbcTemplate jdbc;

    @Value("${app.notification.external.email-enabled:false}")
    private boolean emailEnabled;

    @Value("${app.notification.external.sms-enabled:false}")
    private boolean smsEnabled;

    public ExternalNotificationOutboxService(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public void enqueue(Notification notification) {
        if (notification == null || notification.getId() == null || notification.getUserId() == null) return;
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("title", notification.getTitle());
        payload.put("summary", notification.getSummary());
        payload.put("targetUrl", notification.getTargetUrl());
        String json = JSONUtil.toJsonStr(payload);
        if (emailEnabled) enqueueChannel(notification, "email", "email", json);
        if (smsEnabled) enqueueChannel(notification, "sms", "phone", json);
    }

    private void enqueueChannel(Notification notification, String channel, String userColumn, String payload) {
        String recipient = jdbc.queryForObject("SELECT " + userColumn + " FROM t_user WHERE id=?", String.class,
                notification.getUserId());
        if (recipient == null || recipient.trim().isEmpty()) return;
        try {
            jdbc.update("INSERT INTO t_notification_outbox(notification_id,user_id,channel,recipient,payload_json,status,next_attempt_at) "
                            + "VALUES(?,?,?,?,?,0,CURRENT_TIMESTAMP(3))",
                    notification.getId(), notification.getUserId(), channel, recipient.trim(), payload);
        } catch (DuplicateKeyException ignored) {
            // 同一站内通知、同一渠道仅入队一次。
        }
    }
}
