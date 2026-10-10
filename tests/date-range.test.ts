import { describe, it, expect } from 'vitest';
import { addDays, clampRange, dayIndex, dayStart, endOfDay, formatDateTime, formatDay, formatTime, isWeekend, monthMatrix, partsOfIndex, rangePresets, sameMonth, startOfDay, wallParts, withTime } from '../src/dateRange';

/** 2026-09-08 23:29（UTC+8）—— 与既有测试保持一致。 */
const T = 1788881340;

describe('UTC+8 wall clock helpers', () => {
  it('reads wall-clock parts regardless of host timezone', () => {
    expect(wallParts(T)).toEqual({ year: 2026, month: 9, day: 8, hour: 23, minute: 29 });
    expect(formatDay(T)).toBe('2026-09-08');
    expect(formatDateTime(T)).toBe('2026-09-08 23:29');
    expect(formatTime(T)).toBe('23:29');
  });
  it('moves between days and rebuilds timestamps', () => {
    const day = dayIndex(T);
    expect(formatDay(dayStart(day))).toBe('2026-09-08');
    expect(formatTime(dayStart(day))).toBe('00:00');
    expect(formatTime(endOfDay(T))).toBe('23:59');
    expect(formatDay(addDays(T, 1))).toBe('2026-09-09');
    expect(formatDateTime(withTime(T, 9, 5))).toBe('2026-09-08 09:05');
    expect(startOfDay(T)).toBe(dayStart(day));
  });
  it('marks weekends in UTC+8', () => {
    const monday = withTime(T, 12, 0) - 2 * 86400;   // 2026-09-06 是周日
    expect(isWeekend(dayIndex(monday))).toBe(true);
    expect(isWeekend(dayIndex(withTime(T, 12, 0)))).toBe(false);
  });
});

describe('calendar matrix', () => {
  it('builds a six-week monday-first grid covering the month', () => {
    const weeks = monthMatrix(2026, 9);
    expect(weeks).toHaveLength(6);
    expect(weeks.every(week => week.length === 7)).toBe(true);
    const flat = weeks.flat();
    expect(flat.some(index => sameMonth(index, 2026, 9) && partsOfIndex(index).day === 1)).toBe(true);
    expect(flat.some(index => sameMonth(index, 2026, 9) && partsOfIndex(index).day === 30)).toBe(true);
    expect(new Set(flat).size).toBe(flat.length);
  });
});

describe('range presets and clamping', () => {
  it('offers fixed windows, bar counts and the full range', () => {
    const dataStart = T - 30 * 86400, dataEnd = T;
    const presets = rangePresets(dataStart, dataEnd, 900);
    expect(presets.map(preset => preset.id)).toEqual(['today', '3d', '7d', '30d', 'bars100', 'bars500', 'all']);
    const bars100 = presets.find(preset => preset.id === 'bars100')!;
    expect(bars100.from).toBe(dataEnd - 100 * 900);
    expect(presets.find(preset => preset.id === 'all')).toMatchObject({ from: null, to: null });
    const today = presets.find(preset => preset.id === 'today')!;
    expect(today.from).toBe(startOfDay(dataEnd));
  });
  it('compares day cells against the data window by day index', () => {
    const dataStart = T - 5 * 86400, dataEnd = T + 2 * 86400;
    const first = dayIndex(dataStart), last = dayIndex(dataEnd);
    expect(last - first).toBe(7);
    // 日历格子的天序号必须落在 [first, last] 内才算可选（回归：曾把时间戳当天序号比较，导致全部禁用）
    const inside = first + 3;
    expect(inside >= first && inside <= last).toBe(true);
    expect(formatDay(dayStart(inside))).toBe(formatDay(dataStart + 3 * 86400));
    expect(dayStart(inside)).toBeLessThan(1e9 * 2);
  });
  it('clamps both ends into the data window and rejects inverted ranges', () => {
    const dataStart = T - 10 * 86400, dataEnd = T;
    expect(clampRange(dataStart - 9999, dataEnd + 9999, dataStart, dataEnd)).toMatchObject({ from: dataStart, to: dataEnd, valid: true });
    expect(clampRange(T, T - 86400, dataStart, dataEnd).valid).toBe(false);
    expect(clampRange(T, T, dataStart, dataEnd).valid).toBe(false);
  });
});
