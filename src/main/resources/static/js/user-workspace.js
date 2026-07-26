/**
 * 普通用户工作台：统一「默认首页」与「用户功能入口」。
 * 不依赖 Element / front-nav；与 RoleContracts.USER_LOOP_FLAGS 对应的可执行路径对齐。
 */
(function (global) {
  'use strict';

  var ADMIN_FLAGS = Object.freeze([
    'user', 'role', 'permission', 'animal', 'adopt', 'proof', 'visit',
    'volunteer', 'account', 'notice', 'help', 'rescue'
  ]);

  /** 登录后普通用户应能直接使用的功能（路径均为 front 生产页） */
  var USER_SERVICES = Object.freeze([
    Object.freeze({ id: 'browse', label: '浏览待领养动物', href: '/page/front/animal_browse.html', desc: '查看可领养档案并提交申请' }),
    Object.freeze({ id: 'my_adopt', label: '我的领养申请', href: '/page/front/my_adopt.html', desc: '查看审核进度与结果' }),
    Object.freeze({ id: 'proof', label: '提交领养凭证', href: '/page/front/adopt_proof.html', desc: '通过申请后上传证明材料' }),
    Object.freeze({ id: 'visit', label: '我的回访记录', href: '/page/front/my_visit.html', desc: '查看工作人员回访' }),
    Object.freeze({ id: 'volunteer', label: '申请成为义工', href: '/page/front/volunteer_apply.html', desc: '提交义工申请' }),
    Object.freeze({ id: 'my_volunteer', label: '我的义工申请', href: '/page/front/my_volunteer.html', desc: '查看义工审核状态' }),
    Object.freeze({ id: 'rescue', label: '发起救助', href: '/page/front/rescue_apply.html', desc: '提交现场救助请求' }),
    Object.freeze({ id: 'my_rescue', label: '我的救助记录', href: '/page/front/my_rescue.html', desc: '查看处理进度与回复' }),
    Object.freeze({ id: 'notice', label: '救助动态', href: '/page/front/notice_list.html', desc: '浏览平台公告' }),
    Object.freeze({ id: 'account', label: '透明公示', href: '/page/front/account_public.html', desc: '公开资金收支' }),
    Object.freeze({ id: 'person', label: '个人资料', href: '/page/end/person.html', desc: '维护邮箱、电话与头像' })
  ]);

  function hasAdminAccess(user) {
    if (!user || !Array.isArray(user.permission)) return false;
    for (var i = 0; i < user.permission.length; i++) {
      var p = user.permission[i];
      if (p && ADMIN_FLAGS.indexOf(p.flag) >= 0) return true;
    }
    return false;
  }

  /** 无 redirect 时的默认首页：管理员 → 管理工作台；普通用户 → 用户端首页 */
  function defaultHome(user) {
    return hasAdminAccess(user) ? '/page/end/index.html' : '/page/front/index.html';
  }

  function services() {
    return USER_SERVICES.slice();
  }

  global.UserWorkspace = Object.freeze({
    ADMIN_FLAGS: ADMIN_FLAGS,
    USER_SERVICES: USER_SERVICES,
    hasAdminAccess: hasAdminAccess,
    defaultHome: defaultHome,
    services: services
  });
})(typeof window !== 'undefined' ? window : this);
