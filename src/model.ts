/*!
 * src/model.ts - zhuk-replay-studio key core logic
 * (c) 2026 William-Trader (https://github.com/William-Trader)
 * WM: ZRS-24166FB8
 * SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
 * Removing this mark violates the license.
 */
/** 模拟账户引擎：USDT 本位永续口径 —— 双向持仓、杠杆、全仓/逐仓保证金、手续费、滑点、
 *  资金费率与强平。全部为纯函数，且任何状态都能由成交序列重放出来（回退可逆）。
 *  无 DOM、无存储、无网络。 */

export type Side = 'long' | 'short';
/** 结算本位：U 本位（linear，盈亏按 USDT）/ 币本位（inverse，盈亏按币）。 */
export type Settle = 'usdt' | 'coin';
/** 数量单位：按币（base）或按张（contract）。 */
export type QtyUnit = 'base' | 'contract';
export type OrderSide = 'buy' | 'sell';
export type MarginMode = 'cross' | 'isolated';
/** 这笔成交在仓位上的动作。 */
export type FillAction = 'open' | 'add' | 'reduce' | 'close' | 'reverse';
/** 为什么会成交。 */
export type FillReason = 'market' | 'limit' | 'stop' | 'sl' | 'tp' | 'trail' | 'liquidation';

export interface SimConfig {
  /** 初始权益，单位随结算本位：U 本位=USDT，币本位=币（BTC）。 */
  equity: number;
  settle: Settle;
  qtyUnit: QtyUnit;
  /** 每张面值：U 本位=每张多少币（默认 0.01 BTC），币本位=每张多少美元（默认 100 USD）。 */
  contractSize: number;
  /** 杠杆倍数，1–125。 */
  leverage: number;
  marginMode: MarginMode;
  /** 吃单手续费（基点，1bp = 0.01%）。 */
  takerBps: number;
  /** 挂单手续费（基点）。 */
  makerBps: number;
  /** 市价单基础滑点（基点，按不利方向）。 */
  slippageBps: number;
  /** 吃满一整根K线成交量时的额外冲击（基点，按 √(订单名义/该K线名义) 增长）。 */
  impactBps: number;
  /** 资金费率（每 8 小时，小数，0.0001 = 0.01%）。 */
  fundingRate8h: number;
  /** 价格最小变动。 */
  tickSize: number;
  /** 最小下单量。 */
  minQty: number;
  /** 维持保证金率（用于强平价）。 */
  maintenanceMarginRate: number;
}
export const LEVERAGES = [1, 2, 3, 5, 10, 20, 50, 100] as const;
export const MAX_LEVERAGE = 125;
export const defaultContractSize = (settle: Settle): number => settle === 'coin' ? 100 : .01;
export const defaultSimConfig: SimConfig = {
  equity: 10_000, settle: 'usdt', qtyUnit: 'base', contractSize: defaultContractSize('usdt'), leverage: 3, marginMode: 'cross',
  takerBps: 5, makerBps: 2, slippageBps: 1, impactBps: 8, fundingRate8h: .0001,
  tickSize: .1, minQty: .0001, maintenanceMarginRate: .005,
};
export const INITIAL_CASH = defaultSimConfig.equity;
/** 内部精度：所有金额/数量在每次变更后都收到 8 位，杜绝 0.30000000000000004 这类尾巴。 */
export const ENGINE_DECIMALS = 8;
export const round8 = (value: number): number => Number.isFinite(value) ? Number(value.toFixed(ENGINE_DECIMALS)) : 0;
/** 显示位数：U 本位 2 位、币本位 8 位。 */
export const settleDigits = (config: SimConfig): number => config.settle === 'coin' ? 8 : 2;
/** 定长格式化（带千分位）。 */
export function formatNumber(value: number, digits: number): string {
  if (!Number.isFinite(value)) return '0';
  return Number(value.toFixed(digits)).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
/** 数量显示：抹掉浮点尾巴（0.009999999999999998 → 0.01），不补零。 */
export const qtyText = (n: number) => (Number.isFinite(n) ? Number(n.toFixed(8)) : 0).toLocaleString('en-US', { maximumFractionDigits: 8 });
/** 数量输入框文本：按精度四舍五入后**只裁小数尾零**。
 *  不能对整串用 /\.?0+$/ —— 那会把整数位的零也吃掉：100 → "1"、2500 → "25"（下单面板
 *  「25% / 50% / 最大」按钮曾因此报出错误的张数）。 */
export function quantityStepText(value: number, digits = 8): string {
  if (!Number.isFinite(value) || value <= 0) return '';
  const text = value.toFixed(digits);
  return text.includes('.') ? text.replace(/0+$/, '').replace(/\.$/, '') : text;
}
/** 向下取整到指定小数位的数量文本：给"最大/百分比"用，四舍五入会算出刚好超限的数量被拒单。 */
export function quantityStepDownText(value: number, digits = 8): string {
  if (!Number.isFinite(value) || value <= 0) return '';
  const factor = 10 ** digits;
  const floored = Math.floor(value * factor) / factor;
  return quantityStepText(floored, digits);
}

/** 结算币金额显示：U 本位 2 位、币本位 8 位。 */
export const settleText = (n: number, config: SimConfig) => formatNumber(n, settleDigits(config));
/** 百分比显示：0.05000000000000001 → 5.00%。 */
export const percentText = (ratio: number, digits = 2) => Number.isFinite(ratio) ? `${formatNumber(ratio * 100, digits)}%` : '—';
/** 价格显示：按最小变动位对齐（tick 0.1 → 1 位，0.01 → 2 位）。 */
export function priceText(value: number, tickSize = .1): string {
  if (!Number.isFinite(value)) return '—';
  const text = String(tickSize);
  const digits = text.includes('e-') ? Number(text.split('e-')[1]) : Math.min(8, (text.split('.')[1] ?? '').length);
  return formatNumber(value, Math.max(digits, 1));
}
export const money = (n: number) => formatNumber(n, 2);
export const FUNDING_INTERVAL_SECONDS = 8 * 3600;

/** 已成交的一笔（图表标记与统计的唯一来源）。 */
export interface Fill {
  id: string; time: number; price: number; qty: number;
  side: OrderSide; dir: Side; action: FillAction; reason: FillReason;
  fee: number; realized: number;
}
export interface Position { side: Side; qty: number; entry: number; margin: number }
export interface Account {
  /** 可用现金（不含仓位占用保证金）。 */
  balance: number;
  position: Position | null;
  /** 已实现盈亏（不含手续费，手续费单列）。 */
  realized: number; fees: number; funding: number; fills: Fill[];
  /** 触发过强平（复盘报告中标记）。 */
  liquidated: boolean;
}
export type TradeResult = { ok: true; account: Account; fill: Fill } | { ok: false; message: string };
export type CloseResult = { ok: true; account: Account; fill: Fill } | { ok: false; message: string };

export function roundToTick(price: number, tick: number): number {
  if (!(tick > 0)) return price;
  const text = String(tick);
  // 支持科学计数法刻度（1e-9 这类）：小数位数从指数里取。
  const decimals = text.includes('e-') ? Number(text.split('e-')[1]) : (text.split('.')[1] ?? '').length;
  return Number((Math.round(price / tick) * tick).toFixed(Math.min(14, decimals)));
}
export const bpsOf = (notional: number, bps: number) => Math.abs(notional) * Math.max(0, bps) / 10_000;
/** 综合滑点（基点）：基础滑点 + 平方根冲击模型，规模越大越吃亏。 */
export function slippageFor(config: SimConfig, context?: { orderNotional?: number; barNotional?: number }): number {
  const base = Math.max(0, config.slippageBps);
  const impact = Math.max(0, config.impactBps);
  const orderNotional = context?.orderNotional ?? 0, barNotional = context?.barNotional ?? 0;
  if (!impact || orderNotional <= 0 || barNotional <= 0) return base;
  const ratio = orderNotional / barNotional;
  return base + impact * Math.sqrt(Math.min(4, Math.max(0, ratio)));
}
/** 市价成交价：按不利方向滑点（含成交额冲击），并对齐最小变动。 */
export function marketPrice(side: OrderSide, price: number, config: SimConfig, context?: { orderNotional?: number; barNotional?: number }): number {
  const slipped = price * (1 + (side === 'buy' ? 1 : -1) * slippageFor(config, context) / 10_000);
  return roundToTick(slipped, config.tickSize);
}
export function newAccount(config: SimConfig = defaultSimConfig): Account {
  const equity = Number.isFinite(config.equity) && config.equity > 0 ? config.equity : INITIAL_CASH;
  return { balance: equity, position: null, realized: 0, fees: 0, funding: 0, fills: [], liquidated: false };
}
/** 名义价值（美元）：U 本位 = 币数量 × 价格；币本位 = 张数 × 面值。 */
export function notionalUsd(config: SimConfig, qty: number, price: number): number {
  return config.settle === 'coin' ? qty * config.contractSize : qty * price;
}
/** 数量折算成币（币本位随价格变化，这是反向合约的固有特性）。 */
export const baseQtyOf = (config: SimConfig, qty: number, price: number): number =>
  config.settle === 'coin' ? qty * config.contractSize / Math.max(price, 1e-9) : qty;
/** 开仓占用保证金，单位=结算币（币本位按币计）。 */
export function settledMargin(config: SimConfig, qty: number, price: number): number {
  const notional = notionalUsd(config, qty, price);
  const margin = notional / Math.max(1, config.leverage);
  return config.settle === 'coin' ? margin / Math.max(price, 1e-9) : margin;
}
/** 手续费，单位=结算币。 */
export function settledFee(config: SimConfig, qty: number, price: number, bps: number): number {
  const fee = bpsOf(notionalUsd(config, qty, price), bps);
  return config.settle === 'coin' ? fee / Math.max(price, 1e-9) : fee;
}
/** 持仓盈亏，单位=结算币。币本位用反向合约公式 N×(1/开仓 − 1/平仓)。 */
export function settledPnl(config: SimConfig, side: Side, qty: number, entry: number, exit: number): number {
  const sign = side === 'long' ? 1 : -1;
  if (config.settle === 'coin') return notionalUsd(config, qty, entry) * (1 / Math.max(entry, 1e-9) - 1 / Math.max(exit, 1e-9)) * sign;
  return (exit - entry) * qty * sign;
}
/** 展示用：结算货币符号。 */
export const settleSymbol = (config: SimConfig, base?: string): string => config.settle === 'coin' ? (base ?? 'COIN') : 'USDT';

export const unrealizedOf = (position: Position | null, price: number, config: SimConfig = defaultSimConfig) =>
  position ? settledPnl(config, position.side, position.qty, position.entry, price) : 0;
export const notionalOf = (position: Position | null, price: number, config: SimConfig = defaultSimConfig) => position ? notionalUsd(config, position.qty, price) : 0;
/** 权益 = 可用现金 + 占用保证金 + 浮动盈亏。 */
export function equityOf(account: Account, price: number, config: SimConfig = defaultSimConfig): number {
  return account.balance + (account.position?.margin ?? 0) + unrealizedOf(account.position, price, config);
}
export function marginUsed(account: Account): number { return account.position?.margin ?? 0; }
export function maintenanceMarginOf(config: SimConfig, position: Position | null, price: number): number {
  const maintenance = notionalUsd(config, position?.qty ?? 0, price) * Math.max(0, config.maintenanceMarginRate);
  return config.settle === 'coin' ? maintenance / Math.max(price, 1e-9) : maintenance;
}
/** 保证金率 = 维持保证金 / 缓冲（全仓用权益，逐仓只用该仓保证金）；≥ 1 即触发强平。 */
export function marginRatioOf(account: Account, price: number, config: SimConfig): number {
  const position = account.position;
  if (!position) return 0;
  const maintenance = maintenanceMarginOf(config, position, price);
  if (maintenance <= 0) return 0;
  const buffer = config.marginMode === 'isolated'
    ? position.margin + unrealizedOf(position, price, config)
    : equityOf(account, price, config);
  return buffer <= 0 ? 1 : maintenance / buffer;
}
/** 强平价：逐仓只吃该仓保证金，全仓吃整个账户权益。 */
export function liquidationPriceOf(account: Account, config: SimConfig): number {
  const position = account.position;
  if (!position || position.qty <= 0) return Number.NaN;
  const mmr = Math.min(.5, Math.max(0, config.maintenanceMarginRate));
  const { side, qty, entry, margin } = position;
  if (config.settle === 'coin') {
    // 反向合约：notional N（美元）固定，保证金/盈亏按币计。
    const N = notionalUsd(config, qty, entry);
    const buffer = (config.marginMode === 'isolated' ? margin : account.balance + margin) + 0;
    if (side === 'long') { const denom = buffer + N / Math.max(entry, 1e-9); return denom <= 0 ? Number.NaN : N * (1 + mmr) / denom; }
    const denom = N / Math.max(entry, 1e-9) - buffer;
    return denom <= 0 ? Number.NaN : N * (1 - mmr) / denom;
  }
  if (config.marginMode === 'isolated') {
    const ratio = margin / (qty * entry); // = 1 / leverage
    return side === 'long' ? entry * (1 - ratio) / (1 - mmr) : entry * (1 + ratio) / (1 + mmr);
  }
  const buffer = account.balance + margin;
  return side === 'long'
    ? (entry * qty - buffer) / (qty * (1 - mmr))
    : (entry * qty + buffer) / (qty * (1 + mmr));
}
/** 资金费率结算：正费率多头付空头，按 8 小时结转。 */
export function applyFunding(account: Account, config: SimConfig, price: number, periods = 1, rateOverride?: number): Account {
  const position = account.position;
  const rate = rateOverride ?? config.fundingRate8h;
  if (!position || !rate) return account;
  const gross = notionalUsd(config, position.qty, price) * rate * periods;
  const payment = config.settle === 'coin' ? gross / Math.max(price, 1e-9) : gross;
  const delta = position.side === 'long' ? -payment : payment;
  return { ...account, balance: round8(account.balance + delta), funding: round8(account.funding + delta) };
}
/** 手续费与占用的公共部分：开仓/加仓。 */
function withFill(account: Account, fill: Fill): Account {
  return { ...account, fills: [...account.fills, fill], fees: round8(account.fees + fill.fee), realized: round8(account.realized + fill.realized) };
}

/** 开仓或加仓（side 为买入即做多，卖出即做空）。 */
export function openPosition(account: Account, config: SimConfig, request: { side: OrderSide; qty: number; price: number; time: number; reason?: FillReason; maker?: boolean; id?: string }): TradeResult {
  const dir: Side = request.side === 'buy' ? 'long' : 'short';
  const qty = request.qty;
  if (!Number.isFinite(qty) || qty <= 0) return { ok: false, message: '请输入大于 0 的有效数量。' };
  if (qty < config.minQty) return { ok: false, message: `数量低于最小下单量 ${config.minQty}。` };
  if (!Number.isFinite(request.price) || request.price <= 0) return { ok: false, message: '当前价格无效。' };
  if (account.position && account.position.side !== dir) return { ok: false, message: '已有反向持仓，请先平仓或使用反手。' };
  const price = roundToTick(request.price, config.tickSize);
  const marginAdd = settledMargin(config, qty, price);
  const fee = settledFee(config, qty, price, request.maker ? config.makerBps : config.takerBps);
  if (marginAdd + fee > account.balance + 1e-9) return { ok: false, message: `保证金不足：需要 ${money(marginAdd + fee)} USDT，可用 ${money(account.balance)} USDT（降低数量或提高杠杆）。` };
  const existing = account.position;
  const position: Position = existing
    ? { ...existing, qty: existing.qty + qty, entry: (existing.entry * existing.qty + price * qty) / (existing.qty + qty), margin: existing.margin + marginAdd }
    : { side: dir, qty, entry: price, margin: marginAdd };
  const fill: Fill = { id: request.id ?? `fill-${request.time}-${account.fills.length}`, time: request.time, price, qty, side: request.side, dir, action: existing ? 'add' : 'open', reason: request.reason ?? 'market', fee, realized: 0 };
  const next = withFill({ ...account, balance: round8(account.balance - marginAdd - fee), position: { ...position, qty: round8(position.qty), entry: round8(position.entry), margin: round8(position.margin) } }, { ...fill, fee: round8(fee), realized: round8(fill.realized) });
  return { ok: true, account: next, fill };
}
/** 平仓或减仓（side 为卖出即平多，买入即平空）。`qty` 省略或超过持仓时全部平掉。 */
export function closePosition(account: Account, config: SimConfig, request: { side: OrderSide; price: number; time: number; qty?: number; reason?: FillReason; maker?: boolean; id?: string }): CloseResult {
  const position = account.position;
  if (!position) return { ok: false, message: '当前没有持仓。' };
  const expect: OrderSide = position.side === 'long' ? 'sell' : 'buy';
  if (request.side !== expect) return { ok: false, message: position.side === 'long' ? '多头请用卖出平仓。' : '空头请用买入平仓。' };
  if (!Number.isFinite(request.price) || request.price <= 0) return { ok: false, message: '当前价格无效。' };
  const wanted = Number.isFinite(request.qty as number) && (request.qty as number) > 0 ? Math.min(request.qty as number, position.qty) : position.qty;
  const price = roundToTick(request.price, config.tickSize);
  const fee = settledFee(config, wanted, price, request.maker ? config.makerBps : config.takerBps);
  const pnl = settledPnl(config, position.side, wanted, position.entry, price);
  const release = position.margin * (wanted / position.qty);
  const remaining = position.qty - wanted;
  const nextPosition: Position | null = remaining > 1e-12 ? { ...position, qty: remaining, margin: position.margin - release } : null;
  const fill: Fill = { id: request.id ?? `fill-${request.time}-${account.fills.length}`, time: request.time, price, qty: wanted, side: request.side, dir: position.side, action: remaining > 1e-12 ? 'reduce' : 'close', reason: request.reason ?? 'market', fee, realized: pnl };   // 口径：毛盈亏（不含手续费），手续费只在 fee/account.fees 记一次
  const next = withFill({ ...account, balance: round8(account.balance + release + pnl - fee), position: nextPosition ? { ...nextPosition, qty: round8(nextPosition.qty), margin: round8(nextPosition.margin) } : null }, { ...fill, fee: round8(fee), realized: round8(pnl) });
  return { ok: true, account: next, fill };
}
/** 反手：平掉当前持仓并按同数量开出反向仓。 */
export function reversePosition(account: Account, config: SimConfig, request: { price: number; time: number; qty?: number; reason?: FillReason }): TradeResult {
  const position = account.position;
  if (!position) return { ok: false, message: '当前没有持仓，无法反手。' };
  const closed = closePosition(account, config, { side: position.side === 'long' ? 'sell' : 'buy', price: request.price, time: request.time, reason: request.reason });
  if (!closed.ok) return closed;
  const qty = Number.isFinite(request.qty as number) && (request.qty as number) > 0 ? request.qty as number : position.qty;
  const opened = openPosition(closed.account, config, { side: position.side === 'long' ? 'sell' : 'buy', qty, price: request.price, time: request.time, reason: request.reason });
  if (!opened.ok) return { ok: false, message: `反手后开仓失败：${opened.message}` };
  const fill: Fill = { ...opened.fill, action: 'reverse' };
  return { ok: true, account: { ...opened.account, fills: [...opened.account.fills.slice(0, -1), fill] }, fill };
}
/** 强平：按强平价清仓；逐仓只亏该仓保证金，全仓可把可用现金亏光（不会为负）。 */
export function liquidate(account: Account, config: SimConfig, price: number, time: number): Account {
  const position = account.position;
  if (!position) return account;
  const side: OrderSide = position.side === 'long' ? 'sell' : 'buy';
  const closePrice = roundToTick(Number.isFinite(price) && price > 0 ? price : position.entry, config.tickSize);
  const fee = settledFee(config, position.qty, closePrice, config.takerBps);
  const pnl = settledPnl(config, position.side, position.qty, position.entry, closePrice);
  const isolated = config.marginMode === 'isolated';
  // 逐仓：亏损以该仓保证金为限；全仓：亏损以整个账户权益为限。
  const loss = Math.max(0, -pnl);
  const covered = isolated ? Math.min(loss, position.margin) : Math.min(loss, position.margin + account.balance);
  const released = Math.max(0, position.margin - covered);
  const profit = Math.max(0, pnl);
  const fill: Fill = {
    id: `fill-liq-${time}`, time, price: closePrice, qty: position.qty, side, dir: position.side, action: 'close', reason: 'liquidation',
    fee, realized: -covered,   // 同上：毛额，手续费单列
  };
  return withFill({ ...account, balance: round8(account.balance + released + profit), position: null, liquidated: true }, fill);
}
/** 账户概览：给状态栏与复盘报告用。 */
export function accountValues(account: Account, price: number, config: SimConfig = defaultSimConfig) {
  const unrealized = round8(unrealizedOf(account.position, price, config));
  const equity = round8(equityOf(account, price, config));
  const position = account.position;
  return {
    // 真实可用现金：占用保证金与手续费已由引擎逐步算进 account.balance；
    // 旧实现用"期初+已实现+资金费"重建，既漏减占用保证金/开仓手续费，又重复扣平仓手续费。
    balance: round8(account.balance),
    equity, unrealized,
    margin: round8(marginUsed(account)),
    available: Math.max(0, round8(account.balance)),
    // 比例只保留 6 位（够看，且不会出现 0.04000000000000001 这类尾巴）
    marginRatio: round8(Number(marginRatioOf(account, price, config).toFixed(6))),
    liquidationPrice: round8(liquidationPriceOf(account, config)),
    notional: round8(notionalOf(position, price, config)),
    entry: position?.entry ?? 0,
    settle: config.settle, qtyUnit: config.qtyUnit, baseQty: position ? baseQtyOf(config, position.qty, price) : 0,
    fees: account.fees, funding: account.funding,
    side: position?.side ?? null, qty: position?.qty ?? 0,
  };
}
export type AccountValues = ReturnType<typeof accountValues>;
const isRecord2 = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
const finite2 = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
/** 校验外部（本机存档/导入）带来的账户配置，越界值回落到安全区间。 */
export function sanitizeSimConfig(value: unknown, fallback: SimConfig = defaultSimConfig): SimConfig {
  if (!isRecord2(value)) return { ...fallback };
  // 本金下限按结算本位区分：U 本位 100 USDT 起；币本位是"币的数量"，
  // 用 USDT 口径的 100 做下限会把 0.13 BTC 判为非法并回退成 10,000（实测出现"账户权益 10,000 BTC"）。
  const settle = value.settle === 'coin' ? 'coin' as const : 'usdt' as const;
  const equityFloor = settle === 'coin' ? 1e-8 : 100;
  const equity = finite2(value.equity) && value.equity >= equityFloor ? Math.min(value.equity, 1e9) : fallback.equity;
  const bps = (entry: unknown, def: number) => finite2(entry) && entry >= 0 && entry <= 100 ? entry : def;
  return {
    equity,
    settle,
    qtyUnit: value.qtyUnit === 'contract' ? 'contract' : 'base',
    contractSize: finite2(value.contractSize) && value.contractSize > 0 && value.contractSize <= 1e6 ? value.contractSize : defaultContractSize(value.settle === 'coin' ? 'coin' : 'usdt'),
    leverage: finite2(value.leverage) ? clamp(Math.round(value.leverage), 1, MAX_LEVERAGE) : fallback.leverage,
    marginMode: value.marginMode === 'isolated' ? 'isolated' : 'cross',
    takerBps: bps(value.takerBps, fallback.takerBps),
    makerBps: bps(value.makerBps, fallback.makerBps),
    slippageBps: bps(value.slippageBps, fallback.slippageBps),
    impactBps: bps(value.impactBps, fallback.impactBps),
    fundingRate8h: finite2(value.fundingRate8h) && Math.abs(value.fundingRate8h) <= .01 ? value.fundingRate8h : fallback.fundingRate8h,
    tickSize: finite2(value.tickSize) && value.tickSize > 0 && value.tickSize <= 100 ? value.tickSize : fallback.tickSize,
    minQty: finite2(value.minQty) && value.minQty > 0 && value.minQty <= 1000 ? value.minQty : fallback.minQty,
    maintenanceMarginRate: finite2(value.maintenanceMarginRate) ? clamp(value.maintenanceMarginRate, 0, .5) : fallback.maintenanceMarginRate,
  };
}
/** 逐笔重放：从空账户按成交序列重建（回退时用得上）。 */
export function replayFills(fills: readonly Fill[], config: SimConfig): Account {
  return fills.reduce((account, fill) => {
    const request = { side: fill.side, qty: fill.qty, price: fill.price, time: fill.time, reason: fill.reason };
    const result = fill.action === 'reduce' || fill.action === 'close' || fill.reason === 'liquidation'
      ? closePosition(account, config, { side: fill.side, qty: fill.qty, price: fill.price, time: fill.time, reason: fill.reason })
      : openPosition(account, config, request);
    return result.ok ? result.account : account;
  }, newAccount(config));
}
