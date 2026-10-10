import { describe, it, expect } from 'vitest';
import { aggregate, buildRecord, detectStyle, emptyHistoryStore, equityBySession, sanitizeHistoryStore, sanitizeRecords, type SessionRecord } from '../src/history';
import { defaultSimConfig } from '../src/model';
import type { Fill } from '../src/model';

const fill = (over: Partial<Fill> = {}): Fill => ({ id: 'f', time: 0, price: 100, qty: 1, side: 'sell', dir: 'long', action: 'close', reason: 'market', fee: .1, realized: 1, ...over });
const stats = (over: Partial<Parameters<typeof buildRecord>[0]['stats']> = {}) => ({
  trades: 4, wins: 3, losses: 1, realized: 12, fees: .4, funding: -.1, maxDrawdown: 5, winRate: .75,
  profitFactor: 2, best: 8, worst: -3, longTrades: 3, longPnl: 10, shortTrades: 1, shortPnl: 2, avgHoldingMinutes: 45, liquidated: false, ...over,
});
const record = (over: Partial<SessionRecord> = {}): SessionRecord => ({
  id: 'r1', at: 1_789_000_000_000, symbol: 'BTCUSDT', interval: '15m', minutes: 30, bars: 200,
  trades: 4, wins: 3, losses: 1, realized: 12, fees: .4, funding: -.1, maxDrawdown: 5, winRate: .75, profitFactor: 2,
  best: 8, worst: -3, longTrades: 3, longPnl: 10, shortTrades: 1, shortPnl: 2, avgHoldingMinutes: 45, alerts: 2, liquidated: false,
  leverage: 3, marginMode: 'cross', settle: 'usdt', slCount: 2, tpCount: 1, liquidationCount: 0, ...over,
});

describe('session records', () => {
  it('builds a record from a finished session, counting stop/target/liquidation reasons', () => {
    const built = buildRecord({
      id: 's1', at: 123, symbol: 'BTCUSDT', interval: '15m', minutes: 30, bars: 200, stats: stats(), alerts: 3,
      config: { ...defaultSimConfig, leverage: 5, marginMode: 'isolated', settle: 'coin' },
      fills: [fill({ reason: 'sl' }), fill({ reason: 'tp' }), fill({ reason: 'trail' }), fill({ reason: 'liquidation' })],
    });
    expect(built).toMatchObject({ id: 's1', symbol: 'BTCUSDT', trades: 4, realized: 12, alerts: 3, leverage: 5, marginMode: 'isolated', settle: 'coin', slCount: 1, tpCount: 2, liquidationCount: 1 });
    expect(buildRecord({ id: 's2', at: 1, symbol: 'X', interval: '1h', minutes: 1, bars: 1, stats: stats({ profitFactor: Number.POSITIVE_INFINITY }), alerts: 0, config: defaultSimConfig, fills: [] }).profitFactor).toBe(0);
  });

  it('aggregates the whole history', () => {
    const records = [record(), record({ id: 'r2', realized: -4, wins: 1, losses: 3, best: 2, worst: -6, longPnl: 1, shortPnl: -5, trades: 4 })];
    const totals = aggregate(records);
    expect(totals).toMatchObject({ sessions: 2, trades: 8, wins: 4, losses: 4, realized: 8, alerts: 4, liquidations: 0 });
    expect(totals.winRate).toBeCloseTo(.5, 6);
    expect(totals.profitFactor).toBeCloseTo(12 / 4, 6);
    expect(totals.avgLeverage).toBe(3);
    expect(totals.avgTradesPerSession).toBe(4);
    expect(totals.streakKind).toBe('loss');
    expect(totals.streak).toBe(1);
    expect(equityBySession(records)).toEqual([12, 8]);
    expect(aggregate([]).sessions).toBe(0);
    expect(equityBySession([])).toEqual([]);
  });

  it('counts profitable and losing streaks from the end', () => {
    const records = [record({ id: 'a', realized: -1 }), record({ id: 'b', realized: 2 }), record({ id: 'c', realized: 3 })];
    expect(aggregate(records)).toMatchObject({ streakKind: 'win', streak: 2 });
  });
});

describe('style detection', () => {
  it('stays empty without records', () => {
    expect(detectStyle([])).toEqual([]);
  });
  it('recognises direction, holding, frequency, risk, structure and discipline', () => {
    const tags = detectStyle([record({ avgHoldingMinutes: 20, leverage: 12, slCount: 3, tpCount: 2, liquidated: true, liquidationCount: 1, realized: 30, trades: 8, wins: 7, losses: 1, winRate: .875, alerts: 9 })]);
    const ids = tags.map(tag => tag.id);
    expect(ids).toContain('long-bias');
    expect(ids).toContain('scalp');
    expect(ids).toContain('high-freq');
    expect(ids).toContain('aggressive');
    expect(ids).toContain('stop-discipline');
    expect(ids).toContain('take-profit');
    expect(ids).toContain('signal-driven');
    expect(tags.every(tag => tag.label && tag.detail && ['positive', 'neutral', 'warning'].includes(tag.tone))).toBe(true);
  });
  it('flags conservative双向 balanced traders and weak discipline', () => {
    const tags = detectStyle([record({ longTrades: 5, shortTrades: 5, leverage: 2, marginMode: 'cross', slCount: 0, tpCount: 0, trades: 12, wins: 5, losses: 7, winRate: .42, profitFactor: .8, realized: -20, alerts: 0, avgHoldingMinutes: 900 })]);
    const ids = tags.map(tag => tag.id);
    expect(ids).toContain('both-ways');
    expect(ids).toContain('position');
    expect(ids).toContain('conservative');
    expect(ids).toContain('no-stop');
    expect(ids).not.toContain('aggressive');
  });
});

describe('history store guards', () => {
  it('drops malformed records and keeps valid ones', () => {
    const clean = sanitizeRecords([null, 'junk', { id: 'x' }, record(), { id: 'y', at: Number.NaN }]);
    expect(clean).toHaveLength(1);
    expect(clean[0].id).toBe('r1');
    expect(clean[0].marginMode).toBe('cross');
    expect(clean[0].settle).toBe('usdt');
  });
  it('falls back to an empty store for foreign payloads', () => {
    expect(sanitizeHistoryStore(null)).toEqual(emptyHistoryStore());
    expect(sanitizeHistoryStore({ version: 2, records: [record()] })).toEqual(emptyHistoryStore());
    expect(sanitizeHistoryStore({ version: 1, records: [record()] }).records).toHaveLength(1);
  });
  it('caps the stored history', () => {
    const many = Array.from({ length: 600 }, (_, index) => record({ id: `r${index}` }));
    expect(sanitizeRecords(many)).toHaveLength(500);
  });
});
