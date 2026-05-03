(function() {
    var KEY = 'dark-mode';

    function isDark() {
        return localStorage.getItem(KEY) === 'true';
    }

    function apply(mode) {
        if (mode) {
            document.body.classList.add('dark-mode');
        } else {
            document.body.classList.remove('dark-mode');
        }
    }

    function toggle() {
        var next = !isDark();
        localStorage.setItem(KEY, next);
        apply(next);
        updateIcon();
    }

    function updateIcon() {
        var btn = document.getElementById('dark-mode-btn');
        if (btn) {
            btn.textContent = isDark() ? '\u2600\uFE0F' : '\uD83C\uDF19';
        }
    }

    function init() {
        apply(isDark());
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', function() { createBtn(); updateIcon(); });
        } else {
            createBtn(); updateIcon();
        }
    }

    function createBtn() {
        if (document.getElementById('dark-mode-btn')) return;
        var btn = document.createElement('button');
        btn.id = 'dark-mode-btn';
        btn.className = 'dark-mode-toggle';
        btn.title = '\u5207\u6362\u6DF1\u8272\u6A21\u5F0F';
        btn.onclick = toggle;
        document.body.appendChild(btn);
    }

    init();
})();
