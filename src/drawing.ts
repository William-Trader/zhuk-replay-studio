/*!
 * src/drawing.ts - zhuk-replay-studio key core logic
 * (c) 2026 William-Trader (https://github.com/William-Trader)
 * WM: ZRS-997C6C0F
 * SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
 * Removing this mark violates the license.
 */
/** 绘图工具契约：种类、点击次数、名称、图标集与分组（对齐 TradingView 的工具盘）。 */

export type DrawingKind =
  // 线条
  | 'trend-line' | 'info-line' | 'trend-angle' | 'extended-line' | 'ray' | 'arrow' | 'polyline'
  | 'horizontal-line' | 'horizontal-ray' | 'vertical-line' | 'cross-line'
  // 通道
  | 'parallel-channel' | 'regression-trend' | 'flat-channel' | 'disjoint-channel'
  // 斐波那契
  | 'fib-retracement' | 'fib-trend-based' | 'fib-trend-time' | 'fib-extension' | 'fib-channel' | 'fib-time-zone'
  | 'fib-speed-fan' | 'fib-speed-arcs' | 'fib-wedge' | 'fib-circles' | 'fib-spiral' | 'fib-time-extension' | 'fib-pitchfan'
  // 江恩
  | 'gann-box' | 'gann-square-fixed' | 'gann-square' | 'gann-fan'
  // 预测与测量
  | 'measure' | 'date-range' | 'price-range' | 'bars-pattern' | 'long-position' | 'short-position' | 'forecast' | 'projection'
  // 形态
  | 'xabcd-pattern' | 'cypher-pattern' | 'abcd-pattern' | 'head-shoulders' | 'triangle-pattern' | 'three-drives'
  | 'elliott-impulse' | 'elliott-correction' | 'elliott-triangle' | 'elliott-double-combo' | 'elliott-triple-combo'
  // 几何图形
  | 'rectangle' | 'rotated-rectangle' | 'ellipse' | 'circle' | 'triangle' | 'arc' | 'curve' | 'double-curve'
  // 注释
  | 'text-annotation' | 'callout' | 'comment' | 'price-note' | 'signpost' | 'table'
  // 图标与画笔
  | 'icon-mark' | 'arrow-marker' | 'brush' | 'highlighter';

export type Tool = 'cursor' | DrawingKind;
export interface Point { time: number; price: number }
export interface Drawing { id: string; kind: DrawingKind; points: Point[]; color: string; width: number; text?: string }

/** 点击几次落图：单点 / 两点 / 三点 / 多点形态。 */
export const REQUIRED_POINTS: Record<DrawingKind, number> = {
  'trend-line': 2, 'info-line': 2, 'trend-angle': 2, 'extended-line': 2, ray: 2, arrow: 2, polyline: 3,
  'horizontal-line': 1, 'horizontal-ray': 2, 'vertical-line': 1, 'cross-line': 1,
  'parallel-channel': 3, 'regression-trend': 2, 'flat-channel': 3, 'disjoint-channel': 4,
  'fib-retracement': 2, 'fib-trend-based': 3, 'fib-trend-time': 2, 'fib-extension': 2, 'fib-channel': 3, 'fib-time-zone': 2,
  'fib-speed-fan': 3, 'fib-speed-arcs': 3, 'fib-wedge': 3, 'fib-circles': 2, 'fib-spiral': 2, 'fib-time-extension': 2, 'fib-pitchfan': 3,
  'gann-box': 2, 'gann-square-fixed': 1, 'gann-square': 2, 'gann-fan': 2,
  measure: 2, 'date-range': 2, 'price-range': 2, 'bars-pattern': 2, 'long-position': 3, 'short-position': 3, forecast: 3, projection: 2,
  'xabcd-pattern': 5, 'cypher-pattern': 5, 'abcd-pattern': 4, 'head-shoulders': 7, 'triangle-pattern': 3, 'three-drives': 6,
  'elliott-impulse': 6, 'elliott-correction': 3, 'elliott-triangle': 5, 'elliott-double-combo': 5, 'elliott-triple-combo': 7,
  rectangle: 2, 'rotated-rectangle': 3, ellipse: 2, circle: 2, triangle: 3, arc: 3, curve: 3, 'double-curve': 4,
  'text-annotation': 1, callout: 2, comment: 1, 'price-note': 1, signpost: 2, table: 1,
  'icon-mark': 1, 'arrow-marker': 1, brush: 2, highlighter: 2,
};

export const TOOL_NAMES: Record<Tool, string> = {
  cursor: '光标',
  'trend-line': '趋势线', 'info-line': '信息线', 'trend-angle': '趋势角度', 'extended-line': '延长线', ray: '射线', arrow: '箭头', polyline: '折线',
  'horizontal-line': '水平线', 'horizontal-ray': '水平射线', 'vertical-line': '垂直线', 'cross-line': '十字线',
  'parallel-channel': '平行通道', 'regression-trend': '回归趋势', 'flat-channel': '水平通道', 'disjoint-channel': '分离通道',
  'fib-retracement': '斐波那契回撤', 'fib-trend-based': '趋势斐波那契', 'fib-trend-time': '趋势时间斐波那契', 'fib-extension': '斐波那契扩展',
  'fib-channel': '斐波那契通道', 'fib-time-zone': '斐波那契时间区间', 'fib-speed-fan': '斐波那契扇形', 'fib-speed-arcs': '斐波那契弧线',
  'fib-wedge': '斐波那契楔形', 'fib-circles': '斐波那契圆环', 'fib-spiral': '斐波那契螺旋', 'fib-time-extension': '斐波那契时间扩展', 'fib-pitchfan': '斐波那契 Pitchfan',
  'gann-box': '江恩箱', 'gann-square-fixed': '固定江恩方', 'gann-square': '江恩方', 'gann-fan': '江恩扇形',
  measure: '区间测量', 'date-range': '时间区间', 'price-range': '价格区间', 'bars-pattern': 'K线数量',
  'long-position': '做多测算', 'short-position': '做空测算', forecast: '预测线', projection: '投影线',
  'xabcd-pattern': 'XABCD 形态', 'cypher-pattern': 'Cypher 形态', 'abcd-pattern': 'ABCD 形态', 'head-shoulders': '头肩形态',
  'triangle-pattern': '三角形态', 'three-drives': '三推形态',
  'elliott-impulse': '艾略特推动浪', 'elliott-correction': '艾略特调整浪', 'elliott-triangle': '艾略特三角浪',
  'elliott-double-combo': '艾略特双重组合', 'elliott-triple-combo': '艾略特三重组合',
  rectangle: '矩形', 'rotated-rectangle': '旋转矩形', ellipse: '椭圆', circle: '圆', triangle: '三角形', arc: '圆弧', curve: '曲线', 'double-curve': '双曲线',
  'text-annotation': '文字', callout: '标注气泡', comment: '评论', 'price-note': '价格便签', signpost: '指示牌', table: '表格',
  'icon-mark': '图标标记', 'arrow-marker': '箭头标记', brush: '画笔', highlighter: '荧光笔',
};

/** 需要文字的注释类工具。 */
export const TEXT_KINDS: readonly DrawingKind[] = ['text-annotation', 'callout', 'comment', 'price-note', 'signpost', 'table'];
/** 图标标记类工具（text 必须是 ICON_MARKS 之一）。 */
export const MARK_KINDS: readonly DrawingKind[] = ['icon-mark', 'arrow-marker'];

export const ICON_MARKS = [
  'flag', 'star', 'up', 'down', 'arrow-up', 'arrow-down', 'circle', 'square', 'diamond', 'cross',
  'check', 'x-mark', 'plus', 'minus', 'heart', 'smile', 'sad', 'dollar', 'target', 'fire',
  'lightning', 'question', 'exclamation', 'thumb-up', 'thumb-down',
] as const;
export type IconMark = (typeof ICON_MARKS)[number];
/** Fibonacci levels drawn between the two anchors of a retracement tool. */
export const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1] as const;
/** 扩展工具用的延伸比例。 */
export const FIB_EXTENSION_LEVELS = [1.272, 1.414, 1.618, 2, 2.618, 3.618] as const;
/** 时间类斐波那契使用的周期序列。 */
export const FIB_TIME_LEVELS = [1, 2, 3, 5, 8, 13, 21] as const;
/** XABCD pattern vertex labels. */
export const XABCD_LABELS = ['X', 'A', 'B', 'C', 'D'] as const;
/** 艾略特与形态类工具的顶点标签。 */
export const ELLIOTT_LABELS = ['0', '1', '2', '3', '4', '5', '6'] as const;
export const HEAD_SHOULDERS_LABELS = ['','L肩','','头','','R肩',''] as const;
export const PATTERN_LABELS: Partial<Record<DrawingKind, readonly string[]>> = {
  'head-shoulders': HEAD_SHOULDERS_LABELS,
  'elliott-impulse': ['0', '1', '2', '3', '4', '5'],
  'elliott-correction': ['A', 'B', 'C'],
  'elliott-triangle': ['A', 'B', 'C', 'D', 'E'],
  'elliott-double-combo': ['W', 'X', 'Y', 'X', 'Z'],
  'elliott-triple-combo': ['W', 'X', 'Y', 'X', 'Y', 'X', 'Z'],
  'three-drives': ['1', '2', '3', '4', '5', '6'],
  'abcd-pattern': ['A', 'B', 'C', 'D'],
  'cypher-pattern': [...XABCD_LABELS],
};

/** 左侧工具盘分组（对齐 TradingView 的九个分类）。 */
export interface ToolGroup { label: string; icon: DrawingKind; tools: DrawingKind[] }
export const TOOL_GROUPS: ToolGroup[] = [
  { label: '线条工具', icon: 'trend-line', tools: ['trend-line', 'info-line', 'trend-angle', 'extended-line', 'ray', 'arrow', 'polyline', 'horizontal-line', 'horizontal-ray', 'vertical-line', 'cross-line'] },
  { label: '通道工具', icon: 'parallel-channel', tools: ['parallel-channel', 'regression-trend', 'flat-channel', 'disjoint-channel'] },
  { label: '斐波那契与江恩', icon: 'fib-retracement', tools: ['fib-retracement', 'fib-trend-based', 'fib-trend-time', 'fib-extension', 'fib-channel', 'fib-time-zone', 'fib-speed-fan', 'fib-speed-arcs', 'fib-wedge', 'fib-circles', 'fib-spiral', 'fib-time-extension', 'fib-pitchfan', 'gann-box', 'gann-square-fixed', 'gann-square', 'gann-fan'] },
  { label: '预测与测量', icon: 'long-position', tools: ['measure', 'date-range', 'price-range', 'bars-pattern', 'long-position', 'short-position', 'forecast', 'projection'] },
  { label: '形态工具', icon: 'xabcd-pattern', tools: ['xabcd-pattern', 'cypher-pattern', 'abcd-pattern', 'head-shoulders', 'triangle-pattern', 'three-drives', 'elliott-impulse', 'elliott-correction', 'elliott-triangle', 'elliott-double-combo', 'elliott-triple-combo'] },
  { label: '几何图形', icon: 'rectangle', tools: ['rectangle', 'rotated-rectangle', 'ellipse', 'circle', 'triangle', 'arc', 'curve', 'double-curve'] },
  { label: '文字与标注', icon: 'text-annotation', tools: ['text-annotation', 'callout', 'comment', 'price-note', 'signpost', 'table'] },
  { label: '图标标记', icon: 'icon-mark', tools: ['icon-mark', 'arrow-marker'] },
  { label: '画笔工具', icon: 'brush', tools: ['brush', 'highlighter'] },
];

export function requiredPoints(kind: DrawingKind): number { return REQUIRED_POINTS[kind] ?? 2; }
export const isTextKind = (kind: DrawingKind): boolean => TEXT_KINDS.includes(kind);
export const isMarkKind = (kind: DrawingKind): boolean => MARK_KINDS.includes(kind);

export function validDrawing(d: Drawing): boolean {
  if (!d || !Array.isArray(d.points)) return false;
  const minimum = requiredPoints(d.kind);
  return d.points.length >= minimum && d.points.every(p => Number.isFinite(p.time) && Number.isFinite(p.price) && p.price > 0) &&
    Number.isFinite(d.width) && d.width >= 1 && d.width <= 4 &&
    (!isTextKind(d.kind) || !!d.text?.trim()) &&
    (!isMarkKind(d.kind) || ICON_MARKS.includes((d.text ?? '') as IconMark));
}
export function moveDrawing(d: Drawing, time: number, price: number, anchor?: number): Drawing {
  const points = d.points.map((p, i) => anchor === undefined || i === anchor ? { time: p.time + time, price: p.price + price } : p);
  return points.every(p => p.price > 0 && Number.isFinite(p.price) && Number.isFinite(p.time)) ? { ...d, points } : d;
}
export interface DrawingHistory { past: Drawing[][]; present: Drawing[]; future: Drawing[][] }
export const emptyHistory = (): DrawingHistory => ({ past: [], present: [], future: [] });
export function commit(history: DrawingHistory, next: Drawing[]): DrawingHistory {
  if (JSON.stringify(history.present) === JSON.stringify(next)) return history;
  return { past: [...history.past, history.present].slice(-30), present: next, future: [] };
}
export function undo(history: DrawingHistory): DrawingHistory {
  if (!history.past.length) return history;
  return { past: history.past.slice(0, -1), present: history.past[history.past.length - 1], future: [history.present, ...history.future] };
}
export function redo(history: DrawingHistory): DrawingHistory {
  if (!history.future.length) return history;
  return { past: [...history.past, history.present], present: history.future[0], future: history.future.slice(1) };
}
