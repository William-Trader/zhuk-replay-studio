/*!
 * src/indicators/series.ts - zhuk-replay-studio key core logic
 * (c) 2026 William-Trader (https://github.com/William-Trader)
 * WM: ZRS-4384AEB9
 * SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
 * Removing this mark violates the license.
 */
/** Rolling math shared by every indicator: warm-up slots are null, output length always equals input length, inputs are never mutated. */
import type { CandleLike } from './types';

export const nulls = (length: number): (number | null)[] => new Array(length).fill(null);

/** Runs `reduce` over every trailing window of `size` values; windows that do not exist stay null. */
function roll(values: readonly number[], size: number, reduce: (window: number[]) => number | null): (number | null)[] {
  const out = nulls(values.length), n = Math.floor(size);
  if (!Number.isFinite(n) || n < 1) return out;
  for (let end = n; end <= values.length; end++) out[end - 1] = reduce(values.slice(end - n, end));
  return out;
}

/** Re-runs a dense computation on the non-null tail of a sparse series and maps the result back to the original offsets. */
export function align(source: (number | null)[], map: (dense: number[]) => (number | null)[]): (number | null)[] {
  const out = nulls(source.length), start = source.findIndex(value => value !== null);
  if (start < 0) return out;
  map(source.slice(start) as number[]).forEach((value, i) => { out[start + i] = value; });
  return out;
}

export function sum(values: number[], n: number): (number | null)[] {
  return roll(values, n, window => window.reduce((total, value) => total + value, 0));
}
export function sma(values: number[], n: number): (number | null)[] {
  return roll(values, n, window => window.reduce((total, value) => total + value, 0) / window.length);
}
/** Linearly weighted average: the newest value carries the largest weight. */
export function wma(values: number[], n: number): (number | null)[] {
  return roll(values, n, window => { let total = 0; for (let i = 0; i < window.length; i++) total += window[i] * (i + 1); return total / (window.length * (window.length + 1) / 2); });
}
/** Exponential average seeded with the simple average of the first `n` values (TA-Lib / TradingView convention). */
export function ema(values: number[], n: number): (number | null)[] {
  const out = nulls(values.length), size = Math.floor(n);
  if (!Number.isFinite(size) || size < 1 || values.length < size) return out;
  const k = 2 / (size + 1);
  let previous = 0;
  for (let i = 0; i < size; i++) previous += values[i];
  out[size - 1] = previous /= size;
  for (let i = size; i < values.length; i++) { previous += (values[i] - previous) * k; out[i] = previous; }
  return out;
}
/** Wilder's smoothing (RMA / SMMA), seeded with the simple average of the first `n` values. */
export function rma(values: number[], n: number): (number | null)[] {
  const out = nulls(values.length), size = Math.floor(n);
  if (!Number.isFinite(size) || size < 1 || values.length < size) return out;
  let previous = 0;
  for (let i = 0; i < size; i++) previous += values[i];
  out[size - 1] = previous /= size;
  for (let i = size; i < values.length; i++) { previous = (previous * (size - 1) + values[i]) / size; out[i] = previous; }
  return out;
}
/** Hull average: WMA of the difference between two WMAs, smoothed again by sqrt(n). */
export function hma(values: number[], n: number): (number | null)[] {
  const half = Math.max(1, Math.round(n / 2)), root = Math.max(1, Math.round(Math.sqrt(n)));
  const fast = wma(values, half), slow = wma(values, n);
  const diff: (number | null)[] = values.map((_, i) => { const a = fast[i], b = slow[i]; return a !== null && b !== null ? 2 * a - b : null; });
  const out = nulls(values.length), start = diff.findIndex(value => value !== null);
  if (start < 0) return out;
  wma(diff.slice(start) as number[], root).forEach((value, i) => { out[start + i] = value; });
  return out;
}
/** Population standard deviation over the trailing window (TA-Lib STDDEV). */
export function stdev(values: number[], n: number): (number | null)[] {
  return roll(values, n, window => { const mean = window.reduce((total, value) => total + value, 0) / window.length; return Math.sqrt(window.reduce((total, value) => total + (value - mean) ** 2, 0) / window.length); });
}
export function highest(values: number[], n: number): (number | null)[] { return roll(values, n, window => window.reduce((top, value) => Math.max(top, value), window[0])); }
export function lowest(values: number[], n: number): (number | null)[] { return roll(values, n, window => window.reduce((bottom, value) => Math.min(bottom, value), window[0])); }
/** True range; the very first bar falls back to high - low. */
export function trueRange(candles: CandleLike[]): number[] {
  return candles.map((bar, i) => i === 0 ? bar.high - bar.low : Math.max(bar.high - bar.low, Math.abs(bar.high - candles[i - 1].close), Math.abs(bar.low - candles[i - 1].close)));
}
/** Average true range; the first bar has no previous close, so the seed starts at TR[1] and the first value lands on bar `n` (TA-Lib / TradingView convention). */
export function atr(candles: CandleLike[], n: number): (number | null)[] {
  if (!candles.length) return [];
  return [null, ...rma(trueRange(candles).slice(1), n)].slice(0, candles.length);
}
