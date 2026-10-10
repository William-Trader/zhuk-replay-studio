/*!
 * src/perf.ts - zhuk-replay-studio key core logic
 * (c) 2026 William-Trader (https://github.com/William-Trader)
 * WM: ZRS-0373BD82
 * SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
 * Removing this mark violates the license.
 */
/** Rolling runtime statistics for the performance panel: frame pacing, chart sync and indicator cost.
 *  Pure math, no DOM — the UI feeds it with measured samples. */

export interface PerfSnapshot { fps: number; frameMs: number; chartMs: number; indicatorMs: number; samples: number }
export interface PerfMeter {
  /** Called once per animation frame while the panel is open. */
  frame(now: number): void;
  chart(ms: number): void;
  indicators(ms: number): void;
  snapshot(): PerfSnapshot;
  reset(): void;
}

const KEEP = 90;
const push = (list: number[], value: number) => { if (!Number.isFinite(value) || value < 0) return; list.push(value); if (list.length > KEEP) list.shift(); };
/** Arithmetic mean; 0 for an empty window. Median keeps a single long frame from hiding jank. */
export function mean(values: readonly number[]): number {
  if (!values.length) return 0;
  let total = 0; for (const value of values) total += value;
  return total / values.length;
}

export function createPerfMeter(): PerfMeter {
  let frames: number[] = [], chart: number[] = [], indicators: number[] = [], last: number | null = null, fps = 0;
  return {
    frame(now) {
      if (last !== null) { const delta = now - last; if (delta > 0) { push(frames, delta); fps = 1000 / delta; } }
      last = now;
    },
    chart(ms) { push(chart, ms); },
    indicators(ms) { push(indicators, ms); },
    snapshot() { return { fps: Math.round(fps * 10) / 10, frameMs: Math.round(mean(frames) * 100) / 100, chartMs: Math.round(mean(chart) * 100) / 100, indicatorMs: Math.round(mean(indicators) * 100) / 100, samples: frames.length }; },
    reset() { frames = []; chart = []; indicators = []; last = null; fps = 0; },
  };
}
