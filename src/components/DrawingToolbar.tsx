/*!
 * src/components/DrawingToolbar.tsx - zhuk-replay-studio key core logic
 * (c) 2026 William-Trader (https://github.com/William-Trader)
 * WM: ZRS-FBEE0A6B
 * SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
 * Removing this mark violates the license.
 */
import { useEffect, useRef, useState } from 'react';
import { DrawingGlyph, glyphFor } from './DrawingGlyph';
import { Icon } from './Icon';
import { TOOL_GROUPS, TOOL_NAMES, type Tool } from '../drawing';

interface Props {
  tool: Tool; keep: boolean; locked: boolean; hidden: boolean; magnet: boolean;
  onTool: (tool: Tool) => void; onKeep: () => void; onLock: () => void; onHide: () => void;
  onMagnet: () => void; onClear: () => void; onZoom: () => void; onHint: (text: string) => void;
}
/** 工具盘分组来自绘图契约（TradingView 的九类，共 60+ 工具）。 */
const groups: { label: string; icon: string; tools: Tool[] }[] = TOOL_GROUPS.map(group => ({ label: group.label, icon: glyphFor(group.icon), tools: group.tools as Tool[] }));
export function DrawingToolbar(p: Props) {
  const [open, setOpen] = useState<number | null>(null);
  const [top, setTop] = useState(80);
  const [remembered, setRemembered] = useState<Record<number, Tool>>({});
  const root = useRef<HTMLElement>(null);
  useEffect(() => {
    const outside = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(null); };
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(null); };
    window.addEventListener('pointerdown', outside); window.addEventListener('keydown', escape);
    return () => { window.removeEventListener('pointerdown', outside); window.removeEventListener('keydown', escape); };
  }, []);
  const choose = (tool: Tool, index?: number) => { p.onTool(tool); if (index !== undefined) setRemembered(v => ({ ...v, [index]: tool })); setOpen(null); };
  const control = (glyph: string, label: string, click: () => void, selected = false) => <button className={`draw-tool ${selected ? 'selected' : ''}`} title={label} aria-label={label} aria-pressed={selected} onClick={click}><DrawingGlyph type={glyph} /></button>;
  return <aside ref={root} className="left-rail" aria-label="绘图工具栏">
    {control('control-cross', '光标', () => choose('cursor'), p.tool === 'cursor')}
    {groups.map((group, index) => {
      const chosen = remembered[index] ?? group.tools[0];
      return <div className="tool-group" key={group.label}>
        <button className={`draw-tool ${group.tools.includes(p.tool) ? 'selected' : ''}`} aria-label={`绘制${TOOL_NAMES[chosen]}`} title={TOOL_NAMES[chosen]} onClick={() => choose(chosen, index)}>
          <DrawingGlyph type={remembered[index] ? glyphFor(remembered[index]) : group.icon} />
        </button>
        <button className="tool-group-expand" title={group.label} aria-label={group.label} aria-expanded={open === index} onClick={event => { setTop(Math.min(event.currentTarget.getBoundingClientRect().top, window.innerHeight - 260)); setOpen(open === index ? null : index); }}><span className="tool-caret" /></button>
      </div>;
    })}
    <div className="rail-divider" />
    {control('control-measure', '区间测量', () => choose('measure'), p.tool === 'measure')}
    {control('control-zoom', '放大图表', p.onZoom)}
    <div className="rail-divider" />
    {control('control-magnet', '磁铁吸附', p.onMagnet, p.magnet)}
    {control('control-keep-drawing', '连续绘制', p.onKeep, p.keep)}
    {control('control-lock', '锁定绘图', p.onLock, p.locked)}
    {control('control-hide', '隐藏绘图', p.onHide, p.hidden)}
    <div className="rail-divider" />
    {control('control-remove', '清空绘图', p.onClear)}
    <div className="rail-bottom"><button title="绘图工具：使用左侧分类菜单" aria-label="工具目录" onClick={() => { setTop(90); setOpen(0); }}><Icon name="search" /></button><button title="Ctrl+Z 撤销，Ctrl+Y 重做" aria-label="操作历史提示" onClick={() => p.onHint('绘图支持最近 30 步撤销和重做：Ctrl+Z / Ctrl+Y。')}><Icon name="history" /></button></div>
    {open !== null && <div className="tool-flyout" role="menu" aria-label={groups[open].label} style={{ top: Math.max(40, top) }}>
      <div className="tool-menu-section">{groups[open].label}</div>
      {groups[open].tools.map(tool => <div key={tool} className={`tool-menu-row ${p.tool === tool ? 'selected' : ''}`}><button role="menuitem" onClick={() => choose(tool, open)}><span className="flyout-tool-icon"><DrawingGlyph type={glyphFor(tool)} /></span><span className="flyout-tool-copy"><b>{TOOL_NAMES[tool]}</b></span></button><span className="menu-star">☆</span></div>)}
    </div>}
  </aside>;
}
