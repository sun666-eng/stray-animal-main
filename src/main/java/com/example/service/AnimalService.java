package com.example.service;

import cn.hutool.core.util.StrUtil;
import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.example.common.ExcelImportUtil;
import com.example.dto.ImportResult;
import com.example.entity.Animal;
import com.example.entity.Adopt;
import com.example.entity.User;
import com.example.exception.CustomException;
import com.example.mapper.AnimalMapper;
import com.example.mapper.AdoptMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

import jakarta.annotation.Resource;
import java.io.IOException;
import java.util.List;
import java.util.Map;
import java.time.LocalDate;
import java.time.ZoneId;

@Service
public class AnimalService extends ServiceImpl<AnimalMapper, Animal> {

    private static final Logger log = LoggerFactory.getLogger(AnimalService.class);
    private static final int MAX_ROWS = 500;
    private static final long MAX_BYTES = 10L * 1024 * 1024;

    @Resource
    private AnimalMapper animalMapper;

    @Resource
    private FileAssetService fileAssetService;

    @Resource
    private AdoptMapper adoptMapper;

    public Integer lockState(Long id) {
        return id == null ? null : animalMapper.selectStateForUpdate(id);
    }

    public boolean compareAndSetState(Long id, Integer expectedState, Integer nextState) {
        if (id == null || expectedState == null || nextState == null) {
            return false;
        }
        if (expectedState.equals(nextState)) {
            return true;
        }
        return animalMapper.compareAndSetState(id, expectedState, nextState) == 1;
    }

    @Transactional
    public boolean saveAnimal(Animal animal, User user) {
        if (animal == null) {
            throw new CustomException("400", "动物信息不能为空");
        }
        animal.setId(null);
        animal.setTstate(0);
        normalizeAndValidate(animal);
        boolean ok = animalMapper.insert(animal) == 1;
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
        Animal existing = animalMapper.selectOne(Wrappers.<Animal>lambdaQuery()
                .eq(Animal::getId, animal.getId()).last("FOR UPDATE"));
        if (existing == null) {
            throw new CustomException("404", "动物不存在");
        }
        Animal updated = merge(existing, animal);
        updated.setTstate(existing.getTstate());
        normalizeAndValidate(updated);
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
        if (animalMapper.updateById(updated) != 1) {
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
        if (id == null) {
            throw new CustomException("400", "动物 ID 无效");
        }
        Animal existing = animalMapper.selectOne(Wrappers.<Animal>lambdaQuery()
                .eq(Animal::getId, id).last("FOR UPDATE"));
        if (existing == null) {
            throw new CustomException("404", "动物不存在");
        }
        if (hasAdoptionReference(id)) {
            throw new CustomException("409", "动物已有领养申请，不能删除");
        }
        fileAssetService.retireAllForBusiness("animal", id);
        if (animalMapper.deleteById(id) != 1) {
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
        result.setWorkflowNote("所有成功导入的动物状态均强制为0（待领养），工作簿状态不会被采用");

        int rowNum = 2;
        for (Map<String, Object> raw : rows) {
            try {
                Animal a = parseRow(raw);
                a.setTstate(0);
                normalizeAndValidate(a);
                if (animalMapper.insert(a) != 1) {
                    throw new CustomException("500", "动物信息保存失败");
                }
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
        String type = ExcelImportUtil.asString(r.get("品种"));
        String sex = ExcelImportUtil.asString(r.get("性别"));
        a.setTtype(StrUtil.isBlank(type) ? "未知" : type);
        a.setTsex(StrUtil.isBlank(sex) ? "未知" : sex);
        a.setTdescribe(ExcelImportUtil.asString(r.get("描述")));
        a.setTbirthday(ExcelImportUtil.asDate(r.get("生日")));
        a.setTstate(0);
        return a;
    }

    private boolean hasAdoptionReference(Long animalId) {
        Long count = adoptMapper.selectCount(Wrappers.<Adopt>lambdaQuery().eq(Adopt::getAid, animalId));
        return count != null && count > 0;
    }

    private Animal merge(Animal existing, Animal patch) {
        Animal result = new Animal();
        result.setId(existing.getId());
        result.setTname(patch.getTname() == null ? existing.getTname() : patch.getTname());
        result.setTtype(patch.getTtype() == null ? existing.getTtype() : patch.getTtype());
        result.setTsex(patch.getTsex() == null ? existing.getTsex() : patch.getTsex());
        // The management form is a complete replacement contract; null explicitly means unknown.
        result.setTbirthday(patch.getTbirthday());
        result.setTpic(patch.getTpic() == null ? existing.getTpic() : patch.getTpic());
        result.setTstate(existing.getTstate());
        result.setTdescribe(patch.getTdescribe() == null ? existing.getTdescribe() : patch.getTdescribe());
        return result;
    }

    private void normalizeAndValidate(Animal animal) {
        animal.setTname(required(animal.getTname(), 20, "动物名称"));
        animal.setTtype(required(animal.getTtype(), 20, "动物品种"));
        animal.setTsex(required(animal.getTsex(), 3, "动物性别"));
        if (!"公".equals(animal.getTsex()) && !"母".equals(animal.getTsex()) && !"未知".equals(animal.getTsex())) {
            throw new CustomException("400", "动物性别仅允许公、母或未知");
        }
        if (animal.getTstate() == null || animal.getTstate() < 0 || animal.getTstate() > 2) {
            throw new CustomException("400", "动物状态仅允许0待领养、1申请中或2已领养");
        }
        animal.setTpic(optional(animal.getTpic(), 100, "动物图片标识"));
        animal.setTdescribe(optional(animal.getTdescribe(), 100, "动物描述"));
        if (animal.getTbirthday() != null) {
            ZoneId productZone = ZoneId.of("Asia/Shanghai");
            LocalDate birthday = animal.getTbirthday().toInstant().atZone(productZone).toLocalDate();
            if (birthday.isAfter(LocalDate.now(productZone))) {
                throw new CustomException("400", "动物生日不能晚于今天");
            }
        }
    }

    private String required(String value, int max, String field) {
        String normalized = value == null ? "" : value.trim();
        if (normalized.isEmpty()) {
            throw new CustomException("400", field + "不能为空");
        }
        if (normalized.length() > max) {
            throw new CustomException("400", field + "不能超过" + max + "个字符");
        }
        return normalized;
    }

    private String optional(String value, int max, String field) {
        if (value == null) return null;
        String normalized = value.trim();
        if (normalized.length() > max) {
            throw new CustomException("400", field + "不能超过" + max + "个字符");
        }
        return normalized;
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
