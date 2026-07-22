package com.example.service;

import cn.hutool.core.util.StrUtil;
import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.example.common.ExcelImportUtil;
import com.example.dto.ImportResult;
import com.example.entity.Animal;
import com.example.entity.User;
import com.example.exception.CustomException;
import com.example.mapper.AnimalMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

import javax.annotation.Resource;
import java.io.IOException;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@Service
public class AnimalService extends ServiceImpl<AnimalMapper, Animal> {

    private static final Logger log = LoggerFactory.getLogger(AnimalService.class);
    private static final int MAX_ROWS = 500;
    private static final long MAX_BYTES = 10L * 1024 * 1024;

    @Resource
    private AnimalMapper animalMapper;

    @Resource
    private FileAssetService fileAssetService;

    @Transactional
    public boolean saveAnimal(Animal animal, User user) {
        if (animal.getTstate() == null) {
            animal.setTstate(0);
        }
        boolean ok = save(animal);
        if (!ok) {
            throw new CustomException("500", "动物信息保存失败");
        }
        if (animal.getTpic() != null && !animal.getTpic().trim().isEmpty()) {
            fileAssetService.bindToBusiness(user, animal.getTpic(), "animal",
                    "animal", animal.getId(), true);
        }
        return true;
    }

    @Transactional
    public boolean updateAnimal(Animal animal, User user) {
        if (animal == null || animal.getId() == null) {
            throw new CustomException("400", "动物 ID 无效");
        }
        Animal existing = getOne(Wrappers.<Animal>lambdaQuery()
                .eq(Animal::getId, animal.getId()).last("FOR UPDATE"));
        if (existing == null) {
            throw new CustomException("404", "动物不存在");
        }
        String oldPic = existing.getTpic();
        String newPic = animal.getTpic();
        if (newPic != null) {
            String next = newPic.trim();
            String prev = oldPic == null ? "" : oldPic.trim();
            if (!next.isEmpty() && !next.equals(prev)) {
                fileAssetService.bindToBusiness(user, next, "animal",
                        "animal", animal.getId(), true);
            }
        }
        if (!updateById(animal)) {
            throw new CustomException("409", "业务记录已变化，请刷新后重试");
        }
        if (newPic != null) {
            String next = newPic.trim();
            String prev = oldPic == null ? "" : oldPic.trim();
            if (next.isEmpty()) {
                if (!prev.isEmpty()) {
                    fileAssetService.unbindIfMatches(prev, "animal", animal.getId());
                }
            } else if (!next.equals(prev) && !prev.isEmpty()) {
                fileAssetService.unbindIfMatches(prev, "animal", animal.getId());
            }
        }
        return true;
    }

    @Transactional
    public boolean deleteAnimal(Long id) {
        Animal existing = getOne(Wrappers.<Animal>lambdaQuery()
                .eq(Animal::getId, id).last("FOR UPDATE"));
        if (existing == null) {
            return true;
        }
        fileAssetService.unbindAllForBusiness("animal", id);
        if (!removeById(id)) {
            throw new CustomException("409", "删除失败，请刷新后重试");
        }
        return true;
    }

    public ImportResult importFromExcel(MultipartFile file) throws IOException {
        if (file != null && file.getSize() > MAX_BYTES) {
            throw new CustomException("400", "文件不能超过 10MB");
        }
        List<Map<String, Object>> rows = ExcelImportUtil.read(file, MAX_ROWS);

        // 表头预检
        if (!rows.isEmpty() && !rows.get(0).containsKey("名称")) {
            throw new CustomException("400", "Excel 表头必须包含\"名称\"列");
        }

        ImportResult result = new ImportResult();
        result.setTotal(rows.size());

        int rowNum = 2;
        for (Map<String, Object> raw : rows) {
            try {
                Animal a = parseRow(raw);
                save(a);
                result.setSuccessCount(result.getSuccessCount() + 1);
            } catch (Exception e) {
                String reason = sanitize(e);
                result.getFailed().add(new ImportResult.FailedRow(rowNum, reason));
                log.warn("import row {} failed", rowNum, e);
            }
            rowNum++;
        }
        return result;
    }

    private Animal parseRow(Map<String, Object> r) {
        Animal a = new Animal();
        String name = ExcelImportUtil.asString(r.get("名称"));
        if (StrUtil.isBlank(name)) {
            throw new CustomException("400", "名字不能为空");
        }
        a.setTname(name);
        a.setTtype(ExcelImportUtil.asString(r.get("品种")));
        a.setTsex(ExcelImportUtil.asString(r.get("性别")));
        a.setTdescribe(ExcelImportUtil.asString(r.get("描述")));
        a.setTbirthday(ExcelImportUtil.asDate(r.get("生日")));
        a.setTstate(parseTstate(r.get("状态")));
        return a;
    }

    private Integer parseTstate(Object v) {
        if (v == null || ExcelImportUtil.asString(v).isEmpty()) return 0;
        Integer asNum = ExcelImportUtil.asInt(v);
        if (asNum != null) {
            if (asNum == 0 || asNum == 1 || asNum == 2) return asNum;
            throw new CustomException("400", "无效的状态值：" + v);
        }
        Map<String, Integer> textMap = new HashMap<>();
        textMap.put("待领养", 0);
        textMap.put("申请中", 1);
        textMap.put("已领养", 2);
        Integer mapped = textMap.get(ExcelImportUtil.asString(v));
        if (mapped == null) {
            throw new CustomException("400", "无效的状态值：" + v);
        }
        return mapped;
    }

    private String sanitize(Exception e) {
        if (e instanceof CustomException) return ((CustomException) e).getMsg();
        String msg = e.getMessage() == null ? "未知错误" : e.getMessage();
        if (msg.length() > 100) msg = msg.substring(0, 100) + "...";
        String low = msg.toLowerCase();
        if (low.contains("sql") || low.contains("insert") || low.contains("constraint")) {
            return "数据保存失败，请检查该行数据";
        }
        return msg;
    }
}
