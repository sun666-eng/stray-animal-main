package com.example.common;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * A0.4：输出转义契约。
 * 管理端聊天曾把 username 未转义拼进 HTML；安全渲染后原始 &lt;script&gt; 形态不得保留。
 */
public class HtmlEscapesTest {

    @Test
    public void escapeText_neutralizesScriptTag() {
        String payload = "<img src=x onerror=alert(1)>";
        String escaped = HtmlEscapes.escapeText(payload);
        assertFalse(escaped.contains("<img"));
        assertTrue(escaped.contains("&lt;img"));
        assertFalse(HtmlEscapes.containsRawAngleBrackets(escaped));
    }

    @Test
    public void unsafeConcat_wouldKeepExecutableShape() {
        // 复现：未转义拼接（历史漏洞形态）
        String username = "<img src=x onerror=alert(1)>";
        String unsafe = "<div class=\"msg-username\">" + username + "</div>";
        assertTrue(unsafe.contains("<img src=x onerror=alert(1)>"));
        // 修复形态：先转义再拼接
        String safe = "<div class=\"msg-username\">" + HtmlEscapes.escapeText(username) + "</div>";
        assertFalse(safe.contains("<img src=x onerror=alert(1)>"));
        assertTrue(safe.contains("&lt;img"));
    }

    @Test
    public void escapeText_nullIsEmpty() {
        assertEquals("", HtmlEscapes.escapeText(null));
    }

    @Test
    public void escapeText_quotesForAttributes() {
        String escaped = HtmlEscapes.escapeText("a\"b'c");
        assertTrue(escaped.contains("&quot;"));
        assertTrue(escaped.contains("&#39;"));
    }
}
