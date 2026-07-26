package com.example.common;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * 启动期写库策略：与 {@code app.schema-guard.auto-migrate} 对齐。
 * <p>
 * 生产 pure-check（auto-migrate=false）时，所有 ApplicationRunner 不得执行 DDL/DML。
 */
@Component
public class StartupMutationPolicy {

    private final boolean mutationsAllowed;

    public StartupMutationPolicy(
            @Value("${app.schema-guard.auto-migrate:true}") boolean autoMigrate) {
        this.mutationsAllowed = autoMigrate;
    }

    /** 是否允许启动 Runner 执行 CREATE/ALTER/INSERT/UPDATE/DELETE。 */
    public boolean isMutationsAllowed() {
        return mutationsAllowed;
    }

    public void requireMutations(String runner) {
        if (!mutationsAllowed) {
            throw new IllegalStateException(
                    "[" + runner + "] pure-check 模式禁止写库（app.schema-guard.auto-migrate=false）");
        }
    }
}
