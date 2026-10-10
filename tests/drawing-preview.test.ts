import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDrawingPreview, DRAWING_PREVIEW_INTERVAL_MS } from '../src/drawingPreview';

describe('drawing preview scheduling', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  it('limits live preview to a 120ms interval', () => { expect(DRAWING_PREVIEW_INTERVAL_MS).toBe(120); });
  it('waits for the interval, then publishes the preview', () => {
    const publish = vi.fn(), preview = createDrawingPreview(publish);
    preview.enqueue('point'); vi.advanceTimersByTime(119); expect(publish).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1); expect(publish).toHaveBeenCalledExactlyOnceWith('point');
  });
  it('coalesces moves to the newest value without postponing forever', () => {
    const publish = vi.fn(), preview = createDrawingPreview(publish);
    preview.enqueue(1); vi.advanceTimersByTime(40); preview.enqueue(2); vi.advanceTimersByTime(40); preview.enqueue(3);
    vi.advanceTimersByTime(40); expect(publish).toHaveBeenCalledExactlyOnceWith(3);
  });
  it('updates about 8 times during a continuous one-second move stream', () => {
    const publish = vi.fn(), preview = createDrawingPreview(publish);
    for (let i = 0; i < 100; i++) { preview.enqueue(i); vi.advanceTimersByTime(10); }
    expect(publish).toHaveBeenCalledTimes(8); preview.cancel();
  });
  it('commits final pointer-up coordinates immediately and drops the stale preview', () => {
    const publish = vi.fn(), preview = createDrawingPreview(publish);
    preview.enqueue('old point'); vi.advanceTimersByTime(30); preview.commit('release point');
    expect(publish).toHaveBeenCalledExactlyOnceWith('release point'); vi.runAllTimers(); expect(publish).toHaveBeenCalledTimes(1);
  });
  it('cancels queued work on Escape, tool switch or unmount', () => {
    const publish = vi.fn(), preview = createDrawingPreview(publish);
    preview.enqueue('draft'); preview.cancel(); vi.runAllTimers(); expect(publish).not.toHaveBeenCalled();
  });
  it('clearing a draft prevents it from reappearing later', () => {
    const publish = vi.fn(), preview = createDrawingPreview<string | null>(publish);
    preview.enqueue('draft'); preview.commit(null); vi.runAllTimers(); expect(publish).toHaveBeenCalledExactlyOnceWith(null);
  });
  it('preserves all brush samples while displaying only the latest batch', () => {
    const publish = vi.fn(), preview = createDrawingPreview<number[]>(publish); const points: number[] = [];
    for (let i = 0; i < 12; i++) { points.push(i); preview.enqueue([...points]); vi.advanceTimersByTime(10); }
    expect(publish).toHaveBeenCalledExactlyOnceWith(points);
  });
  it('schedules independently after cancel and immediate commit', () => {
    const publish = vi.fn(), preview = createDrawingPreview(publish);
    preview.enqueue(1); preview.cancel(); preview.commit(2); preview.enqueue(3); vi.advanceTimersByTime(120);
    expect(publish.mock.calls).toEqual([[2], [3]]);
  });
  it('does not slow unrelated replay timers', () => {
    const publish = vi.fn(), replay = vi.fn(), preview = createDrawingPreview(publish);
    preview.enqueue('point'); setTimeout(replay, 20); vi.advanceTimersByTime(20);
    expect(replay).toHaveBeenCalledTimes(1); expect(publish).not.toHaveBeenCalled(); preview.cancel();
  });
});
