import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import App from '../src/App';
import { ArchiveDialog } from '../src/components/ArchiveDialog';
import type { ArchiveEntry } from '../src/archive';

const read = (path: string) => readFileSync(resolve(path), 'utf8');
function sourceFiles(dir: string): string[] { return readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? sourceFiles(resolve(dir, entry.name)) : [resolve(dir, entry.name)]); }

describe('application contracts', () => {
  it('declares the chart and React runtime libraries', () => { const pkg = JSON.parse(read('package.json')); expect(Object.keys(pkg.dependencies).sort()).toEqual(['lightweight-charts', 'react', 'react-dom']); });
  it('keeps locked runtime dependencies consistent with the manifest', () => { const pkg = JSON.parse(read('package.json')); const lock = JSON.parse(read('package-lock.json')); expect(lock.packages[''].dependencies).toEqual(pkg.dependencies); });
  it('keeps network access confined to the feed and shell bridge modules', () => {
    const files = sourceFiles('src');
    const networkFiles = files.filter(file => file.endsWith('feed.ts') || file.endsWith('bridge.ts'));
    const others = files.filter(file => !networkFiles.includes(file)).map(read).join('\n');
    for (const api of ['fetch(', 'WebSocket', 'XMLHttpRequest', 'indexedDB', 'sessionStorage']) expect(others).not.toContain(api);
    // The feed only talks to Binance; the shell bridge only talks to its own loopback APIs.
    expect(read('src/feed.ts')).toContain('binance');
    expect(read('src/bridge.ts')).toContain("'/api/");
    // Browser storage is allowed, but only behind the injectable persistence module.
    expect(files.filter(file => !file.endsWith('persist.ts')).map(read).join('\n')).not.toContain('localStorage');
    expect(read('src/persist.ts')).toContain('localStorage');
  });
  it('provides initial historical time metadata', () => { const meta = JSON.parse(read('src/data/history-meta.json')); expect(meta.initialTime).toBe(1788881340); expect(meta.count).toBe(6944); });
  it('renders the workspace regions and control availability', () => { const html = renderToStaticMarkup(createElement(App)); for (const label of ['顶部工具栏', '绘图工具栏', '图表区', '绘图快捷栏', '右侧工具栏', '时间范围栏', '回放控制栏', '交易抽屉']) expect(html).toContain(label);
    // 默认停靠右侧抽屉，并带可拖动分隔条
    expect(html).toContain('调整交易面板宽度');
    expect(html).toContain('data-testid="trade-drawer"'); expect(html).toContain('BTCUSDT.P'); expect(html).toContain('当前没有等待中的委托'); });
  it('renders the finished controls instead of decorative placeholders', () => {
    const html = renderToStaticMarkup(createElement(App));
    for (const label of ['保存项目', '全局设置', '图表类型', '数据窗口', '自选列表', '训练笔记', '搜索品种', '布局', '委托类型', '订单历史', '撤销', '全屏']) expect(html).toContain(label);
    for (const label of ['蜡烛图', '美国线', '折线图', '面积图']) expect(html).toContain(label);
    expect(html).not.toContain('aria-disabled="true"');
    expect(html).not.toContain('当前不可用');
  });
  it('leaves no unavailable placeholder wording in the source', () => { expect(sourceFiles('src').filter(file => file.endsWith('.ts') || file.endsWith('.tsx')).map(read).join('\n')).not.toContain('当前不可用'); });
  it('offers the fib, pattern and icon drawing tools in the left rail', () => {
    // 工具盘由绘图契约的九类分组驱动（60+ 工具，含斐波那契/江恩/形态/图标）
    expect(read('src/components/DrawingToolbar.tsx')).toContain('TOOL_GROUPS');
    const tools = read('src/drawing.ts');
    for (const kind of ['fib-retracement', 'xabcd-pattern', 'icon-mark', 'gann-fan', 'elliott-impulse', 'long-position', 'callout', 'highlighter']) expect(tools).toContain(kind);
    expect(tools).toContain("label: '斐波那契与江恩'");
  });
  it('identifies the offline historical data rather than claiming live prices', () => { const html = renderToStaticMarkup(createElement(App)); expect(html).toContain('OKX 历史快照'); expect(html).toContain('不连接实时行情'); });
  it('retains chart attribution', () => { expect(read('src/App.tsx')).toContain('https://www.tradingview.com/'); expect(read('src/components/ChartCanvas.tsx')).toContain('attributionLogo: true'); });
  it('disables production source maps and has no API proxy', () => { const config = read('vite.config.ts'); expect(config).toContain('sourcemap: false'); expect(config).not.toContain('proxy:'); });
  it('serves static resources independently of market or session APIs', () => { const server = read('serve.mjs'); for (const route of ['/api/history', '/api/sessions', '/api/network', 'okx.com']) expect(server).not.toContain(route); });
  it('uses the product title in the document', () => { expect(read('index.html')).toContain('<title>交易训练室</title>'); });
  it('uses consistent package identity and version', () => { const pkg = JSON.parse(read('package.json')); const lock = JSON.parse(read('package-lock.json')); expect(pkg.name).toBe('zhuk-replay-studio'); expect(lock.name).toBe(pkg.name); expect(lock.version).toBe(pkg.version); expect(lock.packages[''].name).toBe(pkg.name); expect(lock.packages[''].version).toBe(pkg.version); });
  it('names the launcher and its console after the product', () => { expect(read('启动交易训练室.cmd')).toContain('title 交易训练室'); expect(read('README.md')).toContain('启动交易训练室.cmd'); });
  it('identifies the product in the health endpoint and startup log', () => { expect(read('serve.mjs')).toContain("name: '交易训练室'"); expect(read('serve.mjs')).toContain('REPLAY_READY'); });
  it('offers exactly one replay entry point, in the console', () => {
    const html = renderToStaticMarkup(createElement(App));
    // 复盘入口统一到控制台：主按钮「开始训练」+ 次按钮「自选起点」
    expect(html).toContain('开始训练');
    expect(html).toContain('自选起点');
    expect(html).toContain('波动播放');
    expect(html).not.toContain('复盘进行中');
    const source = read('src/App.tsx');
    // 顶栏不再重复提供复盘入口（此前顶栏「回放」与区间条「选择起点」各一套）
    expect(source.match(/aria-label="开启回放选择起点"/g) ?? []).toHaveLength(0);
    expect(source.match(/aria-label="选择起点"/g) ?? []).toHaveLength(0);
    expect(source).toContain('data-testid="console-start-session"');
    expect(source).toContain('data-testid="console-pick-start"');
  });
  it('renders the full-fidelity simulator controls', () => {
    const html = renderToStaticMarkup(createElement(App));
    for (const label of ['开多', '开空', '全部平仓', '减仓', '反手', '止损价', '止盈价', '高级']) expect(html).toContain(label);
    expect(html).toContain('data-testid="account-bar"');
    expect(html).toContain('data-testid="trade-ticket"');
    expect(html).not.toContain('当前不可用');
  });
  it('ships a consolidated replay console with a date range and no duplicate transport', () => {
    const source = read('src/App.tsx');
    // 一体化控制台：区间输入 + 应用 + 快捷 + 会话按钮
    for (const token of ['data-testid="open-range"', 'data-testid="console-start-session"', 'data-testid="console-finish-session"', 'aria-label="回放控制栏"']) expect(source).toContain(token);
    // 区间用自建日历弹窗（原生 datetime 弹窗会被下边栏裁掉）
    const dialog = read('src/components/DateRangeDialog.tsx');
    for (const token of ['range-dialog', 'range-day', 'range-presets', 'range-confirm']) expect(dialog).toContain(token);
    expect(source).not.toContain('type="datetime-local"');
    // 单位跟随当前品种，而不是存档时的品种
    expect(source).toContain("const baseSymbol = baseSymbolOf(live ? symbol : 'BTCUSDT');");
    // 顶部不再有重复的复盘按钮/计时 chip
    expect(source).not.toContain('aria-label="复盘计时"');
    expect(source).not.toContain('训练模式');
    // 选起点模式下允许往回步进（原 bug：disabled 里带 choosing）
    expect(source).toContain('onClick={() => step(-1)} disabled={cursorNow <= MIN_CURSOR}');
  });
  it('records every kept session into the personal dashboard with style tags', () => {
    const source = read('src/App.tsx');
    expect(source).toContain('buildRecord');
    expect(source).toContain('setRecordStore');
    expect(source).toContain('data-testid="open-dashboard"');
    expect(read('src/persist.ts')).toContain('export function loadHistory');
    const history = read('src/history.ts');
    for (const token of ['export function aggregate', 'export function detectStyle', 'export function buildRecord', 'export function equityBySession', 'export function sanitizeRecords']) expect(history).toContain(token);
    const dashboard = read('src/components/Dashboard.tsx');
    for (const token of ['style-tags', 'dash-grid', 'dash-curve', 'dash-export', 'dash-clear']) expect(dashboard).toContain(token);
  });
  it('routes every market call through the current market (spot/futures/fx)', () => {
    const source = read('src/App.tsx');
    // 深抓/翻页/刷新都必须带上市场类型，否则合约品种会打到现货接口（Binance 400）
    for (const token of ['fetchBarsFor', "market: marketKind === 'futures' ? 'futures' : 'spot'", 'marketKindOf', 'mergeLocalCache', 'saveLocalCache']) expect(source).toContain(token);
    expect(read('src/historyCache.ts')).toContain('export function mergeCandles');
    expect(read('src/bridge.ts')).toContain('export async function historyLoad');
  });
  it('ships a dark mode that covers both the chrome and the chart canvas', () => {
    const app = read('src/App.tsx');
    expect(app).toContain('data-testid="theme-toggle"');
    expect(app).toContain('document.documentElement.dataset.theme');
    expect(app).toContain("dark={settings.theme === 'dark'}");
    const chart = read('src/components/ChartCanvas.tsx');
    expect(chart).toContain('function chartTheme');
    expect(chart).toContain("applyOptions({ layout: theme.layout");
    const css = read('src/styles.css');
    expect(css).toContain('[data-theme=dark]');
    for (const token of ['--bg-page:#131722', '--bg-panel:#1a1e2a', '--border:#2a2e39', '--text:#d1d4dc', '--chart-bg:#131722', 'color-scheme:dark']) expect(css).toContain(token);
    // 深色区块要覆盖到浮起层与画布
    expect(css).toContain('--bg-elevated:#1e222d');
    expect(css).toContain('--chart-grid:#1f2431');
    expect(css.indexOf('[data-theme=dark]{')).toBeGreaterThan(css.indexOf(':root{'));
  });
  it('never swallows an order click silently (choosing mode explains itself)', () => {
    const source = read('src/App.tsx');
    // 回归：选起点模式下点开仓曾直接 return，用户表现为"点开仓毫无反应"。
    expect(source).toContain('正在选择回放起点：请先在图表上点一根K线作为起点');
    expect(source).not.toContain('function submit(action: TicketAction, kind: TicketKind) {\n    if (choosing) return;');
    expect(source).toContain('choosing={choosing}');
    const ticket = read('src/components/TradeTicket.tsx');
    expect(ticket).toContain('data-testid="ticket-choosing-notice"');
    expect(ticket).toContain('props.choosing');
    // 键盘下单与按钮下单走同一条 submit，所以两处都被覆盖
    expect(source).toContain("case 'open-long': submit('open-long', 'market'); return;");
  });
  it('opens from local history first and only tops up in the background', () => {
    const source = read('src/App.tsx');
    for (const token of ['planLaunchLoad', 'async function openDataset', 'async function topUpHistory', "origin: 'cache'", '离线模式：本地历史', 'data-origin=']) expect(source).toContain(token);
    // 本地优先：缓存可用时不得先走网络
    const openBody = source.slice(source.indexOf('async function openDataset'), source.indexOf('async function topUpHistory'));
    expect(openBody.indexOf('historyLoad')).toBeLessThan(openBody.indexOf('fetchBarsFor'));
    // 联网全失败也要能复盘：退回内置样本而不是死报错
    expect(source).toContain('useBuiltinSnapshot();\n    setDataOrigin(\'builtin\');');
    // 增量补齐只用 startTime 向前取，不重拉全量
    expect(read('src/feed.ts')).toContain('startTime');
  });
  it('lists every instrument instantly from the bundled snapshots', () => {
    const app = read('src/App.tsx');
    // 现货类：实时表为空也要能用内置快照立刻列出来
    expect(app).toContain("import { SPOT_SNAPSHOT } from './uniSpot';");
    expect(app).toContain('SPOT_SNAPSHOT.map(entry => ({ symbol: entry.symbol');
    // 有快照可看时不得显示"正在加载品种列表…"
    expect(app).toContain('{symbolLoading && !classInstruments(assetClass).length &&');
    // 本地清单要标明后台还在刷新
    expect(app).toContain('本地清单（后台刷新实时表中…）');
    const spot = read('src/uniSpot.ts');
    expect(spot.split('{ symbol:').length - 1).toBeGreaterThan(400);
    const futures = read('src/uniFutures.ts');
    expect(futures).toContain("kind: 'EQUITY'");
    expect(futures).toContain("kind: 'COMMODITY'");
    expect(futures).toContain("kind: 'HK_EQUITY'");
  });
  it('never wipes an order when the real dataset lands', () => {
    const source = read('src/App.tsx');
    // 回归：applyDataset 曾无条件 clearTrades()，用户在"正在加载/占位数据"上开的仓会被真实数据落地清掉，
    // 表现为"开空自己会平仓"。现在：① 清空只由"用户真的换了数据集"触发；② 行情加载中直接禁用下单。
    // 规则已抽到 src/domain/dataset.ts（纯函数 + 单测）；App 只做调用，避免规则散落回组件。
    expect(source).toContain('const appliedIntent = useRef');
    expect(source).toContain('const switched = isUserSwitch(appliedIntent.current, intentNow);');
    expect(source).toContain('if (!options.keepLog && !session && switched) clearTrades();');
    expect(source).not.toContain('if (!options.keepLog && !session) clearTrades();');
    expect(read('src/domain/dataset.ts')).toContain('export function isUserSwitch');
    expect(source).toContain("blockedReason={feedState === 'loading'");
    // 刚下单 3 秒内，加载类的"就绪/补齐"提示不许盖掉成交提示
    const applyStart = source.indexOf('function applyDataset');
    const applyEnd = source.indexOf('async function refreshLatest');
    expect(source.slice(applyStart, applyEnd)).toContain('lastOrderAt.current');
  });
  it('makes the order ticket draggable and dockable as a floating window', () => {
    const source = read('src/App.tsx');
    for (const token of ['data-testid="trade-float"', 'data-testid="trade-float-handle"', 'beginPanelDrag', "['float', '浮动']", "tradePanel === 'float'"]) expect(source).toContain(token);
    // 从抽屉标题栏拖动即可拖成浮动窗口
    expect(source).toContain("onPointerDown={event => beginPanelDrag(event, 'drawer')}");
    expect(source).toContain("beginPanelDrag(event, 'float')");
    expect(read('src/hotkeys.ts')).toContain("'float'");
    expect(read('src/persist.ts')).toContain('floatX');
    expect(read('src/styles.css')).toContain('.trade-float');
  });
  it('drops a replay range that no longer fits the dataset', () => {
    const source = read('src/App.tsx');
    // 回归：存档里的回放区间是按时间记的，换了品种/周期后可能只剩末尾几根，
    // 用户表现为"点复盘直接就是结果"。跨度太小必须自动退回全区间。
    expect(source).toContain('const fit = rangeFits({ bars, from: replayFrom, to: replayTo');
    expect(source).toContain('if (replayFrom !== null && replayTo !== null && !fit.fits) {');
    expect(source).toContain('setReplayFrom(null); setReplayTo(null);');
    expect(read('src/domain/dataset.ts')).toContain('const floor = Math.max(20, Math.min(200, Math.floor(bars.length * 0.05)));');
    expect(source).toContain('原回放区间在新数据上只剩');
  });
  it('never starts a replay on a dataset that has not landed yet', () => {
    const source = read('src/App.tsx');
    // 回归：startSession 原来只等 6 秒，加载慢的品种会带着旧数据集开会话 → 一点复盘就结束。
    expect(source).toContain('const deadline = Date.now() + 30000;');
    expect(source).toContain('已取消开始复盘，等数据就绪后再点一次「复盘」即可。');
    expect(source).toContain('if (!fresh.live || fresh.maxCursor <= MIN_CURSOR + 5)');
    expect(source).toContain('当前还没有可复盘的数据集');
    expect(source).not.toContain('const deadline = Date.now() + 6000;');
  });
  it('blocks ordering until the intended dataset lands, and announces exits', () => {
    const source = read('src/App.tsx');
    // 回归："开空自己平仓" = 用户在占位数据上开的仓，被真实数据落地时的清空逻辑清掉
    expect(source).toContain('const appliedIntent = useRef');
    expect(source).toContain('const switched = isUserSwitch(appliedIntent.current, intentNow);');
    expect(source).toContain("blockedReason={feedState === 'loading'");
    expect(source).toContain('行情加载中：数据就绪后才能下单');
    // 强平/止损/止盈必须明确提示（此前强平悄悄发生）
    expect(source).toContain('⚠️ 仓位已被强制平仓（爆仓）');
    expect(source).toContain('已触发止损');
    expect(source).toContain('已触发止盈');
    const ticket = read('src/components/TradeTicket.tsx');
    expect(ticket).toContain('data-testid="ticket-blocked-notice"');
    expect(ticket).toContain('disabled={!!props.blockedReason}');
  });
  it('drops a dataset load that a newer request superseded', () => {
    const source = read('src/App.tsx');
    expect(source).toContain('const token = ++requestRef.current;');
    expect(source).toContain('if (isStaleRequest(requestRef.current, token)) return false;');
    // 缓存读取后、联网抓取后、后台补齐落地前都要校验
    expect((source.match(/isStaleRequest\(requestRef.current, token\)/g) || []).length).toBeGreaterThanOrEqual(3);
    expect(read('src/domain/dataset.ts')).toContain('export function isStaleRequest');
  });
  it('closes the whole position from every "close all" entry point', () => {
    const source = read('src/App.tsx');
    // 回归：submit('close') 曾用票据数量 (Math.min(qty, position.qty)) 平仓，
    // 于是"全部平仓"在持仓大于票据数量时每次只平一点，用户要连点多次。
    expect(source).toContain('const closed = position.qty;   // 全部平仓：平掉整个持仓');
    expect(source).not.toContain('const closed = Math.min(qty, position.qty);\n      const fillPrice = marketFill(side);\n      const result = closePosition(account, sim, { side, qty: closed, price: fillPrice, time: minute.time });');
    // 部分平仓必须是显式动作（票据上的「减仓」与持仓行的「减仓」）
    expect(source).toContain("if (action === 'reduce') {");
    expect(source).toContain("submit('reduce', 'market')");
    // 所有"平/一键平仓"入口统一走 close（现在语义=全平）
    for (const sel of ['drawer-close', 'float-close']) expect(source).toContain(sel);
    expect((source.match(/submit\('close', 'market'\)/g) || []).length).toBeGreaterThanOrEqual(4);
    const ticket = read('src/components/TradeTicket.tsx');
    expect(ticket).toContain('data-testid="close-position"');
    expect(ticket).toContain('data-testid="reduce-position"');
    expect(ticket).toContain("| 'reduce'");
    expect(ticket).toContain('全部平仓');
  });
  it('refuses an inverted stop/target and arms protection from the next bar', () => {
    const source = read('src/App.tsx');
    // 回归①：方向反的价位过去只提示、仍然写入委托日志 → 下一根立即触发（"刚开仓就被止损"）
    expect(source).toContain('const plan = planProtection({ side, reference, sl: Number(slPrice)');
    expect(source).toContain('const action: OrderAction = { kind: \'protect\', seq, time: start, sl: plan.sl, tp: plan.tp, trailBps: plan.trailBps };');
    expect(source).not.toContain("setHint('止损方向反了");
    // 回归②：保护必须从下一根K线生效（当前K线已走过的路径会造成前视止损）
    expect(source).toContain('const start = protectionStartTime(minute.time, nextBar?.time, step);');
    // 拒绝说明必须如实出现在提示里，不能被成功提示覆盖
    expect(source).toContain('${protectWarn.length ? `（${protectWarn.join(\'；\')}）` : \'\'}');
    const domain = read('src/domain/protection.ts');
    for (const token of ['export function planProtection', 'export function protectionStartTime', 'rejected']) expect(domain).toContain(token);
  });
  it('keeps tall dialogs scrollable inside the viewport with sticky actions', () => {
    // 回归：设置对话框实测 1473px 高、窗口仅 732px，而 .date-dialog 既没有 max-height 也不滚动
    // → 「方案名称/存为方案/保存」整块永远点不到（真实鼠标 elementFromPoint 返回 null）。
    const css = read('src/styles.css');
    const base = css.slice(css.indexOf('.date-dialog{'), css.indexOf('.date-dialog{') + 320);
    expect(base).toContain('max-height:calc(100dvh - 28px)');
    expect(base).toContain('overflow-y:auto');
    const footer = css.slice(css.indexOf('.date-dialog footer{'), css.indexOf('.date-dialog footer{') + 260);
    expect(footer).toContain('position:sticky');
    expect(footer).toContain('bottom:-24px');
  });
  it('keeps the simulated principal denominated in USDT', () => {
    const source = read('src/App.tsx');
    // 用户口径：模拟权益（本金）始终是 USDT，不随本位改成 BTC 等
    expect(source).toContain('模拟权益（USDT）');
    expect(source).not.toContain("模拟权益（{settingsDraft.sim.settle === 'coin' ? baseSymbol : 'USDT'}）");
    // 打开设置时把引擎里的本位数量折回 USDT 显示；保存时再按本位换回去
    expect(source).toContain("settings.sim.settle === 'coin' ? Number((settings.sim.equity * current.close).toFixed(2)) : settings.sim.equity");
    expect(source).toContain("const equity = settingsDraft.sim.settle === 'coin' ? Number((usdt / Math.max(current.close, 1e-9)).toFixed(8)) : usdt;");
    expect(source).toContain('模拟权益 ${money(usdt)} USDT');
  });
  it('keeps the trading panel dockable, resizable and readable in narrow mode', () => {
    const source = read('src/App.tsx');
    // 停靠/拖动/复位
    for (const token of ['setTradePanel', 'startDrag', 'moveDrag', 'endDrag', 'resetPanel', 'MIN_DRAWER_WIDTH', 'MAX_DRAWER_WIDTH', 'MIN_BOTTOM_HEIGHT']) expect(source).toContain(token);
    expect(source).toContain('data-testid="splitter-drawer"');
    expect(source).toContain('data-testid="trade-panel-bottom"');
    expect(read('src/persist.ts')).toContain("tradePanel: 'bottom' | 'right' | 'float' | 'hidden'");
    // 窄抽屉用带标签的卡片行，而不是硬塞 8 列
    const css = read('src/styles.css');
    for (const token of ['.trade-drawer .table-head{display:none}', 'attr(data-label)', 'grid-template-columns:repeat(2,minmax(0,1fr))']) expect(css).toContain(token);
    // 成交原因中文化（强平/止损/止盈一眼可辨）
    expect(source).toContain('强平');
    expect(source).toContain('跟踪止损');
  });
  it('folds the moving averages into the indicator system instead of a standalone overlay', () => {
    const source = read('src/App.tsx');
    expect(source).not.toContain('显示或隐藏EMA20');
    expect(source).not.toContain('ema-label');
    // 数据窗口不再挂着一个孤立的 EMA20 行（数值改由图表图例承载）
    expect(source).not.toContain('EMA20</dt>');
    expect(read('src/components/ChartCanvas.tsx')).not.toContain('average.current');
    // 新存档直接给交易所默认形态（均线组 + 成交量）
    expect(source).toContain('defaultIndicatorInstances');
    expect(read('src/indicators/templates.ts')).toContain("DEFAULT_TEMPLATE");
  });
  it('ships platform-style indicator tooling in the library dialog', () => {
    const html = renderToStaticMarkup(createElement(App));
    // 新存档的默认指标直接出现在图例里（均线组 + 成交量）
    for (const label of ['MA · 均线组（多周期）', 'VOL · 成交量', 'chart-legend']) expect(html).toContain(label);
    const dialog = read('src/components/IndicatorDialog.tsx');
    for (const token of ['onTemplate', 'onFavorite', 'indicator-star', 'favorites', 'editId']) expect(dialog).toContain(token);
    // 模板并入指标列表（列表内的分组），不再有独立的模板行
    expect(dialog).toContain('indicator-templates-group');
    expect(dialog).not.toContain('className="indicator-templates"');
    expect(read('src/styles.css')).toContain('.indicator-group .template-row');
    const templates = read('src/indicators/templates.ts');
    for (const label of ['交易所默认', '趋势跟踪', '震荡波段', '短线快打']) expect(templates).toContain(label);
    // 图例带各序列数值与显隐/改参/移除/副图高度，并且按面板堆在左上角
    const canvas = read('src/components/ChartCanvas.tsx');
    for (const token of ['legend-actions', '副图高度', '显示或隐藏', '指标参数', '移除指标', 'chart-legend-block']) expect(canvas).toContain(token);
    expect(read('src/styles.css')).toContain('.chart-legend-block{position:absolute;left:8px');
  });
  it('keeps the status bar global and gives alerts a chart hook', () => {
    const source = read('src/App.tsx');
    // 状态栏在 <main> 里（面板隐藏也看得见提示语）
    expect(source).toContain('<footer className="statusbar" aria-label="状态栏">');
    expect(source).not.toContain('        <footer className="statusbar">');
    // 壳内不做 blob 下载（会整页重载）
    expect(source).toContain('当前窗口不支持下载');
    // 预警只给有规则的指标
    expect(source).toContain('supportsAlerts');
    expect(read('src/components/ChartCanvas.tsx')).toContain('data-alerts=');
    expect(read('src/alerts.ts')).toContain('export function supportsAlerts');
  });
  it('models a two-sided levered account with costs and liquidation', () => {
    const model = read('src/model.ts');
    for (const token of ['openPosition', 'closePosition', 'reversePosition', 'liquidate', 'applyFunding', 'liquidationPriceOf', 'marginRatioOf', 'takerBps']) expect(model).toContain(token);
    const orders = read('src/orders.ts');
    for (const token of ['protectionTrigger', 'reduceOnly', 'trailBps', 'liquidation', 'applyFunding']) expect(orders).toContain(token);
    expect(read('src/stats.ts')).toContain('maxDrawdown');
    expect(read('src/components/SessionPanel.tsx')).toContain('导出CSV');
  });
  it('keeps the session model pure and free of schedules', () => {
    const model = read('src/session.ts');
    for (const api of ['fetch(', 'WebSocket', 'XMLHttpRequest', 'indexedDB', 'localStorage', 'sessionStorage', 'document.', 'window.', 'setInterval']) expect(model).not.toContain(api);
    expect(read('src/App.tsx')).toContain("from './session'");
    expect(read('src/App.tsx')).toContain('withFormingBar');
    expect(read('src/components/SessionPanel.tsx')).toContain('保留结果');
    expect(read('src/components/SessionPanel.tsx')).toContain('删除结果');
  });
  it('stops promising that a refresh wipes the workspace', () => { const source = read('src/App.tsx'); expect(source).toContain('自动保存在本机'); expect(source).not.toContain('刷新页面后账户重置'); });
  it('files every kept session into the training archive', () => {
    const source = read('src/App.tsx');
    expect(source).toContain('appendArchive');
    expect(source).toContain('createArchiveEntry');
    expect(source).toContain('ArchiveDialog');
    // 保留结果写档案，删除结果不入档
    const keep = source.slice(source.indexOf('function keepSession'), source.indexOf('function discardSession'));
    expect(keep).toContain('setArchive');
    expect(source.slice(source.indexOf('function discardSession'), source.indexOf('function exportText'))).not.toContain('setArchive');
  });
  it('exposes the archive from the right rail only', () => {
    const html = renderToStaticMarkup(createElement(App));
    expect(html).toContain('训练档案');
    expect(html).toContain('data-testid="open-archive"');
    expect(read('src/components/ArchiveDialog.tsx')).toContain('data-testid="archive-dialog"');
    const source = read('src/App.tsx');
    // 去重复：档案入口只保留一处（右侧栏），布局入口只保留一处（顶栏），设置不再有两个
    expect(source.match(/aria-label="训练档案"/g) ?? []).toHaveLength(1);
    expect(source.match(/aria-label="侧栏布局"/g) ?? []).toHaveLength(0);
    expect(source.match(/aria-label="布局"/g) ?? []).toHaveLength(1);
    // 设置只保留顶栏一个**按钮**入口（另一个 aria-label="全局设置" 是设置对话框自身的角色名，属正确用法）
    expect(source.match(/<button[^>]*aria-label="全局设置"/g) ?? []).toHaveLength(1);
    expect(read('src/components/DrawingToolbar.tsx').match(/aria-label="绘图设置提示"/g) ?? []).toHaveLength(0);
  });
  it('renders cross-session totals, a curve and one row per stored session', () => {
    const entries: ArchiveEntry[] = [
      { id: 'a1', at: 1_700_000_000_000, market: 'BTCUSDT', interval: '15分', minutes: 12, bars: 200, unit: 'USDT', startEquity: 10_000, equity: 10_030, trades: 3, wins: 2, losses: 1, grossProfit: 40, grossLoss: -10, realized: 30, fees: 1.2, funding: -.1, best: 30, worst: -10, longTrades: 2, longPnl: 35, shortTrades: 1, shortPnl: -5, maxDrawdown: 12, maxDrawdownPct: .0012, avgHoldingMinutes: 5, liquidated: false, alerts: 1 },
      { id: 'a2', at: 1_700_000_600_000, market: 'ETHUSDT', interval: '1小时', minutes: 25, bars: 320, unit: 'USDT', startEquity: 10_030, equity: 10_005, trades: 2, wins: 0, losses: 2, grossProfit: 0, grossLoss: -25, realized: -25, fees: 1, funding: 0, best: 0, worst: -20, longTrades: 1, longPnl: 0, shortTrades: 1, shortPnl: -25, maxDrawdown: 25, maxDrawdownPct: .0025, avgHoldingMinutes: 9, liquidated: false, alerts: 3 },
    ];
    const html = renderToStaticMarkup(createElement(ArchiveDialog, { entries, currentUnit: 'USDT', onDelete() { }, onClear() { }, onExport() { }, onClose() { } }));
    for (const label of ['训练档案', '场次', '整体胜率', '累计盈亏比', '最大回撤', '最长连赢/连亏', '累计复盘时长', '分品种表现']) expect(html).toContain(label);
    expect(html).toContain('data-testid="archive-curve"');
    expect(html).toContain('data-testid="archive-row"');
    expect(html.match(/data-testid="archive-row"/g)).toHaveLength(2);
    // 两场累计：+30 后 -25 = +5
    expect(html).toContain('+5.00');
    expect(html).toContain('导出CSV');
  });
  it('explains how to fill an empty archive', () => {
    const html = renderToStaticMarkup(createElement(ArchiveDialog, { entries: [], currentUnit: 'USDT', onDelete() { }, onClear() { }, onExport() { }, onClose() { } }));
    expect(html).toContain('data-testid="archive-empty"');
    expect(html).toContain('保留结果');
    expect(html).not.toContain('data-testid="archive-row"');
  });
  it('keeps the keyboard listener stable while reading fresh state', () => {
    const source = read('src/App.tsx');
    expect(source).toContain('hotkeyRef.current');
    expect(source).toContain('hotkeyAction(event');
    // 监听器只注册一次；曾经把 handler 整个关在 useEffect([selected, locked]) 里，
    // 结果改完数量再按 B，成交用的还是挂载时的数量。
    expect(source).not.toContain("window.addEventListener('keydown', keyboard)");
    expect(read('src/hotkeys.ts')).toContain('export function hotkeyAction');
  });
  it('documents the global shortcuts inside settings', () => {
    expect(read('src/App.tsx')).toContain('data-testid="hotkey-block"');
    expect(read('src/App.tsx')).toContain('HOTKEY_HELP.map');
    expect(read('src/hotkeys.ts')).toContain('export const HOTKEY_HELP');
  });
  it('pairs opened and closed trades instead of listing every sell', () => {
    const source = read('src/App.tsx');
    expect(source).toContain('closedTrades(derived.fills)');
    // 双向持仓下卖单可能是开空、买单可能是平空，不能按方向筛
    expect(source).not.toContain("filter(mark => mark.side === 'sell')");
    expect(source).toContain('data-testid="closed-row"');
    expect(source).toContain('fillSideLabel(m.side, m.action)');
  });
  it('renders every money/quantity cell through the documented formatters', () => {
    const source = read('src/App.tsx');
    expect(source).toContain('qtyText(m.qty)');
    expect(source).toContain('priceText(m.price, settings.sim.tickSize)');
    expect(source).toContain('qtyText(order.qty)');
    expect(source).toContain('priceText(order.price, settings.sim.tickSize)');
    expect(source).not.toContain('<span>{order.qty}</span>');
  });
  it('flips the cursor tooltip at the right edge instead of a fixed clamp', () => {
    const source = read('src/App.tsx');
    expect(source).not.toContain('Math.min(cursorAt.x + 14, 460)');
    expect(source).toContain('translateX(-100%)');
    expect(source).toContain('chartSection');
  });
  it('cycles sub-pane heights from the height the legend shows', () => {
    expect(read('src/App.tsx')).toContain('nextHeight(current[instance.id] ?? DEFAULT_PANE_HEIGHT)');
  });
  it('makes the watchlist user-editable and persisted', () => {
    const source = read('src/App.tsx');
    expect(source).toContain('settings.watchlist');
    expect(source).not.toContain('WATCH_SYMBOLS');
    expect(source).toContain('data-testid="watchlist-add"');
    expect(source).toContain('data-testid="watchlist-remove"');
    expect(source).toContain('data-testid="watchlist-add-current"');
    expect(read('src/persist.ts')).toContain('export function sanitizeWatchlist');
  });
  it('shows the account equity trail in the archive', () => {
    const entries: ArchiveEntry[] = [{
      id: 'e1', at: 1_700_000_000_000, market: 'BTCUSDT', interval: '15分', minutes: 10, bars: 100, unit: 'USDT',
      startEquity: 10_000, equity: 10_250, trades: 1, wins: 1, losses: 0, grossProfit: 260, grossLoss: 0,
      realized: 250, fees: 10, funding: 0, best: 250, worst: 0, longTrades: 1, longPnl: 250, shortTrades: 0, shortPnl: 0,
      maxDrawdown: 0, maxDrawdownPct: 0, avgHoldingMinutes: 5, liquidated: false, alerts: 0,
    }];
    const html = renderToStaticMarkup(createElement(ArchiveDialog, { entries, currentUnit: 'USDT', onDelete() { }, onClear() { }, onExport() { }, onClose() { } }));
    expect(html).toContain('权益轨迹');
    expect(html).toContain('10,000.00');
    expect(html).toContain('10,250.00');
  });
  it('offers panel-size presets in the layout menu', () => {
    const source = read('src/App.tsx');
    expect(source).toContain('applyPanelSize');
    expect(source).toContain('data-testid={`panel-size-${preset}`}');
    for (const size of ['compact', 'standard', 'wide']) expect(source).toContain(`['${size}',`);
    // 预设写进和拖动同一份记忆
    expect(source).toContain('bottomHeight: size.bottom');
    expect(source).toContain('drawerWidth: size.drawer');
  });
  it('puts a shortcut cheat sheet on the status bar', () => {
    const source = read('src/App.tsx');
    expect(source).toContain('data-testid="hotkey-help"');
    expect(source).toContain('data-testid="hotkey-menu"');
    // Esc 与点外部都要能收起速查表
    expect(source).toContain('setHelpOpen(false)');
    expect(source).toContain('hotkey-link');
  });
  it('keeps the indicator parameter editor usable while typing', () => {
    const dialog = read('src/components/IndicatorDialog.tsx');
    // 数字框编辑期间保留原始文本；直接写回 Number('') 会变成 0，用户清不干净、小数也打不出来
    expect(dialog).toContain('NumberField');
    expect(dialog).toContain('setText(raw)');
    expect(dialog).not.toContain('[input.key]: Number(event.target.value)');
    // 下单面板的快捷数量不能把整数位的零当小数尾零裁掉
    expect(read('src/components/TradeTicket.tsx')).toContain('quantityStepText');
    expect(read('src/model.ts')).toContain('export function quantityStepText');
  });
});
