package com.example.controller;

import com.baomidou.mybatisplus.core.conditions.Wrapper;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.baomidou.mybatisplus.core.metadata.TableInfoHelper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.example.entity.Animal;
import com.example.service.AnimalService;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.apache.ibatis.builder.MapperBuilderAssistant;

import java.util.Map;
import java.util.Collections;
import com.example.exception.CustomException;
import com.example.entity.Permission;
import com.example.entity.User;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class AnimalControllerTest {

    @BeforeAll
    static void initializeTableMetadata() {
        TableInfoHelper.initTableInfo(new MapperBuilderAssistant(new MybatisConfiguration(), ""), Animal.class);
    }

    @Mock
    AnimalService animalService;

    @InjectMocks
    AnimalController animalController;

    @Test
    void publicPage_clampsPaginationAndBuildsConsistentFilters() {
        when(animalService.page(any(Page.class), any(Wrapper.class))).thenReturn(new Page<Animal>());

        animalController.findPage1("橘猫", "犬类", -4, 5000);

        ArgumentCaptor<Page> pageCaptor = ArgumentCaptor.forClass(Page.class);
        ArgumentCaptor<Wrapper> wrapperCaptor = ArgumentCaptor.forClass(Wrapper.class);
        verify(animalService).page(pageCaptor.capture(), wrapperCaptor.capture());

        assertEquals(1L, pageCaptor.getValue().getCurrent());
        assertEquals(50L, pageCaptor.getValue().getSize());
        LambdaQueryWrapper<Animal> wrapper = (LambdaQueryWrapper<Animal>) wrapperCaptor.getValue();
        String sql = wrapper.getSqlSegment();
        assertTrue(sql.contains("tstate"));
        assertTrue(sql.contains("tname"));
        assertTrue(sql.contains("ttype"));
        assertTrue(sql.contains("tdescribe"));
        assertTrue(sql.contains(" IN "));
        Map<String, Object> values = wrapper.getParamNameValuePairs();
        assertTrue(values.values().stream().anyMatch(value -> String.valueOf(value).contains("橘猫")));
        assertTrue(values.containsValue("犬"));
        assertTrue(values.containsValue("狗"));
    }

    @Test
    void publicPage_usesDefaultsForMissingPagination() {
        when(animalService.page(any(Page.class), any(Wrapper.class))).thenReturn(new Page<Animal>());

        animalController.findPage1("", "猫", null, null);

        ArgumentCaptor<Page> pageCaptor = ArgumentCaptor.forClass(Page.class);
        ArgumentCaptor<Wrapper> wrapperCaptor = ArgumentCaptor.forClass(Wrapper.class);
        verify(animalService).page(pageCaptor.capture(), wrapperCaptor.capture());
        assertEquals(1L, pageCaptor.getValue().getCurrent());
        assertEquals(10L, pageCaptor.getValue().getSize());
        LambdaQueryWrapper<Animal> wrapper = (LambdaQueryWrapper<Animal>) wrapperCaptor.getValue();
        wrapper.getSqlSegment();
        assertTrue(wrapper.getParamNameValuePairs().values().stream()
                .anyMatch(value -> "猫".equals(String.valueOf(value))));
    }

    @Test
    void exportRejectsRowsInsertedAfterCountWithBoundedProbe() {
        when(animalService.count()).thenReturn(10000L);
        when(animalService.list(any(Wrapper.class))).thenReturn(Collections.nCopies(10001, new Animal()));

        CustomException exception = assertThrows(CustomException.class,
                () -> animalController.export(requestWithPermission("animal"), new MockHttpServletResponse()));

        assertEquals("413", exception.getCode());
        ArgumentCaptor<Wrapper> wrapper = ArgumentCaptor.forClass(Wrapper.class);
        verify(animalService).list(wrapper.capture());
        assertTrue(wrapper.getValue().getCustomSqlSegment().endsWith("LIMIT 10001"));
    }

    private MockHttpServletRequest requestWithPermission(String flag) {
        User user = new User();
        Permission permission = new Permission();
        permission.setFlag(flag);
        user.setPermission(Collections.singletonList(permission));
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.getSession(true).setAttribute("user", user);
        return request;
    }
}
