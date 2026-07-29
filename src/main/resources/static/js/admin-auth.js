(function (global) {
  'use strict';

  var ROUTES = Object.freeze({
    user: Object.freeze({ label: '用户管理', shortLabel: '用户', href: '/page/end/user.html' }),
    role: Object.freeze({ label: '角色管理', shortLabel: '角色', href: '/page/end/role.html' }),
    permission: Object.freeze({ label: '权限管理', shortLabel: '权限', href: '/page/end/permission.html' }),
    animal: Object.freeze({ label: '动物档案', shortLabel: '档案', href: '/page/end/animal.html' }),
    adopt: Object.freeze({ label: '领养审核', shortLabel: '领养', href: '/page/end/adopt.html' }),
    proof: Object.freeze({ label: '领养凭证', shortLabel: '凭证', href: '/page/end/proof.html' }),
    visit: Object.freeze({ label: '回访管理', shortLabel: '回访', href: '/page/end/visit.html' }),
    volunteer: Object.freeze({ label: '义工审核', shortLabel: '义工', href: '/page/end/volunteer.html' }),
    account: Object.freeze({ label: '资金公示', shortLabel: '资金', href: '/page/end/account.html' }),
    notice: Object.freeze({ label: '公告管理', shortLabel: '公告', href: '/page/end/notice.html' }),
    help: Object.freeze({ label: '救助咨询', shortLabel: '救助', href: '/page/end/help.html' }),
    rescue: Object.freeze({ label: '救助处理', shortLabel: '救助', href: '/page/end/help.html' }),
    admin_agent: Object.freeze({ label: 'AI 管理助手', shortLabel: 'AI', href: '/page/end/admin_agent.html' }),
    operations: Object.freeze({ label: '运营中心', shortLabel: '运营', href: '/page/end/operations.html' })
  });
  var ROUTE_ORDER = Object.freeze([
    'user', 'role', 'permission', 'animal', 'adopt', 'proof', 'visit',
    'operations', 'volunteer', 'account', 'notice', 'help', 'rescue', 'admin_agent'
  ]);
  /* 桌面顶栏优先展示的入口；其余进入「更多」下拉，避免横向溢出扫读困难 */
  var DESKTOP_PRIMARY_FLAGS = Object.freeze([
    'animal', 'adopt', 'operations', 'help', 'admin_agent'
  ]);
  var NAV_GROUPS = Object.freeze([
    Object.freeze({ id: 'governance', label: '账号治理', flags: Object.freeze(['user', 'role', 'permission']) }),
    Object.freeze({ id: 'adoption', label: '档案与领养', flags: Object.freeze(['animal', 'adopt', 'proof', 'visit']) }),
    Object.freeze({ id: 'ops', label: '运营与服务', flags: Object.freeze(['operations', 'volunteer', 'account', 'notice', 'help', 'admin_agent']) })
  ]);
  var USER_SERVICES = Object.freeze([
    Object.freeze({ id: 'my-adopt', label: '我的领养', href: '/page/front/my_adopt.html' }),
    Object.freeze({ id: 'my-rescue', label: '我的救助', href: '/page/front/my_rescue.html' }),
    Object.freeze({ id: 'my-volunteer', label: '我的义工', href: '/page/front/my_volunteer.html' }),
    Object.freeze({ id: 'person', label: '个人资料', href: '/page/end/person.html' })
  ]);
  var AVATAR_PLACEHOLDER = '/prototype-assets/editorial-04.svg';
  var CACHE_BUST = '20260729b';

  function permissionFlags(permissions) {
    var flags = Object.create(null);
    if (!Array.isArray(permissions)) return flags;
    permissions.forEach(function (permission) {
      var flag = permission && typeof permission.flag === 'string' ? permission.flag : '';
      if (ROUTES[flag]) flags[flag] = true;
    });
    return flags;
  }

  function toRoute(flag) {
    var route = ROUTES[flag];
    if (!route) return null;
    return {
      flag: flag,
      label: route.label,
      shortLabel: route.shortLabel || route.label,
      href: route.href
    };
  }

  function navigation(permissions) {
    var flags = permissionFlags(permissions);
    flags.operations = ['adopt', 'proof', 'visit', 'volunteer', 'animal', 'account', 'help', 'rescue'].some(function (flag) {
      return !!flags[flag];
    });
    var seenHrefs = Object.create(null);
    return ROUTE_ORDER.filter(function (flag) {
      return flags[flag];
    }).map(toRoute).filter(function (route) {
      if (!route || seenHrefs[route.href]) return false;
      seenHrefs[route.href] = true;
      return true;
    });
  }

  function navigationGroups(permissions) {
    var items = navigation(permissions);
    var byFlag = Object.create(null);
    items.forEach(function (item) {
      byFlag[item.flag] = item;
    });
    return NAV_GROUPS.map(function (group) {
      return {
        id: group.id,
        label: group.label,
        items: group.flags.map(function (flag) {
          return byFlag[flag] || null;
        }).filter(Boolean)
      };
    }).filter(function (group) {
      return group.items.length > 0;
    });
  }

  function desktopNavigation(permissions) {
    var items = navigation(permissions);
    var primaryFlags = Object.create(null);
    DESKTOP_PRIMARY_FLAGS.forEach(function (flag) {
      primaryFlags[flag] = true;
    });
    var primary = [];
    var more = [];
    items.forEach(function (item) {
      if (primaryFlags[item.flag]) primary.push(item);
      else more.push(item);
    });
    return { primary: primary, more: more, all: items };
  }

  /** Vue data 片段：菜单由 permission 实时过滤，禁止硬编码全量菜单 */
  function navData(permissions, currentFlag) {
    return {
      menuItems: navigation(permissions),
      menuGroups: navigationGroups(permissions),
      desktopNav: desktopNavigation(permissions),
      currentNavFlag: currentFlag || '',
      mobileOpen: false,
      accountOpen: false,
      moreOpen: false
    };
  }

  function flagsMatch(itemFlag, currentFlag) {
    if (!currentFlag || !itemFlag) return false;
    if (itemFlag === currentFlag) return true;
    /* help / rescue 共用 help.html */
    if ((currentFlag === 'help' || currentFlag === 'rescue') && (itemFlag === 'help' || itemFlag === 'rescue')) {
      return true;
    }
    return false;
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

  /** 可混入各管理页 Vue methods 的导航交互（不覆盖业务方法时再合并） */
  var NAV_METHODS = Object.freeze({
    closeMenus: function () {
      this.mobileOpen = false;
      this.accountOpen = false;
      this.moreOpen = false;
    },
    toggleMore: function () {
      this.moreOpen = !this.moreOpen;
      this.accountOpen = false;
      this.mobileOpen = false;
    },
    toggleMobile: function () {
      this.mobileOpen = !this.mobileOpen;
      this.accountOpen = false;
      this.moreOpen = false;
    },
    toggleAccount: function () {
      this.accountOpen = !this.accountOpen;
      this.moreOpen = false;
      this.mobileOpen = false;
    },
    isNavActive: function (flag) {
      return flagsMatch(flag, this.currentNavFlag);
    },
    isMoreCurrent: function () {
      var vm = this;
      var more = (this.desktopNav && this.desktopNav.more) || [];
      return more.some(function (item) {
        return flagsMatch(item.flag, vm.currentNavFlag);
      });
    },
    isOverviewActive: function () {
      return !this.currentNavFlag;
    },
    avatarUrl: function (flag) {
      return avatarUrl(flag);
    },
    avatarFallback: function (event) {
      avatarFallback(event);
    },
    logout: function () {
      if (global.AuthSession && typeof global.AuthSession.logout === 'function') {
        global.AuthSession.logout();
      }
    }
  });

  if (!global.AuthSession) {
    global.location.replace('/page/front/login.html');
    return;
  }
  global.AuthSession.installAjaxAuth();
  global.AuthSession.sanitizeLocalSession();

  global.AdminWorkspace = Object.freeze({
    routes: ROUTES,
    cacheBust: CACHE_BUST,
    navigation: navigation,
    navigationGroups: navigationGroups,
    desktopNavigation: desktopNavigation,
    navData: navData,
    navMethods: NAV_METHODS,
    flagsMatch: flagsMatch,
    userServices: USER_SERVICES,
    hasFlag: hasFlag,
    avatarUrl: avatarUrl,
    avatarFallback: avatarFallback
  });
})(window);
