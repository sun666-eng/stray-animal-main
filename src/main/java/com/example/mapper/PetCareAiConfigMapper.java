package com.example.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.example.entity.PetCareAiConfig;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Update;

public interface PetCareAiConfigMapper extends BaseMapper<PetCareAiConfig> {

    @Insert("INSERT IGNORE INTO t_petcare_ai_config "
            + "(user_id, enabled, base_url, model, api_key_ciphertext, connection_status, "
            + "last_test_message, last_tested_at, version, created_at, updated_at) VALUES "
            + "(#{row.userId}, #{row.enabled}, #{row.baseUrl}, #{row.model}, #{row.apiKeyCiphertext}, "
            + "#{row.connectionStatus}, #{row.lastTestMessage}, #{row.lastTestedAt}, #{row.version}, "
            + "#{row.createdAt}, #{row.updatedAt})")
    int insertIgnore(@Param("row") PetCareAiConfig row);

    @Update("UPDATE t_petcare_ai_config SET enabled=#{row.enabled}, base_url=#{row.baseUrl}, "
            + "model=#{row.model}, api_key_ciphertext=#{row.apiKeyCiphertext}, "
            + "connection_status=#{row.connectionStatus}, last_test_message=#{row.lastTestMessage}, "
            + "last_tested_at=#{row.lastTestedAt}, version=version+1, updated_at=#{row.updatedAt} "
            + "WHERE user_id=#{row.userId} AND version=#{expectedVersion}")
    int updateConfig(@Param("row") PetCareAiConfig row,
                     @Param("expectedVersion") long expectedVersion);

    @Update("UPDATE t_petcare_ai_config SET connection_status=#{status}, "
            + "last_test_message=#{message}, last_tested_at=#{testedAt}, updated_at=#{testedAt} "
            + "WHERE user_id=#{userId} AND version=#{expectedVersion}")
    int markConnectionIfVersion(@Param("userId") Long userId,
                                @Param("expectedVersion") long expectedVersion,
                                @Param("status") String status,
                                @Param("message") String message,
                                @Param("testedAt") java.util.Date testedAt);
}
