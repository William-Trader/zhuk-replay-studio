/*!
 * src/components/Dashboard.tsx - zhuk-replay-studio key core logic
 * (c) 2026 William-Trader (https://github.com/William-Trader)
 * WM: ZRS-6EFC52D7
 * SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
 * Removing this mark violates the license.
 */
import { Icon } from './Icon';
import { aggregate, detectStyle, equityBySession, type SessionRecord, type StyleTag } from '../history';
import { curvePath } from '../stats';

interface Props {
  records: SessionRecord[];
  /** 结算货币符号（U本位 USDT / 币本位 BTC）。 */
  unit: string;
  onExport: () => void; onClear: () => void; onClose: () => void;
}
const TONE_CLASS: Record<StyleTag['tone'], string> = { positive: 'tone-good', neutral: 'tone-neutral', warning: 'tone-warn' };
const f2 = (value: number, unit: string) => `${value >= 0 ? '+' : ''}${Number(value.toFixed(unit === 'USDT' ? 2 : 8)).toLocaleString('en-US', { maximumFractionDigits: 8 })}`;

/** 个人主面板：累计战绩、风格标签、累计曲线与最近复盘记录。 */
export function Dashboard({ records, unit, onExport, onClear, onClose }: Props) {
  const totals = aggregate(records);
  const tags = detectStyle(records);
  const curve = equityBySession(records);
  const path = curvePath(curve, 320, 56, 90);
  const recent = [...records].slice(-12).reverse();
  const pct = (value: number) => `${(value * 100).toFixed(1)}%`;
  return <div className="dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="date-dialog dashboard-dialog" role="dialog" aria-label="个人主面板" data-testid="dashboard">
      <header className="dashboard-head">
        <h3>个人主面板<small>累计 {totals.sessions} 局复盘 · {totals.trades} 笔成交 · {unit} 结算</small></h3>
        <button className="dash-close" aria-label="关闭主面板" onClick={onClose}><Icon name="close" /></button>
      </header>

      <section className="dash-tags" aria-label="交易风格标签" data-testid="style-tags">
        {tags.length ? tags.map(tag => <span key={tag.id} className={`style-chip ${TONE_CLASS[tag.tone]}`} title={tag.detail} data-testid="style-tag">
          <b>{tag.label}</b><em>{tag.detail}</em>
        </span>) : <span className="dash-empty">完成并保留几次复盘后，这里会自动识别你的交易风格。</span>}
      </section>

      <section className="dash-grid" aria-label="战绩总览">
        <div><span>总盈亏</span><b className={totals.realized < 0 ? 'negative' : 'positive'} data-testid="dash-realized">{f2(totals.realized, unit)} {unit}</b></div>
        <div><span>胜率</span><b data-testid="dash-winrate">{pct(totals.winRate)}<small>（{totals.wins}胜 {totals.losses}负）</small></b></div>
        <div><span>盈亏比 PF</span><b>{Number.isFinite(totals.profitFactor) ? totals.profitFactor.toFixed(2) : '∞'}</b></div>
        <div><span>最大单局回撤</span><b className="negative">{f2(-totals.maxDrawdown, unit)} {unit}</b></div>
        <div><span>平均持仓</span><b>{totals.avgHoldingMinutes ? `${totals.avgHoldingMinutes.toFixed(1)} 分钟` : '—'}</b></div>
        <div><span>平均杠杆 / 每局笔数</span><b>{totals.avgLeverage.toFixed(1)}× · {totals.avgTradesPerSession.toFixed(1)}</b></div>
        <div><span>多 / 空</span><b>{totals.longTrades}多 {f2(totals.longPnl, unit)} · {totals.shortTrades}空 {f2(totals.shortPnl, unit)}</b></div>
        <div><span>爆仓 / 预警</span><b className={totals.liquidations ? 'negative' : ''}>{totals.liquidations} 次 · {totals.alerts} 次</b></div>
        <div><span>手续费 / 资金费</span><b>{f2(-totals.fees, unit)} / {f2(totals.funding, unit)}</b></div>
        <div><span>当前连续</span><b className={totals.streakKind === 'win' ? 'positive' : totals.streakKind === 'loss' ? 'negative' : ''}>{totals.streakKind === 'none' ? '—' : `${totals.streak} 局${totals.streakKind === 'win' ? '盈利' : '亏损'}`}</b></div>
      </section>

      <section className="dash-curve" aria-label="累计盈亏曲线" data-testid="dash-curve">
        {path ? <><svg viewBox="0 0 320 56" preserveAspectRatio="none"><path d={path} fill="none" stroke="#2962ff" strokeWidth="1.5" /></svg>
          <span className={totals.realized < 0 ? 'negative' : 'positive'}>{f2(totals.realized, unit)} {unit}</span></>
          : <span className="dash-empty">{totals.sessions ? `累计 ${totals.sessions} 局：再完成 1 局并保留结果即可画出累计曲线。` : '还没有已保留的复盘战绩。'}</span>}
      </section>

      <section className="dash-table" aria-label="最近复盘">
        <div className="dash-table-head"><span>时间</span><span>品种</span><span>周期</span><span>回放</span><span>成交</span><span>胜率</span><span>盈亏</span></div>
        {recent.length ? recent.map(record => <div key={record.id} className="dash-row" data-testid="dash-row" data-liquidated={record.liquidated}>
          <span>{new Date(record.at).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
          <span>{record.symbol}{record.liquidated ? ' ⚠' : ''}</span>
          <span>{record.interval}</span>
          <span>{record.bars} 根</span>
          <span>{record.trades} 笔</span>
          <span>{pct(record.winRate)}</span>
          <span className={record.realized < 0 ? 'negative' : 'positive'}>{f2(record.realized, unit)}</span>
        </div>) : <div className="dash-empty">还没有记录：完成一局复盘后在结果框点「保留结果」即会计入。</div>}
      </section>

      <footer className="dashboard-foot">
        <small>战绩保存在本机；每局「保留结果」时计入综合统计与风格识别。</small>
        <button type="button" data-testid="dash-export" onClick={onExport}>导出战绩 CSV</button>
        <button type="button" data-testid="dash-clear" onClick={onClear}>清空战绩</button>
        <button type="button" className="primary" onClick={onClose}>关闭</button>
      </footer>
    </div>
  </div>;
}
