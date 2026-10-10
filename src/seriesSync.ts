/*!
 * src/seriesSync.ts - zhuk-replay-studio key core logic
 * (c) 2026 William-Trader (https://github.com/William-Trader)
 * WM: ZRS-4BDD4A56
 * SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
 * Removing this mark violates the license.
 */
/** Incremental series sync for the chart layer.
 *  A replay only ever extends the visible data, so series can be appended to with `update()`
 *  instead of being rebuilt with `setData()` on every step (the TradingView-style fast path).
 *  Pure and dependency-free so the planner itself is unit-testable. */

export interface SeriesSync {
  length: number;
  firstTime: number;
  /** 数据集标识（数据源|市场|品种|周期|重载计数）：换了品种/周期/市场就必须整体重建，
   *  否则"同长度同首根时间"会被误判成追加，图上留着上一个品种的K线。 */
  key: string;
}
export type SyncPlan = { mode: 'full' } | { mode: 'append'; from: number };

/** Decides how to sync one series from its previous state and the new time axis.
 *  - unknown series, shorter data or a different first bar → rebuild with `setData`
 *  - same length → rewrite the last point (a forming candle may have changed)
 *  - grown data → rewrite the previous last point, then append the new ones */
export function syncPlan(cache: SeriesSync | null, length: number, firstTime: number, key: string): SyncPlan {
  if (length <= 0) return { mode: 'full' };
  if (!cache || cache.length > length || cache.length === 0) return { mode: 'full' };
  // 数据集变了（切品种/周期/市场）→ 整体重建；只比长度和首根时间会漏判（两个品种同窗口时完全一样）。
  if (cache.key !== key || cache.firstTime !== firstTime) return { mode: 'full' };
  return { mode: 'append', from: Math.max(0, cache.length - 1) };
}
export const syncedState = (length: number, firstTime: number, key: string): SeriesSync => ({ length, firstTime, key });
/** Drops every cached series plan (chart type switches, pane reorder, dataset swaps). */
export function resetSeriesCache(cache: Map<string, SeriesSync>): void { cache.clear(); }
