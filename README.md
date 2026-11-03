# 新版贴吧增强（油猴脚本）v1.1.0

针对 `https://tieba.baidu.com/`（新版深色界面）的优化，脚本：
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

