/*!
 * src/components/Icon.tsx - zhuk-replay-studio key core logic
 * (c) 2026 William-Trader (https://github.com/William-Trader)
 * WM: ZRS-AAD3405D
 * SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
 * Removing this mark violates the license.
 */
import type { SVGProps } from "react";

export type IconName =
  | "swap"
  | "plus"
  | "arrow"
  | "brush"
  | "calendar"
  | "channel"
  | "chevron"
  | "close"
  | "copy"
  | "paste"
  | "template"
  | "cloud"
  | "crosshair"
  | "cursor"
  | "eye"
  | "moon"
  | "sun"
  | "fib"
  | "fullscreen"
  | "gann"
  | "hide"
  | "history"
  | "indicators"
  | "layers"
  | "line"
  | "lock"
  | "magnet"
  | "more"
  | "panel"
  | "pause"
  | "play"
  | "position"
  | "random"
  | "redo"
  | "ruler"
  | "save"
  | "search"
  | "settings"
  | "shape"
  | "smile"
  | "stepBack"
  | "stepForward"
  | "star"
  | "target"
  | "text"
  | "trophy"
  | "trash"
  | "trend"
  | "undo"
  | "unlock"
  | "watchlist"
  | "zoomIn";

export function Icon({ name, ...props }: { name: IconName } & SVGProps<SVGSVGElement>) {
  const common = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.7,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    ...props,
  };

  switch (name) {
    case "target":
      return <svg {...common}><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.4"/><path d="M12 2v2.6M12 19.4V22M2 12h2.6M19.4 12H22"/></svg>;
    case "swap":
      return <svg {...common}><path d="M4 8h16l-4-4M20 16H4l4 4" /></svg>;
    case "layers":
      return <svg {...common}><path d="m3 8 9-5 9 5-9 5Z"/><path d="m3 12 9 5 9-5M3 16l9 5 9-5"/></svg>;
    case "template":
      return <svg {...common}><rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/></svg>;
    case "paste":
      return <svg {...common}><path d="M8 5H5v16h14V5h-3"/><rect x="8" y="3" width="8" height="4" rx="1"/><path d="M8 11h8M8 15h8"/></svg>;
    case "more":
      return <svg {...common}><circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/></svg>;
    case "watchlist":
      return <svg {...common}><path d="M5 3h14v18l-7-3-7 3Z"/><path d="M8 7h8M8 11h8M8 15h6"/></svg>;
    case "cursor":
      return <svg {...common}><path d="m5 3 13 8-6 2-3 6Z"/><path d="m12 13 4 5"/></svg>;
    case "crosshair":
      return <svg {...common}><path d="M12 2v5m0 10v5M2 12h5m10 0h5"/><circle cx="12" cy="12" r="3.5"/></svg>;
    case "trend":
      return <svg {...common}><path d="m4 17 16-13"/><circle cx="4" cy="17" r="2"/><circle cx="20" cy="4" r="2"/></svg>;
    case "line":
      return <svg {...common}><path d="M3 7h18M3 12h12M3 17h18"/><circle cx="17" cy="12" r="2"/></svg>;
    case "channel":
      return <svg {...common}><path d="m4 17 12-12M8 21 20 9"/><path d="M4 13v4h4M16 5h-4M20 9v4"/></svg>;
    case "fib":
      return <svg {...common}><path d="M4 4v16M20 4v16M4 7h16M4 11h16M4 15h16M4 19h16"/><path d="m6 18 12-12"/></svg>;
    case "gann":
      return <svg {...common}><rect x="4" y="4" width="16" height="16" rx="1"/><path d="m4 20 16-16M4 12h16M12 4v16"/></svg>;
    case "position":
      return <svg {...common}><path d="M4 12h16M7 12V6h10v6M7 12v6h10v-6"/><path d="m10 8 2-2 2 2m-4 8 2 2 2-2"/></svg>;
    case "shape":
      return <svg {...common}><rect x="3.5" y="4" width="8" height="7" rx="1"/><circle cx="16.5" cy="15.5" r="4"/><path d="m4 20 5-6 4 6Z"/></svg>;
    case "brush":
      return <svg {...common}><path d="M4 18c3 1 5 0 6-2 1-2 0-4 2-6l5-5c1-1 3 1 2 2l-5 5c-2 2-4 1-6 2-2 1-1 3-4 4Z"/><path d="M4 20h16"/></svg>;
    case "text":
      return <svg {...common}><path d="M5 5h14M12 5v14M8 19h8"/></svg>;
    case "trophy":
      return <svg {...common}><path d="M8 4h8v5a4 4 0 0 1-8 0Z"/><path d="M8 5H5v2a3 3 0 0 0 3 3M16 5h3v2a3 3 0 0 1-3 3"/><path d="M12 13v4M9 20h6M10 17h4"/></svg>;
    case "smile":
      return <svg {...common}><circle cx="12" cy="12" r="9"/><path d="M8.5 14.5c1.8 2 5.2 2 7 0M9 9h.01M15 9h.01"/></svg>;
    case "ruler":
      return <svg {...common}><path d="m4 17 13-13 3 3L7 20Z"/><path d="m9 15-2-2m5-1-2-2m5-1-2-2"/></svg>;
    case "zoomIn":
      return <svg {...common}><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5M10.5 7.5v6m-3-3h6"/></svg>;
    case "magnet":
      return <svg {...common}><path d="M6 4v9a6 6 0 0 0 12 0V4h-4v9a2 2 0 0 1-4 0V4Z"/><path d="M6 8h4m4 0h4"/></svg>;
    case "lock":
      return <svg {...common}><rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v2"/></svg>;
    case "unlock":
      return <svg {...common}><rect x="5" y="10" width="14" height="10" rx="2"/><path d="M9 10V7a4 4 0 0 1 7-2.6M12 14v2"/></svg>;
    case "moon":
      return <svg {...common}><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z"/></svg>;
    case "sun":
      return <svg {...common}><circle cx="12" cy="12" r="4.2"/><path d="M12 2v2.4M12 19.6V22M2 12h2.4M19.6 12H22M4.9 4.9l1.7 1.7M17.4 17.4l1.7 1.7M19.1 4.9l-1.7 1.7M6.6 17.4l-1.7 1.7"/></svg>;
    case "eye":
      return <svg {...common}><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z"/><circle cx="12" cy="12" r="2.5"/></svg>;
    case "hide":
      return <svg {...common}><path d="m3 3 18 18M10.6 6.2A10.7 10.7 0 0 1 12 6c6.5 0 10 6 10 6a17 17 0 0 1-3 3.7M6.2 6.2C3.5 8 2 12 2 12s3.5 6 10 6c1 0 2-.2 2.8-.4M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>;
    case "trash":
      return <svg {...common}><path d="M4 7h16M9 3h6l1 4H8ZM7 7l1 14h8l1-14M10 11v6m4-6v6"/></svg>;
    case "undo":
      return <svg {...common}><path d="m9 7-5 5 5 5"/><path d="M5 12h8a6 6 0 0 1 6 6"/></svg>;
    case "redo":
      return <svg {...common}><path d="m15 7 5 5-5 5"/><path d="M19 12h-8a6 6 0 0 0-6 6"/></svg>;
    case "play":
      return <svg {...common}><path d="m8 5 11 7-11 7Z" fill="currentColor" stroke="none"/></svg>;
    case "pause":
      return <svg {...common}><path d="M8 5v14M16 5v14" strokeWidth="2.4"/></svg>;
    case "stepBack":
      return <svg {...common}><path d="M7 5v14M18 6l-8 6 8 6Z"/></svg>;
    case "stepForward":
      return <svg {...common}><path d="M17 5v14M6 6l8 6-8 6Z"/></svg>;
    case "save":
      return <svg {...common}><path d="M5 3h12l2 2v16H5Z"/><path d="M8 3v6h8V3M8 21v-7h8v7"/></svg>;
    case "settings":
      return <svg {...common}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6 1.7 1.7 0 0 0 10 3v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/></svg>;
    case "indicators":
      return <svg {...common}><path d="M4 19V9m5 10V5m5 14v-7m5 7V3"/><path d="M2 19h20"/></svg>;
    case "panel":
      return <svg {...common}><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/></svg>;
    case "fullscreen":
      return <svg {...common}><path d="M8 3H3v5m13-5h5v5M8 21H3v-5m13 5h5v-5"/></svg>;
    case "cloud":
      return <svg {...common}><path d="M6 18a4 4 0 0 1-.5-8A6.5 6.5 0 0 1 18 9a4.5 4.5 0 0 1 0 9Z"/><path d="m9 14 2 2 4-5"/></svg>;
    case "random":
      return <svg {...common}><path d="M4 7h3c4 0 5 10 10 10h3M17 4l3 3-3 3M4 17h3c1.5 0 2.5-1.3 3.5-3M17 14l3 3-3 3"/></svg>;
    case "calendar":
      return <svg {...common}><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 10h18"/></svg>;
    case "plus":
      return <svg {...common}><path d="M12 4v16M4 12h16"/></svg>;
    case "close":
      return <svg {...common}><path d="m6 6 12 12M18 6 6 18"/></svg>;
    case "copy":
      return <svg {...common}><rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></svg>;
    case "history":
      return <svg {...common}><path d="M4 8V3m0 0h5M4 3l3.3 3.3A8 8 0 1 1 4.2 15"/><path d="M12 7v5l3 2"/></svg>;
    case "search":
      return <svg {...common}><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/></svg>;
    case "star":
      return <svg {...common}><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z"/></svg>;
    case "chevron":
      return <svg {...common}><path d="m9 6 6 6-6 6"/></svg>;
    case "arrow":
      return <svg {...common}><path d="M4 20 20 4M13 4h7v7"/></svg>;
    default:
      return <svg {...common}><circle cx="12" cy="12" r="8"/></svg>;
  }
}
