/*!
 * src/stats.ts - zhuk-replay-studio key core logic
 * (c) 2026 William-Trader (https://github.com/William-Trader)
 * WM: ZRS-A0B16462
 * SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
 * Removing this mark violates the license.
 */
/** 复盘统计：从成交序列与权益曲线算出胜率、盈亏比、回撤、多空分列与持仓时长。
 *  纯函数，无 DOM / 存储 / 网络。 */
import type { Fill, Side } from './model';

export interface ClosedTrade { dir: Side; qty: number; pnl: number; openedAt: number; closedAt: number; reason: Fill['reason']; complete: boolean }
export interface TradeStats {
  trades: number; wins: number; losses: number; winRate: number;
  grossProfit: number; grossLoss: number; profitFactor: number;
  avgWin: number; avgLoss: number; best: number; worst: number;
  fees: number; funding: number; realized: number;
  longTrades: number; longPnl: number; shortTrades: number; shortPnl: number;
  maxDrawdown: number; maxDrawdownPct: number; peakEquity: number;
  avgHoldingMinutes: number; liquidated: boolean;
}
export const emptyStats = (): TradeStats => ({
  trades: 0, wins: 0, losses: 0, winRate: 0, grossProfit: 0, grossLoss: 0, profitFactor: 0,
  avgWin: 0, avgLoss: 0, best: 0, worst: 0, fees: 0, funding: 0, realized: 0,
  longTrades: 0, longPnl: 0, shortTrades: 0, shortPnl: 0, maxDrawdown: 0, maxDrawdownPct: 0, peakEquity: 0,
  avgHoldingMinutes: 0, liquidated: false,
});
/** 把成交序列配成"已了结的交易"：每次减/平仓记一笔，完整平仓额外带持仓时长。 */
export function closedTrades(fills: readonly Fill[]): ClosedTrade[] {
  const trades: ClosedTrade[] = [];
  let openedAt: number | null = null;
  for (const fill of fills) {
    if (fill.action === 'open' || fill.action === 'add') { if (openedAt === null) openedAt = fill.time; continue; }
    trades.push({ dir: fill.dir, qty: fill.qty, pnl: fill.realized, openedAt: openedAt ?? fill.time, closedAt: fill.time, reason: fill.reason, complete: fill.action === 'close' });
    if (fill.action === 'close') openedAt = null;
  }
  return trades;
}
/** 权益曲线最大回撤（金额与比例）。 */
export function drawdown(curve: readonly number[]): { maxDrawdown: number; maxDrawdownPct: number; peakEquity: number } {
  let peak = curve.length ? curve[0] : 0, maxDrawdown = 0, maxDrawdownPct = 0;
  for (const equity of curve) {
    if (equity > peak) peak = equity;
    const drop = peak - equity;
    if (drop > maxDrawdown) maxDrawdown = drop;
    if (peak > 0 && drop / peak > maxDrawdownPct) maxDrawdownPct = drop / peak;
  }
  return { maxDrawdown, maxDrawdownPct, peakEquity: peak };
}
export function tradeStats(fills: readonly Fill[], equityCurve: readonly number[], funding = 0, liquidated = false): TradeStats {
  const trades = closedTrades(fills);
  const stats = emptyStats();
  const wins = trades.filter(trade => trade.pnl > 0), losses = trades.filter(trade => trade.pnl < 0);
  const grossProfit = wins.reduce((total, trade) => total + trade.pnl, 0);
  const grossLoss = losses.reduce((total, trade) => total + trade.pnl, 0);
  const complete = trades.filter(trade => trade.complete);
  const holding = complete.length ? complete.reduce((total, trade) => total + Math.max(0, trade.closedAt - trade.openedAt), 0) / complete.length : 0;
  const pool = (dir: Side) => trades.filter(trade => trade.dir === dir);
  return {
    ...stats,
    trades: trades.length, wins: wins.length, losses: losses.length,
    winRate: trades.length ? wins.length / trades.length : 0,
    grossProfit, grossLoss, profitFactor: grossLoss < 0 ? grossProfit / Math.abs(grossLoss) : grossProfit > 0 ? Infinity : 0,
    avgWin: wins.length ? grossProfit / wins.length : 0,
    avgLoss: losses.length ? grossLoss / losses.length : 0,
    best: trades.reduce((max, trade) => Math.max(max, trade.pnl), 0),
    worst: trades.reduce((min, trade) => Math.min(min, trade.pnl), 0),
    fees: fills.reduce((total, fill) => total + fill.fee, 0),
    funding, realized: fills.reduce((total, fill) => total + fill.realized, 0),
    longTrades: pool('long').length, longPnl: pool('long').reduce((total, trade) => total + trade.pnl, 0),
    shortTrades: pool('short').length, shortPnl: pool('short').reduce((total, trade) => total + trade.pnl, 0),
    ...drawdown(equityCurve),
    avgHoldingMinutes: holding / 60,
    liquidated,
  };
}
/** 权益曲线压缩成 SVG 折线用的点（最多 `points` 段）。 */
export function curvePath(curve: readonly number[], width: number, height: number, points = 120): string {
  if (curve.length < 2) return '';
  const step = Math.max(1, Math.ceil(curve.length / points));
  const sampled: number[] = [];
  for (let i = 0; i < curve.length; i += step) sampled.push(curve[i]);
  if (sampled[sampled.length - 1] !== curve[curve.length - 1]) sampled.push(curve[curve.length - 1]);
  const min = Math.min(...sampled), max = Math.max(...sampled), span = max - min || 1;
  return sampled.map((value, index) => `${index === 0 ? 'M' : 'L'}${(index / (sampled.length - 1) * width).toFixed(1)},${(height - (value - min) / span * height).toFixed(1)}`).join(' ');
}
const pad2 = (value: number) => String(value).padStart(2, '0');
/** 成交明细 CSV（含表头，可直接进 Excel）。 */
export function fillsCsv(fills: readonly Fill[], symbol: string, unit = 'USDT'): string {
  const rows = fills.map(fill => {
    const stamp = new Date((fill.time + 8 * 3600) * 1000);
    const time = `${stamp.getUTCFullYear()}-${pad2(stamp.getUTCMonth() + 1)}-${pad2(stamp.getUTCDate())} ${pad2(stamp.getUTCHours())}:${pad2(stamp.getUTCMinutes())}`;
    // U 本位：手续费保留 4 位、盈亏 2 位；币本位：都保留 8 位（否则小额币值会被抹平）。
    const feeDigits = unit === 'USDT' ? 4 : 8, pnlDigits = unit === 'USDT' ? 2 : 8;
    return [symbol, time, fill.side === 'buy' ? '买入' : '卖出', fill.dir === 'long' ? '多' : '空', fill.action, fill.reason, fill.qty, fill.price.toFixed(2), fill.fee.toFixed(feeDigits), fill.realized.toFixed(pnlDigits)].join(',');
  });
  return [`合约,时间(UTC+8),方向,持仓,动作,原因,数量,价格,手续费(${unit}),已实现盈亏(${unit})`, ...rows].join('\n');
}
export const statsCsv = (stats: TradeStats, symbol: string, unit = 'USDT'): string => [
  `# ${symbol} 复盘统计（结算单位：${unit}）`,
  `成交笔数,${stats.trades}`,
  `胜率,${(stats.winRate * 100).toFixed(1)}%`,
  `盈利因子,${Number.isFinite(stats.profitFactor) ? stats.profitFactor.toFixed(2) : '∞'}`,
  `平均盈利,${stats.avgWin.toFixed(2)}`,
  `平均亏损,${stats.avgLoss.toFixed(2)}`,
  `最大回撤,${stats.maxDrawdown.toFixed(2)} (${(stats.maxDrawdownPct * 100).toFixed(2)}%)`,
  `手续费,${stats.fees.toFixed(unit === 'USDT' ? 2 : 8)}`,
  `资金费,${stats.funding.toFixed(unit === 'USDT' ? 2 : 8)}`,
  `平均持仓,${stats.avgHoldingMinutes.toFixed(1)} 分钟`,
  `多单,${stats.longTrades} 笔 / ${stats.longPnl.toFixed(2)}`,
  `空单,${stats.shortTrades} 笔 / ${stats.shortPnl.toFixed(2)}`,
  `是否爆仓,${stats.liquidated ? '是' : '否'}`,
].join('\n');
