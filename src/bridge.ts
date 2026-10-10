/*!
 * src/bridge.ts - zhuk-replay-studio key core logic
 * (c) 2026 William-Trader (https://github.com/William-Trader)
 * WM: ZRS-C90CA84E
 * SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
 * Removing this mark violates the license.
 */
// Thin client for the macOS shell JSON APIs (loopback only).
// Every call degrades gracefully when the page runs in a plain browser, so the web
// build stays fully usable (and testable) outside the desktop shell.
export interface ShellInfo { mode: string; python: boolean }

let infoPromise: Promise<ShellInfo | null> | null = null;

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body = (await response.json().catch(() => null)) as (T & { ok?: boolean; error?: string }) | null;
  if (!response.ok || !body || body.ok === false) throw new Error(body?.error ?? `HTTP ${response.status}`);
  return body;
}

/** Cached health probe: `mac-app` marks the desktop shell, anything else is a plain page. */
export function shellInfo(): Promise<ShellInfo | null> {
  infoPromise ??= fetch('/api/health').then(async response => {
    if (!response.ok) return null;
    const body = (await response.json()) as { mode?: string; python?: boolean };
    return { mode: body.mode ?? 'page', python: body.python === true };
  }).catch(() => null);
  return infoPromise;
}

export async function shellAvailable(): Promise<boolean> {
  return (await shellInfo())?.mode === 'mac-app';
}

// MARK: - Python indicators (shell only)

export interface PythonFile { name: string; size: number; mtime: number }

export async function pythonList(): Promise<{ dir: string; files: PythonFile[] }> {
  return json('/api/python/files');
}

export async function pythonRead(name: string): Promise<string> {
  const body = await json<{ code: string }>(`/api/python/file?name=${encodeURIComponent(name)}`);
  return body.code;
}

export async function pythonSave(name: string, code: string): Promise<void> {
  await json('/api/python/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, code }) });
}

export async function pythonDelete(name: string): Promise<void> {
  await json('/api/python/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
}

export async function pythonReveal(): Promise<void> {
  await json('/api/python/reveal', { method: 'POST' });
}

export interface PythonPlot { title: string; type: 'line' | 'histogram' | 'area' | 'dots'; data: (number | null)[]; color?: string }
export interface PythonLevel { value: number; color?: string; title?: string }
export interface PythonResult { pane?: 'main' | 'sub'; plots: PythonPlot[]; levels?: PythonLevel[] }

export type PythonRunResponse =
  | { ok: true; result: PythonResult; debug?: string }
  | { ok: false; error: string; traceback?: string; stderr?: string; stdout?: string };

export interface PythonCandles { t: number[]; o: number[]; h: number[]; l: number[]; c: number[]; v: number[] }

/** Runs one indicator script; execution errors come back as `ok:false` for inline display. */
export async function pythonRun(payload: { file?: string; code?: string; params?: Record<string, unknown>; candles: PythonCandles }): Promise<PythonRunResponse> {
  const response = await fetch('/api/python/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  return (await response.json()) as PythonRunResponse;
}

// MARK: - Shell config (Binance proxy override)

export interface ShellConfigData { proxyUrl: string }

export async function configGet(): Promise<ShellConfigData> {
  const body = await json<{ config: ShellConfigData }>('/api/config');
  return body.config;
}

export async function configSave(proxyUrl: string): Promise<void> {
  await json('/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ proxyUrl }) });
}

// MARK: - 深历史本地缓存（shell only：抓一次，之后秒开）

export interface CachedDataset { symbol: string; interval: string; count: number; from: number; to: number; bytes: number; savedAt: number }

/** 读取本地缓存的K线行（无缓存返回空数组）。 */
export async function historyLoad(symbol: string, interval: string, market = 'spot'): Promise<number[][]> {
  const body = await json<{ candles: number[][] }>(`/api/history?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&market=${encodeURIComponent(market)}`);
  return Array.isArray(body.candles) ? body.candles : [];
}

/** 写入本地缓存（整段覆盖，调用方负责合并）。 */
export async function historySave(symbol: string, interval: string, candles: number[][], market = 'spot'): Promise<number> {
  const body = await json<{ count: number }>('/api/history', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ symbol, interval, market, candles }),
  });
  return body.count ?? 0;
}

export async function historyList(): Promise<{ items: CachedDataset[]; bytes: number }> {
  const body = await json<{ items: CachedDataset[]; bytes: number }>('/api/history/list');
  return { items: body.items ?? [], bytes: body.bytes ?? 0 };
}

export async function historyDelete(symbol: string, interval: string): Promise<boolean> {
  const body = await json<{ removed: boolean }>('/api/history/delete', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ symbol, interval }),
  });
  return body.removed === true;
}

export async function historyClear(): Promise<number> {
  const body = await json<{ removed: number }>('/api/history/clear', { method: 'POST' });
  return body.removed ?? 0;
}
