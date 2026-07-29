package com.example.service;

import cn.hutool.json.JSONArray;
import cn.hutool.json.JSONObject;
import cn.hutool.json.JSONUtil;
import com.example.exception.CustomException;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class PetCareAgentIntegrationTest {

    private HttpServer server;

    @AfterEach
    void tearDown() {
        if (server != null) {
            server.stop(0);
        }
    }

    @Test
    void realAgentLoopCallsToolThenAnswersWithToolResult() throws Exception {
        AtomicInteger calls = new AtomicInteger();
        List<JSONObject> requests = new ArrayList<>();
        List<String> authorization = new ArrayList<>();
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/v1/chat/completions", exchange -> {
            requests.add(readJson(exchange));
            authorization.add(exchange.getRequestHeaders().getFirst("Authorization"));
            int call = calls.incrementAndGet();
            String response = call == 1
                    ? "{\"choices\":[{\"message\":{\"role\":\"assistant\",\"content\":null,"
                    + "\"tool_calls\":[{\"id\":\"call_1\",\"type\":\"function\",\"function\":{"
                    + "\"name\":\"get_my_adoptions\",\"arguments\":\"{}\"}}]}}]}"
                    : "{\"choices\":[{\"message\":{\"role\":\"assistant\","
                    + "\"content\":\"已查到你的领养记录，请按档案安排疫苗。\"}}]}";
            writeJson(exchange, response);
        });
        server.start();

        PetCareTools tools = mock(PetCareTools.class);
        JSONArray specs = new JSONArray();
        specs.add(new JSONObject()
                .set("type", "function")
                .set("function", new JSONObject().set("name", "get_my_adoptions")));
        when(tools.toolSpecs()).thenReturn(specs);
        when(tools.execute(eq(42L), eq("get_my_adoptions"), any(JSONObject.class)))
                .thenReturn("{\"count\":1,\"items\":[{\"animal_name\":\"团团\"}]}");

        PetCareService service = new PetCareService();
        ReflectionTestUtils.setField(service, "petCareTools", tools);
        ReflectionTestUtils.setField(service, "aiTimeoutMs", 3000L);
        ReflectionTestUtils.setField(service, "maxToolRounds", 3);
        ReflectionTestUtils.setField(service, "maxHistory", 8);
        PetCareService.AiConnectionConfig connectionConfig = new PetCareService.AiConnectionConfig(true,
                "http://127.0.0.1:" + server.getAddress().getPort() + "/v1",
                "test-secret", "fake-agent", false);

        PetCareService.PetCareAnswer answer = service.ask(
                42L, "我领养的动物该注意什么？",
                java.util.Collections.emptyList(), connectionConfig);

        assertEquals("ai", answer.getSource());
        assertTrue(answer.getAnswer().contains("领养记录"));
        assertEquals(java.util.Collections.singletonList("get_my_adoptions"), answer.getToolsUsed());
        assertEquals(2, calls.get());
        assertEquals("Bearer test-secret", authorization.get(0));
        assertEquals("auto", requests.get(0).getStr("tool_choice"));
        assertTrue(requests.get(0).containsKey("tools"));
        assertTrue(requests.get(1).getJSONArray("messages").stream()
                .map(String::valueOf).anyMatch(message -> message.contains("\"role\":\"tool\"")));
        verify(tools).execute(eq(42L), eq("get_my_adoptions"), any(JSONObject.class));
    }

    @Test
    void connectionTestReturnsSafeProviderReasonInsteadOfGenericFailure() throws Exception {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/v1/chat/completions", exchange -> writeJson(
                exchange,
                401,
                "{\"error\":{\"message\":\"Incorrect API key provided: test-secret\","
                        + "\"code\":\"invalid_api_key\"}}"));
        server.start();

        PetCareService service = new PetCareService();
        ReflectionTestUtils.setField(service, "aiTimeoutMs", 3000L);
        PetCareService.AiConnectionConfig connectionConfig = new PetCareService.AiConnectionConfig(
                true,
                "http://127.0.0.1:" + server.getAddress().getPort() + "/v1",
                "test-secret",
                "fake-agent",
                false);

        CustomException failure = assertThrows(CustomException.class,
                () -> service.testAiConnection(connectionConfig));

        assertEquals("502", failure.getCode());
        assertTrue(failure.getMsg().contains("HTTP 401"));
        assertTrue(failure.getMsg().contains("API Key"));
        assertTrue(failure.getMsg().contains("[已隐藏]"));
        assertFalse(failure.getMsg().contains("test-secret"));
    }

    @Test
    void fourthConnectionTestIsRateLimitedBeforeExternalCall() throws Exception {
        AtomicInteger calls = new AtomicInteger();
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/v1/chat/completions", exchange -> {
            calls.incrementAndGet();
            writeJson(exchange, "{\"choices\":[{\"message\":{\"content\":\"连接成功\"}}]}");
        });
        server.start();
        PetCareService service = configuredService();
        PetCareService.AiConnectionConfig config = loopbackConfig();

        for (int i = 0; i < 3; i++) service.testAiConnection(88L, config);
        CustomException limited = assertThrows(CustomException.class,
                () -> service.testAiConnection(88L, config));

        assertEquals("429", limited.getCode());
        assertEquals(3, calls.get());
    }

    @Test
    void oversizedProviderResponseDegradesWithReason() throws Exception {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/v1/chat/completions", exchange -> writeJson(
                exchange, "{\"choices\":[{\"message\":{\"content\":\"0123456789\"}}]}"));
        server.start();
        PetCareService service = configuredService();
        ReflectionTestUtils.setField(service, "maxResponseBytes", 8);

        PetCareService.PetCareAnswer answer = service.ask(
                91L, "疫苗怎么安排", java.util.Collections.emptyList(), loopbackConfig());

        assertEquals("degraded", answer.getSource());
        assertTrue(answer.getDegradeReason().contains("响应体超过大小限制"));
    }

    @Test
    void finalNoToolsRoundReturningToolCallsIsProtocolFailure() throws Exception {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/v1/chat/completions", exchange -> writeJson(exchange,
                "{\"choices\":[{\"message\":{\"tool_calls\":[{\"id\":\"x\","
                        + "\"function\":{\"name\":\"get_my_adoptions\",\"arguments\":\"{}\"}}]}}]}"));
        server.start();
        PetCareTools tools = mock(PetCareTools.class);
        JSONArray specs = new JSONArray();
        specs.add(new JSONObject().set("type", "function"));
        when(tools.toolSpecs()).thenReturn(specs);
        when(tools.execute(any(), any(), any())).thenReturn("{}");
        PetCareService service = configuredService();
        ReflectionTestUtils.setField(service, "petCareTools", tools);
        ReflectionTestUtils.setField(service, "maxToolRounds", 1);

        PetCareService.PetCareAnswer answer = service.ask(
                92L, "我领养的猫", java.util.Collections.emptyList(), loopbackConfig());

        assertEquals("degraded", answer.getSource());
        assertTrue(answer.getDegradeReason().contains("禁用工具"));
    }

    private PetCareService configuredService() {
        PetCareService service = new PetCareService();
        PetCareTools tools = mock(PetCareTools.class);
        when(tools.toolSpecs()).thenReturn(new JSONArray());
        ReflectionTestUtils.setField(service, "petCareTools", tools);
        ReflectionTestUtils.setField(service, "aiTimeoutMs", 3000L);
        ReflectionTestUtils.setField(service, "totalDeadlineMs", 5000L);
        ReflectionTestUtils.setField(service, "maxResponseBytes", 1024 * 1024);
        ReflectionTestUtils.setField(service, "maxAnswerChars", 4000);
        ReflectionTestUtils.setField(service, "maxToolRounds", 3);
        ReflectionTestUtils.setField(service, "maxToolCallsPerRound", 4);
        ReflectionTestUtils.setField(service, "maxToolCallsTotal", 8);
        ReflectionTestUtils.setField(service, "maxHistory", 8);
        return service;
    }

    private PetCareService.AiConnectionConfig loopbackConfig() {
        return new PetCareService.AiConnectionConfig(true,
                "http://127.0.0.1:" + server.getAddress().getPort() + "/v1",
                "test-secret", "fake-agent", false);
    }

    private static JSONObject readJson(HttpExchange exchange) throws IOException {
        byte[] bytes = exchange.getRequestBody().readAllBytes();
        return JSONUtil.parseObj(new String(bytes, StandardCharsets.UTF_8));
    }

    private static void writeJson(HttpExchange exchange, String body) throws IOException {
        writeJson(exchange, 200, body);
    }

    private static void writeJson(HttpExchange exchange, int status, String body) throws IOException {
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type", "application/json");
        exchange.sendResponseHeaders(status, bytes.length);
        exchange.getResponseBody().write(bytes);
        exchange.close();
    }
}
