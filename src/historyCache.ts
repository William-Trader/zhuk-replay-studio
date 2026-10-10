/*!
 * src/historyCache.ts - zhuk-replay-studio key core logic
 * (c) 2026 William-Trader (https://github.com/William-Trader)
 * WM: ZRS-3CFE998E
 * SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
 * Removing this mark violates the license.
 */
/** 深历史本地缓存：K线序列的合并、压缩与判定（纯函数，无 DOM / 存储 / 网络）。
 *  壳（macOS）负责把结果落盘，这里只做数据加工。 */
import type { Candle } from './market';

/** 缓存/网络两段K线合并：按时间去重排序，同一时间以 extra 为准（较新的数据）。 */
export function mergeCandles(base: readonly Candle[], extra: readonly Candle[]): Candle[] {
  if (!base.length) return [...extra].sort((left, right) => left.time - right.time);
  if (!extra.length) return [...base].sort((left, right) => left.time - right.time);
  const map = new Map<number, Candle>();
  for (const bar of base) map.set(bar.time, bar);
  for (const bar of extra) map.set(bar.time, bar);
  return [...map.values()].sort((left, right) => left.time - right.time);
}

const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
/** 落盘用紧凑行：[time, open, high, low, close, volume]。 */
export function toRows(candles: readonly Candle[]): number[][] {
  return candles.map(bar => [bar.time, bar.open, bar.high, bar.low, bar.close, bar.volume ?? 0]);
}
/** 解析落盘行；脏数据（时间/价格非法、high<low）直接丢弃。 */
export function fromRows(rows: unknown): Candle[] {
  if (!Array.isArray(rows)) return [];
  const out: Candle[] = [];
  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 6) continue;
    const [time, open, high, low, close, volume] = row as unknown[];
    if (!isFiniteNumber(time) || !isFiniteNumber(open) || !isFiniteNumber(high) || !isFiniteNumber(low) || !isFiniteNumber(close)) continue;
    if (close <= 0 || open <= 0 || high < low) continue;
    out.push({ time, open, high, low, close, volume: isFiniteNumber(volume) ? volume : 0 });
  }
  return out.sort((left, right) => left.time - right.time);
}

/** 启动决策：本地历史够用就"先显示本地、再后台补齐最新"，否则才联网全量。
 *  复盘工具不需要实时精度，联网只用于把本地历史往前补一段。 */
export type LaunchPlan = { mode: 'cache-first'; since: number; bars: number } | { mode: 'network'; bars: number };
export function planLaunchLoad(cached: readonly Candle[], minBars = 200): LaunchPlan {
  if (cached.length >= minBars) {
    return { mode: 'cache-first', since: cached[cached.length - 1].time + 1, bars: cached.length };
  }
  return { mode: 'network', bars: cached.length };
}

/** 缓存值不值得用：根数明显更多，或覆盖更早的起点（说明是深历史）。 */
export function cacheIsDeeper(cached: readonly Candle[], fresh: readonly Candle[]): boolean {
  if (cached.length < 2) return false;
  if (!fresh.length) return true;
  if (cached[0].time < fresh[0].time) return true;
  return cached.length > fresh.length * 1.2;
}

/** 缓存摘要（状态栏展示）。 */
export function cacheSummary(candles: readonly Candle[], format: (time: number) => string): string {
  if (candles.length < 2) return '无本地缓存';
  return `本地缓存 ${candles.length} 根 · ${format(candles[0].time)} → ${format(candles[candles.length - 1].time)}`;
}

/** 人类可读体积。 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
