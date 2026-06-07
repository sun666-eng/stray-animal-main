package com.example.service;

import cn.hutool.poi.excel.ExcelUtil;
import cn.hutool.poi.excel.ExcelWriter;
import com.example.dto.ImportResult;
import com.example.entity.Animal;
import com.example.mapper.AnimalMapper;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.web.multipart.MultipartFile;

import java.io.ByteArrayOutputStream;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
public class AnimalServiceImportTest {

    @Mock
    AnimalMapper animalMapper;

    @InjectMocks
    AnimalService animalService;

    private MultipartFile xlsx(List<String> headers, List<List<Object>> rows) throws Exception {
        ExcelWriter w = ExcelUtil.getWriter(true);
        w.writeHeadRow(headers);
        for (List<Object> r : rows) w.writeRow(r);
        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        w.flush(baos, true);
        w.close();
        return new MockMultipartFile("file", "t.xlsx",
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                baos.toByteArray());
    }

    @Test
    public void import_allValid_returnsAllSuccess() throws Exception {
        when(animalMapper.insert(any(Animal.class))).thenReturn(1);

        MultipartFile file = xlsx(
                Arrays.asList("名称", "品种", "性别", "生日", "状态", "描述"),
                Arrays.asList(
                        Arrays.asList("小白", "狗", "公", "2024-01-15", "待领养", "活泼"),
                        Arrays.asList("小黑", "猫", "母", "2023-06-10", "申请中", "温顺"),
                        Arrays.asList("橘子", "猫", "公", "", "", "")
                ));

        ImportResult r = animalService.importFromExcel(file);

        assertEquals(3, r.getTotal());
        assertEquals(3, r.getSuccessCount());
        assertTrue(r.getFailed().isEmpty());

        ArgumentCaptor<Animal> cap = ArgumentCaptor.forClass(Animal.class);
        verify(animalMapper, times(3)).insert(cap.capture());
        assertEquals("小白", cap.getAllValues().get(0).getTname());
        assertEquals(Integer.valueOf(0), cap.getAllValues().get(0).getTstate()); // "待领养" → 0
        assertEquals(Integer.valueOf(1), cap.getAllValues().get(1).getTstate()); // "申请中" → 1
        assertEquals(Integer.valueOf(0), cap.getAllValues().get(2).getTstate()); // 空 → 默认 0
    }

    @Test
    public void import_tnameEmpty_skipped() throws Exception {
        when(animalMapper.insert(any(Animal.class))).thenReturn(1);
        MultipartFile file = xlsx(
                Arrays.asList("名称", "品种"),
                Arrays.asList(
                        Arrays.asList("小白", "狗"),
                        Arrays.asList("", "猫"),           // 第 3 行：空名字
                        Arrays.asList("橘子", "猫")
                ));

        ImportResult r = animalService.importFromExcel(file);

        assertEquals(3, r.getTotal());
        assertEquals(2, r.getSuccessCount());
        assertEquals(1, r.getFailed().size());
        assertEquals(3, r.getFailed().get(0).getRow());
        assertTrue(r.getFailed().get(0).getReason().contains("名字"));
    }

    @Test
    public void import_invalidTstateText_skipped() throws Exception {
        MultipartFile file = xlsx(
                Arrays.asList("名称", "状态"),
                Arrays.asList(
                        Arrays.asList("小白", "出售中")     // 第 2 行：非法状态
                ));

        ImportResult r = animalService.importFromExcel(file);

        assertEquals(0, r.getSuccessCount());
        assertEquals(1, r.getFailed().size());
        assertTrue(r.getFailed().get(0).getReason().contains("状态"));
    }

    @Test
    public void import_tstateNumber_kept() throws Exception {
        when(animalMapper.insert(any(Animal.class))).thenReturn(1);
        MultipartFile file = xlsx(
                Arrays.asList("名称", "状态"),
                Arrays.asList(Arrays.asList("小白", 2)));

        animalService.importFromExcel(file);

        ArgumentCaptor<Animal> cap = ArgumentCaptor.forClass(Animal.class);
        verify(animalMapper).insert(cap.capture());
        assertEquals(Integer.valueOf(2), cap.getValue().getTstate());
    }

    @Test
    public void import_tbirthdayGarbage_succeedsWithNull() throws Exception {
        when(animalMapper.insert(any(Animal.class))).thenReturn(1);
        MultipartFile file = xlsx(
                Arrays.asList("名称", "生日"),
                Arrays.asList(Arrays.asList("小白", "明天")));

        ImportResult r = animalService.importFromExcel(file);

        assertEquals(1, r.getSuccessCount());
        assertTrue(r.getFailed().isEmpty());

        ArgumentCaptor<Animal> cap = ArgumentCaptor.forClass(Animal.class);
        verify(animalMapper).insert(cap.capture());
        assertNull(cap.getValue().getTbirthday());
    }

    @Test
    public void import_missingNameHeader_throws() throws Exception {
        MultipartFile file = xlsx(
                Arrays.asList("品种", "性别"),                  // 没有"名称"
                Arrays.asList(Arrays.asList("狗", "公")));

        com.example.exception.CustomException ex = assertThrows(
                com.example.exception.CustomException.class,
                () -> animalService.importFromExcel(file));

        assertTrue(ex.getMsg().contains("名称"));
        verify(animalMapper, never()).insert(any(Animal.class));
    }

    @Test
    public void import_dbException_sanitized() throws Exception {
        // 第一次成功，第二次抛 SQL 异常
        when(animalMapper.insert(any(Animal.class)))
                .thenReturn(1)
                .thenThrow(new RuntimeException("Duplicate entry SQL INSERT INTO t_animal..."));

        MultipartFile file = xlsx(
                Arrays.asList("名称"),
                Arrays.asList(
                        Arrays.asList("小白"),
                        Arrays.asList("小黑")));

        ImportResult r = animalService.importFromExcel(file);

        assertEquals(1, r.getSuccessCount());
        assertEquals(1, r.getFailed().size());
        assertEquals("数据保存失败，请检查该行数据", r.getFailed().get(0).getReason());
        assertFalse(r.getFailed().get(0).getReason().toLowerCase().contains("sql"));
    }
}
