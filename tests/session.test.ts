import { describe, it, expect } from 'vitest';
import type { Candle } from '../src/market';
import { createSession, durationText, STEP_SIZES, intrabarPrice, intrabarPrices, partialBar, sessionStats, sessionSummary, withFormingBar, MIN_REPLAY_SPEED, REPLAY_SPEEDS } from '../src/session';

const bar = (over: Partial<Candle> = {}): Candle => ({ time: 1_700_000_000, open: 100, high: 110, low: 95, close: 105, volume: 40, ...over });

describe('intrabar replay path', () => {
  it('sweeps low then high on a rising bar, high then low on a falling bar', () => {
    expect(intrabarPrices(bar())).toEqual([100, 95, 110, 105]);
    expect(intrabarPrices(bar({ open: 105, close: 98 }))).toEqual([105, 110, 95, 98]);
  });
  it('starts at the open with no volume and ends exactly on the finished bar', () => {
    const start = partialBar(bar(), 0);
    expect(start).toMatchObject({ open: 100, high: 100, low: 100, close: 100, volume: 0 });
    expect(partialBar(bar(), 1)).toEqual(bar());
    expect(partialBar(bar(), 2)).toEqual(bar());
  });
  it('reaches each extreme on the way and never leaves the bar range', () => {
    const at = (f: number) => partialBar(bar(), f);
    expect(at(.35)).toMatchObject({ close: 95, high: 100, low: 95 });
    expect(at(.7)).toMatchObject({ close: 110, high: 110, low: 95 });
    expect(at(.85).close).toBeCloseTo(107.5, 6);
    for (let f = 0; f <= 1.0001; f += .05) {
      const candle = at(Math.min(f, 1));
      expect(candle.high).toBeGreaterThanOrEqual(Math.max(candle.open, candle.close));
      expect(candle.low).toBeLessThanOrEqual(Math.min(candle.open, candle.close));
      expect(candle.high).toBeLessThanOrEqual(110);
      expect(candle.low).toBeGreaterThanOrEqual(95);
      expect(candle.volume).toBeGreaterThanOrEqual(0);
      expect(candle.volume).toBeLessThanOrEqual(40);
    }
  });
  it('accrues volume monotonically with progress', () => {
    let previous = -1;
    for (let f = 0; f <= 1.0001; f += .1) { const volume = partialBar(bar(), Math.min(f, 1)).volume; expect(volume).toBeGreaterThanOrEqual(previous); previous = volume; }
    expect(partialBar(bar(), .5).volume).toBeCloseTo(20, 6);
  });
  it('keeps a flat bar flat and clamps out-of-range fractions', () => {
    const flat = bar({ open: 100, high: 100, low: 100, close: 100, volume: 5 });
    expect(partialBar(flat, .5)).toMatchObject({ open: 100, high: 100, low: 100, close: 100, volume: 2.5 });
    expect(partialBar(bar(), -1).volume).toBe(0);
    expect(intrabarPrice(bar(), -1)).toBe(100);
    expect(intrabarPrice(bar(), 5)).toBe(105);
  });
  it('reports the price along the path', () => {
    expect(intrabarPrice(bar(), 0)).toBe(100);
    expect(intrabarPrice(bar(), .7)).toBe(110);
    expect(intrabarPrice(bar(), 1)).toBe(105);
  });
  it('replaces only the newest bar with its forming state', () => {
    const bars = [bar({ time: 1 }), bar({ time: 2 }), bar({ time: 3, open: 10, high: 12, low: 9, close: 11 })];
    const view = withFormingBar(bars, 0);
    expect(view).toHaveLength(3);
    expect(view[0]).toEqual(bars[0]);
    expect(view[1]).toEqual(bars[1]);
    expect(view[2]).toMatchObject({ time: 3, open: 10, close: 10, high: 10, low: 10, volume: 0 });
    expect(bars[2].close).toBe(11);
    expect(withFormingBar([], .5)).toEqual([]);
    expect(withFormingBar(bars, 1)[2]).toEqual(bars[2]);
  });
});

describe('replay sessions', () => {
  const snapshot = { cursor: 900, marketEvents: [], orderLog: [], notes: [{ id: 'note-1' }] };
  it('captures the starting point so a discarded result can roll back', () => {
    const session = createSession({ now: 1_000_000, cursor: 1300, revealed: 200, fills: 3, realized: 12, equity: 10000, addedVolume: true, snapshot });
    expect(session).toMatchObject({ startCursor: 1300, revealedAtStart: 200, fillsAtStart: 3, realizedAtStart: 12, addedVolume: true, startedAt: 1_000_000 });
    expect(session.snapshot.cursor).toBe(900);
    expect(session.id.startsWith('session-')).toBe(true);
  });
  it('measures only what happened during the session', () => {
    const session = createSession({ now: 0, cursor: 1300, revealed: 200, fills: 3, realized: 12, equity: 10000, addedVolume: false, snapshot });
    const stats = sessionStats(session, { revealed: 260, cursor: 2600, fills: 5, buys: 3, sells: 2, realized: 30, equity: 10030, curve: [] }, 5 * 60_000);
    expect(stats).toMatchObject({ bars: 60, fills: 5, buys: 3, sells: 2, realized: 18, equity: 10030, minutes: 5 });
  });
  it('never reports negative progress when the replay moved back', () => {
    const session = createSession({ now: 0, cursor: 1300, revealed: 200, fills: 0, realized: 0, equity: 10000, addedVolume: false, snapshot });
    expect(sessionStats(session, { revealed: 120, cursor: 1200, fills: 0, buys: 0, sells: 0, realized: 0, equity: 10000, curve: [] }).bars).toBe(0);
  });
  it('writes a readable kept-result summary', () => {
    const session = createSession({ now: new Date(2026, 8, 17, 9, 5).getTime(), cursor: 1300, revealed: 30, fills: 0, realized: 0, equity: 10000, addedVolume: false, snapshot });
    const stats = sessionStats(session, { revealed: 72, cursor: 720, fills: 2, buys: 1, sells: 1, realized: -9.4, equity: 9990.6, curve: [] }, session.startedAt + 12 * 60_000);
    const text = sessionSummary(session, stats, 'BTCUSDT 15m');
    expect(text).toContain('【复盘小结】BTCUSDT 15m · 09:05 开始');
    expect(text).toContain('本次回放 42 根K线 · 用时 12 分钟 · 成交 2 笔（买开 1 / 卖平 1）');
    expect(text).toContain('已实现盈亏 -9.40 USDT');
    expect(text).toContain('账户净值 9990.60 USDT');
    const coinText = sessionSummary(session, { ...stats, realized: .0002, equity: .1275 }, 'BTCUSD 15m', 'BTC');
    expect(coinText).toContain('已实现盈亏 +0.00 BTC');
    expect(coinText).toContain('账户净值 0.12750000 BTC');
  });
  it('exposes the play speeds as bars per second', () => {
    expect([...REPLAY_SPEEDS]).toEqual([.5, 1, 2, 4, 8, 16, 32]);
    expect([...STEP_SIZES]).toEqual([1, 2, 4]);
    expect(MIN_REPLAY_SPEED).toBe(.5);
  });
  it('formats elapsed time', () => {
    expect(durationText(0)).toBe('00:00');
    expect(durationText(95_000)).toBe('01:35');
    expect(durationText(3_725_000)).toBe('1:02:05');
  });
});
