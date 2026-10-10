/*!
 * src/hotkeys.ts - zhuk-replay-studio key core logic
 * (c) 2026 William-Trader (https://github.com/William-Trader)
 * WM: ZRS-B263F679
 * SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
 * Removing this mark violates the license.
 */
/** 全局快捷键 → 动作的纯映射。
 *
 *  单独成模块的原因：window 上的 keydown 监听器只注册一次，但动作必须读到**最新**状态。
 *  之前 handler 整个关在 useEffect([selected, locked]) 里，闭包锁死在旧渲染上 ——
 *  改完数量再按 B，成交用的还是挂载时的数量。现在监听器只做转发，映射交给这里（可单测）。 */

export interface HotkeyEvent {
  key: string;
  ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean;
  /** 输入法组合中：不抢键。 */
  isComposing?: boolean;
}

export interface HotkeyContext {
  /** 焦点在输入框/文本域/下拉/可编辑元素里：一律不抢键。 */
  editable?: boolean;
  selected?: boolean; locked?: boolean;
  /** 交易面板当前停靠位置。 */
  panel?: DockWhere;
  /** 上次的停靠位置（隐藏后按 \ 恢复到它）。 */
  lastPanel?: Exclude<DockWhere, 'hidden'>;
  choosing?: boolean; replay?: boolean;
}

export type DockWhere = 'bottom' | 'right' | 'float' | 'hidden';

export type HotkeyAction =
  | { kind: 'escape' }
  | { kind: 'delete-selected' }
  | { kind: 'undo' }
  | { kind: 'redo' }
  | { kind: 'toggle-panel' }
  | { kind: 'cycle-panel' }
  | { kind: 'open-long' }
  | { kind: 'open-short' }
  | { kind: 'close-position' }
  | { kind: 'reverse' }
  | { kind: 'toggle-play' }
  | { kind: 'step'; direction: 1 | -1 };

/** `\`：隐藏 / 恢复上次停靠位置（不会把面板从底部莫名切到抽屉）。 */
export const togglePanel = (panel: DockWhere = 'right', lastPanel: Exclude<DockWhere, 'hidden'> = 'right'): DockWhere =>
  panel === 'hidden' ? lastPanel : 'hidden';

/** `Ctrl/Cmd + \`：右侧抽屉 → 底部 → 浮动 → 隐藏 → 右侧抽屉。 */
export const cyclePanel = (panel: DockWhere = 'right'): DockWhere =>
  panel === 'right' ? 'bottom' : panel === 'bottom' ? 'float' : panel === 'float' ? 'hidden' : 'right';

/** 键位映射。返回 null 表示这个键不归全局管（让浏览器/输入框照常处理）。 */
export function hotkeyAction(event: HotkeyEvent, context: HotkeyContext = {}): HotkeyAction | null {
  if (context.editable || event.isComposing) return null;
  if (event.key === 'Escape') return { kind: 'escape' };
  if ((event.key === 'Delete' || event.key === 'Backspace') && context.selected && !context.locked) return { kind: 'delete-selected' };
  const key = event.key.toLowerCase();
  if (event.ctrlKey || event.metaKey || event.altKey) {
    if (key === 'z') return { kind: event.shiftKey ? 'redo' : 'undo' };
    if (key === 'y') return { kind: 'redo' };
    if (event.key === '\\') return { kind: 'cycle-panel' };
    return null;
  }
  if (event.key === '\\') return { kind: 'toggle-panel' };
  if (key === 'b') return { kind: 'open-long' };
  if (key === 's') return { kind: 'open-short' };
  if (key === 'c') return { kind: 'close-position' };
  if (key === 'r') return { kind: 'reverse' };
  // 回放不可用时不要把空格吞掉（否则页面没法用空格滚动）。
  if (event.key === ' ') return context.choosing || !context.replay ? null : { kind: 'toggle-play' };
  if (event.key === 'ArrowLeft') return { kind: 'step', direction: -1 };
  if (event.key === 'ArrowRight') return { kind: 'step', direction: 1 };
  return null;
}

/** 快捷键说明表（设置/帮助面板与文档共用一份文案）。 */
export const HOTKEY_HELP: { keys: string; label: string }[] = [
  { keys: 'B / S', label: '市价开多 / 开空' },
  { keys: 'C / R', label: '全部平仓 / 反手' },
  { keys: '空格', label: '播放 / 暂停回放' },
  { keys: '← / →', label: '上一根 / 下一根（按步长）' },
  { keys: '\\', label: '隐藏 / 恢复交易面板' },
  { keys: 'Ctrl/Cmd + \\', label: '循环停靠：抽屉 → 底部 → 隐藏' },
  { keys: 'Ctrl/Cmd + Z / Y', label: '撤销 / 重做绘图' },
  { keys: 'Delete', label: '删除选中绘图' },
  { keys: 'Esc', label: '取消当前工具 / 关闭弹窗' },
];
