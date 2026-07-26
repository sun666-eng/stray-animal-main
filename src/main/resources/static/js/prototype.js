(function () {
    'use strict';

    var animalImages = [
        '/prototype-assets/editorial-01.svg', '/prototype-assets/editorial-02.svg',
        '/prototype-assets/editorial-03.svg', '/prototype-assets/editorial-04.svg',
        '/prototype-assets/editorial-01.svg', '/prototype-assets/editorial-02.svg',
        '/prototype-assets/editorial-03.svg', '/prototype-assets/editorial-04.svg'
    ];

    var pages = [
        { group: '公众体验', type: 'public', id: 'home', icon: '⌂', title: '品牌首页', render: renderHome, notes: ['真实动物内容前置，建立作品集第一印象', '双主行动：浏览领养与发起救助', '用透明数据和救助流程建立公益可信度'] },
        { group: '公众体验', type: 'public', id: 'animals', icon: '⌕', title: '动物浏览', render: renderAnimals, notes: ['状态、筛选与行动在卡片层直接闭环', '移动端一列卡片，避免桌面布局缩放', '图片固定比例并预留加载区域，降低 CLS'] },
        { group: '公众体验', type: 'public', id: 'animal-detail', icon: '✦', title: '动物详情', render: renderAnimalDetail, notes: ['照片与申请信息双栏构图', '事实信息结构化，长描述保持阅读节奏', '明确领养前须知，减少无效申请'] },
        { group: '公众体验', type: 'public', id: 'notices', icon: '◫', title: '公告中心', render: renderNotices, notes: ['编辑式日期卡片强化时间层级', '类别筛选与搜索并行', '重要公告在视觉上有单独优先级'] },
        { group: '公众体验', type: 'public', id: 'notice-detail', icon: '¶', title: '公告详情', render: renderNoticeDetail, notes: ['正文采用窄栏编辑排版', '保留来源、发布时间和关联行动', '相关公告引导继续浏览'] },
        { group: '公众体验', type: 'public', id: 'funds', icon: '¥', title: '资金公示', render: renderFunds, notes: ['先总览收入、支出、结余，再查看明细', '公开 DTO 不暴露经手人和内部 ID', '用颜色和正负号双重表达收支'] },
        { group: '身份入口', type: 'member', id: 'login', icon: '→', title: '登录', render: function () { return renderAuth(false); }, notes: ['左侧品牌故事，右侧专注完成身份进入', '输入框具备可见标签，不依赖 placeholder', '统一用户与管理员入口，但说明登录后去向'] },
        { group: '身份入口', type: 'member', id: 'register', icon: '+', title: '注册', render: function () { return renderAuth(true); }, notes: ['字段分组减少认知压力', '服务条款与隐私说明可访问', '注册后进入用户工作台而非管理后台'] },
        { group: '用户工作台', type: 'member', id: 'dashboard', icon: '⌘', title: '用户首页', render: renderDashboard, notes: ['围绕“下一步该做什么”设计，不复制管理后台', '状态提醒、任务卡与最近记录形成闭环', '用户端和管理端信息架构真正分离'] },
        { group: '用户工作台', type: 'member', id: 'adopt-apply', icon: '♡', title: '领养申请', render: function () { return renderFormPage('adopt'); }, notes: ['分步表单和侧边说明降低填写负担', '字段级帮助与错误区域预留', '提交后明确审核流程和预计时间'] },
        { group: '用户工作台', type: 'member', id: 'my-adoptions', icon: '◎', title: '我的领养', render: function () { return renderRecordPage('adopt'); }, notes: ['时间线替代纯数据表，状态更易理解', '关键下一步直接显示在记录卡上', '终态记录保持可追溯但降低视觉权重'] },
        { group: '用户工作台', type: 'member', id: 'proof-upload', icon: '⇧', title: '凭证提交', render: function () { return renderFormPage('proof'); }, notes: ['敏感文件上传明确用途和隐私提示', '上传区保留文件状态与删除入口', '只允许为本人已通过领养提交'] },
        { group: '用户工作台', type: 'member', id: 'volunteer-apply', icon: '♧', title: '志愿者申请', render: function () { return renderFormPage('volunteer'); }, notes: ['按基础信息、能力、服务意愿分组', '清晰说明审核和培训流程', '移动端保持单列与舒适触控尺寸'] },
        { group: '用户工作台', type: 'member', id: 'my-volunteer', icon: '✓', title: '我的志愿服务', render: function () { return renderRecordPage('volunteer'); }, notes: ['申请状态与服务任务同页呈现', '突出近期任务和签到行动', '志愿者角色使用自然绿而非通用蓝'] },
        { group: '用户工作台', type: 'member', id: 'rescue-apply', icon: '!', title: '发起救助', render: function () { return renderFormPage('rescue'); }, notes: ['紧急救助表单在移动端优先于聊天', '位置、联系方式、现场情况形成最小信息集', '在线咨询降级为辅助入口'] },
        { group: '用户工作台', type: 'member', id: 'my-rescues', icon: '◉', title: '我的救助', render: function () { return renderRecordPage('rescue'); }, notes: ['用处理时间线解释当前进度', '允许补充资料而不重复提交', '紧急联系方式在处理中保持可见'] },
        { group: '用户工作台', type: 'member', id: 'my-visits', icon: '⌁', title: '回访记录', render: function () { return renderRecordPage('visit'); }, notes: ['健康评分、回访照片和文字结论一体化', '按领养动物分组，降低跨记录查找成本', '空状态提示何时会出现回访'] },
        { group: '用户工作台', type: 'member', id: 'profile', icon: '●', title: '个人中心', render: renderProfile, notes: ['资料、安全和通知偏好分区', '头像变更与账户资料分离保存', '危险操作集中在独立区域'] },
        { group: '沟通协作', type: 'member', id: 'chat', icon: '…', title: '救助咨询', render: renderChat, notes: ['消息区采用稳定高度并提供 aria-live 语义', '正式救助行动始终比聊天更突出', '在线人数只显示数量，不枚举登录用户名'] },
        { group: '管理后台', type: 'admin', id: 'admin-dashboard', icon: '▦', title: '运营总览', render: renderAdminDashboard, notes: ['待办优先于统计装饰', '数据卡直接关联业务入口', '图表提供文字摘要，权限不足时有明确空态'] },
        { group: '管理后台', type: 'admin', id: 'admin-animals', icon: '♢', title: '动物管理', render: function () { return renderAdminList('animals'); }, notes: ['高频字段留在表格，详情进入抽屉', '状态变更改为行级保存并可回滚', '导入、导出、添加动作按主次排序'] },
        { group: '管理后台', type: 'admin', id: 'admin-adoptions', icon: '♡', title: '领养审核', render: function () { return renderAdminList('adoptions'); }, notes: ['待审核作为默认筛选', '申请人、动物和风险信息组合展示', '通过与驳回使用明确确认文案'] },
        { group: '管理后台', type: 'admin', id: 'admin-proofs', icon: '▣', title: '凭证审核', render: function () { return renderAdminList('proofs'); }, notes: ['隐私文件只在授权详情中预览', '凭证状态与关联领养关系同时可见', '审核操作保持审计上下文'] },
        { group: '管理后台', type: 'admin', id: 'admin-visits', icon: '⌁', title: '回访管理', render: function () { return renderAdminList('visits'); }, notes: ['健康评分和异常标签前置', '支持按领养人、动物和日期组合筛选', '新增回访使用侧边抽屉减少上下文切换'] },
        { group: '管理后台', type: 'admin', id: 'admin-volunteers', icon: '♧', title: '志愿者审核', render: function () { return renderAdminList('volunteers'); }, notes: ['能力与服务时间在列表中摘要展示', '审核通过后明确角色变化', '敏感资料默认折叠'] },
        { group: '管理后台', type: 'admin', id: 'admin-rescues', icon: '!', title: '救助管理', render: function () { return renderAdminList('rescues'); }, notes: ['按紧急程度而非提交顺序排序', '位置与联系方式为处理核心信息', '处理状态有负责人和更新时间'] },
        { group: '管理后台', type: 'admin', id: 'admin-notices', icon: '◫', title: '公告管理', render: function () { return renderAdminList('notices'); }, notes: ['草稿、已发布、已下线状态清晰', '编辑器按需加载，不进入其他后台页', '发布前提供前台预览'] },
        { group: '管理后台', type: 'admin', id: 'admin-funds', icon: '¥', title: '资金管理', render: function () { return renderAdminList('funds'); }, notes: ['管理明细保留 ID 与经手人，和公开 DTO 分离', '金额编辑使用明确正负语义', '统计按收入与支出分别聚合'] },
        { group: '管理后台', type: 'admin', id: 'admin-adopt-board', icon: '◷', title: '领养待办看板', render: renderAdoptBoard, notes: ['把待审核、待沟通和待回访按流程分栏', '每张卡只显示推进决策所需信息', '适用于原 adopt_wait 等状态型页面'] },
        { group: '管理后台', type: 'admin', id: 'admin-rescue-chat', icon: '…', title: '救助会话工作台', render: renderAdminChat, notes: ['会话列表、当前对话和救助上下文三栏联动', '优先显示紧急程度与关联救助单', '替代旧 im/help 页面中混杂的聊天和业务记录'] },
        { group: '系统治理', type: 'admin', id: 'admin-users', icon: '●', title: '用户管理', render: function () { return renderAdminList('users'); }, notes: ['角色变更不再选择后立即保存', '危险角色调整需要二次确认', '搜索和筛选支持账号、状态、角色'] },
        { group: '系统治理', type: 'admin', id: 'admin-roles', icon: '◇', title: '角色管理', render: function () { return renderAdminList('roles'); }, notes: ['角色与权限范围同屏展示', '超级管理员保护规则可见', '权限变化前提供影响用户数量'] },
        { group: '系统治理', type: 'admin', id: 'admin-permissions', icon: '⌾', title: '权限管理', render: function () { return renderAdminList('permissions'); }, notes: ['按业务域分组，而不是扁平长表', 'Flag、路径和菜单语义保持一致', '新增权限提供契约检查提示'] },
        { group: '系统治理', type: 'admin', id: 'admin-profile', icon: '○', title: '管理员个人资料', render: renderAdminProfile, notes: ['个人资料、账号安全和通知偏好分区', '不与用户管理页面混用', '敏感操作集中到安全区域'] },
        { group: '系统治理', type: 'admin', id: 'admin-editor', icon: '¶', title: '内容编辑器', render: renderEditor, notes: ['富文本编辑器只在本页按需加载', '提供预览、草稿和发布状态', '外部资源和失效音频不进入正式菜单'] },
        { group: '系统治理', type: 'admin', id: 'design-components', icon: '▤', title: '组件与状态规范', render: renderComponentLibrary, notes: ['把按钮、表单、标签、空状态集中成可复用规范', '原 plugins 页面不再承担无关外部资源展示', '正式迁移时作为设计系统验收页'] },
        { group: '系统治理', type: 'admin', id: 'system-states', icon: '⚙', title: '系统状态与异常', render: renderSystemStates, notes: ['集中展示加载、空数据、权限不足、网络异常和维护状态', '所有页面复用一致反馈结构', '状态文案提供下一步行动而不是只报错'] }
    ];

    var state = {
        current: getQuery('view') || 'home',
        viewport: getQuery('viewport') || 'desktop',
        standalone: getQuery('standalone') === '1'
    };

    var app = document.getElementById('prototypeApp');
    var nav = document.getElementById('prototypeNav');
    var stage = document.getElementById('previewStage');
    var toast = document.getElementById('prototypeToast');
    var toastTimer;

    function getQuery(name) {
        try { return new URLSearchParams(location.search).get(name); } catch (e) { return null; }
    }

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
    }

    function renderNav(filter) {
        var groups = [];
        pages.forEach(function (page) {
            if (filter && (page.title + page.group).toLowerCase().indexOf(filter.toLowerCase()) < 0) return;
            var group = groups.find(function (g) { return g.name === page.group; });
            if (!group) { group = { name: page.group, pages: [] }; groups.push(group); }
            group.pages.push(page);
        });
        nav.innerHTML = groups.map(function (group) {
            return '<div class="studio-nav-group"><div class="studio-nav-group-title"><span>' + group.name + '</span><span>' + group.pages.length + '</span></div>' +
                group.pages.map(function (page) {
                    return '<button class="studio-nav-item ' + (page.id === state.current ? 'is-active' : '') + '" data-view="' + page.id + '">' +
                        '<span class="studio-nav-icon">' + page.icon + '</span><span>' + page.title + '</span></button>';
                }).join('') + '</div>';
        }).join('');
    }

    function navigate(id, push) {
        var page = pages.find(function (item) { return item.id === id; }) || pages[0];
        state.current = page.id;
        app.innerHTML = page.render();
        document.getElementById('currentSection').textContent = page.group;
        document.getElementById('currentTitle').textContent = page.title;
        document.getElementById('notesTitle').textContent = page.title;
        document.getElementById('notesContent').innerHTML = renderNotes(page);
        renderNav(document.getElementById('prototypeSearch').value || '');
        app.focus();
        if (push !== false && history.replaceState) {
            var query = '?view=' + encodeURIComponent(page.id) + '&viewport=' + encodeURIComponent(state.viewport) + (state.standalone ? '&standalone=1' : '');
            history.replaceState(null, '', location.pathname + query);
        }
        document.getElementById('prototypeStudio').classList.remove('sidebar-open');
    }

    function renderNotes(page) {
        return '<section class="notes-block"><h3>设计目标</h3><ul>' + page.notes.map(function (note) { return '<li>' + note + '</li>'; }).join('') + '</ul></section>' +
            '<section class="notes-block"><h3>视觉语言</h3><p>暖米白背景、松针绿品牌色与陶土橙行动色共同建立自然、可信、有人情味的公益服务气质。标题采用宋体风格强化编辑感，正文保持高可读性。</p></section>' +
            '<section class="notes-block"><h3>组件 token</h3><div class="token-row"><span class="token-chip">4px 网格</span><span class="token-chip">14px 卡片圆角</span><span class="token-chip">44px 触控区</span><span class="token-chip">AA 对比度</span><span class="token-chip">Focus Visible</span></div></section>' +
            '<section class="notes-block"><h3>原型说明</h3><p>这是不连接真实接口的视觉原型。点击页面中的按钮、筛选器和导航可查看交互反馈；正式实施时再将组件映射到现有 Spring Boot API。</p></section>';
    }

    function setViewport(viewport) {
        state.viewport = viewport;
        stage.className = 'preview-stage is-' + viewport;
        document.querySelectorAll('[data-viewport]').forEach(function (button) {
            button.classList.toggle('is-active', button.getAttribute('data-viewport') === viewport);
        });
        document.getElementById('previewRuler').textContent = viewport === 'desktop' ? '1440 × 自适应' : viewport === 'tablet' ? '768 × 自适应' : '390 × 自适应';
        navigate(state.current, true);
    }

    function showToast(message) {
        clearTimeout(toastTimer);
        toast.textContent = message;
        toast.classList.add('is-show');
        toastTimer = setTimeout(function () { toast.classList.remove('is-show'); }, 2200);
    }

    function publicHeader(active, member) {
        return '<header class="p-header"><a class="p-logo" href="#" data-view="home"><span class="p-logo-mark">♡</span><span><strong>归途计划</strong><span>PAWS ON THE WAY HOME</span></span></a>' +
            '<nav class="p-nav" aria-label="主导航">' +
            navLink('home', '首页', active) + navLink('animals', '等待一个家', active) + navLink('notices', '救助动态', active) + navLink('funds', '透明公示', active) +
            '</nav><div class="p-header-actions"><button class="p-icon-button" data-action="search" aria-label="搜索">⌕</button>' +
            (member === false ? '<a class="p-button brand" href="#" data-view="login">登录 / 注册</a>' : '<button class="p-user-chip" data-view="dashboard"><span class="p-user-avatar">林</span><span>林晓 · 我的工作台</span></button>') +
            '<button class="p-mobile-menu" data-action="mobile-menu" aria-label="打开导航">☰</button></div></header>';
    }

    function navLink(id, label, active) {
        return '<a href="#" data-view="' + id + '" class="' + (active === id ? 'is-active' : '') + '">' + label + '</a>';
    }

    function footer() {
        return '<footer class="p-footer"><div class="p-container p-footer-inner"><span>© 2026 归途计划 · 让每一次善意都有回音</span><span>救助热线 400-021-0520　隐私政策　志愿者守则</span></div></footer>';
    }

    function renderHome() {
        return '<div class="p-app">' + publicHeader('home', false) + '<main>' +
            '<section class="p-container p-hero"><div class="p-hero-copy"><p class="p-eyebrow">ADOPT · RESCUE · CARE</p><h1 class="p-display">让每个生命，<br>都被认真对待。</h1><p>发现需要帮助的动物，了解正在等待领养的它们，并持续看到每一次救助的进展。</p><div class="p-actions"><button class="p-button primary" data-view="animals">浏览待领养动物</button><button class="p-button secondary" data-view="rescue-apply">发起救助</button></div><div class="p-trust-row"><span><b>328</b>成功领养</span><span><b>76</b>认证志愿者</span><span><b>94%</b>请求响应率</span></div></div>' +
            '<div class="p-hero-visual"><div class="p-hero-photo"><img src="' + animalImages[1] + '" alt="动物摄影占位图"><div class="p-float-card"><strong>小满 · 02</strong><span>已完成体检与绝育<br>上海 · 等待领养</span></div></div></div></section>' +
            '<section class="p-section" style="background:#fffdf8"><div class="p-container"><div class="p-section-head"><div><p class="p-eyebrow">WAITING FOR YOU</p><h2 class="p-title">也许，你们正在等待彼此</h2></div><button class="p-link" data-view="animals">查看全部待领养动物　→</button></div><div class="p-grid cards-3">' + animalCards(3) + '</div></div></section>' +
            '<section class="p-section"><div class="p-container"><div class="p-section-head"><div><p class="p-eyebrow">HOW IT WORKS</p><h2 class="p-title">一份善意，四步抵达</h2></div></div><div class="p-grid cards-4">' + processCards() + '</div></div></section>' +
            '</main>' + footer() + '</div>';
    }

    function animalCards(count) {
        var names = ['小满', '阿布', '年糕', '星星', '栗子', '汤圆', '麦麦', '小七'];
        var types = ['中华田园猫', '边境牧羊犬', '橘白猫', '中华田园犬', '狸花猫', '比熊', '奶牛猫', '柯基'];
        return names.slice(0, count).map(function (name, index) {
            var status = index === 3 ? 'pending' : index === 5 ? 'done' : 'waiting';
            var label = status === 'waiting' ? '等待领养' : status === 'pending' ? '申请沟通中' : '已找到新家';
            return '<article class="p-animal-card"><div class="p-animal-photo"><img src="' + animalImages[index % animalImages.length] + '" alt="' + name + '的照片"><span class="p-status ' + status + '">' + label + '</span></div><div class="p-card-body"><div class="p-card-head"><h3>' + name + '</h3><span>上海</span></div><div class="p-meta-row"><span class="p-meta-chip">' + types[index] + '</span><span class="p-meta-chip">' + (index % 2 ? '男孩' : '女孩') + '</span><span class="p-meta-chip">' + (index + 1) + ' 岁</span></div><p>' + (index % 2 ? '性格温和，喜欢散步，对人友善，正在学习适应家庭生活。' : '已经完成基础体检，亲人安静，希望找到稳定而耐心的家庭。') + '</p><div class="p-card-actions"><button class="p-button ghost" data-view="animal-detail">了解 ' + name + '</button><button class="p-button primary ' + (status !== 'waiting' ? 'is-disabled' : '') + '" ' + (status !== 'waiting' ? 'disabled' : 'data-view="adopt-apply"') + '>申请领养</button></div></div></article>';
        }).join('');
    }

    function processCards() {
        var data = [['01', '发现与上报', '通过救助表单提供位置、照片和现场情况。'], ['02', '响应与安置', '志愿者接单，完成接驳、体检和临时安置。'], ['03', '领养与审核', '充分了解、双向沟通，并完成规范审核。'], ['04', '回访与陪伴', '持续回访，让新的家庭关系更稳定。']];
        return data.map(function (item) { return '<div class="p-panel"><p class="p-eyebrow">STEP ' + item[0] + '</p><h3>' + item[1] + '</h3><p class="p-panel-sub">' + item[2] + '</p></div>'; }).join('');
    }

    function renderAnimals() {
        return '<div class="p-app">' + publicHeader('animals', true) + '<main><section class="p-page-hero"><div class="p-container p-page-hero-inner"><div><div class="p-breadcrumb"><span>首页</span><span>/</span><b>等待一个家</b></div><h1 class="p-title">和未来的家人，先见一面</h1><p class="p-subtitle">目前有 18 只动物正在等待领养。请在申请前认真了解它们的状态和长期照护需要。</p></div><span class="p-status waiting">18 只可申请</span></div></section>' +
            '<section class="p-container p-section-compact"><div class="p-toolbar"><label class="p-search">⌕<input type="search" placeholder="搜索名字、品种或性格"></label><select class="p-select"><option>全部动物</option><option>猫咪</option><option>狗狗</option></select><select class="p-select"><option>全部年龄</option><option>幼年</option><option>成年</option></select><button class="p-button brand" data-action="filter">筛选</button></div><div class="p-filter-chips"><button class="p-filter-chip is-active">全部 24</button><button class="p-filter-chip">等待领养 18</button><button class="p-filter-chip">申请沟通中 4</button><button class="p-filter-chip">已找到新家 2</button></div><div class="p-grid cards-3">' + animalCards(8) + '</div></section></main>' + footer() + '</div>';
    }

    function renderAnimalDetail() {
        return '<div class="p-app">' + publicHeader('animals', true) + '<main><section class="p-container p-section"><div class="p-breadcrumb"><span>等待一个家</span><span>/</span><b>小满</b></div><div class="p-detail"><div class="p-detail-media"><div class="p-detail-image"><img src="' + animalImages[1] + '" alt="小满的照片"></div><div class="p-detail-thumbs"><div class="p-detail-thumb is-active"><img src="' + animalImages[1] + '" alt=""></div><div class="p-detail-thumb"><img src="' + animalImages[4] + '" alt=""></div><div class="p-detail-thumb"><img src="' + animalImages[3] + '" alt=""></div><div class="p-detail-thumb"><img src="' + animalImages[6] + '" alt=""></div></div></div>' +
            '<div class="p-detail-copy"><span class="p-status waiting">等待领养</span><h1>小满</h1><p class="p-detail-lead">小满是在一个雨夜被志愿者发现的。经过三个月的安置和社交训练，她已经愿意主动靠近熟悉的人，也会安静地趴在窗边晒太阳。</p><div class="p-facts"><div class="p-fact"><span>品种</span><strong>中华田园猫</strong></div><div class="p-fact"><span>年龄</span><strong>约 2 岁</strong></div><div class="p-fact"><span>性别</span><strong>女孩 · 已绝育</strong></div><div class="p-fact"><span>健康</span><strong>已体检 · 已免疫</strong></div><div class="p-fact"><span>性格</span><strong>安静 · 亲人 · 慢热</strong></div><div class="p-fact"><span>所在地</span><strong>上海市徐汇区</strong></div></div><div class="p-callout"><strong>领养前请确认</strong><br>可以接受 10 年以上的长期照护；家庭成员意见一致；同意回访并为动物提供必要医疗。</div><div class="p-actions" style="margin-top:22px"><button class="p-button primary" data-view="adopt-apply">申请领养小满　→</button><button class="p-button ghost" data-action="favorite">♡ 收藏</button></div></div></div></section></main>' + footer() + '</div>';
    }

    function renderNotices() {
        var notices = [['22', 'JUL', '夏季高温救助指引：先降温，再转运', '救助指南', '高温天气下，发现疑似中暑的流浪动物时，请避免直接灌水，并第一时间联系附近救助点。'], ['18', 'JUL', '七月领养开放日开始报名', '线下活动', '本月开放日将在徐汇区社区中心举办，现场可与 12 只待领养动物见面。'], ['12', 'JUL', '六月资金使用与医疗支出公示', '透明公示', '本月收到公众捐助 28,640 元，主要用于绝育、疫苗、接驳和住院治疗。'], ['05', 'JUL', '新志愿者基础培训安排', '志愿服务', '通过初审的志愿者请留意站内通知，并在工作台确认可参加的培训场次。']];
        return '<div class="p-app">' + publicHeader('notices', false) + '<main><section class="p-page-hero"><div class="p-container p-page-hero-inner"><div><p class="p-eyebrow">NEWS & STORIES</p><h1 class="p-title">救助动态与公开信息</h1><p class="p-subtitle">了解最近的救助行动、领养活动、志愿服务和平台公示。</p></div></div></section><section class="p-container p-section-compact"><div class="p-toolbar"><label class="p-search">⌕<input type="search" placeholder="搜索公告标题或内容"></label><select class="p-select"><option>全部分类</option><option>救助指南</option><option>线下活动</option><option>透明公示</option></select><button class="p-button brand" data-action="filter">搜索</button></div><div class="p-filter-chips"><button class="p-filter-chip is-active">全部</button><button class="p-filter-chip">重要公告</button><button class="p-filter-chip">活动</button><button class="p-filter-chip">救助故事</button></div><div class="p-notice-list">' + notices.map(function (n) { return '<article class="p-notice-item"><div class="p-date-box"><b>' + n[0] + '</b><span>' + n[1] + '</span></div><div><span class="p-status done">' + n[3] + '</span><h3>' + n[2] + '</h3><p>' + n[4] + '</p></div><button class="p-button ghost" data-view="notice-detail">阅读全文</button></article>'; }).join('') + '</div></section></main>' + footer() + '</div>';
    }

    function renderNoticeDetail() {
        return '<div class="p-app">' + publicHeader('notices', false) + '<main><article class="p-container p-section" style="max-width:820px"><div class="p-breadcrumb"><span>救助动态</span><span>/</span><b>救助指南</b></div><span class="p-status done">救助指南</span><h1 class="p-title" style="margin-top:18px">夏季高温救助指引：先降温，再转运</h1><p class="p-subtitle">发布于 2026 年 7 月 22 日 · 归途计划医疗协作组</p><div style="margin:32px 0;overflow:hidden;border-radius:22px"><img src="' + animalImages[7] + '" alt="志愿者照顾获救动物" style="width:100%;max-height:430px;object-fit:cover"></div><div style="font-family:var(--font-display);font-size:17px;line-height:2;color:#394038"><p>盛夏时，流浪动物常会躲在车底、地下室入口和树荫下。如果发现动物呼吸急促、站立不稳或意识模糊，请先把它转移到通风阴凉处。</p><p>用常温水逐步湿润脚垫、腹部和耳朵，不要直接使用冰水，也不要强行灌水。记录准确位置和现场状态后，通过平台发起救助，附近志愿者会收到提醒。</p><blockquote style="margin:25px 0;padding:18px 22px;border-left:3px solid var(--action-500);background:#fff3ec">紧急情况请直接联系附近动物医院。平台救助请求不替代专业急救。</blockquote><p>转运时使用透气纸箱或航空箱，保持安静，避免多人围观。抵达医院后，将发现时间、降温措施和动物反应完整告知医生。</p></div><div class="p-actions" style="margin-top:30px"><button class="p-button primary" data-view="rescue-apply">发起救助请求</button><button class="p-button ghost" data-view="notices">返回公告中心</button></div></article></main>' + footer() + '</div>';
    }

    function renderFunds() {
        var rows = [['7 月 20 日', '社会爱心捐助', '+ ¥6,800.00', 'income'], ['7 月 18 日', '小满住院治疗', '- ¥1,260.00', 'expense'], ['7 月 16 日', '疫苗与驱虫采购', '- ¥840.00', 'expense'], ['7 月 12 日', '开放日义卖收入', '+ ¥3,420.00', 'income'], ['7 月 08 日', '救助接驳交通', '- ¥560.00', 'expense']];
        return '<div class="p-app">' + publicHeader('funds', false) + '<main><section class="p-page-hero"><div class="p-container p-page-hero-inner"><div><p class="p-eyebrow">OPEN & ACCOUNTABLE</p><h1 class="p-title">每一份善意，都有清晰去向</h1><p class="p-subtitle">公开展示平台收入、支出与结余。个人敏感信息和内部经手人不会出现在公众页面。</p></div></div></section><section class="p-container p-section-compact"><div class="p-admin-stats"><div class="p-stat-card"><span>累计收入</span><strong>¥ 86,420</strong><small>本月 +10,220</small></div><div class="p-stat-card"><span>累计支出</span><strong>¥ 61,385</strong><small style="color:var(--action-600)">医疗占 54%</small></div><div class="p-stat-card"><span>当前结余</span><strong>¥ 25,035</strong><small>可支持约 18 次基础救助</small></div><div class="p-stat-card"><span>已公开记录</span><strong>128</strong><small>最近更新 2 小时前</small></div></div><div class="p-panel"><div class="p-panel-head"><div><h2>收支明细</h2><p class="p-panel-sub">仅展示款项名称、金额、用途和公示日期</p></div><button class="p-button ghost" data-action="download">下载公示摘要</button></div><div class="p-toolbar" style="margin-bottom:15px"><label class="p-search">⌕<input type="search" placeholder="搜索款项或用途"></label><select class="p-select"><option>全部收支</option><option>收入</option><option>支出</option></select></div><div class="p-table-wrap" style="border-radius:12px"><table class="p-table" style="min-width:620px"><thead><tr><th>日期</th><th>款项名称</th><th>金额</th><th>用途说明</th></tr></thead><tbody>' + rows.map(function (r, i) { return '<tr><td>' + r[0] + '</td><td><strong>' + r[1] + '</strong></td><td style="color:' + (r[3] === 'income' ? 'var(--success)' : 'var(--danger)') + ';font-weight:700">' + r[2] + '</td><td>' + (i % 2 ? '动物医疗、药品和住院护理' : '用于平台救助与安置工作') + '</td></tr>'; }).join('') + '</tbody></table></div></div></section></main>' + footer() + '</div>';
    }

    function renderAuth(register) {
        return '<div class="p-auth"><section class="p-auth-visual"><img src="' + animalImages[0] + '" alt="获救后等待领养的小狗"><a class="p-logo" href="#" data-view="home" style="position:relative;z-index:2;color:#fff"><span class="p-logo-mark" style="background:rgba(255,255,255,.2)">♡</span><span><strong>归途计划</strong><span style="color:rgba(255,255,255,.65)">PAWS ON THE WAY HOME</span></span></a><div class="p-auth-copy"><p class="p-eyebrow" style="color:#f5bc98">' + (register ? 'JOIN THE JOURNEY' : 'WELCOME BACK') + '</p><h1>' + (register ? '让你的善意，成为它们回家的路。' : '欢迎回来，今天也一起做点温暖的事。') + '</h1><p>浏览领养、发起救助、加入志愿服务，并随时查看每一次行动的进展。</p></div></section><section class="p-auth-form-wrap"><div class="p-auth-form"><a class="p-link" href="#" data-view="home">← 返回首页</a><h2>' + (register ? '创建账户' : '登录账户') + '</h2><p>' + (register ? '注册后即可提交领养、救助和志愿服务申请。' : '用户与管理员共用入口，系统会根据权限进入对应工作台。') + '</p><div class="p-field"><label>账号</label><input class="p-input" placeholder="请输入账号" autocomplete="username"></div>' + (register ? '<div class="p-form-grid"><div class="p-field"><label>邮箱</label><input class="p-input" type="email" placeholder="name@example.com"></div><div class="p-field"><label>手机号</label><input class="p-input" type="tel" placeholder="用于救助联系"></div></div>' : '') + '<div class="p-field"><label>密码</label><input class="p-input" type="password" placeholder="至少 8 位" autocomplete="current-password"></div>' + (register ? '<div class="p-field"><label>确认密码</label><input class="p-input" type="password" placeholder="请再次输入密码"></div>' : '<div class="p-auth-meta"><label><input type="checkbox"> 记住本设备</label><a class="p-link" href="#" data-action="forgot">忘记密码？</a></div>') + '<button class="p-button primary" style="width:100%" data-action="auth">' + (register ? '注册并进入工作台' : '登录') + '</button><div class="p-auth-footer">' + (register ? '已有账户？ <a href="#" data-view="login">直接登录</a>' : '还没有账户？ <a href="#" data-view="register">创建一个</a>') + '</div></div></section></div>';
    }

    function renderDashboard() {
        return '<div class="p-app">' + publicHeader('', true) + '<main><section class="p-container p-section"><div class="p-dashboard"><div class="p-welcome"><p class="p-eyebrow" style="color:#f5bc98">GOOD AFTERNOON</p><h1>下午好，林晓。<br>小满的申请有新进展。</h1><p>审核志愿者已查看你的家庭信息，下一步需要预约一次线上沟通。</p><div class="p-actions" style="margin-top:20px"><button class="p-button primary" data-view="my-adoptions">查看申请进度</button><button class="p-button secondary" style="color:#fff;border-color:rgba(255,255,255,.3)" data-view="animals">继续浏览动物</button></div></div><div class="p-dashboard-stat"><div class="p-stat-card"><span>进行中的申请</span><strong>2</strong><small>1 项等待你的操作</small></div><div class="p-stat-card"><span>参与救助</span><strong>4</strong><small>3 项已完成安置</small></div><div class="p-stat-card"><span>志愿服务</span><strong>18h</strong><small>本月 +6 小时</small></div><div class="p-stat-card"><span>站内消息</span><strong>3</strong><small style="color:var(--action-600)">有 2 条未读</small></div></div></div><div class="p-grid two" style="margin-top:22px"><div class="p-panel"><div class="p-panel-head"><div><h2>接下来要做</h2><p class="p-panel-sub">按优先级为你整理</p></div></div><div class="p-task-list"><div class="p-task"><span class="p-task-icon">◷</span><div><strong>预约小满的线上沟通</strong><span>领养申请 · 建议 2 天内完成</span></div><button class="p-button primary" data-view="my-adoptions">去处理</button></div><div class="p-task"><span class="p-task-icon">⇧</span><div><strong>补充居住环境照片</strong><span>领养申请 · 审核需要</span></div><button class="p-button ghost" data-view="proof-upload">上传</button></div><div class="p-task"><span class="p-task-icon">♧</span><div><strong>确认周末志愿服务</strong><span>7 月 27 日 · 领养开放日</span></div><button class="p-button ghost" data-view="my-volunteer">查看</button></div></div></div><div class="p-panel"><div class="p-panel-head"><div><h2>最近动态</h2><p class="p-panel-sub">你的申请与救助记录</p></div></div>' + timeline(['领养申请进入沟通阶段', '“梧桐路受伤橘猫”已完成安置', '志愿者申请审核通过']) + '</div></div></section></main>' + footer() + '</div>';
    }

    function timeline(items) {
        return '<div class="p-timeline">' + items.map(function (item, index) { return '<div class="p-timeline-item"><span class="p-timeline-dot">' + (index + 1) + '</span><div class="p-timeline-copy"><strong>' + item + '</strong><span>' + (index === 0 ? '今天 14:32 · 请进入详情查看下一步' : index === 1 ? '昨天 19:08 · 救助编号 R-20260721' : '7 月 18 日 · 欢迎加入志愿服务') + '</span></div></div>'; }).join('') + '</div>';
    }

    var formConfig = {
        adopt: { eyebrow: 'ADOPTION APPLICATION', title: '申请领养小满', desc: '认真填写的信息会帮助志愿者判断你和小满是否适合彼此。', panel: '申请人信息', fields: [['真实姓名', '请输入姓名'], ['联系电话', '用于审核沟通'], ['居住城市', '例如：上海'], ['住房类型', '自有 / 租住'], ['家庭成员情况', '请说明家庭成员和意见', 'full'], ['养宠经历', '请描述过去或当前的养宠经历', 'full', true]], tips: ['提交申请', '资料初审', '线上沟通', '见面互动', '确认领养'] },
        proof: { eyebrow: 'PRIVATE DOCUMENT', title: '提交领养凭证', desc: '凭证将作为私有资料保存，仅本人和具备凭证审核权限的工作人员可以查看。', panel: '凭证信息', fields: [['关联动物', '小满 · A-1024'], ['凭证类型', '领养协议'], ['备注', '补充说明（选填）', 'full', true]], tips: ['选择领养记录', '上传凭证', '等待审核', '凭证归档'] },
        volunteer: { eyebrow: 'VOLUNTEER APPLICATION', title: '加入志愿者团队', desc: '告诉我们你擅长的事情和可以参与的时间，我们会安排合适的服务与培训。', panel: '志愿者资料', fields: [['姓名', '请输入姓名'], ['联系电话', '用于服务联系'], ['所在区域', '例如：徐汇区'], ['每周可服务时间', '例如：周末 4 小时'], ['擅长领域', '接驳 / 摄影 / 文案 / 医疗协助', 'full'], ['为什么想加入', '简单介绍你的动机和经验', 'full', true]], tips: ['提交申请', '资料审核', '基础培训', '参与服务'] },
        rescue: { eyebrow: 'RESCUE REQUEST', title: '发起动物救助', desc: '请优先提供准确位置、动物状态和可联系的手机号。生命危险时请同时联系附近动物医院。', panel: '现场信息', fields: [['发现位置', '尽量填写详细地址'], ['联系电话', '保持电话畅通'], ['动物类型', '猫 / 狗 / 其他'], ['紧急程度', '一般 / 紧急 / 危急'], ['现场情况', '描述伤情、活动能力和周边环境', 'full', true]], tips: ['提交位置', '附近志愿者响应', '接驳与医疗', '安置与后续'] }
    };

    function renderFormPage(type) {
        var c = formConfig[type];
        return '<div class="p-app">' + publicHeader('', true) + '<main><section class="p-page-hero"><div class="p-container"><p class="p-eyebrow">' + c.eyebrow + '</p><h1 class="p-title">' + c.title + '</h1><p class="p-subtitle">' + c.desc + '</p></div></section><section class="p-container p-section-compact"><div class="p-form-layout"><form class="p-panel" data-prototype-form><div class="p-panel-head"><div><h2>' + c.panel + '</h2><p class="p-panel-sub">标有 * 的项目为必填项</p></div><span class="p-status pending">草稿自动保存</span></div><div class="p-form-grid">' + c.fields.map(function (f, i) { return '<div class="p-field ' + (f[2] === 'full' ? 'full' : '') + '"><label for="field-' + type + '-' + i + '">' + f[0] + (i < 3 ? ' <span class="p-required">*</span>' : '') + '</label>' + (f[3] ? '<textarea id="field-' + type + '-' + i + '" class="p-textarea" placeholder="' + f[1] + '"></textarea>' : '<input id="field-' + type + '-' + i + '" class="p-input" placeholder="' + f[1] + '">') + '<p class="p-field-help">信息仅用于本次' + (type === 'rescue' ? '救助处理' : '申请审核') + '</p></div>'; }).join('') + (type === 'proof' || type === 'rescue' || type === 'volunteer' ? '<div class="p-field full"><label>相关图片或文件</label><button class="p-upload" type="button" data-action="upload"><span><b>点击上传，或将文件拖到这里</b>支持 JPG / PNG' + (type === 'proof' ? ' / PDF' : '') + '，单个文件不超过 5MB</span></button></div>' : '') + '</div><div class="p-actions" style="margin-top:24px"><button class="p-button primary" type="submit">提交申请</button><button class="p-button ghost" type="button" data-action="save-draft">保存草稿</button></div></form><aside class="p-panel"><h3>接下来会发生什么</h3><p class="p-panel-sub" style="margin-bottom:16px">流程公开透明，你会在工作台收到每一步提醒。</p><div class="p-steps">' + c.tips.map(function (tip, i) { return '<div class="p-step ' + (i === 0 ? 'is-active' : '') + '"><span class="p-step-num">' + (i + 1) + '</span><div><strong>' + tip + '</strong><span>' + (i === 0 ? '当前步骤' : '完成前一步后自动进入') + '</span></div></div>'; }).join('') + '</div></aside></div></section></main>' + footer() + '</div>';
    }

    function renderRecordPage(type) {
        var config = {
            adopt: ['我的领养申请', '小满 · A-1024', '沟通中', ['申请已提交', '资料初审通过', '等待线上沟通']],
            volunteer: ['我的志愿服务', '志愿者申请 V-028', '已通过', ['申请已提交', '资料审核通过', '完成基础培训']],
            rescue: ['我的救助记录', '梧桐路受伤橘猫 · R-0719', '处理中', ['救助请求已提交', '志愿者已接单', '已送往合作医院']],
            visit: ['领养回访记录', '小七 · 第 2 次回访', '健康良好', ['回访预约已确认', '志愿者完成回访', '健康评分 5 / 5']]
        }[type];
        return '<div class="p-app">' + publicHeader('', true) + '<main><section class="p-page-hero"><div class="p-container p-page-hero-inner"><div><p class="p-eyebrow">MY RECORDS</p><h1 class="p-title">' + config[0] + '</h1><p class="p-subtitle">集中查看进度、下一步操作和历史记录。</p></div><button class="p-button primary" data-view="' + (type === 'rescue' ? 'rescue-apply' : type === 'volunteer' ? 'volunteer-apply' : type === 'adopt' ? 'animals' : 'dashboard') + '">' + (type === 'rescue' ? '发起新救助' : type === 'volunteer' ? '查看服务机会' : type === 'adopt' ? '浏览动物' : '返回工作台') + '</button></div></section><section class="p-container p-section-compact"><div class="p-grid two"><article class="p-panel"><div class="p-panel-head"><div><span class="p-status pending">' + config[2] + '</span><h2 style="margin-top:12px">' + config[1] + '</h2><p class="p-panel-sub">最近更新：今天 14:32</p></div><button class="p-button ghost" data-action="detail">查看详情</button></div>' + timeline(config[3]) + '<div class="p-callout">下一步：' + (type === 'adopt' ? '请在 7 月 25 日前选择线上沟通时间。' : type === 'volunteer' ? '周六开放日需要 2 名现场协助志愿者。' : type === 'rescue' ? '动物正在治疗中，新的医疗结果会通过站内消息通知。' : '建议继续保持当前饮食，并观察毛发状态。') + '</div></article><article class="p-panel"><div class="p-panel-head"><div><h2>历史记录</h2><p class="p-panel-sub">已结束的记录仍可追溯</p></div></div><div class="p-task-list"><div class="p-task"><span class="p-task-icon">✓</span><div><strong>' + (type === 'rescue' ? '河滨路幼猫救助' : type === 'visit' ? '小七 · 第 1 次回访' : '历史申请记录') + '</strong><span>已完成 · 2026 年 6 月</span></div><span class="p-status done">已完成</span></div><div class="p-task"><span class="p-task-icon">✓</span><div><strong>' + (type === 'rescue' ? '社区流浪猫绝育' : type === 'volunteer' ? '六月领养开放日' : '历史记录') + '</strong><span>已归档 · 2026 年 5 月</span></div><span class="p-status done">已归档</span></div></div></article></div></section></main>' + footer() + '</div>';
    }

    function renderProfile() {
        return '<div class="p-app">' + publicHeader('', true) + '<main><section class="p-page-hero"><div class="p-container"><p class="p-eyebrow">ACCOUNT CENTER</p><h1 class="p-title">个人中心</h1><p class="p-subtitle">管理公开资料、联系方式、账户安全与消息偏好。</p></div></section><section class="p-container p-section-compact"><div class="p-grid two"><div class="p-panel"><div class="p-panel-head"><div><h2>基本资料</h2><p class="p-panel-sub">用于申请和救助联系的信息</p></div><div class="p-user-avatar" style="width:58px;height:58px;font-size:20px">林</div></div><div class="p-form-grid"><div class="p-field"><label>账号</label><input class="p-input" value="linxiao" disabled></div><div class="p-field"><label>显示名称</label><input class="p-input" value="林晓"></div><div class="p-field"><label>邮箱</label><input class="p-input" value="linxiao@example.com"></div><div class="p-field"><label>手机号</label><input class="p-input" value="138 **** 6128"></div></div><button class="p-button primary" style="margin-top:20px" data-action="save">保存资料</button></div><div><div class="p-panel" style="margin-bottom:16px"><h3>账户安全</h3><div class="p-task-list" style="margin-top:15px"><div class="p-task"><span class="p-task-icon">⌾</span><div><strong>登录密码</strong><span>建议定期更新密码</span></div><button class="p-button ghost" data-action="password">修改</button></div><div class="p-task"><span class="p-task-icon">✓</span><div><strong>服务端会话</strong><span>当前设备已安全登录</span></div><span class="p-status waiting">正常</span></div></div></div><div class="p-panel"><h3>消息偏好</h3><p class="p-panel-sub">申请状态和紧急救助消息始终保留站内通知。</p><label style="display:flex;justify-content:space-between;margin-top:15px;font-size:12px">邮件提醒 <input type="checkbox" checked></label><label style="display:flex;justify-content:space-between;margin-top:15px;font-size:12px">活动推荐 <input type="checkbox"></label></div></div></div></section></main>' + footer() + '</div>';
    }

    function renderChat() {
        return '<div class="p-app">' + publicHeader('', true) + '<main><section class="p-page-hero"><div class="p-container p-page-hero-inner"><div><p class="p-eyebrow">RESCUE SUPPORT</p><h1 class="p-title">救助咨询</h1><p class="p-subtitle">非紧急问题可在线咨询；发现受伤或生命危险的动物，请直接发起正式救助。</p></div><button class="p-button primary" data-view="rescue-apply">发起正式救助</button></div></section><section class="p-container p-section-compact"><div class="p-chat-layout"><div class="p-chat"><div class="p-chat-head"><div><strong>在线咨询</strong><span style="display:block;color:var(--muted);font-size:9px;margin-top:3px">当前 6 人在线 · 工作时间 9:00–21:00</span></div><span class="p-status waiting">在线</span></div><div class="p-chat-body" aria-live="polite"><div class="p-message">你好，请问发现未受伤的流浪猫也可以提交救助吗？<small>访客 · 14:18</small></div><div class="p-message mine">可以先观察是否有固定投喂人。如果需要绝育或安置，可以填写救助表单并说明现场情况。<small>我 · 14:20</small></div><div class="p-message">了解了，谢谢。我先去拍一下周边环境。<small>访客 · 14:21</small></div></div><div class="p-chat-input"><input placeholder="输入咨询内容"><button class="p-button brand" data-action="send">发送</button></div></div><aside class="p-panel"><h3>咨询前先看看</h3><div class="p-task-list" style="margin-top:15px"><div class="p-task"><span class="p-task-icon">!</span><div><strong>动物受伤或有生命危险</strong><span>请同时联系附近动物医院</span></div></div><div class="p-task"><span class="p-task-icon">⌖</span><div><strong>准备准确位置</strong><span>街道、门牌或地图定位</span></div></div><div class="p-task"><span class="p-task-icon">▣</span><div><strong>拍摄现场照片</strong><span>不要为了拍摄惊扰动物</span></div></div></div></aside></div></section></main>' + footer() + '</div>';
    }

    var adminConfigs = {
        animals: { title: '动物管理', desc: '维护动物档案、健康信息与领养状态', primary: '新增动物', stats: [['动物档案', '86'], ['等待领养', '18'], ['申请沟通中', '7'], ['本月新增', '12']], headers: ['动物', '品种 / 性别', '年龄', '健康状态', '领养状态', '最近更新', '操作'], rows: [['小满', '中华田园猫 · 女孩', '2 岁', '已体检', '等待领养', '2 小时前'], ['阿布', '边境牧羊犬 · 男孩', '3 岁', '已免疫', '申请沟通中', '昨天'], ['年糕', '橘白猫 · 女孩', '1 岁', '治疗观察', '暂不可申请', '昨天'], ['星星', '中华田园犬 · 女孩', '4 岁', '已绝育', '等待领养', '7 月 20 日']] },
        adoptions: { title: '领养审核', desc: '集中处理申请资料、沟通记录与审核结果', primary: '导出申请', stats: [['待审核', '12'], ['沟通中', '7'], ['本月通过', '18'], ['平均处理', '2.4 天']], headers: ['申请编号', '动物', '申请人', '居住情况', '当前阶段', '提交时间', '操作'], rows: [['AD-24072', '小满', '林晓', '自有住房 · 全家同意', '沟通中', '今天 10:32'], ['AD-24068', '阿布', '周淇', '租住 · 房东同意', '待审核', '昨天'], ['AD-24061', '栗子', '张悦', '自有住房 · 有养宠经验', '待审核', '7 月 20 日'], ['AD-24055', '汤圆', '陈屿', '租住 · 独居', '已通过', '7 月 18 日']] },
        proofs: { title: '凭证审核', desc: '审核领养协议、绝育证明和必要附件', primary: '导出记录', stats: [['待审核', '8'], ['本周通过', '14'], ['需补充', '3'], ['归档总数', '128']], headers: ['凭证编号', '关联动物', '提交人', '文件类型', '审核状态', '提交时间', '操作'], rows: [['PF-1082', '小满', '林晓', '领养协议', '待审核', '今天 11:20'], ['PF-1079', '小七', '赵南', '绝育证明', '需补充', '昨天'], ['PF-1072', '栗子', '孙悦', '领养协议', '已通过', '7 月 20 日'], ['PF-1068', '汤圆', '陈屿', '回访材料', '已通过', '7 月 18 日']] },
        visits: { title: '回访管理', desc: '记录领养后的健康、适应与家庭反馈', primary: '新增回访', stats: [['本月待访', '9'], ['已完成', '24'], ['健康异常', '2'], ['平均评分', '4.7']], headers: ['回访编号', '动物 / 饲主', '回访日期', '健康评分', '异常标签', '回访人', '操作'], rows: [['VS-208', '小七 · 赵南', '7 月 22 日', '5 / 5', '无', '李婷'], ['VS-204', '栗子 · 孙悦', '7 月 20 日', '4 / 5', '轻微掉毛', '高桥'], ['VS-198', '汤圆 · 陈屿', '7 月 17 日', '3 / 5', '食欲下降', '李婷'], ['VS-191', '麦麦 · 周淇', '7 月 12 日', '5 / 5', '无', '韩松']] },
        volunteers: { title: '志愿者审核', desc: '审核申请、安排培训并维护服务状态', primary: '发布服务任务', stats: [['待审核', '6'], ['认证志愿者', '76'], ['本周服务', '128h'], ['任务缺口', '4']], headers: ['申请人', '所在区域', '擅长领域', '可服务时间', '审核状态', '申请时间', '操作'], rows: [['王然', '徐汇区', '接驳 · 摄影', '周末', '待审核', '今天'], ['刘可', '浦东新区', '文案 · 活动', '工作日晚间', '培训中', '昨天'], ['沈瑶', '静安区', '医疗协助', '周三 / 周六', '已通过', '7 月 18 日'], ['周屿', '长宁区', '接驳', '灵活', '已通过', '7 月 16 日']] },
        rescues: { title: '救助管理', desc: '按紧急程度处理现场救助与后续安置', primary: '创建救助任务', stats: [['危急待处理', '2'], ['处理中', '8'], ['今日完成', '5'], ['平均响应', '18m']], headers: ['紧急度', '地点', '现场情况', '联系人', '负责人', '处理状态', '操作'], rows: [['危急', '梧桐路 218 号', '橘猫后腿受伤，无法站立', '林晓', '李婷', '送医中'], ['紧急', '滨江公园 3 号门', '幼犬被困排水沟', '王然', '韩松', '已接单'], ['一般', '虹梅路社区', '母猫带三只幼猫', '周淇', '待响应', '待处理'], ['一般', '徐家汇地铁口', '流浪犬持续徘徊', '陈屿', '高桥', '评估中']] },
        notices: { title: '公告管理', desc: '发布救助动态、活动通知与透明公示', primary: '新建公告', stats: [['草稿', '3'], ['已发布', '42'], ['本月阅读', '6.8k'], ['待更新', '2']], headers: ['标题', '分类', '发布状态', '作者', '阅读量', '更新时间', '操作'], rows: [['夏季高温救助指引', '救助指南', '已发布', '医疗协作组', '1,284', '今天'], ['七月领养开放日', '线下活动', '已发布', '运营组', '886', '昨天'], ['六月资金使用公示', '透明公示', '已发布', '财务组', '734', '7 月 12 日'], ['新志愿者培训安排', '志愿服务', '草稿', '志愿者组', '—', '7 月 05 日']] },
        funds: { title: '资金管理', desc: '登记救助收入支出，并同步生成公开公示', primary: '新增收支', stats: [['累计收入', '¥86.4k'], ['累计支出', '¥61.3k'], ['当前结余', '¥25.0k'], ['待核对', '3']], headers: ['记录 ID', '款项名称', '经手人', '金额', '用途详情', '日期', '操作'], rows: [['AC-128', '社会爱心捐助', '张悦', '+ ¥6,800', '七月公众捐助', '7 月 20 日'], ['AC-127', '小满住院治疗', '李婷', '- ¥1,260', '检查、住院与药品', '7 月 18 日'], ['AC-126', '疫苗与驱虫采购', '陈屿', '- ¥840', '救助动物基础医疗', '7 月 16 日'], ['AC-125', '开放日义卖收入', '王然', '+ ¥3,420', '领养开放日义卖', '7 月 12 日']] },
        users: { title: '用户管理', desc: '维护账户、角色和安全状态', primary: '新增用户', stats: [['注册用户', '1,248'], ['本月新增', '86'], ['管理员', '12'], ['异常账户', '3']], headers: ['用户', '联系方式', '角色', '账户状态', '最近登录', '注册时间', '操作'], rows: [['林晓 · linxiao', '138 **** 6128', '普通用户', '正常', '今天 14:20', '2026-05-12'], ['李婷 · liting', '136 **** 8831', '救助管理员', '正常', '今天 09:12', '2025-11-08'], ['王然 · wangran', '139 **** 1720', '认证志愿者', '正常', '昨天', '2026-06-18'], ['admin', '—', '超级管理员', '受保护', '今天 08:30', '2025-01-01']] },
        roles: { title: '角色管理', desc: '按职责配置角色，保持最小权限', primary: '新建角色', stats: [['系统角色', '6'], ['授权用户', '94'], ['权限项', '18'], ['受保护角色', '1']], headers: ['角色名称', '角色 ID', '权限范围', '用户数量', '保护状态', '更新时间', '操作'], rows: [['超级管理员', '1', '全部权限', '1', '受保护', '系统内置'], ['认证志愿者', '2', '义工 · 救助 · 回访', '76', '普通', '7 月 18 日'], ['救助管理员', '3', '救助 · 动物 · 回访', '8', '普通', '7 月 12 日'], ['内容运营', '4', '公告 · 资金公示', '5', '普通', '7 月 05 日']] },
        permissions: { title: '权限管理', desc: '维护业务 Flag、菜单入口与接口契约', primary: '新增权限', stats: [['权限项', '18'], ['业务域', '9'], ['菜单入口', '16'], ['待校验', '2']], headers: ['权限名称', 'Flag', '业务域', '菜单路径', '关联角色', '契约状态', '操作'], rows: [['动物管理', 'animal', '动物档案', '/page/end/animal.html', '3 个角色', '正常'], ['领养审核', 'adopt', '领养业务', '/page/end/adopt.html', '2 个角色', '正常'], ['凭证审核', 'proof', '领养凭证', '/page/end/proof.html', '2 个角色', '正常'], ['资金管理', 'account', '透明公示', '/page/end/account.html', '2 个角色', '待复核']] }
    };

    function adminShell(active, content) {
        var menu = [['admin-dashboard', '▦', '运营总览'], ['admin-animals', '♢', '动物管理'], ['admin-adoptions', '♡', '领养审核'], ['admin-adopt-board', '◷', '领养待办'], ['admin-proofs', '▣', '凭证审核'], ['admin-visits', '⌁', '回访管理'], ['admin-volunteers', '♧', '志愿者审核'], ['admin-rescues', '!', '救助管理'], ['admin-rescue-chat', '…', '救助会话'], ['admin-notices', '◫', '公告管理'], ['admin-funds', '¥', '资金管理'], ['admin-users', '●', '用户管理'], ['admin-roles', '◇', '角色管理'], ['admin-permissions', '⌾', '权限管理']];
        return '<div class="p-admin"><aside class="p-admin-sidebar"><div class="p-admin-brand"><span class="p-logo-mark">♡</span><div><strong>归途管理台</strong><span>PAWS OPERATIONS</span></div></div><nav class="p-admin-nav"><div class="p-admin-nav-label">WORKSPACE</div>' + menu.map(function (item) { return '<a href="#" data-view="' + item[0] + '" class="' + (active === item[0] ? 'is-active' : '') + '"><b>' + item[1] + '</b><span>' + item[2] + '</span></a>'; }).join('') + '</nav><div class="p-admin-profile"><span class="p-user-avatar">李</span><div><strong>李婷</strong><span>救助管理员</span></div></div></aside><div class="p-admin-main"><header class="p-admin-header"><div class="p-admin-header-left"><button aria-label="折叠侧栏">☰</button><span>运营中心 / ' + escapeHtml(pages.find(function (p) { return p.id === active; }).title) + '</span></div><div class="p-admin-header-actions"><button class="p-icon-button" data-action="notification">♢</button><button class="p-icon-button" data-action="help">?</button></div></header>' + content + '</div></div>';
    }

    function renderAdminDashboard() {
        return adminShell('admin-dashboard', '<main class="p-admin-content"><div class="p-admin-title-row"><div><h1>运营总览</h1><p>2026 年 7 月 22 日 · 今天有 14 项任务需要处理</p></div><button class="p-button primary" data-view="admin-rescues">查看紧急救助</button></div><div class="p-admin-stats"><div class="p-admin-stat"><span>危急救助待处理</span><strong>2</strong><small style="color:var(--danger)">需要立即响应</small></div><div class="p-admin-stat"><span>待审核申请</span><strong>26</strong><small>较昨日 +4</small></div><div class="p-admin-stat"><span>等待领养动物</span><strong>18</strong><small>本月成功 12 例</small></div><div class="p-admin-stat"><span>本月志愿服务</span><strong>128h</strong><small>76 名认证志愿者</small></div></div><div class="p-grid two"><section class="p-panel"><div class="p-panel-head"><div><h3>优先待办</h3><p class="p-panel-sub">按紧急程度和等待时间排序</p></div><button class="p-link" data-action="refresh">刷新</button></div><div class="p-task-list"><div class="p-task"><span class="p-task-icon" style="background:#fff0ef;color:var(--danger)">!</span><div><strong>梧桐路受伤橘猫等待接驳</strong><span>危急 · 已等待 12 分钟</span></div><button class="p-button danger" data-view="admin-rescues">处理</button></div><div class="p-task"><span class="p-task-icon">♡</span><div><strong>小满的领养申请等待沟通</strong><span>申请人资料已完成初审</span></div><button class="p-button ghost" data-view="admin-adoptions">查看</button></div><div class="p-task"><span class="p-task-icon">♧</span><div><strong>6 份志愿者申请待审核</strong><span>最早提交于 2 天前</span></div><button class="p-button ghost" data-view="admin-volunteers">审核</button></div></div></section><section class="p-panel"><div class="p-panel-head"><div><h3>最近动态</h3><p class="p-panel-sub">跨模块事件摘要</p></div></div>' + timeline(['救助 R-0719 已送往合作医院', '领养 AD-24055 审核通过', '七月领养开放日公告已发布']) + '</section></div><div class="p-chart-grid"><section class="p-chart"><h3>近七日救助与领养趋势</h3><div class="p-bars">' + [42, 66, 53, 82, 62, 94, 76].map(function (height, i) { return '<div class="p-bar" style="height:' + height + '%"><span>' + ['一','二','三','四','五','六','日'][i] + '</span></div>'; }).join('') + '</div></section><section class="p-chart"><h3>救助闭环率</h3><div class="p-donut-wrap"><div class="p-donut"></div></div></section></div></main>');
    }

    function renderAdminList(type) {
        var c = adminConfigs[type];
        var active = 'admin-' + type;
        var rows = c.rows.map(function (row, rowIndex) {
            return '<tr>' + row.map(function (cell, index) {
                if (index === 0 && type === 'animals') return '<td><div class="p-table-animal"><img class="p-table-avatar" src="' + animalImages[rowIndex] + '" alt=""><div><strong>' + cell + '</strong><span>#A-' + (1024 + rowIndex) + '</span></div></div></td>';
                var statusLike = /(等待|待审|沟通|处理|通过|正常|草稿|危急|紧急|异常|保护|培训|送医|接单)/.test(cell);
                return '<td>' + (statusLike ? '<span class="p-status ' + (/危急|异常/.test(cell) ? 'danger' : /等待|待审|沟通|处理|培训|紧急|送医|接单/.test(cell) ? 'pending' : 'waiting') + '">' + cell + '</span>' : cell) + '</td>';
            }).join('') + '<td><div class="p-table-actions"><button class="p-text-button" data-action="edit">查看</button><button class="p-text-button" data-action="edit">编辑</button><button class="p-text-button danger" data-action="delete">删除</button></div></td></tr>';
        }).join('');
        return adminShell(active, '<main class="p-admin-content"><div class="p-admin-title-row"><div><h1>' + c.title + '</h1><p>' + c.desc + '</p></div><button class="p-button primary" data-action="create">＋ ' + c.primary + '</button></div><div class="p-admin-stats">' + c.stats.map(function (s, i) { return '<div class="p-admin-stat"><span>' + s[0] + '</span><strong>' + s[1] + '</strong><small>' + (i === 0 ? '需要优先关注' : '数据实时更新') + '</small></div>'; }).join('') + '</div><div class="p-admin-toolbar"><div class="p-admin-filters"><label class="p-search"><span>⌕</span><input placeholder="搜索关键词、编号或姓名"></label><select class="p-select"><option>全部状态</option><option>待处理</option><option>已完成</option></select><button class="p-button ghost" data-action="filter">更多筛选</button></div><div class="p-admin-actions"><button class="p-button ghost" data-action="import">导入</button><button class="p-button ghost" data-action="download">导出</button></div></div><div class="p-table-wrap"><table class="p-table"><thead><tr>' + c.headers.map(function (h) { return '<th>' + h + '</th>'; }).join('') + '</tr></thead><tbody>' + rows + '</tbody></table><div class="p-pagination"><span>共 86 条记录 · 每页 10 条</span><div class="p-page-buttons"><button>‹</button><button class="is-active">1</button><button>2</button><button>3</button><button>›</button></div></div></div></main>');
    }

    function renderEditor() {
        return adminShell('admin-editor', '<main class="p-admin-content"><div class="p-admin-title-row"><div><h1>内容编辑器</h1><p>撰写公告、救助故事和活动通知</p></div><div class="p-actions"><button class="p-button ghost" data-action="preview">预览</button><button class="p-button primary" data-action="publish">发布内容</button></div></div><div class="p-form-layout" style="grid-template-columns:minmax(0,1fr) 280px"><section class="p-panel"><div class="p-field"><label>标题</label><input class="p-input" value="七月领养开放日开始报名"></div><div class="p-field" style="margin-top:16px"><label>正文</label><div style="border:1px solid var(--line);border-radius:10px;overflow:hidden;background:#fff"><div style="display:flex;gap:6px;padding:9px;border-bottom:1px solid var(--line);background:#f8f7f2"><button class="p-icon-button"><b>B</b></button><button class="p-icon-button"><i>I</i></button><button class="p-icon-button">H</button><button class="p-icon-button">☷</button><button class="p-icon-button">▧</button></div><div contenteditable="true" style="min-height:380px;padding:22px;outline:none;font-family:var(--font-display);line-height:2"><h2>和它们见一面，也许就是一个家的开始</h2><p>本月领养开放日将在徐汇区社区中心举行。现场有 12 只完成健康评估的动物等待与大家见面。</p><p>请提前在线报名，并认真阅读领养须知。</p></div></div></div></section><aside><div class="p-panel" style="margin-bottom:14px"><h3>发布设置</h3><div class="p-field" style="margin-top:14px"><label>分类</label><select class="p-select" style="width:100%"><option>线下活动</option></select></div><div class="p-field" style="margin-top:14px"><label>发布时间</label><input class="p-input" value="立即发布"></div></div><div class="p-panel"><h3>发布检查</h3><div class="p-task-list" style="margin-top:14px"><div class="p-task"><span class="p-task-icon">✓</span><div><strong>标题与摘要</strong><span>已完成</span></div></div><div class="p-task"><span class="p-task-icon">!</span><div><strong>封面图片</strong><span>建议补充</span></div></div></div></div></aside></div></main>');
    }

    function renderAdoptBoard() {
        var columns = [
            { title: '待初审', count: 12, cards: [['AD-24068', '阿布 × 周淇', '已等待 18 小时'], ['AD-24061', '栗子 × 张悦', '已等待 1 天']] },
            { title: '待沟通', count: 7, cards: [['AD-24072', '小满 × 林晓', '资料完整'], ['AD-24059', '麦麦 × 王然', '待预约时间']] },
            { title: '待见面', count: 4, cards: [['AD-24055', '汤圆 × 陈屿', '周六 14:00'], ['AD-24052', '年糕 × 沈瑶', '周日 10:30']] },
            { title: '待归档', count: 3, cards: [['AD-24041', '小七 × 赵南', '协议待上传'], ['AD-24038', '星星 × 刘可', '回访计划待确认']] }
        ];
        return adminShell('admin-adopt-board', '<main class="p-admin-content"><div class="p-admin-title-row"><div><h1>领养待办看板</h1><p>按流程阶段推进申请，减少跨页面查找和状态遗漏</p></div><div class="p-actions"><button class="p-button ghost" data-view="admin-adoptions">切换列表</button><button class="p-button primary" data-action="create">新建沟通记录</button></div></div><div class="p-board">' + columns.map(function (column, ci) {
            return '<section class="p-board-column"><header><div><strong>' + column.title + '</strong><span>' + column.count + ' 项</span></div><button data-action="filter">•••</button></header><div class="p-board-list">' + column.cards.map(function (card, i) {
                return '<article class="p-board-card"><div class="p-card-head"><span class="p-status ' + (ci === 0 ? 'pending' : ci === 3 ? 'done' : 'waiting') + '">' + card[0] + '</span><span>0' + (i + 1) + '</span></div><h3>' + card[1] + '</h3><p>' + card[2] + '</p><div class="p-board-meta"><span>资料 ' + (ci === 0 ? '4/6' : '6/6') + '</span><button class="p-text-button" data-action="edit">打开详情 →</button></div></article>';
            }).join('') + '</div><button class="p-board-add" data-action="create">＋ 添加待办</button></section>';
        }).join('') + '</div></main>');
    }

    function renderAdminChat() {
        return adminShell('admin-rescue-chat', '<main class="p-admin-content"><div class="p-admin-title-row"><div><h1>救助会话工作台</h1><p>将咨询、救助单和处理上下文集中到一个工作区</p></div><span class="p-status waiting">6 人在线</span></div><div class="p-admin-chat-shell"><aside class="p-conversation-list"><div class="p-chat-search">⌕　搜索会话或救助编号</div>' +
            [['林晓', '梧桐路受伤橘猫', '刚刚', '危急'], ['周淇', '社区母猫和幼猫', '8 分钟前', '一般'], ['王然', '幼犬被困排水沟', '25 分钟前', '紧急'], ['陈屿', '流浪犬持续徘徊', '昨天', '评估中']].map(function (item, i) {
                return '<button class="p-conversation ' + (i === 0 ? 'is-active' : '') + '" data-action="edit"><span class="p-user-avatar">' + item[0].slice(0,1) + '</span><span><strong>' + item[0] + '</strong><small>' + item[1] + '</small></span><em>' + item[2] + '</em><i class="p-status ' + (item[3] === '危急' ? 'danger' : 'pending') + '">' + item[3] + '</i></button>';
            }).join('') + '</aside><section class="p-chat p-admin-chat"><div class="p-chat-head"><div><strong>林晓 · R-0719</strong><span>梧桐路受伤橘猫</span></div><button class="p-button ghost" data-view="admin-rescues">查看救助单</button></div><div class="p-chat-body"><div class="p-message">猫咪后腿可能受伤，现在躲在台阶旁边。<small>林晓 · 14:18</small></div><div class="p-message mine">已经通知附近志愿者，请保持距离观察，不要强行移动。<small>我 · 14:20</small></div><div class="p-message">收到，我会在现场等候。<small>林晓 · 14:21</small></div></div><div class="p-chat-input"><input placeholder="输入处理回复"><button class="p-button brand" data-action="send">发送</button></div></section><aside class="p-context-panel"><div class="p-panel"><span class="p-status danger">危急</span><h3>救助上下文</h3><dl><dt>位置</dt><dd>梧桐路 218 号</dd><dt>联系电话</dt><dd>138 **** 6128</dd><dt>负责人</dt><dd>李婷</dd><dt>当前状态</dt><dd>等待接驳</dd></dl><button class="p-button primary" data-action="edit">更新救助状态</button></div><div class="p-panel"><h3>快捷回复</h3><button class="p-quick-reply" data-action="send">请保持安全距离</button><button class="p-quick-reply" data-action="send">志愿者正在赶往现场</button><button class="p-quick-reply" data-action="send">请补充现场照片</button></div></aside></div></main>');
    }

    function renderAdminProfile() {
        return adminShell('admin-profile', '<main class="p-admin-content"><div class="p-admin-title-row"><div><h1>管理员个人资料</h1><p>管理工作身份、联系方式、账户安全与通知偏好</p></div><button class="p-button primary" data-action="save">保存修改</button></div><div class="p-profile-layout"><section class="p-panel p-profile-card"><span class="p-user-avatar p-profile-avatar">李</span><h2>李婷</h2><p>救助管理员 · 上海站</p><span class="p-status waiting">账户正常</span><div class="p-profile-stats"><div><strong>128</strong><span>处理救助</span></div><div><strong>96%</strong><span>按时响应</span></div></div></section><div class="p-profile-sections"><section class="p-panel"><div class="p-panel-head"><div><h2>基本资料</h2><p class="p-panel-sub">用于团队协作和审计记录</p></div></div><div class="p-form-grid"><div class="p-field"><label>显示名称</label><input class="p-input" value="李婷"></div><div class="p-field"><label>联系电话</label><input class="p-input" value="136 **** 8831"></div><div class="p-field"><label>工作邮箱</label><input class="p-input" value="liting@example.com"></div><div class="p-field"><label>所属站点</label><select class="p-select" style="width:100%"><option>上海站</option></select></div></div></section><section class="p-panel"><h2>账户安全</h2><div class="p-task-list"><div class="p-task"><span class="p-task-icon">⌾</span><div><strong>登录密码</strong><span>最近更新于 30 天前</span></div><button class="p-button ghost" data-action="password">修改</button></div><div class="p-task"><span class="p-task-icon">✓</span><div><strong>当前会话</strong><span>Windows · Edge · 上海</span></div><span class="p-status waiting">当前设备</span></div></div></section></div></div></main>');
    }

    function renderComponentLibrary() {
        return adminShell('design-components', '<main class="p-admin-content"><div class="p-admin-title-row"><div><h1>组件与状态规范</h1><p>正式页面迁移时复用相同的按钮、字段、标签和反馈模式</p></div><button class="p-button primary" data-action="download">导出规范</button></div><div class="p-component-grid"><section class="p-panel"><h2>按钮</h2><p class="p-panel-sub">主行动、次行动、危险操作与文本行动</p><div class="p-component-row"><button class="p-button primary">主要操作</button><button class="p-button brand">品牌操作</button><button class="p-button ghost">次要操作</button><button class="p-button danger">危险操作</button></div></section><section class="p-panel"><h2>状态标签</h2><p class="p-panel-sub">颜色与文字同时表达，不只依赖颜色</p><div class="p-component-row"><span class="p-status waiting">已通过</span><span class="p-status pending">待处理</span><span class="p-status done">已归档</span><span class="p-status danger">异常</span></div></section><section class="p-panel"><h2>表单字段</h2><div class="p-form-grid"><div class="p-field"><label>正常字段</label><input class="p-input" placeholder="请输入内容"><p class="p-field-help">提供清晰的输入帮助</p></div><div class="p-field"><label>选择字段</label><select class="p-select" style="width:100%"><option>请选择状态</option></select></div><div class="p-field full"><label>多行说明</label><textarea class="p-textarea" placeholder="请输入详细说明"></textarea></div></div></section><section class="p-panel"><h2>反馈消息</h2><div class="p-alert success"><strong>操作成功</strong><span>资料已保存并同步到业务记录。</span></div><div class="p-alert warning"><strong>需要补充信息</strong><span>请上传清晰的居住环境照片。</span></div><div class="p-alert error"><strong>操作未完成</strong><span>网络连接异常，请稍后重试。</span></div></section></div></main>');
    }

    function renderSystemStates() {
        return adminShell('system-states', '<main class="p-admin-content"><div class="p-admin-title-row"><div><h1>系统状态与异常</h1><p>所有业务页面使用一致、可行动的加载和错误反馈</p></div><span class="p-status waiting">组件规范 v1</span></div><div class="p-state-grid"><section class="p-panel"><div class="p-state-preview"><span class="p-state-spinner"></span><h3>正在加载数据</h3><p>保留稳定布局，避免内容出现时发生跳动。</p></div></section><section class="p-panel"><div class="p-state-preview"><span class="p-empty-icon">⌕</span><h3>暂时没有记录</h3><p>调整筛选条件，或创建第一条业务记录。</p><button class="p-button primary" data-action="create">创建记录</button></div></section><section class="p-panel"><div class="p-state-preview"><span class="p-empty-icon">!</span><h3>数据加载失败</h3><p>网络连接异常，请检查后重新加载。</p><button class="p-button brand" data-action="refresh">重新加载</button></div></section><section class="p-panel"><div class="p-state-preview"><span class="p-empty-icon">⌾</span><h3>没有访问权限</h3><p>当前角色无法访问此功能，如有需要请联系管理员。</p><button class="p-button ghost" data-view="admin-dashboard">返回总览</button></div></section><section class="p-panel"><div class="p-state-preview"><span class="p-empty-icon">✓</span><h3>全部处理完成</h3><p>当前筛选范围内没有待办事项。</p><button class="p-button ghost" data-action="filter">查看历史</button></div></section><section class="p-panel"><div class="p-state-preview"><span class="p-empty-icon">⚙</span><h3>系统维护中</h3><p>预计 15 分钟后恢复，请保留当前页面。</p><button class="p-button ghost" data-action="refresh">检查状态</button></div></section></div></main>');
    }

    function bindEvents() {
        document.addEventListener('click', function (event) {
            var viewTarget = event.target.closest('[data-view]');
            if (viewTarget) {
                event.preventDefault();
                navigate(viewTarget.getAttribute('data-view'), true);
                return;
            }
            var actionTarget = event.target.closest('[data-action]');
            if (actionTarget) {
                event.preventDefault();
                var action = actionTarget.getAttribute('data-action');
                var messages = {
                    search: '搜索面板已展开（原型交互）', filter: '筛选条件已应用', favorite: '已收藏小满', upload: '已打开安全文件选择器',
                    'save-draft': '草稿已保存', detail: '详情抽屉已打开', password: '密码修改面板已打开', save: '资料已保存',
                    send: '消息已发送', notification: '暂无新的紧急通知', help: '帮助中心已打开', refresh: '数据已刷新',
                    create: '新增抽屉已打开', edit: '详情抽屉已打开', delete: '已打开危险操作确认框', import: '导入向导已打开',
                    download: '已生成可下载摘要', preview: '前台预览已打开', publish: '发布前检查已通过', auth: '身份验证成功，将进入工作台',
                    forgot: '密码找回流程已打开', 'mobile-menu': '移动导航已展开'
                };
                showToast(messages[action] || '交互已触发');
            }
        });
        document.addEventListener('submit', function (event) {
            if (event.target.matches('[data-prototype-form]')) {
                event.preventDefault();
                showToast('申请已提交，进度已同步到工作台');
            }
        });
        document.getElementById('prototypeSearch').addEventListener('input', function (event) { renderNav(event.target.value.trim()); });
        document.querySelectorAll('[data-viewport]').forEach(function (button) { button.addEventListener('click', function () { setViewport(button.getAttribute('data-viewport')); }); });
        document.getElementById('toggleNotes').addEventListener('click', function () { document.getElementById('studioNotes').classList.add('is-open'); });
        document.getElementById('closeNotes').addEventListener('click', function () { document.getElementById('studioNotes').classList.remove('is-open'); });
        document.getElementById('sidebarToggle').addEventListener('click', function () { document.getElementById('prototypeStudio').classList.toggle('sidebar-open'); });
        document.getElementById('openStandalone').addEventListener('click', function () {
            window.open(location.pathname + '?view=' + encodeURIComponent(state.current) + '&viewport=' + encodeURIComponent(state.viewport) + '&standalone=1', '_blank');
        });
    }

    function initStandalone() {
        if (!state.standalone) return;
        document.body.classList.add('standalone-prototype');
        var style = document.createElement('style');
        style.textContent = '.standalone-prototype .studio-sidebar,.standalone-prototype .studio-toolbar,.standalone-prototype .preview-ruler{display:none!important}.standalone-prototype .prototype-studio{display:block}.standalone-prototype .studio-workspace{padding:0;min-height:100vh;background:#151917}.standalone-prototype .preview-stage{width:100%!important;min-height:100vh;border:0;border-radius:0;box-shadow:none}.standalone-prototype .prototype-app{min-height:100vh}';
        document.head.appendChild(style);
    }

    initStandalone();
    bindEvents();
    renderNav('');
    setViewport(state.viewport);
}());
