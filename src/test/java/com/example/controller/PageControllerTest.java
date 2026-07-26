package com.example.controller;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;

class PageControllerTest {
    private final PageController controller = new PageController();

    @Test
    void publicEntriesUseCanonicalBrandHome() {
        assertEquals("redirect:/page/front/index.html", controller.siteRoot());
        assertEquals("redirect:/page/front/index.html", controller.frontEntry());
        assertEquals("redirect:/page/front/index.html", controller.prototypeEntry());
    }
}
