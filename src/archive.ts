/*!
 * src/archive.ts - zhuk-replay-studio key core logic
 * (c) 2026 William-Trader (https://github.com/William-Trader)
 * WM: ZRS-6B809F01
 * SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
 * Removing this mark violates the license.
 */
/** 训练档案：把每次「保留结果」的复盘落成结构化战绩，跨场累计、分组与导出。
 *  纯函数，无 DOM / 存储 / 网络。
 *
 *  设计取舍：
 *  - 只存原始计数与金额（wins/losses/grossProfit…），盈亏比在读取时派生 —— JSON 里
 *    不会出现 Infinity（`JSON.stringify(Infinity)` 会变成 null，存档就废了）。
 *  - 每场自带 `unit`，币本位（BTC）与 U 本位（USDT）的战绩不混算，按单位分组统计。 */
import type { SessionStats } from './session';
import type { TradeStats } from './stats';

/** 档案上限：够看一整季训练，又不会把存档撑爆。超出丢最旧的。 */
export const MAX_ARCHIVE_ENTRIES = 500;

export interface ArchiveEntry {
  id: string;
  /** 复盘结束时间（毫秒时间戳）。 */
  at: number;
  market: string;
  /** 周期标签，如 `15分`、`1小时`。 */
  interval: string;
  /** 本场用时（分钟）。 */
  minutes: number;
  bars: number;
  /** 结算单位：`USDT`（U本位）或基础币（币本位）。 */
  unit: string;
  /** 本场起始权益，跨场累计曲线的起点。 */
  startEquity: number;
  /** 本场结束权益。 */
  equity: number;
  trades: number; wins: number; losses: number;
  grossProfit: number; grossLoss: number;
  realized: number; fees: number; funding: number;
  best: number; worst: number;
  longTrades: number; longPnl: number; shortTrades: number; shortPnl: number;
  maxDrawdown: number; maxDrawdownPct: number;
  avgHoldingMinutes: number;
  liquidated: boolean;
  alerts: number;
}

export interface ArchiveTotals {
  sessions: number; trades: number; wins: number; losses: number;
  winRate: number; grossProfit: number; grossLoss: number; profitFactor: number;
  realized: number; fees: number; funding: number;
  /** 场均已实现盈亏。 */
  avgRealized: number;
  /** 场均成交笔数。 */
  avgTrades: number;
  /** 单场最长连赢 / 连亏（按该场已实现盈亏的正负号）。 */
  maxWinStreak: number; maxLossStreak: number;
  bestSession: number; worstSession: number;
  /** 跨场累计曲线的最大回撤。 */
  maxDrawdown: number; maxDrawdownPct: number;
  liquidations: number;
  minutes: number;
  first: number; last: number;
}

export const emptyTotals = (): ArchiveTotals => ({
  sessions: 0, trades: 0, wins: 0, losses: 0, winRate: 0, grossProfit: 0, grossLoss: 0, profitFactor: 0,
  realized: 0, fees: 0, funding: 0, avgRealized: 0, avgTrades: 0, maxWinStreak: 0, maxLossStreak: 0,
  bestSession: 0, worstSession: 0, maxDrawdown: 0, maxDrawdownPct: 0, liquidations: 0, minutes: 0, first: 0, last: 0,
});

const finiteOr = (value: number, fallback = 0) => Number.isFinite(value) ? value : fallback;

/** 一场复盘的战绩 → 档案条目。`startEquity`/`endEquity` 用于跨场累计曲线。 */
export function createArchiveEntry(input: {
  session: SessionStats; trade: TradeStats; market: string; interval: string; unit: string;
  startEquity: number; endEquity: number; at?: number; id?: string;
}): ArchiveEntry {
  const { session, trade } = input;
  const at = input.at ?? Date.now();
  return {
    id: input.id ?? `archive-${at.toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    at,
    market: input.market,
    interval: input.interval,
    minutes: Math.max(0, Math.round(finiteOr(session.minutes))),
    bars: Math.max(0, Math.round(finiteOr(session.bars))),
    unit: input.unit,
    startEquity: finiteOr(input.startEquity),
    equity: finiteOr(input.endEquity),
    trades: Math.max(0, Math.round(finiteOr(trade.trades))),
    wins: Math.max(0, Math.round(finiteOr(trade.wins))),
    losses: Math.max(0, Math.round(finiteOr(trade.losses))),
    grossProfit: finiteOr(trade.grossProfit),
    grossLoss: finiteOr(trade.grossLoss),
    realized: finiteOr(trade.realized),
    fees: finiteOr(trade.fees),
    funding: finiteOr(trade.funding),
    best: finiteOr(trade.best),
    worst: finiteOr(trade.worst),
    longTrades: Math.max(0, Math.round(finiteOr(trade.longTrades))),
    longPnl: finiteOr(trade.longPnl),
    shortTrades: Math.max(0, Math.round(finiteOr(trade.shortTrades))),
    shortPnl: finiteOr(trade.shortPnl),
    maxDrawdown: finiteOr(trade.maxDrawdown),
    maxDrawdownPct: finiteOr(trade.maxDrawdownPct),
    avgHoldingMinutes: finiteOr(trade.avgHoldingMinutes),
    liquidated: trade.liquidated === true,
    alerts: Math.max(0, Math.round(finiteOr(session.alerts))),
  };
}

/** 盈亏比：亏损为 0 但有盈利记 ∞，两边都空记 0（与单场统计同口径）。 */
export function profitFactorOf(entry: Pick<ArchiveEntry, 'grossProfit' | 'grossLoss'>): number {
  if (entry.grossLoss < 0) return entry.grossProfit / Math.abs(entry.grossLoss);
  return entry.grossProfit > 0 ? Infinity : 0;
}
/** 盈亏比的显示文本（∞ 不参与后续加总）。 */
export const profitFactorText = (value: number): string => Number.isFinite(value) ? value.toFixed(2) : '∞';

/** 单场胜率。 */
export const entryWinRate = (entry: Pick<ArchiveEntry, 'trades' | 'wins'>): number => entry.trades > 0 ? entry.wins / entry.trades : 0;
/** 单场结算金额的可读位数：U 本位 2 位，币本位 8 位。 */
export const unitDigits = (unit: string): number => unit === 'USDT' ? 2 : 8;

/** 档案里出现过的结算单位（按出现顺序）；用于分组统计与切换视图。 */
export function archiveUnits(entries: readonly ArchiveEntry[]): string[] {
  const seen: string[] = [];
  for (const entry of entries) if (!seen.includes(entry.unit)) seen.push(entry.unit);
  return seen;
}

/** 跨场累计已实现盈亏曲线（首点为 0，便于画线与算回撤）。 */
export function archiveCurve(entries: readonly ArchiveEntry[]): number[] {
  const curve = [0];
  let total = 0;
  for (const entry of entries) { total += finiteOr(entry.realized); curve.push(total); }
  return curve;
}

/** 按场次符号统计最长连赢 / 连亏。 */
function streaks(entries: readonly ArchiveEntry[]): { maxWinStreak: number; maxLossStreak: number } {
  let win = 0, loss = 0, maxWinStreak = 0, maxLossStreak = 0;
  for (const entry of entries) {
    const value = finiteOr(entry.realized);
    if (value > 0) { win += 1; loss = 0; } else if (value < 0) { loss += 1; win = 0; }
    maxWinStreak = Math.max(maxWinStreak, win);
    maxLossStreak = Math.max(maxLossStreak, loss);
  }
  return { maxWinStreak, maxLossStreak };
}

/** 跨场回撤：取自累计曲线（口径与单场一致）。 */
function curveDrawdown(curve: readonly number[]): { maxDrawdown: number; maxDrawdownPct: number } {
  let peak = curve.length ? curve[0] : 0, maxDrawdown = 0, maxDrawdownPct = 0;
  for (const value of curve) {
    if (value > peak) peak = value;
    const drop = peak - value;
    if (drop > maxDrawdown) maxDrawdown = drop;
    if (peak > 0 && drop / peak > maxDrawdownPct) maxDrawdownPct = drop / peak;
  }
  return { maxDrawdown, maxDrawdownPct };
}

/** 跨场汇总。入参应当已经是同一结算单位的条目（不同单位的钱不能相加）。 */
export function archiveTotals(entries: readonly ArchiveEntry[]): ArchiveTotals {
  if (!entries.length) return emptyTotals();
  let trades = 0, wins = 0, losses = 0, grossProfit = 0, grossLoss = 0;
  let realized = 0, fees = 0, funding = 0, minutes = 0, liquidations = 0;
  let bestSession = 0, worstSession = 0;
  for (const entry of entries) {
    trades += Math.max(0, entry.trades); wins += Math.max(0, entry.wins); losses += Math.max(0, entry.losses);
    grossProfit += finiteOr(entry.grossProfit); grossLoss += finiteOr(entry.grossLoss);
    realized += finiteOr(entry.realized); fees += finiteOr(entry.fees); funding += finiteOr(entry.funding);
    minutes += Math.max(0, entry.minutes);
    if (entry.liquidated) liquidations += 1;
    bestSession = Math.max(bestSession, finiteOr(entry.realized));
    worstSession = Math.min(worstSession, finiteOr(entry.realized));
  }
  const times = entries.map(entry => finiteOr(entry.at));
  return {
    sessions: entries.length, trades, wins, losses,
    winRate: trades > 0 ? wins / trades : 0,
    grossProfit, grossLoss,
    profitFactor: profitFactorOf({ grossProfit, grossLoss }),
    realized, fees, funding,
    avgRealized: realized / entries.length,
    avgTrades: trades / entries.length,
    ...streaks(entries),
    bestSession, worstSession,
    ...curveDrawdown(archiveCurve(entries)),
    liquidations, minutes,
    first: Math.min(...times), last: Math.max(...times),
  };
}

export interface ArchiveGroup { unit: string; totals: ArchiveTotals; entries: ArchiveEntry[] }

/** 按结算单位分组（单位按出现顺序），组内按时间升序。 */
export function archiveGroups(entries: readonly ArchiveEntry[]): ArchiveGroup[] {
  return archiveUnits(entries).map(unit => {
    const scoped = entries.filter(entry => entry.unit === unit).slice().sort((a, b) => a.at - b.at);
    return { unit, totals: archiveTotals(scoped), entries: scoped };
  });
}

export interface MarketBreakdown { market: string; sessions: number; trades: number; winRate: number; realized: number }
/** 按品种分组（盈亏降序），用于"哪个品种打得最好"。 */
export function marketBreakdown(entries: readonly ArchiveEntry[]): MarketBreakdown[] {
  const buckets = new Map<string, ArchiveEntry[]>();
  for (const entry of entries) {
    const bucket = buckets.get(entry.market);
    if (bucket) bucket.push(entry); else buckets.set(entry.market, [entry]);
  }
  return [...buckets.entries()].map(([market, scoped]) => {
    const totals = archiveTotals(scoped);
    return { market, sessions: totals.sessions, trades: totals.trades, winRate: totals.winRate, realized: totals.realized };
  }).sort((a, b) => b.realized - a.realized || b.trades - a.trades || a.market.localeCompare(b.market));
}

const pad2 = (value: number) => String(value).padStart(2, '0');
/** UTC+8 时间戳文本（与成交明细 CSV 口径一致）。 */
export function archiveStamp(at: number): string {
  const stamp = new Date((at + 8 * 3600 * 1000));
  return `${stamp.getUTCFullYear()}-${pad2(stamp.getUTCMonth() + 1)}-${pad2(stamp.getUTCDate())} ${pad2(stamp.getUTCHours())}:${pad2(stamp.getUTCMinutes())}`;
}

/** 档案 CSV：一场一行，含跨场汇总表头；已按结算单位分块。 */
export function archiveCsv(entries: readonly ArchiveEntry[]): string {
  const blocks: string[] = [];
  for (const group of archiveGroups(entries)) {
    const digits = unitDigits(group.unit);
    const fixed = (value: number) => value.toFixed(digits);
    const header = ['时间(UTC+8)', '品种', '周期', '场次用时(分)', '回放K线', '成交', '胜率', '盈亏比', `已实现盈亏(${group.unit})`, `手续费(${group.unit})`, `资金费(${group.unit})`, `最大回撤(${group.unit})`, '多单', '空单', '是否爆仓'];
    const rows = group.entries.map(entry => [
      archiveStamp(entry.at), entry.market, entry.interval, entry.minutes, entry.bars, entry.trades,
      `${(entryWinRate(entry) * 100).toFixed(1)}%`,
      profitFactorText(profitFactorOf(entry)),
      fixed(entry.realized), fixed(entry.fees), fixed(entry.funding), fixed(entry.maxDrawdown),
      `${entry.longTrades}/${fixed(entry.longPnl)}`, `${entry.shortTrades}/${fixed(entry.shortPnl)}`,
      entry.liquidated ? '是' : '否',
    ].join(','));
    const t = group.totals;
    blocks.push([
      `# 训练档案（结算单位：${group.unit}）`,
      `# 场次,${t.sessions}`,
      `# 累计已实现盈亏,${fixed(t.realized)}`,
      `# 整体胜率,${(t.winRate * 100).toFixed(1)}%`,
      `# 累计盈亏比,${profitFactorText(t.profitFactor)}`,
      `# 最大回撤,${fixed(t.maxDrawdown)} (${(t.maxDrawdownPct * 100).toFixed(2)}%)`,
      `# 累计手续费,${fixed(t.fees)}`,
      `# 累计资金费,${fixed(t.funding)}`,
      `# 最长连赢/连亏,${t.maxWinStreak}/${t.maxLossStreak}`,
      header.join(','), ...rows,
    ].join('\n'));
  }
  return blocks.join('\n\n');
}

/** 档案文件名：交易训练室-训练档案-YYYYMMDD-HHmm.csv */
export function archiveFileName(date = new Date()): string {
  return `交易训练室-训练档案-${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}-${pad2(date.getHours())}${pad2(date.getMinutes())}.csv`;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
const num = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? value : null;
const text = (value: unknown, max: number): string | null => typeof value === 'string' && value.length > 0 && value.length <= max ? value : null;

/** 校验单条档案；任何一处不合法整条丢弃（存档宁可少一条，也不要污染统计）。 */
export function sanitizeArchiveEntry(value: unknown): ArchiveEntry | null {
  if (!isRecord(value)) return null;
  const id = text(value.id, 64), market = text(value.market, 24), interval = text(value.interval, 16), unit = text(value.unit, 12);
  const numbers = ['at', 'minutes', 'bars', 'startEquity', 'equity', 'trades', 'wins', 'losses', 'grossProfit', 'grossLoss', 'realized', 'fees', 'funding', 'best', 'worst', 'longTrades', 'longPnl', 'shortTrades', 'shortPnl', 'maxDrawdown', 'maxDrawdownPct', 'avgHoldingMinutes', 'alerts'] as const;
  if (!id || !market || !interval || !unit) return null;
  const parsed: Record<string, number> = {};
  for (const key of numbers) { const next = num(value[key]); if (next === null) return null; parsed[key] = next; }
  return {
    id, market, interval, unit,
    at: parsed.at, minutes: Math.max(0, Math.round(parsed.minutes)), bars: Math.max(0, Math.round(parsed.bars)),
    startEquity: parsed.startEquity, equity: parsed.equity,
    trades: Math.max(0, Math.round(parsed.trades)), wins: Math.max(0, Math.round(parsed.wins)), losses: Math.max(0, Math.round(parsed.losses)),
    grossProfit: parsed.grossProfit, grossLoss: parsed.grossLoss,
    realized: parsed.realized, fees: parsed.fees, funding: parsed.funding,
    best: parsed.best, worst: parsed.worst,
    longTrades: Math.max(0, Math.round(parsed.longTrades)), longPnl: parsed.longPnl,
    shortTrades: Math.max(0, Math.round(parsed.shortTrades)), shortPnl: parsed.shortPnl,
    maxDrawdown: parsed.maxDrawdown, maxDrawdownPct: parsed.maxDrawdownPct,
    avgHoldingMinutes: parsed.avgHoldingMinutes,
    liquidated: value.liquidated === true,
    alerts: Math.max(0, Math.round(parsed.alerts)),
  };
}

/** 存档/导入时的档案清洗：丢弃非法条目、按时间升序、只留最近 MAX_ARCHIVE_ENTRIES 场。 */
export function sanitizeArchive(value: unknown): ArchiveEntry[] {
  if (!Array.isArray(value)) return [];
  const entries = value.map(sanitizeArchiveEntry).filter((entry): entry is ArchiveEntry => entry !== null);
  entries.sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
  return entries.length > MAX_ARCHIVE_ENTRIES ? entries.slice(entries.length - MAX_ARCHIVE_ENTRIES) : entries;
}

/** 追加一场并保持上限（返回新数组，便于直接 setState）。 */
export function appendArchive(entries: readonly ArchiveEntry[], entry: ArchiveEntry): ArchiveEntry[] {
  const next = [...entries, entry];
  return next.length > MAX_ARCHIVE_ENTRIES ? next.slice(next.length - MAX_ARCHIVE_ENTRIES) : next;
}
