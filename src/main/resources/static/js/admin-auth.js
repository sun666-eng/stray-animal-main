// 管理员端 jQuery ajax 鉴权全局拦截
// 1) 每个请求自动带上 sessionStorage 里存的 JWT token
// 2) 全局监听 401，触发统一跳登录
// 必须在页面 Vue 初始化之前加载（即放在 jquery.min.js 后面、Vue/element/页面脚本之前）
(function () {
    if (typeof window.jQuery === 'undefined') {
        return;
    }
    var $ = window.jQuery;

    $.ajaxSetup({
        beforeSend: function (xhr) {
            var token = sessionStorage.getItem('token');
            if (token) {
                xhr.setRequestHeader('Authorization', 'Bearer ' + token);
            }
        }
    });

    function buildLoginUrl() {
        try {
            var current = window.location.pathname + window.location.search;
            if (window.location.pathname === '/page/end/login.html') {
                return '/page/end/login.html';
            }
            return '/page/end/login.html?redirect=' + encodeURIComponent(current);
        } catch (e) {
            return '/page/end/login.html';
        }
    }

    $(document).ajaxError(function (event, xhr) {
        if (xhr && xhr.status === 401) {
            sessionStorage.removeItem('user');
            sessionStorage.removeItem('token');
            window.location.href = buildLoginUrl();
        }
    });

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

    // 3) 兜底：清理 sessionStorage.user.permission 里的重复项并修正旧路径。
    //    后台侧边栏只保留真实管理功能，用户自助功能从首页快捷入口进入。
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
                // 同名 + 同 path 视为重复（兼容 flag 不同但实际指向同一页面的脏数据）
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
            // 静默忽略：解析失败不应影响页面正常加载
        }
    }
    dedupePermissionsInSession();
})();
