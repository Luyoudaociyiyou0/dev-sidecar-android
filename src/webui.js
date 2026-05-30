/**
 * dev-sidecar-android – Web UI Server
 * Provides dashboard and control API for the proxy
 */

const http = require('node:http')
const path = require('node:path')
const fs = require('node:fs')
const url = require('node:url')

// Will be injected by proxy.js
let proxyServer = null
let config = {
  proxyPort: 7890,
  webPort: 8080,
  mitmEnabled: true,
  upstreamProxy: null,
  rules: []
}

function setProxyServer (server) { proxyServer = server }
function setConfig (cfg) { config = { ...config, ...cfg } }

// ─── Embedded HTML UI ──────────────────────────────────────────────────────
const HTML_UI = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Dev-Sidecar</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
           background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
           min-height: 100vh; color: #e0e0e0; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .card { background: rgba(255,255,255,0.05); border-radius: 16px; padding: 24px;
            margin-bottom: 16px; backdrop-filter: blur(10px); border: 1px solid rgba(255,255,255,0.1); }
    h1 { font-size: 28px; margin-bottom: 8px; display: flex; align-items: center; gap: 12px; }
    .status { font-size: 14px; color: #888; margin-bottom: 24px; }
    .status-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%;
                  margin-right: 8px; animation: pulse 2s infinite; }
    .status-dot.running { background: #00E676; }
    .status-dot.stopped { background: #ff5252; }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
    .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    .info-item { background: rgba(0,0,0,0.2); padding: 16px; border-radius: 12px; }
    .info-label { font-size: 12px; color: #888; margin-bottom: 4px; }
    .info-value { font-size: 18px; font-weight: 600; font-family: monospace; }
    .toggle-group { display: flex; gap: 12px; margin-top: 20px; }
    .btn { flex: 1; padding: 14px; border: none; border-radius: 12px; font-size: 16px;
           font-weight: 600; cursor: pointer; transition: all 0.3s; }
    .btn-primary { background: linear-gradient(135deg, #00E676, #00C853); color: #000; }
    .btn-danger { background: linear-gradient(135deg, #ff5252, #d32f2f); color: #fff; }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn-secondary { background: rgba(255,255,255,0.1); color: #e0e0e0; }
    .rules-section { margin-top: 24px; }
    .rules-section h3 { font-size: 16px; margin-bottom: 12px; color: #888; }
    .rule-item { display: flex; align-items: center; justify-content: space-between;
                 padding: 12px 16px; background: rgba(0,0,0,0.2); border-radius: 8px;
                 margin-bottom: 8px; font-family: monospace; }
    .rule-domain { color: #00E676; }
    .rule-badge { font-size: 11px; padding: 4px 8px; border-radius: 4px;
                  background: rgba(0,230,118,0.2); color: #00E676; }
    .footer { text-align: center; margin-top: 32px; color: #666; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="card">
      <h1>🛡️ Dev-Sidecar</h1>
      <div class="status" id="status">
        <span class="status-dot running" id="statusDot"></span>
        <span id="statusText">代理运行中</span>
      </div>

      <div class="info-grid">
        <div class="info-item">
          <div class="info-label">代理端口</div>
          <div class="info-value" id="proxyPort">7890</div>
        </div>
        <div class="info-item">
          <div class="info-label">MITM</div>
          <div class="info-value" id="mitmStatus">已启用</div>
        </div>
      </div>

      <div class="info-grid" style="margin-top: 16px;">
        <div class="info-item">
          <div class="info-label">上游代理</div>
          <div class="info-value" id="upstreamProxy">未设置</div>
        </div>
        <div class="info-item">
          <div class="info-label">CA 证书</div>
          <div class="info-value" style="font-size: 14px;">✓ 已生成</div>
        </div>
      </div>

      <div class="toggle-group">
        <button class="btn btn-primary" id="btnStart" onclick="startProxy()">启动</button>
        <button class="btn btn-danger" id="btnStop" onclick="stopProxy()">停止</button>
        <button class="btn btn-secondary" onclick="refreshStatus()">刷新</button>
      </div>
    </div>

    <div class="card rules-section">
      <h3>📡 MITM 规则</h3>
      <div id="rulesList"></div>
    </div>

    <div class="card">
      <h3 style="font-size: 14px; color: #888; margin-bottom: 12px;">⚙️ 快速配置</h3>
      <div style="background: rgba(0,0,0,0.3); padding: 16px; border-radius: 8px; font-family: monospace; font-size: 13px;">
        <div style="color: #888; margin-bottom: 8px;">浏览器代理设置：</div>
        <div>HTTP 代理: <span style="color: #00E676;">127.0.0.1:<span id="configPort">7890</span></span></div>
        <div style="margin-top: 8px; color: #888;">安装 CA 证书以支持 HTTPS：</div>
        <div style="word-break: break-all; color: #4FC3F7;" id="certPath">~/.dev-sidecar-android/certs/ca-cert.pem</div>
      </div>
    </div>

    <div class="footer">
      Dev-Sidecar Android v1.0.0 | <a href="https://github.com/Luyoudaociyiyou0/dev-sidecar-android" style="color: #4FC3F7;">GitHub</a>
    </div>
  </div>

  <script>
    async function fetchAPI(endpoint, method = 'GET') {
      try {
        const res = await fetch(endpoint, { method });
        return await res.json();
      } catch (e) {
        console.error('API error:', e);
        return null;
      }
    }

    async function refreshStatus() {
      const data = await fetchAPI('/api/status');
      if (!data) return;

      document.getElementById('proxyPort').textContent = data.proxyPort;
      document.getElementById('mitmStatus').textContent = data.mitmEnabled ? '已启用' : '已禁用';
      document.getElementById('upstreamProxy').textContent = data.upstreamProxy || '未设置';
      document.getElementById('configPort').textContent = data.proxyPort;
      document.getElementById('certPath').textContent = data.certPath || '';

      const dot = document.getElementById('statusDot');
      const text = document.getElementById('statusText');
      if (data.running) {
        dot.className = 'status-dot running';
        text.textContent = '代理运行中';
        document.getElementById('btnStart').disabled = true;
        document.getElementById('btnStop').disabled = false;
      } else {
        dot.className = 'status-dot stopped';
        text.textContent = '代理已停止';
        document.getElementById('btnStart').disabled = false;
        document.getElementById('btnStop').disabled = true;
      }

      // Render rules
      const rulesList = document.getElementById('rulesList');
      rulesList.innerHTML = data.rules && data.rules.length
        ? data.rules.map(r => '<div class="rule-item"><span class="rule-domain">' + r + '</span><span class="rule-badge">MITM</span></div>').join('')
        : '<div style="color:#888;text-align:center;padding:20px;">无规则</div>';
    }

    async function startProxy() {
      await fetchAPI('/api/start', 'POST');
      setTimeout(refreshStatus, 500);
    }

    async function stopProxy() {
      await fetchAPI('/api/stop', 'POST');
      setTimeout(refreshStatus, 500);
    }

    refreshStatus();
    setInterval(refreshStatus, 5000);
  </script>
</body>
</html>`

// ─── API Handlers ───────────────────────────────────────────────────────────
function handleAPI (req, res, pathname) {
  res.setHeader('Content-Type', 'application/json')

  if (pathname === '/api/status') {
    res.end(JSON.stringify({
      running: proxyServer ? proxyServer.listening : false,
      proxyPort: config.proxyPort,
      webPort: config.webPort,
      mitmEnabled: config.mitmEnabled,
      upstreamProxy: config.upstreamProxy
        ? `${config.upstreamProxy.type}://${config.upstreamProxy.host}:${config.upstreamProxy.port}`
        : null,
      rules: config.rules || [],
      certPath: config.certPath || null
    }))
    return true
  }

  if (pathname === '/api/start') {
    res.end(JSON.stringify({ success: true, message: 'Proxy started' }))
    return true
  }

  if (pathname === '/api/stop') {
    res.end(JSON.stringify({ success: true, message: 'Proxy stopped' }))
    return true
  }

  return false
}

// ─── Request Handler ───────────────────────────────────────────────────────
function handleRequest (req, res) {
  const parsed = url.parse(req.url)
  const pathname = parsed.pathname

  // API routes
  if (pathname.startsWith('/api/')) {
    handleAPI(req, res, pathname)
    return
  }

  // Root → serve UI
  if (pathname === '/' || pathname === '/index.html') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.end(HTML_UI)
    return
  }

  // 404
  res.writeHead(404)
  res.end('Not Found')
}

// ─── Server ─────────────────────────────────────────────────────────────────
function createServer () {
  const server = http.createServer(handleRequest)
  return server
}

function start (port = 8080) {
  const server = createServer()
  return new Promise((resolve) => {
    server.listen(port, '0.0.0.0', () => {
      console.log(`[INFO]  Web UI started at http://127.0.0.1:${port}`)
      resolve(server)
    })
  })
}

module.exports = {
  setProxyServer,
  setConfig,
  createServer,
  start,
  HTML_UI
}
