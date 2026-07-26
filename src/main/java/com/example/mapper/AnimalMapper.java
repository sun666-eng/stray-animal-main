package com.example.mapper;

import com.example.entity.Animal;
import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

public interface AnimalMapper extends BaseMapper<Animal> {

    @Select("SELECT tstate FROM t_animal WHERE id = #{id} FOR UPDATE")
    Integer selectStateForUpdate(@Param("id") Long id);

    @Update("UPDATE t_animal SET tstate = #{nextState} WHERE id = #{id} AND tstate = #{expectedState}")
    int compareAndSetState(@Param("id") Long id,
                           @Param("expectedState") Integer expectedState,
                           @Param("nextState") Integer nextState);
}
