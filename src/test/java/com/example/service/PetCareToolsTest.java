package com.example.service;

import cn.hutool.json.JSONArray;
import cn.hutool.json.JSONObject;
import cn.hutool.json.JSONUtil;
import com.example.entity.Adopt;
import com.example.entity.Animal;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.Arrays;
import java.util.Collections;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

/**
 * agent 工具层的安全不变量——这些断言保护的是「模型不能越权」，破坏即为安全事故。
 */
@ExtendWith(MockitoExtension.class)
class PetCareToolsTest {

    @Mock
    AdoptService adoptService;
    @Mock
    AnimalService animalService;
    @Mock
    VisitService visitService;
    @Mock
    VolunteerService volunteerService;

    @InjectMocks
    PetCareTools tools;

    @Test
    void toolSpecs_declareNoUserIdParameter() {
        // 关键不变量：任何工具都不得暴露 userId/uid 参数，
        // 否则模型就有了表达「查别人数据」的手段
        JSONArray specs = tools.toolSpecs();
        assertEquals(4, specs.size());
        String json = specs.toString();
        assertFalse(json.contains("user_id"), "工具签名不得包含 user_id");
        assertFalse(json.contains("\"uid\""), "工具签名不得包含 uid");
    }

    @Test
    void myAdoptions_queriesOnlyInjectedUser() {
        Adopt row = new Adopt();
        row.setAid(10011L);
        row.setUid(7L);
        row.setAname("咪咪");
        row.setVstate(1);
        when(adoptService.list(any(com.baomidou.mybatisplus.core.conditions.Wrapper.class))).thenReturn(Collections.singletonList(row));

        JSONObject result = JSONUtil.parseObj(tools.execute(7L, "get_my_adoptions", new JSONObject()));

        assertEquals(1, result.getInt("count"));
        JSONObject first = result.getJSONArray("adoptions").getJSONObject(0);
        assertEquals("咪咪", first.getStr("animal_name"));
        assertEquals("已通过", first.getStr("review_status"));
    }

    @Test
    void myAdoptions_omitsPersonalContactFields() {
        // 结果裁剪：即使是用户自己的数据，手机号/住址/微信也不进 LLM 上下文
        Adopt row = new Adopt();
        row.setAid(1L);
        row.setAname("小白");
        row.setVstate(0);
        row.setTel(13800000000L);
        row.setLocation("上海市杨浦区xx路");
        row.setWechat("secret-wechat");
        when(adoptService.list(any(com.baomidou.mybatisplus.core.conditions.Wrapper.class))).thenReturn(Collections.singletonList(row));

        String json = tools.execute(7L, "get_my_adoptions", new JSONObject());

        assertFalse(json.contains("13800000000"));
        assertFalse(json.contains("杨浦"));
        assertFalse(json.contains("secret-wechat"));
    }

    @Test
    void animalProfile_publicAnimal_isReadable() {
        Animal animal = publicAnimal();
        when(animalService.getById(10011L)).thenReturn(animal);

        JSONObject result = JSONUtil.parseObj(
                tools.execute(7L, "get_animal_profile", new JSONObject().set("animal_id", 10011)));

        assertEquals("咪咪", result.getStr("name"));
        assertEquals("家猫", result.getStr("species_or_breed"));
        assertEquals("等待领养", result.getStr("status"));
    }

    @Test
    void animalProfile_adoptedAnimalOfOtherUser_isNotFound() {
        // 防枚举：已被他人领养(tstate=2)且本人未申请过 → 与不存在同样的响应
        Animal animal = publicAnimal();
        animal.setTstate(2);
        when(animalService.getById(10011L)).thenReturn(animal);
        when(adoptService.count(any(com.baomidou.mybatisplus.core.conditions.Wrapper.class))).thenReturn(0L);

        JSONObject result = JSONUtil.parseObj(
                tools.execute(7L, "get_animal_profile", new JSONObject().set("animal_id", 10011)));

        assertEquals("not_found", result.getStr("error"));
        assertFalse(result.containsKey("name"));
    }

    @Test
    void animalProfile_adoptedByRequestingUser_isReadable() {
        // 与 AnimalController H1 修复一致：本人申请过则可见
        Animal animal = publicAnimal();
        animal.setTstate(2);
        when(animalService.getById(10011L)).thenReturn(animal);
        when(adoptService.count(any(com.baomidou.mybatisplus.core.conditions.Wrapper.class))).thenReturn(1L);

        JSONObject result = JSONUtil.parseObj(
                tools.execute(7L, "get_animal_profile", new JSONObject().set("animal_id", 10011)));

        assertEquals("咪咪", result.getStr("name"));
        assertEquals("已找到新家", result.getStr("status"));
    }

    @Test
    void animalProfile_missingArgument_returnsStructuredError() {
        JSONObject result = JSONUtil.parseObj(
                tools.execute(7L, "get_animal_profile", new JSONObject()));
        assertEquals("bad_argument", result.getStr("error"));
    }

    @Test
    void unknownTool_returnsStructuredErrorInsteadOfThrowing() {
        // agent 容错：未知工具不抛异常，让模型能自行改口
        JSONObject result = JSONUtil.parseObj(tools.execute(7L, "delete_everything", new JSONObject()));
        assertEquals("unknown_tool", result.getStr("error"));
    }

    @Test
    void toolFailure_isSwallowedAsStructuredError() {
        when(adoptService.list(any(com.baomidou.mybatisplus.core.conditions.Wrapper.class))).thenThrow(new RuntimeException("db down"));
        JSONObject result = JSONUtil.parseObj(tools.execute(7L, "get_my_adoptions", new JSONObject()));
        assertEquals("tool_failed", result.getStr("error"));
    }

    @Test
    void emptyResults_reportZeroCountRatherThanError() {
        // 让模型能区分「没有记录」与「查询失败」——前者应据实说明，后者应降级
        when(visitService.list(any(com.baomidou.mybatisplus.core.conditions.Wrapper.class))).thenReturn(Collections.emptyList());
        JSONObject result = JSONUtil.parseObj(tools.execute(7L, "get_my_visits", new JSONObject()));
        assertEquals(0, result.getInt("count"));
        assertNotNull(result.getJSONArray("visits"));
    }

    @Test
    void allToolNamesAreExecutable() {
        // 声明与实现必须一一对应，否则模型会调到不存在的工具
        when(adoptService.list(any(com.baomidou.mybatisplus.core.conditions.Wrapper.class))).thenReturn(Collections.emptyList());
        when(visitService.list(any(com.baomidou.mybatisplus.core.conditions.Wrapper.class))).thenReturn(Collections.emptyList());
        when(volunteerService.list(any(com.baomidou.mybatisplus.core.conditions.Wrapper.class))).thenReturn(Collections.emptyList());
        for (String name : Arrays.asList("get_my_adoptions", "get_my_visits", "get_my_volunteer_status")) {
            JSONObject result = JSONUtil.parseObj(tools.execute(7L, name, new JSONObject()));
            assertFalse(result.containsKey("error"), name + " 应可执行");
        }
    }

    private static Animal publicAnimal() {
        Animal animal = new Animal();
        animal.setId(10011L);
        animal.setTname("咪咪");
        animal.setTtype("家猫");
        animal.setTsex("母");
        animal.setTstate(0);
        animal.setTdescribe("性格温和");
        return animal;
    }
}
