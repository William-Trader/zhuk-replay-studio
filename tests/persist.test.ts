import { describe, expect, it } from 'vitest';
import {
  PROJECT_KEY, SETTINGS_KEY, clearProject, clearSettings, createNote, DEFAULT_WATCHLIST, defaultSettings, defaultStorage, loadProject, loadSettings,
  MAX_WATCHLIST, memoryStorage, parseProject, projectFileName, sanitizeProject, sanitizeSettings, sanitizeWatchlist, saveProject, saveSettings, serializeProject,
  type ProjectV1, type StorageLike,
} from '../src/persist';
import type { ArchiveEntry } from '../src/archive';

/** Injected storage: the persistence module never talks to a real browser store in tests. */
function fakeStorage(seed: Record<string, string> = {}) {
  const map = new Map(Object.entries(seed));
  return {
    map,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => { map.set(key, value); },
    removeItem: (key: string) => { map.delete(key); },
  };
}
const brokenStorage: StorageLike = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } };

const project = (over: Partial<ProjectV1> = {}): ProjectV1 => ({
  version: 1, savedAt: 1788881340, cursor: 200, minutes: 15, speed: 2, replay: true, showEma: false, keep: true, magnet: true,
  chartType: 'line', quantity: '0.05', source: 'builtin', symbol: 'BTCUSDT', interval: '15m', marketKind: 'spot', indicators: [], pythonIndicators: [],
  replayFrom: 1788_800_000, replayTo: 1788_881_340,
  archive: [],
  drawings: [{ id: 'd1', kind: 'trend-line', points: [{ time: 100, price: 100 }, { time: 200, price: 110 }], color: '#2962ff', width: 2 }],
  marketEvents: [{ id: 'e1', seq: 1, time: 120, side: 'buy', qty: 0.01, price: 100 }],
  orderLog: [{ kind: 'place', seq: 2, order: { id: 'o1', seq: 2, side: 'buy', type: 'limit', qty: 0.01, price: 99, createdCursor: 150 } }],
  notes: [{ id: 'n1', text: '观察', time: 120, createdAt: 1788881340 }],
  ...over,
});

/** 一场已保留的训练档案（默认 BTCUSDT / USDT 结算）。 */
const archiveEntry = (over: Partial<ArchiveEntry> = {}): ArchiveEntry => ({
  id: 'a0', at: 1788881340_000, market: 'BTCUSDT', interval: '15分', minutes: 12, bars: 200, unit: 'USDT',
  startEquity: 10000, equity: 10025, trades: 3, wins: 2, losses: 1, grossProfit: 40, grossLoss: -15,
  realized: 25, fees: 1.5, funding: -.2, best: 30, worst: -15, longTrades: 2, longPnl: 35, shortTrades: 1, shortPnl: -10,
  maxDrawdown: 18, maxDrawdownPct: .0018, avgHoldingMinutes: 6, liquidated: false, alerts: 2,
  ...over,
});

describe('storage injection', () => {
  it('uses the documented project and settings keys', () => { expect(PROJECT_KEY).toBe('zhuk-replay-studio/project/v1'); expect(SETTINGS_KEY).toBe('zhuk-replay-studio/settings/v1'); });
  it('round-trips values through the memory fallback', () => { const store = memoryStorage(); store.setItem('a', '1'); expect(store.getItem('a')).toBe('1'); store.removeItem('a'); expect(store.getItem('a')).toBeNull(); expect(store.getItem('missing')).toBeNull(); });
  it('returns a usable store when the page has no localStorage', () => {
    const store = defaultStorage();
    store.setItem('probe', 'yes');
    expect(store.getItem('probe')).toBe('yes');
    store.removeItem('probe');
    expect(store.getItem('probe')).toBeNull();
  });
  it('only touches storage through the injected interface', () => { const store = fakeStorage(); saveProject(project(), store); expect(store.map.has(PROJECT_KEY)).toBe(true); });
});

describe('project persistence', () => {
  it('saves and reloads a complete project', () => {
    const store = fakeStorage();
    expect(saveProject(project(), store)).toBe(true);
    expect(loadProject(store)).toEqual(project());
  });
  it('keeps drawings, events, orders and notes after a textual round trip', () => {
    const restored = parseProject(serializeProject(project()))!;
    expect(restored.drawings).toHaveLength(1);
    expect(restored.marketEvents[0].side).toBe('buy');
    expect(restored.orderLog[0]).toMatchObject({ kind: 'place', order: { type: 'limit' } });
    expect(restored.notes[0].text).toBe('观察');
  });
  it('returns null when nothing is stored', () => { expect(loadProject(fakeStorage())).toBeNull(); });
  it('clears the stored project', () => { const store = fakeStorage(); saveProject(project(), store); clearProject(store); expect(loadProject(store)).toBeNull(); });
  it.each([2, 0, '1', null])('rejects version %s', version => { expect(sanitizeProject({ ...project(), version })).toBeNull(); });
  it('rejects projects with missing or invalid required fields', () => {
    expect(sanitizeProject({ ...project(), cursor: Number.NaN })).toBeNull();
    expect(sanitizeProject({ ...project(), chartType: 'heikin' })).toBeNull();
    expect(sanitizeProject({ ...project(), notes: undefined })).toBeNull();
    expect(sanitizeProject({ ...project(), replay: 'yes' })).toBeNull();
    expect(sanitizeProject(null)).toBeNull();
    expect(sanitizeProject([])).toBeNull();
  });
  it('drops entries that no longer validate instead of failing the whole project', () => {
    const messy = { ...project(), drawings: [{ id: 'bad' }, ...project().drawings], marketEvents: [{ id: 'x' }, ...project().marketEvents], notes: [{ id: 'y' }, ...project().notes] };
    const clean = sanitizeProject(messy)!;
    expect(clean.drawings).toHaveLength(1);
    expect(clean.marketEvents).toHaveLength(1);
    expect(clean.notes).toHaveLength(1);
  });
  it('survives corrupt text', () => { expect(parseProject('{ not json')).toBeNull(); expect(parseProject('')).toBeNull(); expect(parseProject('null')).toBeNull(); });
  it('never throws when the store is blocked', () => {
    expect(loadProject(brokenStorage)).toBeNull();
    expect(saveProject(project(), brokenStorage)).toBe(false);
    expect(() => clearProject(brokenStorage)).not.toThrow();
  });
  it('accepts every chart type', () => { for (const chartType of ['candlestick', 'bar', 'line', 'area'] as const) expect(sanitizeProject({ ...project(), chartType })?.chartType).toBe(chartType); });
  it('defaults the live-market fields for legacy projects', () => {
    const legacy = sanitizeProject({ ...project(), source: undefined, symbol: undefined, interval: undefined })!;
    expect(legacy.source).toBe('builtin');
    expect(legacy.symbol).toBe('BTCUSDT');
    expect(legacy.interval).toBe('15m');
  });
  it('round-trips a binance project with its symbol and interval', () => {
    const live = project({ source: 'binance', symbol: 'ETHUSDT', interval: '1h' });
    const restored = parseProject(serializeProject(live))!;
    expect(restored).toMatchObject({ source: 'binance', symbol: 'ETHUSDT', interval: '1h' });
  });
  it('round-trips indicator and python selections', () => {
    const withIndicators = project({
      indicators: [{ id: 'i1', defId: 'rsi', inputs: { period: 14 }, visible: true }],
      pythonIndicators: [{ id: 'p1', file: 'custom.py', params: { n: 2 }, visible: false }],
    });
    const restored = parseProject(serializeProject(withIndicators))!;
    expect(restored.indicators?.[0]).toMatchObject({ defId: 'rsi', inputs: { period: 14 }, visible: true });
    expect(restored.pythonIndicators?.[0]).toMatchObject({ file: 'custom.py', params: { n: 2 }, visible: false });
  });
  it('drops malformed indicator entries instead of failing the project', () => {
    const messy = project({ indicators: [{ id: 'x' } as never, { id: 'i1', defId: 'rsi', inputs: {}, visible: true }] });
    const clean = sanitizeProject(messy)!;
    expect(clean.indicators).toHaveLength(1);
    expect(clean.indicators?.[0].defId).toBe('rsi');
  });
  it('round-trips the training archive', () => {
    const withArchive = project({ archive: [archiveEntry({ id: 'a1', at: 1788881340_000, realized: 12.5, trades: 4, wins: 3, losses: 1 })] });
    const restored = parseProject(serializeProject(withArchive))!;
    expect(restored.archive).toHaveLength(1);
    expect(restored.archive?.[0]).toMatchObject({ id: 'a1', realized: 12.5, trades: 4, wins: 3, market: 'BTCUSDT', unit: 'USDT' });
  });
  it('treats a legacy project without an archive as an empty one', () => {
    const legacy = sanitizeProject({ ...project(), archive: undefined })!;
    expect(legacy.archive).toEqual([]);
  });
  it('drops malformed archive entries instead of failing the project', () => {
    const messy = project({ archive: [{ id: 'broken' } as never, archiveEntry({ id: 'a2' })] });
    const clean = sanitizeProject(messy)!;
    expect(clean.archive?.map(entry => entry.id)).toEqual(['a2']);
  });
});

describe('settings persistence', () => {
  it('starts from the documented defaults', () => {
    expect(defaultSettings).toEqual({
      initialCash: 10000, defaultQty: '0.01', autosave: true, autoFeed: true, presets: [], favorites: ['maSet', 'volume', 'bollinger', 'macd'],
      sim: { equity: 10000, settle: 'usdt', qtyUnit: 'base', contractSize: .01, leverage: 3, marginMode: 'cross', takerBps: 5, makerBps: 2, slippageBps: 1, impactBps: 8, fundingRate8h: .0001, tickSize: .1, minQty: .0001, maintenanceMarginRate: .005 },
      orderDefaults: { settle: 'usdt', qtyUnit: 'base', contractSize: .01, leverage: 3, marginMode: 'cross', orderType: 'market', quantity: '0.01', reduceOnly: false, protectOn: false, sl: '', tp: '', trail: '' },
      alertsSound: false, alertsToast: true,
      watchlist: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT', 'ADAUSDT', 'LINKUSDT'],
      rememberRange: true, theme: 'light',
      ui: { leftRail: true, rightRail: true, bottomPanel: true, dataWindow: false, watchlist: false, tradePanel: 'right', bottomHeight: 300, drawerWidth: 380, lastTradePanel: 'right', floatX: 980, floatY: 120 },
    });
  });
  it('sanitizes the simulated-account config and keeps presets usable', () => {
    const settings = sanitizeSettings({ sim: { equity: 5, leverage: 900, marginMode: 'isolated', takerBps: -3, slippageBps: 250, fundingRate8h: 2, tickSize: 0, minQty: -1, maintenanceMarginRate: 9 }, presets: [{ name: '激进', sim: { equity: 20000, leverage: 50 } }, {}] });
    expect(settings.sim).toEqual({ equity: 10000, settle: 'usdt', qtyUnit: 'base', contractSize: .01, leverage: 125, marginMode: 'isolated', takerBps: 5, makerBps: 2, slippageBps: 1, impactBps: 8, fundingRate8h: .0001, tickSize: .1, minQty: .0001, maintenanceMarginRate: .5 });
    expect(settings.presets).toHaveLength(2);
    expect(settings.presets[0]).toMatchObject({ name: '激进', sim: { equity: 20000, leverage: 50 } });
    expect(settings.presets[1].name).toBe('方案 2');
  });
  it('clamps remembered panel sizes and the trade-panel dock', () => {
    const ui = sanitizeSettings({ ui: { bottomHeight: 5, drawerWidth: 99999, tradePanel: 'nonsense' } }).ui;
    expect(ui).toMatchObject({ bottomHeight: 140, drawerWidth: 720, tradePanel: 'right' });
    expect(sanitizeSettings({ ui: { bottomHeight: 480, drawerWidth: 520, tradePanel: 'bottom' } }).ui).toMatchObject({ bottomHeight: 480, drawerWidth: 520, tradePanel: 'bottom' });
    expect(sanitizeSettings({ ui: { tradePanel: 'hidden' } }).ui.tradePanel).toBe('hidden');
    expect(sanitizeSettings({ ui: { lastTradePanel: 'bottom' } }).ui.lastTradePanel).toBe('bottom');
    expect(sanitizeSettings({ ui: { lastTradePanel: 'nonsense' } }).ui.lastTradePanel).toBe('right');
    expect(sanitizeSettings({ ui: { bottomHeight: Number.NaN } }).ui.bottomHeight).toBe(300);
  });
  it('keeps the alert notification switches boolean', () => {
    expect(sanitizeSettings({ alertsSound: true, alertsToast: false })).toMatchObject({ alertsSound: true, alertsToast: false });
    expect(sanitizeSettings({ alertsSound: 'yes' })).toMatchObject({ alertsSound: false, alertsToast: true });
  });
  it('defaults to remembering the replay range and honours an explicit opt-out', () => {
    expect(sanitizeSettings({}).rememberRange).toBe(true);
    expect(sanitizeSettings({ rememberRange: false }).rememberRange).toBe(false);
    expect(sanitizeSettings({ rememberRange: 'nope' } as never).rememberRange).toBe(true);
  });
  it('defaults to the light theme and only accepts the two known themes', () => {
    expect(sanitizeSettings({}).theme).toBe('light');
    expect(sanitizeSettings({ theme: 'dark' }).theme).toBe('dark');
    expect(sanitizeSettings({ theme: 'solarized' } as never).theme).toBe('light');
    expect(defaultSettings.theme).toBe('light');
  });
  it('keeps a user-edited watchlist but never lets junk in', () => {
    // 没有这个字段的老存档 → 默认列表
    expect(sanitizeWatchlist(undefined)).toEqual([...DEFAULT_WATCHLIST]);
    // 用户把自选删空是合法状态，不能又塞回默认值
    expect(sanitizeWatchlist([])).toEqual([]);
    // 大小写、空白、重复、非法代码一律清洗
    expect(sanitizeWatchlist([' solusdt ', 'SOLUSDT', 'btc', '', 'BTC-USDT', 42, 'ETHUSDT'])).toEqual(['SOLUSDT', 'ETHUSDT']);
    expect(sanitizeWatchlist('BTCUSDT')).toEqual([...DEFAULT_WATCHLIST]);
    const many = Array.from({ length: 40 }, (_, index) => `COIN${String(index).padStart(3, '0')}USDT`);
    expect(sanitizeWatchlist(many)).toHaveLength(MAX_WATCHLIST);
    expect(sanitizeSettings({ watchlist: ['aaplusdt'] }).watchlist).toEqual(['AAPLUSDT']);
    // 太短的代码（<5 位）不是交易对，直接丢弃
    expect(sanitizeWatchlist(['AAPL'])).toEqual([]);
  });
  it('sanitizes remembered order defaults (settle / unit / leverage / strings)', () => {
    const defaults = sanitizeSettings({ orderDefaults: { settle: 'coin', qtyUnit: 'contract', leverage: 900, orderType: 'stop', quantity: '2', reduceOnly: true, protectOn: true, sl: '50000', tp: '', trail: '1.5', contractSize: 100 } }).orderDefaults;
    expect(defaults).toMatchObject({ settle: 'coin', qtyUnit: 'contract', leverage: 125, orderType: 'stop', quantity: '2', reduceOnly: true, protectOn: true, sl: '50000', trail: '1.5', contractSize: 100 });
    expect(sanitizeSettings({ orderDefaults: { orderType: 'nonsense', leverage: Number.NaN } }).orderDefaults).toMatchObject({ orderType: 'market', leverage: 3 });
    expect(sanitizeSettings({}).orderDefaults.quantity).toBe('0.01');
    expect(sanitizeSettings({ orderDefaults: { sl: 'x'.repeat(40) } }).orderDefaults.sl).toBe('');
  });
  it('keeps only known indicator ids in the favorites and caps the list', () => {
    const settings = sanitizeSettings({ favorites: ['maSet', 'bad id!', 42, 'volume'] });
    expect(settings.favorites).toEqual(['maSet', 'volume']);
    expect(sanitizeSettings({}).favorites.length).toBeGreaterThan(0);
  });
  it('carries a legacy initialCash into the simulated equity', () => {
    expect(sanitizeSettings({ initialCash: 25000 }).sim.equity).toBe(25000);
  });
  it('keeps the auto-feed switch in settings', () => {
    expect(sanitizeSettings({ autoFeed: false }).autoFeed).toBe(false);
    expect(sanitizeSettings({ autoFeed: 'yes' }).autoFeed).toBe(true);
  });
  it('returns defaults when nothing is stored', () => { expect(loadSettings(fakeStorage())).toEqual(defaultSettings); });
  it('round-trips saved settings', () => {
    const store = fakeStorage();
    const settings = sanitizeSettings({ initialCash: 25000, defaultQty: '0.5', autosave: false, ui: { watchlist: true } });
    expect(saveSettings(settings, store)).toBe(true);
    expect(loadSettings(store)).toEqual(settings);
    expect(loadSettings(store).ui.leftRail).toBe(true);
  });
  it('falls back to defaults on corrupt stored JSON', () => { expect(loadSettings(fakeStorage({ [SETTINGS_KEY]: '{oops' }))).toEqual(defaultSettings); });
  it('clears saved settings', () => { const store = fakeStorage(); saveSettings(defaultSettings, store); clearSettings(store); expect(store.getItem(SETTINGS_KEY)).toBeNull(); });
  it.each([0, 50, 99, Number.NaN, Number.POSITIVE_INFINITY, '10000'])('rejects an unavailable initial cash %s', initialCash => { expect(sanitizeSettings({ initialCash }).initialCash).toBe(10000); });
  it('keeps a valid initial cash and clamps the ceiling', () => { expect(sanitizeSettings({ initialCash: 50000 }).initialCash).toBe(50000); expect(sanitizeSettings({ initialCash: 1e12 }).initialCash).toBe(1e9); });
  it('keeps a usable default quantity', () => { expect(sanitizeSettings({ defaultQty: '  ' }).defaultQty).toBe('0.01'); expect(sanitizeSettings({ defaultQty: '1.5' }).defaultQty).toBe('1.5'); expect(sanitizeSettings({ defaultQty: 7 }).defaultQty).toBe('0.01'); });
  it('keeps the autosave switch and merges partial ui state', () => {
    const settings = sanitizeSettings({ autosave: false, ui: { dataWindow: true } });
    expect(settings.autosave).toBe(false);
    expect(settings.ui).toEqual({ leftRail: true, rightRail: true, bottomPanel: true, dataWindow: true, watchlist: false, tradePanel: 'right', bottomHeight: 300, drawerWidth: 380, lastTradePanel: 'right', floatX: 980, floatY: 120 });
  });
  it('never throws when the store is blocked', () => { expect(loadSettings(brokenStorage)).toEqual(defaultSettings); expect(saveSettings(defaultSettings, brokenStorage)).toBe(false); expect(() => clearSettings(brokenStorage)).not.toThrow(); });
});

describe('export file names and notes', () => {
  it('names exports 交易训练室-项目-YYYYMMDD-HHmm.json', () => { expect(projectFileName(new Date(2026, 8, 17, 9, 5))).toBe('交易训练室-项目-20260917-0905.json'); });
  it('pads single digit months, days, hours and minutes', () => { expect(projectFileName(new Date(2026, 0, 2, 3, 4))).toBe('交易训练室-项目-20260102-0304.json'); });
  it('creates a note at the replay moment and writing time', () => {
    const note = createNote('  突破前高  ', 1788881340, 1788881400000, 'note-1');
    expect(note).toEqual({ id: 'note-1', text: '突破前高', time: 1788881340, createdAt: 1788881400 });
  });
  it('creates unique note ids', () => { expect(createNote('a', 1).id).not.toBe(createNote('a', 1).id); });
});
