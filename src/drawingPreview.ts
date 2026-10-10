/*!
 * src/drawingPreview.ts - zhuk-replay-studio key core logic
 * (c) 2026 William-Trader (https://github.com/William-Trader)
 * WM: ZRS-29216391
 * SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
 * Removing this mark violates the license.
 */
// Coalesce live drawing previews; preserve immediate pointer-up commits.
// Keep pointer sampling and final commits immediate; never block the UI thread.
export const DRAWING_PREVIEW_INTERVAL_MS = 120;

export function createDrawingPreview<T>(publish: (value: T) => void) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let latest: T;
  let pending = false;
  function cancel() {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined; pending = false;
  }
  return {
    enqueue(value: T) {
      latest = value; pending = true;
      if (timer !== undefined) return;
      timer = setTimeout(() => {
        timer = undefined;
        if (!pending) return;
        pending = false;
        publish(latest);
      }, DRAWING_PREVIEW_INTERVAL_MS);
    },
    commit(value: T) { cancel(); publish(value); },
    cancel,
  };
}
