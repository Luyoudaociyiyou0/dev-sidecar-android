package com.devsidecar;

import android.os.Bundle;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.ConsoleMessage;
import android.widget.Toast;
import androidx.appcompat.app.AppCompatActivity;

/**
 * MainActivity - WebView shell connecting to dev-sidecar proxy web UI
 * The proxy runs separately (Termux or embedded). This app provides
 * a convenient UI for controlling it.
 */
public class MainActivity extends AppCompatActivity {
    private static final String TAG = "DevSidecar";
    private static final String DEFAULT_PROXY_URL = "http://127.0.0.1:8080";

    private WebView webView;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        webView = new WebView(this);
        setContentView(webView);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setCacheMode(WebSettings.LOAD_NO_CACHE);

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onReceivedError(WebView view, int errorCode, String desc, String url) {
                view.loadData(
                    "<html><body style='background:#212121;color:#00E676;font-family:monospace;"
                    + "display:flex;justify-content:center;align-items:center;height:100vh;"
                    + "flex-direction:column;text-align:center;padding:20px'>"
                    + "<h2>Dev-Sidecar</h2>"
                    + "<p>Proxy web UI not reachable.</p>"
                    + "<p>Make sure the proxy is running:<br>"
                    + "<code>dsc --port 7890 --web-port 8080</code></p>"
                    + "<p style='color:#666;font-size:12px'>" + desc + "</p>"
                    + "<button onclick='location.reload()' style='margin-top:16px;"
                    + "padding:8px 24px;background:#4CAF50;color:#fff;border:none;"
                    + "border-radius:4px;font-size:16px;cursor:pointer'>Retry</button>"
                    + "</body></html>",
                    "text/html", "UTF-8");
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onConsoleMessage(ConsoleMessage msg) {
                android.util.Log.d(TAG, "[WEB] " + msg.message());
                return true;
            }
        });

        // Load proxy web UI
        String url = getIntent().getStringExtra("proxy_url");
        if (url == null) url = DEFAULT_PROXY_URL;
        webView.loadUrl(url);
    }

    @Override
    public void onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onDestroy() {
        webView.destroy();
        super.onDestroy();
    }
}
