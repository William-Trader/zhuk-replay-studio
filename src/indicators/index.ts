/*!
 * src/indicators/index.ts - zhuk-replay-studio key core logic
 * (c) 2026 William-Trader (https://github.com/William-Trader)
 * WM: ZRS-09FD416F
 * SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
 * Removing this mark violates the license.
 */
/** Barrel for the pure indicator library: registry, defaults, safe compute entry point, and math re-exports. */
import { OVERLAYS } from './overlays';
import { PANES } from './panes';
import { defaultsOf, resolveInputs } from './params';
import type { CandleLike, IndicatorDef, IndicatorOutput } from './types';

/** All 30 indicators: 13 price overlays, 17 sub-pane studies. */
export const INDICATORS: IndicatorDef[] = [...OVERLAYS, ...PANES];
export const INDICATOR_MAP: Record<string, IndicatorDef> = Object.fromEntries(INDICATORS.map(def => [def.id, def]));

export function defaultInputs(def: IndicatorDef): Record<string, number | string> { return defaultsOf(def.inputs); }

/** Never throws: missing, mistyped or out-of-range inputs fall back to the declared defaults. */
export function computeIndicator(def: IndicatorDef, candles: CandleLike[], inputs?: Record<string, number | string>): IndicatorOutput {
  return def.compute(candles, resolveInputs(def, inputs));
}

export * from './series';
export * from './types';
export * from './templates';
