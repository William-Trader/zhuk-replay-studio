import { describe, it, expect } from 'vitest';
import { accountValues, applyFunding, baseQtyOf, closePosition, defaultContractSize, defaultSimConfig, equityOf, formatNumber, liquidate, liquidationPriceOf, marginRatioOf, marketPrice, money, newAccount, notionalUsd, openPosition, percentText, priceText, qtyText, quantityStepText, replayFills, reversePosition, round8, roundToTick, sanitizeSimConfig, settleText, settledFee, settledMargin, settledPnl, slippageFor, type Fill, type SimConfig, unrealizedOf } from '../src/model';

const config = (over: Partial<SimConfig> = {}): SimConfig => ({ ...defaultSimConfig, leverage: 10, takerBps: 5, makerBps: 2, slippageBps: 0, tickSize: .1, maintenanceMarginRate: .005, ...over });

describe('position closing semantics', () => {
  const config = { ...defaultSimConfig, equity: 10000, leverage: 3 };
  const open = (account: ReturnType<typeof newAccount>, side: 'buy' | 'sell', qty: number, price: number) => {
    const result = openPosition(account, config, { side, qty, price, time: 1 });
    if (!result.ok) throw new Error(result.message);
    return result;
  };
  it('closes the entire position when no quantity is given', () => {
    const opened = open(newAccount(config), 'buy', 2, 100);
    const closed = closePosition(opened.account, config, { side: 'sell', price: 110, time: 2 });
    if (!closed.ok) throw new Error(closed.message);
    expect(closed.account.position).toBeNull();
    expect(closed.fill.qty).toBe(2);
    expect(closed.fill.action).toBe('close');
  });
  it('keeps the remainder and releases only its share of margin when reducing', () => {
    const opened = open(newAccount(config), 'buy', 2, 100);
    const before = opened.account.position;
    if (!before) throw new Error('no position');
    const reduced = closePosition(opened.account, config, { side: 'sell', qty: .5, price: 110, time: 2 });
    if (!reduced.ok) throw new Error(reduced.message);
    expect(reduced.account.position?.qty).toBeCloseTo(1.5, 10);
    expect(reduced.account.position?.margin).toBeCloseTo(before.margin * .75, 6);
    expect(reduced.fill.action).toBe('reduce');
  });
  it('clamps an over-sized reduce to the whole position', () => {
    const opened = open(newAccount(config), 'sell', 1, 100);
    const closed = closePosition(opened.account, config, { side: 'buy', qty: 5, price: 90, time: 2 });
    if (!closed.ok) throw new Error(closed.message);
    expect(closed.account.position).toBeNull();
    expect(closed.fill.qty).toBe(1);
  });
});
describe('simulated account: opening', () => {
  it('starts flat with the configured equity', () => {
    const account = newAccount(config({ equity: 5000 }));
    expect(account).toMatchObject({ balance: 5000, position: null, realized: 0, fees: 0, funding: 0, liquidated: false });
  });
  it('locks margin at 1/leverage and charges a taker fee', () => {
    const cfg = config();
    const result = openPosition(newAccount(cfg), cfg, { side: 'buy', qty: 1, price: 100, time: 10 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 名义 100，10 倍杠杆 → 占用 10；手续费 100 * 5bp = 0.05
    expect(result.account.position).toEqual({ side: 'long', qty: 1, entry: 100, margin: 10 });
    expect(result.account.balance).toBeCloseTo(10_000 - 10 - .05, 6);
    expect(result.account.fees).toBeCloseTo(.05, 6);
    expect(result.fill).toMatchObject({ side: 'buy', dir: 'long', action: 'open', reason: 'market', price: 100, qty: 1 });
  });
  it('opens shorts with a sell and averages the entry when adding', () => {
    const cfg = config();
    const short = openPosition(newAccount(cfg), cfg, { side: 'sell', qty: 2, price: 50, time: 1 });
    expect(short.ok && short.account.position).toMatchObject({ side: 'short', qty: 2, entry: 50 });
    const added = openPosition(newAccount(cfg), cfg, { side: 'buy', qty: 1, price: 100, time: 1 });
    if (!added.ok) return;
    const more = openPosition(added.account, cfg, { side: 'buy', qty: 1, price: 200, time: 2 });
    expect(more.ok && more.account.position).toMatchObject({ qty: 2, entry: 150, side: 'long' });
    expect(more.ok && more.account.fills[1].action).toBe('add');
  });
  it('rejects a reverse-direction order, bad size and thin margin', () => {
    const cfg = config();
    const long = openPosition(newAccount(cfg), cfg, { side: 'buy', qty: 1, price: 100, time: 1 });
    if (!long.ok) return;
    expect(openPosition(long.account, cfg, { side: 'sell', qty: 1, price: 100, time: 1 })).toMatchObject({ ok: false });
    expect(openPosition(newAccount(cfg), cfg, { side: 'buy', qty: 0, price: 100, time: 1 })).toMatchObject({ ok: false });
    expect(openPosition(newAccount(cfg), cfg, { side: 'buy', qty: .00001, price: 100, time: 1 })).toMatchObject({ ok: false, message: expect.stringContaining('最小下单量') });
    const small = newAccount(config({ equity: 5 }));
    expect(openPosition(small, cfg, { side: 'buy', qty: 10, price: 100, time: 1 })).toMatchObject({ ok: false, message: expect.stringContaining('保证金不足') });
  });
  it('charges the maker fee for resting orders', () => {
    const cfg = config();
    const result = openPosition(newAccount(cfg), cfg, { side: 'buy', qty: 1, price: 100, time: 1, maker: true, reason: 'limit' });
    expect(result.ok && result.account.fees).toBeCloseTo(.02, 6);
  });
});

describe('simulated account: closing', () => {
  it('books profit, releases margin and charges the fee', () => {
    const cfg = config();
    const opened = openPosition(newAccount(cfg), cfg, { side: 'buy', qty: 1, price: 100, time: 1 });
    if (!opened.ok) return;
    const closed = closePosition(opened.account, cfg, { side: 'sell', price: 110, time: 2 });
    if (!closed.ok) return;
    expect(closed.account.position).toBeNull();
    expect(closed.fill).toMatchObject({ action: 'close', realized: 10, dir: 'long' });   // 口径：毛盈亏
    expect(closed.fill.fee).toBeGreaterThan(0);   // 手续费仍然单独收取
    expect(closed.account.realized).toBeCloseTo(10, 6);
    expect(closed.account.balance).toBeCloseTo(10_000 + 10 - .055 - .05, 6);
  });
  it('supports partial closes and keeps the entry price', () => {
    const cfg = config();
    const opened = openPosition(newAccount(cfg), cfg, { side: 'buy', qty: 2, price: 100, time: 1 });
    if (!opened.ok) return;
    const half = closePosition(opened.account, cfg, { side: 'sell', price: 120, time: 2, qty: 1 });
    if (!half.ok) return;
    expect(half.account.position).toMatchObject({ qty: 1, entry: 100 });
    expect(half.fill.action).toBe('reduce');
    expect(half.account.realized).toBeCloseTo(20, 6);
  });
  it('closes a short on a buy and refuses the wrong side', () => {
    const cfg = config();
    const opened = openPosition(newAccount(cfg), cfg, { side: 'sell', qty: 1, price: 100, time: 1 });
    if (!opened.ok) return;
    expect(closePosition(opened.account, cfg, { side: 'sell', price: 90, time: 2 })).toMatchObject({ ok: false, message: '空头请用买入平仓。' });
    const closed = closePosition(opened.account, cfg, { side: 'buy', price: 90, time: 2 });
    expect(closed.ok && closed.fill.realized).toBeCloseTo(10, 6);
  });
  it('refuses to close without a position', () => {
    const cfg = config();
    expect(closePosition(newAccount(cfg), cfg, { side: 'sell', price: 100, time: 1 })).toMatchObject({ ok: false, message: '当前没有持仓。' });
  });
  it('reverses a long into a short in one action', () => {
    const cfg = config();
    const opened = openPosition(newAccount(cfg), cfg, { side: 'buy', qty: 1, price: 100, time: 1 });
    if (!opened.ok) return;
    const reversed = reversePosition(opened.account, cfg, { price: 95, time: 2 });
    if (!reversed.ok) return;
    expect(reversed.account.position).toMatchObject({ side: 'short', qty: 1, entry: 95 });
    expect(reversed.fill.action).toBe('reverse');
    expect(reversed.account.realized).toBeCloseTo(-5, 6);
  });
});

describe('settlement modes: USDT-margined vs coin-margined', () => {
  /** 币本位（反向合约）：1 张 = 100 USD 面值，账户以币计价。 */
  const coin = (over: Partial<SimConfig> = {}): SimConfig => ({ ...defaultSimConfig, settle: 'coin', qtyUnit: 'contract', contractSize: 100, leverage: 10, maintenanceMarginRate: .005, takerBps: 5, makerBps: 2, slippageBps: 0, fundingRate8h: 0, equity: 1, ...over });
  const linear = (over: Partial<SimConfig> = {}): SimConfig => ({ ...defaultSimConfig, settle: 'usdt', qtyUnit: 'base', leverage: 10, takerBps: 5, slippageBps: 0, fundingRate8h: 0, ...over });
  it('defaults the contract face per settlement mode', () => {
    expect(defaultContractSize('coin')).toBe(100);
    expect(defaultContractSize('usdt')).toBe(.01);
  });
  it('values the notional in USD for both modes', () => {
    expect(notionalUsd(linear(), 2, 50_000)).toBe(100_000);
    expect(notionalUsd(coin(), 2, 50_000)).toBe(200);
  });
  it('locks coin margin and charges the fee in coin for inverse contracts', () => {
    const config = coin();
    const opened = openPosition(newAccount(config), config, { side: 'buy', qty: 1, price: 50_000, time: 1 });
    if (!opened.ok) return;
    expect(opened.account.position).toMatchObject({ side: 'long', qty: 1, entry: 50_000 });
    expect(settledMargin(config, 1, 50_000)).toBeCloseTo(.0002, 10);          // 100 USD / 10 / 50,000
    expect(opened.account.position?.margin).toBeCloseTo(.0002, 10);
    expect(settledFee(config, 1, 50_000, 5)).toBeCloseTo(.000001, 12);        // 100 USD × 5bp / 50,000
    expect(opened.account.balance).toBeCloseTo(1 - .0002 - .000001, 10);
    expect(baseQtyOf(config, 1, 50_000)).toBeCloseTo(.002, 10);               // 折算成 BTC
  });
  it('books inverse PnL in coin and pays it back on close', () => {
    const config = coin();
    const long = settledPnl(config, 'long', 1, 50_000, 55_000);
    const short = settledPnl(config, 'short', 1, 50_000, 55_000);
    expect(long).toBeCloseTo(100 * (1 / 50_000 - 1 / 55_000), 12);
    expect(short).toBeCloseTo(-long, 12);
    const opened = openPosition(newAccount(config), config, { side: 'sell', qty: 1, price: 50_000, time: 1 });
    if (!opened.ok) return;
    const closed = closePosition(opened.account, config, { side: 'buy', price: 45_000, time: 2 });
    if (!closed.ok) return;
    // 空头在下跌中赚币：100 × (1/45,000 − 1/50,000)
    expect(closed.fill.realized).toBeCloseTo(100 * (1 / 45_000 - 1 / 50_000), 10);
    expect(closed.account.position).toBeNull();
  });
  it('marks equity, margin ratio and the inverse liquidation price', () => {
    const isolated = coin({ marginMode: 'isolated' });
    const opened = openPosition(newAccount(isolated), isolated, { side: 'buy', qty: 1, price: 50_000, time: 1 });
    if (!opened.ok) return;
    const equity = equityOf(opened.account, 55_000, isolated);
    expect(equity).toBeCloseTo(opened.account.balance + .0002 + settledPnl(isolated, 'long', 1, 50_000, 55_000), 10);
    // 逐仓：N×(1+mmr) / (保证金 + N/开仓价)
    const liq = liquidationPriceOf(opened.account, isolated);
    expect(liq).toBeCloseTo(100 * 1.005 / (.0002 + 100 / 50_000), 4);
    expect(marginRatioOf(opened.account, liq, isolated)).toBeGreaterThanOrEqual(1);
    expect(marginRatioOf(opened.account, 50_000, isolated)).toBeCloseTo(.05, 6);
    // 全仓：账户里还有 1 BTC，强平价会被拉到很远
    const cross = coin();
    const held = openPosition(newAccount(cross), cross, { side: 'buy', qty: 1, price: 50_000, time: 1 });
    if (!held.ok) return;
    expect(liquidationPriceOf(held.account, cross)).toBeLessThan(1_000);
  });
  it('caps an isolated coin liquidation at the position margin', () => {
    const config = coin({ marginMode: 'isolated' });
    const opened = openPosition(newAccount(config), config, { side: 'buy', qty: 1, price: 50_000, time: 1 });
    if (!opened.ok) return;
    const blown = liquidate(opened.account, config, 30_000, 2);
    expect(blown.position).toBeNull();
    expect(blown.liquidated).toBe(true);
    expect(blown.balance).toBeGreaterThanOrEqual(1 - .0002 - .000002 - 1e-9);
  });
  it('keeps funding in the settlement currency', () => {
    const config = coin({ fundingRate8h: .001 });
    const opened = openPosition(newAccount(config), config, { side: 'buy', qty: 1, price: 50_000, time: 1 });
    if (!opened.ok) return;
    const charged = applyFunding(opened.account, config, 50_000, 1);
    expect(charged.funding).toBeCloseTo(-(100 * .001 / 50_000), 12);
  });
  it('reports the settlement unit and base quantity for the UI', () => {
    const config = coin();
    const opened = openPosition(newAccount(config), config, { side: 'buy', qty: 2, price: 50_000, time: 1 });
    if (!opened.ok) return;
    const values = accountValues(opened.account, 50_000, config);
    expect(values).toMatchObject({ settle: 'coin', qtyUnit: 'contract' });
    expect(values.baseQty).toBeCloseTo(.004, 10);
    expect(accountValues(opened.account, 50_000, linear()).settle).toBe('usdt');
  });
});

describe('margin, liquidation and funding', () => {
  it('computes equity as cash + margin + unrealized', () => {
    const cfg = config();
    const opened = openPosition(newAccount(cfg), cfg, { side: 'buy', qty: 1, price: 100, time: 1 });
    if (!opened.ok) return;
    expect(unrealizedOf(opened.account.position, 120)).toBeCloseTo(20, 6);
    expect(equityOf(opened.account, 120)).toBeCloseTo(10_000 + 20 - .05, 6);
  });
  it('puts the isolated liquidation price where the position margin is gone', () => {
    const cfg = config({ marginMode: 'isolated', leverage: 10, maintenanceMarginRate: .005 });
    const opened = openPosition(newAccount(cfg), cfg, { side: 'buy', qty: 1, price: 100, time: 1 });
    if (!opened.ok) return;
    const liq = liquidationPriceOf(opened.account, cfg);
    expect(liq).toBeCloseTo(100 * (1 - .1) / (1 - .005), 2);
    expect(marginRatioOf(opened.account, liq, cfg)).toBeGreaterThanOrEqual(1);
    expect(marginRatioOf(opened.account, 99, cfg)).toBeLessThan(1);
  });
  it('keeps cross liquidation above zero only when free cash runs out', () => {
    const cross = config({ marginMode: 'cross', leverage: 1 });
    const opened = openPosition(newAccount(cross), cross, { side: 'buy', qty: 1, price: 100, time: 1 });
    if (!opened.ok) return;
    // 1 倍满仓多：可用现金充足时强平价低于 0（不会爆）
    expect(liquidationPriceOf(opened.account, cross)).toBeLessThan(0);
    const short = openPosition(newAccount(cross), cross, { side: 'sell', qty: 1, price: 100, time: 1 });
    if (!short.ok) return;
    expect(liquidationPriceOf(short.account, cross)).toBeGreaterThan(0);
  });
  it('caps an isolated liquidation loss at that position margin', () => {
    const cfg = config({ marginMode: 'isolated' });
    const opened = openPosition(newAccount(cfg), cfg, { side: 'buy', qty: 1, price: 100, time: 1 });
    if (!opened.ok) return;
    const before = opened.account.balance;
    const liquidated = liquidate(opened.account, cfg, 50, 2);
    expect(liquidated.position).toBeNull();
    expect(liquidated.liquidated).toBe(true);
    expect(liquidated.balance).toBeGreaterThanOrEqual(before - 1);
    expect(liquidated.fills.at(-1)?.reason).toBe('liquidation');
  });
  it('lets a cross liquidation consume the balance but never go negative', () => {
    const cfg = config({ marginMode: 'cross', leverage: 10 });
    const opened = openPosition(newAccount(cfg), cfg, { side: 'long' === 'long' ? 'buy' : 'buy', qty: 1, price: 100, time: 1 });
    if (!opened.ok) return;
    const blown = liquidate(opened.account, cfg, 1, 2);
    expect(blown.balance).toBeGreaterThanOrEqual(0);
    expect(equityOf(blown, 1)).toBeGreaterThanOrEqual(0);
  });
  it('charges funding to longs and pays shorts', () => {
    const cfg = config({ fundingRate8h: .001 });
    const long = openPosition(newAccount(cfg), cfg, { side: 'buy', qty: 1, price: 100, time: 1 });
    if (!long.ok) return;
    const charged = applyFunding(long.account, cfg, 100, 1);
    expect(charged.balance).toBeCloseTo(long.account.balance - .1, 6);
    expect(charged.funding).toBeCloseTo(-.1, 6);
    const short = openPosition(newAccount(cfg), cfg, { side: 'sell', qty: 1, price: 100, time: 1 });
    if (!short.ok) return;
    expect(applyFunding(short.account, cfg, 100, 1).funding).toBeCloseTo(.1, 6);
    expect(applyFunding(newAccount(cfg), cfg, 100, 1).funding).toBe(0);
  });
});

describe('number formatting: no floating-point tails', () => {
  it('rounds engine state to 8 decimals so 0.3 - 0.1 never leaks', () => {
    const cfg = config();
    const opened = openPosition(newAccount(cfg), cfg, { side: 'buy', qty: .3, price: 100, time: 1 });
    if (!opened.ok) return;
    const half = closePosition(opened.account, cfg, { side: 'sell', qty: .1, price: 110, time: 2 });
    if (!half.ok) return;
    expect(half.account.position?.qty).toBe(.2);
    expect(String(half.account.position?.qty)).not.toContain('19999');
    const rest = closePosition(half.account, cfg, { side: 'sell', qty: .2, price: 120, time: 3 });
    if (!rest.ok) return;
    expect(rest.account.position).toBeNull();
    // 1/3 这种无限循环也要干净
    const third = openPosition(newAccount(cfg), cfg, { side: 'buy', qty: 1 / 3, price: 100, time: 1 });
    if (!third.ok) return;
    const closed = closePosition(third.account, cfg, { side: 'sell', price: 100, time: 2 });
    if (!closed.ok) return;
    expect(String(closed.account.realized)).not.toMatch(/\d{9,}/);
    expect(closed.account.balance).toBe(round8(closed.account.balance));
  });
  it('formats numbers per settlement mode and kills the tails', () => {
    expect(qtyText(.009999999999999998)).toBe('0.01');
    expect(qtyText(1 / 3)).toBe('0.33333333');
    expect(qtyText(.000000001)).toBe('0');
    expect(money(0.1 + 0.2)).toBe('0.30');
    expect(settleText(0.1 + 0.2, defaultSimConfig)).toBe('0.30');
    expect(settleText(.000000015, { ...defaultSimConfig, settle: 'coin' })).toBe('0.00000001');
    expect(percentText(0.05000000000000001)).toBe('5.00%');
    expect(percentText(1 / 3, 1)).toBe('33.3%');
    expect(percentText(Number.POSITIVE_INFINITY)).toBe('—');
    expect(priceText(76543.219999, .1)).toBe('76,543.2');
    expect(priceText(76543.219999, .01)).toBe('76,543.22');
    expect(priceText(0.5, 1e-8)).toBe('0.50000000');
  });
  it('trims only decimal zeros when filling the quantity box', () => {
    // 「25% / 50% / 最大」按钮会把这里的文本写进数量输入框：
    // 旧实现用 replace(/\.?0+$/) 连整数位的零一起吃掉，100 会变成 "1"、2500 变成 "25"。
    expect(quantityStepText(100, 6)).toBe('100');
    expect(quantityStepText(2500, 6)).toBe('2500');
    expect(quantityStepText(10, 6)).toBe('10');
    expect(quantityStepText(2500, 2)).toBe('2500');
    expect(quantityStepText(0.5, 6)).toBe('0.5');
    expect(quantityStepText(0.250000, 6)).toBe('0.25');
    expect(quantityStepText(1, 6)).toBe('1');
    expect(quantityStepText(1.5, 2)).toBe('1.5');
    expect(quantityStepText(0.3333333333, 6)).toBe('0.333333');
    expect(quantityStepText(0, 6)).toBe('');
    expect(quantityStepText(Number.NaN, 6)).toBe('');
    expect(quantityStepText(-5, 6)).toBe('');
  });
  it('settles the account values without tails', () => {
    const cfg = config();
    const opened = openPosition(newAccount(cfg), cfg, { side: 'buy', qty: .3, price: 33_333.33, time: 1 });
    if (!opened.ok) return;
    const values = accountValues(opened.account, 33_333.33, cfg);
    for (const value of [values.equity, values.available, values.margin, values.unrealized, values.fees]) {
      expect(String(value)).not.toMatch(/\d{9,}/);
    }
    expect(settleText(values.equity, cfg)).toMatch(/^[\d,]+\.\d{2}$/);
  });
});

describe('pricing helpers and replay', () => {
  it('applies slippage against the taker and rounds to the tick', () => {
    const cfg = config({ slippageBps: 50, tickSize: .5, impactBps: 0 });
    expect(marketPrice('buy', 100, cfg)).toBe(100.5);
    expect(marketPrice('sell', 100, cfg)).toBe(99.5);
    expect(roundToTick(100.24, .1)).toBeCloseTo(100.2, 6);
  });
  it('grows slippage with order size relative to the candle volume (square-root impact)', () => {
    const cfg = config({ slippageBps: 1, impactBps: 8, tickSize: 1e-9 });
    expect(slippageFor(cfg)).toBe(1);
    expect(slippageFor(cfg, { orderNotional: 0, barNotional: 1_000_000 })).toBe(1);
    // 吃掉整根K线成交额 → 基础 + 1×impact
    const full = slippageFor(cfg, { orderNotional: 1_000_000, barNotional: 1_000_000 });
    expect(full).toBeCloseTo(9, 6);
    // 四分之一仓位 → 基础 + impact/2
    expect(slippageFor(cfg, { orderNotional: 250_000, barNotional: 1_000_000 })).toBeCloseTo(5, 6);
    // 冲击上限 4×（避免极端参数把成交价打到离谱）
    expect(slippageFor(cfg, { orderNotional: 1e12, barNotional: 1 })).toBeCloseTo(1 + 8 * 2, 6);
    expect(marketPrice('buy', 100, cfg, { orderNotional: 250_000, barNotional: 1_000_000 })).toBeCloseTo(100.05, 6);
  });
  it('prefers a real funding rate over the configured constant', () => {
    const cfg = config({ fundingRate8h: .0001 });
    const opened = openPosition(newAccount(cfg), cfg, { side: 'buy', qty: 1, price: 100, time: 1 });
    if (!opened.ok) return;
    const real = applyFunding(opened.account, cfg, 100, 1, .002);
    expect(real.funding).toBeCloseTo(-.2, 10);
    expect(applyFunding(opened.account, cfg, 100, 1).funding).toBeCloseTo(-.01, 10);
  });
  it('reports the account snapshot used by the status bar', () => {
    const cfg = config();
    const opened = openPosition(newAccount(cfg), cfg, { side: 'buy', qty: 1, price: 100, time: 1 });
    if (!opened.ok) return;
    const values = accountValues(opened.account, 105, cfg);
    expect(values).toMatchObject({ side: 'long', qty: 1 });
    expect(values.unrealized).toBeCloseTo(5, 6);
    expect(values.equity).toBeCloseTo(10_005 - .05, 6);
    expect(values.margin).toBeCloseTo(10, 6);
    expect(values.marginRatio).toBeGreaterThan(0);
    expect(values.fees).toBeCloseTo(.05, 6);
  });
  it('rebuilds the same account from its fills', () => {
    const cfg = config();
    const first = openPosition(newAccount(cfg), cfg, { side: 'buy', qty: 1, price: 100, time: 1 });
    if (!first.ok) return;
    const second = closePosition(first.account, cfg, { side: 'sell', price: 130, time: 2 });
    if (!second.ok) return;
    const rebuilt = replayFills(second.account.fills, cfg);
    expect(rebuilt.position).toBeNull();
    expect(rebuilt.realized).toBeCloseTo(second.account.realized, 6);
    expect(rebuilt.fills.map((fill: Fill) => fill.action)).toEqual(['open', 'close']);
  });
});

describe('principal unit handling', () => {
  it('accepts a coin-denominated principal without inflating it', () => {
    // 回归：本金下限写死 100（USDT 口径），币本位下 0.133 BTC 被判非法 → 回退成 10,000，
    // 实测表现为「账户权益（BTC）10,000」。
    const coin = sanitizeSimConfig({ settle: 'coin', equity: 0.1333 }, defaultSimConfig);
    expect(coin.equity).toBeCloseTo(0.1333, 8);
    const tiny = sanitizeSimConfig({ settle: 'coin', equity: 0.00000001 }, defaultSimConfig);
    expect(tiny.equity).toBeCloseTo(1e-8, 12);
  });
  it('still refuses an implausibly small USDT principal', () => {
    const small = sanitizeSimConfig({ settle: 'usdt', equity: 0.5 }, defaultSimConfig);
    expect(small.equity).toBe(defaultSimConfig.equity);
  });
});
