import UIKit
import WebKit
import CoreAudioKit

@MainActor
private final class WeakScriptHandler: NSObject, WKScriptMessageHandler {
    weak var owner: SoundLabViewController?
    init(_ owner: SoundLabViewController) { self.owner = owner }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        owner?.userContentController(userContentController, didReceive: message)
    }
}

final class SoundLabViewController: UIViewController, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
    private var webView: WKWebView!
    private var bridge: CoreMidiBridge!
    private var observers: [NSObjectProtocol] = []

    override func viewDidLoad() {
        super.viewDidLoad()
        title = "SoundLAB Studio"
        view.backgroundColor = UIColor(red: 0.07, green: 0.07, blue: 0.09, alpha: 1)
        let config = WKWebViewConfiguration()
        config.setURLSchemeHandler(BundledAssets(), forURLScheme: "soundlab")
        config.userContentController.add(WeakScriptHandler(self), name: "soundlabMidi")
        config.allowsInlineMediaPlayback = true
        // Sound still starts from the shared UI's user gesture.
        webView = WKWebView(frame: .zero, configuration: config)
        webView.translatesAutoresizingMaskIntoConstraints = false
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.isOpaque = false
        webView.backgroundColor = view.backgroundColor
        view.addSubview(webView)
        NSLayoutConstraint.activate([
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            webView.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            webView.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor)
        ])
        bridge = CoreMidiBridge(webView: webView)
        bridge.showBluetooth = { [weak self] in self?.showBluetoothChooser() }
        observers.append(NotificationCenter.default.addObserver(forName: UIApplication.willResignActiveNotification, object: nil, queue: .main) { [weak self] _ in
            DispatchQueue.main.async { self?.bridge.suspend() }
        })
        observers.append(NotificationCenter.default.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in
            DispatchQueue.main.async { self?.bridge.resume() }
        })
        webView.load(URLRequest(url: BundledAssets.entry))
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "soundlabMidi", message.frameInfo.isMainFrame,
              BundledAssets.isTrusted(message.frameInfo.request.url), BundledAssets.isTrusted(webView.url),
              let command = message.body as? [String: Any] else { return }
        bridge.handle(command)
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard navigationAction.targetFrame?.isMainFrame != false, BundledAssets.isTrusted(navigationAction.request.url) else {
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.allow)
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        bridge.stop()
        webView.reload()
    }

    private func showBluetoothChooser() {
        guard presentedViewController == nil else { return }
        let chooser = CABTMIDICentralViewController()
        chooser.navigationItem.title = "Connect MIDI keyboard"
        chooser.navigationItem.rightBarButtonItem = UIBarButtonItem(barButtonSystemItem: .done, target: self, action: #selector(closeBluetoothChooser))
        let navigation = UINavigationController(rootViewController: chooser)
        navigation.modalPresentationStyle = .formSheet
        present(navigation, animated: true)
    }

    @objc private func closeBluetoothChooser() { dismiss(animated: true) }

    deinit {
        observers.forEach(NotificationCenter.default.removeObserver)
        let closingBridge = bridge
        DispatchQueue.main.async { closingBridge?.stop() }
    }
}
