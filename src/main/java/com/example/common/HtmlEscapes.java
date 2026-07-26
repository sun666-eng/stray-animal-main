package com.example.common;

/**
 * HTML 文本/属性转义（与前端 escape 行为对齐，便于单测固定契约）。
 * 输出到 HTML 时优先用 DOM textContent；此工具用于服务端消毒或测试断言。
 */
public final class HtmlEscapes {

    private HtmlEscapes() {
    }

    public static String escapeText(String raw) {
        if (raw == null) {
            return "";
        }
        StringBuilder sb = new StringBuilder(raw.length() + 16);
        for (int i = 0; i < raw.length(); i++) {
            char c = raw.charAt(i);
            switch (c) {
                case '&':
                    sb.append("&amp;");
                    break;
                case '<':
                    sb.append("&lt;");
                    break;
                case '>':
                    sb.append("&gt;");
                    break;
                case '"':
                    sb.append("&quot;");
                    break;
                case '\'':
                    sb.append("&#39;");
                    break;
                default:
                    sb.append(c);
            }
        }
        return sb.toString();
    }

    /**
     * 模拟「未转义直接拼进 HTML」是否仍含可执行危险片段（用于回归：安全渲染后不得保留原始尖括号标签形态）。
     */
    public static boolean containsRawAngleBrackets(String rendered) {
        return rendered != null && (rendered.contains("<") || rendered.contains(">"));
    }
}
