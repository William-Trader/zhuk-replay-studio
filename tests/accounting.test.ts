import { describe, expect, it } from 'vitest';
import { applyFunding, closePosition, defaultSimConfig, equityOf, newAccount, openPosition, unrealizedOf } from '../src/model';
import { derive, type MarketEvent } from '../src/orders';

/** 账目恒等式（引擎必须永远成立）：
 *  权益（含浮动） == 期初权益 + 已实现盈亏 + 资金费 − 手续费 + 浮动盈亏
 *  等价于：可用现金 + 占用保证金 == 期初权益 + 已实现 + 资金费 − 手续费
 *  这条等式是"加仓后权益波动是否可信"的判据。 */
const identity = (account: ReturnType<typeof newAccount>, config: typeof defaultSimConfig, price: number) => {
  const equity = equityOf(account, price, config);
  const expected = config.equity + account.realized + account.funding - account.fees + unrealizedOf(account.position, price, config);   // 已实现为毛额，手续费单列
  return { equity, expected, gap: equity - expected };
};

describe('accounting identity', () => {
  const config = { ...defaultSimConfig, equity: 10000, leverage: 3, takerBps: 8, makerBps: 2 };

  it('holds for a single open', () => {
    const opened = openPosition(newAccount(config), config, { side: 'buy', qty: .03, price: 74000, time: 1 });
    if (!opened.ok) throw new Error(opened.message);
    const { gap } = identity(opened.account, config, 74000);
    expect(Math.abs(gap)).toBeLessThan(1e-6);
  });

  it('holds across repeated adds at different prices', () => {
    let account = newAccount(config);
    const prices = [74000, 74500, 73800];
    for (let index = 0; index < prices.length; index++) {
      const opened = openPosition(account, config, { side: 'buy', qty: .03, price: prices[index], time: index + 1 });
      if (!opened.ok) throw new Error(opened.message);
      account = opened.account;
      const { gap } = identity(account, config, prices[index]);
      expect({ step: index, gap }).toEqual({ step: index, gap: expect.closeTo(0, 6) });
    }
  });

  it('holds when funding is applied between adds', () => {
    let account = newAccount(config);
    for (let index = 0; index < 3; index++) {
      const opened = openPosition(account, config, { side: 'buy', qty: .03, price: 74000, time: index * 10 + 1 });
      if (!opened.ok) throw new Error(opened.message);
      account = opened.account;
      // 负费率：多头收取资金费（余额增加），这会同时进入 balance 与 account.funding
      account = applyFunding(account, config, 74000, 1, -.0001);
      const { gap } = identity(account, config, 74000);
      expect({ step: index, gap }).toEqual({ step: index, gap: expect.closeTo(0, 6) });
    }
  });

  it('holds along the replayed path (derive) with funding between bars', () => {
    // 复盘路径才是用户实际走的链路：逐bar重放时手续费/资金费/加仓都必须守恒。
    const bars = Array.from({ length: 40 }, (_, index) => ({
      time: 1_700_000_000 + index * 300, open: 74000 + index * 5, high: 74100 + index * 5, low: 73900 + index * 5, close: 74000 + index * 5, volume: 120,
    }));
    const events: MarketEvent[] = [0, 1, 2].map(index => ({
      id: `e${index}`, seq: index + 1, time: bars[10 + index * 5].time, side: 'buy' as const, qty: .03, price: bars[10 + index * 5].close,
    }));
    const state = derive(config, events, [], bars, bars.length);
    const price = bars[bars.length - 1].close;
    const { gap } = identity(state.account, config, price);
    expect(gap).toBeCloseTo(0, 6);
    expect(state.account.position?.qty).toBeCloseTo(.09, 10);
  });

  it('holds after a partial close', () => {
    const opened = openPosition(newAccount(config), config, { side: 'buy', qty: .09, price: 74000, time: 1 });
    if (!opened.ok) throw new Error(opened.message);
    const reduced = closePosition(opened.account, config, { side: 'sell', qty: .03, price: 75000, time: 2 });
    if (!reduced.ok) throw new Error(reduced.message);
    const { gap } = identity(reduced.account, config, 75000);
    expect(Math.abs(gap)).toBeLessThan(1e-6);
  });
});
