/*!
 * src/components/ChartCanvas.tsx - zhuk-replay-studio key core logic
 * (c) 2026 William-Trader (https://github.com/William-Trader)
 * WM: ZRS-8715F3F9
 * SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
 * Removing this mark violates the license.
 */
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { AreaSeries, BarSeries, CandlestickSeries, HistogramSeries, LineSeries, ColorType, CrosshairMode, LineStyle, createChart, createSeriesMarkers,
  type IChartApi, type IPriceLine, type ISeriesApi, type ISeriesMarkersPluginApi, type Logical, type MouseEventParams, type SeriesType, type Time, type UTCTimestamp } from 'lightweight-charts';
import { chartTime, logicalToTime, timeToLogical, type Candle, type ChartType } from '../market';
import { resetSeriesCache, syncPlan, syncedState, type SeriesSync } from '../seriesSync';
import type { PerfMeter } from '../perf';
import { alertMarker, type IndicatorAlert } from '../alerts';
import { FIB_EXTENSION_LEVELS, FIB_LEVELS, FIB_TIME_LEVELS, PATTERN_LABELS, XABCD_LABELS, isMarkKind, isTextKind, moveDrawing, requiredPoints, validDrawing, type Drawing, type DrawingKind, type Point, type Tool } from '../drawing';
import { arcPath, channelOffset, circleThrough, fibPrices, fibTimeSlots, gannAngles, gannGrid, linePriceAt, projectAlong, quadraticPath, rangeStats, regressionChannel, rotatedRectangle, spiralPath } from '../drawingGeometry';
import { money, type Fill } from '../model';
import { iconMarkPath } from './DrawingGlyph';
import { createDrawingPreview, DRAWING_PREVIEW_INTERVAL_MS } from '../drawingPreview';

export interface ChartPlotSpec {
  key: string; paneKey: string; pane: 'main' | 'sub'; type: 'line' | 'histogram' | 'area' | 'dots';
  data: (number | null)[]; color: string; lineStyle?: 'solid' | 'dashed' | 'dotted';
  colorBySign?: boolean; colorUp?: string; colorDown?: string;
}
export interface ChartLevelSpec { paneKey: string; pane: 'main' | 'sub'; value: number; color?: string; title?: string }
export interface ChartLegendPlot { id: string; title: string; text: string; color?: string }
/** 图例条目：交易所形态的「指标名 + 各序列当前值 + 显隐/改参/移除/副图高度」。 */
export interface ChartLegendSpec {
  paneKey: string; pane: 'main' | 'sub'; title: string; color?: string; plots: ChartLegendPlot[];
  visible?: boolean; heightFactor?: number;
  /** 指标预警开关与该实例当前提醒条数。 */
  alertsOn?: boolean; alertCount?: number;
  onToggle?: () => void; onEdit?: () => void; onRemove?: () => void; onHeight?: () => void; onAlerts?: () => void;
}
/** 图表配色（canvas 不吃 CSS 变量，深色必须显式喂给 lightweight-charts）。 */
const CHART_FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "PingFang SC", "Microsoft YaHei", sans-serif';
function chartTheme(dark: boolean) {
  const grid = dark ? '#1f2431' : '#f0f3fa';
  const axis = dark ? '#2a2e39' : '#e0e3eb';
  const crosshair = dark ? '#5d606b' : '#9598a1';
  const label = dark ? '#2a2e39' : '#131722';
  return {
    layout: { background: { type: ColorType.Solid, color: dark ? '#131722' : '#ffffff' }, textColor: dark ? '#a6a9b2' : '#787b86' },
    grid: { vertLines: { color: grid }, horzLines: { color: grid } },
    rightPriceScale: { borderColor: axis },
    timeScale: { borderColor: axis },
    crosshair: { vertLine: { color: crosshair, labelBackgroundColor: label }, horzLine: { color: crosshair, labelBackgroundColor: label } },
  };
}

interface Props {
  /** 数据集标识：品种/周期/市场/重载计数变化时必须整体重建序列。 */
  datasetKey: string;
  /** 深色模式：画布/网格/坐标轴/十字线配色跟随主题（CSS 变量管不到 canvas）。 */
  dark: boolean;
  bars: Candle[]; minutes: number; anchorTime: number; drawings: Drawing[]; marks: Fill[]; alerts?: IndicatorAlert[]; tool: Tool; resetId: number;
  selected: string | null; hidden: boolean; locked: boolean; magnet: boolean; choosing: boolean;
  chartType: ChartType; iconMark: string;
  plots: ChartPlotSpec[]; paneOrder: string[]; levels: ChartLevelSpec[]; legends: ChartLegendSpec[];
  /** 副图高度倍率（paneKey → stretchFactor），交易所那种"副图可拉高"的手感。 */
  paneHeights?: Record<string, number>;
  /** 拖动副图分隔线后回传新的倍率。 */
  onPaneResize?: (key: string, factor: number) => void;
  onDrawing: (drawing: Drawing) => void; onUpdate: (drawing: Drawing) => void;
  onSelect: (id: string | null) => void; onPick: (time: number) => void; onHint: (hint: string) => void;
  onCrosshair: (bar: Candle | null, point?: { x: number; y: number } | null) => void;
  perf?: PerfMeter;
}
export interface ChartHandle { focus: (count?: number) => void; zoom: () => void }
type Gesture = { mode: 'create'; down: Point; x: number; y: number } | { mode: 'move'; down: Point; original: Drawing; anchor?: number };
type Editor = { point: Point; text: string; id?: string };
type AnySeries = ISeriesApi<SeriesType>;
/** Second colour of an XABCD zig-zag so alternating legs stay readable. */
const XABCD_ALT = '#ff6d00';
const ALERT_GREEN = '#089981', ALERT_RED = '#f23645', GRAY_DASH = '#9aa0aa', GRAY_TEXT = '#5c6270';
const PRICE_FORMAT = { type: 'price' as const, precision: 1, minMove: .1 };
/** 副图默认高度与上下限（像素）。 */
export const DEFAULT_PANE_HEIGHT = 140;
const clampHeight = (value: number, available: number) => Math.round(Math.min(Math.max(60, available * .75), Math.max(60, value)));
function dashStyle(style?: 'solid' | 'dashed' | 'dotted') {
  return style === 'dashed' ? LineStyle.Dashed : style === 'dotted' ? LineStyle.Dotted : LineStyle.Solid;
}

export const ChartCanvas = forwardRef<ChartHandle, Props>(function ChartCanvas(props, ref) {
  const host = useRef<HTMLDivElement>(null), stage = useRef<SVGSVGElement>(null);
  const latest = useRef(props); latest.current = props;
  const chart = useRef<IChartApi | null>(null), priceSeries = useRef<AnySeries | null>(null), mountedType = useRef<ChartType | null>(null);
  const markers = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const plotSeries = useRef(new Map<string, ISeriesApi<SeriesType>>());
  const levelLines = useRef(new Map<string, { series: ISeriesApi<SeriesType>; line: IPriceLine }>());
  /** Per-series sync state: lets the replay append instead of rebuilding every series each step. */
  const priceCache = useRef<SeriesSync | null>(null);
  const plotCaches = useRef(new Map<string, SeriesSync>());
  const paneSig = useRef('');
  const [paneTops, setPaneTops] = useState<number[]>([]);
  const [size, setSize] = useState({ width: 800, height: 400 });
  /** Observability for the incremental sync: how many points the price series and plot series hold. */
  const [synced, setSynced] = useState({ pricePoints: 0, plotPoints: 0, mode: 'full' as 'full' | 'append' });
  const [seriesEpoch, setSeriesEpoch] = useState(0);
  /** 主题热更新计数（无头验证用：能证明 applyOptions 真的跑过）。 */
  const [themeEpoch, setThemeEpoch] = useState(0);
  /** 图表实际使用的底色（读库的 options，验证深色真的喂进去了）。 */
  const [themeState, setThemeState] = useState({ bg: '' });
  /** 图上真正持有的数据（品种/点数/最后收盘价），随同步更新。 */
  const [seriesState, setSeriesState] = useState({ key: '', points: 0, lastClose: 0, lastTime: 0 });
  const [, setRevision] = useState(0);
  const redraw = () => setRevision(n => n + 1);
  /** 事件驱动的重算入口（尺寸变化时也会走 heights 效果）。 */
  function measurePanes() { setRevision(n => n + 1); }
  /** 副图分隔线拖动：以上方面板的高度比例换算倍率。 */
  const paneDrag = useRef<{ key: string; startY: number; height: number } | null>(null);
  function startPaneDrag(event: ReactPointerEvent<HTMLDivElement>, paneIndex: number) {
    if (paneIndex < 1) return;
    event.preventDefault(); event.stopPropagation();
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* 合成事件无活动指针 */ }
    // 分隔线下方的那块面板就是要调整的副图（第一条分隔线对应第一个副图）。
    const key = props.paneOrder[paneIndex - 1];
    if (!key) return;
    paneDrag.current = { key, startY: event.clientY, height: clampHeight(props.paneHeights?.[key] ?? DEFAULT_PANE_HEIGHT, 600) };
  }
  function movePaneDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const active = paneDrag.current; if (!active) return;
    // 向上拖 = 该副图变高。
    props.onPaneResize?.(active.key, clampHeight(active.height - (event.clientY - active.startY), (host.current?.clientHeight ?? 600)));
  }
  function endPaneDrag(event: ReactPointerEvent<HTMLDivElement>) {
    paneDrag.current = null;
    try { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* 忽略 */ }
  }
  const pending = useRef<Point[]>([]), gesture = useRef<Gesture | null>(null);
  const lastClick = useRef<{ id: string; at: number } | null>(null);
  const draftRef = useRef<Drawing | null>(null);
  const [draft, setDraftState] = useState<Drawing | null>(null);
  const preview = useMemo(() => createDrawingPreview<Drawing | null>(setDraftState), []);
  useEffect(() => () => preview.cancel(), [preview]);
  const setDraft = (d: Drawing | null) => { draftRef.current = d; preview.commit(d); };
  const queueDraft = (d: Drawing) => { draftRef.current = d; preview.enqueue(d); };
  const [editor, setEditor] = useState<Editor | null>(null);
  const editorRef = useRef(editor); editorRef.current = editor;
  const [hover, setHover] = useState<{ x: number; time: number } | null>(null);
  const focus = (count = 116) => {
    const p = latest.current;
    const last = p.choosing ? timeToLogical(p.anchorTime, p.bars, p.minutes * 60) : p.bars.length - 1;
    chart.current?.priceScale('right').applyOptions({ autoScale: true });
    chart.current?.timeScale().setVisibleLogicalRange({ from: last - count * .47, to: last + count * .53 });
    redraw();
  };
  useImperativeHandle(ref, () => ({ focus, zoom() {
    const range = chart.current?.timeScale().getVisibleLogicalRange();
    if (range) { const center = (range.from + range.to) / 2, half = (range.to - range.from) / 3; chart.current?.timeScale().setVisibleLogicalRange({ from: center - half, to: center + half }); }
  } }));
  /** (Re)builds the price series and the EMA overlay so chart-type switches keep every overlay. */
  function mountSeries(api: IChartApi, type: ChartType) {
    const series = (type === 'candlestick'
      ? api.addSeries(CandlestickSeries, { upColor: '#089981', downColor: '#f23645', borderUpColor: '#089981', borderDownColor: '#f23645', wickUpColor: '#089981', wickDownColor: '#f23645', priceLineColor: '#9598a1', priceLineStyle: LineStyle.Dotted, priceFormat: PRICE_FORMAT })
      : type === 'bar'
      ? api.addSeries(BarSeries, { upColor: '#089981', downColor: '#f23645', priceLineColor: '#9598a1', priceLineStyle: LineStyle.Dotted, priceFormat: PRICE_FORMAT })
      : type === 'line'
      ? api.addSeries(LineSeries, { color: '#2962ff', lineWidth: 2, priceLineColor: '#9598a1', priceLineStyle: LineStyle.Dotted, priceFormat: PRICE_FORMAT })
      : api.addSeries(AreaSeries, { lineColor: '#2962ff', topColor: '#2962ff26', bottomColor: '#2962ff04', lineWidth: 2, priceLineColor: '#9598a1', priceLineStyle: LineStyle.Dotted, priceFormat: PRICE_FORMAT })) as unknown as AnySeries;
    priceSeries.current = series;
    mountedType.current = type;
    markers.current = createSeriesMarkers(series, []);
    return series;
  }
  /** 主题切换：canvas 不吃 CSS 变量，必须显式 applyOptions（不重建图表）。 */
  useEffect(() => {
    const api = chart.current;
    if (!api) return;
    const theme = chartTheme(props.dark);
    api.applyOptions({ layout: theme.layout, grid: theme.grid, rightPriceScale: theme.rightPriceScale, timeScale: theme.timeScale, crosshair: theme.crosshair });
    setThemeEpoch(n => n + 1);
    setThemeState({ bg: String((api.options().layout?.background as { color?: string } | undefined)?.color ?? '') });
  }, [props.dark]);
  useEffect(() => {
    if (!host.current) return;
    const theme = chartTheme(props.dark);
    const api = createChart(host.current, {
      autoSize: true,
      layout: { ...theme.layout, fontFamily: CHART_FONT, fontSize: 11, attributionLogo: true },
      grid: theme.grid,
      rightPriceScale: { ...theme.rightPriceScale, minimumWidth: 66, scaleMargins: { top: .16, bottom: .25 } },
      timeScale: { ...theme.timeScale, timeVisible: true, secondsVisible: false, rightOffset: 65, shiftVisibleRangeOnNewBar: false,
        tickMarkFormatter: (time: Time) => typeof time === 'number' ? chartTime(time) : '' },
      crosshair: { mode: CrosshairMode.Normal, ...theme.crosshair },
      localization: { timeFormatter: (time: Time) => typeof time === 'number' ? chartTime(time, true) : '' },
    });
    chart.current = api;
    // 无头验证用探针：读出各副图真实高度（只读，不参与业务）。
    (window as Window & { __zkPanes?: () => unknown }).__zkPanes = () => ({ panes: api.panes().map(pane => ({ h: pane.getHeight(), f: pane.getStretchFactor() })), container: host.current?.clientHeight ?? 0, timeScale: api.timeScale().height() });
    mountSeries(api, latest.current.chartType);
    let frame = 0;
    const refresh = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!host.current) return;
        setSize({ width: Math.max(1, host.current.clientWidth - api.priceScale('right').width()), height: Math.max(1, host.current.clientHeight - api.timeScale().height()) });
        measurePanes();
        redraw();
      });
    };
    const observer = new ResizeObserver(refresh); observer.observe(host.current);
    api.timeScale().subscribeVisibleLogicalRangeChange(refresh);
    const crosshair = (param: MouseEventParams<Time>) => {
      const time = param.time;
      const point = param.point;
      latest.current.onCrosshair(
        typeof time === 'number' ? latest.current.bars.find(bar => bar.time === time) ?? null : null,
        point ? { x: point.x, y: point.y } : null,
      );
    };
    api.subscribeCrosshairMove(crosshair);
    const parent = host.current.parentElement!;
    parent.addEventListener('pointermove', refresh); parent.addEventListener('wheel', refresh, { passive: true });
    return () => {
      observer.disconnect(); cancelAnimationFrame(frame); api.timeScale().unsubscribeVisibleLogicalRangeChange(refresh);
      api.unsubscribeCrosshairMove(crosshair);
      parent.removeEventListener('pointermove', refresh); parent.removeEventListener('wheel', refresh);
      markers.current?.detach(); api.remove();
      chart.current = null; priceSeries.current = null; markers.current = null; mountedType.current = null;
    };
  }, [props.dark]);   // 主题切换直接重建图表：applyOptions 对多层 canvas 的重绘不可靠
  useEffect(() => {
    const api = chart.current;
    if (!api || mountedType.current === props.chartType) return;
    // Drawings, markers and hover state live outside the series, so they survive the swap.
    markers.current?.detach();
    if (priceSeries.current) api.removeSeries(priceSeries.current);
    priceSeries.current = null; markers.current = null;
    priceCache.current = null;
    mountSeries(api, props.chartType);
    setSeriesEpoch(n => n + 1);
  }, [props.chartType]);
  /** Syncs indicator / Python plot series and their reference lines, per pane. */
  useEffect(() => {
    const api = chart.current; if (!api) return;
    const sig = props.paneOrder.join('|');
    if (sig !== paneSig.current) {
      for (const series of plotSeries.current.values()) api.removeSeries(series);
      plotSeries.current.clear(); levelLines.current.clear();
      resetSeriesCache(plotCaches.current);
      paneSig.current = sig;
    }
    const desired = new Set(props.plots.map(plot => plot.key));
    for (const [key, series] of plotSeries.current) if (!desired.has(key)) { api.removeSeries(series); plotSeries.current.delete(key); plotCaches.current.delete(key); }
    const paneIndexFor = (plot: ChartPlotSpec) => plot.pane === 'main' ? 0 : 1 + Math.max(0, props.paneOrder.indexOf(plot.paneKey));
    const started = performance.now();
    for (const plot of props.plots) {
      let series = plotSeries.current.get(plot.key);
      if (!series) {
        // 主图叠加不占价格轴（数值在图例里），副图把当前值显示在右轴 —— 与交易所一致。
        const base = { priceLineVisible: false, lastValueVisible: plot.pane === 'sub', crosshairMarkerVisible: false };
        series = (plot.type === 'histogram'
          ? api.addSeries(HistogramSeries, { ...base, priceFormat: PRICE_FORMAT }, paneIndexFor(plot))
          : plot.type === 'area'
          ? api.addSeries(AreaSeries, { ...base, lineWidth: 1, lineColor: plot.color, topColor: `${plot.color}22`, bottomColor: `${plot.color}05` }, paneIndexFor(plot))
          : api.addSeries(LineSeries, { ...base, color: plot.color, lineWidth: 1, lineStyle: dashStyle(plot.lineStyle), ...(plot.type === 'dots' ? { lineVisible: false, pointMarkersVisible: true, pointMarkersRadius: 2 } : {}) }, paneIndexFor(plot))) as unknown as ISeriesApi<SeriesType>;
        plotSeries.current.set(plot.key, series);
        plotCaches.current.delete(plot.key);
      }
      const bars = latest.current.bars;
      const length = Math.min(plot.data.length, bars.length);
      if (!length) continue;
      const plan = syncPlan(plotCaches.current.get(plot.key) ?? null, length, bars[0].time, props.datasetKey);
      /** One point, or null when the value is missing (chart libraries reject NaN). */
      const pointAt = (index: number) => {
        const value = plot.data[index];
        if (value === null || value === undefined || !Number.isFinite(value)) return null;
        const time = bars[index].time as UTCTimestamp;
        return plot.type === 'histogram'
          ? { time, value, color: plot.colorBySign ? (value >= 0 ? plot.colorUp ?? '#26a69a' : plot.colorDown ?? '#ef5350') : plot.color }
          : { time, value };
      };
      if (plan.mode === 'full') {
        const data: { time: UTCTimestamp; value: number; color?: string }[] = [];
        for (let i = 0; i < length; i++) { const point = pointAt(i); if (point) data.push(point); }
        (series as ISeriesApi<'Histogram'>).setData(data);
      } else {
        for (let i = plan.from; i < length; i++) { const point = pointAt(i); if (point) (series as ISeriesApi<'Histogram'>).update(point); }
      }
      plotCaches.current.set(plot.key, syncedState(length, bars[0].time, props.datasetKey));
    }
    setSynced(current => ({ ...current, plotPoints: props.plots.reduce((total, plot) => total + Math.min(plot.data.length, latest.current.bars.length), 0) }));
    props.perf?.chart(performance.now() - started);
    const firstFor = new Map<string, ISeriesApi<SeriesType>>();
    for (const plot of props.plots) if (!firstFor.has(plot.paneKey)) { const series = plotSeries.current.get(plot.key); if (series) firstFor.set(plot.paneKey, series); }
    const wanted = new Set<string>();
    for (const level of props.levels) {
      const series = firstFor.get(level.paneKey); if (!series) continue;
      const key = `${level.paneKey}:${level.value}`; wanted.add(key);
      if (levelLines.current.has(key)) continue;
      const line = series.createPriceLine({ price: level.value, color: level.color ?? '#787b86', lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: true, title: level.title ?? '' });
      levelLines.current.set(key, { series, line });
    }
    for (const [key, entry] of levelLines.current) if (!wanted.has(key)) { try { entry.series.removePriceLine(entry.line); } catch { /* series already gone */ } levelLines.current.delete(key); }
    measurePanes();
    redraw();
  }, [props.plots, props.paneOrder, props.levels, props.datasetKey, seriesEpoch]);
  useEffect(() => {
    const bars = props.bars;
    const started = performance.now();
    const firstTime = bars[0]?.time ?? 0;
    const series = priceSeries.current;
    let mode: 'full' | 'append' = 'full';
    if (series) {
      const plan = syncPlan(priceCache.current, bars.length, firstTime, props.datasetKey);
      mode = plan.mode;
      if (plan.mode === 'full') (series as unknown as ISeriesApi<'Candlestick'>).setData(bars.map(bar => ({ ...bar, time: bar.time as UTCTimestamp })));
      else for (let i = plan.from; i < bars.length; i++) (series as unknown as ISeriesApi<'Candlestick'>).update({ ...bars[i], time: bars[i].time as UTCTimestamp });
      priceCache.current = syncedState(bars.length, firstTime, props.datasetKey);
      // 观测：图上真正持有的最后一根（用于验证"切品种后图确实换了"）。
      setSeriesState({ key: props.datasetKey, points: bars.length, lastClose: bars[bars.length - 1]?.close ?? 0, lastTime: bars[bars.length - 1]?.time ?? 0 });
    }
    props.perf?.chart(performance.now() - started);
    setSynced(current => current.pricePoints === bars.length && current.mode === mode ? current : { ...current, pricePoints: bars.length, mode });
    const range = chart.current?.timeScale().getVisibleLogicalRange(), last = bars.length - 1;
    if (range && last > range.to - 5) chart.current?.timeScale().setVisibleLogicalRange({ from: last + 15 - (range.to - range.from), to: last + 15 });
    redraw();
  }, [props.bars, props.datasetKey, seriesEpoch]);
  /** 副图高度倍率：交易所那种可以拉高的副图。 */
  useEffect(() => {
    const api = chart.current; if (!api) return;
    const panes = api.panes();
    if (!panes.length) return;
    // getHeight() 对副图会返回 0，所以高度由我们自己算：副图取记忆像素值，主图吃剩余空间。
    const container = host.current?.clientHeight ?? 0;
    const available = Math.max(160, container - api.timeScale().height());
    const subs = props.paneOrder.slice(0, Math.max(0, panes.length - 1)).map(key => Math.round(clampHeight(props.paneHeights?.[key] ?? DEFAULT_PANE_HEIGHT, available)));
    const mainHeight = Math.max(120, available - subs.reduce((total, value) => total + value, 0));
    panes[0].setHeight(mainHeight);
    subs.forEach((height, index) => panes[index + 1]?.setHeight(height));
    setPaneTops(subs.reduce<number[]>((tops, height) => [...tops, tops[tops.length - 1] + height], [0]));
    redraw();
  }, [props.paneOrder, props.paneHeights, seriesEpoch]);
  useEffect(() => { focus(); }, [props.resetId, props.minutes]);
  useEffect(() => {
    pending.current = []; gesture.current = null; setDraft(null); setHover(null);
    chart.current?.applyOptions({ handleScroll: props.tool === 'cursor' && !props.choosing, handleScale: props.tool === 'cursor' && !props.choosing });
  }, [props.tool, props.choosing, props.resetId]);
  useEffect(() => {
    // 成交记号与指标预警共用同一批标记（预警用小圆点，避免与箭头混淆）。
    const fillMarks = props.marks.map(mark => ({
      time: (Math.floor(mark.time / (props.minutes * 60)) * props.minutes * 60) as UTCTimestamp,
      position: (mark.side === 'buy' ? 'belowBar' : 'aboveBar') as 'belowBar' | 'aboveBar',
      shape: (mark.side === 'buy' ? 'arrowUp' : 'arrowDown') as 'arrowUp' | 'arrowDown',
      color: mark.side === 'buy' ? '#089981' : '#f23645', text: `${mark.side === 'buy' ? '开多' : '平多'} ${mark.qty}`,
    }));
    const alertMarks = (props.alerts ?? []).map(alert => {
      const shape = alertMarker(alert);
      return { time: (Math.floor(alert.time / (props.minutes * 60)) * props.minutes * 60) as UTCTimestamp, ...shape };
    });
    markers.current?.setMarkers([...fillMarks, ...alertMarks].sort((a, b) => a.time - b.time));
  }, [props.marks, props.alerts, props.minutes, seriesEpoch]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { pending.current = []; gesture.current = null; setDraft(null); editorRef.current = null; setEditor(null); }
    };
    window.addEventListener('keydown', escape); return () => window.removeEventListener('keydown', escape);
  }, []);
  function coordinates(point: Point) {
    const logical = timeToLogical(point.time, props.bars, props.minutes * 60);
    return { x: chart.current?.timeScale().logicalToCoordinate(logical as Logical) ?? -9999, y: priceSeries.current?.priceToCoordinate(point.price) ?? -9999 };
  }
  function pointer(event: ReactPointerEvent): { point: Point; x: number; y: number } | null {
    const rect = stage.current?.getBoundingClientRect(); if (!rect || !chart.current || !priceSeries.current) return null;
    const x = Math.max(0, Math.min(size.width, event.clientX - rect.left)), y = Math.max(0, Math.min(size.height, event.clientY - rect.top));
    const logical = chart.current.timeScale().coordinateToLogical(x), price = priceSeries.current.coordinateToPrice(y);
    if (logical === null || price === null || price <= 0) return null;
    const point: Point = { time: logicalToTime(logical, props.bars, props.minutes * 60), price };
    if (props.magnet && props.tool !== 'cursor') {
      const bar = props.bars[Math.round(logical)];
      if (bar) { const closest = [bar.open, bar.high, bar.low, bar.close].sort((a, b) => Math.abs(a - price) - Math.abs(b - price))[0];
        if (Math.abs((priceSeries.current.priceToCoordinate(closest) ?? -999) - y) < 14) { point.time = bar.time; point.price = closest; } }
    }
    return { point, x, y };
  }
  function fresh(points: Point[]): Drawing {
    const kind: DrawingKind = props.tool === 'cursor' ? 'trend-line' : props.tool;
    return { id: `drawing-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, kind, points, color: '#2962ff', width: 2,
      ...(isMarkKind(kind) ? { text: props.iconMark } : {}) };
  }
  function finish(d: Drawing | null) {
    if (d && validDrawing(d)) props.onDrawing(d);
    setDraft(null); pending.current = []; gesture.current = null;
  }
  function down(event: ReactPointerEvent<SVGSVGElement>) {
    if (event.button !== 0 || editor) return;
    const p = pointer(event); if (!p) return;
    if (props.choosing) { const i = Math.max(0, Math.min(props.bars.length - 1, Math.round(timeToLogical(p.point.time, props.bars, props.minutes * 60)))); props.onPick(props.bars[i].time); return; }
    if (props.tool === 'cursor') return;
    event.preventDefault();
    // 指针已失效/合成事件时 setPointerCapture 会抛错，这里容错（真机拖拽仍走捕获）。
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* 忽略 */ }
    if (isTextKind(props.tool as DrawingKind)) { setEditor({ point: p.point, text: '' }); return; }
    const needed = requiredPoints(props.tool);
    if (needed === 1) { finish(fresh([p.point])); return; }
    const collected = [...pending.current, p.point];
    gesture.current = { mode: 'create', down: p.point, x: p.x, y: p.y };
    pending.current = collected;
    if (collected.length >= needed) finish(fresh(collected));
    else setDraft(fresh([...collected, p.point]));
  }
  function move(event: ReactPointerEvent<SVGSVGElement>) {
    const p = pointer(event); if (!p) return;
    if (props.choosing) { const index = Math.max(0, Math.min(props.bars.length - 1, Math.round(timeToLogical(p.point.time, props.bars, props.minutes * 60)))); setHover({ x: coordinates({time:props.bars[index].time,price:props.bars[index].close}).x, time: props.bars[index].time }); return; }
    const g = gesture.current;
    if (g?.mode === 'move') { queueDraft(moveDrawing(g.original, p.point.time - g.down.time, p.point.price - g.down.price, g.anchor)); return; }
    if (!pending.current.length || !draftRef.current) return;
    const points = props.tool === 'brush' && g ? [...draftRef.current.points, p.point] : [...pending.current, p.point];
    queueDraft({ ...draftRef.current, points });
  }
  function up(event: ReactPointerEvent<SVGSVGElement>) {
    const p = pointer(event), g = gesture.current;
    if (g?.mode === 'move') {
      // Commit the release coordinates, even when the last preview is still queued.
      if (p) draftRef.current = moveDrawing(g.original, p.point.time - g.down.time, p.point.price - g.down.price, g.anchor);
      if (draftRef.current && validDrawing(draftRef.current)) props.onUpdate(draftRef.current);
      // Pointer capture retargets the native dblclick to the SVG root. Detect two
      // stationary pointer releases so text remains editable after dragging too.
      if (draftRef.current && JSON.stringify(draftRef.current.points) === JSON.stringify(g.original.points)) {
        const now = performance.now();
        if (g.original.kind === 'text-annotation' && lastClick.current?.id === g.original.id && now - lastClick.current.at < 500) {
          setEditor({ id: g.original.id, point: g.original.points[0], text: g.original.text ?? '' });
          lastClick.current = null;
        } else lastClick.current = { id: g.original.id, at: now };
      } else lastClick.current = null;
      setDraft(null); gesture.current = null;
    } else if (g && p) {
      const dragged = Math.hypot(p.x - g.x, p.y - g.y) > 4;
      const kind = props.tool === 'cursor' ? 'trend-line' : props.tool;
      // Only two-point tools commit on release; the five-point pattern waits for its clicks.
      if (dragged && requiredPoints(kind) === 2 && draftRef.current && pending.current.length <= 1) {
        const d = draftRef.current;
        const points = props.tool === 'brush' ? [...d.points, p.point] : [g.down, p.point];
        finish({ ...d, points });
      }
      else if (props.tool === 'brush') { setDraft(null); pending.current = []; gesture.current = null; }
      else gesture.current = null;
    }
    try { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* 忽略 */ }
  }
  function beginMove(event: ReactPointerEvent, drawing: Drawing, anchor?: number) {
    if (props.tool !== 'cursor' || props.locked || event.button !== 0 || props.choosing) return;
    const p = pointer(event); if (!p) return;
    event.preventDefault(); event.stopPropagation(); props.onSelect(drawing.id);
    gesture.current = { mode: 'move', down: p.point, original: drawing, anchor };
    setDraft(drawing);
    try { stage.current?.setPointerCapture(event.pointerId); } catch { /* 忽略 */ }
  }
  function commitText() {
    const edit = editorRef.current; if (!edit) return;
    editorRef.current = null; setEditor(null);
    const old = props.drawings.find(d => d.id === edit.id);
    // 编辑已有文字时保留它原本的工具类型（标注气泡/评论/便签/指示牌/表格）。
    const d: Drawing = { ...(old ?? fresh([edit.point])), text: edit.text.trim() };
    if (validDrawing(d)) { if (old) props.onUpdate(d); else props.onDrawing(d); }
  }
  /** 全部绘图工具的 SVG 画法（按家族组织：线条 / 通道 / 斐波那契 / 江恩 / 测算 / 形态 / 几何 / 注释 / 图标 / 画笔）。 */
  function shape(d: Drawing, hit = false) {
    const p0 = d.points[0], p1 = d.points[1] ?? d.points[0], p2 = d.points[2] ?? p1, p3 = d.points[3] ?? p2;
    const pts = d.points.map(coordinates);
    const stroke = { stroke: hit ? 'transparent' : d.color, strokeWidth: hit ? 14 : d.width, fill: 'none', vectorEffect: 'non-scaling-stroke' as const };
    const soft = hit ? 'transparent' : `${d.color}14`;
    const xOf = (time: number) => chart.current?.timeScale().logicalToCoordinate(timeToLogical(time, props.bars, props.minutes * 60) as Logical) ?? -9999;
    const yOf = (price: number) => priceSeries.current?.priceToCoordinate(price) ?? -9999;
    const at = (point: Point) => ({ x: xOf(point.time), y: yOf(point.price) });
    const text = (x: number, y: number, value: string, color = d.color, anchor: 'start' | 'middle' | 'end' = 'start') => <text x={x} y={y} fill={color} fontSize={11} textAnchor={anchor}>{value}</text>;
    const seg = (from: Point, to: Point, color = d.color, dash?: string) => <line x1={xOf(from.time)} y1={yOf(from.price)} x2={xOf(to.time)} y2={yOf(to.price)} stroke={color} strokeWidth={d.width} strokeDasharray={dash} vectorEffect="non-scaling-stroke" />;
    const extend = (from: { x: number; y: number }, to: { x: number; y: number }, factor: number) => ({ x: from.x + (to.x - from.x) * factor, y: from.y + (to.y - from.y) * factor });
    const FULL = Math.max(size.width, size.height) * 3;
    const far = (from: { x: number; y: number }, to: { x: number; y: number }, direction: 1 | -1) => {
      const dx = to.x - from.x, dy = to.y - from.y, length = Math.max(1, Math.hypot(dx, dy));
      return { x: from.x + dx / length * FULL * direction, y: from.y + dy / length * FULL * direction };
    };
    const a = coordinates(p0), b = coordinates(p1);
    /** 斐波那契水平线（价格-时间空间，从 x0 到 x1，右侧标比例与价格）。 */
    const fibLines = (from: Point, to: Point, levels: readonly number[], colors: string[]) => {
      const x0 = xOf(from.time), x1 = xOf(to.time), left = Math.min(x0, x1), right = Math.max(x0, x1);
      const anchorRight = right > size.width - 96;
      return <g>{levels.map((level, index) => {
        const price = from.price + (to.price - from.price) * level;
        const y = yOf(price);
        return <g key={`${level}-${index}`}><line x1={left} x2={right} y1={y} y2={y} stroke={colors[index % colors.length]} strokeWidth={d.width} vectorEffect="non-scaling-stroke" strokeDasharray={index === 0 || index === levels.length - 1 ? undefined : '5 4'} />
          {text(anchorRight ? right - 4 : right + 4, y - 3, `${(level * 100).toFixed(1)}% ${money(price)}`, colors[index % colors.length], anchorRight ? 'end' : 'start')}</g>;
      })}</g>;
    };
    if (hit) {
      // 命中层：统一的透明粗线 / 外框，保证任何工具都容易点中。
      if (d.kind === 'icon-mark' || d.kind === 'arrow-marker' || d.kind === 'comment' || d.kind === 'price-note' || d.kind === 'table' || d.kind === 'gann-square-fixed') return <rect x={a.x - 14} y={a.y - 14} width={28} height={28} fill="transparent" />;
      if (d.kind === 'rectangle' || d.kind === 'rotated-rectangle' || d.kind === 'measure' || d.kind === 'long-position' || d.kind === 'short-position' || d.kind === 'flat-channel' || d.kind === 'gann-box' || d.kind === 'gann-square' || d.kind === 'date-range' || d.kind === 'price-range' || d.kind === 'bars-pattern' || d.kind === 'projection') {
        const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
        return <rect x={Math.min(...xs) - 6} y={Math.min(...ys) - 6} width={Math.abs(Math.max(...xs) - Math.min(...xs)) + 12} height={Math.abs(Math.max(...ys) - Math.min(...ys)) + 12} fill="transparent" />;
      }
      if (d.points.length > 2) return <polyline points={pts.map(p => `${p.x},${p.y}`).join(' ')} stroke="transparent" strokeWidth={16} fill="none" strokeLinejoin="round" />;
      return <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} {...stroke} strokeWidth={16} />;
    }

    // ---- 形态类（艾略特 / ABCD / Cypher / 头肩 / 三推）：折线 + 顶点标签 ----
    const patternLabels = PATTERN_LABELS[d.kind];
    if (patternLabels) {
      return <g>
        {pts.slice(0, -1).map((c, i) => <line key={i} x1={c.x} y1={c.y} x2={pts[i + 1].x} y2={pts[i + 1].y} stroke={i % 2 ? XABCD_ALT : d.color} strokeWidth={d.width} vectorEffect="non-scaling-stroke" />)}
        {pts.map((c, i) => patternLabels[i] ? <g key={i}><circle cx={c.x} cy={c.y} r={2.5} fill={i % 2 ? XABCD_ALT : d.color} />{text(c.x + 7, c.y - 7, patternLabels[i], i % 2 ? XABCD_ALT : d.color)}</g> : null)}
      </g>;
    }
    if (d.kind === 'triangle-pattern') {
      return <g><polygon points={pts.map(p => `${p.x},${p.y}`).join(' ')} {...stroke} fill={soft} />
        {pts.map((c, i) => text(c.x + 6, c.y - 6, ['A', 'B', 'C', 'D', 'E'][i] ?? '', d.color))}</g>;
    }

    // ---- 斐波那契家族 ----
    if (d.kind === 'fib-retracement') return fibLines(p0, p1, FIB_LEVELS, [d.color, d.color, d.color, d.color, d.color, d.color, d.color]);
    if (d.kind === 'fib-extension') return <g>{fibLines(p0, p1, FIB_LEVELS, [d.color])}{seg(p0, p1, GRAY_DASH)}{fibLines(p1, { time: p1.time + (p1.time - p0.time), price: p1.price + (p1.price - p0.price) }, FIB_EXTENSION_LEVELS, [XABCD_ALT])}</g>;
    if (d.kind === 'fib-trend-based' || d.kind === 'fib-wedge') {
      // 三点：先定趋势（A→B），再由 C 决定区间 → 回撤与扩展一起画。
      const x0 = xOf(p2.time), x1 = x0 + Math.abs(xOf(p1.time) - xOf(p0.time));
      const top = p2.price, bottom = p1.price;
      return <g>
        {seg(p0, p1, GRAY_DASH)}{seg(p1, p2, GRAY_DASH)}
        {FIB_LEVELS.map((level, index) => { const y = yOf(top + (bottom - top) * level); return <line key={level} x1={Math.min(x0, x1)} x2={Math.max(x0, x1)} y1={y} y2={y} stroke={index % 2 ? XABCD_ALT : d.color} strokeWidth={d.width} vectorEffect="non-scaling-stroke" strokeDasharray={index ? '5 4' : undefined} />; })}
      </g>;
    }
    if (d.kind === 'fib-channel') {
      // 三点：A→B 为斜边，C 决定通道宽；每个比例画一条平行斜线。
      const shift = channelOffset(p0, p1, p2);
      return <g>{FIB_LEVELS.map((level, index) => {
        const from = { time: p0.time, price: p0.price + shift * level };
        const to = { time: p1.time, price: p1.price + shift * level };
        return <g key={level}>{seg(from, to, index % 2 ? XABCD_ALT : d.color, index ? '5 4' : undefined)}
          {text(xOf(p1.time) + 4, yOf(to.price) - 3, `${(level * 100).toFixed(1)}%`, index % 2 ? XABCD_ALT : d.color)}</g>;
      })}</g>;
    }
    if (d.kind === 'fib-time-zone' || d.kind === 'fib-trend-time' || d.kind === 'fib-time-extension') {
      const unit = Math.max(1, p1.time - p0.time);
      const levels = d.kind === 'fib-time-extension' ? [...FIB_TIME_LEVELS.map(value => value * 2)] : FIB_TIME_LEVELS;
      const times = fibTimeSlots(p0.time, unit, levels);
      return <g>{seg(p0, p1, GRAY_DASH)}{times.map((time, index) => {
        const x = xOf(time);
        return <g key={index}><rect x={x - 6} y={0} width={12} height={size.height} fill={index % 2 ? `${XABCD_ALT}22` : `${d.color}1f`} />
          {text(x + 3, 14, `${levels[index]}`, d.color)}</g>;
      })}</g>;
    }
    if (d.kind === 'fib-speed-fan' || d.kind === 'fib-pitchfan') {
      const prices = fibPrices(p1.price, p2.price, FIB_LEVELS);
      return <g>{seg(p0, p1, GRAY_DASH)}{seg(p0, p2, GRAY_DASH)}{prices.map((price, index) => {
        const target = far(a, at({ time: p1.time, price }), 1);
        return <g key={index}><line x1={a.x} y1={a.y} x2={target.x} y2={target.y} stroke={index % 2 ? XABCD_ALT : d.color} strokeWidth={d.width} vectorEffect="non-scaling-stroke" strokeDasharray={index ? '5 4' : undefined} />
          {text(target.x - 4, target.y - 4, `${(FIB_LEVELS[index] * 100).toFixed(1)}%`, index % 2 ? XABCD_ALT : d.color, 'end')}</g>;
      })}</g>;
    }
    if (d.kind === 'fib-speed-arcs' || d.kind === 'fib-circles') {
      const dx = Math.abs(b.x - a.x), dy = Math.abs(b.y - a.y);
      return <g>{pts.length > 1 && seg(p0, p1, GRAY_DASH)}{FIB_LEVELS.map((level, index) => <ellipse key={level} cx={a.x} cy={a.y} rx={Math.max(2, dx * level)} ry={Math.max(2, dy * level)} fill="none" stroke={index % 2 ? XABCD_ALT : d.color} strokeWidth={d.width} vectorEffect="non-scaling-stroke" strokeDasharray={index ? '4 4' : undefined} />)}</g>;
    }
    if (d.kind === 'fib-spiral') return <g>{seg(p0, p1, GRAY_DASH)}<path d={spiralPath(a, Math.max(4, Math.hypot(b.x - a.x, b.y - a.y)))} fill="none" stroke={d.color} strokeWidth={d.width} vectorEffect="non-scaling-stroke" /></g>;

    // ---- 江恩家族 ----
    if (d.kind === 'gann-box' || d.kind === 'gann-square') {
      const xs = [a.x, b.x], ys = [a.y, b.y];
      const left = Math.min(...xs), right = Math.max(...xs), top = Math.min(...ys), bottom = Math.max(...ys);
      const grid = gannGrid(p0, p1, 4);
      return <g><rect x={left} y={top} width={right - left} height={bottom - top} {...stroke} fill={soft} />
        {grid.prices.map((price, index) => <line key={`p${index}`} x1={left} x2={right} y1={yOf(price)} y2={yOf(price)} stroke={d.color} strokeWidth={1} strokeDasharray="4 4" vectorEffect="non-scaling-stroke" opacity={.7} />)}
        {grid.times.map((time, index) => <line key={`t${index}`} x1={xOf(time)} x2={xOf(time)} y1={top} y2={bottom} stroke={d.color} strokeWidth={1} strokeDasharray="4 4" vectorEffect="non-scaling-stroke" opacity={.7} />)}
        <line x1={left} y1={top} x2={right} y2={bottom} stroke={XABCD_ALT} strokeWidth={d.width} vectorEffect="non-scaling-stroke" />
        <line x1={left} y1={bottom} x2={right} y2={top} stroke={XABCD_ALT} strokeWidth={d.width} vectorEffect="non-scaling-stroke" />
        {text(left + 4, top - 4, '江恩箱', d.color)}</g>;
    }
    if (d.kind === 'gann-square-fixed') {
      const side = 160, left = a.x - side / 2, top = a.y - side / 2;
      return <g><rect x={left} y={top} width={side} height={side} {...stroke} fill={soft} />
        {[1, 2, 3].map(index => <g key={index}><line x1={left + side * index / 4} x2={left + side * index / 4} y1={top} y2={top + side} stroke={d.color} strokeWidth={1} strokeDasharray="4 4" opacity={.7} vectorEffect="non-scaling-stroke" />
          <line x1={left} x2={left + side} y1={top + side * index / 4} y2={top + side * index / 4} stroke={d.color} strokeWidth={1} strokeDasharray="4 4" opacity={.7} vectorEffect="non-scaling-stroke" /></g>)}
        <line x1={left} y1={top} x2={left + side} y2={top + side} stroke={XABCD_ALT} strokeWidth={1} vectorEffect="non-scaling-stroke" />
        <line x1={left} y1={top + side} x2={left + side} y2={top} stroke={XABCD_ALT} strokeWidth={1} vectorEffect="non-scaling-stroke" /></g>;
    }
    if (d.kind === 'gann-fan') {
      const dx = b.x - a.x, dy = b.y - a.y;
      const base = Math.atan2(dy, dx);
      const rays: [string, number][] = [['1×8', 8], ['1×4', 4], ['1×3', 3], ['1×2', 2], ['1×1', 1], ['2×1', .5], ['3×1', 1 / 3], ['4×1', .25], ['8×1', .125]];
      return <g>{rays.map(([name, factor], index) => {
        const angle = base * factor;
        const end = { x: a.x + Math.cos(angle) * FULL, y: a.y + Math.sin(angle) * FULL };
        return <g key={name}><line x1={a.x} y1={a.y} x2={end.x} y2={end.y} stroke={name === '1×1' ? XABCD_ALT : d.color} strokeWidth={name === '1×1' ? d.width : 1} vectorEffect="non-scaling-stroke" strokeDasharray={name === '1×1' ? undefined : '5 4'} opacity={.9} />
          {index % 2 === 0 && text(a.x + (end.x - a.x) * .18, a.y + (end.y - a.y) * .18, name, d.color)}</g>;
      })}</g>;
    }

    // ---- 通道家族 ----
    if (d.kind === 'parallel-channel' || d.kind === 'disjoint-channel') {
      const shift = channelOffset(p0, p1, p2);
      const lower = d.kind === 'parallel-channel'
        ? [{ time: p0.time, price: p0.price + shift }, { time: p1.time, price: p1.price + shift }]
        : [{ time: p2.time, price: p2.price + shift }, { time: p3.time, price: p3.price + shift }];
      const top = pts[0], bottom = at(lower[0]);
      const rightTop = far(top, at(p1), 1), rightBottom = far(bottom, at(lower[1]), 1);
      return <g><polygon points={`${top.x},${top.y} ${rightTop.x},${rightTop.y} ${rightBottom.x},${rightBottom.y} ${bottom.x},${bottom.y}`} fill={soft} stroke="none" />
        {seg(p0, p1)}{seg(lower[0], lower[1], d.color)}{seg(p0, lower[0], GRAY_DASH)}</g>;
    }
    if (d.kind === 'flat-channel') {
      const top = Math.max(p0.price, p1.price, p2.price), bottom = Math.min(p0.price, p1.price, p2.price);
      const left = Math.min(a.x, b.x, coordinates(p2).x), right = Math.max(a.x, b.x, coordinates(p2).x);
      return <g><rect x={left} y={yOf(top)} width={Math.max(2, right - left)} height={Math.max(2, yOf(bottom) - yOf(top))} fill={soft} stroke="none" />
        <line x1={left} x2={right} y1={yOf(top)} y2={yOf(top)} stroke={d.color} strokeWidth={d.width} vectorEffect="non-scaling-stroke" />
        <line x1={left} x2={right} y1={yOf(bottom)} y2={yOf(bottom)} stroke={d.color} strokeWidth={d.width} vectorEffect="non-scaling-stroke" /></g>;
    }
    if (d.kind === 'regression-trend') {
      const channel = regressionChannel([p0, p1]);
      const ends = channel.ends;
      return <g>{[[0, 'middle'], [channel.upper, 'upper'], [-channel.lower, 'lower']].map(([offset, name], index) => {
        const from = { time: ends[0].time, price: ends[0].price + Number(offset) };
        const to = { time: ends[1].time, price: ends[1].price + Number(offset) };
        return <g key={name as string}>{seg(from, to, index === 0 ? d.color : `${d.color}aa`, index === 0 ? undefined : '5 4')}</g>;
      })}{text(xOf(ends[1].time) + 4, yOf(ends[1].price) - 4, '回归', d.color)}</g>;
    }

    // ---- 预测与测量 ----
    if (d.kind === 'long-position' || d.kind === 'short-position') {
      const entry = p0.price, target = p1.price, stop = p2.price;
      const long = d.kind === 'long-position';
      const reward = Math.abs(target - entry), risk = Math.abs(entry - stop);
      const left = Math.min(a.x, b.x), right = Math.max(a.x, b.x);
      const rewardTop = yOf(Math.max(entry, target)), rewardBottom = yOf(Math.min(entry, target));
      return <g>
        <rect x={left} y={rewardTop} width={Math.max(2, right - left)} height={Math.max(1, rewardBottom - rewardTop)} fill={`${ALERT_GREEN}22`} stroke="none" />
        <line x1={left} x2={right} y1={yOf(stop)} y2={yOf(stop)} stroke={ALERT_RED} strokeWidth={d.width} strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
        <line x1={left} x2={right} y1={yOf(target)} y2={yOf(target)} stroke={ALERT_GREEN} strokeWidth={d.width} strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
        {text(left + 4, yOf(entry) - 4, `${long ? '做多' : '做空'} 入场 ${money(entry)}`, d.color)}
        {text(right + 6, yOf(target) + 12, `目标 ${money(target)} · ${(((target - entry) / entry) * 100).toFixed(2)}%`, ALERT_GREEN)}
        {text(right + 6, yOf(stop) - 3, `止损 ${money(stop)} · ${(((stop - entry) / entry) * 100).toFixed(2)}% · R:R ${risk ? (reward / risk).toFixed(2) : '∞'}`, ALERT_RED)}
      </g>;
    }
    if (d.kind === 'forecast' || d.kind === 'projection') {
      const projected = d.kind === 'forecast' ? projectAlong(p0, p2, 1) : projectAlong(p0, p1, 1);
      return <g>{seg(p0, p2, GRAY_DASH)}{seg(p2, projected)}{text(xOf(projected.time) + 4, yOf(projected.price) - 4, `投影 ${money(projected.price)}`, d.color)}</g>;
    }
    if (d.kind === 'date-range' || d.kind === 'price-range' || d.kind === 'bars-pattern') {
      const stats = rangeStats(p0, p1, props.minutes);
      const left = Math.min(a.x, b.x), right = Math.max(a.x, b.x);
      const days = Math.floor(Math.abs(p1.time - p0.time) / 86400);
      const hours = Math.floor((Math.abs(p1.time - p0.time) % 86400) / 3600);
      const label = d.kind === 'date-range' ? `${Math.abs(stats.bars)} 根 · ${days}天${hours}小时` : d.kind === 'bars-pattern' ? `${Math.abs(stats.bars)} 根K线` : `${stats.change >= 0 ? '+' : ''}${money(stats.change)} (${stats.percent.toFixed(2)}%)`;
      return <g><rect x={left} y={Math.min(a.y, b.y)} width={Math.max(2, right - left)} height={Math.abs(b.y - a.y)} fill={soft} stroke={d.color} strokeWidth={d.width} vectorEffect="non-scaling-stroke" />
        {seg(p0, p1, GRAY_DASH)}<rect x={(left + right) / 2 - 62} y={Math.min(a.y, b.y) - 22} width={124} height={20} rx={3} fill={d.color} />{text((left + right) / 2, Math.min(a.y, b.y) - 8, label, '#ffffff', 'middle')}</g>;
    }
    if (d.kind === 'measure') {
      return <g><rect x={Math.min(a.x, b.x)} y={Math.min(a.y, b.y)} width={Math.abs(b.x - a.x)} height={Math.abs(b.y - a.y)} {...stroke} fill={soft} />
        {text(a.x, a.y - 10, `${(p1.price - p0.price).toFixed(1)} (${((p1.price / p0.price - 1) * 100).toFixed(2)}%) · ${Math.round(Math.abs(p1.time - p0.time) / (props.minutes * 60))} 根`, d.color)}</g>;
    }

    // ---- 几何图形 ----
    if (d.kind === 'rectangle') return <rect x={Math.min(a.x, b.x)} y={Math.min(a.y, b.y)} width={Math.abs(b.x - a.x)} height={Math.abs(b.y - a.y)} {...stroke} fill={soft} />;
    if (d.kind === 'rotated-rectangle') {
      const corners = rotatedRectangle(p0, p1, p2).map(at);
      return <polygon points={corners.map(c => `${c.x},${c.y}`).join(' ')} {...stroke} fill={soft} />;
    }
    if (d.kind === 'ellipse') return <ellipse cx={(a.x + b.x) / 2} cy={(a.y + b.y) / 2} rx={Math.abs(b.x - a.x) / 2} ry={Math.abs(b.y - a.y) / 2} {...stroke} fill={soft} />;
    if (d.kind === 'circle') { const radius = Math.hypot(b.x - a.x, b.y - a.y); return <circle cx={a.x} cy={a.y} r={Math.max(2, radius)} {...stroke} fill={soft} />; }
    if (d.kind === 'triangle') return <polygon points={pts.map(p => `${p.x},${p.y}`).join(' ')} {...stroke} fill={soft} />;
    if (d.kind === 'arc') {
      const circle = circleThrough(pts[0], pts[1], pts[2]);
      if (!circle) return seg(p0, p2, d.color);
      return <path d={arcPath(circle.center, circle.radius, pts[0], pts[2], true)} {...stroke} />;
    }
    if (d.kind === 'curve') return <path d={quadraticPath(pts[0], pts[1], pts[2])} {...stroke} />;
    if (d.kind === 'double-curve') return <g><path d={quadraticPath(pts[0], pts[1], pts[2])} {...stroke} /><path d={quadraticPath(pts[2], pts[3], pts[0])} {...stroke} /></g>;

    // ---- 注释类 ----
    if (d.kind === 'callout') {
      const lines = (d.text ?? '').split('\n');
      const width = Math.max(60, ...lines.map(line => line.length * 13 + 16));
      return <g><rect x={a.x} y={a.y - lines.length * 18 - 10} width={width} height={lines.length * 18 + 10} rx={5} fill="#ffffff" stroke={d.color} strokeWidth={d.width} vectorEffect="non-scaling-stroke" />
        {lines.map((line, index) => text(a.x + 8, a.y - lines.length * 18 + index * 18 + 2, line, d.color))}
        <line x1={a.x + 12} y1={a.y} x2={b.x} y2={b.y} stroke={d.color} strokeWidth={d.width} vectorEffect="non-scaling-stroke" /><circle cx={b.x} cy={b.y} r={2.5} fill={d.color} /></g>;
    }
    if (d.kind === 'comment') return <g><circle cx={a.x} cy={a.y} r={4} fill={d.color} /><rect x={a.x + 8} y={a.y - 16} width={Math.max(48, (d.text ?? '').length * 13)} height={18} rx={3} fill="#ffffff" stroke={d.color} strokeWidth={1} vectorEffect="non-scaling-stroke" />{text(a.x + 13, a.y - 3, d.text ?? '', d.color)}</g>;
    if (d.kind === 'price-note') {
      const width = Math.max(78, (d.text ?? '').length * 13 + 10);
      return <g><rect x={a.x} y={a.y - 11} width={width} height={22} rx={3} fill={d.color} />{text(a.x + 6, a.y + 4, `${d.text ?? ''} ${money(p0.price)}`, '#ffffff')}</g>;
    }
    if (d.kind === 'signpost') return <g><line x1={b.x} y1={b.y} x2={a.x} y2={a.y} stroke={d.color} strokeWidth={d.width} vectorEffect="non-scaling-stroke" /><rect x={b.x} y={b.y - 18} width={Math.max(64, (d.text ?? '').length * 13 + 12)} height={18} rx={2} fill={d.color} opacity={.92} />{text(b.x + 6, b.y - 5, d.text ?? '', '#ffffff')}</g>;
    if (d.kind === 'table') {
      const rows = (d.text ?? '').split('\n').map(row => row.split('|').map(cell => cell.trim()));
      const columns = Math.max(1, ...rows.map(row => row.length));
      return <g><rect x={a.x} y={a.y} width={columns * 92 + 12} height={rows.length * 20 + 10} rx={4} fill="#ffffff" stroke={d.color} strokeWidth={d.width} vectorEffect="non-scaling-stroke" />
        {rows.map((row, r) => <g key={r}>{row.map((cell, c) => text(a.x + 8 + c * 92, a.y + 16 + r * 20, cell, r === 0 ? d.color : GRAY_TEXT))}{r < rows.length - 1 && <line x1={a.x} x2={a.x + columns * 92 + 12} y1={a.y + 8 + (r + 1) * 20} y2={a.y + 8 + (r + 1) * 20} stroke="#e6e8ee" strokeWidth={1} />}</g>)}</g>;
    }
    if (d.kind === 'text-annotation') {
      const lines = d.text?.split('\n') ?? [''];
      return <text x={a.x} y={a.y} fill={d.color} fontSize={14} fontFamily="Arial, Microsoft YaHei, sans-serif">{lines.map((line, i) => <tspan key={i} x={a.x} dy={i === 0 ? 0 : 20}>{line || ' '}</tspan>)}</text>;
    }

    // ---- 图标 / 画笔 ----
    if (d.kind === 'icon-mark' || d.kind === 'arrow-marker') return <g transform={`translate(${a.x},${a.y})`} style={{ color: d.color }}>{iconMarkPath(d.kind === 'arrow-marker' ? ((d.text ?? '').startsWith('arrow') ? d.text! : 'arrow-up') : (d.text ?? 'flag'))}</g>;
    if (d.kind === 'brush' || d.kind === 'highlighter') {
      const width = d.kind === 'highlighter' ? d.width * 5 : d.width;
      return <polyline points={d.points.map(p => { const c = coordinates(p); return `${c.x},${c.y}`; }).join(' ')} stroke={d.color} strokeWidth={hit ? 16 : width} fill="none" strokeLinejoin="round" strokeLinecap="round" opacity={d.kind === 'highlighter' ? .35 : 1} vectorEffect="non-scaling-stroke" />;
    }

    // ---- 线条与通道的其余变体 ----
    if (d.kind === 'horizontal-line') return <line x1={0} x2={size.width} y1={a.y} y2={a.y} {...stroke} />;
    if (d.kind === 'horizontal-ray') { const to = far(a, b, 1); return <line x1={a.x} y1={a.y} x2={to.x} y2={a.y} {...stroke} />; }
    if (d.kind === 'vertical-line') return <line x1={a.x} x2={a.x} y1={0} y2={size.height} {...stroke} />;
    if (d.kind === 'cross-line') return <g><line x1={a.x} x2={a.x} y1={0} y2={size.height} {...stroke} /><line x1={0} x2={size.width} y1={a.y} y2={a.y} {...stroke} /></g>;
    if (d.kind === 'extended-line') { const from = far(a, b, -1), to = far(a, b, 1); return <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} {...stroke} />; }
    if (d.kind === 'ray') { const to = far(a, b, 1); return <line x1={a.x} y1={a.y} x2={to.x} y2={to.y} {...stroke} />; }
    if (d.kind === 'arrow') {
      const angle = Math.atan2(b.y - a.y, b.x - a.x), head = 12;
      return <g><line x1={a.x} y1={a.y} x2={b.x} y2={b.y} {...stroke} /><polygon points={`${b.x},${b.y} ${b.x - head * Math.cos(angle - .4)},${b.y - head * Math.sin(angle - .4)} ${b.x - head * Math.cos(angle + .4)},${b.y - head * Math.sin(angle + .4)}`} fill={d.color} /></g>;
    }
    if (d.kind === 'polyline') return <polyline points={d.points.map(p => { const c = coordinates(p); return `${c.x},${c.y}`; }).join(' ')} {...stroke} strokeLinejoin="round" />;
    if (d.kind === 'info-line') {
      const stats = rangeStats(p0, p1, props.minutes);
      return <g>{seg(p0, p1)}{text(Math.max(a.x, b.x) + 6, Math.max(a.y, b.y) - 6, `${stats.change >= 0 ? '+' : ''}${money(stats.change)} (${stats.percent.toFixed(2)}%) · ${Math.abs(stats.bars)} 根`, stats.change >= 0 ? ALERT_GREEN : ALERT_RED)}</g>;
    }
    if (d.kind === 'trend-angle') {
      const angle = Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
      return <g>{seg(p0, p1)}{text(b.x + 6, b.y - 6, `${angle.toFixed(1)}°`, d.color)}</g>;
    }
    // 默认：线段
    return <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} {...stroke} />;
  }

  const shown = props.drawings.map(d => draft?.id === d.id ? draft : d);
  if (draft && !shown.some(d => d.id === draft.id)) shown.push(draft);
  const editingAt = editor ? coordinates(editor.point) : null;
  const active = props.tool !== 'cursor' || props.choosing;
  const anchorsOf = (d: Drawing) => d.kind === 'brush' ? [d.points[0], d.points[d.points.length - 1]] : d.points;
  return <div className="chart-stack" data-testid="chart" data-visible-bars={props.bars.length} data-last-time={props.bars.at(-1)?.time} data-drawings={props.drawings.length} data-marks={props.marks.length} data-tool={props.tool} data-selected={props.selected ?? ''} data-choosing={props.choosing} data-chart-type={props.chartType} data-price-points={synced.pricePoints} data-plot-points={synced.plotPoints} data-sync-mode={synced.mode} data-dark={props.dark} data-theme-epoch={themeEpoch} data-chart-bg={themeState.bg} data-series-key={seriesState.key} data-series-points={seriesState.points} data-series-last-close={seriesState.lastClose} data-series-last-time={seriesState.lastTime} data-alerts={(props.alerts ?? []).length} onPointerDownCapture={e => { if (e.target instanceof HTMLCanvasElement) props.onSelect(null); }}>
    <div ref={host} className="chart-canvas" aria-label={`K线图 ${props.minutes}分钟`} />
    {paneTops.slice(1).map((top, index) => <div key={index} className="pane-splitter" data-testid="pane-splitter" style={{ top: top - 3 }} title="拖动调整副图高度（双击右侧 ⇕ 可循环预设）" onPointerDown={event => startPaneDrag(event, index + 1)} onPointerMove={movePaneDrag} onPointerUp={endPaneDrag} onPointerCancel={endPaneDrag} />)}
    <div className="chart-legends" data-testid="chart-legends" data-pane-tops={paneTops.join(',')}>
      {/* 所有指标图例集中在左上角一块（主图在前、副图随后），行距紧凑，不再跟着各自面板散开 */}
      <div className="chart-legend-block" data-testid="chart-legend-block">
        {[...props.legends]
          .sort((a, b) => (a.pane === 'main' ? 0 : 1) - (b.pane === 'main' ? 0 : 1))
          .map(legend => <div key={legend.paneKey} className={`chart-legend ${legend.pane === 'sub' ? 'sub' : 'main'} ${legend.visible === false ? 'off' : ''}`} data-testid="chart-legend" data-pane-key={legend.paneKey} data-pane={legend.pane} data-visible={legend.visible !== false} data-pane-height={legend.heightFactor ?? 140}>
            <i style={{ background: legend.color ?? '#787b86' }} />
            <b>{legend.title}</b>
            {legend.plots.map(plot => <span key={plot.id} style={{ color: plot.color }}>{plot.title} {plot.text}</span>)}
            <span className="legend-actions">
              {legend.pane === 'sub' && legend.onHeight && <button aria-label={`副图高度 ${legend.paneKey}`} title="切换副图高度" onClick={() => legend.onHeight?.()}>⇕</button>}
              {legend.onToggle && <button aria-label={`显示或隐藏 ${legend.paneKey}`} aria-pressed={legend.visible !== false} title="显示／隐藏" onClick={() => legend.onToggle?.()}>{legend.visible === false ? '○' : '●'}</button>}
              {legend.onAlerts && <button className={legend.alertsOn ? 'on' : ''} aria-label={`预警 ${legend.paneKey}`} aria-pressed={legend.alertsOn === true} title={`指标预警${legend.alertCount ? `（已触发 ${legend.alertCount} 次）` : ''}`} onClick={() => legend.onAlerts?.()}>🔔{legend.alertCount ? <em>{legend.alertCount}</em> : null}</button>}
              {legend.onEdit && <button aria-label={`设置 ${legend.paneKey}`} title="指标参数" onClick={() => legend.onEdit?.()}>⚙</button>}
              {legend.onRemove && <button aria-label={`移除 ${legend.paneKey}`} title="移除指标" onClick={() => legend.onRemove?.()}>✕</button>}
            </span>
          </div>)}
      </div>
    </div>
    <svg ref={stage} className="drawing-layer" width={size.width} height={size.height} style={{ pointerEvents: active ? 'all' : 'none', cursor: active ? 'crosshair' : undefined }} data-testid="drawing-layer" data-preview-interval-ms={DRAWING_PREVIEW_INTERVAL_MS} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => { pending.current = []; gesture.current = null; setDraft(null); }}>
      {!props.hidden && shown.map(d => <g key={d.id} data-drawing-id={d.id} data-kind={d.kind} data-points={JSON.stringify(d.points)} data-selected={props.selected === d.id}>
        <g pointerEvents="none">{shape(d)}</g>
        <g className="drawing-hit" style={{ pointerEvents: !active && !props.locked ? 'all' : 'none', cursor: props.locked ? 'default' : 'move' }} onPointerDown={e => beginMove(e, d)} onDoubleClick={e => { if (d.kind === 'text-annotation' && !props.locked) { e.stopPropagation(); setEditor({ point: d.points[0], text: d.text ?? '', id: d.id }); } }}>{shape(d, true)}</g>
        {d.kind === 'measure' && d.points.length > 1 && <text x={coordinates(d.points[0]).x} y={coordinates(d.points[0]).y - 10} fill={d.color} fontSize={12} pointerEvents="none">{(d.points[1].price - d.points[0].price).toFixed(1)} ({((d.points[1].price / d.points[0].price - 1) * 100).toFixed(2)}%) · {Math.round(Math.abs(d.points[1].time - d.points[0].time) / (props.minutes * 60))} 根</text>}
        {props.selected === d.id && !props.locked && !active && anchorsOf(d).map((point, index) => { const c = coordinates(point); return <circle key={index} className="drawing-anchor" data-anchor={index} cx={c.x} cy={c.y} r={4} fill={props.dark ? '#1e222d' : 'white'} stroke={d.color} strokeWidth={1.5} style={{ pointerEvents: 'all', cursor: 'crosshair' }} onPointerDown={e => beginMove(e, d, d.kind === 'brush' ? undefined : index)} />; })}
      </g>)}
      {props.choosing && hover && <g pointerEvents="none"><rect x={hover.x} y={0} width={Math.max(0, size.width - hover.x)} height={size.height} fill="#2962ff0b"/><line x1={hover.x} x2={hover.x} y1={0} y2={size.height} stroke="#2962ff" strokeWidth={2}/><rect x={Math.max(0, Math.min(size.width - 160, hover.x - 80))} y={size.height - 25} width={160} height={25} rx={3} fill="#2962ff"/><text x={Math.max(80, Math.min(size.width - 80, hover.x))} y={size.height - 8} fill="white" textAnchor="middle" fontSize={12}>{chartTime(hover.time, true)}</text></g>}
    </svg>
    {editor && editingAt && <div className="inline-text-editor" style={{ left: Math.max(4, Math.min(size.width - 240, editingAt.x)), top: Math.max(4, Math.min(size.height - 125, editingAt.y - 18)) }}>
      <textarea autoFocus aria-label="图表文字" value={editor.text} onChange={e => { const next = { ...editor, text: e.target.value }; editorRef.current = next; setEditor(next); }} onKeyDown={e => { e.stopPropagation(); if (!e.nativeEvent.isComposing && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); commitText(); } if (e.key === 'Escape') { editorRef.current = null; setEditor(null); } }} />
      <div><small>支持换行 · Ctrl+Enter 完成</small><button onClick={commitText}>完成</button><button onClick={() => { editorRef.current = null; setEditor(null); }}>取消</button></div>
    </div>}
  </div>;
});
