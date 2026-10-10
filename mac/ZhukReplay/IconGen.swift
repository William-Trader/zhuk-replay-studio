/*!
 * mac/ZhukReplay/IconGen.swift - zhuk-replay-studio key native-shell logic
 * (c) 2026 William-Trader (https://github.com/William-Trader)
 * WM: ZRS-BF5A09EE
 * SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
 * Removing this mark violates the license.
 */
// 交易训练室 · app icon generator.
// Draws a green rounded-square with a white candlestick glyph and writes the
// full .iconset set. Usage: icongen <outdir>
import AppKit

let outDir = URL(fileURLWithPath: CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "./AppIcon.iconset")
try? FileManager.default.createDirectory(at: outDir, withIntermediateDirectories: true)

let variants: [(String, Int)] = [
    ("icon_16x16.png", 16), ("icon_16x16@2x.png", 32),
    ("icon_32x32.png", 32), ("icon_32x32@2x.png", 64),
    ("icon_128x128.png", 128), ("icon_128x128@2x.png", 256),
    ("icon_256x256.png", 256), ("icon_256x256@2x.png", 512),
    ("icon_512x512.png", 512), ("icon_512x512@2x.png", 1024),
]

func renderIcon(px: Int) -> Data? {
    let s = CGFloat(px)
    guard let ctx = CGContext(data: nil, width: px, height: px, bitsPerComponent: 8, bytesPerRow: 0,
                              space: CGColorSpaceCreateDeviceRGB(),
                              bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return nil }
    ctx.setAllowsAntialiasing(true)

    // Background: rounded square with a green gradient.
    let inset = s * 0.06
    let rect = CGRect(x: inset, y: inset, width: s - inset * 2, height: s - inset * 2)
    let radius = s * 0.205
    ctx.saveGState()
    ctx.addPath(CGPath(roundedRect: rect, cornerWidth: radius, cornerHeight: radius, transform: nil))
    ctx.clip()
    let top = CGColor(red: 0.36, green: 0.77, blue: 0.05, alpha: 1)
    let bottom = CGColor(red: 0.21, green: 0.55, blue: 0.02, alpha: 1)
    if let gradient = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(), colors: [top, bottom] as CFArray, locations: [0, 1]) {
        ctx.drawLinearGradient(gradient, start: CGPoint(x: rect.midX, y: rect.maxY), end: CGPoint(x: rect.midX, y: rect.minY), options: [])
    }
    ctx.restoreGState()

    // Candlestick glyph (white).
    ctx.setFillColor(gray: 1, alpha: 1)
    let bodyW = max(s * 0.135, 2)
    let wickW = max(s * 0.032, 1)
    let gap = s * 0.075
    // (x offset, body bottom, body top, wick bottom, wick top) as fractions of s, y measured from the bottom.
    let candles: [(CGFloat, CGFloat, CGFloat, CGFloat, CGFloat)] = [
        (-(bodyW + gap), 0.42, 0.58, 0.34, 0.66),
        (0, 0.30, 0.64, 0.23, 0.73),
        (bodyW + gap, 0.38, 0.52, 0.30, 0.61),
    ]
    for (dx, bBot, bTop, wBot, wTop) in candles {
        let x = s / 2 + dx
        ctx.fill(CGRect(x: x - wickW / 2, y: s * wBot, width: wickW, height: s * (wTop - wBot)))
        let body = CGRect(x: x - bodyW / 2, y: s * bBot, width: bodyW, height: s * (bTop - bBot))
        ctx.addPath(CGPath(roundedRect: body, cornerWidth: bodyW * 0.22, cornerHeight: bodyW * 0.22, transform: nil))
        ctx.fillPath()
    }

    guard let image = ctx.makeImage() else { return nil }
    let rep = NSBitmapImageRep(cgImage: image)
    return rep.representation(using: .png, properties: [:])
}

var written = 0
for (name, px) in variants {
    if let data = renderIcon(px: px) {
        try? data.write(to: outDir.appendingPathComponent(name))
        written += 1
    }
}
print("ICONSET_WRITTEN \(written) -> \(outDir.path)")
