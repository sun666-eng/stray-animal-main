package com.example.component;

import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.ApplicationListener;
import org.springframework.stereotype.Component;

import java.util.concurrent.atomic.AtomicBoolean;

@Component
public class StartupReadiness implements ApplicationListener<ApplicationReadyEvent> {

    private final AtomicBoolean ready = new AtomicBoolean(false);

    @Override
    public void onApplicationEvent(ApplicationReadyEvent event) {
        ready.set(true);
    }

    public boolean isReady() {
        return ready.get();
    }

    void markReadyForTest() {
        ready.set(true);
    }
}
