/*!
 * src/components/AccountBar.tsx - zhuk-replay-studio key core logic
 * (c) 2026 William-Trader (https://github.com/William-Trader)
 * WM: ZRS-21396901
 * SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
 * Removing this mark violates the license.
 */
import { money, percentText, priceText, qtyText, settleText, type AccountValues, type SimConfig } from '../model';

interface Props {
  values: AccountValues; config: SimConfig; symbol: string; base: string;
  /** 当前资金费率与下次结算（实况数据时才有）。 */
  premium?: { rate: number; nextFundingTime: number } | null;
  protection: { sl?: number; tp?: number; trail?: number } | null;
  liquidated: boolean;
  onCloseAll: () => void;
}
const pct = (value: number) => percentText(value);
/** 账户状态栏：权益、保证金、保证金率、强平价与浮动盈亏。 */
export function AccountBar({ values, config, symbol, base, premium, protection, liquidated, onCloseAll }: Props) {
  const risk = !Number.isFinite(values.marginRatio) ? '—' : values.marginRatio >= .8 ? 'negative' : values.marginRatio >= .5 ? 'warning' : 'positive';
  return <div className="accountbar sim-accountbar" data-testid="account-bar" data-side={values.side ?? ''} data-leverage={config.leverage} data-margin-mode={config.marginMode}>
    <div className="account-controls">
      <span className="account-select" title={`${config.settle === 'coin' ? '币本位（反向）' : 'U本位（线性）'} · ${config.marginMode === 'cross' ? '全仓' : '逐仓'} · ${config.leverage}×`}>{symbol} {config.settle === 'coin' ? '币本位' : 'U本位'}模拟 <small>{config.marginMode === 'cross' ? '全仓' : '逐仓'} {config.leverage}×</small></span>
      {values.side && <span className={`position-chip ${values.side}`} data-testid="position-chip">{values.side === 'long' ? '多' : '空'} {qtyText(values.qty)}{config.qtyUnit === 'contract' ? '张' : ''} @ {priceText(values.entry, config.tickSize)}
        <button onClick={onCloseAll} aria-label="一键平仓">平</button></span>}
      {liquidated && <span className="position-chip liquidated" data-testid="liquidated-chip">已爆仓</span>}
      {protection && (protection.sl !== undefined || protection.tp !== undefined || protection.trail !== undefined) && <span className="position-chip protect" data-testid="protection-chip">
        {protection.sl !== undefined && `止损 ${priceText(protection.sl, config.tickSize)}`}{protection.tp !== undefined && ` 止盈 ${priceText(protection.tp, config.tickSize)}`}{protection.trail !== undefined && ` 跟踪 ${priceText(protection.trail, config.tickSize)}`}
      </span>}
    </div>
    <div className="account-stats sim-stats">
      <div><span>账户权益（{config.settle === 'coin' ? base : 'USDT'}）</span><strong data-testid="equity">{settleText(values.equity, config)}</strong></div>
      <div><span>可用保证金</span><strong data-testid="available">{settleText(values.available, config)}</strong></div>
      <div><span>占用保证金</span><strong data-testid="margin">{settleText(values.margin, config)}</strong></div>
      <div><span>保证金率</span><strong className={risk} data-testid="margin-ratio">{pct(values.marginRatio)}</strong></div>
      <div><span>强平价</span><strong data-testid="liquidation-price">{Number.isFinite(values.liquidationPrice) && values.liquidationPrice > 0 ? priceText(values.liquidationPrice, config.tickSize) : '—'}</strong></div>
      <div><span>浮动盈亏</span><strong className={values.unrealized < 0 ? 'negative' : 'positive'} data-testid="unrealized">{values.unrealized >= 0 ? '+' : ''}{settleText(values.unrealized, config)}</strong></div>
      <div><span>手续费/资金费</span><strong data-testid="costs">{settleText(values.fees, config)} / {settleText(values.funding, config)}</strong></div>
      <div><span>资金费率</span><strong data-testid="funding-rate">{premium ? `${percentText(premium.rate, 4)} / 8h` : `${percentText(config.fundingRate8h, 4)} / 8h（配置）`}</strong></div>
      <div><span>下次结算</span><strong data-testid="funding-next">{premium ? new Date(premium.nextFundingTime * 1000).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Shanghai' }) : '—'}</strong></div>
    </div>
  </div>;
}
