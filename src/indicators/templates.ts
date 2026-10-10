/*!
 * src/indicators/templates.ts - zhuk-replay-studio key core logic
 * (c) 2026 William-Trader (https://github.com/William-Trader)
 * WM: ZRS-0E21F487
 * SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
 * Removing this mark violates the license.
 */
/** 指标模板与默认组合：新用户打开就是交易所那种形态（多周期均线 + 成交量），
 *  模板一键铺开常用组合。纯数据，无 DOM / 存储 / 网络。 */
import { INDICATOR_MAP, defaultInputs } from './index';

export interface TemplateItem { defId: string; inputs?: Record<string, number | string> }
export interface IndicatorTemplate { id: string; name: string; hint: string; items: TemplateItem[] }

/** 交易所默认形态：MA(5,10,20,60) 主图 + 成交量副图。 */
export const DEFAULT_TEMPLATE: IndicatorTemplate = {
  id: 'default', name: '交易所默认', hint: 'MA5/10/20/60 + 成交量',
  items: [{ defId: 'maSet', inputs: { periods: '5,10,20,60' } }, { defId: 'volume' }],
};
export const INDICATOR_TEMPLATES: IndicatorTemplate[] = [
  DEFAULT_TEMPLATE,
  { id: 'trend', name: '趋势跟踪', hint: 'EMA7/25/99 + 超级趋势 + MACD + 成交量', items: [
    { defId: 'emaSet', inputs: { periods: '7,25,99' } }, { defId: 'supertrend' }, { defId: 'macd' }, { defId: 'volume' }] },
  { id: 'swing', name: '震荡波段', hint: '布林带 + RSI + KDJ + 成交量', items: [
    { defId: 'bollinger' }, { defId: 'rsi' }, { defId: 'kdj' }, { defId: 'volume' }] },
  { id: 'scalp', name: '短线快打', hint: 'EMA9/21 + VWAP + 随机RSI + 成交量', items: [
    { defId: 'emaSet', inputs: { periods: '9,21' } }, { defId: 'vwap' }, { defId: 'stochrsi' }, { defId: 'volume' }] },
];
export interface IndicatorInstanceSpec { id: string; defId: string; inputs: Record<string, number | string>; visible: boolean }
const instanceId = (defId: string, index: number) => `ind-${defId}-${index}`;
/** 模板 → 指标实例列表（参数取自指标默认值，模板可覆盖）。 */
export function templateInstances(template: IndicatorTemplate, existing: number = 0): IndicatorInstanceSpec[] {
  return template.items
    .filter(item => item.defId in INDICATOR_MAP)
    .map((item, index) => {
      const def = INDICATOR_MAP[item.defId];
      return { id: `${instanceId(item.defId, existing + index)}-${Math.random().toString(36).slice(2, 6)}`, defId: item.defId, inputs: { ...defaultInputs(def), ...(item.inputs ?? {}) }, visible: true };
    });
}
/** 新存档（没有历史指标时）的初始组合。 */
export const defaultIndicatorInstances = (): IndicatorInstanceSpec[] => templateInstances(DEFAULT_TEMPLATE);
export const templateById = (id: string): IndicatorTemplate | undefined => INDICATOR_TEMPLATES.find(template => template.id === id);
