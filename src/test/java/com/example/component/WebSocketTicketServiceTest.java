package com.example.component;

import com.example.entity.User;
import com.example.entity.Permission;
import com.example.exception.CustomException;
import org.junit.jupiter.api.Test;

import java.util.Collections;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;

class WebSocketTicketServiceTest {

    @Test
    void authenticatedOrdinaryUserGetsOneTimeTicket() {
        WebSocketTicketService service = new WebSocketTicketService();
        User user = new User();
        user.setId(7L);
        Permission permission = new Permission();
        permission.setFlag("im");
        user.setPermission(Collections.singletonList(permission));

        String ticket = service.issue(user);

        assertNotNull(ticket);
        assertEquals(Long.valueOf(7L), service.consume(ticket));
        assertNull(service.consume(ticket));
    }

    @Test
    void anonymousTicketIssuanceIsRejected() {
        WebSocketTicketService service = new WebSocketTicketService();
        CustomException ex = assertThrows(CustomException.class, () -> service.issue(null));
        assertEquals("401", ex.getCode());
    }

    @Test
    void authenticatedUserWithoutChatAuthorizationIsRejected() {
        WebSocketTicketService service = new WebSocketTicketService();
        User user = new User();
        user.setId(7L);
        CustomException ex = assertThrows(CustomException.class, () -> service.issue(user));
        assertEquals("403", ex.getCode());
    }

    @Test
    void issuingAgainInvalidatesPriorTicketAndConsumeClearsUserIndex() {
        WebSocketTicketService service = new WebSocketTicketService(1, 10, 60_000L);
        User firstUser = authorizedUser(7L);

        String first = service.issue(firstUser);
        String replacement = service.issue(firstUser);

        assertNull(service.consume(first));
        assertEquals(Long.valueOf(7L), service.consume(replacement));
        assertNotNull(service.issue(authorizedUser(8L)));
    }

    @Test
    void revokeUserInvalidatesOutstandingTicket() {
        WebSocketTicketService service = new WebSocketTicketService();
        String ticket = service.issue(authorizedUser(7L));

        service.revokeUser(7L);

        assertNull(service.consume(ticket));
    }

    @Test
    void globalCapAndPerUserIssuanceRateReturn429() {
        WebSocketTicketService capped = new WebSocketTicketService(1, 10, 60_000L);
        capped.issue(authorizedUser(1L));
        CustomException cap = assertThrows(CustomException.class, () -> capped.issue(authorizedUser(2L)));
        assertEquals("429", cap.getCode());

        WebSocketTicketService limited = new WebSocketTicketService(10, 2, 60_000L);
        limited.issue(authorizedUser(3L));
        limited.issue(authorizedUser(3L));
        CustomException rate = assertThrows(CustomException.class, () -> limited.issue(authorizedUser(3L)));
        assertEquals("429", rate.getCode());
    }

    @Test
    void globalCapDrainsAllExpiredTicketsBeforeRejecting() throws InterruptedException {
        WebSocketTicketService service = new WebSocketTicketService(40, 10, 60_000L, 1L);
        for (long id = 1; id <= 40; id++) {
            service.issue(authorizedUser(id));
        }
        Thread.sleep(10L);

        assertNotNull(service.issue(authorizedUser(41L)));
    }

    private static User authorizedUser(Long id) {
        User user = new User();
        user.setId(id);
        Permission permission = new Permission();
        permission.setFlag("im");
        user.setPermission(Collections.singletonList(permission));
        return user;
    }
}
