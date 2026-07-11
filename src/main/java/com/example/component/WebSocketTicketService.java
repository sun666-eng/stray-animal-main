package com.example.component;

import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

@Service
public class WebSocketTicketService {

    private static final long TICKET_TTL_SECONDS = 60;
    private final ConcurrentHashMap<String, Ticket> tickets = new ConcurrentHashMap<>();

    public String issue(Long userId) {
        cleanupExpired();
        String value = UUID.randomUUID().toString().replace("-", "");
        tickets.put(value, new Ticket(userId, Instant.now().plusSeconds(TICKET_TTL_SECONDS)));
        return value;
    }

    public Long consume(String value) {
        if (value == null || value.trim().isEmpty()) {
            return null;
        }
        Ticket ticket = tickets.remove(value);
        if (ticket == null || ticket.expiresAt.isBefore(Instant.now())) {
            return null;
        }
        return ticket.userId;
    }

    private void cleanupExpired() {
        Instant now = Instant.now();
        tickets.entrySet().removeIf(entry -> entry.getValue().expiresAt.isBefore(now));
    }

    private static final class Ticket {
        private final Long userId;
        private final Instant expiresAt;

        private Ticket(Long userId, Instant expiresAt) {
            this.userId = userId;
            this.expiresAt = expiresAt;
        }
    }
}
