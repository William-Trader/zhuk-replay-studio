/*!
 * src/indicators/panes.ts - zhuk-replay-studio key core logic
 * (c) 2026 William-Trader (https://github.com/William-Trader)
 * WM: ZRS-0447BC9D
 * SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
 * Removing this mark violates the license.
 */
/** Sub-pane (oscillator / volume / volatility) indicators. */
import * as S from './series';
import { bars, numInput, periodInput } from './params';
import { BLUE, GRAY, GREEN, ORANGE, PURPLE, RED, TEAL, closes, highs, histogram, join, level, line, lows, midpoints, percentInRange, volumes } from './plots';
import type { IndicatorDef } from './types';
import type { Series } from './plots';

/** Wilder RSI over a close series (shared by RSI and StochRSI). */
function rsiSeries(close: number[], n: number): Series {
  const data = S.nulls(close.length);
  if (close.length <= n) return data;
  let gain = 0, loss = 0;
  const value = () => gain + loss === 0 ? 50 : loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  for (let i = 1; i <= n; i++) { const delta = close[i] - close[i - 1]; gain += Math.max(delta, 0); loss += Math.max(-delta, 0); }
  gain /= n; loss /= n; data[n] = value();
  for (let i = n + 1; i < close.length; i++) { const delta = close[i] - close[i - 1]; gain = (gain * (n - 1) + Math.max(delta, 0)) / n; loss = (loss * (n - 1) + Math.max(-delta, 0)) / n; data[i] = value(); }
  return data;
}

/** Rolling (value - lowest) / (highest - lowest) * 100, the raw stochastic leg. */
const stochastic = (values: number[], n: number): Series => {
  const top = S.highest(values, n), bottom = S.lowest(values, n);
  return values.map((value, i) => { const high = top[i], low = bottom[i]; return high === null || low === null ? null : percentInRange(value, high, low); });
};

export const PANES: IndicatorDef[] = [
  { id: 'kdj', name: 'KDJ · 随机指标', category: '振荡', pane: 'sub', inputs: [periodInput('period', '周期', 9), periodInput('kPeriod', 'K平滑', 3), periodInput('dPeriod', 'D平滑', 3)],
    compute: (candles, inputs) => {
      const n = bars(inputs, 'period', 9), kSmooth = bars(inputs, 'kPeriod', 3), dSmooth = bars(inputs, 'dPeriod', 3);
      const raw = stochastic(closes(candles), n);
      const smooth = (source: Series, size: number) => { const out = S.nulls(source.length); let previous = 50; for (let i = 0; i < source.length; i++) { const value = source[i]; if (value === null) continue; previous = (previous * (size - 1) + value) / size; out[i] = previous; } return out; };
      const k = smooth(raw, kSmooth), d = smooth(k, dSmooth);
      const j = join(k, d, (kv, dv) => 3 * kv - 2 * dv);
      return { plots: [line('k', `K${n}`, k, BLUE), line('d', `D${n}`, d, ORANGE), line('j', 'J', j, PURPLE)], levels: [level(80, RED), level(20, GREEN), level(50, GRAY)] };
    } },
  { id: 'volume', name: 'VOL · 成交量', category: '成交量', pane: 'sub', inputs: [periodInput('maPeriod', '均量周期', 20)],
    compute: (candles, inputs) => {
      const n = bars(inputs, 'maPeriod', 20), rising = candles.map(bar => bar.close >= bar.open);
      return { plots: [
        { id: 'volumeUp', title: '涨量', type: 'histogram', data: candles.map((bar, i) => rising[i] ? bar.volume : null), color: GREEN },
        { id: 'volumeDown', title: '跌量', type: 'histogram', data: candles.map((bar, i) => rising[i] ? null : bar.volume), color: RED },
        line('volumeMa', `均量${n}`, S.sma(volumes(candles), n), ORANGE)] };
    } },
  { id: 'rsi', name: 'RSI · 相对强弱', category: '振荡', pane: 'sub', inputs: [periodInput('period', '周期', 14)],
    compute: (candles, inputs) => { const n = bars(inputs, 'period', 14); return { plots: [line('rsi', `RSI${n}`, rsiSeries(closes(candles), n), PURPLE)], levels: [level(70, RED), level(30, GREEN)] }; } },
  { id: 'macd', name: 'MACD · 指数平滑异同', category: '动量', pane: 'sub', inputs: [periodInput('fast', '快线', 12), periodInput('slow', '慢线', 26), periodInput('signal', '信号线', 9)],
    compute: (candles, inputs) => {
      const fast = bars(inputs, 'fast', 12), slow = bars(inputs, 'slow', 26), signal = bars(inputs, 'signal', 9), close = closes(candles);
      const dif = join(S.ema(close, fast), S.ema(close, slow), (a, b) => a - b), dea = S.align(dif, dense => S.ema(dense, signal));
      return { plots: [line('dif', 'DIF', dif, BLUE), line('dea', 'DEA', dea, ORANGE), histogram('hist', 'MACD柱', join(dif, dea, (a, b) => a - b), GREEN, RED)] };
    } },
  { id: 'stoch', name: 'KD · 随机指标', category: '振荡', pane: 'sub', inputs: [periodInput('kPeriod', '%K周期', 14), periodInput('dPeriod', '%D周期', 3), periodInput('smooth', '平滑', 3)],
    compute: (candles, inputs) => {
      const kPeriod = bars(inputs, 'kPeriod', 14), dPeriod = bars(inputs, 'dPeriod', 3), smooth = bars(inputs, 'smooth', 3), close = closes(candles);
      const top = S.highest(highs(candles), kPeriod), bottom = S.lowest(lows(candles), kPeriod);
      const raw = close.map((value, i) => { const high = top[i], low = bottom[i]; return high === null || low === null ? null : percentInRange(value, high, low); });
      const k = S.align(raw, dense => S.sma(dense, smooth));
      return { plots: [line('k', '%K', k, BLUE), line('d', '%D', S.align(k, dense => S.sma(dense, dPeriod)), ORANGE)], levels: [level(80, RED), level(20, GREEN)] };
    } },
  { id: 'stochrsi', name: 'STOCHRSI · 随机RSI', category: '振荡', pane: 'sub', inputs: [periodInput('rsiPeriod', 'RSI周期', 14), periodInput('stochPeriod', '随机周期', 14), periodInput('k', 'K平滑', 3), periodInput('d', 'D平滑', 3)],
    compute: (candles, inputs) => {
      const rsiPeriod = bars(inputs, 'rsiPeriod', 14), stochPeriod = bars(inputs, 'stochPeriod', 14), kPeriod = bars(inputs, 'k', 3), dPeriod = bars(inputs, 'd', 3);
      const raw = S.align(rsiSeries(closes(candles), rsiPeriod), dense => stochastic(dense, stochPeriod));
      const k = S.align(raw, dense => S.sma(dense, kPeriod));
      return { plots: [line('k', '%K', k, BLUE), line('d', '%D', S.align(k, dense => S.sma(dense, dPeriod)), ORANGE)], levels: [level(80, RED), level(20, GREEN)] };
    } },
  { id: 'cci', name: 'CCI · 顺势指标', category: '振荡', pane: 'sub', inputs: [periodInput('period', '周期', 20)],
    compute: (candles, inputs) => {
      const n = bars(inputs, 'period', 20), typical = candles.map(bar => (bar.high + bar.low + bar.close) / 3), average = S.sma(typical, n);
      const data = typical.map((value, i) => {
        const mean = average[i];
        if (mean === null) return null;
        let deviation = 0;
        for (let j = i - n + 1; j <= i; j++) deviation += Math.abs(typical[j] - mean);
        deviation /= n;
        return deviation === 0 ? 0 : (value - mean) / (0.015 * deviation);
      });
      return { plots: [line('cci', `CCI${n}`, data, PURPLE)], levels: [level(100, RED), level(0, GRAY, '零轴'), level(-100, GREEN)] };
    } },
  { id: 'williamsr', name: '%R · 威廉指标', category: '振荡', pane: 'sub', inputs: [periodInput('period', '周期', 14)],
    compute: (candles, inputs) => {
      const n = bars(inputs, 'period', 14), close = closes(candles), top = S.highest(highs(candles), n), bottom = S.lowest(lows(candles), n);
      const data = close.map((value, i) => { const high = top[i], low = bottom[i]; return high === null || low === null ? null : -(100 - percentInRange(value, high, low)); });
      return { plots: [line('williamsr', `%R${n}`, data, TEAL)], levels: [level(-20, RED), level(-80, GREEN)] };
    } },
  { id: 'adx', name: 'ADX · 趋势强度', category: '趋势', pane: 'sub', inputs: [periodInput('period', '周期', 14)],
    compute: (candles, inputs) => {
      const n = bars(inputs, 'period', 14);
      // Wilder directional movement: the larger of the two bar-to-bar moves wins, the loser contributes 0.
      const rise = candles.map((bar, i) => i === 0 ? 0 : bar.high - candles[i - 1].high);
      const drop = candles.map((bar, i) => i === 0 ? 0 : candles[i - 1].low - bar.low);
      const up = rise.map((value, i) => value > drop[i] && value > 0 ? value : 0), down = drop.map((value, i) => value > rise[i] && value > 0 ? value : 0);
      const range = S.rma(S.trueRange(candles), n);
      const direction = (smoothed: Series) => smoothed.map((value, i) => { const total = range[i]; return value !== null && total !== null && total > 0 ? 100 * value / total : null; });
      const plus = direction(S.rma(up, n)), minus = direction(S.rma(down, n));
      const dx = plus.map((value, i) => { const other = minus[i]; if (value === null || other === null) return null; return value + other === 0 ? 0 : Math.abs(value - other) / (value + other) * 100; });
      return { plots: [line('plusDi', '+DI', plus, GREEN), line('minusDi', '-DI', minus, RED), line('adx', `ADX${n}`, S.align(dx, dense => S.rma(dense, n)), BLUE)] };
    } },
  { id: 'atr', name: 'ATR · 平均真实波幅', category: '波动率', pane: 'sub', inputs: [periodInput('period', '周期', 14)],
    compute: (candles, inputs) => { const n = bars(inputs, 'period', 14); return { plots: [line('atr', `ATR${n}`, S.atr(candles, n), ORANGE)] }; } },
  { id: 'obv', name: 'OBV · 能量潮', category: '成交量', pane: 'sub', inputs: [],
    compute: candles => {
      const close = closes(candles), data: number[] = [];
      for (let i = 0; i < candles.length; i++) data.push(i === 0 ? candles[0].volume : data[i - 1] + (close[i] > close[i - 1] ? candles[i].volume : close[i] < close[i - 1] ? -candles[i].volume : 0));
      return { plots: [line('obv', 'OBV', data, TEAL)] };
    } },
  { id: 'mfi', name: 'MFI · 资金流量', category: '成交量', pane: 'sub', inputs: [periodInput('period', '周期', 14)],
    compute: (candles, inputs) => {
      const n = bars(inputs, 'period', 14), typical = candles.map(bar => (bar.high + bar.low + bar.close) / 3);
      const money = typical.map((value, i) => value * candles[i].volume);
      const inflow = money.map((value, i) => i > 0 && typical[i] > typical[i - 1] ? value : 0), outflow = money.map((value, i) => i > 0 && typical[i] < typical[i - 1] ? value : 0);
      const positive = S.sum(inflow, n), negative = S.sum(outflow, n);
      const data = positive.map((value, i) => {
        const other = negative[i];
        if (value === null || other === null) return null;
        if (other === 0) return value === 0 ? 50 : 100;
        return 100 - 100 / (1 + value / other);
      });
      return { plots: [line('mfi', `MFI${n}`, data, PURPLE)], levels: [level(80, RED), level(20, GREEN)] };
    } },
  { id: 'roc', name: 'ROC · 变动率', category: '动量', pane: 'sub', inputs: [periodInput('period', '周期', 9)],
    compute: (candles, inputs) => {
      const n = bars(inputs, 'period', 9), close = closes(candles);
      return { plots: [line('roc', `ROC${n}`, close.map((value, i) => i < n || close[i - n] === 0 ? null : (value / close[i - n] - 1) * 100), BLUE)], levels: [level(0, GRAY, '零轴')] };
    } },
  { id: 'mom', name: 'MOM · 动量', category: '动量', pane: 'sub', inputs: [periodInput('period', '周期', 10)],
    compute: (candles, inputs) => {
      const n = bars(inputs, 'period', 10), close = closes(candles);
      return { plots: [line('mom', `MOM${n}`, close.map((value, i) => i < n ? null : value - close[i - n]), ORANGE)], levels: [level(0, GRAY, '零轴')] };
    } },
  { id: 'ao', name: 'AO · 动量震荡器', category: '动量', pane: 'sub', inputs: [periodInput('fast', '快线', 5), periodInput('slow', '慢线', 34)],
    compute: (candles, inputs) => {
      const fast = bars(inputs, 'fast', 5), slow = bars(inputs, 'slow', 34), mid = midpoints(candles);
      return { plots: [histogram('ao', `AO(${fast},${slow})`, join(S.sma(mid, fast), S.sma(mid, slow), (a, b) => a - b), GREEN, RED)] };
    } },
  { id: 'trix', name: 'TRIX · 三重指数', category: '动量', pane: 'sub', inputs: [periodInput('period', '周期', 15), periodInput('signal', '信号线', 9)],
    compute: (candles, inputs) => {
      const n = bars(inputs, 'period', 15), signal = bars(inputs, 'signal', 9), close = closes(candles);
      const once = S.ema(close, n), twice = S.align(once, dense => S.ema(dense, n)), thrice = S.align(twice, dense => S.ema(dense, n));
      const trix = S.align(thrice, dense => dense.map((value, i) => i === 0 || dense[i - 1] === 0 ? null : (value / dense[i - 1] - 1) * 100));
      return { plots: [line('trix', `TRIX${n}`, trix, BLUE), line('signal', 'TRIX信号', S.align(trix, dense => S.sma(dense, signal)), ORANGE)] };
    } },
  { id: 'cmf', name: 'CMF · 蔡金资金流', category: '成交量', pane: 'sub', inputs: [periodInput('period', '周期', 20)],
    compute: (candles, inputs) => {
      const n = bars(inputs, 'period', 20);
      const flow = candles.map(bar => bar.high === bar.low ? 0 : ((bar.close - bar.low) - (bar.high - bar.close)) / (bar.high - bar.low) * bar.volume);
      const weighted = S.sum(flow, n), total = S.sum(volumes(candles), n);
      const data = weighted.map((value, i) => { const volume = total[i]; return value !== null && volume !== null && volume > 0 ? value / volume : null; });
      return { plots: [line('cmf', `CMF${n}`, data, TEAL)], levels: [level(0, GRAY, '零轴')] };
    } },
  { id: 'stddev', name: 'STDDEV · 标准差', category: '波动率', pane: 'sub', inputs: [periodInput('period', '周期', 20)],
    compute: (candles, inputs) => { const n = bars(inputs, 'period', 20); return { plots: [line('stddev', `STDDEV${n}`, S.stdev(closes(candles), n), GRAY)] }; } },
];
