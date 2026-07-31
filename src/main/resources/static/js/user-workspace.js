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

  var PUBLIC_NAVIGATION = Object.freeze([
    Object.freeze({ id: 'home', label: '首页', href: '/page/front/index.html' }),
    Object.freeze({ id: 'browse', label: '等待一个家', href: '/page/front/animal_browse.html' }),
    Object.freeze({ id: 'notice', label: '救助动态', href: '/page/front/notice_list.html' }),
    Object.freeze({ id: 'account', label: '透明公示', href: '/page/front/account_public.html' })
  ]);

  var FRONT_ACCOUNT_GROUPS = Object.freeze([
    Object.freeze({
      id: 'actions',
      label: '我的行动',
      items: Object.freeze([
        Object.freeze({ id: 'my_adopt', label: '我的领养', href: '/page/front/my_adopt.html' }),
        Object.freeze({ id: 'notifications', label: '消息通知', href: '/page/front/notifications.html' }),
        Object.freeze({ id: 'my_rescue', label: '我的救助', href: '/page/front/my_rescue.html' }),
        Object.freeze({ id: 'my_volunteer', label: '我的义工', href: '/page/front/my_volunteer.html' }),
        Object.freeze({ id: 'my_visit', label: '回访记录', href: '/page/front/my_visit.html' }),
        Object.freeze({ id: 'volunteer_tasks', label: '义工任务', href: '/page/front/volunteer_tasks.html' })
      ])
    }),
    Object.freeze({
      id: 'tools',
      label: '工具与账户',
      items: Object.freeze([
        Object.freeze({ id: 'pet_care', label: '照顾知识助手', href: '/page/front/pet_care.html' }),
        Object.freeze({ id: 'favorites', label: '我的收藏', href: '/page/front/favorites.html' }),
        Object.freeze({ id: 'profile', label: '个人资料', href: '/page/end/person.html' })
      ])
    })
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
        Object.freeze({ id: 'petcare', label: '照顾知识助手', href: '/page/front/pet_care.html', sub: '喂养与健康问答' }),
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

  // Safe post-auth return targets (must match real pages under /page).
  var PUBLIC_REDIRECT_PATHS = Object.freeze([
    '/page/front/index.html',
    '/page/front/animal_browse.html',
    '/page/front/animal_detail.html',
    '/page/front/notice_list.html',
    '/page/front/notice_detail.html',
    '/page/front/account_public.html',
    '/page/front/login.html',
    '/page/front/register.html'
  ]);

  var MEMBER_REDIRECT_PATHS = Object.freeze([
    '/page/front/my_adopt.html',
    '/page/front/my_visit.html',
    '/page/front/my_volunteer.html',
    '/page/front/my_rescue.html',
    '/page/front/adopt_apply.html',
    '/page/front/adopt_proof.html',
    '/page/front/volunteer_apply.html',
    '/page/front/volunteer_tasks.html',
    '/page/front/rescue_apply.html',
    '/page/front/favorites.html',
    '/page/front/pet_care.html',
    '/page/front/notifications.html',
    '/page/end/person.html',
    '/page/end/index.html'
  ]);

  var ADMIN_REDIRECT_PATHS = Object.freeze([
    '/page/end/user.html',
    '/page/end/role.html',
    '/page/end/permission.html',
    '/page/end/animal.html',
    '/page/end/adopt.html',
    '/page/end/proof.html',
    '/page/end/visit.html',
    '/page/end/volunteer.html',
    '/page/end/account.html',
    '/page/end/notice.html',
    '/page/end/help.html',
    '/page/end/operations.html',
    '/page/end/admin_agent.html'
  ]);

  function isAdminPath(pathname) {
    return ADMIN_REDIRECT_PATHS.indexOf(pathname) >= 0;
  }

  function isAllowedPath(pathname) {
    return PUBLIC_REDIRECT_PATHS.indexOf(pathname) >= 0
      || MEMBER_REDIRECT_PATHS.indexOf(pathname) >= 0
      || ADMIN_REDIRECT_PATHS.indexOf(pathname) >= 0;
  }

  /**
   * Resolve a safe same-origin return URL after login/register.
   * options.memberOnly: reject admin paths even if user has admin flags
   *   (used after registration — accounts start without admin rights).
   */
  function safeRedirect(user, raw, options) {
    options = options || {};
    var fallback = defaultHome(user);
    if (raw == null || raw === '') return fallback;
    var text = String(raw);
    if (!text || text.charAt(0) !== '/' || text.charAt(1) === '/') return fallback;
    if (text.indexOf('\\') >= 0 || text.indexOf('..') >= 0) return fallback;
    if (/[\u0000-\u001F\u007F]/.test(text)) return fallback;
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(text)) return fallback;
    var target;
    try {
      target = new URL(text, (typeof location !== 'undefined' && location.origin) ? location.origin : 'http://127.0.0.1');
    } catch (e) {
      return fallback;
    }
    if (typeof location !== 'undefined' && location.origin && target.origin !== location.origin) return fallback;
    var pathname = target.pathname || '';
    if (!isAllowedPath(pathname)) return fallback;
    if (isAdminPath(pathname)) {
      if (options.memberOnly) return fallback;
      if (!hasAdminAccess(user)) return fallback;
    }
    // Keep business query; drop fragment to avoid hash-based tricks.
    return pathname + (target.search || '');
  }

  /** Read ?redirect= from current location and resolve safely. */
  function safeRedirectFromLocation(user, options) {
    var raw = '';
    try {
      raw = new URLSearchParams(location.search).get('redirect') || '';
    } catch (e) {
      raw = '';
    }
    return safeRedirect(user, raw, options);
  }

  /**
   * Append current redirect query to a same-page auth link (login ↔ register).
   * Does not validate the redirect value here; consumers still call safeRedirect on use.
   */
  function withRedirectParam(href) {
    var raw = '';
    try {
      raw = new URLSearchParams(location.search).get('redirect') || '';
    } catch (e) {
      raw = '';
    }
    if (!raw || raw.charAt(0) !== '/' || raw.charAt(1) === '/') return href;
    if (raw.indexOf('\\') >= 0 || raw.indexOf('..') >= 0) return href;
    try {
      var u = new URL(href, location.origin);
      u.searchParams.set('redirect', raw);
      return u.pathname + u.search;
    } catch (e2) {
      return href;
    }
  }

  function services() {
    return USER_SERVICES.slice();
  }

  function serviceGroups() {
    return SERVICE_GROUPS.slice();
  }

  function publicNavigation() {
    return PUBLIC_NAVIGATION.slice();
  }

  function frontAccountGroups() {
    return FRONT_ACCOUNT_GROUPS.slice();
  }

  function frontPageFlag(pathname) {
    var file = String(pathname || '').split('/').pop().split('?')[0].toLowerCase();
    if (!file || file === 'index.html') return 'home';
    if (/^(animal_browse|animal_detail|adopt_apply|adopt_proof|my_adopt|favorites)\.html$/.test(file)) return 'browse';
    if (/^(notice_list|notice_detail)\.html$/.test(file)) return 'notice';
    if (file === 'account_public.html') return 'account';
    return file.replace(/\.html$/, '');
  }

  global.UserWorkspace = Object.freeze({
    ADMIN_FLAGS: ADMIN_FLAGS,
    PUBLIC_NAVIGATION: PUBLIC_NAVIGATION,
    FRONT_ACCOUNT_GROUPS: FRONT_ACCOUNT_GROUPS,
    USER_SERVICES: USER_SERVICES,
    SERVICE_GROUPS: SERVICE_GROUPS,
    PUBLIC_REDIRECT_PATHS: PUBLIC_REDIRECT_PATHS,
    MEMBER_REDIRECT_PATHS: MEMBER_REDIRECT_PATHS,
    ADMIN_REDIRECT_PATHS: ADMIN_REDIRECT_PATHS,
    hasAdminAccess: hasAdminAccess,
    defaultHome: defaultHome,
    safeRedirect: safeRedirect,
    safeRedirectFromLocation: safeRedirectFromLocation,
    withRedirectParam: withRedirectParam,
    isAdminPath: isAdminPath,
    isAllowedPath: isAllowedPath,
    services: services,
    serviceGroups: serviceGroups,
    publicNavigation: publicNavigation,
    frontAccountGroups: frontAccountGroups,
    frontPageFlag: frontPageFlag
  });
})(typeof window !== 'undefined' ? window : this);
