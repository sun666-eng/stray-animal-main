package com.example.service;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.example.entity.Help;
import com.example.mapper.HelpMapper;
import org.springframework.stereotype.Service;

import java.util.List;

@Service
public class HelpService extends ServiceImpl<HelpMapper, Help> {

    public List<Help> listByUid(Long uid) {
        return list(Wrappers.<Help>lambdaQuery()
                .eq(Help::getUid, uid)
                .orderByDesc(Help::getCreateTime));
    }
}
