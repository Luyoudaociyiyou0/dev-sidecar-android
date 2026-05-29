package com.devsidecar;

import android.app.Service;
import android.content.Intent;
import android.os.IBinder;
import android.util.Log;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;

/**
 * NodeService - 后台运行 Node.js 代理
 * 使用 nodejs-mobile-android 启动 proxy.js
 */
public class NodeService extends Service {
    private static final String TAG = "DevSidecar/NodeService";
    private Thread nodeThread;
    private volatile boolean shouldStop = false;

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        Log.i(TAG, "Starting Node.js proxy...");
        startNodeProxy();
        return START_STICKY;
    }

    private void startNodeProxy() {
        shouldStop = false;
        nodeThread = new Thread(() -> {
            try {
                // 1. 将 assets/nodejs/ 中的文件复制到应用私有目录
                File nodejsDir = new File(getFilesDir(), "nodejs");
                if (!nodejsDir.exists()) {
                    nodejsDir.mkdirs();
                }
                copyAssetFolder("nodejs", nodejsDir);

                // 2. 使用 nodejs-mobile-android 启动 Node.js
                // nodejs-mobile-android 提供 NodeJS.startNodeProject 方法
                // 这里我们用 Runtime 执行（简化版）
                File proxyJs = new File(nodejsDir, "proxy.js");
                File nodeBinary = findNodeBinary();

                if (nodeBinary == null || !nodeBinary.exists()) {
                    Log.e(TAG, "Node.js binary not found!");
                    return;
                }

                // 启动 Node.js 进程
                String[] cmd = {nodeBinary.getAbsolutePath(), proxyJs.getAbsolutePath(), "--port", "7890"};
                ProcessBuilder pb = new ProcessBuilder(cmd);
                pb.directory(nodejsDir);
                pb.redirectErrorStream(true);

                Process process = pb.start();
                Log.i(TAG, "Node.js proxy started, PID: " + process.pid());

                // 读取输出
                InputStream is = process.getInputStream();
                byte[] buffer = new byte[4096];
                int len;
                while (!shouldStop && (len = is.read(buffer)) != -1) {
                    String line = new String(buffer, 0, len);
                    Log.i(TAG, "[NODE] " + line.trim());
                }

                process.destroy();
                if (shouldStop) {
                    process.destroyForcibly();
                }
                Log.i(TAG, "Node.js proxy stopped");

            } catch (Exception e) {
                Log.e(TAG, "Failed to start Node.js proxy", e);
            }
        });
        nodeThread.start();
    }

    private File findNodeBinary() {
        // nodejs-mobile-android 会把 node 二进制放在 lib/ 目录
        File libDir = new File(getApplicationInfo().nativeLibraryDir);
        File nodeBin = new File(libDir, "libnode.so");
        if (nodeBin.exists()) {
            return nodeBin;
        }
        // 备用：检查 files/nodejs/node
        File alt = new File(getFilesDir(), "nodejs/node");
        if (alt.exists()) {
            return alt;
        }
        return null;
    }

    private void copyAssetFolder(String assetPath, File destDir) throws Exception {
        String[] files = getAssets().list(assetPath);
        if (files == null || files.length == 0) {
            // 是文件，直接复制
            copyAssetFile(assetPath, new File(destDir, new File(assetPath).getName()));
            return;
        }
        destDir.mkdirs();
        for (String file : files) {
            String assetFilePath = assetPath + "/" + file;
            File destFile = new File(destDir, file);
            try {
                // 尝试作为目录继续
                copyAssetFolder(assetFilePath, destFile);
            } catch (Exception e) {
                // 是文件
                copyAssetFile(assetFilePath, destFile);
            }
        }
    }

    private void copyAssetFile(String assetPath, File destFile) throws Exception {
        InputStream is = getAssets().open(assetPath);
        destFile.getParentFile().mkdirs();
        OutputStream os = new FileOutputStream(destFile);
        byte[] buffer = new byte[4096];
        int len;
        while ((len = is.read(buffer)) != -1) {
            os.write(buffer, 0, len);
        }
        is.close();
        os.close();
        Log.d(TAG, "Copied asset: " + assetPath + " -> " + destFile.getAbsolutePath());
    }

    @Override
    public void onDestroy() {
        Log.i(TAG, "Service destroying...");
        shouldStop = true;
        if (nodeThread != null) {
            nodeThread.interrupt();
        }
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
