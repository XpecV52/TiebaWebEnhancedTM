# 新版贴吧增强（油猴脚本）v1.2.7

针对 `https://tieba.baidu.com/`（新版深色界面）的优化，脚本：
[`tieba-new-enhance.user.js`](./tieba-new-enhance.user.js)

## 功能

| # | 需求 | 实现 |
| --- | --- | --- |
| 1 | 屏蔽左侧「我玩过的游戏」 | 按模块标题匹配 `.list-container-wrapper`，加 `display:none !important`；贴吧重渲染后会再次套用 |
| 2 | 屏蔽右上角游戏手柄图标 | 按图标 `<use xlink:href="#game_center_dark">` 匹配 `.right-menu .menu-item` 并隐藏 |
| 3 | 「我常逛的吧」「我关注的吧」默认全显示 | 自动反复点「展开全部」直到按钮消失 |
| 4 | 左侧列表双列 + 区域内滚动 | 常逛 2 列 6 条、关注 2 列 18 条（关注列表撑满视口剩余高度）；吧名完整不截断，「已签到」✓ 保留，关注列表显示等级徽章 |
| 5 | 点任意吧 → 最新 tab + 发布排序 | 改写链接 + 捕获阶段接管 click + 落地补 `tab=503`，见 `forceLatestTab()` |
| 6 | 左侧「首页/我的」下方新增「一键签到」 | 复制菜单项样式，图标用站点 sprite `#sign_icon`；点击后调用 `newmoindex` + `sign/add` |
| 7 | 左栏加宽 + 主内容铺满 | 左栏 320px；放开站点给主内容的限宽（首页 708 / 吧页 1059），信息流吃满，右栏贴右不留黑边 |

## 可调参数（脚本顶部 `CFG`）

```js
listLayouts: {                       // cols=列数 maxItems=最少露出条数 fill=撑满视口 showLevel=显示等级
  '我常逛的吧': { cols: 2, maxItems: 6 },
  '我关注的吧': { cols: 2, maxItems: 18, fill: true, showLevel: true }
},
leftColumnWidth: 320,                // 左栏宽度上限（站点原本 240；窄屏按视口自动收）
fillMainWidth: true,                 // 主内容铺满可用宽度，关掉就恢复站点限宽居中
gridNameFontSize: 13,                // 双列时吧名字号
latestTab: '503',                    // 最新 tab 的 id
autoSort: true,                      // 落地页自动切「发布」
debug: false                         // true 时控制台打印过程
```

## 安装 / 更新

1. Tampermonkey → 打开「新版贴吧增强」→ 全选旧代码，用本文件的全部内容替换 → Ctrl+S。
2. 刷新贴吧页面。
3. 版本号应为 `1.2.7`（脚本管理列表里可见）。

`@match` 仅 `tieba.baidu.com`，`@grant none`，不联网上传任何数据。

## 测试

```bash
node tests/layout.test.mjs     # 15 条断言：双列行数 / 高度 / fill / showLevel
```
