/**
 * 统一登录态：Session Cookie + JWT（sessionStorage.token）
 * - 请求自动带 Authorization: Bearer
 * - 401 清本地并跳登录
 * - 本地有 user 无 token → 视为假登录并清除
 * - 可选 /api/user/me 静默校验
 *
 * 在 jquery 之后加载；front-nav.js / admin-auth.js 会调用 install。
 */
(function (global) {
  'use strict';

  var LOGIN_PATH = '/page/front/login.html';
  var KEY_USER = 'user';
  var KEY_TOKEN = 'token';
  var KEY_LEGACY = 'x-auth-token';

  function getToken() {
    try {
      return sessionStorage.getItem(KEY_TOKEN) || localStorage.getItem(KEY_TOKEN) || localStorage.getItem(KEY_LEGACY) || '';
    } catch (e) {
      return '';
    }
  }

  function getUser() {
    try {
      var raw = sessionStorage.getItem(KEY_USER);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function saveSession(user, token) {
    try {
      if (user) {
        sessionStorage.setItem(KEY_USER, typeof user === 'string' ? user : JSON.stringify(user));
      }
      if (token) {
        sessionStorage.setItem(KEY_TOKEN, token);
        localStorage.setItem(KEY_TOKEN, token);
      }
    } catch (e) { /* ignore */ }
  }

  function clearSession() {
    try {
      sessionStorage.removeItem(KEY_USER);
      sessionStorage.removeItem(KEY_TOKEN);
      localStorage.removeItem(KEY_TOKEN);
      localStorage.removeItem(KEY_LEGACY);
    } catch (e) { /* ignore */ }
  }

  function loginUrl(redirect) {
    try {
      var path = redirect || (global.location.pathname + global.location.search);
      if (global.location.pathname === LOGIN_PATH) {
        return LOGIN_PATH;
      }
      return LOGIN_PATH + '?redirect=' + encodeURIComponent(path);
    } catch (e) {
      return LOGIN_PATH;
    }
  }

  /**
   * 本地一致性：有用户对象必须有 token，否则清掉（服务重启后最常见假登录形态）。
   */
  function sanitizeLocalSession() {
    var user = getUser();
    var token = getToken();
    if (user && user.id && !token) {
      clearSession();
      return false;
    }
    if (!user && token) {
      // 仅有 token 允许保留，由 /me 回填 user
      return true;
    }
    return !!(user && user.id && token);
  }

  function goLogin(forceRedirect) {
    clearSession();
    if (forceRedirect !== false) {
      global.location.href = loginUrl();
    }
  }

  /**
   * 安装 jQuery ajax 全局鉴权（幂等）。
   */
  function installAjaxAuth() {
    if (!global.jQuery) {
      return;
    }
    var $ = global.jQuery;
    if ($.authSessionInstalled) {
      return;
    }
    $.authSessionInstalled = true;

    $.ajaxSetup({
      xhrFields: { withCredentials: true },
      beforeSend: function (xhr) {
        var token = getToken();
        if (token) {
          xhr.setRequestHeader('Authorization', 'Bearer ' + token);
        }
      }
    });

    $(global.document).ajaxError(function (event, xhr) {
      if (xhr && xhr.status === 401) {
        // 登录接口本身的 401 不强制整页跳转（由表单处理）
        var url = '';
        try {
          url = (xhr.responseURL || '') + '';
        } catch (e) { /* ignore */ }
        if (url.indexOf('/api/user/login') >= 0 || url.indexOf('/api/user/register') >= 0) {
          return;
        }
        goLogin(true);
      }
    });
  }

  /**
   * 静默校验服务端会话；失败清本地。
   * @param {function(boolean, object|null)} done (ok, user)
   */
  function revalidate(done) {
    done = done || function () {};
    sanitizeLocalSession();
    var token = getToken();
    var localUser = getUser();
    if (!token && !localUser) {
      done(false, null);
      return;
    }
    if (!token) {
      clearSession();
      done(false, null);
      return;
    }

    function applyOk(user) {
      if (user) {
        saveSession(user, token);
      }
      done(true, user || localUser);
    }

    function applyFail() {
      clearSession();
      done(false, null);
    }

    if (global.jQuery) {
      global.jQuery.ajax({
        url: '/api/user/me',
        type: 'GET',
        cache: false,
        timeout: 8000
      }).done(function (res) {
        if (res && res.code === '0' && res.data) {
          applyOk(res.data);
        } else {
          applyFail();
        }
      }).fail(function (xhr) {
        if (xhr && (xhr.status === 401 || xhr.status === 403)) {
          applyFail();
        } else {
          // 网络错误：保留本地态，避免断网误踢
          done(!!localUser, localUser);
        }
      });
      return;
    }

    // fetch 回退
    try {
      global.fetch('/api/user/me', {
        method: 'GET',
        credentials: 'same-origin',
        headers: token ? { Authorization: 'Bearer ' + token } : {}
      }).then(function (r) {
        if (r.status === 401 || r.status === 403) {
          applyFail();
          return null;
        }
        return r.json();
      }).then(function (res) {
        if (!res) return;
        if (res.code === '0' && res.data) {
          applyOk(res.data);
        } else {
          applyFail();
        }
      }).catch(function () {
        done(!!localUser, localUser);
      });
    } catch (e) {
      done(!!localUser, localUser);
    }
  }

  /**
   * 页面入口：装 ajax + 本地消毒 + 静默 revalidate。
   * @param {{requireAuth?: boolean, onDone?: function}} opts
   */
  function bootstrap(opts) {
    opts = opts || {};
    installAjaxAuth();
    var okLocal = sanitizeLocalSession();
    if (opts.requireAuth && !okLocal && !getToken()) {
      goLogin(true);
      return;
    }
    revalidate(function (ok, user) {
      if (opts.requireAuth && !ok) {
        goLogin(true);
        return;
      }
      if (typeof opts.onDone === 'function') {
        opts.onDone(ok, user);
      }
      try {
        global.document.dispatchEvent(new CustomEvent('auth-session-ready', { detail: { ok: ok, user: user } }));
      } catch (e) { /* IE ignore */ }
    });
  }

  global.AuthSession = {
    getToken: getToken,
    getUser: getUser,
    saveSession: saveSession,
    clearSession: clearSession,
    loginUrl: loginUrl,
    goLogin: goLogin,
    sanitizeLocalSession: sanitizeLocalSession,
    installAjaxAuth: installAjaxAuth,
    revalidate: revalidate,
    bootstrap: bootstrap
  };
})(typeof window !== 'undefined' ? window : this);
