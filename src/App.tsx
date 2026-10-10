/*!
 * src/App.tsx - zhuk-replay-studio key core logic
 * (c) 2026 William-Trader (https://github.com/William-Trader)
 * WM: ZRS-D17A039E
 * SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
 * Removing this mark violates the license.
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { Icon } from './components/Icon';
import { ChartCanvas, DEFAULT_PANE_HEIGHT, type ChartHandle, type ChartLevelSpec, type ChartLegendSpec, type ChartPlotSpec } from './components/ChartCanvas';
import { DrawingGlyph, IconMarkGlyph } from './components/DrawingGlyph';
import { DrawingToolbar } from './components/DrawingToolbar';
import { ReplayIcon } from './components/ReplayIcon';
import { shellInfo, pythonRun as bridgePythonRun, type PythonCandles, type PythonResult } from './bridge';
import { fetchFundingRates, fetchFxDaily, fetchFuturesUniverse, fetchKlines, fetchPremiumIndex, fetchSymbols, fetchTickers, fundingByBoundary, HISTORY_CHUNK, INTERVALS, MAX_KLINES, type MarketSymbol, type Ticker } from './feed';
import { computeIndicator, defaultIndicatorInstances, defaultInputs as defaultIndicatorInputs, INDICATOR_MAP, templateById, templateInstances } from './indicators';
import { IndicatorDialog, type IndicatorInstance } from './components/IndicatorDialog';
import { PythonDialog, type PythonInstance, type PythonRunState } from './components/PythonDialog';
import { SessionPanel, SessionResultDialog } from './components/SessionPanel';
import { Dashboard } from './components/Dashboard';
import { DateRangeDialog } from './components/DateRangeDialog';
import { cacheIsDeeper, cacheSummary, formatBytes, fromRows, mergeCandles, planLaunchLoad, toRows } from './historyCache';
import { historyClear, historyList, historyLoad, historySave, type CachedDataset } from './bridge';
import { formatDateTime } from './dateRange';
import { ASSET_CLASSES, classLabel, classify, COMMODITY_INSTRUMENTS, FOREX_INSTRUMENTS, isReady, marketKindOf, parseFxPair, snapshotInstruments, type AssetClassId, type MarketKind } from './universe';
import { SPOT_SNAPSHOT } from './uniSpot';
import { cursorAfterApply, intentKey, intentOf, isStaleRequest, isUserSwitch, rangeFits } from './domain/dataset';
import { planProtection, protectionStartTime } from './domain/protection';

/** 外汇对解析的兜底（品种不在清单里时也能用）。 */
const parseFxPairAny = (symbol: string) => parseFxPair(symbol);
import { buildRecord } from './history';
import { ArchiveDialog } from './components/ArchiveDialog';
import { appendArchive, archiveCsv, archiveFileName, createArchiveEntry, sanitizeArchive, type ArchiveEntry } from './archive';
import { aggregateIndexed, CHART_TYPES, chartTime, cursorForTime, cursorForTimeIn, dateInput, HISTORY, valueAt, INITIAL_CURSOR, MIN_CURSOR, parseDateInput, PERIODS, revealedAggregate, stepBars, stepCursor, type Candle, type ChartType } from './market';
import { createPerfMeter, type PerfSnapshot } from './perf';
import { accountValues, closePosition, LEVERAGES, marketPrice, money, notionalUsd, openPosition, percentText, priceText, qtyText, settleText, reversePosition, type FillAction, type SimConfig } from './model';
import { AccountBar } from './components/AccountBar';
import { TradeTicket, type TicketAction, type TicketKind } from './components/TradeTicket';
import { closedTrades, fillsCsv, statsCsv, tradeStats, type TradeStats } from './stats';
import { alertsSince, indicatorAlerts, MAX_CHART_ALERTS, supportsAlerts, type IndicatorAlert } from './alerts';
import { derive, nextSeq, protectionLevels, reducesPosition, type MarketEvent, type Order, type OrderAction, type OrderSide, type OrderState, type OrderType } from './orders';
import { clearHistory, clearProject, createNote, DEFAULT_BOTTOM_HEIGHT, DEFAULT_DRAWER_WIDTH, defaultSettings, loadHistory, loadProject, saveHistory, MAX_BOTTOM_HEIGHT, MAX_DRAWER_WIDTH, MAX_WATCHLIST, MIN_BOTTOM_HEIGHT, MIN_DRAWER_WIDTH, loadSettings, parseProject, projectFileName, sanitizeSettings, sanitizeWatchlist, saveProject, saveSettings, serializeProject, WATCHLIST_SYMBOL, type HistoryStore, type Note, type ProjectV1, type Settings, type SimPreset } from './persist';
import { createSession, durationText, MIN_REPLAY_SPEED, REPLAY_SPEEDS, STEP_SIZES, sessionStats, sessionSummary, withFormingBar, type ReplaySession, type SessionStats } from './session';
import { commit, emptyHistory, ICON_MARKS, redo, TOOL_NAMES, undo, type Drawing, type DrawingHistory, type Tool } from './drawing';
import { cyclePanel, HOTKEY_HELP, hotkeyAction, togglePanel } from './hotkeys';

/** Native shell bridge (macOS app). Feature detection only — the web bundle never writes to it. */
interface NativeBridge { isNative: true; exportFile(name: string, content: string): void; importFile(): Promise<string | null>; toggleFullscreen(): void }
function nativeBridge(): NativeBridge | null {
  if (typeof window === 'undefined') return null;
  const bridge = (window as Window & { __zkNative?: NativeBridge }).__zkNative;
  return bridge?.isNative ? bridge : null;
}
type RecordTab = 'positions' | 'orders' | 'history' | 'overview' | 'fills' | 'closed';
type PanelTab = 'trades' | 'notes';
type UiKey = 'leftRail' | 'rightRail' | 'bottomPanel' | 'dataWindow' | 'watchlist';
type FeedState = 'idle' | 'loading' | 'live' | 'error';
const recordTabs: [RecordTab, string][] = [['positions', '持仓'], ['orders', '订单'], ['history', '订单历史'], ['overview', '账户概览'], ['fills', '成交记录'], ['closed', '已平仓']];
const uiToggles: [UiKey, string][] = [['leftRail', '左侧工具栏'], ['rightRail', '右侧栏'], ['bottomPanel', '底部面板'], ['dataWindow', '数据窗口'], ['watchlist', '自选列表']];
const orderTypeLabels: Record<'market' | OrderType, string> = { market: '市价', limit: '限价', stop: '止损' };
const statusLabels = { working: '委托中', filled: '已成交', cancelled: '已撤销' } as const;
/** 成交原因（复盘时一眼看出是手动、挂单还是被强平）。 */
/** 从交易对推基础币种（BTCUSDT / BTCUSDT.P → BTC）。 */
function baseSymbolOf(symbol: string): string {
  const clean = symbol.replace(/[^A-Z0-9]/g, '');
  for (const quote of ['USDT', 'USDC', 'USD']) if (clean.endsWith(quote) && clean.length > quote.length) return clean.slice(0, -quote.length);
  return clean.slice(0, 3) || 'COIN';
}
const FILL_REASON_LABELS: Record<string, string> = { market: '手动市价', limit: '限价单', stop: '止损单', sl: '止损', tp: '止盈', trail: '跟踪止损', liquidation: '强平' };
/** 成交动作标签：双向持仓下「买」不等于「开」、「卖」也不等于「平」。 */
const fillSideLabel = (side: OrderSide, action: FillAction): string => {
  const opening = action === 'open' || action === 'add';
  return side === 'buy' ? (opening ? '买开' : '买平') : (opening ? '卖开' : '卖平');
};
/** 持仓时长：秒 → 人话（<1 分 / 分 / 小时分）。 */
function holdingText(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  if (total < 60) return `${total} 秒`;
  const minutes = Math.floor(total / 60);
  if (minutes < 60) return `${minutes} 分`;
  return `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分`;
}
const toolHints: Partial<Record<Tool, string>> = {
  cursor: '光标：平移缩放图表；点击绘图选中，拖动图形或端点修改。',
  brush: '画笔：按住鼠标拖动，松开完成。',
  'text-annotation': '点击图表输入文字；支持中文和换行，Ctrl+Enter 完成。',
  'fib-retracement': '斐波那契回撤：点击起点与终点，自动标注七条水平位与比例。',
  'xabcd-pattern': 'XABCD 形态：依次点击 X、A、B、C、D 五个点；Esc 取消。',
  'icon-mark': '图标标记：先选择图标，再点击图表放置；Esc 取消。',
};
/** 复盘模式默认补上的成交量面板（内置指标 id）。 */
const VOLUME_DEF_ID = 'volume';
/** 副图高度档位（像素）：100 → 140 → 200 → 280 → 回到 100。 */
const PANE_HEIGHTS = [100, 140, 200, 280] as const;
const nextHeight = (current: number) => PANE_HEIGHTS[(PANE_HEIGHTS.indexOf(current as (typeof PANE_HEIGHTS)[number]) + 1) % PANE_HEIGHTS.length] ?? 140;
const messageOf = (error: unknown) => error instanceof Error ? error.message : String(error);
const intervalLabelOf = (value: string) => INTERVALS.find(entry => entry.value === value)?.label ?? value;
const intervalMinutesOf = (value: string) => INTERVALS.find(entry => entry.value === value)?.minutes ?? 15;
const sanitizeIndicators = (list: ProjectV1['indicators']): IndicatorInstance[] => (list ?? []).filter(entry => entry && typeof entry.id === 'string' && typeof entry.defId === 'string' && entry.defId in INDICATOR_MAP).map(entry => ({ id: entry.id, defId: entry.defId, visible: entry.visible !== false, alerts: entry.alerts !== false, inputs: { ...defaultIndicatorInputs(INDICATOR_MAP[entry.defId]), ...(entry.inputs ?? {}) } }));
const sanitizePythons = (list: ProjectV1['pythonIndicators']): PythonInstance[] => (list ?? []).filter(entry => entry && typeof entry.id === 'string' && typeof entry.file === 'string').map(entry => ({ id: entry.id, file: entry.file, params: (entry.params ?? {}) as Record<string, unknown>, visible: entry.visible !== false }));

export default function App() {
  const [restored] = useState(() => loadProject());
  const [settings, setSettings] = useState<Settings>(() => loadSettings());
  const [cursor, setCursor] = useState(restored?.cursor ?? INITIAL_CURSOR), [minutes, setMinutes] = useState(restored?.minutes ?? 15);
  const [playing, setPlaying] = useState(false), [replay, setReplay] = useState(restored?.replay ?? true), [choosing, setChoosing] = useState(false);
  /** 回放区间（秒）：起点/终点，null 表示不限制（专业回测的时间段控制）。 */
  const [replayFrom, setReplayFrom] = useState<number | null>(restored?.replayFrom ?? null);
  const [replayTo, setReplayTo] = useState<number | null>(restored?.replayTo ?? null);
  const [speed, setSpeed] = useState(restored?.speed ?? 1), [resetId, setResetId] = useState(0);
  const [tool, setTool] = useState<Tool>('cursor'), [history, setHistory] = useState<DrawingHistory>(() => restored?.drawings.length ? commit(emptyHistory(), restored.drawings) : emptyHistory());
  const [selected, setSelected] = useState<string | null>(null), [keep, setKeep] = useState(restored?.keep ?? false);
  const [hidden, setHidden] = useState(false), [locked, setLocked] = useState(false), [magnet, setMagnet] = useState(restored?.magnet ?? false);
  const [, setShowEma] = useState(true), [objectsOpen, setObjectsOpen] = useState(false);
  const [chartType, setChartType] = useState<ChartType>(restored?.chartType ?? 'candlestick'), [iconMark, setIconMark] = useState<string>(ICON_MARKS[0]);
  const [marketEvents, setMarketEvents] = useState<MarketEvent[]>(restored?.marketEvents ?? []);
  const [orderLog, setOrderLog] = useState<OrderAction[]>(restored?.orderLog ?? []);
  const [notes, setNotes] = useState<Note[]>(restored?.notes ?? []), [noteDraft, setNoteDraft] = useState('');
  /** 训练档案：每局「保留结果」落一条结构化战绩，跨场累计。 */
  const [archive, setArchive] = useState<ArchiveEntry[]>(() => sanitizeArchive(restored?.archive));
  const saved = settings.orderDefaults;
  const [quantity, setQuantity] = useState(restored?.quantity ?? saved.quantity ?? settings.defaultQty);
  const [orderType, setOrderType] = useState<TicketKind>(saved.orderType), [orderPrice, setOrderPrice] = useState('');
  const [orderSide, setOrderSide] = useState<'long' | 'short'>('long'), [reduceOnly, setReduceOnly] = useState(saved.reduceOnly);
  const [slPrice, setSlPrice] = useState(saved.sl), [tpPrice, setTpPrice] = useState(saved.tp), [trailPct, setTrailPct] = useState(saved.trail);
  const [protectOn, setProtectOn] = useState(saved.protectOn), [defaultsSaved, setDefaultsSaved] = useState(false);
  const [stepSize, setStepSize] = useState(1);
  const [presetName, setPresetName] = useState('');
  const [sessionResult, setSessionResult] = useState<{ stats: SessionStats; trade: TradeStats } | null>(null);
  const [tab, setTab] = useState<RecordTab>('orders'), [panelTab, setPanelTab] = useState<PanelTab>('trades');
  const [crosshair, setCrosshair] = useState<Candle | null>(null);
  /** 十字光标指针位置，用于跟手数值浮标。 */
  /** 十字光标位置（相对图表区）+ 图表区尺寸：浮标要按尺寸翻转，不能用魔法常量硬夹。 */
  const [cursorAt, setCursorAt] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [saveOpen, setSaveOpen] = useState(false), [layoutOpen, setLayoutOpen] = useState(false);
  /** 状态栏的快捷键速查浮层（不翻设置也能查到键位）。 */
  const [helpOpen, setHelpOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false), [settingsDraft, setSettingsDraft] = useState<Settings | null>(null), [searchOpen, setSearchOpen] = useState(false), [searchQuery, setSearchQuery] = useState('');
  const [source, setSource] = useState<'builtin' | 'binance'>('builtin');
  const [symbol, setSymbol] = useState(restored?.symbol ?? 'BTCUSDT'), [interval, setFeedInterval] = useState(restored?.interval ?? '15m');
  const [liveBars, setLiveBars] = useState<Candle[]>([]);
  const [feedState, setFeedState] = useState<FeedState>('idle'), [feedError, setFeedError] = useState('');
  /** Mirror of feedState readable from async handlers (state reads go stale across awaits). */
  const feedStateRef = useRef<FeedState>('idle'); feedStateRef.current = feedState;
  const [symbolList, setSymbolList] = useState<MarketSymbol[]>([]), [symbolLoading, setSymbolLoading] = useState(false);
  const [board, setBoard] = useState<Record<string, Ticker>>({});
  /** 自选列表输入框（添加品种时用）。 */
  const [watchDraft, setWatchDraft] = useState('');
  const [shell, setShell] = useState<{ mode: string; python: boolean } | null>(null);
  // 新存档（没有历史指标）直接给交易所默认形态：MA(5,10,20,60) + 成交量。
  const [indicators, setIndicators] = useState<IndicatorInstance[]>(() => restored ? sanitizeIndicators(restored.indicators) : defaultIndicatorInstances());
  const [pythons, setPythons] = useState<PythonInstance[]>(() => sanitizePythons(restored?.pythonIndicators));
  const [pythonRuns, setPythonRuns] = useState<Record<string, PythonRunState>>({});
  const [indicatorOpen, setIndicatorOpen] = useState(false), [indicatorEditId, setIndicatorEditId] = useState<string | null>(null), [pythonOpen, setPythonOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [paneHeights, setPaneHeights] = useState<Record<string, number>>({});
  /** 面板尺寸拖动：拖动中只改本地状态（跟手），松手再落盘，避免每次移动都写存档。 */
  const [drag, setDrag] = useState<{ kind: 'bottom' | 'drawer'; size: number } | null>(null);
  const ui = settings.ui;
  /** 拖动状态保存在 ref 里：pointerup 与 pointermove 落在同一帧时也要拿到最终尺寸（不依赖 React 状态）。 */
  const dragRef = useRef<{ kind: 'bottom' | 'drawer'; start: number; origin: number; size: number } | null>(null);
  /** 通用分栏拖拽：bottom 改高度（向上拖变大），drawer 改宽度（向左拖变大）。 */
  function startDrag(kind: 'bottom' | 'drawer', event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    // 合成事件/无活动指针时 setPointerCapture 会抛错，这里容错（真实拖拽仍走捕获）。
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* 忽略：仍能通过 move/up 完成拖动 */ }
    const origin = kind === 'bottom' ? ui.bottomHeight : ui.drawerWidth;
    dragRef.current = { kind, start: kind === 'bottom' ? event.clientY : event.clientX, origin, size: origin };
    setDrag({ kind, size: origin });
  }
  /** 拖动下单面板：浮动状态直接移动；从抽屉/底部拖动则自动变成浮动（交易所那种手感）。 */
  function beginPanelDrag(event: ReactPointerEvent<HTMLElement>, from: 'float' | 'drawer') {
    if ((event.target as HTMLElement | null)?.closest('button,input,select')) return;   // 别抢按钮的点击
    event.preventDefault();
    const startX = event.clientX, startY = event.clientY;
    const base = from === 'float' ? { ...floatAt } : { x: Math.max(8, startX - 200), y: Math.max(8, startY - 14) };
    const clamp = (value: number, max: number) => Math.max(6, Math.min(value, Math.max(6, max)));
    let moved = false;
    let latest = base;
    const move = (native: PointerEvent) => {
      const dx = native.clientX - startX, dy = native.clientY - startY;
      if (!moved) {
        if (Math.abs(dx) + Math.abs(dy) < 6) return;
        moved = true;
        if (from === 'drawer') { setTradePanel('float'); setFloatAt(base); latest = base; }
      }
      latest = { x: clamp(base.x + dx, window.innerWidth - 160), y: clamp(base.y + dy, window.innerHeight - 60) };
      setFloatAt(latest);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (!moved) return;
      setSettings(state => ({ ...state, ui: { ...state.ui, floatX: latest.x, floatY: latest.y } }));
      setHint('下单面板位置已记住（双击标题栏回到默认位置）。');
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }
  function moveDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const active = dragRef.current;
    if (!active) return;
    const delta = (active.kind === 'bottom' ? event.clientY : event.clientX) - active.start;
    const limits = active.kind === 'bottom' ? [MIN_BOTTOM_HEIGHT, MAX_BOTTOM_HEIGHT] : [MIN_DRAWER_WIDTH, MAX_DRAWER_WIDTH];
    const size = Math.min(limits[1], Math.max(limits[0], Math.round(active.origin - delta)));
    active.size = size;
    setDrag({ kind: active.kind, size });
  }
  function endDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const active = dragRef.current;
    dragRef.current = null;
    try { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* 忽略 */ }
    if (!active) { setDrag(null); return; }
    const size = active.size;
    setSettings(state => ({ ...state, ui: active.kind === 'bottom' ? { ...state.ui, bottomHeight: size } : { ...state.ui, drawerWidth: size } }));
    setDrag(null);
    setHint(active.kind === 'bottom' ? `底部面板高度已设为 ${size}px（双击分隔条恢复默认）。` : `交易面板宽度已设为 ${size}px（双击分隔条恢复默认）。`);
  }
  const bottomHeight = drag?.kind === 'bottom' ? drag.size : ui.bottomHeight;
  const drawerWidth = drag?.kind === 'drawer' ? drag.size : ui.drawerWidth;
  function resetPanel(kind: 'bottom' | 'drawer') {
    setSettings(state => ({ ...state, ui: kind === 'bottom' ? { ...state.ui, bottomHeight: DEFAULT_BOTTOM_HEIGHT } : { ...state.ui, drawerWidth: DEFAULT_DRAWER_WIDTH } }));
    setHint(kind === 'bottom' ? '底部面板高度已恢复默认。' : '交易面板宽度已恢复默认。');
  }
  /** 面板尺寸预设：不想一格一格拖的时候，直接选紧凑/标准/宽敞。 */
  const PANEL_SIZES = {
    compact: { bottom: 190, drawer: 300 },
    standard: { bottom: DEFAULT_BOTTOM_HEIGHT, drawer: DEFAULT_DRAWER_WIDTH },
    wide: { bottom: 460, drawer: 620 },
  } as const;
  function applyPanelSize(preset: keyof typeof PANEL_SIZES) {
    const size = PANEL_SIZES[preset];
    setSettings(state => ({ ...state, ui: { ...state.ui, bottomHeight: size.bottom, drawerWidth: size.drawer } }));
    setHint(`面板尺寸已设为「${preset === 'compact' ? '紧凑' : preset === 'wide' ? '宽敞' : '标准'}」：底部 ${size.bottom}px · 抽屉 ${size.drawer}px（仍可拖动微调）。`);
  }
  function setTradePanel(where: 'bottom' | 'right' | 'float' | 'hidden') {
    setSettings(state => ({ ...state, ui: { ...state.ui, tradePanel: where, bottomPanel: where !== 'hidden', lastTradePanel: where === 'hidden' ? state.ui.lastTradePanel : where } }));
    setHint(where === 'right' ? '交易面板已停靠到右侧抽屉（可拖左边框改宽）。' : where === 'bottom' ? '交易面板已停回底部（可拖上边框改高）。' : where === 'float' ? '下单面板已浮动：按住标题栏可拖动，双击标题栏回到默认位置。' : '交易面板已隐藏，可在「布局」菜单里恢复。');
  }
  /** 复盘模式：随时开一局，K线波动与成交量逐帧生长，结束时保留或删除结果。 */
  const [session, setSession] = useState<ReplaySession | null>(null);
  const [sessionPanel, setSessionPanel] = useState(true), [smooth, setSmooth] = useState(true), [fraction, setFraction] = useState(1);
  const [nowTick, setNowTick] = useState(() => Date.now());
  /** 加载请求令牌：每次打开数据集自增；异步结果落地前校验，避免被更早的请求覆盖。 */
  const requestRef = useRef(0);
  /** 已落地的数据集意图（品种|周期|市场）：只用于判断"用户是否真的换了数据集"。 */
  const appliedIntent = useRef('');
  /** 最近一次「开始复盘」的尝试结果（无头验证/自查用：started / waiting / refused-* 及当时的上下文）。 */
  const [sessionAttempt, setSessionAttempt] = useState('none');
  /** 浮动下单面板位置（拖动记忆）。 */
  const [floatAt, setFloatAt] = useState(() => ({ x: settings.ui.floatX, y: settings.ui.floatY }));
  /** 最近一次下单时刻：加载完成后的"就绪"提示不许盖掉刚下单的成交提示。 */
  const lastOrderAt = useRef(0);
  /** 当前图上的数据来源：本地历史 / 联网 / 内置样本（复盘定位：优先本地）。 */
  const [dataOrigin, setDataOrigin] = useState<'cache' | 'live' | 'builtin'>('live');
  /** 本地深历史缓存：当前品种的根数与总体占用（设置面板展示与清理）。 */
  const [cacheItems, setCacheItems] = useState<CachedDataset[]>([]);
  const [cacheBytes, setCacheBytes] = useState(0);
  /** 当前已加载的品种/周期（异步回调里判断是否还对应，避免串台）。 */
  const loadedKey = useRef('');
  /** 实时品种表是否已经成功取过（成功过就不再显示"正在获取"）。 */
  const futuresUniverseState = useRef({ fetchedAt: 0 });
  /** 当前分类与市场类型；分类决定品种清单与抓取链路。 */
  const [assetClass, setAssetClass] = useState<AssetClassId>('crypto-spot');
  const [marketKind, setMarketKind] = useState<MarketKind>('spot');
  const [futuresUniverse, setFuturesUniverse] = useState<Record<string, { symbol: string; base: string; quote: string }[]>>({});
  const [universeState, setUniverseState] = useState<'idle' | 'loading' | 'live' | 'snapshot'>('idle');
  /** 分类批量抓取的缓存：symbol → K线（本会话内即时切换）。 */
  const [barsCache, setBarsCache] = useState<Map<string, Candle[]>>(() => new Map());
  const [batch, setBatch] = useState<{ done: number; total: number; failed: string[] } | null>(null);
  /** 战绩库（累计统计与风格识别）。 */
  const [recordStore, setRecordStore] = useState<HistoryStore>(() => loadHistory());
  const [dashOpen, setDashOpen] = useState(false);
  /** 主题：亮/暗，作用于 <html data-theme>，CSS 与图表都跟着走。 */
  useEffect(() => { document.documentElement.dataset.theme = settings.theme; }, [settings.theme]);
  /** 回放区间选择器开关（自建日历，替代原生 datetime 弹窗）。 */
  const [rangeOpen, setRangeOpen] = useState(false);
  const fractionRef = useRef(1);
  const perf = useRef(createPerfMeter()).current;
  const [perfOpen, setPerfOpen] = useState(false), [perfSnapshot, setPerfSnapshot] = useState<PerfSnapshot>(() => perf.snapshot());
  const [hint, setHint] = useState(restored ? '已恢复本机存档：自动保存在本机；可导出项目文件。' : '选择绘图工具标注图表，或选择起点进行逐K回放。');
  const chart = useRef<ChartHandle>(null), crosshairRef = useRef<number | null>(null);
  /** 图表区 DOM：浮标翻转要用它的实时尺寸。 */
  const chartSection = useRef<HTMLElement | null>(null);
  const pyPending = useRef<{ candles: PythonCandles; items: PythonInstance[] } | null>(null);
  const pyTimer = useRef<number | null>(null);
  const live = source === 'binance';
  // 单位/币种必须跟随"当前品种"（原来取的是存档时的品种，换品种后会显示成旧品种，例如 BTC 显示成 BNB）。
  const baseSymbol = baseSymbolOf(live ? symbol : 'BTCUSDT');
  /** 真实资金费率（按 8h 边界查表），拿不到就退回配置常数。 */
  const [fundingRates, setFundingRates] = useState<Map<number, number> | null>(null);
  /** 当前资金费率 + 下次结算时间（永续实时口径）。 */
  const [premium, setPremium] = useState<{ rate: number; nextFundingTime: number } | null>(null);
  /** 预警浮层（新触发的几条，自动消失）。 */
  const [toasts, setToasts] = useState<IndicatorAlert[]>([]);
  const seenAlerts = useRef<Set<string>>(new Set());
  const lastBeep = useRef(0);
  /** 当前结算货币符号（复盘报告/CSV/笔记都用它）。 */
  const settleUnit = settings.sim.settle === 'coin' ? baseSymbol : 'USDT';
  const intervalMinutes = live ? intervalMinutesOf(interval) : minutes;
  const periodLabel = live ? intervalLabelOf(interval) : PERIODS.find(p => p.minutes === minutes)!.label;
  const builtinIndexed = useMemo(() => aggregateIndexed(HISTORY, minutes), [minutes]);
  const builtinAll = builtinIndexed.bars;
  const dataset = live ? liveBars : builtinAll;
  const dataLength = dataset.length;
  /** Cursor units: built-in mode counts minute bars, live mode counts native bars. */
  const maxCursor = live ? liveBars.length : HISTORY.length;
  const cursorNow = Math.max(Math.min(cursor, maxCursor), Math.min(MIN_CURSOR, maxCursor));
  const visibleBars = useMemo(() => {
    const view = live ? liveBars.slice(0, cursorNow) : revealedAggregate(builtinIndexed, HISTORY, cursorNow, minutes);
    // 波动播放：当前K线按内部价格路径逐帧生长，成交量同步累积（fraction === 1 即完整K线）。
    return fraction < 1 ? withFormingBar(view, fraction) : view;
  }, [live, liveBars, cursorNow, minutes, builtinIndexed, fraction]);
  const current = visibleBars[visibleBars.length - 1] ?? dataset[0];
  function barAt(index: number): Candle {
    if (live && liveBars.length) return liveBars[Math.min(Math.max(index, 0), liveBars.length - 1)];
    return HISTORY[Math.min(Math.max(index, 0), HISTORY.length - 1)];
  }
  const minute = barAt(cursorNow - 1);
  const derivationBars = live ? liveBars : HISTORY;
  /** 当前费率并入边界表：历史之外的那次结算也按真实费率走。 */
  const fundingTable = useMemo(() => {
    if (!premium) return fundingRates;
    const map = new Map(fundingRates ?? []);
    const boundary = Math.floor(premium.nextFundingTime / (8 * 3600)) * 8 * 3600;
    map.set(boundary, premium.rate);
    return map;
  }, [fundingRates, premium]);
  const derived = useMemo(() => derive(settings.sim, marketEvents, orderLog, derivationBars, cursorNow, fundingTable), [settings.sim, marketEvents, orderLog, derivationBars, cursorNow, fundingTable]);
  const account = derived.account, values = accountValues(account, current.close, settings.sim);
  /** 出场提示：强平 / 止损 / 止盈 成交后明确告知（此前强平悄悄发生，用户只看到仓位消失）。 */
  const lastExitRef = useRef(0);
  useEffect(() => {
    const fills = derived.fills;
    if (fills.length <= lastExitRef.current) { lastExitRef.current = fills.length; return; }
    const fresh = fills.slice(lastExitRef.current);
    lastExitRef.current = fills.length;
    const notable = fresh.find(fill => fill.reason === 'liquidation' || fill.reason === 'sl' || fill.reason === 'tp' || fill.reason === 'trail');
    if (!notable) return;
    const label = notable.reason === 'liquidation' ? '⚠️ 仓位已被强制平仓（爆仓）' : notable.reason === 'sl' ? '已触发止损' : notable.reason === 'tp' ? '已触发止盈' : '已触发跟踪止损';
    setSessionResult(current => current);
    setHint(`${label}：${notable.dir === 'long' ? '多' : '空'} ${qtyText(notable.qty)} @ ${priceText(notable.price, settings.sim.tickSize)} · 本笔 ${settleText(notable.realized ?? 0, settings.sim)}`);
  }, [derived.fills]);
  const tradeStatsNow = useMemo(() => tradeStats(derived.fills, derived.equityCurve, account.funding, account.liquidated), [derived.fills, derived.equityCurve, account.funding, account.liquidated]);
  const change = (current.close / current.open - 1) * 100;
  /** 回放区间换算成游标：起点决定"从哪根开始"，终点决定"到哪根停下"。 */
  const fromCursor = replayFrom === null ? MIN_CURSOR : (live ? cursorForTimeIn(liveBars, replayFrom) : cursorForTime(replayFrom));
  const toCursor = replayTo === null ? maxCursor : (live ? cursorForTimeIn(liveBars, replayTo) : cursorForTime(replayTo));
  const replayEnd = Math.max(Math.min(fromCursor + 1, maxCursor), Math.min(toCursor, maxCursor));
  const exhausted = cursorNow >= replayEnd;
  /** 区间进度：已回放根数 / 区间总根数。 */
  const rangeTotal = Math.max(1, replayEnd - fromCursor);
  const rangeDone = Math.max(0, Math.min(rangeTotal, cursorNow - fromCursor));
  const selectedDrawing = history.present.find(d => d.id === selected);
  const dataBar = crosshair ?? current;
  const dataChange = (dataBar.close / dataBar.open - 1) * 100;
  const working = derived.orders.filter(order => order.status === 'working');
  const settled = derived.orders.filter(order => order.status !== 'working').reverse();
  const records = derived.fills;
  /** 已平仓：按「开 → 平」配对。双向持仓下卖单可能是开空、买单可能是平空，不能按方向筛。 */
  const closedList = useMemo(() => closedTrades(derived.fills), [derived.fills]);
  const barTimeAt = (index: number) => barAt(index - 1).time;
  const dataStart = live && liveBars.length ? liveBars[0].time : HISTORY[0].time;
  const dataEnd = live && liveBars.length ? liveBars[liveBars.length - 1].time : HISTORY[HISTORY.length - 1].time;
  const minStartTime = live && liveBars.length ? liveBars[Math.min(MIN_CURSOR, liveBars.length) - 1].time : HISTORY[MIN_CURSOR - 1].time;
  const symbolMatches = symbolList.filter(entry => entry.symbol.toLowerCase().includes(searchQuery.trim().toLowerCase()) || entry.base.toLowerCase().includes(searchQuery.trim().toLowerCase())).slice(0, 80);
  const visibleCandles = useMemo<PythonCandles>(() => ({ t: visibleBars.map(bar => bar.time), o: visibleBars.map(bar => bar.open), h: visibleBars.map(bar => bar.high), l: visibleBars.map(bar => bar.low), c: visibleBars.map(bar => bar.close), v: visibleBars.map(bar => bar.volume) }), [visibleBars]);
  const indicatorOutputs = useMemo(() => {
    const started = performance.now();
    const list = indicators.map(instance => ({ instance, def: INDICATOR_MAP[instance.defId], out: computeIndicator(INDICATOR_MAP[instance.defId], visibleBars, instance.inputs) }));
    perf.indicators(performance.now() - started);
    return list;
  }, [indicators, visibleBars, perf]);
  const chartPlots = useMemo<ChartPlotSpec[]>(() => {
    const list: ChartPlotSpec[] = [];
    for (const { instance, def, out } of indicatorOutputs) { if (!instance.visible) continue; for (const plot of out.plots) list.push({ key: `${instance.id}:${plot.id}`, paneKey: instance.id, pane: def.pane, type: plot.type, data: plot.data, color: plot.color ?? '#2962ff', lineStyle: plot.lineStyle, colorBySign: plot.colorBy === 'sign', colorUp: plot.colorUp, colorDown: plot.colorDown }); }
    for (const item of pythons) {
      if (!item.visible) continue;
      const state = pythonRuns[item.id];
      if (!state?.ok || !state.result) continue;
      state.result.plots.forEach((plot, index) => list.push({ key: `py:${item.id}:${index}`, paneKey: `py:${item.id}`, pane: state.result?.pane === 'sub' ? 'sub' : 'main', type: plot.type, data: plot.data ?? [], color: plot.color ?? '#7b61ff' }));
    }
    return list;
  }, [indicatorOutputs, pythons, pythonRuns]);
  const chartLevels = useMemo<ChartLevelSpec[]>(() => {
    const list: ChartLevelSpec[] = [];
    for (const { instance, def, out } of indicatorOutputs) { if (!instance.visible) continue; for (const level of out.levels ?? []) list.push({ paneKey: instance.id, pane: def.pane, value: level.value, color: level.color, title: level.title }); }
    for (const item of pythons) { const state = pythonRuns[item.id]; if (!state?.ok || !state.result?.levels) continue; for (const level of state.result.levels) list.push({ paneKey: `py:${item.id}`, pane: state.result?.pane === 'sub' ? 'sub' : 'main', value: level.value, color: level.color, title: level.title }); }
    return list;
  }, [indicatorOutputs, pythons, pythonRuns]);
  /** 光标所在K线的下标：图例数值跟着光标走（没有光标时显示最新值）。 */
  const crosshairIndex = useMemo(() => crosshair ? visibleBars.findIndex(bar => bar.time === crosshair.time) : -1, [crosshair, visibleBars]);
  /** 指标预警：水平位穿越 + 双线金叉/死叉，只算已揭示的K线；图上最多标最近 60 条。 */
  const alerts = useMemo<IndicatorAlert[]>(() => {
    const list: IndicatorAlert[] = [];
    for (const { instance, def, out } of indicatorOutputs) {
      if (!instance.visible || instance.alerts === false) continue;
      list.push(...indicatorAlerts(def, out, visibleBars, instance.id, true));
    }
    return list.sort((a, b) => a.time - b.time).slice(-MAX_CHART_ALERTS);
  }, [indicatorOutputs, visibleBars]);
  const chartLegends = useMemo<ChartLegendSpec[]>(() => {
    const list: ChartLegendSpec[] = [];
    /** 光标处优先，否则取最后一个有限值（交易所图例口径）。 */
    const lastValue = (data: (number | null)[]) => { const value = valueAt(data, crosshairIndex); return value === null ? null : Number(value.toFixed(2)); };
    const textOf = (value: number | null) => value === null ? '—' : String(value);
    const instanceById = (id: string) => indicators.find(entry => entry.id === id);
    for (const { instance, def, out } of indicatorOutputs) {
      list.push({
        paneKey: instance.id, pane: def.pane, title: def.name, color: out.plots[0]?.color,
        plots: out.plots.map(plot => ({ id: plot.id, title: plot.title, text: textOf(lastValue(plot.data)), color: plot.color })),
        visible: instance.visible, heightFactor: paneHeights[instance.id] ?? DEFAULT_PANE_HEIGHT,
        onToggle: () => setIndicators(items => items.map(entry => entry.id === instance.id ? { ...entry, visible: !entry.visible } : entry)),
        onEdit: () => openIndicatorEdit(instance.id),
        onRemove: () => { setIndicators(items => items.filter(entry => entry.id !== instance.id)); setHint(`已移除指标 ${def.name}。`); },
        alertsOn: supportsAlerts(def) ? instance.alerts !== false : undefined,
        alertCount: alerts.filter(alert => alert.instanceId === instance.id).length,
        onAlerts: supportsAlerts(def) ? () => setIndicators(items => items.map(entry => entry.id === instance.id ? { ...entry, alerts: entry.alerts === false } : entry)) : undefined,
        // 循环起点必须等于图例显示的默认高度，否则第一次点 ⇕ 会把副图缩到比当前更矮。
        onHeight: () => setPaneHeights(current => ({ ...current, [instance.id]: nextHeight(current[instance.id] ?? DEFAULT_PANE_HEIGHT) })),
      });
    }
    for (const item of pythons) {
      const state = pythonRuns[item.id];
      if (!state?.ok || !state.result?.plots?.length) continue;
      list.push({
        paneKey: `py:${item.id}`, pane: state.result?.pane === 'sub' ? 'sub' : 'main', title: item.file.replace(/\.py$/, ''),
        plots: state.result.plots.map((plot, index) => ({ id: `py${index}`, title: plot.title, text: textOf(lastValue(plot.data ?? [])), color: plot.color })),
        visible: item.visible,
        onToggle: () => setPythons(items => items.map(entry => entry.id === item.id ? { ...entry, visible: !entry.visible } : entry)),
        onRemove: () => { setPythons(items => items.filter(entry => entry.id !== item.id)); setHint('已移除 Python 指标。'); },
      });
    }
    return list;
  }, [indicatorOutputs, pythons, pythonRuns, indicators, paneHeights, crosshairIndex]);
  const paneOrder = useMemo(() => Array.from(new Set(chartPlots.filter(plot => plot.pane === 'sub').map(plot => plot.paneKey))), [chartPlots]);
  const project: ProjectV1 = useMemo(() => ({
    version: 1, savedAt: Date.now(), cursor, minutes, speed, replay, showEma: true, keep, magnet, chartType, quantity, source, symbol, interval, replayFrom, replayTo,
    indicators, pythonIndicators: pythons,
    archive,
    drawings: history.present, marketEvents, orderLog, notes,
  }), [cursor, minutes, speed, replay, keep, magnet, chartType, quantity, source, symbol, interval, indicators, pythons, archive, history.present, marketEvents, orderLog, notes]);

  /** 复盘回放：按帧推进。波动播放开启时当前K线在 1/speed 秒内走完 open→极值→极值→close 路径，
   *  成交量同步累积，走完一根才前进游标；关闭时整根跳变（与手动步进一致）。
   *  另外带一个保底定时器：窗口被遮挡/最小化时 WebKit 会暂停 requestAnimationFrame，
   *  没有它回放会莫名停住。 */
  useEffect(() => {
    if (!playing || exhausted || choosing || !replay) return;
    const perBar = 1000 / Math.max(speed, MIN_REPLAY_SPEED);
    let frame = 0, previous = performance.now(), pending = 0, lastTick = previous;
    const advance = () => setCursor(value => live ? stepBars(Math.min(value, liveBars.length), liveBars.length, 1) : stepCursor(value, minutes, 1));
    const step = (now: number) => {
      const elapsed = Math.min(now - previous, 250); previous = now;
      if (smooth) {
        let progress = fractionRef.current + elapsed / perBar;
        while (progress >= 1) { progress -= 1; pending += 1; }
        if (pending) { for (let i = 0; i < Math.min(pending, 240); i++) advance(); pending = 0; }
        fractionRef.current = progress;
        setFraction(progress);
      } else {
        pending += elapsed;
        const steps = Math.min(Math.floor(pending / perBar), 240);
        if (steps > 0) { pending -= steps * perBar; for (let i = 0; i < steps; i++) advance(); }
        if (fractionRef.current !== 1) { fractionRef.current = 1; setFraction(1); }
      }
    };
    const tick = (now: number) => { lastTick = now; step(now); frame = requestAnimationFrame(tick); };
    frame = requestAnimationFrame(tick);
    const watchdog = window.setInterval(() => {
      const now = performance.now();
      if (now - lastTick < 250) return;   // rAF 正常在跑，不用兜底
      lastTick = now;
      step(now);
    }, 120);
    return () => { cancelAnimationFrame(frame); window.clearInterval(watchdog); };
  }, [playing, exhausted, choosing, replay, minutes, speed, live, liveBars.length, smooth]);
  /** One render frame sample per paint, plus the rolling panel refresh. */
  useEffect(() => { perf.frame(performance.now()); });
  useEffect(() => {
    if (!perfOpen) return;
    const timer = window.setInterval(() => setPerfSnapshot(perf.snapshot()), 500);
    return () => window.clearInterval(timer);
  }, [perfOpen, perf]);
  useEffect(() => { if (exhausted) setPlaying(false); }, [exhausted]);
  /** 复盘跑到数据末尾：自动收尾，弹出保留／删除。 */
  useEffect(() => {
    if (exhausted && session && !sessionResult) finishSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exhausted, session, sessionResult]);
  useEffect(() => { saveSettings(settings); }, [settings]);
  useEffect(() => { saveHistory(recordStore); }, [recordStore]);
  /** 复盘会话心跳：进行中每秒刷新计时与统计，否则 15 秒。 */
  useEffect(() => {
    const timer = window.setInterval(() => setNowTick(Date.now()), session ? 1000 : 15_000);
    return () => window.clearInterval(timer);
  }, [session]);
  /** Debounced autosave: every state change rewrites the project 800ms after it settles. */
  useEffect(() => {
    if (!settings.autosave) return;
    const base = { ...project, marketKind };
    const payload = settings.rememberRange ? base : { ...base, replayFrom: null, replayTo: null };
    const timer = window.setTimeout(() => { saveProject(payload); }, 800);
    return () => window.clearTimeout(timer);
  }, [project, settings.autosave]);
  /** Auto-connect on open: probe the shell and pull the live market (settings.autoFeed can disable). */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const info = await shellInfo();
      if (cancelled) return;
      setShell(info);
      if (info?.mode === 'mac-app') void refreshCacheInfo();
      if (settings.autoFeed === false) return;
      const keepLog = restored?.source === 'binance';
      await loadLive(restored?.symbol ?? 'BTCUSDT', restored?.interval ?? '15m', keepLog ? { keepLog: true, restoreCursor: restored?.cursor, kind: restored?.marketKind } : { kind: restored?.marketKind });
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  /** 真实资金费率：拉到就按历史费率结算，拉不到继续用配置常数。 */
  useEffect(() => {
    if (!live) { setFundingRates(null); setPremium(null); return; }
    let alive = true;
    void fetchFundingRates(symbol, undefined, 1000).then(rates => {
      if (!alive || !rates.length) return;
      const map = fundingByBoundary(rates);
      setFundingRates(map);
    }).catch(() => { /* 资金费率是增强项，失败就沿用配置值 */ });
    void fetchPremiumIndex(symbol).then(index => { if (alive && index) setPremium(index); }).catch(() => { /* 实时费率可选 */ });
    return () => { alive = false; };
  }, [live, symbol]);
  /** 预警提示：新的提醒触发浮层，可选提示音（WebAudio，无外部依赖）。 */
  useEffect(() => {
    const fresh = alerts.filter(alert => !seenAlerts.current.has(alert.key));
    if (!fresh.length) return;
    for (const alert of fresh) seenAlerts.current.add(alert.key);
    if (seenAlerts.current.size > 400) seenAlerts.current = new Set(alerts.slice(-200).map(alert => alert.key));
    if (settings.alertsToast) {
      setToasts(current => [...current, ...fresh].slice(-4));
      window.setTimeout(() => setToasts(current => current.filter(alert => !fresh.includes(alert))), 4200);
    }
    if (settings.alertsSound && Date.now() - lastBeep.current > 1200) {
      lastBeep.current = Date.now();
      try {
        const Ctor = (globalThis as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext
          ?? (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (Ctor) {
          const ctx = new Ctor();
          const oscillator = ctx.createOscillator(), gain = ctx.createGain();
          oscillator.type = 'sine';
          oscillator.frequency.value = fresh[0].kind === 'over-sold' || fresh[0].kind === 'golden' ? 880 : 520;
          gain.gain.setValueAtTime(.0001, ctx.currentTime);
          gain.gain.exponentialRampToValueAtTime(.12, ctx.currentTime + .02);
          gain.gain.exponentialRampToValueAtTime(.0001, ctx.currentTime + .28);
          oscillator.connect(gain); gain.connect(ctx.destination);
          oscillator.start(); oscillator.stop(ctx.currentTime + .3);
          window.setTimeout(() => void ctx.close(), 600);
        }
      } catch { /* 声音失败不影响预警 */ }
    }
  }, [alerts, settings.alertsToast, settings.alertsSound]);
  /** Live quote polling for the watchlist while it is open. */
  useEffect(() => {
    if (!settings.ui.watchlist || !live) return;
    let alive = true;
    // 自选列表由用户维护；当前品种始终并入轮询，切过去就有报价。
    const symbols = Array.from(new Set([...settings.watchlist, symbol]));
    const refresh = () => { void fetchTickers(symbols).then(list => {
      if (!alive) return;
      setBoard(prev => { const next = { ...prev }; for (const ticker of list) next[ticker.symbol] = ticker; return next; });
    }).catch(() => { /* quotes are optional */ }); };
    refresh();
    const timer = window.setInterval(refresh, 12_000);
    return () => { alive = false; window.clearInterval(timer); };
  }, [settings.ui.watchlist, settings.watchlist, live, symbol]);
  /** Max-wait throttled Python recompute: runs in the macOS shell and never starves mid-playback. */
  useEffect(() => {
    if (!pythons.length || !shell?.python) return;
    pyPending.current = { candles: visibleCandles, items: pythons };
    if (pyTimer.current !== null) return;
    pyTimer.current = window.setTimeout(() => {
      pyTimer.current = null;
      const job = pyPending.current; if (!job) return;
      void (async () => {
        const next: Record<string, PythonRunState> = {};
        for (const item of job.items) {
          if (!item.visible) continue;
          try {
            const response = await bridgePythonRun({ file: item.file, params: item.params, candles: job.candles });
            next[item.id] = response.ok ? { ok: true, result: response.result } : { ok: false, error: response.error };
          } catch (error) { next[item.id] = { ok: false, error: messageOf(error) }; }
        }
        setPythonRuns(next);
      })();
    }, 500);
  }, [pythons, visibleCandles, shell?.python]);
  useEffect(() => () => { if (pyTimer.current !== null) window.clearTimeout(pyTimer.current); }, []);
  useEffect(() => {
    if (!saveOpen && !layoutOpen && !helpOpen) return;
    const outside = (event: PointerEvent) => { if (!(event.target as HTMLElement).closest('.menu-host,.popup-menu,.hotkey-link')) { setSaveOpen(false); setLayoutOpen(false); setHelpOpen(false); } };
    window.addEventListener('pointerdown', outside);
    return () => window.removeEventListener('pointerdown', outside);
  }, [saveOpen, layoutOpen, helpOpen]);
  /** 快捷键：handler 每次渲染重建（读到最新状态），监听器只注册一次并转发到它。 */
  const hotkeyRef = useRef<(event: KeyboardEvent) => void>(() => {});
  const handleHotkey = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement | null;
    const editable = typeof target?.closest === 'function' && target.closest('input,textarea,select,[contenteditable=true]') !== null;
    const action = hotkeyAction(event, {
      editable, selected: selected !== null, locked,
      panel: ui.tradePanel, lastPanel: ui.lastTradePanel, choosing, replay,
    });
    if (!action) return;
    // 除了 Esc（浏览器/系统还要用它），其余按键都由应用接管，挡掉浏览器默认行为。
    if (action.kind !== 'escape') event.preventDefault();
    switch (action.kind) {
      case 'escape':
        setTool('cursor'); setSelected(null); setChoosing(false); setSaveOpen(false); setLayoutOpen(false);
        setSettingsOpen(false); setSearchOpen(false); setIndicatorOpen(false); setPythonOpen(false); setArchiveOpen(false); setResetId(n => n + 1);
        setHelpOpen(false);
        return;
      case 'delete-selected':
        setHistory(h => commit(h, h.present.filter(d => d.id !== selected))); setSelected(null); return;
      case 'undo': case 'redo':
        setHistory(action.kind === 'redo' ? redo : undo); setSelected(null); setTool('cursor'); return;
      case 'toggle-panel': setTradePanel(togglePanel(ui.tradePanel, ui.lastTradePanel)); return;
      case 'cycle-panel': setTradePanel(cyclePanel(ui.tradePanel)); return;
      case 'open-long': submit('open-long', 'market'); return;
      case 'open-short': submit('open-short', 'market'); return;
      case 'close-position': submit('close', 'market'); return;
      case 'reverse': submit('reverse', 'market'); return;
      case 'toggle-play': setPlaying(value => !value); return;
      case 'step': step(action.direction); return;
    }
  };
  // 提交后再同步 ref（不在渲染期写 ref），监听器永远拿到最新一版 handler。
  useEffect(() => { hotkeyRef.current = handleHotkey; });
  useEffect(() => {
    const listener = (event: KeyboardEvent) => hotkeyRef.current(event);
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);
  /** 指标系统：收藏、模板铺开、从图例齿轮直接改参。 */
  const toggleFavorite = (defId: string) => setSettings(state => ({ ...state, favorites: state.favorites.includes(defId) ? state.favorites.filter(entry => entry !== defId) : [...state.favorites, defId].slice(0, 24) }));
  function openIndicatorEdit(id: string) { setIndicatorEditId(id); setIndicatorOpen(true); setPlaying(false); }
  function applyTemplate(templateId: string) {
    const template = templateById(templateId);
    if (!template) return;
    const spec = sanitizeIndicators(templateInstances(template, indicators.length));
    setIndicators(list => [...list.filter(entry => !spec.some(added => added.defId === entry.defId)), ...spec]);
    setIndicatorEditId(null);
    setHint(`已套用「${template.name}」模板：${template.items.map(item => INDICATOR_MAP[item.defId]?.name ?? item.defId).join('、')}。`);
  }
  function toggleUi(key: UiKey) { setSettings(state => ({ ...state, ui: { ...state.ui, [key]: !state.ui[key] } })); }
  function selectTool(next: Tool) {
    setTool(next); setPlaying(false); setSelected(null); setChoosing(false); setHidden(false);
    if (next !== 'cursor') setLocked(false);
    setHint(toolHints[next] ?? `${TOOL_NAMES[next]}：点击放置；两点图形支持两次点击或按住拖动。Esc 取消。`);
  }
  function addDrawing(d: Drawing) { setHistory(h => commit(h, [...h.present, d])); setSelected(d.id); if (!keep) setTool('cursor'); setHint(`${TOOL_NAMES[d.kind]}已绘制：拖动修改，Delete 删除，Ctrl+Z 撤销。`); }
  function updateDrawing(d: Drawing) { setHistory(h => commit(h, h.present.map(old => old.id === d.id ? d : old))); }
  function deleteSelected() { if (!locked && selected) { setHistory(h => commit(h, h.present.filter(d => d.id !== selected))); setSelected(null); } }
  function step(direction: 1 | -1) {
    setPlaying(false); setChoosing(false);
    if (stepSize > 1) {
      const next = fractionRef.current + direction / stepSize;
      if (next > 0 && next < 1) { fractionRef.current = next; setFraction(next); return; }
    }
    fractionRef.current = 1; setFraction(1);
    setCursor(value => live
      ? stepBars(Math.min(value, liveBars.length), liveBars.length, direction)
      : stepCursor(value, minutes, direction));
  }
  /** Restarting or picking a new start drops the trade log; drawings and notes stay. */
  function clearTrades() { setMarketEvents([]); setOrderLog([]); }
  function pickStart(time: number) {
    const next = live ? cursorForTimeIn(liveBars, time) : cursorForTime(time);
    setCursor(next); setReplay(true); setChoosing(false); setPlaying(false); clearTrades(); setTool('cursor'); setSelected(null); setResetId(n => n + 1);
    setReplayFrom(barAt(next - 1).time);
    if (replayTo === null || replayTo <= barAt(next - 1).time) setReplayTo(live && liveBars.length ? liveBars[liveBars.length - 1].time : HISTORY[HISTORY.length - 1].time);
    setHint(`回放起点已设为 ${chartTime(barAt(next - 1).time, true)}；未来K线已隐藏，模拟交易记录已清空。可在控制台调整区间与速度。`);
  }
  /** 应用回放区间（起止时间）：游标落到起点，交易清空，与手动选起点一致。 */
  function applyRange(from: number | null, to: number | null) {
    const clampFrom = from === null ? null : Math.max(minStartTime, Math.min(from, dataEnd));
    const clampTo = to === null ? null : Math.max(minStartTime, Math.min(to, dataEnd));
    if (clampFrom !== null && clampTo !== null && clampFrom >= clampTo) { setHint('回放区间无效：开始时间必须早于结束时间。'); return; }
    setReplayFrom(clampFrom); setReplayTo(clampTo);
    const startAt = clampFrom ?? minStartTime;
    const next = live ? cursorForTimeIn(liveBars, startAt) : cursorForTime(startAt);
    setCursor(Math.max(MIN_CURSOR, next)); setReplay(true); setChoosing(false); setPlaying(false); clearTrades(); setResetId(n => n + 1);
    const bars = clampTo === null ? maxCursor - next : (live ? cursorForTimeIn(liveBars, clampTo) : cursorForTime(clampTo)) - next;
    setHint(`回放区间已设为 ${chartTime(startAt, true)} → ${clampTo === null ? '数据末尾' : chartTime(clampTo, true)}（约 ${Math.max(1, bars)} 根）；模拟交易记录已清空。`);
  }
  /** 快捷区间：最近 N 根 / 全部。 */
  function quickRange(count: number | null) {
    if (count === null) { applyRange(null, null); return; }
    const end = live && liveBars.length ? liveBars[liveBars.length - 1].time : HISTORY[HISTORY.length - 1].time;
    const startCursor = Math.max(MIN_CURSOR, maxCursor - count);
    applyRange(barAtQuiet(startCursor - 1), end);
  }
  /** barAt 的"安静版"：只取时间，不触发副作用（用于区间换算）。 */
  function barAtQuiet(index: number): number {
    const bars = live ? liveBars : HISTORY;
    const safe = Math.max(0, Math.min(index, Math.max(0, bars.length - 1)));
    return bars[safe]?.time ?? 0;
  }
  function chooseStart() {
    setReplay(true); setPlaying(false); setChoosing(value => !value); setTool('cursor'); setSelected(null); setResetId(n => n + 1);
    setHint('点击一根K线作为起点；右侧行情将在选定后隐藏。重新选起点会清空模拟交易记录；Esc 取消。');
  }
  /** 按市场类型取K线（现货 / USDT 永续 / 外汇日线）。 */
  async function fetchBarsFor(forSymbol: string, forInterval: string, kind: MarketKind, limit = 1500, startTime?: number): Promise<Candle[]> {
    if (kind === 'fx') {
      const pair = FOREX_INSTRUMENTS.find(item => item.symbol === forSymbol);
      const parsed = pair ?? parseFxPairAny(forSymbol);
      if (!parsed) throw new Error('不是有效的外汇对');
      return fetchFxDaily(parsed.base, parsed.quote);
    }
    return fetchKlines({ symbol: forSymbol, interval: forInterval, limit, startTime, market: kind === 'futures' ? 'futures' : 'spot' });
  }
  async function loadLive(nextSymbol: string, nextInterval: string, options: { keepLog?: boolean; restoreCursor?: number; kind?: MarketKind } = {}) {
    setHint(`正在打开 ${nextSymbol} · ${intervalLabelOf(nextInterval)} …`);
    const attempts: MarketKind[] = [];
    for (const candidate of [options.kind ?? 'spot', marketKindOf(nextSymbol), 'spot', 'futures', 'fx'] as MarketKind[]) {
      if (!attempts.includes(candidate)) attempts.push(candidate);
    }
    for (const candidate of attempts) {
      if (await openDataset(nextSymbol, nextInterval, candidate, options)) {
        if (candidate !== attempts[0]) setHint(`已自动改用${candidate === 'futures' ? '合约' : candidate === 'fx' ? '外汇' : '现货'}数据打开 ${nextSymbol}。`);
        return;
      }
    }
    useBuiltinSnapshot();
    setDataOrigin('builtin');
    setHint(`${nextSymbol} 暂时取不到行情（网络不通且本地无历史）：已切到内置历史样本，可继续复盘；网络恢复后点「刷新最新」接入。`);
  }
  async function loadOlder() {
    if (!live || !liveBars.length || feedState === 'loading') return;
    setFeedState('loading'); setFeedError('');
    try {
      const oldest = liveBars[0].time;
      if (marketKind === 'fx') { setFeedState('live'); setHint('外汇为日线序列，没有更早的分页数据。'); return; }
      // 一次多取一些：按块 1 万根（原来 1000 根，深度太浅）；市场类型跟随当前品种。
      const more = await fetchKlines({ symbol, interval, limit: HISTORY_CHUNK, endTime: oldest * 1000 - 1, market: marketKind === 'futures' ? 'futures' : 'spot' });
      const seen = new Set(liveBars.map(bar => bar.time));
      const fresh = more.filter(bar => !seen.has(bar.time) && bar.time < oldest);
      if (!fresh.length) { setFeedState('live'); setHint('已到达 Binance 提供的历史边界。'); return; }
      setLiveBars(prev => [...fresh, ...prev]);
      if (!session) setCursor(value => Math.min(value + fresh.length, liveBars.length + fresh.length));
      setFeedState('live'); setResetId(n => n + 1);
      void saveLocalCache(symbol, interval, [...fresh, ...liveBars], marketKind);
      setHint(`已向更早载入 ${fresh.length} 根K线（当前共 ${liveBars.length + fresh.length} 根，最早 ${chartTime(fresh[0].time, true)}）。`);
    } catch (error) { setFeedState('error'); setFeedError(messageOf(error)); setHint(`载入更早失败：${messageOf(error)}`); }
  }
  /** 抓取全部历史：从最早一根继续向前翻，直到交易所没有更早数据或达到上限。 */
  async function fetchAllHistory() {
    if (!live || !liveBars.length || feedState === 'loading') return;
    setFeedState('loading'); setFeedError('');
    let bars = liveBars;
    let rounds = 0, empty = 0;
    setHint(`开始抓取 ${symbol} · ${intervalLabelOf(interval)} 的全部历史…`);
    try {
      if (marketKind === 'fx') { setFeedState('live'); setHint('外汇为日线序列，已含全部历史（无需抓取）。'); return; }
      while (rounds < 40 && bars.length < MAX_KLINES) {
        const oldest = bars[0].time;
        const more = await fetchKlines({ symbol, interval, limit: HISTORY_CHUNK, endTime: oldest * 1000 - 1, market: marketKind === 'futures' ? 'futures' : 'spot' });
        const seen = new Set(bars.map(bar => bar.time));
        const fresh = more.filter(bar => !seen.has(bar.time) && bar.time < oldest).sort((left, right) => left.time - right.time);
        rounds++;
        if (!fresh.length) { empty++; if (empty >= 2) break; continue; }
        empty = 0;
        bars = [...fresh, ...bars];
        setLiveBars(bars);
        setHint(`抓取中：已 ${bars.length} 根，最早 ${chartTime(bars[0].time, true)}…`);
        await new Promise(resolve => window.setTimeout(resolve, 0));
      }
      if (!session) setCursor(value => Math.min(value + (bars.length - liveBars.length), bars.length));
      setFeedState('live'); setResetId(n => n + 1);
      void saveLocalCache(symbol, interval, bars, marketKind);
      setHint(`历史抓取完成：${bars.length} 根 ${intervalLabelOf(interval)}，覆盖 ${chartTime(bars[0].time, true)} → ${chartTime(bars[bars.length - 1].time, true)}${bars.length >= MAX_KLINES ? `（已达上限 ${MAX_KLINES} 根）` : '（已到交易所历史起点）'}。`);
    } catch (error) { setFeedState('error'); setFeedError(messageOf(error)); setHint(`历史抓取中断：${messageOf(error)}（已保留 ${bars.length} 根）`); }
  }
  /** 统一落地：把一份K线装进界面（品种/周期/市场/游标/重载/来源标记）。 */
  function applyDataset(forSymbol: string, forInterval: string, kind: MarketKind, bars: Candle[], options: { keepLog?: boolean; restoreCursor?: number; origin: 'cache' | 'live' | 'builtin' }) {
    setLiveBars(bars);
    setSymbol(forSymbol); setFeedInterval(forInterval); setMarketKind(kind); setSource('binance');
    setDataOrigin(options.origin);
    setCursor(current => cursorAfterApply({ barCount: bars.length, current, restore: options.restoreCursor, session: session !== null, min: MIN_CURSOR }));
    // 关键：同一份数据落地（首次加载 / 后台补齐 / 重复落地）绝不能清掉用户刚下的单，
    // 否则用户在"正在加载"时点开仓 → 订单被随后的落地清空 → 表现为"点开仓没反应"。
    // 只有"用户主动换了品种/周期/市场"才清空记录。此前是按已加载数据判断，
    // 于是"占位样本 → 真实数据落地"也会被判成切换，把刚开的仓默默清掉（用户："开空自己会平仓"）。
    const intentNow = intentKey(intentOf(forSymbol, forInterval, kind));
    const switched = isUserSwitch(appliedIntent.current, intentNow);
    appliedIntent.current = intentNow;
    loadedKey.current = `${forSymbol}|${forInterval}`;
    // 回放区间按"时间"记忆：换了品种/周期后，老区间映射到新数据集上可能只剩末尾几根，
    // 表现为"一点复盘就已经是结果"。跨度小得离谱就直接退回全区间（等价于没设过区间）。
    const fit = rangeFits({ bars, from: replayFrom, to: replayTo, cursorAt: time => cursorForTimeIn(bars, time) });
    if (replayFrom !== null && replayTo !== null && !fit.fits) {
      setReplayFrom(null); setReplayTo(null);
      if (Date.now() - lastOrderAt.current > 3000) setHint(`数据已切换为 ${forSymbol}：原回放区间在新数据上只剩 ${Math.max(0, fit.span)} 根，已自动回到全区间。`);
    }
    if (!options.keepLog && !session && switched) clearTrades();
    setResetId(n => n + 1); setFeedState('live');
  }

  /** 本地历史优先（复盘定位）：有本地历史立刻开图，再后台补齐最新；没有才联网全量。 */
  async function openDataset(forSymbol: string, forInterval: string, kind: MarketKind, options: { keepLog?: boolean; restoreCursor?: number } = {}): Promise<boolean> {
    // 每次打开都领一个令牌：异步结果落地前必须校验，否则早发出的请求后落地会覆盖新请求
    // （实测症状：状态里 symbol=BTCUSDT、图上是另一个品种的价格）。
    const token = ++requestRef.current;
    setPlaying(false); setChoosing(false); setFeedState('loading'); setFeedError('');
    const shellReady = (await shellInfo())?.mode === 'mac-app';
    if (isStaleRequest(requestRef.current, token)) return false;
    let cached: Candle[] = [];
    if (shellReady) { try { cached = fromRows(await historyLoad(forSymbol, forInterval, kind)); } catch { cached = []; } }
    if (isStaleRequest(requestRef.current, token)) return false;
    if (planLaunchLoad(cached).mode === 'cache-first') {
      applyDataset(forSymbol, forInterval, kind, cached, { ...options, origin: 'cache' });
      setBarsCache(current => new Map(current).set(`${kind}|${forSymbol}`, cached));
      if (Date.now() - lastOrderAt.current > 3000) setHint(`本地历史 ${cached.length} 根（${chartTime(cached[0].time, true)} → ${chartTime(cached[cached.length - 1].time, true)}）已就绪 · 正在后台补齐最新…`);
      void topUpHistory(forSymbol, forInterval, kind, cached, token);
      return true;
    }
    try {
      const bars = await fetchBarsFor(forSymbol, forInterval, kind, 1500);
      if (isStaleRequest(requestRef.current, token)) return false;   // 已有更新的请求：丢弃这次结果
      if (!bars.length) throw new Error('未返回K线数据');
      applyDataset(forSymbol, forInterval, kind, bars, { ...options, origin: 'live' });
      setBarsCache(current => new Map(current).set(`${kind}|${forSymbol}`, bars));
      if (shellReady) void saveLocalCache(forSymbol, forInterval, bars, kind);
      return true;
    } catch { return false; }   // 交给上层：换市场重试，或退回内置样本
  }

  /** 后台增量补齐：只取本地历史之后的新K线，合并落盘；失败不打扰复盘。 */
  async function topUpHistory(forSymbol: string, forInterval: string, kind: MarketKind, base: Candle[], token = requestRef.current) {
    try {
      const fresh = await fetchBarsFor(forSymbol, forInterval, kind, 2000, base[base.length - 1].time + 1);
      if (isStaleRequest(requestRef.current, token)) return;   // 期间已有更新的请求：补齐结果作废
      if (!fresh.length) { if (Date.now() - lastOrderAt.current > 3000) setHint(`本地历史已是最新（${chartTime(base[base.length - 1].time, true)}）· 共 ${base.length} 根。`); return; }
      const merged = mergeCandles(base, fresh);
      if (loadedKey.current !== `${forSymbol}|${forInterval}`) return;
      setLiveBars(merged); setResetId(n => n + 1); setDataOrigin('live');
      void saveLocalCache(forSymbol, forInterval, merged, kind);
      if (Date.now() - lastOrderAt.current > 3000) setHint(`已补齐最新 ${fresh.length} 根（共 ${merged.length} 根，最新 ${chartTime(merged[merged.length - 1].time, true)}）。`);
    } catch (error) {
      setHint(`离线模式：本地历史 ${base.length} 根可用（补齐失败：${messageOf(error)}）——复盘不受影响。`);
    }
  }

  /** 按分类加载品种：现货 / USDT 永续 / 外汇日线，并记忆市场类型。 */
  async function loadInstrument(entry: { symbol: string; base: string; quote: string }, kind: MarketKind, intervalOverride?: string) {
    // 复盘进行中：数据集是这次复盘的基线，换品种会让持仓/成交串到新品种上，必须先结束复盘。
    if (session && entry.symbol !== symbol) {
      setSearchOpen(false);
      setHint(`复盘进行中（${symbol}）：请先在复盘面板点「结束复盘」再切换品种，否则持仓与成交会串到新品种。`);
      return;
    }
    setSearchOpen(false);
    const ok = await openDataset(entry.symbol, kind === 'fx' ? '1d' : (intervalOverride ?? interval), kind);
    if (!ok) {
      setFeedState('error');
      setHint(`${entry.symbol} 本地没有历史且联网取不到：联网抓一次即可（点「刷新最新」重试），其间可继续用内置样本复盘。`);
      return;
    }
    const ownedClass = [...COMMODITY_INSTRUMENTS, ...FOREX_INSTRUMENTS].find(item => item.symbol === entry.symbol)?.classId;
    setAssetClass(ownedClass ?? classify(entry.symbol, kind === 'futures' ? 'futures' : 'spot'));
  }
  /** 当前市场的文案（提示里用，别再硬编码"现货"）。 */
  const marketLabel = marketKind === 'futures' ? 'Binance USDT 永续' : marketKind === 'fx' ? '外汇日线' : 'Binance 现货';
  /** 当前分类的品种清单（加密类来自实时品种表，其余来自静态清单）。 */
  function classInstruments(id: AssetClassId): { symbol: string; base: string; quote: string; kind: MarketKind; note?: string }[] {
    if (id === 'crypto-spot') {
      // 打开就能看到全部品种：实时表还没到（或网络不通）时先用内置快照，联网后静默替换。
      const source = symbolList.length
        ? symbolList.map(entry => ({ symbol: entry.symbol, base: entry.base, quote: entry.quote }))
        : SPOT_SNAPSHOT.map(entry => ({ symbol: entry.symbol, base: entry.base, quote: 'USDT' }));
      return source.map(entry => ({ symbol: entry.symbol, base: entry.base, quote: entry.quote, kind: 'spot' as MarketKind }));
    }
    if (id === 'forex') return FOREX_INSTRUMENTS.map(item => ({ symbol: item.symbol, base: item.base, quote: item.quote, kind: item.kind, note: item.name }));
    // 合约类（加密/美股/港股/韩A股/指数/大宗）：优先用实时 fapi 品种表，拿不到就用内置快照，保证清单始终可用。
    const live = futuresUniverse[id];
    if (live?.length) return live.map(entry => ({ symbol: entry.symbol, base: entry.base, quote: entry.quote, kind: 'futures' as MarketKind }));
    if (id === 'commodity') {
      return [...snapshotInstruments('commodity'), ...COMMODITY_INSTRUMENTS.map(item => ({ symbol: item.symbol, base: item.base, quote: item.quote, kind: item.kind, note: item.note }))];
    }
    return snapshotInstruments(id);
  }
  /** 批量抓取当前分类：每个品种取最近 1000 根（外汇取全部日线）缓存到本会话。 */
  async function fetchClass() {
    if (feedState === 'loading') return;
    const list = classInstruments(assetClass);
    if (!list.length) { setHint('该分类暂无可用品种。'); return; }
    const target = list.slice(0, assetClass === 'crypto-spot' || assetClass === 'crypto-perp' ? 40 : list.length);
    setFeedState('loading'); setFeedError('');
    const failed: string[] = [];
    const cache = new Map(barsCache);
    setBatch({ done: 0, total: target.length, failed });
    setHint(`开始批量抓取 ${classLabel(assetClass)}：共 ${target.length} 个品种…`);
    for (let index = 0; index < target.length; index++) {
      const item = target[index];
      try {
        const bars = item.kind === 'fx'
          ? await fetchFxDaily(item.base, item.quote)
          : await fetchKlines({ symbol: item.symbol, interval: item.kind === 'spot' && assetClass === 'commodity' ? '1h' : interval, limit: 1000, market: item.kind === 'futures' ? 'futures' : 'spot' });
        if (bars.length) cache.set(`${item.kind}|${item.symbol}`, bars); else failed.push(item.symbol);
      } catch { failed.push(item.symbol); }
      setBarsCache(new Map(cache));   // 逐条刷新，面板上的"已缓存"标记实时更新
      setBatch({ done: index + 1, total: target.length, failed });
      setHint(`批量抓取中：${index + 1}/${target.length} · 成功 ${cache.size} · 失败 ${failed.length}`);
    }
    setBarsCache(cache);
    setFeedState('live');
    setBatch(null);
    setHint(`批量抓取完成：${classLabel(assetClass)} 共 ${target.length} 个品种，成功 ${target.length - failed.length}${failed.length ? `，失败：${failed.slice(0, 6).join('、')}${failed.length > 6 ? '…' : ''}` : ''}。`);
  }
  /** 若本地缓存更完整，就并入当前K线（壳环境才有缓存）。 */
  async function mergeLocalCache(forSymbol: string, forInterval: string, fresh: Candle[], forKind: MarketKind = 'spot') {
    try {
      if ((await shellInfo())?.mode !== 'mac-app') return;
      const rows = await historyLoad(forSymbol, forInterval, forKind);
      const cached = fromRows(rows);
      if (!cacheIsDeeper(cached, fresh)) return;
      const merged = mergeCandles(cached, fresh);
      if (loadedKey.current !== `${forSymbol}|${forInterval}`) return;   // 期间已经切走品种
      setLiveBars(merged);
      if (!session) setCursor(value => Math.min(value + (merged.length - fresh.length), merged.length));
      setResetId(n => n + 1);
      setHint(`已并入本地缓存：${cacheSummary(merged, time => chartTime(time, true))}。`);
    } catch { /* 没有缓存或非壳环境：忽略 */ }
  }
  /** 把当前K线整段写入本地缓存（抓到深历史后调用）。 */
  async function saveLocalCache(forSymbol: string, forInterval: string, bars: Candle[], forKind: MarketKind = 'spot') {
    try {
      if ((await shellInfo())?.mode !== 'mac-app') return;
      const count = await historySave(forSymbol, forInterval, toRows(bars), forKind);
      if (count > 0) { if (Date.now() - lastOrderAt.current > 3000) setHint(`已写入本地缓存：${forSymbol} · ${forInterval} · ${count} 根。`); void refreshCacheInfo(); }
    } catch { setHint('本地缓存写入失败（非桌面壳环境或磁盘不可写）。'); }
  }
  async function refreshCacheInfo() {
    try {
      if ((await shellInfo())?.mode !== 'mac-app') return;
      const { items, bytes } = await historyList();
      setCacheItems(items); setCacheBytes(bytes);
    } catch { /* 忽略 */ }
  }
  async function refreshLatest() {
    if (!live || !liveBars.length || feedState === 'loading') return;
    setFeedState('loading'); setFeedError('');
    try {
      if (marketKind === 'fx') { setFeedState('live'); setHint('外汇为日线序列，刷新无新增。'); return; }
      const fresh = await fetchKlines({ symbol, interval, limit: 500, market: marketKind === 'futures' ? 'futures' : 'spot' });
      const map = new Map(liveBars.map(bar => [bar.time, bar] as const));
      for (const bar of fresh) map.set(bar.time, bar);
      const merged = [...map.values()].sort((a, b) => a.time - b.time);
      const wasFull = cursorNow >= liveBars.length;
      setLiveBars(merged);
      if (wasFull && !session) setCursor(merged.length);
      setFeedState('live'); setResetId(n => n + 1);
      setHint(`已刷新到最新：新增 ${Math.max(0, merged.length - liveBars.length)} 根K线。`);
    } catch (error) { setFeedState('error'); setFeedError(messageOf(error)); setHint(`刷新失败：${messageOf(error)}`); }
  }
  async function openSymbolPanel() {
    setSearchOpen(true); setPlaying(false);
    if (symbolList.length || symbolLoading) return;
    setSymbolLoading(true);
    try {
      const list = await fetchSymbols();
      setSymbolList(list);
      void loadBoardPrices(list.slice(0, 40).map(entry => entry.symbol));
    } catch (error) {
      setHint(`品种列表加载失败：${messageOf(error)}。网络可用后可重试。`);
    } finally { setSymbolLoading(false); }
  }
  async function loadBoardPrices(symbols: string[]) {
    try {
      const list = await fetchTickers(symbols);
      setBoard(prev => { const next = { ...prev }; for (const ticker of list) next[ticker.symbol] = ticker; return next; });
    } catch { /* quotes are optional */ }
  }
  function useBuiltinSnapshot() {
    setPlaying(false); setChoosing(false); setSource('builtin'); setFeedState('idle'); setFeedError('');
    setCursor(value => Math.min(value, HISTORY.length));
    setResetId(n => n + 1);
    setHint('已切回内置 BTC 快照（离线样本）。可随时在品种面板重新接入 Binance。');
  }
  /** 下单面板：市价直接成交，限价/止损挂单；开仓可同时带上止损/止盈/跟踪保护。 */
  /** 记录仓位保护。返回被拒绝的条目说明（调用方必须拼进提示，不能静默放行也不要被覆盖）。
   *  两处历史 bug：①方向反的价位过去仍然写入 → 下一根立即触发（"刚开仓就被止损"）；
   *  ②保护过去从当前K线生效 → 用该K线已走过的路径触发（前视），与提示"下一根生效"不符。 */
  function recordProtection(seq: number, _time: number, side: 'long' | 'short', reference: number): string[] {
    const plan = planProtection({ side, reference, sl: Number(slPrice), tp: Number(tpPrice), trailPercent: Number(trailPct) });
    if (plan.sl === undefined && plan.tp === undefined && plan.trailBps === undefined) return plan.rejected;
    const nextBar = barAt(cursorNow);
    const step = Math.max(1, (nextBar?.time ?? minute.time + 60) - minute.time);
    const start = protectionStartTime(minute.time, nextBar?.time, step);
    const action: OrderAction = { kind: 'protect', seq, time: start, sl: plan.sl, tp: plan.tp, trailBps: plan.trailBps };
    setOrderLog(list => [...list, action]);
    return plan.rejected;
  }
  function submit(action: TicketAction, kind: TicketKind) {
    lastOrderAt.current = Date.now();
    // 选起点模式下不再静默吞掉下单：明确告知原因与出路（此前这里直接 return，用户表现为"点开仓毫无反应"）。
    if (choosing) {
      setHint('正在选择回放起点：请先在图表上点一根K线作为起点（或按 Esc 取消）再下单——选中起点会清空模拟交易记录。');
      return;
    }
    const qty = Number(quantity), sim = settings.sim;
    // 市价/止损成交按基础滑点 + 成交额冲击走一个更真实的价。
    const barNotional = Math.max(1e-9, current.volume * current.close);
    const marketFill = (side: 'buy' | 'sell') => marketPrice(side, current.close, sim, { orderNotional: notionalUsd(sim, qty, current.close), barNotional });
    const mark = current.close;
    if (!Number.isFinite(qty) || qty <= 0) { setHint('请输入大于 0 的有效数量。'); return; }
    const position = account.position;
    const seq = nextSeq(marketEvents, orderLog);
    const pushEvent = (side: OrderSide, eventQty: number, price: number) => setMarketEvents(list => [...list, { id: `event-${seq}`, seq, time: minute.time, side, qty: eventQty, price }]);
    if (kind !== 'market') {
      const price = Number(orderPrice) || mark;
      if (!Number.isFinite(price) || price <= 0) { setHint('请输入大于 0 的委托价格。'); return; }
      const side: OrderSide = orderSide === 'long' ? 'buy' : 'sell';
      const trail = Number(trailPct) > 0 ? Number(trailPct) * 100 : undefined;
      const order: Order = { id: `order-${seq}`, seq, side, type: kind === 'limit' ? 'limit' : 'stop', qty, price, createdCursor: cursorNow, reduceOnly, trailBps: trail, trailRef: trail ? mark : undefined };
      setOrderLog(list => [...list, { kind: 'place', seq, order }]);
      const protectWarn = recordProtection(seq + 1, minute.time, orderSide, price);
      setTab('orders');
      setHint(`${kind === 'limit' ? '限价' : '止损'}单已挂出：${orderSide === 'long' ? '做多' : '做空'} ${qty} @ ${money(price)}${reduceOnly ? '（只减仓）' : ''}${trail ? ` · 跟踪 ${trailPct}%` : ''}。${protectWarn.length ? `（${protectWarn.join('；')}）` : ''}`);
      return;
    }
    if (action === 'protect') {
      if (!position) { setHint('当前没有持仓。'); return; }
      const protectWarn = recordProtection(seq, minute.time, position.side, current.close);
      setHint(`已为${position.side === 'long' ? '多' : '空'}头设置保护：止损 ${slPrice || '—'} / 止盈 ${tpPrice || '—'} / 跟踪 ${trailPct || '0'}%。下一根K线起生效。${protectWarn.length ? `（${protectWarn.join('；')}）` : ''}`);
      return;
    }
    if (action === 'close') {
      if (!position) { setHint('当前没有持仓。'); return; }
      const side: OrderSide = position.side === 'long' ? 'sell' : 'buy';
      const closed = position.qty;   // 全部平仓：平掉整个持仓（此前误用票据数量，持仓大时要连点多次）
      const fillPrice = marketFill(side);
      const result = closePosition(account, sim, { side, qty: closed, price: fillPrice, time: minute.time });
      if (!result.ok) { setHint(result.message); return; }
      pushEvent(side, closed, fillPrice); setTab('positions');
      setHint(`已全部平仓 ${qtyText(closed)} @ ${money(fillPrice)}。`);
      return;
    }
    if (action === 'reduce') {
      // 显式减仓：按票据里的数量部分平仓（想全平请用「全部平仓」）
      if (!position) { setHint('当前没有持仓。'); return; }
      const closed = Math.min(qty, position.qty);
      if (!(closed > 0)) { setHint('请输入大于 0 的减仓数量。'); return; }
      const side: OrderSide = position.side === 'long' ? 'sell' : 'buy';
      const fillPrice = marketFill(side);
      const result = closePosition(account, sim, { side, qty: closed, price: fillPrice, time: minute.time });
      if (!result.ok) { setHint(result.message); return; }
      pushEvent(side, closed, fillPrice); setTab('positions');
      setHint(closed >= position.qty
        ? `减仓数量不少于持仓，已全部平仓 ${qtyText(closed)} @ ${money(fillPrice)}。`
        : `已减仓 ${qtyText(closed)}，剩余 ${qtyText(position.qty - closed)} @ ${money(fillPrice)}。`);
      return;
    }
    if (action === 'reverse') {
      if (!position) { setHint('当前没有持仓，无法反手。'); return; }
      const trial = reversePosition(account, sim, { price: mark, time: minute.time, qty });
      if (!trial.ok) { setHint(trial.message); return; }
      pushEvent(position.side === 'long' ? 'sell' : 'buy', position.qty + qty, mark);
      setTab('positions');
      setHint(`已反手：平掉 ${position.qty} 并开出同价反向 ${qty}（按市价 ${money(mark)}）。`);
      return;
    }
    const side: OrderSide = action === 'open-short' ? 'sell' : 'buy';
    const fillPrice = marketFill(side);
    const trial = openPosition(account, sim, { side, qty, price: fillPrice, time: minute.time });
    if (!trial.ok) { setHint(trial.message); return; }
    pushEvent(side, qty, fillPrice);
    const protectWarn = recordProtection(seq + 1, minute.time, action === 'open-short' ? 'short' : 'long', fillPrice);
    setTab('positions');
    setHint(`${action === 'open-short' ? '做空' : '做多'} ${qty} 成交 @ ${money(fillPrice)} · ${sim.leverage}× ${sim.marginMode === 'cross' ? '全仓' : '逐仓'}。${protectWarn.length ? `（${protectWarn.join('；')}）` : ''}`);
  }
  function cancelOrder(orderId: string) {
    const seq = nextSeq(marketEvents, orderLog);
    setOrderLog(list => [...list, { kind: 'cancel', seq, orderId, cursor: cursorNow }]);
    setHint('委托已撤销；撤销后可继续回放，撤销本身也可通过回退撤销。');
  }
  function addNote() {
    const text = noteDraft.trim();
    if (!text) { setHint('请先输入笔记内容。'); return; }
    const note = createNote(text, current.time);
    setNotes(list => [note, ...list]); setNoteDraft('');
    setHint(`已添加笔记，记录回放时刻 ${chartTime(note.time, true)}。`);
  }
  function jumpToNote(note: Note) {
    // 跳到过去的笔记就是回到回放：不把 replay 打开的话播放/步进按钮会一直是灰的。
    setPlaying(false); setChoosing(false); setReplay(true);
    setCursor(live ? cursorForTimeIn(liveBars, note.time) : Math.max(MIN_CURSOR, cursorForTime(note.time)));
    setResetId(n => n + 1);
    setHint(`已跳转到笔记时刻 ${chartTime(note.time, true)}；账户与绘图保持不变。`);
  }
  function restart() {
    setQuantity(settings.defaultQty); setTab('orders'); setPanelTab('trades'); setSpeed(1); setHidden(false); setLocked(false); setTool('cursor'); setSelected(null);
    if (live && liveBars.length) {
      clearTrades(); setPlaying(false); setChoosing(false); setReplay(true);
      setCursor(Math.max(MIN_CURSOR, liveBars.length - 200)); setResetId(n => n + 1);
      setHint('已重置回放位置（最近 200 根待回放）；模拟交易记录已清空，绘图与笔记保留。');
      return;
    }
    pickStart(HISTORY[INITIAL_CURSOR - 1].time); setMinutes(15);
  }
  /** 下单默认参数：OKX 那种"记住我的设置"，重启/新局都按这份恢复。 */
  function saveOrderDefaults() {
    const next = { settle: settings.sim.settle, qtyUnit: settings.sim.qtyUnit, contractSize: settings.sim.contractSize, leverage: settings.sim.leverage, marginMode: settings.sim.marginMode, orderType, quantity, reduceOnly, protectOn, sl: slPrice, tp: tpPrice, trail: trailPct };
    setSettings(state => ({ ...state, orderDefaults: next, defaultQty: quantity || state.defaultQty }));
    setDefaultsSaved(true);
    setHint(`已保存下单默认：${next.settle === 'coin' ? '币本位' : 'U本位'} · ${next.qtyUnit === 'contract' ? '张' : '币'} · ${next.leverage}× ${next.marginMode === 'cross' ? '全仓' : '逐仓'} · ${next.orderType === 'market' ? '市价' : next.orderType === 'limit' ? '限价' : '止损'} · 数量 ${next.quantity}${next.protectOn ? ' · 带止盈止损' : ''}。`);
    window.setTimeout(() => setDefaultsSaved(false), 2400);
  }
  /** 复盘模式：随时开一局；K线波动与成交量逐帧生长；结束时保留或删除结果。 */
  /** 已揭示的根数（按当前模式自己的单位）：实况=原生根索引，内置=聚合后的根数。内置用前缀索引，避免逐步重算。 */
  const revealedNow = live ? cursorNow : builtinIndexed.prefix[Math.min(cursorNow, HISTORY.length)];
  /** Fresh replay values for async handlers: a feed that lands mid-click must not be judged by stale state. */
  const sessionStartRef = useRef({ live, maxCursor, cursor: cursorNow, prefix: builtinIndexed.prefix, fills: 0, realized: 0 });
  sessionStartRef.current = { live, maxCursor, cursor: cursorNow, prefix: builtinIndexed.prefix, fills: derived.fills.length, realized: account.realized };
  /** 复盘起点对应的K线时间：用于过滤"本次复盘期间"的预警。 */
  function sessionStartTimeOf(entry: ReplaySession): number {
    const bars = live ? liveBars : HISTORY;
    const index = Math.max(0, Math.min(entry.startCursor - 1, Math.max(0, bars.length - 1)));
    return bars[index]?.time ?? 0;
  }
  function sessionStatsOf(entry: ReplaySession, now = Date.now()): SessionStats {
    const fills = derived.fills.slice(entry.fillsAtStart);
    return sessionStats(entry, {
      revealed: revealedNow, cursor: cursorNow, fills: fills.length,
      buys: fills.filter(fill => fill.side === 'buy').length, sells: fills.filter(fill => fill.side === 'sell').length,
      realized: account.realized, equity: values.equity, curve: derived.equityCurve,
      // 只统计复盘开始之后触发的预警（按可回放的时间戳过滤）。
      alerts: alertsSince(alerts, sessionStartTimeOf(entry)).map(alert => `${chartTime(alert.time)} ${alert.message}`),
    }, now);
  }
  async function startSession() {
    if (session) { setSessionPanel(true); setSessionAttempt('already-running'); return; }
    setSessionAttempt(`click@feed=${feedStateRef.current}`);
    // 行情还在加载：必须等它真正落地再开——原来的 6 秒硬上限在加载慢的品种上会让会话
    // 带着"还没落地的旧数据集"启动（sessionStartRef 仍是内置样本），起手就落在终点之外，
    // 表现为"一点复盘就结束、根本没开始"。
    if (feedStateRef.current === 'loading') {
      setHint('行情加载中，正在等数据落地后自动开始复盘…');
      const deadline = Date.now() + 30000;
      while (feedStateRef.current === 'loading' && Date.now() < deadline) await new Promise(resolve => window.setTimeout(resolve, 200));
      // 再等一帧渲染：让 sessionStartRef 吃到刚落地的数据集
      await new Promise(resolve => window.setTimeout(resolve, 250));
    }
    if (feedStateRef.current === 'loading') {
      setSessionAttempt('refused:still-loading');
      setHint('行情还在加载（网络较慢）：已取消开始复盘，等数据就绪后再点一次「复盘」即可。');
      return;
    }
    const now = Date.now();
    const fresh = sessionStartRef.current;
    // 数据集还没接入（离线退回内置样本等）或小到没法复盘：明确拒绝，不要开一个"起手即结束"的会话。
    if (!fresh.live || fresh.maxCursor <= MIN_CURSOR + 5) {
      setSessionAttempt(`refused:nodata(live=${fresh.live},max=${fresh.maxCursor})`);
      setHint('当前还没有可复盘的数据集（行情未接入或数据过小）：先在品种面板接入品种，再点「复盘」。');
      return;
    }
    const startCursor = Math.max(MIN_CURSOR, fresh.maxCursor - 200);
    const startRevealed = fresh.live ? startCursor : fresh.prefix[Math.min(startCursor, HISTORY.length)];
    // 成交量面板：复盘时自动补上，删除结果时一并移除（只在我们自己加过的情况下）。
    const addedVolume = !indicators.some(instance => instance.defId === VOLUME_DEF_ID);
    if (addedVolume) setIndicators(list => [...list, { id: `ind-vol-${now.toString(36)}`, defId: VOLUME_DEF_ID, inputs: defaultIndicatorInputs(INDICATOR_MAP[VOLUME_DEF_ID]), visible: true }]);
    setSession(createSession({
      // 复盘开始会清空模拟交易，所以成交与盈亏基线就是 0（清空前的记录留在 snapshot 里以便回滚）。
      now, cursor: startCursor, revealed: startRevealed, fills: 0, realized: 0, equity: settings.sim.equity, addedVolume,
      snapshot: { cursor: fresh.cursor, marketEvents, orderLog, notes },
    }));
    setSessionResult(null); setSessionPanel(true); setSmooth(true);
    clearTrades(); setReplay(true); setChoosing(false); setTool('cursor'); setSelected(null);
    setCursor(startCursor); fractionRef.current = 0; setFraction(0);
    setResetId(n => n + 1); setPlaying(true);
    setSessionAttempt(`started:cursor=${startCursor}/${fresh.maxCursor}`);
    setHint('复盘开始：清空模拟交易，从最近 200 根开始逐帧播放；结束时选择保留或删除结果。');
  }
  function finishSession() {
    if (!session) return;
    setPlaying(false); fractionRef.current = 1; setFraction(1);
    setSessionResult({ stats: sessionStatsOf(session), trade: tradeStatsNow });
  }
  function keepSession() {
    if (!session || !sessionResult) return;
    // 计入战绩库：综合统计与交易风格识别都基于这些记录。
    const record = buildRecord({
      id: session.id, at: Date.now(), symbol: live ? symbol : 'BTCUSDT.P', interval: live ? interval : `${minutes}m`,
      minutes: sessionResult.stats.minutes, bars: sessionResult.stats.bars, stats: sessionResult.trade,
      alerts: sessionResult.stats.alerts, config: settings.sim, fills: derived.fills.slice(session.fillsAtStart),
    });
    setRecordStore(store => ({ ...store, records: [...store.records, record] }));
    const note = createNote(sessionSummary(session, sessionResult.stats, live ? symbol : 'BTCUSDT.P', settleUnit), current.time);
    setNotes(list => [note, ...list]);
    // 结构化战绩一并入档：笔记给人看，档案给统计看。
    const trade = sessionResult.trade;
    setArchive(list => appendArchive(list, createArchiveEntry({
      session: sessionResult.stats, trade,
      market: live ? symbol : 'BTCUSDT.P', interval: periodLabel, unit: settleUnit,
      startEquity: values.equity - trade.realized, endEquity: values.equity,
    })));
    setSession(null); setSessionResult(null); setSessionPanel(true);
    setHint(`已保留复盘结果：回放 ${sessionResult.stats.bars} 根K线 · 成交 ${trade.trades} 笔 · 胜率 ${(trade.winRate * 100).toFixed(0)}% · 已实现 ${trade.realized >= 0 ? '+' : ''}${trade.realized.toFixed(2)} ${settleUnit}；复盘小结已写入训练笔记，本场已存入训练档案。`);
  }
  function discardSession() {
    if (!session || !sessionResult) return;
    const { snapshot } = session;
    setMarketEvents(snapshot.marketEvents); setOrderLog(snapshot.orderLog);
    setNotes(list => list.filter(note => snapshot.notes.some(kept => kept.id === note.id)));
    if (session.addedVolume) setIndicators(list => list.filter(instance => instance.defId !== VOLUME_DEF_ID));
    setCursor(snapshot.cursor); setResetId(n => n + 1); fractionRef.current = 1; setFraction(1);
    setSession(null); setSessionResult(null); setSessionPanel(true);
    setHint('已删除本次复盘结果：成交与笔记回滚到复盘开始前，绘图保留。');
  }
  /** 导出文本文件：macOS 壳走原生保存面板，浏览器走下载。 */
  function exportText(name: string, content: string, mime: string, what: string) {
    const bridge = nativeBridge();
    if (bridge) { bridge.exportFile(name, content); setHint(`已通过本机壳导出${what} ${name}。`); return; }
    // 应用内（loopback 端口）没有原生桥时不要 blob 下载：WKWebView 会把它当导航并整页重载。
    const port = Number((globalThis as { location?: { port?: string } }).location?.port ?? 0);
    if (port >= 8808 && port <= 8830) { setHint(`当前窗口不支持下载${what}；请用浏览器打开同一地址导出。`); return; }
    try {
      const url = URL.createObjectURL(new Blob([content], { type: mime }));
      const link = document.createElement('a'); link.href = url; link.download = name; link.click();
      URL.revokeObjectURL(url);
      setHint(`已导出${what} ${name}。`);
    } catch { setHint('导出失败：当前环境不支持文件下载。'); }
  }
  /** 导出战绩库为 CSV（每次复盘一行）。 */
  function exportRecords() {
    const records = recordStore.records;
    if (!records.length) { setHint('还没有可导出的复盘战绩。'); return; }
    const head = ['时间', '品种', '周期', '回放分钟', '回放根数', '成交笔数', '胜场', '负场', '胜率', `盈亏(${settleUnit})`, '手续费', '资金费', '最大回撤', '平均持仓(分)', '多单', '空单', '杠杆', '保证金模式', '爆仓', '预警次数', '止损次数', '止盈次数'].join(',');
    const rows = records.map(record => [
      new Date(record.at).toISOString(), record.symbol, record.interval, record.minutes, record.bars, record.trades,
      record.wins, record.losses, (record.winRate * 100).toFixed(1) + '%', record.realized.toFixed(settleUnit === 'USDT' ? 2 : 8),
      record.fees.toFixed(4), record.funding.toFixed(4), record.maxDrawdown.toFixed(2), record.avgHoldingMinutes.toFixed(1),
      record.longTrades, record.shortTrades, record.leverage, record.marginMode === 'cross' ? '全仓' : '逐仓',
      record.liquidated ? '是' : '否', record.alerts, record.slCount, record.tpCount,
    ].join(','));
    exportText(`交易训练室-战绩-${new Date().toISOString().slice(0, 10)}.csv`, [head, ...rows].join('\n'), 'text/csv', '战绩');
  }
  function exportSession() {
    if (!session || !sessionResult) return;
    const stamp = new Date();
    const pad = (value: number) => String(value).padStart(2, '0');
    const name = `${live ? symbol : 'BTCUSDT'}-复盘-${stamp.getFullYear()}${pad(stamp.getMonth() + 1)}${pad(stamp.getDate())}-${pad(stamp.getHours())}${pad(stamp.getMinutes())}.csv`;
    const body = [statsCsv(sessionResult.trade, live ? symbol : 'BTCUSDT.P', settleUnit), '', fillsCsv(derived.fills.slice(session.fillsAtStart), live ? symbol : 'BTCUSDT.P', settleUnit)].join('\n');
    exportText(name, body, 'text/csv', '复盘明细');
  }
  /** 训练档案：删除单场 / 清空 / 导出（档案与笔记、成交记录互不影响）。 */
  /** 自选列表：增删都写进设置（本机持久化）；删空是合法状态，不会被默认列表塞回来。 */
  function addWatchSymbol(raw: string) {
    const value = raw.trim().toUpperCase();
    if (!WATCHLIST_SYMBOL.test(value)) { setHint('代码格式不对：请输入类似 BTCUSDT 的交易对（5–20 位大写字母或数字）。'); return false; }
    if (settings.watchlist.includes(value)) { setHint(`${value} 已经在自选列表里了。`); return false; }
    if (settings.watchlist.length >= MAX_WATCHLIST) { setHint(`自选最多 ${MAX_WATCHLIST} 个，先删一个再添加。`); return false; }
    setSettings(state => ({ ...state, watchlist: sanitizeWatchlist([...state.watchlist, value]) }));
    setHint(`已把 ${value} 加入自选列表。`);
    return true;
  }
  function removeWatchSymbol(value: string) {
    setSettings(state => ({ ...state, watchlist: sanitizeWatchlist(state.watchlist.filter(entry => entry !== value)) }));
    setHint(`已把 ${value} 移出自选列表。`);
  }
  function deleteArchiveEntry(id: string) {
    setArchive(list => list.filter(entry => entry.id !== id));
    setHint('已从训练档案删除该场战绩。');
  }
  function clearArchive() {
    setArchive([]);
    setHint('训练档案已清空（训练笔记与成交记录不受影响）。');
  }
  function exportArchive() {
    if (!archive.length) { setHint('训练档案还是空的：先完成一局复盘并点「保留结果」。'); return; }
    exportText(archiveFileName(), archiveCsv(archive), 'text/csv', '训练档案');
  }

  const switchPeriod = (value: number) => { setPlaying(false); setMinutes(value); setSelected(null); setTool('cursor'); };
  const handleCrosshair = (bar: Candle | null, point?: { x: number; y: number } | null) => {
    const time = bar?.time ?? null;
    if (crosshairRef.current === time) { if (!bar) setCursorAt(null); return; }
    crosshairRef.current = time;
    setCrosshair(bar);
    if (!point) { setCursorAt(null); return; }
    const box = chartSection.current?.getBoundingClientRect();
    setCursorAt({ x: point.x, y: point.y, width: box?.width ?? 0, height: box?.height ?? 0 });
  };
  function toggleFullscreen() {
    const bridge = nativeBridge();
    try {
      if (document.fullscreenElement) { void document.exitFullscreen?.().catch(() => {}); return; }
      if (document.documentElement.requestFullscreen) {
        void document.documentElement.requestFullscreen().catch(() => { if (bridge) bridge.toggleFullscreen(); else setHint('当前环境不支持全屏，请使用浏览器全屏按钮。'); });
        return;
      }
    } catch { /* fall through to the native shell */ }
    if (bridge) bridge.toggleFullscreen(); else setHint('当前环境不支持全屏，请使用浏览器全屏按钮。');
  }
  function exportProject() {
    setSaveOpen(false);
    const name = projectFileName(), content = serializeProject(project), bridge = nativeBridge();
    if (bridge) { bridge.exportFile(name, content); setHint(`已通过本机壳导出项目文件 ${name}。`); return; }
    try {
      const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
      const link = document.createElement('a'); link.href = url; link.download = name; link.click();
      URL.revokeObjectURL(url);
      setHint(`已导出项目文件 ${name}。`);
    } catch { setHint('导出失败：当前环境不支持文件下载。'); }
  }
  function pickFile(): Promise<string | null> {
    return new Promise(resolve => {
      const input = document.createElement('input');
      input.type = 'file'; input.accept = 'application/json,.json';
      input.onchange = () => { const file = input.files?.[0]; if (!file) { resolve(null); return; } file.text().then(resolve).catch(() => resolve(null)); };
      input.click();
    });
  }
  function applyProject(next: ProjectV1) {
    setCursor(next.cursor); setMinutes(next.minutes); setSpeed(next.speed); setReplay(next.replay); setShowEma(true);
    setReplayFrom(next.replayFrom ?? null); setReplayTo(next.replayTo ?? null);
    setKeep(next.keep); setMagnet(next.magnet); setChartType(next.chartType); setQuantity(next.quantity);
    setHistory(next.drawings.length ? commit(emptyHistory(), next.drawings) : emptyHistory());
    setMarketEvents(next.marketEvents); setOrderLog(next.orderLog); setNotes(next.notes);
    setArchive(sanitizeArchive(next.archive));
    setIndicators(sanitizeIndicators(next.indicators)); setPythons(sanitizePythons(next.pythonIndicators)); setPythonRuns({});
    setTool('cursor'); setSelected(null); setPlaying(false); setChoosing(false); setResetId(n => n + 1);
    if (next.source === 'binance') { void loadLive(next.symbol ?? 'BTCUSDT', next.interval ?? '15m', { keepLog: true, restoreCursor: next.cursor }); }
    else { setSource('builtin'); setFeedState('idle'); }
  }
  async function importProject() {
    setSaveOpen(false);
    const bridge = nativeBridge();
    let text: string | null = null;
    try { text = bridge ? await bridge.importFile() : await pickFile(); }
    catch { setHint('导入失败：无法读取所选文件。'); return; }
    if (text === null) return;
    const next = parseProject(text);
    if (!next) { setHint('导入失败：文件不是有效的交易训练室项目。'); return; }
    applyProject(next);
    setHint('已导入项目文件，回放位置、绘图、交易与笔记均已恢复。');
  }
  function resetArchive() {
    setSaveOpen(false); clearProject();
    // 重置也给交易所默认形态（MA5/10/20/60 + 成交量），不是空图表。
    applyProject({ version: 1, savedAt: Date.now(), cursor: INITIAL_CURSOR, minutes: 15, speed: 1, replay: true, showEma: true, keep: false, magnet: false, chartType: 'candlestick', quantity: settings.defaultQty, source: 'builtin', symbol: 'BTCUSDT', interval: '15m', indicators: defaultIndicatorInstances(), pythonIndicators: [], archive: [], drawings: [], marketEvents: [], orderLog: [], notes: [] });
    setHint('已清除本机存档并恢复默认状态。');
  }
  function applySettings() {
    if (!settingsDraft) return;
    // 输入按 USDT 计价（本金口径），落库前换算成引擎结算本位：币本位按标记价折成币的数量。
    const usdt = settingsDraft.sim.equity;
    const equity = settingsDraft.sim.settle === 'coin' ? Number((usdt / Math.max(current.close, 1e-9)).toFixed(8)) : usdt;
    // initialCash 是历史字段，保持 USDT 口径（不写本位数量，避免被 100 下限规则误判）。
    const next = sanitizeSettings({ ...settingsDraft, sim: { ...settingsDraft.sim, equity }, initialCash: usdt });
    setSettings(next); setQuantity(next.defaultQty); setSettingsOpen(false); setSettingsDraft(null);
    setHint(`设置已保存：模拟权益 ${money(usdt)} USDT · ${next.sim.leverage}× ${next.sim.marginMode === 'cross' ? '全仓' : '逐仓'} · taker ${next.sim.takerBps}bp / maker ${next.sim.makerBps}bp · 滑点 ${next.sim.slippageBps}bp；默认数量 ${next.defaultQty}。权益与杠杆在重新开始或选择新起点后生效。`);
  }
  const orderRow = (state: OrderState) => {
    const { order } = state;
    return <div key={order.id} className="order-row" data-testid="order-row" data-status={state.status}>
      <strong data-label="合约">{live ? symbol : 'BTCUSDT.P'}</strong>
      <span data-label="买卖" className={order.side === 'buy' ? 'positive' : 'negative'}>{order.side === 'buy' ? '买入' : '卖出'}</span>
      <span data-label="类型">{orderTypeLabels[order.type]}</span>
      <span data-label="数量">{qtyText(order.qty)}</span>
      <span data-label="触发价">{priceText(order.price, settings.sim.tickSize)}</span>
      <span data-label="状态">{statusLabels[state.status]}</span>
      <span data-label="成交价">{state.status === 'filled' ? priceText(state.fillPrice ?? order.price, settings.sim.tickSize) : '—'}</span>
      <span data-label="时间">{chartTime(state.fillTime ?? barTimeAt(state.cancelCursor ?? order.createdCursor), true)}</span>
    </div>;
  };

  /** 交易面板内容（账户/下单/持仓/记录/笔记），底部与右侧抽屉共用同一份。 */
  const tradingPanel = <>
        <header className="panel-tabs">
          <button className={`panel-tab ${panelTab === 'trades' ? 'active' : ''}`} aria-pressed={panelTab === 'trades'} onClick={() => setPanelTab('trades')}><span className="table-icon">▦</span>模拟交易</button>
          <button className={`panel-tab ${panelTab === 'notes' ? 'active' : ''}`} aria-pressed={panelTab === 'notes'} onClick={() => setPanelTab('notes')}><Icon name="text"/>训练笔记</button>
          <span className="panel-state">{session ? '复盘进行中' : choosing ? '选择回放起点' : !replay ? '历史行情' : exhausted ? '回放已结束' : playing ? '回放中' : '回放已暂停'} <span>⌃</span></span>
        </header>
        {panelTab === 'notes' ? <div className="notes-view" data-testid="notes-view">
          <div className="note-editor"><textarea aria-label="笔记内容" data-testid="note-input" placeholder="记录当前回放时刻的观察、形态或情绪…" value={noteDraft} onChange={e => setNoteDraft(e.target.value)} /><button className="primary" data-testid="add-note" onClick={addNote}>添加笔记</button></div>
          <div className="notes-list" data-testid="notes-list">{notes.length ? notes.map(note => <article key={note.id} className="note-row" data-testid="note-row">
            <header><span>回放时间 {chartTime(note.time, true)}</span><small>记录于 {chartTime(note.createdAt, true)}</small></header>
            <p>{note.text}</p>
            <footer><button onClick={() => jumpToNote(note)}>跳转</button><button onClick={() => { setNotes(list => list.filter(item => item.id !== note.id)); setHint('笔记已删除。'); }}>删除</button></footer>
          </article>) : <div className="empty-table">还没有训练笔记<small>写下观察后保存在本机项目里</small></div>}</div>
        </div> : <>
          <AccountBar values={values} config={settings.sim} symbol={live ? symbol : 'BTCUSDT.P'} base={baseSymbol} premium={premium} protection={protectionLevels(derived.protection, account.position?.side ?? null)} liquidated={account.liquidated} onCloseAll={() => submit('close', 'market')} />
          <TradeTicket config={settings.sim} onConfig={patch => setSettings(state => ({ ...state, sim: { ...state.sim, ...patch } }))} protectOn={protectOn} onProtectOn={setProtectOn} baseSymbol={baseSymbol} onSaveDefaults={saveOrderDefaults} choosing={choosing} blockedReason={feedState === 'loading' ? '行情加载中：数据就绪后才能下单（避免下单被数据落地清掉）' : undefined} defaultsSaved={defaultsSaved} quantity={quantity} onQuantity={setQuantity} price={orderPrice} onPrice={setOrderPrice} orderType={orderType} onOrderType={setOrderType} orderSide={orderSide} onOrderSide={setOrderSide} reduceOnly={reduceOnly} onReduceOnly={setReduceOnly} sl={slPrice} tp={tpPrice} trail={trailPct} onSl={setSlPrice} onTp={setTpPrice} onTrail={setTrailPct} position={account.position} available={values.available} markPrice={current.close} tickSize={settings.sim.tickSize} minQty={settings.sim.minQty} onSubmit={submit} />
          <div className="order-tabs" role="tablist" aria-label="交易记录分类">{recordTabs.map(([id, label]) => <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>{label}{id === 'positions' && account.position ? ' 1' : ''}{id === 'orders' && working.length ? ` ${working.length}` : ''}</button>)}<span className="notes-caption">自动保存在本机</span></div>
          <div className="table-area" role="tabpanel" aria-label="交易列表">
            {tab === 'orders' ? <div className="orders-table" data-testid="orders-table"><div className="table-head order-head">{['商品代码','买/卖','类型','数量','触发价','状态','创建时间','操作'].map(title => <span key={title}>{title}</span>)}</div>{working.length ? working.map(state => <div key={state.order.id} className="order-row" data-testid="working-order" data-status="working"><strong data-label="合约">{live ? symbol : 'BTCUSDT.P'}</strong><span data-label="方向" className={state.order.side === 'buy' ? 'positive' : 'negative'}>{state.order.side === 'buy' ? '买入' : '卖出'}</span><span data-label="类型">{orderTypeLabels[state.order.type]}</span><span data-label="数量">{qtyText(state.order.qty)}</span><span data-label="触发价">{priceText(state.order.price, settings.sim.tickSize)}</span><span data-label="状态">{statusLabels.working}</span><span data-label="时间">{chartTime(barTimeAt(state.order.createdCursor), true)}</span><button onClick={() => cancelOrder(state.order.id)}>撤单</button></div>) : <div className="empty-table">当前没有等待中的委托<small>选择限价或止损类型后下单，委托会显示在这里</small></div>}</div>
              : tab === 'history' ? <div className="orders-history" data-testid="orders-history"><div className="table-head history-head">{['商品代码','买/卖','类型','数量','触发价','状态','成交价','时间'].map(title => <span key={title}>{title}</span>)}</div>{settled.length ? settled.map(orderRow) : <div className="empty-table">还没有已成交或已撤销的委托</div>}</div>
              : tab === 'positions' ? <><div className="table-head position-head">{['商品代码','方向','数量','开仓均价','标记价','保证金率','强平价','浮动盈亏','操作'].map(title => <span key={title}>{title}</span>)}</div>{account.position ? <div className="position-row" data-testid="position-row" data-side={account.position.side}><strong data-label="合约">{live ? symbol : 'BTCUSDT.P'}</strong><span data-label="方向" data-testid="row-side" className={account.position.side === 'long' ? 'positive' : 'negative'}>{account.position.side === 'long' ? '多' : '空'} {settings.sim.leverage}× · {settings.sim.marginMode === 'cross' ? '全仓' : '逐仓'}</span><span data-label="数量">{qtyText(account.position.qty)}</span><span data-label="开仓均价">{priceText(account.position.entry, settings.sim.tickSize)}</span><span data-label="标记价" data-testid="mark-price">{priceText(current.close, settings.sim.tickSize)}</span><span data-label="保证金率" data-testid="row-margin-ratio" className={!Number.isFinite(values.marginRatio) ? '' : values.marginRatio >= .8 ? 'negative' : values.marginRatio >= .5 ? 'warning' : 'positive'}>{(values.marginRatio * 100).toFixed(1)}%</span><span data-label="强平价" data-testid="row-liquidation">{Number.isFinite(values.liquidationPrice) && values.liquidationPrice > 0 ? priceText(values.liquidationPrice, settings.sim.tickSize) : '—'}</span><span data-label="浮动盈亏" className={values.unrealized < 0 ? 'negative' : 'positive'}>{settleText(values.unrealized, settings.sim)}</span><button disabled={choosing} onClick={() => submit('close', 'market')} aria-label="全部平仓" title="平掉整个持仓">全部平仓</button><button disabled={choosing} onClick={() => submit('reduce', 'market')} aria-label="按数量减仓" title="按票据里的数量部分平仓">减仓</button><button disabled={choosing} onClick={() => submit('reverse', 'market')} aria-label="反手">反手</button></div> : <div className="empty-table">当前没有持仓<small>设置数量后，点击图表左上角的“开多”或“开空”</small></div>}</>
              : tab === 'overview' ? <div className="overview"><span>初始资金 <b>{settleText(settings.sim.equity, settings.sim)} {settleUnit}</b></span><span>已实现盈亏 <b>{settleText(account.realized, settings.sim)} {settleUnit}</b></span><span>成交笔数 <b>{derived.fills.length}</b></span><span>挂单中 <b>{working.length}</b></span><small>{live ? `数据源 Binance 现货 · ${symbol} · ${periodLabel}` : '内置快照数据源'}；市价买入、限价／止损委托与全部平仓；自动保存在本机，可导出项目文件。</small></div>
              : tab === 'closed' ? <div className="closed-trades" data-testid="closed-trades"><div className="table-head closed-head">{['商品代码','方向','数量','开仓时间','平仓时间','持仓','盈亏','原因'].map(title => <span key={title}>{title}</span>)}</div>{closedList.length ? [...closedList].reverse().map((trade, index) => <div key={`${trade.closedAt}-${index}`} className="closed-row" data-testid="closed-row" data-dir={trade.dir} data-complete={trade.complete}><strong data-label="合约">{live ? symbol : 'BTCUSDT.P'}</strong><span data-label="方向" className={trade.dir === 'long' ? 'positive' : 'negative'}>{trade.dir === 'long' ? '多' : '空'}{trade.complete ? '' : ' · 部分'}</span><span data-label="数量">{qtyText(trade.qty)}</span><span data-label="开仓时间">{chartTime(trade.openedAt, true)}</span><span data-label="平仓时间">{chartTime(trade.closedAt, true)}</span><span data-label="持仓">{holdingText(trade.closedAt - trade.openedAt)}</span><b data-label="盈亏" className={trade.pnl < 0 ? 'negative' : 'positive'}>{settleText(trade.pnl, settings.sim)}</b><span data-label="原因">{FILL_REASON_LABELS[trade.reason] ?? trade.reason}</span></div>) : <div className="empty-table">还没有已平仓的交易<small>开仓后减仓或平仓，这里按「开 → 平」配对列出（含减仓的部分了结）</small></div>}</div>
              : <><div className="table-head fill-head">{['商品代码','买卖','数量','成交价','成交时间'].map(title => <span key={title}>{title}</span>)}</div>{records.length ? records.map((m, i) => <div key={i} className="fill-row" data-testid="fill-row" data-action={m.action}><strong data-label="合约">{live ? symbol : 'BTCUSDT.P'}</strong><span data-label="买卖" className={m.side === 'buy' ? 'positive' : 'negative'}>{fillSideLabel(m.side, m.action)}</span><span data-label="数量">{qtyText(m.qty)}</span><span data-label="成交价">{priceText(m.price, settings.sim.tickSize)}</span><span data-label="成交时间">{chartTime(m.time, true)}</span></div>) : <div className="empty-table">当前没有成交记录</div>}</>}
          </div>
        </>}
      </>;

  /** 浮标定位：贴近右边缘时翻到光标左侧，并按图表区实时尺寸夹住上下。
   *  （原来是 Math.min(x + 14, 460)：宽窗口下鼠标滑到右侧，浮标会卡在屏幕中间不动。） */
  const tipFlip = cursorAt !== null && cursorAt.width > 0 && cursorAt.x > cursorAt.width - 200;
  const tip = cursorAt ? {
    flip: tipFlip,
    left: tipFlip ? cursorAt.x - 14 : cursorAt.x + 14,
    top: Math.max(8, Math.min(cursorAt.y - 46, cursorAt.height > 0 ? cursorAt.height - 104 : cursorAt.y - 46)),
  } : null;

  return <main className={`studio${settings.ui.leftRail ? '' : ' hide-left'}${settings.ui.rightRail ? '' : ' hide-right'}${settings.ui.bottomPanel ? '' : ' hide-bottom'}`} data-testid="studio" data-cursor={cursor} data-playing={playing} data-replay={replay} data-period={minutes} data-chart-type={chartType} data-source={source} data-symbol={symbol} data-interval={interval} data-feed={feedState} data-origin={dataOrigin} data-session-attempt={sessionAttempt} data-orders-blocked={feedState === 'loading' ? '1' : '0'} data-bars={dataLength}>
    <header className="topbar" aria-label="顶部工具栏">
      <button className="brand" onClick={restart} aria-label="重新开始" title="重新开始（清空模拟交易记录，保留绘图与笔记）"><Icon name="history" /></button>
      <button aria-label="搜索品种" title="搜索品种：接入 Binance 现货行情" onClick={() => void openSymbolPanel()}><Icon name="search" /></button>
      <strong className="symbol">{live ? symbol : 'BTCUSDT.P'}</strong>
      {live
        ? <select className="timeframe-label feed-interval" aria-label="图表周期" value={interval} onChange={e => void loadLive(symbol, e.target.value)}>{INTERVALS.map(entry => <option key={entry.value} value={entry.value}>{entry.label}</option>)}</select>
        : <><div className="timeframes">{PERIODS.map(p => <button key={p.minutes} className={minutes === p.minutes ? 'active' : ''} aria-label={`周期${p.label}`} aria-pressed={minutes === p.minutes} onClick={() => switchPeriod(p.minutes)}>{p.label}</button>)}</div>
        <select className="timeframe-label" aria-label="图表周期" value={minutes} onChange={e => switchPeriod(Number(e.target.value))}>{PERIODS.map(p => <option key={p.minutes} value={p.minutes}>{p.label}</option>)}</select></>}
      <i className="separator" />
      <select className="chart-type" aria-label="图表类型" value={chartType} onChange={e => setChartType(e.target.value as ChartType)}>{CHART_TYPES.map(entry => <option key={entry.type} value={entry.type}>{entry.label}</option>)}</select>
      <button aria-label="指标库" title="指标库：30 项技术指标（主图/副图）" onClick={() => { setIndicatorEditId(null); setIndicatorOpen(true); setPlaying(false); }}><Icon name="indicators"/>指标</button>
      <button aria-label="Python 指标" title="Python 指标：编写、运行与挂载到图表" onClick={() => { setPythonOpen(true); setPlaying(false); }}><Icon name="text"/>Python</button>
      <button aria-label="个人主面板" data-testid="open-dashboard" title="个人主面板：累计战绩、交易风格标签与复盘记录" onClick={() => { setDashOpen(true); setPlaying(false); }}><Icon name="star"/>战绩</button>
      <i className="separator" /><button aria-label="撤销" title="撤销绘图 Ctrl+Z" disabled={!history.past.length} onClick={() => { setHistory(undo); setSelected(null); setTool('cursor'); }}><Icon name="undo" /></button><button aria-label="重做" title="重做绘图 Ctrl+Y" disabled={!history.future.length} onClick={() => { setHistory(redo); setSelected(null); }}><Icon name="redo" /></button>
      <span className="top-spacer" />
      <div className="menu-host">
        <button aria-label="布局" title="布局：显示或隐藏面板" aria-pressed={layoutOpen} onClick={() => { setLayoutOpen(v => !v); setSaveOpen(false); }}><Icon name="panel" /></button>
      </div>
      <div className="menu-host">
        <button aria-label="保存项目" title="保存项目：自动保存、导出与导入" aria-pressed={saveOpen} data-testid="save-project" onClick={() => { setSaveOpen(v => !v); setLayoutOpen(false); }}><Icon name="save" /></button>
      </div>
      <button aria-label="切换主题" data-testid="theme-toggle" title={settings.theme === 'dark' ? '切换到亮色模式' : '切换到暗色模式'} onClick={() => setSettings(state => ({ ...state, theme: state.theme === 'dark' ? 'light' : 'dark' }))}><Icon name={settings.theme === 'dark' ? 'sun' : 'moon'} /></button><button aria-label="全局设置" title="全局设置" onClick={() => { setSettingsDraft({ ...settings, sim: { ...settings.sim, equity: settings.sim.settle === 'coin' ? Number((settings.sim.equity * current.close).toFixed(2)) : settings.sim.equity }, ui: { ...settings.ui } }); setSettingsOpen(true); void refreshCacheInfo(); }}><Icon name="settings" /></button>
      <button aria-label="全屏" title="全屏" onClick={toggleFullscreen}><Icon name="fullscreen" /></button>
    </header>
    <DrawingToolbar tool={tool} keep={keep} locked={locked} hidden={hidden} magnet={magnet} onTool={selectTool} onKeep={() => setKeep(v => !v)} onLock={() => { setLocked(v => !v); setTool('cursor'); }} onHide={() => { setHidden(v => !v); setSelected(null); }} onMagnet={() => setMagnet(v => !v)} onClear={() => { setHistory(h => commit(h, [])); setTool('cursor'); setSelected(null); }} onZoom={() => chart.current?.zoom()} onHint={setHint}/>
    <section className="workbench" style={{ '--drawer-width': ui.tradePanel === 'right' ? `${drawerWidth}px` : '0px', '--bottom-height': ui.tradePanel === 'bottom' ? `${bottomHeight}px` : '0px' } as CSSProperties}>
      <section className="chart-section" aria-label="图表区" ref={element => { chartSection.current = element; }}>
        <ChartCanvas dark={settings.theme === 'dark'} datasetKey={`${source}|${marketKind}|${symbol}|${live ? interval : `${minutes}m`}|${resetId}`} ref={chart} bars={choosing ? dataset : visibleBars} minutes={intervalMinutes} chartType={chartType} iconMark={iconMark} anchorTime={minute.time} drawings={history.present} marks={derived.fills} alerts={alerts} tool={tool} resetId={resetId} selected={selected} hidden={hidden} locked={locked} magnet={magnet} choosing={choosing} plots={chartPlots} paneOrder={paneOrder} levels={chartLevels} legends={chartLegends} paneHeights={paneHeights} onPaneResize={(key, factor) => setPaneHeights(current => ({ ...current, [key]: factor }))} perf={perf} onDrawing={addDrawing} onUpdate={updateDrawing} onSelect={setSelected} onPick={time => pickStart(time + intervalMinutes * 60 - 60)} onHint={setHint} onCrosshair={handleCrosshair}/>
        <div className="chart-heading"><strong>{live ? symbol : 'BTCUSDT.P'}</strong><span>· {periodLabel} ·</span>{live ? <span className={feedState === 'error' ? 'negative' : 'muted'} title="Binance 现货行情（经本机智能路由）">{feedState === 'error' ? 'Binance 离线' : 'Binance'}</span> : <span className="muted" title="内置 OKX 历史快照，不连接实时行情">OKX</span>}<span className="ohlc"><span>开</span> {priceText(current.open, settings.sim.tickSize)} <span>高</span> {priceText(current.high, settings.sim.tickSize)} <span>低</span> {priceText(current.low, settings.sim.tickSize)} <span>收</span> <b className={change < 0 ? 'negative' : 'positive'}>{priceText(current.close, settings.sim.tickSize)}　{change >= 0 ? '+' : ''}{Number(change.toFixed(2))}%</b></span></div>
        <div className="quotes"><button className="sell-quote" disabled={choosing} onClick={() => submit('open-short', 'market')} aria-label="开空" title={`市价开空 ${quantity}（${settings.sim.leverage}× ${settings.sim.marginMode === 'cross' ? '全仓' : '逐仓'}）`}><b>{priceText(current.close, settings.sim.tickSize)}</b><span>开空</span></button><button className="buy-quote" disabled={choosing} onClick={() => submit('open-long', 'market')} aria-label="开多" title={`市价开多 ${quantity}（${settings.sim.leverage}× ${settings.sim.marginMode === 'cross' ? '全仓' : '逐仓'}）`}><b>{priceText(current.close, settings.sim.tickSize)}</b><span>开多</span></button></div>
        <div className="floating-tools" aria-label="绘图快捷栏"><span className="grip">⠿</span>{(['trend-line','horizontal-line','rectangle'] as Tool[]).map(t => <button key={t} className={tool === t ? 'selected' : ''} title={TOOL_NAMES[t]} aria-label={`快捷${TOOL_NAMES[t]}`} onClick={() => selectTool(t)}><DrawingGlyph type={t}/></button>)}</div>
        {selectedDrawing && !locked && !hidden && <div className="drawing-stylebar" aria-label="选中绘图设置"><span>{TOOL_NAMES[selectedDrawing.kind]}</span><input type="color" aria-label="绘图颜色" value={selectedDrawing.color} onChange={e => updateDrawing({ ...selectedDrawing, color: e.target.value })}/><select aria-label="绘图线宽" value={selectedDrawing.width} onChange={e => updateDrawing({ ...selectedDrawing, width: Number(e.target.value) })}>{[1,2,3,4].map(w => <option key={w} value={w}>{w}px</option>)}</select><button onClick={deleteSelected} aria-label="删除选中绘图" title="删除 Delete"><Icon name="trash"/></button></div>}
        {(tool !== 'cursor' || choosing) && <div className="drawing-hint">{choosing ? '选择回放起点 · 点击一根K线' : tool === 'brush' ? `${TOOL_NAMES[tool]} · 按住拖动` : tool === 'text-annotation' ? `${TOOL_NAMES[tool]} · 点击输入文字` : tool === 'xabcd-pattern' ? `${TOOL_NAMES[tool]} · 依次点击 5 个点` : tool === 'icon-mark' ? `${TOOL_NAMES[tool]} · 选择图标后点击放置` : `${TOOL_NAMES[tool]} · 点击或拖动绘制`}<span>Esc 取消</span>{tool === 'icon-mark' && <span className="icon-picker" data-testid="icon-mark-picker">{ICON_MARKS.map(name => <button key={name} className={`icon-choice ${iconMark === name ? 'selected' : ''}`} aria-label={`图标${name}`} aria-pressed={iconMark === name} onClick={() => setIconMark(name)}><IconMarkGlyph name={name} /></button>)}</span>}</div>}
        {objectsOpen && <div className="object-list" aria-label="绘图对象列表"><strong>绘图对象</strong>{history.present.length ? history.present.map(d => <button key={d.id} onClick={() => { setSelected(d.id); setHidden(false); setTool('cursor'); }}>{TOOL_NAMES[d.kind]} {d.text?.slice(0, 15)}</button>) : <p>尚无绘图</p>}</div>}
        {session && sessionPanel && <SessionPanel session={session} stats={sessionStatsOf(session, nowTick)} playing={playing} fraction={smooth ? fraction : 1} speed={speed} step={stepSize} onTogglePlay={() => setPlaying(value => !value)} onFinish={finishSession} />}
        {perfOpen && <div className="float-panel perf-panel" data-testid="perf-panel" aria-label="性能面板">
          <header><strong>性能</strong><button aria-label="关闭性能面板" onClick={() => setPerfOpen(false)}><Icon name="close" /></button></header>
          <dl>
            <div><dt>渲染频率</dt><dd data-testid="perf-fps">{perfSnapshot.fps.toFixed(1)} fps</dd></div>
            <div><dt>渲染间隔</dt><dd>{perfSnapshot.frameMs.toFixed(1)} ms</dd></div>
            <div><dt>图表同步</dt><dd data-testid="perf-chart">{perfSnapshot.chartMs.toFixed(2)} ms</dd></div>
            <div><dt>指标计算</dt><dd data-testid="perf-indicators">{perfSnapshot.indicatorMs.toFixed(2)} ms</dd></div>
            <div><dt>可见K线</dt><dd>{visibleBars.length} / {dataset.length}</dd></div>
            <div><dt>指标实例</dt><dd>{indicators.length}</dd></div>
          </dl>
          <footer><small>图表与副图走增量更新（只在尾部追加）</small><button onClick={() => { perf.reset(); setPerfSnapshot(perf.snapshot()); }}>重置</button></footer>        </div>}
        {toasts.length > 0 && <div className="alert-toast" data-testid="alert-toast">{toasts.map(alert => <button key={alert.key} title="点击关闭" onClick={() => setToasts(current => current.filter(entry => entry.key !== alert.key))}><i style={{ background: alert.color }} />{chartTime(alert.time)} {alert.message}</button>)}</div>}
        {crosshair && cursorAt && tip && <div className="cursor-tooltip" data-testid="cursor-tooltip" data-flip={tip.flip} style={{ left: tip.left, top: tip.top, transform: tip.flip ? 'translateX(-100%)' : undefined }}>
          <b>{chartTime(crosshair.time, true)}</b>
          <span>开 {priceText(crosshair.open, settings.sim.tickSize)} 高 {priceText(crosshair.high, settings.sim.tickSize)}</span>
          <span>低 {priceText(crosshair.low, settings.sim.tickSize)} 收 <i className={crosshair.close < crosshair.open ? 'negative' : 'positive'}>{priceText(crosshair.close, settings.sim.tickSize)}</i></span>
          <span>量 {qtyText(crosshair.volume)}</span>
        </div>}
        {settings.ui.dataWindow && <div className="float-panel data-window" data-testid="data-window" aria-label="数据窗口">
          <header><strong>数据窗口</strong><button aria-label="关闭数据窗口" onClick={() => toggleUi('dataWindow')}><Icon name="close" /></button></header>
          <dl>
            <div><dt>时间</dt><dd>{chartTime(dataBar.time, true)}</dd></div>
            <div><dt>开</dt><dd>{priceText(dataBar.open, settings.sim.tickSize)}</dd></div>
            <div><dt>高</dt><dd>{priceText(dataBar.high, settings.sim.tickSize)}</dd></div>
            <div><dt>低</dt><dd>{priceText(dataBar.low, settings.sim.tickSize)}</dd></div>
            <div><dt>收</dt><dd className={dataChange < 0 ? 'negative' : 'positive'}>{priceText(dataBar.close, settings.sim.tickSize)}　{dataChange >= 0 ? '+' : ''}{Number(dataChange.toFixed(2))}%</dd></div>
            <div><dt>量</dt><dd>{qtyText(dataBar.volume)}</dd></div>
          </dl>
          <small>{crosshair ? '悬停K线' : '最新可见K线'}</small>
        </div>}
        {settings.ui.watchlist && <div className="float-panel watchlist" data-testid="watchlist" aria-label="自选列表">
          <header><strong>自选列表</strong><span className="watchlist-actions">
            <button aria-label="把当前品种加入自选" title="把当前品种加入自选" data-testid="watchlist-add-current" onClick={() => { if (live) addWatchSymbol(symbol); else setHint('内置快照只有 BTCUSDT.P：接入 Binance 行情后即可增删自选。'); }}>＋当前</button>
            <button aria-label="关闭自选列表" onClick={() => toggleUi('watchlist')}><Icon name="close" /></button>
          </span></header>
          {live ? <>
            {settings.watchlist.length ? settings.watchlist.map(entry => {
              const ticker = board[entry];
              return <div key={entry} className="watchlist-row" data-active={entry === symbol} data-testid="watchlist-row">
                <button className="watchlist-pick" aria-pressed={entry === symbol} title={`切换到 ${entry}`} onClick={() => { if (entry !== symbol) void loadLive(entry, interval); }}><strong>{entry}</strong><span>{ticker ? priceText(ticker.price, settings.sim.tickSize) : '—'}</span><span className={ticker && ticker.changePercent < 0 ? 'negative' : 'positive'}>{ticker ? `${ticker.changePercent >= 0 ? '+' : ''}${ticker.changePercent.toFixed(2)}%` : ''}</span></button>
                <button className="watchlist-remove" aria-label={`把 ${entry} 移出自选`} title="移出自选" data-testid="watchlist-remove" onClick={() => removeWatchSymbol(entry)}>✕</button>
              </div>;
            }) : <p className="watchlist-empty">自选是空的：点右上「＋当前」，或在下面输入代码添加。</p>}
            <form className="watchlist-add" data-testid="watchlist-add" onSubmit={event => { event.preventDefault(); if (addWatchSymbol(watchDraft)) setWatchDraft(''); }}>
              <input aria-label="添加自选代码" placeholder="如 SOLUSDT" value={watchDraft} onChange={event => setWatchDraft(event.target.value.toUpperCase())} />
              <button type="submit">添加</button>
            </form>
            <small>点击切换品种 · 约 12 秒刷新 · 可增删，最多 {MAX_WATCHLIST} 个（随设置保存在本机）</small>
          </> : <><div className="watchlist-row" data-active="true"><button className="watchlist-pick" onClick={() => { chart.current?.focus(); setHint('已聚焦图表：BTCUSDT.P 内置快照。'); }}><strong>BTCUSDT.P</strong><span>{priceText(current.close, settings.sim.tickSize)}</span><span className={change < 0 ? 'negative' : 'positive'}>{change >= 0 ? '+' : ''}{Number(change.toFixed(2))}%</span></button></div><small>内置单一品种快照 · 不联网；接入 Binance 后自选可增删</small></>}
        </div>}
      </section>
      <div className="rangebar" aria-label="时间范围栏"><div className="range-links">{['1天','5天','1个月','3个月','6个月','YTD','1年','5年','全部'].map((label, i) => <button key={label} onClick={() => chart.current?.focus((i === 0 ? Math.min(visibleBars.length, 1440 / intervalMinutes) : visibleBars.length) / .47)} title={live ? '查看当前数据范围' : '查看内置历史范围'}>{label}</button>)}</div>
        <div className="feed-tools" data-testid="feed-tools">
          <span className={`feed-chip ${feedState}`} title={feedError || (live ? `Binance 现货数据（智能路由）\n覆盖 ${chartTime((live ? liveBars : HISTORY)[0].time, true)} → ${chartTime((live ? liveBars : HISTORY)[(live ? liveBars : HISTORY).length - 1].time, true)}` : '内置离线快照，不联网')}>{live ? (feedState === 'loading' ? 'Binance 加载中…' : feedState === 'error' ? 'Binance 离线' : `Binance · ${symbol} · ${periodLabel}`) : feedState === 'loading' ? '连接中…' : '内置快照'}</span>
          {live ? <><button onClick={() => void loadOlder()} disabled={feedState === 'loading'} title="向更早再抓 1 万根">载入更早</button><button onClick={() => void fetchAllHistory()} disabled={feedState === 'loading'} data-testid="fetch-all-history" title={`一直抓到交易所历史起点（单次上限 ${MAX_KLINES.toLocaleString('en-US')} 根）`}>抓取全部历史</button><button onClick={() => void refreshLatest()} disabled={feedState === 'loading'} title="拉取最新已收盘K线">刷新最新</button></> : <button onClick={() => void loadLive(symbol, interval)} disabled={feedState === 'loading'} title="连接 Binance 实时行情">接入 Binance</button>}
        </div>
        <span className="clock"><b className="class-badge" data-testid="class-badge">{classLabel(assetClass)}{marketKind === 'futures' ? ' · 永续' : marketKind === 'fx' ? ' · 日线' : ''}</b><i/>{chartTime(minute.time)}:00 UTC+8 <span>{replay ? '回放' : '历史'}</span></span></div>
      {/* 回放控制台：区间 + 传送控制 + 会话，一体化（原来顶部/底部两套控件已合并到这里） */}
      <nav className={`replaybar console ${choosing ? 'choosing' : ''}`} aria-label="回放控制栏" data-range={JSON.stringify({ from: replayFrom, to: replayTo, fromCursor, toCursor, replayEnd, rangeTotal })}>
        <div className="console-row">
          <i className="separator"/>
          <button onClick={() => step(-1)} disabled={cursorNow <= MIN_CURSOR} aria-label="上一根" title="上一根（同步撤回未来成交）"><span className="replay-back"><ReplayIcon name="forward"/></span></button>
          <button onClick={() => { setTool('cursor'); setPlaying(v => !v); }} disabled={!replay || exhausted} aria-label={playing ? '暂停回放' : '播放回放'} title={playing ? '暂停' : '播放'}>{playing ? <ReplayIcon name="pause"/> : <ReplayIcon name="play"/>}</button>
          <button onClick={() => step(1)} disabled={exhausted} aria-label="下一根" title="下一根"><ReplayIcon name="forward"/></button>
          <i className="separator"/>
          <label className="console-field">速度<select aria-label="回放速度" value={speed} onChange={e => setSpeed(Number(e.target.value))}>{REPLAY_SPEEDS.map(s => <option key={s} value={s}>{s}×</option>)}</select></label>
          <label className="console-field">步长<select aria-label="步长" title="手动步进粒度：整根 / 半根 / 四分之一根" value={stepSize} onChange={e => { setStepSize(Number(e.target.value)); fractionRef.current = 1; setFraction(1); }}>{STEP_SIZES.map(size => <option key={size} value={size}>{size === 1 ? '整根' : `1/${size}根`}</option>)}</select></label>
          {live
            ? <span className="tf-tabs" data-testid="tf-tabs" aria-label="周期">{INTERVALS.map(entry => <button key={entry.value} className={interval === entry.value ? 'active' : ''} disabled={marketKind === 'fx' && entry.value !== '1d'} aria-pressed={interval === entry.value} onClick={() => void loadInstrument({ symbol, base: baseSymbol, quote: marketKind === 'fx' ? symbol.slice(3) : 'USDT' }, marketKind, entry.value)}>{entry.label}</button>)}</span>
            : <label className="console-field">周期<select aria-label="回放周期" value={minutes} onChange={e => switchPeriod(Number(e.target.value))}>{PERIODS.map(p => <option key={p.minutes} value={p.minutes}>{p.label}</option>)}</select></label>}
          <button className={smooth ? 'smooth-on' : ''} aria-pressed={smooth} aria-label="波动播放" title="波动播放：每根K线逐帧生长，成交量同步累积" onClick={() => { const next = !smooth; setSmooth(next); if (!next) { fractionRef.current = 1; setFraction(1); } setHint(next ? '波动播放已开启。' : '波动播放已关闭：整根K线跳动。'); }}><Icon name="trend"/>波动</button>
          <span className="console-progress" data-testid="replay-progress">区间 {rangeDone}/{rangeTotal} · {Math.round(rangeDone / rangeTotal * 100)}%</span>
          <span className="console-spacer" />
          {session
            ? <button className="console-primary danger" data-testid="console-finish-session" onClick={finishSession}>结束复盘</button>
            : <><button className="console-pick" data-testid="console-pick-start" onClick={chooseStart} title="自选起点：在图表上点一根K线作为复盘起点（选中会清空模拟交易记录）"><Icon name="history"/>自选起点</button>
              <button className="console-primary" data-testid="console-start-session" onClick={() => void startSession()} title="开始训练：直接从当前回放区间逐K播放（结束后可保留或删除结果）"><Icon name="target"/>开始训练</button></>}
          <button onClick={() => { setPlaying(false); setChoosing(false); setCursor(replayEnd); setResetId(n => n + 1); }} aria-label="跳至区间末尾" title="跳至区间末尾"><Icon name="arrow"/></button>
          <button onClick={() => { setPlaying(false); setChoosing(false); setReplay(false); setReplayFrom(null); setReplayTo(null); setCursor(maxCursor); setResetId(n => n + 1); setHint('已退出回放，显示全部已加载K线。'); }} aria-label="退出回放" title="退出回放（显示全部K线）"><Icon name="close"/></button>
        </div>
        <div className="console-row range-row">
          <button className="range-open" data-testid="open-range" onClick={() => { setRangeOpen(true); setPlaying(false); }}><Icon name="calendar"/>回放区间…</button>
          <i className="separator"/>
          <span className="console-quick">快捷</span>
          {([[100, '近100根'], [500, '近500根'], [null, '全部']] as const).map(([count, label]) => <button key={label} data-testid={`quick-${count ?? 'all'}`} onClick={() => quickRange(count)}>{label}</button>)}
          <span className="console-range-hint" data-testid="range-summary">{replayFrom === null ? '起点未限制' : `起点 ${formatDateTime(replayFrom)}`} · {replayTo === null ? '到数据末尾' : `终点 ${formatDateTime(replayTo)}`} · 约 {rangeTotal} 根</span>
          <span className="console-spacer" />
          <span className="console-range-hint">拖动或用日历精确选起止时间（UTC+8）</span>
        </div>
      </nav>
      {/* 交易面板：默认停在右侧抽屉（可拖宽），也可切回底部或隐藏；底部/抽屉都带可拖动分隔条。 */}
      {ui.tradePanel === 'bottom' && <>
        <div className="splitter horizontal" role="separator" aria-label="调整底部面板高度" data-testid="splitter-bottom" onPointerDown={event => startDrag('bottom', event)} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag} onDoubleClick={() => resetPanel('bottom')} title="拖动改高度 · 双击恢复默认" />
        <section className="bottom-panel" aria-label="模拟交易面板" data-testid="trade-panel-bottom">
          {tradingPanel}
        </section>
      </>}
      {ui.tradePanel === 'float' && <aside className="trade-float" data-testid="trade-float" aria-label="浮动下单面板" style={{ left: floatAt.x, top: floatAt.y }}>
        <header className="trade-float-head" data-testid="trade-float-handle" onPointerDown={event => beginPanelDrag(event, 'float')} onDoubleClick={() => { const at = { x: 980, y: 120 }; setFloatAt(at); setSettings(state => ({ ...state, ui: { ...state.ui, floatX: at.x, floatY: at.y } })); setHint('下单面板已回到默认位置。'); }}>
          <span className="grip" aria-hidden="true">⠿</span>
          <strong>下单</strong>
          {account.position && <span className={`position-chip ${account.position.side}`}>{account.position.side === 'long' ? '多' : '空'} {qtyText(account.position.qty)}</span>}
          <span className="drawer-actions">
            {account.position && <button aria-label="一键平仓" title="一键平仓" data-testid="float-close" onClick={() => submit('close', 'market')}>平</button>}
            <button aria-label="停靠到右侧" title="停靠到右侧" onClick={() => setTradePanel('right')}>⇥</button>
            <button aria-label="停靠到底部" title="停靠到底部" onClick={() => setTradePanel('bottom')}>⤓</button>
            <button aria-label="隐藏交易面板" title="隐藏" onClick={() => setTradePanel('hidden')}>✕</button>
          </span>
        </header>
        {tradingPanel}
      </aside>}
      {ui.tradePanel === 'right' && <aside className={`trade-drawer${drawerWidth < 340 ? ' narrow' : ''}`} aria-label="交易抽屉" data-testid="trade-drawer" data-width={drawerWidth} style={{ width: drawerWidth }}>
        <div className="splitter vertical" role="separator" aria-label="调整交易面板宽度" data-testid="splitter-drawer" onPointerDown={event => startDrag('drawer', event)} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag} onDoubleClick={() => resetPanel('drawer')} title="拖动改宽度 · 双击恢复默认" />
        <header className="drawer-head" onPointerDown={event => beginPanelDrag(event, 'drawer')} title="按住拖动可把下单面板拖成浮动窗口">
          <span className="grip" aria-hidden="true">⠿</span>
          <strong>模拟交易</strong>
          {account.position && <span className={`position-chip ${account.position.side}`}>{account.position.side === 'long' ? '多' : '空'} {qtyText(account.position.qty)}</span>}
          <span className="drawer-actions">
            {account.position && <button aria-label="一键平仓" title="一键平仓" data-testid="drawer-close" onClick={() => submit('close', 'market')}>平</button>}
            <button aria-label="停靠到底部" title="停靠到底部" onClick={() => setTradePanel('bottom')}>⤓</button>
            <button aria-label="隐藏交易面板" title="隐藏" onClick={() => setTradePanel('hidden')}>✕</button>
          </span>
        </header>
        {tradingPanel}
      </aside>}
    </section>
    <footer className="statusbar" aria-label="状态栏"><span role="status" data-testid="status">{hint}</span><span className="status-legend">{alerts.length ? `预警 ${alerts.length}` : ''}</span><button className="hotkey-link" aria-label="快捷键" aria-pressed={helpOpen} data-testid="hotkey-help" onClick={() => setHelpOpen(value => !value)}>快捷键</button><a href="https://www.tradingview.com/" target="_blank" rel="noreferrer">TradingView Lightweight Charts™</a></footer>
    {helpOpen && <div className="popup-menu hotkey-menu" role="menu" aria-label="快捷键" data-testid="hotkey-menu">
      {HOTKEY_HELP.map(item => <div key={item.keys} className="hotkey-row"><kbd>{item.keys}</kbd><span>{item.label}</span></div>)}
      <i className="menu-divider" /><small>输入框聚焦时快捷键自动让行</small>
    </div>}
    <aside className="right-rail" aria-label="右侧工具栏">
      <button aria-label="自选列表" title="自选列表" aria-pressed={settings.ui.watchlist} onClick={() => toggleUi('watchlist')}><Icon name="watchlist"/></button>
      <button aria-label="数据窗口" title="数据窗口：悬停K线 OHLC 与成交量" aria-pressed={settings.ui.dataWindow} onClick={() => toggleUi('dataWindow')}><Icon name="position"/></button>
      <button aria-label="绘图对象树" title="绘图对象" aria-pressed={objectsOpen} onClick={() => setObjectsOpen(v => !v)}><Icon name="layers"/></button>
      <button aria-label="笔记" title="训练笔记" aria-pressed={panelTab === 'notes'} onClick={() => { setPanelTab('notes'); setSettings(state => ({ ...state, ui: { ...state.ui, bottomPanel: true } })); }}><Icon name="text"/></button>
      <button aria-label="性能面板" title="性能面板：渲染帧率、图表同步与指标计算耗时" aria-pressed={perfOpen} onClick={() => setPerfOpen(value => !value)}><Icon name="ruler"/></button>
      <button aria-label="训练档案" data-testid="open-archive" title="训练档案：跨场战绩、累计曲线与 CSV 导出" aria-pressed={archiveOpen} onClick={() => setArchiveOpen(value => !value)}><Icon name="trophy"/></button>
    </aside>
    {layoutOpen && <div className="popup-menu layout-menu" role="menu" aria-label="布局菜单" data-testid="layout-menu">
      {uiToggles.map(([key, label]) => <button key={key} role="menuitemcheckbox" aria-checked={settings.ui[key]} onClick={() => toggleUi(key)}><span className="check">{settings.ui[key] ? '✓' : ''}</span>{`显示${label}`}</button>)}
      <i className="menu-divider" />
      <small>交易面板位置</small>
      {([['right', '右侧抽屉'], ['bottom', '底部'], ['float', '浮动'], ['hidden', '隐藏']] as const).map(([where, label]) => <button key={where} role="menuitemradio" aria-checked={ui.tradePanel === where} data-testid={`trade-panel-${where}`} onClick={() => setTradePanel(where)}><span className="check">{ui.tradePanel === where ? '✓' : ''}</span>{label}</button>)}
      <i className="menu-divider" />
      <small>面板尺寸</small>
      {([['compact', '紧凑'], ['standard', '标准'], ['wide', '宽敞']] as const).map(([preset, label]) => <button key={preset} role="menuitem" data-testid={`panel-size-${preset}`} onClick={() => applyPanelSize(preset)}>{label}</button>)}
      <button role="menuitem" data-testid="reset-layout" onClick={() => { resetPanel('bottom'); resetPanel('drawer'); }}>重置面板尺寸</button>
      <small>拖动分隔条可自由改尺寸，双击恢复默认</small>
    </div>}
    {saveOpen && <div className="popup-menu save-menu" role="menu" aria-label="项目菜单" data-testid="save-menu">
      <button role="menuitemcheckbox" aria-checked={settings.autosave} data-testid="autosave-toggle" onClick={() => setSettings(state => ({ ...state, autosave: !state.autosave }))}><span className="check">{settings.autosave ? '✓' : ''}</span>自动保存</button>
      <button role="menuitem" data-testid="export-project" onClick={exportProject}>导出项目文件</button>
      <button role="menuitem" data-testid="import-project" onClick={importProject}>导入项目文件</button>
      <button role="menuitem" data-testid="clear-project" onClick={resetArchive}>清除本地存档并重置</button>
      <small>自动保存在本机；可导出项目文件</small>
    </div>}
    {searchOpen && <div className="dialog-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) setSearchOpen(false); }}><div className="date-dialog search-dialog" role="dialog" aria-label="搜索品种" data-testid="search-dialog">
      <h3>行情品种<small>{classLabel(assetClass)} · {classInstruments(assetClass).length} 个品种 · 数据源见下</small></h3>
      <div className="class-tabs" data-testid="class-tabs">
        {ASSET_CLASSES.map(item => <button key={item.id} className={assetClass === item.id ? 'active' : ''} aria-pressed={assetClass === item.id} data-testid={`class-${item.id}`} title={item.source} onClick={() => setAssetClass(item.id)}>
          {item.short}{!item.ready && <em>未接通</em>}</button>)}
      </div>
      <label>搜索品种<input type="search" aria-label="搜索品种名称" placeholder={assetClass === 'forex' ? 'EURUSD / USDJPY…' : 'BTC / ETH / SOL…'} autoFocus value={searchQuery} onChange={e => setSearchQuery(e.target.value)} data-testid="search-input"/></label>
      <div className="symbol-list">
        <button data-testid="use-builtin" aria-pressed={!live} onClick={() => { useBuiltinSnapshot(); setSearchOpen(false); }}><strong>内置 BTC 快照</strong><small>离线 · OKX 历史样本</small><span className="muted">{live ? '' : '使用中'}</span><span className="muted" /></button>
        {symbolLoading && !classInstruments(assetClass).length && <p className="symbol-empty">正在加载品种列表…</p>}
        {!symbolLoading && classInstruments(assetClass).filter(entry => !searchQuery.trim() || entry.symbol.toLowerCase().includes(searchQuery.trim().toLowerCase()) || entry.base.toLowerCase().includes(searchQuery.trim().toLowerCase())).slice(0, 400).map(entry => {
          const ticker = board[entry.symbol];
          const cached = barsCache.has(`${entry.kind}|${entry.symbol}`);
          return <button key={entry.symbol} data-testid="symbol-row" data-cached={cached} aria-pressed={live && entry.symbol === symbol} onClick={() => void loadInstrument(entry, entry.kind)}>
            <strong>{entry.symbol}</strong><small>{entry.note ?? `${entry.base} / ${entry.quote}`}{cached ? ' · 已缓存' : ''}</small>
            <span>{ticker ? priceText(ticker.price, settings.sim.tickSize) : '—'}</span>
            <span className={ticker && ticker.changePercent < 0 ? 'negative' : 'positive'}>{ticker ? `${ticker.changePercent >= 0 ? '+' : ''}${ticker.changePercent.toFixed(2)}%` : ''}</span>
          </button>;
        })}
        {!symbolLoading && !classInstruments(assetClass).length && <p className="symbol-empty">该分类暂无可用品种（网络受限或清单为空）。</p>}
      </div>
      <p className="class-source" data-testid="class-source">{ASSET_CLASSES.find(item => item.id === assetClass)?.source}{assetClass === 'crypto-spot'
          ? (symbolLoading ? ' · 本地清单（后台刷新实时表中…）' : symbolList.length ? ' · 实时品种表' : ' · 本地清单')
          : assetClass !== 'forex'
            ? universeState === 'loading' ? ' · 本地快照（后台刷新实时表…）' : universeState === 'snapshot' ? ' · 本地快照（实时表不可达）' : universeState === 'live' ? ' · 实时品种表' : ' · 本地快照'
            : ''}{batch ? ` · 批量抓取 ${batch.done}/${batch.total}` : ''}</p>
      <footer>
        <button type="button" data-testid="fetch-class" disabled={!isReady(assetClass) || feedState === 'loading'} onClick={() => void fetchClass()}>{batch ? `抓取中 ${batch.done}/${batch.total}` : `批量抓取「${classLabel(assetClass)}」`}</button>
        <button type="button" onClick={() => setSearchOpen(false)}>关闭</button>
      </footer>
    </div></div>}
        {settingsOpen && settingsDraft && <div className="dialog-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) { setSettingsOpen(false); setSettingsDraft(null); } }}><form className="date-dialog settings-dialog" role="dialog" aria-label="全局设置" data-testid="settings-dialog" onSubmit={e => { e.preventDefault(); applySettings(); }}><h3>全局设置</h3>
      <label className="inline-label">主题<select aria-label="主题" value={settingsDraft.theme} onChange={e => setSettingsDraft({ ...settingsDraft, theme: e.target.value === 'dark' ? 'dark' : 'light' })}><option value="light">亮色</option><option value="dark">暗色</option></select></label>
      <label className="check-row"><input type="checkbox" aria-label="记住回放区间" checked={settingsDraft.rememberRange} onChange={e => setSettingsDraft({ ...settingsDraft, rememberRange: e.target.checked })}/>记住回放区间（关闭则每次启动回到全区间）</label>
      <div className="cache-row" data-testid="cache-row">
        <span>本地深历史缓存：{cacheItems.length} 个数据集 · {formatBytes(cacheBytes)}</span>
        <button type="button" data-testid="cache-clear" onClick={() => void historyClear().then(count => { void refreshCacheInfo(); setHint(`已清空本地缓存（${count} 个数据集）。`); })}>清空缓存</button>
      </div>
      <label title="以 USDT 计价的本金；切到币本位时按标记价折算给引擎">模拟权益（USDT）<input type="number" aria-label="模拟权益" min={100} step={100} value={settingsDraft.sim.equity} onChange={e => setSettingsDraft({ ...settingsDraft, sim: { ...settingsDraft.sim, equity: Number(e.target.value) }, initialCash: Number(e.target.value) })}/></label>
      <label>杠杆<select aria-label="默认杠杆" value={settingsDraft.sim.leverage} onChange={e => setSettingsDraft({ ...settingsDraft, sim: { ...settingsDraft.sim, leverage: Number(e.target.value) } })}>{LEVERAGES.map(value => <option key={value} value={value}>{value}×</option>)}</select></label>
      <label>保证金模式<select aria-label="默认保证金模式" value={settingsDraft.sim.marginMode} onChange={e => setSettingsDraft({ ...settingsDraft, sim: { ...settingsDraft.sim, marginMode: e.target.value as SimConfig['marginMode'] } })}><option value="cross">全仓</option><option value="isolated">逐仓</option></select></label>
      <label>吃单手续费（bp）<input type="number" aria-label="吃单手续费" min={0} max={100} step={0.5} value={settingsDraft.sim.takerBps} onChange={e => setSettingsDraft({ ...settingsDraft, sim: { ...settingsDraft.sim, takerBps: Number(e.target.value) } })}/></label>
      <label>挂单手续费（bp）<input type="number" aria-label="挂单手续费" min={0} max={100} step={0.5} value={settingsDraft.sim.makerBps} onChange={e => setSettingsDraft({ ...settingsDraft, sim: { ...settingsDraft.sim, makerBps: Number(e.target.value) } })}/></label>
      <label>市价滑点（bp）<input type="number" aria-label="市价滑点" min={0} max={100} step={0.5} value={settingsDraft.sim.slippageBps} onChange={e => setSettingsDraft({ ...settingsDraft, sim: { ...settingsDraft.sim, slippageBps: Number(e.target.value) } })}/></label>
      <label>资金费率（%/8h）<input type="number" aria-label="资金费率" step={0.001} value={Number((settingsDraft.sim.fundingRate8h * 100).toFixed(4))} onChange={e => setSettingsDraft({ ...settingsDraft, sim: { ...settingsDraft.sim, fundingRate8h: Number(e.target.value) / 100 } })}/></label>
      <label>维持保证金率（%）<input type="number" aria-label="维持保证金率" min={0} max={50} step={0.1} value={Number((settingsDraft.sim.maintenanceMarginRate * 100).toFixed(3))} onChange={e => setSettingsDraft({ ...settingsDraft, sim: { ...settingsDraft.sim, maintenanceMarginRate: Number(e.target.value) / 100 } })}/></label>
      <label>价格精度 / 最小数量<input aria-label="精度与最小数量" value={`${settingsDraft.sim.tickSize} / ${settingsDraft.sim.minQty}`} readOnly/></label>
      <label>默认下单数量（BTC）<input aria-label="默认下单数量" value={settingsDraft.defaultQty} onChange={e => setSettingsDraft({ ...settingsDraft, defaultQty: e.target.value })}/></label>
      <div className="preset-block" data-testid="preset-block"><small>账户方案（点应用即切换全真口径）</small>
        {settingsDraft.presets.length ? settingsDraft.presets.map(preset => <div key={preset.id} className="preset-row"><span>{preset.name}<em>{preset.sim.leverage}× {preset.sim.marginMode === 'cross' ? '全仓' : '逐仓'} · taker {preset.sim.takerBps}bp</em></span><button type="button" onClick={() => setSettingsDraft({ ...settingsDraft, sim: { ...preset.sim } })}>应用</button><button type="button" onClick={() => setSettingsDraft({ ...settingsDraft, presets: settingsDraft.presets.filter(entry => entry.id !== preset.id) })}>删除</button></div>) : <p className="preset-empty">还没有方案：调好下面参数后点“存为方案”。</p>}
        <div className="preset-save"><input aria-label="方案名称" placeholder="方案名称（如 10k-3x-全仓）" value={presetName} onChange={e => setPresetName(e.target.value)} /><button type="button" data-testid="save-preset" onClick={() => { const name = presetName.trim() || `${settingsDraft.sim.equity}-${settingsDraft.sim.leverage}x`; setSettingsDraft({ ...settingsDraft, presets: [...settingsDraft.presets, { id: `preset-${Date.now().toString(36)}`, name, sim: { ...settingsDraft.sim } }] }); setPresetName(''); }}>存为方案</button></div>
      </div>
      <div className="preset-block hotkey-block" data-testid="hotkey-block"><small>快捷键（全局生效，焦点在输入框里时自动让行）</small>
        {HOTKEY_HELP.map(item => <div key={item.keys} className="hotkey-row"><kbd>{item.keys}</kbd><span>{item.label}</span></div>)}
      </div>
      <label className="inline-label"><input type="checkbox" aria-label="自动保存" checked={settingsDraft.autosave} onChange={e => setSettingsDraft({ ...settingsDraft, autosave: e.target.checked })}/>自动保存到本机</label>
      <label className="inline-label"><input type="checkbox" aria-label="自动接入Binance" checked={settingsDraft.autoFeed} onChange={e => setSettingsDraft({ ...settingsDraft, autoFeed: e.target.checked })}/>打开时自动接入 Binance 行情</label>
      <p>数据通道：{shell?.mode === 'mac-app' ? 'Mac 应用（Binance 智能路由，主站被阻自动回退镜像）' : '浏览器直连 Binance'}。账户口径：USDT 本位永续，双向持仓、杠杆与保证金实时折算；手续费（吃单/挂单）、市价滑点、资金费按 8 小时结算，强平按维持保证金率触发。权益/杠杆在重新开始或选择新起点后生效。</p>
      <footer><button type="button" data-testid="restore-defaults" onClick={() => setSettingsDraft({ ...defaultSettings, ui: { ...defaultSettings.ui } })}>恢复默认</button><button type="button" onClick={() => { setSettingsOpen(false); setSettingsDraft(null); }}>取消</button><button className="primary" type="submit">保存</button></footer></form></div>}
    {session && sessionResult && <SessionResultDialog stats={sessionResult.stats} trade={sessionResult.trade} alerts={sessionResult.stats.alertLines} market={live ? symbol : 'BTCUSDT.P'} unit={settleUnit} onKeep={keepSession} onDiscard={discardSession} onExport={exportSession} />}
    {archiveOpen && <ArchiveDialog entries={archive} currentUnit={settleUnit} onDelete={deleteArchiveEntry} onClear={clearArchive} onExport={exportArchive} onClose={() => setArchiveOpen(false)} />}
    {rangeOpen && <DateRangeDialog from={replayFrom} to={replayTo} dataStart={dataStart} dataEnd={dataEnd} barSeconds={(live ? intervalMinutes : minutes) * 60}
      onApply={(from, to) => { setRangeOpen(false); applyRange(from, to); }} onClose={() => setRangeOpen(false)} />}
    {dashOpen && <Dashboard records={recordStore.records} unit={settleUnit} onExport={exportRecords} onClear={() => { clearHistory(); setRecordStore({ version: 1, records: [] }); setHint('战绩库已清空（本机记录一并删除）。'); }} onClose={() => setDashOpen(false)} />}
    {indicatorOpen && <IndicatorDialog open active={indicators} editId={indicatorEditId} favorites={settings.favorites} onTemplate={applyTemplate} onFavorite={toggleFavorite} onAdd={(defId, inputs) => { const id = `ind-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`; setIndicators(list => [...list, { id, defId, inputs, visible: true }]); setHint(`已添加指标 ${INDICATOR_MAP[defId]?.name ?? defId}。`); }} onUpdate={instance => setIndicators(list => list.map(entry => entry.id === instance.id ? instance : entry))} onRemove={id => { setIndicators(list => list.filter(entry => entry.id !== id)); setHint('已移除该指标。'); }} onClose={() => { setIndicatorOpen(false); setIndicatorEditId(null); }} />}
    {pythonOpen && <PythonDialog open available={shell?.python === true} instances={pythons} runs={pythonRuns} getCandles={() => visibleCandles} onAdd={(file, params) => { setPythons(list => [...list, { id: `py-${Date.now().toString(36)}`, file, params, visible: true }]); }} onToggle={(id, visible) => setPythons(list => list.map(entry => entry.id === id ? { ...entry, visible } : entry))} onRemove={id => setPythons(list => list.filter(entry => entry.id !== id))} onHint={setHint} onClose={() => setPythonOpen(false)} />}
  </main>;
}
