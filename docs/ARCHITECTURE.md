# 架构（交易训练室 / 逐K复盘室）

> 定位：**本地优先的K线逐K复盘与模拟训练工作台**。不是实盘终端——实时精度让位于「随时可用、可复盘、可对账」。

## 分层

```
UI 编排        src/App.tsx            事件编排、状态组合（⚠️ 1642 行，P2 拆分目标）
UI 组件        src/components/*       图表(ChartCanvas)、下单票据(TradeTicket)、面板/对话框
样式           src/styles.css         语义化颜色令牌（亮/暗两套：--bg-*/--tv-*）

领域层         src/domain/*           ★ 纯函数、可单测、不依赖 UI
  └ dataset.ts                       数据集意图 / 游标落地 / 回放区间有效性

模拟引擎       src/model.ts           账户、保证金、强平价、成交、结算
               src/orders.ts          逐bar撮合、挂单、止盈止损、强平
               src/session.ts         复盘会话生命周期与统计
               src/archive.ts         训练档案（持久化、分组、CSV）
               src/history.ts         训练画像与统计口径

数据层         src/feed.ts            Binance/Frankfurter 取数、分页、多线路降级
               src/historyCache.ts    深历史合并规则（本地优先的依据）
               src/universe.ts        品种/分类/市场类型推断
               src/uniSpot.ts         内置清单快照（离线也能列出全部品种）
               src/uniFutures.ts

壳（macOS）    mac/ZhukReplay/*.swift 本地 HTTP 服务、取数代理与多线路、缓存落盘、Python 服务
工具           scripts/prefetch_history.py   全量历史预抓取（可断点续跑）
               scripts/gen_universe.py        生成品种清单快照
               scripts/check.mjs              静态质量门
               scripts/ci.sh                  类型 → 单测 → 质量门
```

## 数据流

```
启动 → 存档恢复 → 读本地历史(cache-first) → 立刻开图 → 后台增量补齐(静默) → 合并落盘
                                              ↓
                                     逐K回放 / 模拟交易（引擎）
                                              ↓
                                   复盘会话结束 → 训练档案 → 统计画像
```

## 不变量（本项目历史上最容易出错的地方，全部有测试固定）

1. **数据集意图**：只有「用户主动换品种/周期/市场」才允许清空模拟记录；占位数据被真实数据替换**不是**切换（否则表现为「开仓后自己平仓」）。
2. **游标落地**：复盘会话期间数据落地只夹取游标，绝不挪动它；无会话时才用存档游标或落到最新一根（否则持仓被「瞬间模拟」掉）。
3. **回放区间有效性**：区间按时间记忆，换数据集后覆盖不足 `max(20 根, 5%, 200 根)` 即判失效并退回全区间（否则表现为「一点复盘就是结果」）。
4. **行情加载中禁止下单**：数据未落地时按钮禁用并说明原因（避免下单被随后的落地清掉）。
5. **缓存键必须含市场**：现货与永续同品种同名不得共用缓存文件或内存条目。
6. **序列身份**：图表序列同步缓存必须带数据集标识（数据源|市场|品种|周期|重载计数），标识变化强制整体重建（否则图上残留上一个品种）。
7. **提示优先级**：用户操作（下单/平仓）的反馈不得被加载类的「就绪/补齐」提示覆盖。
8. **会话启动必须等数据真正落地**（30 秒上限），等不到就明确拒绝，而不是开一个坏会话。

## 可观测性（无头验收依赖）

`[data-testid=studio]` 暴露：`data-symbol/interval/bars/cursor/replay/feed/origin/orders-blocked/session-attempt`
`[data-testid=chart]` 暴露：`data-series-key/points/last-close/sync-mode/dark/tool/choosing/drawings/plot-points`
壳探针：`window.__zkPanes()`（副图真实高度）

## 已知债务

- `src/App.tsx` 1642 行（质量门债务清单内，P2 拆分）
- 账户为**单持仓模型**，无双向持仓（多空双开）
- 状态分散在 `useState` + 多个 `useRef`（`latest`/`sessionStartRef`/`feedStateRef`/`appliedIntent`），P2 收敛为显式领域状态
- 端到端冒烟目前靠临时 `--eval` 脚本，P4 入库为可重复套件
