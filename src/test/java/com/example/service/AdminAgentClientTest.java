package com.example.service;

import cn.hutool.json.JSONArray;
import cn.hutool.json.JSONObject;
import cn.hutool.json.JSONUtil;
import com.example.entity.User;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class AdminAgentClientTest {

    private HttpServer server;

    @AfterEach
    void tearDown() {
        if (server != null) server.stop(0);
    }

    @Test
    void fiveParallelReadOnlyToolsAreAcceptedAndThenSummarized() throws Exception {
        AtomicInteger providerCalls = new AtomicInteger();
        List<JSONObject> requests = new ArrayList<>();
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/v1/chat/completions", exchange -> {
            requests.add(readJson(exchange));
            String body = providerCalls.incrementAndGet() == 1
                    ? toolCallResponse(5, 0)
                    : "{\"choices\":[{\"message\":{\"role\":\"assistant\","
                    + "\"content\":\"## 管理结论\\n已汇总五个模块。\"}}]}";
            writeJson(exchange, body);
        });
        server.start();

        AdminAgentTools tools = mock(AdminAgentTools.class);
        when(tools.toolSpecs()).thenReturn(specs(5));
        when(tools.execute(any(), any(), any())).thenReturn("{\"read_only\":true,\"count\":1}");
        AdminAgentClient client = configuredClient(tools);

        AdminAgentClient.AgentAnswer answer = client.ask(actor(), "读取五个指定模块",
                Collections.emptyList(), connectionConfig());

        assertTrue(answer.getAnswer().contains("已汇总五个模块"));
        assertEquals(5, answer.getToolsUsed().size());
        assertEquals(2, providerCalls.get());
        verify(tools, times(5)).execute(any(), any(), any());
        assertTrue(requests.get(0).containsKey("tools"));
        assertTrue(requests.get(1).getJSONArray("messages").stream()
                .map(String::valueOf).anyMatch(message -> message.contains("\"role\":\"tool\"")));
    }

    @Test
    void overviewQuestionCanFinishInOneProviderRoundWithServerPrefetch() throws Exception {
        AtomicInteger providerCalls = new AtomicInteger();
        List<JSONObject> requests = new ArrayList<>();
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/v1/chat/completions", exchange -> {
            requests.add(readJson(exchange));
            providerCalls.incrementAndGet();
            writeJson(exchange, "{\"choices\":[{\"message\":{\"role\":\"assistant\","
                    + "\"content\":\"当前有 4 份可领养档案和 1 份待审申请。\"}}]}");
        });
        server.start();

        AdminAgentTools tools = mock(AdminAgentTools.class);
        when(tools.toolSpecs()).thenReturn(specs(7));
        when(tools.execute(any(), eq("get_management_overview"), any()))
                .thenReturn("{\"read_only\":true,\"available_animals\":4,\"pending_adoptions\":1}");
        AdminAgentClient client = configuredClient(tools);

        AdminAgentClient.AgentAnswer answer = client.ask(actor(), "现在有多少待办？",
                Collections.emptyList(), connectionConfig());

        assertTrue(answer.getAnswer().contains("4 份"));
        assertEquals(Collections.singletonList("get_management_overview"), answer.getToolsUsed());
        assertEquals(1, providerCalls.get());
        verify(tools).execute(any(), eq("get_management_overview"), any());
        assertTrue(requests.get(0).toString().contains("服务器已预取最新只读管理概览"));
        assertEquals(900, requests.get(0).getInt("max_tokens"));
        assertFalse(requests.get(0).containsKey("tools"));
    }

    @Test
    void adoptionDraftUsesStructuredJsonAndRedactsUnexpectedContactText() throws Exception {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/v1/chat/completions", exchange -> {
            String content = new JSONObject()
                    .set("recommendation", "manual_review").set("risk_level", "medium")
                    .set("rationale", "固定住所与家庭意见需要结合原始材料核验")
                    .set("missing_info", "请联系 13812345678 补充住房证明")
                    .set("review_note", "先核对材料").toString();
            String response = new JSONObject().set("choices", new JSONArray().set(new JSONObject()
                    .set("message", new JSONObject().set("role", "assistant").set("content", content)))).toString();
            writeJson(exchange, response);
        });
        server.start();
        AdminAgentTools tools = mock(AdminAgentTools.class);
        when(tools.toolSpecs()).thenReturn(new JSONArray());
        AdminAgentClient client = configuredClient(tools);
        JSONObject context = new JSONObject().set("read_only", true).set("privacy_minimized", true)
                .set("untrusted_business_data", new JSONObject().set("application_state", 0));

        AdminAgentClient.AdoptionDraftSuggestion result = client.generateAdoptionDraft(
                actor(), context, connectionConfig());

        assertEquals("manual_review", result.getRecommendation());
        assertEquals("medium", result.getRiskLevel());
        assertFalse(result.getMissingInfo().contains("13812345678"));
        assertTrue(result.getMissingInfo().contains("已隐藏"));
        assertTrue(result.getReviewNote().contains("最终决定需管理员确认"));
    }

    @Test
    void exhaustedTotalBudgetForcesFinalAnswerInsteadOfGenericResourceFailure() throws Exception {
        AtomicInteger providerCalls = new AtomicInteger();
        List<JSONObject> requests = new ArrayList<>();
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/v1/chat/completions", exchange -> {
            requests.add(readJson(exchange));
            int call = providerCalls.incrementAndGet();
            String body = call == 1 ? toolCallResponse(5, 0)
                    : call == 2 ? toolCallResponse(4, 5)
                    : "{\"choices\":[{\"message\":{\"role\":\"assistant\","
                    + "\"content\":\"已基于取得的数据完成汇总。\"}}]}";
            writeJson(exchange, body);
        });
        server.start();

        AdminAgentTools tools = mock(AdminAgentTools.class);
        when(tools.toolSpecs()).thenReturn(specs(9));
        when(tools.execute(any(), any(), any())).thenReturn("{\"read_only\":true}");
        AdminAgentClient client = configuredClient(tools);

        AdminAgentClient.AgentAnswer answer = client.ask(actor(), "检查所有模块",
                Collections.emptyList(), connectionConfig());

        assertTrue(answer.getAnswer().contains("完成汇总"));
        assertEquals(8, answer.getToolsUsed().size());
        assertEquals(3, providerCalls.get());
        verify(tools, times(8)).execute(any(), any(), any());
        assertFalse(requests.get(2).containsKey("tools"));
        assertTrue(requests.get(2).toString().contains("tool_budget_exhausted"));
    }

    private AdminAgentClient configuredClient(AdminAgentTools tools) {
        PetCareService endpointGuard = mock(PetCareService.class);
        AdminAgentClient client = new AdminAgentClient(tools, endpointGuard);
        ReflectionTestUtils.setField(client, "timeoutMs", 3000L);
        ReflectionTestUtils.setField(client, "totalDeadlineMs", 8000L);
        ReflectionTestUtils.setField(client, "maxResponseBytes", 1024 * 1024);
        ReflectionTestUtils.setField(client, "maxTokens", 900);
        ReflectionTestUtils.setField(client, "maxHistoryMessages", 6);
        ReflectionTestUtils.setField(client, "maxHistoryChars", 4800);
        ReflectionTestUtils.setField(client, "maxToolRounds", 3);
        ReflectionTestUtils.setField(client, "maxToolCallsPerRound", 8);
        ReflectionTestUtils.setField(client, "maxToolCallsTotal", 8);
        ReflectionTestUtils.setField(client, "maxConcurrent", 2);
        return client;
    }

    private PetCareService.AiConnectionConfig connectionConfig() {
        return new PetCareService.AiConnectionConfig(true,
                "http://127.0.0.1:" + server.getAddress().getPort() + "/v1",
                "test-secret", "fake-admin-agent", false);
    }

    private static User actor() {
        User user = new User();
        user.setId(1L);
        return user;
    }

    private static JSONArray specs(int count) {
        JSONArray result = new JSONArray();
        for (int i = 0; i < count; i++) {
            result.add(new JSONObject().set("type", "function")
                    .set("function", new JSONObject().set("name", "tool_" + i)));
        }
        return result;
    }

    private static String toolCallResponse(int count, int offset) {
        JSONArray calls = new JSONArray();
        for (int i = 0; i < count; i++) {
            int number = offset + i;
            calls.add(new JSONObject().set("id", "call_" + number).set("type", "function")
                    .set("function", new JSONObject().set("name", "tool_" + number)
                            .set("arguments", "{}")));
        }
        return new JSONObject().set("choices", new JSONArray().set(new JSONObject()
                .set("message", new JSONObject().set("role", "assistant")
                        .set("content", null).set("tool_calls", calls)))).toString();
    }

    private static JSONObject readJson(HttpExchange exchange) throws IOException {
        return JSONUtil.parseObj(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
    }

    private static void writeJson(HttpExchange exchange, String body) throws IOException {
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type", "application/json");
        exchange.sendResponseHeaders(200, bytes.length);
        exchange.getResponseBody().write(bytes);
        exchange.close();
    }
}
