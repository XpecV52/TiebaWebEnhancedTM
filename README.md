# 新版贴吧增强（油猴脚本）v1.1.0

针对 `https://tieba.baidu.com/`（2025 新版深色界面）的优化，脚本：
[`tieba-new-enhance.user.js`](./tieba-new-enhance.user.js)

## 功能

| # | 需求 | 实现 |
| --- | --- | --- |
| 1 | 屏蔽左侧「我玩过的游戏」 | 按模块标题匹配 `.list-container-wrapper`，加 `display:none !important`；贴吧重渲染后会再次套用 |
| 2 | 屏蔽右上角游戏手柄图标 | 按图标 `<use xlink:href="#game_center_dark">` 匹配 `.right-menu .menu-item` 并隐藏 |
| 3 | 「我常逛的吧」「我关注的吧」默认全显示 | 自动反复点「展开全部」直到按钮消失（实测：关注 98 个、常逛 20 个） |
| 4 | 列表区域滚动，不撑满整页 | `.list-wrapper { max-height: min(56vh,640px); overflow-y:auto }` |
| 5 | 点任意吧 → 最新 tab + 发布排序 | 见下文「为什么第一版没生效」 |
| 6 | 左侧「首页/我的」下方新增「一键签到」 | 复制菜单项样式，图标用站点 sprite `#sign_icon`；点击后调用 `newmoindex` + `sign/add` |

## 为什么第一版「点吧还是热门」

第一版只改了 `.forum-card-wrapper`（左栏卡片）的 `href`，实测发现**信息流里的吧名/头像（`a.forum-main-link`、`a.avatar-with-fallback`）不是卡片**，点击由组件自己 `window.open(原地址)`，改 `href` 无效 —— 所以点进吧还是默认的「热门」。

现在三层兜底：

1. 页面上**所有** `a[href*="/f?kw="]` 都改写为 `&tab=503&ie=utf-8`（最新）；
2. `pointerdown` 捕获阶段再补一次改写；
3. **window 捕获阶段接管 click**：`preventDefault + stopImmediatePropagation`，自己 `window.open(改写后的 URL)`，绕开组件原来的打开逻辑。

再加一层落地兜底：如果进入的吧页 URL **没有 tab 参数**（站外链接/收藏夹/旧标签），脚本补上 `tab=503` 并 `location.replace`，10 秒内同一吧只跳一次，避免循环。

排序：点「发布」只是把 `page_pc` 请求里的 `sort_type` 从 `0`（回复）改成 `1`（发布时间），**不在 URL 里**，所以只能在页面里点。脚本在「最新」页（URL 带 `tab=503` 或 UI 高亮「最新」）自动点「发布」，并校验确实切过去。

## 一键签到

- 数据源与签到接口和之前的签到插件一致：
  - `GET /mo/q/newmoindex` → 关注列表（`like_forum[].is_sign`）+ `tbs`
  - `POST /sign/add`（`ie=utf-8&kw=吧名&tbs=...`）
  - 失败再补 `GET /dc/common/tbs`
- `is_sign === 1` 的吧直接跳过，不会重复请求；
- 逐个签，间隔 0.35–0.8 秒；按钮上显示 `签到中 3/12`，完成后显示「完成 ✓」并在底部弹提示；
- 连续失败 3 次判定为风控，立即停止并提示，不会一直撞；
- 已签过的吧会在名字后面补一个绿色 ✓（仅本次点按钮实际处理的）。
- 用的是页面自身的登录态（`fetch` + `credentials: include`），不额外申请权限。

## 安装 / 更新

1. Tampermonkey → 打开「新版贴吧增强」→ 全选旧代码，用本文件的全部内容替换 → Ctrl+S。
2. 刷新贴吧页面。
3. 版本号应为 `1.1.0`（脚本管理列表里可见）。

`@match` 仅 `tieba.baidu.com`，`@grant none`，不联网上传任何数据。

## 可调参数（脚本顶部 `CFG`）

```js
hideTitles: ['我玩过的游戏'],        // 还想屏蔽别的模块就加标题
hideGameIcon: true,                  // 右上角游戏手柄
expandTitles: ['我常逛的吧', '我关注的吧'],
listMaxHeight: 'min(56vh, 640px)',   // 列表区域高度
latestTab: '503',                    // 最新 tab 的 id
autoSort: true,                      // 落地页自动切「发布」
signGapMin / signGapMax: 350 / 800,  // 签到请求间隔（毫秒）
debug: false                         // true 时控制台打印过程
```

## 实测记录（CDP 真实页面）

- 左栏结构：`.list-container-wrapper > .list-title-wrapper/.list-wrapper/.list-load-more`；
- 「展开全部」一次只加载一页（关注 10 个、常逛 5 个），全部加载完按钮消失；
- 信息流吧名链接：`a.forum-main-link`（无 `.forum-card-wrapper`），组件自行 `window.open`；
- 事件日志确认：接管后 `window.open` 收到的 URL 为 `...&tab=503&ie=utf-8`，新标签页显示「最新 + 发布」；
- 签到接口现状：98 个吧 `is_sign` 全为 1，`sign/add` 对已签吧返回 `{"no":1101,"error":"亲，你之前已经签过了"}`，脚本判定为「已签到」。
