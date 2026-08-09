/**
 * 用户端共享页面壳：统一公共导航、账户入口、移动抽屉与页脚。
 * 只消费已由页面完成鉴权后提供的 user，不发起业务请求，也不改变权限规则。
 */
(function (global) {
  'use strict';

  if (!global.Vue || !global.UserWorkspace) {
    throw new Error('front-shell.js requires Vue and user-workspace.js');
  }

  var ICON_SPRITE = '/icons/ui-icons.svg?v=20260809u1a';

  function icon(id, className) {
    return '<svg class="' + (className || 'ui-icon') + '" aria-hidden="true" focusable="false">'
      + '<use href="' + ICON_SPRITE + '#' + id + '"></use></svg>';
  }

  function focusableElements(root) {
    if (!root) return [];
    return Array.prototype.filter.call(
      root.querySelectorAll('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'),
      function (node) {
        return node.offsetParent !== null && node.getAttribute('aria-hidden') !== 'true';
      }
    );
  }

  global.Vue.component('front-site-header', {
    props: {
      user: { type: Object, default: null }
    },
    data: function () {
      return {
        mobileOpen: false,
        accountOpen: false
      };
    },
    computed: {
      loggedIn: function () {
        return !!(this.user && this.user.id);
      },
      displayName: function () {
        if (!this.loggedIn) return '账户';
        return this.user.name || this.user.username || ('用户 ' + this.user.id);
      },
      initial: function () {
        var value = this.displayName.replace(/^\s+|\s+$/g, '');
        return value ? value.charAt(0).toUpperCase() : '友';
      },
      hasAdminAccess: function () {
        return global.UserWorkspace.hasAdminAccess(this.user);
      },
      publicItems: function () {
        return global.UserWorkspace.publicNavigation();
      },
      accountGroups: function () {
        return global.UserWorkspace.frontAccountGroups();
      },
      activeFlag: function () {
        return global.UserWorkspace.frontPageFlag(global.location.pathname);
      }
    },
    watch: {
      mobileOpen: function (open) {
        document.body.classList.toggle('ui-front-drawer-open', open);
        if (open) {
          this.$nextTick(function () {
            var closeButton = this.$refs.mobileClose;
            if (closeButton && typeof closeButton.focus === 'function') closeButton.focus();
          });
        }
      }
    },
    mounted: function () {
      document.addEventListener('keydown', this.onDocumentKeydown, true);
      document.addEventListener('click', this.onDocumentClick);
    },
    beforeDestroy: function () {
      document.removeEventListener('keydown', this.onDocumentKeydown, true);
      document.removeEventListener('click', this.onDocumentClick);
      document.body.classList.remove('ui-front-drawer-open');
    },
    methods: {
      isActive: function (id) {
        return this.activeFlag === id;
      },
      toggleAccount: function () {
        if (!this.loggedIn) return;
        this.mobileOpen = false;
        this.accountOpen = !this.accountOpen;
        if (this.accountOpen) {
          this.$nextTick(function () {
            var first = this.$refs.accountPanel && this.$refs.accountPanel.querySelector('a, button');
            if (first) first.focus();
          });
        }
      },
      closeAccount: function (restoreFocus) {
        if (!this.accountOpen) return;
        this.accountOpen = false;
        if (restoreFocus !== false) {
          this.$nextTick(function () {
            if (this.$refs.accountTrigger) this.$refs.accountTrigger.focus();
          });
        }
      },
      openMobile: function () {
        this.closeAccount(false);
        this.mobileOpen = true;
      },
      closeMobile: function (restoreFocus) {
        if (!this.mobileOpen) return;
        this.mobileOpen = false;
        if (restoreFocus !== false) {
          this.$nextTick(function () {
            if (this.$refs.mobileTrigger) this.$refs.mobileTrigger.focus();
          });
        }
      },
      onDocumentClick: function (event) {
        if (this.accountOpen && this.$refs.accountWrap && !this.$refs.accountWrap.contains(event.target)) {
          this.closeAccount(false);
        }
      },
      onDocumentKeydown: function (event) {
        if (event.key === 'Escape') {
          if (this.mobileOpen) {
            event.preventDefault();
            this.closeMobile(true);
            return;
          }
          if (this.accountOpen) {
            event.preventDefault();
            this.closeAccount(true);
          }
          return;
        }
        if (event.key !== 'Tab' || !this.mobileOpen) return;
        var nodes = focusableElements(this.$refs.mobileDrawer);
        if (!nodes.length) {
          event.preventDefault();
          return;
        }
        var first = nodes[0];
        var last = nodes[nodes.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      },
      logout: function () {
        this.accountOpen = false;
        this.mobileOpen = false;
        if (global.AuthSession && typeof global.AuthSession.logout === 'function') {
          global.AuthSession.logout();
        }
      }
    },
    template:
      '<div class="ui-front-shell-root">'
      + '<header class="ui-header ui-front-header">'
      + '  <div class="ui-header-inner">'
      + '    <a class="ui-brand" href="/page/front/index.html" aria-label="归途计划首页">'
      + '      <span class="ui-brand-mark" aria-hidden="true">♡</span>'
      + '      <span class="ui-brand-copy"><strong>归途计划</strong><small>PAWS ON THE WAY HOME</small></span>'
      + '    </a>'
      + '    <nav class="ui-nav ui-front-desktop-nav" aria-label="主导航">'
      + '      <a v-for="item in publicItems" :key="item.id" :href="item.href" :class="{\'is-active\': isActive(item.id)}" :aria-current="isActive(item.id) ? \'page\' : null">{{ item.label }}</a>'
      + '    </nav>'
      + '    <div class="ui-header-actions">'
      + '      <button ref="mobileTrigger" class="ui-icon-button ui-front-mobile-toggle" type="button" aria-label="打开导航菜单" aria-controls="frontMobileDrawer" :aria-expanded="mobileOpen ? \'true\' : \'false\'" @click="openMobile">'
      +          icon('icon-menu', 'ui-icon ui-icon-lg')
      + '      </button>'
      + '      <div v-if="loggedIn" ref="accountWrap" class="ui-account ui-front-account">'
      + '        <button ref="accountTrigger" class="ui-account-trigger" type="button" aria-haspopup="dialog" aria-controls="frontAccountPanel" :aria-expanded="accountOpen ? \'true\' : \'false\'" @click.stop="toggleAccount">'
      + '          <span class="ui-avatar" aria-hidden="true">{{ initial }}</span><span class="ui-account-name">{{ displayName }}</span>'
      +            icon('icon-chevron-down', 'ui-icon ui-icon-sm')
      + '        </button>'
      + '        <div v-if="accountOpen" id="frontAccountPanel" ref="accountPanel" class="ui-account-menu ui-front-account-menu" role="dialog" aria-label="账户导航" @click.stop>'
      + '          <section v-for="group in accountGroups" :key="group.id" class="ui-front-account-group">'
      + '            <strong>{{ group.label }}</strong>'
      + '            <a v-for="item in group.items" :key="item.id" :href="item.href" :class="{\'is-active\': isActive(item.id)}" @click="closeAccount(false)">{{ item.label }}</a>'
      + '          </section>'
      + '          <section v-if="hasAdminAccess" class="ui-front-account-group ui-front-account-admin"><strong>管理</strong><a href="/page/end/index.html">管理工作台</a></section>'
      + '          <div class="ui-front-account-separator"></div>'
      + '          <button type="button" class="is-danger" @click="logout">' + icon('icon-logout', 'ui-icon ui-icon-sm') + '<span>退出登录</span></button>'
      + '        </div>'
      + '      </div>'
      + '      <div v-else class="ui-front-auth-actions"><a class="ui-button is-text" href="/page/front/login.html">登录</a><a class="ui-button is-dark" href="/page/front/register.html">注册</a></div>'
      + '    </div>'
      + '  </div>'
      + '</header>'
      + '<div v-if="mobileOpen" class="ui-front-drawer-scrim" aria-hidden="true" @click="closeMobile(true)"></div>'
      + '<aside v-if="mobileOpen" id="frontMobileDrawer" ref="mobileDrawer" class="ui-front-drawer" role="dialog" aria-modal="true" aria-labelledby="frontMobileTitle" @click.stop>'
      + '  <div class="ui-front-drawer-head"><div><span>MENU</span><strong id="frontMobileTitle">浏览与账户</strong></div><button ref="mobileClose" class="ui-icon-button" type="button" aria-label="关闭导航菜单" @click="closeMobile(true)">' + icon('icon-close', 'ui-icon ui-icon-lg') + '</button></div>'
      + '  <div class="ui-front-drawer-body">'
      + '    <section class="ui-front-drawer-group"><strong>浏览平台</strong><nav aria-label="移动端主导航"><a v-for="item in publicItems" :key="item.id" :href="item.href" :class="{\'is-active\': isActive(item.id)}" :aria-current="isActive(item.id) ? \'page\' : null">{{ item.label }}<span aria-hidden="true">→</span></a></nav></section>'
      + '    <template v-if="loggedIn"><section v-for="group in accountGroups" :key="group.id" class="ui-front-drawer-group"><strong>{{ group.label }}</strong><nav :aria-label="group.label"><a v-for="item in group.items" :key="item.id" :href="item.href" :class="{\'is-active\': isActive(item.id)}">{{ item.label }}<span aria-hidden="true">→</span></a></nav></section><section v-if="hasAdminAccess" class="ui-front-drawer-group"><strong>管理</strong><nav aria-label="管理入口"><a href="/page/end/index.html">管理工作台<span aria-hidden="true">→</span></a></nav></section></template>'
      + '    <section v-else class="ui-front-drawer-auth" aria-label="登录与注册"><a class="ui-button is-ghost" href="/page/front/login.html">登录</a><a class="ui-button is-dark" href="/page/front/register.html">创建账户</a></section>'
      + '  </div>'
      + '  <button v-if="loggedIn" class="ui-front-drawer-logout" type="button" @click="logout">' + icon('icon-logout', 'ui-icon ui-icon-sm') + '<span>退出登录</span></button>'
      + '</aside>'
      + '</div>'
  });

  global.Vue.component('front-member-sidebar', {
    props: {
      active: { type: String, default: '' }
    },
    computed: {
      groups: function () {
        return global.UserWorkspace.frontAccountGroups();
      }
    },
    methods: {
      isActive: function (id) {
        return this.active === id;
      }
    },
    template:
      '<aside class="ui-member-sidebar" aria-label="我的行动导航">'
      + '<div class="ui-member-sidebar-title"><span>MEMBER DESK</span><strong>我的行动</strong></div>'
      + '<section v-for="group in groups" :key="group.id" class="ui-member-sidebar-group">'
      + '  <strong>{{ group.label }}</strong>'
      + '  <nav :aria-label="group.label">'
      + '    <a v-for="item in group.items" :key="item.id" :href="item.href" :class="{\'is-active\': isActive(item.id)}" :aria-current="isActive(item.id) ? \'page\' : null">{{ item.label }}</a>'
      + '  </nav>'
      + '</section>'
      + '</aside>'
  });

  global.Vue.component('front-site-footer', {
    computed: {
      publicItems: function () {
        return global.UserWorkspace.publicNavigation();
      }
    },
    template:
      '<footer class="ui-site-footer ui-front-footer">'
      + '<div class="ui-container ui-footer-inner">'
      + '  <div class="ui-footer-copy"><strong>归途计划</strong><span>© 2026 · 让每一次善意都有回音</span></div>'
      + '  <nav class="ui-footer-nav" aria-label="页脚导航"><a v-for="item in publicItems" :key="item.id" :href="item.href">{{ item.label }}</a><a href="/page/front/rescue_apply.html">发起救助</a></nav>'
      + '</div>'
      + '</footer>'
  });
})(typeof window !== 'undefined' ? window : this);
