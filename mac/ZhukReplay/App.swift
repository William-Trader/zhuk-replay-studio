/*!
 * mac/ZhukReplay/App.swift - zhuk-replay-studio key native-shell logic
 * (c) 2026 William-Trader (https://github.com/William-Trader)
 * WM: ZRS-6E06A477
 * SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
 * Removing this mark violates the license.
 */
// 交易训练室 · macOS native shell.
// A single-window WKWebView app around the bundled web build, plus:
//   - embedded loopback static server (HTTPServer.swift)
//   - native bridge: save/load project files, window fullscreen
//   - headless helpers for verification: --serve-only / --snapshot / --eval
import Cocoa
import WebKit
import UniformTypeIdentifiers

struct Options {
    var serveOnly = false
    var snapshotPath: String?
    var evals: [String] = []
    var evalGap: Double = 1.0
    var waitSeconds: Double = 3.0
    var holdSeconds: Double = 0.8
    var width: CGFloat = 1440
    var height: CGFloat = 920
    var ports: [UInt16] = (8808...8830).map { UInt16($0) }
    var webRoot: URL?
    var explicitSize = false
    var devExtras = ProcessInfo.processInfo.environment["ZK_DEV"] != nil

    static func parse(_ args: [String]) -> Options {
        var o = Options()
        var i = 1
        while i < args.count {
            let arg = args[i]
            switch arg {
            case "--serve-only": o.serveOnly = true
            case "--snapshot": i += 1; if i < args.count { o.snapshotPath = args[i] }
            case "--eval": i += 1; if i < args.count { o.evals.append(args[i]) }
            case "--eval-gap": i += 1; if i < args.count, let v = Double(args[i]) { o.evalGap = v }
            case "--wait": i += 1; if i < args.count, let v = Double(args[i]) { o.waitSeconds = v }
            case "--hold": i += 1; if i < args.count, let v = Double(args[i]) { o.holdSeconds = v }
            case "--width": i += 1; if i < args.count, let v = Double(args[i]) { o.width = CGFloat(v); o.explicitSize = true }
            case "--height": i += 1; if i < args.count, let v = Double(args[i]) { o.height = CGFloat(v); o.explicitSize = true }
            case "--port": i += 1; if i < args.count, let v = UInt16(args[i]) { o.ports = [v] }
            case "--web-root": i += 1; if i < args.count { o.webRoot = URL(fileURLWithPath: args[i]) }
            default: break
            }
            i += 1
        }
        return o
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    let options = Options.parse(CommandLine.arguments)
    private var server: HTTPServer?
    private var window: NSWindow?
    private var webView: WKWebView?
    private var finished = false

    // MARK: - Lifecycle

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(options.serveOnly ? .accessory : .regular)
        buildMenu()
        PythonService.shared.resolveBundledPaths()
        let root = resolveWebRoot()
        guard FileManager.default.fileExists(atPath: root.appendingPathComponent("index.html").path) else {
            FileHandle.standardError.write(Data("WEB_ROOT_MISSING \(root.path)\n".utf8))
            exit(2)
        }
        let server = HTTPServer(root: root, preferredPorts: options.ports)
        self.server = server
        server.onReady = { [weak self] port in
            guard let self else { return }
            if self.options.serveOnly {
                print("SERVER_READY \(port)")
                return
            }
            DispatchQueue.main.async { self.startUI(port: port) }
        }
        server.onFailure = { reason in
            FileHandle.standardError.write(Data("SERVER_FAILED \(reason)\n".utf8))
            exit(2)
        }
        server.start(preferredPorts: options.ports)
        if options.snapshotPath != nil || !options.evals.isEmpty {
            DispatchQueue.main.asyncAfter(deadline: .now() + options.waitSeconds + 45) { [weak self] in
                guard let self, !self.finished else { return }
                FileHandle.standardError.write(Data("TIMEOUT\n".utf8))
                exit(3)
            }
        }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { !options.serveOnly }
    func applicationSupportsSecureRestorableState(_ app: NSApplication) -> Bool { true }

    // MARK: - Window / web view

    private func startUI(port: UInt16) {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        if options.devExtras { config.preferences.setValue(true, forKey: "developerExtrasEnabled") }
        let controller = config.userContentController
        controller.add(self, name: "zkExport")
        controller.add(self, name: "zkImport")
        controller.add(self, name: "zkFullscreen")
        controller.addUserScript(WKUserScript(source: AppDelegate.bridgeJS, injectionTime: .atDocumentStart, forMainFrameOnly: false))

        let rect = NSRect(x: 0, y: 0, width: options.width, height: options.height)
        let webView = WKWebView(frame: rect, configuration: config)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        self.webView = webView

        let window = NSWindow(contentRect: rect, styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = "交易训练室"
        window.contentView = webView
        window.center()
        window.setFrameAutosaveName("ZhukReplayMainWindow")
        if options.explicitSize { window.setFrame(rect, display: false) }
        window.isReleasedWhenClosed = false
        self.window = window
        window.makeKeyAndOrderFront(nil)
        if options.snapshotPath == nil && options.evals.isEmpty { NSApp.activate(ignoringOtherApps: true) }
        webView.load(URLRequest(url: URL(string: "http://127.0.0.1:\(port)/")!))
        print("UI_LOADING port=\(port)")
    }

    private func resolveWebRoot() -> URL {
        if let override = options.webRoot { return override.standardizedFileURL }
        if let res = Bundle.main.resourceURL {
            let bundled = res.appendingPathComponent("web")
            if FileManager.default.fileExists(atPath: bundled.appendingPathComponent("index.html").path) { return bundled }
        }
        let exeDir = URL(fileURLWithPath: CommandLine.arguments[0]).deletingLastPathComponent()
        for name in ["web", "dist"] {
            let candidate = exeDir.appendingPathComponent(name)
            if FileManager.default.fileExists(atPath: candidate.appendingPathComponent("index.html").path) { return candidate }
        }
        return URL(fileURLWithPath: FileManager.default.currentDirectoryPath).appendingPathComponent("dist")
    }

    // MARK: - Verification helpers (headless modes)

    private func runEval(at index: Int) {
        guard index < options.evals.count else {
            // When a snapshot is pending it owns the exit; otherwise the eval run ends here.
            if options.snapshotPath == nil { finish(exitCode: 0) }
            return
        }
        webView?.evaluateJavaScript(options.evals[index]) { [weak self] result, error in
            guard let self else { return }
            if let error {
                print("EVAL[\(index)]_ERROR \(error.localizedDescription)")
            } else if let result {
                print("EVAL[\(index)]_RESULT \(result)")
            } else {
                print("EVAL[\(index)]_RESULT null")
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + self.options.evalGap) {
                self.runEval(at: index + 1)
            }
        }
    }

    private func finish(exitCode: Int32) {
        guard !finished else { return }
        finished = true
        DispatchQueue.main.asyncAfter(deadline: .now() + max(0.2, options.holdSeconds)) {
            if exitCode == 0 { NSApp.terminate(nil) } else { exit(exitCode) }
        }
    }

    private func scheduleSnapshot() {
        DispatchQueue.main.asyncAfter(deadline: .now() + max(0.5, options.waitSeconds)) { [weak self] in
            guard let self, let webView = self.webView else { return }
            let config = WKSnapshotConfiguration()
            config.rect = webView.bounds
            webView.takeSnapshot(with: config) { [weak self] image, error in
                guard let self else { return }
                guard let image, let tiff = image.tiffRepresentation,
                      let rep = NSBitmapImageRep(data: tiff),
                      let png = rep.representation(using: .png, properties: [:]) else {
                    print("SNAPSHOT_FAILED \(error.map { String(describing: $0) } ?? "unknown")")
                    self.finish(exitCode: 4)
                    return
                }
                let url = URL(fileURLWithPath: self.options.snapshotPath ?? "snapshot.png")
                try? png.write(to: url)
                print("SNAPSHOT_SAVED \(url.path)")
                self.finish(exitCode: 0)
            }
        }
    }

    // MARK: - Native bridge

    static let bridgeJS = """
    (function () {
      if (window.__zkNative) return;
      window.__zkNative = {
        isNative: true,
        version: '1.0',
        exportFile: function (name, content) {
          try { window.webkit.messageHandlers.zkExport.postMessage({ name: String(name), content: String(content) }); } catch (e) {}
        },
        importFile: function () {
          return new Promise(function (resolve) {
            window.__zkNativeImportResolve = resolve;
            try { window.webkit.messageHandlers.zkImport.postMessage({}); }
            catch (e) { window.__zkNativeImportResolve = null; resolve(null); }
          });
        },
        toggleFullscreen: function () {
          try { window.webkit.messageHandlers.zkFullscreen.postMessage({}); } catch (e) {}
        }
      };
    })();
    """

    private static func jsLiteral(_ value: String) -> String {
        if let data = try? JSONSerialization.data(withJSONObject: value, options: [.fragmentsAllowed]),
           let text = String(data: data, encoding: .utf8) { return text }
        return "null"
    }

    private func evaluateBridgeResolve(_ text: String?) {
        let literal = text.map(AppDelegate.jsLiteral) ?? "null"
        let js = "if (typeof window.__zkNativeImportResolve === 'function') { var f = window.__zkNativeImportResolve; window.__zkNativeImportResolve = null; f(\(literal)); }"
        webView?.evaluateJavaScript(js, completionHandler: nil)
    }

    private func exportFile(name: String, content: String) {
        let panel = NSSavePanel()
        panel.nameFieldStringValue = name
        panel.canCreateDirectories = true
        if #available(macOS 11.0, *) { panel.allowedContentTypes = [UTType.json] }
        panel.begin { [weak self] response in
            guard response == .OK, let url = panel.url else { return }
            do {
                try content.write(to: url, atomically: true, encoding: .utf8)
                self?.webView?.evaluateJavaScript("window.dispatchEvent(new CustomEvent('zk-native-toast', { detail: '项目已导出' }))", completionHandler: nil)
            } catch {
                self?.showAlert(title: "导出失败", message: error.localizedDescription)
            }
        }
    }

    private func importFile() {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = false
        panel.canChooseDirectories = false
        if #available(macOS 11.0, *) { panel.allowedContentTypes = [UTType.json] }
        panel.begin { [weak self] response in
            guard response == .OK, let url = panel.url, let text = try? String(contentsOf: url, encoding: .utf8) else {
                self?.evaluateBridgeResolve(nil)
                return
            }
            self?.evaluateBridgeResolve(text)
        }
    }

    private func showAlert(title: String, message: String) {
        let alert = NSAlert()
        alert.messageText = title
        alert.informativeText = message
        alert.alertStyle = .warning
        alert.runModal()
    }

    // MARK: - Menu

    private func buildMenu() {
        let main = NSMenu()

        let appItem = NSMenuItem()
        main.addItem(appItem)
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "关于交易训练室", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "隐藏交易训练室", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "退出交易训练室", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu

        let editItem = NSMenuItem()
        main.addItem(editItem)
        let editMenu = NSMenu(title: "编辑")
        editMenu.addItem(withTitle: "撤销", action: Selector(("undo:")), keyEquivalent: "z")
        editMenu.addItem(withTitle: "重做", action: Selector(("redo:")), keyEquivalent: "Z")
        editMenu.addItem(.separator())
        editMenu.addItem(withTitle: "剪切", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        editMenu.addItem(withTitle: "拷贝", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        editMenu.addItem(withTitle: "粘贴", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        editMenu.addItem(withTitle: "全选", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editItem.submenu = editMenu

        let viewItem = NSMenuItem()
        main.addItem(viewItem)
        let viewMenu = NSMenu(title: "显示")
        viewMenu.addItem(withTitle: "重新载入", action: #selector(reloadPage), keyEquivalent: "r")
        viewMenu.addItem(.separator())
        viewMenu.addItem(withTitle: "实际大小", action: #selector(zoomReset), keyEquivalent: "0")
        viewMenu.addItem(withTitle: "放大", action: #selector(zoomIn), keyEquivalent: "+")
        viewMenu.addItem(withTitle: "缩小", action: #selector(zoomOut), keyEquivalent: "-")
        viewMenu.addItem(.separator())
        viewMenu.addItem(withTitle: "进入全屏", action: #selector(NSWindow.toggleFullScreen(_:)), keyEquivalent: "f")
        viewItem.submenu = viewMenu

        let windowItem = NSMenuItem()
        main.addItem(windowItem)
        let windowMenu = NSMenu(title: "窗口")
        windowMenu.addItem(withTitle: "最小化", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        windowMenu.addItem(withTitle: "缩放", action: #selector(NSWindow.performZoom(_:)), keyEquivalent: "")
        windowItem.submenu = windowMenu
        NSApp.windowsMenu = windowMenu

        NSApp.mainMenu = main
    }

    @objc private func reloadPage() { webView?.reload() }
    @objc private func zoomReset() { webView?.pageZoom = 1 }
    @objc private func zoomIn() { if let z = webView?.pageZoom { webView?.pageZoom = min(2.0, z + 0.1) } }
    @objc private func zoomOut() { if let z = webView?.pageZoom { webView?.pageZoom = max(0.5, z - 0.1) } }
}

// MARK: - Navigation & UI delegates

extension AppDelegate: WKNavigationDelegate {
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        print("NAV_FINISHED \(webView.url?.absoluteString ?? "")")
        if !options.evals.isEmpty {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { [weak self] in self?.runEval(at: 0) }
        }
        if options.snapshotPath != nil { scheduleSnapshot() }
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if navigationAction.navigationType == .linkActivated,
           let url = navigationAction.request.url,
           let host = url.host,
           host != "127.0.0.1" {
            NSWorkspace.shared.open(url)
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.allow)
    }
}

extension AppDelegate: WKUIDelegate {
    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.canChooseDirectories = parameters.allowsDirectories
        panel.begin { response in
            completionHandler(response == .OK ? panel.urls : nil)
        }
    }
}

// MARK: - Script messages

extension AppDelegate: WKScriptMessageHandler {
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        switch message.name {
        case "zkExport":
            guard let payload = message.body as? [String: Any],
                  let name = payload["name"] as? String,
                  let content = payload["content"] as? String else { return }
            exportFile(name: name, content: content)
        case "zkImport":
            importFile()
        case "zkFullscreen":
            window?.toggleFullScreen(nil)
        default:
            break
        }
    }
}
