/*!
 * src/components/ReplayIcon.tsx - zhuk-replay-studio key core logic
 * (c) 2026 William-Trader (https://github.com/William-Trader)
 * WM: ZRS-7916C479
 * SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
 * Removing this mark violates the license.
 */
/** Thin 28px replay controls. */
export function ReplayIcon({ name }: { name: "random" | "bar" | "date" | "play" | "pause" | "forward" | "return" }) {
  return <svg viewBox="0 0 28 28" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1" strokeLinejoin="round" aria-hidden="true" data-replay-icon={name}>
    {name === "random" && <><path d="M14 4H6a3 3 0 0 0-3 3v15a3 3 0 0 0 3 3h15a3 3 0 0 0 3-3v-9" /><path d="m21 2 1.5 4.5L27 8l-4.5 1.5L21 14l-1.5-4.5L15 8l4.5-1.5Z" /><circle cx="8.5" cy="9.5" r="2" /><circle cx="13.5" cy="14.5" r="2" /><circle cx="18.5" cy="19.5" r="2" /></>}
    {name === "bar" && <><rect x="7.5" y="5.5" width="3" height="17" rx=".5" /><path d="M24 14H13l4-4m-4 4 4 4" /></>}
    {name === "date" && <><rect x="3.5" y="5.5" width="20" height="18" rx="2.5" /><path d="M8.5 3v5m10-5v5M4 10.5h19m-3 6H9l4-4m-4 4 4 4" /></>}
    {name === "play" && <path d="m10 6 9 8-9 8Z" />}
    {name === "pause" && <><path d="M10 6v16M18 6v16" /></>}
    {name === "forward" && <><path d="m8 6 9 8-9 8ZM20 6v16" /></>}
    {name === "return" && <><path d="M6 6v16m3-16 9 8-9 8ZM21 6v16" /></>}
  </svg>;
}
