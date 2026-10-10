/*!
 * src/indicators/overlays.ts - zhuk-replay-studio key core logic
 * (c) 2026 William-Trader (https://github.com/William-Trader)
 * WM: ZRS-F2FCE122
 * SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
 * Removing this mark violates the license.
 */
/** Main-pane overlays: every indicator is a pure function of candles + resolved inputs. */
import * as S from './series';
import { bars, num, numInput, periodInput, periods, periodsInput } from './params';
import { AMBER, BLUE, GRAY, GREEN, ORANGE, PURPLE, RED, TEAL, closes, dots, highs, join, line, lows, midpoints, shift, volumes } from './plots';
import type { IndicatorDef } from './types';
import type { Series } from './plots';

/** 交易所平台口径的均线配色：MA5 白/橙、MA10 蓝、MA20 紫、MA60 绿…（深色图上依旧可辨）。 */
/** 均线组配色对齐 TradingView 默认均线（蓝/橙/品红/绿/紫/琥珀）。 */
const GROUP_COLORS = ['#2962ff', '#ff6d00', '#e91e63', '#089981', '#9c27b0', '#ffb300'];

export const OVERLAYS: IndicatorDef[] = [
  { id: 'maSet', name: 'MA · 均线组（多周期）', category: '均线', pane: 'main', inputs: [periodsInput('periods', '周期（逗号分隔）', '5,10,20,60')],
    compute: (candles, inputs) => {
      const list = periods(inputs, 'periods', [5, 10, 20, 60]), close = closes(candles);
      return { plots: list.map((period, index) => line(`ma${period}`, `MA${period}`, S.sma(close, period), GROUP_COLORS[index % GROUP_COLORS.length])) };
    } },
  { id: 'emaSet', name: 'EMA · 指数均线组（多周期）', category: '均线', pane: 'main', inputs: [periodsInput('periods', '周期（逗号分隔）', '7,25,99')],
    compute: (candles, inputs) => {
      const list = periods(inputs, 'periods', [7, 25, 99]), close = closes(candles);
      return { plots: list.map((period, index) => line(`ema${period}`, `EMA${period}`, S.ema(close, period), GROUP_COLORS[index % GROUP_COLORS.length])) };
    } },
  { id: 'sma', name: 'SMA · 简单均线', category: '均线', pane: 'main', inputs: [periodInput('period', '周期', 20)],
    compute: (candles, inputs) => { const n = bars(inputs, 'period', 20); return { plots: [line('sma', `SMA${n}`, S.sma(closes(candles), n), BLUE)] }; } },
  { id: 'ema', name: 'EMA · 指数均线', category: '均线', pane: 'main', inputs: [periodInput('period', '周期', 20)],
    compute: (candles, inputs) => { const n = bars(inputs, 'period', 20); return { plots: [line('ema', `EMA${n}`, S.ema(closes(candles), n), ORANGE)] }; } },
  { id: 'wma', name: 'WMA · 加权均线', category: '均线', pane: 'main', inputs: [periodInput('period', '周期', 20)],
    compute: (candles, inputs) => { const n = bars(inputs, 'period', 20); return { plots: [line('wma', `WMA${n}`, S.wma(closes(candles), n), PURPLE)] }; } },
  { id: 'hma', name: 'HMA · 赫尔均线', category: '均线', pane: 'main', inputs: [periodInput('period', '周期', 20)],
    compute: (candles, inputs) => { const n = bars(inputs, 'period', 20); return { plots: [line('hma', `HMA${n}`, S.hma(closes(candles), n), TEAL)] }; } },
  { id: 'vwma', name: 'VWMA · 量价均线', category: '均线', pane: 'main', inputs: [periodInput('period', '周期', 20)],
    compute: (candles, inputs) => {
      const n = bars(inputs, 'period', 20), weighted = S.sum(closes(candles).map((close, i) => close * candles[i].volume), n), total = S.sum(volumes(candles), n);
      const value = weighted.map((sum, i) => { const volume = total[i]; return sum !== null && volume !== null && volume > 0 ? sum / volume : null; });
      return { plots: [line('vwma', `VWMA${n}`, value, GREEN)] };
    } },
  { id: 'bollinger', name: 'BB · 布林带', category: '通道', pane: 'main', inputs: [periodInput('period', '周期', 20), numInput('mult', '倍数', 2, 0.1, 20)],
    compute: (candles, inputs) => {
      const n = bars(inputs, 'period', 20), mult = num(inputs, 'mult', 2, 0.1, 20), close = closes(candles);
      const middle = S.sma(close, n), deviation = S.stdev(close, n);
      return { plots: [line('upper', `BB上轨${n}`, join(middle, deviation, (m, d) => m + mult * d), BLUE), line('middle', `BB中轨${n}`, middle, ORANGE, 'dashed'), line('lower', `BB下轨${n}`, join(middle, deviation, (m, d) => m - mult * d), BLUE)] };
    } },
  { id: 'keltner', name: 'KC · 肯特纳通道', category: '通道', pane: 'main', inputs: [periodInput('period', '周期', 20), numInput('mult', '倍数', 2, 0.1, 20), periodInput('atrPeriod', 'ATR周期', 10)],
    compute: (candles, inputs) => {
      const n = bars(inputs, 'period', 20), mult = num(inputs, 'mult', 2, 0.1, 20), atrPeriod = bars(inputs, 'atrPeriod', 10);
      const middle = S.ema(closes(candles), n), range = S.atr(candles, atrPeriod);
      return { plots: [line('upper', `KC上轨${n}`, join(middle, range, (m, a) => m + mult * a), PURPLE), line('middle', `KC中轨${n}`, middle, GRAY, 'dashed'), line('lower', `KC下轨${n}`, join(middle, range, (m, a) => m - mult * a), PURPLE)] };
    } },
  { id: 'donchian', name: 'DC · 唐奇安通道', category: '通道', pane: 'main', inputs: [periodInput('period', '周期', 20)],
    compute: (candles, inputs) => {
      const n = bars(inputs, 'period', 20), upper = S.highest(highs(candles), n), lower = S.lowest(lows(candles), n);
      return { plots: [line('upper', `DC上轨${n}`, upper, ORANGE), line('middle', `DC中轨${n}`, join(upper, lower, (a, b) => (a + b) / 2), GRAY, 'dashed'), line('lower', `DC下轨${n}`, lower, ORANGE)] };
    } },
  { id: 'supertrend', name: 'SUPERTREND · 超级趋势', category: '趋势', pane: 'main', inputs: [periodInput('atrPeriod', 'ATR周期', 10), numInput('mult', '倍数', 3, 0.1, 20)],
    compute: (candles, inputs) => {
      const atrPeriod = bars(inputs, 'atrPeriod', 10), mult = num(inputs, 'mult', 3, 0.1, 20), range = S.atr(candles, atrPeriod);
      const out = S.nulls(candles.length);
      let upper = 0, lower = 0, direction = 1, started = false;
      for (let i = 0; i < candles.length; i++) {
        const band = range[i];
        if (band === null) continue;
        const mid = (candles[i].high + candles[i].low) / 2, nextUpper = mid + mult * band, nextLower = mid - mult * band;
        if (!started) { upper = nextUpper; lower = nextLower; direction = i > 0 && candles[i].close >= candles[i - 1].close ? 1 : -1; started = true; }
        else {
          const previousClose = candles[i - 1].close;
          upper = nextUpper < upper || previousClose > upper ? nextUpper : upper;
          lower = nextLower > lower || previousClose < lower ? nextLower : lower;
          direction = candles[i].close > upper ? 1 : candles[i].close < lower ? -1 : direction;
        }
        out[i] = direction === 1 ? lower : upper;
      }
      return { plots: [line('supertrend', '超级趋势', out, BLUE)] };
    } },
  { id: 'psar', name: 'PSAR · 抛物线SAR', category: '趋势', pane: 'main', inputs: [numInput('step', '步长', 0.02, 0.001, 1), numInput('max', '上限', 0.2, 0.01, 1)],
    compute: (candles, inputs) => {
      const step = num(inputs, 'step', 0.02, 0.001, 1), max = num(inputs, 'max', 0.2, 0.01, 1), cap = Math.max(step, max);
      const out = S.nulls(candles.length), last = candles.length - 1;
      if (candles.length < 2) return { plots: [dots('psar', '抛物线SAR', out, PURPLE)] };
      const high = highs(candles), low = lows(candles);
      let long = candles[1].close >= candles[0].close, extreme = long ? Math.max(high[0], high[1]) : Math.min(low[0], low[1]);
      let sar = long ? Math.min(low[0], low[1]) : Math.max(high[0], high[1]), af = step;
      out[1] = sar;
      for (let i = 2; i <= last; i++) {
        let next = sar + af * (extreme - sar);
        next = long ? Math.min(next, low[i - 1], low[i - 2]) : Math.max(next, high[i - 1], high[i - 2]);
        if (long) { if (low[i] < next) { long = false; next = extreme; extreme = low[i]; af = step; } else if (high[i] > extreme) { extreme = high[i]; af = Math.min(af + step, cap); } }
        else { if (high[i] > next) { long = true; next = extreme; extreme = high[i]; af = step; } else if (low[i] < extreme) { extreme = low[i]; af = Math.min(af + step, cap); } }
        sar = next; out[i] = sar;
      }
      return { plots: [dots('psar', '抛物线SAR', out, long ? GREEN : RED)] };
    } },
  { id: 'ichimoku', name: 'ICHIMOKU · 一目均衡表', category: '趋势', pane: 'main', inputs: [periodInput('tenkan', '转换线', 9), periodInput('kijun', '基准线', 26), periodInput('senkou', '先行跨度', 52)],
    compute: (candles, inputs) => {
      const tenkanPeriod = bars(inputs, 'tenkan', 9), kijunPeriod = bars(inputs, 'kijun', 26), senkouPeriod = bars(inputs, 'senkou', 52);
      const high = highs(candles), low = lows(candles);
      const midline = (period: number) => join(S.highest(high, period), S.lowest(low, period), (a, b) => (a + b) / 2);
      const conversion = midline(tenkanPeriod), base = midline(kijunPeriod);
      const spanA = shift(join(conversion, base, (a, b) => (a + b) / 2), kijunPeriod), spanB = shift(midline(senkouPeriod), kijunPeriod);
      return { plots: [line('tenkan', `转换线${tenkanPeriod}`, conversion, BLUE), line('kijun', `基准线${kijunPeriod}`, base, RED), line('senkouA', '先行A', spanA, GREEN), line('senkouB', '先行B', spanB, ORANGE)] };
    } },
  { id: 'vwap', name: 'VWAP · 成交量加权均价', category: '成交量', pane: 'main', inputs: [],
    compute: candles => {
      let day = Number.NaN, weighted = 0, volume = 0;
      const data = candles.map(bar => {
        const current = Math.floor(bar.time / 86400);
        if (current !== day) { day = current; weighted = 0; volume = 0; }
        const typical = (bar.high + bar.low + bar.close) / 3;
        weighted += typical * bar.volume; volume += bar.volume;
        return volume > 0 ? weighted / volume : bar.close;
      });
      return { plots: [line('vwap', 'VWAP', data, AMBER)] };
    } },
  { id: 'pivots', name: 'PIVOT · 经典枢轴点', category: '趋势', pane: 'main', inputs: [],
    compute: candles => {
      const order: number[] = [], stats = new Map<number, { high: number; low: number; close: number; index: number }>();
      for (const bar of candles) {
        const day = Math.floor(bar.time / 86400), found = stats.get(day);
        if (found) { found.high = Math.max(found.high, bar.high); found.low = Math.min(found.low, bar.low); found.close = bar.close; }
        else { order.push(day); stats.set(day, { high: bar.high, low: bar.low, close: bar.close, index: order.length - 1 }); }
      }
      const levels = candles.map(bar => { const day = Math.floor(bar.time / 86400), at = stats.get(day)?.index ?? 0; return at > 0 ? stats.get(order[at - 1]) ?? null : null; });
      const value = (fn: (previous: { high: number; low: number; close: number }) => number): Series => levels.map(previous => previous ? fn(previous) : null);
      const pivot = (previous: { high: number; low: number; close: number }) => (previous.high + previous.low + previous.close) / 3;
      return { plots: [
        line('p', '枢轴P', value(pivot), BLUE), line('r1', 'R1', value(p => 2 * pivot(p) - p.low), RED), line('r2', 'R2', value(p => pivot(p) + (p.high - p.low)), RED, 'dashed'), line('r3', 'R3', value(p => p.high + 2 * (pivot(p) - p.low)), RED, 'dotted'),
        line('s1', 'S1', value(p => 2 * pivot(p) - p.high), GREEN), line('s2', 'S2', value(p => pivot(p) - (p.high - p.low)), GREEN, 'dashed'), line('s3', 'S3', value(p => p.low - 2 * (p.high - pivot(p))), GREEN, 'dotted')] };
    } },
];
