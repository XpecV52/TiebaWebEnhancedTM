// ==UserScript==
// @name         新版贴吧增强：屏蔽游戏模块 / 关注列表全展开 / 默认最新+发布时间 / 一键签到
// @namespace    https://github.com/XpecV52/TiebaWebEnhancedTM
// @version      1.1.0
// @description  1) 屏蔽左侧「我玩过的游戏」和右上角游戏手柄图标；2) 「我常逛的吧」「我关注的吧」自动加载全部并改成区域内滚动；3) 点任意吧默认进入「最新」tab，并自动把排序切成「发布」（按发布时间）；4) 左侧「首页/我的」下方新增「一键签到」按钮。
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
    listMaxHeight: 'min(56vh, 640px)', // 列表区域最大高度，超出后区域内滚动
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

    .tbx-scroll-list {
      max-height: ${CFG.listMaxHeight} !important;
      overflow-y: auto !important;
      overflow-x: hidden !important;
      overscroll-behavior: contain;
      scrollbar-width: thin;
      scrollbar-color: rgba(127,127,127,.5) transparent;
    }
    .tbx-scroll-list::-webkit-scrollbar { width: 8px; }
    .tbx-scroll-list::-webkit-scrollbar-track { background: transparent; }
    .tbx-scroll-list::-webkit-scrollbar-thumb { background: rgba(127,127,127,.45); border-radius: 4px; }
    .tbx-scroll-list::-webkit-scrollbar-thumb:hover { background: rgba(127,127,127,.65); }

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

  /* ---------------------------------------- 2) 关注列表全展开 + 区域滚动 */

  const expanding = new WeakSet();
  const expandAttempts = new WeakMap();
  let expandBudgetLeft = CFG.expandBudget;

  function applyListScroll(wrap) {
    const list = wrap.querySelector('.list-wrapper');
    if (!list) return;
    if (!list.classList.contains('tbx-scroll-list')) list.classList.add('tbx-scroll-list');
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
      applyListScroll(wrap);
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
      applyListScroll(wrap);
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

  function scan() {
    hideGameModules();
    hideGameToolbarIcon();

    for (const wrap of $$('.list-container-wrapper')) {
      const title = wrapperTitle(wrap);
      if (!CFG.expandTitles.includes(title)) continue;
      applyListScroll(wrap);
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
  window.addEventListener('resize', scheduleScan);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) scheduleScan(); });

  const mo = new MutationObserver(scheduleScan);
  mo.observe(document.documentElement, { childList: true, subtree: true });

  // 兜底轮询：懒加载/二次渲染时不依赖 MutationObserver 的完整性
  setInterval(scheduleScan, 1500);

  forceLatestTab();
  setTimeout(scan, 300);
  window.addEventListener('load', scheduleScan);
})();
