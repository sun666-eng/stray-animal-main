(function (global) {
  'use strict';

  var ROUTES = Object.freeze({
    user: Object.freeze({ label: '用户管理', href: '/page/end/user.html' }),
    role: Object.freeze({ label: '角色管理', href: '/page/end/role.html' }),
    permission: Object.freeze({ label: '权限管理', href: '/page/end/permission.html' }),
    animal: Object.freeze({ label: '动物档案', href: '/page/end/animal.html' }),
    adopt: Object.freeze({ label: '领养审核', href: '/page/end/adopt.html' }),
    proof: Object.freeze({ label: '领养凭证', href: '/page/end/proof.html' }),
    visit: Object.freeze({ label: '回访管理', href: '/page/end/visit.html' }),
    volunteer: Object.freeze({ label: '义工审核', href: '/page/end/volunteer.html' }),
    account: Object.freeze({ label: '资金公示', href: '/page/end/account.html' }),
    notice: Object.freeze({ label: '公告管理', href: '/page/end/notice.html' }),
    help: Object.freeze({ label: '救助咨询', href: '/page/end/help.html' }),
    rescue: Object.freeze({ label: '救助处理', href: '/page/end/help.html' }),
    admin_agent: Object.freeze({ label: 'AI 管理助手', href: '/page/end/admin_agent.html' })
  });
  var ROUTE_ORDER = Object.freeze([
    'user', 'role', 'permission', 'animal', 'adopt', 'proof', 'visit',
    'volunteer', 'account', 'notice', 'help', 'rescue', 'admin_agent'
  ]);
  var AVATAR_PLACEHOLDER = '/prototype-assets/editorial-04.svg';

  function permissionFlags(permissions) {
    var flags = Object.create(null);
    if (!Array.isArray(permissions)) return flags;
    permissions.forEach(function (permission) {
      var flag = permission && typeof permission.flag === 'string' ? permission.flag : '';
      if (ROUTES[flag]) flags[flag] = true;
    });
    return flags;
  }

  function navigation(permissions) {
    var flags = permissionFlags(permissions);
    var seenHrefs = Object.create(null);
    return ROUTE_ORDER.filter(function (flag) {
      return flags[flag];
    }).map(function (flag) {
      return { flag: flag, label: ROUTES[flag].label, href: ROUTES[flag].href };
    }).filter(function (route) {
      if (seenHrefs[route.href]) return false;
      seenHrefs[route.href] = true;
      return true;
    });
  }

  function hasFlag(user, flag) {
    return !!permissionFlags(user && user.permission)[flag];
  }

  function avatarUrl(flag) {
    if (!flag || typeof flag !== 'string') return AVATAR_PLACEHOLDER;
    return '/api/files/' + encodeURIComponent(flag);
  }

  function avatarFallback(event) {
    var image = event && event.target;
    if (!image) return;
    image.onerror = null;
    image.src = AVATAR_PLACEHOLDER;
  }

  if (!global.AuthSession) {
    global.location.replace('/page/front/login.html');
    return;
  }
  global.AuthSession.installAjaxAuth();
  global.AuthSession.sanitizeLocalSession();

  global.AdminWorkspace = Object.freeze({
    routes: ROUTES,
    navigation: navigation,
    hasFlag: hasFlag,
    avatarUrl: avatarUrl,
    avatarFallback: avatarFallback
  });
})(window);
