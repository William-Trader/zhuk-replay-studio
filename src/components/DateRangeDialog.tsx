/*!
 * src/components/DateRangeDialog.tsx - zhuk-replay-studio key core logic
 * (c) 2026 William-Trader (https://github.com/William-Trader)
 * WM: ZRS-0730FF69
 * SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
 * Removing this mark violates the license.
 */
import { useMemo, useState } from 'react';
import { Icon } from './Icon';
import {
  clampRange, dayIndex, dayStart, formatDateTime, formatDay, formatTime, isWeekend, monthMatrix, partsOfIndex, rangePresets, sameMonth, wallParts, withTime,
} from '../dateRange';

interface Props {
  /** 当前区间（秒；null = 不限制）。 */
  from: number | null; to: number | null;
  /** 数据窗口（秒），用于裁剪与日历上下限。 */
  dataStart: number; dataEnd: number; barSeconds: number;
  onApply: (from: number | null, to: number | null) => void;
  onClose: () => void;
}
type Editing = 'from' | 'to';
const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];

/** 回放区间选择器：自建日历（不依赖原生 datetime 弹窗，避免被下边栏裁掉），支持起止时间与快捷区间。 */
export function DateRangeDialog({ from, to, dataStart, dataEnd, barSeconds, onApply, onClose }: Props) {
  const [draftFrom, setDraftFrom] = useState<number>(from ?? dataStart);
  const [draftTo, setDraftTo] = useState<number>(to ?? dataEnd);
  const [editing, setEditing] = useState<Editing>('from');
  const [cursorMonth, setCursorMonth] = useState(() => { const { year, month } = wallParts(from ?? dataStart); return { year, month }; });
  const presets = useMemo(() => rangePresets(dataStart, dataEnd, barSeconds), [dataStart, dataEnd, barSeconds]);
  const active = editing === 'from' ? draftFrom : draftTo;
  const weeks = useMemo(() => monthMatrix(cursorMonth.year, cursorMonth.month), [cursorMonth]);
  // 日历一律用"天序号"比较（之前混用了时间戳，导致所有格子都被判为越界而禁用）
  const activeDay = dayIndex(active);
  const dataFirstDay = dayIndex(dataStart), dataLastDay = dayIndex(dataEnd);
  const parts = wallParts(active);
  const shiftMonth = (delta: number) => setCursorMonth(current => { const next = new Date(Date.UTC(current.year, current.month - 1 + delta, 1)); return { year: next.getUTCFullYear(), month: next.getUTCMonth() + 1 }; });
  const pickDay = (index: number) => {
    if (index < dataFirstDay || index > dataLastDay) return;
    const stamp = withTime(dayStart(index), parts.hour, parts.minute);
    if (editing === 'from') setDraftFrom(stamp); else setDraftTo(stamp);
  };
  const setHour = (hour: number) => { const stamp = withTime(active, hour, parts.minute); if (editing === 'from') setDraftFrom(stamp); else setDraftTo(stamp); };
  const setMinute = (minute: number) => { const stamp = withTime(active, parts.hour, minute); if (editing === 'from') setDraftFrom(stamp); else setDraftTo(stamp); };
  const clamped = clampRange(draftFrom, draftTo, dataStart, dataEnd);
  const isPreset = (presetFrom: number | null, presetTo: number | null) =>
    (presetFrom === null && from === null) || (presetFrom !== null && presetTo !== null && Math.abs((from ?? 0) - presetFrom) < 60 && Math.abs((to ?? 0) - presetTo) < 60);

  return <div className="dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="date-dialog range-dialog" role="dialog" aria-label="选择回放区间" data-testid="range-dialog">
      <h3>回放区间<small>UTC+8 · 数据范围 {formatDay(dataStart)} ~ {formatDay(dataEnd)}</small></h3>

      <div className="range-picks">
        <button className={`range-pick ${editing === 'from' ? 'active' : ''}`} data-testid="pick-from" onClick={() => setEditing('from')}>
          <em>开始</em><b>{formatDateTime(draftFrom)}</b>
        </button>
        <span className="range-arrow">→</span>
        <button className={`range-pick ${editing === 'to' ? 'active' : ''}`} data-testid="pick-to" onClick={() => setEditing('to')}>
          <em>结束</em><b>{formatDateTime(draftTo)}</b>
        </button>
      </div>

      <div className="range-calendar" aria-label={editing === 'from' ? '选择开始日期' : '选择结束日期'}>
        <header>
          <button type="button" aria-label="上个月" onClick={() => shiftMonth(-1)}><Icon name="line" /></button>
          <strong>{cursorMonth.year} 年 {cursorMonth.month} 月</strong>
          <button type="button" aria-label="下个月" onClick={() => shiftMonth(1)}><Icon name="line" /></button>
        </header>
        <div className="range-week">{WEEKDAYS.map(day => <span key={day}>{day}</span>)}</div>
        <div className="range-days" data-testid="range-days">
          {weeks.flat().map(index => {
            const dayNumber = partsOfIndex(index).day;
            const outside = index < dataFirstDay || index > dataLastDay;
            const selected = index === activeDay;
            const inMonth = sameMonth(index, cursorMonth.year, cursorMonth.month);
            return <button key={index} type="button" disabled={outside} data-testid="range-day" data-selected={selected}
              className={`range-day ${selected ? 'selected' : ''} ${inMonth ? '' : 'muted'} ${isWeekend(index) ? 'weekend' : ''}`}
              title={formatDay(dayStart(index))} onClick={() => pickDay(index)}>{dayNumber}</button>;
          })}
        </div>
        <div className="range-time">
          <label>时<select aria-label="小时" value={parts.hour} onChange={event => setHour(Number(event.target.value))}>{Array.from({ length: 24 }, (_, hour) => <option key={hour} value={hour}>{pad2(hour)}</option>)}</select></label>
          <label>分<select aria-label="分钟" value={parts.minute} onChange={event => setMinute(Number(event.target.value))}>{[0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55].map(minute => <option key={minute} value={minute}>{pad2(minute)}</option>)}</select></label>
          <span className="range-time-hint">当前编辑：{editing === 'from' ? '开始时间' : '结束时间'} · {formatTime(active)}</span>
        </div>
      </div>

      <div className="range-presets" data-testid="range-presets">
        {presets.map(preset => <button key={preset.id} type="button" className={isPreset(preset.from, preset.to) ? 'on' : ''} data-testid={`preset-${preset.id}`}
          onClick={() => { setDraftFrom(preset.from ?? dataStart); setDraftTo(preset.to ?? dataEnd); const { year, month } = wallParts(preset.from ?? dataStart); setCursorMonth({ year, month }); }}>{preset.label}</button>)}
      </div>

      <p className={`range-summary ${clamped.valid ? '' : 'negative'}`} data-testid="range-dialog-summary">
        {clamped.valid
          ? `将回放 ${formatDateTime(clamped.from)} → ${formatDateTime(clamped.to)}（约 ${Math.max(1, Math.round((clamped.to - clamped.from) / barSeconds))} 根）`
          : '开始时间必须早于结束时间。'}
      </p>

      <footer>
        <button type="button" onClick={onClose}>取消</button>
        <button type="button" className="primary" data-testid="range-confirm" disabled={!clamped.valid}
          onClick={() => onApply(clamped.from, clamped.to)}>应用区间</button>
      </footer>
    </div>
  </div>;
}
const pad2 = (value: number) => String(value).padStart(2, '0');
