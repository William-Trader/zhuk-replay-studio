/*!
 * src/components/PythonDialog.tsx - zhuk-replay-studio key core logic
 * (c) 2026 William-Trader (https://github.com/William-Trader)
 * WM: ZRS-B1D3804F
 * SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
 * Removing this mark violates the license.
 */
import { useEffect, useState } from 'react';
import { pythonDelete, pythonList, pythonRead, pythonReveal, pythonRun, pythonSave, type PythonCandles, type PythonFile, type PythonResult } from '../bridge';

export interface PythonInstance { id: string; file: string; params: Record<string, unknown>; visible: boolean }
export interface PythonRunState { ok: boolean; error?: string; result?: PythonResult }

interface Props {
  open: boolean; available: boolean; instances: PythonInstance[]; runs: Record<string, PythonRunState>;
  getCandles: () => PythonCandles;
  onAdd: (file: string, params: Record<string, unknown>) => void;
  onToggle: (id: string, visible: boolean) => void;
  onRemove: (id: string) => void;
  onHint: (text: string) => void;
  onClose: () => void;
}

export function PythonDialog({ open, available, instances, runs, getCandles, onAdd, onToggle, onRemove, onHint, onClose }: Props) {
  const [files, setFiles] = useState<PythonFile[]>([]);
  const [dir, setDir] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [paramsText, setParamsText] = useState('{}');
  const [test, setTest] = useState<string>('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open || !available) return;
    void pythonList().then(list => { setFiles(list.files); setDir(list.dir); }).catch(error => onHint(`无法读取指标目录：${String(error)}`));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, available]);
  if (!open) return null;
  const openFile = async (name: string) => {
    try { const text = await pythonRead(name); setSelected(name); setCode(text); setTest(''); }
    catch (error) { onHint(`读取失败：${String(error)}`); }
  };
  const parseParams = () => { try { const value = JSON.parse(paramsText || '{}'); return value && typeof value === 'object' ? value as Record<string, unknown> : {}; } catch { onHint('参数必须是 JSON 对象。'); return null; } };
  const save = async (name: string) => {
    setBusy(true);
    try { await pythonSave(name, code); const list = await pythonList(); setFiles(list.files); setSelected(name); onHint(`已保存 ${name}。`); }
    catch (error) { onHint(`保存失败：${String(error)}`); }
    finally { setBusy(false); }
  };
  const saveAs = async () => {
    const name = window.prompt('新文件名（字母数字下划线，.py 结尾）', selected ?? 'my_indicator.py');
    if (!name) return;
    await save(name);
  };
  const remove = async () => {
    if (!selected) return;
    if (!window.confirm(`删除 ${selected}？`)) return;
    try { await pythonDelete(selected); const list = await pythonList(); setFiles(list.files); setSelected(null); setCode(''); }
    catch (error) { onHint(`删除失败：${String(error)}`); }
  };
  const runTest = async () => {
    if (!code.trim()) { onHint('先在左侧选择一个文件或粘贴代码。'); return; }
    setBusy(true); setTest('运行中…');
    try {
      const response = await pythonRun({ code, file: selected ?? 'inline.py', params: parseParams() ?? {}, candles: getCandles() });
      if (response.ok) {
        const plots = response.result.plots ?? [];
        setTest(`✓ 成功：pane=${response.result.pane ?? 'main'}，${plots.length} 条序列（${plots.map(plot => `${plot.title}:${plot.data.length}点`).join('，')}）`);
      } else setTest(`✗ ${response.error}${response.traceback ? `\n${response.traceback.slice(0, 800)}` : ''}`);
    } catch (error) { setTest(`✗ ${String(error)}`); }
    finally { setBusy(false); }
  };
  const mount = () => {
    if (!selected) { onHint('先选择指标文件。'); return; }
    const params = parseParams();
    if (params === null) return;
    onAdd(selected, params);
    onHint(`已挂载 ${selected}；将随回放实时重算。`);
  };
  return <div className="dialog-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
    <div className="date-dialog python-dialog" role="dialog" aria-label="Python 指标" data-testid="python-dialog">
      <h3>Python 指标{dir ? <small>{dir}</small> : null}</h3>
      {!available && <p className="python-note">Python 指标运行需要 macOS 桌面版（本机壳内置运行器）。浏览器模式暂不可用。</p>}
      {available && <>
        <div className="python-body">
          <div className="python-files">
            <div className="python-file-actions"><button onClick={() => { setSelected(null); setCode('"""新的指标：定义 compute(candles, params) 返回 plots。"""\n\n\ndef compute(candles, params):\n    closes = candles.get("c", [])\n    period = int(params.get("period", 20))\n    values = []\n    for index, close in enumerate(closes):\n        if index < period - 1:\n            values.append(None)\n        else:\n            window = closes[index - period + 1:index + 1]\n            values.append(sum(window) / period)\n    return {"pane": "main", "plots": [{"title": f"SMA{period}", "type": "line", "data": values, "color": "#2962ff"}]}\n'); }}>新建</button><button onClick={() => void pythonReveal()}>打开文件夹</button></div>
            <ul data-testid="python-files">{files.map(file => <li key={file.name}><button className={selected === file.name ? 'selected' : ''} aria-pressed={selected === file.name} onClick={() => void openFile(file.name)}>{file.name}</button></li>)}</ul>
          </div>
          <div className="python-editor">
            <textarea aria-label="指标代码" data-testid="python-code" spellCheck={false} value={code} onChange={e => setCode(e.target.value)} placeholder="选择或新建一个指标文件…" />
            <label className="python-params">参数（JSON）<input aria-label="指标参数" value={paramsText} onChange={e => setParamsText(e.target.value)} /></label>
            <div className="python-actions">
              <button disabled={busy || !selected} onClick={() => selected && void save(selected)}>保存</button>
              <button disabled={busy} onClick={() => void saveAs()}>另存为</button>
              <button disabled={busy || !selected} onClick={() => void remove()}>删除</button>
              <button disabled={busy || !code.trim()} onClick={() => void runTest()}>运行测试</button>
              <button className="primary" disabled={busy || !selected} onClick={mount}>挂载到图表</button>
            </div>
            {test && <pre className="python-test" data-testid="python-test">{test}</pre>}
          </div>
        </div>
        <div className="indicator-active"><small>已挂载 {instances.length} 项</small>
          {instances.map(instance => { const state = runs[instance.id]; return <span key={instance.id} className="indicator-chip">
            <button aria-pressed={instance.visible} title="显示／隐藏" onClick={() => onToggle(instance.id, !instance.visible)}>{instance.visible ? '●' : '○'}</button>
            <button title="状态" onClick={() => onHint(state?.ok ? `${instance.file} 运行正常。` : `${instance.file}：${state?.error ?? '等待运行'}`)}>{instance.file}</button>
            <button title="移除" onClick={() => onRemove(instance.id)}>✕</button>
          </span>; })}
          {!instances.length && <em>暂无（保存文件后点「挂载到图表」）</em>}
        </div>
      </>}
      <footer><button type="button" onClick={onClose}>关闭</button></footer>
    </div>
  </div>;
}
