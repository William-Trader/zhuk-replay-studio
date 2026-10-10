import { describe, it, expect } from 'vitest';
import { aggregate, aggregateIndexed, ema20, ema20Extend, HISTORY, revealedAggregate, valueAt, type Candle } from '../src/market';
import { createPerfMeter, mean } from '../src/perf';
import { resetSeriesCache, syncPlan, syncedState } from '../src/seriesSync';

const candle = (time: number, close: number): Candle => ({ time, open: close, high: close + 1, low: close - 1, close, volume: 1 });

describe('prefix-indexed aggregation', () => {
  it('matches aggregate() for every prefix and period', () => {
    for (const minutes of [1, 5, 15, 60, 240]) {
      const indexed = aggregateIndexed(HISTORY, minutes);
      expect(indexed.prefix[0]).toBe(0);
      expect(indexed.bars).toEqual(aggregate(HISTORY, minutes));
      for (const cursor of [0, 1, 59, 60, 61, 977, 1000, HISTORY.length - 1, HISTORY.length]) {
        expect(revealedAggregate(indexed, HISTORY, cursor, minutes)).toEqual(aggregate(HISTORY.slice(0, cursor), minutes));
      }
    }
  });
  it('never mutates the source bars', () => {
    const before = JSON.stringify(HISTORY.slice(0, 200));
    aggregateIndexed(HISTORY.slice(0, 200), 15);
    expect(JSON.stringify(HISTORY.slice(0, 200))).toBe(before);
  });
  it('keeps a stable prefix while an in-progress bucket keeps growing', () => {
    const indexed = aggregateIndexed(HISTORY, 15);
    const bucketOf = (index: number) => Math.floor(HISTORY[index - 1].time / 900) * 900;
    const cursor = 1000;
    let grown = cursor + 1;
    while (grown <= cursor + 15 && bucketOf(grown) !== bucketOf(cursor)) grown++;
    const head = aggregate(HISTORY.slice(0, cursor), 15);
    expect(revealedAggregate(indexed, HISTORY, cursor, 15)).toEqual(head);
    const next = revealedAggregate(indexed, HISTORY, grown, 15);
    expect(next.slice(0, -1)).toEqual(head.slice(0, -1));
    expect(next.length).toBe(head.length);
    expect(next[next.length - 1].close).toBe(HISTORY[grown - 1].close);
  });
  it('clamps out-of-range cursors', () => {
    const indexed = aggregateIndexed(HISTORY, 15);
    expect(revealedAggregate(indexed, HISTORY, -5, 15)).toEqual([]);
    expect(revealedAggregate(indexed, HISTORY, HISTORY.length + 99, 15)).toEqual(aggregate(HISTORY, 15));
  });
});

describe('incremental EMA20', () => {
  const bars: Candle[] = [];
  let price = 100;
  for (let i = 0; i < 400; i++) { price += Math.sin(i / 7) * 2 + (i % 5) - 2; bars.push(candle(i * 60, price)); }
  it('matches the full computation when extended in chunks', () => {
    const reference = ema20(bars);
    let cursor = null as ReturnType<typeof ema20Extend> | null;
    for (const end of [1, 5, 60, 61, 200, 399, 400]) {
      cursor = ema20Extend(cursor, bars.slice(0, end));
      expect(cursor.values.map((value, index) => ({ time: bars[index].time, value }))).toEqual(reference.slice(0, end));
    }
    // A newly formed last candle changes the tail only.
    const extended = ema20Extend(cursor, [...bars, candle(400 * 60, price + 9)]);
    expect(extended.values.slice(0, 400)).toEqual(reference.map(point => point.value));
    expect(extended.values).toHaveLength(401);
  });
  it('rebuilds when the first bar changes', () => {
    const first = ema20Extend(null, bars.slice(0, 50));
    const swapped = ema20Extend(first, [candle(999, 5), ...bars.slice(1, 50)]);
    expect(swapped.firstTime).toBe(999);
    expect(swapped.values[0]).toBe(5);
  });
  it('handles empty input', () => { expect(ema20Extend(null, [])).toEqual({ firstTime: 0, values: [] }); });
});

describe('legend value at the crosshair', () => {
  const data = [1, 2, null, 4, null] as (number | null)[];
  it('prefers the value under the cursor', () => {
    expect(valueAt(data, 0)).toBe(1);
    expect(valueAt(data, 1)).toBe(2);
    expect(valueAt(data, 3)).toBe(4);
  });
  it('falls back to the last finite value when the cursor has none or is off-chart', () => {
    expect(valueAt(data, 2)).toBe(4);
    expect(valueAt(data, -1)).toBe(4);
    expect(valueAt(data, 99)).toBe(4);
  });
  it('returns null for an empty or all-null series', () => {
    expect(valueAt([], 0)).toBeNull();
    expect(valueAt([null, null], 1)).toBeNull();
  });
});

describe('series sync planning', () => {
  const K = 'binance|spot|BTCUSDT|15m|7';
  it('rebuilds an unknown series', () => { expect(syncPlan(null, 10, 100, K)).toEqual({ mode: 'full' }); });
  it('rebuilds when the data shrank (replay stepped back)', () => { expect(syncPlan(syncedState(10, 100, K), 9, 100, K)).toEqual({ mode: 'full' }); });
  it('rebuilds when the first bar changed (new dataset)', () => { expect(syncPlan(syncedState(10, 100, K), 10, 200, K)).toEqual({ mode: 'full' }); });
  it('rebuilds for empty data', () => { expect(syncPlan(syncedState(10, 100, K), 0, 100, K)).toEqual({ mode: 'full' }); });
  it('rebuilds when the dataset key changes even if length and first bar match', () => {
    // 回归：BTCUSDT 15m×1500 切到 SOLUSDT 15m×1500 时长度与首根时间完全相同，
    // 之前被误判为"追加"，图上留着上一个品种的K线。
    const other = 'binance|spot|SOLUSDT|15m|7';
    expect(syncPlan(syncedState(1500, 100, K), 1500, 100, other)).toEqual({ mode: 'full' });
    expect(syncPlan(syncedState(1500, 100, K), 1500, 100, K)).toEqual({ mode: 'append', from: 1499 });
  });
  it('rewrites only the last point when the length is unchanged', () => { expect(syncPlan(syncedState(10, 100, K), 10, 100, K)).toEqual({ mode: 'append', from: 9 }); });
  it('rewrites the previous last point and appends the new bars', () => { expect(syncPlan(syncedState(10, 100, K), 13, 100, K)).toEqual({ mode: 'append', from: 9 }); });
  it('starts from zero for a one-bar series', () => { expect(syncPlan(syncedState(1, 100, K), 4, 100, K)).toEqual({ mode: 'append', from: 0 }); });
  it('clears cached plans when asked', () => {
    const cache = new Map([['a', syncedState(3, 1, 'k')]]);
    resetSeriesCache(cache);
    expect(cache.size).toBe(0);
  });
});

describe('performance meter', () => {
  it('reports frame pacing and stage averages', () => {
    const meter = createPerfMeter();
    expect(meter.snapshot()).toEqual({ fps: 0, frameMs: 0, chartMs: 0, indicatorMs: 0, samples: 0 });
    meter.frame(0);
    for (let i = 1; i <= 60; i++) meter.frame(i * 16);
    meter.chart(3); meter.chart(5); meter.indicators(1.5);
    const snapshot = meter.snapshot();
    expect(snapshot.fps).toBeCloseTo(62.5, 1);
    expect(snapshot.chartMs).toBe(4);
    expect(snapshot.indicatorMs).toBe(1.5);
    expect(snapshot.samples).toBe(60);
    meter.reset();
    expect(meter.snapshot().samples).toBe(0);
  });
  it('ignores invalid samples and averages an empty window as zero', () => {
    expect(mean([])).toBe(0);
    expect(mean([2, 4])).toBe(3);
    const meter = createPerfMeter();
    meter.chart(-1); meter.chart(Number.NaN);
    expect(meter.snapshot().chartMs).toBe(0);
  });
  it('keeps only the most recent window', () => {
    const meter = createPerfMeter();
    for (let i = 0; i < 200; i++) meter.chart(1);
    expect(meter.snapshot().samples).toBe(0);
    expect(meter.snapshot().chartMs).toBe(1);
  });
});
