/*!
 * src/orders.ts - zhuk-replay-studio key core logic
 * (c) 2026 William-Trader (https://github.com/William-Trader)
 * WM: ZRS-5F95BE07
 * SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
 * Removing this mark violates the license.
 */
import { applyFunding, closePosition, equityOf, liquidate, liquidationPriceOf, marginRatioOf, marketPrice, newAccount, notionalUsd, openPosition, roundToTick,
  type Account, type Fill, type FillReason, type OrderSide, type SimConfig } from './model';
import { intrabarPrices, type Candle } from './market';

export type OrderType = 'limit' | 'stop';
export type { OrderSide } from './model';
/** 手动成交（市价按当前 bar 收盘价执行），与委托走同一条重放管线。 */
export interface MarketEvent { id: string; seq: number; time: number; side: OrderSide; qty: number; price: number }
/** 委托；`trailBps` 表示这是跟踪委托（触发价随极值移动）。 */
export interface Order { id: string; seq: number; side: OrderSide; type: OrderType; qty: number; price: number; createdCursor: number; reduceOnly?: boolean; trailBps?: number; trailRef?: number }
export type OrderAction =
  | { kind: 'place'; seq: number; order: Order }
  | { kind: 'cancel'; seq: number; orderId: string; cursor: number }
  /** 仓位保护（开仓即带或事后调整）：从 `time` 这根K线起生效，仓位平掉即失效。 */
  | { kind: 'protect'; seq: number; time: number; sl?: number; tp?: number; trailBps?: number };
export interface OrderState { order: Order; status: 'working' | 'filled' | 'cancelled'; fillTime?: number; fillPrice?: number; cancelCursor?: number }
/** 仓位保护；`trailRef` 是跟踪止损的极值参考。 */
export interface Protection { sl?: number; tp?: number; trailBps?: number; trailRef?: number }
export interface DerivedState { account: Account; orders: OrderState[]; fills: Fill[]; protection: Protection | null; liquidatedAt?: number; /** 每根已揭示K线收盘时的账户权益，用于回撤与权益曲线。 */ equityCurve: number[] }

/** 跟踪委托的当前触发价。 */
export function trailingLevel(order: Order, trailRef?: number): number {
  if (!order.trailBps || trailRef === undefined) return order.price;
  return order.side === 'sell' ? trailRef * (1 - order.trailBps / 10_000) : trailRef * (1 + order.trailBps / 10_000);
}
/** 工作委托在这一根K线上的成交价；沿 bar 内路径判定（跳空则按开盘价成交）。 */
export function orderTrigger(order: Order, bar: Candle, config: SimConfig, trailRef?: number): number | null {
  const path = intrabarPrices(bar);
  const open = path[0];
  const low = Math.min(...path), high = Math.max(...path);
  const level = trailingLevel(order, trailRef);
  if (order.side === 'buy') {
    if (order.type === 'limit') return low <= level ? roundToTick(open <= level ? open : level, config.tickSize) : null;
    return high >= level ? roundToTick(open >= level ? open : level, config.tickSize) : null;
  }
  if (order.type === 'limit') return high >= level ? roundToTick(open >= level ? open : level, config.tickSize) : null;
  return low <= level ? roundToTick(open <= level ? open : level, config.tickSize) : null;
}
/** 仓位保护在这一根K线上的触发：按路径顺序，先到先成交；开盘即越过按开盘价。 */
export function protectionTrigger(protection: Protection | null, bar: Candle, side: 'long' | 'short', config: SimConfig): { reason: FillReason; price: number } | null {
  if (!protection) return null;
  const path = intrabarPrices(bar);
  const long = side === 'long';
  const levels: { reason: FillReason; price: number }[] = [];
  if (protection.sl !== undefined) levels.push({ reason: 'sl', price: protection.sl });
  if (protection.tp !== undefined) levels.push({ reason: 'tp', price: protection.tp });
  if (protection.trailBps && protection.trailRef !== undefined) levels.push({ reason: 'trail', price: trailingLevel({ side: long ? 'sell' : 'buy', trailBps: protection.trailBps } as Order, protection.trailRef) });
  if (!levels.length) return null;
  for (let i = 0; i < path.length; i++) {
    const price = path[i];
    for (const level of levels) {
      const hit = level.reason === 'tp' ? (long ? price >= level.price : price <= level.price) : (long ? price <= level.price : price >= level.price);
      if (hit) return { reason: level.reason, price: roundToTick(i === 0 ? price : level.price, config.tickSize) };
    }
  }
  return null;
}
/** 保护价位（含跟踪）用于界面显示。 */
export function protectionLevels(protection: Protection | null, side: 'long' | 'short' | null): { sl?: number; tp?: number; trail?: number } {
  if (!protection || !side) return {};
  const trail = protection.trailBps && protection.trailRef !== undefined
    ? trailingLevel({ side: side === 'long' ? 'sell' : 'buy', trailBps: protection.trailBps } as Order, protection.trailRef)
    : undefined;
  return { sl: protection.sl, tp: protection.tp, trail };
}

export function nextSeq(marketEvents: readonly MarketEvent[], orderLog: readonly OrderAction[]): number {
  return [...marketEvents.map(event => event.seq), ...orderLog.map(action => action.seq)].reduce((max, seq) => Math.max(max, seq), 0) + 1;
}
/** 该方向会减仓还是加仓：有反向持仓即为减仓。 */
export function reducesPosition(account: Account, side: OrderSide): boolean {
  return side === 'buy' ? account.position?.side === 'short' : account.position?.side === 'long';
}
/** 成交一笔（市价/委托共用）：先平掉反向持仓，超过持仓的部分继续开反向仓（真实交易所口径的反手）。 */
function applyEvent(account: Account, config: SimConfig, request: { side: OrderSide; qty: number; price: number; time: number; reason: FillReason; maker?: boolean }): Account {
  if (!reducesPosition(account, request.side)) {
    const opened = openPosition(account, config, request);
    return opened.ok ? opened.account : account;
  }
  const open = account.position!.qty;
  const closed = closePosition(account, config, { ...request, qty: Math.min(request.qty, open) });
  if (!closed.ok) return account;
  const remainder = request.qty - Math.min(request.qty, open);
  if (remainder <= 1e-12) return closed.account;
  const flipped = openPosition(closed.account, config, { ...request, qty: remainder });
  return flipped.ok ? flipped.account : closed.account;
}

/**
 * 重放市价事件、委托、仓位保护、资金费率与强平。纯函数：回退或前进都会重算出同样的账户，
 * 尚未揭示的那根K线一到，工作委托就回到 working。
 */
/** 资金费率来源：`fundingRates` 命中就按真实历史费率，否则退回配置常数。 */
export function derive(config: SimConfig, marketEvents: readonly MarketEvent[], orderLog: readonly OrderAction[], bars: readonly Candle[], cursor: number, fundingRates?: Map<number, number> | null): DerivedState {
  let account = newAccount(config);
  const protection: Protection = {};
  let hasProtection = false;
  let liquidatedAt: number | undefined;
  let appliedProtectSeq = Number.NEGATIVE_INFINITY;
  const places = orderLog.filter((action): action is Extract<OrderAction, { kind: 'place' }> => action.kind === 'place').sort((a, b) => a.seq - b.seq);
  const cancels = orderLog.filter((action): action is Extract<OrderAction, { kind: 'cancel' }> => action.kind === 'cancel').sort((a, b) => a.seq - b.seq);
  const protects = orderLog.filter((action): action is Extract<OrderAction, { kind: 'protect' }> => action.kind === 'protect').sort((a, b) => a.seq - b.seq);
  const states = new Map<string, OrderState>();
  for (const action of places) if (!states.has(action.order.id)) states.set(action.order.id, { order: action.order, status: 'working' });
  const byTime = new Map<number, MarketEvent[]>();
  for (const event of [...marketEvents].sort((a, b) => a.seq - b.seq)) { const list = byTime.get(event.time) ?? []; list.push(event); byTime.set(event.time, list); }
  const clearProtection = () => { protection.sl = undefined; protection.tp = undefined; protection.trailBps = undefined; protection.trailRef = undefined; hasProtection = false; };
  const equityCurve: number[] = [];
  const last = Math.max(0, Math.min(cursor, bars.length));
  let fundingBoundary = -1;
  for (let index = 0; index < last; index++) {
    const bar = bars[index];
    // 1) 资金费率：每 8 小时（UTC 0/8/16 点）结算一次。
    const boundary = Math.floor(bar.time / (8 * 3600));
    if (fundingBoundary === -1) fundingBoundary = boundary;
    else if (boundary !== fundingBoundary) {
      const periods = Math.min(24, boundary - fundingBoundary);
      fundingBoundary = boundary;
      const boundaryTime = boundary * 8 * 3600;
      const real = fundingRates?.get(boundaryTime) ?? fundingRates?.get(boundaryTime + 8 * 3600 - 1);
      account = applyFunding(account, config, bar.open, periods, real);
    }
    // 2) 到点的仓位保护设置（开仓即带的保护从这根K线开始生效）。
    for (const action of protects) {
      if (action.time > bar.time || action.seq <= appliedProtectSeq) continue;
      appliedProtectSeq = action.seq;
      protection.sl = action.sl; protection.tp = action.tp; protection.trailBps = action.trailBps;
      protection.trailRef = action.trailBps ? account.position?.entry ?? bar.close : undefined;
      hasProtection = action.sl !== undefined || action.tp !== undefined || action.trailBps !== undefined;
    }
    // 3) 保护触发（止损/止盈/跟踪）；跟踪不走马后炮：先用上一根以来的极值判定，再推进极值。
    if (account.position) {
      const long = account.position.side === 'long';
      if (protection.trailBps && protection.trailRef === undefined) protection.trailRef = account.position.entry;
      const hit = protectionTrigger(protection, bar, account.position.side, config);
      if (hit) {
        const result = closePosition(account, config, { side: long ? 'sell' : 'buy', price: hit.price, time: bar.time, reason: hit.reason });
        if (result.ok) { account = result.account; clearProtection(); }
      } else if (protection.trailBps) {
        protection.trailRef = long ? Math.max(protection.trailRef ?? account.position.entry, bar.high) : Math.min(protection.trailRef ?? account.position.entry, bar.low);
      }
    }
    // 4) 工作委托：按 seq 顺序触发（含跟踪委托与只减仓）。
    for (const state of [...states.values()].sort((a, b) => a.order.seq - b.order.seq)) {
      if (state.status !== 'working') continue;
      const order = state.order;
      if (index < order.createdCursor) continue;
      if (order.trailBps && order.trailRef === undefined) order.trailRef = order.price;
      const price = orderTrigger(order, bar, config, order.trailRef);
      if (price === null) {
        // 只在这根K线没有触发时才把极值推进到本根（避免回马枪）。
        if (order.trailBps) order.trailRef = order.side === 'sell' ? Math.max(order.trailRef ?? order.price, bar.high) : Math.min(order.trailRef ?? order.price, bar.low);
        continue;
      }
      if (order.reduceOnly && !reducesPosition(account, order.side)) continue;
      // 限价单是挂单，按触发价成交；止损单触发后是吃单，要承担基础滑点 + 成交额冲击。
      const filled = order.type === 'limit' ? price : marketPrice(order.side, price, config, { orderNotional: notionalUsd(config, order.qty, price), barNotional: Math.max(1e-9, bar.volume * bar.close) });
      const request = { side: order.side, qty: order.qty, price: filled, time: bar.time, reason: (order.type === 'limit' ? 'limit' : 'stop') as FillReason, maker: order.type === 'limit' };
      const before = account.fills.length;
      account = applyEvent(account, config, request);
      if (account.fills.length === before) continue;
      const fill = account.fills[account.fills.length - 1];
      state.status = 'filled'; state.fillTime = bar.time; state.fillPrice = fill.price;
      if (!account.position) clearProtection();
    }
    // 5) 撤单：`cursor <= index + 1` 表示当前游标立即生效。
    for (const cancel of cancels) {
      if (cancel.cursor > index + 1) continue;
      const state = states.get(cancel.orderId);
      if (state && state.status === 'working') { state.status = 'cancelled'; state.cancelCursor = cancel.cursor; }
    }
    // 6) 市价成交：按 seq 顺序在收盘价执行。
    for (const event of byTime.get(bar.time) ?? []) {
      const before = account.fills.length;
      // 手动市价同样按成交额冲击滑点（订单越大越吃亏）。
      const filled = marketPrice(event.side, event.price, config, { orderNotional: notionalUsd(config, event.qty, event.price), barNotional: Math.max(1e-9, bar.volume * bar.close) });
      account = applyEvent(account, config, { side: event.side, qty: event.qty, price: filled, time: event.time, reason: 'market' });
      if (account.fills.length !== before && !account.position) clearProtection();
    }
    // 7) 强平：本根K线触及强平价，或保证金率已经打满。
    if (account.position) {
      const liq = liquidationPriceOf(account, config);
      const long = account.position.side === 'long';
      const touched = Number.isFinite(liq) && (long ? bar.low <= liq : bar.high >= liq);
      if (touched || marginRatioOf(account, bar.close, config) >= 1) {
        account = liquidate(account, config, Number.isFinite(liq) ? liq : bar.close, bar.time);
        liquidatedAt = bar.time;
        clearProtection();
      }
    }
    equityCurve.push(equityOf(account, bar.close));
  }
  return { account, orders: [...states.values()], fills: account.fills, protection: hasProtection ? { ...protection } : null, liquidatedAt, equityCurve };
}
