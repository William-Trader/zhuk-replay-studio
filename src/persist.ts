/*!
 * src/persist.ts - zhuk-replay-studio key core logic
 * (c) 2026 William-Trader (https://github.com/William-Trader)
 * WM: ZRS-446C1321
 * SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
 * Removing this mark violates the license.
 */
import { isChartType, type ChartType } from './market';
import { emptyHistoryStore, sanitizeHistoryStore, type HistoryStore } from './history';
import { validDrawing, type Drawing } from './drawing';
import type { MarketEvent, Order, OrderAction } from './orders';
import { defaultSimConfig, sanitizeSimConfig, type SimConfig } from './model';
import { sanitizeArchive, type ArchiveEntry } from './archive';

export const PROJECT_KEY = 'zhuk-replay-studio/project/v1';
export const SETTINGS_KEY = 'zhuk-replay-studio/settings/v1';
export const HISTORY_KEY = 'zhuk-replay-studio/history/v1';

/** Minimal synchronous key/value store, injectable so tests run without a browser. */
export interface StorageLike { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }

export function memoryStorage(): StorageLike {
  const map = new Map<string, string>();
  return { getItem: key => map.get(key) ?? null, setItem: (key, value) => { map.set(key, value); }, removeItem: key => { map.delete(key); } };
}

/** localStorage when the page can reach it, otherwise an in-memory fallback. */
export function defaultStorage(): StorageLike {
  try {
    const store = (globalThis as { localStorage?: StorageLike }).localStorage;
    if (store) { const probe = '__zk_probe__'; store.setItem(probe, '1'); store.removeItem(probe); return store; }
  } catch { /* private mode or blocked storage falls back to memory */ }
  return memoryStorage();
}

export interface Note { id: string; text: string; time: number; createdAt: number }
/** Structural shapes for persisted indicator selections (validated in the app). */
export interface StoredIndicator { id: string; defId: string; inputs: Record<string, number | string>; visible: boolean; /** 指标预警开关（缺省开）。 */ alerts?: boolean }
export interface StoredPythonIndicator { id: string; file: string; params: Record<string, unknown>; visible: boolean }
/** 模拟账户方案（F）：整套配置一键切换。 */
export interface SimPreset { id: string; name: string; sim: SimConfig }
export interface Settings {
  initialCash: number; defaultQty: string; autosave: boolean; autoFeed: boolean;
  /** 全真模拟口径：权益、杠杆、保证金模式、手续费、滑点、资金费率与精度。 */
  sim: SimConfig;
  presets: SimPreset[];
  /** 收藏的指标 id（指标库置顶）。 */
  favorites: string[];
  /** 上次下单参数（OKX 那种"记住我的设置"）。 */
  orderDefaults: OrderDefaults;
  /** 指标预警提示：声音 / 屏幕浮层。 */
  alertsSound: boolean;
  alertsToast: boolean;
  /** 自选列表（可增删，本机持久化；不受 ui.watchlist 显隐开关影响）。 */
  watchlist: string[];
  /** 是否把回放区间写进存档（关掉则重启后回到全区间）。 */
  rememberRange: boolean;
  /** 界面主题：亮色 / 暗色。 */
  theme: 'light' | 'dark';
  ui: UiLayout;
}
/** 布局：面板显隐、交易面板停靠位置与可拖动尺寸（本机记忆）。 */
export interface UiLayout {
  leftRail: boolean; rightRail: boolean; bottomPanel: boolean; dataWindow: boolean; watchlist: boolean;
  /** 交易面板停靠：底部 / 右侧抽屉 / 隐藏。 */
  tradePanel: 'bottom' | 'right' | 'float' | 'hidden';
  /** 底部面板高度（px，拖动记忆）。 */
  bottomHeight: number;
  /** 右侧抽屉宽度（px，拖动记忆）。 */
  drawerWidth: number;
  /** 上次的停靠位置（隐藏后按 \ 键恢复到它）。 */
  lastTradePanel: 'bottom' | 'right' | 'float';
  /** 浮动下单面板位置（px，拖动记忆）。 */
  floatX: number;
  floatY: number;
}
export const DEFAULT_BOTTOM_HEIGHT = 300;
export const DEFAULT_DRAWER_WIDTH = 380;
export const MIN_BOTTOM_HEIGHT = 140;
export const MAX_BOTTOM_HEIGHT = 900;
export const MIN_DRAWER_WIDTH = 280;
export const MAX_DRAWER_WIDTH = 720;
/** 下单面板的默认参数：新开一局/重启后按这份恢复。 */
export interface OrderDefaults {
  settle: 'usdt' | 'coin'; qtyUnit: 'base' | 'contract'; contractSize: number;
  leverage: number; marginMode: 'cross' | 'isolated';
  orderType: 'market' | 'limit' | 'stop'; quantity: string; reduceOnly: boolean;
  protectOn: boolean; sl: string; tp: string; trail: string;
}
export const defaultOrderDefaults = (): OrderDefaults => ({ settle: 'usdt', qtyUnit: 'base', contractSize: .01, leverage: 3, marginMode: 'cross', orderType: 'market', quantity: '0.01', reduceOnly: false, protectOn: false, sl: '', tp: '', trail: '' });
/** 自选列表默认品种；用户可增删，存进设置里。 */
export const DEFAULT_WATCHLIST = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT', 'ADAUSDT', 'LINKUSDT'] as const;
/** 自选上限：再多报价板也看不过来，且轮询额度要留着。 */
export const MAX_WATCHLIST = 24;
/** 合约代码形状（与项目存档里的 symbol 校验同一套规则）。 */
export const WATCHLIST_SYMBOL = /^[A-Z0-9]{5,20}$/;
export const defaultSettings: Settings = { initialCash: 10000, defaultQty: '0.01', autosave: true, autoFeed: true, sim: { ...defaultSimConfig }, presets: [], favorites: ['maSet', 'volume', 'bollinger', 'macd'], orderDefaults: defaultOrderDefaults(), alertsSound: false, alertsToast: true, watchlist: [...DEFAULT_WATCHLIST], rememberRange: true, theme: 'light', ui: { leftRail: true, rightRail: true, bottomPanel: true, dataWindow: false, watchlist: false, tradePanel: 'right', bottomHeight: DEFAULT_BOTTOM_HEIGHT, drawerWidth: DEFAULT_DRAWER_WIDTH, lastTradePanel: 'right', floatX: 980, floatY: 120 } };

/** 自选列表清洗：大写、去空白、去重、限长；**没有这个字段**的老存档回落到默认列表，
 *  但显式存成空数组（用户把自选删空）要尊重，不能又给他塞回 8 个。 */
export function sanitizeWatchlist(value: unknown): string[] {
  if (!Array.isArray(value)) return [...DEFAULT_WATCHLIST];
  const list: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') continue;
    const symbol = entry.trim().toUpperCase();
    if (!WATCHLIST_SYMBOL.test(symbol) || list.includes(symbol)) continue;
    list.push(symbol);
    if (list.length >= MAX_WATCHLIST) break;
  }
  return list;
}
export interface ProjectV1 {
  version: 1; savedAt: number; cursor: number; minutes: number; speed: number; replay: boolean; showEma: boolean;
  keep: boolean; magnet: boolean; chartType: ChartType; quantity: string;
  /** Live-market fields; absent on legacy projects and defaulted on load. */
  source?: 'builtin' | 'binance'; symbol?: string; interval?: string;
  /** 品种所属市场（现货/合约/外汇）：不存档的话重启会用错接口（例如把港股合约当现货拉，Binance 返 400）。 */
  marketKind?: 'spot' | 'futures' | 'fx';
  /** 回放区间（秒，UTC；null = 不限制）。 */
  replayFrom?: number | null; replayTo?: number | null;
  indicators?: StoredIndicator[]; pythonIndicators?: StoredPythonIndicator[];
  /** 训练档案：每次「保留结果」落一条战绩；老存档没有这个字段就是空档案。 */
  archive?: ArchiveEntry[];
  drawings: Drawing[]; marketEvents: MarketEvent[]; orderLog: OrderAction[]; notes: Note[];
}

export const MAX_INITIAL_CASH = 1e9;
export function sanitizeSettings(value: unknown): Settings {
  const raw = (value ?? {}) as Partial<Settings>;
  const ui = (raw.ui ?? {}) as Partial<Settings['ui']>;
  return {
    initialCash: Number.isFinite(raw.initialCash) && (raw.initialCash as number) >= 100 ? Math.min(raw.initialCash as number, MAX_INITIAL_CASH) : defaultSettings.initialCash,
    defaultQty: typeof raw.defaultQty === 'string' && raw.defaultQty.trim() ? raw.defaultQty : defaultSettings.defaultQty,
    autosave: typeof raw.autosave === 'boolean' ? raw.autosave : defaultSettings.autosave,
    autoFeed: typeof raw.autoFeed === 'boolean' ? raw.autoFeed : defaultSettings.autoFeed,
    // 老存档只有 initialCash：把它作为没有 sim 时的初始权益。
    sim: sanitizeSimConfig(raw.sim, { ...defaultSimConfig, equity: Number.isFinite(raw.initialCash) && (raw.initialCash as number) >= 100 ? raw.initialCash as number : defaultSimConfig.equity }),
    presets: Array.isArray(raw.presets) ? (raw.presets as unknown[])
      .filter((entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null)
      .map((entry, index): SimPreset => ({ id: typeof entry.id === 'string' ? entry.id : `preset-${index}`, name: typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim().slice(0, 24) : `方案 ${index + 1}`, sim: sanitizeSimConfig(entry.sim) }))
      .slice(0, 12) : [],
    favorites: Array.isArray(raw.favorites) ? raw.favorites.filter((entry): entry is string => typeof entry === 'string' && /^[a-zA-Z0-9_]{1,32}$/.test(entry)).slice(0, 24) : [...defaultSettings.favorites],
    orderDefaults: sanitizeOrderDefaults(raw.orderDefaults),
    alertsSound: raw.alertsSound === true,
    alertsToast: raw.alertsToast !== false,
    watchlist: sanitizeWatchlist(raw.watchlist),
    rememberRange: raw.rememberRange !== false,
    theme: raw.theme === 'dark' ? 'dark' : 'light',
    ui: {
      leftRail: typeof ui.leftRail === 'boolean' ? ui.leftRail : defaultSettings.ui.leftRail,
      rightRail: typeof ui.rightRail === 'boolean' ? ui.rightRail : defaultSettings.ui.rightRail,
      bottomPanel: typeof ui.bottomPanel === 'boolean' ? ui.bottomPanel : defaultSettings.ui.bottomPanel,
      tradePanel: ui.tradePanel === 'bottom' || ui.tradePanel === 'hidden' ? ui.tradePanel : 'right',
      bottomHeight: clampNumber(ui.bottomHeight, MIN_BOTTOM_HEIGHT, MAX_BOTTOM_HEIGHT, DEFAULT_BOTTOM_HEIGHT),
      drawerWidth: clampNumber(ui.drawerWidth, MIN_DRAWER_WIDTH, MAX_DRAWER_WIDTH, DEFAULT_DRAWER_WIDTH),
      lastTradePanel: ui.lastTradePanel === 'bottom' ? 'bottom' : ui.lastTradePanel === 'float' ? 'float' : 'right',
      floatX: Math.max(6, Math.min(4000, Number.isFinite(ui.floatX) ? Number(ui.floatX) : 980)),
      floatY: Math.max(6, Math.min(4000, Number.isFinite(ui.floatY) ? Number(ui.floatY) : 120)),
      dataWindow: typeof ui.dataWindow === 'boolean' ? ui.dataWindow : defaultSettings.ui.dataWindow,
      watchlist: typeof ui.watchlist === 'boolean' ? ui.watchlist : defaultSettings.ui.watchlist,
    },
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
/** 下单默认参数的清洗：数值夹取、字符串长度限制、枚举回落。 */
export function sanitizeOrderDefaults(value: unknown): OrderDefaults {
  const base = defaultOrderDefaults();
  if (!isRecord(value)) return base;
  const text = (entry: unknown, fallback: string, max = 16) => typeof entry === 'string' && entry.length <= max ? entry : fallback;
  return {
    settle: value.settle === 'coin' ? 'coin' : 'usdt',
    qtyUnit: value.qtyUnit === 'contract' ? 'contract' : 'base',
    contractSize: typeof value.contractSize === 'number' && value.contractSize > 0 && value.contractSize <= 1e6 ? value.contractSize : base.contractSize,
    leverage: typeof value.leverage === 'number' && Number.isFinite(value.leverage) ? Math.min(125, Math.max(1, Math.round(value.leverage))) : base.leverage,
    marginMode: value.marginMode === 'isolated' ? 'isolated' : 'cross',
    orderType: value.orderType === 'limit' || value.orderType === 'stop' ? value.orderType : 'market',
    quantity: text(value.quantity, base.quantity),
    reduceOnly: value.reduceOnly === true,
    protectOn: value.protectOn === true,
    sl: text(value.sl, ''), tp: text(value.tp, ''), trail: text(value.trail, ''),
  };
}
/** 尺寸类数值：非法或越界就回落到默认/边界，避免存档把面板拖成 0 高。 */
const clampNumber = (value: unknown, min: number, max: number, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback;
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const side = (value: unknown): value is 'buy' | 'sell' => value === 'buy' || value === 'sell';

function sanitizeEvent(value: unknown): MarketEvent | null {
  if (!isRecord(value) || typeof value.id !== 'string' || !finite(value.seq) || !finite(value.time) || !side(value.side) || !finite(value.qty) || !finite(value.price)) return null;
  return { id: value.id, seq: value.seq, time: value.time, side: value.side, qty: value.qty, price: value.price };
}
function sanitizeOrder(value: unknown): Order | null {
  if (!isRecord(value) || typeof value.id !== 'string' || !finite(value.seq) || !side(value.side) || (value.type !== 'limit' && value.type !== 'stop') || !finite(value.qty) || !finite(value.price) || !finite(value.createdCursor)) return null;
  return { id: value.id, seq: value.seq, side: value.side, type: value.type, qty: value.qty, price: value.price, createdCursor: value.createdCursor };
}
function sanitizeAction(value: unknown): OrderAction | null {
  if (!isRecord(value) || !finite(value.seq)) return null;
  if (value.kind === 'place') { const order = sanitizeOrder(value.order); return order ? { kind: 'place', seq: value.seq, order } : null; }
  if (value.kind === 'cancel' && typeof value.orderId === 'string' && finite(value.cursor)) return { kind: 'cancel', seq: value.seq, orderId: value.orderId, cursor: value.cursor };
  return null;
}
function sanitizeNote(value: unknown): Note | null {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.text !== 'string' || !value.text.trim() || !finite(value.time) || !finite(value.createdAt)) return null;
  return { id: value.id, text: value.text, time: value.time, createdAt: value.createdAt };
}
function sanitizeIndicator(value: unknown): StoredIndicator | null {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.defId !== 'string') return null;
  const inputs: Record<string, number | string> = {};
  if (isRecord(value.inputs)) for (const [key, entry] of Object.entries(value.inputs)) {
    if (typeof entry === 'number' && Number.isFinite(entry)) inputs[key] = entry;
    else if (typeof entry === 'string') inputs[key] = entry;
  }
  return { id: value.id, defId: value.defId, inputs, visible: value.visible !== false, alerts: value.alerts !== false };
}
function sanitizePythonIndicator(value: unknown): StoredPythonIndicator | null {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.file !== 'string') return null;
  return { id: value.id, file: value.file, params: isRecord(value.params) ? value.params : {}, visible: value.visible !== false };
}
function list<T>(value: unknown, sanitize: (entry: unknown) => T | null): T[] {
  return Array.isArray(value) ? value.map(sanitize).filter((entry): entry is T => entry !== null) : [];
}
const drawingOrNull = (value: unknown): Drawing | null => isRecord(value) && validDrawing(value as unknown as Drawing) ? value as unknown as Drawing : null;

/** Strictly validates a stored or imported project; anything else means "no project". */
export function sanitizeProject(value: unknown): ProjectV1 | null {
  if (!isRecord(value) || value.version !== 1) return null;
  if (!finite(value.cursor) || !finite(value.minutes) || !finite(value.speed) || !finite(value.savedAt)) return null;
  if (typeof value.replay !== 'boolean' || typeof value.showEma !== 'boolean' || typeof value.keep !== 'boolean' || typeof value.magnet !== 'boolean') return null;
  if (!isChartType(value.chartType) || typeof value.quantity !== 'string') return null;
  if (!Array.isArray(value.drawings) || !Array.isArray(value.marketEvents) || !Array.isArray(value.orderLog) || !Array.isArray(value.notes)) return null;
  const source: 'builtin' | 'binance' = value.source === 'binance' ? 'binance' : 'builtin';
  const symbol = typeof value.symbol === 'string' && /^[A-Z0-9]{5,20}$/.test(value.symbol) ? value.symbol : 'BTCUSDT';
  const interval = typeof value.interval === 'string' && value.interval.length > 0 && value.interval.length <= 8 ? value.interval : '15m';
  const marketKind: 'spot' | 'futures' | 'fx' = value.marketKind === 'futures' ? 'futures' : value.marketKind === 'fx' ? 'fx' : 'spot';
  return {
    version: 1, savedAt: value.savedAt, cursor: value.cursor, minutes: value.minutes, speed: value.speed,
    replay: value.replay, showEma: value.showEma, keep: value.keep, magnet: value.magnet,
    chartType: value.chartType, quantity: value.quantity,
    source, symbol, interval, marketKind,
    replayFrom: finite(value.replayFrom) ? value.replayFrom : null,
    replayTo: finite(value.replayTo) ? value.replayTo : null,
    indicators: list(value.indicators, sanitizeIndicator), pythonIndicators: list(value.pythonIndicators, sanitizePythonIndicator),
    archive: sanitizeArchive(value.archive),
    drawings: list(value.drawings, drawingOrNull), marketEvents: list(value.marketEvents, sanitizeEvent),
    orderLog: list(value.orderLog, sanitizeAction), notes: list(value.notes, sanitizeNote),
  };
}

export function serializeProject(project: ProjectV1): string { return JSON.stringify(project, null, 2); }
export function parseProject(text: string): ProjectV1 | null {
  try { return sanitizeProject(JSON.parse(text)); } catch { return null; }
}
export function loadProject(storage: StorageLike = defaultStorage()): ProjectV1 | null {
  try { const raw = storage.getItem(PROJECT_KEY); return raw ? parseProject(raw) : null; } catch { return null; }
}
export function saveProject(project: ProjectV1, storage: StorageLike = defaultStorage()): boolean {
  try { storage.setItem(PROJECT_KEY, serializeProject(project)); return true; } catch { return false; }
}
export function clearProject(storage: StorageLike = defaultStorage()): void { try { storage.removeItem(PROJECT_KEY); } catch { /* ignore */ } }
export function loadSettings(storage: StorageLike = defaultStorage()): Settings {
  try { const raw = storage.getItem(SETTINGS_KEY); return raw ? sanitizeSettings(JSON.parse(raw)) : { ...defaultSettings, ui: { ...defaultSettings.ui } }; }
  catch { return { ...defaultSettings, ui: { ...defaultSettings.ui } }; }
}
export function saveSettings(settings: Settings, storage: StorageLike = defaultStorage()): boolean {
  try { storage.setItem(SETTINGS_KEY, JSON.stringify(settings)); return true; } catch { return false; }
}
export function clearSettings(storage: StorageLike = defaultStorage()): void { try { storage.removeItem(SETTINGS_KEY); } catch { /* ignore */ } }

export function loadHistory(storage: StorageLike = defaultStorage()): HistoryStore {
  try { const raw = storage.getItem(HISTORY_KEY); return raw ? sanitizeHistoryStore(JSON.parse(raw)) : emptyHistoryStore(); }
  catch { return emptyHistoryStore(); }
}
export function saveHistory(store: HistoryStore, storage: StorageLike = defaultStorage()): boolean {
  try { storage.setItem(HISTORY_KEY, JSON.stringify(store)); return true; } catch { return false; }
}
export function clearHistory(storage: StorageLike = defaultStorage()): void { try { storage.removeItem(HISTORY_KEY); } catch { /* ignore */ } }
export type { HistoryStore } from './history';

export const DEFAULT_QUANTITY = defaultSettings.defaultQty;

/** Export file name: 交易训练室-项目-YYYYMMDD-HHmm.json */
export function projectFileName(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `交易训练室-项目-${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}.json`;
}

/** Notes remember the replay moment (visible candle time) plus when they were written. */
export function createNote(text: string, time: number, now = Date.now(), id = `note-${now}-${Math.random().toString(36).slice(2, 7)}`): Note {
  return { id, text: text.trim(), time, createdAt: Math.floor(now / 1000) };
}
