import { describe, it, expect } from 'vitest';
import { CROSS_PAIRS, MAX_CHART_ALERTS, alertMarker, alertsSince, crossAlerts, indicatorAlerts, levelAlerts, supportsAlerts } from '../src/alerts';
import { INDICATOR_MAP, computeIndicator } from '../src/indicators';
import type { Candle } from '../src/market';

const bars = (count: number): Candle[] => Array.from({ length: count }, (_, i) => ({ time: 1_700_000_000 + i * 3600, open: 100, high: 101, low: 99, close: 100, volume: 1 }));
const series = (values: (number | null)[]) => values;

describe('level crossings', () => {
  it('flags up-crossings and down-crossings with the right colour and message', () => {
    const data = series([50, 60, 75, 80, 60, 40, 25, 10]);
    const alerts = levelAlerts(data, 70, bars(8), { instanceId: 'i1', defId: 'rsi', title: 'RSI' });
    expect(alerts).toHaveLength(2);
    expect(alerts[0]).toMatchObject({ kind: 'over-bought', time: bars(8)[2].time, color: '#f23645' });
    expect(alerts[0].message).toContain('RSI 上穿 70');
    expect(alerts[1]).toMatchObject({ kind: 'over-sold', time: bars(8)[4].time, color: '#089981' });
    expect(alerts[1].message).toContain('RSI 下穿 70');
    expect(alerts[0].key).not.toBe(alerts[1].key);
  });
  it('ignores nulls, flat lines and touches at the level', () => {
    expect(levelAlerts([null, null, 70], 70, bars(3), { instanceId: 'i', defId: 'rsi', title: 'RSI' })).toHaveLength(0);
    expect(levelAlerts([30, 30, 30], 70, bars(3), { instanceId: 'i', defId: 'rsi', title: 'RSI' })).toHaveLength(0);
  });
  it('uses the declared label when provided', () => {
    const alerts = levelAlerts([10, 25], 20, bars(2), { instanceId: 'i', defId: 'kdj', title: 'KDJ', label: '20（超卖）' });
    expect(alerts[0].title).toBe('KDJ 上穿20（超卖）');
  });
});

describe('two-line crosses', () => {
  it('flags golden and death crosses', () => {
    const fast = series([1, 2, 5, 4, 1]);
    const slow = series([3, 3, 3, 3, 3]);
    const alerts = crossAlerts(fast, slow, bars(5), { instanceId: 'm1', defId: 'macd', title: 'MACD', fastLabel: 'DIF', slowLabel: 'DEA' });
    expect(alerts.map(alert => alert.kind)).toEqual(['golden', 'death']);
    expect(alerts[0].message).toBe('MACD：DIF 上穿 DEA（5 / 3）');
    expect(alerts[1].color).toBe('#f23645');
  });
});

describe('indicator rules', () => {
  const market: Candle[] = Array.from({ length: 120 }, (_, i) => {
    const close = 100 + 12 * Math.sin(i / 5) + i * .2;
    return { time: 1_700_000_000 + i * 900, open: close, high: close + 1, low: close - 1, close, volume: 100 + i };
  });
  it('raises RSI alerts at 70/30', () => {
    const def = INDICATOR_MAP.rsi;
    const out = computeIndicator(def, market);
    const alerts = indicatorAlerts(def, out, market, 'rsi-1');
    expect(alerts.length).toBeGreaterThan(0);
    expect(new Set(alerts.map(alert => alert.kind)).size).toBeGreaterThan(0);
    expect(alerts.every(alert => alert.defId === 'rsi' && alert.instanceId === 'rsi-1')).toBe(true);
    expect(alerts.map(alert => alert.time)).toEqual([...alerts.map(alert => alert.time)].sort((a, b) => a - b));
  });
  it('raises MACD golden/death crosses', () => {
    const def = INDICATOR_MAP.macd;
    const alerts = indicatorAlerts(def, computeIndicator(def, market), market, 'macd-1');
    expect(alerts.length).toBeGreaterThan(0);
    expect(alerts.every(alert => alert.title.startsWith('MACD '))).toBe(true);
    expect(CROSS_PAIRS.macd.fast).toBe('dif');
  });
  it('stays silent for indicators without levels or pairs, and when disabled', () => {
    const def = INDICATOR_MAP.sma;
    const out = computeIndicator(def, market);
    expect(indicatorAlerts(def, out, market, 'sma-1')).toEqual([]);
    expect(indicatorAlerts(INDICATOR_MAP.rsi, computeIndicator(INDICATOR_MAP.rsi, market), market, 'rsi-1', false)).toEqual([]);
    expect(indicatorAlerts(INDICATOR_MAP.kdj, computeIndicator(INDICATOR_MAP.kdj, market), market, 'kdj-1').length).toBeGreaterThan(0);
  });
  it('filters alerts to a replay window', () => {
    const list = [
      { key: 'a', time: 100 } as never, { key: 'b', time: 200 } as never, { key: 'c', time: 300 } as never,
    ];
    expect(alertsSince(list, 200).map(alert => (alert as { key: string }).key)).toEqual(['b', 'c']);
    expect(alertsSince(list, 1_000)).toEqual([]);
    expect(MAX_CHART_ALERTS).toBe(60);
  });
  it('tells the UI which indicators can raise alerts', () => {
    expect(supportsAlerts(INDICATOR_MAP.rsi)).toBe(true);
    expect(supportsAlerts(INDICATOR_MAP.macd)).toBe(true);
    expect(supportsAlerts(INDICATOR_MAP.kdj)).toBe(true);
    expect(supportsAlerts(INDICATOR_MAP.bollinger)).toBe(false);
    expect(supportsAlerts(INDICATOR_MAP.volume)).toBe(false);
    expect(supportsAlerts(INDICATOR_MAP.sma)).toBe(false);
  });
  it('maps alerts to chart markers as plain dots (no text on the chart)', () => {
    const [alert] = crossAlerts([1, 5], [3, 3], bars(2), { instanceId: 'i', defId: 'macd', title: 'MACD', fastLabel: 'DIF', slowLabel: 'DEA' });
    expect(alertMarker(alert)).toMatchObject({ position: 'belowBar', shape: 'circle', color: '#089981', text: '' });
  });
});
