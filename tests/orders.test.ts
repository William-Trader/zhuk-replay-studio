import { describe, it, expect } from 'vitest';
import { derive, nextSeq, orderTrigger, protectionTrigger, reducesPosition, trailingLevel, type MarketEvent, type Order, type OrderAction } from '../src/orders';
import { defaultSimConfig, newAccount, type SimConfig } from '../src/model';
import type { Candle } from '../src/market';

// 测试默认关掉冲击滑点（滑点模型本身在 model.test 里单独断言）。
const cfg = (over: Partial<SimConfig> = {}): SimConfig => ({ ...defaultSimConfig, leverage: 10, slippageBps: 0, impactBps: 0, takerBps: 0, makerBps: 0, fundingRate8h: 0, tickSize: .1, ...over });
const bar = (time: number, open: number, high: number, low: number, close: number): Candle => ({ time, open, high, low, close, volume: 1 });
const flat = (time: number, price: number) => bar(time, price, price + 1, price - 1, price);
const order = (over: Partial<Order> = {}): Order => ({ id: 'o1', seq: 1, side: 'buy', type: 'limit', qty: 1, price: 100, createdCursor: 0, ...over });
const event = (over: Partial<MarketEvent> = {}): MarketEvent => ({ id: 'e1', seq: 1, time: 60, side: 'buy', qty: 1, price: 100, ...over });

describe('order triggers along the intrabar path', () => {
  const rising = bar(60, 100, 110, 95, 105);
  it('fills a buy limit at the level, or better at the open after a gap', () => {
    expect(orderTrigger(order({ type: 'limit', side: 'buy', price: 98 }), rising, cfg())).toBe(98);
    expect(orderTrigger(order({ type: 'limit', side: 'buy', price: 101 }), rising, cfg())).toBe(100);
    expect(orderTrigger(order({ type: 'limit', side: 'buy', price: 90 }), rising, cfg())).toBeNull();
  });
  it('fills buys on stops and sells on both kinds', () => {
    expect(orderTrigger(order({ type: 'stop', side: 'buy', price: 108 }), rising, cfg())).toBe(108);
    expect(orderTrigger(order({ type: 'stop', side: 'buy', price: 99 }), rising, cfg())).toBe(100);
    expect(orderTrigger(order({ type: 'limit', side: 'sell', price: 108 }), rising, cfg())).toBe(108);
    expect(orderTrigger(order({ type: 'limit', side: 'sell', price: 99 }), rising, cfg())).toBe(100);
    expect(orderTrigger(order({ type: 'stop', side: 'sell', price: 96 }), rising, cfg())).toBe(96);
    // 卖出止损挂在市价上方：价格已在触发价之下 → 开盘即触发
    expect(orderTrigger(order({ type: 'stop', side: 'sell', price: 112 }), rising, cfg())).toBe(100);
  });
  it('walks the falling path too', () => {
    const falling = bar(60, 105, 110, 95, 98);
    expect(orderTrigger(order({ type: 'limit', side: 'buy', price: 100 }), falling, cfg())).toBe(100);
    expect(orderTrigger(order({ type: 'stop', side: 'sell', price: 100 }), falling, cfg())).toBe(100);
    expect(orderTrigger(order({ type: 'limit', side: 'sell', price: 108 }), falling, cfg())).toBe(108);
  });
  it('moves a trailing trigger with the extreme', () => {
    const trail = { side: 'sell' as const, trailBps: 100 };
    expect(trailingLevel(trail as Order, 200)).toBe(198);
    expect(trailingLevel({ side: 'buy', trailBps: 100 } as Order, 100)).toBe(101);
    expect(trailingLevel(trail as Order, undefined)).toBeUndefined();
  });
});

describe('position protection', () => {
  const cfg_ = cfg();
  it('triggers the stop first when the path hits both levels', () => {
    const protection = { sl: 95, tp: 110 };
    expect(protectionTrigger(protection, bar(60, 100, 115, 94, 100), 'long', cfg_)).toEqual({ reason: 'sl', price: 95 });
    expect(protectionTrigger(protection, bar(60, 100, 115, 99, 100), 'long', cfg_)).toEqual({ reason: 'tp', price: 110 });
    expect(protectionTrigger(protection, bar(60, 100, 104, 99, 100), 'long', cfg_)).toBeNull();
  });
  it('handles shorts and gaps', () => {
    expect(protectionTrigger({ sl: 105 }, bar(60, 100, 108, 99, 100), 'short', cfg_)).toEqual({ reason: 'sl', price: 105 });
    expect(protectionTrigger({ tp: 90 }, bar(60, 100, 101, 88, 100), 'short', cfg_)).toEqual({ reason: 'tp', price: 90 });
    // 开盘就跳空越过止损 → 按开盘价成交
    expect(protectionTrigger({ sl: 99 }, bar(60, 110, 112, 108, 111), 'short', cfg_)).toEqual({ reason: 'sl', price: 110 });
  });
});

describe('replay engine', () => {
  const bars = [flat(60, 100), flat(120, 100), flat(180, 100), flat(240, 100), flat(300, 100)];
  it('opens a long from a market event and closes it later', () => {
    const config = cfg();
    const events = [event({ seq: 1, time: 60, side: 'buy', qty: 1, price: 100 }), event({ id: 'e2', seq: 2, time: 180, side: 'sell', qty: 1, price: 100 })];
    const state = derive(config, events, [], bars, 5);
    expect(state.account.position).toBeNull();
    expect(state.fills.map(fill => fill.action)).toEqual(['open', 'close']);
    expect(state.equityCurve).toHaveLength(5);
  });
  it('opens a short when selling without a position', () => {
    const state = derive(cfg(), [event({ side: 'sell', qty: 1, price: 100 })], [], bars, 1);
    expect(state.account.position).toMatchObject({ side: 'short', qty: 1 });
  });
  it('fills a working limit only on the triggering candle and never before its cursor', () => {
    const config = cfg();
    const log: OrderAction[] = [{ kind: 'place', seq: 1, order: order({ price: 95, createdCursor: 3 }) }];
    const bars_ = [bar(60, 100, 101, 94, 100), bar(120, 100, 101, 94, 100), bar(180, 100, 101, 94, 100), bar(240, 100, 101, 94, 100)];
    expect(derive(config, [], log, bars_, 3).orders[0].status).toBe('working');
    const filled = derive(config, [], log, bars_, 4);
    expect(filled.orders[0]).toMatchObject({ status: 'filled', fillPrice: 95 });
    expect(filled.account.position).toMatchObject({ side: 'long', entry: 95 });
  });
  it('keeps a reduce-only order working while it would open a position', () => {
    const config = cfg();
    const log: OrderAction[] = [{ kind: 'place', seq: 1, order: order({ side: 'sell', type: 'limit', price: 105, reduceOnly: true }) }];
    const state = derive(config, [], log, [bar(60, 100, 106, 99, 100)], 1);
    expect(state.orders[0].status).toBe('working');
    expect(state.account.position).toBeNull();
  });
  it('cancels at the current cursor and stays working before the cancel', () => {
    const config = cfg();
    const log: OrderAction[] = [{ kind: 'place', seq: 1, order: order({ price: 92.5 }) }, { kind: 'cancel', seq: 2, orderId: 'o1', cursor: 2 }];
    const bars_ = [bar(60, 100, 101, 95, 100), bar(120, 100, 101, 94, 100)];
    expect(derive(config, [], log, bars_, 1).orders[0].status).toBe('working');
    const cancelled = derive(config, [], log, bars_, 2);
    expect(cancelled.orders[0].status).toBe('cancelled');
    expect(cancelled.account.position).toBeNull();
  });
  it('closes on a stop-loss set with the position', () => {
    const config = cfg();
    const events = [event({ seq: 1, time: 60, side: 'buy', qty: 1, price: 100 })];
    const log: OrderAction[] = [{ kind: 'protect', seq: 2, time: 60, sl: 95, tp: 120 }];
    const bars_ = [flat(60, 100), bar(120, 100, 101, 93, 96)];
    const state = derive(config, events, log, bars_, 2);
    expect(state.account.position).toBeNull();
    expect(state.fills.at(-1)).toMatchObject({ reason: 'sl', action: 'close' });
    expect(state.protection).toBeNull();
  });
  it('takes profit and reports the active protection while the position lives', () => {
    const config = cfg();
    const events = [event({ seq: 1, time: 60, side: 'buy', qty: 1, price: 100 })];
    const log: OrderAction[] = [{ kind: 'protect', seq: 2, time: 60, tp: 110, trailBps: 200 }];
    const open = derive(config, events, log, [flat(60, 100), bar(120, 100, 105, 99, 104)], 2);
    expect(open.account.position).not.toBeNull();
    expect(open.protection).toMatchObject({ tp: 110, trailBps: 200 });
    const closed = derive(config, events, log, [flat(60, 100), flat(120, 100), bar(180, 100, 112, 99, 111)], 3);
    expect(closed.fills.at(-1)?.reason).toBe('tp');
  });
  it('trails a stop behind the high', () => {
    const config = cfg();
    const events = [event({ seq: 1, time: 60, side: 'buy', qty: 1, price: 100 })];
    const log: OrderAction[] = [{ kind: 'protect', seq: 2, time: 60, trailBps: 500 }];
    const bars_ = [flat(60, 100), bar(120, 100, 120, 99, 118), bar(180, 118, 118, 112, 113)];
    const state = derive(config, events, log, bars_, 3);
    expect(state.fills.at(-1)).toMatchObject({ reason: 'trail', action: 'close' });
  });
  it('settles funding at the 8 hour boundary', () => {
    const config = cfg({ fundingRate8h: .001 });
    const events = [event({ seq: 1, time: 60, side: 'buy', qty: 1, price: 100 })];
    const bars_ = [flat(60, 100), flat(8 * 3600, 100), flat(8 * 3600 + 60, 100)];
    const state = derive(config, events, [], bars_, 3);
    expect(state.account.position).not.toBeNull();
    expect(state.account.funding).toBeLessThan(0);
    const flatOnly = derive(config, [], [], bars_, 3);
    expect(flatOnly.account.funding).toBe(0);
    expect(bars_).toHaveLength(state.equityCurve.length);
  });
  it('liquidates a levered long when the candle dumps', () => {
    const config = cfg({ marginMode: 'isolated', leverage: 20 });
    const events = [event({ seq: 1, time: 60, side: 'buy', qty: 1, price: 100 })];
    const bars_ = [flat(60, 100), bar(120, 100, 101, 80, 85)];
    const state = derive(config, events, [], bars_, 2);
    expect(state.account.position).toBeNull();
    expect(state.account.liquidated).toBe(true);
    expect(state.liquidatedAt).toBe(120);
    expect(state.fills.at(-1)?.reason).toBe('liquidation');
  });
  it('never liquidates a 1x long on a shallow dip', () => {
    const config = cfg({ leverage: 1, marginMode: 'cross' });
    const events = [event({ seq: 1, time: 60, side: 'buy', qty: 1, price: 100 })];
    const state = derive(config, events, [], [flat(60, 100), bar(120, 100, 101, 70, 72)], 2);
    expect(state.account.position).not.toBeNull();
    expect(state.account.liquidated).toBe(false);
  });
  it('adds, reduces and reverses through market events', () => {
    const config = cfg();
    const bars_ = [flat(60, 100), flat(120, 110), flat(180, 120)];
    const events = [
      event({ seq: 1, time: 60, side: 'buy', qty: 1, price: 100 }),
      event({ id: 'e2', seq: 2, time: 120, side: 'buy', qty: 1, price: 110 }),
      event({ id: 'e3', seq: 3, time: 180, side: 'sell', qty: 2, price: 120 }),
    ];
    const state = derive(config, events, [], bars_, 3);
    expect(state.fills.map(fill => fill.action)).toEqual(['open', 'add', 'close']);
    expect(state.fills.at(-1)?.qty).toBe(2);
    expect(state.account.position).toBeNull();
  });
  it('flips to a short when the sell is bigger than the long', () => {
    const config = cfg();
    const events = [
      event({ seq: 1, time: 60, side: 'buy', qty: 2, price: 100 }),
      event({ id: 'e2', seq: 2, time: 120, side: 'sell', qty: 3, price: 110 }),
    ];
    const state = derive(config, events, [], [flat(60, 100), flat(120, 110)], 2);
    expect(state.fills.map(fill => fill.action)).toEqual(['open', 'close', 'open']);
    expect(state.account.position).toMatchObject({ side: 'short', qty: 1, entry: 110 });
  });
  it('keeps sequence numbers shared by events and orders', () => {
    expect(nextSeq([event({ seq: 4 })], [{ kind: 'place', seq: 9, order: order() }])).toBe(10);
    expect(reducesPosition(newAccount(cfg()), 'sell')).toBe(false);
  });
});
