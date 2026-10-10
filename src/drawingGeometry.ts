/*!
 * src/drawingGeometry.ts - zhuk-replay-studio key core logic
 * (c) 2026 William-Trader (https://github.com/William-Trader)
 * WM: ZRS-30F0F7B8
 * SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
 * Removing this mark violates the license.
 */
/** 绘图几何：斐波那契 / 江恩 / 通道 / 回归 / 形状的纯计算。
 *  屏幕坐标（XY）用于圆、弧、曲线；价格-时间坐标（Priced）用于比例类工具。无 DOM。 */
import type { Point } from './drawing';

export interface XY { x: number; y: number }
export type Priced = Point;

/** 斐波那契价格序列：from + (to − from) × ratio。 */
export function fibPrices(from: number, to: number, ratios: readonly number[]): number[] {
  return ratios.map(ratio => from + (to - from) * ratio);
}
/** 时间斐波那契：锚点时间 + 单位步长 × 周期。 */
export function fibTimeSlots(time: number, step: number, levels: readonly number[]): number[] {
  return levels.map(level => time + step * level);
}
/** 直线在某个时间上的价格（两端时间相同时取起点价格）。 */
export function linePriceAt(a: Priced, b: Priced, time: number): number {
  if (b.time === a.time) return a.price;
  return a.price + (b.price - a.price) * ((time - a.time) / (b.time - a.time));
}
/** 过第三点的平行线相对 A→B 直线的价格偏移（通道宽）。 */
export function channelOffset(a: Priced, b: Priced, through: Priced): number {
  return through.price - linePriceAt(a, b, through.time);
}
/** 一元线性回归：price = intercept + slope × (time − firstTime)。 */
export function linearRegression(points: readonly Priced[]): { slope: number; intercept: number; firstTime: number } {
  if (points.length < 2) return { slope: 0, intercept: points[0]?.price ?? 0, firstTime: points[0]?.time ?? 0 };
  const firstTime = points[0].time;
  const xs = points.map(point => point.time - firstTime), ys = points.map(point => point.price);
  const meanX = xs.reduce((total, x) => total + x, 0) / xs.length, meanY = ys.reduce((total, y) => total + y, 0) / ys.length;
  let numerator = 0, denominator = 0;
  for (let i = 0; i < xs.length; i++) { numerator += (xs[i] - meanX) * (ys[i] - meanY); denominator += (xs[i] - meanX) ** 2; }
  const slope = denominator === 0 ? 0 : numerator / denominator;
  return { slope, intercept: meanY - slope * meanX, firstTime };
}
/** 回归线两端点 + 通道上下轨价格（标准差 × 倍数）。 */
export function regressionChannel(points: readonly Priced[], width = 2): { ends: [Priced, Priced]; upper: number; lower: number } {
  const { slope, intercept, firstTime } = linearRegression(points);
  const priceAt = (time: number) => intercept + slope * (time - firstTime);
  const first = points[0], last = points[points.length - 1];
  const residuals = points.map(point => point.price - priceAt(point.time));
  const deviation = Math.sqrt(residuals.reduce((total, value) => total + value * value, 0) / Math.max(1, residuals.length));
  return { ends: [{ time: first.time, price: priceAt(first.time) }, { time: last.time, price: priceAt(last.time) }], upper: deviation * width, lower: deviation * width };
}
/** 江恩角度线：以 A→B 为 1×1 基准，给出常用倍率的斜率（价格/时间）。 */
export function gannAngles(anchor: Priced, reference: Priced): { label: string; slope: number }[] {
  const span = reference.time - anchor.time;
  const base = span === 0 ? 0 : (reference.price - anchor.price) / span;
  const ratios: [string, number][] = [['1×8', 8], ['1×4', 4], ['1×3', 3], ['1×2', 2], ['1×1', 1], ['2×1', 1 / 2], ['3×1', 1 / 3], ['4×1', 1 / 4], ['8×1', 1 / 8]];
  return ratios.map(([label, factor]) => ({ label, slope: base * factor }));
}
/** 江恩箱网格：把 A→B 的矩形按 divisions 等分，返回价格线与时间线。 */
export function gannGrid(a: Priced, b: Priced, divisions = 4): { prices: number[]; times: number[] } {
  const steps = Math.max(1, Math.round(divisions));
  return {
    prices: Array.from({ length: steps - 1 }, (_, i) => a.price + (b.price - a.price) * ((i + 1) / steps)),
    times: Array.from({ length: steps - 1 }, (_, i) => a.time + (b.time - a.time) * ((i + 1) / steps)),
  };
}
/** 三点定圆（屏幕坐标）；三点共线时返回 null。 */
export function circleThrough(a: XY, b: XY, c: XY): { center: XY; radius: number } | null {
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  if (Math.abs(d) < 1e-6) return null;
  const ux = ((a.x ** 2 + a.y ** 2) * (b.y - c.y) + (b.x ** 2 + b.y ** 2) * (c.y - a.y) + (c.x ** 2 + c.y ** 2) * (a.y - b.y)) / d;
  const uy = ((a.x ** 2 + a.y ** 2) * (c.x - b.x) + (b.x ** 2 + b.y ** 2) * (a.x - c.x) + (c.x ** 2 + c.y ** 2) * (b.x - a.x)) / d;
  return { center: { x: ux, y: uy }, radius: Math.hypot(a.x - ux, a.y - uy) };
}
/** 以圆心与角度（度，0 = 右，顺时针）取圆上一点。 */
export function pointOnCircle(center: XY, radius: number, degrees: number): XY {
  const radians = degrees * Math.PI / 180;
  return { x: center.x + radius * Math.cos(radians), y: center.y + radius * Math.sin(radians) };
}
/** 椭圆弧路径（SVG，屏幕坐标）：先移动到 start，再以 stroke 到 end。 */
export function arcPath(center: XY, radius: number, start: XY, end: XY, largeArc = false): string {
  if (radius <= 0 || !Number.isFinite(radius)) return '';
  const sweep = 1;
  return `M${start.x} ${start.y}A${radius} ${radius} 0 ${largeArc ? 1 : 0} ${sweep} ${end.x} ${end.y}`;
}
/** 二次贝塞尔曲线路径（SVG，屏幕坐标）。 */
export function quadraticPath(a: XY, control: XY, b: XY): string {
  return `M${a.x} ${a.y}Q${control.x} ${control.y} ${b.x} ${b.y}`;
}
/** 对数螺旋：从锚点向外转 turns 圈，用于"斐波那契螺旋"。 */
export function spiralPath(center: XY, radius: number, turns = 2.5, steps = 96): string {
  if (radius <= 0) return '';
  const points: string[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const angle = t * turns * 2 * Math.PI;
    const r = radius * Math.pow(1.28, t * turns * 2);
    points.push(`${(center.x + r * Math.cos(angle)).toFixed(1)} ${(center.y + r * Math.sin(angle)).toFixed(1)}`);
  }
  return `M${points.join('L')}`;
}
/** 旋转矩形（价格-时间坐标）：A→B 为一条边，第三点决定垂直方向的价格偏移。 */
export function rotatedRectangle(a: Priced, b: Priced, through: Priced): Priced[] {
  const offset = channelOffset(a, b, through);
  return [a, b, { time: b.time, price: b.price + offset }, { time: a.time, price: a.price + offset }];
}
/** 投影线（价格-时间坐标）：沿 A→B 方向把 B 再延伸 ratio 倍。 */
export function projectAlong(a: Priced, b: Priced, ratio: number): Priced {
  return { time: b.time + (b.time - a.time) * ratio, price: b.price + (b.price - a.price) * ratio };
}
/** 区间统计：价格变化、百分比、K线根数（按分钟换算）。 */
export function rangeStats(a: Priced, b: Priced, minutes: number) {
  const change = b.price - a.price;
  return { change, percent: a.price ? change / a.price * 100 : 0, bars: Math.round((b.time - a.time) / (minutes * 60)) };
}
