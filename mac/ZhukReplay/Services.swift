/*!
 * mac/ZhukReplay/Services.swift - zhuk-replay-studio key native-shell logic
 * (c) 2026 William-Trader (https://github.com/William-Trader)
 * WM: ZRS-ECB1E65C
 * SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
 * Removing this mark violates the license.
 */
// 交易训练室 · desktop shell services.
// - ShellConfig: user-editable settings persisted next to the indicator folder.
// - ProxyService: safe passthrough to Binance public APIs with automatic route fallback
//   (direct → data-api mirror → local HTTP proxies) plus short-lived route memory.
// - PythonService: runs user indicator scripts with python3 and manages the indicator folder.
import AppKit
import Foundation

enum ServiceError: Error {
    case message(String)
    var text: String { if case .message(let value) = self { return value }; return String(describing: self) }
}

enum ShellPaths {
    static var supportDir: URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? URL(fileURLWithPath: NSHomeDirectory()).appendingPathComponent("Library/Application Support")
        return base.appendingPathComponent("ZhukReplay", isDirectory: true)
    }
    static var indicatorsDir: URL { supportDir.appendingPathComponent("indicators", isDirectory: true) }
    static var configFile: URL { supportDir.appendingPathComponent("config.json") }
}

// MARK: - Shell config

struct ShellConfig: Codable {
    var proxyUrl: String?
    /// 上次成功的取数路线（跨启动记住：本机直连被墙时不必每次先撞墙）。
    var routeProxy: String?
    var routeMirror: Bool?
    var routeUntil: Double?

    static func load() -> ShellConfig {
        guard let data = try? Data(contentsOf: ShellPaths.configFile), let config = try? JSONDecoder().decode(ShellConfig.self, from: data) else {
            return ShellConfig()
        }
        return config
    }

    static func save(_ config: ShellConfig) throws {
        try FileManager.default.createDirectory(at: ShellPaths.supportDir, withIntermediateDirectories: true)
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        try encoder.encode(config).write(to: ShellPaths.configFile, options: .atomic)
    }
}

// MARK: - Binance proxy

final class ProxyService {
    static let shared = ProxyService()

    static let mirrorHost = "data-api.binance.vision"
    private static let binanceApiHosts: Set<String> = ["api.binance.com", "api1.binance.com", "api2.binance.com", "api3.binance.com", "api4.binance.com"]
    private static let allowedHosts: Set<String> = {
        var hosts: Set<String> = ["api.binance.com", "fapi.binance.com", "data-api.binance.vision", "api1.binance.com", "api2.binance.com", "api3.binance.com", "api4.binance.com", "api.frankfurter.app"]
        if let extra = ProcessInfo.processInfo.environment["ZK_ALLOW_HOSTS"] {
            for host in extra.split(separator: ",") { hosts.insert(host.trimmingCharacters(in: .whitespaces)) }
        }
        return hosts
    }()

    struct Reply { let status: Int; let body: Data; let contentType: String }
    private struct Attempt { let url: URL; let proxy: String?; let mirror: Bool }
    private struct Preference { let proxy: String?; let mirror: Bool; let until: Date }

    private let lock = NSLock()
    private var preference: Preference?
    private var cachedConfig: (ShellConfig, Date)?
    private var proxySessions: [String: URLSession] = [:]

    private lazy var direct: URLSession = {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 3.5
        configuration.timeoutIntervalForResource = 12
        return URLSession(configuration: configuration)
    }()

    func fetch(_ urlString: String, completion: @escaping (Result<Reply, ServiceError>) -> Void) {
        guard let url = URL(string: urlString), url.scheme == "https", let host = url.host, ProxyService.allowedHosts.contains(host) else {
            completion(.failure(.message("BLOCKED_URL"))); return
        }
        let attempts = orderedAttempts(for: url)
        run(attempts, index: 0, deadline: Date().addingTimeInterval(15), errors: [], lastReply: nil, completion: completion)
    }

    func invalidateConfig() {
        lock.lock(); cachedConfig = nil; lock.unlock()
    }

    // MARK: - Route planning

    private func config() -> ShellConfig {
        lock.lock(); defer { lock.unlock() }
        if let cached = cachedConfig, Date().timeIntervalSince(cached.1) < 10 { return cached.0 }
        let config = ShellConfig.load()
        cachedConfig = (config, Date())
        return config
    }

    private func proxyCandidates() -> [String] {
        let configured = config().proxyUrl?.trimmingCharacters(in: .whitespaces) ?? ""
        if !configured.isEmpty { return [configured] }
        return ["http://127.0.0.1:7890", "http://127.0.0.1:1087", "http://127.0.0.1:7891"]
    }

    /** Spot market data also lives on the public mirror; futures do not. */
    private func mirrorVariant(of url: URL) -> URL? {
        guard let host = url.host, ProxyService.binanceApiHosts.contains(host), url.path.hasPrefix("/api/v3/") else { return nil }
        var components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        components?.host = ProxyService.mirrorHost
        return components?.url
    }

    private func orderedAttempts(for url: URL) -> [Attempt] {
        let mirror = mirrorVariant(of: url)
        let configured = !(config().proxyUrl?.trimmingCharacters(in: .whitespaces) ?? "").isEmpty
        let direct = Attempt(url: url, proxy: nil, mirror: false)
        let mirrorAttempt = mirror.map { Attempt(url: $0, proxy: nil, mirror: true) }
        let viaProxy = proxyCandidates().map { Attempt(url: url, proxy: $0, mirror: false) }
        let viaProxyMirror: [Attempt] = mirror.map { mirrored in proxyCandidates().map { Attempt(url: mirrored, proxy: $0, mirror: true) } } ?? []
        var list: [Attempt] = []
        if configured {
            // 已配置代理（本机直连被墙时的正解）：镜像最快先用镜像，其余走代理，直连只作最后兜底。
            if let mirrorAttempt { list.append(mirrorAttempt) }
            list.append(contentsOf: viaProxy)
            list.append(contentsOf: viaProxyMirror)
            list.append(direct)
        } else {
            list.append(direct)
            if let mirrorAttempt { list.append(mirrorAttempt) }
            list.append(contentsOf: viaProxy)
            list.append(contentsOf: viaProxyMirror)
        }
        // 注意：storedPreference → config() 会自行加锁，必须在拿锁之前算好，否则同线程重入死锁（曾导致取数线程全挂）。
        let stored = storedPreference(date: Date())
        lock.lock()
        let remembered = preference ?? stored
        if let remembered, remembered.until > Date(), let index = list.firstIndex(where: { $0.proxy == remembered.proxy && $0.mirror == remembered.mirror }) {
            list.insert(list.remove(at: index), at: 0)
        }
        lock.unlock()
        return list
    }

    /// 上一次会话成功过的路线（写进了配置，所以重启也不用重新试错）。
    private func storedPreference(date: Date) -> Preference? {
        let config = config()
        guard let until = config.routeUntil, until > date.timeIntervalSince1970 else { return nil }
        return Preference(proxy: config.routeProxy, mirror: config.routeMirror ?? false, until: date)
    }

    /// 记住成功路线：内存里 10 分钟，配置文件里 24 小时（跨启动）。
    private func remember(_ attempt: Attempt) {
        lock.lock()
        preference = Preference(proxy: attempt.proxy, mirror: attempt.mirror, until: Date().addingTimeInterval(600))
        lock.unlock()
        var config = config()
        let changed = config.routeProxy != attempt.proxy || (config.routeMirror ?? false) != attempt.mirror
        guard changed || (config.routeUntil ?? 0) < Date().timeIntervalSince1970 else { return }
        config.routeProxy = attempt.proxy
        config.routeMirror = attempt.mirror
        config.routeUntil = Date().addingTimeInterval(24 * 3600).timeIntervalSince1970
        try? ShellConfig.save(config)
        lock.lock(); cachedConfig = (config, Date()); lock.unlock()
    }

    private func session(for proxy: String?) -> URLSession {
        guard let proxy, let parsed = URL(string: proxy), let host = parsed.host else { return direct }
        lock.lock(); defer { lock.unlock() }
        if let cached = proxySessions[proxy] { return cached }
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 6
        configuration.timeoutIntervalForResource = 20
        let port = parsed.port ?? 7890
        configuration.connectionProxyDictionary = [
            "HTTPEnable": 1, "HTTPProxy": host, "HTTPPort": port,
            "HTTPSEnable": 1, "HTTPSProxy": host, "HTTPSPort": port,
        ]
        let session = URLSession(configuration: configuration)
        proxySessions[proxy] = session
        return session
    }

    private static func label(_ attempt: Attempt) -> String {
        let target = attempt.mirror ? "vision" : "origin"
        let route = attempt.proxy == nil ? "direct" : "proxy \(attempt.proxy!)"
        return "\(target)/\(route)"
    }

    private func run(_ attempts: [Attempt], index: Int, deadline: Date, errors: [String], lastReply: Reply?, completion: @escaping (Result<Reply, ServiceError>) -> Void) {
        guard index < attempts.count else {
            if let lastReply { completion(.success(lastReply)) } else { completion(.failure(.message(errors.isEmpty ? "NO_ROUTE" : errors.joined(separator: " | ")))) }
            return
        }
        if Date() > deadline {
            if let lastReply { completion(.success(lastReply)) } else { completion(.failure(.message("TIMEOUT: " + errors.joined(separator: " | ")))) }
            return
        }
        let attempt = attempts[index]
        session(for: attempt.proxy).dataTask(with: attempt.url) { [weak self] data, response, error in
            guard let self else { return }
            var nextErrors = errors
            if let error {
                nextErrors.append("\(ProxyService.label(attempt)): \(error.localizedDescription)")
                self.run(attempts, index: index + 1, deadline: deadline, errors: nextErrors, lastReply: lastReply, completion: completion)
                return
            }
            guard let http = response as? HTTPURLResponse else {
                nextErrors.append("\(ProxyService.label(attempt)): NO_RESPONSE")
                self.run(attempts, index: index + 1, deadline: deadline, errors: nextErrors, lastReply: lastReply, completion: completion)
                return
            }
            let reply = Reply(status: http.statusCode, body: data ?? Data(), contentType: http.value(forHTTPHeaderField: "Content-Type") ?? "application/json")
            if [403, 451, 500, 502, 503].contains(http.statusCode), index + 1 < attempts.count {
                nextErrors.append("\(ProxyService.label(attempt)): HTTP \(http.statusCode)")
                self.run(attempts, index: index + 1, deadline: deadline, errors: nextErrors, lastReply: reply, completion: completion)
                return
            }
            self.remember(attempt)
            completion(.success(reply))
        }.resume()
    }
}

// MARK: - Python indicator service

final class PythonService {
    static let shared = PythonService()

    var runnerURL: URL?
    var samplesURL: URL?
    private let io = DispatchQueue(label: "zhuk.python.io")

    var available: Bool { runnerURL != nil && pythonExecutable() != nil }

    func resolveBundledPaths() {
        let environment = ProcessInfo.processInfo.environment
        if let path = environment["ZK_PY_RUNNER"] { runnerURL = URL(fileURLWithPath: path) }
        if let path = environment["ZK_PY_SAMPLES"] { samplesURL = URL(fileURLWithPath: path) }
        if runnerURL == nil, let resources = Bundle.main.resourceURL {
            let candidate = resources.appendingPathComponent("python/runner.py")
            if FileManager.default.fileExists(atPath: candidate.path) { runnerURL = candidate }
        }
        if samplesURL == nil, let resources = Bundle.main.resourceURL {
            let candidate = resources.appendingPathComponent("python/samples")
            if FileManager.default.fileExists(atPath: candidate.path) { samplesURL = candidate }
        }
        if runnerURL == nil {
            let candidate = URL(fileURLWithPath: CommandLine.arguments[0]).deletingLastPathComponent().appendingPathComponent("python/runner.py")
            if FileManager.default.fileExists(atPath: candidate.path) { runnerURL = candidate }
        }
        if samplesURL == nil {
            let candidate = URL(fileURLWithPath: CommandLine.arguments[0]).deletingLastPathComponent().appendingPathComponent("python/samples")
            if FileManager.default.fileExists(atPath: candidate.path) { samplesURL = candidate }
        }
    }

    func pythonExecutable() -> URL? {
        for path in ["/usr/bin/python3", "/opt/homebrew/bin/python3", "/usr/local/bin/python3"] where FileManager.default.isExecutableFile(atPath: path) {
            return URL(fileURLWithPath: path)
        }
        return nil
    }

    func ensureDir() {
        let fileManager = FileManager.default
        let dir = ShellPaths.indicatorsDir
        try? fileManager.createDirectory(at: dir, withIntermediateDirectories: true)
        let names = (try? fileManager.contentsOfDirectory(atPath: dir.path)) ?? []
        guard names.filter({ $0.hasSuffix(".py") }).isEmpty, let samples = samplesURL,
              let sampleNames = try? fileManager.contentsOfDirectory(atPath: samples.path) else { return }
        for name in sampleNames where name.hasSuffix(".py") {
            try? fileManager.copyItem(at: samples.appendingPathComponent(name), to: dir.appendingPathComponent(name))
        }
    }

    func listFiles() -> [[String: Any]] {
        ensureDir()
        let fileManager = FileManager.default
        let dir = ShellPaths.indicatorsDir
        let names = (try? fileManager.contentsOfDirectory(atPath: dir.path)) ?? []
        return names.filter { $0.hasSuffix(".py") }.sorted().map { name in
            let attributes = try? fileManager.attributesOfItem(atPath: dir.appendingPathComponent(name).path)
            let size = (attributes?[.size] as? NSNumber)?.intValue ?? 0
            let mtime = ((attributes?[.modificationDate] as? Date)?.timeIntervalSince1970 ?? 0) * 1000
            return ["name": name, "size": size, "mtime": Int(mtime)]
        }
    }

    static func validName(_ name: String) -> Bool {
        !name.isEmpty && name.count <= 64 && name.hasSuffix(".py") &&
            name.range(of: "^[A-Za-z0-9_\\-]+\\.py$", options: .regularExpression) != nil
    }

    func readFile(_ name: String) -> String? {
        guard PythonService.validName(name) else { return nil }
        return try? String(contentsOf: ShellPaths.indicatorsDir.appendingPathComponent(name), encoding: .utf8)
    }

    func saveFile(_ name: String, code: String) throws {
        guard PythonService.validName(name) else { throw ServiceError.message("非法文件名（仅限字母数字下划线连字符 + .py）") }
        ensureDir()
        try code.write(to: ShellPaths.indicatorsDir.appendingPathComponent(name), atomically: true, encoding: .utf8)
    }

    func deleteFile(_ name: String) throws {
        guard PythonService.validName(name) else { throw ServiceError.message("非法文件名") }
        try FileManager.default.removeItem(at: ShellPaths.indicatorsDir.appendingPathComponent(name))
    }

    func revealInFinder() {
        ensureDir()
        NSWorkspace.shared.selectFile(nil, inFileViewerRootedAtPath: ShellPaths.indicatorsDir.path)
    }

    func run(code: String, fileName: String, candles: [String: Any], params: [String: Any], completion: @escaping ([String: Any]) -> Void) {
        io.async {
            guard let python = self.pythonExecutable() else {
                completion(["ok": false, "error": "未找到 python3（可安装 Xcode 命令行工具或 Python 3）"]); return
            }
            guard let runner = self.runnerURL, FileManager.default.fileExists(atPath: runner.path) else {
                completion(["ok": false, "error": "runner.py 缺失"]); return
            }
            let process = Process()
            process.executableURL = python
            process.arguments = [runner.path]
            var environment = ProcessInfo.processInfo.environment
            environment["PYTHONIOENCODING"] = "utf-8"
            environment["PYTHONUNBUFFERED"] = "1"
            process.environment = environment
            let stdinPipe = Pipe(), stdoutPipe = Pipe(), stderrPipe = Pipe()
            process.standardInput = stdinPipe
            process.standardOutput = stdoutPipe
            process.standardError = stderrPipe
            do {
                try process.run()
            } catch {
                completion(["ok": false, "error": "启动 python3 失败: \(error.localizedDescription)"]); return
            }
            let payload: [String: Any] = ["code": code, "file": fileName, "candles": candles, "params": params]
            if let data = try? JSONSerialization.data(withJSONObject: payload) {
                stdinPipe.fileHandleForWriting.write(data)
            }
            stdinPipe.fileHandleForWriting.closeFile()
            let killer = DispatchWorkItem { if process.isRunning { process.terminate() } }
            DispatchQueue.global().asyncAfter(deadline: .now() + 15, execute: killer)
            let outData = stdoutPipe.fileHandleForReading.readDataToEndOfFile()
            let errData = stderrPipe.fileHandleForReading.readDataToEndOfFile()
            process.waitUntilExit()
            killer.cancel()
            if let object = try? JSONSerialization.jsonObject(with: outData) as? [String: Any], object["ok"] != nil {
                var result = object
                if result["ok"] as? Bool == false, result["stderr"] == nil {
                    let text = String(data: errData, encoding: .utf8) ?? ""
                    if !text.isEmpty { result["stderr"] = String(text.prefix(4000)) }
                }
                completion(result)
            } else {
                let stdout = String(data: outData, encoding: .utf8) ?? ""
                let stderr = String(data: errData, encoding: .utf8) ?? ""
                completion(["ok": false, "error": "python 输出无法解析", "stdout": String(stdout.prefix(2000)), "stderr": String(stderr.prefix(4000))])
            }
        }
    }
}

// MARK: - 深历史本地缓存（抓一次，之后秒开）

/// 把抓到的K线按「品种_周期」落盘到 Application Support/ZhukReplay/history。
/// 每根K线用紧凑数组 [time, open, high, low, close, volume]，避免字段名重复占空间。
enum HistoryStore {
    static var dir: URL { ShellPaths.supportDir.appendingPathComponent("history", isDirectory: true) }

    /// 文件名带市场（现货/永续同品种同周期是两份不同数据，不能共用一个文件）。
    private static func fileName(_ symbol: String, _ interval: String, _ market: String?) -> String {
        let parts = [symbol, market, interval].compactMap { $0 }.filter { !$0.isEmpty }
        let safe = parts.joined(separator: "_").replacingOccurrences(of: "/", with: "-")
        return "\(safe).json"
    }
    private static func fileURL(_ symbol: String, _ interval: String, _ market: String?) -> URL { dir.appendingPathComponent(fileName(symbol, interval, market)) }

    @discardableResult
    static func save(symbol: String, interval: String, market: String?, candles: [[Double]]) -> (count: Int, bytes: Int) {
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let payload: [String: Any] = [
            "symbol": symbol, "interval": interval, "market": market ?? "spot",
            "savedAt": Date().timeIntervalSince1970,
            "candles": candles,
        ]
        guard let data = try? JSONSerialization.data(withJSONObject: payload) else { return (0, 0) }
        do { try data.write(to: fileURL(symbol, interval, market), options: .atomic) } catch { return (0, 0) }
        return (candles.count, data.count)
    }

    static func load(symbol: String, interval: String, market: String?) -> [[Double]] {
        guard let data = try? Data(contentsOf: fileURL(symbol, interval, market)) else { return [] }
        guard let payload = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { return [] }
        if let candles = payload["candles"] as? [[Double]] { return candles }
        if let candles = payload["candles"] as? [[NSNumber]] { return candles.map { $0.map { $0.doubleValue } } }
        return []
    }

    static func list() -> (items: [[String: Any]], bytes: Int) {
        let fm = FileManager.default
        guard let names = try? fm.contentsOfDirectory(atPath: dir.path) else { return ([], 0) }
        var items: [[String: Any]] = []
        var total = 0
        for name in names.filter({ $0.hasSuffix(".json") }) {
            let url = dir.appendingPathComponent(name)
            guard let data = try? Data(contentsOf: url),
                  let payload = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { continue }
            let candles = (payload["candles"] as? [[Double]]) ?? []
            let bytes = data.count
            total += bytes
            items.append([
                "symbol": payload["symbol"] as? String ?? name,
                "interval": payload["interval"] as? String ?? "",
                "market": payload["market"] as? String ?? "spot",
                "count": candles.count,
                "from": candles.first?.first ?? 0,
                "to": candles.last?.first ?? 0,
                "bytes": bytes,
                "savedAt": payload["savedAt"] as? Double ?? 0,
            ])
        }
        items.sort { ($0["symbol"] as? String ?? "") < ($1["symbol"] as? String ?? "") }
        return (items, total)
    }

    @discardableResult
    static func delete(symbol: String, interval: String, market: String?) -> Bool {
        do { try FileManager.default.removeItem(at: fileURL(symbol, interval, market)); return true } catch { return false }
    }

    @discardableResult
    static func clear() -> Int {
        let fm = FileManager.default
        guard let names = try? fm.contentsOfDirectory(atPath: dir.path) else { return 0 }
        var removed = 0
        for name in names where name.hasSuffix(".json") {
            if (try? fm.removeItem(at: dir.appendingPathComponent(name))) != nil { removed += 1 }
        }
        return removed
    }
}
