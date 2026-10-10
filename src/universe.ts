/*!
 * src/universe.ts - zhuk-replay-studio key core logic
 * (c) 2026 William-Trader (https://github.com/William-Trader)
 * WM: ZRS-A8F0D2DC
 * SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
 * Removing this mark violates the license.
 */
/** 品种分类体系：加密现货 / 加密合约（USDT 永续）/ 大宗（代币化）/ 外汇 / 美股与指数（需数据源）。
 *  纯数据 + 纯函数，无网络 / DOM。 */

import { FUTURES_SNAPSHOT } from './uniFutures';

export type AssetClassId = 'crypto-spot' | 'crypto-perp' | 'equity' | 'hk-equity' | 'other-equity' | 'index' | 'commodity' | 'forex';
export interface AssetClass { id: AssetClassId; label: string; short: string; /** 数据来源说明（展示给用户）。 */ source: string; /** 是否已接通数据源。 */ ready: boolean }
export const ASSET_CLASSES: AssetClass[] = [
  { id: 'crypto-spot', label: '加密货币 · 现货', short: '加密现货', source: 'Binance 现货（全量 USDT 交易对）', ready: true },
  { id: 'crypto-perp', label: '加密货币 · 合约', short: '加密合约', source: 'Binance USDT 本位永续 · 币种合约', ready: true },
  { id: 'equity', label: '美股合约', short: '美股', source: 'Binance USDT 本位永续 · 美股（含预上市）', ready: true },
  { id: 'hk-equity', label: '港股合约', short: '港股', source: 'Binance USDT 本位永续 · 港股', ready: true },
  { id: 'other-equity', label: '韩股 / A股合约', short: '韩A股', source: 'Binance USDT 本位永续 · 韩国/中国股票', ready: true },
  { id: 'index', label: '指数合约', short: '指数', source: 'Binance USDT 本位永续 · 指数（ALL/BTCDOM）', ready: true },
  { id: 'commodity', label: '大宗商品合约', short: '大宗', source: 'Binance USDT 本位永续 · 黄金/白银/铜/原油/天然气/铂/钯', ready: true },
  { id: 'forex', label: '外汇', short: '外汇', source: 'Frankfurter 日线（欧洲央行参考汇率）', ready: true },
];

/** 品种所在的市场类型，决定用哪条抓取链路。 */
export type MarketKind = 'spot' | 'futures' | 'fx';
export interface Instrument { symbol: string; base: string; quote: string; kind: MarketKind; classId: AssetClassId; name?: string; /** 交易面板用的最小变动/合约面值提示。 */ note?: string }

/** 大宗：Binance 上可交易的代币化商品（其余大宗暂无免费可通达源）。 */
export const COMMODITY_INSTRUMENTS: Instrument[] = [
  { symbol: 'PAXGUSDT', base: 'PAXG', quote: 'USDT', kind: 'spot', classId: 'commodity', name: '黄金（PAXG 代币化）', note: '1 PAXG = 1 金衡盎司黄金' },
  { symbol: 'XAUTUSDT', base: 'XAUT', quote: 'USDT', kind: 'spot', classId: 'commodity', name: '黄金（Tether Gold）' },
  { symbol: 'PAXGUSDC', base: 'PAXG', quote: 'USDC', kind: 'spot', classId: 'commodity', name: '黄金 / USDC' },
];

/** 外汇：Frankfurter 以 EUR 为基准，列出常用交叉盘（对 = 基础/计价）。 */
export const FOREX_INSTRUMENTS: Instrument[] = [
  { symbol: 'EURUSD', base: 'EUR', quote: 'USD', kind: 'fx', classId: 'forex', name: '欧元 / 美元' },
  { symbol: 'USDJPY', base: 'USD', quote: 'JPY', kind: 'fx', classId: 'forex', name: '美元 / 日元' },
  { symbol: 'GBPUSD', base: 'GBP', quote: 'USD', kind: 'fx', classId: 'forex', name: '英镑 / 美元' },
  { symbol: 'USDCNY', base: 'USD', quote: 'CNY', kind: 'fx', classId: 'forex', name: '美元 / 人民币' },
  { symbol: 'AUDUSD', base: 'AUD', quote: 'USD', kind: 'fx', classId: 'forex', name: '澳元 / 美元' },
  { symbol: 'USDCHF', base: 'USD', quote: 'CHF', kind: 'fx', classId: 'forex', name: '美元 / 瑞郎' },
  { symbol: 'EURJPY', base: 'EUR', quote: 'JPY', kind: 'fx', classId: 'forex', name: '欧元 / 日元' },
  { symbol: 'EURGBP', base: 'EUR', quote: 'GBP', kind: 'fx', classId: 'forex', name: '欧元 / 英镑' },
  { symbol: 'USDCAD', base: 'USD', quote: 'CAD', kind: 'fx', classId: 'forex', name: '美元 / 加元' },
  { symbol: 'USDHKD', base: 'USD', quote: 'HKD', kind: 'fx', classId: 'forex', name: '美元 / 港币' },
];

/** 加密合约兜底清单：fapi 被墙时（间歇性）至少能列出主流 USDT 永续，数据恢复后会自动换成实时全量。 */
export const PERP_FALLBACK = [
  'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT', 'ADAUSDT', 'LINKUSDT', 'AVAXUSDT', 'DOTUSDT',
  'LTCUSDT', 'TRXUSDT', 'SUIUSDT', 'APTUSDT', 'ARBUSDT', 'OPUSDT', 'TONUSDT', 'NEARUSDT', 'ATOMUSDT', 'FILUSDT',
  'INJUSDT', 'SEIUSDT', 'TIAUSDT', 'AAVEUSDT', 'UNIUSDT', 'ETCUSDT', 'BCHUSDT', 'HBARUSDT', 'ICPUSDT', 'RUNEUSDT',
] as const;
export const perpFallbackInstruments = (): Instrument[] => PERP_FALLBACK.map(symbol => ({
  symbol, base: symbol.replace(/USDT$/, ''), quote: 'USDT', kind: 'futures' as MarketKind, classId: 'crypto-perp' as AssetClassId,
}));

/** 美股与指数：保留清单用于展示与后续接入数据源（当前标为未接通，避免假装有数据）。 */
export const EQUITY_SYMBOLS = ['AAPL', 'MSFT', 'NVDA', 'TSLA', 'AMZN', 'GOOGL', 'META', 'AMD', 'NFLX', 'INTC', 'JPM', 'V', 'AVGO', 'COST', 'BABA'] as const;
export const INDEX_SYMBOLS = ['^GSPC', '^IXIC', '^DJI', '^RUT', '^VIX', '^HSI', '^N225'] as const;

/** 由交易对推断分类：现货按代币化商品/加密现货分；合约查快照的 underlyingType。 */
export function classify(symbol: string, market: 'spot' | 'futures'): AssetClassId {
  if (COMMODITY_INSTRUMENTS.some(item => item.symbol === symbol)) return 'commodity';
  if (market !== 'futures') return 'crypto-spot';
  return classOfFuturesKind(futuresKindOf(symbol));
}
/** 快照里该合约的 underlyingType（COIN / EQUITY / HK_EQUITY / KR_EQUITY / CN_EQUITY / INDEX / COMMODITY / PREMARKET）。 */
export function futuresKindOf(symbol: string): string {
  return FUTURES_SNAPSHOT.find(row => row.symbol === symbol)?.kind ?? 'COIN';
}
/** underlyingType → 分类。 */
export function classOfFuturesKind(kind: string): AssetClassId {
  switch (kind) {
    case 'EQUITY': case 'PREMARKET': return 'equity';
    case 'HK_EQUITY': return 'hk-equity';
    case 'KR_EQUITY': case 'CN_EQUITY': return 'other-equity';
    case 'INDEX': return 'index';
    case 'COMMODITY': return 'commodity';
    default: return 'crypto-perp';
  }
}
/** 从快照取出某个分类的合约品种（fapi 不可达时也能列出清单）。 */
export function snapshotInstruments(id: AssetClassId): Instrument[] {
  const kinds: Record<string, string[]> = {
    'crypto-perp': ['COIN'], equity: ['EQUITY', 'PREMARKET'], 'hk-equity': ['HK_EQUITY'],
    'other-equity': ['KR_EQUITY', 'CN_EQUITY'], index: ['INDEX'], commodity: ['COMMODITY'],
  };
  const wanted = kinds[id];
  if (!wanted) return [];
  return FUTURES_SNAPSHOT.filter(row => wanted.includes(row.kind))
    .map(row => ({ symbol: row.symbol, base: row.base, quote: 'USDT', kind: 'futures' as MarketKind, classId: id, note: row.kind === 'PREMARKET' ? `${row.base} · 预上市` : undefined }));
}
/** 该分类当前是否已接通数据。 */
export const isReady = (id: AssetClassId): boolean => ASSET_CLASSES.find(item => item.id === id)?.ready === true;
export const classLabel = (id: AssetClassId): string => ASSET_CLASSES.find(item => item.id === id)?.short ?? '其他';

/** 外汇对解析：输入形如 EURUSD / USDJPY，拆成基础与计价（Frankfurter 用三字母代码）。 */
export function parseFxPair(text: string): { base: string; quote: string } | null {
  const clean = text.trim().toUpperCase().replace(/[^A-Z]/g, '');
  if (clean.length !== 6) return null;
  return { base: clean.slice(0, 3), quote: clean.slice(3) };
}
/** 外汇：把日线收盘序列合成 OHLC（免费源只给收盘价，H/L 取相邻两日极值，标注为合成）。 */
export function synthesiseOhlc(series: { date: string; rate: number }[]): { time: number; open: number; high: number; low: number; close: number; volume: number }[] {
  return series.map((point, index) => {
    const previous = series[index - 1]?.rate ?? point.rate;
    return {
      time: Math.floor(Date.parse(`${point.date}T00:00:00+08:00`) / 1000),
      open: previous, close: point.rate,
      high: Math.max(previous, point.rate), low: Math.min(previous, point.rate), volume: 0,
    };
  }).filter(bar => Number.isFinite(bar.time) && Number.isFinite(bar.close) && bar.close > 0);
}
/** 由品种名猜市场类型（老存档没有 marketKind 时用来优先重试正确的接口）。 */
export function marketKindOf(symbol: string): MarketKind {
  if (FOREX_INSTRUMENTS.some(item => item.symbol === symbol)) return 'fx';
  if (FUTURES_SNAPSHOT.some(row => row.symbol === symbol)) return 'futures';
  return 'spot';
}

/** 分类里要批量抓取的品种（加密类由实时品种表提供，这里返回静态清单）。 */
export function staticInstruments(id: AssetClassId): Instrument[] {
  if (id === 'commodity') return COMMODITY_INSTRUMENTS;
  if (id === 'forex') return FOREX_INSTRUMENTS;
  return [];
}
