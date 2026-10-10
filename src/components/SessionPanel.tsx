/*!
 * src/components/SessionPanel.tsx - zhuk-replay-studio key core logic
 * (c) 2026 William-Trader (https://github.com/William-Trader)
 * WM: ZRS-EC3999A2
 * SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
 * Removing this mark violates the license.
 */
import { Icon } from './Icon';
import { curvePath, type TradeStats } from '../stats';
import { durationText, type ReplaySession, type SessionStats } from '../session';

interface PanelProps {
  session: ReplaySession; stats: SessionStats; playing: boolean; fraction: number; speed: number; step: number;
  onTogglePlay: () => void; onFinish: () => void;
}
/** 复盘 HUD：用时、回放根数、成交与盈亏，外加当前K线生长进度。 */
export function SessionPanel({ session, stats, playing, fraction, speed, step, onTogglePlay, onFinish }: PanelProps) {
  return <div className="float-panel session-hud" data-testid="session-hud" data-progress={Math.round(fraction * 100)} aria-label="复盘进度">
    <header><strong><Icon name="target" /> 复盘进行中</strong><span className="muted">{durationText(Date.now() - session.startedAt)}</span></header>
    <div className="session-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(fraction * 100)}><i style={{ width: `${Math.round(fraction * 100)}%` }} /></div>
    <div className="session-metrics">
      <span>本次回放 <b data-testid="session-bars">{stats.bars} 根</b></span>
      <span>成交 <b data-testid="session-fills">{stats.fills} 笔</b></span>
      <span>已实现 <b data-testid="session-realized" className={stats.realized < 0 ? 'negative' : 'positive'}>{stats.realized >= 0 ? '+' : ''}{stats.realized.toFixed(2)}</b></span>
    </div>
    <footer>
      <small>当前K线 {Math.round(fraction * 100)}% · {speed}× · 步长 {step === 1 ? '整根' : `1/${step}`} · {playing ? '播放中' : '已暂停'}</small>
      <button className="primary" data-testid="finish-session" onClick={onFinish}>结束复盘</button>
    </footer>
  </div>;
}

interface ResultProps { stats: SessionStats; trade: TradeStats; market: string; unit: string; alerts: string[]; onKeep: () => void; onDiscard: () => void; onExport: () => void }
const pct = (value: number) => `${(value * 100).toFixed(1)}%`;
/** 复盘结果：交易统计 + 权益曲线，保留 / 删除 / 导出。 */
export function SessionResultDialog({ stats, trade, market, unit, alerts, onKeep, onDiscard, onExport }: ResultProps) {
  const curve = curvePath(stats.curve, 320, 54, 90);
  /** 结算币位数：U 本位 2 位、币本位 8 位，浮点尾巴一律抹掉。 */
  const digits = unit === 'USDT' ? 2 : 8;
  const display = (value: number) => Number(value.toFixed(digits)).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return <div className="dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onKeep(); }}>
    <div className="date-dialog session-result" role="dialog" aria-label="复盘结果" data-testid="session-result">
      <h3>复盘结果 · {market}<small>{unit} 结算 · {stats.minutes} 分钟 · 回放 {stats.bars} 根K线</small></h3>
      {curve && <div className="result-curve" data-testid="result-curve"><svg viewBox="0 0 320 54" preserveAspectRatio="none"><path d={curve} fill="none" stroke="#2962ff" strokeWidth="1.5" /></svg>
        <span className={trade.realized < 0 ? 'negative' : 'positive'}>{trade.realized >= 0 ? '+' : ''}{display(trade.realized)} {unit}</span></div>}
      <div className="result-grid">
        <div><span>成交</span><b>{trade.trades} 笔</b></div>
        <div><span>胜率</span><b data-testid="stat-winrate">{pct(trade.winRate)}</b></div>
        <div><span>盈亏比</span><b>{Number.isFinite(trade.profitFactor) ? trade.profitFactor.toFixed(2) : '∞'}</b></div>
        <div><span>平均盈/亏</span><b>{display(trade.avgWin)} / {display(trade.avgLoss)}</b></div>
        <div><span>最佳/最差</span><b>{display(trade.best)} / {display(trade.worst)}</b></div>
        <div><span>多空</span><b>{trade.longTrades}多 {trade.longPnl >= 0 ? '+' : ''}{display(trade.longPnl)} · {trade.shortTrades}空 {trade.shortPnl >= 0 ? '+' : ''}{display(trade.shortPnl)}</b></div>
        <div><span>最大回撤</span><b className="negative" data-testid="stat-drawdown">{display(trade.maxDrawdown)} ({pct(trade.maxDrawdownPct)})</b></div>
        <div><span>平均持仓</span><b>{trade.avgHoldingMinutes.toFixed(1)} 分钟</b></div>
        <div><span>手续费/资金费</span><b>{display(trade.fees)} / {display(trade.funding)}</b></div>
        <div><span>账户权益</span><b>{display(stats.equity)} {unit}</b></div>
        <div><span>指标预警</span><b data-testid="stat-alerts">{stats.alerts} 次</b></div>
      </div>
      {alerts.length > 0 && <ul className="result-alerts" data-testid="result-alerts">{alerts.map((line, index) => <li key={index}>{line}</li>)}</ul>}
      {trade.liquidated && <p className="negative" data-testid="stat-liquidated">本轮出现强制平仓（爆仓）。</p>}
      <p>保留：成交记录、盈亏与复盘小结一并存入本机项目；删除：回滚到复盘开始前的成交与笔记（绘图保留）。</p>
      <footer>
        <button type="button" data-testid="export-result" onClick={onExport}>导出CSV</button>
        <button type="button" data-testid="discard-session" onClick={onDiscard}>删除结果</button>
        <button type="button" className="primary" data-testid="keep-session" onClick={onKeep}>保留结果</button>
      </footer>
    </div>
  </div>;
}
