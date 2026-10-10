/*!
 * src/components/TradeTicket.tsx - zhuk-replay-studio key core logic
 * (c) 2026 William-Trader (https://github.com/William-Trader)
 * WM: ZRS-81558A91
 * SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
 * Removing this mark violates the license.
 */
import { useState } from 'react';
import { LEVERAGES, MAX_LEVERAGE, baseQtyOf, money, notionalUsd, priceText, qtyText, quantityStepDownText, quantityStepText, settleText, settledFee, settledMargin, type SimConfig } from '../model';

export type TicketAction = 'open-long' | 'open-short' | 'close' | 'reduce' | 'reverse' | 'protect';
export type TicketKind = 'market' | 'limit' | 'stop';
interface Props {
  config: SimConfig; onConfig: (patch: Partial<SimConfig>) => void;
  quantity: string; onQuantity: (value: string) => void;
  price: string; onPrice: (value: string) => void;
  orderType: TicketKind; onOrderType: (value: TicketKind) => void;
  orderSide: 'long' | 'short'; onOrderSide: (value: 'long' | 'short') => void;
  reduceOnly: boolean; onReduceOnly: (value: boolean) => void;
  protectOn: boolean; onProtectOn: (value: boolean) => void;
  sl: string; tp: string; trail: string;
  onSl: (value: string) => void; onTp: (value: string) => void; onTrail: (value: string) => void;
  position: { side: 'long' | 'short'; qty: number } | null;
  available: number; markPrice: number; tickSize: number; minQty: number;
  /** 标的币种（BTC），用于币本位显示与单位后缀。 */
  baseSymbol: string;
  onSubmit: (action: TicketAction, kind: TicketKind) => void;
  onSaveDefaults: () => void;
  /** 处于「选择起点」状态：此时下单会被清空，面板上直接说明，避免点了没反应。 */
  choosing?: boolean;
  /** 不可下单的原因（如行情还在加载）：按钮禁用 + 面板说明，避免下单后数据落地被清掉。 */
  blockedReason?: string; defaultsSaved: boolean;
}
const QUICK = [.25, .5, 1] as const;
const KINDS: { value: TicketKind; label: string }[] = [{ value: 'limit', label: '限价' }, { value: 'market', label: '市价' }, { value: 'stop', label: '止损' }];

/** 下单面板（OKX 布局 + TradingView 视觉）：保证金模式/杠杆 → 委托类型与数量 → TP/SL → 买/卖按钮。 */
export function TradeTicket(props: Props) {
  const { config, position, available, markPrice, baseSymbol } = props;
  const coin = config.settle === 'coin';
  const contract = config.qtyUnit === 'contract';
  const unitLabel = contract ? '张' : baseSymbol;
  const price = Number(props.price) || markPrice;
  const qty = Number(props.quantity) || 0;
  const settleLabel = coin ? baseSymbol : 'USDT';
  /** 最大可开：按可用保证金与杠杆折算成当前单位。 */
  // 最大可开：可用保证金要同时覆盖"占用保证金 + 预估手续费"，否则"最大"会算出刚好超限的数量被拒单。
  const feeRate = Math.max(0, config.takerBps) / 10_000;
  const maxNotional = available > 0 ? (available * .998) / (1 / Math.max(1, config.leverage) + feeRate) : 0;
  const perUnitNotional = contract ? (coin ? config.contractSize : config.contractSize * markPrice) : markPrice;
  const maxQty = perUnitNotional > 0 ? Math.max(0, maxNotional / perUnitNotional) : 0;
  const notional = notionalUsd(config, qty, price);
  const margin = settledMargin(config, qty, price);
  const fee = settledFee(config, qty, price, config.takerBps);
  const baseQty = baseQtyOf(config, qty, price);
  // 向下取整：四舍五入会给出比上限多一丝的数量，导致"最大"被拒单。
  /** 高级项折叠：保证金模式/杠杆/本位/单位/存为默认/只减仓（默认收起，减少面板冗杂）。 */
  const [advanced, setAdvanced] = useState(false);
  const step = (ratio: number) => props.onQuantity(quantityStepDownText(maxQty * ratio, contract ? 2 : 6));
  const kindLabel = KINDS.find(entry => entry.value === props.orderType)?.label ?? '市价';
  return <div className="trade-ticket" data-testid="trade-ticket" data-settle={config.settle} data-unit={config.qtyUnit}>
    <div className="ticket-row ticket-head">
      <span className="ticket-summary" data-testid="ticket-summary" title="当前下单参数"><b>{config.leverage}×</b> {config.marginMode === 'cross' ? '全仓' : '逐仓'} · {settleLabel} · {unitLabel}</span>
      <button className="ticket-advanced-toggle" data-testid="ticket-advanced" aria-expanded={advanced} title="保证金模式 / 杠杆 / 本位 / 单位 / 存为默认" onClick={() => setAdvanced(v => !v)}>{advanced ? '收起高级 ▴' : '高级 ▾'}</button>
      <span className="ticket-max">可用 {settleText(available, config)} {settleLabel} · 最大 {qtyText(maxQty)} {unitLabel}</span>
    </div>
    {advanced && <div className="ticket-row ticket-advanced" data-testid="ticket-advanced-panel">
      <div className="seg" role="group" aria-label="保证金模式">
        {(['cross', 'isolated'] as const).map(mode => <button key={mode} className={config.marginMode === mode ? 'on' : ''} data-testid={`margin-${mode}`} onClick={() => props.onConfig({ marginMode: mode })}>{mode === 'cross' ? '全仓' : '逐仓'}</button>)}
      </div>
      <label className="ticket-leverage" title="杠杆倍数">杠杆
        <select aria-label="杠杆" value={config.leverage} onChange={event => props.onConfig({ leverage: Number(event.target.value) })}>{LEVERAGES.map(value => <option key={value} value={value}>{value}×</option>)}</select>
      </label>
      <label className="ticket-leverage" title="结算本位">本位
        <select aria-label="结算本位" data-testid="settle-select" value={config.settle} onChange={event => {
          const settle = event.target.value as SimConfig['settle'];
          const equity = settle === config.settle ? config.equity
            : settle === 'coin' ? Number((config.equity / Math.max(markPrice, 1e-9)).toFixed(8))
            : Number((config.equity * markPrice).toFixed(2));
          props.onConfig({ settle, equity, qtyUnit: settle === 'coin' ? 'contract' : config.qtyUnit, contractSize: settle === 'coin' ? 100 : .01 });
        }}><option value="usdt">U本位</option><option value="coin">币本位</option></select>
      </label>
      <label className="ticket-leverage" title="数量单位">单位
        <select aria-label="数量单位" data-testid="unit-select" value={config.qtyUnit} onChange={event => props.onConfig({ qtyUnit: event.target.value as SimConfig['qtyUnit'] })}><option value="base">{baseSymbol}</option><option value="contract">张</option></select>
      </label>
      <button className="ticket-save" data-testid="save-order-defaults" title="把当前下单参数存为默认" onClick={props.onSaveDefaults}>{props.defaultsSaved ? '已存默认 ✓' : '存为默认'}</button>
    </div>}
    <div className="ticket-row">
      <div className="seg" role="group" aria-label="委托类型">
        {KINDS.map(entry => <button key={entry.value} className={props.orderType === entry.value ? 'on' : ''} data-testid={`kind-${entry.value}`} onClick={() => props.onOrderType(entry.value)}>{entry.label}</button>)}
      </div>
      <label className="ticket-price">价格
        <input aria-label="委托价格" type="number" step={props.tickSize} value={props.price} disabled={props.orderType === 'market'} placeholder={props.orderType === 'market' ? '以市价成交' : priceText(markPrice, props.tickSize)} onChange={event => props.onPrice(event.target.value)} />
        <button type="button" className="ticket-mark" title="填入标记价" onClick={() => props.onPrice(String(markPrice))}>标记价</button>
      </label>
      <label className="ticket-qty">数量
        <input aria-label="下单数量" type="number" step={contract ? 1 : .0001} min="0" value={props.quantity} onChange={event => props.onQuantity(event.target.value)} />
        <span className="unit-chip">{unitLabel}</span>
      </label>
      <span className="ticket-quick">{QUICK.map(ratio => <button key={ratio} onClick={() => step(ratio)} title={`最大可开的 ${ratio * 100}%`}>{ratio === 1 ? '最大' : `${ratio * 100}%`}</button>)}</span>
      {advanced && <label className="ticket-check"><input type="checkbox" aria-label="只减仓" checked={props.reduceOnly} onChange={event => props.onReduceOnly(event.target.checked)} />只减仓</label>}
    </div>
    <div className={`ticket-row ticket-protect ${props.protectOn ? '' : 'off'}`}>
      <label className="ticket-check ticket-protect-toggle"><input type="checkbox" aria-label="止盈止损" checked={props.protectOn} onChange={event => props.onProtectOn(event.target.checked)} />止盈/止损</label>
      <label className="ticket-price">止盈 <input aria-label="止盈价" type="number" step={props.tickSize} value={props.tp} disabled={!props.protectOn} onChange={event => props.onTp(event.target.value)} /></label>
      <label className="ticket-price">止损 <input aria-label="止损价" type="number" step={props.tickSize} value={props.sl} disabled={!props.protectOn} onChange={event => props.onSl(event.target.value)} /></label>
      <label className="ticket-price">跟踪 <input aria-label="跟踪止损" type="number" step="0.1" min="0" placeholder="0" value={props.trail} disabled={!props.protectOn} onChange={event => props.onTrail(event.target.value)} /><span className="unit-chip">%</span></label>
      <span className="ticket-plan" data-testid="ticket-plan">名义 {money(notional)} USD · 占用 {settleText(margin, config)} {settleLabel} · ≈{qtyText(baseQty)} {baseSymbol} · 手续费≈{settleText(fee, config)} {settleLabel}</span>
    </div>
    <div className="ticket-row ticket-actions">
      {props.choosing && <p className="ticket-notice" data-testid="ticket-choosing-notice">正在选择回放起点：先在图表点一根K线（或 Esc 取消）再下单；选中起点会清空模拟交易记录。</p>}
      {props.blockedReason && <p className="ticket-notice blocked" data-testid="ticket-blocked-notice">⏳ {props.blockedReason}</p>}
      <button className="ticket-open long" data-testid="open-long" disabled={!!props.blockedReason} onClick={() => props.onSubmit('open-long', props.orderType)}>{kindLabel}开多<span>买入</span></button>
      <button className="ticket-open short" data-testid="open-short" disabled={!!props.blockedReason} onClick={() => props.onSubmit('open-short', props.orderType)}>{kindLabel}开空<span>卖出</span></button>
      <button data-testid="close-position" disabled={!position} title="平掉整个持仓（一次性全部平仓）" onClick={() => props.onSubmit('close', 'market')}>全部平仓{position ? `（${qtyText(position.qty)}）` : ''}</button>
      <button data-testid="reduce-position" disabled={!position || !(qty > 0) || qty >= (position?.qty ?? 0)} title="按上面的数量减仓（部分平仓）" onClick={() => props.onSubmit('reduce', 'market')}>减仓{qty > 0 && position && qty < position.qty ? `（${qtyText(qty)}）` : ''}</button>
      <button data-testid="reverse-position" disabled={!position} onClick={() => props.onSubmit('reverse', 'market')}>反手</button>
      <button data-testid="apply-protection" disabled={!position} title="把当前止盈/止损设置到已有持仓" onClick={() => props.onSubmit('protect', 'market')}>设保护</button>
    </div>
  </div>;
}
