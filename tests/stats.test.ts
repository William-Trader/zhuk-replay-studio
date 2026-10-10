import { describe, it, expect } from 'vitest';
import { closedTrades, curvePath, drawdown, emptyStats, fillsCsv, statsCsv, tradeStats } from '../src/stats';
import type { Fill } from '../src/model';

const fill = (over: Partial<Fill> = {}): Fill => ({ id: 'f', time: 0, price: 100, qty: 1, side: 'buy', dir: 'long', action: 'open', reason: 'market', fee: 0, realized: 0, ...over });

describe('closed trade pairing', () => {
  it('pairs an open with its close and keeps the entry time', () => {
    const trades = closedTrades([
      fill({ time: 100, action: 'open' }),
      fill({ time: 200, action: 'close', side: 'sell', realized: 15 }),
    ]);
    expect(trades).toHaveLength(1);
    expect(trades[0]).toMatchObject({ pnl: 15, openedAt: 100, closedAt: 200, complete: true, dir: 'long' });
  });
  it('treats each partial reduce as its own trade and keeps the entry for the rest', () => {
    const trades = closedTrades([
      fill({ time: 100, action: 'open' }),
      fill({ time: 150, action: 'reduce', side: 'sell', qty: .5, realized: 5 }),
      fill({ time: 200, action: 'close', side: 'sell', qty: .5, realized: 8 }),
    ]);
    expect(trades.map(trade => trade.pnl)).toEqual([5, 8]);
    expect(trades.map(trade => trade.complete)).toEqual([false, true]);
    expect(trades[1].openedAt).toBe(100);
  });
  it('ignores fills without an open', () => {
    expect(closedTrades([fill({ action: 'close', realized: 3 })])).toHaveLength(1);
    expect(closedTrades([])).toHaveLength(0);
  });
});

describe('drawdown and stats', () => {
  it('measures the deepest drop from a peak', () => {
    expect(drawdown([100, 120, 90, 130, 110])).toEqual({ maxDrawdown: 30, maxDrawdownPct: .25, peakEquity: 130 });
    expect(drawdown([])).toMatchObject({ maxDrawdown: 0, peakEquity: 0 });
    expect(drawdown([5, 4, 3]).maxDrawdownPct).toBeCloseTo(.4, 6);
  });
  it('summarises wins, losses, profit factor and sides', () => {
    const fills = [
      fill({ time: 0, action: 'open', fee: 1, dir: 'long' }),
      fill({ time: 60, action: 'close', side: 'sell', realized: 30, fee: 1, dir: 'long' }),
      fill({ time: 120, action: 'open', side: 'sell', dir: 'short', fee: 1 }),
      fill({ time: 180, action: 'close', side: 'buy', realized: -10, fee: 1, dir: 'short' }),
      fill({ time: 240, action: 'open', dir: 'long', fee: 1 }),
      fill({ time: 300, action: 'close', side: 'sell', realized: 5, fee: 1, dir: 'long' }),
    ];
    const stats = tradeStats(fills, [10_000, 10_030, 10_020, 10_025], -2, false);
    expect(stats).toMatchObject({ trades: 3, wins: 2, losses: 1, longTrades: 2, shortTrades: 1, fees: 6, funding: -2, liquidated: false });
    expect(stats.winRate).toBeCloseTo(2 / 3, 6);
    expect(stats.grossProfit).toBe(35);
    expect(stats.grossLoss).toBe(-10);
    expect(stats.profitFactor).toBeCloseTo(3.5, 6);
    expect(stats.best).toBe(30);
    expect(stats.worst).toBe(-10);
    expect(stats.longPnl).toBe(35);
    expect(stats.shortPnl).toBe(-10);
    expect(stats.realized).toBe(25);
    expect(stats.maxDrawdown).toBe(10);
    expect(stats.avgHoldingMinutes).toBeCloseTo(1, 6);
  });
  it('handles a trade-free account', () => {
    expect(tradeStats([], [], 0, false)).toEqual(emptyStats());
    expect(tradeStats([], []).profitFactor).toBe(0);
  });
  it('reports an infinite profit factor when nothing loses', () => {
    const stats = tradeStats([fill({ action: 'open' }), fill({ action: 'close', side: 'sell', realized: 7 })], [1, 2]);
    expect(stats.profitFactor).toBe(Infinity);
    expect(stats.avgLoss).toBe(0);
  });
});

describe('chart and export helpers', () => {
  it('builds a normalised SVG path', () => {
    const path = curvePath([1, 3, 2, 4], 100, 10, 10);
    expect(path.startsWith('M0.0,10.0')).toBe(true);
    expect(path.split(' ')).toHaveLength(4);
    expect(curvePath([1], 100, 10)).toBe('');
    expect(curvePath([], 100, 10)).toBe('');
  });
  it('samples long curves down to the requested resolution', () => {
    const curve = Array.from({ length: 500 }, (_, index) => 100 + index);
    expect(curvePath(curve, 120, 40, 30).split(' ').length).toBeLessThanOrEqual(32);
  });
  it('exports fills and stats as CSV', () => {
    const csv = fillsCsv([fill({ time: 1788881340, qty: .5, price: 76_543.21, fee: .02, realized: 12.5 })], 'BTCUSDT');
    const [head, row] = csv.split('\n');
    expect(head).toContain('合约,时间(UTC+8)');
    expect(head).toContain('手续费(USDT)');
    expect(row).toBe('BTCUSDT,2026-09-08 23:29,买入,多,open,market,0.5,76543.21,0.0200,12.50');
    expect(statsCsv(tradeStats([], [], -1, true), 'ETHUSDT')).toContain('是否爆仓,是');
    // 币本位：表头与精度都换成结算币
    const coinCsv = fillsCsv([fill({ time: 1788881340, qty: 2, price: 76_543.21, fee: .0000013, realized: .0002 })], 'BTCUSD', 'BTC');
    expect(coinCsv.split('\n')[0]).toContain('手续费(BTC)');
    expect(coinCsv.split('\n')[1]).toContain('0.00000130,0.00020000');
    expect(statsCsv(tradeStats([], []), 'BTCUSD', 'BTC')).toContain('结算单位：BTC');
  });
});
