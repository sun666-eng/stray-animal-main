package com.example.service;

import com.example.common.FileStorage;
import com.example.component.StartupReadiness;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.mockito.InOrder;
import org.mockito.Mockito;
import org.springframework.test.util.ReflectionTestUtils;

import javax.sql.DataSource;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.stream.Stream;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class HealthProbeServiceTest {

    private StartupReadiness readiness;
    private DataSource dataSource;
    private FileStorage fileStorage;
    private Connection connection;
    private Statement statement;

    @TempDir
    Path uploadDir;

    @BeforeEach
    void setUp() throws Exception {
        readiness = new StartupReadiness();
        dataSource = mock(DataSource.class);
        connection = mock(Connection.class);
        statement = mock(Statement.class);
        fileStorage = FileStorage.forTest(uploadDir);
        when(dataSource.getConnection()).thenReturn(connection);
        when(connection.isClosed()).thenReturn(false);
        when(connection.getNetworkTimeout()).thenReturn(0);
        when(connection.createStatement()).thenReturn(statement);
    }

    private HealthProbeService service(long cacheMs) {
        return new HealthProbeService(readiness, dataSource, fileStorage, 2000L, cacheMs);
    }

    private void markReady() {
        ReflectionTestUtils.invokeMethod(readiness, "markReadyForTest");
    }

    @Test
    void notReadyWhenApplicationReadyEventMissing_doesNotOpenConnection() throws Exception {
        assertFalse(service(0).isReady());
        verify(dataSource, never()).getConnection();
    }

    @Test
    void falseWhenGetConnectionFails() throws Exception {
        markReady();
        when(dataSource.getConnection()).thenThrow(new SQLException("pool empty"));
        assertFalse(service(0).isReady());
    }

    @Test
    void falseWhenSelectFails() throws Exception {
        markReady();
        doThrow(new SQLException("select failed")).when(statement).execute("SELECT 1");
        assertFalse(service(0).isReady());
    }

    @Test
    void falseWhenUploadDirUnavailable(@TempDir Path other) {
        markReady();
        Path gone = other.resolve("missing-upload");
        FileStorage mockFs = mock(FileStorage.class);
        when(mockFs.getRoot()).thenReturn(gone);
        HealthProbeService svc = new HealthProbeService(readiness, dataSource, mockFs, 2000L, 0L);
        assertFalse(svc.isReady());
    }

    @Test
    void trueWhenDbAndUploadOk() {
        markReady();
        assertTrue(service(0).isReady());
    }

    @Test
    void cacheHitSkipsRepeatedProbes() throws Exception {
        markReady();
        HealthProbeService svc = service(60_000L);
        assertTrue(svc.isReady());
        assertTrue(svc.isReady());
        verify(dataSource, times(1)).getConnection();
    }

    @Test
    void cacheExpiryReProbes() throws Exception {
        markReady();
        HealthProbeService svc = new HealthProbeService(readiness, dataSource, fileStorage, 2000L, 1L);
        assertTrue(svc.isReady());
        Thread.sleep(5L);
        assertTrue(svc.isReady());
        verify(dataSource, times(2)).getConnection();
    }

    @Test
    void restoresNetworkTimeoutOnSuccess() throws Exception {
        markReady();
        when(connection.getNetworkTimeout()).thenReturn(12345);
        assertTrue(service(0).isReady());
        InOrder order = inOrder(connection);
        order.verify(connection).setNetworkTimeout(any(), eq(2000));
        order.verify(connection).setNetworkTimeout(any(), eq(12345));
        verify(connection).close();
        verify(connection, never()).abort(any());
    }

    @Test
    void restoresNetworkTimeoutWhenSelectThrows() throws Exception {
        markReady();
        when(connection.getNetworkTimeout()).thenReturn(99);
        doThrow(new SQLException("boom")).when(statement).execute("SELECT 1");
        assertFalse(service(0).isReady());
        verify(connection).setNetworkTimeout(any(), eq(2000));
        verify(connection).setNetworkTimeout(any(), eq(99));
        verify(connection).close();
        verify(connection, never()).abort(any());
    }

    @Test
    void whenRestoreThrows_abortsConnection_andReturnsFalse() throws Exception {
        markReady();
        when(connection.getNetworkTimeout()).thenReturn(50);
        // first set (probe timeout) succeeds; second set (restore) throws
        doAnswer(inv -> null)
                .doThrow(new SQLException("restore failed"))
                .when(connection).setNetworkTimeout(any(), org.mockito.ArgumentMatchers.anyInt());
        HealthProbeService svc = service(0);
        assertFalse(svc.isReady(), "restore failure must make readiness false even if SELECT succeeded");
        verify(connection).abort(any());
        // next probe must open a new connection (cannot reuse polluted physical connection)
        Connection conn2 = mock(Connection.class);
        Statement st2 = mock(Statement.class);
        when(dataSource.getConnection()).thenReturn(conn2);
        when(conn2.isClosed()).thenReturn(false);
        when(conn2.getNetworkTimeout()).thenReturn(0);
        when(conn2.createStatement()).thenReturn(st2);
        // after invalidate, second probe uses fresh connection
        svc.invalidateCache();
        assertTrue(svc.isReady());
        verify(dataSource, times(2)).getConnection();
        verify(conn2, never()).abort(any());
    }

    @Test
    void probeTempFileDoesNotRemain() throws Exception {
        markReady();
        assertTrue(service(0).isReady());
        try (Stream<Path> stream = Files.list(uploadDir)) {
            long leftovers = stream.filter(p -> p.getFileName().toString().startsWith(".health-probe-")).count();
            assertTrue(leftovers == 0, "health probe temp files must not remain");
        }
    }
}
