/*!
 * src/history.ts - zhuk-replay-studio key core logic
 * (c) 2026 William-Trader (https://github.com/William-Trader)
 * WM: ZRS-3CCCECF8
 * SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
 * Removing this mark violates the license.
 */
/** 战绩库与交易风格识别：把每次复盘的战绩累进综合统计，并自动识别个人交易风格标签。
 *  纯函数，无 DOM / 存储 / 网络。 */
import type { Fill, Side, SimConfig } from './model';

export interface SessionRecord {
  id: string; at: number;
  symbol: string; interval: string; minutes: number; bars: number;
  trades: number; wins: number; losses: number;
  realized: number; fees: number; funding: number;
  maxDrawdown: number; winRate: number; profitFactor: number; best: number; worst: number;
  longTrades: number; longPnl: number; shortTrades: number; shortPnl: number;
  avgHoldingMinutes: number; alerts: number; liquidated: boolean;
  /** 当时的账户口径，用于风险风格识别。 */
  leverage: number; marginMode: SimConfig['marginMode']; settle: SimConfig['settle'];
  /** 成交原因计数（止损/止盈/强平），用于纪律风格识别。 */
  slCount: number; tpCount: number; liquidationCount: number;
}

export interface TradeStatsLike {
  trades: number; wins: number; losses: number; realized: number; fees: number; funding: number;
  maxDrawdown: number; winRate: number; profitFactor: number; best: number; worst: number;
  longTrades: number; longPnl: number; shortTrades: number; shortPnl: number; avgHoldingMinutes: number; liquidated: boolean;
}
export interface SessionLike {
  id: string; name: string; startedAt: number; endsAt?: number;
  bars: number; alerts: number;
}

const countReasons = (fills: readonly Fill[]) => ({
  slCount: fills.filter(fill => fill.reason === 'sl').length,
  tpCount: fills.filter(fill => fill.reason === 'tp' || fill.reason === 'trail').length,
  liquidationCount: fills.filter(fill => fill.reason === 'liquidation').length,
});

/** 一次复盘结束后生成战绩记录（保留结果时写入战绩库）。 */
export function buildRecord(input: {
  id: string; at: number; symbol: string; interval: string; minutes: number; bars: number;
  stats: TradeStatsLike; alerts: number; config: SimConfig; fills: readonly Fill[];
}): SessionRecord {
  const reasons = countReasons(input.fills);
  const { stats } = input;
  return {
    id: input.id, at: input.at, symbol: input.symbol, interval: input.interval, minutes: input.minutes, bars: input.bars,
    trades: stats.trades, wins: stats.wins, losses: stats.losses,
    realized: stats.realized, fees: stats.fees, funding: stats.funding,
    maxDrawdown: stats.maxDrawdown, winRate: stats.winRate,
    profitFactor: Number.isFinite(stats.profitFactor) ? stats.profitFactor : 0,
    best: stats.best, worst: stats.worst,
    longTrades: stats.longTrades, longPnl: stats.longPnl, shortTrades: stats.shortTrades, shortPnl: stats.shortPnl,
    avgHoldingMinutes: stats.avgHoldingMinutes, alerts: input.alerts, liquidated: stats.liquidated,
    leverage: input.config.leverage, marginMode: input.config.marginMode, settle: input.config.settle,
    ...reasons,
  };
}

export interface Totals {
  sessions: number; trades: number; wins: number; losses: number;
  realized: number; fees: number; funding: number; alerts: number; liquidations: number;
  winRate: number; profitFactor: number; maxDrawdown: number; avgHoldingMinutes: number;
  best: number; worst: number; longTrades: number; longPnl: number; shortTrades: number; shortPnl: number;
  avgLeverage: number; avgTradesPerSession: number;
  /** 连续盈亏（按时间顺序的最后一段）。 */
  streakKind: 'win' | 'loss' | 'none'; streak: number;
}
const average = (values: number[]) => values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0;

/** 综合统计：把每次复盘的战绩累加（按时间顺序）。 */
export function aggregate(records: readonly SessionRecord[]): Totals {
  const wins = records.reduce((total, record) => total + record.wins, 0);
  const losses = records.reduce((total, record) => total + record.losses, 0);
  const profit = records.reduce((total, record) => total + Math.max(0, record.realized), 0);
  const loss = records.reduce((total, record) => total + Math.min(0, record.realized), 0);
  // 连续盈亏：按时间从后往前找同号的会话段
  let streakKind: Totals['streakKind'] = 'none', streak = 0;
  for (let i = records.length - 1; i >= 0; i--) {
    const sign = records[i].realized >= 0 ? 'win' : 'loss';
    if (streakKind === 'none') { streakKind = sign; streak = 1; continue; }
    if (sign !== streakKind) break;
    streak++;
  }
  return {
    sessions: records.length,
    trades: records.reduce((total, record) => total + record.trades, 0),
    wins, losses,
    realized: records.reduce((total, record) => total + record.realized, 0),
    fees: records.reduce((total, record) => total + record.fees, 0),
    funding: records.reduce((total, record) => total + record.funding, 0),
    alerts: records.reduce((total, record) => total + record.alerts, 0),
    liquidations: records.filter(record => record.liquidated).length,
    winRate: wins + losses ? wins / (wins + losses) : 0,
    profitFactor: loss < 0 ? profit / Math.abs(loss) : profit > 0 ? Number.POSITIVE_INFINITY : 0,
    maxDrawdown: records.reduce((worst, record) => Math.max(worst, record.maxDrawdown), 0),
    avgHoldingMinutes: average(records.map(record => record.avgHoldingMinutes).filter(value => value > 0)),
    best: records.reduce((best, record) => Math.max(best, record.best), 0),
    worst: records.reduce((worst, record) => Math.min(worst, record.worst), 0),
    longTrades: records.reduce((total, record) => total + record.longTrades, 0),
    longPnl: records.reduce((total, record) => total + record.longPnl, 0),
    shortTrades: records.reduce((total, record) => total + record.shortTrades, 0),
    shortPnl: records.reduce((total, record) => total + record.shortPnl, 0),
    avgLeverage: average(records.map(record => record.leverage)),
    avgTradesPerSession: records.length ? records.reduce((total, record) => total + record.trades, 0) / records.length : 0,
    streakKind, streak,
  };
}

export type StyleTone = 'positive' | 'neutral' | 'warning';
export interface StyleTag { id: string; label: string; detail: string; tone: StyleTone }

/** 交易风格标签：从累计战绩里自动识别方向、持仓、频率、风险、盈亏结构与纪律。 */
export function detectStyle(records: readonly SessionRecord[]): StyleTag[] {
  const tags: StyleTag[] = [];
  if (!records.length) return tags;
  const totals = aggregate(records);
  const directional = totals.longTrades + totals.shortTrades;
  // 方向偏好
  if (directional >= 4) {
    const longShare = totals.longTrades / directional;
    if (longShare >= .7) tags.push({ id: 'long-bias', label: '多头偏好', detail: `多单占 ${(longShare * 100).toFixed(0)}%`, tone: 'neutral' });
    else if (longShare <= .3) tags.push({ id: 'short-bias', label: '空头偏好', detail: `空单占 ${((1 - longShare) * 100).toFixed(0)}%`, tone: 'neutral' });
    else tags.push({ id: 'both-ways', label: '双向均衡', detail: `多空 ${totals.longTrades}/${totals.shortTrades}`, tone: 'neutral' });
  }
  // 持仓风格
  const holding = totals.avgHoldingMinutes;
  if (holding > 0) {
    if (holding < 60) tags.push({ id: 'scalp', label: '日内快打', detail: `平均持仓 ${holding.toFixed(0)} 分钟`, tone: 'neutral' });
    else if (holding < 480) tags.push({ id: 'swing', label: '短线波段', detail: `平均持仓 ${(holding / 60).toFixed(1)} 小时`, tone: 'neutral' });
    else tags.push({ id: 'position', label: '中长线持仓', detail: `平均持仓 ${(holding / 60).toFixed(1)} 小时`, tone: 'neutral' });
  }
  // 交易频率
  if (totals.avgTradesPerSession > 0) {
    if (totals.avgTradesPerSession < 2) tags.push({ id: 'low-freq', label: '低频谨慎', detail: `每局 ${totals.avgTradesPerSession.toFixed(1)} 笔`, tone: 'neutral' });
    else if (totals.avgTradesPerSession <= 6) tags.push({ id: 'mid-freq', label: '节奏适中', detail: `每局 ${totals.avgTradesPerSession.toFixed(1)} 笔`, tone: 'positive' });
    else tags.push({ id: 'high-freq', label: '高频活跃', detail: `每局 ${totals.avgTradesPerSession.toFixed(1)} 笔`, tone: 'warning' });
  }
  // 风险偏好
  if (totals.avgLeverage >= 10 || totals.liquidations > 0) tags.push({ id: 'aggressive', label: '高风险偏好', detail: `平均 ${totals.avgLeverage.toFixed(1)}× · 爆仓 ${totals.liquidations} 次`, tone: 'warning' });
  else if (totals.avgLeverage > 0 && totals.avgLeverage <= 3) tags.push({ id: 'conservative', label: '低杠杆稳健', detail: `平均 ${totals.avgLeverage.toFixed(1)}×`, tone: 'positive' });
  // 盈亏结构
  if (totals.profitFactor >= 1.5) tags.push({ id: 'edge', label: '盈亏比优秀', detail: `PF ${totals.profitFactor === Number.POSITIVE_INFINITY ? '∞' : totals.profitFactor.toFixed(2)}`, tone: 'positive' });
  else if (totals.winRate >= .55 && totals.profitFactor < 1.2) tags.push({ id: 'high-win-small', label: '高胜率小盈亏', detail: `胜率 ${(totals.winRate * 100).toFixed(0)}% · PF ${totals.profitFactor.toFixed(2)}`, tone: 'warning' });
  else if (totals.losses > totals.wins * 1.5) tags.push({ id: 'low-win-big', label: '低胜率博盈亏比', detail: `胜率 ${(totals.winRate * 100).toFixed(0)}%`, tone: 'warning' });
  // 纪律
  const slRate = totals.trades ? records.reduce((total, record) => total + record.slCount, 0) / Math.max(1, totals.trades) : 0;
  const tpRate = totals.trades ? records.reduce((total, record) => total + record.tpCount, 0) / Math.max(1, totals.trades) : 0;
  if (slRate >= .3) tags.push({ id: 'stop-discipline', label: '止损纪律好', detail: `止损占比 ${(slRate * 100).toFixed(0)}%`, tone: 'positive' });
  else if (totals.trades >= 5) tags.push({ id: 'no-stop', label: '少用止损', detail: `止损占比 ${(slRate * 100).toFixed(0)}%`, tone: 'warning' });
  if (tpRate >= .2) tags.push({ id: 'take-profit', label: '止盈执行到位', detail: `止盈占比 ${(tpRate * 100).toFixed(0)}%`, tone: 'positive' });
  if (totals.alerts > 0 && totals.sessions > 0 && totals.alerts / totals.sessions >= 3) tags.push({ id: 'signal-driven', label: '依赖指标信号', detail: `每局 ${(totals.alerts / totals.sessions).toFixed(1)} 次提醒`, tone: 'neutral' });
  if (totals.streakKind !== 'none' && totals.streak >= 3) tags.push({ id: 'streak', label: totals.streakKind === 'win' ? '连胜中' : '连亏中', detail: `连续 ${totals.streak} 局${totals.streakKind === 'win' ? '盈利' : '亏损'}`, tone: totals.streakKind === 'win' ? 'positive' : 'warning' });
  return tags;
}

/** 累计盈亏曲线（按会话净值累加），供主面板画折线。 */
export function equityBySession(records: readonly SessionRecord[]): number[] {
  let total = 0;
  return records.map(record => (total += record.realized));
}

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const text = (value: unknown, fallback = ''): string => typeof value === 'string' ? value : fallback;
/** 战绩记录的清洗（导入/存档）：字段缺失或非法就丢弃该条。 */
export function sanitizeRecords(value: unknown): SessionRecord[] {
  if (!Array.isArray(value)) return [];
  return value.filter(record => record && typeof record === 'object').map(record => record as Record<string, unknown>)
    .filter(record => finite(record.at) && typeof record.id === 'string')
    .map(record => ({
      id: String(record.id), at: record.at as number,
      symbol: text(record.symbol, 'BTCUSDT'), interval: text(record.interval, '15m'),
      minutes: finite(record.minutes) ? record.minutes : 0, bars: finite(record.bars) ? record.bars : 0,
      trades: finite(record.trades) ? record.trades : 0, wins: finite(record.wins) ? record.wins : 0, losses: finite(record.losses) ? record.losses : 0,
      realized: finite(record.realized) ? record.realized : 0, fees: finite(record.fees) ? record.fees : 0, funding: finite(record.funding) ? record.funding : 0,
      maxDrawdown: finite(record.maxDrawdown) ? record.maxDrawdown : 0, winRate: finite(record.winRate) ? record.winRate : 0,
      profitFactor: finite(record.profitFactor) ? record.profitFactor : 0,
      best: finite(record.best) ? record.best : 0, worst: finite(record.worst) ? record.worst : 0,
      longTrades: finite(record.longTrades) ? record.longTrades : 0, longPnl: finite(record.longPnl) ? record.longPnl : 0,
      shortTrades: finite(record.shortTrades) ? record.shortTrades : 0, shortPnl: finite(record.shortPnl) ? record.shortPnl : 0,
      avgHoldingMinutes: finite(record.avgHoldingMinutes) ? record.avgHoldingMinutes : 0,
      alerts: finite(record.alerts) ? record.alerts : 0, liquidated: record.liquidated === true,
      leverage: finite(record.leverage) ? record.leverage : 1,
      marginMode: record.marginMode === 'isolated' ? 'isolated' as const : 'cross' as const,
      settle: record.settle === 'coin' ? 'coin' as const : 'usdt' as const,
      slCount: finite(record.slCount) ? record.slCount : 0, tpCount: finite(record.tpCount) ? record.tpCount : 0,
      liquidationCount: finite(record.liquidationCount) ? record.liquidationCount : 0,
    }))
    .slice(-500);
}

export interface HistoryStore { version: 1; records: SessionRecord[] }
export const emptyHistoryStore = (): HistoryStore => ({ version: 1, records: [] });
export function sanitizeHistoryStore(value: unknown): HistoryStore {
  if (!value || typeof value !== 'object' || (value as { version?: unknown }).version !== 1) return emptyHistoryStore();
  return { version: 1, records: sanitizeRecords((value as { records?: unknown }).records) };
}
export const sideLabel = (side: Side) => side === 'long' ? '多' : '空';
