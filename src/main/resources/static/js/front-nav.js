(function () {
  var FRONT_BASE = '/page/front/';
  var FRONT_PAGES = {
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

  // 管理员端的 admin flag 集合，与 end/index.html 的 hasAdminAccess 保持一致
  var ADMIN_FLAGS = ['user','role','permission','animal','adopt','proof','visit','volunteer','account','notice','help'];

  function userHasAdminAccess() {
    var user = getUser();
    if (!user || !user.id || !Array.isArray(user.permission)) return false;
    for (var i = 0; i < user.permission.length; i++) {
      var p = user.permission[i];
      if (p && ADMIN_FLAGS.indexOf(p.flag) >= 0) return true;
    }
    return false;
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
      '#front-home-button { position: fixed; left: 20px; top: 20px; z-index: 9998; display: inline-flex; align-items: center; height: 42px; padding: 0 16px; border-radius: 12px; background: #fff; color: #1D4ED8; text-decoration: none; font-size: 15px; font-weight: 700; box-shadow: 0 8px 24px rgba(25,43,77,0.12); border: 1px solid rgba(37,99,235,0.12); }',
      '#front-home-button:hover { background: #EFF6FF; }',
      '@media (max-width: 640px) { #front-home-button { left: 14px; top: 14px; height: 38px; padding: 0 12px; font-size: 14px; } }'
    ].join('\n');
    document.head.appendChild(style);
  }

  function injectHomeButton() {
    var current = window.location.pathname.split('/').pop() || 'animal_browse.html';
    if (current === 'login.html' || current === 'register.html' || document.getElementById(HOME_BUTTON_ID)) {
      return;
    }
    var button = document.createElement('a');
    button.id = HOME_BUTTON_ID;
    // 普通用户回用户首页；管理员可进后台
    if (userHasAdminAccess()) {
      button.href = '/page/end/index.html';
      button.textContent = '管理后台';
    } else {
      button.href = FRONT_BASE + 'animal_browse.html';
      button.textContent = '返回首页';
    }
    document.body.appendChild(button);
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
    var active = current === 'notice_detail.html' ? 'notice_list.html' : current;
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
      } else if (text === '管理后台' || text === '功能首页') {
        // 只有具备任一 admin flag 的用户才看到后台入口，普通用户隐藏
        var hasAdmin = userHasAdminAccess();
        if (hasAdmin) {
          link.style.display = 'block';
          link.href = '/page/end/index.html';
          link.textContent = '管理后台';
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
    function goLogin() {
      sessionStorage.removeItem('user');
      sessionStorage.removeItem('token');
      localStorage.removeItem('token');
      window.location.href = '/page/front/login.html';
    }

    if (window.jQuery) {
      window.jQuery.ajax({ url: '/api/user/logout', type: 'GET' }).always(goLogin);
      return;
    }
    fetch('/api/user/logout', { method: 'GET', credentials: 'same-origin' }).then(goLogin).catch(goLogin);
  };

  function init() {
    injectStableLayoutStyles();
    if (window.jQuery) {
      window.jQuery.ajaxSetup({
        beforeSend: function (xhr) {
          var token = sessionStorage.getItem('token');
          if (token) {
            xhr.setRequestHeader('Authorization', 'Bearer ' + token);
          }
        }
      });
    }
    syncNavLinks();
    normalizeFrontLinks();
    highlightCurrentChip();
    injectHomeButton();
    normalizeToolbar();
    if (window.jQuery) {
      window.jQuery(document).ajaxError(function (event, xhr) {
        if (xhr && xhr.status === 401) {
          window.location.href = loginUrl();
        }
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
