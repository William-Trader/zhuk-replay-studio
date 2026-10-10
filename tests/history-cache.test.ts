import { describe, it, expect } from 'vitest';
import { cacheIsDeeper, cacheSummary, formatBytes, fromRows, mergeCandles, planLaunchLoad, toRows } from '../src/historyCache';
import type { Candle } from '../src/market';

const bar = (time: number, close = 100): Candle => ({ time, open: close - 1, high: close + 1, low: close - 2, close, volume: 10 });

describe('history cache helpers', () => {
  it('merges two series by time, newest wins on collision', () => {
    const cached = [bar(1, 10), bar(2, 20), bar(3, 30)];
    const fresh = [bar(3, 33), bar(4, 44)];
    const merged = mergeCandles(cached, fresh);
    expect(merged.map(b => b.time)).toEqual([1, 2, 3, 4]);
    expect(merged.find(b => b.time === 3)!.close).toBe(33);
    expect(mergeCandles([], fresh).map(b => b.time)).toEqual([3, 4]);
    expect(mergeCandles(cached, []).map(b => b.time)).toEqual([1, 2, 3]);
  });
  it('round-trips rows and drops malformed ones', () => {
    const rows = toRows([bar(1), bar(2)]);
    expect(rows[0]).toEqual([1, 99, 101, 98, 100, 10]);
    expect(fromRows(rows)).toHaveLength(2);
    expect(fromRows([[1, 1, 1, 1, 1, 1]])).toHaveLength(1);
    expect(fromRows([[NaN, 1, 1, 1, 1, 1], [1, 1, 1, 1, 0, 1], [1, 5, 4, 9, 5, 1], ['x'], null])).toEqual([]);
    expect(fromRows('nope')).toEqual([]);
  });
  it('only prefers the cache when it is meaningfully deeper', () => {
    expect(cacheIsDeeper([], [bar(1)])).toBe(false);
    expect(cacheIsDeeper([bar(1)], [bar(5)])).toBe(false);
    expect(cacheIsDeeper([bar(1), bar(2)], [bar(5), bar(6)])).toBe(true);
    expect(cacheIsDeeper([bar(9), bar(10)], [bar(9), bar(10), bar(11)])).toBe(false);
    expect(cacheIsDeeper([bar(9), bar(10), bar(11), bar(12)], [bar(10)])).toBe(true);
  });
  it('prefers local history on launch when it is usable (replay tool, not a live terminal)', () => {
    const cached = Array.from({ length: 500 }, (_, index) => bar(1000 + index));
    const plan = planLaunchLoad(cached);
    expect(plan).toEqual({ mode: 'cache-first', since: 1000 + 499 + 1, bars: 500 });
    // 本地历史太少时不值得先展示，仍然联网全量
    expect(planLaunchLoad([bar(1), bar(2)])).toEqual({ mode: 'network', bars: 2 });
    expect(planLaunchLoad([])).toEqual({ mode: 'network', bars: 0 });
    expect(planLaunchLoad(cached, 1000).mode).toBe('network');
  });
  it('describes the cache and humanises sizes', () => {
    expect(cacheSummary([], t => String(t))).toBe('无本地缓存');
    expect(cacheSummary([bar(1), bar(2)], t => `t${t}`)).toBe('本地缓存 2 根 · t1 → t2');
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(900)).toBe('900 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.0 MB');
  });
});
