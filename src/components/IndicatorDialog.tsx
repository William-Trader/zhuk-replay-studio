/*!
 * src/components/IndicatorDialog.tsx - zhuk-replay-studio key core logic
 * (c) 2026 William-Trader (https://github.com/William-Trader)
 * WM: ZRS-D3DCCC9A
 * SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
 * Removing this mark violates the license.
 */
import { useEffect, useMemo, useState, type InputHTMLAttributes } from 'react';
import { INDICATOR_MAP, INDICATORS, INDICATOR_TEMPLATES, defaultInputs, type IndicatorDef } from '../indicators';

export interface IndicatorInstance { id: string; defId: string; inputs: Record<string, number | string>; visible: boolean; /** 指标预警开关（缺省开）。 */ alerts?: boolean }
interface Props {
  open: boolean; active: IndicatorInstance[];
  /** 从图例齿轮进来时直接进入某个实例的参数编辑。 */
  editId?: string | null; favorites: string[];
  onAdd: (defId: string, inputs: Record<string, number | string>) => void;
  onUpdate: (instance: IndicatorInstance) => void;
  onRemove: (id: string) => void;
  onTemplate: (templateId: string) => void;
  onFavorite: (defId: string) => void;
  onClose: () => void;
}

function ParamsEditor({ def, value, onChange }: { def: IndicatorDef; value: Record<string, number | string>; onChange: (next: Record<string, number | string>) => void }) {
  if (!def.inputs.length) return <p className="indicator-empty">该指标无参数。</p>;
  return <div className="indicator-params">{def.inputs.map(input => {
    const current = value[input.key] ?? input.default;
    return <label key={input.key}>{input.label}
      {input.type === 'select'
        ? <select aria-label={`参数${input.key}`} value={String(current)} onChange={event => onChange({ ...value, [input.key]: event.target.value })}>{(input.options ?? []).map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
        : input.type === 'text'
        ? <input aria-label={`参数${input.key}`} type="text" placeholder={input.placeholder} value={String(current)} onChange={event => onChange({ ...value, [input.key]: event.target.value })} />
        : <NumberField aria-label={`参数${input.key}`} min={input.min} max={input.max} value={current} onChange={next => onChange({ ...value, [input.key]: next })} />}
    </label>;
  })}</div>;
}

/** 参数数字框：编辑期间保留原始文本。
 *  直接把 `Number(input.value)` 写回 draft 的话，空串会变成 0 —— 用户删不干净，
 *  也没法输入「0.」这种中间态，小数参数（如 2.5 倍标准差）根本打不出来。 */
function NumberField({ value, onChange, ...rest }: { value: number | string; onChange: (next: number) => void } & Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'>) {
  const [text, setText] = useState(() => String(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => { if (!focused) setText(String(value)); }, [value, focused]);
  return <input {...rest} type="number" value={text}
    onFocus={event => { setFocused(true); rest.onFocus?.(event); }}
    onBlur={event => {
      setFocused(false);
      const parsed = Number(text);
      // 空串/非法输入：回到最后一个合法值，而不是把 NaN 或 0 悄悄写进参数。
      setText(text.trim() !== '' && Number.isFinite(parsed) ? String(parsed) : String(value));
      rest.onBlur?.(event);
    }}
    onChange={event => {
      const raw = event.target.value;
      setText(raw);
      const parsed = Number(raw);
      if (raw.trim() !== '' && Number.isFinite(parsed)) onChange(parsed);
    }} />;
}

/** 指标库：模板一键铺开、收藏分组、搜索、参数编辑与主/副图挂载（交易所平台形态）。 */
export function IndicatorDialog({ open, active, editId, favorites, onAdd, onUpdate, onRemove, onTemplate, onFavorite, onClose }: Props) {
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, number | string>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  useEffect(() => {
    if (!open || !editId) return;
    const instance = active.find(entry => entry.id === editId);
    if (!instance) return;
    const def = INDICATOR_MAP[instance.defId];
    setSelectedId(instance.defId); setEditingId(instance.id); setDraft({ ...defaultInputs(def), ...instance.inputs });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editId]);
  const shownTemplates = useMemo(() => {
    const text = query.trim().toLowerCase();
    if (!text) return INDICATOR_TEMPLATES;
    return INDICATOR_TEMPLATES.filter(template => template.name.toLowerCase().includes(text) || template.hint.toLowerCase().includes(text));
  }, [query]);
  const selected = selectedId ? INDICATOR_MAP[selectedId] : null;
  const groups = useMemo(() => {
    const text = query.trim().toLowerCase();
    const list = INDICATORS.filter(def => !text || def.name.toLowerCase().includes(text) || def.id.includes(text) || def.category.includes(text));
    const list_withFavorites = [...list].sort((a, b) => Number(favorites.includes(b.id)) - Number(favorites.includes(a.id)));
    const map = new Map<string, IndicatorDef[]>();
    const starred = list_withFavorites.filter(def => favorites.includes(def.id));
    if (starred.length) map.set('收藏', starred);
    for (const def of list_withFavorites) { if (favorites.includes(def.id)) continue; const bucket = map.get(def.category) ?? []; bucket.push(def); map.set(def.category, bucket); }
    return [...map.entries()];
  }, [query, favorites]);
  if (!open) return null;
  const pick = (def: IndicatorDef) => { setSelectedId(def.id); setEditingId(null); setDraft(defaultInputs(def)); };
  const submit = () => {
    if (!selected) return;
    if (editingId) {
      const instance = active.find(entry => entry.id === editingId);
      if (instance) onUpdate({ ...instance, inputs: draft });
      setEditingId(null);
    } else onAdd(selected.id, draft);
    setEditingId(null);
  };
  return <div className="dialog-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
    <div className="date-dialog indicator-dialog" role="dialog" aria-label="指标库" data-testid="indicator-dialog">
      <h3>指标库 · {INDICATORS.length} 项<small>模板一键铺开 · 收藏 · 主副图挂载</small></h3>
      <label>搜索指标<input type="search" aria-label="搜索指标" placeholder="RSI / MACD / 布林 / 均线…" value={query} onChange={e => setQuery(e.target.value)} /></label>
      <div className="indicator-body">
        <div className="indicator-list" data-testid="indicator-list">
          {shownTemplates.length > 0 && <div className="indicator-group templates" data-testid="indicator-templates-group">
            <small>模板（点击套用）</small>
            {shownTemplates.map(template => <button key={template.id} data-testid={`template-${template.id}`} className="template-row" title={template.hint} onClick={() => onTemplate(template.id)}>
              <span>{template.name}</span><em>{template.hint}</em>
            </button>)}
          </div>}
          {groups.map(([category, defs]) => <div key={category} className="indicator-group">
            <small>{category}</small>
            {defs.map(def => <div key={def.id} className={`indicator-row ${selectedId === def.id ? 'selected' : ''}`}>
              <button className="indicator-pick" aria-pressed={selectedId === def.id} onClick={() => pick(def)}><span>{def.name}</span><em>{def.pane === 'main' ? '主图' : '副图'}</em></button>
              <button className={`indicator-star ${favorites.includes(def.id) ? 'on' : ''}`} aria-label={`收藏${def.name}`} aria-pressed={favorites.includes(def.id)} title={favorites.includes(def.id) ? '取消收藏' : '收藏'} onClick={() => onFavorite(def.id)}>★</button>
            </div>)}
          </div>)}
        </div>
        <div className="indicator-detail" data-testid="indicator-detail">
          {selected ? <>
            <strong>{selected.name}<small>{selected.pane === 'main' ? '主图叠加' : '独立副图'} · {selected.category}</small></strong>
            <ParamsEditor def={selected} value={draft} onChange={setDraft} />
            <button className="primary" onClick={submit}>{editingId ? '应用参数' : '添加到图表'}</button>
          </> : <p className="indicator-empty">选择左侧指标，调整参数后添加到图表。</p>}
        </div>
      </div>
      <div className="indicator-active" data-testid="indicator-active">
        <small>已启用 {active.length} 项</small>
        {active.map(instance => { const def = INDICATOR_MAP[instance.defId]; return <span key={instance.id} className="indicator-chip">
          <button aria-pressed={instance.visible} title="显示／隐藏" onClick={() => onUpdate({ ...instance, visible: !instance.visible })}>{instance.visible ? '●' : '○'}</button>
          <button title="编辑参数" onClick={() => { setSelectedId(instance.defId); setEditingId(instance.id); setDraft({ ...defaultInputs(def), ...instance.inputs }); }}>{def.name}</button>
          <button title="移除" onClick={() => onRemove(instance.id)}>✕</button>
        </span>; })}
        {!active.length && <em>暂无（从上方列表添加）</em>}
      </div>
      <footer><button type="button" onClick={onClose}>关闭</button></footer>
    </div>
  </div>;
}
