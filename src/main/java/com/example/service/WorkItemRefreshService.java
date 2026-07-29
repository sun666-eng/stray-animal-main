package com.example.service;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 将统一待办的物化刷新串行化。
 *
 * <p>列表与汇总可能被不同浏览器或不同应用实例同时请求。使用数据库中必然存在的
 * schema_version 元数据行作为事务锁，保证刷新事务提交后下一次刷新才开始，避免
 * 多批 INSERT IGNORE 在 t_work_item 唯一索引上互相形成插入意向死锁。</p>
 */
@Service
public class WorkItemRefreshService {
    private final JdbcTemplate jdbc;

    public WorkItemRefreshService(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Transactional
    public void refresh() {
        jdbc.queryForObject(
                "SELECT meta_value FROM app_schema_meta WHERE meta_key='schema_version' FOR UPDATE",
                String.class);
        jdbc.update("INSERT IGNORE INTO t_work_item(business_type,business_id,title,priority,due_at,status,source_event_key) "
                + "SELECT 'adopt',CONCAT(aid,':',uid),CONCAT('审核领养申请：',COALESCE(aname,aid)),2,NULL,0,CONCAT('adopt:',aid,':',uid) "
                + "FROM t_adopt WHERE vstate IN (0,3)");
        jdbc.update("INSERT IGNORE INTO t_work_item(business_type,business_id,title,priority,due_at,status,source_event_key) "
                + "SELECT 'proof',CAST(id AS CHAR),CONCAT('审核领养凭证 #',id),1,NULL,0,CONCAT('proof:',id) FROM t_proof WHERE pstatus=0");
        jdbc.update("INSERT IGNORE INTO t_work_item(business_type,business_id,title,priority,due_at,status,source_event_key) "
                + "SELECT 'rescue',CAST(id AS CHAR),CONCAT('处理救助事件 #',id),GREATEST(1,priority),NULL,0,CONCAT('rescue:',id) "
                + "FROM t_help WHERE status<>2");
        jdbc.update("INSERT IGNORE INTO t_work_item(business_type,business_id,title,priority,due_at,status,source_event_key) "
                + "SELECT 'visit_plan',CAST(id AS CHAR),CONCAT('逾期回访计划 #',id),2,CAST(due_at AS DATETIME),0,CONCAT('visit-plan:',id) "
                + "FROM t_visit_plan WHERE status=2");
        jdbc.update("UPDATE t_work_item w SET status=2,completed_at=COALESCE(completed_at,CURRENT_TIMESTAMP(3)),version=version+1 "
                + "WHERE w.status<>2 AND ((w.business_type='adopt' AND NOT EXISTS(SELECT 1 FROM t_adopt a WHERE BINARY CONCAT(a.aid,':',a.uid)=BINARY w.business_id AND a.vstate IN(0,3))) "
                + "OR (w.business_type='proof' AND NOT EXISTS(SELECT 1 FROM t_proof p WHERE p.id=CAST(w.business_id AS UNSIGNED) AND p.pstatus=0)) "
                + "OR (w.business_type='rescue' AND NOT EXISTS(SELECT 1 FROM t_help h WHERE h.id=CAST(w.business_id AS UNSIGNED) AND h.status<>2)) "
                + "OR (w.business_type='visit_plan' AND NOT EXISTS(SELECT 1 FROM t_visit_plan v WHERE v.id=CAST(w.business_id AS UNSIGNED) AND v.status=2)))");
    }
}
