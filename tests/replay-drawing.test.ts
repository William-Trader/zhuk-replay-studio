import { describe, it, expect } from 'vitest';
import { aggregate, chartTime, cursorForTime, dateInput, ema20, HISTORY, INITIAL_CURSOR, logicalToTime, MIN_CURSOR, parseDateInput, PERIODS, stepCursor, timeToLogical } from '../src/market';
import { commit, emptyHistory, FIB_LEVELS, ICON_MARKS, isMarkKind, isTextKind, moveDrawing, PATTERN_LABELS, redo, REQUIRED_POINTS, requiredPoints, TEXT_KINDS, TOOL_GROUPS, TOOL_NAMES, undo, validDrawing, XABCD_LABELS, type Drawing, type DrawingKind, type Tool } from '../src/drawing';

describe('actual offline history and replay', () => {
  it('uses a contiguous minute history with valid OHLC', () => {
    expect(HISTORY.length).toBe(6944);
    HISTORY.forEach((b, i) => {
      expect(Object.values(b).every(Number.isFinite)).toBe(true);
      expect(b.low).toBeLessThanOrEqual(Math.min(b.open, b.close)); expect(b.high).toBeGreaterThanOrEqual(Math.max(b.open, b.close));
      if (i) expect(b.time - HISTORY[i - 1].time).toBe(60);
    });
  });
  it('loads the initial historical candle', () => {
    const b = aggregate(HISTORY.slice(0, INITIAL_CURSOR), 15).at(-1)!;
    expect(b).toMatchObject({ time: 1788880500, open: 78608.4, high: 78679.8, low: 78419, close: 78420.2 });
    expect(chartTime(HISTORY[INITIAL_CURSOR - 1].time, true)).toBe('2026-09-08 23:29');
  });
  it.each(PERIODS.map(p => p.minutes))('aggregates %s minutes from only revealed data', m => {
    const prefix = HISTORY.slice(0, INITIAL_CURSOR - 7), result = aggregate(prefix, m);
    const last = result.at(-1)!, group = prefix.filter(b => Math.floor(b.time / (m * 60)) * m * 60 === last.time);
    expect(last.open).toBe(group[0].open); expect(last.close).toBe(group.at(-1)!.close);
    expect(last.high).toBe(Math.max(...group.map(b => b.high))); expect(last.low).toBe(Math.min(...group.map(b => b.low)));
    expect(result.every((b, i) => !i || b.time > result[i - 1].time)).toBe(true);
    expect(ema20(result)).toHaveLength(result.length);
  });
  it('never mutates the minute data during aggregation', () => { const before = JSON.stringify(HISTORY.slice(0, 100)); aggregate(HISTORY.slice(0, 100), 15); expect(JSON.stringify(HISTORY.slice(0, 100))).toBe(before); });
  it.each(PERIODS.map(p => p.minutes))('steps forward and backward one %s-minute bucket', m => {
    const next = stepCursor(INITIAL_CURSOR, m, 1), previous = stepCursor(INITIAL_CURSOR, m, -1);
    const bucket = (index: number) => Math.floor(HISTORY[index - 1].time / (m * 60));
    expect(bucket(next)).toBe(bucket(INITIAL_CURSOR) + 1); expect(bucket(previous)).toBe(bucket(INITIAL_CURSOR) - 1);
  });
  it.each(PERIODS.map(p => p.minutes))('clamps %s-minute replay at both ends', m => { expect(stepCursor(MIN_CURSOR, m, -1)).toBe(MIN_CURSOR); expect(stepCursor(HISTORY.length, m, 1)).toBe(HISTORY.length); });
  it('date input preserves UTC+8 independently of host timezone', () => { const value = '2026-09-08T23:29'; expect(dateInput(parseDateInput(value))).toBe(value); expect(cursorForTime(parseDateInput(value))).toBe(INITIAL_CURSOR); });
  it('accepts datetime values that already carry seconds', () => {
    expect(parseDateInput('2026-09-08T23:29:00')).toBe(parseDateInput('2026-09-08T23:29'));
    expect(parseDateInput('2026-09-08T23:29:30')).toBe(parseDateInput('2026-09-08T23:29') + 30);
    expect(Number.isFinite(parseDateInput(''))).toBe(false);
    expect(Number.isFinite(parseDateInput('乱码'))).toBe(false);
  });
  it('clamps invalid and out-of-range dates', () => { expect(cursorForTime(NaN)).toBe(MIN_CURSOR); expect(cursorForTime(0)).toBe(MIN_CURSOR); expect(cursorForTime(1e12)).toBe(HISTORY.length); });
  it('only computes revealed EMA points', () => { const a = aggregate(HISTORY, 15); expect(ema20(a.slice(0, 60))).toEqual(ema20(a).slice(0, 60)); expect(ema20([])).toEqual([]); });
});

const drawing = (kind: DrawingKind = 'trend-line'): Drawing => ({
  id: 'one', kind, width: 2, color: '#2962ff',
  points: Array.from({ length: Math.max(2, requiredPoints(kind)) }, (_, index) => ({ time: 100 + index * 100, price: 100 + index * 10 })),
  text: isTextKind(kind) ? 'note' : isMarkKind(kind) ? 'flag' : undefined,
});
describe('usable drawing model and projection', () => {
  it.each(Object.keys(REQUIRED_POINTS) as DrawingKind[])('supports %s geometry', kind => { expect(validDrawing(drawing(kind))).toBe(true); });
  it('rejects invalid values and empty text', () => { expect(validDrawing({ ...drawing(), points: [{ time: NaN, price: 2 }] })).toBe(false); expect(validDrawing({ ...drawing('text-annotation'), text: '  ' })).toBe(false); expect(validDrawing({ ...drawing(), width: 0 })).toBe(false); });
  it('moves entire shapes without mutating original', () => { const d = drawing(); const moved = moveDrawing(d, 50, 10); expect(moved.points).toEqual([{ time: 150, price: 110 }, { time: 250, price: 120 }]); expect(d.points[0].time).toBe(100); });
  it('edits an individual anchor', () => { expect(moveDrawing(drawing(), 50, 10, 1).points).toEqual([{ time: 100, price: 100 }, { time: 250, price: 120 }]); });
  it('rejects movement into nonpositive or invalid prices', () => { const d = drawing(); expect(moveDrawing(d, 10, -120)).toBe(d); expect(moveDrawing(d, Infinity, 0)).toBe(d); });
  it.each([-50,-1,0,.5,30.3,221,250,500])('roundtrips logical %s including empty future area', x => { const bars = aggregate(HISTORY.slice(0, INITIAL_CURSOR), 15); expect(timeToLogical(logicalToTime(x, bars, 900), bars, 900)).toBeCloseTo(x, 7); });
  it('preserves timestamp anchors across timeframe switches', () => { const time = HISTORY[INITIAL_CURSOR - 1].time + 900 * 20; for (const { minutes } of PERIODS) { const bars = aggregate(HISTORY.slice(0, INITIAL_CURSOR), minutes); expect(logicalToTime(timeToLogical(time, bars, minutes * 60), bars, minutes * 60)).toBeCloseTo(time); } });
  it('undoes and redoes create, edit and delete', () => { const a = commit(emptyHistory(), [drawing()]); const b = commit(a, [moveDrawing(drawing(), 30, 10)]); const c = commit(b, []); expect(undo(c).present).toEqual(b.present); expect(undo(undo(c)).present).toEqual(a.present); expect(redo(undo(c)).present).toEqual([]); });
  it('clears redo on a new branch and limits history to 30 steps', () => { let h = emptyHistory(); for (let i = 0; i < 50; i++) h = commit(h, [{ ...drawing(), id: String(i) }]); expect(h.past).toHaveLength(30); expect(commit(undo(h), []).future).toHaveLength(0); });
  it('does not add a history entry for a selection-only click', () => { const h = commit(emptyHistory(), [drawing()]); expect(commit(h, [drawing()])).toBe(h); expect(undo(emptyHistory())).toEqual(emptyHistory()); expect(redo(emptyHistory())).toEqual(emptyHistory()); });
});

describe('extended drawing tools', () => {
  it.each([
    ['trend-line', 2], ['horizontal-line', 1], ['vertical-line', 1], ['ray', 2], ['rectangle', 2], ['ellipse', 2],
    ['brush', 2], ['text-annotation', 1], ['measure', 2], ['fib-retracement', 2], ['xabcd-pattern', 5], ['icon-mark', 1],
  ] as [DrawingKind, number][])('needs %s clicks: %s', (kind, count) => { expect(requiredPoints(kind)).toBe(count); });
  it('names every tool including the new ones', () => {
    const tools: Tool[] = ['cursor', 'fib-retracement', 'xabcd-pattern', 'icon-mark'];
    for (const tool of tools) expect(TOOL_NAMES[tool]).toBeTruthy();
    expect(TOOL_NAMES['fib-retracement']).toBe('斐波那契回撤');
  });
  it('draws the seven documented fibonacci levels between the anchors', () => {
    expect([...FIB_LEVELS]).toEqual([0, 0.236, 0.382, 0.5, 0.618, 0.786, 1]);
    expect(validDrawing(drawing('fib-retracement'))).toBe(true);
  });
  it('labels the five xabcd vertices', () => { expect([...XABCD_LABELS]).toEqual(['X', 'A', 'B', 'C', 'D']); });
  it('rejects an xabcd pattern with fewer than five points', () => {
    expect(validDrawing({ ...drawing('xabcd-pattern'), points: drawing('xabcd-pattern').points.slice(0, 4) })).toBe(false);
    expect(validDrawing({ ...drawing('xabcd-pattern'), points: drawing('xabcd-pattern').points.slice(0, 5) })).toBe(true);
  });
  it('accepts the four icon marks and rejects unknown icons', () => {
    expect(ICON_MARKS.length).toBeGreaterThanOrEqual(25);
    expect([...ICON_MARKS].slice(0, 4)).toEqual(['flag', 'star', 'up', 'down']);
    for (const mark of ICON_MARKS) expect(validDrawing({ ...drawing('icon-mark'), text: mark })).toBe(true);
    expect(validDrawing({ ...drawing('icon-mark'), text: 'rocket' })).toBe(false);
    expect(validDrawing({ ...drawing('icon-mark'), text: undefined })).toBe(false);
  });
  it('moves and edits the new shapes like any other drawing', () => {
    const pattern = moveDrawing(drawing('xabcd-pattern'), 10, 5);
    expect(pattern.points).toHaveLength(5);
    expect(pattern.points[4]).toEqual({ time: 510, price: 145 });
    expect(moveDrawing(drawing('icon-mark'), 0, -500)).toEqual(drawing('icon-mark'));
  });
});

describe('full TradingView-style tool set', () => {
  it('covers nine groups with every declared tool placed in exactly one group', () => {
    expect(TOOL_GROUPS).toHaveLength(9);
    const placed = TOOL_GROUPS.flatMap(group => group.tools);
    expect(new Set(placed).size).toBe(placed.length);
    for (const kind of Object.keys(REQUIRED_POINTS) as DrawingKind[]) expect(placed).toContain(kind);
    for (const group of TOOL_GROUPS) { expect(group.label.length).toBeGreaterThan(0); expect(group.tools.length).toBeGreaterThan(0); }
  });
  it('has a Chinese name for every tool and positive click counts', () => {
    for (const kind of Object.keys(REQUIRED_POINTS) as DrawingKind[]) {
      expect(TOOL_NAMES[kind as Tool]).toBeTruthy();
      expect(requiredPoints(kind)).toBeGreaterThanOrEqual(1);
      expect(requiredPoints(kind)).toBeLessThanOrEqual(7);
    }
  });
  it('requires text only for the annotation tools and marks only for the mark tools', () => {
    for (const kind of Object.keys(REQUIRED_POINTS) as DrawingKind[]) {
      const base = drawing(kind);
      if (isTextKind(kind)) expect(validDrawing({ ...base, text: undefined })).toBe(false);
      else if (!isMarkKind(kind)) expect(validDrawing(base)).toBe(true);
    }
    expect(isTextKind('callout')).toBe(true);
    expect(isTextKind('trend-line')).toBe(false);
    expect(isMarkKind('arrow-marker')).toBe(true);
  });
  it('labels every multi-point pattern tool', () => {
    for (const [kind, labels] of Object.entries(PATTERN_LABELS)) {
      expect(labels.length).toBe(requiredPoints(kind as DrawingKind));
    }
    expect(PATTERN_LABELS['elliott-impulse']).toEqual(['0', '1', '2', '3', '4', '5']);
  });
  it('keeps every tool kind distinct', () => {
    const kinds = Object.keys(REQUIRED_POINTS);
    expect(kinds.length).toBeGreaterThanOrEqual(60);
    expect(new Set(kinds).size).toBe(kinds.length);
    expect(FIB_LEVELS).toContain(.618);
  });
});
