/*!
 * src/session.ts - zhuk-replay-studio key core logic
 * (c) 2026 William-Trader (https://github.com/William-Trader)
 * WM: ZRS-4A19ECF3
 * SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
 * Removing this mark violates the license.
 */
/** Replay-session model: an on-demand 复盘 session with intrabar playback and keep/discard.
 *  Pure functions only — no DOM, no storage, no network. */
import { partialBar, withFormingBar, type Candle } from './market';
import type { MarketEvent, OrderAction } from './orders';

/** bar 内路径与原子的单一定义在 market.ts，这里只做再导出，保持调用点不变。 */
export { intrabarPrice, intrabarPrices, partialBar, withFormingBar, INTRABAR_STOPS } from './market';

export interface SessionSnapshot { cursor: number; marketEvents: MarketEvent[]; orderLog: OrderAction[]; notes: { id: string }[] }
export interface ReplaySession {
  id: string;
  startedAt: number;
  /** Replay cursor at start; restored when the result is discarded. */
  startCursor: number;
  /** Revealed-bar count at start, in the current mode's own units. */
  revealedAtStart: number;
  fillsAtStart: number;
  realizedAtStart: number;
  /** 开始复盘时的账户权益（含浮动）：本次收益按权益变动算，才与权益曲线一致。 */
  equityAtStart: number;
  /** Auto-added volume pane, removed again when the result is discarded. */
  addedVolume: boolean;
  snapshot: SessionSnapshot;
}
export interface SessionStats { minutes: number; bars: number; fills: number; buys: number; sells: number; realized: number; equity: number; gained: number; /** 本次复盘的权益曲线（按重放索引截取）。 */ curve: number[]; /** 复盘期间触发的指标预警条数。 */ alerts: number; /** 最近几条预警文案（写进复盘小结）。 */ alertLines: string[] }
export interface SessionContext { revealed: number; cursor: number; fills: number; buys: number; sells: number; realized: number; equity: number; curve: number[]; alerts?: string[] }

export const newSessionId = (now = Date.now()) => `session-${now.toString(36)}`;
export function createSession(input: { now?: number; cursor: number; revealed: number; fills: number; realized: number; equity: number; addedVolume: boolean; snapshot: SessionSnapshot }): ReplaySession {
  const now = input.now ?? Date.now();
  return {
    id: newSessionId(now), startedAt: now, startCursor: input.cursor,
    revealedAtStart: input.revealed, fillsAtStart: input.fills, realizedAtStart: input.realized, equityAtStart: input.equity,
    addedVolume: input.addedVolume, snapshot: input.snapshot,
  };
}
/** Progress is measured by replay position (never by array length), so a feed that finishes
 *  loading mid-session cannot inflate the report. */
export function sessionStats(session: ReplaySession, context: SessionContext, now = Date.now()): SessionStats {
  const realized = context.realized - session.realizedAtStart;
  // 本次收益 = 权益变动（含浮动与手续费）。旧实现只算已实现盈亏，与权益曲线对不上。
  const equityDelta = context.equity - session.equityAtStart;
  return {
    minutes: Math.max(0, Math.round((now - session.startedAt) / 60_000)),
    bars: Math.max(0, context.revealed - session.revealedAtStart),
    fills: context.fills, buys: context.buys, sells: context.sells,
    realized, equity: context.equity, gained: equityDelta,
    curve: context.curve.slice(session.startCursor, Math.max(session.startCursor, context.cursor)),
    alerts: (context.alerts ?? []).length, alertLines: (context.alerts ?? []).slice(-5),
  };
}
const signed = (value: number) => `${value >= 0 ? '+' : ''}${value.toFixed(2)}`;
/** Kept results are written into the notes as a one-paragraph summary. */
export function sessionSummary(session: ReplaySession, stats: SessionStats, market: string, unit = 'USDT', now = Date.now()): string {
  const started = new Date(session.startedAt);
  const pad = (value: number) => String(value).padStart(2, '0');
  return [
    `【复盘小结】${market} · ${pad(started.getHours())}:${pad(started.getMinutes())} 开始`,
    `本次回放 ${stats.bars} 根K线 · 用时 ${stats.minutes} 分钟 · 成交 ${stats.fills} 笔（买开 ${stats.buys} / 卖平 ${stats.sells}）`,
    `已实现盈亏 ${signed(stats.realized)} ${unit} · 账户净值 ${stats.equity.toFixed(unit === 'USDT' ? 2 : 8)} ${unit}`,
    `指标预警 ${stats.alerts} 次${stats.alertLines.length ? `：${stats.alertLines.join('；')}` : ''}`,
  ].join('\n');
}
/** mm:ss countdown/elapsed text, hh:mm:ss above an hour. */
export function durationText(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const pad = (value: number) => String(value).padStart(2, '0');
  const hours = Math.floor(total / 3600), minutes = Math.floor((total % 3600) / 60), seconds = total % 60;
  return hours ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}
/** Speeds are bars per second; the intrabar animation spreads one bar over `1000 / speed` ms. */
export const REPLAY_SPEEDS = [.5, 1, 2, 4, 8, 16, 32] as const;
export const STEP_SIZES = [1, 2, 4] as const;
export const MIN_REPLAY_SPEED = REPLAY_SPEEDS[0];
