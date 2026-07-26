package com.example.service;

import com.example.entity.Notice;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.example.mapper.NoticeMapper;
import com.example.exception.CustomException;
import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import javax.annotation.Resource;

@Service
public class NoticeService extends ServiceImpl<NoticeMapper, Notice> {

    @Resource
    private NoticeMapper noticeMapper;

    @Transactional
    public boolean saveNotice(Notice notice) {
        validate(notice, false);
        notice.setId(null);
        if (!save(notice)) {
            throw new CustomException("500", "公告保存失败");
        }
        return true;
    }

    @Transactional
    public boolean updateNotice(Notice notice) {
        validate(notice, true);
        Notice existing = noticeMapper.selectOne(Wrappers.<Notice>lambdaQuery()
                .eq(Notice::getId, notice.getId()).last("FOR UPDATE"));
        if (existing == null) {
            throw new CustomException("404", "公告不存在");
        }
        // No version column exists: serialized updates are intentionally last-write-wins under this row lock.
        if (!updateById(notice)) {
            throw new CustomException("500", "公告更新失败");
        }
        return true;
    }

    @Transactional
    public boolean deleteNotice(Long id) {
        if (id == null) throw new CustomException("400", "公告 ID 无效");
        if (getById(id) == null) throw new CustomException("404", "公告不存在");
        if (!removeById(id)) throw new CustomException("409", "删除失败，请刷新后重试");
        return true;
    }

    private void validate(Notice notice, boolean requireId) {
        if (notice == null || (requireId && notice.getId() == null)) {
            throw new CustomException("400", requireId ? "公告 ID 无效" : "公告不能为空");
        }
        notice.setTitle(required(notice.getTitle(), 255, "公告标题"));
        notice.setContent(required(notice.getContent(), 65535, "公告内容"));
    }

    private String required(String value, int max, String field) {
        String normalized = value == null ? "" : value.trim();
        if (normalized.isEmpty()) throw new CustomException("400", field + "不能为空");
        if (normalized.length() > max) throw new CustomException("400", field + "不能超过" + max + "个字符");
        return normalized;
    }

}
