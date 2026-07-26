# 前端优化计划(2026-07-26)

基于三路评估(代码架构 / UX 一致性 / 加载性能,各自实测取证)+ 浏览器实机验证。
总体结论:近期 UI 改造产出的设计系统(product-ui.css + admin-workspace.css)质量很高,
front 16 页 + end 13 页已统一,首屏约 255KB;问题集中在服务端缓存策略、死资源、
复制漂移与若干体验断点。

## ✅ P0 服务端性能(已完成,配置级,实测验证)

| 项 | 改动 | 效果 |
|----|------|------|
| gzip | `server.compression` | 文本资源约 -65% 传输 |
| 公开图片缓存 | FileController:公开图片 `public, max-age=7d, immutable`(flag=UUID 内容不可变),私有附件保持 no-store | 此前动物列表每次访问重下 2.8MB/张 |
| 静态资源缓存 | WebMvcConfig:js/css 7 天 + HTML no-cache 协商 | 消除 304 风暴;发版改动即时可见 |
| 版本串统一 | 三代 ?v= 并存 → `20260726`,CSS 补版本参数 | 修复缓存用户跑旧 auth 逻辑 |

**发版约定:改动任何自有 js/css 后,全局把 `?v=20260726` bump 为当天日期。**

## ✅ P1 死重量清理(已完成,static 15MB → 825KB)

- 删除 10 个已被 AuthInterceptor 重定向的 legacy Element UI 后台页 + prototype.html
  (重定向表保留,外部书签仍 302)
- 删除 35 项零引用资源(逐项 grep 验证):tinymce 7.9M、echarts、element.js/css、
  js/vue/、index.css、theme.css、search_css、三个图片目录、front-nav.js(零引用死代码)等
- 现存活文件清单:css 2 个(product-ui / admin-workspace),js 7 个
  (jquery / vue.min / auth-session / admin-auth / user-workspace / decimal-money / gVerify / status-text)

## ✅ P2 体验与一致性(已完成)

- **凭证入口死路**:「提交领养凭证」改指「我的领养」;adopt_proof 无参访问给引导态+跳转按钮
- **a11y**:主按钮对比度 3.1:1 → 4.68:1(新 `--ui-accent-strong: #d63a1f`);
  字号下限 12px(修 21 处 10px、1 处 8px);面包屑对比度 2.6:1 → 4.6:1
- **品牌统一**:front 16 页 ♡、end 13 页 爪(原三种 mark 混布);产品名统一「归途计划」;
  title 分隔符统一「·」;全站补 SVG favicon
- **状态词单一事实源**:新增 `js/status-text.js`(adopt/animal/proof/volunteer/help 五套字典),
  已接线 4 个冲突页(用户端「未通过」vs 管理端「已驳回」、动物三态两套叫法)
- **聊天状态胶囊真实化**:rescue_apply + end/help 按轮询结果显示 更新中/每10秒更新/连接异常
- **文案**:register 按钮「创建账户并进入工作台」→「创建账户」;my_visit 页脚补 ©2026、空态图标统一

## ⏸ P3 结构性去重(建议后续排期,按收益排序)

1. **front 头部/页脚共享注入**(impact:high / effort:medium)
   16 页手写 header 已漂移:账号菜单内容页页不同,my_adopt/my_visit/adopt_proof 等页
   **无退出登录入口**;移动菜单按钮三种形态;分页按钮两种。
   方案:新写 front-shell.js(数据驱动渲染 header/footer/账号菜单,按 pathname 高亮),
   各页只留挂载点;或先做一次以 index.html 为准的对齐 pass(半天)。
2. **admin-shell.js + AdminCrudMixin**(impact:medium / effort:medium)
   13 个管理页 header 壳与 8 个 CRUD 方法(load/openEdit/save/logout 等)重复,
   分页 markup 全站 18 份 → 抽 mixin + `<ui-pagination>` 组件,每页 -80~150 行。
3. **内联脚本外置**(impact:medium / effort:large)
   全站约 21 万字符内联 JS;user/role/permission/my_visit 等 8 页被压成单行(不可 review)。
   先格式化还原,再把 TOP5 大页脚本移到 js/pages/*.js(享受缓存与版本串)。
   统一 Vue 接线模式为「AuthSession.bootstrap onDone 内创建实例」(消除未验证先渲染的闪烁)。
4. **上传图缩略图管线**(impact:high / effort:medium)
   服务端上传时限制长边(如 1600px)或生成列表用缩略图;
   配合 P0 缓存,列表页流量再降一个数量级。
5. **adopt_apply 表单校验升级**(impact:medium / effort:small)
   13 字段长表单目前只在底部报第一条错误;改成 rescue_apply 同款逐字段
   内联错误 + aria-invalid + focus 第一个错误字段。adopt_proof 的原生 confirm() 换 ui-dialog。
6. **普通用户 person.html 品牌切换**(impact:high / effort:medium)
   front 用户改资料要跳进「管理工作台」品牌页;方案:person.html 按
   `UserWorkspace.hasAdminAccess` 切换头部品牌,或新建 front/person.html。
7. **状态词字典全量接线**(status-text.js 已就绪,剩 proof/volunteer/help 相关约 6 页)
   与「义工/志愿者」术语全局统一(建议定「义工」)。

## 验收基线(P0-P2 后实测)

- 首页首访资源 ≈ 255KB(gzip 后 ≈ 90KB);二次访问图片/js/css 全部命中缓存
- 动物图片:2.8MB × N 每次重下 → 每 7 天一次
- 控制台零错误;favicon/品牌/状态词全站一致
- 后端 338/338 测试通过(FileController 缓存头断言已更新)
