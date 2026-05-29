package com.devsidecar;

import android.os.Bundle;
import android.os.Handler;
import android.util.Log;
import android.widget.Button;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Switch;
import androidx.appcompat.app.AppCompatActivity;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.ServerSocket;
import java.net.Socket;

/**
 * 主 Activity - Dev-Sidecar Android 控制界面
 * 功能：启动/停止 Node.js 代理，显示日志
 */
public class MainActivity extends AppCompatActivity {
    private static final String TAG = "DevSidecar";
    private TextView logText;
    private ScrollView logScroll;
    private Switch mitmSwitch;
    private Button startBtn, stopBtn;
    private boolean isRunning = false;
    private Process nodeProcess;
    private Handler handler = new Handler();
    private StringBuilder logBuffer = new StringBuilder();

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        logText = findViewById(R.id.log_text);
        logScroll = findViewById(R.id.log_scroll);
        mitmSwitch = findViewById(R.id.mitm_switch);
        startBtn = findViewById(R.id.start_btn);
        stopBtn = findViewById(R.id.stop_btn);

        startBtn.setOnClickListener(v -> startProxy());
        stopBtn.setOnClickListener(v -> stopProxy());

        appendLog("Dev-Sidecar Android v1.0.0");
        appendLog("Node.js proxy bundled in assets/");
        appendLog("Ready. Click 'Start Proxy' to begin.\n");
    }

    private void startProxy() {
        if (isRunning) {
            appendLog("Proxy already running!");
            return;
        }

        appendLog("Starting Node.js proxy...");
        new Thread(() -> {
            try {
                // Extract node binary and proxy.js from assets
                extractAssets();

                // Start Node.js process
                String nodePath = getFilesDir() + "/nodejs/node";
                String proxyPath = getFilesDir() + "/nodejs/proxy.js";
                String[] cmd = {nodePath, proxyPath, "--port", "7890"};
                nodeProcess = new ProcessBuilder(cmd)
                        .directory(getFilesDir() + "/nodejs")
                        .redirectErrorStream(true)
                        .start();

                isRunning = true;
                handler.post(() -> {
                    startBtn.setEnabled(false);
                    stopBtn.setEnabled(true);
                });
                appendLog("Proxy started on port 7890");

                // Read output
                BufferedReader reader = new BufferedReader(
                        new InputStreamReader(nodeProcess.getInputStream()));
                String line;
                while ((line = reader.readLine()) != null) {
                    appendLog(line);
                }

                nodeProcess.waitFor();
                isRunning = false;
                appendLog("Proxy stopped (exit code: " + nodeProcess.exitValue() + ")");
                handler.post(() -> {
                    startBtn.setEnabled(true);
                    stopBtn.setEnabled(false);
                });

            } catch (Exception e) {
                Log.e(TAG, "Failed to start proxy", e);
                appendLog("ERROR: " + e.getMessage());
                isRunning = false;
                handler.post(() -> {
                    startBtn.setEnabled(true);
                    stopBtn.setEnabled(false);
                });
            }
        }).start();
    }

    private void stopProxy() {
        if (!isRunning || nodeProcess == null) {
            appendLog("Proxy not running.");
            return;
        }
        appendLog("Stopping proxy...");
        nodeProcess.destroy();
        // Force kill after 3 seconds
        handler.postDelayed(() -> {
            if (isRunning && nodeProcess != null) {
                nodeProcess.destroyForcibly();
                appendLog("Proxy force-killed.");
            }
        }, 3000);
    }

    private void extractAssets() throws Exception {
        // TODO: Extract node binary and proxy.js from assets/
        // For now, assume they're already extracted
        appendLog("Extracting assets (TODO: implement)");
    }

    private void appendLog(String msg) {
        handler.post(() -> {
            logBuffer.append(msg).append("\n");
            if (logBuffer.length() > 5000) {
                logBuffer.delete(0, logBuffer.length() - 5000);
            }
            logText.setText(logBuffer.toString());
            logScroll.post(() -> logScroll.fullScroll(ScrollView.FOCUS_DOWN));
        });
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        stopProxy();
    }
}
