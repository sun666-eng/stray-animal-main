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
      timeout: 8000,
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
   * 统一退出：仅当服务端 Session 销毁成功（HTTP 2xx 且 code===0）才清本地并跳转。
   * 失败时保留本地态，避免共享设备上的假退出。
   */
  function logout(opts) {
    opts = opts || {};
    var redirect = opts.redirect !== false;
    var onError = typeof opts.onError === 'function' ? opts.onError : null;

    function succeed() {
      clearSession();
      if (redirect) {
        global.location.href = LOGIN_PATH;
      }
    }

    function fail(message) {
      var msg = message || '退出未完成，请检查网络后重试';
      if (onError) {
        try { onError(msg); } catch (e0) { /* ignore */ }
      } else if (global.console && typeof global.console.warn === 'function') {
        global.console.warn('[AuthSession.logout]', msg);
      }
      try {
        if (global.alert) {
          global.alert(msg);
        }
      } catch (e1) { /* ignore */ }
    }

    function isLogoutOk(status, body) {
      if (status < 200 || status >= 300) {
        return false;
      }
      if (body == null || body === '') {
        return true;
      }
      try {
        var parsed = typeof body === 'string' ? JSON.parse(body) : body;
        if (parsed && parsed.code != null) {
          return String(parsed.code) === '0';
        }
      } catch (e2) { /* non-JSON 2xx still counts as success */ }
      return true;
    }

    function postLogout(retried) {
      if (!global.jQuery) {
        try {
          global.fetch('/api/user/logout', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'X-CSRF-Token': getCsrfToken() || '', 'Content-Type': 'application/json' },
            body: '{}'
          }).then(function (r) {
            return r.text().then(function (text) {
              if (isLogoutOk(r.status, text)) {
                succeed();
              } else if (!retried && r.status === 403) {
                ensureCsrf(function () { postLogout(true); }, true);
              } else {
                fail('退出未完成（HTTP ' + r.status + '），服务端会话可能仍有效');
              }
            });
          }).catch(function () {
            fail('退出请求失败，请稍后重试');
          });
        } catch (e) {
          fail('退出请求无法发出');
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
        }).done(function (res, _textStatus, xhr) {
          var status = xhr && xhr.status ? xhr.status : 200;
          if (isLogoutOk(status, res)) {
            succeed();
          } else {
            fail((res && res.msg) || '退出未完成');
          }
        }).fail(function (xhr) {
          var status = xhr && xhr.status ? xhr.status : 0;
          if (!retried && status === 403) {
            ensureCsrf(function () { postLogout(true); }, true);
            return;
          }
          fail(status ? ('退出未完成（HTTP ' + status + '）') : '退出请求失败，请稍后重试');
        });
      }, !!retried);
    }

    postLogout(false);
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

    $(global.document).ajaxError(function (event, xhr, settings) {
      if (!xhr) {
        return;
      }
      if (xhr.status === 401) {
        var url = settings && settings.url ? String(settings.url) : '';
        try {
          if (!url) {
            url = (xhr.responseURL || '') + '';
          }
        } catch (e) { /* ignore */ }
        if (url.indexOf('/api/user/login') >= 0
            || url.indexOf('/api/user/register') >= 0
            || url.indexOf('/api/user/me') >= 0) {
          // /me 由 bootstrap(requireAuth) 决定匿名停留或跳转，避免公共页面被全局处理器误伤。
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

  var revalidateFlight = null;

  function revalidate(done, allowCachedOnNetworkError) {
    done = done || function () {};
    if (revalidateFlight) {
      revalidateFlight.callbacks.push(done);
      if (allowCachedOnNetworkError === false) revalidateFlight.allowCachedOnNetworkError = false;
      return;
    }
    revalidateFlight = { callbacks: [done], allowCachedOnNetworkError: allowCachedOnNetworkError };
    sanitizeLocalSession();

    function complete(ok, user) {
      var flight = revalidateFlight;
      revalidateFlight = null;
      (flight ? flight.callbacks : [done]).forEach(function (callback) {
        try { callback(ok, user); } catch (e) { /* one subscriber must not block others */ }
      });
    }

    function applyOk(user) {
      if (user) {
        saveSession(user, null, getCsrfToken());
      }
      ensureCsrf(function () {
        complete(true, user);
      });
    }

    function applyFail() {
      clearSession();
      complete(false, null);
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
          applyFail();
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
        applyFail();
      });
    } catch (e) {
      applyFail();
    }
  }

  function bootstrap(opts) {
    opts = opts || {};
    installAjaxAuth();
    sanitizeLocalSession();
    // HttpOnly Session cookie is authoritative. Always probe /me before deciding
    // that a protected page is unauthenticated, including newly opened tabs.
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
    }, false);
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
