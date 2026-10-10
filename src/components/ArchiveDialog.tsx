/*!
 * src/components/ArchiveDialog.tsx - zhuk-replay-studio key core logic
 * (c) 2026 William-Trader (https://github.com/William-Trader)
 * WM: ZRS-D881AC23
 * SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
 * Removing this mark violates the license.
 */
import { useState } from 'react';
import { archiveCurve, archiveGroups, archiveStamp, entryWinRate, marketBreakdown, profitFactorOf, profitFactorText, unitDigits, type ArchiveEntry } from '../archive';
import { curvePath } from '../stats';

interface Props {
  entries: readonly ArchiveEntry[];
  /** 当前账户的结算单位：档案里有就默认看它。 */
  currentUnit: string;
  onDelete: (id: string) => void;
  onClear: () => void;
  onExport: () => void;
  onClose: () => void;
}

const pct = (value: number) => `${(value * 100).toFixed(1)}%`;
const sessionText = (minutes: number) => minutes >= 60 ? `${Math.floor(minutes / 60)}小时${minutes % 60}分` : `${minutes} 分`;

/** 训练档案：跨场战绩汇总、累计曲线、分品种表现与逐场明细。 */
export function ArchiveDialog({ entries, currentUnit, onDelete, onClear, onExport, onClose }: Props) {
  const groups = archiveGroups(entries);
  const [picked, setPicked] = useState<string | null>(null);
  // 有当前结算单位就默认看它，否则看最近一场的单位。
  const activeUnit = picked && groups.some(group => group.unit === picked) ? picked
    : groups.some(group => group.unit === currentUnit) ? currentUnit
    : groups.length ? groups[groups.length - 1].unit : currentUnit;
  const group = groups.find(entry => entry.unit === activeUnit);
  const totals = group?.totals;
  const scoped = group?.entries ?? [];
  const digits = unitDigits(activeUnit);
  const display = (value: number) => Number(value.toFixed(digits)).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const signed = (value: number) => `${value >= 0 ? '+' : ''}${display(value)}`;
  const curve = totals ? curvePath(archiveCurve(scoped), 320, 54, 120) : '';
  const markets = marketBreakdown(scoped);
  // 明细按时间倒序：最近一局在最上面。
  const rows = [...scoped].reverse();

  return <div className="dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="date-dialog archive-dialog" role="dialog" aria-label="训练档案" data-testid="archive-dialog">
      <h3>训练档案<small>{entries.length ? `${entries.length} 场 · ${archiveStamp(totals?.first ?? 0)} 至 ${archiveStamp(totals?.last ?? 0)}` : '还没有保留过复盘结果'}</small></h3>

      {!entries.length && <div className="archive-empty" data-testid="archive-empty">
        <p>每局复盘结束时点「保留结果」，这一场的成交、胜率、回撤与盈亏就会存进档案。</p>
        <small>档案跨场累计，可导出 CSV；删除结果的那一局不会入库。档案随项目文件一起导出/导入。</small>
      </div>}

      {groups.length > 1 && <div className="archive-units" data-testid="archive-units" role="tablist" aria-label="结算单位">
        {groups.map(entry => <button key={entry.unit} role="tab" aria-selected={entry.unit === activeUnit} className={entry.unit === activeUnit ? 'active' : ''} onClick={() => setPicked(entry.unit)}>{entry.unit} · {entry.totals.sessions} 场</button>)}
      </div>}

      {totals && group && <>
        {curve && <div className="result-curve" data-testid="archive-curve">
          <svg viewBox="0 0 320 54" preserveAspectRatio="none"><path d={curve} fill="none" stroke="#2962ff" strokeWidth="1.5" /></svg>
          <span className={totals.realized < 0 ? 'negative' : 'positive'}>{signed(totals.realized)} {group.unit}</span>
        </div>}
        <div className="result-grid" data-testid="archive-totals">
          <div><span>场次</span><b>{totals.sessions} 场</b></div>
          <div><span>累计盈亏</span><b className={totals.realized < 0 ? 'negative' : 'positive'}>{signed(totals.realized)} {group.unit}</b></div>
          <div><span>整体胜率</span><b data-testid="archive-winrate">{pct(totals.winRate)}</b></div>
          <div><span>累计盈亏比</span><b>{profitFactorText(totals.profitFactor)}</b></div>
          <div><span>场均盈亏</span><b>{signed(totals.avgRealized)}</b></div>
          <div><span>场均成交</span><b>{totals.avgTrades.toFixed(1)} 笔</b></div>
          <div><span>最大回撤</span><b className="negative" data-testid="archive-drawdown">{display(totals.maxDrawdown)} ({pct(totals.maxDrawdownPct)})</b></div>
          <div><span>最长连赢/连亏</span><b>{totals.maxWinStreak} / {totals.maxLossStreak} 场</b></div>
          <div><span>最好/最差一场</span><b>{signed(totals.bestSession)} / {signed(totals.worstSession)}</b></div>
          <div><span>累计手续费/资金费</span><b>{display(totals.fees)} / {display(totals.funding)}</b></div>
          <div><span>累计复盘时长</span><b>{sessionText(totals.minutes)}</b></div>
          <div><span>爆仓</span><b className={totals.liquidations ? 'negative' : ''}>{totals.liquidations} 次</b></div>
          {/* 档案里存了每场的起始/结束权益，这里让它们真正派上用场：一眼看出总账走了多远。 */}
          <div><span>权益轨迹</span><b title="第一场起始权益 → 最近一场结束权益">{display(scoped[0].startEquity)} → {display(scoped[scoped.length - 1].equity)}</b></div>
        </div>

        {markets.length > 1 && <div className="archive-markets" data-testid="archive-markets">
          <small>分品种表现（按累计盈亏排序）</small>
          {markets.map(entry => <div key={entry.market} className="archive-market-row">
            <strong>{entry.market}</strong>
            <span>{entry.sessions} 场 · {entry.trades} 笔</span>
            <span>胜率 {pct(entry.winRate)}</span>
            <b className={entry.realized < 0 ? 'negative' : 'positive'}>{signed(entry.realized)}</b>
          </div>)}
        </div>}

        <div className="archive-list" data-testid="archive-list">
          <div className="archive-head"><span>时间</span><span>品种 / 周期</span><span>成交</span><span>胜率</span><span>盈亏</span><span>回撤</span><span>用时</span><span /></div>
          {rows.map(entry => <div key={entry.id} className="archive-row" data-testid="archive-row" data-market={entry.market} title={`本场权益 ${display(entry.startEquity)} → ${display(entry.equity)} ${group.unit}`}>
            <span data-label="时间">{archiveStamp(entry.at)}</span>
            <span data-label="品种">{entry.market}<small> · {entry.interval}</small></span>
            <span data-label="成交">{entry.trades} 笔</span>
            <span data-label="胜率">{pct(entryWinRate(entry))}</span>
            <b data-label="盈亏" className={entry.realized < 0 ? 'negative' : 'positive'}>{signed(entry.realized)}</b>
            <span data-label="回撤">{display(entry.maxDrawdown)}</span>
            <span data-label="用时">{entry.minutes} 分{entry.liquidated ? ' · 爆仓' : ''}</span>
            <button type="button" data-testid="archive-delete" aria-label={`删除 ${archiveStamp(entry.at)} 的这场档案`} onClick={() => onDelete(entry.id)}>删除</button>
          </div>)}
        </div>
      </>}

      <p>档案只记已实现盈亏与成交统计，不含行情原始数据；随项目文件一起导出、导入与清除。</p>
      <footer>
        <button type="button" data-testid="archive-export" disabled={!entries.length} onClick={onExport}>导出CSV</button>
        <button type="button" data-testid="archive-clear" disabled={!entries.length} onClick={onClear}>清空档案</button>
        <button type="button" className="primary" data-testid="archive-close" onClick={onClose}>关闭</button>
      </footer>
    </div>
  </div>;
}
