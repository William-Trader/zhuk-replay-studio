import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TEMPLATE, INDICATORS, INDICATOR_MAP, INDICATOR_TEMPLATES, align, atr, computeIndicator, defaultIndicatorInstances, defaultInputs,
  ema, highest, hma, lowest, nulls, rma, sma, stdev, sum, templateInstances, trueRange, wma,
} from '../src/indicators';
import type { CandleLike, IndicatorOutput } from '../src/indicators';

const CLOSES = [10, 12, 11, 13, 12, 14, 13, 15];
const PRECISION = 10;

/** Builds candles from closes; the high/low padding is explicit so true range stays hand-checkable. */
const fromCloses = (values: number[], highPad = 2, lowPad = 1, step = 3600): CandleLike[] =>
  values.map((close, i) => ({ time: 1_700_000_000 + i * step, open: i ? values[i - 1] : close, high: close + highPad, low: close - lowPad, close, volume: 100 + i * 10 }));

/** 90 hourly bars over four UTC days: exercises warm-up, vwap resets and pivot day grouping. */
const market: CandleLike[] = Array.from({ length: 90 }, (_, i) => {
  const close = 100 + 8 * Math.sin(i / 5) + i * 0.4, open = i ? 100 + 8 * Math.sin((i - 1) / 5) + (i - 1) * 0.4 : 100;
  return { time: 1_700_000_000 + i * 3600, open, high: Math.max(open, close) + 1 + (i % 3) * 0.5, low: Math.min(open, close) - 1 - (i % 2) * 0.5, close, volume: 100 + (i % 7) * 10 };
});
const trend = fromCloses(Array.from({ length: 60 }, (_, i) => 100 + i));

const output = (id: string, candles: CandleLike[], inputs?: Record<string, number | string>): IndicatorOutput => computeIndicator(INDICATOR_MAP[id], candles, inputs);
const series = (id: string, candles: CandleLike[], inputs?: Record<string, number | string>, plotId?: string) => {
  const plots = output(id, candles, inputs).plots, chosen = plotId ? plots.find(plot => plot.id === plotId) : plots[0];
  if (!chosen) throw new Error(`${id} has no plot ${plotId ?? '(first)'}`);
  return chosen.data;
};
const last = (values: (number | null)[]) => values[values.length - 1] as number;
const finiteOrNull = (value: number | null) => value === null || Number.isFinite(value);

describe('series primitives', () => {
  it('computes sma with a leading warm-up of nulls', () => {
    expect(sma([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
    expect(sma([1, 2, 3], 1)).toEqual([1, 2, 3]);
    expect(sma([1, 2, 3], 3)).toEqual([null, null, 2]);
    expect(sma([1, 2, 3], 4)).toEqual([null, null, null]);
    expect(sma([], 3)).toEqual([]);
  });
  it('seeds ema with the simple average of the first period', () => {
    const out = ema(CLOSES, 2);
    expect(out[0]).toBeNull();
    expect(out[1]).toBeCloseTo(11, PRECISION);
    expect(out[2]).toBeCloseTo(11, PRECISION);
    expect(out[3]).toBeCloseTo(37 / 3, PRECISION);
    expect(out[4]).toBeCloseTo(109 / 9, PRECISION);
    expect(out[5]).toBeCloseTo(361 / 27, PRECISION);
    expect(out[6]).toBeCloseTo(1063 / 81, PRECISION);
    expect(out[7]).toBeCloseTo(3493 / 243, PRECISION);
    expect(ema(CLOSES, 20).every(value => value === null)).toBe(true);
  });
  it('smooths rma with the wilder recurrence', () => {
    expect(rma([2, 2, 2, 2], 2)).toEqual([null, 2, 2, 2]);
    expect(rma([1, 2, 3], 3)).toEqual([null, null, 2]);
    expect(rma([4, 6], 3)).toEqual([null, null]);
  });
  it('computes wma, hma, stdev, highest, lowest and rolling sums', () => {
    expect(wma([1, 2, 3], 3)).toEqual([null, null, (1 + 4 + 9) / 6]);
    expect(hma([1, 2, 3, 4, 5], 4)).toEqual([null, null, null, null, 5]);
    expect(stdev([10, 12, 11], 3)[2]).toBeCloseTo(Math.sqrt(2 / 3), PRECISION);
    expect(highest([3, 1, 4, 2], 2)).toEqual([null, 3, 4, 4]);
    expect(lowest([3, 1, 4, 2], 2)).toEqual([null, 1, 1, 2]);
    expect(sum([1, 2, 3, 4], 2)).toEqual([null, 3, 5, 7]);
    expect(align([null, null, 1, 2], dense => sma(dense, 2))).toEqual([null, null, null, 1.5]);
  });
  it('keeps true range and atr aligned to the bars', () => {
    expect(trueRange(fromCloses([10, 12], 2, 1))).toEqual([3, 4]);
    expect(trueRange([])).toEqual([]);
    expect(atr(fromCloses(CLOSES, 2, 1), 3)[3]).toBeCloseTo(11 / 3, PRECISION);
    expect(atr(fromCloses(CLOSES, 2, 1), 3).slice(0, 3)).toEqual([null, null, null]);
    expect(nulls(2)).toEqual([null, null]);
  });
  it('never mutates its inputs', () => {
    const values = [3, 1, 4, 1, 5], copy = [...values];
    sma(values, 2); ema(values, 2); rma(values, 2); wma(values, 2); hma(values, 2); stdev(values, 2); highest(values, 2); lowest(values, 2); sum(values, 2);
    expect(values).toEqual(copy);
  });
});

describe('exact indicator values', () => {
  const candles = fromCloses(CLOSES);

  it('sma(3) matches the hand-computed averages', () => {
    const out = output('sma', fromCloses([1, 2, 3, 4, 5]), { period: 3 });
    expect(out.plots[0].data).toEqual([null, null, 2, 3, 4]);
    expect(out.plots[0].title).toBe('SMA3');
    expect(out.plots[0].type).toBe('line');
  });
  it('bollinger(3, 2) centres on the sma and scales the population deviation', () => {
    const middle = series('bollinger', candles, { period: 3, mult: 2 }, 'middle');
    const band = 2 * Math.sqrt(2 / 3);
    expect(middle.slice(0, 2)).toEqual([null, null]);
    expect(middle[2]).toBeCloseTo(11, PRECISION);
    expect(middle[3]).toBeCloseTo(12, PRECISION);
    expect(series('bollinger', candles, { period: 3, mult: 2 }, 'upper')[2]).toBeCloseTo(11 + band, PRECISION);
    expect(series('bollinger', candles, { period: 3, mult: 2 }, 'lower')[4]).toBeCloseTo(12 - band, PRECISION);
  });
  it('rsi(3) follows the wilder average gain/loss ratio', () => {
    const data = series('rsi', candles, { period: 3 });
    expect(data.slice(0, 3)).toEqual([null, null, null]);
    expect(data[3]).toBeCloseTo(80, PRECISION);                       // avgGain 4/3 vs avgLoss 1/3 -> RS 4
    expect(data[4]).toBeCloseTo(100 - 100 / (1 + 1.6), PRECISION);    // (8/9) / (5/9)
    expect(data[5]).toBeCloseTo(100 - 100 / (1 + 3.4), PRECISION);    // (34/27) / (10/27)
    expect(data[6]).toBeCloseTo(100 - 100 / (1 + 68 / 47), PRECISION);
    expect(data[7]).toBeCloseTo(100 - 100 / (1 + 149 / 47), PRECISION);
    expect(output('rsi', candles, { period: 3 }).levels?.map(level => level.value)).toEqual([70, 30]);
  });
  it('macd(2, 4, 2) derives dif, dea and histogram from two seeded emas', () => {
    const inputs = { fast: 2, slow: 4, signal: 2 };
    const dif = series('macd', candles, inputs, 'dif');
    const expected = [37 / 3 - 11.5, 109 / 9 - 11.7, 361 / 27 - 12.62, 1063 / 81 - 12.772, 3493 / 243 - 13.6632];
    expect(dif.slice(0, 3)).toEqual([null, null, null]);
    expected.forEach((value, offset) => expect(dif[offset + 3]).toBeCloseTo(value, PRECISION));
    const dea = series('macd', candles, inputs, 'dea');
    expect(dea.slice(0, 4)).toEqual([null, null, null, null]);
    const seed = (expected[0] + expected[1]) / 2;
    expect(dea[4]).toBeCloseTo(seed, PRECISION);
    expect(dea[5]).toBeCloseTo(seed + (expected[2] - seed) * 2 / 3, PRECISION);
    expect(series('macd', candles, inputs, 'hist')[7]).toBeCloseTo((dif[7] as number) - (dea[7] as number), PRECISION);
  });
  it('atr(3) smooths a hand-computed true range series', () => {
    const data = series('atr', fromCloses(CLOSES, 2, 1), { period: 3 });
    expect(data.slice(0, 3)).toEqual([null, null, null]);
    [11 / 3, 31 / 9, 98 / 27, 277 / 81, 878 / 243].forEach((value, offset) => expect(data[offset + 3]).toBeCloseTo(value, PRECISION));
  });
});

describe('day-based indicators', () => {
  const twoDays: CandleLike[] = [
    { time: 1699920000, open: 10, high: 12, low: 8, close: 10, volume: 10 },
    { time: 1699923600, open: 10, high: 14, low: 12, close: 13, volume: 30 },
    { time: 1699927200, open: 13, high: 20, low: 18, close: 19, volume: 60 },
    { time: 1700006400, open: 29, high: 30, low: 28, close: 29, volume: 100 },
  ];
  it('restarts vwap on every utc day using the typical price', () => {
    const data = series('vwap', twoDays);
    expect(data[0]).toBeCloseTo(10, PRECISION);
    expect(data[1]).toBeCloseTo((10 * 10 + 13 * 30) / 40, PRECISION);
    expect(data[2]).toBeCloseTo((10 * 10 + 13 * 30 + 19 * 60) / 100, PRECISION);
    expect(data[3]).toBeCloseTo(29, PRECISION);
  });
  it('derives pivots from the previous complete day only', () => {
    expect(series('pivots', twoDays, undefined, 'p').slice(0, 3)).toEqual([null, null, null]);
    expect(series('pivots', twoDays, undefined, 'p')[3]).toBeCloseTo(47 / 3, PRECISION);
    expect(series('pivots', twoDays, undefined, 'r1')[3]).toBeCloseTo(70 / 3, PRECISION);
    expect(series('pivots', twoDays, undefined, 's1')[3]).toBeCloseTo(34 / 3, PRECISION);
    expect(series('pivots', twoDays, undefined, 'r3')[3]).toBeCloseTo(20 + 2 * (47 / 3 - 8), PRECISION);
    expect(series('pivots', twoDays)).toHaveLength(4);
  });
  it('shifts the ichimoku spans forward by the kijun period', () => {
    const spanA = series('ichimoku', market, undefined, 'senkouA'), tenkan = series('ichimoku', market, undefined, 'tenkan'), kijun = series('ichimoku', market, undefined, 'kijun');
    expect(spanA[50]).toBeNull();
    expect(spanA[51]).toBeCloseTo(((tenkan[25] as number) + (kijun[25] as number)) / 2, PRECISION);
    expect(series('ichimoku', market, undefined, 'senkouB')[76]).toBeNull();
    expect(series('ichimoku', market, undefined, 'senkouB')[77]).not.toBeNull();
  });
});

describe('registry', () => {
  it('registers 33 unique indicators with legal declared defaults', () => {
    expect(INDICATORS).toHaveLength(33);
    expect(new Set(INDICATORS.map(def => def.id)).size).toBe(33);
    expect(Object.keys(INDICATOR_MAP)).toHaveLength(33);
    expect(INDICATORS.filter(def => def.pane === 'main')).toHaveLength(15);
    expect(INDICATORS.filter(def => def.pane === 'sub')).toHaveLength(18);
    for (const def of INDICATORS) {
      expect(def.name.length).toBeGreaterThan(0);
      expect(Object.keys(defaultInputs(def)).length).toBe(def.inputs.length);
      for (const spec of def.inputs) {
        expect(spec.key.length).toBeGreaterThan(0);
        expect(spec.default).toBeDefined();
        if (spec.type === 'number') {
          expect(Number.isFinite(spec.default as number)).toBe(true);
          expect(spec.default as number).toBeGreaterThanOrEqual(spec.min ?? -Infinity);
          expect(spec.default as number).toBeLessThanOrEqual(spec.max ?? Infinity);
        } else if (spec.type === 'select') expect((spec.options ?? []).some(option => option.value === spec.default)).toBe(true);
        else expect(String(spec.default).trim().length).toBeGreaterThan(0);
      }
    }
    expect(defaultInputs(INDICATOR_MAP.sma)).toEqual({ period: 20 });
  });
  it('exposes the documented indicator ids in order', () => {
    expect(INDICATORS.map(def => def.id)).toEqual(['maSet', 'emaSet', 'sma', 'ema', 'wma', 'hma', 'vwma', 'bollinger', 'keltner', 'donchian', 'supertrend', 'psar', 'ichimoku', 'vwap', 'pivots', 'kdj', 'volume', 'rsi', 'macd', 'stoch', 'stochrsi', 'cci', 'williamsr', 'adx', 'atr', 'obv', 'mfi', 'roc', 'mom', 'ao', 'trix', 'cmf', 'stddev']);
  });
  it('keeps the plot ids the UI binds to', () => {
    const ids = (id: string) => computeIndicator(INDICATOR_MAP[id], market).plots.map(plot => plot.id);
    expect(ids('bollinger')).toEqual(['upper', 'middle', 'lower']);
    expect(ids('keltner')).toEqual(['upper', 'middle', 'lower']);
    expect(ids('donchian')).toEqual(['upper', 'middle', 'lower']);
    expect(ids('ichimoku')).toEqual(['tenkan', 'kijun', 'senkouA', 'senkouB']);
    expect(ids('pivots')).toEqual(['p', 'r1', 'r2', 'r3', 's1', 's2', 's3']);
    expect(ids('volume')).toEqual(['volumeUp', 'volumeDown', 'volumeMa']);
    expect(ids('macd')).toEqual(['dif', 'dea', 'hist']);
    expect(ids('adx')).toEqual(['plusDi', 'minusDi', 'adx']);
    expect(ids('stoch')).toEqual(['k', 'd']);
    expect(ids('stochrsi')).toEqual(['k', 'd']);
    expect(ids('trix')).toEqual(['trix', 'signal']);
    expect(ids('sma')).toEqual(['sma']);
  });
  it('returns empty plots for empty input without throwing', () => {
    for (const def of INDICATORS) {
      const out = computeIndicator(def, []);
      expect(out.plots.length).toBeGreaterThan(0);
      for (const plot of out.plots) expect(plot.data).toEqual([]);
    }
  });
  it('keeps every plot aligned with the candles, finite and uniquely identified', () => {
    for (const def of INDICATORS) {
      const out = computeIndicator(def, market);
      expect(new Set(out.plots.map(plot => plot.id)).size).toBe(out.plots.length);
      for (const plot of out.plots) {
        expect(plot.data).toHaveLength(market.length);
        expect(plot.data.every(finiteOrNull)).toBe(true);
        expect(plot.title.length).toBeGreaterThan(0);
      }
      expect(out.plots.some(plot => plot.data.some(value => value !== null))).toBe(true);
      for (const level of out.levels ?? []) expect(Number.isFinite(level.value)).toBe(true);
    }
  });
  it('confines nulls to a leading warm-up block', () => {
    // The volume study deliberately splits its histogram into alternating up/down plots, so interior nulls are expected there.
    const split = new Set(['volumeUp', 'volumeDown']);
    for (const def of INDICATORS) for (const plot of computeIndicator(def, market).plots) {
      expect(plot.data).toHaveLength(market.length);
      const start = plot.data.findIndex(value => value !== null);
      // 预热比样本还长的周期（如 EMA99 对 90 根）整段为 null，这是正确行为。
      if (start < 0) continue;
      if (!split.has(plot.id)) expect(plot.data.slice(start).includes(null)).toBe(false);
    }
  });
  it('follows the direction of a monotonic uptrend', () => {
    for (const id of ['sma', 'ema', 'wma', 'hma', 'vwma']) expect(last(series(id, trend))).toBeGreaterThan(series(id, trend).find(value => value !== null) as number);
    expect(last(series('rsi', trend, { period: 14 }))).toBeCloseTo(100, PRECISION);
    expect(last(series('mom', trend))).toBeGreaterThan(0);
    expect(last(series('roc', trend))).toBeGreaterThan(0);
    expect(last(series('ao', trend))).toBeGreaterThan(0);
    expect(last(series('cci', trend))).toBeGreaterThan(0);
    expect(last(series('obv', trend))).toBeGreaterThan(series('obv', trend)[0] as number);
    expect(last(series('supertrend', trend))).toBeLessThan((trend[trend.length - 1].close));
    expect(last(series('psar', trend))).toBeLessThan((trend[trend.length - 1].close));
  });
  it('falls back to defaults for illegal inputs instead of throwing', () => {
    const fallback = series('sma', market);
    expect(series('sma', market, { period: Number.NaN })).toEqual(fallback);
    expect(series('sma', market, { period: 'oops' })).toEqual(fallback);
    expect(series('sma', market, { period: 0 })).toEqual(fallback);
    expect(series('sma', market, { period: 9999 })).toEqual(fallback);
    expect(series('sma', market, { unknown: 3 })).toEqual(fallback);
    expect(series('sma', market, { period: 5 })).not.toEqual(fallback);
  });
  it('survives extreme window sizes for every declared numeric input', () => {
    for (const def of INDICATORS) for (const spec of def.inputs) {
      if (spec.type !== 'number') continue;
      for (const value of [1, market.length, market.length + 10, market.length * 3]) {
        const out = computeIndicator(def, market, { [spec.key]: value });
        expect(out.plots.every(plot => plot.data.length === market.length && plot.data.every(finiteOrNull))).toBe(true);
      }
    }
  });
  it('returns null-only output when the window exceeds the data', () => {
    expect(series('sma', market.slice(0, 20), { period: 30 }).every(value => value === null)).toBe(true);
    expect(series('atr', market.slice(0, 20), { period: 30 }).every(value => value === null)).toBe(true);
  });
  it('handles a single candle', () => {
    for (const def of INDICATORS) expect(computeIndicator(def, market.slice(0, 1)).plots.every(plot => plot.data.length === 1)).toBe(true);
  });
});

describe('platform-style indicator sets', () => {
  it('builds one line per period for the moving-average groups', () => {
    const ma = output('maSet', trend, { periods: '5,10,20' });
    expect(ma.plots.map(plot => plot.id)).toEqual(['ma5', 'ma10', 'ma20']);
    expect(ma.plots.map(plot => plot.title)).toEqual(['MA5', 'MA10', 'MA20']);
    expect(new Set(ma.plots.map(plot => plot.color)).size).toBe(3);
    for (const plot of ma.plots) { expect(plot.data).toHaveLength(trend.length); expect(plot.data.every(finiteOrNull)).toBe(true); }
    // 末值等于对应周期的简单均值
    const closes = trend.map(bar => bar.close);
    expect(last(ma.plots[0].data)).toBeCloseTo(closes.slice(-5).reduce((total, value) => total + value, 0) / 5, PRECISION);
    const emaGroup = output('emaSet', trend, { periods: '7,25' });
    expect(emaGroup.plots.map(plot => plot.id)).toEqual(['ema7', 'ema25']);
  });
  it('dedupes, clamps and falls back on illegal period lists', () => {
    expect(output('maSet', trend, { periods: '5,5,0,-3,abc,20' }).plots.map(plot => plot.id)).toEqual(['ma5', 'ma20']);
    expect(output('maSet', trend, { periods: '' }).plots.map(plot => plot.id)).toEqual(['ma5', 'ma10', 'ma20', 'ma60']);
    expect(output('maSet', trend, { periods: '1,2,3,4,5,6,7,8' }).plots).toHaveLength(6);
  });
  it('computes KDJ with the Chinese platform recurrence and 80/20 levels', () => {
    const kdj = output('kdj', market, { period: 9, kPeriod: 3, dPeriod: 3 });
    expect(kdj.plots.map(plot => plot.id)).toEqual(['k', 'd', 'j']);
    expect(kdj.levels?.map(level => level.value)).toEqual([80, 20, 50]);
    const k = kdj.plots[0].data, d = kdj.plots[1].data, j = kdj.plots[2].data;
    for (let i = 0; i < kdj.plots[0].data.length; i++) {
      if (k[i] === null || d[i] === null || j[i] === null) continue;
      expect(j[i] as number).toBeCloseTo(3 * (k[i] as number) - 2 * (d[i] as number), 8);
      expect(k[i] as number).toBeGreaterThanOrEqual(0);
      expect(k[i] as number).toBeLessThanOrEqual(100);
    }
    expect(k.filter(value => value !== null).length).toBeGreaterThan(50);
  });
  it('ships exchange-style templates that only reference known indicators', () => {
    expect(INDICATOR_TEMPLATES.length).toBeGreaterThanOrEqual(3);
    for (const template of INDICATOR_TEMPLATES) {
      expect(template.items.length).toBeGreaterThan(0);
      for (const item of template.items) expect(item.defId in INDICATOR_MAP).toBe(true);
    }
    const instances = templateInstances(DEFAULT_TEMPLATE);
    expect(instances.map(instance => instance.defId)).toEqual(['maSet', 'volume']);
    expect(instances[0].inputs.periods).toBe('5,10,20,60');
    expect(instances.every(instance => instance.visible)).toBe(true);
    expect(new Set(instances.map(instance => instance.id)).size).toBe(instances.length);
    expect(defaultIndicatorInstances().map(instance => instance.defId)).toEqual(['maSet', 'volume']);
  });
});
