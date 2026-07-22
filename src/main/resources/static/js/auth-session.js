/**
 * 统一登录态（A0.5 最终：Session 唯一权威）
 * - 权威：HttpOnly JSESSIONID（withCredentials）
 * - CSRF：X-CSRF-Token
 * - 不再签发/存储/发送 JWT
 * - 401 清本地并跳登录
 */
(function (global) {
  'use strict';

  var LOGIN_PATH = '/page/front/login.html';
  var KEY_USER = 'user';
  var KEY_TOKEN = 'token';
  var KEY_CSRF = 'csrfToken';
  var KEY_LEGACY = 'x-auth-token';

  function getCsrfToken() {
    try {
      return sessionStorage.getItem(KEY_CSRF) || '';
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

  /** 兼容旧调用签名 saveSession(user, token, csrf)；token 忽略并清除 */
  function saveSession(user, tokenOrCsrf, csrfMaybe) {
    try {
      if (user) {
        sessionStorage.setItem(KEY_USER, typeof user === 'string' ? user : JSON.stringify(user));
      }
      // 清除任何历史 JWT
      sessionStorage.removeItem(KEY_TOKEN);
      localStorage.removeItem(KEY_TOKEN);
      localStorage.removeItem(KEY_LEGACY);
      var csrf = csrfMaybe;
      if (csrf == null && typeof tokenOrCsrf === 'string' && tokenOrCsrf.length < 80) {
        // 旧调用 saveSession(user, csrf) 或 (user, token, csrf)
        csrf = tokenOrCsrf;
      }
      if (arguments.length >= 3) {
        csrf = csrfMaybe;
      }
      if (csrf) {
        sessionStorage.setItem(KEY_CSRF, csrf);
      }
    } catch (e) { /* ignore */ }
  }

  function clearSession() {
    try {
      sessionStorage.removeItem(KEY_USER);
      sessionStorage.removeItem(KEY_TOKEN);
      sessionStorage.removeItem(KEY_CSRF);
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

  function sanitizeLocalSession() {
    try {
      localStorage.removeItem(KEY_TOKEN);
      localStorage.removeItem(KEY_LEGACY);
      sessionStorage.removeItem(KEY_TOKEN);
    } catch (e) { /* ignore */ }
    var user = getUser();
    return !!(user && user.id);
  }

  function goLogin(forceRedirect) {
    clearSession();
    if (forceRedirect !== false) {
      global.location.href = loginUrl();
    }
  }

  /**
   * @param {function(boolean)} done
   * @param {boolean} [forceRefresh]
   */
  function ensureCsrf(done, forceRefresh) {
    done = done || function () {};
    if (forceRefresh) {
      try { sessionStorage.removeItem(KEY_CSRF); } catch (e0) { /* ignore */ }
    }
    if (!forceRefresh && getCsrfToken()) {
      done(true);
      return;
    }
    if (!global.jQuery) {
      done(false);
      return;
    }
    global.jQuery.ajax({
      url: '/api/user/csrf',
      type: 'GET',
      cache: false,
      xhrFields: { withCredentials: true }
    }).done(function (res) {
      if (res && res.code === '0' && res.data && res.data.csrfToken) {
        try {
          sessionStorage.setItem(KEY_CSRF, res.data.csrfToken);
        } catch (e) { /* ignore */ }
        done(true);
      } else {
        done(false);
      }
    }).fail(function () {
      done(false);
    });
  }

  /**
   * 统一退出：POST + CSRF，等待完成再清理并跳转。
   */
  function logout(opts) {
    opts = opts || {};
    var redirect = opts.redirect !== false;
    function finish() {
      clearSession();
      if (redirect) {
        global.location.href = LOGIN_PATH;
      }
    }
    if (!global.jQuery) {
      try {
        global.fetch('/api/user/logout', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'X-CSRF-Token': getCsrfToken() || '', 'Content-Type': 'application/json' },
          body: '{}'
        }).finally(finish);
      } catch (e) {
        finish();
      }
      return;
    }
    var $ = global.jQuery;
    ensureCsrf(function () {
      $.ajax({
        url: '/api/user/logout',
        type: 'POST',
        contentType: 'application/json',
        data: '{}',
        xhrFields: { withCredentials: true },
        headers: { 'X-CSRF-Token': getCsrfToken() || '' }
      }).always(finish);
    }, false);
  }

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
      beforeSend: function (xhr, settings) {
        var method = (settings && settings.type ? settings.type : 'GET').toUpperCase();
        if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
          var csrf = getCsrfToken();
          if (csrf) {
            xhr.setRequestHeader('X-CSRF-Token', csrf);
          }
        }
      }
    });

    $(global.document).ajaxError(function (event, xhr) {
      if (!xhr) {
        return;
      }
      if (xhr.status === 401) {
        var url = '';
        try {
          url = (xhr.responseURL || '') + '';
        } catch (e) { /* ignore */ }
        if (url.indexOf('/api/user/login') >= 0 || url.indexOf('/api/user/register') >= 0) {
          return;
        }
        goLogin(true);
        return;
      }
      if (xhr.status === 403) {
        try {
          var body = xhr.responseJSON || (xhr.responseText ? JSON.parse(xhr.responseText) : null);
          var msg = body && body.msg ? String(body.msg) : '';
          if (msg.indexOf('CSRF') >= 0 || (body && body.code === '403' && msg.indexOf('token') >= 0)) {
            // 强制刷新 CSRF；故意不自动重放业务写请求（防非幂等重复提交）
            ensureCsrf(function (ok) {
              try {
                global.document.dispatchEvent(new CustomEvent('auth-csrf-refreshed', { detail: { ok: ok } }));
              } catch (e3) { /* ignore */ }
            }, true);
          }
        } catch (e2) { /* ignore */ }
      }
    });
  }

  function revalidate(done) {
    done = done || function () {};
    sanitizeLocalSession();
    var localUser = getUser();

    function applyOk(user) {
      if (user) {
        saveSession(user, null, getCsrfToken());
      }
      ensureCsrf(function () {
        done(true, user || localUser);
      });
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
        timeout: 8000,
        xhrFields: { withCredentials: true }
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
          done(!!localUser, localUser);
        }
      });
      return;
    }

    try {
      global.fetch('/api/user/me', {
        method: 'GET',
        credentials: 'same-origin'
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

  function bootstrap(opts) {
    opts = opts || {};
    installAjaxAuth();
    var okLocal = sanitizeLocalSession();
    if (opts.requireAuth && !okLocal && !getUser()) {
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
      } catch (e) { /* ignore */ }
    });
  }

  function getUploadHeaders() {
    var h = {};
    try {
      var c = getCsrfToken();
      if (c) {
        h['X-CSRF-Token'] = c;
      }
    } catch (e) { /* ignore */ }
    return h;
  }

  function appendUploadPurpose(formData, purpose) {
    if (!formData || typeof formData.append !== 'function') {
      return formData;
    }
    try {
      formData.append('purpose', purpose || 'private');
    } catch (e) { /* ignore */ }
    return formData;
  }

  // 兼容旧代码 getToken()：恒为空，避免误带 Authorization
  function getToken() {
    return '';
  }

  global.AuthSession = {
    getToken: getToken,
    getCsrfToken: getCsrfToken,
    getUser: getUser,
    saveSession: saveSession,
    clearSession: clearSession,
    loginUrl: loginUrl,
    goLogin: goLogin,
    logout: logout,
    sanitizeLocalSession: sanitizeLocalSession,
    installAjaxAuth: installAjaxAuth,
    ensureCsrf: ensureCsrf,
    revalidate: revalidate,
    bootstrap: bootstrap,
    getUploadHeaders: getUploadHeaders,
    appendUploadPurpose: appendUploadPurpose
  };
})(typeof window !== 'undefined' ? window : this);
