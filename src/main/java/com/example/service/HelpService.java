package com.example.service;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.example.common.PermissionUtil;
import com.example.entity.Help;
import com.example.entity.User;
import com.example.exception.CustomException;
import com.example.mapper.HelpMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import javax.annotation.Resource;
import java.util.Date;
import java.util.List;

@Service
public class HelpService extends ServiceImpl<HelpMapper, Help> {

    @Resource
    private FileAssetService fileAssetService;

    public List<Help> listByUid(Long uid) {
        return list(Wrappers.<Help>lambdaQuery()
                .eq(Help::getUid, uid)
                .orderByDesc(Help::getCreateTime));
    }

    @Transactional
    public boolean submitHelp(Help help, User user) {
        if (user == null || user.getId() == null) {
            throw new CustomException("401", "未登录或登录已过期");
        }
        help.setUid(user.getId());
        help.setUname(user.getUsername());
        help.setStatus(0);
        help.setCreateTime(new Date());
        help.setUpdateTime(new Date());
        if (!save(help)) {
            throw new CustomException("500", "救助请求保存失败");
        }
        if (help.getPic() != null && !help.getPic().trim().isEmpty()) {
            fileAssetService.bindToBusiness(user, help.getPic(), "help",
                    "help", help.getId(), false);
        }
        return true;
    }

    @Transactional
    public boolean updateHelp(Help help, User user) {
        if (user == null || user.getId() == null) {
            throw new CustomException("401", "未登录或登录已过期");
        }
        if (help == null || help.getId() == null) {
            throw new CustomException("400", "记录 ID 无效");
        }
        // 悲观锁业务行，避免并发换图/删除穿插
        Help existing = getOne(Wrappers.<Help>lambdaQuery()
                .eq(Help::getId, help.getId()).last("FOR UPDATE"));
        if (existing == null) {
            throw new CustomException("404", "记录不存在");
        }
        boolean manage = PermissionUtil.hasFlag(user, "help") || PermissionUtil.hasFlag(user, "rescue");
        if (!manage && !user.getId().equals(existing.getUid())) {
            throw new CustomException("403", "只能修改自己的救助请求");
        }
        if (!manage) {
            help.setUid(existing.getUid());
            if (existing.getStatus() != null && existing.getStatus() != 0) {
                throw new CustomException("403", "当前状态不可修改");
            }
            help.setStatus(0);
        }
        help.setUpdateTime(new Date());

        String oldPic = existing.getPic();
        String newPic = help.getPic();
        if (newPic != null) {
            String next = newPic.trim();
            String prev = oldPic == null ? "" : oldPic.trim();
            if (!next.isEmpty() && !next.equals(prev)) {
                fileAssetService.bindToBusiness(user, next, "help", "help", help.getId(), manage);
            }
        }

        if (!updateById(help)) {
            throw new CustomException("409", "业务记录已变化，请刷新后重试");
        }

        if (newPic != null) {
            String next = newPic.trim();
            String prev = oldPic == null ? "" : oldPic.trim();
            if (next.isEmpty()) {
                if (!prev.isEmpty()) {
                    fileAssetService.unbindIfMatches(prev, "help", help.getId());
                }
            } else if (!next.equals(prev) && !prev.isEmpty()) {
                fileAssetService.unbindIfMatches(prev, "help", help.getId());
            }
        }
        return true;
    }

    @Transactional
    public boolean deleteHelp(Long id) {
        Help existing = getOne(Wrappers.<Help>lambdaQuery()
                .eq(Help::getId, id).last("FOR UPDATE"));
        if (existing == null) {
            return true;
        }
        fileAssetService.unbindAllForBusiness("help", id);
        if (!removeById(id)) {
            throw new CustomException("409", "删除失败，请刷新后重试");
        }
        return true;
    }
}
