import { describe, it, expect } from 'vitest';
import { ASSET_CLASSES, classLabel, classOfFuturesKind, classify, COMMODITY_INSTRUMENTS, FOREX_INSTRUMENTS, futuresKindOf, isReady, marketKindOf, parseFxPair, snapshotInstruments, staticInstruments, synthesiseOhlc } from '../src/universe';

describe('asset classes', () => {
  it('declares crypto, commodity and forex as live and equities as pending', () => {
    expect(ASSET_CLASSES.map(item => item.id)).toEqual(['crypto-spot', 'crypto-perp', 'equity', 'hk-equity', 'other-equity', 'index', 'commodity', 'forex']);
    // Binance 合约里确实有美股/港股/韩A股/指数/大宗，全部接通
    for (const item of ASSET_CLASSES) expect(isReady(item.id)).toBe(true);
    expect(classLabel('forex')).toBe('外汇');
    for (const item of ASSET_CLASSES) { expect(item.label.length).toBeGreaterThan(0); expect(item.source.length).toBeGreaterThan(0); }
  });
  it('routes symbols to the right class', () => {
    expect(classify('BTCUSDT', 'spot')).toBe('crypto-spot');
    expect(classify('BTCUSDT', 'futures')).toBe('crypto-perp');
    expect(classify('AAPLUSDT', 'futures')).toBe('equity');
    expect(classify('XAUUSDT', 'futures')).toBe('commodity');
    expect(futuresKindOf('AAPLUSDT')).toBe('EQUITY');
    expect(classOfFuturesKind('HK_EQUITY')).toBe('hk-equity');
    expect(classOfFuturesKind('KR_EQUITY')).toBe('other-equity');
    expect(classOfFuturesKind('COMMODITY')).toBe('commodity');
    expect(classOfFuturesKind('PREMARKET')).toBe('equity');
    expect(classify('PAXGUSDT', 'spot')).toBe('commodity');
    expect(classify('PAXGUSDC', 'spot')).toBe('commodity');
    expect(classify('ETHUSDT', 'spot')).toBe('crypto-spot');
  });
  it('ships curated commodity, forex, equity and index lists', () => {
    expect(COMMODITY_INSTRUMENTS.some(item => item.symbol === 'PAXGUSDT')).toBe(true);
    expect(staticInstruments('commodity')).toHaveLength(COMMODITY_INSTRUMENTS.length);
    expect(staticInstruments('forex')).toHaveLength(FOREX_INSTRUMENTS.length);
    expect(staticInstruments('crypto-spot')).toEqual([]);
    expect(FOREX_INSTRUMENTS.every(item => parseFxPair(item.symbol) !== null)).toBe(true);
    expect(snapshotInstruments('crypto-perp').every(item => item.base && item.quote === 'USDT')).toBe(true);
    expect(snapshotInstruments('equity').length).toBeGreaterThanOrEqual(150);
    expect(snapshotInstruments('equity').some(item => item.symbol === 'AAPLUSDT')).toBe(true);
    expect(snapshotInstruments('hk-equity').some(item => item.symbol === 'TENCENTUSDT' || item.symbol === 'HK0700USDT')).toBe(true);
    expect(snapshotInstruments('other-equity').some(item => item.symbol === 'SAMSUNGUSDT')).toBe(true);
    expect(snapshotInstruments('commodity').map(item => item.symbol)).toEqual(expect.arrayContaining(['XAUUSDT', 'XAGUSDT', 'CLUSDT', 'NATGASUSDT', 'COPPERUSDT']));
    expect(snapshotInstruments('crypto-perp').length).toBeGreaterThan(500);
    // 老存档没记市场类型时，用品种名猜一个更可能对的接口先试
    expect(marketKindOf('EURUSD')).toBe('fx');
    expect(marketKindOf('AAPLUSDT')).toBe('futures');
    expect(marketKindOf('TENCENTUSDT')).toBe('futures');
    expect(marketKindOf('NOTAREALSYM')).toBe('spot');
    expect(snapshotInstruments('index').length).toBeGreaterThan(0);
  });
});

describe('forex helpers', () => {
  it('parses six-letter pairs only', () => {
    expect(parseFxPair('eurusd')).toEqual({ base: 'EUR', quote: 'USD' });
    expect(parseFxPair('USD/JPY')).toEqual({ base: 'USD', quote: 'JPY' });
    expect(parseFxPair('BTCUSDT')).toBeNull();
    expect(parseFxPair('EU')).toBeNull();
    expect(parseFxPair('')).toBeNull();
  });
  it('synthesises OHLC from a daily close series (open = previous close)', () => {
    const bars = synthesiseOhlc([
      { date: '2026-09-15', rate: 1.1 },
      { date: '2026-09-16', rate: 1.2 },
      { date: '2026-09-17', rate: 1.15 },
    ]);
    expect(bars).toHaveLength(3);
    expect(bars[0]).toMatchObject({ open: 1.1, close: 1.1, high: 1.1, low: 1.1 });
    expect(bars[1]).toMatchObject({ open: 1.1, close: 1.2, high: 1.2, low: 1.1 });
    expect(bars[2]).toMatchObject({ open: 1.2, close: 1.15, high: 1.2, low: 1.15 });
    expect(bars.every(bar => bar.volume === 0 && bar.close > 0)).toBe(true);
    expect(bars[0].time).toBeLessThan(bars[1].time);
  });
  it('drops unusable rows', () => {
    expect(synthesiseOhlc([{ date: 'nope', rate: 1 }, { date: '2026-09-16', rate: Number.NaN }])).toEqual([]);
  });
});
