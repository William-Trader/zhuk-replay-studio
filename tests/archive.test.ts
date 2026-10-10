import { describe, expect, it } from 'vitest';
import {
  appendArchive, archiveCsv, archiveCurve, archiveFileName, archiveGroups, archiveStamp, archiveTotals, archiveUnits,
  createArchiveEntry, entryWinRate, MAX_ARCHIVE_ENTRIES, marketBreakdown, profitFactorOf, profitFactorText,
  sanitizeArchive, sanitizeArchiveEntry, unitDigits, type ArchiveEntry,
} from '../src/archive';
import { defaultSimConfig } from '../src/model';
import type { SessionStats } from '../src/session';
import { tradeStats, type TradeStats } from '../src/stats';

const entry = (over: Partial<ArchiveEntry> = {}): ArchiveEntry => ({
  id: 'a1', at: 1_700_000_000_000, market: 'BTCUSDT', interval: '15分', minutes: 10, bars: 200, unit: 'USDT',
  startEquity: 10_000, equity: 10_010, trades: 2, wins: 1, losses: 1, grossProfit: 30, grossLoss: -20,
  realized: 10, fees: 1, funding: 0, best: 30, worst: -20, longTrades: 1, longPnl: 30, shortTrades: 1, shortPnl: -20,
  maxDrawdown: 5, maxDrawdownPct: .0005, avgHoldingMinutes: 4, liquidated: false, alerts: 0,
  ...over,
});

describe('archive entries', () => {
  it('turns one finished session into a stored record', () => {
    const stats: SessionStats = { minutes: 12, bars: 180, fills: 2, buys: 1, sells: 1, realized: 25, equity: 10_025, gained: 25, curve: [], alerts: 2, alertLines: ['金叉'] };
    const trade = tradeStats([
      { id: 'f1', time: 0, price: 100, qty: 1, side: 'buy', dir: 'long', action: 'open', reason: 'market', fee: 1, realized: 0 },
      { id: 'f2', time: 60, price: 130, qty: 1, side: 'sell', dir: 'long', action: 'close', reason: 'market', fee: 1, realized: 28 },
    ], [10_000, 10_028]);
    const record = createArchiveEntry({ session: stats, trade, market: 'ETHUSDT', interval: '1小时', unit: 'USDT', startEquity: 10_000, endEquity: 10_025, at: 999, id: 'fixed' });
    // 已实现盈亏取自成交流水（28），不取复盘 HUD 的实时读数
    expect(record).toMatchObject({ id: 'fixed', at: 999, market: 'ETHUSDT', interval: '1小时', minutes: 12, bars: 180, trades: 1, wins: 1, realized: 28, fees: 2, alerts: 2, unit: 'USDT' });
  });
  it('clamps negative counts and non-finite numbers instead of storing junk', () => {
    const stats = { minutes: -5, bars: Number.NaN, fills: 0, buys: 0, sells: 0, realized: 0, equity: Number.POSITIVE_INFINITY, gained: 0, curve: [], alerts: -3, alertLines: [] } as SessionStats;
    const trade = { ...tradeStats([], []), trades: -2, winners: 0, wins: -1 } as unknown as TradeStats;
    const record = createArchiveEntry({ session: stats, trade, market: 'BTCUSDT', interval: '15分', unit: 'USDT', startEquity: Number.NaN, endEquity: 1 });
    expect(record.minutes).toBe(0);
    expect(record.bars).toBe(0);
    expect(record.trades).toBe(0);
    expect(record.wins).toBe(0);
    expect(record.alerts).toBe(0);
    expect(record.startEquity).toBe(0);
    expect(Number.isFinite(record.equity)).toBe(true);
  });
  it('derives win rate and profit factor without ever persisting Infinity', () => {
    expect(entryWinRate(entry({ trades: 4, wins: 3 }))).toBe(.75);
    expect(entryWinRate(entry({ trades: 0, wins: 0 }))).toBe(0);
    expect(profitFactorOf(entry({ grossProfit: 30, grossLoss: -10 }))).toBe(3);
    expect(profitFactorOf(entry({ grossProfit: 30, grossLoss: 0 }))).toBe(Infinity);
    expect(profitFactorOf(entry({ grossProfit: 0, grossLoss: 0 }))).toBe(0);
    expect(profitFactorText(Infinity)).toBe('∞');
    expect(profitFactorText(2.5)).toBe('2.50');
    // 落盘的条目里只有原始金额，没有 ∞（JSON 会把 Infinity 变成 null）
    const stored = JSON.stringify(entry({ grossProfit: 30, grossLoss: 0 }));
    expect(stored).not.toContain('null');
    expect(JSON.parse(stored).grossProfit).toBe(30);
  });
  it('uses two decimals for USDT and eight for coin-settled accounts', () => {
    expect(unitDigits('USDT')).toBe(2);
    expect(unitDigits('BTC')).toBe(8);
  });
});

describe('cross-session totals', () => {
  const sessions = [
    entry({ id: 's1', at: 1_000, realized: 50, trades: 4, wins: 3, losses: 1, grossProfit: 80, grossLoss: -30, minutes: 10, fees: 2, funding: 1 }),
    entry({ id: 's2', at: 2_000, realized: -20, trades: 2, wins: 0, losses: 2, grossProfit: 0, grossLoss: -20, minutes: 20, fees: 1, funding: 1 }),
    entry({ id: 's3', at: 3_000, realized: -40, trades: 2, wins: 1, losses: 1, grossProfit: 10, grossLoss: -50, minutes: 30, fees: 3, funding: 2, liquidated: true }),
  ];
  it('sums trades, money, streaks and time', () => {
    const totals = archiveTotals(sessions);
    expect(totals).toMatchObject({
      sessions: 3, trades: 8, wins: 4, losses: 4, realized: -10, fees: 6, funding: 4, minutes: 60,
      bestSession: 50, worstSession: -40, maxWinStreak: 1, maxLossStreak: 2, liquidations: 1, first: 1_000, last: 3_000,
    });
    expect(totals.winRate).toBe(.5);
    expect(totals.profitFactor).toBeCloseTo(90 / 100, 6);
    expect(totals.avgRealized).toBeCloseTo(-10 / 3, 6);
    expect(totals.avgTrades).toBeCloseTo(8 / 3, 6);
  });
  it('measures drawdown on the cumulative curve, not per session', () => {
    // 累计：0 → +50 → +30 → -10，峰值 50，最深跌到 -10，回撤 60（120%）
    expect(archiveCurve(sessions)).toEqual([0, 50, 30, -10]);
    const totals = archiveTotals(sessions);
    expect(totals.maxDrawdown).toBe(60);
    expect(totals.maxDrawdownPct).toBeCloseTo(1.2, 6);
  });
  it('returns a zeroed summary for an empty archive', () => {
    expect(archiveTotals([])).toMatchObject({ sessions: 0, trades: 0, realized: 0, maxDrawdown: 0, maxWinStreak: 0 });
    expect(archiveCurve([])).toEqual([0]);
  });
  it('counts streaks by session sign, ignoring flat sessions', () => {
    const streak = archiveTotals([entry({ id: 'w1', at: 1, realized: 5 }), entry({ id: 'w2', at: 2, realized: 5 }), entry({ id: 'f', at: 3, realized: 0 }), entry({ id: 'w3', at: 4, realized: 5 })]);
    expect(streak.maxWinStreak).toBe(3);
    expect(streak.maxLossStreak).toBe(0);
  });
});

describe('grouping and breakdowns', () => {
  it('never mixes settlement units', () => {
    const entries = [entry({ id: 'u1', unit: 'USDT', at: 1 }), entry({ id: 'c1', unit: 'BTC', at: 2, realized: .001 }), entry({ id: 'u2', unit: 'USDT', at: 3 })];
    expect(archiveUnits(entries)).toEqual(['USDT', 'BTC']);
    const groups = archiveGroups(entries);
    expect(groups.map(group => [group.unit, group.totals.sessions])).toEqual([['USDT', 2], ['BTC', 1]]);
    // 组内按时间升序，保证曲线与回撤口径稳定
    expect(groups[0].entries.map(item => item.id)).toEqual(['u1', 'u2']);
  });
  it('ranks markets by realized pnl', () => {
    const breakdown = marketBreakdown([
      entry({ id: 'b1', market: 'BTCUSDT', realized: -5 }),
      entry({ id: 'e1', market: 'ETHUSDT', realized: 30 }),
      entry({ id: 'e2', market: 'ETHUSDT', realized: 10 }),
    ]);
    expect(breakdown.map(row => row.market)).toEqual(['ETHUSDT', 'BTCUSDT']);
    expect(breakdown[0]).toMatchObject({ sessions: 2, realized: 40 });
  });
});

describe('archive persistence hygiene', () => {
  it('rejects entries with missing or non-numeric fields', () => {
    expect(sanitizeArchiveEntry(null)).toBeNull();
    expect(sanitizeArchiveEntry({ id: 'a' })).toBeNull();
    expect(sanitizeArchiveEntry({ ...entry(), realized: '10' })).toBeNull();
    expect(sanitizeArchiveEntry({ ...entry(), unit: '' })).toBeNull();
    expect(sanitizeArchiveEntry({ ...entry(), at: Number.NaN })).toBeNull();
    expect(sanitizeArchiveEntry(entry())).toMatchObject({ id: 'a1', realized: 10 });
  });
  it('sorts by time, drops junk and caps the archive length', () => {
    const messy = [{ id: 'bad' }, entry({ id: 'late', at: 500 }), entry({ id: 'early', at: 100 })];
    expect(sanitizeArchive(messy).map(item => item.id)).toEqual(['early', 'late']);
    expect(sanitizeArchive('nope')).toEqual([]);
    expect(sanitizeArchive(null)).toEqual([]);
    const many = Array.from({ length: MAX_ARCHIVE_ENTRIES + 25 }, (_, index) => entry({ id: `a${index}`, at: index }));
    const capped = sanitizeArchive(many);
    expect(capped).toHaveLength(MAX_ARCHIVE_ENTRIES);
    expect(capped[0].id).toBe('a25');   // 丢最旧的
    expect(appendArchive(capped, entry({ id: 'newest', at: 9_999 }))).toHaveLength(MAX_ARCHIVE_ENTRIES);
    expect(appendArchive([], entry({ id: 'only' })).map(item => item.id)).toEqual(['only']);
  });
});

describe('archive export', () => {
  it('writes per-unit blocks with totals and one row per session', () => {
    const csv = archiveCsv([entry({ id: 'u1', unit: 'USDT', at: 0 }), entry({ id: 'c1', unit: 'BTC', at: 86_400_000, realized: .5, fees: .01, funding: 0, maxDrawdown: .02 })]);
    expect(csv).toContain('# 训练档案（结算单位：USDT）');
    expect(csv).toContain('# 训练档案（结算单位：BTC）');
    expect(csv).toContain('时间(UTC+8),品种,周期');
    // USDT 块 2 位小数，币本位块 8 位小数
    expect(csv).toContain('BTCUSDT,15分,10,200,2,50.0%,1.50,10.00,1.00,0.00,5.00');
    expect(csv).toContain('BTCUSDT,15分,10,200,2,50.0%,1.50,0.50000000,0.01000000,0.00000000,0.02000000');
  });
  it('formats UTC+8 timestamps for the file name and rows', () => {
    // 2026-01-31T16:00:00Z = 2026-02-01 00:00 UTC+8
    expect(archiveStamp(Date.UTC(2026, 0, 31, 16, 0, 0))).toBe('2026-02-01 00:00');
    expect(archiveFileName(new Date(2026, 0, 31, 9, 5))).toBe('交易训练室-训练档案-20260131-0905.csv');
  });
  it('keeps documented default quantities reachable for the record helper', () => {
    // 档案里的默认口径来自模拟账户配置，避免文档与实现漂移
    expect(defaultSimConfig.settle).toBe('usdt');
  });
});
