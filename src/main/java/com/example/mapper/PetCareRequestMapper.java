package com.example.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.example.entity.PetCareRequest;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

public interface PetCareRequestMapper extends BaseMapper<PetCareRequest> {

    @Insert("INSERT IGNORE INTO t_petcare_request "
            + "(user_id, request_id, conversation_id, requested_conversation_id, "
            + "requested_conversation_known, question, status, "
            + "attempt_count, created_at, updated_at) "
            + "VALUES (#{row.userId}, #{row.requestId}, #{row.conversationId}, "
            + "#{row.requestedConversationId}, #{row.requestedConversationKnown}, #{row.question}, "
            + "#{row.status}, #{row.attemptCount}, #{row.createdAt}, #{row.updatedAt})")
    int insertIgnore(@Param("row") PetCareRequest row);

    @Select("SELECT id FROM t_user WHERE id = #{userId} FOR UPDATE")
    Long lockUser(@Param("userId") Long userId);

    @Update("UPDATE t_petcare_request SET status = 'running', attempt_count = attempt_count + 1, "
            + "error_code = NULL, error_message = NULL, updated_at = #{now} "
            + "WHERE id = #{id} AND status = 'failed'")
    int retryFailed(@Param("id") Long id, @Param("now") java.util.Date now);

    @Update("UPDATE t_petcare_request SET status = 'failed', error_code = '503', "
            + "error_message = #{message}, updated_at = #{now} "
            + "WHERE id = #{id} AND status = 'running' AND updated_at <= #{cutoff}")
    int expireStale(@Param("id") Long id, @Param("cutoff") java.util.Date cutoff,
                    @Param("now") java.util.Date now, @Param("message") String message);

    @Update("UPDATE t_petcare_request SET answer = #{answer.answer}, source = #{answer.source}, "
            + "degrade_reason = #{answer.degradeReason}, topic = #{answer.topic}, "
            + "tools_json = #{toolsJson}, status = 'answered', updated_at = #{now} "
            + "WHERE id = #{id} AND status = 'running' AND attempt_count = #{expectedAttempt}")
    int saveAnswerIfAttempt(@Param("id") Long id, @Param("expectedAttempt") int expectedAttempt,
                            @Param("answer") com.example.service.PetCareService.PetCareAnswer answer,
                            @Param("toolsJson") String toolsJson, @Param("now") java.util.Date now);

    @Update("UPDATE t_petcare_request SET status = 'failed', error_code = #{code}, "
            + "error_message = #{message}, updated_at = #{now} "
            + "WHERE id = #{id} AND status = 'running' AND attempt_count = #{expectedAttempt}")
    int failIfAttempt(@Param("id") Long id, @Param("expectedAttempt") int expectedAttempt,
                      @Param("code") String code, @Param("message") String message,
                      @Param("now") java.util.Date now);

    @Update("UPDATE t_petcare_request SET status = 'cancelled', answer = NULL, source = NULL, "
            + "degrade_reason = '', topic = NULL, tools_json = NULL, conversation_title = NULL, "
            + "error_code = '410', error_message = '会话已删除，任务结果不可再读取', "
            + "completed_at = NULL, updated_at = #{now} "
            + "WHERE user_id = #{userId} AND "
            + "(conversation_id = #{conversationId} OR requested_conversation_id = #{conversationId})")
    int cancelConversation(@Param("userId") Long userId,
                           @Param("conversationId") Long conversationId,
                           @Param("now") java.util.Date now);

    @Update("UPDATE t_petcare_request SET status = 'cancelled', answer = NULL, source = NULL, "
            + "degrade_reason = '', topic = NULL, tools_json = NULL, conversation_title = NULL, "
            + "error_code = '410', error_message = '聊天历史已清空，任务结果不可再读取', "
            + "completed_at = NULL, updated_at = #{now} WHERE user_id = #{userId}")
    int cancelAll(@Param("userId") Long userId, @Param("now") java.util.Date now);
}
