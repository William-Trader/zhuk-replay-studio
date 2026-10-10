/*!
 * src/market.ts - zhuk-replay-studio key core logic
 * (c) 2026 William-Trader (https://github.com/William-Trader)
 * WM: ZRS-3636F19F
 * SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
 * Removing this mark violates the license.
 */
import rows from './data/history.json';
import metadata from './data/history-meta.json';

export interface Candle { time: number; open: number; high: number; low: number; close: number; volume: number }
export const HISTORY: Candle[] = rows.map(([time, open, high, low, close, volume]) => ({ time, open, high, low, close, volume }));
export const INITIAL_CURSOR = metadata.initialCursor;
export const MIN_CURSOR = 60;
export const PERIODS = [{ minutes: 1, label: '1分' }, { minutes: 5, label: '5分' }, { minutes: 15, label: '15分' }, { minutes: 60, label: '1小时' }, { minutes: 240, label: '4小时' }] as const;
export const CHART_TYPES = [{ type: 'candlestick', label: '蜡烛图' }, { type: 'bar', label: '美国线' }, { type: 'line', label: '折线图' }, { type: 'area', label: '面积图' }] as const;
export type ChartType = (typeof CHART_TYPES)[number]['type'];
export const DEFAULT_CHART_TYPE: ChartType = 'candlestick';
export function isChartType(value: unknown): value is ChartType { return CHART_TYPES.some(entry => entry.type === value); }

/** Only aggregate revealed minute candles: a partly revealed higher timeframe never sees future OHLC. */
export function aggregate(bars: readonly Candle[], minutes: number): Candle[] {
  const result: Candle[] = [];
  const step = minutes * 60;
  for (const bar of bars) {
    const time = Math.floor(bar.time / step) * step;
    const last = result[result.length - 1];
    if (last?.time === time) {
      last.high = Math.max(last.high, bar.high); last.low = Math.min(last.low, bar.low);
      last.close = bar.close; last.volume += bar.volume;
    } else result.push({ ...bar, time });
  }
  return result;
}
/** Aggregation for the whole minute history plus a prefix index.
 *  `prefix[i]` is how many aggregated bars the first `i` minute bars produce, so a replay cursor
 *  becomes a slice instead of a re-bucket per step (same values as `aggregate(bars.slice(0, i))`). */
export function aggregateIndexed(bars: readonly Candle[], minutes: number): { bars: Candle[]; prefix: Int32Array; bucketStart: Int32Array } {
  const result: Candle[] = [];
  const prefix = new Int32Array(bars.length + 1);
  const bucketStart = new Int32Array(bars.length);
  const step = minutes * 60;
  let start = 0;
  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i];
    const time = Math.floor(bar.time / step) * step;
    const last = result[result.length - 1];
    if (last?.time === time) {
      last.high = Math.max(last.high, bar.high); last.low = Math.min(last.low, bar.low);
      last.close = bar.close; last.volume += bar.volume;
    } else { result.push({ ...bar, time }); start = i; }
    prefix[i + 1] = result.length;
    bucketStart[i] = start;
  }
  return { bars: result, prefix, bucketStart };
}
/** Revealed aggregation for a minute cursor: completed buckets plus the bucket still forming.
 *  The last bucket is rebuilt from its own minute bars, so a partial candle never peers ahead. */
export function revealedAggregate(indexed: { bars: Candle[]; prefix: Int32Array; bucketStart: Int32Array }, minuteBars: readonly Candle[], cursor: number, minutes: number): Candle[] {
  const clamped = Math.max(0, Math.min(Math.floor(cursor), minuteBars.length));
  const count = indexed.prefix[clamped];
  if (count <= 0) return [];
  const view = indexed.bars.slice(0, count - 1);
  const start = indexed.bucketStart[clamped - 1];
  view.push(aggregate(minuteBars.slice(start, clamped), minutes)[0]);
  return view;
}
export function cursorForTime(time: number): number {
  if (!Number.isFinite(time)) return MIN_CURSOR;
  let lo = 0, hi = HISTORY.length;
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (HISTORY[mid].time <= time) lo = mid + 1; else hi = mid; }
  return Math.max(MIN_CURSOR, lo);
}
export function stepCursor(cursor: number, minutes: number, direction: 1 | -1): number {
  const c = Math.max(MIN_CURSOR, Math.min(HISTORY.length, cursor));
  const start = Math.floor(HISTORY[c - 1].time / (minutes * 60)) * minutes * 60;
  return cursorForTime(start + (direction === 1 ? 2 * minutes * 60 : 0) - 60);
}
/** Cursor helpers for native datasets (e.g. the Binance feed where one bar = one interval). */
export function cursorForTimeIn(bars: readonly Candle[], time: number, minCursor = MIN_CURSOR): number {
  if (!bars.length) return minCursor;
  if (!Number.isFinite(time)) return Math.min(minCursor, bars.length);
  let lo = 0, hi = bars.length;
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (bars[mid].time <= time) lo = mid + 1; else hi = mid; }
  return Math.max(Math.min(minCursor, bars.length), lo);
}
export function stepBars(cursor: number, count: number, direction: 1 | -1): number {
  const floor = Math.min(MIN_CURSOR, count);
  return Math.max(floor, Math.min(count, cursor + direction));
}
/** One EMA20 step (α = 2/21) — the single place the recurrence lives. */
export function emaStep(value: number, close: number): number { return value + (close - value) * 2 / 21; }
export function ema20(bars: readonly Candle[]) {
  let value = bars[0]?.close ?? 0;
  return bars.map(bar => { value = emaStep(value, bar.close); return { time: bar.time, value }; });
}
/** Incremental EMA20 state for the chart: values[i] is the EMA after bar i. */
export interface EmaCursor { firstTime: number; values: number[] }
/** Extends a cursor to cover `bars`.
 *  Only the last previously known bar may still change while a candle is forming, so the tail is
 *  recomputed from index `values.length - 2` — the result matches `ema20(bars)` exactly. */
export function ema20Extend(cursor: EmaCursor | null, bars: readonly Candle[]): EmaCursor {
  if (!bars.length) return { firstTime: 0, values: [] };
  const reusable = cursor && cursor.firstTime === bars[0].time ? Math.min(cursor.values.length, bars.length) : 0;
  const keep = Math.max(0, reusable - 1);
  const values = keep ? cursor!.values.slice(0, keep) : [];
  let value = values.length ? values[values.length - 1] : bars[0].close;
  if (!values.length) values.push(value);
  for (let i = values.length; i < bars.length; i++) { value = emaStep(value, bars[i].close); values.push(value); }
  return { firstTime: bars[0].time, values };
}
/** 图例数值：优先取光标所在的这一根，没有光标（或该点为空）时回落到最后一个有效值。 */
export function valueAt(data: readonly (number | null)[], index: number): number | null {
  if (index >= 0 && index < data.length) { const value = data[index]; if (value !== null && value !== undefined && Number.isFinite(value)) return value; }
  for (let i = data.length - 1; i >= 0; i--) { const value = data[i]; if (value !== null && value !== undefined && Number.isFinite(value)) return value; }
  return null;
}
export function chartTime(time: number, withDate = false): string {
  const iso = new Date((time + 8 * 3600) * 1000).toISOString();
  return withDate ? `${iso.slice(0, 10)} ${iso.slice(11, 16)}` : iso.slice(11, 16);
}
export function dateInput(time: number) { return chartTime(time, true).replace(' ', 'T'); }
/** 解析 datetime-local 的值：带秒/不带秒都接受（浏览器可能规范化出 :ss）。 */
export function parseDateInput(value: string) {
  const text = String(value ?? '').trim();
  if (!text) return Number.NaN;
  const withSeconds = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(text) ? `${text}:00` : text;
  return Date.parse(`${withSeconds}+08:00`) / 1000;
}

/** Fractional logical positions also support drawing in blank space to either side of the candles. */
export function logicalToTime(logical: number, bars: readonly Candle[], step: number): number {
  if (!bars.length) return logical * step;
  if (logical <= 0) return bars[0].time + logical * step;
  if (logical >= bars.length - 1) return bars[bars.length - 1].time + (logical - bars.length + 1) * step;
  const i = Math.floor(logical);
  return bars[i].time + (bars[i + 1].time - bars[i].time) * (logical - i);
}
export function timeToLogical(time: number, bars: readonly Candle[], step: number): number {
  if (!bars.length) return time / step;
  if (time <= bars[0].time) return (time - bars[0].time) / step;
  const last = bars.length - 1;
  if (time >= bars[last].time) return last + (time - bars[last].time) / step;
  let lo = 0, hi = last;
  while (lo + 1 < hi) { const mid = (lo + hi) >>> 1; if (bars[mid].time <= time) lo = mid; else hi = mid; }
  return lo + (time - bars[lo].time) / (bars[hi].time - bars[lo].time);
}

/** ---- bar 内逐帧路径：复盘波动播放与委托触价的共同基础 ---- */
/** Where a bar's price travels inside the bar: open → first extreme → second extreme → close.
 *  Rising bars sweep low-then-high, falling bars high-then-low, so the wick order matches a real tape. */
export const INTRABAR_STOPS = [0, .35, .7, 1] as const;
export function intrabarPrices(bar: Candle): number[] {
  return bar.close >= bar.open ? [bar.open, bar.low, bar.high, bar.close] : [bar.open, bar.high, bar.low, bar.close];
}
/** Interpolated price at `fraction` (0…1) of the intrabar path, clamped to the bar's own range. */
export function intrabarPrice(bar: Candle, fraction: number): number {
  const f = Math.min(1, Math.max(0, fraction));
  const prices = intrabarPrices(bar);
  for (let i = 0; i < INTRABAR_STOPS.length - 1; i++) {
    const from = INTRABAR_STOPS[i], to = INTRABAR_STOPS[i + 1];
    if (f <= to || i === INTRABAR_STOPS.length - 2) {
      const ratio = to > from ? (f - from) / (to - from) : 0;
      return Math.min(bar.high, Math.max(bar.low, prices[i] + (prices[i + 1] - prices[i]) * ratio));
    }
  }
  return bar.close;
}
/** The bar as it looks while it is still forming: only the visited part of the path, volume accrued.
 *  `fraction === 1` returns exactly the finished bar (open/high/low/close/volume). */
export function partialBar(bar: Candle, fraction: number): Candle {
  const f = Math.min(1, Math.max(0, fraction));
  if (f >= 1) return bar;
  const prices = intrabarPrices(bar);
  let price = bar.close;
  let visited: number[] = [bar.open];
  for (let i = 0; i < INTRABAR_STOPS.length - 1; i++) {
    const from = INTRABAR_STOPS[i], to = INTRABAR_STOPS[i + 1];
    if (f > to) { visited.push(prices[i + 1]); continue; }
    const ratio = to > from ? (f - from) / (to - from) : 0;
    price = prices[i] + (prices[i + 1] - prices[i]) * ratio;
    visited = [...visited, price];
    break;
  }
  return {
    time: bar.time,
    open: bar.open,
    high: Math.max(...visited),
    low: Math.min(...visited),
    close: price,
    volume: bar.volume * f,
  };
}
/** Revealed bars with the newest one still forming — what the chart and the indicators see mid-play. */
export function withFormingBar(bars: readonly Candle[], fraction: number): Candle[] {
  if (!bars.length) return [];
  const view = bars.slice();
  view[view.length - 1] = partialBar(view[view.length - 1], fraction);
  return view;
}
