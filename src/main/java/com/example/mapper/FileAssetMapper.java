package com.example.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.example.entity.FileAsset;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

@Mapper
public interface FileAssetMapper extends BaseMapper<FileAsset> {

    @Select("SELECT * FROM t_file_asset WHERE flag = #{flag} AND deleted = 0 LIMIT 1 FOR UPDATE")
    FileAsset selectLiveByFlagForUpdate(@Param("flag") String flag);

    // 审计修复 L4：补 deleted=0 过滤——已标删（退役）的残行不应继续占用上传者配额
    @Select("SELECT COUNT(*) FROM t_file_asset WHERE owner_id = #{ownerId} AND business_type IS NULL AND business_id IS NULL AND deleted = 0")
    long countLiveStagedByOwner(@Param("ownerId") Long ownerId);

    @Select("SELECT COALESCE(SUM(size_bytes), 0) FROM t_file_asset WHERE owner_id = #{ownerId} AND business_type IS NULL AND business_id IS NULL AND deleted = 0")
    long sumLiveStagedBytesByOwner(@Param("ownerId") Long ownerId);
}
