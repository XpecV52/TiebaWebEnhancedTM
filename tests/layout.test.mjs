/* 布局算法验证：从真实脚本里抠出「双列 + 可见条数」那段函数，喂一个模拟布局的假 DOM。
 * 只验证算术与控制流（可见行数、max-height、行距不翻倍），不验证像素渲染。
 * 跑：node tests/layout.test.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(here, '..', 'tieba-new-enhance.user.js'), 'utf8');

const start = src.indexOf('  function layoutFor(title)');
const end = src.indexOf('  async function expandList(');
if (start < 0 || end < 0) throw new Error('没找到布局函数块');
const block = src.slice(start, end);

const CARD_H = 34;      // 卡片高度
const MARGIN_B = 4;     // 站点给卡片的下边距
const PAD_BOTTOM = 0;   // list-wrapper 的 padding-bottom

function makeEl(cls) {
  const el = {
    className: cls || '',
    children: [],
    parentElement: null,
    dataset: {},
    style: {
      _v: {},
      setProperty(k, v) { this._v[k] = v; },
      getPropertyValue(k) { return this._v[k] || ''; },
    },
    classList: {
      _s: new Set(),
      add(...c) { c.forEach((x) => this._s.add(x)); },
      remove(...c) { c.forEach((x) => this._s.delete(x)); },
      contains(c) { return this._s.has(c); },
      toggle(c, on) {
        const want = on === undefined ? !this._s.has(c) : !!on;
        if (want) this._s.add(c); else this._s.delete(c);
        return want;
      },
    },
    querySelector(sel) {
      const walk = (n) => {
        for (const c of n.children) {
          if (sel === '.name-info-wrapper' && c.className === 'name-info-wrapper') return c;
          const r = walk(c);
          if (r) return r;
        }
        return null;
      };
      return walk(el);
    },
    querySelectorAll(sel) {
      const out = [];
      const walk = (n) => {
        for (const c of n.children) {
          if (sel === 'a.forum-card-wrapper' && c.className === 'forum-card-wrapper') out.push(c);
          walk(c);
        }
      };
      walk(el);
      return out;
    },
    appendChild(c) { c.parentElement = el; el.children.push(c); return c; },
  };
  return el;
}

// 让卡片按「当前是不是 grid」算出各自的 rect
function layoutCards(list, host, cards, cols, top) {
  const grid = host.classList.contains('tbx-grid-list');
  const rowGap = Number(host.dataset.tbxRowGap || 0);
  const listTop = top == null ? 100 : top;
  const colW = 90;
  cards.forEach((c, i) => {
    if (grid) {
      const r = Math.floor(i / cols);
      const col = i % cols;
      c._rect = {
        top: listTop + r * (CARD_H + MARGIN_B + rowGap),
        height: CARD_H,
        left: col * (colW + 6),
        width: colW,
      };
    } else {
      c._rect = { top: listTop + i * (CARD_H + MARGIN_B), height: CARD_H, left: 0, width: 200 };
    }
    c._rect.bottom = c._rect.top + CARD_H;
  });
  list._rect = { top: listTop, height: 600 };
}

function makeList(count) {
  const wrap = makeEl('');
  const list = makeEl('list-wrapper');
  const host = list; // 卡片直接挂在 .list-wrapper 下
  wrap.appendChild(list);
  for (let i = 0; i < count; i += 1) {
    const card = makeEl('forum-card-wrapper');
    // 模拟真实卡片：36x36 头像 + name-info-wrapper
    const av = makeEl('avatar');
    av._fixed = { width: 36, height: 36 };
    const name = makeEl('name-info-wrapper');
    name._fixed = { width: 120, height: 18 };
    card.appendChild(av);
    card.appendChild(name);
    host.appendChild(card);
  }

  const cards = host.querySelectorAll('a.forum-card-wrapper');
  cards.forEach((c) => {
    c.getBoundingClientRect = () => c._rect || { top: 0, bottom: 0, height: 0, left: 0, width: 0 };
    c.children.forEach((k) => {
      k.getBoundingClientRect = () => ({
        top: 0, left: 0, bottom: k._fixed.height, width: k._fixed.width, height: k._fixed.height
      });
    });
  });
  list.getBoundingClientRect = () => list._rect || { top: 0, bottom: 0, height: 0, left: 0, width: 0 };
  Object.defineProperty(list, 'scrollTop', { get: () => 0, set: () => {} });

  // wrap 的 querySelector 只要 .list-wrapper
  wrap.querySelector = (sel) => (sel === '.list-wrapper' ? list : null);
  wrap.querySelectorAll = () => [];
  return { wrap, list, host, cards, relayout: (top) => layoutCards(list, host, cards, 2, top) };
}

const sandbox = {
  CFG: {
    listLayouts: {
      '我常逛的吧': { cols: 2, maxItems: 6 },
      '我关注的吧': { cols: 2, maxItems: 18, fill: false, showLevel: true },
    },
    listMaxHeight: 'min(56vh, 640px)',
    gridAvatarRatio: 0.16,
    gridAvatarMin: 18,
    gridAvatarMax: 26,
    gridNameFontSize: 13,
    fillGap: 16,
  },
  window: { innerHeight: 900 },
  getComputedStyle: (el) => ({
    paddingBottom: el.className === 'list-wrapper' ? PAD_BOTTOM + 'px' : '0px',
    borderBottomWidth: '0px',
    marginTop: '0px',
    marginBottom: el.className === 'forum-card-wrapper' ? MARGIN_B + 'px' : '0px',
  }),
};

const factory = new Function(
  'CFG',
  'getComputedStyle',
  'window',
  block + '\n return { applyListLayout, fitListHeight, cardsHost, measureRowGap, fillAvail };'
);
const api = factory(sandbox.CFG, sandbox.getComputedStyle, sandbox.window);

let pass = 0;
let fail = 0;
function check(name, actual, expected) {
  const ok = actual === expected;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  实际=${actual} 期望=${expected}`);
  ok ? (pass += 1) : (fail += 1);
}

function run(title, count) {
  const { wrap, list, host, relayout } = makeList(count);
  relayout();                       // 原始竖向布局，先让 measureRowGap 能量到
  api.applyListLayout(wrap, title); // 第一次：套 grid + 算高度
  relayout();                       // grid 生效后的真实位置
  api.applyListLayout(wrap, title); // 第二次：按 grid 重算高度
  return { list, host, wrap };
}

// 1) 我常逛的吧：2 列 6 条 = 3 行
{
  const { list, host } = run('我常逛的吧', 20);
  const rows = 3;
  const expect = CARD_H * rows + MARGIN_B * (rows - 1) + PAD_BOTTOM + 1;
  check('常逛：套上双列 grid', host.classList.contains('tbx-grid-list'), true);
  check('常逛：不显示等级徽章', host.classList.contains('tbx-show-level'), false);
  check('常逛：行距不翻倍（margin 已被识别）', Number(host.dataset.tbxRowGap), 0);
  check('常逛：列数变量', host.style.getPropertyValue('--tbx-cols'), '2');
  check('常逛：max-height = 3 行', Number(list.dataset.tbxFitH), expect);
}

// 2) 我关注的吧：2 列 18 条 = 9 行
{
  const { list, host } = run('我关注的吧', 98);
  const rows = 9;
  const expect = CARD_H * rows + MARGIN_B * (rows - 1) + PAD_BOTTOM + 1;
  check('关注：套上双列 grid', host.classList.contains('tbx-grid-list'), true);
  check('关注：显示等级徽章（tbx-show-level）', host.classList.contains('tbx-show-level'), true);
  check('关注：max-height = 9 行', Number(list.dataset.tbxFitH), expect);
}

// 3) 条数不足时不产生滚动（高度 = 内容高）
{
  const { list } = run('我常逛的吧', 4);
  const rows = 2;
  check('常逛 4 条：高度只到第 2 行', Number(list.dataset.tbxFitH),
    CARD_H * rows + MARGIN_B * (rows - 1) + PAD_BOTTOM + 1);
}

// 4) 奇数条数（5 条 → 3 行，最后一行只有 1 个）
{
  const { list } = run('我常逛的吧', 5);
  const rows = 3;
  check('常逛 5 条：仍按 3 行算', Number(list.dataset.tbxFitH),
    CARD_H * rows + MARGIN_B * (rows - 1) + PAD_BOTTOM + 1);
}

// 5) 隐藏状态（抽屉没开）不写高度，避免 max-height:0
{
  const { wrap, list, host, cards } = makeList(20);
  cards.forEach((c) => { c._rect = { top: 0, bottom: 0, height: 0, left: 0, width: 0 }; });
  list._rect = { top: 0, height: 0 };
  api.applyListLayout(wrap, '我关注的吧');
  check('隐藏时不写 max-height', list.dataset.tbxFitH === undefined, true);
}

// 6) 未配置的列表退回固定高度类
{
  const { wrap, list, host } = makeList(3);
  host.classList._s.clear();
  api.applyListLayout(wrap, '我玩过的游戏');
  check('未配置列表加 tbx-scroll-auto', list.classList.contains('tbx-scroll-auto'), true);
  check('未配置列表不加 grid', host.classList.contains('tbx-grid-list'), false);
}

// 7) fill：撑满视口剩余高度（而不是固定 18 条就留白）
{
  sandbox.CFG.listLayouts['我关注的吧'].fill = true;
  const { wrap, list, host, relayout } = makeList(98);
  relayout();
  api.applyListLayout(wrap, '我关注的吧');
  relayout();
  api.applyListLayout(wrap, '我关注的吧');
  // 列表顶在 y=100，视口 900，底部留 16 → 784，比 9 行的 339 大，应取 784
  const expect = Math.max(339, 900 - 100 - 16);
  check('fill：撑到视口底部', Number(list.dataset.tbxFitH), expect);
  sandbox.CFG.listLayouts['我关注的吧'].fill = false;
}

// 8) fill 不会把高度算得比「最少条数」还小
{
  sandbox.CFG.listLayouts['我关注的吧'].fill = true;
  const { wrap, list, host, relayout } = makeList(98);
  relayout(860); // 列表贴着视口底部，剩余空间极小
  api.applyListLayout(wrap, '我关注的吧');
  relayout(860);
  api.applyListLayout(wrap, '我关注的吧');
  check('fill：空间不足时退回 9 行高度', Number(list.dataset.tbxFitH), 339);
  sandbox.CFG.listLayouts['我关注的吧'].fill = false;
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
