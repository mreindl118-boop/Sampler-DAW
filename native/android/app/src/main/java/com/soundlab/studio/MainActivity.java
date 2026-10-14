package com.soundlab.studio;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebChromeClient;
import android.webkit.ValueCallback;
import android.webkit.PermissionRequest;
import android.widget.TextView;
import androidx.webkit.WebViewAssetLoader;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.HashMap;
import java.util.Map;

public final class MainActivity extends Activity {
    static final String ORIGIN = "https://appassets.androidplatform.net";
    static final String ENTRY = ORIGIN + "/app/index.html";
    private static final int PICK_FILE = 8430;
    private static final int REQUEST_MICROPHONE = 8431;
    private WebView webView;
    private MidiBridge midi;
    private ValueCallback<Uri[]> fileSelection;
    private PermissionRequest audioPermissionRequest;
    private boolean microphonePermissionInFlight;
    private boolean foreground;

    static boolean isTrusted(Uri uri) {
        return uri != null && "https".equals(uri.getScheme()) && "appassets.androidplatform.net".equals(uri.getHost())
            && uri.getPort() == -1 && uri.getUserInfo() == null && uri.getPath() != null && uri.getPath().startsWith("/app/");
    }

    private static boolean isTrustedOrigin(Uri uri) {
        return uri != null && "https".equals(uri.getScheme()) && "appassets.androidplatform.net".equals(uri.getHost())
            && uri.getPort() == -1 && uri.getUserInfo() == null;
    }

    @SuppressLint("SetJavaScriptEnabled")
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        setTitle("SoundLAB Studio");
        webView = new WebView(this);
        webView.setBackgroundColor(Color.rgb(18, 18, 23));
        webView.getSettings().setJavaScriptEnabled(true);
        webView.getSettings().setDomStorageEnabled(true);
        webView.getSettings().setAllowFileAccess(false);
        webView.getSettings().setAllowContentAccess(false);
        webView.getSettings().setMediaPlaybackRequiresUserGesture(true);
        webView.getSettings().setSupportMultipleWindows(false);
        webView.getSettings().setMixedContentMode(android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        webView.setWebChromeClient(new WebChromeClient() {
            @Override public void onPermissionRequest(PermissionRequest request) {
                runOnUiThread(() -> requestAudioCapture(request));
            }
            @Override public void onPermissionRequestCanceled(PermissionRequest request) {
                runOnUiThread(() -> {
                    if (audioPermissionRequest == request) audioPermissionRequest = null;
                });
            }
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams parameters) {
                if (!isTrusted(Uri.parse(view.getUrl() == null ? "" : view.getUrl()))) { callback.onReceiveValue(null); return true; }
                if (fileSelection != null) fileSelection.onReceiveValue(null);
                fileSelection = callback;
                try { startActivityForResult(parameters.createIntent(), PICK_FILE); }
                catch (ActivityNotFoundException unavailable) { fileSelection = null; callback.onReceiveValue(null); }
                return true;
            }
        });
        webView.setOnApplyWindowInsetsListener((view, insets) -> {
            if (android.os.Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets safe = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                view.setPadding(safe.left, safe.top, safe.right, safe.bottom);
            } else {
                view.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(), insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            }
            return insets;
        });
        final WebViewAssetLoader loader = new WebViewAssetLoader.Builder()
            .addPathHandler("/", new WebViewAssetLoader.AssetsPathHandler(this)).build();
        webView.setWebViewClient(new WebViewClient() {
            @Override public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                cancelAudioCaptureRequest();
            }
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                if (!isTrusted(request.getUrl()) || !"GET".equals(request.getMethod())) return blocked();
                WebResourceResponse response = loader.shouldInterceptRequest(request.getUrl());
                if (response == null) return blocked();
                Map<String, String> headers = new HashMap<>();
                headers.put("Content-Security-Policy", "default-src 'self' data: blob:; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data: blob:; media-src 'self' data: blob:; worker-src 'self' blob:; object-src 'none'; frame-src 'none'; base-uri 'self'");
                headers.put("X-Content-Type-Options", "nosniff");
                response.setResponseHeaders(headers);
                return response;
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return !request.isForMainFrame() || !isTrusted(request.getUrl());
            }
            @Override public void onPageFinished(WebView view, String url) { if (midi != null) midi.pageReady(); }
        });
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            TextView message = new TextView(this);
            message.setText("Update Android System WebView to enable SoundLAB's secure MIDI connection.");
            message.setPadding(32, 64, 32, 32);
            setContentView(message);
            webView.destroy();
            webView = null;
            return;
        }
        midi = new MidiBridge(this, webView);
        WebViewCompat.addWebMessageListener(webView, "SoundLabMidi", Collections.singleton(ORIGIN),
            (view, message, sourceOrigin, isMainFrame, replyProxy) -> {
                if (!isMainFrame || !isTrustedOrigin(sourceOrigin) || !isTrusted(Uri.parse(view.getUrl() == null ? "" : view.getUrl()))) return;
                if (message.getType() != androidx.webkit.WebMessageCompat.TYPE_STRING) return;
                String body = message.getData();
                if (body != null) midi.command(body);
            });
        setContentView(webView);
        webView.loadUrl(ENTRY);
    }

    private static WebResourceResponse blocked() {
        return new WebResourceResponse("text/plain", "UTF-8", 403, "Forbidden", Collections.emptyMap(),
            new ByteArrayInputStream("Only bundled SoundLAB assets are allowed.".getBytes(StandardCharsets.UTF_8)));
    }

    private boolean allowsAudioCapture(PermissionRequest request) {
        String[] resources = request.getResources();
        return foreground && webView != null && !isFinishing() && !isDestroyed()
            && isTrustedOrigin(request.getOrigin())
            && isTrusted(Uri.parse(webView.getUrl() == null ? "" : webView.getUrl()))
            && resources != null && resources.length == 1
            && PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resources[0]);
    }

    private void requestAudioCapture(PermissionRequest request) {
        // Every request is checked independently. Never grant arbitrary or future WebView resources.
        if (!allowsAudioCapture(request) || audioPermissionRequest != null || microphonePermissionInFlight) {
            request.deny();
            return;
        }
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
            request.grant(new String[] { PermissionRequest.RESOURCE_AUDIO_CAPTURE });
            return;
        }
        audioPermissionRequest = request;
        microphonePermissionInFlight = true;
        requestPermissions(new String[] { Manifest.permission.RECORD_AUDIO }, REQUEST_MICROPHONE);
    }

    private void cancelAudioCaptureRequest() {
        PermissionRequest pending = audioPermissionRequest;
        audioPermissionRequest = null;
        if (pending != null) pending.deny();
        // Keep the in-flight flag until the OS result arrives; an old result must not grant a new request.
    }

    @Override protected void onResume() {
        super.onResume();
        foreground = true;
        if (webView != null) webView.onResume();
        if (midi != null) midi.resume();
    }

    @Override protected void onStop() {
        foreground = false;
        cancelAudioCaptureRequest();
        if (midi != null) midi.suspend();
        if (webView != null) webView.onPause();
        super.onStop();
    }

    @Override protected void onDestroy() {
        foreground = false;
        cancelAudioCaptureRequest();
        if (fileSelection != null) { fileSelection.onReceiveValue(null); fileSelection = null; }
        if (midi != null) midi.stop();
        if (webView != null) {
            if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
                WebViewCompat.removeWebMessageListener(webView, "SoundLabMidi");
            }
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }

    @Override public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQUEST_MICROPHONE) {
            microphonePermissionInFlight = false;
            PermissionRequest pending = audioPermissionRequest;
            audioPermissionRequest = null;
            if (pending != null) {
                if (allowsAudioCapture(pending) && checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                    pending.grant(new String[] { PermissionRequest.RESOURCE_AUDIO_CAPTURE });
                } else pending.deny();
            }
            return;
        }
        if (midi != null) midi.permissionResult(requestCode);
    }

    @Override protected void onActivityResult(int requestCode, int resultCode, android.content.Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == PICK_FILE) {
            ValueCallback<Uri[]> callback = fileSelection;
            fileSelection = null;
            if (callback != null) {
                Uri[] files = WebChromeClient.FileChooserParams.parseResult(resultCode, data);
                if (files != null) for (Uri file : files) if (file == null || !"content".equals(file.getScheme())) { files = null; break; }
                callback.onReceiveValue(files);
            }
            return;
        }
        if (midi != null) midi.activityResult(requestCode, resultCode);
    }
}
