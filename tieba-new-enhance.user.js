// ==UserScript==
// @name         新版贴吧增强：屏蔽游戏模块 / 关注列表全展开 / 默认最新+发布时间 / 一键签到
// @namespace    https://github.com/XpecV52/TiebaWebEnhancedTM
// @version      1.2.7
// @description  1) 屏蔽左侧「我玩过的游戏」和右上角游戏手柄图标；2) 「我常逛的吧」「我关注的吧」自动加载全部，改成双列显示并限定可视条数（常逛 6 条 / 关注 18 条），超出后区域内滚动；3) 点任意吧默认进入「最新」tab，并自动把排序切成「发布」（按发布时间）；4) 左侧「首页/我的」下方新增「一键签到」按钮。
// @author       XpecV52
// @match        https://tieba.baidu.com/*
// @match        http://tieba.baidu.com/*
// @run-at       document-idle
// @grant        none
// @noframes
// @updateURL    https://raw.githubusercontent.com/XpecV52/TiebaWebEnhancedTM/main/tieba-new-enhance.user.js
// @downloadURL  https://raw.githubusercontent.com/XpecV52/TiebaWebEnhancedTM/main/tieba-new-enhance.user.js
// ==/UserScript==

(() => {
  'use strict';

  if (window.__tbxEnhancerLoaded) return;
  window.__tbxEnhancerLoaded = true;

  const CFG = {
    hideTitles: ['我玩过的游戏'], // 要屏蔽的左侧模块标题
    hideGameIcon: true, // 屏蔽右上角游戏手柄图标
    expandTitles: ['我常逛的吧', '我关注的吧'], // 要自动展开的列表
    expandText: '展开全部', // 展开按钮文案
    expandBudget: 150, // 整页最多点多少次「展开全部」，防止组件异常时死循环
    // 列表区域布局：cols = 列数；maxItems = 最少露出条数；
    // fill = 撑满视口剩余高度（只当下限用）；showLevel = 显示等级徽章；
    // fontSize = 该列表单独的字号（不给就用 gridNameFontSize）
    listLayouts: {
      '我常逛的吧': { cols: 2, maxItems: 6 },
      '我关注的吧': { cols: 2, maxItems: 18, fill: true, showLevel: true }
    },
    listMaxHeight: 'min(56vh, 640px)', // 上面没配置的列表，用这个高度兜底
    leftColumnWidth: 320, // 左栏宽度上限（站点原本 240px；窄屏按视口自动收）
    // 站点把主内容限死宽度再居中（首页 .center-content 708px / 吧页 .frs-page-container 1059px），
    // 宽屏下右侧会空出一大条。true = 放开上限，让信息流往右吃满，右栏只留站点自己的 padding
    fillMainWidth: true,
    gridAvatarRatio: 0.16, // 头像宽 = 列宽 × 该比例，再夹在 [min,max]
    gridAvatarMin: 18,
    gridAvatarMax: 26,
    gridNameFontSize: 13, // 双列时吧名字号（listLayouts 里没写 fontSize 的列表用这个）
    fillGap: 16, // 撑满高度时，列表底部离视口底部留多少
    latestTab: '503', // 「最新」tab 的 tab 参数
    autoSort: true, // 进入「最新」后自动切到「发布」排序
    sortLabel: '发布',
    signGapMin: 350, // 一键签到：两次请求的最小间隔
    signGapMax: 800,
    debug: false
  };

  const API = {
    index: 'https://tieba.baidu.com/mo/q/newmoindex',
    tbs: 'https://tieba.baidu.com/dc/common/tbs',
    sign: 'https://tieba.baidu.com/sign/add'
  };

  const log = (...args) => CFG.debug && console.log('[贴吧增强]', ...args);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const text = (el) => (el && el.textContent ? el.textContent : '').replace(/\s+/g, '').trim();

  /* ------------------------------------------------------------------ 样式 */

  const style = document.createElement('style');
  style.textContent = `
    .tbx-hidden-module { display: none !important; }
    .tbx-hidden-item { display: none !important; }

    /* 左栏加宽：站点把 .left-content 写死 240px（padding-left 20），两列根本放不下吧名 */
    .left-content {
      width: var(--tbx-left-w, 240px) !important;
      flex: 0 0 var(--tbx-left-w, 240px) !important;
      max-width: none !important;
    }
    /* 折叠态站点硬编码 left:-244px（= 240 + 4），加宽后要同步，否则收起时露出半截 */
    .left-content.is-collapsed {
      left: calc(-1 * var(--tbx-left-w, 240px) - 4px) !important;
    }
    /* 悬停展开是 .is-collapsed.is-hovered{left:0}，别被上面的 !important 压住 */
    .left-content.is-collapsed.is-hovered { left: 0 !important; }

    /* 连带：站点把主内容区写成 .main-content{width:calc(100% - 260px)}，
       260 = 左栏 240 + padding 20。左栏变宽后不同步就会整行溢出，右侧多一条空白。
       常态宽度由 JS 按实测左栏宽度写 inline（见 applyLeftWidth），这里只管折叠展开态。 */
    .content-container .main-content.is-expanded {
      margin-left: calc(-1 * var(--tbx-left-w, 240px) - 4px) !important;
    }
    /* 折叠按钮贴着左栏右边缘：站点写死 left:248px（= 240 + 8） */
    .content-container .collapse-btn { left: calc(var(--tbx-left-w, 240px) + 8px) !important; }
    .content-container .collapse-btn.is-collapsed { left: 4px !important; }
    .content-container .collapse-btn.is-hovered { left: calc(var(--tbx-left-w, 240px) + 4px) !important; }
    /* 关键：站点在左栏里有两处写死 224px，不放开的话左栏变宽只会多出空白
       —— .list-container-wrapper-nav（吧列表）和 .left-nav-wrapper .main（顶部导航） */
    .left-content .list-container-wrapper,
    .left-content .list-container-wrapper.list-container-wrapper-nav {
      width: 100% !important;
      max-width: 100% !important;
      box-sizing: border-box !important;
    }
    .left-content .left-nav-wrapper,
    .left-content .left-nav-wrapper .main {
      width: 100% !important;
      max-width: 100% !important;
      box-sizing: border-box !important;
    }
    /* 顶部导航条目站点是 padding:10px 16px，而双列卡片横向只有 8px，
       两边缩进差 8px 看着就"上部比例不对" —— 统一成 8px */
    .left-content .left-nav-wrapper .main .menu-item {
      padding-left: 8px !important;
      padding-right: 8px !important;
    }

    /* 主内容区铺满（CFG.fillMainWidth）：
       首页 .container 是 justify-content:center 且 .center-content 限死 max-width:708px，
       吧页 .frs-page-container 限死 max-width:1059px —— 宽屏下整组内容居中，
       右侧就空出一大条。三件事一起做：
       ① 放开限宽；② 信息流 flex 撑满中间；③ 右栏不再收缩、被顶到最右。 */
    html.tbx-fill-main .main-content .home-page-wrapper > .container {
      justify-content: space-between !important;
    }
    html.tbx-fill-main .main-content .center-content,
    html.tbx-fill-main .main-content .frs-page-container {
      max-width: none !important;
    }
    /* 信息流往右平铺：吃掉中间所有富余 */
    html.tbx-fill-main .main-content .center-content,
    html.tbx-fill-main .main-content .frs-main-container > .left-container {
      flex: 1 1 auto !important;
      min-width: 0 !important;
    }
    /* 右栏贴右：信息流吃掉中间的富余，右栏自然被顶到右边，只剩站点自己的 padding。
       这里不能用 margin-left:auto —— flex-grow 会先把富余吃干净，auto 边距变 0，
       右栏反而会贴死信息流；保留站点原本的 36px 间距更稳。 */
    html.tbx-fill-main .main-content .right-nav-bar,
    html.tbx-fill-main .main-content .frs-right-sidebar {
      flex: 0 0 auto !important;
    }

    /* 区域滚动：高度由 JS 按「可见条数」算出后写成 inline max-height；
       这里不再写死 max-height，否则 !important 会盖掉 inline 值 */
    .tbx-scroll-list {
      overflow-y: auto !important;
      overflow-x: hidden !important;
      overscroll-behavior: contain;
      scrollbar-width: thin;
      scrollbar-color: rgba(127,127,127,.5) transparent;
    }
    /* 没在 listLayouts 里配置的列表，退回固定高度 */
    .tbx-scroll-list.tbx-scroll-auto { max-height: ${CFG.listMaxHeight} !important; }

    .tbx-scroll-list::-webkit-scrollbar { width: 8px; }
    .tbx-scroll-list::-webkit-scrollbar-track { background: transparent; }
    .tbx-scroll-list::-webkit-scrollbar-thumb { background: rgba(127,127,127,.45); border-radius: 4px; }
    .tbx-scroll-list::-webkit-scrollbar-thumb:hover { background: rgba(127,127,127,.65); }

    /* 双列（列数由 --tbx-cols 控制，行距由 --tbx-row-gap 沿用站点原来的间距） */
    .tbx-grid-list {
      display: grid !important;
      grid-template-columns: repeat(var(--tbx-cols, 2), minmax(0, 1fr)) !important;
      column-gap: 4px !important;
      row-gap: var(--tbx-row-gap, 2px) !important;
      align-content: start !important;
      justify-items: stretch !important;
      list-style: none !important;
    }
    .tbx-grid-list > * { min-width: 0 !important; box-sizing: border-box; }

    /* 卡片：站点 padding 是 10px 16px，半宽后 32px 横向内边距直接把吧名挤没 */
    .tbx-grid-list a.forum-card-wrapper {
      width: auto !important;
      max-width: 100% !important;
      padding: 8px 8px !important;
      min-height: 32px !important;
    }

    /* 头像：div.avatar-wrapper 上是内联 width/height，img 是 100%，缩 wrapper 即可 */
    .tbx-grid-list .avatar-wrapper {
      width: var(--tbx-av, 24px) !important;
      height: var(--tbx-av, 24px) !important;
      flex: 0 0 var(--tbx-av, 24px) !important;
    }
    .tbx-grid-list .avatar-wrapper .forum-avatar {
      width: 100% !important;
      height: 100% !important;
    }
    /* 另一种卡片变体（如「大家都在逛的吧」）没有 .avatar-wrapper，
       头像 div 本身就是 .forum-avatar 且内联 width/height=32px，得直接盖 */
    .tbx-grid-list .forum-avatar {
      width: var(--tbx-av, 24px) !important;
      height: var(--tbx-av, 24px) !important;
      flex: 0 0 auto !important;
    }

    /* 名字链路上的每一层 flex 容器都要放开 min-width，否则缩不下去、永远只显示 1-2 个字 */
    .tbx-grid-list .forum-info-wrapper {
      flex: 1 1 auto !important;
      min-width: 0 !important;
      overflow: hidden !important;
    }
    .tbx-grid-list .name-info-wrapper {
      justify-content: flex-start !important;
      min-width: 0 !important;
    }
    .tbx-grid-list .name-info {
      min-width: 0 !important;
      overflow: hidden !important;
    }
    .tbx-grid-list .forum-name {
      min-width: 0 !important;
      overflow: hidden !important;
      text-overflow: ellipsis !important;
      white-space: nowrap !important;
      font-size: var(--tbx-fs, 13px) !important;
    }
    /* 后缀 .forum-suffix 里混着三样东西：文本「吧」、.level-icon / .earth-icon、.sign-icon（已签到 ✓）。
       半宽下「吧」和等级徽章都挤地方，但 ✓ 是有用信息，必须留 —— 用 font-size:0 只干掉文字，
       图标是 svg（靠 width/height 撑），不受字号影响。 */
    .tbx-grid-list .forum-suffix {
      display: inline-flex !important;
      align-items: center !important;
      flex: 0 0 auto !important;
      font-size: 0 !important;
    }
    .tbx-grid-list .forum-suffix .level-icon,
    .tbx-grid-list .forum-suffix .earth-icon,
    .tbx-grid-list .right-level-icon { display: none !important; }
    .tbx-grid-list .forum-suffix .sign-icon {
      display: inline-block !important;
      width: var(--tbx-sign, 13px) !important;
      height: var(--tbx-sign, 13px) !important;
      margin-left: 2px !important;
      flex: 0 0 auto !important;
    }
    .tbx-grid-list .forum-time { display: none !important; }

    /* listLayouts[x].showLevel = true 的列表：把等级徽章放出来。
       站点有两个位置放等级 —— 卡片右侧的 .right-level-icon，和后缀里的 .level-icon，两处都恢复，
       哪个存在显示哪个；尺寸沿用站点的 17×15。 */
    .tbx-grid-list.tbx-show-level .right-level-icon,
    .tbx-grid-list.tbx-show-level .forum-suffix .level-icon {
      display: inline-block !important;
      width: 17px !important;
      height: 15px !important;
      margin-left: 3px !important;
      flex: 0 0 auto !important;
      vertical-align: middle !important;
    }
    /* 显示等级时后缀别被 font-size:0 连带压扁（图标本身靠宽高，这里只是保险） */
    .tbx-grid-list.tbx-show-level .forum-suffix { font-size: 0 !important; }

    .tbx-sign-btn { position: relative; user-select: none; }
    .tbx-sign-btn.tbx-busy { opacity: .7; pointer-events: none; }
    .tbx-sign-btn .tbx-sign-status {
      margin-left: auto; font-size: 12px; line-height: 1;
      color: rgba(255,255,255,.45); white-space: nowrap;
    }
    .tbx-sign-btn .tbx-sign-status.ok { color: #2ecc71; }
    .tbx-sign-btn .tbx-sign-status.err { color: #ff6b6b; }

    .tbx-signed-card .name-info-wrapper::after {
      content: '✓'; color: #2ecc71; font-size: 12px; margin-left: 4px;
    }

    #tbx-toast {
      position: fixed; left: 50%; bottom: 48px; transform: translateX(-50%) translateY(12px);
      max-width: 520px; padding: 10px 18px; border-radius: 10px;
      background: rgba(30,32,38,.96); color: #f2f3f5; font-size: 14px; line-height: 1.5;
      box-shadow: 0 8px 28px rgba(0,0,0,.45); border: 1px solid rgba(255,255,255,.1);
      opacity: 0; pointer-events: none; transition: opacity .18s, transform .18s; z-index: 2100000000;
    }
    #tbx-toast.show { opacity: 1; transform: translateX(-50%) translateY(0); }
  `;
  (document.head || document.documentElement).appendChild(style);

  // 主内容区铺满：站点限宽居中会让宽屏右侧空一条，挂个根类名让上面的 CSS 生效
  document.documentElement.classList.toggle('tbx-fill-main', !!CFG.fillMainWidth);

  /* -------------------------------------------------------------- 工具函数 */

  function wrapperTitle(wrap) {
    const t = wrap.querySelector('.list-title');
    return t ? text(t) : '';
  }

  function isVisible(el) {
    if (!el || !el.getBoundingClientRect) return false;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    const cs = getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden';
  }

  function waitUntil(fn, timeout) {
    return new Promise((resolve) => {
      const started = Date.now();
      const tick = () => {
        let ok = false;
        try { ok = !!fn(); } catch (e) { ok = false; }
        if (ok) return resolve(true);
        if (Date.now() - started >= timeout) return resolve(false);
        setTimeout(tick, 100);
      };
      tick();
    });
  }

  function toast(msg) {
    let el = document.getElementById('tbx-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'tbx-toast';
      (document.body || document.documentElement).appendChild(el);
    }
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(el.__tbxTimer);
    el.__tbxTimer = setTimeout(() => el.classList.remove('show'), 4200);
  }

  /* ------------------------------------- 1) 屏蔽游戏模块 / 右上角游戏图标 */

  function hideGameModules() {
    for (const wrap of $$('.list-container-wrapper')) {
      if (!CFG.hideTitles.includes(wrapperTitle(wrap))) continue;
      if (!wrap.classList.contains('tbx-hidden-module')) {
        wrap.classList.add('tbx-hidden-module');
        wrap.setAttribute('aria-hidden', 'true');
      }
    }
  }

  function hideGameToolbarIcon() {
    if (!CFG.hideGameIcon) return;
    for (const item of $$('.right-menu .menu-item')) {
      const use = item.querySelector('use');
      if (!use) continue;
      const href = use.getAttribute('xlink:href') || use.getAttribute('href') || '';
      if (!/game_center/.test(href)) continue;
      item.classList.add('tbx-hidden-item');
      item.setAttribute('aria-hidden', 'true');
    }
  }

  /* ---------------------------------------- 2) 关注列表全展开 + 双列 + 区域滚动 */

  const expanding = new WeakSet();
  const expandAttempts = new WeakMap();
  let expandBudgetLeft = CFG.expandBudget;

  function layoutFor(title) {
    const c = CFG.listLayouts[title];
    if (!c) return null;
    return {
      cols: Math.max(1, parseInt(c.cols, 10) || 1),
      maxItems: Math.max(1, parseInt(c.maxItems, 10) || 1),
      fill: !!c.fill,
      showLevel: !!c.showLevel,
      fontSize: Number(c.fontSize) > 0 ? Number(c.fontSize) : 0
    };
  }

  // 卡片的直接父节点（可能是 .list-wrapper 本身，也可能是里面的 ul），网格要套在它身上
  function cardsHost(list) {
    const cards = list.querySelectorAll('a.forum-card-wrapper');
    if (!cards.length) return list;
    const parent = cards[0].parentElement;
    if (!parent) return list;
    for (const c of cards) if (c.parentElement !== parent) return list;
    return parent;
  }

  // 站点原本的卡片垂直间距；第一次改成 grid 之前量，之后沿用
  function measureRowGap(host) {
    const cached = host.dataset.tbxRowGap;
    if (cached != null) return Number(cached) || 0;

    const cards = host.querySelectorAll('a.forum-card-wrapper');
    if (cards.length < 2) return 0;
    const a = cards[0].getBoundingClientRect();
    const b = cards[1].getBoundingClientRect();
    const pitch = b.top - a.top;
    if (!(pitch > 0) || !(a.height > 0)) return 0; // 还没渲染出来（抽屉没开），下次再量

    // 卡片自带 margin 的话间距已经存在，row-gap 只补「容器 gap」那部分，避免间距翻倍
    const cs = getComputedStyle(cards[0]);
    const mt = parseFloat(cs.marginTop) || 0;
    const mb = parseFloat(cs.marginBottom) || 0;
    const gap = Math.max(0, Math.min(Math.round(pitch - a.height - mt - mb), 24));
    host.dataset.tbxRowGap = String(gap);
    return gap;
  }

  // 撑满视口时的高度基准：只算一次并冻结，避免页面滚动时列表高度跟着抖
  function fillAvail(list) {
    const cached = list.dataset.tbxFill;
    if (cached != null) return Number(cached) || 0;
    const lr = list.getBoundingClientRect();
    if (lr.height <= 0) return 0;
    const avail = Math.round(window.innerHeight - lr.top - CFG.fillGap);
    if (avail <= 0) return 0; // 列表在视口下方，先别撑
    list.dataset.tbxFill = String(avail);
    return avail;
  }

  // 按「最少露出 maxItems 条」算高度；cfg.fill 时再撑到视口底部
  function fitListHeight(list, cfg) {
    const cards = list.querySelectorAll('a.forum-card-wrapper');
    if (!cards.length) return false;

    const lr = list.getBoundingClientRect();
    if (lr.height <= 0) return false; // 列表被隐藏（移动端抽屉），等打开后再量

    const rows = Math.ceil(cfg.maxItems / cfg.cols);
    const idx = Math.min(cards.length, rows * cfg.cols) - 1;
    const er = cards[idx].getBoundingClientRect();
    if (er.height <= 0) return false;

    const cs = getComputedStyle(list);
    const padBottom = parseFloat(cs.paddingBottom) || 0;
    const borderBottom = parseFloat(cs.borderBottomWidth) || 0;
    // 卡片底边换算成列表内容坐标（列表可能已经滚过一段）
    const contentBottom = er.bottom - lr.top + list.scrollTop;
    let h = Math.ceil(contentBottom + padBottom + borderBottom + 1);

    if (cfg.fill) h = Math.max(h, fillAvail(list));

    if (Math.abs((Number(list.dataset.tbxFitH) || 0) - h) <= 1) return true;
    list.dataset.tbxFitH = String(h);
    list.style.maxHeight = h + 'px';
    return true;
  }

  // 左栏宽度：站点多半在 .left-content 上写 inline width，直接 !important 覆盖；
  // 若父容器是 grid，还要把第一列轨道一起改掉
  function applyLeftWidth() {
    // 只在有这两个列表的页面（首页）加宽，吧页 / 其它页不动布局
    if (!document.querySelector('.list-container-wrapper')) return;
    const left = document.querySelector('.left-content');
    if (!left) return;

    const want = Math.max(260, Math.min(CFG.leftColumnWidth, Math.round(window.innerWidth * 0.24)));
    // 写在 :root 上，折叠按钮 / .main-content.is-expanded 那些兄弟节点才继承得到
    const root = document.documentElement;
    const wVar = want + 'px';
    if (root.style.getPropertyValue('--tbx-left-w') !== wVar) root.style.setProperty('--tbx-left-w', wVar);

    // 父容器是 grid 的话，光改 .left-content 没用，第一列轨道也得跟着改
    const parent = left.parentElement;
    if (parent) {
      const cs = getComputedStyle(parent);
      if (/grid/.test(cs.display)) {
        const tracks = (cs.gridTemplateColumns || '').trim().split(/\s+/);
        if (tracks.length >= 2 && Math.abs(parseFloat(tracks[0]) - want) > 1) {
          tracks[0] = wVar;
          parent.style.setProperty('grid-template-columns', tracks.join(' '), 'important');
        }
      }
    }

    // 关键：站点写死 .main-content{width:calc(100% - 260px)}，260 = 左栏 240 + padding 20。
    // 左栏变宽后不同步，整行就会溢出，右侧多出一条空白（用户截图里的红框）。
    // 直接量渲染后的宽度，避免 box-sizing 差异算错。
    const main = document.querySelector('.main-content');
    if (!main) return;
    if (main.classList.contains('is-expanded')) {
      // 折叠展开态由 CSS 的 calc(var(--tbx-left-w)) 接管，别用 inline 压住
      if (main.style.getPropertyValue('width')) main.style.removeProperty('width');
      return;
    }
    const total = Math.round(left.getBoundingClientRect().width);
    if (!total) return;
    const w = 'calc(100% - ' + total + 'px)';
    if (main.style.getPropertyValue('width') !== w) main.style.setProperty('width', w, 'important');
  }

  // 头像尺寸 / 字号跟着列宽走：列宽够就放大，不够就收，别写死
  function applyAdaptiveMetrics(host, cfg) {
    const hostW = host.clientWidth || 0;
    if (!hostW) return;
    const colGap = 4;
    const colW = Math.floor((hostW - colGap * (cfg.cols - 1)) / cfg.cols);
    if (colW <= 0) return;

    const av = Math.max(CFG.gridAvatarMin, Math.min(CFG.gridAvatarMax, Math.round(colW * CFG.gridAvatarRatio)));
    const avVar = av + 'px';
    if (host.style.getPropertyValue('--tbx-av') !== avVar) host.style.setProperty('--tbx-av', avVar);

    // 「已签到」✓ 跟着头像一起收，别比头像还显眼
    const signVar = Math.max(10, Math.round(av * 0.55)) + 'px';
    if (host.style.getPropertyValue('--tbx-sign') !== signVar) host.style.setProperty('--tbx-sign', signVar);

    // 字号：列表可以单独指定（CFG.listLayouts[标题].fontSize），没给就用全局默认
    const fsPx = Number(cfg.fontSize) > 0 ? Number(cfg.fontSize) : CFG.gridNameFontSize;
    const fsVar = fsPx + 'px';
    if (host.style.getPropertyValue('--tbx-fs') !== fsVar) host.style.setProperty('--tbx-fs', fsVar);
  }

  function applyListLayout(wrap, title) {
    const list = wrap.querySelector('.list-wrapper');
    if (!list) return;

    const cfg = layoutFor(title);
    if (!cfg) {
      if (!list.classList.contains('tbx-scroll-list')) {
        list.classList.add('tbx-scroll-list', 'tbx-scroll-auto');
      }
      return;
    }

    if (!list.classList.contains('tbx-scroll-list')) list.classList.add('tbx-scroll-list');

    const host = cardsHost(list);
    const gap = measureRowGap(host);
    // 站点类名固定（.forum-name / .forum-suffix / .avatar-wrapper），样式直接命中，不用再猜
    if (!host.classList.contains('tbx-grid-list')) host.classList.add('tbx-grid-list');
    // 该列表要不要显示等级徽章（listLayouts[x].showLevel）
    host.classList.toggle('tbx-show-level', !!cfg.showLevel);

    const colsVar = String(cfg.cols);
    if (host.style.getPropertyValue('--tbx-cols') !== colsVar) {
      host.style.setProperty('--tbx-cols', colsVar);
    }
    const gapVar = gap + 'px';
    if (host.style.getPropertyValue('--tbx-row-gap') !== gapVar) {
      host.style.setProperty('--tbx-row-gap', gapVar);
    }
    applyAdaptiveMetrics(host, cfg);
    fitListHeight(list, cfg);
  }

  async function expandList(wrap, title) {
    if (expanding.has(wrap)) return;
    if (expandBudgetLeft <= 0) {
      wrap.dataset.tbxExpanded = '1';
      return;
    }
    expanding.add(wrap);

    const tries = (expandAttempts.get(wrap) || 0) + 1;
    expandAttempts.set(wrap, tries);

    try {
      applyListLayout(wrap, title);
      const count = () => wrap.querySelectorAll('a.forum-card-wrapper').length;

      for (let i = 0; i < 60 && expandBudgetLeft > 0; i += 1) {
        const btn = wrap.querySelector('.list-load-more');
        // 按钮消失 = 没有更多了；文案变了也停手（避免点到「收起」）
        if (!btn || !text(btn).includes(CFG.expandText)) break;

        const before = count();
        expandBudgetLeft -= 1;
        btn.click();

        const changed = await waitUntil(
          () => count() > before || !wrap.querySelector('.list-load-more'),
          2500
        );
        if (!changed) break; // 点了没反应/没更多，别死循环
      }

      log('列表已展开：', title, count(), '项');
    } finally {
      applyListLayout(wrap, title);
      expanding.delete(wrap);
    }

    // 只有真正没有「展开全部」了才算完成；没进展的话允许后面再试，最多 3 次
    const btn = wrap.querySelector('.list-load-more');
    const stillExpandable = !!(btn && text(btn).includes(CFG.expandText));
    if (!stillExpandable || tries >= 3) wrap.dataset.tbxExpanded = '1';
  }

  /* ------------------------------------- 3) 任意吧链接 → 最新 tab + 发布 */

  const TAB_RE = new RegExp('[?&]tab=' + CFG.latestTab + '([&#]|$)');
  const IE_RE = /[?&]ie=utf-8([&#]|$)/;

  function forumUrl(href) {
    let url;
    try {
      url = new URL(href, location.origin);
    } catch (e) {
      return null;
    }
    if (!/(^|\.)tieba\.baidu\.com$/i.test(url.hostname)) return null;
    if (url.pathname !== '/f') return null;
    if (!url.searchParams.get('kw')) return null;
    return url;
  }

  function rewriteAnchor(a) {
    const raw = a.getAttribute('href');
    if (!raw) return;
    if (TAB_RE.test(raw) && IE_RE.test(raw)) return;
    const url = forumUrl(raw);
    if (!url) return;
    url.searchParams.set('tab', CFG.latestTab);
    url.searchParams.set('ie', 'utf-8');
    a.setAttribute('href', url.toString());
    a.setAttribute('data-tbx-latest', '1');
  }

  // 页面上所有指向「某个吧」的链接都改：左侧卡片、信息流里的吧名、头像、搜索结果……
  function rewriteForumLinks() {
    for (const a of $$('a[href*="/f?kw="]')) rewriteAnchor(a);
  }

  // 兜底：从站外/收藏夹进来、链接没被改写的，落地页直接补上 tab=503
  function forceLatestTab() {
    if (location.pathname !== '/f') return;
    let sp;
    try {
      sp = new URLSearchParams(location.search);
    } catch (e) {
      return;
    }
    const kw = sp.get('kw');
    if (!kw) return;
    const tab = sp.get('tab');
    if (tab) return; // 用户明确选了 tab（热门/精华/分类），不要抢

    const key = 'tbxRedir:' + kw;
    const last = Number(sessionStorage.getItem(key) || 0);
    if (Date.now() - last < 10000) return; // 防循环
    try { sessionStorage.setItem(key, String(Date.now())); } catch (e) { /* 忽略 */ }

    sp.set('tab', CFG.latestTab);
    sp.set('ie', 'utf-8');
    location.replace('/f?' + sp.toString());
  }

  /* --------------------------- 4) 「最新」下自动排序为「发布」 */

  let sorting = false;
  let sortedKey = '';

  function activeTabText() {
    const a = $$('a.tab-item.active')[0];
    return a ? text(a) : '';
  }

  function isForumPage() {
    return location.pathname === '/f' && !!new URLSearchParams(location.search).get('kw');
  }

  async function ensureSortByCreate() {
    if (!CFG.autoSort || !isForumPage()) return;
    const key = location.pathname + location.search;
    if (sortedKey === key || sorting) return;

    // 只在「最新」页里排序：URL 带 tab=503，或 UI 上高亮的就是「最新」
    const tab = new URLSearchParams(location.search).get('tab');
    if (tab !== CFG.latestTab && activeTabText() !== '最新') return;

    sorting = true;
    try {
      const deadline = Date.now() + 8000;
      let clicks = 0;
      let lastClick = 0;
      while (Date.now() < deadline) {
        const items = $$('.thread-sort .menu-item');
        const publish = items.find((m) => text(m) === CFG.sortLabel);
        if (publish) {
          if (publish.classList.contains('active')) {
            sortedKey = key;
            log('已按「发布」排序');
            return;
          }
          if (clicks < 3 && Date.now() - lastClick > 700) {
            publish.click();
            clicks += 1;
            lastClick = Date.now();
            log('切换排序：', CFG.sortLabel, clicks);
          }
        }
        await sleep(300);
      }
    } finally {
      sorting = false;
    }
  }

  /* ------------------------------------------------------ 5) 一键签到 */

  let signing = false;

  async function fetchJson(url, options, timeout) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout || 12000);
    try {
      const res = await fetch(url, Object.assign({
        credentials: 'include',
        cache: 'no-store',
        headers: { 'X-Requested-With': 'XMLHttpRequest' }
      }, options || {}, { signal: ctrl.signal }));
      const txt = await res.text();
      try {
        return JSON.parse(txt);
      } catch (e) {
        return null; // 风控页/登录页
      }
    } finally {
      clearTimeout(timer);
    }
  }

  function classifySign(json) {
    if (!json || typeof json !== 'object') return { status: 'fail', msg: '响应不是 JSON' };
    if (json.user_info) return { status: 'ok', msg: '' };
    const code = String(json.error_code == null ? '' : json.error_code);
    const data = json.data && typeof json.data === 'object' ? json.data : {};
    const errno = Number(data.errno || 0) || 0;
    const no = Number(json.no);
    const msg = String(json.error || data.errmsg || json.error_msg || '');
    if (code === '160002') return { status: 'already', msg: '已签到' };
    if (errno === 1101 || no === 1101) return { status: 'already', msg: '已签到' };
    if (/已经签|已签到|签过/.test(msg)) return { status: 'already', msg: '已签到' };
    if (no === 0) return { status: 'ok', msg: '' };
    return { status: 'fail', msg: msg || ('错误码 ' + (no || code || '未知')) };
  }

  async function signOne(name, tbs) {
    const body = new URLSearchParams({ ie: 'utf-8', kw: name, tbs });
    try {
      const json = await fetchJson(API.sign, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString()
      }, 8000);
      if (!json) return { status: 'fail', msg: '接口没有返回 JSON（可能被风控）' };
      return classifySign(json);
    } catch (e) {
      return { status: 'fail', msg: '请求失败：' + (e && e.message ? e.message : e) };
    }
  }

  async function fetchTbs() {
    try {
      const json = await fetchJson(API.tbs, { method: 'GET' }, 8000);
      if (json && json.tbs) return String(json.tbs);
    } catch (e) { /* 忽略 */ }
    return '';
  }

  function markSignedCard(name) {
    if (!name) return;
    for (const a of $$('a.forum-card-wrapper')) {
      const n = a.querySelector('.forum-name');
      if (n && text(n) === name) a.classList.add('tbx-signed-card');
    }
  }

  async function doSignAll(btn) {
    if (signing) return;
    signing = true;
    btn.classList.add('tbx-busy');
    const label = btn.querySelector('.tbx-sign-label') || btn;
    const status = btn.querySelector('.tbx-sign-status');
    const setStatus = (s, cls) => {
      if (!status) return;
      status.textContent = s || '';
      status.className = 'tbx-sign-status' + (cls ? ' ' + cls : '');
    };

    try {
      const index = await fetchJson(API.index, { method: 'GET' }, 12000);
      const data = (index && index.data) || {};
      const list = Array.isArray(data.like_forum) ? data.like_forum : [];
      if (!list.length) {
        toast('没取到关注的吧，请确认已登录百度贴吧');
        setStatus('未登录', 'err');
        return;
      }

      const names = [];
      const seen = new Set();
      list.forEach((f) => {
        const name = String(f.forum_name || '').trim();
        if (!name || seen.has(name)) return;
        seen.add(name);
        if (Number(f.is_sign) === 1) return;
        names.push(name);
      });

      if (!names.length) {
        toast('关注的吧今天都已经签到过了 ✓');
        setStatus('已全部签到', 'ok');
        return;
      }

      let tbs = typeof data.tbs === 'string' ? data.tbs : '';
      if (!tbs) tbs = await fetchTbs();
      if (!tbs) {
        toast('没取到 tbs，请重新登录贴吧后再试');
        setStatus('缺少 tbs', 'err');
        return;
      }

      let ok = 0;
      let already = 0;
      let fail = 0;
      let consecutiveFail = 0;

      for (let i = 0; i < names.length; i += 1) {
        const name = names[i];
        label.textContent = '签到中 ' + (i + 1) + '/' + names.length;
        setStatus((i + 1) + '/' + names.length);

        const r = await signOne(name, tbs);
        if (r.status === 'ok') {
          ok += 1;
          consecutiveFail = 0;
          markSignedCard(name);
        } else if (r.status === 'already') {
          already += 1;
          consecutiveFail = 0;
          markSignedCard(name);
        } else {
          fail += 1;
          consecutiveFail += 1;
          log('签到失败：', name, r.msg);
        }

        if (consecutiveFail >= 3) {
          toast('连续失败 ' + consecutiveFail + ' 次，可能被风控，已停止（已完成 ' + (ok + already) + '/' + names.length + '）');
          setStatus('被风控', 'err');
          break;
        }

        if (i < names.length - 1) {
          await sleep(CFG.signGapMin + Math.random() * (CFG.signGapMax - CFG.signGapMin));
        }
      }

      const summary = '签到完成：新签 ' + ok + '，已签 ' + already + '，失败 ' + fail;
      toast(summary + (fail ? '（失败的可以稍后再点一次）' : ''));
      setStatus(fail ? '失败 ' + fail : '完成 ✓', fail ? 'err' : 'ok');
    } catch (e) {
      toast('签到出错：' + (e && e.message ? e.message : e));
      setStatus('出错', 'err');
    } finally {
      signing = false;
      btn.classList.remove('tbx-busy');
      setTimeout(() => {
        label.textContent = '一键签到';
        setStatus('');
      }, 6000);
    }
  }

  function ensureSignButton() {
    for (const nav of $$('.left-nav-wrapper')) {
      if (nav.dataset.tbxSignAdded) continue;
      const main = nav.querySelector('.main') || nav;
      const mine = $$('a.menu-item', main).find((a) => text(a) === '我的');
      const home = $$('a.menu-item', main).find((a) => text(a) === '首页');
      const proto = mine || home;
      if (!proto) continue;

      nav.dataset.tbxSignAdded = '1';

      const scopeAttrs = [...proto.attributes]
        .filter((a) => /^data-v-/.test(a.name))
        .map((a) => [a.name, a.value]);

      const btn = document.createElement('a');
      btn.className = 'menu-item tbx-sign-btn';
      btn.setAttribute('role', 'button');
      btn.tabIndex = 0;
      scopeAttrs.forEach(([n, v]) => btn.setAttribute(n, v));

      const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      icon.setAttribute('class', 'item-icon');
      icon.setAttribute('aria-hidden', 'true');
      scopeAttrs.forEach(([n, v]) => icon.setAttribute(n, v));
      const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
      use.setAttribute('href', '#sign_icon');
      use.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', '#sign_icon');
      icon.appendChild(use);

      const label = document.createElement('span');
      label.className = 'tbx-sign-label';
      label.textContent = '一键签到';
      scopeAttrs.forEach(([n, v]) => label.setAttribute(n, v));

      const status = document.createElement('span');
      status.className = 'tbx-sign-status';
      scopeAttrs.forEach(([n, v]) => status.setAttribute(n, v));

      btn.appendChild(icon);
      btn.appendChild(label);
      btn.appendChild(status);

      const run = (e) => {
        if (e) {
          e.preventDefault();
          e.stopPropagation();
        }
        doSignAll(btn);
      };
      btn.addEventListener('click', run);
      btn.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') run(e);
      });

      const anchor = mine || home;
      if (anchor && anchor.parentElement === main) {
        anchor.insertAdjacentElement('afterend', btn);
      } else {
        main.appendChild(btn);
      }
    }
  }

  /* ------------------------------------------------------------ 主循环 */

  // 主内容区铺满的通用兜底：站点各页面用的类名不一样（首页 .center-content、吧页 .frs-page-container、
  // 帖子页又是另一套），但套路都一样 —— 某个容器限了 max-width 再居中，宽屏下右边就空一条。
  // 这里按「实测宽度」找：宽度占主内容区一半以上、且 max-width 比主内容区小，就是它在卡。
  function applyMainFill() {
    if (!CFG.fillMainWidth) return;
    const main = document.querySelector('.main-content');
    if (!main) return;
    const mainW = main.getBoundingClientRect().width;
    if (mainW < 640) return; // 窄屏本来就没富余，别动

    // 只看前三层，既够用又不至于每次 scan 遍历整棵树
    const level1 = Array.from(main.children);
    const level2 = [];
    for (const a of level1) level2.push(...a.children);
    const level3 = [];
    for (const b of level2) level3.push(...b.children);

    for (const el of level1.concat(level2, level3)) {
      if (el.dataset.tbxFilled === '1') continue;
      if (!el.children.length) continue;
      const cs = getComputedStyle(el);
      if (!/^(block|flex|grid)$/.test(cs.display)) continue;
      if (cs.position === 'absolute' || cs.position === 'fixed') continue;
      const rect = el.getBoundingClientRect();
      if (rect.height < 240) continue; // 卡片 / 头像 / 角标那类矮盒子不动
      const mw = parseFloat(cs.maxWidth);
      if (!isFinite(mw) || mw <= 0) continue;
      if (mw < 480 || mw >= mainW * 0.95) continue; // 卡不住主内容区的不算
      if (rect.width < 480) continue;

      el.dataset.tbxFilled = '1';
      el.style.setProperty('max-width', 'none', 'important');
      log('放开限宽', el.className, mw, '→ none');
    }
  }

  function scan() {
    hideGameModules();
    hideGameToolbarIcon();
    applyLeftWidth();
    applyMainFill();

    for (const wrap of $$('.list-container-wrapper')) {
      const title = wrapperTitle(wrap);
      if (!CFG.expandTitles.includes(title)) continue;
      applyListLayout(wrap, title);
      // 只展开看得见的那一份（桌面左栏 / 抽屉那份打开时才展开）
      if (isVisible(wrap) && !wrap.dataset.tbxExpanded) expandList(wrap, title);
    }

    rewriteForumLinks();
    ensureSignButton();
    ensureSortByCreate();
    forceLatestTab();
  }

  let scanTimer = null;
  function scheduleScan() {
    if (scanTimer) return;
    scanTimer = setTimeout(() => {
      scanTimer = null;
      scan();
    }, 120);
  }

  // 点击前的最后一道保险：即使组件刚把 href 改回原样，也能按「最新」打开
  document.addEventListener(
    'pointerdown',
    (e) => {
      const a = e.target && e.target.closest ? e.target.closest('a[href*="/f?kw="]') : null;
      if (a) rewriteAnchor(a);
    },
    true
  );

  // 贴吧有些吧链接（信息流里的吧名/头像）是组件自己 window.open 原地址的，
  // href 改了也没用。这里在 window 捕获阶段直接接管，保证落地的就是「最新」。
  window.addEventListener(
    'click',
    (e) => {
      if (e.defaultPrevented || e.button !== 0) return;
      const a = e.target && e.target.closest ? e.target.closest('a[href*="/f?kw="]') : null;
      if (!a) return;
      const url = forumUrl(a.getAttribute('href') || '');
      if (!url) return;
      url.searchParams.set('tab', CFG.latestTab);
      url.searchParams.set('ie', 'utf-8');
      e.preventDefault();
      e.stopImmediatePropagation();
      window.open(url.toString(), '_blank', 'noopener');
    },
    true
  );

  window.addEventListener('popstate', () => { sortedKey = ''; scheduleScan(); });
  window.addEventListener('hashchange', () => { sortedKey = ''; scheduleScan(); });
  // 视口变化时清掉「撑满高度」的冻结值，让下一次 scan 重算
  window.addEventListener('resize', () => {
    for (const el of $$('.tbx-scroll-list')) {
      delete el.dataset.tbxFill;
      delete el.dataset.tbxFitH;
    }
    scheduleScan();
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) scheduleScan(); });

  const mo = new MutationObserver(scheduleScan);
  mo.observe(document.documentElement, { childList: true, subtree: true });

  // 兜底轮询：懒加载/二次渲染时不依赖 MutationObserver 的完整性
  setInterval(scheduleScan, 1500);

  forceLatestTab();
  setTimeout(scan, 300);
  window.addEventListener('load', scheduleScan);
})();
