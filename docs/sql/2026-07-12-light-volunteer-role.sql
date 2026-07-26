-- 轻量「认证义工」角色：义工审核通过后只打标记，不授予后台管理权限
-- 默认 app.volunteer.auto-grant-role-id=4

USE `test`;

-- 角色 4：认证义工（无后台 flag；fillPermissions 不会因此获得 adopt/visit/proof 等）
INSERT INTO t_role (id, name, description, permission)
VALUES (
  4,
  '认证义工',
  '义工审核通过标记，无后台管理权限',
  '[]'
)
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  description = VALUES(description),
  permission = VALUES(permission);

-- 将「普通用户 + 志愿者(2)」中的 2 替换为认证义工(4)，收回误授的后台权限
-- 仅处理 role JSON 中含 "id":2 且含 "id":3 的账号（避免动纯志愿者运营账号）
UPDATE t_user
SET role = REPLACE(role, '"id":2', '"id":4')
WHERE role LIKE '%"id":2%'
  AND role LIKE '%"id":3%'
  AND role LIKE '%志愿者%';

-- 名称一并纠正（若上面只改了 id）
UPDATE t_user
SET role = REPLACE(role, '"name":"志愿者"', '"name":"认证义工"')
WHERE role LIKE '%"id":4%'
  AND role LIKE '%"name":"志愿者"%'
  AND role LIKE '%"id":3%';
