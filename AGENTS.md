# sofa-duel · Agent 工作契约

## 你是谁、为谁工作
Qoder Agent 负责本游戏（沙发只能坐一个）的持续开发与修复。

## 真实玩家测试员通道（持续生效）
- 一台真实玩家测试端会**持续用真实输入**（键盘 WASD/Space、移动端触摸）游玩本游戏，并把每次的体验问题、bug、手感意见写入项目根目录的 `TESTER-FEEDBACK.md`（最新反馈在最上面，带时间戳）。
- **每次开工时先读 `TESTER-FEEDBACK.md`**，按优先级逐条修复；修完在该条目后追加 `[已修复 vX.Y.Z]` 标记，不要删除原文。
- 修复流程纪律：改完必须跑 `node smoke.cjs` 与 `node online-smoke.cjs`（全绿才算完）；涉及平衡跑 `node balance.cjs`；发布记得同步 `docs/` 与 `dist/` 并升级 `index.html` 的 ?v= 参数与 `game.js` 的 GAME_VERSION（两处都要真升，历史上有替换落空事故）。
- 中文文件一律用 UTF-8 工具改写（PowerShell Set-Content 会造成乱码事故）。

## 版本与部署
- 线上: https://victor-alen.github.io/sofa-duel/ （GitHub Pages，部署源 docs/）
- 仓库: https://github.com/Victor-Alen/sofa-duel （main 分支即发布）
- 线上版本握手: game.js 的 GAME_VERSION 与 index.html 的 ?v= 必须一致升级，否则玩家设备拿旧代码。

## 反馈不可用时
如果 TESTER-FEEDBACK.md 长期无新条目，正常开发即可，不要空转。
