/*!
 * src/alerts.ts - zhuk-replay-studio key core logic
 * (c) 2026 William-Trader (https://github.com/William-Trader)
 * WM: ZRS-F9D39D1A
 * SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
 * Removing this mark violates the license.
 */
/** 指标预警：水平位穿越（RSI 70/30、KDJ 80/20…）与双线交叉（MACD 金叉/死叉、KDJ 金叉…）。
 *  纯函数：只看已揭示的K线，不读未来。无 DOM / 存储 / 网络。 */
import type { Candle } from './market';
import type { IndicatorDef, IndicatorOutput } from './indicators';

export type AlertKind = 'over-bought' | 'over-sold' | 'golden' | 'death';
export interface IndicatorAlert {
  /** 同一条提醒在回放中稳定（时间 + 指标 + 类型），用于去重与回退。 */
  key: string; time: number; kind: AlertKind;
  instanceId: string; defId: string; title: string; message: string; value: number; color: string;
}
export const ALERT_COLORS = { up: '#089981', down: '#f23645', warn: '#ff9800' } as const;
const finite = (value: number | null | undefined): value is number => value !== null && value !== undefined && Number.isFinite(value);
const round = (value: number) => Math.round(value * 100) / 100;

/** 单条线穿越某个水平位：上穿 → over-bought（红），下穿 → over-sold（绿）。 */
export function levelAlerts(data: readonly (number | null)[], level: number, bars: readonly Candle[], context: { instanceId: string; defId: string; title: string; label?: string }): IndicatorAlert[] {
  const list: IndicatorAlert[] = [];
  for (let i = 1; i < data.length && i < bars.length; i++) {
    const previous = data[i - 1], current = data[i];
    if (!finite(previous) || !finite(current)) continue;
    const up = previous < level && current >= level, down = previous > level && current <= level;
    if (!up && !down) continue;
    const label = context.label ?? String(level);
    list.push({
      key: `${context.defId}:${context.instanceId}:level:${level}:${bars[i].time}`,
      time: bars[i].time, kind: up ? 'over-bought' : 'over-sold',
      instanceId: context.instanceId, defId: context.defId,
      title: `${context.title} ${up ? '上穿' : '下穿'}${label}`,
      message: `${context.title} ${up ? '上穿' : '下穿'} ${label}（${round(current)}）`,
      value: current, color: up ? ALERT_COLORS.down : ALERT_COLORS.up,
    });
  }
  return list;
}
/** 两条线交叉：快线上穿慢线 → 金叉（绿），下穿 → 死叉（红）。 */
export function crossAlerts(fast: readonly (number | null)[], slow: readonly (number | null)[], bars: readonly Candle[], context: { instanceId: string; defId: string; title: string; fastLabel: string; slowLabel: string }): IndicatorAlert[] {
  const list: IndicatorAlert[] = [];
  for (let i = 1; i < fast.length && i < slow.length && i < bars.length; i++) {
    const f0 = fast[i - 1], s0 = slow[i - 1], f1 = fast[i], s1 = slow[i];
    if (!finite(f0) || !finite(s0) || !finite(f1) || !finite(s1)) continue;
    const golden = f0 <= s0 && f1 > s1, death = f0 >= s0 && f1 < s1;
    if (!golden && !death) continue;
    list.push({
      key: `${context.defId}:${context.instanceId}:cross:${bars[i].time}`,
      time: bars[i].time, kind: golden ? 'golden' : 'death',
      instanceId: context.instanceId, defId: context.defId,
      title: `${context.title} ${golden ? '金叉' : '死叉'}`,
      message: `${context.title}：${context.fastLabel} ${golden ? '上穿' : '下穿'} ${context.slowLabel}（${round(f1)} / ${round(s1)}）`,
      value: f1, color: golden ? ALERT_COLORS.up : ALERT_COLORS.down,
    });
  }
  return list;
}
/** 双线型指标（副图两条线）与水平位型指标的预警规则表。 */
export const CROSS_PAIRS: Record<string, { fast: string; slow: string; fastLabel: string; slowLabel: string; title: string }> = {
  macd: { fast: 'dif', slow: 'dea', fastLabel: 'DIF', slowLabel: 'DEA', title: 'MACD' },
  kdj: { fast: 'k', slow: 'd', fastLabel: 'K', slowLabel: 'D', title: 'KDJ' },
  stoch: { fast: 'k', slow: 'd', fastLabel: 'K', slowLabel: 'D', title: '随机指标' },
  stochrsi: { fast: 'k', slow: 'd', fastLabel: 'K', slowLabel: 'D', title: '随机RSI' },
  trix: { fast: 'trix', slow: 'signal', fastLabel: 'TRIX', slowLabel: '信号线', title: 'TRIX' },
  adx: { fast: 'plusDi', slow: 'minusDi', fastLabel: '+DI', slowLabel: '-DI', title: 'DMI' },
};
/** 该指标是否有预警规则（决定 UI 是否给开关）。 */
export function supportsAlerts(def: IndicatorDef): boolean {
  return Boolean(CROSS_PAIRS[def.id]) || Boolean(def.inputs.length >= 0 && def.pane === 'sub' && def.id !== 'atr' && def.id !== 'stddev' && def.id !== 'obv' && def.id !== 'volume' && def.id !== 'cmf');
}
/** 一个指标实例的全部提醒（按时间排序）。`enabled: false` 时返回空。 */
export function indicatorAlerts(def: IndicatorDef, out: IndicatorOutput, bars: readonly Candle[], instanceId: string, enabled = true): IndicatorAlert[] {
  if (!enabled || !bars.length) return [];
  const first = out.plots[0];
  if (!first) return [];
  const context = { instanceId, defId: def.id, title: def.name.split(' · ')[0] };
  const pair = CROSS_PAIRS[def.id];
  if (pair) {
    const fast = out.plots.find(plot => plot.id === pair.fast)?.data ?? first.data;
    const slow = out.plots.find(plot => plot.id === pair.slow)?.data;
    if (!slow) return [];
    return crossAlerts(fast, slow, bars, { ...context, fastLabel: pair.fastLabel, slowLabel: pair.slowLabel, title: pair.title })
      .sort((a, b) => a.time - b.time);
  }
  const levels = (out.levels ?? []).map(level => level.value);
  if (!levels.length) return [];
  return levels.flatMap(level => levelAlerts(first.data, level, bars, context)).sort((a, b) => a.time - b.time);
}
/** 过滤出某个时刻之后触发的提醒（复盘只统计本局窗口内的）。 */
export function alertsSince(alerts: readonly IndicatorAlert[], fromTime: number): IndicatorAlert[] {
  return alerts.filter(alert => alert.time >= fromTime);
}
/** 图上最多保留的提醒条数。 */
export const MAX_CHART_ALERTS = 60;
/** 图表标记用的形状/位置。 */
/** 图表标记：默认只画小圆点（金叉/死叉/超买超卖的文字不上图，避免糊在图面上）。 */
export const alertMarker = (alert: IndicatorAlert) => ({
  position: alert.kind === 'over-sold' || alert.kind === 'golden' ? 'belowBar' as const : 'aboveBar' as const,
  shape: 'circle' as const, color: alert.color, text: '',
});
