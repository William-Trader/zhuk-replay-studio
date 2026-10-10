/*!
 * src/indicators/types.ts - zhuk-replay-studio key core logic
 * (c) 2026 William-Trader (https://github.com/William-Trader)
 * WM: ZRS-36F983E3
 * SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
 * Removing this mark violates the license.
 */
/** Pure contracts shared by the indicator library and the chart UI. No DOM, no storage, no network. */

export interface CandleLike { time: number; open: number; high: number; low: number; close: number; volume: number }
export type PlotType = 'line' | 'histogram' | 'area' | 'dots';

/** One drawable series; `data` is always as long as the candle array, warm-up slots are null. */
export interface PlotSpec {
  id: string;            // unique inside one indicator output, e.g. 'upper'
  title: string;         // legend label, e.g. 'BB上轨'
  type: PlotType;
  data: (number | null)[];   // never NaN or Infinity
  color?: string;        // default colour, the UI may override it
  lineStyle?: 'solid' | 'dashed' | 'dotted';
  colorBy?: 'sign';      // histogram colouring by the sign of each value
  colorUp?: string; colorDown?: string;
}
/** Horizontal reference line such as RSI 70/30. */
export interface LevelSpec { value: number; color?: string; title?: string }
export interface IndicatorOutput { plots: PlotSpec[]; levels?: LevelSpec[] }
export interface InputSpec {
  key: string; label: string;
  /** `text` is used for comma-separated period lists (均线组) and similar free text. */
  type: 'number' | 'select' | 'text';
  default: number | string; min?: number; max?: number;
  options?: { value: string; label: string }[];
  /** Placeholder for text inputs. */
  placeholder?: string;
}
export interface IndicatorDef {
  id: string;            // stable English id, e.g. 'bollinger'
  name: string;          // display name, e.g. 'RSI · 相对强弱'
  category: '均线' | '通道' | '趋势' | '动量' | '振荡' | '成交量' | '波动率';
  pane: 'main' | 'sub';  // main = overlay on price, sub = own pane
  inputs: InputSpec[];
  compute(candles: CandleLike[], inputs: Record<string, number | string>): IndicatorOutput;
}
