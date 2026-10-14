import Foundation
import WebKit
import UniformTypeIdentifiers

/// Only serves the bundled build. No remote page receives the MIDI bridge.
final class BundledAssets: NSObject, WKURLSchemeHandler {
    static let entry = URL(string: "soundlab://app/index.html")!
    static let contentPolicy = "default-src 'self' data: blob:; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data: blob:; media-src 'self' data: blob:; worker-src 'self' blob:; object-src 'none'; frame-src 'none'; base-uri 'self'"
    private let root = Bundle.main.bundleURL.appendingPathComponent("Web", isDirectory: true).resolvingSymlinksInPath()

    static func isTrusted(_ url: URL?) -> Bool {
        guard let url = url else { return false }
        return url.scheme == "soundlab" && url.host == "app" && url.user == nil && url.password == nil && url.port == nil
    }

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        guard let url = urlSchemeTask.request.url, Self.isTrusted(url),
              urlSchemeTask.request.httpMethod == nil || urlSchemeTask.request.httpMethod == "GET" else {
            urlSchemeTask.didFailWithError(NSError(domain: "SoundLABAssets", code: 403))
            return
        }
        let relative = url.path == "/" ? "index.html" : String(url.path.dropFirst())
        let file = root.appendingPathComponent(relative).standardizedFileURL.resolvingSymlinksInPath()
        guard file.path.hasPrefix(root.path + "/"), let data = try? Data(contentsOf: file) else {
            urlSchemeTask.didFailWithError(NSError(domain: "SoundLABAssets", code: 404,
                userInfo: [NSLocalizedDescriptionKey: "Bundled SoundLAB asset missing. Run npm run native:sync before building."]))
            return
        }
        let mime: String
        switch file.pathExtension.lowercased() {
        case "js", "mjs": mime = "application/javascript"
        case "css": mime = "text/css"
        case "html": mime = "text/html"
        case "json", "webmanifest": mime = "application/json"
        case "wasm": mime = "application/wasm"
        default: mime = UTType(filenameExtension: file.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
        }
        let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: [
            "Content-Type": mime,
            "Content-Length": String(data.count),
            "Content-Security-Policy": Self.contentPolicy,
            "X-Content-Type-Options": "nosniff"
        ])!
        urlSchemeTask.didReceive(response)
        urlSchemeTask.didReceive(data)
        urlSchemeTask.didFinish()
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {}
}
