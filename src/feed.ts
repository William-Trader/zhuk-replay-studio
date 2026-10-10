/*!
 * src/feed.ts - zhuk-replay-studio key core logic
 * (c) 2026 William-Trader (https://github.com/William-Trader)
 * WM: ZRS-0BD4B6C0
 * SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
 * Removing this mark violates the license.
 */
import { classOfFuturesKind, synthesiseOhlc } from './universe';
import type { Candle } from './market';

/** Live market feed: Binance REST either through the Mac shell proxy or direct from the browser. */
export const INTERVALS: { value: string; label: string; minutes: number }[] = [
  { value: '1m', label: '1分', minutes: 1 }, { value: '5m', label: '5分', minutes: 5 },
  { value: '15m', label: '15分', minutes: 15 }, { value: '1h', label: '1小时', minutes: 60 },
  { value: '4h', label: '4小时', minutes: 240 }, { value: '1d', label: '1天', minutes: 1440 },
];

export interface MarketSymbol { symbol: string; base: string; quote: string }
export interface Ticker { symbol: string; price: number; changePercent: number; volume: number }
export interface FeedOptions { fetchImpl?: typeof fetch; transport?: 'auto' | 'direct' | 'shell'; dataApi?: boolean }
export interface KlinesQuery {
  symbol: string; interval: string; limit?: number; endTime?: number; market?: 'spot' | 'futures';
  /** 向前（向最新）翻页：只补 startTime 之后的K线，用于本地历史增量补齐。 */
  startTime?: number;
}

type Transport = 'shell' | 'direct';
type Market = 'spot' | 'futures';

const SPOT_HOST = 'https://api.binance.com';
/** CORS-friendly mirror used when the primary host is unreachable. */
const SPOT_MIRROR = 'https://data-api.binance.vision';
const FUTURES_HOST = 'https://fapi.binance.com';
/** 外汇日线数据源（免费、无 key、返回 JSON）。 */
const FX_HOST = 'https://api.frankfurter.app';
/** Binance caps one klines page at 1000 bars; deeper history needs endTime paging. */
const MAX_PAGE = 1000;
/** 单次请求链最多翻多少页：1000 根/页 → 300k 根（15m 约 8 年，1h 约 34 年，足够覆盖主流币全史）。 */
const MAX_PAGES = 300;
/** 单次请求链能取到的最大根数（深抓时按块循环，块大小取它的一部分）。 */
export const MAX_KLINES = MAX_PAGE * MAX_PAGES;
/** 深抓历史的块大小：一次 1 万根，既能显示进度也不会让单次请求太久。 */
export const HISTORY_CHUNK = 10_000;
const KLINES_TTL = 3_000;
const TICKERS_TTL = 15_000;
const SYMBOLS_TTL = 6 * 60 * 60 * 1000;

/** Exchange order is arbitrary for a Chinese-facing board, so mainstream bases come first. */
export const MAINSTREAM_ORDER = [
  'BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'DOGE', 'ADA', 'LINK', 'AVAX', 'LTC', 'DOT', 'TRX', 'SHIB',
  'SUI', 'TON', 'NEAR', 'APT', 'ARB', 'OP', 'UNI', 'BCH', 'ATOM', 'FIL', 'ETC', 'MATIC', 'POL', 'PEPE',
];
const STABLE_BASES = new Set(['USDC', 'FDUSD', 'TUSD', 'BUSD', 'DAI', 'USDP', 'USDE', 'PYUSD', 'USDS', 'USDD']);
const LEVERAGED = /(UP|DOWN|BULL|BEAR)$/;
/** Real spot tickers that merely share a leveraged-token suffix. */
const SUFFIX_TOKENS = new Set(['JUP']);
const RANK = new Map(MAINSTREAM_ORDER.map((base, index) => [base, index] as const));

let transportCache: Promise<Transport> | null = null;
const inflight = new Map<string, Promise<unknown>>();
const fresh = new Map<string, { at: number; value: unknown }>();

/** Tests call this between cases: drops the transport probe, in-flight entries and every TTL value. */
export function resetFeedCache(): void { transportCache = null; inflight.clear(); fresh.clear(); }

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null; }

function toNumber(value: unknown): number { return typeof value === 'number' ? value : Number(value); }

function fetchOf(o?: FeedOptions): typeof fetch {
  if (o?.fetchImpl) return o.fetchImpl;
  return (input, init) => globalThis.fetch(input, init);
}

/** Same-origin base of the hosting shell or page; empty when neither is available. */
function origin(): string {
  const loc = (globalThis as { location?: { origin?: string } }).location;
  return typeof loc?.origin === 'string' ? loc.origin : '';
}

/** In-flight dedupe plus a short TTL, so a drag across the chart cannot stampede Binance. */
function cached<T>(key: string, ttl: number, load: () => Promise<T>): Promise<T> {
  const hit = fresh.get(key) as { at: number; value: T } | undefined;
  if (hit && Date.now() - hit.at < ttl) return Promise.resolve(hit.value);
  const pending = inflight.get(key) as Promise<T> | undefined;
  if (pending) return pending;
  const task = (async () => {
    try {
      const value = await load();
      fresh.set(key, { at: Date.now(), value });
      return value;
    } finally { inflight.delete(key); }
  })();
  inflight.set(key, task);
  return task;
}

/** The Mac shell only proxies on its own origin, so the target travels as one encoded query value. */
async function readJson(url: string, transport: Transport, o?: FeedOptions): Promise<unknown> {
  const target = transport === 'shell' ? `${origin()}/api/market/proxy?url=${encodeURIComponent(url)}` : url;
  const res = await fetchOf(o)(target);
  if (res.status !== 200) throw new Error(`Binance HTTP ${res.status}`);
  const body = await res.text();
  try { return JSON.parse(body) as unknown; } catch { throw new Error('Binance returned invalid JSON'); }
}

/** Spot market data also lives on the public CORS mirror; retry there when the primary host fails. */
function mirrorOf(url: string): string | null {
  if (!url.startsWith(`${SPOT_HOST}/api/v3/`)) return null;
  return `${SPOT_MIRROR}${url.slice(SPOT_HOST.length)}`;
}

async function readJsonWithFallback(url: string, transport: Transport, o?: FeedOptions): Promise<unknown> {
  try {
    return await readJson(url, transport, o);
  } catch (error) {
    const mirror = mirrorOf(url);
    if (!mirror) throw error;
    return await readJson(mirror, transport, o);
  }
}

async function probeTransport(o?: FeedOptions): Promise<Transport> {
  const impl = fetchOf(o);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await impl(`${origin()}/api/health`);
      if (res.status === 200) {
        const body: unknown = await res.json();
        return isRecord(body) && body.mode === 'mac-app' ? 'shell' : 'direct';
      }
    } catch { /* retry once, then fall back to direct */ }
  }
  return 'direct';
}

async function transportFor(o?: FeedOptions): Promise<Transport> {
  if (o?.transport === 'shell') return 'shell';
  if (o?.transport === 'direct') return 'direct';
  transportCache ??= probeTransport(o);
  return transportCache;
}

export async function detectTransport(o?: FeedOptions): Promise<Transport> { return transportFor(o); }

function klinesUrl(symbol: string, interval: string, limit: number, endTime: number | undefined, market: Market, mirror: boolean, startTime?: number): string {
  const base = market === 'futures' ? `${FUTURES_HOST}/fapi/v1/klines` : `${mirror ? SPOT_MIRROR : SPOT_HOST}/api/v3/klines`;
  const parts = [`symbol=${encodeURIComponent(symbol)}`, `interval=${encodeURIComponent(interval)}`, `limit=${limit}`];
  if (endTime !== undefined) parts.push(`endTime=${Math.floor(endTime)}`);
  if (startTime !== undefined) parts.push(`startTime=${Math.floor(startTime)}`);
  return `${base}?${parts.join('&')}`;
}

/** Binance sends numbers as strings and may repeat or corrupt rows; keep only sane candles. */
function cleanKlines(rows: readonly unknown[]): Candle[] {
  const bars: Candle[] = [];
  for (const entry of rows) {
    if (!Array.isArray(entry)) continue;
    const time = toNumber(entry[0]) / 1000;
    const open = toNumber(entry[1]), high = toNumber(entry[2]), low = toNumber(entry[3]), close = toNumber(entry[4]);
    if (!(time > 0) || !Number.isFinite(time)) continue;
    if (![open, high, low, close].every(Number.isFinite)) continue;
    const volume = toNumber(entry[5]);
    bars.push({ time, open, high, low, close, volume: Number.isFinite(volume) ? volume : 0 });
  }
  return bars;
}

export async function fetchKlines(q: KlinesQuery, o?: FeedOptions): Promise<Candle[]> {
  const market: Market = q.market === 'futures' ? 'futures' : 'spot';
  const asked = Number.isFinite(q.limit) ? Math.floor(q.limit as number) : MAX_PAGE;
  const limit = Math.min(Math.max(1, asked), MAX_PAGE * MAX_PAGES);
  const key = `k|${market}|${q.symbol}|${q.interval}|${limit}|${q.endTime ?? ''}|${q.startTime ?? ''}`;
  return cached(key, KLINES_TTL, async () => {
    const transport = await transportFor(o);
    const mirror = o?.dataApi === true;
    const pages = Math.min(MAX_PAGES, Math.ceil(limit / MAX_PAGE));
    const bars = new Map<number, Candle>();
    let cursor = q.endTime;
    let forward = q.startTime;
    for (let page = 0; page < pages; page++) {
      const size = Math.min(MAX_PAGE, limit - page * MAX_PAGE);
      const rows: unknown = await readJsonWithFallback(klinesUrl(q.symbol, q.interval, size, forward === undefined ? cursor : undefined, market, mirror, forward), transport, o);
      if (!Array.isArray(rows)) break;
      const parsed = cleanKlines(rows);
      let oldest = Infinity, newest = -Infinity;
      for (const bar of parsed) { bars.set(bar.time, bar); oldest = Math.min(oldest, bar.time); newest = Math.max(newest, bar.time); }
      // A short page means history ran out; otherwise step the cursor just before the oldest bar.
      if (rows.length < size || !parsed.length) break;
      if (forward !== undefined) forward = newest * 1000 + 1; else cursor = oldest * 1000 - 1;
    }
    return [...bars.values()].sort((a, b) => a.time - b.time);
  });
}

function pickSymbols(raw: unknown): MarketSymbol[] {
  /* The light all-symbols price list carries every tradable pair without exchangeInfo's weight. */
  const list = Array.isArray(raw) ? raw : [];
  const out: MarketSymbol[] = [];
  for (const entry of list) {
    if (!isRecord(entry)) continue;
    const symbol = entry.symbol;
    if (typeof symbol !== 'string' || !symbol.endsWith('USDT')) continue;
    const base = symbol.slice(0, -4);
    if (!base || !/^[A-Z0-9]+$/.test(base)) continue;
    if (LEVERAGED.test(base) && !SUFFIX_TOKENS.has(base)) continue;
    if (STABLE_BASES.has(base)) continue;
    out.push({ symbol, base, quote: 'USDT' });
  }
  // Stable sort: ranked bases first, everything else keeps exchange order.
  return out.sort((a, b) => (RANK.get(a.base) ?? MAINSTREAM_ORDER.length) - (RANK.get(b.base) ?? MAINSTREAM_ORDER.length));
}

export async function fetchSymbols(o?: FeedOptions): Promise<MarketSymbol[]> {
  const mirror = o?.dataApi === true;
  return cached(`s|${mirror ? 'vision' : 'binance'}`, SYMBOLS_TTL, async () => {
    const transport = await transportFor(o);
    const raw = await readJsonWithFallback(`${mirror ? SPOT_MIRROR : SPOT_HOST}/api/v3/ticker/price`, transport, o);
    return pickSymbols(raw);
  });
}

function cleanTickers(raw: unknown): Ticker[] {
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const out: Ticker[] = [];
  for (const entry of list) {
    if (!isRecord(entry)) continue;
    const symbol = entry.symbol;
    if (typeof symbol !== 'string' || !symbol) continue;
    const price = toNumber(entry.lastPrice);
    if (!Number.isFinite(price)) continue;
    const change = toNumber(entry.priceChangePercent), volume = toNumber(entry.quoteVolume);
    out.push({ symbol, price, changePercent: Number.isFinite(change) ? change : 0, volume: Number.isFinite(volume) ? volume : 0 });
  }
  return out;
}

/** 历史资金费率（永续，每 8 小时一条）：复盘按真实费率结算，而不是只用配置里的常数。 */
export interface FundingRate { time: number; rate: number }
export const FUNDING_TTL = 10 * 60 * 1000;
export async function fetchFundingRates(symbol: string, o?: FeedOptions, limit = 1000): Promise<FundingRate[]> {
  const size = Math.min(Math.max(1, Math.floor(limit)), MAX_PAGE);
  const key = `fund|${symbol}|${size}`;
  return cached(key, FUNDING_TTL, async () => {
    const transport = await transportFor(o);
    const rows: unknown = await readJsonWithFallback(`${FUTURES_HOST}/fapi/v1/fundingRate?symbol=${encodeURIComponent(symbol)}&limit=${size}`, transport, o);
    if (!Array.isArray(rows)) return [];
    return rows
      .filter(isRecord)
      .map(row => ({ time: Math.floor(toNumber(row.fundingTime) / 1000), rate: toNumber(row.fundingRate) }))
      .filter(entry => Number.isFinite(entry.time) && entry.time > 0 && Number.isFinite(entry.rate))
      .sort((a, b) => a.time - b.time);
  });
}
/** 当前资金费率与下次结算时间（永续实时口径）。 */
export interface PremiumIndex { symbol: string; rate: number; nextFundingTime: number }
export async function fetchPremiumIndex(symbol: string, o?: FeedOptions): Promise<PremiumIndex | null> {
  const key = `prem|${symbol}`;
  return cached(key, FUNDING_TTL, async () => {
    const transport = await transportFor(o);
    const row: unknown = await readJsonWithFallback(`${FUTURES_HOST}/fapi/v1/premiumIndex?symbol=${encodeURIComponent(symbol)}`, transport, o);
    if (!isRecord(row)) return null;
    const rate = toNumber(row.lastFundingRate), next = Math.floor(toNumber(row.nextFundingTime) / 1000);
    return Number.isFinite(rate) && Number.isFinite(next) && next > 0 ? { symbol: String(row.symbol ?? symbol), rate, nextFundingTime: next } : null;
  });
}

/** 8 小时边界（秒）→ 费率，供重放时按边界查表。 */
export function fundingByBoundary(rates: readonly FundingRate[]): Map<number, number> {
  const map = new Map<number, number>();
  for (const entry of rates) map.set(Math.floor(entry.time / (8 * 3600)) * 8 * 3600, entry.rate);
  return map;
}

/** USDT 本位永续全量品种表，按 underlyingType 分桶（加密/美股/港股/韩A股/指数/大宗）。 */
export async function fetchFuturesUniverse(o?: FeedOptions): Promise<Record<string, { symbol: string; base: string; quote: string }[]>> {
  const key = 'fsym|universe';
  return cached(key, 30 * 60 * 1000, async () => {
    const transport = await transportFor(o);
    const raw: unknown = await readJsonWithFallback(`${FUTURES_HOST}/fapi/v1/exchangeInfo`, transport, o);
    const rows = isRecord(raw) && Array.isArray(raw.symbols) ? raw.symbols : [];
    const universe: Record<string, { symbol: string; base: string; quote: string }[]> = {};
    for (const row of rows.filter(isRecord)) {
      // TradFi 合约（美股/港股/韩A股/大宗）的 contractType 是 TRADIFI_PERPETUAL，不是 PERPETUAL。
      const contract = String(row.contractType ?? '');
      if (!contract.endsWith('PERPETUAL') || row.status !== 'TRADING' || row.quoteAsset !== 'USDT') continue;
      const kind = classOfFuturesKind(String(row.underlyingType ?? 'COIN'));
      (universe[kind] ??= []).push({ symbol: String(row.symbol), base: String(row.baseAsset), quote: 'USDT' });
    }
    for (const list of Object.values(universe)) list.sort((left, right) => left.symbol.localeCompare(right.symbol));
    return universe;
  });
}

/** 外汇日线（Frankfurter，欧洲央行参考汇率；免费无 key）。 */
export async function fetchFxDaily(base: string, quote: string, o?: FeedOptions, start = '2015-01-01'): Promise<Candle[]> {
  const key = `fx|${base}|${quote}|${start}`;
  return cached(key, 6 * 60 * 60 * 1000, async () => {
    const transport = await transportFor(o);
    const end = new Date().toISOString().slice(0, 10);
    const url = `${FX_HOST}/${start}..${end}?from=${encodeURIComponent(base)}&to=${encodeURIComponent(quote)}`;
    const raw: unknown = await readJsonWithFallback(url, transport, o);
    const rates = isRecord(raw) && isRecord(raw.rates) ? raw.rates : {};
    const series = Object.entries(rates)
      .map(([date, value]) => ({ date, rate: isRecord(value) ? toNumber(value[quote]) : Number.NaN }))
      .filter(point => Number.isFinite(point.rate) && point.rate > 0)
      .sort((left, right) => left.date.localeCompare(right.date));
    return synthesiseOhlc(series);
  });
}

export async function fetchTickers(symbols: string[], o?: FeedOptions): Promise<Ticker[]> {
  if (!symbols.length) return [];
  const mirror = o?.dataApi === true;
  return cached(`t|${mirror ? 'vision' : 'binance'}|${symbols.join(',')}`, TICKERS_TTL, async () => {
    const transport = await transportFor(o);
    const params = `symbols=${encodeURIComponent(JSON.stringify(symbols))}`;
    const raw = await readJsonWithFallback(`${mirror ? SPOT_MIRROR : SPOT_HOST}/api/v3/ticker/24hr?${params}`, transport, o);
    return cleanTickers(raw);
  });
}
