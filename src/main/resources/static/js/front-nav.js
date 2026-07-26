(function () {
  var FRONT_BASE = '/page/front/';
  // 普通用户默认首页：front/index（含「我的服务」）；管理员：end/index
  var MEMBER_HOME = '/page/front/index.html';
  var ADMIN_HOME = '/page/end/index.html';
  var FRONT_PAGES = {
    'index.html': true,
    'animal_browse.html': true,
    'animal_detail.html': true,
    'adopt_apply.html': true,
    'my_adopt.html': true,
    'adopt_proof.html': true,
    'my_visit.html': true,
    'volunteer_apply.html': true,
    'my_volunteer.html': true,
    'rescue_apply.html': true,
    'my_rescue.html': true,
    'notice_list.html': true,
    'notice_detail.html': true,
    'account_public.html': true,
    'login.html': true,
    'register.html': true
  };
  var NAV_ITEMS = [
    { href: 'animal_browse.html', text: '动物浏览' },
    { href: 'my_adopt.html', text: '我的领养申请' },
    { href: 'my_visit.html', text: '我的回访' },
    { href: 'volunteer_apply.html', text: '义工申请' },
    { href: 'my_volunteer.html', text: '我的义工申请' },
    { href: 'rescue_apply.html', text: '救助咨询' },
    { href: 'my_rescue.html', text: '我的救助' },
    { href: 'notice_list.html', text: '公告中心' },
    { href: 'account_public.html', text: '信息公示' }
  ];
  var STABLE_LAYOUT_STYLE_ID = 'front-stable-layout-style';
  var HOME_BUTTON_ID = 'front-home-button';

  function getUser() {
    try {
      return JSON.parse(sessionStorage.getItem('user') || '{}') || {};
    } catch (e) {
      return {};
    }
  }

  function currentPathWithQuery() {
    return window.location.pathname + window.location.search;
  }

  function loginUrl() {
    var redirect = currentPathWithQuery();
    if (window.location.pathname === '/page/front/login.html') {
      return '/page/front/login.html';
    }
    return '/page/front/login.html?redirect=' + encodeURIComponent(redirect);
  }

  // 与 UserWorkspace / RoleContracts 管理 flags 对齐（含 rescue）
  var ADMIN_FLAGS = ['user','role','permission','animal','adopt','proof','visit','volunteer','account','notice','help','rescue'];

  function userHasAdminAccess() {
    var user = getUser();
    if (window.UserWorkspace && typeof window.UserWorkspace.hasAdminAccess === 'function') {
      return window.UserWorkspace.hasAdminAccess(user);
    }
    if (!user || !user.id || !Array.isArray(user.permission)) return false;
    for (var i = 0; i < user.permission.length; i++) {
      var p = user.permission[i];
      if (p && ADMIN_FLAGS.indexOf(p.flag) >= 0) return true;
    }
    return false;
  }

  function resolveHome(user) {
    if (window.UserWorkspace && typeof window.UserWorkspace.defaultHome === 'function') {
      return window.UserWorkspace.defaultHome(user || getUser());
    }
    return userHasAdminAccess() ? ADMIN_HOME : MEMBER_HOME;
  }

  function normalizeFrontHref(href) {
    if (!href || href.indexOf('javascript:') === 0 || href.charAt(0) === '#') {
      return href;
    }
    if (href.indexOf('./') === 0) {
      href = href.slice(2);
    }
    var fileName = href.split('?')[0].split('#')[0];
    if (FRONT_PAGES[fileName]) {
      return FRONT_BASE + href;
    }
    return href;
  }

  function normalizeFrontLinks() {
    var anchors = document.querySelectorAll('a[href]');
    Array.prototype.forEach.call(anchors, function (anchor) {
      var href = anchor.getAttribute('href');
      var normalized = normalizeFrontHref(href);
      if (normalized && normalized !== href) {
        anchor.setAttribute('href', normalized);
      }
      if (anchor.getAttribute('href') === FRONT_BASE + 'login.html' && window.location.pathname !== FRONT_BASE + 'login.html') {
        anchor.setAttribute('href', loginUrl());
      }
    });
  }

  function injectStableLayoutStyles() {
    if (document.getElementById(STABLE_LAYOUT_STYLE_ID)) {
      return;
    }
    var style = document.createElement('style');
    style.id = STABLE_LAYOUT_STYLE_ID;
    style.textContent = [
      'html { overflow-y: scroll; scrollbar-gutter: stable; }',
      'body { margin-left: 0 !important; margin-right: 0 !important; }',
      '.page-shell { box-sizing: border-box; width: min(1180px, calc(100vw - 40px)); max-width: 1180px !important; margin-left: auto !important; margin-right: auto !important; padding-left: 20px !important; padding-right: 20px !important; }',
      '@media (max-width: 640px) { .page-shell { width: 100%; padding-left: 14px !important; padding-right: 14px !important; } }',
      '.nav, .nav-links { box-sizing: border-box; max-width: 100%; }',
      '#front-home-button { position: fixed; left: 20px; top: 20px; z-index: 10002; display: inline-flex; align-items: center; height: 42px; padding: 0 16px; border-radius: 12px; background: #fff; color: #1D4ED8; text-decoration: none; font-size: 15px; font-weight: 700; box-shadow: 0 8px 24px rgba(25,43,77,0.12); border: 1px solid rgba(37,99,235,0.12); cursor: pointer; pointer-events: auto; }',
      '#front-home-button:hover { background: #EFF6FF; }',
      '@media (max-width: 640px) { #front-home-button { left: 14px; top: 14px; height: 38px; padding: 0 12px; font-size: 14px; } }'
    ].join('\n');
    document.head.appendChild(style);
  }

  function injectHomeButton() {
    var path = window.location.pathname || '';
    var current = path.split('/').pop() || 'animal_browse.html';
    if (current === 'login.html' || current === 'register.html' || current === 'index.html') {
      return;
    }
    var user = getUser();
    var home = resolveHome(user);
    // 已在角色对应首页时不显示
    if (path === home || path.indexOf(home) === 0 || path === MEMBER_HOME || path === ADMIN_HOME) {
      var existingHome = document.getElementById(HOME_BUTTON_ID);
      if (existingHome && existingHome.parentNode) {
        existingHome.parentNode.removeChild(existingHome);
      }
      return;
    }
    var button = document.getElementById(HOME_BUTTON_ID);
    if (!button) {
      button = document.createElement('a');
      button.id = HOME_BUTTON_ID;
      document.body.appendChild(button);
    }
    button.href = home;
    button.textContent = '返回首页';
    button.setAttribute('title', '返回首页');
    button.onclick = function (e) {
      if (e) {
        e.preventDefault();
        e.stopPropagation();
      }
      var u = getUser();
      var target = resolveHome(u);
      if (!u || !u.id) {
        window.location.assign('/page/front/login.html?redirect=' + encodeURIComponent(MEMBER_HOME));
        return false;
      }
      window.location.assign(target);
      return false;
    };
  }

  function syncNavLinks() {
    var navContainers = document.querySelectorAll('.nav-links, .nav');
    Array.prototype.forEach.call(navContainers, function (container) {
      if (container.classList.contains('nav') && container.querySelector('.nav-links')) {
        return;
      }
      var hasFrontNavChip = Array.prototype.some.call(container.querySelectorAll('a.chip[href]'), function (link) {
        return NAV_ITEMS.some(function (item) {
          return normalizeFrontHref(link.getAttribute('href')) === FRONT_BASE + item.href;
        });
      });
      if (!hasFrontNavChip) {
        return;
      }
      var loginLink = container.querySelector('a.chip[href$="login.html"]');
      var userChip = container.querySelector('.nav-user');
      container.innerHTML = NAV_ITEMS.map(function (item) {
        return '<a class="chip" href="' + FRONT_BASE + item.href + '">' + item.text + '</a>';
      }).join('');
      if (userChip) {
        container.appendChild(userChip);
      } else if (loginLink) {
        container.appendChild(loginLink);
      }
    });
  }

  function highlightCurrentChip() {
    var current = window.location.pathname.split('/').pop() || 'animal_browse.html';
    var active = current === 'notice_detail.html' ? 'notice_list.html'
      : (current === 'animal_detail.html' ? 'animal_browse.html' : current);
    var chips = document.querySelectorAll('a.chip[href]');
    Array.prototype.forEach.call(chips, function (chip) {
      var href = chip.getAttribute('href');
      var normalized = normalizeFrontHref(href);
      if (normalized && normalized !== href) {
        chip.setAttribute('href', normalized);
      }
      chip.classList.remove('is-active');
      chip.style.background = '';
      chip.style.color = '';

      var target = '';
      try {
        target = new URL(chip.getAttribute('href'), window.location.origin).pathname.split('/').pop();
      } catch (e) {
        target = '';
      }
      if (target === active) {
        chip.classList.add('is-active');
        chip.style.background = '#2563EB';
        chip.style.color = '#fff';
      }
    });
  }

  function normalizeToolbar() {
    var toolbar = document.getElementById('user-toolbar');
    if (!toolbar) return;

    var user = getUser();
    var username = document.getElementById('toolbar-username');
    if (username) {
      username.textContent = user && user.username ? user.username : '未登录';
    }

    var links = toolbar.querySelectorAll('#toolbar-dropdown a');
    Array.prototype.forEach.call(links, function (link) {
      var text = (link.textContent || '').replace(/\s+/g, '');
      if (text === '个人信息') {
        link.href = user && user.id ? '/page/end/person.html' : loginUrl();
        link.textContent = user && user.id ? '个人信息' : '去登录';
      } else if (text === '管理后台' || text === '功能首页' || text === '系统首页' || text === '用户首页') {
        if (user && user.id) {
          link.style.display = 'block';
          link.href = resolveHome(user);
          link.textContent = userHasAdminAccess() ? '管理后台' : '用户首页';
        } else {
          link.style.display = 'none';
        }
      } else if (text === '退出登录') {
        link.style.display = user && user.id ? 'block' : 'none';
        link.setAttribute('href', 'javascript:void(0)');
        link.onclick = function (event) {
          event.preventDefault();
          window.handleLogout();
        };
      }
    });
  }

  window.handleLogout = function () {
    if (window.AuthSession && typeof window.AuthSession.logout === 'function') {
      window.AuthSession.logout();
      return;
    }
    if (window.jQuery) {
      window.jQuery.ajax({
        url: '/api/user/logout',
        type: 'POST',
        contentType: 'application/json',
        data: '{}',
        xhrFields: { withCredentials: true },
        headers: { 'X-CSRF-Token': (sessionStorage.getItem('csrfToken') || '') }
      }).always(function () {
        sessionStorage.removeItem('user');
        sessionStorage.removeItem('token');
        sessionStorage.removeItem('csrfToken');
        localStorage.removeItem('token');
        window.location.href = '/page/front/login.html';
      });
      return;
    }
    window.location.href = '/page/front/login.html';
  };

  function refreshToolbarFromSession() {
    try {
      if (window.AuthSession && window.AuthSession.getUser()) {
        // getUser already from storage; fillPermissions refreshed via /me
      }
    } catch (e) { /* ignore */ }
    normalizeToolbar();
    var u = getUser();
    var el = document.getElementById('toolbar-username');
    if (el) {
      el.textContent = u && u.username ? u.username : '未登录';
    }
  }

  function init() {
    injectStableLayoutStyles();
    // Session 权威 + 静默 /api/user/me
    if (window.AuthSession) {
      window.AuthSession.bootstrap({
        requireAuth: false,
        onDone: function () {
          refreshToolbarFromSession();
        }
      });
    } else if (window.jQuery) {
      window.jQuery.ajaxSetup({
        xhrFields: { withCredentials: true },
        beforeSend: function (xhr, settings) {
          var method = (settings && settings.type ? settings.type : 'GET').toUpperCase();
          if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
            var csrf = sessionStorage.getItem('csrfToken');
            if (csrf) {
              xhr.setRequestHeader('X-CSRF-Token', csrf);
            }
          }
        }
      });
      window.jQuery(document).ajaxError(function (event, xhr) {
        if (xhr && xhr.status === 401) {
          try {
            sessionStorage.removeItem('user');
            sessionStorage.removeItem('token');
            sessionStorage.removeItem('csrfToken');
            localStorage.removeItem('token');
          } catch (e) { /* ignore */ }
          window.location.href = loginUrl();
        }
      });
    }
    syncNavLinks();
    normalizeFrontLinks();
    highlightCurrentChip();
    injectHomeButton();
    refreshToolbarFromSession();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
