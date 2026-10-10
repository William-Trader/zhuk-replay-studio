/*!
 * src/indicators/plots.ts - zhuk-replay-studio key core logic
 * (c) 2026 William-Trader (https://github.com/William-Trader)
 * WM: ZRS-8DE446C2
 * SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
 * Removing this mark violates the license.
 */
/** Palette and sparse-series helpers shared by the overlay and pane indicator sets. */
import type { CandleLike, LevelSpec, PlotSpec } from './types';

// 调色板对齐 TradingView 设计语言：涨 #089981 / 跌 #f23645 / 主色 #2962ff。
export const BLUE = '#2962ff', ORANGE = '#ff6d00', PURPLE = '#9c27b0', GREEN = '#089981', RED = '#f23645', GRAY = '#787b86', TEAL = '#26c6da', AMBER = '#ffb300';

export type Series = (number | null)[];
export const closes = (candles: CandleLike[]): number[] => candles.map(bar => bar.close);
export const highs = (candles: CandleLike[]): number[] => candles.map(bar => bar.high);
export const lows = (candles: CandleLike[]): number[] => candles.map(bar => bar.low);
export const volumes = (candles: CandleLike[]): number[] => candles.map(bar => bar.volume);
export const midpoints = (candles: CandleLike[]): number[] => candles.map(bar => (bar.high + bar.low) / 2);

export const line = (id: string, title: string, data: Series, color?: string, lineStyle?: PlotSpec['lineStyle']): PlotSpec => ({ id, title, type: 'line', data, color, lineStyle });
export const dots = (id: string, title: string, data: Series, color?: string): PlotSpec => ({ id, title, type: 'dots', data, color });
export const histogram = (id: string, title: string, data: Series, colorUp: string, colorDown: string): PlotSpec => ({ id, title, type: 'histogram', data, colorBy: 'sign', colorUp, colorDown });
export const level = (value: number, color: string, title?: string): LevelSpec => ({ value, color, title });

/** Chains two sparse series element-wise; a null on either side yields null. */
export const join = (a: Series, b: Series, fn: (x: number, y: number) => number): Series => a.map((x, i) => { const y = b[i]; return x !== null && y !== null ? fn(x, y) : null; });
/** Moves every value `amount` slots to the right, e.g. Ichimoku spans drawn ahead. */
export const shift = (values: Series, amount: number): Series => values.map((_, i) => i >= amount ? values[i - amount] : null);
/** Percent position of a value inside a rolling range. */
export const percentInRange = (value: number, top: number, bottom: number): number => top === bottom ? 0 : (value - bottom) / (top - bottom) * 100;
