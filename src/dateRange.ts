/*!
 * src/dateRange.ts - zhuk-replay-studio key core logic
 * (c) 2026 William-Trader (https://github.com/William-Trader)
 * WM: ZRS-5364D3D5
 * SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
 * Removing this mark violates the license.
 */
/** 日期区间选择：UTC+8 墙钟日历与区间预设（纯函数，无 DOM）。
 *  应用固定用 UTC+8（与 chartTime / dateInput 一致），不依赖宿主时区。 */

export const ZONE_OFFSET = 8 * 3600;
const DAY = 86400;
const pad = (value: number) => String(value).padStart(2, '0');

/** 某时间戳所在"UTC+8 天"的序号。 */
export const dayIndex = (time: number): number => Math.floor((time + ZONE_OFFSET) / DAY);
/** 天序号 → 当天 00:00（UTC+8）对应的时间戳。 */
export const dayStart = (index: number): number => index * DAY - ZONE_OFFSET;
/** 某时间戳所在天的 00:00 / 23:59:59。 */
export const startOfDay = (time: number): number => dayStart(dayIndex(time));
export const endOfDay = (time: number): number => startOfDay(time) + DAY - 1;
export const addDays = (time: number, days: number): number => time + days * DAY;

/** UTC+8 墙钟的年月日（用于日历表头）。 */
export function wallParts(time: number): { year: number; month: number; day: number; hour: number; minute: number } {
  const date = new Date((time + ZONE_OFFSET) * 1000);
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate(), hour: date.getUTCHours(), minute: date.getUTCMinutes() };
}
export const formatDay = (time: number): string => { const { year, month, day } = wallParts(time); return `${year}-${pad(month)}-${pad(day)}`; };
export const formatDateTime = (time: number): string => { const { year, month, day, hour, minute } = wallParts(time); return `${year}-${pad(month)}-${pad(day)} ${pad(hour)}:${pad(minute)}`; };
export const formatTime = (time: number): string => { const { hour, minute } = wallParts(time); return `${pad(hour)}:${pad(minute)}`; };

/** 由"UTC+8 的年月日 + 时分"拼回时间戳。 */
export function withTime(time: number, hour: number, minute: number): number {
  const { year, month, day } = wallParts(time);
  return Date.UTC(year, month - 1, day, hour, minute, 0) / 1000 - ZONE_OFFSET;
}
/** 取某天的某个月里的日历矩阵（6×7），每格是天序号。 */
export function monthMatrix(year: number, month: number): number[][] {
  const first = Date.UTC(year, month - 1, 1) / 1000;      // 该月 1 号（当作 UTC 墙钟）
  const firstIndex = Math.floor(first / DAY);
  const weekDay = (new Date(Date.UTC(year, month - 1, 1)).getUTCDay() + 6) % 7; // 周一为一周之首
  const weeks: number[][] = [];
  for (let week = 0; week < 6; week++) {
    const row: number[] = [];
    for (let day = 0; day < 7; day++) row.push(firstIndex - weekDay + week * 7 + day);
    weeks.push(row);
  }
  return weeks;
}
/** 天序号 → 该天的年月日（用于日历标记"是否本月"）。 */
export const partsOfIndex = (index: number) => wallParts(dayStart(index) + 3600);
export const sameMonth = (index: number, year: number, month: number): boolean => { const parts = partsOfIndex(index); return parts.year === year && parts.month === month; };
export const isWeekend = (index: number): boolean => { const weekDay = new Date(dayStart(index) * 1000 + ZONE_OFFSET * 1000).getUTCDay(); return weekDay === 0 || weekDay === 6; };

/** 区间预设：快捷时间段（按数据窗口裁剪）。 */
export interface RangePreset { id: string; label: string; from: number | null; to: number | null }
export function rangePresets(dataStart: number, dataEnd: number, barSeconds: number): RangePreset[] {
  const now = dataEnd;
  const fixed: RangePreset[] = [
    { id: 'today', label: '今天', from: Math.max(dataStart, startOfDay(now)), to: now },
    { id: '3d', label: '近 3 天', from: Math.max(dataStart, now - 3 * DAY), to: now },
    { id: '7d', label: '近 7 天', from: Math.max(dataStart, now - 7 * DAY), to: now },
    { id: '30d', label: '近 30 天', from: Math.max(dataStart, now - 30 * DAY), to: now },
  ];
  const bars = (count: number): RangePreset => ({ id: `bars${count}`, label: `近 ${count} 根`, from: Math.max(dataStart, dataEnd - count * barSeconds), to: dataEnd });
  return [...fixed, bars(100), bars(500), { id: 'all', label: '全部数据', from: null, to: null }];
}
/** 把区间夹到数据窗口内；开始晚于结束则判定无效。 */
export function clampRange(from: number, to: number, dataStart: number, dataEnd: number): { from: number; to: number; valid: boolean } {
  const clampedFrom = Math.min(Math.max(from, dataStart), dataEnd);
  const clampedTo = Math.min(Math.max(to, dataStart), dataEnd);
  return { from: clampedFrom, to: clampedTo, valid: clampedFrom < clampedTo };
}
