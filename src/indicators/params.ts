/*!
 * src/indicators/params.ts - zhuk-replay-studio key core logic
 * (c) 2026 William-Trader (https://github.com/William-Trader)
 * WM: ZRS-A4F31BE8
 * SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
 * Removing this mark violates the license.
 */
/** Input resolution: missing, mistyped or out-of-range values silently fall back to the declared defaults. */
import type { IndicatorDef, InputSpec } from './types';

type Inputs = Record<string, number | string>;

/** Numeric input with a fallback; strings that parse to a finite number are accepted. */
export function num(inputs: Inputs, key: string, fallback: number, min = -Infinity, max = Infinity): number {
  const raw = inputs[key], value = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(value) && value >= min && value <= max ? value : fallback;
}
/** Integer period input, never below 1. */
export const bars = (inputs: Inputs, key: string, fallback: number, max = 5000): number => Math.max(1, Math.round(num(inputs, key, fallback, 1, max)));
/** 逗号/空格分隔的周期列表（均线组）：去重、夹到 1..500、最多 6 条，非法值回落到默认。 */
export function periods(inputs: Inputs, key: string, fallback: number[]): number[] {
  const raw = inputs[key];
  const list = (typeof raw === 'string' ? raw.split(/[,，\s]+/) : [])
    .map(entry => Math.round(Number(entry)))
    .filter(entry => Number.isFinite(entry) && entry >= 1 && entry <= 500);
  const unique = [...new Set(list)].slice(0, 6);
  return unique.length ? unique : fallback;
}
/** Select input restricted to the declared options. */
export function text(inputs: Inputs, key: string, fallback: string, options: string[]): string {
  const raw = inputs[key];
  return typeof raw === 'string' && options.includes(raw) ? raw : fallback;
}

/** Defaults for every declared input. */
export const defaultsOf = (specs: InputSpec[]): Inputs => Object.fromEntries(specs.map(spec => [spec.key, spec.default]));

/** Merges caller inputs over the defaults, dropping unknown keys and illegal values. */
export function resolveInputs(def: IndicatorDef, inputs?: Inputs): Inputs {
  const resolved = defaultsOf(def.inputs);
  for (const spec of def.inputs) {
    const raw = inputs?.[spec.key];
    if (raw === undefined) continue;
    if (spec.type === 'select') { if (typeof raw === 'string' && (spec.options ?? []).some(option => option.value === raw)) resolved[spec.key] = raw; continue; }
    if (spec.type === 'text') { if (typeof raw === 'string' && raw.trim() && raw.length <= 48) resolved[spec.key] = raw.trim(); continue; }
    const value = typeof raw === 'number' ? raw : Number(raw);
    if (Number.isFinite(value) && value >= (spec.min ?? -Infinity) && value <= (spec.max ?? Infinity)) resolved[spec.key] = value;
  }
  return resolved;
}

/** Numeric indicator input declaration. */
export const numInput = (key: string, label: string, value: number, min: number, max: number): InputSpec => ({ key, label, type: 'number', default: value, min, max });
/** Period-list declaration ("5,10,20,60"), the platform-style multi-line moving average input. */
export const periodsInput = (key: string, label: string, value: string): InputSpec => ({ key, label, type: 'text', default: value, placeholder: '5,10,20,60' });
/** Period declaration: integers from 1 to 500. */
export const periodInput = (key: string, label: string, value: number, max = 500): InputSpec => numInput(key, label, value, 1, max);
