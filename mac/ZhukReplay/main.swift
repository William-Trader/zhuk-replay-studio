/*!
 * mac/ZhukReplay/main.swift - zhuk-replay-studio key native-shell logic
 * (c) 2026 William-Trader (https://github.com/William-Trader)
 * WM: ZRS-994D0931
 * SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
 * Removing this mark violates the license.
 */
// 交易训练室 · macOS app entry point.
import AppKit

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.run()
