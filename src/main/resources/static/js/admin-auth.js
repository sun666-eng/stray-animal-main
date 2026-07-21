// 管理员端 jQuery ajax 鉴权 + 统一登录态（依赖可选 auth-session.js）
// 必须在 jquery 之后、Vue 之前加载
(function () {
    if (typeof window.jQuery === 'undefined') {
        return;
    }
    var $ = window.jQuery;

    if (window.AuthSession) {
        window.AuthSession.installAjaxAuth();
        window.AuthSession.sanitizeLocalSession();
        // 管理端页面必须有效会话
        var path = window.location.pathname || '';
        var isLogin = path.indexOf('login.html') >= 0;
        if (!isLogin) {
            window.AuthSession.revalidate(function (ok) {
                if (!ok && !window.AuthSession.getToken()) {
                    // 无 token 且 /me 失败 → 跳登录
                    if (!window.AuthSession.getUser()) {
                        window.location.href = window.AuthSession.loginUrl();
                    }
                }
            });
        }
    } else {
        $.ajaxSetup({
            xhrFields: { withCredentials: true },
            beforeSend: function (xhr) {
                var token = sessionStorage.getItem('token') || localStorage.getItem('token');
                if (token) {
                    xhr.setRequestHeader('Authorization', 'Bearer ' + token);
                }
            }
        });
        $(document).ajaxError(function (event, xhr) {
            if (xhr && xhr.status === 401) {
                sessionStorage.removeItem('user');
                sessionStorage.removeItem('token');
                localStorage.removeItem('token');
                var current = window.location.pathname + window.location.search;
                window.location.href = '/page/front/login.html?redirect=' + encodeURIComponent(current);
            }
        });
        try {
            if (sessionStorage.getItem('user') && !sessionStorage.getItem('token')) {
                sessionStorage.removeItem('user');
            }
        } catch (e) { /* ignore */ }
    }

    var ADMIN_FLAGS = {
        user: true,
        role: true,
        permission: true,
        animal: true,
        adopt: true,
        proof: true,
        visit: true,
        volunteer: true,
        account: true,
        notice: true,
        help: true
    };

    var LEGACY_FRONT_PATHS = {
        adopt_view: '/page/front/animal_browse.html',
        my_adopt: '/page/front/my_adopt.html',
        my_proof: '/page/front/adopt_proof.html',
        apply: '/page/front/volunteer_apply.html',
        im: '/page/front/rescue_apply.html',
        rescue: '/page/front/rescue_apply.html'
    };

    function dedupePermissionsInSession() {
        try {
            var raw = sessionStorage.getItem('user');
            if (!raw) return;
            var user = JSON.parse(raw);
            if (!user || !user.permission || !user.permission.length) return;
            var seen = {};
            var deduped = [];
            for (var i = 0; i < user.permission.length; i++) {
                var p = user.permission[i];
                if (!p) continue;
                if (LEGACY_FRONT_PATHS[p.flag]) {
                    p.path = LEGACY_FRONT_PATHS[p.flag];
                }
                var key = (p.name || '') + '|' + (p.path || '');
                if (seen[key]) continue;
                seen[key] = true;
                if (ADMIN_FLAGS[p.flag]) {
                    deduped.push(p);
                }
            }
            if (deduped.length !== user.permission.length) {
                user.permission = deduped;
                sessionStorage.setItem('user', JSON.stringify(user));
            }
        } catch (e) {
            // ignore
        }
    }
    dedupePermissionsInSession();
})();
