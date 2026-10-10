/*!
 * mac/ZhukReplay/HTTPServer.swift - zhuk-replay-studio key native-shell logic
 * (c) 2026 William-Trader (https://github.com/William-Trader)
 * WM: ZRS-9FB3A47A
 * SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
 * Removing this mark violates the license.
 */
// 交易训练室 · embedded server: static files + shell JSON APIs.
// Serves the bundled web build over loopback and exposes:
//   /api/health            app + capability info
//   /api/market/proxy      Binance passthrough (direct → local proxy fallback)
//   /api/python/*          Python indicator files and execution (macOS shell only)
import Foundation
import Network

final class HTTPServer {
    private let root: URL
    private let queue = DispatchQueue(label: "zhuk.http.server")
    private var listener: NWListener?
    private var remaining: [UInt16] = []
    private(set) var port: UInt16 = 0

    private static let maxHeaderBytes = 64 * 1024
    private static let maxBodyBytes = 16 * 1024 * 1024

    var onReady: ((UInt16) -> Void)?
    var onFailure: ((String) -> Void)?

    init(root: URL, preferredPorts: [UInt16]) {
        self.root = root.standardizedFileURL
    }

    func start(preferredPorts: [UInt16]) {
        remaining = preferredPorts
        tryNext()
    }

    func stop() {
        listener?.cancel()
        listener = nil
    }

    private func tryNext() {
        guard let candidate = remaining.first else {
            onFailure?("PORT_UNAVAILABLE")
            return
        }
        remaining.removeFirst()
        do {
            let params = NWParameters.tcp
            params.allowLocalEndpointReuse = true
            if let port = NWEndpoint.Port(rawValue: candidate) {
                params.requiredLocalEndpoint = .hostPort(host: "127.0.0.1", port: port)
            }
            let listener = try NWListener(using: params)
            listener.stateUpdateHandler = { [weak self] state in
                guard let self else { return }
                switch state {
                case .ready:
                    self.listener = listener
                    self.port = listener.port?.rawValue ?? candidate
                    self.onReady?(self.port)
                case .failed:
                    listener.cancel()
                    self.tryNext()
                default:
                    break
                }
            }
            listener.newConnectionHandler = { [weak self] connection in
                self?.accept(connection)
            }
            listener.start(queue: queue)
        } catch {
            tryNext()
        }
    }

    // MARK: - Connection handling

    private func accept(_ connection: NWConnection) {
        connection.start(queue: queue)
        read(connection, accumulated: Data())
    }

    private func read(_ connection: NWConnection, accumulated: Data) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 1 << 16) { [weak self] data, _, isComplete, error in
            guard let self else { connection.cancel(); return }
            var buffer = accumulated
            if let data, !data.isEmpty { buffer.append(data) }
            if let headerEnd = buffer.range(of: Data("\r\n\r\n".utf8)) {
                let head = buffer.subdata(in: 0..<headerEnd.lowerBound)
                let headerText = String(decoding: head, as: UTF8.self)
                let expected = HTTPServer.contentLength(headerText)
                let bodyStart = headerEnd.upperBound
                let have = buffer.count - bodyStart
                if have >= expected {
                    let body = buffer.subdata(in: bodyStart..<(bodyStart + expected))
                    self.dispatch(connection, header: headerText, body: body)
                    return
                }
                if buffer.count > HTTPServer.maxBodyBytes + HTTPServer.maxHeaderBytes { connection.cancel(); return }
                self.read(connection, accumulated: buffer)
                return
            }
            if error != nil || isComplete || buffer.count > HTTPServer.maxHeaderBytes { connection.cancel(); return }
            self.read(connection, accumulated: buffer)
        }
    }

    private func dispatch(_ connection: NWConnection, header: String, body: Data) {
        let requestLine = header.components(separatedBy: "\r\n").first ?? ""
        let parts = requestLine.split(separator: " ")
        guard parts.count >= 2 else { sendStatus(connection, code: 400, reason: "Bad Request"); return }
        let method = parts[0].uppercased()
        let target = String(parts[1])
        let (path, query) = HTTPServer.parseQuery(target)
        let headOnly = method == "HEAD"
        switch (method, path) {
        case ("GET", "/api/health"), ("HEAD", "/api/health"):
            handleHealth(connection, headOnly: headOnly)
        case ("GET", "/api/market/proxy"):
            handleProxy(connection, query: query)
        case ("GET", "/api/python/files"):
            sendJSON(connection, status: 200, object: ["ok": true, "dir": ShellPaths.indicatorsDir.path, "files": PythonService.shared.listFiles()])
        case ("GET", "/api/python/file"):
            guard let name = query["name"], let code = PythonService.shared.readFile(name) else {
                sendJSON(connection, status: 404, object: ["ok": false, "error": "文件不存在"]); return
            }
            sendJSON(connection, status: 200, object: ["ok": true, "name": name, "code": code])
        case ("POST", "/api/python/run"):
            handlePythonRun(connection, body: body)
        case ("POST", "/api/python/save"):
            handlePythonSave(connection, body: body)
        case ("POST", "/api/python/delete"):
            handlePythonDelete(connection, body: body)
        case ("POST", "/api/python/reveal"):
            PythonService.shared.revealInFinder()
            sendJSON(connection, status: 200, object: ["ok": true])
        case ("GET", "/api/history"):
            handleHistoryLoad(connection, query: query)
        case ("GET", "/api/history/list"):
            let result = HistoryStore.list()
            sendJSON(connection, status: 200, object: ["ok": true, "items": result.items, "bytes": result.bytes])
        case ("POST", "/api/history"):
            handleHistorySave(connection, body: body)
        case ("POST", "/api/history/delete"):
            handleHistoryDelete(connection, body: body)
        case ("POST", "/api/history/clear"):
            sendJSON(connection, status: 200, object: ["ok": true, "removed": HistoryStore.clear()])
        case ("GET", "/api/config"):
            let config = ShellConfig.load()
            sendJSON(connection, status: 200, object: ["ok": true, "config": ["proxyUrl": config.proxyUrl ?? ""]])
        case ("POST", "/api/config"):
            handleConfigSave(connection, body: body)
        case ("GET", _), ("HEAD", _):
            serveStatic(connection, path: path, headOnly: headOnly)
        default:
            sendStatus(connection, code: 405, reason: "Method Not Allowed")
        }
    }

    // MARK: - API handlers

    private func handleHealth(_ connection: NWConnection, headOnly: Bool) {
        let payload: [String: Any] = [
            "ok": true,
            "name": "交易训练室",
            "mode": "mac-app",
            "python": PythonService.shared.available,
        ]
        let data = (try? JSONSerialization.data(withJSONObject: payload)) ?? Data("{}".utf8)
        sendData(connection, status: "200 OK", contentType: "application/json; charset=utf-8", body: data, headOnly: headOnly)
    }

    private func handleProxy(_ connection: NWConnection, query: [String: String]) {
        guard let urlString = query["url"], !urlString.isEmpty else {
            sendStatus(connection, code: 400, reason: "Bad Request")
            return
        }
        ProxyService.shared.fetch(urlString) { result in
            switch result {
            case .success(let reply):
                self.sendData(connection, status: "\(reply.status) \(HTTPServer.reason(reply.status))", contentType: reply.contentType, body: reply.body, headOnly: false)
            case .failure(let error):
                let body = Data("proxy error: \(error.text)".utf8)
                self.sendData(connection, status: "502 Bad Gateway", contentType: "text/plain; charset=utf-8", body: body, headOnly: false)
            }
        }
    }

    private func handlePythonRun(_ connection: NWConnection, body: Data) {
        guard let payload = (try? JSONSerialization.jsonObject(with: body)) as? [String: Any] else {
            sendJSON(connection, status: 400, object: ["ok": false, "error": "请求体必须是 JSON"])
            return
        }
        let file = payload["file"] as? String ?? "inline.py"
        let candles = payload["candles"] as? [String: Any] ?? [:]
        let params = payload["params"] as? [String: Any] ?? [:]
        var source = payload["code"] as? String
        if source == nil, let text = PythonService.shared.readFile(file) { source = text }
        guard let code = source else {
            sendJSON(connection, status: 400, object: ["ok": false, "error": "缺少 code 或文件不可读"])
            return
        }
        PythonService.shared.run(code: code, fileName: file, candles: candles, params: params) { result in
            self.sendJSON(connection, status: 200, object: result)
        }
    }

    private func handlePythonSave(_ connection: NWConnection, body: Data) {
        guard let payload = (try? JSONSerialization.jsonObject(with: body)) as? [String: Any],
              let name = payload["name"] as? String, let code = payload["code"] as? String else {
            sendJSON(connection, status: 400, object: ["ok": false, "error": "需要 name 与 code"]); return
        }
        do {
            try PythonService.shared.saveFile(name, code: code)
            sendJSON(connection, status: 200, object: ["ok": true, "name": name])
        } catch {
            sendJSON(connection, status: 400, object: ["ok": false, "error": "保存失败: \(error)"])
        }
    }

    private func handlePythonDelete(_ connection: NWConnection, body: Data) {
        guard let payload = (try? JSONSerialization.jsonObject(with: body)) as? [String: Any],
              let name = payload["name"] as? String else {
            sendJSON(connection, status: 400, object: ["ok": false, "error": "需要 name"]); return
        }
        do {
            try PythonService.shared.deleteFile(name)
            sendJSON(connection, status: 200, object: ["ok": true, "name": name])
        } catch {
            sendJSON(connection, status: 400, object: ["ok": false, "error": "删除失败: \(error)"])
        }
    }

    private func handleHistoryLoad(_ connection: NWConnection, query: [String: String]) {
        let symbol = query["symbol"] ?? "", interval = query["interval"] ?? ""
        guard !symbol.isEmpty, !interval.isEmpty else {
            sendJSON(connection, status: 400, object: ["ok": false, "error": "缺少 symbol 或 interval"]); return
        }
        let candles = HistoryStore.load(symbol: symbol, interval: interval, market: query["market"])
        sendJSON(connection, status: 200, object: ["ok": true, "symbol": symbol, "interval": interval, "candles": candles])
    }

    private func handleHistorySave(_ connection: NWConnection, body: Data) {
        guard let payload = (try? JSONSerialization.jsonObject(with: body)) as? [String: Any],
              let symbol = payload["symbol"] as? String, let interval = payload["interval"] as? String,
              let raw = payload["candles"] as? [[NSNumber]] else {
            sendJSON(connection, status: 400, object: ["ok": false, "error": "请求体需要 symbol/interval/candles"]); return
        }
        let candles = raw.map { $0.map { $0.doubleValue } }
        let result = HistoryStore.save(symbol: symbol, interval: interval, market: payload["market"] as? String, candles: candles)
        sendJSON(connection, status: 200, object: ["ok": true, "count": result.count, "bytes": result.bytes])
    }

    private func handleHistoryDelete(_ connection: NWConnection, body: Data) {
        guard let payload = (try? JSONSerialization.jsonObject(with: body)) as? [String: Any],
              let symbol = payload["symbol"] as? String, let interval = payload["interval"] as? String else {
            sendJSON(connection, status: 400, object: ["ok": false, "error": "请求体需要 symbol/interval"]); return
        }
        sendJSON(connection, status: 200, object: ["ok": true, "removed": HistoryStore.delete(symbol: symbol, interval: interval, market: payload["market"] as? String)])
    }

    private func handleConfigSave(_ connection: NWConnection, body: Data) {
        guard let payload = (try? JSONSerialization.jsonObject(with: body)) as? [String: Any] else {
            sendJSON(connection, status: 400, object: ["ok": false, "error": "请求体必须是 JSON"]); return
        }
        var config = ShellConfig.load()
        if let proxy = payload["proxyUrl"] as? String {
            let trimmed = proxy.trimmingCharacters(in: .whitespaces)
            config.proxyUrl = trimmed.isEmpty ? nil : trimmed
        }
        do {
            try ShellConfig.save(config)
            ProxyService.shared.invalidateConfig()
            sendJSON(connection, status: 200, object: ["ok": true, "config": ["proxyUrl": config.proxyUrl ?? ""]])
        } catch {
            sendJSON(connection, status: 500, object: ["ok": false, "error": "保存配置失败: \(error)"])
        }
    }

    // MARK: - Static files

    private func serveStatic(_ connection: NWConnection, path: String, headOnly: Bool) {
        var relative = path.hasPrefix("/") ? String(path.dropFirst()) : path
        if relative.isEmpty { relative = "index.html" }
        var fileURL = root.appendingPathComponent(relative).standardizedFileURL
        guard fileURL.path == root.path || fileURL.path.hasPrefix(root.path + "/") else {
            sendStatus(connection, code: 403, reason: "Forbidden")
            return
        }
        var isDirectory: ObjCBool = false
        if FileManager.default.fileExists(atPath: fileURL.path, isDirectory: &isDirectory), isDirectory.boolValue {
            fileURL.appendPathComponent("index.html")
        }
        guard let body = try? Data(contentsOf: fileURL) else {
            sendStatus(connection, code: 404, reason: "Not Found")
            return
        }
        sendData(connection, status: "200 OK", contentType: HTTPServer.mimeType(for: fileURL.pathExtension), body: body, headOnly: headOnly)
    }

    // MARK: - Helpers

    private func sendStatus(_ connection: NWConnection, code: Int, reason: String) {
        let body = Data("\(code) \(reason)".utf8)
        sendData(connection, status: "\(code) \(reason)", contentType: "text/plain; charset=utf-8", body: body, headOnly: false)
    }

    private func sendJSON(_ connection: NWConnection, status: Int, object: [String: Any]) {
        let data = (try? JSONSerialization.data(withJSONObject: object)) ?? Data("{}".utf8)
        sendData(connection, status: "\(status) \(HTTPServer.reason(status))", contentType: "application/json; charset=utf-8", body: data, headOnly: false)
    }

    private func sendData(_ connection: NWConnection, status: String, contentType: String, body: Data, headOnly: Bool) {
        var header = "HTTP/1.1 \(status)\r\n"
        header += "Content-Type: \(contentType)\r\n"
        header += "Content-Length: \(body.count)\r\n"
        header += "Cache-Control: no-store\r\n"
        header += "X-Content-Type-Options: nosniff\r\n"
        header += "Connection: close\r\n\r\n"
        var payload = Data(header.utf8)
        if !headOnly { payload.append(body) }
        connection.send(content: payload, completion: .contentProcessed { _ in
            connection.cancel()
        })
    }

    static func parseQuery(_ target: String) -> (String, [String: String]) {
        guard let mark = target.firstIndex(of: "?") else {
            return (target.removingPercentEncoding ?? target, [:])
        }
        let rawPath = String(target[..<mark])
        var query: [String: String] = [:]
        for pair in target[target.index(after: mark)...].split(separator: "&") {
            let parts = pair.split(separator: "=", maxSplits: 1)
            let key = String(parts[0]).removingPercentEncoding ?? String(parts[0])
            let raw = parts.count > 1 ? String(parts[1]) : ""
            query[key] = raw.replacingOccurrences(of: "+", with: " ").removingPercentEncoding ?? raw
        }
        return (rawPath.removingPercentEncoding ?? rawPath, query)
    }

    private static func contentLength(_ header: String) -> Int {
        for line in header.components(separatedBy: "\r\n").dropFirst() where line.lowercased().hasPrefix("content-length:") {
            let value = line.components(separatedBy: ":").dropFirst().joined(separator: ":").trimmingCharacters(in: .whitespaces)
            return max(0, min(Int(value) ?? 0, HTTPServer.maxBodyBytes))
        }
        return 0
    }

    private static func reason(_ code: Int) -> String {
        switch code {
        case 200: return "OK"
        case 204: return "No Content"
        case 400: return "Bad Request"
        case 403: return "Forbidden"
        case 404: return "Not Found"
        case 429: return "Too Many Requests"
        case 451: return "Unavailable For Legal Reasons"
        case 500: return "Internal Server Error"
        case 502: return "Bad Gateway"
        case 503: return "Service Unavailable"
        default: return "Upstream"
        }
    }

    static func mimeType(for ext: String) -> String {
        switch ext.lowercased() {
        case "html": return "text/html; charset=utf-8"
        case "js", "mjs": return "text/javascript; charset=utf-8"
        case "css": return "text/css; charset=utf-8"
        case "json": return "application/json; charset=utf-8"
        case "svg": return "image/svg+xml"
        case "png": return "image/png"
        case "jpg", "jpeg": return "image/jpeg"
        case "ico": return "image/x-icon"
        case "woff2": return "font/woff2"
        case "txt", "md": return "text/plain; charset=utf-8"
        default: return "application/octet-stream"
        }
    }
}
