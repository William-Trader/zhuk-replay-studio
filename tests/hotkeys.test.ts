import { describe, expect, it } from 'vitest';
import { cyclePanel, HOTKEY_HELP, hotkeyAction, togglePanel, type HotkeyContext, type HotkeyEvent } from '../src/hotkeys';

const press = (key: string, over: Partial<HotkeyEvent> = {}): HotkeyEvent => ({ key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...over });
const context = (over: HotkeyContext = {}): HotkeyContext => ({ editable: false, selected: false, locked: false, panel: 'right', lastPanel: 'right', choosing: false, replay: true, ...over });

describe('hotkey mapping', () => {
  it('maps the trading keys', () => {
    expect(hotkeyAction(press('b'), context())).toEqual({ kind: 'open-long' });
    expect(hotkeyAction(press('S'), context())).toEqual({ kind: 'open-short' });
    expect(hotkeyAction(press('c'), context())).toEqual({ kind: 'close-position' });
    expect(hotkeyAction(press('r'), context())).toEqual({ kind: 'reverse' });
  });
  it('maps replay controls, and only when replay is actually usable', () => {
    expect(hotkeyAction(press(' '), context())).toEqual({ kind: 'toggle-play' });
    expect(hotkeyAction(press('ArrowLeft'), context())).toEqual({ kind: 'step', direction: -1 });
    expect(hotkeyAction(press('ArrowRight'), context())).toEqual({ kind: 'step', direction: 1 });
    // 选择起点中 / 没开回放时不要把空格吞掉（否则页面没法用空格滚动）
    expect(hotkeyAction(press(' '), context({ choosing: true }))).toBeNull();
    expect(hotkeyAction(press(' '), context({ replay: false }))).toBeNull();
  });
  it('maps undo/redo and the panel keys', () => {
    expect(hotkeyAction(press('z', { ctrlKey: true }), context())).toEqual({ kind: 'undo' });
    expect(hotkeyAction(press('z', { metaKey: true, shiftKey: true }), context())).toEqual({ kind: 'redo' });
    expect(hotkeyAction(press('y', { ctrlKey: true }), context())).toEqual({ kind: 'redo' });
    expect(hotkeyAction(press('\\', { ctrlKey: true }), context())).toEqual({ kind: 'cycle-panel' });
    expect(hotkeyAction(press('\\'), context())).toEqual({ kind: 'toggle-panel' });
  });
  it('never steals keys while typing or composing', () => {
    for (const event of [press('b'), press(' '), press('\\'), press('c', { ctrlKey: true }), press('Escape')]) {
      expect(hotkeyAction(event, context({ editable: true }))).toBeNull();
      expect(hotkeyAction({ ...event, isComposing: true }, context())).toBeNull();
    }
  });
  it('leaves unrelated and modifier-alias keys alone', () => {
    expect(hotkeyAction(press('k'), context())).toBeNull();
    expect(hotkeyAction(press('1'), context())).toBeNull();
    // Ctrl+B / Cmd+S 是浏览器与系统快捷键，不能当成下单
    expect(hotkeyAction(press('b', { ctrlKey: true }), context())).toBeNull();
    expect(hotkeyAction(press('s', { metaKey: true }), context())).toBeNull();
    expect(hotkeyAction(press('b', { altKey: true }), context())).toBeNull();
  });
  it('only deletes a drawing that is selected and unlocked', () => {
    expect(hotkeyAction(press('Delete'), context({ selected: true }))).toEqual({ kind: 'delete-selected' });
    expect(hotkeyAction(press('Backspace'), context({ selected: true }))).toEqual({ kind: 'delete-selected' });
    expect(hotkeyAction(press('Delete'), context({ selected: false }))).toBeNull();
    expect(hotkeyAction(press('Delete'), context({ selected: true, locked: true }))).toBeNull();
  });
  it('escapes from every mode', () => {
    expect(hotkeyAction(press('Escape'), context())).toEqual({ kind: 'escape' });
  });
});

describe('panel docking', () => {
  it('toggles between the last dock and hidden', () => {
    expect(togglePanel('right', 'bottom')).toBe('hidden');
    expect(togglePanel('bottom', 'right')).toBe('hidden');
    // 隐藏后恢复"上次停靠"，不会把底部莫名切成抽屉
    expect(togglePanel('hidden', 'bottom')).toBe('bottom');
    expect(togglePanel('hidden', 'right')).toBe('right');
  });
  it('cycles drawer → bottom → float → hidden', () => {
    expect(cyclePanel('right')).toBe('bottom');
    expect(cyclePanel('bottom')).toBe('float');
    expect(cyclePanel('float')).toBe('hidden');
    expect(cyclePanel('hidden')).toBe('right');
  });
});

describe('shortcut help table', () => {
  it('documents every action the mapper can return', () => {
    const documented = HOTKEY_HELP.map(entry => entry.keys).join(' ');
    for (const token of ['B / S', 'C / R', '空格', '←', '\\', 'Ctrl/Cmd + \\', 'Z / Y', 'Delete', 'Esc']) expect(documented).toContain(token);
    expect(HOTKEY_HELP.every(entry => entry.label.length > 0)).toBe(true);
  });
});
