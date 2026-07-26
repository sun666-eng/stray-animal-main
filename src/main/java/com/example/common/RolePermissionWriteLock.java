package com.example.common;

import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import java.util.concurrent.locks.ReentrantLock;
import java.util.function.Supplier;

/** Serializes role and permission definition writes within this application process. */
public final class RolePermissionWriteLock {

    private static final ReentrantLock LOCK = new ReentrantLock();
    private static final Object RESOURCE_KEY = RolePermissionWriteLock.class.getName();

    private RolePermissionWriteLock() {
    }

    public static <T> T execute(Supplier<T> action) {
        LOCK.lock();
        boolean unlockOnReturn = true;
        try {
            if (TransactionSynchronizationManager.isSynchronizationActive()
                    && !TransactionSynchronizationManager.hasResource(RESOURCE_KEY)) {
                TransactionSynchronizationManager.bindResource(RESOURCE_KEY, Boolean.TRUE);
                TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                    @Override
                    public void afterCompletion(int status) {
                        TransactionSynchronizationManager.unbindResourceIfPossible(RESOURCE_KEY);
                        LOCK.unlock();
                    }
                });
                unlockOnReturn = false;
            }
            return action.get();
        } finally {
            if (unlockOnReturn) {
                LOCK.unlock();
            }
        }
    }
}
