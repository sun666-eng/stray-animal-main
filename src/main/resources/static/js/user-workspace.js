/**
 * 普通用户工作台：统一「默认首页」与「用户功能入口」。
 * 不依赖 Element / front-nav；与 RoleContracts.USER_LOOP_FLAGS 对应的可执行路径对齐。
 *
 * 排版优化（2026-07-27）：服务入口按信息架构分为三层——
 *   action   快速行动（大卡，用户的三个核心目的）
 *   record   我的记录（紧凑行，跟进进展）
 *   platform 了解平台（轻量链接）
 * 「提交领养凭证」独立卡已移除：凭证必须挂在具体申请下（M1 修复后其入口即我的领养）。
 * end/index 等旧消费方仍可用 services() 取扁平列表。
 */
(function (global) {
  'use strict';

  var ADMIN_FLAGS = Object.freeze([
    'user', 'role', 'permission', 'animal', 'adopt', 'proof', 'visit',
    'volunteer', 'account', 'notice', 'help', 'rescue'
  ]);

  var SERVICE_GROUPS = Object.freeze([
    Object.freeze({
      id: 'action', label: '快速行动', hint: '从这里开始一次帮助', style: 'action',
      items: Object.freeze([
        Object.freeze({ id: 'browse', mark: '领', label: '浏览待领养动物', href: '/page/front/animal_browse.html', desc: '查看可领养档案，为它找到一个家。', cta: '去看看' }),
        Object.freeze({ id: 'rescue', mark: '救', label: '发起救助', href: '/page/front/rescue_apply.html', desc: '发现需要帮助的动物，提交现场救助请求。', cta: '立即发起' }),
        Object.freeze({ id: 'volunteer', mark: '义', label: '申请成为义工', href: '/page/front/volunteer_apply.html', desc: '加入志愿服务，参与救助与回访工作。', cta: '提交申请' })
      ])
    }),
    Object.freeze({
      id: 'records', label: '我的记录', hint: '跟进每一次行动的进展', style: 'record',
      items: Object.freeze([
        Object.freeze({ id: 'my_adopt', label: '我的领养申请', href: '/page/front/my_adopt.html', desc: '查看审核进度 · 通过后在此上传凭证' }),
        Object.freeze({ id: 'visit', label: '我的回访记录', href: '/page/front/my_visit.html', desc: '查看工作人员回访' }),
        Object.freeze({ id: 'my_volunteer', label: '我的义工申请', href: '/page/front/my_volunteer.html', desc: '查看义工审核状态' }),
        Object.freeze({ id: 'my_rescue', label: '我的救助记录', href: '/page/front/my_rescue.html', desc: '查看处理进度与回复' })
      ])
    }),
    Object.freeze({
      id: 'platform', label: '了解平台', hint: '', style: 'platform',
      items: Object.freeze([
        Object.freeze({ id: 'notice', label: '救助动态', href: '/page/front/notice_list.html', sub: '平台公告' }),
        Object.freeze({ id: 'account', label: '透明公示', href: '/page/front/account_public.html', sub: '资金收支' }),
        Object.freeze({ id: 'person', label: '个人资料', href: '/page/end/person.html', sub: '邮箱与头像' })
      ])
    })
  ]);

  /** 兼容旧消费方（end/index 用户服务区）的扁平列表 */
  var USER_SERVICES = (function () {
    var flat = [];
    for (var g = 0; g < SERVICE_GROUPS.length; g++) {
      var items = SERVICE_GROUPS[g].items;
      for (var i = 0; i < items.length; i++) {
        var item = items[i];
        flat.push(Object.freeze({ id: item.id, label: item.label, href: item.href, desc: item.desc || item.sub || '' }));
      }
    }
    return Object.freeze(flat);
  })();

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

  function serviceGroups() {
    return SERVICE_GROUPS.slice();
  }

  global.UserWorkspace = Object.freeze({
    ADMIN_FLAGS: ADMIN_FLAGS,
    USER_SERVICES: USER_SERVICES,
    SERVICE_GROUPS: SERVICE_GROUPS,
    hasAdminAccess: hasAdminAccess,
    defaultHome: defaultHome,
    services: services,
    serviceGroups: serviceGroups
  });
})(typeof window !== 'undefined' ? window : this);
