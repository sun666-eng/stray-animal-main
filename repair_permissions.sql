-- Sync admin/user permission data for an existing database.
-- Safe to run repeatedly after importing older versions of test.sql.

UPDATE `t_permission` SET `name`='用户管理', `description`='管理系统用户和角色分配', `path`='/page/end/user.html' WHERE `flag`='user';
UPDATE `t_permission` SET `name`='角色管理', `description`='管理角色及角色权限', `path`='/page/end/role.html' WHERE `flag`='role';
UPDATE `t_permission` SET `name`='权限管理', `description`='管理后台权限菜单', `path`='/page/end/permission.html' WHERE `flag`='permission';
UPDATE `t_permission` SET `name`='动物管理', `description`='新增、编辑、删除动物档案', `path`='/page/end/animal.html' WHERE `flag`='animal';
UPDATE `t_permission` SET `name`='回访管理', `description`='管理动物领养后回访记录', `path`='/page/end/visit.html' WHERE `flag`='visit';
UPDATE `t_permission` SET `name`='领养审核', `description`='审核和管理领养申请', `path`='/page/end/adopt.html' WHERE `flag`='adopt';
UPDATE `t_permission` SET `name`='凭证管理', `description`='管理领养相关凭证', `path`='/page/end/proof.html' WHERE `flag`='proof';
UPDATE `t_permission` SET `name`='义工审核', `description`='审核和管理义工申请', `path`='/page/end/volunteer.html' WHERE `flag`='volunteer';
UPDATE `t_permission` SET `name`='资金公示管理', `description`='管理资金收入、支出和公示数据', `path`='/page/end/account.html' WHERE `flag`='account';
UPDATE `t_permission` SET `name`='公告管理', `description`='管理系统公告和活动通知', `path`='/page/end/notice.html' WHERE `flag`='notice';
UPDATE `t_permission` SET `name`='救助管理', `description`='管理救助请求并回复用户', `path`='/page/end/help.html' WHERE `flag`='help';

UPDATE `t_permission` SET `name`='动物浏览', `description`='用户端浏览可领养动物', `path`='/page/front/animal_browse.html' WHERE `flag`='adopt_view';
UPDATE `t_permission` SET `name`='我的领养申请', `description`='用户端查看自己的领养申请', `path`='/page/front/my_adopt.html' WHERE `flag`='my_adopt';
UPDATE `t_permission` SET `name`='领养凭证入口', `description`='用户端提交和管理自己的领养凭证', `path`='/page/front/adopt_proof.html' WHERE `flag`='my_proof';
UPDATE `t_permission` SET `name`='义工申请', `description`='用户端提交义工申请', `path`='/page/front/volunteer_apply.html' WHERE `flag`='apply';
UPDATE `t_permission` SET `name`='救助咨询', `description`='用户端提交救助咨询和救助请求', `path`='/page/front/rescue_apply.html' WHERE `flag` IN ('im', 'rescue');

UPDATE `t_role`
SET `permission`='[{"id":1,"name":"用户管理","path":"/page/end/user.html","description":"管理系统用户和角色分配","flag":"user"},{"id":2,"name":"角色管理","path":"/page/end/role.html","description":"管理角色及角色权限","flag":"role"},{"id":3,"name":"权限管理","path":"/page/end/permission.html","description":"管理后台权限菜单","flag":"permission"},{"id":6,"name":"动物管理","path":"/page/end/animal.html","description":"新增、编辑、删除动物档案","flag":"animal"},{"id":7,"name":"回访管理","path":"/page/end/visit.html","description":"管理动物领养后回访记录","flag":"visit"},{"id":8,"name":"领养审核","path":"/page/end/adopt.html","description":"审核和管理领养申请","flag":"adopt"},{"id":9,"name":"凭证管理","path":"/page/end/proof.html","description":"管理领养相关凭证","flag":"proof"},{"id":13,"name":"义工审核","path":"/page/end/volunteer.html","description":"审核和管理义工申请","flag":"volunteer"},{"id":17,"name":"资金公示管理","path":"/page/end/account.html","description":"管理资金收入、支出和公示数据","flag":"account"},{"id":44,"name":"公告管理","path":"/page/end/notice.html","description":"管理系统公告和活动通知","flag":"notice"},{"id":46,"name":"救助管理","path":"/page/end/help.html","description":"管理救助请求并回复用户","flag":"help"}]'
WHERE `id`=1;

UPDATE `t_role`
SET `permission`='[{"id":7,"name":"回访管理","path":"/page/end/visit.html","description":"管理动物领养后回访记录","flag":"visit"},{"id":6,"name":"动物管理","path":"/page/end/animal.html","description":"新增、编辑、删除动物档案","flag":"animal"},{"id":8,"name":"领养审核","path":"/page/end/adopt.html","description":"审核和管理领养申请","flag":"adopt"},{"id":9,"name":"凭证管理","path":"/page/end/proof.html","description":"管理领养相关凭证","flag":"proof"},{"id":44,"name":"公告管理","path":"/page/end/notice.html","description":"管理系统公告和活动通知","flag":"notice"},{"id":13,"name":"义工审核","path":"/page/end/volunteer.html","description":"审核和管理义工申请","flag":"volunteer"},{"id":17,"name":"资金公示管理","path":"/page/end/account.html","description":"管理资金收入、支出和公示数据","flag":"account"},{"id":46,"name":"救助管理","path":"/page/end/help.html","description":"管理救助请求并回复用户","flag":"help"}]'
WHERE `id`=2;

UPDATE `t_role`
SET `permission`='[{"id":43,"name":"动物浏览","path":"/page/front/animal_browse.html","description":"用户端浏览可领养动物","flag":"adopt_view"},{"id":11,"name":"我的领养申请","path":"/page/front/my_adopt.html","description":"用户端查看自己的领养申请","flag":"my_adopt"},{"id":12,"name":"领养凭证入口","path":"/page/front/adopt_proof.html","description":"用户端提交和管理自己的领养凭证","flag":"my_proof"},{"id":15,"name":"义工申请","path":"/page/front/volunteer_apply.html","description":"用户端提交义工申请","flag":"apply"},{"id":5,"name":"救助咨询","path":"/page/front/rescue_apply.html","description":"用户端提交救助咨询和救助请求","flag":"im"}]'
WHERE `id`=3;
