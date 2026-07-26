package com.example.component;

import com.example.common.PermissionUtil;
import com.example.entity.User;
import com.example.exception.CustomException;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

@Service
public class WebSocketTicketService {

    private static final long TICKET_TTL_SECONDS = 60;
    private static final int MAX_OUTSTANDING_TICKETS = 10_000;
    private static final int MAX_ISSUES_PER_WINDOW = 12;
    private static final long ISSUE_WINDOW_MILLIS = 60_000L;
    private final ConcurrentHashMap<String, Ticket> tickets = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<Long, String> userTickets = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<Long, IssueWindow> issueWindows = new ConcurrentHashMap<>();
    private final Deque<Expiry> expirations = new ArrayDeque<>();
    private final Object stateLock = new Object();
    private final int maxOutstandingTickets;
    private final int maxIssuesPerWindow;
    private final long issueWindowMillis;
    private final long ticketTtlMillis;

    public WebSocketTicketService() {
        this(MAX_OUTSTANDING_TICKETS, MAX_ISSUES_PER_WINDOW, ISSUE_WINDOW_MILLIS,
                TICKET_TTL_SECONDS * 1000L);
    }

    WebSocketTicketService(int maxOutstandingTickets, int maxIssuesPerWindow, long issueWindowMillis) {
        this(maxOutstandingTickets, maxIssuesPerWindow, issueWindowMillis, TICKET_TTL_SECONDS * 1000L);
    }

    WebSocketTicketService(int maxOutstandingTickets, int maxIssuesPerWindow,
                           long issueWindowMillis, long ticketTtlMillis) {
        this.maxOutstandingTickets = maxOutstandingTickets;
        this.maxIssuesPerWindow = maxIssuesPerWindow;
        this.issueWindowMillis = issueWindowMillis;
        this.ticketTtlMillis = ticketTtlMillis;
    }

    /** Ordinary authenticated users are authorized for the global rescue public room. */
    public String issue(User user) {
        if (user == null || user.getId() == null) {
            throw new CustomException("401", "未登录或登录已过期");
        }
        if (!PermissionUtil.hasAnyFlag(user, "im", "help", "rescue")) {
            throw new CustomException("403", "无权访问救助公共聊天室");
        }
        long nowMillis = System.currentTimeMillis();
        synchronized (stateLock) {
            cleanupExpired(nowMillis);
            Long userId = user.getId();
            String previous = userTickets.get(userId);
            if (previous == null && tickets.size() >= maxOutstandingTickets) {
                throw new CustomException("429", "WebSocket连接请求过多，请稍后再试");
            }
            checkIssueRate(userId, nowMillis);
            if (previous != null) {
                tickets.remove(previous);
            }
            String value = UUID.randomUUID().toString().replace("-", "");
            long expiresAtMillis = nowMillis + ticketTtlMillis;
            tickets.put(value, new Ticket(userId, Instant.ofEpochMilli(expiresAtMillis)));
            userTickets.put(userId, value);
            expirations.addLast(new Expiry(value, userId, expiresAtMillis));
            return value;
        }
    }

    public Long consume(String value) {
        if (value == null || value.trim().isEmpty()) {
            return null;
        }
        synchronized (stateLock) {
            cleanupExpired(System.currentTimeMillis());
            Ticket ticket = tickets.remove(value);
            if (ticket == null) {
                return null;
            }
            userTickets.remove(ticket.userId, value);
            if (!ticket.expiresAt.isAfter(Instant.now())) {
                return null;
            }
            return ticket.userId;
        }
    }

    public void revokeUser(Long userId) {
        if (userId == null) {
            return;
        }
        synchronized (stateLock) {
            String value = userTickets.remove(userId);
            if (value != null) {
                tickets.remove(value);
            }
        }
    }

    private void checkIssueRate(Long userId, long nowMillis) {
        IssueWindow window = issueWindows.get(userId);
        if (window == null || nowMillis - window.startedAt >= issueWindowMillis) {
            issueWindows.put(userId, new IssueWindow(nowMillis));
            return;
        }
        if (window.count >= maxIssuesPerWindow) {
            throw new CustomException("429", "WebSocket连接请求过于频繁，请稍后再试");
        }
        window.count++;
    }

    private void cleanupExpired(long nowMillis) {
        while (true) {
            Expiry expiry = expirations.peekFirst();
            if (expiry == null || expiry.expiresAtMillis > nowMillis) {
                return;
            }
            expirations.removeFirst();
            Ticket ticket = tickets.get(expiry.ticket);
            if (ticket != null && !ticket.expiresAt.isAfter(Instant.ofEpochMilli(nowMillis))) {
                tickets.remove(expiry.ticket, ticket);
                userTickets.remove(expiry.userId, expiry.ticket);
            }
            IssueWindow window = issueWindows.get(expiry.userId);
            if (window != null && nowMillis - window.startedAt >= issueWindowMillis) {
                issueWindows.remove(expiry.userId, window);
            }
        }
    }

    private static final class Ticket {
        private final Long userId;
        private final Instant expiresAt;

        private Ticket(Long userId, Instant expiresAt) {
            this.userId = userId;
            this.expiresAt = expiresAt;
        }
    }

    private static final class IssueWindow {
        private final long startedAt;
        private int count = 1;

        private IssueWindow(long startedAt) {
            this.startedAt = startedAt;
        }
    }

    private static final class Expiry {
        private final String ticket;
        private final Long userId;
        private final long expiresAtMillis;

        private Expiry(String ticket, Long userId, long expiresAtMillis) {
            this.ticket = ticket;
            this.userId = userId;
            this.expiresAtMillis = expiresAtMillis;
        }
    }
}
